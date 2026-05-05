import { setState } from '../state/store.js';

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  return `
    <div class="header">
      <h1>vibe composer</h1>
    </div>
    <div class="muse-screen">

      <div class="muse-step-label">01 — the muse</div>

      <div class="muse-prompt">can you find the words?</div>
      <div class="muse-sub">a feeling, a memory, a moment. write anything.</div>

      <textarea
        id="phrase-input"
        class="phrase-input"
        placeholder="losing you on a tuesday. the smell of rain on hot pavement. coming home to an empty house…"
        maxlength="280"
      >${state.phrase || ''}</textarea>

      <div class="muse-footer">
  <label class="skip-label">
    <input type="checkbox" id="skip-phrase" ${state.skipPhrase ? 'checked' : ''} />
    <div class="skip-box ${state.skipPhrase ? 'checked' : ''}">
      ${state.skipPhrase ? '✓' : ''}
    </div>
    <span>Can't put it into words</span>
  </label>
  <div class="muse-footer-right">
    <span class="char-count" id="char-count">${(state.phrase || '').length}/280</span>
    <button class="continue-btn ${state.skipPhrase || (state.phrase && state.phrase.trim().length > 2) ? 'enabled' : 'disabled'}"
      id="muse-continue"
      ${state.skipPhrase || (state.phrase && state.phrase.trim().length > 2) ? '' : 'disabled'}>
      continue →
    </button>
  </div>
</div>

    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const input    = document.getElementById('phrase-input');
  const btn      = document.getElementById('muse-continue');
  const counter  = document.getElementById('char-count');
  const skipCheck = document.getElementById('skip-phrase');
  const box = document.querySelector('.skip-box');

  input.addEventListener('input', () => {
    const val = input.value;
    counter.textContent = `${val.length}/280`;
    const hasContent = val.trim().length > 0;
    btn.disabled = !hasContent;
    btn.classList.toggle('enabled',  hasContent);
    btn.classList.toggle('disabled', !hasContent);
    // Soft state sync (no re-render)
    state = { ...state, phrase: val };
  });
  
  skipCheck.addEventListener('change', () => {
  const skip = skipCheck.checked;
  box.classList.toggle('checked', skip);
  box.textContent = skip ? '✓' : '';
  input.disabled = skip;
  input.style.opacity = skip ? '0.3' : '1';
  btn.disabled = !skip;
  btn.classList.toggle('enabled', !skip || skip);
  btn.classList.remove('disabled');
  state = { ...state, phrase: skip ? null : '' };
});

  // Focus textarea on load
  input.focus();

  btn.addEventListener('click', () => {
    setState({ phrase: input.value, screen: 'place' });
  });
}
