---
name: qa-infinite-loading
description: Audit and live-test VibeComposer for states that can hang forever with no way out — a loading spinner that never resolves, a screen stuck behind a gate that never opens, a button that silently stops responding after a tap. Use this whenever asked to check for infinite loading, stuck spinners, "the app froze", blockers, or pages that never finish loading — and proactively after adding or touching ANY async data-loading code (a new screen's initial fetch, a new sheet's own load effect, a new direct fetch() call), since that's exactly the kind of change that silently reintroduces this bug class.
---

# QA: no state may be unrecoverably stuck

## The actual failure shape, not just "add a spinner"

Every screen already shows a spinner while it loads. The bug isn't the spinner — it's that nothing
guarantees the spinner ever goes away. A promise that never settles leaves whatever `.then()` or
`finally` was waiting on it simply… waiting, forever, with no error, no retry button, nothing. This
reads to a real person as "the app is broken", not "the network is slow" — there's no signal telling
them to wait longer or try again.

This happens from three independent causes, and all three have to be checked separately — fixing
one doesn't fix the others:

1. **No timeout on the underlying request.** `fetch()` has no built-in timeout. A stalled connection
   (cold launch waking wifi, DNS, a token refresh riding along) just hangs. Nothing about the code
   being "wrong" — the network genuinely never answers.
2. **No `.catch()` on a `.then()`-only chain.** Even once a request eventually errors, if nothing is
   listening for the rejection, whatever state update was supposed to flip a `loading` flag to
   `false` never runs.
3. **A `try/finally` that assumes the `await` inside it will settle.** `finally` only runs once the
   awaited promise resolves OR rejects. If the promise never does either (case 1), the `finally`
   never runs either — this one is easy to miss because the code *looks* protected and isn't.

A fix needs the request to be bounded (timeout) AND the bound's failure to actually reach the UI
state that's gating the screen (error handling). Half of that isn't a fix.

## Where this project already solved it — verify new code doesn't bypass it

- `src/utils/supabaseClient.js` routes **every** Supabase request (table queries, RPCs, auth, Storage)
  through a custom `fetch` that hard-aborts after `DEFAULT_LOAD_TIMEOUT_MS` (12s; 60s for Storage
  uploads/downloads, which legitimately take longer). This is the single point of protection for the
  whole Supabase surface — confirmed that `postgrest-js`/`storage-js`/`auth-js` all catch a fetch
  failure internally and resolve as a normal `{data, error}` result rather than letting it reject
  uncaught, so an ordinary `.then(({error}) => ...)` call site is covered automatically, with no
  `.catch()` of its own needed.
- `src/utils/withTimeout.js` is an older, call-site-level version of the same idea (still used by
  `canvasData.js`/`collaborationData.js`/`projectsData.js`) — redundant with the client-level fix now,
  harmless, not worth removing.
- `src/utils/api.js`'s `fetchClaude` is the equivalent for direct Claude API calls (`composeProgression`,
  `callClaudeOnce`, `museApi.js`'s `callClaude`) — a 60s timeout, since a real completion can take a
  while. **Any new direct Claude call must go through this, not a bare `fetch(API_URL, …)`** — a bare
  fetch here is invisible to the Supabase-side fix entirely, it's a different dependency.
- `src/state/store.js`'s `getSession().then(...).catch(...)` is the single most critical case in the
  app: `main.js` renders ONLY the loading screen until `state.sessionChecked` is true, and that flag
  is set from exactly this one call. Its `.catch()` guarantees `sessionChecked` becomes `true` no
  matter what fails inside — the whole app is unreachable until this resolves, so it gets an
  unconditional guarantee rather than trusting the SDK's own internals end-to-end.

**A real regression hit while building the client-level fix, worth knowing before you "improve"
error messages near a timeout:** `postgrest-js` specifically checks `fetchError?.name === 'AbortError'`
to decide whether to retry a request. Passing a custom-reasoned abort (`controller.abort(new Error(...))`)
changes the error's `.name` to `'Error'`, which silently defeats that check — the request gets retried
up to `DEFAULT_MAX_RETRIES` times, each attempt re-stalling for the full timeout again, so what should
resolve in 12s instead takes 20s+. If you ever touch `timedFetch`, keep `err.name = 'AbortError'`
explicit alongside any custom message.

## Audit checklist

Grep for the shape, don't just read the files you already suspect:

- `setLoading(true)` / `setLoaded(false)` / any boolean state that gates a spinner or a blocking
  screen — for each one, find where it flips back, and confirm that path is reachable on BOTH
  success and failure, not just success.
- `.then(` without a `.catch(` anywhere in the same chain, AND without going through a Supabase
  client call (which is covered) — a bare `fetch(` elsewhere in the codebase is the thing to be
  suspicious of; check `src/utils/api.js`, `src/utils/museApi.js`, and run
  `grep -rn "await fetch(" src/` to catch any new direct call that didn't route through `fetchClaude`.
- `try { await X } finally { setLoading(false) }` with no `catch` — looks protected, isn't, unless
  `X` itself is guaranteed to always settle (confirm that, don't assume it).
- Any brand-new screen/sheet's own first-load `useEffect` — does it mirror the `{data, error}` shape
  the rest of the app uses, or does it half-trust a promise to "just work"?

## Live-testing methodology

Code review alone won't catch everything — the actual proof is forcing a request to hang and
watching what the UI does. This project's established pattern (Playwright, mobile emulation):

```js
import { chromium, devices } from '@playwright/test';
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['Pixel 7'], storageState: 'e2e/.auth/user.json' });
const page = await context.newPage();

// Intercept the specific request and never resolve it — not an error response,
// not a slow one, just nothing. This is the actual "stalled connection" failure
// mode a timeout is meant to survive; a mocked error response doesn't test it.
await page.route('**/rest/v1/<table>*', () => { /* never fulfill/continue/abort */ });

await page.goto('http://localhost:5173');
// … navigate to the screen under test …

// Poll once a second rather than waiting a single fixed timeout — this gives
// you the ACTUAL resolution time, which should land at/near the app's own
// configured timeout (12s for a table query, 60s for Storage/Claude), not
// "eventually" and not "never".
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  const stuck = await page.locator('.mp-spinner, .mp-loading').count();
  console.log(`t=${i + 1}s: still spinning = ${stuck > 0}`);
  if (!stuck) break;
}
```

Write this as a short throwaway script at the project root (`_pw_<name>.mjs`, matching this
project's existing convention — see `e2e/` for the committed suite vs. these one-off repros),
run it with `timeout 30 node ./_pw_<name>.mjs`, delete it once you're done. Don't commit it.

Things to confirm from the run, not just assume:
- The spinner actually resolves, at a time close to the real configured timeout (if it takes
  dramatically longer, suspect a retry loop eating the budget — see the `AbortError.name` trap above).
- Whatever replaces the spinner is a real state a person can act on (an error message + retry button,
  not a blank screen) — a `.catch()` that fires but renders nothing is barely better than never firing.
- The rest of the app (bottom tab bar, navigation) stays usable while this one screen is stuck/
  recovering — a stuck loading state on ONE screen should never block navigating away from it.

## Reporting

For each stuck-state risk found, report: the file/line, what guarantees it (or doesn't) a
resolution, and — if you fixed it — the before/after live-test timing proving the fix actually
closes the gap, not just that the code "looks" more defensive now.
