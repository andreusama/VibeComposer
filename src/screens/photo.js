import { setState } from '../state/store.js';

// ─── Extract dominant color from image via canvas ─────────────────────────────

function extractDominantRgb(imgEl) {
  const canvas = document.createElement('canvas');
  const SIZE   = 50; // sample at small size for speed
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Skip near-white and near-black pixels
    const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
    if (brightness > 30 && brightness < 230) {
      r += data[i]; g += data[i+1]; b += data[i+2];
      count++;
    }
  }
  if (!count) return { r: 107, g: 140, b: 174 };
  return { r: Math.round(r/count), g: Math.round(g/count), b: Math.round(b/count) };
}

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const skip = state.skipPhoto;

  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">${state.phrase.length > 40 ? state.phrase.slice(0, 40) + '…' : state.phrase}</span>
    </div>
    <div class="muse-screen">

      <div class="muse-step-label">03 — the image</div>

      <div class="muse-prompt">is there an image that holds this feeling?</div>
      <div class="muse-sub">a photo, a polaroid, a screenshot. its colors will become the song's palette.</div>

      <div class="photo-upload-area ${skip ? 'hidden' : ''}" id="upload-area">
        <input type="file" id="photo-input" accept="image/*" style="display:none"/>
        <div class="photo-drop" id="photo-drop">
          <div class="photo-drop-icon">⬆</div>
          <div class="photo-drop-label">tap to upload an image</div>
          <div class="photo-drop-sub">jpg, png, webp</div>
        </div>
        <img id="photo-preview" class="photo-preview hidden" />
        <div class="photo-color-preview hidden" id="color-extracted">
          <div class="extracted-swatch" id="extracted-swatch"></div>
          <span class="extracted-label">color extracted ✓</span>
        </div>
      </div>

      <label class="skip-label">
        <input type="checkbox" id="skip-photo" ${skip ? 'checked' : ''} />
        <div class="skip-box ${skip ? 'checked' : ''}">
          ${skip ? '✓' : ''}
        </div>
        <span>Just an idea</span>
      </label>

      <div class="muse-footer">
        <button class="continue-btn secondary" id="photo-back">← back</button>
        <button class="continue-btn enabled" id="photo-continue">continue →</button>
      </div>

    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const fileInput   = document.getElementById('photo-input');
  const drop        = document.getElementById('photo-drop');
  const preview     = document.getElementById('photo-preview');
  const uploadArea  = document.getElementById('upload-area');
  const skipCheck   = document.getElementById('skip-photo');
  const skipVis     = document.querySelector('.skip-box');
  const colorBlock  = document.getElementById('color-extracted');
  const swatch      = document.getElementById('extracted-swatch');

  let extractedRgb  = null;

  function handleImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img  = new Image();
    img.onload = () => {
      preview.src = url;
      preview.classList.remove('hidden');
      drop.classList.add('hidden');
      extractedRgb = extractDominantRgb(img);
      const { r, g, b } = extractedRgb;
      swatch.style.background = `rgb(${r},${g},${b})`;
      colorBlock.classList.remove('hidden');
    };
    img.src = url;
  }

  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => handleImage(fileInput.files[0]));

  // Drag and drop
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('drag-over');
    handleImage(e.dataTransfer.files[0]);
  });

  skipCheck.addEventListener('change', () => {
    const skip = skipCheck.checked;
    skipVis.classList.toggle('checked', skip);
    skipVis.textContent = skip ? '✓' : '';
    uploadArea.classList.toggle('hidden', skip);
  });

  document.getElementById('photo-back').addEventListener('click', () => {
    setState({ screen: 'place' });
  });

  document.getElementById('photo-continue').addEventListener('click', () => {
    const skip = skipCheck.checked;
    setState({
      skipPhoto: skip,
      rgb:       (!skip && extractedRgb) ? extractedRgb : state.rgb,
      photoUrl:  (!skip && preview.src) ? preview.src : null,
      screen:    'builder',
    });
  });
}
