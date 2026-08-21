-- Adds 'OPEN_REFERENCE' to muse_entries.mode's allowed values — the 5th
-- Muse mode (shipped alongside the "new open reference mode" commit) that
-- the muse_entries_mode_check constraint never got updated for. Without
-- this, any turn where the muse picks OPEN_REFERENCE fails the insert with
-- "new row for relation muse_entries violates check constraint
-- muse_entries_mode_check" (23514) — same class of gap as
-- migration_muse_entries_mode.sql, which added `mode` itself but only
-- covered the original four modes.
--
-- Additive only, safe to re-run — just widens the existing check
-- constraint, no data touched.

alter table muse_entries drop constraint if exists muse_entries_mode_check;
alter table muse_entries add constraint muse_entries_mode_check
  check (mode in ('SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK', 'OPEN_REFERENCE'));
