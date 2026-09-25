import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  loadResourceLibrary, createResource, updateResource, deleteResource,
  createFolder, deleteFolder, setResourceFolders, RESOURCE_TYPE_LABELS,
} from './resourcesData.js';
import ResourceEditorSheet from './ResourceEditorSheet.jsx';
import ResourceImportSheet from './ResourceImportSheet.jsx';
import ManageFoldersSheet from './ManageFoldersSheet.jsx';
import MobileScreen from '../mobile/MobileScreen.jsx';
import MobileFab from '../mobile/MobileFab.jsx';
import { IcSearch, IcFolder, IcPencil, IcPaperclip, IcInfo, IcMore } from '../mobile/icons.jsx';

const CHOOSER_OPTIONS = [
  {
    key: 'new', icon: IcPencil, iconVariant: 'thread', label: 'Escribir un recurso',
    info: 'Guarda a mano una metáfora, un refrán o una frase que se te haya ocurrido.',
  },
  {
    key: 'import', icon: IcPaperclip, iconVariant: 'amber', label: 'Importar texto',
    info: 'Pega un texto largo — notas del móvil, un chat exportado — o adjunta una foto de una página o libreta. La musa busca dentro frases reales que valga la pena guardar. Nada se guarda todavía: eliges cuáles conservar en la pantalla siguiente.',
  },
];

// FAB chooser — same "pick what kind of thing you're creating" pattern as
// the projects screen's Sencillo/Álbum sheet. "Importar" is a distinct path
// from writing one resource by hand: it goes through Claude's segmentation
// (resourceImportProcessor.js) and a review step before anything saves —
// not obvious from the label alone, hence the explanatory (i) on each
// option, not just the less obvious one, so the row isn't lopsided.
//
// Each option is a `div role="button"` rather than a real `<button>` so it
// can host a genuinely separate, independently-tappable info button without
// nesting interactive elements — same fix MobileProjectsScreen's own row
// needed for its swipe-delete action (see ProjectRow.jsx).
function NewResourceChooser({ onPick, onClose }) {
  const [infoOpen, setInfoOpen] = useState(null); // null | option key

  return (
    <div className="baul-sheet-scrim" onClick={onClose}>
      <div className="baul-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="ts-grabber" />
        <div className="baul-sheet-body">
          <div className="attach-title">Nuevo recurso</div>
          {CHOOSER_OPTIONS.map(({ key, icon: Icon, iconVariant, label, info }) => (
            <div className="attach-option-wrap" key={key}>
              <div className="attach-option attach-option-row">
                <div
                  className="attach-option-main"
                  role="button"
                  tabIndex={0}
                  onClick={() => onPick(key)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(key); } }}
                >
                  <span className={`aic aic-${iconVariant}`}><Icon size={18} /></span>
                  <span className="tt">{label}</span>
                </div>
                <button
                  className="attach-option-info-btn"
                  onClick={(e) => { e.stopPropagation(); setInfoOpen((cur) => (cur === key ? null : key)); }}
                  title="qué es esto"
                  aria-label={`Qué es "${label}"`}
                >
                  <IcInfo size={16} />
                </button>
              </div>
              {infoOpen === key && <p className="attach-option-desc">{info}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResourceCard({ resource, folderNames, onOpen }) {
  return (
    <button className="res-card" onClick={onOpen}>
      <p className="res-card-body">{resource.body}</p>
      {/* Its own line, right under the text — the folder is where this
          resource lives, worth noticing before the type/origin/tags
          detail, not just another chip blended into that row. */}
      {folderNames.length > 0 && (
        <div className="res-card-folders">
          {folderNames.map((name) => (
            <span key={name} className="res-tag res-tag-folder"><IcFolder size={11} /> {name}</span>
          ))}
        </div>
      )}
      <div className="res-card-meta">
        {resource.type && <span className="res-card-type">{RESOURCE_TYPE_LABELS[resource.type]}</span>}
        {resource.origin && <span className="res-card-origin">{resource.origin}</span>}
      </div>
      {resource.tags?.length > 0 && (
        <div className="res-card-tags">
          {resource.tags.map((t) => <span key={t} className="res-tag">{t}</span>)}
        </div>
      )}
    </button>
  );
}

// The artist-level "Recursos" library — one page of MobileHomePager's
// bottom-tab-bar strip, not song-scoped (see resourcesData.js). Browse by
// folder or search everything; tap a resource to edit or delete it; the FAB
// opens the same editor in create mode (only the text is ever required).
export default function MobileResourcesScreen({ state, justEntered }) {
  const userId = state.session?.user?.id;
  const [resources, setResources] = useState([]);
  const [folders, setFolders] = useState([]);
  const [membership, setMembership] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [activeFolderId, setActiveFolderId] = useState(null); // null = "Todos"
  const [sheet, setSheet] = useState(null); // null | 'chooser' | 'new' | 'import' | a resource object
  const [manageFoldersOpen, setManageFoldersOpen] = useState(false);

  const load = useCallback(() => {
    if (!userId) return;
    loadResourceLibrary(userId).then(({ resources, folders, membership, error }) => {
      setResources(resources); setFolders(folders); setMembership(membership);
      setError(error); setLoaded(true);
    });
  }, [userId]);

  useEffect(() => { if (justEntered) load(); }, [justEntered, load]);

  const folderNameFor = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f.name])), [folders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter((r) => {
      if (activeFolderId && !(membership[r.id] || []).includes(activeFolderId)) return false;
      if (!q) return true;
      const haystack = [r.body, r.origin, ...(r.tags || [])].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [resources, membership, activeFolderId, query]);

  // Returns {folder, errorMessage} rather than a bare folder|null — this is
  // always called from inside a full-screen sheet (ResourceEditorSheet /
  // ResourceImportSheet via FolderChipPicker), which visually covers this
  // screen's own error banner below. A failure used to only ever reach
  // `error` here, i.e. nowhere the artist could actually see it while the
  // sheet was open — the caller now gets the message directly and shows it
  // inline (see FolderChipPicker).
  const handleCreateFolderInline = useCallback(async (name) => {
    if (!userId) return { folder: null, errorMessage: 'sesión no disponible' };
    const { data, error } = await createFolder(userId, name);
    if (error) { setError(error.message); return { folder: null, errorMessage: error.message }; }
    setFolders((cur) => [...cur, data]);
    return { folder: data, errorMessage: null };
  }, [userId]);

  // Deleting a folder only removes the container (resource_folder_members
  // rows cascade — see migration_resources.sql); the resources inside it
  // are untouched, same rule an album's own delete already follows. If the
  // deleted folder was the active filter, fall back to "Todos" rather than
  // leaving the view stuck filtering on a folder that no longer exists.
  const handleDeleteFolder = useCallback(async (folder) => {
    const { error } = await deleteFolder(folder.id);
    if (error) { setError(error.message); return; }
    setFolders((cur) => cur.filter((f) => f.id !== folder.id));
    setActiveFolderId((cur) => (cur === folder.id ? null : cur));
  }, []);

  const handleSaveResource = useCallback(async (patch, folderIds) => {
    if (sheet === 'new') {
      const { data, error } = await createResource({ userId, ...patch });
      if (error) { setError(error.message); return; }
      if (folderIds.length) await setResourceFolders(data.id, folderIds);
      setResources((cur) => [data, ...cur]);
      setMembership((cur) => ({ ...cur, [data.id]: folderIds }));
    } else {
      const { data, error } = await updateResource(sheet.id, patch);
      if (error) { setError(error.message); return; }
      await setResourceFolders(sheet.id, folderIds);
      setResources((cur) => cur.map((r) => (r.id === sheet.id ? data : r)));
      setMembership((cur) => ({ ...cur, [sheet.id]: folderIds }));
    }
    setSheet(null);
  }, [sheet, userId]);

  const handleDeleteResource = useCallback(async (resource) => {
    const { error } = await deleteResource(resource.id);
    if (error) { setError(error.message); return; }
    setResources((cur) => cur.filter((r) => r.id !== resource.id));
    setMembership((cur) => { const { [resource.id]: _drop, ...rest } = cur; return rest; });
    setSheet(null);
  }, []);

  // ResourceImportSheet already created the rows AND wrote each one's own
  // folder membership itself (per-candidate folders, not one shared batch
  // destination — see its own comment) — this just syncs local state from
  // what it reports back: [{resource, folderIds}, ...].
  const handleImported = useCallback((pairs) => {
    setResources((cur) => [...pairs.map((p) => p.resource), ...cur]);
    setMembership((cur) => {
      const next = { ...cur };
      pairs.forEach((p) => { next[p.resource.id] = p.folderIds; });
      return next;
    });
    setSheet(null);
  }, []);

  return (
    <MobileScreen className="res-screen" fixed={false}>
      <div className="mp-body res-body">
        <div className="mp-header">
          <h1 className="mp-title">Recursos</h1>
          <div className="mp-search">
            <span className="mp-search-icon"><IcSearch size={17} /></span>
            <input
              type="text"
              placeholder="Buscar"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Inside the sticky header, not a separate flow element below it —
              with a long list this used to only be reachable by scrolling
              all the way back to the top, fighting the header's own sticky
              behavior on the way (see the reported bug). Living in the same
              sticky block means switching folders never needs a scroll. */}
          {folders.length > 0 && (
          <div className="res-chip-row res-folder-filter">
            <button className={`res-chip${activeFolderId === null ? ' res-chip-active' : ''}`} onClick={() => setActiveFolderId(null)}>Todos</button>
            {folders.map((f) => (
              <button
                key={f.id}
                className={`res-chip${activeFolderId === f.id ? ' res-chip-active' : ''}`}
                onClick={() => setActiveFolderId(activeFolderId === f.id ? null : f.id)}
              >
                <IcFolder size={12} /> {f.name}
              </button>
            ))}
            <button className="res-manage-folders-btn" onClick={() => setManageFoldersOpen(true)} title="gestionar carpetas" aria-label="Gestionar carpetas">
              <IcMore size={14} />
            </button>
          </div>
          )}
        </div>

        {!loaded ? (
          <div className="mp-loading"><span className="mp-spinner" /></div>
        ) : (
          <>
            {error && (
              <p className="thread-status thread-status-error">
                {error} <button className="mp-retry-btn" onClick={load}>Reintentar</button>
              </p>
            )}
            {!error && filtered.length === 0 && (
              <div className="thread-empty">
                <p>{resources.length === 0 ? 'Aún no hay recursos. Guarda metáforas, refranes o frases que te inspiren.' : 'Nada coincide con la búsqueda.'}</p>
              </div>
            )}
            {filtered.map((r) => (
              <ResourceCard
                key={r.id}
                resource={r}
                folderNames={(membership[r.id] || []).map((id) => folderNameFor[id]).filter(Boolean)}
                onOpen={() => setSheet(r)}
              />
            ))}
          </>
        )}
      </div>

      <MobileFab onClick={() => setSheet('chooser')} title="Nuevo recurso" aboveTabBar />

      {sheet === 'chooser' && (
        <NewResourceChooser onPick={setSheet} onClose={() => setSheet(null)} />
      )}

      {(sheet === 'new' || (sheet && sheet !== 'chooser' && sheet !== 'import')) && (
        <ResourceEditorSheet
          resource={sheet === 'new' ? null : sheet}
          folders={folders}
          memberFolderIds={sheet === 'new' ? [] : (membership[sheet.id] || [])}
          onSave={handleSaveResource}
          onDelete={handleDeleteResource}
          onCreateFolder={handleCreateFolderInline}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === 'import' && (
        <ResourceImportSheet
          userId={userId}
          folders={folders}
          onCreateFolder={handleCreateFolderInline}
          onImported={handleImported}
          onClose={() => setSheet(null)}
        />
      )}

      {manageFoldersOpen && (
        <ManageFoldersSheet folders={folders} onDelete={handleDeleteFolder} onClose={() => setManageFoldersOpen(false)} />
      )}
    </MobileScreen>
  );
}
