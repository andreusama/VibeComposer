// ─── Resources ("Recursos") data layer ─────────────────────────────────────
// The artist-level library of consciously saved phrases/metaphors/proverbs —
// see supabase/migration_resources.sql. Deliberately NOT song-scoped and
// NOT the Baúl: a resource is a visible snippet the artist chose and labeled
// themselves, individually retrievable and insertable, never an AI-fused
// interpretation. Only `body` is ever required — every other field is
// fillable later from the library screen, so a quick capture never blocks
// on labeling.

import { supabase } from '../utils/supabaseClient.js';

// 'lesson' covers craft insight/analysis (a definition, a structural
// principle, a piece of "how this works" wisdom pulled from a book or
// article about writing) — distinct from 'metaphor', which is a genuinely
// literary, image-based comparison. Added after real usage (importing
// screenwriting-craft book notes) showed the model mislabeling analytical
// passages as metaphors for lack of a better bucket.
export const RESOURCE_TYPES = ['metaphor', 'proverb', 'phrase', 'lesson', 'other'];
export const RESOURCE_TYPE_LABELS = { metaphor: 'Metáfora', proverb: 'Refrán', phrase: 'Frase', lesson: 'Lección', other: 'Otro' };

// A resource can sit in several folders (a join table, not a folder_id
// column — see the migration), so loading "the library" means three
// queries assembled client-side, same pattern projectsData.js already uses
// for album tracks/previews.
export async function loadResourceLibrary(userId) {
  const [{ data: resources, error: resErr }, { data: folders, error: folderErr }] = await Promise.all([
    supabase.from('resources').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('resource_folders').select('*').eq('user_id', userId).order('created_at'),
  ]);
  if (resErr) return { resources: [], folders: [], membership: {}, error: resErr.message };
  if (folderErr) return { resources: [], folders: [], membership: {}, error: folderErr.message };

  const resourceIds = (resources || []).map((r) => r.id);
  let members = [];
  if (resourceIds.length) {
    const { data, error } = await supabase.from('resource_folder_members').select('*').in('resource_id', resourceIds);
    if (error) return { resources: [], folders: [], membership: {}, error: error.message };
    members = data || [];
  }

  // { [resourceId]: [folderId, ...] } — what MobileResourcesScreen/the
  // picker sheet actually need per resource; folder→resource lookups are
  // done by filtering `resources` on this map instead of a second index.
  const membership = {};
  members.forEach((m) => { (membership[m.resource_id] ||= []).push(m.folder_id); });

  return { resources: resources || [], folders: folders || [], membership, error: null };
}

export async function createResource({ userId, body, type = null, tags = [], origin = null }) {
  return supabase.from('resources').insert({ user_id: userId, body, type, tags, origin }).select().single();
}

export async function updateResource(id, patch) {
  return supabase.from('resources').update(patch).eq('id', id).select().single();
}

export async function deleteResource(id) {
  return supabase.from('resources').delete().eq('id', id);
}

export async function createFolder(userId, name) {
  return supabase.from('resource_folders').insert({ user_id: userId, name }).select().single();
}

export async function renameFolder(id, name) {
  return supabase.from('resource_folders').update({ name }).eq('id', id);
}

// Deleting a folder only removes the container — resource_folder_members
// rows cascade (the join table's FK), the resources themselves are untouched.
export async function deleteFolder(id) {
  return supabase.from('resource_folders').delete().eq('id', id);
}

// Replaces a resource's whole folder membership set — simplest correct
// operation for what's always a small list (delete then insert), rather
// than diffing add/remove.
export async function setResourceFolders(resourceId, folderIds) {
  const { error: delErr } = await supabase.from('resource_folder_members').delete().eq('resource_id', resourceId);
  if (delErr) return { error: delErr };
  if (!folderIds.length) return { error: null };
  const { error } = await supabase.from('resource_folder_members')
    .insert(folderIds.map((folder_id) => ({ resource_id: resourceId, folder_id })));
  return { error };
}
