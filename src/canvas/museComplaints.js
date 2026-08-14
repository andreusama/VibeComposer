// ─── Complaints — persisted QA notes on individual muse responses OR baúl
// absorptions ─────────────────────────────────────────────────────────────
// Deliberately separate from debugLog.js, which is explicitly in-memory/
// no-persistence (cleared on reload, by design — see its own header). A
// comment left here needs to survive past the session it was written in,
// or "end up with a summary of complaints" would mean starting over every
// time the tab closes. Keyed by debug.id (muse, see museApi.js's askMuse)
// or a baul_entries row id (baúl, see MuseEyePanel's BaulEntryComment) —
// either way a real, stable id for the exact thing being commented on, not
// debugLog's own separate entry id. snapshot.source ('muse' | 'baul')
// decides how formatComplaintsSummary below reads the rest of the snapshot.

const STORAGE_KEY = 'vc_muse_complaints';
const MAX_COMPLAINTS = 300;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_COMPLAINTS))); } catch { /* quota — non-critical, scratch QA data */ }
}

export function loadComplaints() {
  return load();
}

export function getComplaint(entryId) {
  return load().find((c) => c.id === entryId) || null;
}

// snapshot is a small, deliberately bounded slice of the real payload
// (actionType/parsedOutput for muse, inputType/rawPreview/generatedSummary/
// tags for baúl) — never the raw prompts, which would bloat localStorage
// fast and aren't what a "complaint" is about.
export function saveComplaint(entryId, comment, snapshot) {
  const list = load();
  const existing = list.findIndex((c) => c.id === entryId);
  const entry = { id: entryId, comment, at: new Date().toISOString(), ...snapshot };
  if (existing >= 0) list[existing] = entry;
  else list.unshift(entry);
  persist(list);
  return entry;
}

export function deleteComplaint(entryId) {
  persist(load().filter((c) => c.id !== entryId));
}

export function clearComplaints() {
  persist([]);
}

// What line 2 of a formatted/on-screen complaint shows — "what actually
// happened" for the thing being commented on. Branches on snapshot.source;
// defaults to 'muse' for entries saved before that field existed.
export function excerptFor(complaint) {
  if (complaint.source === 'baul') {
    return complaint.generatedSummary || complaint.rawPreview || '';
  }
  const output = complaint.parsedOutput;
  if (!output) return '';
  if (output.suggestions?.length) return output.suggestions.map((s) => s.text).join(' / ');
  if (output.question) return output.question.text;
  if (output.wordBank) return `rima ${output.wordBank.rhymeType} con "${output.wordBank.targetRhyme}"`;
  return '';
}

// Plain-text digest for pasting into a bug tracker / sharing with someone
// who isn't going to open the app — the literal "summary" the feature was
// asked for. Newest first, matching the on-screen list.
export function formatComplaintsSummary(complaints) {
  if (!complaints.length) return '(no complaints logged)';
  return complaints
    .map((c, i) => {
      const when = new Date(c.at).toLocaleString();
      const where = [c.songTitle, c.nodeLabel].filter(Boolean).join(' · ');
      const label = c.source === 'baul' ? `baúl · ${c.inputType || '—'}` : (c.actionType || '—');
      const speaker = c.source === 'baul' ? 'extracted' : 'muse';
      return `${i + 1}. [${label}] ${where ? where + ' · ' : ''}${when}\n`
        + `   ${speaker}: "${excerptFor(c)}"\n`
        + `   complaint: ${c.comment}`;
    })
    .join('\n\n');
}
