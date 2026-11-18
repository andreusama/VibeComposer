-- ─── Shared song: read-only view without an account ────────────────────────
-- A share link (?invite=<code>) used to need a session before it did anything.
-- Now anyone who opens it — no sign-in — sees a READ-ONLY snapshot of the song
-- (its Parts in order, with their chords) through get_shared_song(). Signing in
-- with a real account from that view then joins the song as an editor exactly
-- as before (accept_project_invite). See docs/adr/0003.
--
-- Rules (agreed 2026-11-18):
--   • Looking never spends a single-use link; only joining does.
--   • Guest sessions (anonymous users — the demo) are NOT accounts: they can
--     view but cannot join as editors. An account is the trust signal.
--   • The owner can make a link that never grants editing (view_only).
--   • Demo guests are now cleaned up after 3 days (was 1).
--
-- Safe to re-run. Needs migration_project_collaboration.sql; the cleanup part
-- also needs migration_guest_demo.sql.

-- ─── 1. Owner-chosen "view only" links ──────────────────────────────────────
alter table project_invites add column if not exists view_only boolean not null default false;

-- ─── 2. Joining as an editor: no view-only links, no guest sessions ─────────
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
  if v_invite.view_only then
    raise exception 'invite view only';
  end if;
  -- No session at all, or a guest (anonymous) session: viewing is fine
  -- (get_shared_song), joining as an editor needs a real account.
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'sign in with an account to edit';
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

-- ─── 3. The read-only snapshot ──────────────────────────────────────────────
-- Callable with NO session (the anon role). The code is the only credential:
-- it has to exist, not be revoked, not be expired, and not be a used-up
-- single-use link. Returns just what a reader needs — title, Parts, lines,
-- chords — and nothing else (no lyric DNA, Muse history, audio or Baúl).
create or replace function get_shared_song(p_code text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_invite project_invites;
  v_title  text;
  v_notes  jsonb;
  v_chords jsonb;
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

  select title into v_title from songs where id = v_invite.song_id;

  -- Same order the song thread uses: bucketed by thread_index (notes without
  -- one go last), then position.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'type', s.type,
           'custom_label', s.custom_label,
           'thread_index', s.thread_index,
           'lines', (
             select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'text', l.text) order by l.position), '[]'::jsonb)
             from lines l where l.section_id = s.id
           )
         ) order by s.thread_index nulls last, s.position, s.created_at), '[]'::jsonb)
    into v_notes
    from sections s
   where s.song_id = v_invite.song_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'line_id', c.line_id, 'line_index', c.line_index,
           'position', c.position, 'chord_name', c.chord_name
         )), '[]'::jsonb)
    into v_chords
    from line_chords c
    join lines l on l.id = c.line_id
    join sections s on s.id = l.section_id
   where s.song_id = v_invite.song_id;

  return jsonb_build_object(
    'title', v_title,
    'view_only', v_invite.view_only,
    'notes', v_notes,
    'chords', v_chords
  );
end;
$$;

revoke all on function get_shared_song(text) from public;
grant execute on function get_shared_song(text) to anon, authenticated;

-- ─── 4. Demo guests live 3 days, not 1 ──────────────────────────────────────
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
      and created_at < now() - interval '3 days'
    returning 1
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end;
$$;

revoke all on function cleanup_guest_users() from public, anon, authenticated;
