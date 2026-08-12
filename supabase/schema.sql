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
  mode                 text check (mode in ('SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK')),
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
-- line_audio — voice memos anchored to a specific physical verse line
-- (hummed melodies, rhythmic phrasing, vocal hooks recorded via the mobile
-- long-press gesture, see src/mobile/AudioRecorderSheet.jsx).
--
-- NOTE the anchor is (section_id, line_index), not a `lines` row — unlike
-- what the table name might suggest, `lines` holds exactly ONE row per
-- section (see canvasData.js: `insert({ section_id, position: 0, text })`,
-- always position 0), the whole block's text as one string with embedded
-- \n's; individual physical lines only exist as a client-side split
-- (NoteEditorScreen's `splitIntoLines`), so there's no stable per-line row
-- to reference. line_index is the line's position in that split at record
-- time — the exact same "position drifts if lines are inserted/deleted
-- above it" tradeoff `annotations.start_offset/end_offset` already accepts
-- for the same underlying reason, not a new gap this table introduces.
--
-- The blob itself lives in Storage (bucket below); this row is just the
-- pointer + metadata.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists line_audio (
  id                uuid primary key default gen_random_uuid(),
  section_id        uuid not null references sections(id) on delete cascade,
  song_id           uuid not null references songs(id) on delete cascade,
  line_index        integer not null,
  storage_path      text not null,
  duration_seconds  numeric,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now()
);

create index if not exists idx_line_audio_section on line_audio(section_id, line_index);

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
-- with it. charisma_score (1-10) is a heuristic "how evocative/poetic does
-- this word read" proxy derived from word shape + corpus frequency at seed
-- time (see the seed script's own comment) — NOT a linguistically
-- validated rating; short, ultra-common function words score low, longer
-- rarer content words score higher. Good enough to bias SELECTs toward
-- more interesting candidates, not a claim of poetic authority.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists lexicon (
  id               bigint generated always as identity primary key,
  word             text not null,
  lang_code        varchar(5) not null default 'es',
  syllables        int not null,
  stress_type      text check (stress_type in ('aguda', 'llana', 'esdrujula')),
  rhyme_key        varchar(20) not null,
  charisma_score   int not null default 5 check (charisma_score between 1 and 10),
  freq_rank        int,
  tags             text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique (word, lang_code)
);

-- The Cultural Resonance Engine's one real query: "give me high-charisma
-- words matching this rhyme_key, for this language" — this index is what
-- makes that a real indexed lookup instead of a sequential scan over
-- however many tens of thousands of rows the seed script imports.
create index if not exists idx_lexicon_rhyme on lexicon(lang_code, rhyme_key, charisma_score desc);

alter table lexicon enable row level security;

drop policy if exists lexicon_public_read on lexicon;
create policy lexicon_public_read on lexicon
  for select using (true);
