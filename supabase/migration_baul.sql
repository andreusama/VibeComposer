-- Run this in the Supabase SQL editor. Adds the "Inspiration Black Hole"
-- node (a real DB row for position/size, same shape as tempo_nodes — it has
-- no content columns of its own, everything it produces lives in
-- songs.lyric_dna) and the lyric_dna column itself, which the baúl
-- processor (see src/utils/baulProcessor.js) reads and overwrites.
--
-- lyric_dna is deliberately a separate concept from muse_profile: that one
-- accumulates from conversations with the muse, segmented by emotional
-- register; this one accumulates from raw material dropped into the baúl
-- (text, transcripts, notebook photos, documents), one evolving object, no
-- register split.

create table if not exists baul_nodes (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references songs(id) on delete cascade,
  canvas_x      double precision not null default 0,
  canvas_y      double precision not null default 0,
  canvas_width  double precision not null default 140,
  canvas_height double precision not null default 140,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_baul_nodes_updated_at on baul_nodes;
create trigger trg_baul_nodes_updated_at
  before update on baul_nodes
  for each row execute function set_updated_at();

create index if not exists idx_baul_nodes_song on baul_nodes(song_id);

alter table baul_nodes enable row level security;

drop policy if exists baul_nodes_owner on baul_nodes;
create policy baul_nodes_owner on baul_nodes
  for all using (
    exists (select 1 from songs s where s.id = baul_nodes.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = baul_nodes.song_id and s.user_id = auth.uid())
  );

alter table songs add column if not exists lyric_dna jsonb not null default '{}'::jsonb;
