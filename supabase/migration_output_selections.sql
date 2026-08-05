-- Run this in the Supabase SQL editor. Lets each final mix remember which
-- branch it takes whenever the note graph forks (a note has more than one
-- outgoing main-thread link) — no row means "use the default" (the branch
-- drawn first), so a fork is never left ambiguous.

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
