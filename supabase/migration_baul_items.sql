-- Run this in the Supabase SQL editor. Adds baul_items: the actual inputs an
-- artist dropped into a song's Baúl (a written note, a photo, a PDF), so they
-- can be shown back in the "glass cabinet". This stores ONLY what the artist
-- put in — never what the Baúl extracted from it. songs.lyric_dna (the fused
-- ADN) stays hidden and unchanged; baul_entries stays the dev-only audit log.
--
-- Items absorbed before this migration were never kept (only the fused ADN
-- and a 140-char dev preview survived), so existing cabinets start empty.
-- Safe to re-run.

create table if not exists baul_items (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references songs(id) on delete cascade,
  kind          text not null check (kind in ('note', 'image', 'document')),
  text_content  text,          -- the note's text (kind = 'note')
  storage_path  text,          -- {song_id}/{id}.{ext} in the baul-items bucket (image/document)
  file_name     text,          -- original filename, display only
  mime_type     text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_baul_items_song on baul_items(song_id, created_at);

alter table baul_items enable row level security;

drop policy if exists baul_items_owner on baul_items;
create policy baul_items_owner on baul_items
  for all using (
    exists (select 1 from songs s where s.id = baul_items.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = baul_items.song_id and s.user_id = auth.uid())
  );

-- Private bucket for the photo/PDF bytes — same convention as voice-memos:
-- path {song_id}/..., access only through the policies below.
insert into storage.buckets (id, name, public)
values ('baul-items', 'baul-items', false)
on conflict (id) do nothing;

drop policy if exists baul_items_obj_select on storage.objects;
create policy baul_items_obj_select on storage.objects
  for select using (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid())
  );

drop policy if exists baul_items_obj_insert on storage.objects;
create policy baul_items_obj_insert on storage.objects
  for insert with check (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid())
  );

drop policy if exists baul_items_obj_delete on storage.objects;
create policy baul_items_obj_delete on storage.objects
  for delete using (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid())
  );
