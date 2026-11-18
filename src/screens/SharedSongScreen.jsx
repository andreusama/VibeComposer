import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSharedSong } from '../canvas/collaborationData.js';
import { snapshotToView, sharedSongErrorMessage } from '../utils/sharedSong.js';
import { guestName } from '../utils/guestNames.js';
import { DEMO_ONLY } from '../utils/guest.js';
import SongPerformanceScreen from '../canvas/SongPerformanceScreen.jsx';
import MobileScreen from '../mobile/MobileScreen.jsx';

// A song opened from a share link by someone who hasn't signed in: the song's
// final read-through (every Part set apart, chords shown), read-only, kept
// fresh by polling — a snapshot, not a live connection (docs/adr/0003). No
// session is created, so there's nothing to clean up and no collaborator slot
// is used.

const REFRESH_MS = 8000;

export default function SharedSongScreen({ code, isAccount, onSignIn, onLeave }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { snapshot: snap, error: err } = await getSharedSong(code);
      if (err) throw err;
      setSnapshot(snap);
      setError(null);
    } catch (err) {
      // A failed REFRESH must not blank a song that's already on screen —
      // only the very first load turns into an error page.
      setError((prev) => prev ?? sharedSongErrorMessage(err?.message));
    }
  }, [code]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const view = useMemo(() => (snapshot ? snapshotToView(snapshot) : null), [snapshot]);
  const name = useMemo(() => guestName(), []);

  if (!view) {
    return (
      <MobileScreen className="perf-screen">
        <div className="shared-state">
          {error ? (
            <>
              <p className="thread-status thread-status-error">{error}</p>
              <button className="continue-btn enabled" onClick={onLeave}>Entrar en VibeComposer</button>
            </>
          ) : (
            <p className="thread-status">Cargando la canción…</p>
          )}
        </div>
      </MobileScreen>
    );
  }

  // Someone who can't edit this link (view-only, or the demo-only site) gets
  // no sign-in prompt; otherwise signing in is how they join as an editor.
  const canJoin = !view.viewOnly && !DEMO_ONLY && !isAccount;
  const banner = (
    <div className="shared-banner">
      <span className="shared-banner-text">
        {isAccount ? 'Solo lectura' : <>Estás viendo esta canción como <strong>{name}</strong> · solo lectura</>}
      </span>
      {canJoin && <button className="shared-banner-btn" onClick={onSignIn}>Inicia sesión para editar</button>}
      {isAccount && <button className="shared-banner-btn" onClick={onLeave}>Salir</button>}
    </div>
  );

  return <SongPerformanceScreen title={view.title} groups={view.groups} preloadedChords={view.chordsByLineId} banner={banner} />;
}
