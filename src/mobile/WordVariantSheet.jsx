import { useState, useEffect, useMemo } from 'react';
import { IcRadioOn, IcRadioOff, IcClose, IcPlus } from './icons.jsx';

// Attach / manage alternative wordings for a span of words in a line (see
// wordVariantData.js). Two ways in:
//  - `draft` set  → creating: the selected phrase is the first wording, add
//    one or more alternatives.
//  - `variant` set → managing: reorder which wording is live, edit the list,
//    or drop the alternatives entirely.
// Reuses the ToolsSheet bottom-sheet shell (.ts-* classes).
export default function WordVariantSheet({ variant, draft, onClose, onCreate, onSave, onDelete }) {
  const creating = !!draft;
  const [options, setOptions] = useState(() =>
    creating ? [draft.text, ''] : (variant?.options?.length ? [...variant.options] : ['']),
  );
  const [activeIndex, setActiveIndex] = useState(() => (creating ? 0 : (variant?.active_index ?? 0)));

  // The variant vanished from under us (deleted elsewhere) — nothing to manage.
  useEffect(() => { if (!creating && !variant) onClose(); }, [creating, variant, onClose]);

  const filled = useMemo(() => options.map((o) => o.trim()).filter(Boolean), [options]);
  const canSave = filled.length >= 2;

  const setOption = (i, value) => setOptions((cur) => cur.map((o, j) => (j === i ? value : o)));
  const addOption = () => setOptions((cur) => [...cur, '']);
  const removeOption = (i) => setOptions((cur) => {
    const next = cur.filter((_, j) => j !== i);
    setActiveIndex((a) => (i < a ? a - 1 : Math.min(a, next.length - 1)));
    return next;
  });

  const handleSave = () => {
    // Re-map activeIndex onto the trimmed/compacted list.
    const compact = [];
    let nextActive = 0;
    options.forEach((o, i) => {
      const t = o.trim();
      if (!t) return;
      if (i === activeIndex) nextActive = compact.length;
      compact.push(t);
    });
    if (compact.length < 2) {
      if (creating) { onClose(); return; }
      onDelete(variant);
      return;
    }
    if (creating) onCreate(draft, compact);
    else onSave(variant, compact, nextActive);
  };

  return (
    <div className="ts-backdrop" onClick={onClose}>
      <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="ts-sub-head"><h2>{creating ? 'Redacción alternativa' : 'Redacciones'}</h2></div>
        <p className="vc-hint">
          {creating
            ? 'El verso conserva la primera redacción — toca el subrayado luego para cambiarla.'
            : 'Toca una redacción para ponerla en el verso.'}
        </p>

        <div className="wv-option-list">
          {options.map((opt, i) => (
            <div className={`wv-option-row${i === activeIndex ? ' active' : ''}`} key={i}>
              <button
                className="wv-option-radio"
                onClick={() => setActiveIndex(i)}
                title="usar esta redacción"
              >{i === activeIndex ? <IcRadioOn size={18} /> : <IcRadioOff size={18} />}</button>
              <input
                className="wv-option-input"
                value={opt}
                placeholder={i === 0 ? 'redacción' : 'otra redacción…'}
                onChange={(e) => setOption(i, e.target.value)}
              />
              {options.length > 1 && (
                <button className="wv-option-del" onClick={() => removeOption(i)} title="quitar"><IcClose size={15} /></button>
              )}
            </div>
          ))}
        </div>

        <button className="wv-add" onClick={addOption}><IcPlus size={15} /> añadir redacción</button>

        <div className="wv-actions">
          {!creating && (
            <button className="wv-remove-all" onClick={() => onDelete(variant)}>Quitar alternativas</button>
          )}
          <span className="wv-actions-spacer" />
          <button className="wv-cancel" onClick={onClose}>Cancelar</button>
          <button className="wv-save" disabled={!canSave} onClick={handleSave}>
            {creating ? 'Añadir' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
