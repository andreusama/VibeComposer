// ─── Projects data layer ────────────────────────────────────────────────────
// Shared between home.js (desktop grid) and MobileProjectsScreen.jsx (mobile
// list) — both show "every song the user owns" with a small preview of its
// note graph, they just render that data differently (HTML-string grid vs.
// React list). Kept here once so the Supabase queries and preview math don't
// drift between the two.

import { supabase } from '../utils/supabaseClient.js';
import { withTimeout } from '../utils/withTimeout.js';

export async function loadProjectSummaries() {
  try {
    return await withTimeout(fetchProjectSummaries());
  } catch (err) {
    return { songs: [], albums: [], error: err.message };
  }
}

const SONG_COLUMNS = 'id, title, updated_at, lyric_language, lyric_dialect';

async function fetchProjectSummaries() {
  // album_id/track_position come from migration_albums.sql, which creates
  // the albums table in the same script — so the two queries below either
  // both succeed or both belong to a not-yet-migrated DB, and nothing about
  // one depends on the other's result. Run them together instead of paying
  // two sequential round trips on every project-screen load.
  const [songsRes, albumsRes] = await Promise.all([
    supabase.from('songs').select(`${SONG_COLUMNS}, album_id, track_position, sort_order`).order('updated_at', { ascending: false }),
    supabase.from('albums').select('id, title, updated_at, sort_order').order('updated_at', { ascending: false }),
  ]);
  let { data, error } = songsRes;
  let albums = albumsRes.data || [];

  if (error) {
    // Pre-migration DB: the plain columns still work (every song then reads
    // as a single, no albums) rather than taking the whole projects screen
    // down over a pending migration. The albums table isn't there either.
    ({ data, error } = await supabase.from('songs').select(SONG_COLUMNS).order('updated_at', { ascending: false }));
    albums = [];
  }

  if (error) return { songs: [], albums: [], error: error.message };

  const withLines = await attachLineCounts(data);
  const songs = await attachPreviewData(withLines);
  return { songs, albums, error: null };
}

// One extra round trip to show a lyrics status chip with the same weight as
// the chords chip — otherwise the dashboard visually implies chords are the
// primary artifact and lyrics are secondary, which isn't the point of a
// project that can start from either side.
async function attachLineCounts(songs) {
  const songIds = songs.map((s) => s.id);
  if (!songIds.length) return songs;

  const { data: sections } = await supabase
    .from('sections').select('id, song_id').in('song_id', songIds);
  const sectionToSong = Object.fromEntries((sections || []).map((s) => [s.id, s.song_id]));
  const sectionIds = Object.keys(sectionToSong);
  if (!sectionIds.length) return songs.map((s) => ({ ...s, lineCount: 0 }));

  const { data: lines } = await supabase
    .from('lines').select('section_id').in('section_id', sectionIds);

  const counts = {};
  (lines || []).forEach((l) => {
    const songId = sectionToSong[l.section_id];
    counts[songId] = (counts[songId] || 0) + 1;
  });

  return songs.map((s) => ({ ...s, lineCount: counts[s.id] || 0 }));
}

// Chord-progression counts, every note's position/status (nodeCount reads
// off the full list; previewNodes below caps it to 6 — enough for a
// thumbnail sketch without pulling every field the real canvas needs), and
// their main-thread links.
async function attachPreviewData(songs) {
  const songIds = songs.map((s) => s.id);
  if (!songIds.length) return songs;

  const [{ data: progressions }, { data: sections }, { data: links }] = await Promise.all([
    supabase.from('chord_progressions').select('id, song_id').in('song_id', songIds),
    supabase.from('sections').select('id, song_id, canvas_x, canvas_y, lines(status)').in('song_id', songIds),
    supabase.from('note_links').select('song_id, source_note_id, target_note_id').in('song_id', songIds).eq('type', 'main-thread'),
  ]);

  const progressionCounts = {};
  (progressions || []).forEach((p) => { progressionCounts[p.song_id] = (progressionCounts[p.song_id] || 0) + 1; });

  const sectionsBySong = {};
  (sections || []).forEach((s) => { (sectionsBySong[s.song_id] ||= []).push(s); });

  const linksBySong = {};
  (links || []).forEach((l) => { (linksBySong[l.song_id] ||= []).push(l); });

  return songs.map((s) => ({
    ...s,
    progressionCount: progressionCounts[s.id] || 0,
    nodeCount: (sectionsBySong[s.id] || []).length,
    previewNodes: (sectionsBySong[s.id] || []).sort((a, b) => (a.canvas_x || 0) - (b.canvas_x || 0)).slice(0, 6),
    previewLinks: linksBySong[s.id] || [],
  }));
}

// Normalizes real canvas_x/canvas_y positions into a 0-100 percentage space
// so the thumbnail is a genuine (if tiny) reflection of that project's
// actual note layout and thread connections, not a generic decoration. Pure
// data out (no markup) — the HTML-string grid and the React list each format
// `lines`/`points` into their own markup.
export function computePreviewLayout(nodes, links) {
  if (!nodes.length) return { points: [], lines: [] };

  const PAD = 18;
  const xs = nodes.map((n) => n.canvas_x || 0);
  const ys = nodes.map((n) => n.canvas_y || 0);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const positions = {};
  const points = nodes.map((n) => {
    const x = spanX ? PAD + ((n.canvas_x || 0) - minX) / spanX * (100 - PAD * 2) : 50;
    const y = spanY ? PAD + ((n.canvas_y || 0) - minY) / spanY * (100 - PAD * 2) : 50;
    positions[n.id] = { x, y };
    return { x, y, status: n.lines?.[0]?.status || 'provisional' };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const lines = links
    .filter((l) => nodeIds.has(l.source_note_id) && nodeIds.has(l.target_note_id))
    .map((l) => {
      const a = positions[l.source_note_id];
      const b = positions[l.target_note_id];
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });

  return { points, lines };
}

export async function deleteSong(id) {
  // Every table that references songs.id is `on delete cascade` (schema.sql)
  // — sections, lines, chord_progressions, note_links, etc. all go with it,
  // no manual cleanup needed here.
  return supabase.from('songs').delete().eq('id', id);
}

// title is overridable so debug-only flows (see MuseEyeScreen's "new mock
// song") can mark what they create — a real song row, nothing fake about
// it, just clearly labeled so it never gets mistaken for real work.
export async function createProject(userId, title = 'Sin título', { albumId = null, trackPosition = 0, sortOrder = 0 } = {}) {
  // album_id/track_position/sort_order are only sent when they matter, so
  // creating a plain single keeps working even before migration_albums.sql
  // has run.
  const albumFields = albumId
    ? { album_id: albumId, track_position: trackPosition }
    : (sortOrder ? { sort_order: sortOrder } : {});
  const { data: song, error } = await supabase
    .from('songs')
    .insert({ user_id: userId, title, ...albumFields })
    .select()
    .single();

  if (error) return { error: error.message };
  return { song: { ...song, lineCount: 0, progressionCount: 0, nodeCount: 0, previewNodes: [], previewLinks: [] } };
}

// ─── Albums ─────────────────────────────────────────────────────────────────
// An album is only a container — a song with album_id = null is a single.
// Its tracks are just the songs pointing at it (state.songs filtered by
// album_id), so there's no per-album song list to keep in sync.

export async function createAlbum(userId, title = 'Sin título', sortOrder = 0) {
  const { data, error } = await supabase
    .from('albums')
    .insert({ user_id: userId, title, ...(sortOrder ? { sort_order: sortOrder } : {}) })
    .select()
    .single();
  if (error) return { error: error.message };
  return { album: data };
}

export async function renameAlbum(id, title) {
  return supabase.from('albums').update({ title }).eq('id', id);
}

// Deleting an album keeps its songs — `songs.album_id` is `on delete set
// null` (migration_albums.sql), so they simply become singles again.
export async function deleteAlbum(id) {
  return supabase.from('albums').delete().eq('id', id);
}

export function tracksOfAlbum(songs, albumId) {
  return songs
    .filter((s) => s.album_id === albumId)
    .sort((a, b) => (a.track_position || 0) - (b.track_position || 0));
}

// Moves a song into an album (albumId) or back out to being a single (null).
// Moving in appends it as the last track (trackPosition); moving out puts it
// at the top of the projects list (sortOrder) instead of leaving it at a
// stale value that would collide with the current order.
export async function moveSongToAlbum(songId, albumId, { trackPosition = 0, sortOrder = 0 } = {}) {
  return supabase
    .from('songs')
    .update(albumId
      ? { album_id: albumId, track_position: trackPosition }
      : { album_id: null, track_position: 0, sort_order: sortOrder })
    .eq('id', songId);
}

// Pure counterpart for the local state.songs copy, so the UI can update
// optimistically and revert on a failed write.
export function applySongMove(songs, songId, albumId, { trackPosition = 0, sortOrder = 0 } = {}) {
  return songs.map((s) => {
    if (s.id !== songId) return s;
    return albumId
      ? { ...s, album_id: albumId, track_position: trackPosition }
      : { ...s, album_id: null, track_position: 0, sort_order: sortOrder };
  });
}

export function nextTrackPosition(songs, albumId) {
  return songs
    .filter((s) => s.album_id === albumId)
    .reduce((max, s) => Math.max(max, s.track_position || 0), 0) + 1;
}

// A sort_order that lands above everything in the projects list (singles and
// albums share one order; tracks inside albums don't count).
export function topSortOrder(songs, albums) {
  const orders = [
    ...songs.filter((s) => !s.album_id).map((s) => s.sort_order || 0),
    ...albums.map((a) => a.sort_order || 0),
  ];
  return orders.length ? Math.min(...orders) - 1 : 0;
}

// Persists a new order after a drag. Only rows whose value actually changed
// are written. `table`/`column` pick the projects order (songs+albums by
// sort_order) or an album's track order (songs by track_position).
async function writeOrder(updates) {
  const results = await Promise.all(updates.map(({ table, id, column, value }) => supabase.from(table).update({ [column]: value }).eq('id', id)));
  return results.find((r) => r.error)?.error || null;
}

export function saveProjectOrder(changes) {
  return writeOrder(changes.map((c) => ({ table: c.kind === 'album' ? 'albums' : 'songs', id: c.id, column: 'sort_order', value: c.value })));
}

export function saveTrackOrder(changes) {
  return writeOrder(changes.map((c) => ({ table: 'songs', id: c.id, column: 'track_position', value: c.value })));
}
