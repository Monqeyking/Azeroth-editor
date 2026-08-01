import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import {
  Search, Save, RotateCcw, Plus, Trash2, MapPin, Copy, Compass, Crosshair, Box, Layers, AlertTriangle, MousePointerClick, ChevronDown, ChevronUp,
} from 'lucide-react';
import GameObjectPreview from '../components/editor3d/GameObjectPreview';
import './DashboardPage.css';
import './EditorPage.css';
import './GameObjectEditorPage.css';

const GO_TYPES = [
  { value: 0, label: '0 · Door' },
  { value: 1, label: '1 · Button' },
  { value: 2, label: '2 · Questgiver' },
  { value: 3, label: '3 · Chest' },
  { value: 4, label: '4 · Binder' },
  { value: 5, label: '5 · Generic' },
  { value: 6, label: '6 · Trap' },
  { value: 7, label: '7 · Chair' },
  { value: 8, label: '8 · Spell Focus' },
  { value: 9, label: '9 · Text' },
  { value: 10, label: '10 · Goober (portal/schakel)' },
  { value: 11, label: '11 · Transport' },
  { value: 12, label: '12 · Area Damage' },
  { value: 13, label: '13 · Camera' },
  { value: 14, label: '14 · Map Object' },
  { value: 15, label: '15 · Mo Transport' },
  { value: 16, label: '16 · Duel Arbiter' },
  { value: 17, label: '17 · Fishing Node' },
  { value: 18, label: '18 · Summoning Ritual' },
  { value: 19, label: '19 · Mailbox' },
  { value: 20, label: '20 · Auction House' },
  { value: 21, label: '21 · Guild Bank' },
  { value: 22, label: '22 · Spell Caster' },
  { value: 23, label: '23 · Meeting Stone' },
  { value: 24, label: '24 · Flag Stand' },
  { value: 25, label: '25 · Fishing Hole' },
  { value: 26, label: '26 · Flag Drop' },
  { value: 27, label: '27 · Mini Game' },
  { value: 28, label: '28 · Lottery Kiosk' },
  { value: 29, label: '29 · Capture Point' },
  { value: 30, label: '30 · Arena Gate' },
  { value: 31, label: '31 · Ledger' },
  { value: 32, label: '32 · Altar of Kings' },
  { value: 33, label: '33 · Bunker' },
  { value: 34, label: '34 · Christmas Tree' },
  { value: 35, label: '35 · Counter' },
];

const DATA_FIELD_COUNT = 32;
const TEMPLATE_LIST_LIMIT = 100;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function text(value) {
  return value == null ? '' : String(value);
}

function fmtCoord(value) {
  const n = num(value, 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

function buildTemplateDraft(row) {
  const draft = { name: text(row.name), type: text(row.type), displayId: text(row.displayId), size: text(row.size ?? 1), VerifiedBuild: text(row.VerifiedBuild) };
  for (let i = 0; i < DATA_FIELD_COUNT; i++) draft['Data' + i] = text(row['Data' + i]);
  return draft;
}

function getTypeLabel(type) {
  return GO_TYPES.find(opt => opt.value === Number(type))?.label || `Type ${type}`;
}

function SpawnRow({ spawn, mapName, active, onSelect }) {
  return (
    <div className={`go-spawn-row${active ? ' active' : ''}`} onClick={onSelect} role="button" tabIndex={0}>
      <div className="go-spawn-row-top">
        <span className="go-spawn-guid">#{spawn.guid}</span>
        <span className="go-spawn-map">{mapName || `Map ${spawn.map}`}</span>
      </div>
      <div className="go-spawn-pos">
        <span>{fmtCoord(spawn.position_x)}</span>
        <span>{fmtCoord(spawn.position_y)}</span>
        <span>{fmtCoord(spawn.position_z)}</span>
        <span>{Math.round((num(spawn.orientation, 0) * 180 / Math.PI) * 10) / 10}°</span>
      </div>
    </div>
  );
}

function NudgeButtons({ onNudge, step = 0.5 }) {
  const press = (e, fn) => { e.preventDefault(); e.stopPropagation(); fn(); };
  const steps = [step, step / 5];
  return (
    <div className="go-nudge">
      {steps.map((s, idx) => (
        <button key={idx} className="go-nudge-btn"
          title={`±${s}`}
          onMouseDown={e => press(e, () => onNudge(s))}
          onContextMenu={e => press(e, () => onNudge(-s))}>
          {idx === 0 ? '▲' : '▶'}
        </button>
      ))}
    </div>
  );
}

export default function GameObjectEditorPage() {
  const { query, soapCommand, dbcPath, worldmapMpqPath } = useConnection();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [onlySpawned, setOnlySpawned] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mapNames, setMapNames] = useState({});
  const mapNamesPathRef = useRef('');
  const templateLoadRef = useRef(0);

  const [selectedEntry, setSelectedEntry] = useState(null);
  const selectedEntryRef = useRef(null);
  const [template, setTemplate] = useState(null);
  const [draft, setDraft] = useState(null);
  const [displayInfo, setDisplayInfo] = useState(null);
  const [displayInfoError, setDisplayInfoError] = useState('');
  const [templateDirty, setTemplateDirty] = useState(false);

  const [spawns, setSpawns] = useState([]);
  const [selectedSpawn, setSelectedSpawn] = useState(null);
  const [spawnDraft, setSpawnDraft] = useState(null);
  const [spawnDirty, setSpawnDirty] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [addModal, setAddModal] = useState(null);
  const [addForm, setAddForm] = useState({ map: '1', position_x: '0', position_y: '0', position_z: '0', orientation: '0' });
  const [pendingSelection, setPendingSelection] = useState(null);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [positionNudgeStep, setPositionNudgeStep] = useState('0.1');

  const dirty = templateDirty || spawnDirty;
  const unsavedGuard = useUnsavedGuard(dirty);

  useEffect(() => { selectedEntryRef.current = selectedEntry; }, [selectedEntry]);

  useEffect(() => {
    if (!dbcPath || !template || mapNamesPathRef.current === dbcPath) return;
    mapNamesPathRef.current = dbcPath;
    window.azeroth.dbc.readMapNames(dbcPath).then(res => {
      if (res.success) setMapNames(res.names || {});
    });
  }, [dbcPath, template]);

  const loadTemplates = useCallback(async (term, type, spawned) => {
    const requestId = ++templateLoadRef.current;
    setLoading(true);
    try {
      const trimmed = term.trim();
      const isNumeric = /^\d+$/.test(trimmed);
      const params = [];
      let sql = `
        SELECT g.entry, g.type, g.displayId, g.name, g.size
        FROM gameobject_template g
        WHERE 1=1
      `;
      if (trimmed) {
        if (isNumeric) { sql += ' AND (g.entry = ? OR g.displayId = ?)'; params.push(Number(trimmed), Number(trimmed)); }
        else { sql += ' AND g.name LIKE ?'; params.push(`%${trimmed}%`); }
      }
      if (type !== 'all') { sql += ' AND g.type = ?'; params.push(Number(type)); }
      if (spawned) { sql += ' AND EXISTS (SELECT 1 FROM gameobject s WHERE s.id = g.entry)'; }
      sql += ` ORDER BY g.entry DESC LIMIT ${TEMPLATE_LIST_LIMIT}`;

      const res = await query(sql, params);
      if (requestId !== templateLoadRef.current) return;
      const rows = res.data || [];
      if (rows.length) {
        const ids = rows.map(row => row.entry);
        const placeholders = ids.map(() => '?').join(',');
        const stats = await query(
          `SELECT id, COUNT(*) AS spawn_count, COUNT(DISTINCT map) AS map_count
           FROM gameobject WHERE id IN (${placeholders}) GROUP BY id`,
          ids
        );
        if (requestId !== templateLoadRef.current) return;
        const statsById = new Map((stats.data || []).map(row => [Number(row.id), row]));
        rows.forEach(row => Object.assign(row, statsById.get(Number(row.entry)) || { spawn_count: 0, map_count: 0 }));
      }
      setTemplates(rows);
      if (selectedEntryRef.current) {
        const next = rows.find(r => r.entry === selectedEntryRef.current);
        if (next) setSelectedEntry(next.entry);
      }
    } finally {
      if (requestId === templateLoadRef.current) setLoading(false);
    }
  }, [query]);

  const loadTemplate = useCallback(async (row) => {
    setSelectedEntry(row.entry);
    setLoading(true);
    setMsg(null);
    try {
      const res = await query('SELECT * FROM gameobject_template WHERE entry = ?', [row.entry]);
      const tpl = res.data?.[0];
      if (!tpl) { setMsg({ type: 'error', text: res.error || `Template #${row.entry} niet gevonden` }); setLoading(false); return; }
      setTemplate(tpl);
      setDraft(buildTemplateDraft(tpl));
      setTemplateDirty(false);
      setSelectedSpawn(null);
      setSpawnDraft(null);
      setSpawnDirty(false);
      const spawnRes = await query('SELECT * FROM gameobject WHERE id = ? ORDER BY map ASC, guid ASC', [row.entry]);
      setSpawns(spawnRes?.data || []);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadTemplates(search, typeFilter, onlySpawned).catch(err => setMsg({ type: 'error', text: err.message }));
    }, 120);
    return () => clearTimeout(timer);
  }, [search, typeFilter, onlySpawned, loadTemplates]);

  useEffect(() => {
    if (!template || !worldmapMpqPath) return;
    const displayId = num(draft?.displayId, 0);
    if (!displayId) { setDisplayInfo(null); setDisplayInfoError(''); return; }
    let cancelled = false;
    window.azeroth.dbc.readGameObjectDisplayInfos(worldmapMpqPath, [displayId]).then(res => {
      if (cancelled) return;
      if (res.success) {
        const info = res.data?.[displayId];
        setDisplayInfo(info || null);
        setDisplayInfoError(info ? '' : 'Geen GameObjectDisplayInfo voor displayId ' + displayId);
      } else {
        setDisplayInfo(null);
        setDisplayInfoError(res.error);
      }
    }).catch(err => {
      if (!cancelled) { setDisplayInfo(null); setDisplayInfoError(err.message); }
    });
    return () => { cancelled = true; };
  }, [template, draft?.displayId, worldmapMpqPath]);

  const markTemplateDirty = () => setTemplateDirty(true);

  const updateDraft = (key, value) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    markTemplateDirty();
  };

  const scale = useMemo(() => Math.max(0.01, num(draft?.size, 1)), [draft?.size]);
  const previewOrientation = spawnDraft
    ? num(spawnDraft.orientation, 0)
    : selectedSpawn
      ? num(selectedSpawn.orientation, 0) * 180 / Math.PI
      : 0;

  const selectSpawn = useCallback((spawn) => {
    setSelectedSpawn(spawn);
    setSpawnDraft({
      position_x: fmtCoord(spawn.position_x),
      position_y: fmtCoord(spawn.position_y),
      position_z: fmtCoord(spawn.position_z),
      orientation: String(Math.round((num(spawn.orientation, 0) * 180 / Math.PI) * 3) / 3),
      spawntimesecs: text(spawn.spawntimesecs),
      animprogress: text(spawn.animprogress),
      state: text(spawn.state),
      spawnMask: text(spawn.spawnMask),
      phaseMask: text(spawn.phaseMask),
    });
    setSpawnDirty(false);
  }, []);

  const updateSpawnDraft = (key, value) => {
    setSpawnDraft(prev => ({ ...prev, [key]: value }));
    setSpawnDirty(true);
  };

  const requestSelect = async (row) => {
    if (!row || row.entry === selectedEntry) return;
    if (dirty) { setPendingSelection(row.entry); return; }
    await loadTemplate(row);
  };

  const handleRowClick = async (row) => {
    if (!row) return;
    if (row.entry === selectedEntry) {
      if (!dirty) await loadTemplate(row);
      return;
    }
    await requestSelect(row);
  };

  const saveTemplate = useCallback(async () => {
    if (!template) return false;
    setSaving(true);
    setMsg(null);
    try {
      const entry = template.entry;
      const name = String(draft.name || '').trim() || 'GameObject ' + entry;
      const dataValues = [];
      for (let i = 0; i < DATA_FIELD_COUNT; i++) {
        const raw = draft['Data' + i];
        dataValues.push(raw === '' || raw == null ? 0 : num(raw, 0));
      }
      const params = [
        name,
        num(draft.type, 0),
        num(draft.displayId, 0),
        Math.max(0.01, num(draft.size, 1)),
        ...dataValues,
      ];
      const verified = draft.VerifiedBuild === '' || draft.VerifiedBuild == null ? null : num(draft.VerifiedBuild, 0);
      const dataSet = dataValues.map((_, i) => `Data${i}=?`).join(', ');
      await query(
        `UPDATE gameobject_template SET name=?, type=?, displayId=?, size=?, ${dataSet}, VerifiedBuild=? WHERE entry=?`,
        [...params, verified, entry]
      );
      setTemplateDirty(false);
      setTemplates(prev => prev.map(r => r.entry === entry
        ? { ...r, name, type: num(draft.type, 0), displayId: num(draft.displayId, 0), size: num(draft.size, 1) }
        : r));
      setMsg({ type: 'success', text: `Template #${entry} opgeslagen (scale ${num(draft.size, 1).toFixed(2)})` });
      return true;
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
      return false;
    } finally {
      setSaving(false);
    }
  }, [template, draft, query]);

  const saveSpawn = useCallback(async () => {
    if (!selectedSpawn || !spawnDraft) return false;
    setSaving(true);
    setMsg(null);
    try {
      const guid = selectedSpawn.guid;
      const o = num(spawnDraft.orientation, 0) * Math.PI / 180;
      await query(
        `UPDATE gameobject SET position_x=?, position_y=?, position_z=?, orientation=?, rotation0=0, rotation1=0, rotation2=?, rotation3=?, spawntimesecs=?, animprogress=?, state=?, spawnMask=?, phaseMask=? WHERE guid=?`,
        [
          num(spawnDraft.position_x, 0),
          num(spawnDraft.position_y, 0),
          num(spawnDraft.position_z, 0),
          o,
          Math.sin(o / 2),
          Math.cos(o / 2),
          num(spawnDraft.spawntimesecs, 300),
          num(spawnDraft.animprogress, 0),
          num(spawnDraft.state, 1),
          num(spawnDraft.spawnMask, 1),
          num(spawnDraft.phaseMask, 1),
          guid,
        ]
      );
      setSpawnDirty(false);
      const next = {
        ...selectedSpawn,
        position_x: num(spawnDraft.position_x, 0),
        position_y: num(spawnDraft.position_y, 0),
        position_z: num(spawnDraft.position_z, 0),
        orientation: o,
      };
      setSelectedSpawn(next);
      setSpawns(prev => prev.map(s => s.guid === guid ? next : s));
      setMsg({ type: 'success', text: `Spawn #${guid} opgeslagen` });
      return true;
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
      return false;
    } finally {
      setSaving(false);
    }
  }, [selectedSpawn, spawnDraft, query]);

  const saveAll = useCallback(async () => {
    let ok = true;
    if (templateDirty) ok = (await saveTemplate()) && ok;
    if (spawnDirty) ok = (await saveSpawn()) && ok;
    return ok;
  }, [saveTemplate, saveSpawn, templateDirty, spawnDirty]);

  const resetTemplate = useCallback(async () => {
    if (!template) return;
    const fresh = await query('SELECT * FROM gameobject_template WHERE entry = ?', [template.entry]);
    const tpl = fresh.data?.[0];
    if (tpl) { setTemplate(tpl); setDraft(buildTemplateDraft(tpl)); setTemplateDirty(false); }
  }, [template, query]);

  const resetSpawn = useCallback(() => {
    if (!selectedSpawn) return;
    selectSpawn(selectedSpawn);
  }, [selectedSpawn, selectSpawn]);

  const teleportToSpawn = useCallback(async () => {
    const target = selectedSpawn || spawns[0];
    if (!target) return;
    await soapCommand(`.go xyz ${num(target.position_x, 0).toFixed(3)} ${num(target.position_y, 0).toFixed(3)} ${num(target.position_z, 0).toFixed(3)} ${num(target.map, 0)}`);
  }, [selectedSpawn, spawns, soapCommand]);

  const usePlayerFacing = useCallback(async () => {
    if (!selectedSpawn || !spawnDraft) return;
    setMsg(null);
    const res = await soapCommand('.gps');
    if (!res?.success) {
      setMsg({ type: 'error', text: res?.error || 'Player orientation kon niet worden opgehaald' });
      return;
    }
    const match = String(res.result || '').match(/orientation\s*[:=]\s*([-+]?\d+(?:\.\d+)?)/i);
    if (!match) {
      setMsg({ type: 'error', text: 'Geen Orientation gevonden in de .gps-output' });
      return;
    }
    const playerFacing = Number(match[1]);
    const portalFacing = ((playerFacing + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    updateSpawnDraft('orientation', (portalFacing * 180 / Math.PI).toFixed(1));
    setMsg({ type: 'success', text: `Portalrichting ingesteld op ${(portalFacing * 180 / Math.PI).toFixed(1)}Â° (player facing + 180Â°)` });
  }, [selectedSpawn, spawnDraft, soapCommand]);

  const copyCoords = useCallback(async () => {
    const target = selectedSpawn || spawns[0];
    if (!target) return;
    await navigator.clipboard.writeText(`${num(target.position_x, 0).toFixed(3)} ${num(target.position_y, 0).toFixed(3)} ${num(target.position_z, 0).toFixed(3)}`);
    setMsg({ type: 'success', text: 'Coördinaten gekopieerd' });
  }, [selectedSpawn, spawns]);

  const deleteSpawn = useCallback(async () => {
    if (!selectedSpawn) return;
    if (!window.confirm(`Spawn #${selectedSpawn.guid} definitief verwijderen?`)) return;
    const res = await query('DELETE FROM gameobject WHERE guid = ?', [selectedSpawn.guid]);
    if (!res.success) { setMsg({ type: 'error', text: res.error }); return; }
    setSpawns(prev => prev.filter(s => s.guid !== selectedSpawn.guid));
    setSelectedSpawn(null);
    setSpawnDraft(null);
    setSpawnDirty(false);
    setMsg({ type: 'success', text: `Spawn #${selectedSpawn.guid} verwijderd` });
  }, [selectedSpawn, query]);

  const openAddSpawn = () => {
    const first = spawns[0];
    setAddForm({
      map: text(first?.map ?? 1),
      position_x: '0', position_y: '0', position_z: '0', orientation: '0',
    });
    setAddModal(true);
  };

  const confirmAddSpawn = useCallback(async () => {
    if (!addModal || !template) return;
    const idRes = await window.azeroth.db.findNextId({ table: 'gameobject', idColumn: 'guid', startId: 1 });
    if (!idRes.success) { setMsg({ type: 'error', text: idRes.error }); return; }
    const guid = idRes.nextId;
    const o = num(addForm.orientation, 0) * Math.PI / 180;
    const res = await query(
      `INSERT INTO gameobject (guid, id, map, zoneId, areaId, spawnMask, phaseMask, position_x, position_y, position_z, orientation, rotation0, rotation1, rotation2, rotation3, spawntimesecs, animprogress, state, VerifiedBuild)
       VALUES (?,?,?,0,0,1,1,?,?,?,?,0,0,?,?,300,0,1,NULL)`,
      [
        guid, template.entry, num(addForm.map, 0),
        num(addForm.position_x, 0), num(addForm.position_y, 0), num(addForm.position_z, 0), o,
        Math.sin(o / 2), Math.cos(o / 2),
      ]
    );
    if (!res.success) { setMsg({ type: 'error', text: res.error }); return; }
    const fresh = await query('SELECT * FROM gameobject WHERE guid = ?', [guid]);
    const row = fresh.data?.[0];
    if (row) setSpawns(prev => [...prev, row]);
    setAddModal(null);
    setMsg({ type: 'success', text: `Spawn #${guid} aangemaakt (entry #${template.entry})` });
  }, [addModal, addForm, template, query]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (dirty) saveAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saveAll]);

  const pendingRow = pendingSelection ? templates.find(r => r.entry === pendingSelection) : null;

  const currentDisplayId = num(draft?.displayId, 0);

  return (
    <div className="go-editor-page fade-in">
      <div className="editor-page-header go-editor-header">
        <div>
          <h1 className="editor-page-title">Game Objects</h1>
          <p className="editor-page-subtitle">Zoek een object, pas de scale aan met live 3D preview en beheer spawns</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn-ghost" onClick={() => loadTemplates(search, typeFilter, onlySpawned)} disabled={loading || !templates.length}><RotateCcw size={13} /> Refresh</button>
          {selectedEntry && (
            <button type="button" className="btn-primary" onClick={saveAll} disabled={saving || !dirty}>
              <Save size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {msg && <div className={`editor-msg ${msg.type}`} style={{ marginTop: 12 }}>{msg.text}</div>}

      <div className="go-editor-layout">
        <aside className="editor-list go-list">
          <div className="editor-list-header go-list-header">
            <div className="search-box">
              <Search size={13} />
              <input type="text" placeholder="Naam, entry of displayId…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="go-filter-row">
              <div className="field-group">
                <label>Type</label>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                  <option value="all">Alle types</option>
                  {GO_TYPES.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              <label className="go-only-spawned">
                <input type="checkbox" checked={onlySpawned} onChange={e => setOnlySpawned(e.target.checked)} />
                Gespawned
              </label>
            </div>
          </div>

          <div className="list-items">
            {templates.length ? templates.map(row => {
              const active = selectedEntry === row.entry;
              return (
                <div key={row.entry} className={`list-item${active ? ' active' : ''}`} onClick={() => handleRowClick(row)} role="button" tabIndex={0}>
                  <div className="list-item-main">
                    <span className="list-item-name">{row.name || 'Unnamed object'}</span>
                    <span className="go-entry-badge">#{row.entry}</span>
                  </div>
                  <div className="list-item-meta">
                    <span>{getTypeLabel(row.type)}</span>
                    <span>Display {row.displayId}</span>
                    <span>Scale {num(row.size, 1).toFixed(2)}</span>
                    {num(row.spawn_count, 0) > 0 && <span>{row.spawn_count} spawn{row.spawn_count > 1 ? 's' : ''}</span>}
                  </div>
                </div>
              );
            }) : (
              <div className="editor-empty"><MousePointerClick /><p>Geen game objects gevonden.</p></div>
            )}
          </div>
        </aside>

        <section className="editor-form go-form">
          {!template ? (
            <div className="editor-empty"><Box /><p>Selecteer een object links om de scale en spawns te bewerken.</p></div>
          ) : (
            <div className="go-workspace">
              <div className="go-main-col">
                <div className="editor-card go-preview-card">
                  <div className="go-panel-title"><Box size={12} /> Live preview — scale {scale.toFixed(2)}</div>
                  {displayInfoError && <div className="go-display-warn">{displayInfoError}</div>}
                  {displayInfo?.modelPath && <div className="go-model-path" title={displayInfo.modelPath}>{displayInfo.modelPath}</div>}
                  <GameObjectPreview
                    modelPath={displayInfo?.modelPath}
                    scale={scale}
                    orientation={previewOrientation * Math.PI / 180}
                    height={300}
                  />
                  <div className="go-scale-row">
                    <span className="go-scale-label">Scale</span>
                    <input type="range" min="0.1" max="5" step="0.01" value={scale} onChange={e => updateDraft('size', e.target.value)} />
                    <input type="number" step="0.01" min="0.01" value={draft?.size ?? 1}
                      onChange={e => updateDraft('size', e.target.value)}
                      onWheel={e => e.target.blur()} />
                  </div>
                  <div className="go-scale-presets">
                    <span>Presets:</span>
                    {[0.5, 1, 1.23, 1.5, 2, 3].map(p => (
                      <button key={p} className={`go-scale-preset${Math.abs(scale - p) < 0.001 ? ' active' : ''}`} onClick={() => updateDraft('size', String(p))}>{p}</button>
                    ))}
                  </div>
                </div>

                <div className="editor-card">
                  <div className="go-panel-title"><Layers size={12} /> Template</div>
                  <div className="go-form-fields">
                    <div className="field-group go-field-wide">
                      <label>Name</label>
                      <input type="text" value={draft?.name ?? ''} onChange={e => updateDraft('name', e.target.value)} />
                    </div>
                    <div className="field-group">
                      <label>Type</label>
                      <select value={draft?.type ?? 0} onChange={e => updateDraft('type', e.target.value)}>
                        {GO_TYPES.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div className="field-group">
                      <label>Display ID</label>
                      <input type="number" min="0" value={draft?.displayId ?? ''} onChange={e => updateDraft('displayId', e.target.value)} onWheel={e => e.target.blur()} />
                    </div>
                    <div className="field-group">
                      <label>VerifiedBuild</label>
                      <input type="number" value={draft?.VerifiedBuild ?? ''} onChange={e => updateDraft('VerifiedBuild', e.target.value)} onWheel={e => e.target.blur()} />
                    </div>
                  </div>

                  <details className="go-data-fields" open={dataOpen} onToggle={e => setDataOpen(e.target.open)}>
                    <summary>
                      <span>Data fields (Data0–31)</span>
                      <span className="go-data-toggle">{dataOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</span>
                    </summary>
                    <div className="go-data-grid">
                      {Array.from({ length: DATA_FIELD_COUNT }, (_, i) => (
                        <div key={i} className="field-group">
                          <label>Data{i}</label>
                          <input type="number" value={draft?.['Data' + i] ?? ''}
                            onChange={e => updateDraft('Data' + i, e.target.value)}
                            onWheel={e => e.target.blur()} />
                        </div>
                      ))}
                    </div>
                  </details>

                  <div className="go-action-row">
                    <button type="button" className="btn-primary" onClick={saveTemplate} disabled={saving || !templateDirty}><Save size={13} /> Save template</button>
                    <button type="button" className="btn-ghost" onClick={resetTemplate} disabled={saving || !templateDirty}><RotateCcw size={13} /> Reset</button>
                  </div>
                </div>
              </div>

              <div className="go-side-col">
                <div className="editor-card">
                  <div className="go-panel-title go-panel-title-split">
                    <span><MapPin size={12} /> Spawns ({spawns.length})</span>
                    <button type="button" className="btn-ghost go-small-btn" onClick={openAddSpawn}><Plus size={12} /> Nieuw</button>
                  </div>
                  <div className="go-spawn-list">
                    {spawns.length ? spawns.map(spawn => (
                      <SpawnRow key={spawn.guid} spawn={spawn} mapName={mapNames[spawn.map]} active={selectedSpawn?.guid === spawn.guid} onSelect={() => selectSpawn(spawn)} />
                    )) : (
                      <div className="go-spawn-empty">Geen spawns voor dit object. Klik “Nieuw” om er één te maken.</div>
                    )}
                  </div>
                </div>

                {selectedSpawn && spawnDraft && (
                  <div className="editor-card">
                    <div className="go-panel-title go-panel-title-split">
                      <span><Crosshair size={12} /> Spawn #{(selectedSpawn || {}).guid}</span>
                      <div className="go-spawn-actions">
                        <button type="button" className="btn-ghost go-small-btn" onClick={teleportToSpawn} title="Teleporteer naar spawn (.go xyz)"><MapPin size={12} /></button>
                        <button type="button" className="btn-ghost go-small-btn" onClick={usePlayerFacing} title="Gebruik player facing + 180 graden via .gps"><Compass size={12} /></button>
                        <button type="button" className="btn-ghost go-small-btn" onClick={copyCoords} title="Coördinaten kopiëren"><Copy size={12} /></button>
                        <button type="button" className="btn-danger go-small-btn" onClick={deleteSpawn} title="Spawn verwijderen"><Trash2 size={12} /></button>
                      </div>
                    </div>

                    <div className="go-spawn-field">
                      <div className="go-nudge-settings">
                        <label htmlFor="go-position-step">Position step</label>
                        <select id="go-position-step" value={positionNudgeStep} onChange={e => setPositionNudgeStep(e.target.value)}>
                          <option value="1">1.000</option>
                          <option value="0.1">0.100</option>
                          <option value="0.01">0.010</option>
                        </select>
                        <span>right-click = negative</span>
                      </div>
                      <div className="go-pos-head">
                        <span className="go-pos-axis">X</span>
                        <div className="go-pos-inputs">
                          <NudgeButtons step={num(positionNudgeStep, 0.1)} onNudge={delta => updateSpawnDraft('position_x', (num(spawnDraft.position_x, 0) + delta).toFixed(3))} />
                          <input type="number" step="0.001" value={spawnDraft.position_x} onChange={e => updateSpawnDraft('position_x', e.target.value)} onWheel={e => e.target.blur()} />
                        </div>
                      </div>
                      <div className="go-pos-head">
                        <span className="go-pos-axis">Y</span>
                        <div className="go-pos-inputs">
                          <NudgeButtons step={num(positionNudgeStep, 0.1)} onNudge={delta => updateSpawnDraft('position_y', (num(spawnDraft.position_y, 0) + delta).toFixed(3))} />
                          <input type="number" step="0.001" value={spawnDraft.position_y} onChange={e => updateSpawnDraft('position_y', e.target.value)} onWheel={e => e.target.blur()} />
                        </div>
                      </div>
                      <div className="go-pos-head">
                        <span className="go-pos-axis">Z</span>
                        <div className="go-pos-inputs">
                          <NudgeButtons step={num(positionNudgeStep, 0.1)} onNudge={delta => updateSpawnDraft('position_z', (num(spawnDraft.position_z, 0) + delta).toFixed(3))} />
                          <input type="number" step="0.001" value={spawnDraft.position_z} onChange={e => updateSpawnDraft('position_z', e.target.value)} onWheel={e => e.target.blur()} />
                        </div>
                      </div>
                      <div className="go-pos-head">
                        <span className="go-pos-axis">Orient °</span>
                        <div className="go-pos-inputs">
                          <NudgeButtons onNudge={delta => updateSpawnDraft('orientation', (num(spawnDraft.orientation, 0) + delta * 5).toFixed(1))} />
                          <input type="number" step="1" value={spawnDraft.orientation} onChange={e => updateSpawnDraft('orientation', e.target.value)} onWheel={e => e.target.blur()} />
                        </div>
                      </div>

                      <div className="go-spawn-meta">
                        <div className="field-group"><label>SpawnTimeSecs</label><input type="number" value={spawnDraft.spawntimesecs} onChange={e => updateSpawnDraft('spawntimesecs', e.target.value)} onWheel={e => e.target.blur()} /></div>
                        <div className="field-group"><label>State</label><input type="number" value={spawnDraft.state} onChange={e => updateSpawnDraft('state', e.target.value)} onWheel={e => e.target.blur()} /></div>
                        <div className="field-group"><label>SpawnMask</label><input type="number" value={spawnDraft.spawnMask} onChange={e => updateSpawnDraft('spawnMask', e.target.value)} onWheel={e => e.target.blur()} /></div>
                        <div className="field-group"><label>PhaseMask</label><input type="number" value={spawnDraft.phaseMask} onChange={e => updateSpawnDraft('phaseMask', e.target.value)} onWheel={e => e.target.blur()} /></div>
                      </div>

                      <div className="go-action-row">
                        <button type="button" className="btn-primary" onClick={saveSpawn} disabled={saving || !spawnDirty}><Save size={13} /> Save spawn</button>
                        <button type="button" className="btn-ghost" onClick={resetSpawn} disabled={saving || !spawnDirty}><RotateCcw size={13} /> Reset</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {pendingSelection && dirty && (
        <div className="go-pending-warning">
          <AlertTriangle size={13} />
          <span>Onopgeslagen wijzigingen op #{selectedEntry}. Opslaan of negeren voor je naar #{pendingSelection} gaat.</span>
          <div className="go-pending-actions">
            <button type="button" className="btn-primary" disabled={saving || !pendingRow} onClick={async () => {
              const target = pendingRow;
              const ok = await saveAll();
              if (ok && target) await loadTemplate(target);
              setPendingSelection(null);
            }}><Save size={13} /> Opslaan &amp; wissel</button>
            <button type="button" className="btn-ghost" disabled={!pendingRow} onClick={async () => {
              setTemplateDirty(false); setSpawnDirty(false); setPendingSelection(null);
              if (pendingRow) await loadTemplate(pendingRow);
            }}>Negeren</button>
            <button type="button" className="btn-ghost" onClick={() => setPendingSelection(null)}>Annuleren</button>
          </div>
        </div>
      )}

      {addModal && (
        <div className="modal-overlay" onMouseDown={() => setAddModal(null)}>
          <div className="modal-box" onMouseDown={e => e.stopPropagation()}>
            <div className="modal-title">Spawn toevoegen — #{template.entry}</div>
            <div className="modal-field">
              <label className="modal-label">Map</label>
              <input type="number" className="modal-input" value={addForm.map} onChange={e => setAddForm(f => ({ ...f, map: e.target.value }))} />
            </div>
            {['position_x', 'position_y', 'position_z', 'orientation'].map(field => (
              <div className="modal-field" key={field}>
                <label className="modal-label">{field}</label>
                <input type="number" className="modal-input" value={addForm[field]} onChange={e => setAddForm(f => ({ ...f, [field]: e.target.value }))} />
              </div>
            ))}
            <div className="modal-actions">
              <button className="modal-btn-cancel" onClick={() => setAddModal(null)}>Annuleren</button>
              <button className="modal-btn-ok" onClick={confirmAddSpawn}>Toevoegen</button>
            </div>
          </div>
        </div>
      )}

      {dirty && unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
    </div>
  );
}
