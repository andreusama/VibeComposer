import { useState, useEffect, useCallback } from 'react';
import { loadBaulEntries } from './canvasData.js';
import { getUsageRemaining } from '../utils/api.js';
import { getComplaint, saveComplaint, deleteComplaint } from './museComplaints.js';
import { BAUL_MODEL, BAUL_SYSTEM_PROMPT } from '../utils/baulProcessor.js';

// Complete rewrite of the old MuseDebugPanel — "instrument of control" over
// "game HUD" (see the mockup this reproduces). Two things it covers that
// the old one didn't: an interpretation layer over what mode actually fired
// and why (the "musa" tab), and the baúl's ingestion pipeline (the "baúl"
// tab, backed by the new baul_entries log — see canvasData.js/schema.sql;
// deliberately the ONE place that reverses the Baúl's "black box" opacity,
// dev-only, never shown to a real user).

const MODE_META = {
  SURGEON: { icon: '🔧', color: 'warn', label: 'surgeon', desc: 'line-level micro edits' },
  ARCHITECT: { icon: '🏛', color: 'chord', label: 'architect', desc: 'structural suggestion, not a question' },
  SOCRATIC: { icon: '❓', color: 'amber', label: 'socratic', desc: 'provoking question, no verses' },
  WORD_BANK: { icon: '📖', color: 'thread', label: 'word bank', desc: 'rhyme & imagery vocabulary' },
  OPEN_REFERENCE: { icon: '🧭', color: 'slate', label: 'open reference', desc: 'cultural/sensory material — declines to opine' },
};

const TYPE_META = {
  text: { icon: '✎', color: 'thread' },
  audio_transcript: { icon: '♪', color: 'amber' },
  notebook_image: { icon: '▣', color: 'chord' },
  document: { icon: '▤', color: 'graphite' },
};

const LAYERS = [
  { key: 'museProfileAndSystem', label: 'sistema + perfil', color: 'chord' },
  { key: 'localNodeAndLines', label: 'contexto local', color: 'thread' },
  { key: 'userIntent', label: 'intención del usuario', color: 'amber' },
];

const LATENCY_BUDGET_MS = 1500;

// Not a real JSON highlighter — the system/dynamic blocks are prose, not
// JSON (see museApi.js's buildStaticMuseInstructions/buildDynamicMuseContext).
// Just the two categories the spec asked for: section headers as keywords,
// quoted fragments as strings.
function highlightPrompt(text) {
  if (!text) return '';
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .replace(/^(===[^\n]*===|SYSTEM:|SI action_type[^\n]*|INSTRUCCIÓN OBLIGATORIA[^\n]*)/gm, '<span class="eye-code-k">$1</span>')
    .replace(/"([^"\n]{1,140})"/g, '"<span class="eye-code-s">$1</span>"');
}

// Same comment mechanics as the muse response box below, just keyed by a
// baul_entries row id instead of debug.id — real, persisted, stable across
// reloads (unlike debug.id, which only exists for the session that made
// the call). One instance per pipeline row, own local draft/saved state.
function BaulEntryComment({ entryId, snapshot }) {
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    const existing = getComplaint(entryId);
    setSaved(existing);
    setDraft(existing?.comment || '');
  }, [entryId]);

  const handleSave = useCallback(() => {
    if (!draft.trim()) return;
    setSaved(saveComplaint(entryId, draft.trim(), snapshot));
  }, [entryId, draft, snapshot]);

  const handleDelete = useCallback(() => {
    deleteComplaint(entryId);
    setSaved(null);
    setDraft('');
  }, [entryId]);

  return (
    <div className="eye-comment eye-comment-nested">
      <div className="eye-comment-label">
        your note on this input
        {saved && <span className="eye-comment-saved">✓ saved · in complaints summary</span>}
      </div>
      <textarea
        className="eye-comment-input"
        rows={2}
        value={draft}
        placeholder="anything off about what got extracted from this one?"
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="eye-comment-actions">
        <button className="eye-comment-save" onClick={handleSave} disabled={!draft.trim()}>
          {saved ? 'update note' : 'save note'}
        </button>
        {saved && <button className="eye-comment-delete" onClick={handleDelete}>delete</button>}
      </div>
    </div>
  );
}

// embedded=true (default): lives inline inside a draggable React Flow node
// (MuseFloatNode) — needs nodrag/nowheel so scrolling/interacting with the
// panel doesn't drag or zoom the canvas underneath it.
// embedded=false: MuseEyeScreen's full-page history viewer — a plain block,
// no React Flow underneath it to fight with.
export default function MuseEyePanel({ debug, songId, songTitle, nodeLabel, embedded = true }) {
  const [tab, setTab] = useState('system');
  const [baulEntries, setBaulEntries] = useState([]);
  const [openEntry, setOpenEntry] = useState(null);
  const [showBaulPrompt, setShowBaulPrompt] = useState(false);
  const [usage, setUsage] = useState(() => getUsageRemaining());
  const [commentDraft, setCommentDraft] = useState('');
  const [savedComplaint, setSavedComplaint] = useState(null);

  const refreshBaul = useCallback(() => {
    if (!songId) return;
    loadBaulEntries(songId).then(({ data }) => setBaulEntries(data || []));
  }, [songId]);

  useEffect(() => { refreshBaul(); }, [refreshBaul]);
  useEffect(() => { setUsage(getUsageRemaining()); }, [debug]);

  // Re-loads whenever we're looking at a DIFFERENT response (new debug.id)
  // — the inline panel overwrites its debug object on every new message,
  // so the comment box has to follow the id, not just mount once.
  useEffect(() => {
    if (!debug?.id) { setSavedComplaint(null); setCommentDraft(''); return; }
    const existing = getComplaint(debug.id);
    setSavedComplaint(existing);
    setCommentDraft(existing?.comment || '');
  }, [debug?.id]);

  const handleSaveComment = useCallback(() => {
    if (!debug?.id || !commentDraft.trim()) return;
    const entry = saveComplaint(debug.id, commentDraft.trim(), {
      source: 'muse',
      actionType: debug.actionType,
      latencyMs: debug.latencyMs,
      parsedOutput: debug.parsedOutput,
      songTitle, nodeLabel,
    });
    setSavedComplaint(entry);
  }, [debug, commentDraft, songTitle, nodeLabel]);

  const handleDeleteComment = useCallback(() => {
    if (!debug?.id) return;
    deleteComplaint(debug.id);
    setSavedComplaint(null);
    setCommentDraft('');
  }, [debug?.id]);

  if (!debug) return null;

  const overBudget = debug.latencyMs > LATENCY_BUDGET_MS;
  const currentMode = MODE_META[debug.actionType];
  const output = debug.parsedOutput || {};
  const hasOutput = output.suggestions?.length || output.question || output.wordBank;

  return (
    <div className={`muse-eye-panel${embedded ? ' nodrag nowheel' : ' muse-eye-panel-standalone'}`}>
      <div className="eye-head">
        <div className="eye-head-left">
          <span className="eye-dot-wrap"><span className="eye-dot-pulse" /></span>
          <span className="eye-title">muse eye</span>
        </div>
        <div className="eye-head-right">
          <span><b>{usage.used}</b> calls today</span>
          <span><b>{baulEntries.length}</b> baúl items</span>
        </div>
      </div>

      <div className="eye-readout">
        <div className="eye-readout-bar">
          {LAYERS.map((l) => (
            <div key={l.key} className={`eye-readout-seg eye-fill-${l.color}`} style={{ width: debug.weights[l.key].percentage }} />
          ))}
        </div>
        <div className="eye-readout-rows">
          {LAYERS.map((l) => (
            <div className="eye-readout-row" key={l.key}>
              <span className={`eye-readout-dot eye-fill-${l.color}`} />
              <span className="eye-readout-label">{l.label}</span>
              <span className="eye-readout-val"><b>{debug.weights[l.key].percentage}</b> · {debug.weights[l.key].charCount} car.</span>
            </div>
          ))}
        </div>
      </div>

      <div className="eye-metrics">
        <div className="eye-metric">
          <div className="eye-metric-label">latencia</div>
          <div className={`eye-metric-value ${overBudget ? 'eye-status-warn' : 'eye-status-ok'}`}>{debug.latencyMs}ms</div>
        </div>
        <div className="eye-metric">
          <div className="eye-metric-label">modelo</div>
          <div className="eye-metric-value">{(debug.model || '—').replace('claude-', '')}</div>
        </div>
        <div className="eye-metric">
          <div className="eye-metric-label">temp</div>
          <div className="eye-metric-value">{debug.parameters?.temperature || '—'}</div>
        </div>
        <div className="eye-metric">
          <div className="eye-metric-label">thinking</div>
          <div className="eye-metric-value">{debug.parameters?.thinking === 'disabled' ? 'off' : (debug.parameters?.thinking || '—')}</div>
        </div>
      </div>

      <div className="eye-tabs">
        <button className={`eye-tab${tab === 'system' ? ' active' : ''}`} onClick={() => setTab('system')}>system</button>
        <button className={`eye-tab${tab === 'dynamic' ? ' active' : ''}`} onClick={() => setTab('dynamic')}>dynamic</button>
        <button className={`eye-tab${tab === 'musa' ? ' active' : ''}`} onClick={() => setTab('musa')}>musa</button>
        <button className={`eye-tab${tab === 'baul' ? ' active' : ''}`} onClick={() => setTab('baul')}>baúl <span className="eye-tab-count">· {baulEntries.length}</span></button>
      </div>

      {tab === 'system' && (
        <pre className="eye-code" dangerouslySetInnerHTML={{ __html: highlightPrompt(debug.rawSystemPrompt) }} />
      )}
      {tab === 'dynamic' && (
        <pre className="eye-code" dangerouslySetInnerHTML={{ __html: highlightPrompt(debug.rawDynamicContext) }} />
      )}

      {tab === 'musa' && (
        <div className="eye-musa">
          <div className="eye-musa-active-row">
            {currentMode ? (
              <>
                <span className={`eye-active-badge eye-badge-${currentMode.color}`}>{currentMode.icon} {currentMode.label}</span>
                <span className="eye-musa-active-desc">{currentMode.desc}</span>
              </>
            ) : <span className="eye-empty-sm">sin action_type todavía</span>}
          </div>

          <div className="eye-mode-legend">
            {Object.entries(MODE_META).map(([key, m]) => (
              <div key={key} className={`eye-legend-row${debug.actionType === key ? ' current' : ''}`}>
                <span className={`eye-legend-dot eye-fill-${m.color}`} />
                <span className="eye-legend-name">{m.label}</span>
                <span className="eye-legend-desc">{m.desc}</span>
                {debug.actionType === key && <span className="eye-legend-tag">fired</span>}
              </div>
            ))}
          </div>

          <div className="eye-ctx">
            <div className="eye-ctx-label">before — song structure</div>
            {debug.lineContext?.before?.length ? debug.lineContext.before.map((n, i) => (
              <div className="eye-ctx-line" key={i}><span className="eye-ctx-tag">{n.type}</span><span className="eye-ctx-txt">{n.text}</span></div>
            )) : <div className="eye-empty-sm">sin notas anteriores</div>}

            <div className="eye-ctx-label eye-ctx-label-n">current note — every physical line (N is the whole verse, not one line)</div>
            {debug.lineContext?.lines?.length ? debug.lineContext.lines.map((l) => (
              <div className="eye-ctx-line n" key={l.i}>
                <span className="eye-ctx-tag">{l.i + 1}</span>
                <span className="eye-ctx-txt">{l.text}</span>
                <span className="eye-ctx-meta">{l.syllables}s{l.rhyme ? ` · ${l.rhyme}` : ''}</span>
              </div>
            )) : <div className="eye-empty-sm">nota vacía</div>}

            <div className="eye-ctx-label">after — song structure</div>
            {debug.lineContext?.after?.length ? debug.lineContext.after.map((n, i) => (
              <div className="eye-ctx-line" key={i}><span className="eye-ctx-tag">{n.type}</span><span className="eye-ctx-txt">{n.text}</span></div>
            )) : <div className="eye-empty-sm">sin notas siguientes</div>}
          </div>

          <div className="eye-output">
            <div className="eye-output-label">lo que la musa dijo realmente</div>
            {output.suggestions?.map((s, i) => (
              <div className="eye-suggestion" key={i}><span className="eye-idx">{i + 1}</span><span>"{s.text}" — <i>{(s.type || '').toLowerCase()}</i></span></div>
            ))}
            {output.question && (
              <div className="eye-suggestion"><span className="eye-idx">?</span><span>{output.question.text}</span></div>
            )}
            {output.wordBank && (
              <div className="eye-suggestion"><span className="eye-idx">📖</span><span>rima {output.wordBank.rhymeType} con "{output.wordBank.targetRhyme}"</span></div>
            )}
            {!hasOutput && <div className="eye-empty-sm">sin salida parseada</div>}
          </div>

          {debug.verificationTrace?.length > 0 && (
            <div className="eye-funnel">
              <div className="eye-funnel-title">verification funnel</div>
              {debug.verificationTrace.map((step, i) => (
                <div className="eye-funnel-row" key={i}><span>{step.stage}</span><span className="eye-funnel-count">{step.count}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'baul' && (
        <div className="eye-pipeline">
          <div className="eye-pipe-refresh-row">
            <button className="eye-pipe-refresh" onClick={() => setShowBaulPrompt((v) => !v)}>
              {showBaulPrompt ? '▾' : '▸'} extraction system prompt ({BAUL_MODEL.replace('claude-', '')})
            </button>
            <button className="eye-pipe-refresh" onClick={refreshBaul} title="reload from baul_entries">↻ refresh</button>
          </div>
          {showBaulPrompt && <pre className="eye-code" dangerouslySetInnerHTML={{ __html: highlightPrompt(BAUL_SYSTEM_PROMPT) }} />}

          {baulEntries.length === 0 && <div className="eye-empty-sm eye-pipe-empty">nada registrado todavía — vuelca algo al baúl para verlo aquí</div>}
          {baulEntries.map((entry) => {
            const meta = TYPE_META[entry.input_type] || TYPE_META.text;
            const isOpen = openEntry === entry.id;
            const overBudget = entry.latency_ms > LATENCY_BUDGET_MS;
            return (
              <div className={`eye-pipe-row${isOpen ? ' open' : ''}`} key={entry.id}>
                <button className="eye-pipe-head" onClick={() => setOpenEntry(isOpen ? null : entry.id)}>
                  <span className={`eye-pipe-type eye-badge-${meta.color}`}>{meta.icon}</span>
                  <span className="eye-pipe-preview">{entry.raw_preview}</span>
                  <span className="eye-pipe-chev">▸</span>
                </button>
                {isOpen && (
                  <div className="eye-pipe-body">
                    {entry.latency_ms != null && (
                      <div className="eye-status-row">
                        <span className={`eye-badge ${overBudget ? 'eye-badge-warn' : ''}`}>{entry.latency_ms}ms</span>
                        <span className="eye-badge">{new Date(entry.created_at).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="eye-pipe-stage">
                      <span className="eye-pipe-stage-label">input</span>
                      <span className="eye-pipe-stage-content raw">{entry.raw_preview}</span>
                    </div>
                    <div className="eye-pipe-stage">
                      <span className="eye-pipe-stage-label">generado</span>
                      <span className="eye-pipe-stage-content">{entry.generated_summary || '(sin resumen — la musa no lo devolvió esta vez)'}</span>
                    </div>
                    {entry.tags?.length > 0 && (
                      <div className="eye-pipe-stage">
                        <span className="eye-pipe-stage-label">tags</span>
                        <span className="eye-pipe-stage-content">
                          <div className="eye-pipe-tags">{entry.tags.map((t, i) => <span className="eye-pipe-tag" key={i}>{t}</span>)}</div>
                        </span>
                      </div>
                    )}
                    <BaulEntryComment
                      entryId={entry.id}
                      snapshot={{
                        source: 'baul',
                        inputType: entry.input_type,
                        rawPreview: entry.raw_preview,
                        generatedSummary: entry.generated_summary,
                        tags: entry.tags,
                        songTitle, nodeLabel,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="eye-comment">
        <div className="eye-comment-label">
          your note on this response
          {savedComplaint && <span className="eye-comment-saved">✓ saved · in complaints summary</span>}
        </div>
        <textarea
          className="eye-comment-input"
          rows={2}
          value={commentDraft}
          placeholder="what's wrong with this one? (or just a note — anything you save here shows up in the complaints summary)"
          onChange={(e) => setCommentDraft(e.target.value)}
        />
        <div className="eye-comment-actions">
          <button className="eye-comment-save" onClick={handleSaveComment} disabled={!commentDraft.trim()}>
            {savedComplaint ? 'update note' : 'save note'}
          </button>
          {savedComplaint && (
            <button className="eye-comment-delete" onClick={handleDeleteComment}>delete</button>
          )}
        </div>
      </div>

      <div className="eye-foot">
        <span>project: {songTitle || '—'}</span>
        <span>node: {nodeLabel || '—'}</span>
      </div>
    </div>
  );
}
