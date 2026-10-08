import { useState, useCallback } from 'react';
import { IcCheck, IcPlus } from '../mobile/icons.jsx';

// The folder chip row: toggle any of the artist's existing (flat) folders,
// or create a new one on the spot and it's selected immediately. Shared by
// ResourceEditorSheet (one resource) and ResourceImportSheet (a whole
// import batch) — both just need "which folders should this land in", the
// component owns its own "am I typing a new name right now" state so
// neither caller has to.
export default function FolderChipPicker({ folders, selectedIds, onToggle, onCreateFolder }) {
  const [newFolderName, setNewFolderName] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const [createError, setCreateError] = useState(null);
  // Guards against a double-create: Enter and the blur it can trigger (some
  // mobile keyboards blur the field on "done"/"enter") could otherwise both
  // fire handleCreateFolder for the same name before the first call resolves.
  const [creating, setCreating] = useState(false);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { folder, errorMessage } = await onCreateFolder(name);
      if (!folder) {
        // Surfaced right here, inline — this picker always lives inside a
        // full-screen sheet, which visually covers whatever error banner the
        // screen underneath might render. Keep the name typed so it isn't
        // lost on a failed attempt.
        setCreateError(errorMessage || 'no se pudo crear la carpeta');
        return;
      }
      // A brand-new id can never already be in selectedIds, so a plain
      // toggle is always an add here — it starts selected, you just asked for it.
      onToggle(folder.id);
      setNewFolderName('');
      setAddingFolder(false);
    } finally {
      setCreating(false);
    }
  }, [newFolderName, creating, onCreateFolder, onToggle]);

  return (
    <div className="res-folder-picker">
      <div className="res-chip-row">
        {folders.map((f) => (
          <button
            key={f.id}
            className={`res-chip${selectedIds.has(f.id) ? ' res-chip-active' : ''}`}
            onClick={() => onToggle(f.id)}
          >
            {selectedIds.has(f.id) && <IcCheck size={12} />} {f.name}
          </button>
        ))}
        {addingFolder ? (
          <span className="res-new-folder">
            <input
              className="res-new-folder-input"
              value={newFolderName}
              placeholder="nombre"
              autoFocus
              disabled={creating}
              onChange={(e) => { setNewFolderName(e.target.value); setCreateError(null); }}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              // Leaving the field with a name typed creates it — tapping the
              // checkmark was previously the only way, and just tapping
              // away (the natural "I'm done" gesture) silently discarded
              // whatever was typed with no feedback at all.
              onBlur={() => (newFolderName.trim() ? handleCreateFolder() : setAddingFolder(false))}
            />
            <button onClick={handleCreateFolder} disabled={creating}><IcCheck size={13} /></button>
          </span>
        ) : (
          <button className="res-chip res-chip-add" onClick={() => { setAddingFolder(true); setCreateError(null); }}><IcPlus size={13} /> carpeta</button>
        )}
      </div>
      {createError && <p className="res-folder-error">{createError}</p>}
    </div>
  );
}
