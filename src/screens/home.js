import { setState, enterProjectChords } from '../state/store.js';
import { supabase } from '../utils/supabaseClient.js';

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const songs = state.songs || [];

  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">your projects</span>
    </div>
    <div class="body">

      ${state.projectError ? `<div class="error-banner">${state.projectError}</div>` : ''}

      <div class="lyrics-home-top">
        <button class="ghost-btn" id="btn-new-project">+ new project</button>
        <button class="ghost-btn" id="btn-sign-out">sign out</button>
      </div>

      <div class="lyrics-song-list" id="project-list">
        ${songs.length ? songs.map(renderProjectRow).join('') : '<div class="muse-sub">no projects yet — start one above.</div>'}
      </div>

    </div>
  `;
}

function renderProjectRow(song) {
  const chordsChip = song.vibe_snapshot?.progression
    ? `🎵 ${song.vibe_snapshot.progression.key} · ${song.vibe_snapshot.progression.title}`
    : '🎵 no chords yet';

  const lineCount = song.lineCount || 0;
  const lyricsChip = lineCount > 0
    ? `📝 ${lineCount} line${lineCount === 1 ? '' : 's'}`
    : '📝 no lyrics yet';

  return `
    <div class="lyrics-song-row" data-id="${song.id}">
      <div class="lyrics-song-info">
        <span class="lyrics-song-title">${song.title || 'untitled'}</span>
        <span class="lyrics-song-chip">${chordsChip}</span>
        <span class="lyrics-song-chip">${lyricsChip}</span>
      </div>
      <div class="lyrics-song-actions">
        <button class="ghost-btn" data-action="chords" data-id="${song.id}">🎵 chords</button>
        <button class="ghost-btn" data-action="lyrics" data-id="${song.id}">📝 lyrics</button>
      </div>
      <span class="lyrics-song-date">${new Date(song.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export async function attach(state, justEntered) {
  document.getElementById('btn-sign-out').addEventListener('click', async () => {
    await supabase.auth.signOut();
    setState({ session: null, songs: [], activeSong: null, screen: 'home' });
  });

  document.getElementById('btn-new-project').addEventListener('click', () => createProject(state));

  document.querySelectorAll('[data-action="chords"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const song = (state.songs || []).find((s) => s.id === btn.dataset.id);
      if (song) enterProjectChords(song);
    });
  });

  document.querySelectorAll('[data-action="lyrics"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const song = (state.songs || []).find((s) => s.id === btn.dataset.id);
      if (song) setState({ activeSong: song, screen: 'canvas' });
    });
  });

  if (justEntered) {
    await loadSongs();
  }
}

// ─── Data ──────────────────────────────────────────────────────────────────────

async function loadSongs() {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, updated_at, vibe_snapshot')
    .order('updated_at', { ascending: false });

  if (error) { setState({ projectError: error.message }); return; }

  const songs = await attachLineCounts(data);
  setState({ songs, projectError: null });
}

// One extra round trip to show a lyrics status chip with the same weight as
// the chords chip — otherwise the dashboard visually implies chords are the
// primary artifact and lyrics are secondary, which isn't the point of a
// project that can start from either side.
async function attachLineCounts(songs) {
  const songIds = songs.map((s) => s.id);
  if (!songIds.length) return songs;

  const { data: sections } = await supabase
    .from('sections').select('id, song_id').in('song_id', songIds);
  const sectionToSong = Object.fromEntries((sections || []).map((s) => [s.id, s.song_id]));
  const sectionIds = Object.keys(sectionToSong);
  if (!sectionIds.length) return songs.map((s) => ({ ...s, lineCount: 0 }));

  const { data: lines } = await supabase
    .from('lines').select('section_id').in('section_id', sectionIds);

  const counts = {};
  (lines || []).forEach((l) => {
    const songId = sectionToSong[l.section_id];
    counts[songId] = (counts[songId] || 0) + 1;
  });

  return songs.map((s) => ({ ...s, lineCount: counts[s.id] || 0 }));
}

async function createProject(state) {
  const { data: song, error } = await supabase
    .from('songs')
    .insert({ user_id: state.session.user.id, title: 'untitled' })
    .select()
    .single();

  if (error) { setState({ projectError: error.message }); return; }

  // Just add it to the list — don't assume chords come first. The row's own
  // "🎵 chords" / "📝 lyrics" buttons are the entry points, on equal footing.
  setState({ songs: [song, ...(state.songs || [])], projectError: null });
}
