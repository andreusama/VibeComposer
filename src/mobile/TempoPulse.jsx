// One shared amber dot, used in both the song-thread header and the note
// editor header — always the same value in both places now (see
// SongThreadScreen's songBpm: one plain tempo per song, set from the
// "···" menu's Tempo action, deliberately NOT derived from any chord
// progression's tempo_node_id — desktop's plug-in relationship is for
// beat-accurate playback, which mobile doesn't have yet, so tying the
// pulse to it would mean it could never show anything in practice).
// Pulses at the actual rhythm — animation-duration is 60000/bpm ms, not a
// fixed 500ms; 500ms only happens to be right at 120 BPM. Renders nothing
// if there's no bpm set yet — no dot is more honest than a static one, and
// there's nothing to tap-to-edit if onClick isn't given (only the thread
// header wires it, opening the Tempo sheet; the note editor's copy is
// display-only, edited from the thread level).
export default function TempoPulse({ bpm, onClick }) {
  if (!bpm) return null;
  const dot = (
    <>
      <span className="tempo-pulse-dot" style={{ animationDuration: `${60000 / bpm}ms` }} />
      {bpm}
    </>
  );
  if (!onClick) {
    return <span className="tempo-pulse" title={`${bpm} BPM`}>{dot}</span>;
  }
  return (
    <button className="tempo-pulse tempo-pulse-btn" title={`${bpm} BPM — tap to change`} onClick={onClick}>
      {dot}
    </button>
  );
}
