import { useState, useCallback } from 'react';
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from './resourcesData.js';
import FolderChipPicker from './FolderChipPicker.jsx';
import { IcTrash } from '../mobile/icons.jsx';

// Create AND edit in one sheet — only `body` is ever required to save; type,
// tags, origin and folders are all optional and just as reachable at
// creation time as later, so nothing forces a second "now label it" step.
// `resource` null means create mode. `folders` is the artist's whole flat
// folder list; `onCreateFolder` lets a new one be filed into on the spot.
export default function ResourceEditorSheet({ resource, folders, memberFolderIds = [], onSave, onDelete, onCreateFolder, onClose }) {
  const [body, setBody] = useState(resource?.body || '');
  const [type, setType] = useState(resource?.type || null);
  const [tagsText, setTagsText] = useState((resource?.tags || []).join(', '));
  const [origin, setOrigin] = useState(resource?.origin || '');
  const [selectedFolders, setSelectedFolders] = useState(new Set(memberFolderIds));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggleFolder = useCallback((id) => {
    setSelectedFolders((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      await onSave({ body: trimmed, type, tags, origin: origin.trim() || null }, [...selectedFolders]);
    } finally {
      setSaving(false);
    }
  }, [body, type, tagsText, origin, selectedFolders, saving, onSave]);

  return (
    <div className="baul-sheet-scrim" onClick={onClose}>
      <div className="baul-sheet res-editor-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        {/* Dimmed (not hidden) during the delete confirm, same pattern
            BaulSheet already uses — the confirm card is a small floating
            overlay near the bottom (.confirm-sheet), not full coverage, so
            without this the whole edit form (textarea, chips, Guardar…)
            stayed fully visible and interactive behind it. */}
        <div className={`baul-sheet-body res-editor-body${confirmDelete ? ' baul-sheet-body-dimmed' : ''}`}>
          <div className="attach-title">{resource ? 'Editar recurso' : 'Nuevo recurso'}</div>

          <textarea
            className="res-body-input"
            value={body}
            placeholder="una metáfora, un refrán, una frase que te dijeron…"
            onChange={(e) => setBody(e.target.value)}
            autoFocus={!resource}
          />

          <div className="res-field-label">Tipo</div>
          <div className="res-chip-row">
            {RESOURCE_TYPES.map((t) => (
              <button
                key={t}
                className={`res-chip${type === t ? ' res-chip-active' : ''}`}
                onClick={() => setType(type === t ? null : t)}
              >
                {RESOURCE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <div className="res-field-label">Etiquetas</div>
          <input
            className="res-text-input"
            value={tagsText}
            placeholder="amor, pérdida, calle…"
            onChange={(e) => setTagsText(e.target.value)}
          />

          <div className="res-field-label">Origen</div>
          <input
            className="res-text-input"
            value={origin}
            placeholder="Rayuela, p. 214 — un tío en el bar de la esquina…"
            onChange={(e) => setOrigin(e.target.value)}
          />

          <div className="res-field-label">Carpetas</div>
          <FolderChipPicker folders={folders} selectedIds={selectedFolders} onToggle={toggleFolder} onCreateFolder={onCreateFolder} />

          <button className="baul-note-submit res-save-btn" onClick={handleSave} disabled={saving || !body.trim()}>
            {saving ? '…' : 'Guardar'}
          </button>

          {resource && !confirmDelete && (
            <button className="clear-option res-delete-btn" onClick={() => setConfirmDelete(true)}>
              <span className="aic"><span className="clear-icon"><IcTrash size={18} /></span></span>
              <span className="clear-option-body">
                <span className="tt">Eliminar recurso</span>
              </span>
            </button>
          )}
        </div>

        {confirmDelete && (
          <div className="confirm-sheet">
            <div className="confirm-card">
              <div className="confirm-text">
                <div className="tt">¿Eliminar este recurso?</div>
                <div className="ss">No se puede deshacer.</div>
              </div>
              <button className="confirm-btn destructive" onClick={() => onDelete(resource)}>Eliminar</button>
            </div>
            <button className="confirm-cancel" onClick={() => setConfirmDelete(false)}>Cancelar</button>
          </div>
        )}
      </div>
    </div>
  );
}
