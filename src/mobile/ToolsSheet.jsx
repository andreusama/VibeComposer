import { useState, useEffect, useCallback } from 'react';
import { findRepeatedWords } from '../utils/repeatedWords.js';
import { loadAnnotations, addAnnotation, deleteAnnotation } from '../canvas/canvasData.js';
import { IcClose, IcComment, IcChevronLeft, IcChevronRight } from './icons.jsx';

// A comment about the WHOLE note — not the same thing as a selection-
// anchored comment (not built yet: taps a text range, shown with an amber
// underline in place). Same `annotations` table, just null start/end
// offset (see loadAnnotations' comment in canvasData.js) — the two never
// get confused because they're filtered apart by offset presence, not by
// which UI created them.
function WholeVerseCommentTab({ lineId, userId, comments, setComments }) {
  const [body, setBody] = useState('');

  const handleAdd = useCallback(async () => {
    const text = body.trim();
    if (!text || !userId) return;
    const { data, error } = await addAnnotation(lineId, userId, text, null);
    if (error) return;
    setComments((c) => [...c, data]);
    setBody('');
  }, [body, lineId, userId, setComments]);

  return (
    <div className="ts-tab">
      {comments.length === 0 && <p className="ts-empty">aún no hay apuntes sobre esta parte</p>}
      {comments.map((c) => (
        <div className="ts-annotation-row" key={c.id}>
          <div className="ts-annotation-main">
            <p className="ts-annotation-body">{c.body}</p>
            <div className="ts-row-actions">
              <button title="borrar apunte" onClick={async () => { await deleteAnnotation(c.id); setComments((prev) => prev.filter((item) => item.id !== c.id)); }}><IcClose size={14} /></button>
            </div>
          </div>
        </div>
      ))}
      <div className="ts-add-col">
        <textarea value={body} placeholder="un apunte sobre el conjunto…" onChange={(e) => setBody(e.target.value)} />
        <div className="ts-add-row">
          <button onClick={handleAdd}>+ Añadir</button>
        </div>
      </div>
    </div>
  );
}

// Variants (now created via the FAB's "Variant" pill — an independent note
// sharing thread_index, not a nested list here) and History used to live
// in this sheet too — their backend functions (canvasData.js's
// line_variants/section_versions calls) are untouched, this sheet just
// stopped exposing them. Selection-anchored comments (Genius-style, an
// amber underline in the text itself) still aren't built — that one needs
// a different rendering approach than a plain <textarea> allows, tracked
// separately.
export default function ToolsSheet({
  open, onClose, lineId, userId, chordSummary,
  noteText,
  syllableCountOn, onToggleSyllableCount, focusModeOn, onToggleFocusMode,
}) {
  const [sub, setSub] = useState(null); // null | 'comment'
  const [loadingComments, setLoadingComments] = useState(true);
  const [comments, setComments] = useState([]);
  const [repeatResults, setRepeatResults] = useState(null);

  useEffect(() => {
    if (!open) { setSub(null); setRepeatResults(null); return; }
    let cancelled = false;
    setLoadingComments(true);
    loadAnnotations(lineId).then(({ data }) => {
      if (cancelled) return;
      // Whole-verse comments only — a real start/end_offset means it's a
      // selection-anchored comment (not built yet), a different list.
      setComments((data || []).filter((a) => a.start_offset == null && a.end_offset == null));
      setLoadingComments(false);
    });
    return () => { cancelled = true; };
  }, [open, lineId]);

  // Scoped to this one note, not the whole song (that's the song-thread
  // screen's own "Repeated words" menu action) — a single verse rarely
  // repeats a word 3+ times, findRepeatedWords' own default, so the
  // threshold drops to 2 here or the check would almost never find
  // anything at this scope.
  const handleCheckRepeats = useCallback(() => {
    setRepeatResults(findRepeatedWords([noteText], { minCount: 2 }));
  }, [noteText]);

  if (!open) return null;

  return (
    <div className="ts-backdrop" onClick={onClose}>
      <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />

        {sub === 'comment' ? (
          <>
            <div className="ts-sub-head">
              <button className="ts-back" onClick={() => setSub(null)}><IcChevronLeft size={20} /></button>
              <h2>Apunte de la parte</h2>
            </div>
            {loadingComments ? (
              <p className="ts-empty">cargando…</p>
            ) : (
              <WholeVerseCommentTab lineId={lineId} userId={userId} comments={comments} setComments={setComments} />
            )}
          </>
        ) : (
          <div className="ts-list">
            {/* First and visually distinct on purpose — the one genuinely
                new row here, everything else already existed. */}
            <button className="ts-row ts-row-disclosure ts-row-featured" onClick={() => setSub('comment')}>
              <span className="ts-row-icon"><IcComment size={19} /></span>
              <div className="ts-row-main">
                <div className="ts-row-label">Apunte de la parte</div>
                <div className="ts-row-sublabel">un apunte sobre el conjunto</div>
              </div>
              <span className="ts-row-count">{loadingComments ? '…' : comments.length}</span>
              <span className="ts-chevron"><IcChevronRight size={15} /></span>
            </button>

            <div className="ts-row">
              <div className="ts-row-main">
                <div className="ts-row-label">Contador de sílabas</div>
                <div className="ts-row-sublabel">en el margen izquierdo</div>
              </div>
              <label className="ts-toggle">
                <input type="checkbox" checked={syllableCountOn} onChange={onToggleSyllableCount} />
                <span className="ts-toggle-track"><span className="ts-toggle-thumb" /></span>
              </label>
            </div>

            <div className="ts-row">
              <div className="ts-row-main">
                <div className="ts-row-label">Modo foco</div>
                <div className="ts-row-sublabel">atenúa todo menos el verso actual</div>
              </div>
              <label className="ts-toggle">
                <input type="checkbox" checked={focusModeOn} onChange={onToggleFocusMode} />
                <span className="ts-toggle-track"><span className="ts-toggle-thumb" /></span>
              </label>
            </div>

            <div className="ts-row">
              <div className="ts-row-main">
                <div className="ts-row-label">Palabras repetidas</div>
                <div className="ts-row-sublabel">dentro de esta parte</div>
              </div>
              <button className="ts-run" onClick={handleCheckRepeats}>Comprobar</button>
            </div>
            {repeatResults && (
              <div className="ts-repeat-results">
                {repeatResults.length === 0 ? (
                  <p className="ts-empty">sin repeticiones en esta parte</p>
                ) : (
                  <ul>{repeatResults.map((r) => <li key={r.word}><strong>{r.word}</strong> × {r.count}</li>)}</ul>
                )}
              </div>
            )}

            <button className="ts-row ts-row-disclosure" disabled title="asignar acordes — próximamente">
              <div className="ts-row-main">
                <div className="ts-row-label">Asignar acordes</div>
                <div className="ts-row-sublabel">{chordSummary || 'ninguno aún'}</div>
              </div>
              <span className="ts-chevron"><IcChevronRight size={15} /></span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
