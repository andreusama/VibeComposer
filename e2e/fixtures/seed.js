// Seeds a throwaway song straight through supabase-js (signed in as the same
// test account the browser uses) so a gesture test starts from known data
// instead of driving the whole create-song UI first. Everything it makes
// hangs off one song row, so deleting that song cascades the rest away.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../src/config.js';

export async function seedSongWithChord({ title, lines, chords }) {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({
    email: process.env.PLAYWRIGHT_TEST_EMAIL,
    password: process.env.PLAYWRIGHT_TEST_PASSWORD,
  });
  if (authErr) throw authErr;

  const { data: song, error: e1 } = await sb.from('songs').insert({ user_id: auth.user.id, title }).select().single();
  if (e1) throw e1;
  const { data: section, error: e2 } = await sb.from('sections').insert({ song_id: song.id, type: 'verse', position: 0 }).select().single();
  if (e2) throw e2;
  const { data: line, error: e3 } = await sb.from('lines').insert({ section_id: section.id, position: 0, text: lines.join('\n') }).select().single();
  if (e3) throw e3;
  if (chords?.length) {
    const rows = chords.map((c) => ({ line_id: line.id, line_index: c.lineIndex, position: c.position, chord_name: c.name }));
    const { error: e4 } = await sb.from('line_chords').insert(rows);
    if (e4) throw e4;
  }

  return {
    songId: song.id,
    lineId: line.id,
    async chordsNow() {
      const { data } = await sb.from('line_chords').select('line_index, position, chord_name').eq('line_id', line.id).order('line_index').order('position');
      return data;
    },
    async cleanup() {
      await sb.from('songs').delete().eq('id', song.id);
      await sb.auth.signOut({ scope: 'local' }); // 'global' (the default) would revoke the browser's session too
    },
  };
}
