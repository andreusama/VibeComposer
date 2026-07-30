-- Run this in the Supabase SQL editor. Adds the song_outputs table used by
-- the canvas "output node" (one per song, auto-created, undeletable).
-- Assumes set_updated_at() already exists (it does — chord_progressions uses it).

create table if not exists song_outputs (
  id              uuid primary key default gen_random_uuid(),
  song_id         uuid not null unique references songs(id) on delete cascade,
  canvas_x        double precision not null default 0,
  canvas_y        double precision not null default 0,
  canvas_width    double precision not null default 320,
  canvas_height   double precision not null default 240,
  plugged_note_id uuid references sections(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_song_outputs_updated_at on song_outputs;
create trigger trg_song_outputs_updated_at
  before update on song_outputs
  for each row execute function set_updated_at();

alter table song_outputs enable row level security;

drop policy if exists song_outputs_owner on song_outputs;
create policy song_outputs_owner on song_outputs
  for all using (
    exists (select 1 from songs s where s.id = song_outputs.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = song_outputs.song_id and s.user_id = auth.uid())
  );
