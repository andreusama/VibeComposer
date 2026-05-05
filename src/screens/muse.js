import { setState } from '../state/store.js';

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  return `
    <div class="header">
      <h1>vibe composer</h1>
    </div>
    <div class="muse-screen">

      <div class="muse-step-label">01 — the muse</div>

      <div class="muse-prompt">what's the song about?</div>
      <div class="muse-sub">a feeling, a memory, a moment. write anything.</div>

      <textarea
        id="phrase-input"
        class="phrase-input"
        placeholder="losing you on a tuesday. the smell of rain on hot pavement. coming home to an empty house…"
        maxlength="280"
      >${state.phrase || ''}</textarea>

      <div class="muse-footer">
        <span class="char-count" id="char-count">${(state.phrase || '').length}/280</span>
        <button class="continue-btn ${state.phrase && state.phrase.trim().length > 2 ? 'enabled' : 'disabled'}"
          id="muse-continue"
          ${state.phrase && state.phrase.trim().length > 2 ? '' : 'disabled'}>
          continue →
        </button>
      </div>

    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const input    = document.getElementById('phrase-input');
  const btn      = document.getElementById('muse-continue');
  const counter  = document.getElementById('char-count');

  input.addEventListener('input', () => {
    const val = input.value;
    counter.textContent = `${val.length}/280`;
    const hasContent = val.trim().length > 2;
    btn.disabled = !hasContent;
    btn.classList.toggle('enabled',  hasContent);
    btn.classList.toggle('disabled', !hasContent);
    // Soft state sync (no re-render)
    state = { ...state, phrase: val };
  });

  // Focus textarea on load
  input.focus();

  btn.addEventListener('click', () => {
    setState({ phrase: input.value, screen: 'place' });
  });
}
