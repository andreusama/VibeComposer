import { useState, useEffect, useCallback, useMemo } from 'react';
import { askMuse, buildStaticMuseInstructions, MUSE_MODEL } from '../utils/museApi.js';
import { getUsageRemaining } from '../utils/api.js';
import { MUSE_GOLDEN_SET, OPEN_REFERENCE_GOLDEN_SET } from './museGoldenSet.js';
import {
  loadLabRuns, saveLabRun, tagLabRun, deleteLabRun, clearLabRuns, computeAggregateStats,
  loadLabSnapshots, saveLabSnapshot, deleteLabSnapshot,
} from './museLabData.js';

// ─── Muse Lab — systematic prompt-engineering pipeline ─────────────────────
// Golden Set cases are hardcoded fixtures (museGoldenSet.js) — synthetic
// input scenarios, but every CALL made against them is a real askMuse()
// call: real Claude API, real applyMuseVerification pipeline. "Prompt B"
// lets you edit the literal system-prompt text and A/B it against the
// real code-generated Prompt A via askMuse's staticSystemOverride escape
// hatch — dev-only, never touched by any real product call path.

const MODES = ['SURGEON', 'ARCHITECT', 'SOCRATIC', 'WORD_BANK', 'OPEN_REFERENCE', 'AUTO'];
const MODE_META = {
  SURGEON: { icon: '🔧', label: 'surgeon' },
  ARCHITECT: { icon: '🏛', label: 'architect' },
  SOCRATIC: { icon: '❓', label: 'socratic' },
  WORD_BANK: { icon: '📖', label: 'word bank' },
  OPEN_REFERENCE: { icon: '🧭', label: 'open reference' },
  AUTO: { icon: '🎲', label: 'auto' },
};
const TAGS = [
  { id: 'good', label: 'Good' },
  { id: 'slop', label: 'Slop' },
  { id: 'off_vibe', label: 'Off-vibe' },
  { id: 'metric_error', label: 'Metric error' },
];

function excerptFor(response) {
  if (!response) return '';
  if (response.suggestions?.length) return response.suggestions.map((s) => s.text).join(' / ');
  if (response.question) return response.question.text;
  if (response.wordBank) return `rima ${response.wordBank.rhymeType} con "${response.wordBank.targetRhyme}"`;
  if (response.openReference) {
    const or = response.openReference;
    return or.declined ? `[declined · ${or.redirect}]` : `[${or.category}] ${or.answer}`;
  }
  return response.message || '';
}

function PipelineTrace({ trace, survivalRate }) {
  if (!trace?.length) return null;
  return (
    <div className="lab-funnel">
      <div className="lab-funnel-head">
        <span className="lab-funnel-title">verification pipeline</span>
        {survivalRate != null && <span className="lab-survival">{survivalRate}% survived</span>}
      </div>
      {trace.map((step, i) => (
        <div className="lab-funnel-step" key={i}>
          <div className="lab-funnel-step-head">
            <span>{step.stage}</span>
            <span className="lab-funnel-step-count">{step.count}</span>
          </div>
          {step.rejected?.length > 0 && (
            <div className="lab-funnel-rejected">
              {step.rejected.map((r, j) => <span className="lab-rejected-chip" key={j}>✕ {r}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ResultCard({ run, onTag }) {
  if (!run) return null;
  const excerpt = excerptFor(run.response);
  const matchesExpected = run.expectedMode ? run.expectedMode === run.actionType : null;
  return (
    <div className="lab-result-card">
      <div className="lab-result-head">
        <span className="lab-badge">{run.actionType || '—'}</span>
        {matchesExpected != null && (
          <span className={`lab-badge ${matchesExpected ? 'lab-badge-good' : 'lab-badge-warn'}`}>
            {matchesExpected ? '✓ expected mode' : `⚠ expected ${run.expectedMode}`}
          </span>
        )}
        <span className="lab-badge">{run.latencyMs}ms</span>
        {run.survivalRate != null && <span className="lab-badge">{run.survivalRate}% survived</span>}
        <span className="lab-badge lab-badge-version">{run.promptVersion}</span>
      </div>
      <p className="lab-result-excerpt">{excerpt || '(sin contenido)'}</p>
      <div className="lab-tag-row">
        {TAGS.map((t) => (
          <button key={t.id} className={`lab-tag-btn${run.tag === t.id ? ' active' : ''}`} onClick={() => onTag(run.id, t.id)}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MuseLabView() {
  // ── working inputs, seeded from the active Golden Set case ──
  const [activeCaseId, setActiveCaseId] = useState(MUSE_GOLDEN_SET[0].id);
  const activeCase = useMemo(() => MUSE_GOLDEN_SET.find((c) => c.id === activeCaseId) || MUSE_GOLDEN_SET[0], [activeCaseId]);
  const [verseText, setVerseText] = useState(activeCase.verseText);
  const [blockProfile, setBlockProfile] = useState(activeCase.blockProfile);
  const [lyricDnaText, setLyricDnaText] = useState(JSON.stringify(activeCase.lyricDna, null, 2));
  const [userMessage, setUserMessage] = useState(activeCase.userMessage);
  const [mode, setMode] = useState(activeCase.forceMode || 'AUTO');
  const [inputTab, setInputTab] = useState('verse');

  const loadCase = useCallback((c) => {
    setActiveCaseId(c.id);
    setVerseText(c.verseText);
    setBlockProfile(c.blockProfile);
    setLyricDnaText(JSON.stringify(c.lyricDna, null, 2));
    setUserMessage(c.userMessage);
    setMode(c.forceMode || 'AUTO');
  }, []);

  // ── Prompt A (real, code-generated) / Prompt B (editable override) ──
  const lyricDnaParsed = useMemo(() => {
    try { return { value: JSON.parse(lyricDnaText), error: null }; } catch (e) { return { value: null, error: e.message }; }
  }, [lyricDnaText]);
  const promptAText = useMemo(() => {
    if (lyricDnaParsed.error) return '(lyric_dna inválido — corrígelo para ver el prompt real)';
    return buildStaticMuseInstructions({ lyricDna: lyricDnaParsed.value, blockProfile, lang: activeCase.lang, dialect: activeCase.dialect });
  }, [lyricDnaParsed, blockProfile, activeCase.lang, activeCase.dialect]);
  const [promptBText, setPromptBText] = useState('');
  const [promptTab, setPromptTab] = useState('A');
  const cloneIntoB = useCallback(() => { setPromptBText(promptAText); setPromptTab('B'); }, [promptAText]);

  // ── dispatch ──
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState(null);
  const [currentRun, setCurrentRun] = useState(null);
  const [compareRun, setCompareRun] = useState(null); // the OTHER version's run on the same case, for diffing
  const [usage, setUsage] = useState(() => getUsageRemaining());
  const [batchProgress, setBatchProgress] = useState(null); // {done, total} while running the full set

  const [runs, setRuns] = useState(() => loadLabRuns());
  const refreshRuns = useCallback(() => setRuns(loadLabRuns()), []);

  const dispatchOne = useCallback(async (caseDef, promptVersion, { silent = false } = {}) => {
    const override = promptVersion === 'B' ? promptBText : null;
    const dnaForCall = caseDef === activeCase ? lyricDnaParsed.value : caseDef.lyricDna;
    const response = await askMuse({
      verseText: caseDef === activeCase ? verseText : caseDef.verseText,
      noteFunction: caseDef.noteFunction,
      blockProfile: caseDef === activeCase ? blockProfile : caseDef.blockProfile,
      lyricDna: dnaForCall,
      lang: caseDef.lang, dialect: caseDef.dialect,
      songStructure: caseDef.songStructure,
      targetVerse: caseDef.targetVerse,
      forceMode: caseDef === activeCase ? (mode === 'AUTO' ? null : mode) : caseDef.forceMode,
      userMessage: caseDef === activeCase ? userMessage : caseDef.userMessage,
      debug: true,
      staticSystemOverride: override,
      meta: { nodeLabel: `lab · ${caseDef.label}` },
    });
    const debug = response._debug;
    const run = saveLabRun({
      caseId: caseDef.id, caseLabel: caseDef.label, promptVersion,
      mode: debug?.actionType || response.action_type, actionType: response.action_type,
      expectedMode: caseDef.expectedMode, latencyMs: debug?.latencyMs, survivalRate: debug?.survivalRate,
      response, verificationTrace: debug?.verificationTrace,
    });
    if (!silent) refreshRuns();
    setUsage(getUsageRemaining());
    return run;
  }, [activeCase, verseText, blockProfile, lyricDnaParsed, mode, userMessage, promptBText, refreshRuns]);

  const handleRun = useCallback(async (promptVersion) => {
    if (!userMessage.trim() || dispatching) return;
    if (lyricDnaParsed.error) { setDispatchError(`lyric_dna inválido: ${lyricDnaParsed.error}`); return; }
    setDispatching(true);
    setDispatchError(null);
    try {
      const run = await dispatchOne(activeCase, promptVersion);
      if (promptVersion === 'A') { setCurrentRun(run); setCompareRun((prev) => (prev?.promptVersion === 'B' ? prev : null)); }
      else { setCompareRun(run); }
      if (promptVersion === 'B') setCurrentRun((prev) => prev || run);
      if (!currentRun && promptVersion === 'A') setCurrentRun(run);
    } catch (err) {
      setDispatchError(err.message === 'LIMIT_REACHED' ? 'daily AI limit reached' : err.message);
    } finally {
      setDispatching(false);
    }
  }, [userMessage, dispatching, lyricDnaParsed, activeCase, dispatchOne, currentRun]);

  const handleRunGoldenSet = useCallback(async (promptVersion) => {
    if (dispatching) return;
    setDispatching(true);
    setDispatchError(null);
    setBatchProgress({ done: 0, total: MUSE_GOLDEN_SET.length });
    try {
      for (let i = 0; i < MUSE_GOLDEN_SET.length; i++) {
        await dispatchOne(MUSE_GOLDEN_SET[i], promptVersion, { silent: true });
        setBatchProgress({ done: i + 1, total: MUSE_GOLDEN_SET.length });
      }
      refreshRuns();
    } catch (err) {
      setDispatchError(err.message === 'LIMIT_REACHED' ? 'daily AI limit reached mid-run' : err.message);
    } finally {
      setDispatching(false);
      setBatchProgress(null);
    }
  }, [dispatching, dispatchOne, refreshRuns]);

  // "Test guardrail" — runs exactly the 4 declined:true cases from the
  // OPEN_REFERENCE spec's own edge-case table against the REAL pipeline
  // (same dispatchOne every other run in this file uses, not a mock), and
  // checks whether the model actually declined each one. This is the one
  // check in the whole Lab where "did the real model behave" matters more
  // than prompt-engineering iteration speed — a guardrail that silently
  // stops working in production (a prompt tweak elsewhere regresses it, a
  // model update changes behavior) is a much worse failure mode than a
  // mediocre rhyme suggestion, so it gets its own always-real, one-click
  // check rather than living only as golden-set cases someone has to
  // remember to click through individually.
  const [guardrailResult, setGuardrailResult] = useState(null);
  const handleTestGuardrail = useCallback(async () => {
    if (dispatching) return;
    const cases = OPEN_REFERENCE_GOLDEN_SET.filter((c) => c.expectedDeclined === true);
    setDispatching(true);
    setDispatchError(null);
    setGuardrailResult(null);
    setBatchProgress({ done: 0, total: cases.length });
    const results = [];
    try {
      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const run = await dispatchOne(c, 'A', { silent: true });
        const declined = run.response?.openReference?.declined === true;
        results.push({
          caseId: c.id, label: c.label, userMessage: c.userMessage,
          pass: declined, actionType: run.actionType,
          excerpt: excerptFor(run.response),
        });
        setBatchProgress({ done: i + 1, total: cases.length });
      }
      refreshRuns();
      setGuardrailResult(results);
    } catch (err) {
      setDispatchError(err.message === 'LIMIT_REACHED' ? 'daily AI limit reached mid-run' : err.message);
    } finally {
      setDispatching(false);
      setBatchProgress(null);
    }
  }, [dispatching, dispatchOne, refreshRuns]);

  const handleTag = useCallback((runId, tagId) => {
    tagLabRun(runId, tagId);
    refreshRuns();
    setCurrentRun((r) => (r?.id === runId ? { ...r, tag: r.tag === tagId ? null : tagId } : r));
    setCompareRun((r) => (r?.id === runId ? { ...r, tag: r.tag === tagId ? null : tagId } : r));
  }, [refreshRuns]);

  // ── aggregate dashboard ──
  const [statsFilter, setStatsFilter] = useState('all'); // 'all' | 'A' | 'B'
  const filteredRuns = useMemo(
    () => (statsFilter === 'all' ? runs : runs.filter((r) => r.promptVersion === statsFilter)),
    [runs, statsFilter]
  );
  const stats = useMemo(() => computeAggregateStats(filteredRuns), [filteredRuns]);

  // ── snapshots ──
  const [snapshots, setSnapshots] = useState(() => loadLabSnapshots());
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [snapshotNotes, setSnapshotNotes] = useState('');
  const handleSaveSnapshot = useCallback(() => {
    if (!snapshotLabel.trim() || !promptBText.trim()) return;
    const bRuns = runs.filter((r) => r.promptVersion === 'B');
    saveLabSnapshot({ label: snapshotLabel.trim(), notes: snapshotNotes.trim(), promptBText, aggregateStats: computeAggregateStats(bRuns) });
    setSnapshots(loadLabSnapshots());
    setSnapshotLabel('');
    setSnapshotNotes('');
  }, [snapshotLabel, snapshotNotes, promptBText, runs]);
  const handleRestoreSnapshot = useCallback((snap) => {
    setPromptBText(snap.promptBText);
    setPromptTab('B');
  }, []);
  const handleDeleteSnapshot = useCallback((id) => {
    deleteLabSnapshot(id);
    setSnapshots(loadLabSnapshots());
  }, []);

  useEffect(() => { setUsage(getUsageRemaining()); }, [currentRun, compareRun]);

  return (
    <div className="lab-view">
      <div className="lab-usage-row">
        <span className="lab-usage">API usage: <b>{usage.used}</b>/{usage.limit} · {usage.remaining} left today</span>
        <span className="lab-model">{MUSE_MODEL}</span>
      </div>

      <div className="lab-grid">
        {/* ── Column 1: inputs & presets ── */}
        <div className="lab-col">
          <div className="lab-col-title">golden set</div>
          <div className="lab-case-list">
            {MUSE_GOLDEN_SET.map((c) => (
              <button key={c.id} className={`lab-case-btn${c.id === activeCaseId ? ' active' : ''}`} onClick={() => loadCase(c)} title={c.description}>
                <span className="lab-case-label">{c.label}</span>
                <span className="lab-case-expect">expects {c.expectedMode}</span>
              </button>
            ))}
          </div>
          <p className="lab-case-desc">{activeCase.description}</p>

          <div className="lab-hr" />

          <div className="lab-tabs">
            <button className={`lab-tab${inputTab === 'verse' ? ' active' : ''}`} onClick={() => setInputTab('verse')}>verseText</button>
            <button className={`lab-tab${inputTab === 'block' ? ' active' : ''}`} onClick={() => setInputTab('block')}>block profile</button>
            <button className={`lab-tab${inputTab === 'dna' ? ' active' : ''}`} onClick={() => setInputTab('dna')}>lyric_dna</button>
          </div>
          {inputTab === 'verse' && (
            <textarea className="lab-textarea" rows={6} value={verseText} onChange={(e) => setVerseText(e.target.value)} spellCheck={false} />
          )}
          {inputTab === 'block' && (
            <textarea className="lab-textarea" rows={6} value={blockProfile} onChange={(e) => setBlockProfile(e.target.value)} placeholder="(vacío — este bloque no tiene resumen local todavía)" spellCheck={false} />
          )}
          {inputTab === 'dna' && (
            <>
              <textarea className="lab-textarea lab-mono" rows={10} value={lyricDnaText} onChange={(e) => setLyricDnaText(e.target.value)} spellCheck={false} />
              {lyricDnaParsed.error && <div className="lab-error">⚠ {lyricDnaParsed.error}</div>}
            </>
          )}

          <div className="lab-hr" />

          <div className="lab-row-between">
            <div className="lab-tabs">
              <button className={`lab-tab${promptTab === 'A' ? ' active' : ''}`} onClick={() => setPromptTab('A')}>prompt A (real)</button>
              <button className={`lab-tab${promptTab === 'B' ? ' active' : ''}`} onClick={() => setPromptTab('B')}>prompt B {promptBText && '●'}</button>
            </div>
            <button className="lab-btn-ghost" onClick={cloneIntoB}>clone A → B</button>
          </div>
          {promptTab === 'A' ? (
            <pre className="lab-prompt-view">{promptAText}</pre>
          ) : (
            <textarea
              className="lab-textarea lab-mono lab-prompt-edit"
              rows={12}
              value={promptBText}
              onChange={(e) => setPromptBText(e.target.value)}
              placeholder="clone A first, then edit freely — this literal text replaces the real system prompt when you Run (B)"
              spellCheck={false}
            />
          )}
        </div>

        {/* ── Column 2: execution & taller ── */}
        <div className="lab-col">
          <div className="lab-col-title">execution</div>
          <textarea className="lab-textarea" rows={2} value={userMessage} onChange={(e) => setUserMessage(e.target.value)} placeholder="musa, ..." />

          <div className="lab-mode-row">
            {MODES.map((m) => (
              <button key={m} className={`lab-mode-btn${mode === m ? ' active' : ''}`} onClick={() => setMode(m)} title={MODE_META[m].label}>
                {MODE_META[m].icon} {MODE_META[m].label}
              </button>
            ))}
          </div>

          <div className="lab-run-row">
            <button className="lab-btn" onClick={() => handleRun('A')} disabled={dispatching}>{dispatching ? '…' : 'Run (A)'}</button>
            <button className="lab-btn lab-btn-b" onClick={() => handleRun('B')} disabled={dispatching || !promptBText.trim()}>Run (B)</button>
          </div>
          <div className="lab-run-row">
            <button className="lab-btn-ghost" onClick={() => handleRunGoldenSet('A')} disabled={dispatching}>▶ run full golden set (A)</button>
            <button className="lab-btn-ghost" onClick={() => handleRunGoldenSet('B')} disabled={dispatching || !promptBText.trim()}>▶ run full golden set (B)</button>
          </div>
          <div className="lab-run-row">
            <button className="lab-btn-ghost lab-btn-guardrail" onClick={handleTestGuardrail} disabled={dispatching} title="runs the 4 declined:true OPEN_REFERENCE cases against the real API">
              🛡 test guardrail
            </button>
          </div>
          {batchProgress && <div className="lab-progress">running {batchProgress.done}/{batchProgress.total}…</div>}
          {dispatchError && <div className="lab-error">⚠ {dispatchError}</div>}

          {guardrailResult && (
            <div className="lab-guardrail-summary">
              <div className="lab-guardrail-head">
                <span>guardrail: {guardrailResult.filter((r) => r.pass).length}/{guardrailResult.length} passed</span>
                {guardrailResult.every((r) => r.pass)
                  ? <span className="lab-badge lab-badge-good">✓ all declined correctly</span>
                  : <span className="lab-badge lab-badge-warn">⚠ silent guardrail failure</span>}
              </div>
              {guardrailResult.map((r) => (
                <div className="lab-guardrail-row" key={r.caseId}>
                  <span className={r.pass ? 'lab-guardrail-pass' : 'lab-guardrail-fail'}>{r.pass ? '✓' : '✕'}</span>
                  <span className="lab-guardrail-question">{r.userMessage}</span>
                  {!r.pass && <span className="lab-badge lab-badge-warn">{r.actionType || '—'}</span>}
                </div>
              ))}
            </div>
          )}

          {(currentRun || compareRun) && (
            <>
              <div className="lab-hr" />
              <div className={`lab-compare${currentRun && compareRun ? ' split' : ''}`}>
                {currentRun && (
                  <div className="lab-compare-col">
                    <PipelineTrace trace={currentRun.verificationTrace} survivalRate={currentRun.survivalRate} />
                    <ResultCard run={currentRun} onTag={handleTag} />
                  </div>
                )}
                {compareRun && compareRun.id !== currentRun?.id && (
                  <div className="lab-compare-col">
                    <PipelineTrace trace={compareRun.verificationTrace} survivalRate={compareRun.survivalRate} />
                    <ResultCard run={compareRun} onTag={handleTag} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Column 3: golden bench & telemetry ── */}
        <div className="lab-col">
          <div className="lab-col-title">snapshots</div>
          <input className="lab-input" placeholder="label (e.g. v2.1 — anti-slop blacklist added)" value={snapshotLabel} onChange={(e) => setSnapshotLabel(e.target.value)} />
          <textarea className="lab-textarea" rows={2} placeholder="what changed and why…" value={snapshotNotes} onChange={(e) => setSnapshotNotes(e.target.value)} />
          <button className="lab-btn" onClick={handleSaveSnapshot} disabled={!snapshotLabel.trim() || !promptBText.trim()}>save Prompt B snapshot</button>
          <div className="lab-snapshot-list">
            {snapshots.length === 0 && <span className="lab-empty-sm">no snapshots yet.</span>}
            {snapshots.map((s) => (
              <div className="lab-snapshot-row" key={s.id}>
                <div className="lab-snapshot-info">
                  <span className="lab-snapshot-label">{s.label}</span>
                  <span className="lab-snapshot-score">
                    {s.aggregateStats.total > 0 ? `${s.aggregateStats.tagPercentages.good}% good · ${s.aggregateStats.total} runs` : 'no tagged runs yet'}
                  </span>
                  {s.notes && <span className="lab-snapshot-notes">{s.notes}</span>}
                </div>
                <button className="lab-btn-ghost" onClick={() => handleRestoreSnapshot(s)}>restore</button>
                <button className="lab-btn-icon" onClick={() => handleDeleteSnapshot(s.id)}>✕</button>
              </div>
            ))}
          </div>

          <div className="lab-hr" />

          <div className="lab-row-between">
            <div className="lab-col-title">aggregate metrics</div>
            <div className="lab-tabs">
              <button className={`lab-tab${statsFilter === 'all' ? ' active' : ''}`} onClick={() => setStatsFilter('all')}>all</button>
              <button className={`lab-tab${statsFilter === 'A' ? ' active' : ''}`} onClick={() => setStatsFilter('A')}>A</button>
              <button className={`lab-tab${statsFilter === 'B' ? ' active' : ''}`} onClick={() => setStatsFilter('B')}>B</button>
            </div>
          </div>
          <div className="lab-stats-summary">{stats.total} runs · {stats.untagged} untagged</div>
          <div className="lab-tag-stats">
            <span className="lab-stat-good">{stats.tagPercentages.good}% good</span>
            <span className="lab-stat-bad">{stats.tagPercentages.slop}% slop</span>
            <span className="lab-stat-bad">{stats.tagPercentages.off_vibe}% off-vibe</span>
            <span className="lab-stat-bad">{stats.tagPercentages.metric_error}% metric error</span>
          </div>
          <div className="lab-mode-stats">
            {Object.entries(stats.modeStats).map(([m, s]) => (
              <div className="lab-mode-stat-row" key={m}>
                <span>{MODE_META[m]?.icon || '·'} {m}</span>
                <span className="lab-stat-count">{s.count} runs</span>
                <span className="lab-stat-latency">{s.avgLatency}ms avg</span>
              </div>
            ))}
          </div>

          <div className="lab-hr" />

          <div className="lab-row-between">
            <div className="lab-col-title">run history</div>
            {runs.length > 0 && <button className="lab-btn-ghost" onClick={() => { clearLabRuns(); refreshRuns(); }}>clear</button>}
          </div>
          <div className="lab-history-list">
            {runs.length === 0 && <span className="lab-empty-sm">runs appear here as you dispatch.</span>}
            {runs.slice(0, 30).map((r) => (
              <div className="lab-history-row" key={r.id}>
                <span className={`lab-badge lab-badge-version`}>{r.promptVersion}</span>
                <span className="lab-history-case">{r.caseLabel}</span>
                <span className="lab-badge">{r.actionType || '—'}</span>
                {r.tag && <span className="lab-history-tag">{TAGS.find((t) => t.id === r.tag)?.label}</span>}
                <button className="lab-btn-icon" onClick={() => { deleteLabRun(r.id); refreshRuns(); }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
