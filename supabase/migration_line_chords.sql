-- ─── line_chords ────────────────────────────────────────────────────────────────
-- Chords attached to a WORD RANGE inside a lyric line — "mainstream
-- tablature": the chord symbol sits above the exact word/syllable where the
-- strum change happens, the way Ultimate-Guitar-style sheets print it.
-- Additive only — safe to re-run, nothing here touches existing data.
--
-- Anchored by (line_id, line_index), NOT by a per-physical-line row: `lines`
-- holds exactly ONE row per section (the whole block's text as one string
-- with embedded \n); an individual physical line only exists as the
-- client-side split (textLines.js / NoteEditorScreen). So line_id identifies
-- the block's text row and line_index the physical line inside it — the same
-- best-effort index tradeoff word_variants, line_history and line_audio
-- already accept. line_id rather than section_id because a chord is attached
-- to TEXT, and the text row is what a cascade should take it out with.
--
-- anchor_text is the source of truth for WHERE the chord sits — NOT
-- start_offset/end_offset. Raw offsets go stale the moment anything is typed
-- to the left of them, so they are only a best-effort tie-breaker: the client
-- re-locates anchor_text in the live line text on every render
-- (resolveChordRange, src/utils/chordAnchor.js), biased toward start_offset
-- when the same substring occurs more than once, and simply stops drawing a
-- chord whose anchor no longer appears at all. Exactly how word_variants
-- re-locates its own span (resolveVariantRange) — one anchoring model for
-- every sub-line attachment in the app, not a second, offset-trusting one.
--
-- chord_name is free text on purpose, never an enum/check: real chord names
-- have far too many shapes to enumerate — slash chords (G/B), extensions
-- (Cmaj7, Badd9), suspensions (Dsus4), alterations (F#m7b5).
create table if not exists line_chords (
  id           uuid primary key default gen_random_uuid(),
  line_id      uuid not null references lines(id) on delete cascade,
  line_index   integer not null default 0,
  anchor_text  text    not null,
  start_offset integer not null default 0,
  end_offset   integer not null default 0,
  chord_name   text    not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_line_chords_line on line_chords(line_id, line_index);

alter table line_chords enable row level security;

-- Same lines → sections → songs → is_song_participant() chain every other
-- line-scoped table already uses (see lines_owner).
drop policy if exists line_chords_owner on line_chords;
create policy line_chords_owner on line_chords
  for all using (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = line_chords.line_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = line_chords.line_id and is_song_participant(s.id)
    )
  );
