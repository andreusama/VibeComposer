// The lifted thing itself, following the finger during a drag-onto-a-line
// gesture — fixed to the viewport (not whatever sheet it came from), so it
// stays put over whatever line it's currently hovering. Centered on the
// finger via .res-picker-drag-pill's own transform, not anchored to a
// corner. One component instead of one inline <div> per picker
// (ChordStrumSheet, ResourcePickerSheet) because the two had already
// drifted to use the same CSS class with a copy-pasted style prop each —
// content is the only thing that's actually picker-specific.
export default function LineDragPill({ x, y, className = '', children }) {
  return (
    <div className={`res-picker-drag-pill${className ? ` ${className}` : ''}`} style={{ left: x, top: y }}>
      {children}
    </div>
  );
}
