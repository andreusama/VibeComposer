// Transient screen shown while redeeming a collaboration invite link right
// after sign-in (see src/screens/inviteFlow.js) — same shape as loading.js,
// just with its own copy and an error state with a way out.
import { dismissInviteError } from './inviteFlow.js';

export function render(state) {
  if (state.inviteStatus === 'error') {
    return `
      <div class="header"><h1>vibe composer</h1></div>
      <div class="loading-center">
        <p class="loading-hint">${state.inviteError || "Couldn't join this project."}</p>
        <button class="continue-btn enabled" id="joining-dismiss">back to my projects</button>
      </div>
    `;
  }
  return `
    <div class="header"><h1>vibe composer</h1></div>
    <div class="loading-center">
      <div class="spinner"></div>
      <p class="loading-hint">joining the project…</p>
    </div>
  `;
}

export function attach() {
  document.getElementById('joining-dismiss')?.addEventListener('click', dismissInviteError);
}
