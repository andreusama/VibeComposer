-- Server-side daily cap on Claude proxy calls (api/claude.js). The client's
-- own localStorage counter is trivially bypassable, so the real hard limit
-- lives here: one row per user per UTC day, incremented atomically by the
-- proxy through claude_consume_quota() using the CALLER'S OWN token. Run this
-- once against the live database; safe to re-run. To change the cap, edit
-- v_limit below and re-run.

create table if not exists claude_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  count   integer not null default 0,
  primary key (user_id, day)
);

-- No policies on purpose: nobody can read or write the table directly, only
-- through the security-definer function below.
alter table claude_usage enable row level security;

create or replace function claude_consume_quota()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit constant int := 150;
  v_uid   uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    return false;
  end if;

  insert into claude_usage (user_id, day, count)
  values (v_uid, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set count = claude_usage.count + 1
  returning count into v_count;

  return v_count <= v_limit;
end;
$$;

revoke all on function claude_consume_quota() from public, anon;
grant execute on function claude_consume_quota() to authenticated;
