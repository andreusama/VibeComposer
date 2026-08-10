-- Run this in the Supabase SQL editor.
--
-- IMPORTANT if you already ran an earlier version of this migration: the
-- muse's interaction model changed from "one curious question, one answer"
-- to a real back-and-forth (the user asks for help, the muse asks back for
-- context or gives concrete options) — a genuinely different shape, not
-- just new columns. This DROPS the old muse_entries table and recreates it
-- as a turn-based conversation log. That table only ever held muse Q&A
-- exchanges, nothing else, so nothing outside the muse feature is affected
-- — but if you've been using it, its history does not carry over.
--
-- muse_profile (the learned per-register summary) is untouched either way.

alter table songs drop column if exists muse_profile;
drop table if exists muse_entries;

create table muse_entries (
  id                   uuid primary key default gen_random_uuid(),
  song_id              uuid not null references songs(id) on delete cascade,
  line_id              uuid not null references lines(id) on delete cascade,
  register             text check (register in ('amor', 'amistad', 'familia', 'lugar', 'otro')),
  role                 text not null check (role in ('user', 'muse')),
  action               text not null check (action in ('ask', 'clarify', 'suggest')),
  content              text not null,
  options              jsonb,
  saved_annotation_id  uuid references annotations(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index idx_muse_entries_song_register on muse_entries(song_id, register);
create index idx_muse_entries_line on muse_entries(line_id, created_at);

alter table muse_entries enable row level security;

drop policy if exists muse_entries_owner on muse_entries;
create policy muse_entries_owner on muse_entries
  for all using (
    exists (select 1 from songs s where s.id = muse_entries.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = muse_entries.song_id and s.user_id = auth.uid())
  );

-- muse_profile + muse_increment_interaction are unchanged from the previous
-- migration — only run the block below if you're setting this up fresh and
-- never ran migration_muse.sql before at all.
create table if not exists muse_profile (
  song_id             uuid not null references songs(id) on delete cascade,
  register            text not null check (register in ('amor', 'amistad', 'familia', 'lugar', 'otro')),
  summary             text not null default '',
  interaction_count   int not null default 0,
  last_summarized_at  timestamptz,
  updated_at          timestamptz not null default now(),
  primary key (song_id, register)
);

drop trigger if exists trg_muse_profile_updated_at on muse_profile;
create trigger trg_muse_profile_updated_at
  before update on muse_profile
  for each row execute function set_updated_at();

alter table muse_profile enable row level security;

drop policy if exists muse_profile_owner on muse_profile;
create policy muse_profile_owner on muse_profile
  for all using (
    exists (select 1 from songs s where s.id = muse_profile.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = muse_profile.song_id and s.user_id = auth.uid())
  );

create or replace function muse_increment_interaction(p_song_id uuid, p_register text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not exists (select 1 from songs where id = p_song_id and user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  insert into muse_profile (song_id, register, interaction_count)
  values (p_song_id, p_register, 1)
  on conflict (song_id, register)
  do update set interaction_count = muse_profile.interaction_count + 1
  returning interaction_count into v_count;

  return v_count;
end;
$$;
