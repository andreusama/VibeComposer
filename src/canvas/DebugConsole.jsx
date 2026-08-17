import {useState, useEffect} from 'react';
import {subscribeDebugLog, clearDebugLog} from '../utils/debugLog.js';

// The "open a dev console" gesture games (Quake, Source, Minecraft) and
// plenty of dev tools have trained people to reach for — the physical key
// top-left of the number row, next to "1". Checked via e.code (physical
// position, layout-independent), not e.key (the character it types):
// e.key === '`' only works on US/UK layouts. On a Spanish keyboard that
// same physical key prints º/ª, and the actual backtick character lives
// elsewhere as a dead key that wouldn't reliably fire a single keydown at
// all — e.code sidesteps all of that by matching the key's position, not
// what it prints, so this works the same regardless of layout/language.
export default function DebugConsole() {
    const [open, setOpen] = useState(false);
    const [entries, setEntries] = useState([]);

    useEffect(() => subscribeDebugLog(setEntries), []);

    useEffect(() => {
        const onKeyDown = (e) => {
            // Debug helper: check what your system is actually outputting when pressing º
            // console.log('e.code:', e.code, '| e.key:', e.key);

            const activeTag = document.activeElement?.tagName;
            const isContentEditable = document.activeElement?.isContentEditable;
            const typing = ['INPUT', 'TEXTAREA'].includes(activeTag) || isContentEditable;

            // Check physical position (Backquote / IntlBackslash) OR fallback character
            const isTopLeftKey =
                e.code === 'Backquote' ||
                e.code === 'IntlBackslash' ||
                ['º', 'ª', '`'].includes(e.key);

            if (isTopLeftKey && !typing) {
                e.preventDefault();
                setOpen((v) => !v);
            } else if (e.key === 'Escape' && open) {
                setOpen(false);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open]);

    if (!open) return null;

    return (
        <div className="debug-console">
            <div className="debug-console-head">
                <span className="debug-console-title">debug console · top-left key (next to "1") to close</span>
                <button className="debug-console-clear" onClick={clearDebugLog}>clear</button>
            </div>
            <div className="debug-console-body">
                {entries.length === 0 &&
                    <p className="debug-console-empty">nothing logged yet — trigger the muse with its 🔧 debug toggle
                        on</p>}
                {entries.slice().reverse().map((entry) => (
                    <details className="debug-console-entry" key={entry.id}>
                        <summary>
                            <span className="debug-console-entry-source">{entry.source}</span>
                            <span className="debug-console-entry-time">{entry.at.toLocaleTimeString()}</span>
                        </summary>
                        <pre>{JSON.stringify(entry.payload, null, 2)}</pre>
                    </details>
                ))}
            </div>
        </div>
    );
}
