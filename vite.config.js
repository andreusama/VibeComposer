import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// server.py still runs locally just for its /api/claude → Anthropic proxy;
// Vite's dev server forwards that one path to it instead of duplicating
// the proxy logic here. In production, Vercel's rewrite in vercel.json
// routes /api/claude to api/claude.js instead — this proxy is dev-only.
export default defineConfig({
  plugins: [react()],
  // Playwright specs live in e2e/ and run with `npx playwright test`; Vitest
  // must not try to load them (they call Playwright's own test()).
  test: {
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
  server: {
    proxy: {
      '/api/claude': 'http://localhost:3000',
    },
  },
});
