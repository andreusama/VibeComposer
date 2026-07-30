import { Handle, Position, NodeResizer } from '@xyflow/react';
import { buildMainThreadChains } from './canvasData.js';

const HANDLE_STYLE = { width: 10, height: 10, background: '#1D1C1A', border: '2px solid #fff' };

function summarizeProgression(cp) {
  if (!cp?.progression?.length) return null;
  const chords = cp.progression.map((c) => c.chord).filter(Boolean);
  return chords.length ? chords.join(' · ') : null;
}

export default function OutputNode({ data, selected }) {
  const { output, notes = [], links = [], progressionsById = {} } = data;

  const chains = buildMainThreadChains(notes, links);
  const chain = output.plugged_note_id
    ? chains.find((c) => c.some((n) => n.id === output.plugged_note_id))
    : null;

  return (
    <div className={`canvas-output${selected ? ' selected' : ''}`}>
      {/* No delete affordance anywhere on this node, and the node object
          itself is created with deletable:false — belt and suspenders
          against Backspace/Delete removing the one node every song needs. */}
      <NodeResizer minWidth={260} minHeight={160} isVisible={selected} />
      <Handle type="target" position={Position.Left} id="output-in" style={HANDLE_STYLE} title="plug a note in to render the final result" />

      <div className="output-head">
        <span className="output-eyebrow">Final mix</span>
      </div>

      <div className="output-body nodrag nowheel">
        {!chain ? (
          <p className="output-empty">plug a note in to render the song here</p>
        ) : (
          chain.map((note) => {
            const line = note.lines?.[0];
            const chordSummary = summarizeProgression(progressionsById[note.chord_progression_id]);
            return (
              <div className="output-line" key={note.id}>
                <div className="output-line-head">
                  <span className="output-line-type">{note.type}{note.custom_label ? ` · ${note.custom_label}` : ''}</span>
                  {chordSummary && <span className="output-line-chords">{chordSummary}</span>}
                </div>
                <p className="output-line-text">{line?.text || '—'}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
