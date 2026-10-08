// ─── Project presence ───────────────────────────────────────────────────────
// "Who's here right now" for a song, via Supabase Realtime Presence —
// separate from useLiveSongSync.js on purpose: presence is ephemeral (who's
// connected, which section they're looking at) and never touches the
// database, while sync is real content change notifications over Postgres
// Changes. One channel per song, keyed by user id.
//
// Known, accepted limitation: Realtime Presence channels aren't RLS-scoped
// the way table access is — anyone who already knows this song's id (a
// random uuid, not guessable) and has a valid session could join this exact
// channel name and see who's present, or inject a fake peer. The only thing
// exposed is presence on a song they'd need to already know the id of, and
// the display names shown are the same ones project_collaborators/profiles
// already expose to real collaborators — worth tightening later with
// Realtime's private-channel authorization if this ever matters more than
// it does for up to 4 people on a lyrics app.

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../utils/supabaseClient.js';

export default function useProjectPresence(songId, userId, displayName) {
  const [peers, setPeers] = useState([]); // [{ userId, displayName, sectionId }], excludes self
  const channelRef = useRef(null);
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;

  useEffect(() => {
    if (!songId || !userId) return;

    const channel = supabase.channel(`presence:song:${songId}`, {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    channel.on('presence', { event: 'sync' }, () => {
      const presenceState = channel.presenceState();
      const next = Object.entries(presenceState)
        .filter(([key]) => key !== userId)
        .map(([key, metas]) => {
          const latest = metas[metas.length - 1];
          return { userId: key, displayName: latest?.display_name || '?', sectionId: latest?.section_id || null };
        });
      setPeers(next);
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') channel.track({ display_name: displayNameRef.current, section_id: null });
    });

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setPeers([]);
    };
  }, [songId, userId]);

  // Called as the user moves between notes, so peers see which block (if
  // any) each other person currently has open — a lightweight "someone's
  // here" signal, not a hard lock on editing it.
  const setFocusedSection = useCallback((sectionId) => {
    channelRef.current?.track({ display_name: displayNameRef.current, section_id: sectionId || null });
  }, []);

  return { peers, setFocusedSection };
}
