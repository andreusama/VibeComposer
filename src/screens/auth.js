import { setState } from '../state/store.js';
import { supabase } from '../utils/supabaseClient.js';

// ─── Sign-in ────────────────────────────────────────────────────────────────
// Three ways in, same account underneath (Supabase links them by email
// automatically — Google and password both land on the same row a prior
// magic-link sign-in created, as long as the email matches and is verified):
//
// 1. Google — one click, no round trip at all. The one most people already
//    have ready, and the fastest path for everyone, casual or not.
// 2. Email + password — for whoever has set one (see "crear contraseña"
//    below): no email round trip either, just typing. This is what makes
//    repeat sign-ins during iteration fast; magic link alone meant a real
//    email wait on every single one.
// 3. Magic link — unchanged, still the zero-setup default: nothing to
//    remember, works the first time with no prior step.
//
// Deliberately NOT trying to silently fall back from a failed password
// attempt into "maybe they meant to sign up" — Supabase's own anti-
// enumeration behavior (a signUp() for an email that already has a
// CONFIRMED identity returns the same "check your email" response as a
// genuine new signup, doing nothing silently) makes guessing intent from
// the error message alone unreliable. "Entrar" and "crear contraseña" stay
// two distinct, explicit actions instead.

const redirectTo = () => window.location.origin + window.location.pathname;

export function render(state) {
  return `
    <div class="header">
      <h1>vibe composer</h1>
      <span class="tagline">sign in</span>
    </div>
    <div class="body">
      <div class="auth-card">
        <div class="auth-card-title">sign in to write</div>
        <div class="auth-card-sub">google is fastest. a password works too, once you've set one — no email wait either way.</div>

        ${state.projectError ? `<div class="error-banner">${state.projectError}</div>` : ''}

        <button class="ghost-btn auth-google" id="auth-google">continue with Google</button>

        <div class="auth-divider"><span>or</span></div>

        <div id="auth-form" class="auth-form">
          <input type="email" id="auth-email" class="auth-input" placeholder="you@example.com" autocomplete="email" />
          <input type="password" id="auth-password" class="auth-input" placeholder="password (optional)" autocomplete="current-password" />

          <button class="continue-btn enabled auth-submit" id="auth-password-submit">sign in with password</button>
          <button class="continue-btn secondary auth-submit" id="auth-send">send magic link →</button>

          <button class="auth-link" id="auth-create-password">first time with a password? create one</button>
        </div>

        <div id="auth-sent" class="confirm-label hidden"></div>
      </div>
    </div>
  `;
}

// ─── Attach ────────────────────────────────────────────────────────────────────

export function attach(state) {
  const emailInput    = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const googleBtn      = document.getElementById('auth-google');
  const passwordBtn     = document.getElementById('auth-password-submit');
  const sendBtn         = document.getElementById('auth-send');
  const createPwBtn     = document.getElementById('auth-create-password');
  const form           = document.getElementById('auth-form');
  const sentBox        = document.getElementById('auth-sent');

  emailInput.focus();

  const showError = (message) => setState({ projectError: message });

  // One redirect to Google, then straight back in — no code on this screen
  // runs again until the browser comes back with a session (Supabase's
  // client parses that from the URL on load, same as it already does for
  // magic-link redirects).
  googleBtn.addEventListener('click', async () => {
    googleBtn.disabled = true;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo() },
    });
    // Only reachable on an immediate failure (e.g. the provider isn't
    // configured yet) — a successful call navigates away before this runs.
    if (error) {
      showError(error.message);
      googleBtn.disabled = false;
    }
  });

  passwordBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) { showError('introduce email y contraseña.'); return; }

    passwordBtn.disabled = true;
    passwordBtn.textContent = 'entrando…';

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showError(error.message);
      passwordBtn.disabled = false;
      passwordBtn.textContent = 'sign in with password';
    }
    // On success the auth-state listener elsewhere in the app picks up the
    // new session and re-renders away from this screen — nothing more to
    // do here.
  });

  sendBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) return;

    sendBtn.disabled = true;
    sendBtn.textContent = 'sending…';

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });

    if (error) {
      showError(error.message);
      sendBtn.disabled = false;
      sendBtn.textContent = 'send magic link →';
      return;
    }

    form.classList.add('hidden');
    sentBox.classList.remove('hidden');
    sentBox.textContent = `📩 check ${email} for a sign-in link`;
  });

  // signUp() with a password, for an email that has no password yet. If the
  // email already has a CONFIRMED account (from a prior magic-link or
  // Google sign-in) Supabase's own anti-enumeration behavior returns this
  // exact same "check your email" shape without actually sending anything
  // or changing that account — indistinguishable here from a genuine new
  // signup. That's a one-time, mildly confusing edge case (a returning
  // user sees a "check your email" message that resolves nothing), not a
  // broken or insecure one: magic link and Google both still work for them
  // regardless.
  createPwBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) { showError('introduce email y contraseña para crear una.'); return; }

    createPwBtn.disabled = true;
    createPwBtn.textContent = 'creando…';

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo() },
    });

    if (error) {
      showError(error.message);
      createPwBtn.disabled = false;
      createPwBtn.textContent = 'first time with a password? create one';
      return;
    }

    form.classList.add('hidden');
    sentBox.classList.remove('hidden');
    sentBox.textContent = `📩 check ${email} to confirm your new password`;
  });

  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (passwordInput.value ? passwordBtn : sendBtn).click();
  });
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') passwordBtn.click();
  });
}
