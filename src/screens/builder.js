import { DIMENSIONS, ENERGY_LABELS, rgbToHsl, moodFromHsl, paletteFromRgb, rgbToHex, energyIdFromValue } from '../constants.js';
import { setState } from '../state/store.js';
import { composeProgression } from '../utils/api.js';
import { writeShareUrl } from '../utils/share.js';

// ─── Canvas animation state ────────────────────────────────────────────────────
// Lives outside render/attach so the animation survives between minor re-renders.

const anim = { energy: 50, accent: '#5a9ed4', id: null };

function stopAnim() {
  if (anim.id) { cancelAnimationFrame(anim.id); anim.id = null; }
}

function startAnim() {
  stopAnim();
  const canvas = document.getElementById('waveform-canvas');
  if (!canvas) return;

  // Match canvas pixel size to its CSS size
  canvas.width  = canvas.offsetWidth  || 400;
  canvas.height = canvas.offsetHeight || 72;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let start = null;

  function draw(ts) {
    if (!start) start = ts;
    const t = (ts - start) * 0.001;
    ctx.clearRect(0, 0, W, H);

    const energy  = (anim.energy / 100) * 4;
    const amp     = H * 0.42 * Math.pow(Math.max(energy, 0.05) / 4, 0.6);
    const distort = Math.max(0, energy - 3);
    const cy      = H / 2;

    // Center reference line
    ctx.strokeStyle = anim.accent + '28';
    ctx.lineWidth   = 0.5;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();

    // Waveform
    ctx.strokeStyle = anim.accent;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.beginPath();

    for (let x = 0; x <= W; x++) {
      const phase = (x / W) * Math.PI * 8 + t * 2.2;
      let y = Math.sin(phase);
      if (distort > 0) {
        y += distort * 0.45 * Math.sin(phase * 3);
        y += distort * 0.18 * Math.sin(phase * 5);
        y  = Math.tanh(y * (1 + distort * 2.8));
      }
      x === 0 ? ctx.moveTo(x, cy - y * amp) : ctx.lineTo(x, cy - y * amp);
    }
    ctx.stroke();
    anim.id = requestAnimationFrame(draw);
  }

  anim.id = requestAnimationFrame(draw);
}

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const { r, g, b } = state.rgb;
  const [h, s, l]   = rgbToHsl(r, g, b);
  const mood        = moodFromHsl(h, s, l);
  const palette     = paletteFromRgb(r, g, b);
  const accent      = palette[0];
  const pickedHex   = rgbToHex(r, g, b);
  const energyId    = energyIdFromValue(state.energy);
  const hasAll      = state.flavour && state.texture;

  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">ukulele</span>
    </div>
    <div class="body">

      ${state.error ? `<div class="error-banner">${state.error}</div>` : ''}

      ${renderMoodSection(r, g, b, accent, palette, mood, pickedHex)}
      ${renderEnergySection(state.energy, energyId, accent)}
      ${renderTagSection('flavour', state.flavour, accent)}
      ${renderTagSection('texture', state.texture, accent)}

      <div class="vibe-summary${hasAll ? ' ready' : ''}"
           style="${hasAll ? `border-color:${palette[3]};background:${palette[3]}44` : ''}">
        <div class="vibe-text" style="color:${hasAll ? accent : ''}">
          ${hasAll ? `${mood} · ${energyId} · ${state.flavour} · ${state.texture}` : 'select flavour and texture'}
        </div>
        <button id="compose-btn" class="compose-btn ${hasAll ? 'enabled' : 'disabled'}" ${hasAll ? '' : 'disabled'}>
          ${hasAll ? 'compose ↗' : '...'}
        </button>
      </div>

    </div>
  `;
}

function renderMoodSection(r, g, b, accent, palette, mood, pickedHex) {
  const palSwatches = palette.map(c =>
    `<div class="palette-swatch" style="background:${c}"></div>`
  ).join('');

  return `
    <div class="dimension">
      <div class="dimension-label" style="color:${accent}">Mood</div>
      <div class="mood-picker">
        <div class="color-preview" id="color-preview" style="background:${pickedHex};box-shadow:0 0 20px ${pickedHex}44"></div>
        <div class="rgb-sliders">
          <div class="rgb-row">
            <span class="rgb-label">R</span>
            <div class="rgb-track">
              <div class="rgb-fill" id="fill-r" style="width:${(r/255)*100}%;background:rgb(${r},0,0)"></div>
              <input type="range" class="rgb-input" id="slider-r" min="0" max="255" value="${r}">
            </div>
            <span class="rgb-value" id="val-r">${r}</span>
          </div>
          <div class="rgb-row">
            <span class="rgb-label">G</span>
            <div class="rgb-track">
              <div class="rgb-fill" id="fill-g" style="width:${(g/255)*100}%;background:rgb(0,${g},0)"></div>
              <input type="range" class="rgb-input" id="slider-g" min="0" max="255" value="${g}">
            </div>
            <span class="rgb-value" id="val-g">${g}</span>
          </div>
          <div class="rgb-row">
            <span class="rgb-label">B</span>
            <div class="rgb-track">
              <div class="rgb-fill" id="fill-b" style="width:${(b/255)*100}%;background:rgb(0,0,${b})"></div>
              <input type="range" class="rgb-input" id="slider-b" min="0" max="255" value="${b}">
            </div>
            <span class="rgb-value" id="val-b">${b}</span>
          </div>
        </div>
      </div>
      <div class="palette-row">
        ${palSwatches}
        <span class="mood-label" id="mood-label" style="color:${accent}">→ ${mood}</span>
      </div>
    </div>
  `;
}

function renderEnergySection(energy, energyId, accent) {
  const labels = ENERGY_LABELS.map(l => `
    <span class="energy-snap ${l.id === energyId ? 'active' : ''}"
          style="${l.id === energyId ? `color:${accent}` : ''}"
          data-center="${l.center}">${l.id}</span>
  `).join('');

  return `
    <div class="dimension">
      <div class="dimension-label" style="color:${accent}">Energy</div>
      <canvas id="waveform-canvas" style="width:100%;height:72px;display:block;border-radius:8px;background:#161412"></canvas>
      <input type="range" class="energy-slider" id="energy-slider" min="0" max="100" value="${energy}">
      <div class="energy-labels">${labels}</div>
    </div>
  `;
}

function renderTagSection(dim, selected, accent) {
  const { label, tags } = DIMENSIONS[dim];
  const pills = tags.map(tag => {
    const active = selected === tag;
    const style  = active
      ? `style="border-color:${DIMENSIONS[dim].accent};color:${DIMENSIONS[dim].accent};background:${DIMENSIONS[dim].accent}18"`
      : '';
    return `<button class="tag ${active ? 'active' : ''}" ${style} data-dim="${dim}" data-tag="${tag}">${tag}</button>`;
  }).join('');

  return `
    <div class="dimension">
      <div class="dimension-label" style="color:${DIMENSIONS[dim].accent}">${label}</div>
      <div class="tag-row">${pills}</div>
    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  // Sync animation state with current values
  anim.energy = state.energy;
  anim.accent = paletteFromRgb(state.rgb.r, state.rgb.g, state.rgb.b)[0];
  startAnim();

  // ── RGB sliders: update DOM live, sync store on release ──────────────────────
  let liveRgb = { ...state.rgb };

  function updateColorDom(r, g, b) {
    const palette   = paletteFromRgb(r, g, b);
    const accent    = palette[0];
    const pickedHex = rgbToHex(r, g, b);
    const [h, s, l] = rgbToHsl(r, g, b);
    const mood      = moodFromHsl(h, s, l);

    document.getElementById('color-preview').style.background   = pickedHex;
    document.getElementById('color-preview').style.boxShadow    = `0 0 20px ${pickedHex}44`;
    document.getElementById('fill-r').style.width      = `${(r / 255) * 100}%`;
    document.getElementById('fill-r').style.background = `rgb(${r},0,0)`;
    document.getElementById('fill-g').style.width      = `${(g / 255) * 100}%`;
    document.getElementById('fill-g').style.background = `rgb(0,${g},0)`;
    document.getElementById('fill-b').style.width      = `${(b / 255) * 100}%`;
    document.getElementById('fill-b').style.background = `rgb(0,0,${b})`;
    document.getElementById('val-r').textContent = r;
    document.getElementById('val-g').textContent = g;
    document.getElementById('val-b').textContent = b;
    document.getElementById('mood-label').textContent  = `→ ${mood}`;
    document.getElementById('mood-label').style.color  = accent;
    anim.accent = accent; // live update canvas color
  }

  ['r', 'g', 'b'].forEach(ch => {
    const slider = document.getElementById(`slider-${ch}`);
    slider.addEventListener('input', () => {
      liveRgb[ch] = Number(slider.value);
      updateColorDom(liveRgb.r, liveRgb.g, liveRgb.b);
    });
    slider.addEventListener('change', () => {
      setState({ rgb: { ...liveRgb } });
    });
  });

  // ── Energy slider: update canvas live, sync store on release ─────────────────
  const energySlider = document.getElementById('energy-slider');

  energySlider.addEventListener('input', () => {
    anim.energy = Number(energySlider.value);
    const id = energyIdFromValue(anim.energy);
    document.querySelectorAll('.energy-snap').forEach(el => {
      const isActive = el.dataset.center && energyIdFromValue(Number(el.dataset.center)) === id
        ? false : el.textContent.trim() === id;
      el.classList.toggle('active', isActive);
      el.style.color = isActive ? anim.accent : '';
    });
  });

  energySlider.addEventListener('change', () => {
    setState({ energy: Number(energySlider.value) });
  });

  // Snap labels
  document.querySelectorAll('.energy-snap').forEach(el => {
    el.addEventListener('click', () => {
      const center = Number(el.dataset.center);
      anim.energy = center;
      energySlider.value = center;
      setState({ energy: center });
    });
  });

  // ── Tag pills ────────────────────────────────────────────────────────────────
  document.querySelectorAll('.tag').forEach(btn => {
    btn.addEventListener('click', () => {
      setState({ [btn.dataset.dim]: btn.dataset.tag });
    });
  });

  // ── Compose ──────────────────────────────────────────────────────────────────
  const composeBtn = document.getElementById('compose-btn');
  if (composeBtn && !composeBtn.disabled) {
    composeBtn.addEventListener('click', () => handleCompose(state));
  }
}

async function handleCompose(state) {
  const { r, g, b } = state.rgb;
  const [h, s, l]   = rgbToHsl(r, g, b);
  const mood        = moodFromHsl(h, s, l);
  const energyId    = energyIdFromValue(state.energy);
  const vibeLabel   = `${mood} · ${energyId} · ${state.flavour} · ${state.texture}`;

  stopAnim();
  setState({ screen: 'loading', error: null });

  try {
    const result = await composeProgression({
      mood,
      energy:  energyId,
      flavour: state.flavour,
      texture: state.texture,
      easyMode: state.easyMode,
    });
    writeShareUrl({ progression: result, vibeLabel });
    setState({ progression: result, vibeLabel, screen: 'result' });
  } catch {
    setState({ error: "Couldn't compose — adjust your vibe and try again.", screen: 'builder' });
  }
}
