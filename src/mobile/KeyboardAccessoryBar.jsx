import { useKeyboardInset } from './useKeyboardInset.js';
import { IcSyllables, IcMuse, IcRhyme, IcPencil, IcUndo, IcRedo } from './icons.jsx';

// The one accessory bar, docked to the top edge of the on-screen keyboard
// the whole time a lyric line is being edited — the iOS-Notes pattern. Web
// has no native inputAccessoryView, so it's anchored via `visualViewport`
// (useKeyboardInset), which still reflows on its own if the keyboard
// changes height (autocorrect / suggestion strip). Same icons always;
// Rima and Alternativa just go disabled when there's no text selection.
const keep = (e) => e.preventDefault(); // fires before click (incl. touch) → keeps the textarea focused + selection alive

export default function KeyboardAccessoryBar({
  syllablesOn, hasSelection, canUndo, canRedo,
  onToggleSyllables, onMuse, onRhyme, onAlternative, onUndo, onRedo,
}) {
  const kb = useKeyboardInset();
  return (
    <div className="kab" style={kb ? { bottom: kb } : undefined}>
      <div className="kab-scroll">
        <button
          className={`kab-btn${syllablesOn ? ' active' : ''}`}
          onMouseDown={keep}
          onClick={onToggleSyllables}
          aria-label="Contador de sílabas"
          aria-pressed={syllablesOn}
        ><IcSyllables /></button>
        <span className="kab-sep" />
        <button className="kab-btn" onMouseDown={keep} onClick={onMuse} aria-label="Musa"><IcMuse /></button>
        <button className="kab-btn" onMouseDown={keep} onClick={onRhyme} disabled={!hasSelection} aria-label="Rima"><IcRhyme /></button>
        <button className="kab-btn" onMouseDown={keep} onClick={onAlternative} disabled={!hasSelection} aria-label="Alternativa"><IcPencil /></button>
        <span className="kab-sep" />
        <button className="kab-btn" onMouseDown={keep} onClick={onUndo} disabled={!canUndo} aria-label="Deshacer"><IcUndo /></button>
        <button className="kab-btn" onMouseDown={keep} onClick={onRedo} disabled={!canRedo} aria-label="Rehacer"><IcRedo /></button>
      </div>
    </div>
  );
}
