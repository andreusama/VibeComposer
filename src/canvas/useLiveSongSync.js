// ─── Live song sync ─────────────────────────────────────────────────────────
// Notifies a callback when a collaborator changes something about this song
// that the screen should react to — sections (added/removed/reordered) and
// lines (a block's text — one row per SECTION, not per physical line; see
// NoteEditorScreen's own comment on that). Deliberately coarse: it tells the
// caller "something changed, go refetch" rather than patching individual
// rows into local state itself — a full refetch of one song's notes is cheap,
// and a hand-merged partial update is exactly the kind of thing that quietly
// drifts from the DB over time. See migration_project_collaboration.sql's
// "Sync model" note for the larger tradeoff this is part of.
//
// `lines` has no song_id column to filter on server-side, so this keeps a
// live set of the song's own section ids and filters lines events against it
// client-side — Realtime still only ever delivers rows this client's own RLS
// lets it see in the first place, so that filtering is about relevance, not
// a second security boundary.

import { useEffect, useRef } from 'react';
import { supabase } from '../utils/supabaseClient.js';

export default function useLiveSongSync(songId, onChange) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!songId) return;

    let cancelled = false;
    let sectionIds = new Set();

    supabase.from('sections').select('id').eq('song_id', songId).then(({ data }) => {
      if (!cancelled) sectionIds = new Set((data || []).map((s) => s.id));
    });

    const channel = supabase
      .channel(`song-sync:${songId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sections', filter: `song_id=eq.${songId}` }, (payload) => {
        const row = payload.new?.id ? payload.new : payload.old;
        if (row?.id) {
          if (payload.eventType === 'DELETE') sectionIds.delete(row.id);
          else sectionIds.add(row.id);
        }
        onChangeRef.current?.(payload);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lines' }, (payload) => {
        const row = payload.new || payload.old;
        if (!row || !sectionIds.has(row.section_id)) return;
        onChangeRef.current?.(payload);
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [songId]);
}
