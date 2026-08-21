-- Moves the muse conversation/profile system from line_id to section_id
-- (a "block" — one verse/chorus/etc, see "A 'note' IS a sections row" in
-- schema.sql) and removes song_summary entirely — the muse already gets
-- the full raw song text every turn via describeSongStructure, so a
-- separate AI-summarized "song_summary" field was pure redundancy. "Vibe"
-- (literal vs. metaphorical/abstract, atmosphere) is left to lyric_dna
-- (the Baúl) and the muse's own live reading of the raw text.
--
-- Safe to run regardless of which prior state your database is in
-- (never migrated, the earlier register-keyed muse_profile, or yesterday's
-- line-keyed version) — neither muse_entries nor muse_profile ever shipped
-- with real user data, so this drops and recreates both rather than
-- migrating row-by-row. Safe to re-run.

drop table if exists muse_entries;
drop table if exists muse_profile;
drop function if exists muse_increment_interaction(uuid, uuid);
drop function if exists muse_increment_interaction(uuid, text);

create table muse_entries (
  id                   uuid primary key default gen_random_uuid(),
  song_id              uuid not null references songs(id) on delete cascade,
  section_id           uuid not null references sections(id) on delete cascade,
  role                 text not null check (role in ('user', 'muse')),
  action               text not null check (action in ('ask', 'clarify', 'suggest')),
  -- The muse's actual mode for 'muse' rows (null for 'user' rows) — see
  -- schema.sql's comment on this column for why it's separate from
  -- `action` (the UI needs the specific mode to render correctly, and
  -- SURGEON/ARCHITECT/WORD_BANK all collapse to the same `action` value).
  mode                 text check (mode in ('SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK', 'OPEN_REFERENCE')),
  content              text not null,
  options              jsonb,
  saved_annotation_id  uuid references annotations(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index idx_muse_entries_section on muse_entries(section_id, created_at);

alter table muse_entries enable row level security;

drop policy if exists muse_entries_owner on muse_entries;
create policy muse_entries_owner on muse_entries
  for all using (
    exists (select 1 from songs s where s.id = muse_entries.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = muse_entries.song_id and s.user_id = auth.uid())
  );

create table muse_profile (
  section_id          uuid primary key references sections(id) on delete cascade,
  song_id             uuid not null references songs(id) on delete cascade,
  summary             text not null default '',
  interaction_count   int not null default 0,
  last_summarized_at  timestamptz,
  updated_at          timestamptz not null default now()
);

create index idx_muse_profile_song on muse_profile(song_id);

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

create or replace function muse_increment_interaction(p_section_id uuid, p_song_id uuid)
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

  insert into muse_profile (section_id, song_id, interaction_count)
  values (p_section_id, p_song_id, 1)
  on conflict (section_id)
  do update set interaction_count = muse_profile.interaction_count + 1
  returning interaction_count into v_count;

  return v_count;
end;
$$;

alter table songs drop column if exists song_summary;
alter table songs drop column if exists song_summary_updated_at;
