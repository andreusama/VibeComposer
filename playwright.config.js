import { defineConfig, devices } from '@playwright/test';

// Node 22's own .env loader (no dotenv dependency) — picks up
// PLAYWRIGHT_TEST_EMAIL/PASSWORD for e2e/auth.setup.js. Optional: CI is
// expected to set these as real secrets instead of shipping a .env.local.
try { process.loadEnvFile(new URL('.env.local', import.meta.url)); } catch { /* no .env.local — fine in CI */ }

// ─── E2E / touch-gesture regression suite ──────────────────────────────────
// Exists specifically because manual real-device testing (BrowserStack Live,
// or a phone over USB) is the only way to catch SOME of this app's gesture
// bugs (native OS-level touch-action/scroll arbitration — see
// NoteEditorScreen.jsx's .ne-sheet-drag-active comment, reported twice:
// 2026-10-09 for the textarea, 2026-10-15 for .ne-body), but it doesn't
// scale as a regression net you run on every change. Playwright's touch
// emulation (hasTouch: true below) dispatches real, trusted TouchEvents via
// the browser engine's own Input domain — NOT synthetic events built in
// page-context JS, which the browser's native gesture recognition ignores
// entirely. That's what makes it capable of catching this exact class of
// bug at all, unlike the CDP-mouse-pretending-to-be-touch automation this
// project leaned on before (see e2e/fixtures/touch.js for the actual
// touchstart/touchmove/touchend sequencing, which goes one level lower
// still — straight CDP Input.dispatchTouchEvent — since Playwright's own
// high-level touchscreen API is tap-only, no long-press-then-drag).
//
// iOS/WebKit is NOT configured here: this machine is missing the system
// libraries WebKit needs to launch (`npx playwright install-deps webkit`
// needs sudo, unavailable in this sandbox) — only Chromium/Android
// coverage runs until that's installed on a machine that can grant it.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // the gesture tests mutate real rows in a real shared song — serialize to avoid two tests racing the same line indices
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Starts the real Vite dev server for the suite — reuses one already
  // running locally (this project's dev workflow almost always has one up)
  // rather than fighting over the port.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'], // real touch device profile — hasTouch: true, mobile viewport/UA
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
