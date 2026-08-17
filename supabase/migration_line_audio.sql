-- Adds line-anchored voice memos (long-press a line on mobile to record —
-- see src/mobile/AudioRecorderSheet.jsx): the line_audio table (pointer +
-- metadata) and a new "voice-memos" Storage bucket (the actual audio
-- bytes), both introduced together since neither is useful without the
-- other. Additive only — safe to re-run, nothing here touches existing
-- data.
--
-- Anchored via (section_id, line_index), NOT a `lines` row — `lines` holds
-- exactly one row per section (the whole block's text as one string),
-- individual physical lines only exist as a client-side split, so there's
-- no stable per-line row to reference. Same tradeoff annotations already
-- accepts with character offsets: position drifts if lines are
-- inserted/deleted above it.

create table if not exists line_audio (
  id                uuid primary key default gen_random_uuid(),
  section_id        uuid not null references sections(id) on delete cascade,
  song_id           uuid not null references songs(id) on delete cascade,
  line_index        integer not null,
  storage_path      text not null,
  duration_seconds  numeric,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_line_audio_section on line_audio(section_id, line_index);

alter table line_audio enable row level security;

drop policy if exists line_audio_owner on line_audio;
create policy line_audio_owner on line_audio
  for all using (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_audio.section_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_audio.section_id and s.user_id = auth.uid())
  );

-- Storage bucket for the actual audio bytes — not publicly readable, access
-- goes entirely through the RLS policies below (path convention:
-- {song_id}/{section_id}/{filename}, matching line_audio.storage_path).
insert into storage.buckets (id, name, public)
values ('voice-memos', 'voice-memos', false)
on conflict (id) do nothing;

drop policy if exists voice_memos_owner_select on storage.objects;
create policy voice_memos_owner_select on storage.objects
  for select using (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid()
    )
  );

drop policy if exists voice_memos_owner_insert on storage.objects;
create policy voice_memos_owner_insert on storage.objects
  for insert with check (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid()
    )
  );

drop policy if exists voice_memos_owner_delete on storage.objects;
create policy voice_memos_owner_delete on storage.objects
  for delete using (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid()
    )
  );
