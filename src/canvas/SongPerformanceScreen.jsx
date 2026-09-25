import { useMemo } from 'react';
import { SECTION_TYPE_LABELS } from './canvasData.js';
import { splitIntoLines } from '../utils/textLines.js';
import MobileScreen from '../mobile/MobileScreen.jsx';
import { IcChevronLeft } from '../mobile/icons.jsx';

// "Sing the whole song" mode — a real gap the thread list doesn't cover:
// every card there is capped to a 3-line preview, built for composing one
// block at a time, not for reading the song straight through. This is a
// full takeover (same pattern as NoteEditorScreen's own openNote branch in
// SongThreadScreen.jsx), not a sheet — one continuous, large-type, manual
// scroll of every block's REAL COMPLETE text, in the song's actual order.
// Lyrics only, no chords (explicit product call — keeps it purely readable
// at a glance while performing); empty blocks are skipped entirely, since
// a blank verse has nothing to offer here.
export default function SongPerformanceScreen({ title, groups, onClose }) {
  // groups is the only real dependency — splitIntoLines runs across every
  // block's full text, so this shouldn't redo the work on a render triggered
  // by something unrelated bubbling through from the parent thread screen.
  const sections = useMemo(() => groups
    .map((g) => g.members[0]) // a variant's groupmates are alternates for the same slot, not separate content — show the first/active one
    .map((note) => ({
      id: note.id,
      label: note.type === 'custom' ? (note.custom_label || SECTION_TYPE_LABELS.custom) : SECTION_TYPE_LABELS[note.type] || note.type,
      lines: splitIntoLines(note.lines?.[0]?.text || '').filter(Boolean),
    }))
    .filter((s) => s.lines.length > 0), [groups]);

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
            return (
              <div className="perf-section" key={s.id}>
                <div className="perf-section-label">{heading}</div>
                {s.lines.map((line, i) => <p className="perf-line" key={i}>{line}</p>)}
              </div>
            );
          })
        )}
      </div>
    </MobileScreen>
  );
}
