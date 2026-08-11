import { setState } from '../state/store.js';
import {supabase} from '../utils/supabaseClient.js';
import {loadProjectSummaries, computePreviewLayout, createProject as createProjectRow} from './projectsData.js';

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const songs = state.songs || [];

  return `
    <div class="header">
      ${import.meta.env.DEV ? `<button class="icon-btn" id="btn-muse-eye" title="Muse Eye — real debug history">👁</button>` : ''}
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

function renderProjectCard(song) {
  const lineCount = song.lineCount || 0;
  const progressionCount = song.progressionCount || 0;
  const { points, lines: lineSegments } = computePreviewLayout(song.previewNodes || [], song.previewLinks || []);
  const lines = lineSegments.map((l) => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" />`);

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

  document.getElementById('btn-muse-eye')?.addEventListener('click', () => {
    setState({ screen: 'museeye' });
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
  const { songs, error } = await loadProjectSummaries();
  setState({ songs, projectError: error });
}

async function createProject(state) {
  const { song, error } = await createProjectRow(state.session.user.id);
  if (error) { setState({ projectError: error }); return; }

  // Just add it to the list — don't assume chords come first. The card's own
  // "open canvas" action is the one entry point, on equal footing for
  // whichever side (lyrics or chords) the user starts from.
  setState({ songs: [song, ...(state.songs || [])], projectError: null });
}
