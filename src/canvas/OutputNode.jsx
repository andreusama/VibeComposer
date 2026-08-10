import { useState, useCallback, useRef } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { resolveMainThreadPath, saveOutputTitle, deleteOutputNode } from './canvasData.js';
import { beginSave, endSave } from './saveStatus.js';
import { splitIntoLines } from '../utils/textLines.js';
import { classifyStanzaRhymes } from '../utils/rhyme.js';
import { countLineSyllables } from '../utils/syllables.js';

const HANDLE_STYLE = { width: 10, height: 10, background: '#1D1C1A', border: '2px solid #fff' };

function summarizeProgression(cp) {
  if (!cp?.progression?.length) return null;
  const chords = cp.progression.map((c) => c.chord).filter(Boolean);
  return chords.length ? chords.join(' · ') : null;
}

export default function OutputNode({ id, data, selected }) {
  const {
    output, notes = [], links = [], progressionsById = {}, onDeleted,
    lyricLanguage, lyricDialect,
  } = data;
  const [title, setTitle] = useState(output.title || '');
  const saveTimer = useRef(null);

  const path = output.plugged_note_id
    ? resolveMainThreadPath(notes, links, output.plugged_note_id)
    : [];

  const handleTitleChange = useCallback((e) => {
    const val = e.target.value;
    setTitle(val);
    if (saveTimer.current) endSave();
    clearTimeout(saveTimer.current);
    beginSave();
    saveTimer.current = setTimeout(async () => {
      try {
        await saveOutputTitle(id, val);
      } finally {
        endSave();
      }
    }, 500);
  }, [id]);

  const handleDelete = useCallback(async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this song?')) return;
    await deleteOutputNode(id);
    onDeleted?.(id);
  }, [id, onDeleted]);

  return (
    <div className={`canvas-output${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={260} minHeight={160} isVisible={selected} />
      <Handle type="target" position={Position.Left} id="output-in" style={HANDLE_STYLE} title="plug a note in to render the final result" />

      <div className="output-head">
        <div className="output-head-left">
          <span className="output-eyebrow">Final Song</span>
          <input
            className="output-title nodrag"
            value={title}
            placeholder="untitled song"
            onChange={handleTitleChange}
          />
        </div>
        <button className="output-delete nodrag" onClick={handleDelete} title="delete this song">✕</button>
      </div>

      {/* No nodrag here on purpose — the rendered lines are read-only text,
          not an editor, so clicking into them should behave like clicking
          any other blank part of the card: it drags the node. The title
          input keeps its own nodrag so that click still works as a click,
          not a drag start. */}
      <div className="output-body nowheel">
        {!path.length ? (
          <p className="output-empty">plug a note in to render the song here</p>
        ) : (
          path.map(({ note }) => {
            const line = note.lines?.[0];
            const chordSummary = summarizeProgression(progressionsById[note.chord_progression_id]);
            // Same per-note stanza scope the note itself uses (rhyme letters
            // restart at A per note, not across the whole song) — reusing
            // the identical computation the note's own gutter already runs,
            // just read-only here instead of scroll-synced to a textarea.
            const textLines = splitIntoLines(line?.text || '');
            const rhymeLines = classifyStanzaRhymes(textLines, lyricLanguage || 'es', lyricDialect || 'central');
            const syllableCounts = textLines.map((l) => (l ? countLineSyllables(l, lyricLanguage || 'es') : null));
            return (
              <div className="output-line" key={note.id}>
                <div className="output-line-head">
                  <span className="output-line-type">{note.type}{note.custom_label ? ` · ${note.custom_label}` : ''}</span>
                  {chordSummary && <span className="output-line-chords">{chordSummary}</span>}
                </div>
                <div className="output-line-text">
                  {textLines.length === 0 ? (
                    <p className="output-text-line-row"><span className="output-text-line">—</span></p>
                  ) : (
                    textLines.map((lineText, i) => (
                      <p className="output-text-line-row" key={i}>
                        <span className="output-text-line">{lineText || '—'}</span>
                        <span className="syllable-badge output-inline-badge">{syllableCounts[i] ?? ''}</span>
                        <span
                          className={`rhyme-badge output-inline-badge${rhymeLines[i].letter ? ` ${rhymeLines[i].type}` : ' empty'}`}
                          title={rhymeLines[i].internalRhymeWords.size ? 'also rhymes internally within this line' : undefined}
                        >
                          {rhymeLines[i].letter ?? '·'}
                        </span>
                      </p>
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
