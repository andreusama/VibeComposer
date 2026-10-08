import { useState, useEffect, useCallback } from 'react';
import {
  loadCollaborators, removeCollaborator, createInvite, loadActiveInvites, revokeInvite, inviteUrl,
  MAX_COLLABORATORS,
} from '../canvas/collaborationData.js';
import { IcUsers, IcLink, IcTrash, IcCopy, IcCheck } from './icons.jsx';

// Reached from the song thread's header menu. Shows who's on this song
// (owner first, then editors by join order), lets the owner mint/revoke
// shareable invite links and remove an editor, and lets anyone who isn't
// the owner leave. All three of those map directly onto one `role in
// ('owner','editor')` table — see migration_project_collaboration.sql.
export default function CollaboratorsSheet({ songId, userId, isOwner, onClose }) {
  const [collaborators, setCollaborators] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const refresh = useCallback(async () => {
    const [collabRes, inviteRes] = await Promise.all([loadCollaborators(songId), loadActiveInvites(songId)]);
    if (collabRes.error) setError(collabRes.error.message || String(collabRes.error));
    setCollaborators(collabRes.data || []);
    setInvites(inviteRes.data || []);
    setLoading(false);
  }, [songId]);

  useEffect(() => { refresh(); }, [refresh]);

  const atCapacity = collaborators.length >= MAX_COLLABORATORS;

  const handleCreateInvite = useCallback(async () => {
    setCreatingInvite(true);
    setError(null);
    const { data, error: err } = await createInvite(songId, {});
    setCreatingInvite(false);
    if (err) { setError(err.message || String(err)); return; }
    setInvites((cur) => [data, ...cur]);
  }, [songId]);

  const handleCopy = useCallback(async (invite) => {
    const url = inviteUrl(invite.code);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId((cur) => (cur === invite.id ? null : cur)), 1500);
    } catch {
      // Clipboard permission can be denied (not every mobile webview grants
      // it without a direct user gesture it recognizes) — surfacing the
      // link as selectable text is the fallback the button's own title
      // already points to, nothing further to do here.
      setError('No se pudo copiar — mantén pulsado el enlace para copiarlo.');
    }
  }, []);

  const handleRevoke = useCallback(async (invite) => {
    await revokeInvite(invite.id);
    setInvites((cur) => cur.filter((i) => i.id !== invite.id));
  }, []);

  const handleRemove = useCallback(async (row) => {
    setRemovingId(row.id);
    const { error: err } = await removeCollaborator(row.id);
    setRemovingId(null);
    if (err) { setError(err.message || String(err)); return; }
    setCollaborators((cur) => cur.filter((c) => c.id !== row.id));
  }, []);

  return (
    <div className="baul-sheet-scrim" onClick={onClose}>
      <div className="baul-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="baul-sheet-body collab-sheet-body">
          <div className="attach-title"><IcUsers size={18} /> Colaboradores</div>
          <p className="attach-sub">
            {atCapacity ? `Este proyecto está al máximo (${MAX_COLLABORATORS} personas).` : `Hasta ${MAX_COLLABORATORS} personas pueden trabajar en este proyecto a la vez.`}
          </p>

          {error && <p className="thread-status thread-status-error">{error}</p>}

          {loading ? (
            <p className="attach-sub">Cargando…</p>
          ) : (
            <div className="collab-list">
              {collaborators.map((c) => (
                <div key={c.id} className="collab-row">
                  <span className="collab-avatar">{(c.profiles?.display_name || '?')[0].toUpperCase()}</span>
                  <div className="collab-row-info">
                    <span className="collab-row-name">
                      {c.profiles?.display_name || 'alguien'}{c.user_id === userId ? ' (tú)' : ''}
                    </span>
                    <span className="collab-row-role">{c.role === 'owner' ? 'propietario' : 'editor'}</span>
                  </div>
                  {c.role !== 'owner' && (isOwner || c.user_id === userId) && (
                    <button
                      className="collab-row-remove"
                      onClick={() => handleRemove(c)}
                      disabled={removingId === c.id}
                      title={c.user_id === userId ? 'salir del proyecto' : 'quitar colaborador'}
                    >
                      {removingId === c.id ? '…' : <IcTrash size={16} />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isOwner && (
            <>
              <div className="collab-divider" />
              <div className="collab-invites-head">
                <span className="attach-sub collab-invites-label">Enlaces de invitación</span>
                <button
                  className="collab-new-invite-btn"
                  onClick={handleCreateInvite}
                  disabled={creatingInvite || atCapacity}
                  title={atCapacity ? 'El proyecto ya está completo' : 'Crear enlace de invitación'}
                >
                  <IcLink size={15} /> {creatingInvite ? '…' : 'Nuevo enlace'}
                </button>
              </div>

              {invites.length === 0 ? (
                <p className="attach-sub">Sin enlaces activos.</p>
              ) : (
                <div className="collab-invite-list">
                  {invites.map((inv) => (
                    <div key={inv.id} className="collab-invite-row">
                      <code className="collab-invite-code">{inv.code.slice(0, 10)}…</code>
                      <button className="collab-invite-copy" onClick={() => handleCopy(inv)} title="copiar enlace">
                        {copiedId === inv.id ? <IcCheck size={15} /> : <IcCopy size={15} />}
                      </button>
                      <button className="collab-invite-revoke" onClick={() => handleRevoke(inv)} title="revocar enlace">
                        <IcTrash size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
