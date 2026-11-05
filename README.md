# VibeComposer

A songwriting app built around **La Musa**, an AI co-writer that helps you write, rhyme and refine lyrics — and a chord layer you place by hand, right on the words.

It is mobile-first: a touch-first editor for writing on the go, with a free-form canvas version for larger screens. On a desktop browser the mobile app is shown inside a phone-sized frame.

**Try it:** <https://vibecomposer-demo.vercel.app> — tap *try the demo*, no sign-up. You get a sample song to play with and a handful of Muse calls a day.

## What it does

- **La Musa** — a Claude-powered co-writer that works on the line you select. It can fix a specific technical problem (meter, rhyme, a repeated word), continue an unfinished verse, ask you a pointed question instead of answering, or pull from a real rhyming dictionary. Its suggestions are checked against syllable counts and rhyme before you see them.
- **Rhyme and syllable engine** — Spanish and Catalan, with dialect-aware syllable counting and consonant/assonant rhyme lookup.
- **Chords on the words** — long-press a chord and drag it onto a line; drag a placed chord to move it. Chords stack, reorder and override each other.
- **Voice memos** — record a melody or idea against a part of the song.
- **El Baúl** — a chest for raw inspiration (notes, photos, PDFs) that the Muse distils into a description of your voice and vocabulary, and writes with afterwards.
- **Recursos** — your own library of references, with import from text or a photographed page.
- **Collaboration** — share a song through an invite link; up to four people edit it together, live.
- **Chord progressions and a studio** — generate a progression from a feeling, then arrange it in a step sequencer with a drum machine and a from-scratch Hammond organ.

Lyrics can be written in Spanish or Catalan. The interface is mostly Spanish, with some English.

## Stack

| | |
|---|---|
| Front end | Vite, React 18, `@xyflow/react` (canvas) |
| Back end | Supabase — Postgres with row-level security, Auth, Storage, Realtime |
| AI | Claude, through a small serverless proxy (`api/claude.js`) so the key never reaches the browser |
| Mobile | Capacitor (Android; iOS not added yet) |
| Tests | Vitest (unit) and Playwright (real touch gestures over CDP) |
| Hosting | Vercel |

There is no custom server beyond that proxy; all access control is in the database's row-level security policies.

## Running it locally

You need Node 22+ and Python 3 (for the local Claude proxy).

```bash
npm install

# 1. Claude proxy — create a git-ignored .env next to server.py containing
#    ANTHROPIC_API_KEY=sk-ant-...
python3 server.py            # serves /api/claude on :3000

# 2. App
npm run dev                  # http://localhost:5173
```

Vite forwards `/api/claude` to the Python proxy in development; on Vercel the same path is served by `api/claude.js`.

Open <http://localhost:5173>. On a wide window you get the phone frame; add `?desktop=1` to the URL for the original desktop canvas.

### Your own Supabase project

The app talks to a Supabase project whose URL and public (anon) key are in `src/config.js`. To point it at your own:

1. Create a project and run `supabase/schema.sql` in the SQL editor.
2. Run the `supabase/migration_*.sql` files you need, in any order that respects their comments — they are additive and safe to re-run.
3. Put your project's URL and anon key in `src/config.js`.

The anon key is public by design; row-level security is what protects the data.

## Tests

```bash
npm test                     # unit tests (Vitest)
npx playwright test          # end-to-end, touch gestures included
```

The Playwright suite signs in with a throwaway account. Put its credentials in a git-ignored `.env.local`:

```
PLAYWRIGHT_TEST_EMAIL=...
PLAYWRIGHT_TEST_PASSWORD=...
```

It drives the real app on a Pixel 7 profile, using real touch events rather than synthetic ones, and covers the long-press-and-drag gestures, the guest demo and the desktop phone frame.

## The public demo

*Try the demo* signs a visitor in as an anonymous Supabase user and gives them a sample song. The limits live in the database, not the browser (`supabase/migration_guest_demo.sql`):

- about 10 Muse calls per guest per day, plus one daily cap shared by everyone, so a burst of visitors can't run up the bill;
- no uploads — voice memos, photos and file imports are disabled and refused by Storage;
- a small cap on how many songs a guest can create;
- guest accounts are deleted automatically after a day.

To use it you need *anonymous sign-ins* enabled in Supabase (Authentication → Sign In / Providers) and `pg_cron` enabled for the cleanup job.

The public link is a **separate Vercel project** built from this same repo with `VITE_DEMO_ONLY=true`, which reduces the sign-in screen to just the demo button. Without that variable the app is the normal one, with Google and email sign-in.

## Deploying

The repo deploys to Vercel as it is (`vercel.json`). Set `ANTHROPIC_API_KEY` in the project's environment variables. For the demo-only deployment, create a second Vercel project from the same repo and also set `VITE_DEMO_ONLY=true`.

The proxy requires a signed-in Supabase session, only forwards the models and fields the app uses, caps the output size, and enforces the daily quotas in Postgres — set a monthly spend limit on your Anthropic key as well.

## More documentation

- [`context.md`](context.md) — how the project is put together: screens, data model, how La Musa works, known rough edges.
- [`ROADMAP.md`](ROADMAP.md) — the native-app plan and what is still open.
- [`supabase/`](supabase) — the schema and every migration, each with a comment on why it exists.

## License

MIT — see [`LICENSE`](LICENSE).
