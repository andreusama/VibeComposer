// Notes are a flat table — a "variant" is just another independent note
// that happens to share thread_index with another (see
// migration_mobile_thread_index.sql). Grouping is pure presentation: bucket
// by thread_index, sort buckets by that same value, done. No parent/child
// relationship anywhere in this. Notes without a thread_index (created on
// desktop, which never touches this column) each get their own singleton
// slot rather than being silently dropped.
export function groupNotesByThreadIndex(notes) {
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
