-- Run this in the Supabase SQL editor.
--
-- The muse's profile stops being partitioned into a fixed 5-word register
-- (amor/amistad/familia/lugar/otro) — a verse can genuinely touch more than
-- one theme at once, and forcing a single label per note was the limiting
-- factor. muse_profile becomes a single evolving JSON per song, fused
-- wholesale on every refresh — same shape as songs.lyric_dna already is
-- (see schema.sql's baúl section). muse_entries.register becomes a free
-- array of themes (informational/display only now, no longer a
-- partitioning key for the profile-learning loop).
--
-- Neither the old muse_profile table nor muse_entries has any real user
-- data yet (same reasoning migration_muse.sql already used to justify an
-- unconditional drop), so this drops and recreates rather than migrating
-- row-by-row.

alter table songs add column if not exists muse_profile jsonb not null default '{}'::jsonb;
alter table songs add column if not exists muse_interaction_count int not null default 0;

drop table if exists muse_profile;
drop function if exists muse_increment_interaction(uuid, text);

alter table muse_entries drop constraint if exists muse_entries_register_check;
alter table muse_entries drop column if exists register;
alter table muse_entries add column if not exists themes text[];

-- 'action' used to be the old suggest/clarify shape — now it's whichever
-- of the four modes the muse answered in (for 'muse' rows) or plain 'ask'
-- (for 'user' rows). Old rows from before this migration (action in
-- 'clarify'/'suggest') can't satisfy the new constraint and aren't
-- meaningful under the new shape anyway — same "no real data to preserve"
-- reasoning as the rest of this file, so they're cleared first.
delete from muse_entries where action not in ('ask', 'SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK');
alter table muse_entries drop constraint if exists muse_entries_action_check;
alter table muse_entries add constraint muse_entries_action_check
  check (action in ('ask', 'SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK'));

drop index if exists idx_muse_entries_song_register;
create index if not exists idx_muse_entries_song on muse_entries(song_id, created_at);

create or replace function muse_increment_interaction(p_song_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update songs
  set muse_interaction_count = muse_interaction_count + 1
  where id = p_song_id and user_id = auth.uid()
  returning muse_interaction_count into v_count;

  if v_count is null then
    raise exception 'not authorized';
  end if;

  return v_count;
end;
$$;
