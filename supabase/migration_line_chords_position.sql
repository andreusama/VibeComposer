-- ─── line_chords: word anchor → line-level position ───────────────────────
-- 2026-10-16: chords stopped being anchored to a specific word (anchor_text
-- / start_offset / end_offset) and became a plain stackable, reorderable,
-- overridable sequence per line — each chord's only location is now its
-- 0-based `position` among the other chords on its own line. See
-- chordAnchor.js's own header for the full reasoning (word-level hit-testing
-- turned out to be exactly as fragile as hitting a specific word with a
-- real finger always is).
--
-- Run this against a database that already has line_chords in its OLD
-- (anchor_text/start_offset/end_offset) shape — migration_line_chords.sql
-- and schema.sql now both describe the end state this migrates TO, not
-- what a fresh install goes through to get there.
--
-- Safe to re-run: the position column is added idempotently, the backfill
-- only touches rows that still have a default/zero position, and the
-- column drops are themselves idempotent (IF EXISTS).

alter table line_chords add column if not exists position integer not null default 0;

-- Best-effort backfill for any row that predates this column: order each
-- line's existing chords the same way they always rendered (anchor
-- start_offset, falling back to insertion order), and give them a clean
-- 0..N-1 run. Dynamic SQL because `start_offset` may already be gone on a
-- second run of this file (the DROP COLUMN below removes it) — a plain
-- query referencing it would fail to even PARSE at that point, not just
-- find nothing to do, so this only builds and runs the backfill query when
-- the column is actually still there.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'line_chords' and column_name = 'start_offset'
  ) then
    execute $sql$
      with ranked as (
        select id, row_number() over (
          partition by line_id, line_index
          order by start_offset, created_at
        ) - 1 as rn
        from line_chords
      )
      update line_chords set position = ranked.rn
      from ranked
      where line_chords.id = ranked.id and line_chords.position = 0
    $sql$;
  end if;
end $$;

alter table line_chords drop column if exists anchor_text;
alter table line_chords drop column if exists start_offset;
alter table line_chords drop column if exists end_offset;
