-- Run this in the Supabase SQL editor. Adds per-song collaboration: up to 4
-- people (one owner + up to 3 editors) can work on the same song. Joining
-- happens through a shareable invite link/code, not by looking someone up
-- by email — nothing here needs an email-sending integration.
--
-- Scope, on purpose:
--   - Per SONG, not per album and not per artist account. An album with
--     collaborating songs doesn't itself become shared — each track keeps
--     its own collaborator list.
--   - Resources (the artist-level Recursos library) are untouched — they
--     were explicitly designed as "yours, not the project's" and stay that
--     way. Collaborators on a song do NOT get access to each other's
--     Recursos libraries.
--   - Baúl's fused ADN Lírico (songs.lyric_dna) stays exactly as hidden as
--     it already was — nobody, owner or editor, ever saw it rendered
--     before, and that doesn't change. The glass cabinet (baul_items, the
--     artist's own raw INPUTS) becomes visible to every collaborator, same
--     as every other song-scoped table below — it's part of working on the
--     song together, not part of the hidden ADN.
--   - Sync model: Supabase Realtime (Postgres Changes + Presence) broadcasts
--     row changes live to everyone viewing the same song; conflict handling
--     is last-write-wins per LINE row, not a full text CRDT merge. Two
--     people editing the exact same line in the exact same second can still
--     clobber each other — deliberately not solved here, since lines are
--     already the natural unit of contention and real collisions on one
--     physical line at the same instant should be rare for up to 4 people.
--     Flag this if it turns out to matter in practice.
--
-- Safe to re-run.

create extension if not exists pgcrypto;

-- ─── profiles ───────────────────────────────────────────────────────────────
-- auth.users isn't queryable from the client at all (Supabase locks it down
-- to the service role), so there was never a way to show "who" anyone is —
-- collaboration is the first feature that actually needs it. Minimal: just a
-- display name, defaulted from the email's local part, user-editable. Not
-- exposing email itself to other collaborators, only this.
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

create or replace function ensure_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_ensure_profile on auth.users;
create trigger trg_ensure_profile
  after insert on auth.users
  for each row execute function ensure_profile_for_user();

-- Backfill for every account that already exists.
insert into profiles (id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

alter table profiles enable row level security;

-- profiles_read/profiles_self_update (below project_collaborators, since
-- profiles_read's USING clause queries it — a policy's condition is parsed
-- against real tables at CREATE POLICY time, unlike a function body, which
-- is only checked when it actually runs) are defined further down, right
-- after that table exists.

-- ─── project_collaborators ──────────────────────────────────────────────────
-- One row per (song, person) — INCLUDING the owner, so "who can touch this
-- song" is always one table, one query, no special-casing songs.user_id
-- everywhere it's asked. The owner's row is created automatically (trigger
-- below) the moment a song is; it's never created or removable by hand.
create table if not exists project_collaborators (
  id         uuid primary key default gen_random_uuid(),
  song_id    uuid not null references songs(id) on delete cascade,
  -- References profiles, not auth.users directly, even though every
  -- profiles.id already IS an auth.users id 1:1 — PostgREST's embedded-
  -- resource syntax (.select('..., profiles(display_name)'), used by
  -- loadCollaborators in collaborationData.js) needs an actual foreign key
  -- to the table being embedded, not just a shared ancestor. profiles rows
  -- are guaranteed to exist for every user (signup trigger + backfill,
  -- both above) by the time anything ever inserts here.
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null check (role in ('owner', 'editor')),
  joined_at  timestamptz not null default now(),
  unique (song_id, user_id)
);

create index if not exists idx_project_collaborators_song on project_collaborators(song_id);
create index if not exists idx_project_collaborators_user on project_collaborators(user_id);

-- Not a public directory: you can always read your own row, plus anyone
-- you share at least one song's collaborator list with — not every signed-
-- in user app-wide. A display name is low-sensitivity, but there's no
-- reason to let two people who've never worked together see each other's.
-- (Defined here, not up by `create table profiles`, because this table has
-- to exist first — see the note left there.)
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from project_collaborators mine
      join project_collaborators theirs on theirs.song_id = mine.song_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Every song needs exactly one 'owner' row, created the instant the song
-- is — never left to application code to remember.
create or replace function ensure_song_owner_collaborator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into project_collaborators (song_id, user_id, role)
  values (new.id, new.user_id, 'owner')
  on conflict (song_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_song_owner_collaborator on songs;
create trigger trg_song_owner_collaborator
  after insert on songs
  for each row execute function ensure_song_owner_collaborator();

-- Hard cap: 4 people total per song (owner included). Enforced here, not
-- just in the accept-invite RPC below, so a bug or a future direct insert
-- can't quietly blow past it.
create or replace function enforce_collaborator_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from project_collaborators where song_id = new.song_id) >= 4 then
    raise exception 'project_collaborators: song % already has 4 participants', new.song_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_collaborator_cap on project_collaborators;
create trigger trg_collaborator_cap
  before insert on project_collaborators
  for each row execute function enforce_collaborator_cap();

-- ─── project_invites ────────────────────────────────────────────────────────
-- A shareable code, not a specific person — anyone who opens the link and
-- has (or creates) an account can redeem it, up to the cap. The owner can
-- revoke a live link at any time; a used single-use link can't be redeemed
-- again. code is plain hex (URL-safe with no escaping needed).
create table if not exists project_invites (
  id          uuid primary key default gen_random_uuid(),
  song_id     uuid not null references songs(id) on delete cascade,
  code        text not null unique default encode(gen_random_bytes(12), 'hex'),
  created_by  uuid not null references auth.users(id) on delete cascade,
  single_use  boolean not null default false,
  used_count  integer not null default 0,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_project_invites_song on project_invites(song_id);
-- No separate index on `code`: the inline `unique` above already creates one.

-- ─── access-check helper ────────────────────────────────────────────────────
-- Every other song-scoped table's RLS policy below calls this instead of
-- repeating "owner OR editor" logic in each one. security definer so it can
-- read project_collaborators regardless of THAT table's own RLS (avoids any
-- recursion risk); stable so the planner can treat it as cacheable per
-- statement.
create or replace function is_song_participant(p_song_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from project_collaborators
    where song_id = p_song_id and user_id = auth.uid()
  );
$$;

create or replace function is_song_owner(p_song_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from songs where id = p_song_id and user_id = auth.uid()
  );
$$;

-- ─── accept-invite RPC ──────────────────────────────────────────────────────
-- The only way a non-participant ever gains access: validates the code
-- (exists, not revoked, not expired, not already fully used), checks the
-- cap, inserts the collaborator row, bumps used_count. Returns the song_id
-- on success so the client knows where to navigate. Raises on any failure
-- with a message safe to show as-is.
create or replace function accept_project_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite project_invites;
  v_song_id uuid;
begin
  select * into v_invite from project_invites where code = p_code;

  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite revoked';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'invite expired';
  end if;
  if v_invite.single_use and v_invite.used_count > 0 then
    raise exception 'invite already used';
  end if;
  if (select count(*) from project_collaborators where song_id = v_invite.song_id) >= 4 then
    raise exception 'project is already full';
  end if;

  v_song_id := v_invite.song_id;

  insert into project_collaborators (song_id, user_id, role)
  values (v_song_id, auth.uid(), 'editor')
  on conflict (song_id, user_id) do nothing;

  update project_invites set used_count = used_count + 1 where id = v_invite.id;

  return v_song_id;
end;
$$;

-- ─── RLS: project_collaborators / project_invites ───────────────────────────
alter table project_collaborators enable row level security;
alter table project_invites       enable row level security;

drop policy if exists project_collaborators_select on project_collaborators;
create policy project_collaborators_select on project_collaborators
  for select using (is_song_participant(song_id));

-- Only the owner manages the collaborator list by hand (removing someone).
-- Inserts happen only through the owner trigger above or accept_project_invite
-- (both security definer, bypassing RLS) — no direct insert policy needed.
drop policy if exists project_collaborators_delete on project_collaborators;
create policy project_collaborators_delete on project_collaborators
  for delete using (
    role <> 'owner'
    and (is_song_owner(song_id) or user_id = auth.uid()) -- owner removes anyone; anyone removes themself (leave)
  );

drop policy if exists project_invites_owner on project_invites;
create policy project_invites_owner on project_invites
  for all using (is_song_owner(song_id)) with check (is_song_owner(song_id));

-- ─── songs: split from one owner-only policy into participant read/update
--     vs. owner-only insert/delete, so editors can work but not delete the
--     project or rewrite who owns it. ───────────────────────────────────────
drop policy if exists songs_owner on songs;

create policy songs_select on songs
  for select using (is_song_participant(id));

create policy songs_update on songs
  for update using (is_song_participant(id)) with check (is_song_participant(id));

create policy songs_insert on songs
  for insert with check (user_id = auth.uid());

create policy songs_delete on songs
  for delete using (user_id = auth.uid());

-- songs_update above lets any participant touch the row, but RLS alone
-- can't stop one UPDATE statement from changing WHICH column it touches —
-- without this, an editor could run UPDATE songs SET user_id = <self> and
-- the with-check would still pass (they're still a participant afterwards),
-- quietly making themselves the recorded owner. No "transfer ownership"
-- feature exists, so this is simply never allowed, owner included.
create or replace function prevent_song_ownership_change()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'songs.user_id cannot be changed directly';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_song_ownership_change on songs;
create trigger trg_prevent_song_ownership_change
  before update on songs
  for each row execute function prevent_song_ownership_change();

-- ─── every other song-scoped table: same policy shape as before, just with
--     the "s.user_id = auth.uid()" leaf swapped for is_song_participant(s.id)
--     wherever the subquery already joins back to songs. ───────────────────

drop policy if exists sections_owner on sections;
create policy sections_owner on sections
  for all using (
    exists (select 1 from songs s where s.id = sections.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = sections.song_id and is_song_participant(s.id))
  );

drop policy if exists lines_owner on lines;
create policy lines_owner on lines
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = lines.section_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = lines.section_id and is_song_participant(s.id)
    )
  );

drop policy if exists variants_owner on line_variants;
create policy variants_owner on line_variants
  for all using (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = line_variants.line_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = line_variants.line_id and is_song_participant(s.id)
    )
  );

drop policy if exists annotations_owner on annotations;
create policy annotations_owner on annotations
  for all using (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = annotations.line_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = annotations.line_id and is_song_participant(s.id)
    )
  );

drop policy if exists section_versions_owner on section_versions;
create policy section_versions_owner on section_versions
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = section_versions.section_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = section_versions.section_id and is_song_participant(s.id)
    )
  );

drop policy if exists word_variants_owner on word_variants;
create policy word_variants_owner on word_variants
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = word_variants.section_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = word_variants.section_id and is_song_participant(s.id)
    )
  );

drop policy if exists line_history_owner on line_history;
create policy line_history_owner on line_history
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = line_history.section_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = line_history.section_id and is_song_participant(s.id)
    )
  );

drop policy if exists ideas_owner on ideas_notebook;
create policy ideas_owner on ideas_notebook
  for all using (
    exists (select 1 from songs s where s.id = ideas_notebook.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = ideas_notebook.song_id and is_song_participant(s.id))
  );

drop policy if exists chord_progressions_owner on chord_progressions;
create policy chord_progressions_owner on chord_progressions
  for all using (
    exists (select 1 from songs s where s.id = chord_progressions.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = chord_progressions.song_id and is_song_participant(s.id))
  );

drop policy if exists note_links_owner on note_links;
create policy note_links_owner on note_links
  for all using (
    exists (select 1 from songs s where s.id = note_links.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = note_links.song_id and is_song_participant(s.id))
  );

drop policy if exists song_outputs_owner on song_outputs;
create policy song_outputs_owner on song_outputs
  for all using (
    exists (select 1 from songs s where s.id = song_outputs.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = song_outputs.song_id and is_song_participant(s.id))
  );

drop policy if exists output_selections_owner on output_selections;
create policy output_selections_owner on output_selections
  for all using (
    exists (
      select 1 from song_outputs so
      join songs s on s.id = so.song_id
      where so.id = output_selections.output_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from song_outputs so
      join songs s on s.id = so.song_id
      where so.id = output_selections.output_id and is_song_participant(s.id)
    )
  );

drop policy if exists tempo_nodes_owner on tempo_nodes;
create policy tempo_nodes_owner on tempo_nodes
  for all using (
    exists (select 1 from songs s where s.id = tempo_nodes.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = tempo_nodes.song_id and is_song_participant(s.id))
  );

drop policy if exists muse_entries_owner on muse_entries;
create policy muse_entries_owner on muse_entries
  for all using (
    exists (select 1 from songs s where s.id = muse_entries.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = muse_entries.song_id and is_song_participant(s.id))
  );

drop policy if exists muse_profile_owner on muse_profile;
create policy muse_profile_owner on muse_profile
  for all using (
    exists (select 1 from songs s where s.id = muse_profile.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = muse_profile.song_id and is_song_participant(s.id))
  );

-- muse_increment_interaction had its own inline ownership check (not a
-- policy) — same swap, same security-definer/search_path shape as before.
create or replace function muse_increment_interaction(p_section_id uuid, p_song_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not is_song_participant(p_song_id) then
    raise exception 'not authorized';
  end if;

  insert into muse_profile (section_id, song_id, interaction_count)
  values (p_section_id, p_song_id, 1)
  on conflict (section_id)
  do update set interaction_count = muse_profile.interaction_count + 1
  returning interaction_count into v_count;

  return v_count;
end;
$$;

drop policy if exists baul_nodes_owner on baul_nodes;
create policy baul_nodes_owner on baul_nodes
  for all using (
    exists (select 1 from songs s where s.id = baul_nodes.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = baul_nodes.song_id and is_song_participant(s.id))
  );

drop policy if exists baul_entries_owner on baul_entries;
create policy baul_entries_owner on baul_entries
  for all using (
    exists (select 1 from songs s where s.id = baul_entries.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = baul_entries.song_id and is_song_participant(s.id))
  );

drop policy if exists line_audio_owner on line_audio;
create policy line_audio_owner on line_audio
  for all using (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_audio.section_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_audio.section_id and is_song_participant(s.id))
  );

drop policy if exists voice_memos_owner_select on storage.objects;
create policy voice_memos_owner_select on storage.objects
  for select using (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id)
    )
  );

drop policy if exists voice_memos_owner_insert on storage.objects;
create policy voice_memos_owner_insert on storage.objects
  for insert with check (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id)
    )
  );

drop policy if exists voice_memos_owner_delete on storage.objects;
create policy voice_memos_owner_delete on storage.objects
  for delete using (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id)
    )
  );

drop policy if exists baul_items_owner on baul_items;
create policy baul_items_owner on baul_items
  for all using (
    exists (select 1 from songs s where s.id = baul_items.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = baul_items.song_id and is_song_participant(s.id))
  );

drop policy if exists baul_items_obj_select on storage.objects;
create policy baul_items_obj_select on storage.objects
  for select using (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id))
  );

drop policy if exists baul_items_obj_insert on storage.objects;
create policy baul_items_obj_insert on storage.objects
  for insert with check (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id))
  );

drop policy if exists baul_items_obj_delete on storage.objects;
create policy baul_items_obj_delete on storage.objects
  for delete using (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id))
  );

-- ─── realtime ───────────────────────────────────────────────────────────────
-- Live sync only needs to notify on the tables a collaborator's screen
-- actually reacts to without a manual reload: sections (verses added/
-- removed/reordered), lines (the actual text — one row per SECTION, not
-- per physical line, so this is "the block's text changed", not
-- line-granular), and project_collaborators (so "so-and-so joined/left"
-- updates live too). Assumes the `supabase_realtime` publication already
-- exists, which it does on every Supabase project by default.
--
-- Realtime's Postgres Changes already apply each subscriber's own RLS
-- before delivering a row — same policies as above, so this adds *delivery*
-- of changes, not a new way to read anything the policies already block.
-- ADD TABLE has no IF NOT EXISTS; wrapped so re-running this migration
-- doesn't fail on a table already added.
do $$ begin
  alter publication supabase_realtime add table sections;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table lines;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table project_collaborators;
exception when duplicate_object then null;
end $$;

-- ─── backfill ────────────────────────────────────────────────────────────────
-- Every song that already exists predates this migration and has no
-- project_collaborators row yet — the trigger above only fires on NEW songs.
-- Give every existing song its owner row once, here.
insert into project_collaborators (song_id, user_id, role)
select id, user_id, 'owner' from songs
on conflict (song_id, user_id) do nothing;
