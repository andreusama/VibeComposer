import { setState } from '../state/store.js';
import { supabase } from '../utils/supabaseClient.js';
import { startGuestDemo, GUEST_MUSE_CALLS_PER_DAY } from '../utils/guest.js';

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

// Google's official four-colour "G" — brand colours on purpose, not themed.
const GOOGLE_LOGO = `<svg class="auth-google-logo" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

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

        <button class="continue-btn enabled auth-submit" id="auth-demo">try the demo</button>
        <div class="auth-demo-note">no sign-up · a sample song, ready to play with · ${GUEST_MUSE_CALLS_PER_DAY} Muse calls a day</div>

        <div class="auth-divider"><span>or sign in</span></div>

        <button class="ghost-btn auth-google" id="auth-google">${GOOGLE_LOGO}<span>continue with Google</span></button>

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
  const demoBtn        = document.getElementById('auth-demo');
  const googleBtn      = document.getElementById('auth-google');
  const passwordBtn     = document.getElementById('auth-password-submit');
  const sendBtn         = document.getElementById('auth-send');
  const createPwBtn     = document.getElementById('auth-create-password');
  const form           = document.getElementById('auth-form');
  const sentBox        = document.getElementById('auth-sent');

  // No emailInput.focus() here on purpose: the demo button is the first thing
  // to try, and focusing a field pops the keyboard over it on a phone.

  demoBtn.addEventListener('click', async () => {
    demoBtn.disabled = true;
    demoBtn.textContent = 'abriendo la demo…';
    const { error } = await startGuestDemo();
    if (error) {
      setState({ projectError: error });
      demoBtn.disabled = false;
      demoBtn.textContent = 'try the demo';
    }
    // On success the auth-state listener swaps this screen out by itself.
  });

  const showError = (message) => setState({ projectError: message });

  // One redirect to Google, then straight back in — no code on this screen
  // runs again until the browser comes back with a session (Supabase's
  // client parses that from the URL on load, same as it already does for
  // magic-link redirects).
  googleBtn.addEventListener('click', async () => {
    googleBtn.disabled = true;
    // Google refuses to render inside an iframe (the desktop phone frame), so
    // there the redirect has to happen on the TOP page instead.
    const inFrame = window.top !== window.self;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo(), skipBrowserRedirect: inFrame },
    });
    if (inFrame && data?.url) window.top.location.href = data.url;
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
