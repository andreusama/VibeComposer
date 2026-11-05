-- ─── Guest demo ("Try the demo") ────────────────────────────────────────────
-- A visitor taps "Probar la demo" → Supabase anonymous sign-in (no sign-up) →
-- create_demo_song() gives them a ready-made sample song. Everything below is
-- what keeps that cheap and safe:
--   • guests get ~10 Muse (Claude) calls a day, and ALL users together share
--     one daily cap, so a burst of visitors can't run up the API bill
--   • guests can't upload anything to Storage (voice memos, Baúl photos)
--   • guests are capped at a few songs, and their accounts (plus everything
--     they made — every table cascades off auth.users) are deleted
--     automatically after a day
--
-- PREREQUISITE (dashboard, not SQL): Authentication → Sign In / Providers →
-- enable "Allow anonymous sign-ins". Strongly recommended there too: turn on
-- CAPTCHA protection, since anyone can mint anonymous accounts otherwise
-- (Supabase already rate-limits anonymous sign-ins per IP).
--
-- Run once against the live database; safe to re-run. The caps are plain
-- constants in the functions below — edit and re-run to change them.

-- Anonymous users carry is_anonymous = true in their JWT.
create or replace function is_guest()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- ─── 1. Daily Claude quota: per user (guest limit) + one global cap ─────────
-- Replaces migration_claude_usage.sql's version. Same name/signature/return
-- type, so api/claude.js needs no change.

create table if not exists claude_usage_global (
  day   date primary key,
  count integer not null default 0
);
alter table claude_usage_global enable row level security; -- no policies: function-only

create or replace function claude_consume_quota()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_limit  constant int := 10;    -- Muse calls per guest per day
  v_user_limit   constant int := 150;   -- Muse calls per signed-in user per day
  v_global_limit constant int := 400;   -- Muse calls per day across EVERYONE
  v_uid    uuid := auth.uid();
  v_day    date := (now() at time zone 'utc')::date;
  v_count  int;
  v_global int;
begin
  if v_uid is null then
    return false;
  end if;

  insert into claude_usage (user_id, day, count)
  values (v_uid, v_day, 1)
  on conflict (user_id, day) do update set count = claude_usage.count + 1
  returning count into v_count;

  if v_count > case when is_guest() then v_guest_limit else v_user_limit end then
    return false;
  end if;

  insert into claude_usage_global (day, count)
  values (v_day, 1)
  on conflict (day) do update set count = claude_usage_global.count + 1
  returning count into v_global;

  if v_global > v_global_limit then
    -- Over the global cap: hand the slot back so a rejected call doesn't also
    -- eat this user's own allowance or inflate the global count.
    update claude_usage_global set count = count - 1 where day = v_day;
    update claude_usage set count = count - 1 where user_id = v_uid and day = v_day;
    return false;
  end if;

  return true;
end;
$$;

revoke all on function claude_consume_quota() from public, anon;
grant execute on function claude_consume_quota() to authenticated;

-- ─── 2. Guests can't upload files or audio ──────────────────────────────────
-- A RESTRICTIVE policy is ANDed with every existing permissive one, so this
-- covers every bucket (voice memos, Baúl photos, anything added later)
-- without touching their own policies.

drop policy if exists guests_cannot_upload on storage.objects;
create policy guests_cannot_upload on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (not is_guest());

-- ─── 3. Guests are capped at a few songs ────────────────────────────────────

create or replace function limit_guest_songs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max constant int := 3;
begin
  if is_guest() and (select count(*) from songs where user_id = new.user_id) >= v_max then
    raise exception 'guest song limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limit_guest_songs on songs;
create trigger trg_limit_guest_songs
  before insert on songs
  for each row execute function limit_guest_songs();

-- ─── 4. The sample song ─────────────────────────────────────────────────────
-- Called by the client right after anonymous sign-in. Idempotent: a guest who
-- already has any song gets that one back instead of a second copy. Only
-- guests may call it, so it can't be used to dump rows into a real account.

create or replace function create_demo_song()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_song    uuid;
  v_verse   uuid;
  v_chorus  uuid;
  v_vline   uuid;
  v_cline   uuid;
begin
  if v_uid is null or not is_guest() then
    raise exception 'demo song is for guest sessions only';
  end if;

  select id into v_song from songs where user_id = v_uid order by created_at limit 1;
  if v_song is not null then
    return v_song;
  end if;

  insert into songs (user_id, title) values (v_uid, 'Canción de ejemplo') returning id into v_song;

  insert into sections (song_id, type, position, canvas_x, canvas_y, thread_index)
  values (v_song, 'verse', 0, 0, 0, 0) returning id into v_verse;
  insert into sections (song_id, type, position, canvas_x, canvas_y, thread_index)
  values (v_song, 'chorus', 1, 0, 240, 1) returning id into v_chorus;

  insert into lines (section_id, position, text)
  values (v_verse, 0, E'Anoche la ciudad se quedó sin voz\nY yo cantando bajito en el balcón\nLas luces dibujaban tu silueta\nComo un verso que no termina') returning id into v_vline;
  insert into lines (section_id, position, text)
  values (v_chorus, 0, E'Y si el mundo se apaga, yo te espero\nEn la última nota de esta canción\nQue el tiempo se detenga en un acorde\nY nos encuentre cantando los dos') returning id into v_cline;

  insert into line_chords (line_id, line_index, position, chord_name) values
    (v_vline, 0, 0, 'Am'),
    (v_vline, 1, 0, 'F'),
    (v_vline, 2, 0, 'C'),
    (v_vline, 3, 0, 'G'),
    (v_cline, 0, 0, 'F'),
    (v_cline, 0, 1, 'G'),
    (v_cline, 1, 0, 'Am'),
    (v_cline, 2, 0, 'F'),
    (v_cline, 3, 0, 'C');

  return v_song;
end;
$$;

revoke all on function create_demo_song() from public, anon;
grant execute on function create_demo_song() to authenticated;

-- ─── 5. Auto-delete guest accounts ──────────────────────────────────────────
-- Deleting the auth user cascades to everything it owns (songs → sections →
-- lines → chords, claude_usage, …). Anything older than a day goes.

create or replace function cleanup_guest_users()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted integer;
begin
  with gone as (
    delete from auth.users
    where is_anonymous = true
      and created_at < now() - interval '1 day'
    returning 1
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end;
$$;

revoke all on function cleanup_guest_users() from public, anon, authenticated;

-- Hourly, via pg_cron (enable it once in Dashboard → Database → Extensions).
-- If pg_cron isn't on yet this block just says so instead of failing the
-- whole migration — run it again after enabling the extension.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'cleanup-guest-users';
    perform cron.schedule('cleanup-guest-users', '17 * * * *', 'select cleanup_guest_users()');
  else
    raise notice 'pg_cron is not enabled — enable it (Database → Extensions) and re-run this migration to schedule guest cleanup.';
  end if;
end;
$$;
