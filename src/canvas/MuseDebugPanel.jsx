import { useState } from 'react';

// Reuses the app's own domain colors instead of inventing new ones: chord
// (indigo) for the system/profile layer, thread (green) for local
// note/line context, amber for user intent — the muse's own color, since
// this is the one layer that's literally the artist's voice in the loop.
const LAYERS = [
  { key: 'museProfileAndSystem', label: 'sistema + perfil', color: 'var(--chord)' },
  { key: 'localNodeAndLines', label: 'contexto local', color: 'var(--thread)' },
  { key: 'userIntent', label: 'intención del usuario', color: 'var(--amber)' },
];

// Renders nothing when there's no _debug payload — askMuse only attaches
// one when explicitly asked (debug: true), so this component is safe to
// mount unconditionally next to the muse thread without gating on an env
// check itself; the caller decides whether debug mode is ever reachable.
export default function MuseDebugPanel({ debug }) {
  const [tab, setTab] = useState('system');
  if (!debug) return null;

  return (
    <div className="muse-debug-panel nodrag nowheel">
      <div className="muse-debug-bar">
        {LAYERS.map(({ key, color }) => (
          <div
            key={key}
            className="muse-debug-bar-segment"
            style={{ width: debug.weights[key].percentage, background: color }}
          />
        ))}
      </div>
      <div className="muse-debug-legend">
        {LAYERS.map(({ key, label, color }) => (
          <span className="muse-debug-legend-item" key={key}>
            <span className="muse-debug-legend-dot" style={{ background: color }} />
            {label} · {debug.weights[key].percentage} ({debug.weights[key].charCount} car.)
          </span>
        ))}
      </div>

      <div className="muse-debug-metrics">
        <div className="muse-debug-metric">
          <span className="muse-debug-metric-label">latencia</span>
          <span className="muse-debug-metric-value">{debug.latencyMs}ms</span>
        </div>
        <div className="muse-debug-metric">
          <span className="muse-debug-metric-label">modelo</span>
          <span className="muse-debug-metric-value">{debug.model}</span>
        </div>
        <div className="muse-debug-metric">
          <span className="muse-debug-metric-label">temperature</span>
          <span className="muse-debug-metric-value">{debug.parameters.temperature}</span>
        </div>
        <div className="muse-debug-metric">
          <span className="muse-debug-metric-label">thinking</span>
          <span className="muse-debug-metric-value">{debug.parameters.thinking}</span>
        </div>
      </div>

      <div className="muse-debug-tabs">
        <button
          className={`muse-debug-tab${tab === 'system' ? ' active' : ''}`}
          onClick={() => setTab('system')}
        >
          system prompt (cacheado)
        </button>
        <button
          className={`muse-debug-tab${tab === 'dynamic' ? ' active' : ''}`}
          onClick={() => setTab('dynamic')}
        >
          contexto dinámico
        </button>
      </div>
      <pre className="muse-debug-code">{tab === 'system' ? debug.rawSystemPrompt : debug.rawDynamicContext}</pre>
    </div>
  );
}
