import { setState } from '../state/store.js';
import { supabase } from '../utils/supabaseClient.js';

// ─── Render ────────────────────────────────────────────────────────────────────

export function render(state) {
  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">sign in</span>
    </div>
    <div class="body">
      <div class="auth-card">
        <div class="auth-card-title">sign in to write</div>
        <div class="auth-card-sub">we'll email you a link — no password to remember.</div>

        ${state.projectError ? `<div class="error-banner">${state.projectError}</div>` : ''}

        <div id="auth-form" class="auth-form">
          <input type="email" id="auth-email" class="auth-input" placeholder="you@example.com" />
          <button class="continue-btn enabled auth-submit" id="auth-send">send magic link →</button>
        </div>

        <div id="auth-sent" class="confirm-label hidden"></div>
      </div>
    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const emailInput = document.getElementById('auth-email');
  const sendBtn    = document.getElementById('auth-send');
  const form       = document.getElementById('auth-form');
  const sentBox    = document.getElementById('auth-sent');

  emailInput.focus();

  sendBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) return;

    sendBtn.disabled = true;
    sendBtn.textContent = 'sending…';

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });

    if (error) {
      setState({ projectError: error.message });
      sendBtn.disabled = false;
      sendBtn.textContent = 'send magic link →';
      return;
    }

    form.classList.add('hidden');
    sentBox.classList.remove('hidden');
    sentBox.textContent = `📩 check ${email} for a sign-in link`;
  });

  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendBtn.click();
  });
}
