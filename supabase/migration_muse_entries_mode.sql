-- Adds muse_entries.mode — the actual mode (SURGEON/ARCHITECT/SOCRATIC/
-- WORD_BANK) for 'muse' rows, separate from the existing `action` column
-- (ask/clarify/suggest). The UI needs the specific mode both to label a
-- turn correctly and to know which shape `options` is in — SURGEON,
-- ARCHITECT, and WORD_BANK all collapse to the SAME `action` ('suggest'),
-- so `action` alone can't tell the chat UI whether to render a flat
-- suggestions list or a word-bank's {wordGroups}.
--
-- Additive only (no drop/recreate) — unlike migration_muse_profile_block_
-- level.sql, this one does NOT wipe existing muse_entries rows. Run this
-- instead of re-running that migration if you already have real
-- conversation history you don't want to lose. Existing rows will have
-- mode = null (their suggestion cards/word banks/chips won't render
-- retroactively), but every new turn going forward will.

alter table muse_entries add column if not exists mode text;
alter table muse_entries drop constraint if exists muse_entries_mode_check;
alter table muse_entries add constraint muse_entries_mode_check
  check (mode in ('SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK'));
