import { useCallback } from 'react';
import { NodeResizer } from '@xyflow/react';
import { deleteBaulNode } from './canvasData.js';

// The entry point for the baúl / lyric_dna pipeline (see
// baulProcessor.js) — a standalone tool node like Tempo or vibe-compose,
// not part of the note main-thread, so it has no left/right handles.
// Clicking it opens the floating input panel (BaulFloatNode); the DB row
// this node owns is purely position/size, everything it actually produces
// lives on the song itself (songs.lyric_dna).
const STATUS_TITLE = {
  processing: 'procesando…',
  success: 'ADN lírico actualizado',
  error: 'no se ha podido procesar — inténtalo de nuevo',
};

export default function InspirationBlackHoleNode({ id, data, selected }) {
  const { onOpen, onDeleted, status } = data;

  const handleDelete = useCallback(async (e) => {
    e.stopPropagation();
    await deleteBaulNode(id);
    onDeleted?.(id);
  }, [id, onDeleted]);

  return (
    <div
      className={`baul-blackhole${selected ? ' selected' : ''}${status ? ` ${status}` : ''}`}
      onClick={() => onOpen?.(id)}
      title={status ? STATUS_TITLE[status] : 'abrir el baúl de inspiración'}
    >
      {/* keepAspectRatio so this always stays a circle, never an ellipse. */}
      <NodeResizer minWidth={90} minHeight={90} keepAspectRatio isVisible={selected} />
      <button className="baul-blackhole-delete nodrag" onClick={handleDelete} title="delete">✕</button>
      <span className="baul-blackhole-sparkle">{status === 'success' ? '✓' : status === 'error' ? '!' : '✦'}</span>
    </div>
  );
}
