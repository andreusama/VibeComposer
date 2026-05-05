import { setState, reset } from '../state/store.js';
import { copyCurrentUrl } from '../utils/share.js';
import { paletteFromRgb } from '../constants.js';
import { fretboardSVG } from '../components/fretboard.js';

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const { progression, phrase, place, rgb } = state;
  const accent  = paletteFromRgb(rgb.r, rgb.g, rgb.b)[0];
  const palette = paletteFromRgb(rgb.r, rgb.g, rgb.b);
  const date    = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">ukulele · 4/4</span>
    </div>
    <div class="body">

      <!-- ── The Artifact Card ── -->
      <div class="artifact-card" id="artifact-card">

        <!-- Lead sheet header -->
        <div class="artifact-header">
          <div class="artifact-timesig">
            <span class="timesig-num">4</span>
            <span class="timesig-num">4</span>
          </div>
          <div class="artifact-title">${progression.title}</div>
          <div class="artifact-meta-right">
            <div class="artifact-key">key of ${progression.key}</div>
            <div class="artifact-date">${date}</div>
          </div>
        </div>

        <!-- Staff lines + chords -->
        <div class="artifact-staff">
          <div class="staff-lines">
            <div class="staff-line"></div>
            <div class="staff-line"></div>
            <div class="staff-line"></div>
            <div class="staff-line"></div>
            <div class="staff-line"></div>
          </div>
          <div class="artifact-chords">
            ${progression.progression.map((ch, i) => `
              <div class="artifact-chord" data-index="${i}">
                <div class="artifact-beat">beat ${i + 1}</div>
                <div class="artifact-chord-name">${ch.chord}</div>
                <div class="artifact-fretboard">
                  ${fretboardSVG(ch.ukulele, accent)}
                </div>
                <div class="artifact-feel">${ch.feel}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Polaroid bottom — text + Adobe-style palette swatches -->
        <div class="artifact-footer">
          <div class="artifact-footer-text">
            <div class="artifact-phrase">"${phrase}"</div>
            ${place ? `<div class="artifact-place">📍 ${place}</div>` : ''}
            <div class="artifact-vibe">${state.vibeLabel || ''}</div>
          </div>
          <div class="artifact-swatches">
            ${palette.map(col => `<div class="artifact-swatch" style="background:${col}"></div>`).join('')}
          </div>
        </div>

      </div>

      <!-- Actions -->
      <div class="action-row" style="margin-top:20px">
        <button class="ghost-btn" id="btn-reset">← new vibe</button>
        <button class="ghost-btn" id="btn-share">share progression</button>
      </div>

    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const accent = paletteFromRgb(state.rgb.r, state.rgb.g, state.rgb.b)[0];
  document.documentElement.style.setProperty('--accent', accent);

  // Chord tap → chord screen
  document.querySelectorAll('.artifact-chord').forEach(el => {
    el.addEventListener('click', () => {
      setState({ activeChord: Number(el.dataset.index), screen: 'chord' });
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
