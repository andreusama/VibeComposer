// Reuses the same bottom-sheet shell as ToolsSheet/LanguageSheet (.ts-*
// classes) — a variant is a brand-new, fully independent note (own id,
// text, chords, comments) that just happens to share its origin's
// thread_index, so the thread groups them into one swipeable slot. No
// nested/parent-child data anywhere in this.
export default function VariantChoiceSheet({ onClose, onChoose }) {
  return (
    <div className="ts-backdrop" onClick={onClose}>
      <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="ts-sub-head"><h2>Nueva variante</h2></div>
        <p className="vc-hint">Mismo hueco en el hilo — luego deslizas entre ellas.</p>
        <button className="vc-option" onClick={() => onChoose(false)}>
          <span className="vc-option-icon">+</span>
          <span className="vc-option-body">
            <span className="vc-option-title">Empezar de cero</span>
            <span className="vc-option-sub">página en blanco, mismo hueco</span>
          </span>
        </button>
        <button className="vc-option" onClick={() => onChoose(true)}>
          <span className="vc-option-icon">⧉</span>
          <span className="vc-option-body">
            <span className="vc-option-title">Empezar con el texto actual</span>
            <span className="vc-option-sub">copia esta parte y reescribe</span>
          </span>
        </button>
      </div>
    </div>
  );
}
