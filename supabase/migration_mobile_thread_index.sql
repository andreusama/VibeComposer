-- ─── Mobile song-thread ordering: sections.thread_index ────────────────────────
-- Mobile-only ordering/grouping field — desktop keeps using note_links +
-- canvas_x/y exactly as before, completely untouched by this migration.
-- Notes sharing the same thread_index are "variants": independent notes
-- (own id, own text, own chords, own comments) that group into one
-- swipeable slot in the mobile thread purely by sharing this value — no
-- parent/child relationship, no nested data.
--
-- Backfilled from the *existing* note_links chain topology (not creation
-- order) so switching a song's mobile view over to this column doesn't
-- visually reorder anything that already had a thread. Values are gapped
-- by 10 (10, 20, 30...) so inserting between two slots later is just
-- picking the midpoint, no cascading renumber; root chains (a song can
-- have more than one disconnected chain, or none) are spaced 1000 apart
-- so their depth-based indices never collide.

alter table sections add column if not exists thread_index integer;

with recursive roots as (
  select s.id, s.song_id,
         row_number() over (partition by s.song_id order by s.created_at) as root_rank
  from sections s
  where not exists (
    select 1 from note_links nl
    where nl.target_note_id = s.id and nl.type = 'main-thread'
  )
),
chain as (
  select id as note_id, song_id, root_rank, 0 as depth from roots
  union all
  select nl.target_note_id, chain.song_id, chain.root_rank, chain.depth + 1
  from note_links nl
  join chain on nl.source_note_id = chain.note_id and nl.type = 'main-thread'
)
update sections s
set thread_index = chain.root_rank * 1000 + chain.depth * 10
from chain
where s.id = chain.note_id
  and s.thread_index is null;

create index if not exists idx_sections_thread_index on sections(song_id, thread_index);
