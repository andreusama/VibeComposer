import { setState, reset } from '../state/store.js';
import { copyCurrentUrl } from '../utils/share.js';
import { paletteFromRgb } from '../constants.js';

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const { progression } = state;
  const accent = paletteFromRgb(state.rgb.r, state.rgb.g, state.rgb.b)[0];

  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">ukulele · 4/4</span>
    </div>
    <div class="body">

      <div class="progression-meta">
        <div class="progression-title">${progression.title}</div>
        <div class="progression-summary">${progression.summary}</div>
        <div class="progression-key">key of ${progression.key}${state.vibeLabel ? ' · ' + state.vibeLabel : ''}</div>
      </div>

      <div class="chord-grid">
        ${progression.progression.map((ch, i) => renderChordCard(ch, i, accent)).join('')}
      </div>

      <div class="shorthand">
        ${progression.progression.map((c) => c.chord).join(' · ')} · ↻
      </div>

      <div class="action-row">
        <button class="ghost-btn" id="btn-reset">← new vibe</button>
        <button class="ghost-btn" id="btn-share">share progression</button>
      </div>

    </div>
  `;
}

function renderChordCard(chord, index, accent) {
  return `
    <button class="chord-card" data-index="${index}"
      style="border-color:${accent}33"
      onmouseover="this.style.borderColor='${accent}99'"
      onmouseout="this.style.borderColor='${accent}33'">
      <div class="chord-beat">beat ${index + 1}</div>
      <div class="chord-name" style="color:${accent}">${chord.chord}</div>
      <div class="chord-function">${chord.function}</div>
      <div class="chord-feel">${chord.feel}</div>
      <div class="chord-tap" style="color:${accent};border-top-color:${accent}33">tap to play</div>
    </button>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const accent = paletteFromRgb(state.rgb.r, state.rgb.g, state.rgb.b)[0];
  document.documentElement.style.setProperty('--accent', accent);

  document.querySelectorAll('.chord-card').forEach((card) => {
    card.addEventListener('click', () => {
      setState({ activeChord: Number(card.dataset.index), screen: 'chord' });
    });
  });

  document.getElementById('btn-reset').addEventListener('click', () => reset());

  document.getElementById('btn-share').addEventListener('click', async () => {
    const btn = document.getElementById('btn-share');
    const ok  = await copyCurrentUrl();
    if (ok) {
      btn.textContent = 'link copied ✓';
      btn.classList.add('success');
      setTimeout(() => {
        btn.textContent = 'share progression';
        btn.classList.remove('success');
      }, 2000);
    }
  });
}
