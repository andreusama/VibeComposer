-- Run this in the Supabase SQL editor. Gives the tempo node a real DB row
-- (it was session-only before, so its bpm — and which chord progression it
-- was plugged into — vanished on every reload) and a nullable pointer from
-- chord_progressions to whichever tempo node feeds it.

create table if not exists tempo_nodes (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references songs(id) on delete cascade,
  bpm           integer not null default 120,
  canvas_x      double precision not null default 0,
  canvas_y      double precision not null default 0,
  canvas_width  double precision not null default 160,
  canvas_height double precision not null default 120,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_tempo_nodes_updated_at on tempo_nodes;
create trigger trg_tempo_nodes_updated_at
  before update on tempo_nodes
  for each row execute function set_updated_at();

create index if not exists idx_tempo_nodes_song on tempo_nodes(song_id);

alter table tempo_nodes enable row level security;

drop policy if exists tempo_nodes_owner on tempo_nodes;
create policy tempo_nodes_owner on tempo_nodes
  for all using (
    exists (select 1 from songs s where s.id = tempo_nodes.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = tempo_nodes.song_id and s.user_id = auth.uid())
  );

alter table chord_progressions drop constraint if exists chord_progressions_tempo_node_id_fkey;
alter table chord_progressions add column if not exists tempo_node_id uuid;
alter table chord_progressions
  add constraint chord_progressions_tempo_node_id_fkey
  foreign key (tempo_node_id) references tempo_nodes(id) on delete set null;
