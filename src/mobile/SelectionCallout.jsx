// The entry point to everything in this spec — a bar docked to the bottom
// of the screen (thumb zone) whenever there's an active selection, offering
// the ways to act on it. `rect` is only used as the "is a selection active"
// signal now, not for positioning — see the .sel-callout CSS comment for
// why: iOS's native edit menu (Copy/Paste/Select) is OS-level chrome that
// always paints above web content and always hugs the selection tightly,
// so floating near the selection put this callout's own buttons in the
// exact zone native chrome covers, making them untappable on a real
// device. Docking to the bottom edge — a zone the native menu never
// reaches — is the actual fix, not a positioning tweak.
export default function SelectionCallout({ rect, onRhyme, onAskMuse, onConcept, onGenealogy, onAlternative }) {
  if (!rect) return null;
  return (
    <div className="sel-callout">
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
      {/* Attach an alternative wording to these words — they then carry a
          coloured underline, tap it to swap wordings in place. */}
      {onAlternative && (
        <button className="sel-callout-btn" onMouseDown={(e) => e.preventDefault()} onClick={onAlternative}>
          ✎ Alternativa
        </button>
      )}
    </div>
  );
}
