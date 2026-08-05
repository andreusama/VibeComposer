-- ─────────────────────────────────────────────────────────────────────────────
-- VibeComposer — Lyrics Editor schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── updated_at helper ─────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─── songs ──────────────────────────────────────────────────────────────────────
create table if not exists songs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  title               text not null default 'untitled',
  -- Optional snapshot of a composed chord progression from the main composer flow
  -- (progressions aren't persisted anywhere else — this is the only copy if linked).
  linked_progression  jsonb,
  -- Reserved for later iterations (song-structure templates, main hook marker).
  structure_template  jsonb,
  hook_line_id        uuid, -- FK added below, after `lines` exists
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_songs_updated_at on songs;
create trigger trg_songs_updated_at
  before update on songs
  for each row execute function set_updated_at();

-- ─── sections (estrofas) ────────────────────────────────────────────────────────
create table if not exists sections (
  id           uuid primary key default gen_random_uuid(),
  song_id      uuid not null references songs(id) on delete cascade,
  type         text not null default 'verse'
               check (type in ('verse','chorus','pre-chorus','bridge','outro','custom')),
  custom_label text,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_sections_updated_at on sections;
create trigger trg_sections_updated_at
  before update on sections
  for each row execute function set_updated_at();

create index if not exists idx_sections_song on sections(song_id, position);

-- ─── lines ──────────────────────────────────────────────────────────────────────
create table if not exists lines (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references sections(id) on delete cascade,
  position    integer not null default 0,
  text        text not null default '',
  status      text not null default 'provisional'
              check (status in ('unresolved','provisional','closed')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_lines_updated_at on lines;
create trigger trg_lines_updated_at
  before update on lines
  for each row execute function set_updated_at();

create index if not exists idx_lines_section on lines(section_id, position);

-- Now that `lines` exists, wire up the deferred FK on songs.hook_line_id.
alter table songs
  drop constraint if exists songs_hook_line_id_fkey;
alter table songs
  add constraint songs_hook_line_id_fkey
  foreign key (hook_line_id) references lines(id) on delete set null;

-- ─── line_variants ──────────────────────────────────────────────────────────────
-- Alternate wordings for a line. The "current" text always lives on `lines.text`;
-- a variant becomes current by swapping text (app-level), not by an is_active flag.
create table if not exists line_variants (
  id         uuid primary key default gen_random_uuid(),
  line_id    uuid not null references lines(id) on delete cascade,
  text       text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_variants_line on line_variants(line_id, position);

-- ─── annotations ────────────────────────────────────────────────────────────────
-- Anchored either to a whole line (start/end null) or to a text selection
-- within that line's current text (character offsets, like Google Docs comments).
create table if not exists annotations (
  id            uuid primary key default gen_random_uuid(),
  line_id       uuid not null references lines(id) on delete cascade,
  author_id     uuid not null references auth.users(id) on delete cascade,
  start_offset  integer,
  end_offset    integer,
  body          text not null,
  resolved      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_annotations_updated_at on annotations;
create trigger trg_annotations_updated_at
  before update on annotations
  for each row execute function set_updated_at();

create index if not exists idx_annotations_line on annotations(line_id);

-- ─── section_versions (historial) ───────────────────────────────────────────────
-- Snapshot of an entire section's lines, captured just before a line inside it
-- gets overwritten. Comparing two versions of the same section = diffing two rows.
create table if not exists section_versions (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references sections(id) on delete cascade,
  -- snapshot shape: [{ "line_id": uuid, "position": int, "text": string }, ...]
  snapshot    jsonb not null,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_section_versions_section on section_versions(section_id, created_at desc);

-- ─── ideas_notebook ─────────────────────────────────────────────────────────────
-- Loose ideas/phrases/references for a song, not anchored to any line.
create table if not exists ideas_notebook (
  id         uuid primary key default gen_random_uuid(),
  song_id    uuid not null references songs(id) on delete cascade,
  body       text not null,
  tags       text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ideas_updated_at on ideas_notebook;
create trigger trg_ideas_updated_at
  before update on ideas_notebook
  for each row execute function set_updated_at();

create index if not exists idx_ideas_song on ideas_notebook(song_id);

-- ─── Row Level Security ─────────────────────────────────────────────────────────
-- Every table is scoped to the owning user via `songs.user_id = auth.uid()`,
-- reached directly or through a join up to `songs`.

alter table songs           enable row level security;
alter table sections         enable row level security;
alter table lines            enable row level security;
alter table line_variants    enable row level security;
alter table annotations      enable row level security;
alter table section_versions enable row level security;
alter table ideas_notebook   enable row level security;

drop policy if exists songs_owner on songs;
create policy songs_owner on songs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists sections_owner on sections;
create policy sections_owner on sections
  for all using (
    exists (select 1 from songs s where s.id = sections.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = sections.song_id and s.user_id = auth.uid())
  );

drop policy if exists lines_owner on lines;
create policy lines_owner on lines
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = lines.section_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = lines.section_id and s.user_id = auth.uid()
    )
  );

drop policy if exists variants_owner on line_variants;
create policy variants_owner on line_variants
  for all using (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = line_variants.line_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = line_variants.line_id and s.user_id = auth.uid()
    )
  );

drop policy if exists annotations_owner on annotations;
create policy annotations_owner on annotations
  for all using (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = annotations.line_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = annotations.line_id and s.user_id = auth.uid()
    )
  );

drop policy if exists section_versions_owner on section_versions;
create policy section_versions_owner on section_versions
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = section_versions.section_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = section_versions.section_id and s.user_id = auth.uid()
    )
  );

drop policy if exists ideas_owner on ideas_notebook;
create policy ideas_owner on ideas_notebook
  for all using (
    exists (select 1 from songs s where s.id = ideas_notebook.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = ideas_notebook.song_id and s.user_id = auth.uid())
  );

-- ─── vibe_snapshot ──────────────────────────────────────────────────────────────
-- Full round-trip of the composer's result screen for a project: not just the
-- chord progression (linked_progression was a one-off copy), but everything
-- needed to redisplay it later — phrase, place, rgb, energy, flavour, texture,
-- easyMode, vibeLabel, photoUrl, progression. Written every time "compose" runs
-- inside a project; read back when a project's chords part is reopened.
alter table songs add column if not exists vibe_snapshot jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- Canvas mode — Figma-style infinite canvas, notes as nodes.
-- A "note" IS a `sections` row (same lines/variants/annotations underneath),
-- just placed on a canvas instead of stacked in a list.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── chord_progressions ─────────────────────────────────────────────────────────
-- Independent node type. A project can hold several at once (try a few before
-- deciding); each can be assigned as "definitive" to one text note.
create table if not exists chord_progressions (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references songs(id) on delete cascade,
  title         text not null default 'untitled progression',
  canvas_x      double precision not null default 0,
  canvas_y      double precision not null default 0,
  canvas_width  double precision not null default 260,
  canvas_height double precision,
  key           text,
  -- same shape as the composer's output: [{chord, function, feel, ukulele}, ...]
  progression   jsonb not null default '[]'::jsonb,
  -- 'manual' = built by hand in this pass; 'vibe' reserved for the step-by-step
  -- assisted generation flow (phrase → place → photo → settings), next iteration.
  source        text not null default 'manual' check (source in ('manual', 'vibe')),
  vibe_meta     jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_chord_progressions_updated_at on chord_progressions;
create trigger trg_chord_progressions_updated_at
  before update on chord_progressions
  for each row execute function set_updated_at();

create index if not exists idx_chord_progressions_song on chord_progressions(song_id);

-- ─── sections: canvas placement + assigned progression ─────────────────────────
alter table sections add column if not exists canvas_x double precision not null default 0;
alter table sections add column if not exists canvas_y double precision not null default 0;
alter table sections add column if not exists canvas_width double precision not null default 280;
alter table sections add column if not exists canvas_height double precision;

alter table sections drop constraint if exists sections_chord_progression_id_fkey;
alter table sections add column if not exists chord_progression_id uuid;
alter table sections
  add constraint sections_chord_progression_id_fkey
  foreign key (chord_progression_id) references chord_progressions(id) on delete set null;

-- ─── note_links ─────────────────────────────────────────────────────────────────
-- Generic, extensible connection between two notes. Only 'main-thread' exists
-- today (marks which notes make up the clean-view lyric, and their order) —
-- widen the check constraint to add new types later without touching existing rows.
create table if not exists note_links (
  id              uuid primary key default gen_random_uuid(),
  song_id         uuid not null references songs(id) on delete cascade,
  source_note_id  uuid not null references sections(id) on delete cascade,
  target_note_id  uuid not null references sections(id) on delete cascade,
  type            text not null default 'main-thread' check (type in ('main-thread')),
  position        integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_note_links_song on note_links(song_id, type, position);

-- ─── RLS for the new tables ─────────────────────────────────────────────────────
alter table chord_progressions enable row level security;
alter table note_links         enable row level security;

drop policy if exists chord_progressions_owner on chord_progressions;
create policy chord_progressions_owner on chord_progressions
  for all using (
    exists (select 1 from songs s where s.id = chord_progressions.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = chord_progressions.song_id and s.user_id = auth.uid())
  );

drop policy if exists note_links_owner on note_links;
create policy note_links_owner on note_links
  for all using (
    exists (select 1 from songs s where s.id = note_links.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = note_links.song_id and s.user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 — lyric composing side panel.
-- Variants (line_variants) and history (section_versions) already exist and
-- are reused as-is. Only new thing needed: optional categorization on apuntes.
-- ─────────────────────────────────────────────────────────────────────────────
alter table annotations add column if not exists category text;
alter table annotations drop constraint if exists annotations_category_check;
alter table annotations
  add constraint annotations_category_check
  check (category is null or category in ('duda', 'idea', 'referencia'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Output node — a song can have several (variants/mixes of the same song:
-- "radio edit", "acoustic", etc.), each user-created and user-deletable.
-- Doesn't own any content itself: it's a sink that a text note plugs into,
-- at which point it renders the full main-thread chain (lyrics in
-- clean-view order, plus each note's assigned chords) as that mix's result.
-- plugged_note_id is only "is something connected" state — the rendered
-- chain is always derived live from note_links, not stored here.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists song_outputs (
  id              uuid primary key default gen_random_uuid(),
  song_id         uuid not null references songs(id) on delete cascade,
  title           text not null default 'Final mix',
  canvas_x        double precision not null default 0,
  canvas_y        double precision not null default 0,
  canvas_width    double precision not null default 320,
  canvas_height   double precision not null default 240,
  plugged_note_id uuid references sections(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Was "one output per song" (song_id unique) — now a song can hold several
-- mix variants, so an existing database needs the old uniqueness dropped.
alter table song_outputs drop constraint if exists song_outputs_song_id_key;
alter table song_outputs add column if not exists title text not null default 'Final mix';

drop trigger if exists trg_song_outputs_updated_at on song_outputs;
create trigger trg_song_outputs_updated_at
  before update on song_outputs
  for each row execute function set_updated_at();

alter table song_outputs enable row level security;

drop policy if exists song_outputs_owner on song_outputs;
create policy song_outputs_owner on song_outputs
  for all using (
    exists (select 1 from songs s where s.id = song_outputs.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = song_outputs.song_id and s.user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Output selections — a final mix is one linear playthrough, so when the note
-- graph forks (a note has more than one outgoing main-thread link), each mix
-- needs its own record of which branch it takes at that fork. One row per
-- (mix, forking note); no row means "use the default" (lowest-position link,
-- i.e. whichever branch was drawn first) — a fork is never left ambiguous.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists output_selections (
  output_id      uuid not null references song_outputs(id) on delete cascade,
  source_note_id uuid not null references sections(id) on delete cascade,
  note_link_id   uuid not null references note_links(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (output_id, source_note_id)
);

alter table output_selections enable row level security;

drop policy if exists output_selections_owner on output_selections;
create policy output_selections_owner on output_selections
  for all using (
    exists (
      select 1 from song_outputs so
      join songs s on s.id = so.song_id
      where so.id = output_selections.output_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from song_outputs so
      join songs s on s.id = so.song_id
      where so.id = output_selections.output_id and s.user_id = auth.uid()
    )
  );
