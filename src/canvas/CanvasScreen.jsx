import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, addEdge,
  applyNodeChanges, applyEdgeChanges, ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import TextNoteNode from './TextNoteNode.jsx';
import ChordProgressionNode from './ChordProgressionNode.jsx';
import OutputNode from './OutputNode.jsx';
import NoteSidePanel from './NoteSidePanel.jsx';
import {
  loadCanvasData, createNote, createChordProgression,
  saveNotePosition, saveProgressionPosition,
  createMainThreadLink, deleteNoteLink, assignProgressionToNote,
  deleteNote, deleteChordProgression,
  ensureOutputNode, saveOutputPosition, setOutputPluggedNote,
} from './canvasData.js';

const NODE_TYPES = { textNote: TextNoteNode, chordProgression: ChordProgressionNode, outputNode: OutputNode };

// React Flow needs a concrete numeric width/height for every node up front —
// leaving height undefined (canvas_height has no DB default, unlike
// canvas_width) means the node's box, and therefore where handles/edges
// anchor to it, is unresolved until content forces a size, which reads as
// edges/handles floating at the wrong spot relative to the note.
const DEFAULT_NOTE_HEIGHT = 160;
const DEFAULT_PROGRESSION_HEIGHT = 220;
const DEFAULT_OUTPUT_WIDTH = 320;
const DEFAULT_OUTPUT_HEIGHT = 240;

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

function progressionToFlowNode(cp, onDeleted) {
  return {
    id: cp.id,
    type: 'chordProgression',
    position: { x: cp.canvas_x || 0, y: cp.canvas_y || 0 },
    width: cp.canvas_width || 260,
    height: cp.canvas_height || DEFAULT_PROGRESSION_HEIGHT,
    data: { progression: cp, onDeleted },
  };
}

// Created once per song, never by the user — no onDeleted callback exists
// for it, and deletable:false keeps React Flow from ever handing it to
// onNodesDelete via the selection + Backspace/Delete gesture either.
function outputToFlowNode(output) {
  return {
    id: output.id,
    type: 'outputNode',
    position: { x: output.canvas_x || 0, y: output.canvas_y || 0 },
    width: output.canvas_width || DEFAULT_OUTPUT_WIDTH,
    height: output.canvas_height || DEFAULT_OUTPUT_HEIGHT,
    deletable: false,
    data: { output },
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

export default function CanvasScreen({ state, onExit }) {
  const song = state.activeSong;
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedNoteId, setSelectedNoteId] = useState(null);
  const edgesRef = useRef([]);
  edgesRef.current = edges;

  const handleNodeDeleted = useCallback((id) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedNoteId((cur) => (cur === id ? null : cur));
  }, []);

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

  const noteCallbacks = { onDeleted: handleNodeDeleted, onOpenPanel: handleOpenPanel, onTextChange: handleNoteTextChange };

  useEffect(() => {
    if (!song) { onExit(); return; }
    let cancelled = false;
    (async () => {
      const [{ notes, progressions, links, error }, { output, error: outputError }] = await Promise.all([
        loadCanvasData(song.id),
        ensureOutputNode(song.id),
      ]);
      if (cancelled) return;
      if (error) { setLoadError(error.message); setLoading(false); return; }
      if (outputError) { setLoadError(outputError.message); setLoading(false); return; }
      const progressionsById = Object.fromEntries(progressions.map((p) => [p.id, p]));
      setNodes([
        ...notes.map((n) => noteToFlowNode(n, {
          ...noteCallbacks,
          chordSummary: summarizeProgression(progressionsById[n.chord_progression_id]),
        })),
        ...progressions.map((p) => progressionToFlowNode(p, handleNodeDeleted)),
        outputToFlowNode(output),
      ]);
      const plugEdge = outputPlugEdge(output);
      setEdges([...mainThreadEdges(links), ...assignmentEdges(notes), ...(plugEdge ? [plugEdge] : [])]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // song.id is the only thing that should ever re-trigger a reload here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);

  const onNodeDragStop = useCallback((_evt, node) => {
    if (node.type === 'textNote') saveNotePosition(node.id, node.position, node.width, node.height);
    else if (node.type === 'chordProgression') saveProgressionPosition(node.id, node.position, node.width, node.height);
    else if (node.type === 'outputNode') saveOutputPosition(node.id, node.position, node.width, node.height);
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

      if (sourceNode.type === 'textNote' && targetNode.type === 'textNote') {
        const linkId = crypto.randomUUID();
        const position = edgesRef.current.filter((e) => e.data?.kind === 'main-thread').length;
        createMainThreadLink(linkId, song.id, sourceNode.id, targetNode.id, position);
        setEdges((eds) => addEdge({
          ...connection, id: linkId, type: 'default',
          style: { stroke: '#1F6F63', strokeWidth: 1.5, opacity: 0.6 }, data: { kind: 'main-thread', position },
        }, eds));
      }

      // Only one note can be plugged into the output at a time — a fresh
      // connection replaces whichever plug edge existed before, same pattern
      // as re-assigning a chord progression to a note.
      if (sourceNode.type === 'textNote' && targetNode.type === 'outputNode') {
        setOutputPluggedNote(targetNode.id, sourceNode.id);
        setEdges((eds) => [
          ...eds.filter((e) => e.data?.kind !== 'output'),
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
      }
    });
  }, []);

  const handleAddNote = useCallback(async () => {
    const { note, error } = await createNote(song.id, { x: 120, y: 120 });
    if (error) { setLoadError(error.message); return; }
    setNodes((nds) => [...nds, noteToFlowNode(note, noteCallbacks)]);
  }, [song?.id, handleNodeDeleted]);

  const handleAddProgression = useCallback(async () => {
    const { data: cp, error } = await createChordProgression(song.id, { x: 460, y: 120 });
    if (error) { setLoadError(error.message); return; }
    setNodes((nds) => [...nds, progressionToFlowNode(cp, handleNodeDeleted)]);
  }, [song?.id, handleNodeDeleted]);

  // The output node doesn't own its own content — it renders whatever the
  // rest of the graph currently looks like, so its inputs are recomputed
  // fresh every render (cheap) instead of being written into node state
  // every time any unrelated note/link changes.
  const renderNodes = useMemo(() => {
    const textNotes = nodes.filter((n) => n.type === 'textNote').map((n) => n.data.note);
    const mainThreadLinks = edges
      .filter((e) => e.data?.kind === 'main-thread')
      .map((e) => ({ source_note_id: e.source, target_note_id: e.target }));
    const progressionsById = Object.fromEntries(
      nodes.filter((n) => n.type === 'chordProgression').map((n) => [n.id, n.data.progression])
    );
    return nodes.map((n) => (n.type === 'outputNode'
      ? { ...n, data: { ...n.data, notes: textNotes, links: mainThreadLinks, progressionsById } }
      : n));
  }, [nodes, edges]);

  if (!song) return null;

  return (
    <div className="canvas-root">
      <div className="canvas-toolbar">
        <button className="canvas-btn" onClick={onExit}>← projects</button>
        <span className="canvas-title">{song.title}</span>
        <span className="canvas-hint">click a connection, press Delete to remove it</span>
        <div className="canvas-toolbar-right">
          <button className="canvas-btn" onClick={handleAddNote}>+ note</button>
          <button className="canvas-btn" onClick={handleAddProgression}>+ chord progression</button>
        </div>
      </div>

      {loadError && <div className="canvas-error">{loadError}</div>}

      {loading ? (
        <div className="canvas-loading">loading…</div>
      ) : (
        <ReactFlowProvider>
          <ReactFlow
            nodes={renderNodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            deleteKeyCode={['Backspace', 'Delete']}
            connectionMode="loose"
            fitView
          >
            <Background color="#D8D2C2" gap={22} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      )}

      {selectedNoteId && (() => {
        const selectedNode = nodes.find((n) => n.id === selectedNoteId);
        if (!selectedNode) return null;
        const allNoteTexts = nodes
          .filter((n) => n.type === 'textNote')
          .map((n) => n.data.note.lines?.[0]?.text || '');
        return (
          <NoteSidePanel
            note={selectedNode.data.note}
            userId={state.session?.user?.id}
            allNoteTexts={allNoteTexts}
            onClose={handleClosePanel}
            onTextUpdated={handleNoteTextExternalUpdate}
          />
        );
      })()}
    </div>
  );
}
