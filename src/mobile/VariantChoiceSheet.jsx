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
        <div className="ts-sub-head"><h2>New variant</h2></div>
        <p className="vc-hint">Same slot in the thread — swipe between them later.</p>
        <button className="vc-option" onClick={() => onChoose(false)}>
          <span className="vc-option-icon">+</span>
          <span className="vc-option-body">
            <span className="vc-option-title">Start from scratch</span>
            <span className="vc-option-sub">a blank page, same slot</span>
          </span>
        </button>
        <button className="vc-option" onClick={() => onChoose(true)}>
          <span className="vc-option-icon">⧉</span>
          <span className="vc-option-body">
            <span className="vc-option-title">Start with current text</span>
            <span className="vc-option-sub">copy this note, then rewrite</span>
          </span>
        </button>
      </div>
    </div>
  );
}
