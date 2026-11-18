import { groupNotesByThreadIndex } from './threadGroups.js';

// Turns get_shared_song()'s JSON (supabase/migration_shared_readonly_link.sql)
// into exactly what SongPerformanceScreen — the song's final read-through —
// already takes: Parts bucketed in thread order, and chords keyed by the
// line row they belong to.
export function snapshotToView(snapshot) {
  const notes = (snapshot?.notes || []).map((n) => ({
    id: n.id,
    type: n.type,
    custom_label: n.custom_label,
    thread_index: n.thread_index,
    lines: n.lines || [],
  }));

  const chordsByLineId = {};
  (snapshot?.chords || []).forEach((c) => {
    (chordsByLineId[c.line_id] ??= {});
    (chordsByLineId[c.line_id][c.line_index] ??= []).push({ id: c.id, chordName: c.chord_name, position: c.position });
  });
  Object.values(chordsByLineId).forEach((byLine) => {
    Object.values(byLine).forEach((arr) => arr.sort((a, b) => a.position - b.position));
  });

  return {
    title: snapshot?.title || '',
    viewOnly: Boolean(snapshot?.view_only),
    groups: groupNotesByThreadIndex(notes),
    chordsByLineId,
  };
}

// get_shared_song / accept_project_invite raise plain English messages;
// the visitor gets Spanish ones, in the app's voice.
export function sharedSongErrorMessage(message = '') {
  if (/not found/i.test(message)) return 'Este enlace no es válido.';
  if (/revoked/i.test(message)) return 'El propietario ha desactivado este enlace.';
  if (/expired/i.test(message)) return 'Este enlace ha caducado.';
  if (/already used/i.test(message)) return 'Este enlace ya se ha usado.';
  return 'No se pudo abrir la canción compartida. Prueba de nuevo en un momento.';
}
