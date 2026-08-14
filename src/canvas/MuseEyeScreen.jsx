import { useState, useEffect, useCallback } from 'react';
import { subscribeDebugLog, clearDebugLog } from '../utils/debugLog.js';
import { loadComplaints, deleteComplaint, formatComplaintsSummary, excerptFor } from './museComplaints.js';
import MuseEyePanel from './MuseEyePanel.jsx';
import { createProject } from '../screens/projectsData.js';
import { getState, setState } from '../state/store.js';
import { MOCK_SONG_PREFIX } from './MockPlayground.jsx';
import MuseLabView from './MuseLabView.jsx';

// Full-page home for the SAME real data MuseEyePanel shows inline — never
// a mock/sandbox. Every real muse call made anywhere in the app with debug
// mode on already pushes its _debug payload into debugLog.js; this screen
// is just a comfortable, full-size way to browse that real history instead
// of squinting at a small card inside a draggable canvas node. Reached from
// the projects screen's 👁 button (dev-only) — see main.js's 'museeye'
// screen registration.
//
// Three tabs: "history" is the live, in-memory debugLog (cleared on
// reload, same as always). "complaints" is the persisted QA notes left on
// either a muse response OR a baúl absorption (MuseEyePanel's comment
// boxes, museComplaints.js) — those survive reload on purpose, since the
// whole point is accumulating a summary across sessions. "lab" is the
// Golden Set / A-B prompt testing pipeline (MuseLabView.jsx,
// museGoldenSet.js, museLabData.js) — hardcoded benchmark inputs, but
// every call made against them is real.
function ComplaintsView() {
  const [complaints, setComplaints] = useState(() => loadComplaints());
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => setComplaints(loadComplaints()), []);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(formatComplaintsSummary(complaints)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [complaints]);

  const handleDelete = useCallback((id) => {
    deleteComplaint(id);
    refresh();
  }, [refresh]);

  if (complaints.length === 0) {
    return (
      <div className="eyescr-empty">
        <p>no complaints logged yet.</p>
        <p className="eyescr-empty-hint">open a response in the history tab (or the inline panel on the canvas) and leave a note in "your note on this response" — it shows up here.</p>
      </div>
    );
  }

  return (
    <div className="eyescr-complaints">
      <div className="eyescr-complaints-toolbar">
        <span className="eyescr-complaints-count">{complaints.length} complaint{complaints.length === 1 ? '' : 's'}</span>
        <button className="eyescr-clear" onClick={handleCopy}>{copied ? 'copied' : 'copy summary'}</button>
      </div>
      <div className="eyescr-complaints-list">
        {complaints.map((c) => {
          const excerpt = excerptFor(c);
          const label = c.source === 'baul' ? `baúl · ${c.inputType || '—'}` : (c.actionType || '—');
          const speaker = c.source === 'baul' ? 'extracted' : 'muse';
          return (
            <div className="eyescr-complaint-card" key={c.id}>
              <div className="eyescr-complaint-head">
                <span className="eyescr-complaint-mode">{label}</span>
                <span className="eyescr-complaint-where">{[c.songTitle, c.nodeLabel].filter(Boolean).join(' · ') || 'untitled'}</span>
                <span className="eyescr-complaint-time">{new Date(c.at).toLocaleString()}</span>
                <button className="eyescr-complaint-delete" onClick={() => handleDelete(c.id)} title="delete">✕</button>
              </div>
              {excerpt && <p className="eyescr-complaint-excerpt">{speaker}: "{excerpt}"</p>}
              <p className="eyescr-complaint-comment">{c.comment}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MuseEyeScreen({ onExit }) {
  const [view, setView] = useState('history');
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [complaintCount, setComplaintCount] = useState(() => loadComplaints().length);

  useEffect(() => subscribeDebugLog(setEntries), []);

  const ordered = entries.slice().reverse();
  const selected = ordered.find((e) => e.id === selectedId) || ordered[0] || null;

  // Refresh the tab's badge count whenever the user switches into (or off
  // of) the complaints view — cheap, and the only moment a stale count
  // would actually be visible.
  const switchView = useCallback((next) => {
    setView(next);
    setComplaintCount(loadComplaints().length);
  }, []);

  const [creatingMock, setCreatingMock] = useState(false);
  const handleNewMockSong = useCallback(async () => {
    const userId = getState().session?.user?.id;
    if (!userId || creatingMock) return;
    setCreatingMock(true);
    const { song, error } = await createProject(userId, `${MOCK_SONG_PREFIX}mock song`);
    setCreatingMock(false);
    if (error) return;
    // Straight into its canvas — MockPlayground.jsx picks it up there from
    // the title prefix and shows the raw-editable lyric_dna/muse_profile
    // fields, no separate "configure your mock song" step first.
    setState({ activeSong: song, screen: 'canvas' });
  }, [creatingMock]);

  return (
    <div className="muse-eye-screen">
      <div className="eyescr-topbar">
        <div className="eyescr-brand">
          <button className="eyescr-back" onClick={onExit} title="back to projects">‹</button>
          <div>
            <h1>muse eye</h1>
            <p>real debug history for this session · {entries.length} call{entries.length === 1 ? '' : 's'} captured</p>
          </div>
        </div>
        <div className="eyescr-topbar-actions">
          <button className="eyescr-new-mock" onClick={handleNewMockSong} disabled={creatingMock} title="create a disposable test song with an editable lyric_dna/muse_profile playground">
            {creatingMock ? '…' : '🧪 new mock song'}
          </button>
          {view === 'history' && entries.length > 0 && (
            <button className="eyescr-clear" onClick={() => { clearDebugLog(); setSelectedId(null); }}>clear history</button>
          )}
        </div>
      </div>

      <div className="eyescr-view-tabs">
        <button className={`eyescr-view-tab${view === 'history' ? ' active' : ''}`} onClick={() => switchView('history')}>history</button>
        <button className={`eyescr-view-tab${view === 'complaints' ? ' active' : ''}`} onClick={() => switchView('complaints')}>
          complaints <span className="eyescr-view-tab-count">· {complaintCount}</span>
        </button>
        <button className={`eyescr-view-tab${view === 'lab' ? ' active' : ''}`} onClick={() => switchView('lab')}>lab</button>
      </div>

      {view === 'lab' ? (
        <div className="eyescr-view-body"><MuseLabView /></div>
      ) : view === 'complaints' ? (
        <div className="eyescr-view-body"><ComplaintsView /></div>
      ) : ordered.length === 0 ? (
        <div className="eyescr-empty">
          <p>nothing captured yet this session.</p>
          <p className="eyescr-empty-hint">open any song → open a muse float node → turn on its 🔧 toggle → send it a message. Every real call logged that way shows up here, full-size.</p>
        </div>
      ) : (
        <div className="eyescr-body">
          <div className="eyescr-list">
            {ordered.map((entry) => {
              const isActive = selected?.id === entry.id;
              return (
                <button
                  key={entry.id}
                  className={`eyescr-list-item${isActive ? ' active' : ''}`}
                  onClick={() => setSelectedId(entry.id)}
                >
                  <span className="eyescr-list-mode">{entry.payload?.actionType || '—'}</span>
                  <span className="eyescr-list-song">{entry.meta?.songTitle || 'untitled'}</span>
                  <span className="eyescr-list-time">{entry.at.toLocaleTimeString()}</span>
                </button>
              );
            })}
          </div>
          <div className="eyescr-detail">
            {selected && (
              <MuseEyePanel
                debug={selected.payload}
                songId={selected.meta?.songId}
                songTitle={selected.meta?.songTitle}
                nodeLabel={selected.meta?.nodeLabel}
                embedded={false}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
