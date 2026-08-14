-- Adds baul_entries: an append-only log of individual baúl absorptions,
-- powering the dev-only Muse Eye panel's "baúl pipeline" tab only. Does
-- NOT change songs.lyric_dna's own semantics — that stays a single fused
-- blob, never appended to. See schema.sql for the full comment.
-- Run this once against the live database; safe to re-run (all IF NOT
-- EXISTS / DROP POLICY IF EXISTS).

create table if not exists baul_entries (
  id                 uuid primary key default gen_random_uuid(),
  song_id            uuid not null references songs(id) on delete cascade,
  input_type         text not null check (input_type in ('text', 'audio_transcript', 'notebook_image', 'document')),
  raw_preview        text not null default '',
  generated_summary  text not null default '',
  tags               text[] not null default '{}',
  created_at         timestamptz not null default now()
);

create index if not exists idx_baul_entries_song on baul_entries(song_id, created_at desc);

alter table baul_entries enable row level security;

drop policy if exists baul_entries_owner on baul_entries;
create policy baul_entries_owner on baul_entries
  for all using (
    exists (select 1 from songs s where s.id = baul_entries.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = baul_entries.song_id and s.user_id = auth.uid())
  );
