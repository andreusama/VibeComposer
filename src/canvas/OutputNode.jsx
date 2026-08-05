import { useState, useCallback, useRef } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { resolveMainThreadPath, saveOutputTitle, deleteOutputNode } from './canvasData.js';
import { beginSave, endSave } from './saveStatus.js';

const HANDLE_STYLE = { width: 10, height: 10, background: '#1D1C1A', border: '2px solid #fff' };

function summarizeProgression(cp) {
  if (!cp?.progression?.length) return null;
  const chords = cp.progression.map((c) => c.chord).filter(Boolean);
  return chords.length ? chords.join(' · ') : null;
}

// A short, human label for a fork candidate — enough to tell two branches
// apart in the picker without needing to go find the actual note on canvas.
function candidateLabel(byId, candidate) {
  const note = byId.get(candidate.target_note_id);
  if (!note) return 'deleted note';
  const label = note.custom_label || note.type;
  const text = note.lines?.[0]?.text?.trim();
  return text ? `${label}: "${text.slice(0, 24)}${text.length > 24 ? '…' : ''}"` : label;
}

export default function OutputNode({ id, data, selected }) {
  const { output, notes = [], links = [], progressionsById = {}, selections = {}, onDeleted, onSelectBranch } = data;
  const [title, setTitle] = useState(output.title || '');
  const saveTimer = useRef(null);

  const byId = new Map(notes.map((n) => [n.id, n]));
  const path = output.plugged_note_id
    ? resolveMainThreadPath(notes, links, output.plugged_note_id, selections)
    : [];

  const handleTitleChange = useCallback((e) => {
    const val = e.target.value;
    setTitle(val);
    if (saveTimer.current) endSave();
    clearTimeout(saveTimer.current);
    beginSave();
    saveTimer.current = setTimeout(async () => {
      await saveOutputTitle(id, val);
      endSave();
    }, 500);
  }, [id]);

  const handleDelete = useCallback(async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this mix?')) return;
    await deleteOutputNode(id);
    onDeleted?.(id);
  }, [id, onDeleted]);

  return (
    <div className={`canvas-output${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={260} minHeight={160} isVisible={selected} />
      <Handle type="target" position={Position.Left} id="output-in" style={HANDLE_STYLE} title="plug a note in to render the final result" />

      <div className="output-head">
        <div className="output-head-left">
          <span className="output-eyebrow">Final mix</span>
          <input
            className="output-title nodrag"
            value={title}
            placeholder="untitled mix"
            onChange={handleTitleChange}
          />
        </div>
        <button className="output-delete nodrag" onClick={handleDelete} title="delete this mix">✕</button>
      </div>

      <div className="output-body nodrag nowheel">
        {!path.length ? (
          <p className="output-empty">plug a note in to render the song here</p>
        ) : (
          path.map(({ note, fork }) => {
            const line = note.lines?.[0];
            const chordSummary = summarizeProgression(progressionsById[note.chord_progression_id]);
            const chosenLinkId = selections[note.id];
            return (
              <div className="output-line" key={note.id}>
                <div className="output-line-head">
                  <span className="output-line-type">{note.type}{note.custom_label ? ` · ${note.custom_label}` : ''}</span>
                  {chordSummary && <span className="output-line-chords">{chordSummary}</span>}
                </div>
                <p className="output-line-text">{line?.text || '—'}</p>

                {fork && (
                  <div className="output-fork nodrag">
                    <span className="output-fork-label">continues to</span>
                    {fork.map((candidate, i) => {
                      const isChosen = chosenLinkId ? chosenLinkId === candidate.id : i === 0;
                      return (
                        <button
                          key={candidate.id}
                          className={`output-fork-btn${isChosen ? ' chosen' : ''}`}
                          onClick={() => onSelectBranch?.(output.id, note.id, candidate.id)}
                        >
                          {candidateLabel(byId, candidate)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
