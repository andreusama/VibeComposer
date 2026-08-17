// ─── Line-audio data layer ──────────────────────────────────────────────────
// Voice memos anchored to a physical verse line — a real row (line_audio,
// pointer + metadata) plus the actual bytes in Supabase Storage (bucket
// "voice-memos"), same "row = pointer, bucket = bytes" split any file
// upload follows. See supabase/migration_line_audio.sql for the schema/RLS.
//
// Anchored via (section_id, line_index), NOT a line id — `lines` holds
// exactly one row per section (the whole block's text as one string, see
// canvasData.js), physical lines only exist as NoteEditorScreen's
// client-side split, so there's no stable per-line row to reference.
// section_id === note.id (see schema.sql: "a note IS a sections row").

import { supabase } from '../utils/supabaseClient.js';

const BUCKET = 'voice-memos';

function extensionFor(mimeType) {
  if (mimeType?.includes('mp4')) return 'm4a';
  if (mimeType?.includes('ogg')) return 'ogg';
  return 'webm'; // MediaRecorder's default on Chromium/Android WebView
}

// Uploads the blob, then inserts the pointer row — in that order, so a
// failed insert never leaves an orphaned DB reference to a missing object
// (an upload succeeding but the row failing just leaves an unreferenced
// blob, harmless and cheap to ignore for a first version of this feature).
export async function uploadLineAudio(sectionId, songId, lineIndex, blob, durationSeconds) {
  const path = `${songId}/${sectionId}/${crypto.randomUUID()}.${extensionFor(blob.type)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type });
  if (uploadError) return { data: null, error: uploadError };

  return supabase.from('line_audio')
    .insert({ section_id: sectionId, song_id: songId, line_index: lineIndex, storage_path: path, duration_seconds: durationSeconds })
    .select()
    .single();
}

// Loads every memo for the whole block in one call — the caller (
// NoteEditorScreen) groups them by line_index client-side, cheaper than one
// query per visible line.
export async function loadLineAudioFor(sectionId) {
  return supabase.from('line_audio').select('*').eq('section_id', sectionId).order('created_at');
}

// Removes the row first, then the blob — the inverse order from upload, for
// the same reason: an orphaned blob (row gone, bytes still sitting in
// Storage) is harmless clutter, but an orphaned row (blob gone, row still
// pointing at nothing) would surface as a broken player in the UI.
export async function deleteLineAudio(id, storagePath) {
  const { error } = await supabase.from('line_audio').delete().eq('id', id);
  if (error) return { error };
  if (storagePath) await supabase.storage.from(BUCKET).remove([storagePath]);
  return { error: null };
}

// Signed URL, not a public one — the bucket is private (see the migration),
// so playback always goes through a short-lived signed link.
export async function getLineAudioUrl(storagePath, expiresInSeconds = 3600) {
  return supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
}
