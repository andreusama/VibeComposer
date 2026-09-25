-- Run this in the Supabase SQL editor. Adds albums: a container that groups
-- songs (tracks). A song with album_id = null IS a single — no wrapper row,
-- so every song that already exists stays exactly as it was (still a single,
-- still with its own songs.lyric_dna). An album has no DNA column of its own
-- on purpose: its "coherence" is derived live from its tracks' lyric_dna, not
-- stored (see the album-DNA rollup, not built yet).
--
-- Deleting an album does NOT delete its songs — they fall back to singles
-- (on delete set null). Safe to re-run.

create table if not exists albums (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Sin título',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_albums_updated_at on albums;
create trigger trg_albums_updated_at
  before update on albums
  for each row execute function set_updated_at();

create index if not exists idx_albums_user on albums(user_id);

alter table albums enable row level security;

drop policy if exists albums_owner on albums;
create policy albums_owner on albums
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table songs add column if not exists album_id       uuid references albums(id) on delete set null;
alter table songs add column if not exists track_position integer not null default 0;

create index if not exists idx_songs_album on songs(album_id, track_position);

-- Manual ordering of the projects list (singles and albums share one order).
-- Everything starts at 0, so until something is dragged the list keeps its
-- old most-recently-edited-first behaviour (ties fall back to updated_at).
-- New projects get (lowest existing value - 1) so they land on top.
-- Tracks inside an album are ordered by track_position instead.
alter table songs  add column if not exists sort_order integer not null default 0;
alter table albums add column if not exists sort_order integer not null default 0;
