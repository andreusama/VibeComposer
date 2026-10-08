import { useState, useCallback } from 'react';
import { IcTrash, IcFolder } from '../mobile/icons.jsx';

// Reached from the folder-filter row's "···" button (main Recursos screen)
// — the one place `deleteFolder` (resourcesData.js) is actually wired to
// anything; it existed unused since the folder feature first shipped.
// Deleting a folder never touches the resources inside it — only the
// container and its membership rows go (on delete cascade, see the
// migration), same "the container goes, the contents survive" rule
// deleting an album already follows.
export default function ManageFoldersSheet({ folders, onDelete, onClose }) {
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const handleConfirmDelete = useCallback(async (folder) => {
    setDeletingId(folder.id);
    try {
      await onDelete(folder);
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  }, [onDelete]);

  return (
    <div className="baul-sheet-scrim" onClick={onClose}>
      <div className="baul-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="baul-sheet-body res-manage-folders-body">
          <div className="attach-title">Carpetas</div>
          {folders.length === 0 ? (
            <p className="attach-sub">Aún no tienes carpetas.</p>
          ) : (
            <div className="res-manage-folders-list">
              {folders.map((f) => (
                <div key={f.id} className="res-manage-folder-row">
                  {confirmingId === f.id ? (
                    <>
                      <span className="res-manage-folder-confirm-text">¿Eliminar «{f.name}»? Las notas no se borran.</span>
                      <div className="res-manage-folder-confirm-actions">
                        <button className="res-manage-folder-cancel" onClick={() => setConfirmingId(null)} disabled={deletingId === f.id}>Cancelar</button>
                        <button className="res-manage-folder-confirm-btn" onClick={() => handleConfirmDelete(f)} disabled={deletingId === f.id}>
                          {deletingId === f.id ? '…' : 'Eliminar'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="res-manage-folder-name"><IcFolder size={15} /> {f.name}</span>
                      <button className="res-manage-folder-delete" onClick={() => setConfirmingId(f.id)} title="eliminar carpeta" aria-label={`Eliminar la carpeta ${f.name}`}>
                        <IcTrash size={16} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
