// ─── Projects data layer ────────────────────────────────────────────────────
// Shared between home.js (desktop grid) and MobileProjectsScreen.jsx (mobile
// list) — both show "every song the user owns" with a small preview of its
// note graph, they just render that data differently (HTML-string grid vs.
// React list). Kept here once so the Supabase queries and preview math don't
// drift between the two.

import { supabase } from '../utils/supabaseClient.js';

export async function loadProjectSummaries() {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, updated_at, lyric_language, lyric_dialect')
    .order('updated_at', { ascending: false });

  if (error) return { songs: [], error: error.message };

  const withLines = await attachLineCounts(data);
  const songs = await attachPreviewData(withLines);
  return { songs, error: null };
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
export async function createProject(userId, title = 'untitled') {
  const { data: song, error } = await supabase
    .from('songs')
    .insert({ user_id: userId, title })
    .select()
    .single();

  if (error) return { error: error.message };
  return { song: { ...song, lineCount: 0, progressionCount: 0, nodeCount: 0, previewNodes: [], previewLinks: [] } };
}
