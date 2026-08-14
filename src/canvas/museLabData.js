// ─── Muse Lab — run history, tagging, and snapshot storage ─────────────────
// Deliberately separate from debugLog.js (ephemeral, in-memory, every real
// call in the app) and museComplaints.js (written notes on a single real
// call/absorption). This is specifically for Golden Set benchmark runs —
// persisted, quick-tagged (not written notes), and aggregable into a
// dashboard. localStorage-backed, same pattern as everything else here.

const RUNS_KEY = 'vc_muse_lab_runs';
const SNAPSHOTS_KEY = 'vc_muse_lab_snapshots';
const MAX_RUNS = 300;
const MAX_SNAPSHOTS = 100;

const makeId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function load(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function persist(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* quota — non-critical, scratch QA data */ }
}

// ─── Runs ───────────────────────────────────────────────────────────────

export function loadLabRuns() {
  return load(RUNS_KEY);
}

export function saveLabRun({ caseId, caseLabel, promptVersion, mode, actionType, expectedMode, latencyMs, survivalRate, response, verificationTrace }) {
  const list = load(RUNS_KEY);
  const entry = {
    id: makeId(), caseId, caseLabel, promptVersion, mode, actionType, expectedMode,
    latencyMs, survivalRate, response, verificationTrace, tag: null,
    at: new Date().toISOString(),
  };
  list.unshift(entry);
  persist(RUNS_KEY, list.slice(0, MAX_RUNS));
  return entry;
}

export function tagLabRun(runId, tagId) {
  const list = load(RUNS_KEY);
  const idx = list.findIndex((r) => r.id === runId);
  if (idx === -1) return;
  list[idx] = { ...list[idx], tag: list[idx].tag === tagId ? null : tagId };
  persist(RUNS_KEY, list);
}

export function deleteLabRun(runId) {
  persist(RUNS_KEY, load(RUNS_KEY).filter((r) => r.id !== runId));
}

export function clearLabRuns() {
  persist(RUNS_KEY, []);
}

// Aggregate dashboard data — tag percentages across whatever run set is
// passed in (usually "all runs for the active prompt version"), plus
// avg latency broken down by mode. Pure function, no I/O, so the caller
// decides scope (all runs, one prompt version, one golden-set case, etc.)
// by filtering before calling this.
export function computeAggregateStats(runs) {
  const tagCounts = { good: 0, slop: 0, off_vibe: 0, metric_error: 0 };
  let untagged = 0;
  const byMode = {};

  runs.forEach((r) => {
    if (r.tag && tagCounts[r.tag] !== undefined) tagCounts[r.tag]++;
    else untagged++;
    const m = r.mode || 'UNKNOWN';
    if (!byMode[m]) byMode[m] = { count: 0, totalLatency: 0 };
    byMode[m].count++;
    byMode[m].totalLatency += r.latencyMs || 0;
  });

  const total = runs.length;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const modeStats = Object.fromEntries(
    Object.entries(byMode).map(([m, { count, totalLatency }]) => [
      m, { count, avgLatency: count > 0 ? Math.round(totalLatency / count) : 0 },
    ])
  );

  return {
    total,
    untagged,
    tagCounts,
    tagPercentages: { good: pct(tagCounts.good), slop: pct(tagCounts.slop), off_vibe: pct(tagCounts.off_vibe), metric_error: pct(tagCounts.metric_error) },
    modeStats,
  };
}

// ─── Prompt B snapshots ─────────────────────────────────────────────────

export function loadLabSnapshots() {
  return load(SNAPSHOTS_KEY);
}

export function saveLabSnapshot({ label, notes, promptBText, aggregateStats }) {
  const list = load(SNAPSHOTS_KEY);
  const entry = { id: makeId(), label, notes, promptBText, aggregateStats, at: new Date().toISOString() };
  list.unshift(entry);
  persist(SNAPSHOTS_KEY, list.slice(0, MAX_SNAPSHOTS));
  return entry;
}

export function deleteLabSnapshot(id) {
  persist(SNAPSHOTS_KEY, load(SNAPSHOTS_KEY).filter((s) => s.id !== id));
}
