-- ─── strum_patterns ─────────────────────────────────────────────────────────────
-- One recorded right-hand strum pattern per SECTION (verse/chorus/bridge),
-- performed as real up/down finger swipes on a touch pad
-- (src/mobile/ChordStrumSheet.jsx) rather than typed in.
-- Additive only — safe to re-run, nothing here touches existing data.
--
-- Scoped to a section, not to a chord and not to the whole song: different
-- sections of the same song very commonly strum differently (a verse picked
-- softly, a chorus hammered), while one section almost never carries two
-- competing patterns at once. Hence ONE active pattern per section —
-- `section_id` is unique and the client upserts on it (on conflict
-- (section_id) do update), the same one-row-per-section convention
-- muse_profile already uses. A surrogate `id` is kept anyway so the row has
-- a stable identity independent of what it is attached to, like every other
-- table here.
--
-- pattern is a jsonb ARRAY of strokes in performance order:
--   [{"direction": "down", "intensity": 0.82}, {"direction": "up", "intensity": 0.31}, …]
-- direction = the sign of the swipe's vertical displacement; intensity =
-- 0..1 derived from the swipe's velocity in px/ms (faster swipe = harder
-- strum), see velocityToIntensity in src/utils/strum.js. Stored as jsonb and
-- not normalised into a strokes table on purpose: a pattern is only ever
-- read, written and discarded whole, never queried stroke-by-stroke.
--
-- bpm is auto-derived from the real time elapsed between consecutive strokes
-- during the recording itself (average interval → BPM, folded into a musical
-- range), then freely editable by hand — the same "the system suggests, the
-- human can always correct it" rule the muse suggestions and word variants
-- already follow. Which is why there is no is_auto/was_edited flag: once
-- it's in this column it is simply the artist's tempo.
create table if not exists strum_patterns (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null unique references sections(id) on delete cascade,
  bpm        integer not null default 90,
  pattern    jsonb   not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_strum_patterns_section on strum_patterns(section_id);

drop trigger if exists trg_strum_patterns_updated_at on strum_patterns;
create trigger trg_strum_patterns_updated_at
  before update on strum_patterns
  for each row execute function set_updated_at();

alter table strum_patterns enable row level security;

-- Same sections → songs → is_song_participant() chain every other
-- section-scoped table already uses (see word_variants_owner / line_history_owner).
drop policy if exists strum_patterns_owner on strum_patterns;
create policy strum_patterns_owner on strum_patterns
  for all using (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = strum_patterns.section_id and is_song_participant(s.id)
    )
  ) with check (
    exists (
      select 1 from sections sec join songs s on s.id = sec.song_id
      where sec.id = strum_patterns.section_id and is_song_participant(s.id)
    )
  );
