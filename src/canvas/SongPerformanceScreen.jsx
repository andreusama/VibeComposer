import { useEffect, useMemo, useState } from 'react';
import { SECTION_TYPE_LABELS } from './canvasData.js';
import { splitIntoLines } from '../utils/textLines.js';
import { loadLineChordsForLines } from './lineChordData.js';
import MobileScreen from '../mobile/MobileScreen.jsx';
import LineChordStrip from '../components/LineChordStrip.jsx';
import { IcChevronLeft } from '../mobile/icons.jsx';

// "Sing the whole song" mode — a real gap the thread list doesn't cover:
// every card there is capped to a 3-line preview, built for composing one
// block at a time, not for reading the song straight through. This is a
// full takeover (same pattern as NoteEditorScreen's own openNote branch in
// SongThreadScreen.jsx), not a sheet — one continuous, large-type, manual
// scroll of every block's REAL COMPLETE text, in the song's actual order.
// Chords ARE shown here now (2026-10-20 — reversed an earlier "lyrics
// only, keeps it purely readable" call, on explicit request: a performer
// reading straight through the song wants to see the chord changes too,
// not just the words); empty blocks are skipped entirely, since a blank
// verse has nothing to offer here.
export default function SongPerformanceScreen({ title, groups, onClose }) {
  // groups is the only real dependency — splitIntoLines runs across every
  // block's full text, so this shouldn't redo the work on a render triggered
  // by something unrelated bubbling through from the parent thread screen.
  //
  // Each line keeps its ORIGINAL lineIndex (the unfiltered split's own
  // position), not just its position in this filtered array — line_chords
  // is keyed by that original index (same as NoteEditorScreen's own
  // `lines`, which never filters blanks out), so losing it here would
  // shift every chord onto the wrong line the moment a block has even one
  // blank line before a chorded one.
  const sections = useMemo(() => groups
    .map((g) => g.members[0]) // a variant's groupmates are alternates for the same slot, not separate content — show the first/active one
    .map((note) => ({
      id: note.id,
      lineId: note.lines?.[0]?.id ?? null,
      label: note.type === 'custom' ? (note.custom_label || SECTION_TYPE_LABELS.custom) : SECTION_TYPE_LABELS[note.type] || note.type,
      lines: splitIntoLines(note.lines?.[0]?.text || '')
        .map((text, lineIndex) => ({ text, lineIndex }))
        .filter((l) => l.text),
    }))
    .filter((s) => s.lines.length > 0), [groups]);

  // Every section's chords, in one request — see loadLineChordsForLines'
  // own comment for why this is batched rather than one query per block.
  // Keyed by lineId (the block's own text-row id, which `position`/
  // `line_index` are scoped under) so a section whose note has since been
  // deleted/changed id simply shows no chords rather than stale ones.
  const [chordsByLineId, setChordsByLineId] = useState({});
  useEffect(() => {
    const lineIds = [...new Set(sections.map((s) => s.lineId).filter(Boolean))];
    if (!lineIds.length) { setChordsByLineId({}); return undefined; }
    let cancelled = false;
    loadLineChordsForLines(lineIds).then(({ data }) => {
      if (cancelled || !data) return;
      const map = {};
      data.forEach((c) => {
        (map[c.line_id] ??= {});
        (map[c.line_id][c.line_index] ??= []).push({ id: c.id, chordName: c.chord_name, position: c.position });
      });
      Object.values(map).forEach((byLine) => {
        Object.values(byLine).forEach((arr) => arr.sort((a, b) => a.position - b.position));
      });
      setChordsByLineId(map);
    });
    return () => { cancelled = true; };
    // sections is derived fresh every render from `groups` — depend on the
    // actual lineId SET (its own stable string), not the array identity,
    // or this would refetch on every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.map((s) => s.lineId).join(',')]);

  // Only number repeats of the same label ("Verso 1", "Verso 2") — a song
  // with a single chorus just reads "Estribillo", not "Estribillo 1".
  const totalByLabel = useMemo(() => {
    const counts = {};
    sections.forEach((s) => { counts[s.label] = (counts[s.label] || 0) + 1; });
    return counts;
  }, [sections]);
  const seenByLabel = {};

  return (
    <MobileScreen className="perf-screen">
      <div className="perf-header">
        <button className="thread-back" onClick={onClose} title="cerrar"><IcChevronLeft size={24} /></button>
        <h1 className="perf-title">{title || 'Sin título'}</h1>
      </div>
      <div className="perf-body">
        {sections.length === 0 ? (
          <p className="thread-status">Aún no hay letra que leer.</p>
        ) : (
          sections.map((s) => {
            seenByLabel[s.label] = (seenByLabel[s.label] || 0) + 1;
            const heading = totalByLabel[s.label] > 1 ? `${s.label} ${seenByLabel[s.label]}` : s.label;
            const sectionChords = chordsByLineId[s.lineId];
            return (
              <div className="perf-section" key={s.id}>
                <div className="perf-section-label">{heading}</div>
                {s.lines.map(({ text, lineIndex }) => {
                  const chords = sectionChords?.[lineIndex];
                  return (
                    <div
                      className={`perf-line-wrap${chords?.length ? ' perf-line-wrap-has-chords' : ''}`}
                      key={lineIndex}
                    >
                      <LineChordStrip text={text} chords={chords} readOnly />
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </MobileScreen>
  );
}
