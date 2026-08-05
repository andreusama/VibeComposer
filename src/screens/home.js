import { setState } from '../state/store.js';
import { supabase } from '../utils/supabaseClient.js';

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const songs = state.songs || [];

  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">your projects</span>
      <button class="header-action ghost-btn" id="btn-sign-out">sign out</button>
    </div>
    <div class="body">

      ${state.projectError ? `<div class="error-banner">${state.projectError}</div>` : ''}

      <div class="projects-toolbar">
        <span class="projects-count">${songs.length} project${songs.length === 1 ? '' : 's'}</span>
        <div class="projects-search">
          <span class="projects-search-icon">⌕</span>
          <input type="text" id="project-search" placeholder="search projects" autocomplete="off" />
        </div>
      </div>

      <div class="projects-grid" id="project-list">
        <button class="project-new-card" id="btn-new-project">
          <span class="project-new-icon">+</span>
          <span>new project</span>
        </button>
        ${songs.map(renderProjectCard).join('')}
      </div>

    </div>
  `;
}

// Normalizes real canvas_x/canvas_y positions into a 0-100 percentage space
// so the thumbnail is a genuine (if tiny) reflection of that project's
// actual note layout and thread connections, not a generic decoration.
function buildPreview(nodes, links) {
  if (!nodes.length) return { points: [], lines: [] };

  const PAD = 18;
  const xs = nodes.map((n) => n.canvas_x || 0);
  const ys = nodes.map((n) => n.canvas_y || 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const positions = {};
  const points = nodes.map((n) => {
    const x = spanX ? PAD + ((n.canvas_x || 0) - minX) / spanX * (100 - PAD * 2) : 50;
    const y = spanY ? PAD + ((n.canvas_y || 0) - minY) / spanY * (100 - PAD * 2) : 50;
    positions[n.id] = { x, y };
    return { x, y, status: n.lines?.[0]?.status || 'provisional' };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const lines = links
    .filter((l) => nodeIds.has(l.source_note_id) && nodeIds.has(l.target_note_id))
    .map((l) => {
      const a = positions[l.source_note_id];
      const b = positions[l.target_note_id];
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" />`;
    });

  return { points, lines };
}

function renderProjectCard(song) {
  const lineCount = song.lineCount || 0;
  const progressionCount = song.progressionCount || 0;
  const { points, lines } = buildPreview(song.previewNodes || [], song.previewLinks || []);

  const nodesHtml = points.map((p) => `<span class="project-preview-node" style="left:${p.x}%;top:${p.y}%"></span>`).join('');
  const dotsHtml = points.length
    ? `<div class="project-preview-dots">${points.map((p) => `<span class="project-preview-dot ${p.status}"></span>`).join('')}</div>`
    : '';

  const linesLabel = lineCount > 0 ? `${lineCount} line${lineCount === 1 ? '' : 's'}` : 'no lines yet';

  return `
    <div class="project-card" data-title="${(song.title || 'untitled').toLowerCase()}">
      <div class="project-preview">
        <svg class="project-preview-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${lines.join('')}</svg>
        ${nodesHtml}
        ${dotsHtml}
      </div>
      <div class="project-card-body">
        <div class="project-card-title">${song.title || 'untitled'}</div>
        <div class="project-card-meta">
          <span class="project-meta-lines">☰ ${linesLabel}</span>
          ${progressionCount > 0 ? `<span class="project-meta-chords">♫ ${progressionCount} progression${progressionCount === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>
      <div class="project-card-foot">
        <span class="project-card-date">${new Date(song.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <button class="project-card-open" data-action="open" data-id="${song.id}">open canvas →</button>
      </div>
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

  document.querySelectorAll('[data-action="open"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const song = (state.songs || []).find((s) => s.id === btn.dataset.id);
      if (song) setState({ activeSong: song, screen: 'canvas' });
    });
  });

  // Plain local DOM filtering, not a setState-driven re-render — re-rendering
  // the whole screen on every keystroke would recreate this very input and
  // drop focus/cursor position after each character.
  const searchInput = document.getElementById('project-search');
  searchInput?.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('.project-card').forEach((card) => {
      card.style.display = card.dataset.title.includes(query) ? '' : 'none';
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
    .select('id, title, updated_at, lyric_language, lyric_dialect')
    .order('updated_at', { ascending: false });

  if (error) { setState({ projectError: error.message }); return; }

  const withLines = await attachLineCounts(data);
  const songs = await attachPreviewData(withLines);
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

// Chord-progression counts + a capped set of note positions/statuses and
// their main-thread links, just enough to draw each card's mini preview
// without pulling every field the real canvas needs.
async function attachPreviewData(songs) {
  const songIds = songs.map((s) => s.id);
  if (!songIds.length) return songs;

  const [{ data: progressions }, { data: sections }, { data: links }] = await Promise.all([
    supabase.from('chord_progressions').select('id, song_id').in('song_id', songIds),
    supabase.from('sections').select('id, song_id, canvas_x, canvas_y, lines(status)').in('song_id', songIds),
    supabase.from('note_links').select('song_id, source_note_id, target_note_id').in('song_id', songIds).eq('type', 'main-thread'),
  ]);

  const progressionCounts = {};
  (progressions || []).forEach((p) => { progressionCounts[p.song_id] = (progressionCounts[p.song_id] || 0) + 1; });

  const sectionsBySong = {};
  (sections || []).forEach((s) => { (sectionsBySong[s.song_id] ||= []).push(s); });

  const linksBySong = {};
  (links || []).forEach((l) => { (linksBySong[l.song_id] ||= []).push(l); });

  return songs.map((s) => ({
    ...s,
    progressionCount: progressionCounts[s.id] || 0,
    previewNodes: (sectionsBySong[s.id] || []).sort((a, b) => (a.canvas_x || 0) - (b.canvas_x || 0)).slice(0, 6),
    previewLinks: linksBySong[s.id] || [],
  }));
}

async function createProject(state) {
  const { data: song, error } = await supabase
    .from('songs')
    .insert({ user_id: state.session.user.id, title: 'untitled' })
    .select()
    .single();

  if (error) { setState({ projectError: error.message }); return; }

  // Just add it to the list — don't assume chords come first. The card's own
  // "open canvas" action is the one entry point, on equal footing for
  // whichever side (lyrics or chords) the user starts from.
  setState({ songs: [{ ...song, lineCount: 0, progressionCount: 0, previewNodes: [], previewLinks: [] }, ...(state.songs || [])], projectError: null });
}
