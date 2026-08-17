import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  loadCanvasData, createNote, summarizeProgression, saveSongTitle, saveSongLyricSettings,
  loadLyricDna, loadTempoNodes, createTempoNode, saveTempoBpm,
} from './canvasData.js';
import { deleteSong } from '../screens/projectsData.js';
import { DIALECTS } from '../utils/rhyme.js';
import { findRepeatedWords } from '../utils/repeatedWords.js';
import { splitIntoLines } from '../utils/textLines.js';
import MobileScreen from '../mobile/MobileScreen.jsx';
import FabMenu from '../mobile/FabMenu.jsx';
import NoteEditorScreen from '../mobile/NoteEditorScreen.jsx';
import BaulSheet from '../mobile/BaulSheet.jsx';
import TempoPulse from '../mobile/TempoPulse.jsx';

function describeAdjacentNote(note) {
  return { type: note.custom_label || note.type, text: note.lines?.[0]?.text || '' };
}

const LANGUAGE_LABELS = { es: 'Castellano', ca: 'Català' };
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "···" — design ref (2026-08-10 mockup): Language & dialect / Rename /
// Duplicate / Export / Delete project. Duplicate and Export have no backend
// behind them anywhere in this app yet (not even on desktop) — shown but
// disabled rather than half-built.
function SongMenu({ langLabel, bpmLabel, onOpenLanguage, onOpenTempo, onRename, onRepeatedWords, onDelete, onClose }) {
  return (
    <div className="thread-menu-backdrop" onClick={onClose}>
      <div className="thread-menu" onClick={(e) => e.stopPropagation()}>
        <button className="thread-menu-item" onClick={onOpenLanguage}>
          <div className="thread-menu-main">
            <div className="thread-menu-label">Language &amp; dialect</div>
            <div className="thread-menu-sublabel">{langLabel}</div>
          </div>
          <span className="thread-menu-icon">🌐</span>
        </button>
        <button className="thread-menu-item" onClick={onOpenTempo}>
          <div className="thread-menu-main">
            <div className="thread-menu-label">Tempo</div>
            <div className="thread-menu-sublabel">{bpmLabel}</div>
          </div>
          <span className="thread-menu-icon">◍</span>
        </button>
        <button className="thread-menu-item" onClick={onRename}>
          <div className="thread-menu-label">Rename</div>
          <span className="thread-menu-icon">✎</span>
        </button>
        <button className="thread-menu-item" onClick={onRepeatedWords}>
          <div className="thread-menu-label">Repeated words</div>
          <span className="thread-menu-icon">🔁</span>
        </button>
        <button className="thread-menu-item" disabled title="coming soon">
          <div className="thread-menu-label">Duplicate</div>
          <span className="thread-menu-icon">⧉</span>
        </button>
        <button className="thread-menu-item" disabled title="coming soon">
          <div className="thread-menu-label">Export</div>
          <span className="thread-menu-icon">⇧</span>
        </button>
        <button className="thread-menu-item thread-menu-danger" onClick={onDelete}>
          <div className="thread-menu-label">Delete project</div>
          <span className="thread-menu-icon">🗑</span>
        </button>
      </div>
    </div>
  );
}

// Deliberately not tied to any chord progression (see the note on
// songBpm below) — a single plain bpm value for the whole song, set here.
function TempoSheet({ bpm, onSave, onClose }) {
  const [value, setValue] = useState(String(bpm || 120));
  const parsed = parseInt(value, 10);
  const valid = Number.isFinite(parsed) && parsed >= 20 && parsed <= 300;

  return (
    <div className="ts-backdrop" onClick={onClose}>
      <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="ts-sub-head"><h2>Tempo</h2></div>
        <div className="tempo-sheet-row">
          <input
            className="tempo-sheet-input"
            type="number"
            inputMode="numeric"
            min="20"
            max="300"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <span className="tempo-sheet-unit">BPM</span>
        </div>
        <button className="tempo-sheet-save" disabled={!valid} onClick={() => valid && onSave(parsed)}>
          Save
        </button>
      </div>
    </div>
  );
}

// Song-wide check — the note editor's own Tools drawer has the same
// action scoped to just the open note (see ToolsSheet.jsx); this is the
// "across everything" counterpart, reachable from the "···" menu since it
// isn't tied to any one note. Computed eagerly on open rather than behind
// its own "Check" button — unlike the Tools row (one action among several
// in a shared sheet), this sheet's only purpose IS this result, so there's
// no reason to make that a second tap.
function RepeatedWordsSheet({ notes, onClose }) {
  const results = useMemo(
    () => findRepeatedWords(notes.map((n) => n.lines?.[0]?.text || '')),
    [notes]
  );
  return (
    <div className="ts-backdrop" onClick={onClose}>
      <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="ts-sub-head"><h2>Repeated words</h2></div>
        <p className="ts-repeat-scope-hint">across the whole song</p>
        {results.length === 0 ? (
          <p className="ts-empty">no repeats found across the song</p>
        ) : (
          <div className="ts-repeat-results">
            <ul>{results.map((r) => <li key={r.word}><strong>{r.word}</strong> × {r.count}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Same selector as the desktop toolbar (CanvasScreen's .canvas-rhyme-select)
// — same two functions (DIALECTS, saveSongLyricSettings), a bottom-sheet
// shape instead of two inline <select>s.
function LanguageSheet({ language, dialect, onChangeLanguage, onChangeDialect, onClose }) {
  return (
    <div className="ts-backdrop" onClick={onClose}>
      <div className="ts-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="ts-sub-head"><h2>Language &amp; dialect</h2></div>
        <div className="lang-sheet-group">
          <div className="lang-sheet-group-label">Language</div>
          {Object.keys(LANGUAGE_LABELS).map((lang) => (
            <button
              key={lang}
              className={`lang-sheet-option${language === lang ? ' active' : ''}`}
              onClick={() => onChangeLanguage(lang)}
            >
              {LANGUAGE_LABELS[lang]}
              {language === lang && <span className="lang-sheet-check">✓</span>}
            </button>
          ))}
        </div>
        {DIALECTS[language].length > 1 && (
          <div className="lang-sheet-group">
            <div className="lang-sheet-group-label">Dialect</div>
            {DIALECTS[language].map((d) => (
              <button
                key={d}
                className={`lang-sheet-option${dialect === d ? ' active' : ''}`}
                onClick={() => onChangeDialect(d)}
              >
                {capitalize(d)}
                {dialect === d && <span className="lang-sheet-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Notes are a flat table — a "variant" is just another independent note
// that happens to share thread_index with another (see
// migration_mobile_thread_index.sql). Grouping is pure presentation: bucket
// by thread_index, sort buckets by that same value, done. No parent/child
// relationship anywhere in this. Notes without a thread_index (created on
// desktop, which never touches this column) each get their own singleton
// slot rather than being silently dropped.
function groupNotesByThreadIndex(notes) {
  const byIndex = new Map();
  const singles = [];
  for (const n of notes) {
    if (n.thread_index == null) { singles.push({ threadIndex: null, members: [n] }); continue; }
    if (!byIndex.has(n.thread_index)) byIndex.set(n.thread_index, []);
    byIndex.get(n.thread_index).push(n);
  }
  const groups = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([threadIndex, members]) => ({ threadIndex, members }));
  return [...groups, ...singles];
}

function SongThreadCard({ note, chordSummary, onOpen }) {
  const label = note.type === 'custom' ? (note.custom_label || 'custom') : note.type;
  const text = note.lines?.[0]?.text || '';
  // Real verse lines, not word-wrapped ones — the old version rendered the
  // whole text (embedded \n and all) as one flowing <p> with line-clamp,
  // which collapses \n to a plain space (HTML's default whitespace
  // handling) and then truncates by wrapped-character-width, not by real
  // line boundaries — two actual different lines could fuse into one
  // run-on sentence with the cut landing mid-word. Each real line is now
  // its own block-level span, so the preview shows the poem's actual
  // structure. Blank stanza-break lines are dropped here specifically —
  // they'd just waste space in a compact preview.
  const realLines = splitIntoLines(text).filter(Boolean);
  const visibleLines = realLines.slice(0, 3);
  const moreCount = Math.max(0, realLines.length - 3);

  return (
    <button className="thread-card" onClick={onOpen}>
      <div className="thread-card-head">
        <span className="thread-card-type">{label}</span>
        {chordSummary && <span className="thread-card-chords">{chordSummary}</span>}
      </div>
      {visibleLines.length > 0 ? (
        <div className={`thread-card-preview${moreCount > 0 ? ' thread-card-preview-fade' : ''}`}>
          {visibleLines.map((line, i) => <span className="ln" key={i}>{line}</span>)}
        </div>
      ) : (
        <p className="thread-card-text"><span className="thread-card-empty">write…</span></p>
      )}
      {moreCount > 0 && <div className="thread-card-more">+{moreCount} more line{moreCount === 1 ? '' : 's'}</div>}
      <div className="thread-card-foot">
        <span>{note.annotationCount || 0} note{note.annotationCount === 1 ? '' : 's'}</span>
      </div>
    </button>
  );
}

// One slot in the thread. A single-member group renders exactly like any
// other card; 2+ members (variants of the same slot) render as a
// horizontal scroll-snap carousel with plain page dots below — no visible
// count/label beyond the dots themselves (index is purely internal, not
// user-facing — deliberately just "classic iPhone" dots, current one
// filled, the rest hollow).
function ThreadSlot({ group, progressionsById, onOpen }) {
  const [active, setActive] = useState(0);
  const scrollRef = useRef(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !el.clientWidth) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  }, []);

  // Deleting a variant that isn't the first in its slot shrinks
  // group.members without remounting this component (the .thread-item key
  // is the first member's id, which didn't change) — `active` can be left
  // pointing past the new end of the array, so no dot renders as active
  // and the scroll position is still wherever the now-gone card used to
  // be. Snap both back to the nearest valid page whenever the count drops
  // under the current active index.
  useEffect(() => {
    if (active < group.members.length) return;
    const next = Math.max(0, group.members.length - 1);
    setActive(next);
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: next * el.clientWidth });
  }, [group.members.length, active]);

  if (group.members.length === 1) {
    const note = group.members[0];
    return (
      <SongThreadCard
        note={note}
        chordSummary={summarizeProgression(progressionsById[note.chord_progression_id])}
        onOpen={() => onOpen(note.id)}
      />
    );
  }

  return (
    <div className="thread-slot">
      <div className="thread-slot-scroll" ref={scrollRef} onScroll={handleScroll}>
        {group.members.map((note) => (
          <div className="thread-slot-page" key={note.id}>
            <SongThreadCard
              note={note}
              chordSummary={summarizeProgression(progressionsById[note.chord_progression_id])}
              onOpen={() => onOpen(note.id)}
            />
          </div>
        ))}
      </div>
      <div className="thread-slot-dots">
        {group.members.map((_, i) => (
          <span key={i} className={`thread-slot-dot${i === active ? ' active' : ''}`} />
        ))}
      </div>
    </div>
  );
}

function InsertAffordance({ pending, onClick }) {
  return (
    <button className="thread-insert" onClick={onClick} disabled={pending} title="insert a note here">
      <span className="thread-insert-dot">{pending ? '…' : '+'}</span>
    </button>
  );
}

export default function SongThreadScreen({ state, onExit }) {
  const song = state.activeSong;
  const [notes, setNotes] = useState([]);
  const [progressions, setProgressions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Three separate insert paths, three separate mid-request guards — each
  // is a genuinely different action (append at the end, insert at a
  // specific slot, add a variant to an existing slot), not duplicates of
  // one another.
  const [appending, setAppending] = useState(false);
  const [pendingBetweenIndex, setPendingBetweenIndex] = useState(null);
  // The note currently open in the full-screen editor, or null for the
  // thread list — local state, not a global `screen` change, same reasoning
  // as CanvasScreen's selectedNoteId: this is a view within "being inside a
  // song," not a whole new place in the app.
  const [openNoteId, setOpenNoteId] = useState(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [langSheetOpen, setLangSheetOpen] = useState(false);
  const [repeatedWordsOpen, setRepeatedWordsOpen] = useState(false);
  const [tempoSheetOpen, setTempoSheetOpen] = useState(false);
  const [baulOpen, setBaulOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(song?.title || '');
  // Local, not read straight from `song` on every render — same reasoning
  // as CanvasScreen's lyricLanguage/lyricDialect state: the prop only
  // updates on a fresh navigation, so a change made from this sheet needs
  // its own state to actually reflect immediately.
  const [lyricLanguage, setLyricLanguage] = useState(song?.lyric_language || 'es');
  const [lyricDialect, setLyricDialect] = useState(song?.lyric_dialect || 'central');
  // Same object CanvasScreen loads for the desktop muse/baúl — the mobile
  // muse popover needs it for the exact same reason (CÓMO/QUÉ hierarchy in
  // buildStaticMuseInstructions). The song's whole-song context is the
  // real raw text (songStructure), not a separate stored field — there's
  // no song-wide state to hold here beyond lyricDna.
  const [lyricDna, setLyricDna] = useState(null);
  const [tempoNodes, setTempoNodes] = useState([]);

  useEffect(() => {
    setTitleDraft(song?.title || '');
    setLyricLanguage(song?.lyric_language || 'es');
    setLyricDialect(song?.lyric_dialect || 'central');
  }, [song?.id]);

  useEffect(() => {
    if (!song?.id) { setLyricDna(null); setTempoNodes([]); return; }
    let cancelled = false;
    loadLyricDna(song.id).then(({ data }) => { if (!cancelled) setLyricDna(data?.lyric_dna || {}); });
    loadTempoNodes(song.id).then(({ data }) => { if (!cancelled) setTempoNodes(data || []); });
    return () => { cancelled = true; };
  }, [song?.id]);

  const handleLyricDnaUpdated = useCallback((next) => setLyricDna(next), []);

  useEffect(() => {
    if (!song?.id) return;
    let cancelled = false;
    setLoading(true);
    loadCanvasData(song.id).then(({ notes: n, progressions: p, error }) => {
      if (cancelled) return;
      setNotes(n);
      setProgressions(p);
      setLoadError(error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [song?.id]);

  const groups = useMemo(() => groupNotesByThreadIndex(notes), [notes]);
  const progressionsById = useMemo(
    () => Object.fromEntries(progressions.map((p) => [p.id, p])),
    [progressions]
  );
  // Desktop's tempo_nodes are meant to be plugged into a specific chord
  // progression (chord_progressions.tempo_node_id) for beat-accurate
  // playback — deliberately NOT how mobile reads tempo. There's no
  // playback UI on mobile yet and no chord-progression-assignment flow
  // either, so tying the pulse to that chain would mean it could never
  // show anything in practice. Mobile treats tempo as one plain value for
  // the whole song instead: whichever tempo_node happens to exist for this
  // song (there's normally at most one, created directly from the "···"
  // menu's Tempo action, never via a chord progression), same value shown
  // in both the thread header and every note's own header.
  const songTempoNode = tempoNodes[0] || null;
  const songBpm = songTempoNode?.bpm ?? null;

  // Refetch rather than hand-patching local state because a fresh note
  // also needs a lines[0] row (created server-side by createNote) that's
  // simplest to just read back rather than reconstruct here.
  const reload = useCallback(() => {
    if (!song?.id) return;
    return loadCanvasData(song.id).then(({ notes: n, progressions: p, error }) => {
      setNotes(n);
      setProgressions(p);
      setLoadError(error);
    });
  }, [song?.id]);

  // Gapped by 10 on purpose (see migration_mobile_thread_index.sql) — an
  // append is always "highest existing + 10", never "+1", so a later
  // insert-between always has room for a clean midpoint without a
  // cascading renumber.
  const handleAppend = useCallback(async () => {
    if (!song?.id || appending) return;
    setAppending(true);
    try {
      const maxIndex = notes.reduce((max, n) => (n.thread_index != null && n.thread_index > max ? n.thread_index : max), 0);
      const { note, error } = await createNote(song.id, { x: 0, y: 0 }, { threadIndex: maxIndex + 10 });
      if (error || !note) return;
      await reload();
    } finally {
      setAppending(false);
    }
  }, [song?.id, notes, appending, reload]);

  // Operates on the two neighboring *slots* (their shared thread_index),
  // not individual notes — inserting next to a 3-variant slot inserts next
  // to the whole slot, not next to whichever variant happens to be first.
  const handleInsertBetween = useCallback(async (prevGroup, nextGroup) => {
    if (!song?.id || pendingBetweenIndex != null) return;
    setPendingBetweenIndex(prevGroup.threadIndex);
    try {
      const prevIdx = prevGroup.threadIndex ?? 0;
      const nextIdx = nextGroup.threadIndex ?? (prevIdx + 20);
      const midIdx = Math.floor((prevIdx + nextIdx) / 2);
      // Gap exhausted (adjacent integers) — nothing sensible to insert
      // without a full renumber, which isn't built yet (flagged in the
      // migration's header comment as a deferred edge case).
      if (midIdx === prevIdx || midIdx === nextIdx) return;
      const { note, error } = await createNote(song.id, { x: 0, y: 0 }, { threadIndex: midIdx });
      if (error || !note) return;
      await reload();
    } finally {
      setPendingBetweenIndex(null);
    }
  }, [song?.id, pendingBetweenIndex, reload]);

  // "Variant" — a brand-new independent note sharing its origin's
  // thread_index, optionally seeded with a copy of the origin's current
  // text. Jumps straight into editing it, same as append/insert-between's
  // "create then go there" feel.
  const handleCreateVariant = useCallback(async (originNote, startWithCurrentText) => {
    if (!song?.id) return;
    const text = startWithCurrentText ? (originNote.lines?.[0]?.text || '') : '';
    const { note, error } = await createNote(
      song.id,
      { x: (originNote.canvas_x || 0) + 40, y: (originNote.canvas_y || 0) + 40 },
      { threadIndex: originNote.thread_index, text, type: originNote.type, customLabel: originNote.custom_label }
    );
    if (error || !note) return;
    await reload();
    setOpenNoteId(note.id);
  }, [song?.id, reload]);

  const handleNoteTextChange = useCallback((noteId, text) => {
    setNotes((prev) => prev.map((n) => (
      n.id === noteId ? { ...n, lines: [{ ...n.lines?.[0], text }] } : n
    )));
  }, []);

  const handleNoteTypeChange = useCallback((noteId, type, customLabel) => {
    setNotes((prev) => prev.map((n) => (
      n.id === noteId ? { ...n, type, custom_label: customLabel } : n
    )));
  }, []);

  const handleNoteDeleted = useCallback(() => {
    setOpenNoteId(null);
    reload();
  }, [reload]);

  const commitRename = useCallback(() => {
    setRenaming(false);
    const title = titleDraft.trim();
    if (!song?.id || title === (song.title || '')) return;
    saveSongTitle(song.id, title);
  }, [song?.id, song?.title, titleDraft]);

  const handleLanguageChange = useCallback((language) => {
    const dialect = DIALECTS[language][0];
    setLyricLanguage(language);
    setLyricDialect(dialect);
    if (song?.id) saveSongLyricSettings(song.id, language, dialect);
  }, [song?.id]);

  const handleDialectChange = useCallback((dialect) => {
    setLyricDialect(dialect);
    if (song?.id) saveSongLyricSettings(song.id, lyricLanguage, dialect);
  }, [song?.id, lyricLanguage]);

  const handleDeleteProject = useCallback(async () => {
    setMenuOpen(false);
    if (!song?.id) return;
    if (!confirm(`Delete "${song.title || 'this project'}"? This can't be undone.`)) return;
    await deleteSong(song.id);
    onExit();
  }, [song?.id, song?.title, onExit]);

  // Creates the song's one tempo_node on first save, updates it from then
  // on — mobile never needs more than one (no per-progression tempo
  // switching UI here), so "does this song already have a tempo_node" is
  // enough to decide create vs. update.
  const handleSaveTempo = useCallback(async (bpm) => {
    if (!song?.id) return;
    if (songTempoNode) {
      await saveTempoBpm(songTempoNode.id, bpm);
    } else {
      const { data: node, error } = await createTempoNode(song.id, { x: 0, y: 0 });
      if (error || !node) return;
      await saveTempoBpm(node.id, bpm);
    }
    setTempoSheetOpen(false);
    const { data } = await loadTempoNodes(song.id);
    setTempoNodes(data || []);
  }, [song?.id, songTempoNode]);

  if (!song) return null;

  const langLabel = DIALECTS[lyricLanguage].length > 1
    ? `${LANGUAGE_LABELS[lyricLanguage]} · ${capitalize(lyricDialect)}`
    : LANGUAGE_LABELS[lyricLanguage];

  const openNote = openNoteId ? notes.find((n) => n.id === openNoteId) : null;
  if (openNote) {
    // "Before"/"after" context for the muse is between *slots*, not
    // individual variants — a variant's groupmates aren't textually before
    // or after it, they're alternates for the same spot, so each earlier/
    // later slot contributes just its first member as a representative.
    const openGroupIndex = groups.findIndex((g) => g.members.some((m) => m.id === openNote.id));
    const songStructure = openGroupIndex === -1 ? { before: [], after: [] } : {
      before: groups.slice(0, openGroupIndex).map((g) => describeAdjacentNote(g.members[0])),
      after: groups.slice(openGroupIndex + 1).map((g) => describeAdjacentNote(g.members[0])),
    };
    return (
      <NoteEditorScreen
        note={openNote}
        userId={state.session?.user?.id}
        lyricLanguage={lyricLanguage}
        lyricDialect={lyricDialect}
        songId={song.id}
        lyricDna={lyricDna}
        songStructure={songStructure}
        onLyricDnaUpdated={handleLyricDnaUpdated}
        chordSummary={summarizeProgression(progressionsById[openNote.chord_progression_id])}
        bpm={songBpm}
        onClose={() => setOpenNoteId(null)}
        onTextChange={handleNoteTextChange}
        onTypeChange={handleNoteTypeChange}
        onDeleted={handleNoteDeleted}
        onCreateVariant={(startWithCurrentText) => handleCreateVariant(openNote, startWithCurrentText)}
      />
    );
  }

  return (
    <MobileScreen className="thread-screen">
      <div className="thread-header">
        <button className="thread-back" onClick={onExit} title="back to projects">‹</button>
        <div className="thread-title-block">
          {renaming ? (
            <input
              className="thread-title-input"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
            />
          ) : (
            <h1 className="thread-title">{titleDraft || 'Untitled'}</h1>
          )}
          <div className="thread-lang-pill">
            <button className="thread-lang-btn" onClick={() => setLangSheetOpen(true)}>{langLabel}</button>
            <TempoPulse bpm={songBpm} onClick={() => setTempoSheetOpen(true)} />
            <span className="thread-lang-chevron">›</span>
          </div>
        </div>
        <button className="thread-menu-btn" onClick={() => setMenuOpen(true)} title="more">···</button>
      </div>

      {menuOpen && (
        <SongMenu
          langLabel={langLabel}
          bpmLabel={songBpm ? `${songBpm} BPM` : 'not set'}
          onOpenLanguage={() => { setMenuOpen(false); setLangSheetOpen(true); }}
          onOpenTempo={() => { setMenuOpen(false); setTempoSheetOpen(true); }}
          onRename={() => { setMenuOpen(false); setRenaming(true); }}
          onRepeatedWords={() => { setMenuOpen(false); setRepeatedWordsOpen(true); }}
          onDelete={handleDeleteProject}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {tempoSheetOpen && (
        <TempoSheet bpm={songBpm} onSave={handleSaveTempo} onClose={() => setTempoSheetOpen(false)} />
      )}
      {repeatedWordsOpen && (
        <RepeatedWordsSheet notes={notes} onClose={() => setRepeatedWordsOpen(false)} />
      )}
      {langSheetOpen && (
        <LanguageSheet
          language={lyricLanguage}
          dialect={lyricDialect}
          onChangeLanguage={handleLanguageChange}
          onChangeDialect={handleDialectChange}
          onClose={() => setLangSheetOpen(false)}
        />
      )}

      <div className="thread-body">
        {loading && <p className="thread-status">Loading…</p>}
        {loadError && <p className="thread-status thread-status-error">Couldn't load this song.</p>}

        {!loading && !loadError && groups.length === 0 && (
          <div className="thread-empty">
            <p>No notes yet.</p>
          </div>
        )}

        {!loading && !loadError && groups.map((group, i) => (
          <div className="thread-item" key={group.members[0].id}>
            <ThreadSlot group={group} progressionsById={progressionsById} onOpen={setOpenNoteId} />
            {i < groups.length - 1 && (
              <InsertAffordance
                pending={pendingBetweenIndex === group.threadIndex}
                onClick={() => handleInsertBetween(group, groups[i + 1])}
              />
            )}
          </div>
        ))}
      </div>

      {/* Replaces the old plain "+" FAB — "Añadir nota" covers the same
          append-at-end action. The between-slot circles above stay: they
          insert at a specific spot, a genuinely different action from
          appending, not a duplicate of it. */}
      <FabMenu
        pills={[
          { label: 'Baúl de la inspiración', icon: '✦', dark: true, onClick: () => setBaulOpen(true) },
          { label: 'Añadir nota', icon: '+', onClick: handleAppend, disabled: appending },
        ]}
      />

      {baulOpen && (
        <BaulSheet
          songId={song.id}
          lyricDna={lyricDna}
          onLyricDnaUpdated={handleLyricDnaUpdated}
          onClose={() => setBaulOpen(false)}
        />
      )}
    </MobileScreen>
  );
}
