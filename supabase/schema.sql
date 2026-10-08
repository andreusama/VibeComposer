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

-- ─── word_variants ──────────────────────────────────────────────────────────────
-- Alternate wordings for a SPAN of words inside one physical line. The line's
-- text always holds exactly options[active_index]; the span is re-located on
-- load by searching for that string, biased by anchor_before. Anchored via
-- (section_id, line_index) — see migration_word_variants_line_history.sql.
create table if not exists word_variants (
  id            uuid primary key default gen_random_uuid(),
  section_id    uuid not null references sections(id) on delete cascade,
  line_index    integer not null,
  options       jsonb   not null,
  active_index  integer not null default 0,
  anchor_before text    not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_word_variants_section on word_variants(section_id, line_index);

drop trigger if exists trg_word_variants_updated_at on word_variants;
create trigger trg_word_variants_updated_at
  before update on word_variants
  for each row execute function set_updated_at();

-- ─── line_history ───────────────────────────────────────────────────────────────
-- Per-physical-line version log: the previous wording is appended on every
-- meaningful line change. Finer-grained than section_versions; both coexist.
create table if not exists line_history (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  line_index integer not null,
  text       text    not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_line_history_section on line_history(section_id, line_index, created_at desc);

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
alter table word_variants    enable row level security;
alter table line_history     enable row level security;
alter table ideas_notebook   enable row level security;

drop policy if exists songs_owner on songs;
create policy songs_owner on songs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── albums ─────────────────────────────────────────────────────────────────────
-- Groups songs as tracks. A song with album_id = null IS a single (no wrapper
-- row). No DNA column here on purpose: an album's coherence is derived live
-- from its tracks' songs.lyric_dna. Deleting an album keeps its songs (they
-- become singles). Same statements as migration_albums.sql.
create table if not exists albums (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Sin título',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_albums_updated_at on albums;
create trigger trg_albums_updated_at
  before update on albums
  for each row execute function set_updated_at();

create index if not exists idx_albums_user on albums(user_id);

alter table albums enable row level security;

drop policy if exists albums_owner on albums;
create policy albums_owner on albums
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table songs add column if not exists album_id       uuid references albums(id) on delete set null;
alter table songs add column if not exists track_position integer not null default 0;

create index if not exists idx_songs_album on songs(album_id, track_position);

-- Manual ordering of the projects list (singles and albums share one order).
-- Everything starts at 0, so until something is dragged the list keeps its
-- old most-recently-edited-first behaviour (ties fall back to updated_at).
-- New projects get (lowest existing value - 1) so they land on top.
-- Tracks inside an album are ordered by track_position instead.
alter table songs  add column if not exists sort_order integer not null default 0;
alter table albums add column if not exists sort_order integer not null default 0;

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

drop policy if exists word_variants_owner on word_variants;
create policy word_variants_owner on word_variants
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = word_variants.section_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = word_variants.section_id and s.user_id = auth.uid()
    )
  );

drop policy if exists line_history_owner on line_history;
create policy line_history_owner on line_history
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = line_history.section_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = line_history.section_id and s.user_id = auth.uid()
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

-- Mobile-only song-thread ordering/grouping — see migration_mobile_thread_index.sql
-- for the full rationale. Desktop never reads or writes this column.
alter table sections add column if not exists thread_index integer;
create index if not exists idx_sections_thread_index on sections(song_id, thread_index);

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Tempo node — a bpm a chord progression can plug into for real, beat-
-- accurate playback pacing (see playProgression in src/audio/player.js).
-- Started out session-only, like the vibe-compose tool; unlike that tool it
-- carries actual song data (a real bpm, and which progression it feeds),
-- so it needs the same canvas_x/y/width/height + DB row every other node has.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists tempo_nodes (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references songs(id) on delete cascade,
  bpm           integer not null default 120,
  canvas_x      double precision not null default 0,
  canvas_y      double precision not null default 0,
  canvas_width  double precision not null default 160,
  canvas_height double precision not null default 120,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_tempo_nodes_updated_at on tempo_nodes;
create trigger trg_tempo_nodes_updated_at
  before update on tempo_nodes
  for each row execute function set_updated_at();

create index if not exists idx_tempo_nodes_song on tempo_nodes(song_id);

alter table tempo_nodes enable row level security;

drop policy if exists tempo_nodes_owner on tempo_nodes;
create policy tempo_nodes_owner on tempo_nodes
  for all using (
    exists (select 1 from songs s where s.id = tempo_nodes.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = tempo_nodes.song_id and s.user_id = auth.uid())
  );

-- Which tempo node a chord progression is plugged into, if any — same
-- optional-assignment shape as sections.chord_progression_id above.
alter table chord_progressions drop constraint if exists chord_progressions_tempo_node_id_fkey;
alter table chord_progressions add column if not exists tempo_node_id uuid;
alter table chord_progressions
  add constraint chord_progressions_tempo_node_id_fkey
  foreign key (tempo_node_id) references tempo_nodes(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rhyme scheme — which language/dialect the rhyme module reads a song's
-- lines as (see src/utils/rhyme.js). A song-level setting, not a session
-- toggle, so the rhyme reading stays the same for whoever opens it next.
-- Castilian only has one variant for now; Catalan splits oriental/occidental
-- because that's the actual phonetic fork that changes which lines rhyme.
-- ─────────────────────────────────────────────────────────────────────────────
alter table songs add column if not exists lyric_language text not null default 'es';
alter table songs add column if not exists lyric_dialect text not null default 'central';

alter table songs drop constraint if exists songs_lyric_language_dialect_check;
alter table songs
  add constraint songs_lyric_language_dialect_check
  check (
    (lyric_language = 'es' and lyric_dialect = 'central') or
    (lyric_language = 'ca' and lyric_dialect in ('oriental', 'occidental'))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Muse — a writing companion, not a spectator: the user asks it for help
-- continuing, complementing or rhyming a line, and it either asks back for
-- context it genuinely needs (never idle curiosity) or gives 2-4 concrete
-- options. Learns a per-project profile, segmented by emotional register
-- (love/friendship/family/place/other), so it calibrates *what it suggests*
-- the same way someone who knows the user's taste would.
-- ─────────────────────────────────────────────────────────────────────────────

-- Superseded before either ever shipped with real user data — safe to drop
-- unconditionally rather than migrate column-by-column, since the old
-- question/answer shape doesn't semantically map onto a conversation turn.
alter table songs drop column if exists muse_profile;
drop table if exists muse_entries;

-- One row per turn in an ongoing conversation about one BLOCK (a note —
-- see "A 'note' IS a sections row" below; typically one verse/chorus/etc,
-- 1-8 lines) — not a question/answer pair, since the muse asking back for
-- context (and the user replying) can chain across several turns before
-- landing on actual options. Append-only, grows without limit, NEVER sent
-- to the muse API in full — muse_profile below is the only thing that is.
-- Keyed by section_id, not line_id: a block can hold several physical
-- lines, and the conversation is about the block as a whole, not any one
-- of them — line_id was only ever a fragile stand-in for "this note" (its
-- identity broke if the first line got deleted/reordered).
create table muse_entries (
  id                   uuid primary key default gen_random_uuid(),
  song_id              uuid not null references songs(id) on delete cascade,
  section_id           uuid not null references sections(id) on delete cascade,
  role                 text not null check (role in ('user', 'muse')),
  -- 'ask' = the user's request; 'clarify' = the muse asking back for
  -- context; 'suggest' = the muse offering concrete options. Null only
  -- transiently doesn't happen — every row gets one of these on insert.
  action               text not null check (action in ('ask', 'clarify', 'suggest')),
  -- The muse's actual mode (SURGEON/ARCHITECT/SOCRATIC/WORD_BANK) for
  -- 'muse' rows, null for 'user' rows. Separate from `action` on purpose:
  -- `action` is the coarse ask/clarify/suggest bucket, but the UI needs
  -- the specific mode both to label the turn correctly and to know which
  -- shape `options` is in (a flat suggestions array for SURGEON/ARCHITECT
  -- vs a {wordGroups} object for WORD_BANK) — SOCRATIC and WORD_BANK both
  -- collapse to very different `action` values ('clarify' vs 'suggest'),
  -- and SURGEON/ARCHITECT collapse to the SAME `action` ('suggest') as
  -- each other and as WORD_BANK, so `action` alone can't drive rendering.
  mode                 text check (mode in ('SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK', 'OPEN_REFERENCE')),
  content              text not null,
  -- Only populated on action='suggest' rows — the actual candidate
  -- lines/words, kept structured (not flattened into content) so each one
  -- can be saved as its own apunte independently.
  options              jsonb,
  saved_annotation_id  uuid references annotations(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index idx_muse_entries_section on muse_entries(section_id, created_at);

alter table muse_entries enable row level security;

drop policy if exists muse_entries_owner on muse_entries;
create policy muse_entries_owner on muse_entries
  for all using (
    exists (select 1 from songs s where s.id = muse_entries.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = muse_entries.song_id and s.user_id = auth.uid())
  );

-- Live LOCAL profile — what this one BLOCK is about, not the whole song
-- (different blocks can be about completely different things). One row
-- per section; summary is short and gets OVERWRITTEN on each refresh,
-- never appended to, so a prompt's cost never grows no matter how many
-- months of answers accumulate behind it.
--
-- Deliberately no GLOBAL/song-level counterpart: the muse already gets the
-- full raw song text every turn via describeSongStructure in
-- buildDynamicMuseContext (museApi.js) — real, uncompressed, always
-- current. An extra AI-summarized "song_summary" on top of that was pure
-- redundancy (an LLM's cached, lossy interpretation of text the model
-- already reads in full every call) and got removed. "Vibe" — is the
-- artist literal or metaphorical/abstract, what's the atmosphere — is left
-- entirely to lyric_dna (the Baúl) and the muse's own live reading of the
-- raw text, not a separate stored field.
create table if not exists muse_profile (
  section_id          uuid primary key references sections(id) on delete cascade,
  song_id             uuid not null references songs(id) on delete cascade,
  summary             text not null default '',
  interaction_count   int not null default 0,
  last_summarized_at  timestamptz,
  updated_at          timestamptz not null default now()
);

create index idx_muse_profile_song on muse_profile(song_id);

drop trigger if exists trg_muse_profile_updated_at on muse_profile;
create trigger trg_muse_profile_updated_at
  before update on muse_profile
  for each row execute function set_updated_at();

alter table muse_profile enable row level security;

drop policy if exists muse_profile_owner on muse_profile;
create policy muse_profile_owner on muse_profile
  for all using (
    exists (select 1 from songs s where s.id = muse_profile.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = muse_profile.song_id and s.user_id = auth.uid())
  );

-- Atomic increment-and-return, so two near-simultaneous answers on the same
-- block can never race each other into an inconsistent count the way a
-- client-side read-then-write would. security definer + an explicit
-- ownership check (RLS doesn't apply inside a definer function on its own)
-- + a pinned search_path (blocks search_path-hijacking of unqualified
-- names) is the standard safe shape for this kind of function.
create or replace function muse_increment_interaction(p_section_id uuid, p_song_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not exists (select 1 from songs where id = p_song_id and user_id = auth.uid()) then
    raise exception 'not authorized';
  end if;

  insert into muse_profile (section_id, song_id, interaction_count)
  values (p_section_id, p_song_id, 1)
  on conflict (section_id)
  do update set interaction_count = muse_profile.interaction_count + 1
  returning interaction_count into v_count;

  return v_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Baúl — the "Inspiration Black Hole" node. A real DB row for position/size,
-- same shape as tempo_nodes — it has no content columns of its own, since
-- everything it produces lives in songs.lyric_dna (see below and
-- src/utils/baulProcessor.js).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists baul_nodes (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references songs(id) on delete cascade,
  canvas_x      double precision not null default 0,
  canvas_y      double precision not null default 0,
  canvas_width  double precision not null default 140,
  canvas_height double precision not null default 140,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_baul_nodes_updated_at on baul_nodes;
create trigger trg_baul_nodes_updated_at
  before update on baul_nodes
  for each row execute function set_updated_at();

create index if not exists idx_baul_nodes_song on baul_nodes(song_id);

alter table baul_nodes enable row level security;

drop policy if exists baul_nodes_owner on baul_nodes;
create policy baul_nodes_owner on baul_nodes
  for all using (
    exists (select 1 from songs s where s.id = baul_nodes.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = baul_nodes.song_id and s.user_id = auth.uid())
  );

-- The fused ADN Lírico itself — deliberately a separate concept from
-- muse_profile above: muse_profile accumulates from conversations with the
-- muse, segmented by emotional register; lyric_dna accumulates from raw
-- material dropped into the baúl (text, transcripts, notebook photos,
-- documents), one evolving object, no register split. Never appended to —
-- each processBaulInput call returns the full fused replacement.
alter table songs add column if not exists lyric_dna jsonb not null default '{}'::jsonb;

-- Append-only log of individual baúl absorptions — deliberately separate
-- from lyric_dna above (which stays a single fused, never-appended-to
-- blob). This table exists ONLY to power the dev-only Muse Eye panel's
-- "baúl pipeline" tab (raw input -> what Claude extracted from THAT
-- specific input -> tags), i.e. per-entry provenance. Nothing in the real
-- product reads this — the "black box" decision (BaulFloatNode never shows
-- WHAT was absorbed, only THAT it was) stands for every real user-facing
-- surface; this table is the one deliberate, dev-only exception to it.
create table if not exists baul_entries (
  id                 uuid primary key default gen_random_uuid(),
  song_id            uuid not null references songs(id) on delete cascade,
  input_type         text not null check (input_type in ('text', 'audio_transcript', 'notebook_image', 'document')),
  raw_preview        text not null default '',
  generated_summary  text not null default '',
  tags               text[] not null default '{}',
  -- Real per-call telemetry, same spirit as askMuse's _debug.latencyMs —
  -- the extraction system prompt itself is a fixed constant (see
  -- baulProcessor.js's BAUL_SYSTEM_PROMPT), so it's shown once in the UI
  -- rather than duplicated per row; latency is the one thing that's
  -- actually per-call and worth persisting.
  latency_ms         integer,
  created_at         timestamptz not null default now()
);

create index if not exists idx_baul_entries_song on baul_entries(song_id, created_at desc);

alter table baul_entries enable row level security;

drop policy if exists baul_entries_owner on baul_entries;
create policy baul_entries_owner on baul_entries
  for all using (
    exists (select 1 from songs s where s.id = baul_entries.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = baul_entries.song_id and s.user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- line_audio — voice memos (hummed melodies, rhythmic phrasing, vocal hooks)
-- that belong to a NOTE (section) as a whole. Surfaced by the always-visible
-- "🎙 Àudios" bar in the mobile note editor (src/mobile/NoteAudioBar.jsx).
--
-- Historical: these used to be anchored to a single physical line
-- (section_id, line_index) and shown as per-line gutter badges. That gesture
-- was undiscoverable, so the model moved to per-note. `line_index` is kept
-- nullable for the old rows; the app no longer reads or writes it. `title`
-- is a user-editable label (null → the UI shows "Àudio N").
--
-- The blob itself lives in Storage (bucket below); this row is just the
-- pointer + metadata.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists line_audio (
  id                uuid primary key default gen_random_uuid(),
  section_id        uuid not null references sections(id) on delete cascade,
  song_id           uuid not null references songs(id) on delete cascade,
  line_index        integer,
  title             text,
  storage_path      text not null,
  duration_seconds  numeric,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_line_audio_section on line_audio(section_id, created_at);

alter table line_audio enable row level security;

drop policy if exists line_audio_owner on line_audio;
create policy line_audio_owner on line_audio
  for all using (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_audio.section_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_audio.section_id and s.user_id = auth.uid())
  );

-- Storage bucket for the actual audio bytes — not publicly readable, access
-- goes entirely through the RLS policies below (path convention:
-- {song_id}/{section_id}/{filename}, matching line_audio.storage_path).
insert into storage.buckets (id, name, public)
values ('voice-memos', 'voice-memos', false)
on conflict (id) do nothing;

drop policy if exists voice_memos_owner_select on storage.objects;
create policy voice_memos_owner_select on storage.objects
  for select using (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid()
    )
  );

drop policy if exists voice_memos_owner_insert on storage.objects;
create policy voice_memos_owner_insert on storage.objects
  for insert with check (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid()
    )
  );

drop policy if exists voice_memos_owner_delete on storage.objects;
create policy voice_memos_owner_delete on storage.objects
  for delete using (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- lexicon — the Cultural Resonance Engine's deterministic rhyme source. NOT
-- user data: one global, shared reference table (no song_id/user_id — every
-- row here is real-world Spanish vocabulary, not anything a user wrote), so
-- its RLS shape is deliberately the opposite of every other table in this
-- schema: public READ (any signed-in client can query rhyme candidates),
-- but NO public write policy at all — inserts only ever happen via
-- scripts/seed-lexicon-kaikki.ts using the Supabase service-role key (which
-- bypasses RLS entirely), never through the app's anon key. That's the
-- whole reason RLS is even worth enabling here: it's a write-lock, not an
-- ownership boundary.
--
-- rhyme_key is the word's stressed-vowel-onward tail (see rhyme.js's
-- getWordRhymeKey — consonant key), computed with the SAME algorithm the
-- live app uses to check rhymes, so a lexicon match is guaranteed to also
-- pass the app's own wordMatchesRhyme check, not just approximately agree
-- with it. rhyme_key_assonant is the same word's assonant key (vowels
-- only, from the stressed syllable onward) — WORD_BANK needs both, real
-- rhyme dictionaries distinguish "rima consonante" from "rima asonante"
-- and this table originally only stored the former. charisma_score (1-10)
-- is a heuristic "how evocative/poetic does this word read" proxy derived
-- from word shape + corpus frequency at seed time (see the seed script's
-- own comment) — NOT a linguistically validated rating; short, ultra-
-- common function words score low, longer rarer content words score
-- higher. Good enough to bias SELECTs toward more interesting candidates,
-- not a claim of poetic authority — and NOT the right sort key on its own
-- for a "show me everything, common and cool first" word bank (see
-- src/utils/lexicon.js's queryWordBank for the actual blended sort).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists lexicon (
  id                  bigint generated always as identity primary key,
  word                text not null,
  lang_code           varchar(5) not null default 'es',
  syllables           int not null,
  stress_type         text check (stress_type in ('aguda', 'llana', 'esdrujula')),
  rhyme_key           varchar(20) not null,
  rhyme_key_assonant  varchar(20),
  charisma_score      int not null default 5 check (charisma_score between 1 and 10),
  freq_rank           int,
  tags                text[] not null default '{}',
  created_at          timestamptz not null default now(),
  unique (word, lang_code)
);

-- Two lookup shapes: the Cultural Resonance Engine's single "give me
-- high-charisma words matching this rhyme_key" query (ARCHITECT), and
-- WORD_BANK's "give me everything matching this rhyme, either type" —
-- both need an indexed path instead of a sequential scan over however many
-- hundreds of thousands of rows the seed script imports.
create index if not exists idx_lexicon_rhyme on lexicon(lang_code, rhyme_key, charisma_score desc);
create index if not exists idx_lexicon_rhyme_assonant on lexicon(lang_code, rhyme_key_assonant, charisma_score desc);

alter table lexicon enable row level security;

drop policy if exists lexicon_public_read on lexicon;
create policy lexicon_public_read on lexicon
  for select using (true);

-- ─── baul_items ─────────────────────────────────────────────────────────────────
-- The inputs shown in the Baúl's glass cabinet (never the extracted ADN). Same statements as
-- migration_baul_items.sql, including the private baul-items storage bucket + policies.
create table if not exists baul_items (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references songs(id) on delete cascade,
  kind          text not null check (kind in ('note', 'image', 'document')),
  text_content  text,          -- the note's text (kind = 'note')
  storage_path  text,          -- {song_id}/{id}.{ext} in the baul-items bucket (image/document)
  file_name     text,          -- original filename, display only
  mime_type     text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_baul_items_song on baul_items(song_id, created_at);

alter table baul_items enable row level security;

drop policy if exists baul_items_owner on baul_items;
create policy baul_items_owner on baul_items
  for all using (
    exists (select 1 from songs s where s.id = baul_items.song_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from songs s where s.id = baul_items.song_id and s.user_id = auth.uid())
  );

-- Private bucket for the photo/PDF bytes — same convention as voice-memos:
-- path {song_id}/..., access only through the policies below.
insert into storage.buckets (id, name, public)
values ('baul-items', 'baul-items', false)
on conflict (id) do nothing;

drop policy if exists baul_items_obj_select on storage.objects;
create policy baul_items_obj_select on storage.objects
  for select using (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid())
  );

drop policy if exists baul_items_obj_insert on storage.objects;
create policy baul_items_obj_insert on storage.objects
  for insert with check (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid())
  );

drop policy if exists baul_items_obj_delete on storage.objects;
create policy baul_items_obj_delete on storage.objects
  for delete using (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and s.user_id = auth.uid())
  );

-- ─── resources ─────────────────────────────────────────────────────────────────
-- Artist-level Recursos library (not song-scoped). Same statements as migration_resources.sql,
-- including flat folders + the resource<->folder join table.
create table if not exists resources (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  -- Form of the resource (metaphor/proverb/phrase/other) — separate from
  -- theme (love/loss/anger/...), which is just a free tag like any other,
  -- not a second fixed field.
  type       text check (type in ('metaphor', 'proverb', 'phrase', 'lesson', 'other')),
  tags       text[] not null default '{}',
  -- Free text on purpose — sources vary too much for a fixed taxonomy
  -- (a book+page, a person, an overheard moment, a film) to fit cleanly.
  origin     text,
  -- Physical location within that source — see migration_resource_source_
  -- location.sql. Text, not integer: real pagination/line position isn't
  -- always a plain number.
  source_page text,
  source_line text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_resources_updated_at on resources;
create trigger trg_resources_updated_at
  before update on resources
  for each row execute function set_updated_at();

-- 'lesson' (craft insight/analysis, distinct from a literary 'metaphor')
-- was added after the initial version of this table — applies the
-- constraint change even if the table above already existed live.
alter table resources drop constraint if exists resources_type_check;
alter table resources add constraint resources_type_check
  check (type in ('metaphor', 'proverb', 'phrase', 'lesson', 'other'));

create index if not exists idx_resources_user on resources(user_id, created_at desc);

alter table resources enable row level security;

drop policy if exists resources_owner on resources;
create policy resources_owner on resources
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Flat folders (no nesting) — a resource can sit in several at once (the
-- Rayuela example: one line can live in both a "Rayuela" folder and a
-- "pérdida" folder), so it's a join table, not a single folder_id column.
create table if not exists resource_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'Sin título',
  created_at timestamptz not null default now()
);

create index if not exists idx_resource_folders_user on resource_folders(user_id, created_at);

alter table resource_folders enable row level security;

drop policy if exists resource_folders_owner on resource_folders;
create policy resource_folders_owner on resource_folders
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists resource_folder_members (
  resource_id uuid not null references resources(id) on delete cascade,
  folder_id   uuid not null references resource_folders(id) on delete cascade,
  primary key (resource_id, folder_id)
);

create index if not exists idx_resource_folder_members_folder on resource_folder_members(folder_id);

alter table resource_folder_members enable row level security;

drop policy if exists resource_folder_members_owner on resource_folder_members;
create policy resource_folder_members_owner on resource_folder_members
  for all using (
    exists (select 1 from resources r where r.id = resource_folder_members.resource_id and r.user_id = auth.uid())
  ) with check (
    exists (select 1 from resources r where r.id = resource_folder_members.resource_id and r.user_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Project collaboration — up to 4 people per song. Same statements as
-- migration_project_collaboration.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Run this in the Supabase SQL editor. Adds per-song collaboration: up to 4
-- people (one owner + up to 3 editors) can work on the same song. Joining
-- happens through a shareable invite link/code, not by looking someone up
-- by email — nothing here needs an email-sending integration.
--
-- Scope, on purpose:
--   - Per SONG, not per album and not per artist account. An album with
--     collaborating songs doesn't itself become shared — each track keeps
--     its own collaborator list.
--   - Resources (the artist-level Recursos library) are untouched — they
--     were explicitly designed as "yours, not the project's" and stay that
--     way. Collaborators on a song do NOT get access to each other's
--     Recursos libraries.
--   - Baúl's fused ADN Lírico (songs.lyric_dna) stays exactly as hidden as
--     it already was — nobody, owner or editor, ever saw it rendered
--     before, and that doesn't change. The glass cabinet (baul_items, the
--     artist's own raw INPUTS) becomes visible to every collaborator, same
--     as every other song-scoped table below — it's part of working on the
--     song together, not part of the hidden ADN.
--   - Sync model: Supabase Realtime (Postgres Changes + Presence) broadcasts
--     row changes live to everyone viewing the same song; conflict handling
--     is last-write-wins per LINE row, not a full text CRDT merge. Two
--     people editing the exact same line in the exact same second can still
--     clobber each other — deliberately not solved here, since lines are
--     already the natural unit of contention and real collisions on one
--     physical line at the same instant should be rare for up to 4 people.
--     Flag this if it turns out to matter in practice.
--
-- Safe to re-run.

create extension if not exists pgcrypto;

-- ─── profiles ───────────────────────────────────────────────────────────────
-- auth.users isn't queryable from the client at all (Supabase locks it down
-- to the service role), so there was never a way to show "who" anyone is —
-- collaboration is the first feature that actually needs it. Minimal: just a
-- display name, defaulted from the email's local part, user-editable. Not
-- exposing email itself to other collaborators, only this.
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

create or replace function ensure_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_ensure_profile on auth.users;
create trigger trg_ensure_profile
  after insert on auth.users
  for each row execute function ensure_profile_for_user();

-- Backfill for every account that already exists.
insert into profiles (id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

alter table profiles enable row level security;

-- profiles_read/profiles_self_update (below project_collaborators, since
-- profiles_read's USING clause queries it — a policy's condition is parsed
-- against real tables at CREATE POLICY time, unlike a function body, which
-- is only checked when it actually runs) are defined further down, right
-- after that table exists.

-- ─── project_collaborators ──────────────────────────────────────────────────
-- One row per (song, person) — INCLUDING the owner, so "who can touch this
-- song" is always one table, one query, no special-casing songs.user_id
-- everywhere it's asked. The owner's row is created automatically (trigger
-- below) the moment a song is; it's never created or removable by hand.
create table if not exists project_collaborators (
  id         uuid primary key default gen_random_uuid(),
  song_id    uuid not null references songs(id) on delete cascade,
  -- References profiles, not auth.users directly, even though every
  -- profiles.id already IS an auth.users id 1:1 — PostgREST's embedded-
  -- resource syntax (.select('..., profiles(display_name)'), used by
  -- loadCollaborators in collaborationData.js) needs an actual foreign key
  -- to the table being embedded, not just a shared ancestor. profiles rows
  -- are guaranteed to exist for every user (signup trigger + backfill,
  -- both above) by the time anything ever inserts here.
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null check (role in ('owner', 'editor')),
  joined_at  timestamptz not null default now(),
  unique (song_id, user_id)
);

create index if not exists idx_project_collaborators_song on project_collaborators(song_id);
create index if not exists idx_project_collaborators_user on project_collaborators(user_id);

-- Not a public directory: you can always read your own row, plus anyone
-- you share at least one song's collaborator list with — not every signed-
-- in user app-wide. A display name is low-sensitivity, but there's no
-- reason to let two people who've never worked together see each other's.
-- (Defined here, not up by `create table profiles`, because this table has
-- to exist first — see the note left there.)
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from project_collaborators mine
      join project_collaborators theirs on theirs.song_id = mine.song_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Every song needs exactly one 'owner' row, created the instant the song
-- is — never left to application code to remember.
create or replace function ensure_song_owner_collaborator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into project_collaborators (song_id, user_id, role)
  values (new.id, new.user_id, 'owner')
  on conflict (song_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_song_owner_collaborator on songs;
create trigger trg_song_owner_collaborator
  after insert on songs
  for each row execute function ensure_song_owner_collaborator();

-- Hard cap: 4 people total per song (owner included). Enforced here, not
-- just in the accept-invite RPC below, so a bug or a future direct insert
-- can't quietly blow past it.
create or replace function enforce_collaborator_cap()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from project_collaborators where song_id = new.song_id) >= 4 then
    raise exception 'project_collaborators: song % already has 4 participants', new.song_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_collaborator_cap on project_collaborators;
create trigger trg_collaborator_cap
  before insert on project_collaborators
  for each row execute function enforce_collaborator_cap();

-- ─── project_invites ────────────────────────────────────────────────────────
-- A shareable code, not a specific person — anyone who opens the link and
-- has (or creates) an account can redeem it, up to the cap. The owner can
-- revoke a live link at any time; a used single-use link can't be redeemed
-- again. code is plain hex (URL-safe with no escaping needed).
create table if not exists project_invites (
  id          uuid primary key default gen_random_uuid(),
  song_id     uuid not null references songs(id) on delete cascade,
  code        text not null unique default encode(gen_random_bytes(12), 'hex'),
  created_by  uuid not null references auth.users(id) on delete cascade,
  single_use  boolean not null default false,
  used_count  integer not null default 0,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_project_invites_song on project_invites(song_id);
-- No separate index on `code`: the inline `unique` above already creates one.

-- ─── access-check helper ────────────────────────────────────────────────────
-- Every other song-scoped table's RLS policy below calls this instead of
-- repeating "owner OR editor" logic in each one. security definer so it can
-- read project_collaborators regardless of THAT table's own RLS (avoids any
-- recursion risk); stable so the planner can treat it as cacheable per
-- statement.
create or replace function is_song_participant(p_song_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from project_collaborators
    where song_id = p_song_id and user_id = auth.uid()
  );
$$;

create or replace function is_song_owner(p_song_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from songs where id = p_song_id and user_id = auth.uid()
  );
$$;

-- ─── accept-invite RPC ──────────────────────────────────────────────────────
-- The only way a non-participant ever gains access: validates the code
-- (exists, not revoked, not expired, not already fully used), checks the
-- cap, inserts the collaborator row, bumps used_count. Returns the song_id
-- on success so the client knows where to navigate. Raises on any failure
-- with a message safe to show as-is.
create or replace function accept_project_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite project_invites;
  v_song_id uuid;
begin
  select * into v_invite from project_invites where code = p_code;

  if v_invite is null then
    raise exception 'invite not found';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite revoked';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'invite expired';
  end if;
  if v_invite.single_use and v_invite.used_count > 0 then
    raise exception 'invite already used';
  end if;
  if (select count(*) from project_collaborators where song_id = v_invite.song_id) >= 4 then
    raise exception 'project is already full';
  end if;

  v_song_id := v_invite.song_id;

  insert into project_collaborators (song_id, user_id, role)
  values (v_song_id, auth.uid(), 'editor')
  on conflict (song_id, user_id) do nothing;

  update project_invites set used_count = used_count + 1 where id = v_invite.id;

  return v_song_id;
end;
$$;

-- ─── RLS: project_collaborators / project_invites ───────────────────────────
alter table project_collaborators enable row level security;
alter table project_invites       enable row level security;

drop policy if exists project_collaborators_select on project_collaborators;
create policy project_collaborators_select on project_collaborators
  for select using (is_song_participant(song_id));

-- Only the owner manages the collaborator list by hand (removing someone).
-- Inserts happen only through the owner trigger above or accept_project_invite
-- (both security definer, bypassing RLS) — no direct insert policy needed.
drop policy if exists project_collaborators_delete on project_collaborators;
create policy project_collaborators_delete on project_collaborators
  for delete using (
    role <> 'owner'
    and (is_song_owner(song_id) or user_id = auth.uid()) -- owner removes anyone; anyone removes themself (leave)
  );

drop policy if exists project_invites_owner on project_invites;
create policy project_invites_owner on project_invites
  for all using (is_song_owner(song_id)) with check (is_song_owner(song_id));

-- ─── songs: split from one owner-only policy into participant read/update
--     vs. owner-only insert/delete, so editors can work but not delete the
--     project or rewrite who owns it. ───────────────────────────────────────
drop policy if exists songs_owner on songs;

create policy songs_select on songs
  for select using (is_song_participant(id));

create policy songs_update on songs
  for update using (is_song_participant(id)) with check (is_song_participant(id));

create policy songs_insert on songs
  for insert with check (user_id = auth.uid());

create policy songs_delete on songs
  for delete using (user_id = auth.uid());

-- songs_update above lets any participant touch the row, but RLS alone
-- can't stop one UPDATE statement from changing WHICH column it touches —
-- without this, an editor could run UPDATE songs SET user_id = <self> and
-- the with-check would still pass (they're still a participant afterwards),
-- quietly making themselves the recorded owner. No "transfer ownership"
-- feature exists, so this is simply never allowed, owner included.
create or replace function prevent_song_ownership_change()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'songs.user_id cannot be changed directly';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_song_ownership_change on songs;
create trigger trg_prevent_song_ownership_change
  before update on songs
  for each row execute function prevent_song_ownership_change();

-- ─── every other song-scoped table: same policy shape as before, just with
--     the "s.user_id = auth.uid()" leaf swapped for is_song_participant(s.id)
--     wherever the subquery already joins back to songs. ───────────────────

drop policy if exists sections_owner on sections;
create policy sections_owner on sections
  for all using (
    exists (select 1 from songs s where s.id = sections.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = sections.song_id and is_song_participant(s.id))
  );

drop policy if exists lines_owner on lines;
create policy lines_owner on lines
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = lines.section_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = lines.section_id and is_song_participant(s.id)
    )
  );

drop policy if exists variants_owner on line_variants;
create policy variants_owner on line_variants
  for all using (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = line_variants.line_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = line_variants.line_id and is_song_participant(s.id)
    )
  );

drop policy if exists annotations_owner on annotations;
create policy annotations_owner on annotations
  for all using (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = annotations.line_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from lines l
      join sections sec on sec.id = l.section_id
      join songs s on s.id = sec.song_id
      where l.id = annotations.line_id and is_song_participant(s.id)
    )
  );

drop policy if exists section_versions_owner on section_versions;
create policy section_versions_owner on section_versions
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = section_versions.section_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = section_versions.section_id and is_song_participant(s.id)
    )
  );

drop policy if exists word_variants_owner on word_variants;
create policy word_variants_owner on word_variants
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = word_variants.section_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = word_variants.section_id and is_song_participant(s.id)
    )
  );

drop policy if exists line_history_owner on line_history;
create policy line_history_owner on line_history
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = line_history.section_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = line_history.section_id and is_song_participant(s.id)
    )
  );

drop policy if exists ideas_owner on ideas_notebook;
create policy ideas_owner on ideas_notebook
  for all using (
    exists (select 1 from songs s where s.id = ideas_notebook.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = ideas_notebook.song_id and is_song_participant(s.id))
  );

drop policy if exists chord_progressions_owner on chord_progressions;
create policy chord_progressions_owner on chord_progressions
  for all using (
    exists (select 1 from songs s where s.id = chord_progressions.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = chord_progressions.song_id and is_song_participant(s.id))
  );

drop policy if exists note_links_owner on note_links;
create policy note_links_owner on note_links
  for all using (
    exists (select 1 from songs s where s.id = note_links.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = note_links.song_id and is_song_participant(s.id))
  );

drop policy if exists song_outputs_owner on song_outputs;
create policy song_outputs_owner on song_outputs
  for all using (
    exists (select 1 from songs s where s.id = song_outputs.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = song_outputs.song_id and is_song_participant(s.id))
  );

drop policy if exists output_selections_owner on output_selections;
create policy output_selections_owner on output_selections
  for all using (
    exists (
      select 1 from song_outputs so
      join songs s on s.id = so.song_id
      where so.id = output_selections.output_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from song_outputs so
      join songs s on s.id = so.song_id
      where so.id = output_selections.output_id and is_song_participant(s.id)
    )
  );

drop policy if exists tempo_nodes_owner on tempo_nodes;
create policy tempo_nodes_owner on tempo_nodes
  for all using (
    exists (select 1 from songs s where s.id = tempo_nodes.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = tempo_nodes.song_id and is_song_participant(s.id))
  );

drop policy if exists muse_entries_owner on muse_entries;
create policy muse_entries_owner on muse_entries
  for all using (
    exists (select 1 from songs s where s.id = muse_entries.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = muse_entries.song_id and is_song_participant(s.id))
  );

drop policy if exists muse_profile_owner on muse_profile;
create policy muse_profile_owner on muse_profile
  for all using (
    exists (select 1 from songs s where s.id = muse_profile.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = muse_profile.song_id and is_song_participant(s.id))
  );

-- muse_increment_interaction had its own inline ownership check (not a
-- policy) — same swap, same security-definer/search_path shape as before.
create or replace function muse_increment_interaction(p_section_id uuid, p_song_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not is_song_participant(p_song_id) then
    raise exception 'not authorized';
  end if;

  insert into muse_profile (section_id, song_id, interaction_count)
  values (p_section_id, p_song_id, 1)
  on conflict (section_id)
  do update set interaction_count = muse_profile.interaction_count + 1
  returning interaction_count into v_count;

  return v_count;
end;
$$;

drop policy if exists baul_nodes_owner on baul_nodes;
create policy baul_nodes_owner on baul_nodes
  for all using (
    exists (select 1 from songs s where s.id = baul_nodes.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = baul_nodes.song_id and is_song_participant(s.id))
  );

drop policy if exists baul_entries_owner on baul_entries;
create policy baul_entries_owner on baul_entries
  for all using (
    exists (select 1 from songs s where s.id = baul_entries.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = baul_entries.song_id and is_song_participant(s.id))
  );

drop policy if exists line_audio_owner on line_audio;
create policy line_audio_owner on line_audio
  for all using (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_audio.section_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from sections sec join songs s on s.id = sec.song_id where sec.id = line_audio.section_id and is_song_participant(s.id))
  );

drop policy if exists voice_memos_owner_select on storage.objects;
create policy voice_memos_owner_select on storage.objects
  for select using (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id)
    )
  );

drop policy if exists voice_memos_owner_insert on storage.objects;
create policy voice_memos_owner_insert on storage.objects
  for insert with check (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id)
    )
  );

drop policy if exists voice_memos_owner_delete on storage.objects;
create policy voice_memos_owner_delete on storage.objects
  for delete using (
    bucket_id = 'voice-memos'
    and exists (
      select 1 from songs s
      where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id)
    )
  );

drop policy if exists baul_items_owner on baul_items;
create policy baul_items_owner on baul_items
  for all using (
    exists (select 1 from songs s where s.id = baul_items.song_id and is_song_participant(s.id))
  ) with check (
    exists (select 1 from songs s where s.id = baul_items.song_id and is_song_participant(s.id))
  );

drop policy if exists baul_items_obj_select on storage.objects;
create policy baul_items_obj_select on storage.objects
  for select using (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id))
  );

drop policy if exists baul_items_obj_insert on storage.objects;
create policy baul_items_obj_insert on storage.objects
  for insert with check (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id))
  );

drop policy if exists baul_items_obj_delete on storage.objects;
create policy baul_items_obj_delete on storage.objects
  for delete using (
    bucket_id = 'baul-items'
    and exists (select 1 from songs s where s.id::text = (storage.foldername(name))[1] and is_song_participant(s.id))
  );

-- ─── realtime ───────────────────────────────────────────────────────────────
-- Live sync only needs to notify on the tables a collaborator's screen
-- actually reacts to without a manual reload: sections (verses added/
-- removed/reordered), lines (the actual text — one row per SECTION, not
-- per physical line, so this is "the block's text changed", not
-- line-granular), and project_collaborators (so "so-and-so joined/left"
-- updates live too). Assumes the `supabase_realtime` publication already
-- exists, which it does on every Supabase project by default.
--
-- Realtime's Postgres Changes already apply each subscriber's own RLS
-- before delivering a row — same policies as above, so this adds *delivery*
-- of changes, not a new way to read anything the policies already block.
-- ADD TABLE has no IF NOT EXISTS; wrapped so re-running this migration
-- doesn't fail on a table already added.
do $$ begin
  alter publication supabase_realtime add table sections;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table lines;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table project_collaborators;
exception when duplicate_object then null;
end $$;

-- ─── backfill ────────────────────────────────────────────────────────────────
-- Every song that already exists predates this migration and has no
-- project_collaborators row yet — the trigger above only fires on NEW songs.
-- Give every existing song its owner row once, here.
insert into project_collaborators (song_id, user_id, role)
select id, user_id, 'owner' from songs
on conflict (song_id, user_id) do nothing;
