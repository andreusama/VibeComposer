-- Run this in the Supabase SQL editor. Adds source_page/source_line to
-- resources: where in the original material a saved snippet physically
-- lives, so the artist can go straight back to the book/notebook page it
-- came from instead of re-searching for it. Deliberately separate from
-- `origin` (which stays free text for "which book/person/film" — see
-- migration_resources.sql): these two are narrow, structured, and always
-- about physical location, not provenance in general, so a resource card
-- can show "p. 42, l. 6" as its own small badge rather than parsing it out
-- of a free-text sentence.
--
-- Both are TEXT, not integer: real pagination isn't always a plain number
-- (roman numerals in a preface, "42-43" spanning a page break, "42 bis"),
-- and a "line" is a rough visual position on a photographed page, not a
-- database row number — forcing either into an integer would reject real,
-- correct values. Both stay null unless the import flow (or the artist by
-- hand, in ResourceEditorSheet) actually supplies one — never invented.
-- Safe to re-run.

alter table resources add column if not exists source_page text;
alter table resources add column if not exists source_line text;
