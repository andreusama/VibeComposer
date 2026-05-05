import { setState } from '../state/store.js';

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  const skip = state.skipPlace;

  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">${state.phrase.length > 40 ? state.phrase.slice(0, 40) + '…' : state.phrase}</span>
    </div>
    <div class="muse-screen">

      <div class="muse-step-label">02 — the place</div>

      <div class="muse-prompt">where does this song live?</div>
      <div class="muse-sub">a street, a city, a beach. somewhere that carries the feeling.</div>

      <input
        type="text"
        id="place-input"
        class="place-input ${skip ? 'disabled-input' : ''}"
        placeholder="Carrer de Provença 318, Barcelona…"
        value="${state.place || ''}"
        ${skip ? 'disabled' : ''}
      />

      <label class="skip-label">
        <input type="checkbox" id="skip-place" ${skip ? 'checked' : ''} />
        <div class="skip-box ${skip ? 'checked' : ''}">
          ${skip ? '✓' : ''}
        </div>
        <span>No physical place</span>
      </label>

      <div class="muse-footer">
        <button class="continue-btn secondary" id="place-back">← back</button>
        <button class="continue-btn enabled" id="place-continue">continue →</button>
      </div>

    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const input    = document.getElementById('place-input');
  const skipBox  = document.getElementById('skip-place');
  const skipVis  = document.querySelector('.skip-box');

  skipBox.addEventListener('change', () => {
    const skip = skipBox.checked;
    input.disabled = skip;
    input.classList.toggle('disabled-input', skip);
    skipVis.classList.toggle('checked', skip);
    skipVis.textContent = skip ? '✓' : '';
    if (skip) input.value = '';
  });

  document.getElementById('place-back').addEventListener('click', () => {
    setState({ screen: 'muse' });
  });

  document.getElementById('place-continue').addEventListener('click', () => {
    setState({
      place:     skipBox.checked ? '' : input.value.trim(),
      skipPlace: skipBox.checked,
      screen:    'photo',
    });
  });
}
