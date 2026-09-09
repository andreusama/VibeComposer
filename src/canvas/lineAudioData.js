// ─── Note-audio data layer ──────────────────────────────────────────────────
// Voice memos that belong to a NOTE (section) as a whole — a real row
// (line_audio, pointer + metadata) plus the actual bytes in Supabase Storage
// (bucket "voice-memos"), same "row = pointer, bucket = bytes" split any file
// upload follows. See supabase/migration_audio_per_note.sql for the schema/RLS.
//
// section_id === note.id (see schema.sql: "a note IS a sections row"). The
// table keeps its old `line_audio` name and a now-nullable `line_index` for
// historical rows; the app neither reads nor writes line_index any more.

import { supabase } from '../utils/supabaseClient.js';

const BUCKET = 'voice-memos';

// A note can hold a good number of takes, but not unbounded — Storage is
// real. At the cap the recorder is disabled until something is deleted.
export const MAX_AUDIOS_PER_NOTE = 20;
export const MAX_CLIP_SECONDS = 120;

function extensionFor(mimeType) {
  if (mimeType?.includes('mp4')) return 'm4a';
  if (mimeType?.includes('ogg')) return 'ogg';
  return 'webm'; // MediaRecorder's default on Chromium/Android WebView
}

// Uploads the blob, then inserts the pointer row — in that order, so a
// failed insert never leaves an orphaned DB reference to a missing object
// (an upload succeeding but the row failing just leaves an unreferenced
// blob, harmless and cheap to ignore for a first version of this feature).
export async function uploadNoteAudio(sectionId, songId, blob, durationSeconds) {
  const path = `${songId}/${sectionId}/${crypto.randomUUID()}.${extensionFor(blob.type)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type });
  if (uploadError) return { data: null, error: uploadError };

  return supabase.from('line_audio')
    .insert({ section_id: sectionId, song_id: songId, storage_path: path, duration_seconds: durationSeconds })
    .select()
    .single();
}

// Every take for one note, oldest first — the order the "Àudio 1, 2, 3…"
// numbering follows.
export async function loadNoteAudioFor(sectionId) {
  return supabase.from('line_audio').select('*').eq('section_id', sectionId).order('created_at');
}

export async function renameNoteAudio(id, title) {
  return supabase.from('line_audio').update({ title: title || null }).eq('id', id);
}

// Removes the row first, then the blob — the inverse order from upload, for
// the same reason: an orphaned blob (row gone, bytes still sitting in
// Storage) is harmless clutter, but an orphaned row (blob gone, row still
// pointing at nothing) would surface as a broken player in the UI.
export async function deleteNoteAudio(id, storagePath) {
  const { error } = await supabase.from('line_audio').delete().eq('id', id);
  if (error) return { error };
  if (storagePath) await supabase.storage.from(BUCKET).remove([storagePath]);
  return { error: null };
}

// Signed URL, not a public one — the bucket is private (see the migration),
// so playback always goes through a short-lived signed link.
export async function getNoteAudioUrl(storagePath, expiresInSeconds = 3600) {
  return supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
}
