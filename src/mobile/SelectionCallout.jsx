// The entry point to everything in this spec — a lightweight pill that
// appears right where the user just selected text, offering the ways to
// act on it. Positioned in fixed/viewport coordinates from the selection's
// own DOMRect (captured in LineRow), clamped so it never runs off the right
// edge on a narrow phone.
//
// Real constraint, not addressed elsewhere: selecting text in the
// underlying <textarea> also brings up the OS's own native edit menu
// (Copy/Paste/Select — Apple HIG's "Selection and input"), which a web
// view has no way to detect the position of or suppress. HIG's own
// guidance is to append custom commands after the system ones rather than
// build a parallel menu, which isn't reachable from here — a plain
// <textarea> gives no hook into UIMenuController. The one thing that IS
// fixable from here: the native bubble hugs the selection tightly (roughly
// a system-toolbar's height), so this pill sits further below it than a
// generic tooltip offset would, to come to rest under the native menu
// instead of stacked directly on top of it.
export default function SelectionCallout({ rect, onRhyme, onAskMuse, onConcept, onGenealogy }) {
  if (!rect) return null;
  const style = {
    top: rect.bottom + 40,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)),
  };
  return (
    <div className="sel-callout" style={style}>
      {/* preventDefault on mousedown (fires before the click, including on
          touch) keeps the textarea's selection/focus alive — without this,
          tapping the pill blurs the textarea first and the selection this
          button is supposed to act on is already gone by the time onClick
          fires. Same trick TextNoteNode uses on desktop. */}
      <button className="sel-callout-btn" onMouseDown={(e) => e.preventDefault()} onClick={onRhyme}>
        ↔ Rhyme
      </button>
      {/* Concept explorer's own entry point (creativity proposal #3): one
          tap on any selected word/phrase gets real, voice-fit words related
          to it BY MEANING — the concept-filter WORD_BANK path added for the
          "ala" + "volar" request, given a direct doorway instead of only
          being reachable by phrasing a free-text ask just right. */}
      <button className="sel-callout-btn" onMouseDown={(e) => e.preventDefault()} onClick={onConcept}>
        ✧ Concept
      </button>
      {/* "Genealogía de la imagen" — its own dedicated doorway (explicitly
          requested separate from Concept/SOCRATIC): real universal-culture
          references (literature, myth, art, film) for a word/idea, not
          rhyme-adjacent vocabulary. See museApi.js's getImageGenealogy. */}
      <button className="sel-callout-btn" onMouseDown={(e) => e.preventDefault()} onClick={onGenealogy}>
        🏛 Genealogía
      </button>
      <button className="sel-callout-btn" onMouseDown={(e) => e.preventDefault()} onClick={onAskMuse}>
        ✦ Ask muse
      </button>
    </div>
  );
}
