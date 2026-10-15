-- ─── line_chords ────────────────────────────────────────────────────────────────
-- A stackable, reorderable, overridable sequence of chords per lyric line —
-- NOT anchored to any particular word (see src/utils/chordAnchor.js's own
-- header for the 2026-10-16 redesign that moved off word-anchoring; a fresh
-- install goes straight to this shape — an existing database that already
-- has line_chords in the old anchor_text/start_offset/end_offset shape needs
-- migration_line_chords_position.sql instead). Additive only — safe to
-- re-run, nothing here touches existing data.
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
-- `position` is a chord's only location: a plain 0-based rank among the
-- other chords on its own (line_id, line_index) — renumbered to a clean
-- 0..N-1 run by the client (NoteEditorScreen.jsx) on every insert, move or
-- delete, since a line rarely holds more than a handful of chords and
-- renumbering the lot is simpler to reason about than maintaining gapped
-- ranks for a sequence this short.
--
-- chord_name is free text on purpose, never an enum/check: real chord names
-- have far too many shapes to enumerate — slash chords (G/B), extensions
-- (Cmaj7, Badd9), suspensions (Dsus4), alterations (F#m7b5).
create table if not exists line_chords (
  id           uuid primary key default gen_random_uuid(),
  line_id      uuid not null references lines(id) on delete cascade,
  line_index   integer not null default 0,
  position     integer not null default 0,
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
