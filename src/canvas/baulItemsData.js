// ─── Baúl cabinet data layer ────────────────────────────────────────────────
// What an artist dropped into a song's Baúl, kept so the "glass cabinet" can
// show it back: a row per input (baul_items) plus, for photos and PDFs, the
// original bytes in the private "baul-items" bucket. Only ever the artist's
// OWN inputs — nothing the Baúl extracted from them is stored here (that's
// the hidden songs.lyric_dna). See supabase/migration_baul_items.sql.

import { supabase } from '../utils/supabaseClient.js';

const BUCKET = 'baul-items';

// Photos and PDFs are read by the model as-is, so a huge file is a slow,
// costly absorb and a big upload for very little. Same order of magnitude as
// what Claude's document input tolerates.
export const MAX_ITEM_BYTES = 10 * 1024 * 1024;

const KIND_FOR_INPUT_TYPE = { text: 'note', audio_transcript: 'note', notebook_image: 'image', document: 'document' };

function extensionFor(file) {
  const fromName = file?.name?.split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5 && fromName !== file.name.toLowerCase()) return fromName;
  return file?.type === 'application/pdf' ? 'pdf' : 'jpg';
}

export async function loadBaulItems(songId) {
  try {
    return await supabase.from('baul_items').select('*').eq('song_id', songId).order('created_at');
  } catch (err) {
    return { data: null, error: err };
  }
}

// Stores one absorbed input. Upload first, then the row — so a failed insert
// never leaves a row pointing at a missing object (an upload that succeeds
// but whose insert fails just leaves an unreferenced blob).
export async function addBaulItem({ songId, inputType, text, file }) {
  const kind = KIND_FOR_INPUT_TYPE[inputType];
  if (!kind) return { data: null, error: new Error(`unknown inputType "${inputType}"`) };

  if (kind === 'note') {
    return supabase.from('baul_items').insert({ song_id: songId, kind, text_content: text }).select().single();
  }

  const id = crypto.randomUUID();
  const path = `${songId}/${id}.${extensionFor(file)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (uploadError) return { data: null, error: uploadError };
  return supabase.from('baul_items')
    .insert({ id, song_id: songId, kind, storage_path: path, file_name: file.name || null, mime_type: file.type })
    .select()
    .single();
}

// Short-lived signed links for many items at once — the bucket is private.
// Returns { [storage_path]: url }.
export async function getBaulItemUrls(items, expiresInSeconds = 3600) {
  const paths = items.map((i) => i.storage_path).filter(Boolean);
  if (!paths.length) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, expiresInSeconds);
  return Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

// Empties a song's cabinet (used by "vaciar el baúl"). Removes the rows
// first, then the bytes — the same order line audio uses, so a failure
// leaves harmless orphan blobs rather than rows pointing at nothing.
export async function clearBaulItems(songId) {
  const { data } = await supabase.from('baul_items').select('storage_path').eq('song_id', songId);
  const { error } = await supabase.from('baul_items').delete().eq('song_id', songId);
  if (error) return { error };
  const paths = (data || []).map((r) => r.storage_path).filter(Boolean);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  return { error: null };
}
