-- Voice memos move from being anchored to a single physical verse line to
-- belonging to the whole note (section). See src/mobile/NoteAudioBar.jsx —
-- one always-visible "🎙 Àudios" bar per note editor, replacing the invisible
-- long-press-on-the-gutter gesture and the per-line badges.
--
-- Additive + one nullability relax — safe to re-run. Existing rows keep their
-- line_index as historical data (the app stops reading it); they just show up
-- in their section's audio list, ordered by created_at.

alter table line_audio add column if not exists title text;          -- null → shown as "Àudio N"
alter table line_audio alter column line_index drop not null;         -- the app no longer sets it

-- The old index was on (section_id, line_index); the list is now just
-- "everything for this section, oldest first".
drop index if exists idx_line_audio_section;
create index if not exists idx_line_audio_section on line_audio(section_id, created_at);
