-- Run this in the Supabase SQL editor. Adds the artist-level "Recursos"
-- library: phrases/metaphors/proverbs the artist consciously saves and
-- labels (not song-scoped, unlike ideas_notebook or the Baúl — a resource
-- saved today should be reachable from any future song). Deliberately
-- separate from the Baúl: the Baúl fuses raw material into a hidden voice
-- profile; a resource is a visible, individually retrievable snippet the
-- artist chose and can insert verbatim into a lyric.
--
-- Only `body` is required at capture time — type/tags/origin/folders are
-- all fillable later, so a quick mid-writing save never blocks on labeling.
-- Safe to re-run.

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_resources_updated_at on resources;
create trigger trg_resources_updated_at
  before update on resources
  for each row execute function set_updated_at();

-- 'lesson' (craft insight/analysis, distinct from a literary 'metaphor')
-- was added after the initial version of this table — this makes the
-- constraint change apply even if the table above already exists on a
-- live database (the CREATE TABLE itself is a no-op in that case).
-- Postgres's default name for a column-level check is <table>_<column>_check.
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
