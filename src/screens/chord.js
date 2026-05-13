import { setState } from '../state/store.js';
import { fretboardSVG } from '../components/fretboard.js';
import { paletteFromRgb, energyIdFromValue } from '../constants.js';
import { playChord } from '../audio/player.js';

const TOTAL = 4;

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const { progression, activeChord } = state;
  const chord    = progression.progression[activeChord];
  const accent   = paletteFromRgb(state.rgb.r, state.rgb.g, state.rgb.b)[0];
  const energyId = energyIdFromValue(state.energy);

  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">${progression.title}</span>
    </div>
    <div class="body">

      <div class="beat-selector">
        ${progression.progression.map((ch, i) => `
          <button class="beat-dot ${i === activeChord ? 'active' : ''}" data-index="${i}">
            ${ch.chord}
          </button>
        `).join('')}
      </div>

      <div class="fretboard-card">
        <div class="fretboard-chord-name">${chord.chord}</div>
        ${fretboardSVG(chord.ukulele, accent)}
        <div class="fretboard-meta">${chord.function} · ${chord.feel}</div>
        <button class="play-btn" id="btn-play-chord" style="border-color:${accent};color:${accent}">
          ▶ play ${chord.chord}
        </button>
      </div>

      <div class="chord-nav">
        <button class="ghost-btn" id="btn-prev">← prev</button>
        <button class="ghost-btn" id="btn-progression">progression</button>
        <button class="ghost-btn" id="btn-next">next →</button>
      </div>

      <p class="uke-label">UKULELE · GCEA · ${energyId}</p>

    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const accent   = paletteFromRgb(state.rgb.r, state.rgb.g, state.rgb.b)[0];
  const energyId = energyIdFromValue(state.energy);
  document.documentElement.style.setProperty('--accent', accent);

  const { activeChord } = state;

  // Play chord automatically on load
  const chord = state.progression.progression[activeChord];
  playChord(chord.ukulele, energyId);

  // Play button
  document.getElementById('btn-play-chord').addEventListener('click', () => {
    playChord(chord.ukulele, energyId);
  });

  document.querySelectorAll('.beat-dot').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ activeChord: Number(btn.dataset.index) });
    });
  });

  document.getElementById('btn-prev').addEventListener('click', () => {
    setState({ activeChord: (activeChord - 1 + TOTAL) % TOTAL });
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    setState({ activeChord: (activeChord + 1) % TOTAL });
  });

  document.getElementById('btn-progression').addEventListener('click', () => {
    setState({ screen: 'result' });
  });
}