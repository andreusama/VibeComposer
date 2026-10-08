import { useKeyboardInset } from './useKeyboardInset.js';
import { IcMuse, IcRhyme, IcPencil, IcUndo, IcRedo, IcBook, IcMic, IcQuote } from './icons.jsx';

// The one accessory bar, docked to the top edge of the on-screen keyboard
// the whole time a lyric line is being edited — the iOS-Notes pattern. Web
// has no native inputAccessoryView, so it's anchored via `visualViewport`
// (useKeyboardInset), which still reflows on its own if the keyboard
// changes height (autocorrect / suggestion strip). Same icons always;
// Rima and Alternativa just go disabled when there's no text selection.
const keep = (e) => e.preventDefault(); // fires before click (incl. touch) → keeps the textarea focused + selection alive

export default function KeyboardAccessoryBar({
  hasSelection, canUndo, canRedo,
  onMuse, onRhyme, onAlternative, onCulture, onResource, onUndo, onRedo, onAudio,
}) {
  const kb = useKeyboardInset();
  return (
    <div className="kab" style={kb ? { bottom: kb } : undefined}>
      <div className="kab-scroll">
        <button className="kab-btn" onMouseDown={keep} onClick={onMuse} aria-label="Musa"><IcMuse /></button>
        <button className="kab-btn" onMouseDown={keep} onClick={onRhyme} disabled={!hasSelection} aria-label="Rima"><IcRhyme /></button>
        <button className="kab-btn" onMouseDown={keep} onClick={onAlternative} disabled={!hasSelection} aria-label="Alternativa"><IcPencil /></button>
        <button className="kab-btn" onMouseDown={keep} onClick={onCulture} disabled={!hasSelection} aria-label="Ángulo cultural"><IcBook /></button>
        {/* No disabled={!hasSelection} on purpose — unlike Rima/Alternativa/
            Ángulo cultural, Recursos doesn't need a target phrase to act on:
            with a selection it replaces it, with just a caret it inserts
            there instead (see handleOpenResourcePicker). This bar only ever
            renders while a line is focused, so there's always somewhere to
            insert into. */}
        <button className="kab-btn" onMouseDown={keep} onClick={onResource} aria-label="Recursos"><IcQuote /></button>
        <span className="kab-sep" />
        <button className="kab-btn" onMouseDown={keep} onClick={onUndo} disabled={!canUndo} aria-label="Deshacer"><IcUndo /></button>
        <button className="kab-btn" onMouseDown={keep} onClick={onRedo} disabled={!canRedo} aria-label="Rehacer"><IcRedo /></button>
        <span className="kab-sep" />
        {/* Jumps straight to the audio sheet without a separate tap-away —
            the common case is finishing a verse and wanting to hum/record
            it right away. */}
        <button className="kab-btn" onMouseDown={keep} onClick={onAudio} aria-label="Grabar audio"><IcMic /></button>
      </div>
    </div>
  );
}
