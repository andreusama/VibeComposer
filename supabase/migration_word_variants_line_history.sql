-- Two sub-line features that share the same anchoring model, added together.
-- Additive only — safe to re-run, nothing here touches existing data.
--
-- Both anchor via (section_id, line_index), NOT a `lines` row — `lines` holds
-- exactly one row per section (the whole block's text as one string); an
-- individual physical line only exists as the client-side split
-- (textLines.js / NoteEditorScreen), so there is no stable per-line row to
-- reference. Same tradeoff line_audio and annotations already accept: the
-- index drifts if lines are inserted/removed above it, and the app does a
-- best-effort fix-up in its Enter/Backspace handlers.

-- ─── word_variants ──────────────────────────────────────────────────────────────
-- Alternate wordings for a SPAN of words inside one physical line (Genius-style
-- "try it another way"). The line's text always holds exactly options[active_index];
-- the other options are the alternatives you can swap in. The span is re-located
-- on load by searching for options[active_index] in the line, biased by
-- anchor_before (the text that sat to its left when it was created).
create table if not exists word_variants (
  id            uuid primary key default gen_random_uuid(),
  section_id    uuid not null references sections(id) on delete cascade,
  line_index    integer not null,
  options       jsonb   not null,            -- ordered wordings, e.g. ["la lluna","el cel clar"]
  active_index  integer not null default 0,  -- which option currently sits in the line
  anchor_before text    not null default '', -- text left of the span at creation (best-effort re-locate)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_word_variants_section on word_variants(section_id, line_index);

drop trigger if exists trg_word_variants_updated_at on word_variants;
create trigger trg_word_variants_updated_at
  before update on word_variants
  for each row execute function set_updated_at();

alter table word_variants enable row level security;

drop policy if exists word_variants_owner on word_variants;
create policy word_variants_owner on word_variants
  for all using (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = word_variants.section_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = word_variants.section_id and s.user_id = auth.uid())
  );

-- ─── line_history ───────────────────────────────────────────────────────────────
-- Per-physical-line version log — every time a line's text changes in a
-- meaningful way (blur, Enter-split, Backspace-merge, muse replace, word-variant
-- swap), the PREVIOUS wording is appended here. Finer-grained than
-- section_versions (which snapshots the whole block); the two coexist.
create table if not exists line_history (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  line_index integer not null,
  text       text    not null,            -- the previous wording of that physical line
  created_at timestamptz not null default now()
);

create index if not exists idx_line_history_section on line_history(section_id, line_index, created_at desc);

alter table line_history enable row level security;

drop policy if exists line_history_owner on line_history;
create policy line_history_owner on line_history
  for all using (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_history.section_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_history.section_id and s.user_id = auth.uid())
  );
