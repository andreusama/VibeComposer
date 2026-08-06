import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow, Background, addEdge, useReactFlow, useViewport,
  applyNodeChanges, applyEdgeChanges, ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TextNoteNode from './TextNoteNode.jsx';
import ChordProgressionNode from './ChordProgressionNode.jsx';
import OutputNode from './OutputNode.jsx';
import VibeComposeNode from './VibeComposeNode.jsx';
import TempoNode from './TempoNode.jsx';
import MuseFloatNode from './MuseFloatNode.jsx';
import NoteSidePanel from './NoteSidePanel.jsx';
import { setState } from '../state/store.js';
import { supabase } from '../utils/supabaseClient.js';
import { beginSave, endSave, subscribeSaveStatus } from './saveStatus.js';
import {
  loadCanvasData, createNote, createChordProgression, createVibeProgression,
  saveNotePosition, saveProgressionPosition,
  createMainThreadLink, deleteNoteLink, assignProgressionToNote, setProgressionTempo,
  deleteNote, deleteChordProgression,
  loadOutputNodes, createOutputNode, deleteOutputNode, saveOutputPosition, setOutputPluggedNote,
  loadOutputSelections, setOutputSelection, saveSongTitle, saveSongLyricSettings,
  loadTempoNodes, createTempoNode, saveTempoBpm, saveTempoPosition, deleteTempoNode,
} from './canvasData.js';
import { DIALECTS } from '../utils/rhyme.js';
import { loadMuseProfile } from './museData.js';

const NODE_TYPES = {
  textNote: TextNoteNode, chordProgression: ChordProgressionNode,
  outputNode: OutputNode, vibeCompose: VibeComposeNode, tempoNode: TempoNode,
  museFloat: MuseFloatNode,
};

// The pills a right-click on empty canvas offers, grouped by what they're
// for — writing the song's words vs. shaping what it sounds like.
const NODE_PILL_GROUPS = [
  {
    label: 'Text',
    pills: [
      { type: 'note', label: 'Text note', icon: '✎' },
      { type: 'output', label: 'Final Song', icon: '▤' },
    ],
  },
  {
    label: 'Music',
    pills: [
      { type: 'chord', label: 'Chord progression', icon: '♫' },
      { type: 'vibe', label: 'Vibe Progression', icon: '✦' },
      { type: 'tempo', label: 'Tempo', icon: '◍' },
    ],
  },
];
const NODE_PILL_COUNT = NODE_PILL_GROUPS.reduce((sum, g) => sum + g.pills.length, 0);

// React Flow needs a concrete numeric width/height for every node up front —
// leaving height undefined (canvas_height has no DB default, unlike
// canvas_width) means the node's box, and therefore where handles/edges
// anchor to it, is unresolved until content forces a size, which reads as
// edges/handles floating at the wrong spot relative to the note.
const DEFAULT_NOTE_HEIGHT = 160;
const DEFAULT_PROGRESSION_HEIGHT = 220;
const DEFAULT_OUTPUT_WIDTH = 320;
const DEFAULT_OUTPUT_HEIGHT = 240;
const DEFAULT_TEMPO_WIDTH = 160;
const DEFAULT_TEMPO_HEIGHT = 120;

// Matches Figma's default grid — fine enough to feel unobtrusive, coarse
// enough that "almost aligned" nodes stop happening.
const POSITION_SNAP = 8;
const snapToGrid = (v) => Math.round(v / POSITION_SNAP) * POSITION_SNAP;

function noteToFlowNode(note, callbacks) {
  return {
    id: note.id,
    type: 'textNote',
    position: { x: note.canvas_x || 0, y: note.canvas_y || 0 },
    width: note.canvas_width || 280,
    height: note.canvas_height || DEFAULT_NOTE_HEIGHT,
    data: { note, ...callbacks },
  };
}

function progressionToFlowNode(cp, callbacks) {
  return {
    id: cp.id,
    type: 'chordProgression',
    position: { x: cp.canvas_x || 0, y: cp.canvas_y || 0 },
    width: cp.canvas_width || 260,
    height: cp.canvas_height || DEFAULT_PROGRESSION_HEIGHT,
    data: { progression: cp, ...callbacks },
  };
}

// A song starts with one (see loadOutputNodes), but from there they're
// created/deleted like any other node — songs can hold several mix variants.
function outputToFlowNode(output, callbacks) {
  return {
    id: output.id,
    type: 'outputNode',
    position: { x: output.canvas_x || 0, y: output.canvas_y || 0 },
    width: output.canvas_width || DEFAULT_OUTPUT_WIDTH,
    height: output.canvas_height || DEFAULT_OUTPUT_HEIGHT,
    data: { output, ...callbacks },
  };
}

// Real song data (a bpm, and which progression it feeds) unlike the vibe
// tool, so it has a DB row and loads/saves position like every other node.
function tempoToFlowNode(tempo, callbacks) {
  return {
    id: tempo.id,
    type: 'tempoNode',
    position: { x: tempo.canvas_x || 0, y: tempo.canvas_y || 0 },
    width: tempo.canvas_width || DEFAULT_TEMPO_WIDTH,
    height: tempo.canvas_height || DEFAULT_TEMPO_HEIGHT,
    data: { bpm: tempo.bpm, ...callbacks },
  };
}

function outputPlugEdge(output) {
  if (!output.plugged_note_id) return null;
  return {
    id: `output-plug-${output.id}`,
    source: output.plugged_note_id,
    target: output.id,
    sourceHandle: 'right',
    targetHandle: 'output-in',
    type: 'default',
    style: { stroke: '#1D1C1A', strokeWidth: 1.5, opacity: 0.5 },
    data: { kind: 'output' },
  };
}

// A chord-progression node has exactly one handle ('assign'); a text note's
// dedicated chord input is 'chord' — always this pair, no ambiguity possible.
function assignmentEdges(notes) {
  return notes
    .filter((n) => n.chord_progression_id)
    .map((n) => ({
      id: `assign-${n.chord_progression_id}-${n.id}`,
      source: n.chord_progression_id,
      target: n.id,
      sourceHandle: 'assign',
      targetHandle: 'chord',
      type: 'straight',
      style: { stroke: '#4552D6', strokeDasharray: '4 3' },
      data: { kind: 'assignment' },
    }));
}

// A chord progression has exactly one tempo input ('tempo-in'); a tempo
// node has exactly one output ('tempo-out') — same one-to-one shape as the
// chord/text-note assignment above, just a different pair of node types.
function tempoAssignmentEdges(progressions) {
  return progressions
    .filter((p) => p.tempo_node_id)
    .map((p) => ({
      id: `tempo-plug-${p.tempo_node_id}-${p.id}`,
      source: p.tempo_node_id,
      target: p.id,
      sourceHandle: 'tempo-out',
      targetHandle: 'tempo-in',
      type: 'straight',
      style: { stroke: '#B8842A', strokeDasharray: '2 3' },
      data: { kind: 'tempo' },
    }));
}

function mainThreadEdges(links) {
  return links.map((l) => ({
    id: l.id,
    source: l.source_note_id,
    target: l.target_note_id,
    sourceHandle: 'right',
    targetHandle: 'left',
    type: 'default',
    style: { stroke: '#1F6F63', strokeWidth: 1.5, opacity: 0.6 },
    data: { kind: 'main-thread', position: l.position },
  }));
}

function summarizeProgression(cp) {
  if (!cp?.progression?.length) return null;
  const chords = cp.progression.map((c) => c.chord).filter(Boolean);
  return chords.length ? chords.join(' · ') : null;
}

// Needs to live inside <ReactFlowProvider> to call useReactFlow/useViewport
// — reads the live zoom level reactively instead of polling it.
function ZoomControl() {
  const { zoomIn, zoomOut } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="canvas-zoom">
      <button className="canvas-zoom-btn" onClick={() => zoomOut()} title="zoom out">−</button>
      <span className="canvas-zoom-pct">{Math.round(zoom * 100)}%</span>
      <button className="canvas-zoom-btn" onClick={() => zoomIn()} title="zoom in">+</button>
    </div>
  );
}

// The anchored "right-click to add a node" menu — a small cluster of pills
// anchored at the click point, replacing the old fixed toolbar buttons.
// Needs useReactFlow (screenToFlowPosition) to turn the screen-space click
// into a canvas position, so it lives inside the provider like ZoomControl.
const MENU_WIDTH = 208;
const MENU_ROW_HEIGHT = 42;
const MENU_GROUP_HEADER_HEIGHT = 26;

function CanvasContextMenu({ menu, onClose, onAdd }) {
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    if (!menu) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menu, onClose]);

  if (!menu) return null;

  const menuHeight = NODE_PILL_COUNT * MENU_ROW_HEIGHT + NODE_PILL_GROUPS.length * MENU_GROUP_HEADER_HEIGHT + 16;
  const left = Math.min(menu.x, window.innerWidth - MENU_WIDTH - 12);
  const top = Math.min(menu.y, window.innerHeight - menuHeight - 12);

  const handlePick = (type) => {
    onAdd(type, screenToFlowPosition({ x: menu.x, y: menu.y }));
    onClose();
  };

  return (
    <>
      <div className="canvas-menu-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="canvas-context-menu" style={{ left, top }}>
        {NODE_PILL_GROUPS.map((group) => (
          <div className="canvas-context-group" key={group.label}>
            <span className="canvas-context-group-label">{group.label}</span>
            {group.pills.map((p) => (
              <button key={p.type} className="canvas-context-pill" onClick={() => handlePick(p.type)}>
                <span className="canvas-context-pill-icon">{p.icon}</span>
                {p.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

// Reflects saves happening deep inside note/progression nodes (see
// saveStatus.js) — a plain subscription rather than prop-drilling, since
// the writes it's tracking happen several component layers away.
function SaveStatus() {
  const [pending, setPending] = useState(0);
  useEffect(() => subscribeSaveStatus(setPending), []);
  return (
    <span className="canvas-save-status">
      <span className={`canvas-save-dot${pending > 0 ? ' saving' : ''}`} />
      {pending > 0 ? 'saving…' : 'saved'}
    </span>
  );
}

export default function CanvasScreen({ state, onExit }) {
  const song = state.activeSong;
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  // Per-mix fork choices: [{ output_id, source_note_id, note_link_id }, ...].
  // Kept flat and filtered per-node in renderNodes rather than nested inside
  // each output's own data, since a single connect/delete action elsewhere
  // never needs to touch this.
  const [selections, setSelections] = useState([]);
  // Drives .canvas-flow-dragging (see style.css) — while true, every node
  // except the one being dragged stops taking pointer events, so the
  // browser isn't hover/hit-testing a whole board of irrelevant nodes on
  // every pointermove of the drag.
  const [isDragging, setIsDragging] = useState(false);
  // Screen-space {x, y} of a pane right-click, or null when the "add a node"
  // menu is closed. Kept in screen coords (not flow coords) since it's just
  // where to anchor the popup — CanvasContextMenu converts it at pick time.
  const [contextMenu, setContextMenu] = useState(null);
  // The toolbar title used to just read song.title straight from props —
  // there was no input anywhere, so there was genuinely no way to rename a
  // project. Local state + a debounced save, same pattern as every other
  // editable title in this file (output mix, chord progression).
  const [songTitle, setSongTitle] = useState(song?.title || '');
  const songTitleTimer = useRef(null);
  const edgesRef = useRef([]);
  edgesRef.current = edges;

  useEffect(() => {
    setSongTitle(song?.title || '');
  }, [song?.id]);

  const handleSongTitleChange = useCallback((e) => {
    const val = e.target.value;
    setSongTitle(val);
    if (songTitleTimer.current) endSave();
    clearTimeout(songTitleTimer.current);
    beginSave();
    songTitleTimer.current = setTimeout(async () => {
      try {
        if (song?.id) await saveSongTitle(song.id, val);
      } finally {
        endSave();
      }
    }, 500);
  }, [song?.id]);

  // Drives what rhyme.js reads every note's lines as (see renderNodes,
  // which injects these into every textNote's data reactively — a note
  // captures this only at creation time otherwise, and would go stale the
  // moment the selector changes, same class of bug as the note-type-vs-
  // final-mix staleness fixed earlier).
  const [lyricLanguage, setLyricLanguage] = useState(song?.lyric_language || 'es');
  const [lyricDialect, setLyricDialect] = useState(song?.lyric_dialect || 'central');

  useEffect(() => {
    setLyricLanguage(song?.lyric_language || 'es');
    setLyricDialect(song?.lyric_dialect || 'central');
  }, [song?.id]);

  const handleLyricLanguageChange = useCallback((e) => {
    const language = e.target.value;
    const dialect = DIALECTS[language][0];
    setLyricLanguage(language);
    setLyricDialect(dialect);
    if (song?.id) { beginSave(); saveSongLyricSettings(song.id, language, dialect).finally(endSave); }
  }, [song?.id]);

  // The muse's per-project, per-register profile — a plain {register:
  // summary} map client-side, built from muse_profile's one-row-per-
  // register shape. Kept in local state so the background profile refresh
  // (see museProfileUpdater.js) can hand back one updated register without
  // needing a reload for the *next* question to read it.
  const [museProfile, setMuseProfile] = useState({});

  useEffect(() => {
    if (!song?.id) { setMuseProfile({}); return; }
    let cancelled = false;
    (async () => {
      const { data } = await loadMuseProfile(song.id);
      if (cancelled) return;
      setMuseProfile(Object.fromEntries((data || []).map((row) => [row.register, row.summary])));
    })();
    return () => { cancelled = true; };
  }, [song?.id]);

  const handleMuseProfileUpdated = useCallback(({ register, summary }) => {
    setMuseProfile((profile) => ({ ...profile, [register]: summary }));
  }, []);

  const handleLyricDialectChange = useCallback((e) => {
    const dialect = e.target.value;
    setLyricDialect(dialect);
    if (song?.id) { beginSave(); saveSongLyricSettings(song.id, lyricLanguage, dialect).finally(endSave); }
  }, [song?.id, lyricLanguage]);

  const handleNodeDeleted = useCallback((id) => {
    // A node's own ✕ button (this) bypasses React Flow's delete gesture
    // entirely, so it doesn't get the automatic connected-edge cleanup that
    // path has — a tempo node deleted this way needs its bpm explicitly
    // cleared off whatever chord progression it was feeding, same thing
    // onEdgesDelete's 'tempo' branch does for the keyboard-delete path.
    const removedTempoTargets = edgesRef.current
      .filter((e) => e.data?.kind === 'tempo' && e.source === id)
      .map((e) => e.target);
    setNodes((nds) => nds
      .filter((n) => n.id !== id)
      .map((n) => (removedTempoTargets.includes(n.id) ? { ...n, data: { ...n.data, bpm: undefined } } : n)));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedNoteId((cur) => (cur === id ? null : cur));
  }, []);

  // Opens (or, if one's already open for this note, just leaves alone —
  // one float per note, not a pile of duplicates) the muse's floating
  // node, positioned just to the right of the note it's about. verseText/
  // noteFunction aren't set here — they're injected live in renderNodes
  // below, same as a chord progression's bpm, so the float always reads
  // the note's current text instead of a snapshot from when it opened.
  const handleOpenMuse = useCallback((note) => {
    const floatId = `muse-float-${note.id}`;
    setNodes((nds) => {
      if (nds.some((n) => n.id === floatId)) return nds;
      const sourceNode = nds.find((n) => n.id === note.id);
      const position = sourceNode
        ? { x: sourceNode.position.x + (sourceNode.width || 280) + 40, y: sourceNode.position.y }
        : { x: 400, y: 200 };
      return [...nds, {
        id: floatId,
        type: 'museFloat',
        position,
        width: 320,
        height: 340,
        data: {
          songId: song?.id,
          sourceNoteId: note.id,
          lineId: note.lines?.[0]?.id,
          userId: state.session?.user?.id,
          museProfile,
          onMuseProfileUpdated: handleMuseProfileUpdated,
          lyricLanguage,
          lyricDialect,
          onClose: handleNodeDeleted,
        },
      }];
    });
  }, [song?.id, state.session?.user?.id, museProfile, handleMuseProfileUpdated, lyricLanguage, lyricDialect, handleNodeDeleted]);

  const handleOpenPanel = useCallback((id) => setSelectedNoteId(id), []);
  const handleClosePanel = useCallback(() => setSelectedNoteId(null), []);

  // Cheap mirror of every keystroke into the node's canonical data, so the
  // (separately rendered) side panel always reflects what's currently typed
  // — no textVersion bump, so TextNoteNode doesn't reset its own local state
  // from this (that would fight the user mid-keystroke).
  const handleNoteTextChange = useCallback((id, text) => {
    setNodes((nds) => nds.map((n) => (n.id === id
      ? { ...n, data: { ...n.data, note: { ...n.data.note, lines: [{ ...(n.data.note.lines?.[0] || {}), text }] } } }
      : n)));
  }, []);

  // Same reasoning as handleNoteTextChange: the type dropdown lives inside
  // TextNoteNode and already saves to Supabase itself, but the note's type
  // is also read by the final-mix nodes (see renderNodes' textNotes) — those
  // read from this component's own `nodes` state, not from TextNoteNode's
  // local state, so without this mirror a type change would only show up
  // after a full reload.
  const handleNoteTypeChange = useCallback((id, type, customLabel) => {
    setNodes((nds) => nds.map((n) => (n.id === id
      ? { ...n, data: { ...n.data, note: { ...n.data.note, type, custom_label: customLabel } } }
      : n)));
  }, []);

  // For changes that originate OUTSIDE the note itself (promote a variant,
  // restore a history entry) — bumps textVersion so TextNoteNode knows to
  // resync its local text state instead of silently going stale.
  const handleNoteTextExternalUpdate = useCallback((id, text) => {
    setNodes((nds) => nds.map((n) => (n.id === id
      ? {
        ...n,
        data: {
          ...n.data,
          note: { ...n.data.note, lines: [{ ...(n.data.note.lines?.[0] || {}), text }] },
          textVersion: (n.data.textVersion || 0) + 1,
        },
      }
      : n)));
  }, []);

  const noteCallbacks = {
    onDeleted: handleNodeDeleted, onOpenPanel: handleOpenPanel,
    onTextChange: handleNoteTextChange, onTypeChange: handleNoteTypeChange, onOpenMuse: handleOpenMuse,
  };

  // Sends a progression's current chords over to the studio's deeper
  // verse/chorus/bridge arrangement view — studio reads only from
  // state.studioSource, never the canvas's own data, so this is the one
  // place that translates between the two.
  const handleArrange = useCallback(({ title, key, progression, vibeMeta }) => {
    setState({
      screen: 'studio',
      studioSource: {
        title, key, progression,
        energy: vibeMeta?.energy || 'medium',
        rgb: vibeMeta?.rgb || { r: 69, g: 82, b: 214 },
      },
    });
  }, []);

  const progressionCallbacks = { onDeleted: handleNodeDeleted, onArrange: handleArrange };

  // A final mix is one linear playthrough — this is how it records which
  // branch it takes at a specific fork (see resolveMainThreadPath). Local
  // state is an upsert-by-hand since there's no DB round trip to wait on
  // before the mix should already reflect the new choice.
  const handleSelectBranch = useCallback((outputId, sourceNoteId, noteLinkId) => {
    setOutputSelection(outputId, sourceNoteId, noteLinkId);
    setSelections((sels) => [
      ...sels.filter((s) => !(s.output_id === outputId && s.source_note_id === sourceNoteId)),
      { output_id: outputId, source_note_id: sourceNoteId, note_link_id: noteLinkId },
    ]);
  }, []);

  const outputCallbacks = { onDeleted: handleNodeDeleted, onSelectBranch: handleSelectBranch };

  // Tempo's bpm needs to reach every chord progression currently plugged
  // into it too, not just its own node — otherwise turning the dial only
  // updates the tempo node's own display and playback silently keeps using
  // the value from when the connection was first made. Persisted
  // immediately (not debounced) since TempoNode only calls this on blur,
  // same as a chord progression's title/key fields.
  const handleTempoBpmChange = useCallback((tempoId, bpm) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id === tempoId) return { ...n, data: { ...n.data, bpm } };
      const fedByThisTempo = edgesRef.current.some((e) =>
        e.data?.kind === 'tempo' && e.source === tempoId && e.target === n.id
      );
      return fedByThisTempo ? { ...n, data: { ...n.data, bpm } } : n;
    }));
    beginSave();
    saveTempoBpm(tempoId, bpm).finally(endSave);
  }, []);

  const tempoCallbacks = { onDeleted: handleNodeDeleted, onBpmChange: handleTempoBpmChange };

  useEffect(() => {
    if (!song) { onExit(); return; }
    let cancelled = false;
    (async () => {
      const [{ notes, progressions, links, error }, { outputs, error: outputError }, { data: tempos, error: tempoError }] = await Promise.all([
        loadCanvasData(song.id),
        loadOutputNodes(song.id),
        loadTempoNodes(song.id),
      ]);
      if (cancelled) return;
      if (error) { setLoadError(error.message); setLoading(false); return; }
      if (outputError) { setLoadError(outputError.message); setLoading(false); return; }
      if (tempoError) { setLoadError(tempoError.message); setLoading(false); return; }
      const { selections: loadedSelections, error: selectionsError } = await loadOutputSelections(outputs.map((o) => o.id));
      if (cancelled) return;
      if (selectionsError) { setLoadError(selectionsError.message); setLoading(false); return; }
      const progressionsById = Object.fromEntries(progressions.map((p) => [p.id, p]));
      const tempoById = Object.fromEntries(tempos.map((t) => [t.id, t]));
      setNodes([
        ...notes.map((n) => noteToFlowNode(n, {
          ...noteCallbacks,
          chordSummary: summarizeProgression(progressionsById[n.chord_progression_id]),
        })),
        ...progressions.map((p) => progressionToFlowNode(p, {
          ...progressionCallbacks,
          bpm: tempoById[p.tempo_node_id]?.bpm,
        })),
        ...outputs.map((o) => outputToFlowNode(o, outputCallbacks)),
        ...tempos.map((t) => tempoToFlowNode(t, tempoCallbacks)),
      ]);
      const plugEdges = outputs.map(outputPlugEdge).filter(Boolean);
      setEdges([...mainThreadEdges(links), ...assignmentEdges(notes), ...tempoAssignmentEdges(progressions), ...plugEdges]);
      setSelections(loadedSelections);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // song.id is the only thing that should ever re-trigger a reload here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);

  const onNodeDragStart = useCallback(() => setIsDragging(true), []);

  const onNodeDragStop = useCallback((_evt, node) => {
    setIsDragging(false);

    // Snap to the 8px grid on drop rather than live during the drag — doing
    // it live would mean the node jumps between grid points instead of
    // tracking the cursor, which reads as laggy, not precise. `node-landing`
    // is a one-shot class (see style.css) that animates this correction,
    // then clears itself so the *next* drag isn't dragging a transition too.
    const position = { x: snapToGrid(node.position.x), y: snapToGrid(node.position.y) };
    setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, position, className: 'node-landing' } : n)));
    window.setTimeout(() => {
      setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, className: undefined } : n)));
    }, 160);

    const save = node.type === 'textNote' ? saveNotePosition(node.id, position, node.width, node.height)
      : node.type === 'chordProgression' ? saveProgressionPosition(node.id, position, node.width, node.height)
      : node.type === 'outputNode' ? saveOutputPosition(node.id, position, node.width, node.height)
      : node.type === 'tempoNode' ? saveTempoPosition(node.id, position, node.width, node.height)
      : null;
    if (save) { beginSave(); save.finally(endSave); }
  }, []);

  // One connect gesture, two meanings depending on what's being connected:
  // chord-progression → text-note assigns it as that note's chords; text-note
  // → text-note extends the main-thread (the clean-view lyric order).
  const onConnect = useCallback((connection) => {
    setNodes((nds) => {
      const sourceNode = nds.find((n) => n.id === connection.source);
      const targetNode = nds.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return nds;

      if (sourceNode.type === 'chordProgression' && targetNode.type === 'textNote') {
        assignProgressionToNote(targetNode.id, sourceNode.id);
        setEdges((eds) => [
          ...eds.filter((e) => !(e.data?.kind === 'assignment' && e.target === targetNode.id)),
          {
            id: `assign-${sourceNode.id}-${targetNode.id}`, source: sourceNode.id, target: targetNode.id,
            sourceHandle: 'assign', targetHandle: 'chord',
            type: 'straight', style: { stroke: '#4552D6', strokeDasharray: '4 3' }, data: { kind: 'assignment' },
          },
        ]);
        return nds.map((n) => n.id === targetNode.id
          ? {
            ...n,
            data: {
              ...n.data,
              note: { ...n.data.note, chord_progression_id: sourceNode.id },
              chordSummary: summarizeProgression(sourceNode.data.progression),
            },
          }
          : n);
      }

      // A tempo node's only job is to hand its bpm to a chord progression's
      // playback — one tempo per progression, so a fresh plug replaces
      // whichever one was there, same pattern as the chord/text-note assign.
      if (sourceNode.type === 'tempoNode' && targetNode.type === 'chordProgression') {
        setProgressionTempo(targetNode.id, sourceNode.id);
        setEdges((eds) => [
          ...eds.filter((e) => !(e.data?.kind === 'tempo' && e.target === targetNode.id)),
          {
            id: `tempo-plug-${sourceNode.id}-${targetNode.id}`, source: sourceNode.id, target: targetNode.id,
            sourceHandle: 'tempo-out', targetHandle: 'tempo-in',
            type: 'straight', style: { stroke: '#B8842A', strokeDasharray: '2 3' }, data: { kind: 'tempo' },
          },
        ]);
        return nds.map((n) => n.id === targetNode.id
          ? { ...n, data: { ...n.data, bpm: sourceNode.data.bpm } }
          : n);
      }

      if (sourceNode.type === 'textNote' && targetNode.type === 'textNote') {
        // Two links between the same pair isn't a real fork/merge, just the
        // same connection twice — guard here so it can't happen from a
        // stray double-drag, rather than relying on every downstream reader
        // (the final-mix chain walk) to shrug it off.
        const alreadyLinked = edgesRef.current.some((e) =>
          e.data?.kind === 'main-thread' && e.source === sourceNode.id && e.target === targetNode.id
        );
        if (!alreadyLinked) {
          const linkId = crypto.randomUUID();
          const position = edgesRef.current.filter((e) => e.data?.kind === 'main-thread').length;
          createMainThreadLink(linkId, song.id, sourceNode.id, targetNode.id, position);
          setEdges((eds) => addEdge({
            ...connection, id: linkId, type: 'default',
            style: { stroke: '#1F6F63', strokeWidth: 1.5, opacity: 0.6 }, data: { kind: 'main-thread', position },
          }, eds));
        }
      }

      // Only one note can be plugged into a given final-mix node at a time —
      // a fresh connection replaces whichever plug edge existed on THIS
      // output node, same pattern as re-assigning a chord progression to a
      // note. Other final-mix nodes (there can be several now) keep theirs —
      // scope the replacement to this target only, not every output edge.
      if (sourceNode.type === 'textNote' && targetNode.type === 'outputNode') {
        setOutputPluggedNote(targetNode.id, sourceNode.id);
        setEdges((eds) => [
          ...eds.filter((e) => !(e.data?.kind === 'output' && e.target === targetNode.id)),
          {
            id: `output-plug-${targetNode.id}`, source: sourceNode.id, target: targetNode.id,
            sourceHandle: 'right', targetHandle: 'output-in',
            type: 'default', style: { stroke: '#1D1C1A', strokeWidth: 1.5, opacity: 0.5 }, data: { kind: 'output' },
          },
        ]);
        return nds.map((n) => n.id === targetNode.id
          ? { ...n, data: { ...n.data, output: { ...n.data.output, plugged_note_id: sourceNode.id } } }
          : n);
      }

      return nds;
    });
  }, [song?.id]);

  // Fires when a node is removed via the selection + Delete/Backspace gesture
  // (the standard canvas-editor way to delete something) — the in-node ✕
  // button is a second, explicit way to do the same thing. Without this,
  // deleting via keyboard only removed the node from local React state; it
  // reappeared on the next reload because Supabase never heard about it.
  const onNodesDelete = useCallback((deleted) => {
    deleted.forEach((node) => {
      if (node.type === 'textNote') deleteNote(node.id);
      else if (node.type === 'chordProgression') deleteChordProgression(node.id);
      else if (node.type === 'outputNode') deleteOutputNode(node.id);
      else if (node.type === 'tempoNode') deleteTempoNode(node.id);
    });
  }, []);

  const onEdgesDelete = useCallback((deleted) => {
    deleted.forEach((edge) => {
      if (edge.data?.kind === 'main-thread') {
        deleteNoteLink(edge.id);
      } else if (edge.data?.kind === 'assignment') {
        assignProgressionToNote(edge.target, null);
        setNodes((nds) => nds.map((n) => n.id === edge.target
          ? { ...n, data: { ...n.data, note: { ...n.data.note, chord_progression_id: null }, chordSummary: null } }
          : n));
      } else if (edge.data?.kind === 'output') {
        setOutputPluggedNote(edge.target, null);
        setNodes((nds) => nds.map((n) => n.id === edge.target
          ? { ...n, data: { ...n.data, output: { ...n.data.output, plugged_note_id: null } } }
          : n));
      } else if (edge.data?.kind === 'tempo') {
        setProgressionTempo(edge.target, null);
        setNodes((nds) => nds.map((n) => n.id === edge.target
          ? { ...n, data: { ...n.data, bpm: undefined } }
          : n));
      }
    });
  }, []);

  // Every handleAdd* below now takes the flow position from wherever the
  // right-click menu was opened (see CanvasContextMenu / handleContextAdd),
  // falling back to a fixed spot only if called without one.
  const handleAddNote = useCallback(async (position = { x: 120, y: 120 }) => {
    const { note, error } = await createNote(song.id, position);
    if (error) { setLoadError(error.message); return; }
    setNodes((nds) => [...nds, noteToFlowNode(note, noteCallbacks)]);
  }, [song?.id, handleNodeDeleted]);

  const handleAddProgression = useCallback(async (position = { x: 460, y: 120 }) => {
    const { data: cp, error } = await createChordProgression(song.id, position);
    if (error) { setLoadError(error.message); return; }
    setNodes((nds) => [...nds, progressionToFlowNode(cp, progressionCallbacks)]);
  }, [song?.id, handleNodeDeleted]);

  const handleAddOutput = useCallback(async (position = { x: 800, y: 120 }) => {
    const { data: output, error } = await createOutputNode(song.id, position);
    if (error) { setLoadError(error.message); return; }
    setNodes((nds) => [...nds, outputToFlowNode(output, outputCallbacks)]);
  }, [song?.id, handleNodeDeleted]);

  // The vibe-compose node is a tool, not content — it never gets a DB row of
  // its own (no position/size to persist), so adding and removing it is
  // local-only React state, same as any other ephemeral UI element.
  const handleAddVibeNode = useCallback((position = { x: 120, y: 120 }) => {
    const nodeId = crypto.randomUUID();
    setNodes((nds) => [...nds, {
      id: nodeId,
      type: 'vibeCompose',
      position,
      width: 420,
      height: 560,
      data: {
        onClose: (id) => setNodes((cur) => cur.filter((n) => n.id !== id)),
        onGenerated: async (composed, meta) => {
          const { data: cp, error } = await createVibeProgression(song.id, { x: position.x + 440, y: position.y }, composed, meta);
          if (error) { setLoadError(error.message); return; }
          setNodes((cur) => [...cur, progressionToFlowNode(cp, progressionCallbacks)]);
        },
      },
    }]);
  }, [song?.id]);

  const handleAddTempo = useCallback(async (position = { x: 120, y: 340 }) => {
    const { data: tempo, error } = await createTempoNode(song.id, position);
    if (error) { setLoadError(error.message); return; }
    setNodes((nds) => [...nds, tempoToFlowNode(tempo, tempoCallbacks)]);
  }, [song?.id, handleTempoBpmChange, handleNodeDeleted]);

  const handleContextAdd = useCallback((type, position) => {
    if (type === 'note') handleAddNote(position);
    else if (type === 'chord') handleAddProgression(position);
    else if (type === 'output') handleAddOutput(position);
    else if (type === 'vibe') handleAddVibeNode(position);
    else if (type === 'tempo') handleAddTempo(position);
  }, [handleAddNote, handleAddProgression, handleAddOutput, handleAddVibeNode, handleAddTempo]);

  const onPaneContextMenu = useCallback((e) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // The output node doesn't own its own content — it renders whatever the
  // rest of the graph currently looks like, so its inputs are recomputed
  // fresh every render (cheap) instead of being written into node state
  // every time any unrelated note/link changes.
  const renderNodes = useMemo(() => {
    const textNotes = nodes.filter((n) => n.type === 'textNote').map((n) => n.data.note);
    const textNotesById = Object.fromEntries(textNotes.map((n) => [n.id, n]));
    // id + position are load-bearing here — resolveMainThreadPath needs id to
    // match a stored selection and position to pick a stable default when
    // there isn't one (see canvasData.js).
    const mainThreadLinks = edges
      .filter((e) => e.data?.kind === 'main-thread')
      .map((e) => ({ id: e.id, source_note_id: e.source, target_note_id: e.target, position: e.data.position }));
    const progressionsById = Object.fromEntries(
      nodes.filter((n) => n.type === 'chordProgression').map((n) => [n.id, n.data.progression])
    );
    return nodes.map((n) => {
      if (n.type === 'outputNode') {
        return {
          ...n,
          data: {
            ...n.data,
            notes: textNotes,
            links: mainThreadLinks,
            progressionsById,
            selections: Object.fromEntries(
              selections.filter((s) => s.output_id === n.id).map((s) => [s.source_note_id, s.note_link_id])
            ),
            lyricLanguage,
            lyricDialect,
          },
        };
      }
      if (n.type === 'textNote') {
        return { ...n, data: { ...n.data, lyricLanguage, lyricDialect } };
      }
      if (n.type === 'museFloat') {
        // Reads the source note's CURRENT text every render, same reasoning
        // as a chord progression's bpm — a float opened a while ago
        // shouldn't keep prompting off a stale snapshot of the verse.
        const sourceNote = textNotesById[n.data.sourceNoteId];
        return {
          ...n,
          data: {
            ...n.data,
            verseText: sourceNote?.lines?.[0]?.text || '',
            noteFunction: sourceNote?.custom_label || sourceNote?.type || '',
            museProfile,
            lyricLanguage,
            lyricDialect,
          },
        };
      }
      return n;
    });
  }, [nodes, edges, selections, lyricLanguage, lyricDialect, museProfile]);

  const handleSignOut = useCallback(async () => {
    if (!confirm('Sign out?')) return;
    await supabase.auth.signOut();
    setState({ session: null, activeSong: null, screen: 'home' });
  }, []);

  if (!song) return null;

  const avatarLetter = (state.session?.user?.email || '?')[0].toUpperCase();

  return (
    <div className="canvas-root">
      <ReactFlowProvider>
        <div className="canvas-toolbar">
          <button className="canvas-btn canvas-btn-ghost" onClick={onExit}>‹ projects</button>
          <input
            className="canvas-title-input"
            value={songTitle}
            placeholder="untitled song"
            onChange={handleSongTitleChange}
          />
          <span className="canvas-toolbar-divider" />

          <div className="canvas-rhyme-select" title="language the rhyme scheme reads this song's lines as">
            <select value={lyricLanguage} onChange={handleLyricLanguageChange}>
              <option value="es">Castellano</option>
              <option value="ca">Català</option>
            </select>
            {lyricLanguage === 'ca' && (
              <select value={lyricDialect} onChange={handleLyricDialectChange}>
                <option value="oriental">oriental</option>
                <option value="occidental">occidental</option>
              </select>
            )}
          </div>

          <span className="canvas-toolbar-divider" />
          <SaveStatus />
          <span className="canvas-toolbar-divider" />
          <span className="canvas-hint">right-click the canvas to add a node · click a connection, Delete to remove it</span>

          <div className="canvas-toolbar-right">
            <ZoomControl />
            <span className="canvas-toolbar-divider" />
            <button className="canvas-avatar" onClick={handleSignOut} title="sign out">{avatarLetter}</button>
          </div>
        </div>

        <CanvasContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onAdd={handleContextAdd} />

        {loadError && <div className="canvas-error">{loadError}</div>}

        {loading ? (
          <div className="canvas-loading">loading…</div>
        ) : (
          <ReactFlow
            className={isDragging ? 'canvas-flow-dragging' : undefined}
            nodes={renderNodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onPaneContextMenu={onPaneContextMenu}
            deleteKeyCode={['Backspace', 'Delete']}
            connectionMode="loose"
            fitView
          >
            <Background color="#D8D2C2" gap={22} />
          </ReactFlow>
        )}
      </ReactFlowProvider>

      {selectedNoteId && (() => {
        const selectedNode = nodes.find((n) => n.id === selectedNoteId);
        if (!selectedNode) return null;
        const textNoteNodes = nodes.filter((n) => n.type === 'textNote');
        const allNoteTexts = textNoteNodes.map((n) => n.data.note.lines?.[0]?.text || '');
        return (
          <NoteSidePanel
            note={selectedNode.data.note}
            userId={state.session?.user?.id}
            allNoteTexts={allNoteTexts}
            onClose={handleClosePanel}
            onTextUpdated={handleNoteTextExternalUpdate}
            onOpenMuse={handleOpenMuse}
            onTypeChange={handleNoteTypeChange}
          />
        );
      })()}
    </div>
  );
}
