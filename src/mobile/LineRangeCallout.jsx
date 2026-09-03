// The action bar for a multi-line gutter selection (see NoteEditorScreen's
// lineRange). Same bottom-docked shell as SelectionCallout — a phone's
// native text selection can't span the per-line textareas, so tapping line
// numbers in the gutter is how you gather a block, and this is what you do
// with it once gathered.
export default function LineRangeCallout({ count, onAskMuse, onClear }) {
  return (
    <div className="sel-callout">
      <span className="sel-callout-count">{count} {count === 1 ? 'line' : 'lines'}</span>
      <button className="sel-callout-btn" onMouseDown={(e) => e.preventDefault()} onClick={onAskMuse}>
        ✦ Ask muse
      </button>
      <button className="sel-callout-btn" onMouseDown={(e) => e.preventDefault()} onClick={onClear}>
        ✕ Clear
      </button>
    </div>
  );
}
