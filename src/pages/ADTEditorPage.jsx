import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSearch, FolderOpen, Info, LoaderCircle, RotateCcw, ShieldCheck } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import './ADTEditorPage.css';

const SOURCE_OPTIONS = [
  { value: 'current', label: 'Configured Current Client' },
  { value: 'standalone', label: 'Standalone ADT File' },
];

function displayPath(value) { return value || 'Not configured in Settings'; }
function fmt(value, digits = 2) { return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'; }
function fmtBytes(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const units = ['B', 'KB', 'MB', 'GB']; let n = Number(value), i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 2 : 0)} ${units[i]}`;
}
function statusClass(value) { return value === true || value === 'OK' ? 'ok' : value === false || value === 'Warnings' ? 'warn' : 'muted'; }
function compareTiles(a, b) { return Number(a.x) - Number(b.x) || Number(a.y) - Number(b.y); }
const AREA_FLAG_OPTIONS = [
  [0x00000001, 'Has breath particles'], [0x00000002, 'Breath particles override parent'], [0x00000004, 'On-map dungeon'], [0x00000008, 'Allow trade channel'],
  [0x00000010, 'Enemies PvP flagged'], [0x00000020, 'Allow resting'], [0x00000040, 'Allow dueling'], [0x00000080, 'Free-for-all PvP'],
  [0x00000100, 'Linked chat'], [0x00000200, 'Linked chat special area'], [0x00000400, 'Flying'], [0x00000800, 'Sanctuary'],
  [0x00001000, 'Need fly'], [0x00002000, 'Ambient multiplier on player'], [0x00004000, 'Flight bounds on map'], [0x00008000, 'Subzone PvP POI'],
  [0x00010000, 'No chat channels'], [0x00020000, 'Area not in use'], [0x00040000, 'Contested area'], [0x00080000, 'No player summoning'],
  [0x00100000, 'Low-level'], [0x00200000, 'Players call guards'], [0x00400000, 'Horde resting'], [0x00800000, 'Alliance resting'],
  [0x01000000, 'Combat zone'], [0x02000000, 'Force indoors'], [0x04000000, 'Force outdoors'], [0x08000000, 'Hearth/resurrect allowed'],
  [0x20000000, 'Cannot fly'], [0x40000000, 'Use parent for world-defense visibility'],
];
function describeAreaFlags(value) {
  const mask = Number(value) >>> 0;
  return { hex: `0x${mask.toString(16).padStart(8, '0')}`, labels: AREA_FLAG_OPTIONS.filter(([bit]) => (mask & bit) === bit).map(([, label]) => label) };
}
function AreaFlagPicker({ value, onChange }) {
  const mask = Number(value) >>> 0;
  const info = describeAreaFlags(value);
  const toggle = bit => onChange(String((mask & bit) === bit ? mask & ~bit : mask | bit));
  return <div className="adt-flag-picker">
    <div className="adt-flag-current"><strong>{info.hex}</strong><span>{info.labels.length ? info.labels.join(' · ') : 'No active flags'}</span></div>
    <details>
      <summary>Choose AreaTable flags</summary>
      <div className="adt-flag-options">{AREA_FLAG_OPTIONS.map(([bit, label]) => <label key={bit}><input type="checkbox" checked={(mask & bit) === bit} onChange={() => toggle(bit)} /><span>{label}</span><code>0x{bit.toString(16).padStart(8, '0')}</code></label>)}</div>
      <div className="adt-flag-presets"><span>Quick presets</span><button type="button" className="adt-btn" onClick={() => onChange(String(0x40100040))}>Drygulch</button><button type="button" className="adt-btn" onClick={() => onChange(String(0x40300040))}>Razor Hill</button></div>
    </details>
  </div>;
}
function summarizeChunks(chunks = []) {
  const groups = new Map();
  for (const chunk of chunks) {
    const current = groups.get(chunk.type) || { type: chunk.type, count: 0, bytes: 0, valid: true };
    current.count++;
    current.bytes += Number(chunk.size) || 0;
    current.valid = current.valid && chunk.valid;
    groups.set(chunk.type, current);
  }
  return [...groups.values()];
}

function Panel({ title, meta, children, className = '' }) {
  return <section className={`adt-panel ${className}`}><div className="adt-panel-title"><span>{title}</span>{meta && <small>{meta}</small>}</div>{children}</section>;
}

function Value({ label, children, mono = false }) {
  return <div className="adt-value"><span>{label}</span><strong className={mono ? 'mono' : ''}>{children ?? '—'}</strong></div>;
}

function WarningList({ warnings = [] }) {
  if (!warnings.length) return <div className="adt-empty-inline"><CheckCircle2 size={13} /> No parser warnings</div>;
  return <ul className="adt-warning-list">{warnings.map((warning, index) => <li key={`${warning}-${index}`}><AlertTriangle size={12} /> <span>{warning}</span></li>)}</ul>;
}

function RawTree({ overview, onSelect }) {
  const rows = overview?.topChunks || [];
  const known = ['MVER', 'MHDR', 'MCIN', 'MTEX', 'MMDX/MMID', 'MWMO/MWID', 'MDDF', 'MODF', 'MCNK[0..255]', 'MH2O'];
  const available = new Set(rows.map(row => row.type));
  return <div className="adt-tree">
    <div className="adt-tree-row root"><span>ADT</span></div>
    {known.map((label, index) => {
      const type = label.split('/')[0].replace(/\[.*$/, '');
      const found = type === 'MCNK' ? available.has('MCNK') : available.has(type) || (label.includes('/') && available.has(label.split('/')[1]));
      const matching = rows.filter(row => label.includes('/') ? label.split('/').some(value => rows.some(item => item.type === value) && row.type === value) : row.type === type);
      return <div className="adt-tree-group" key={label}>
        <div className={`adt-tree-row ${found ? '' : 'missing'}`}><span className="tree-branch">{index === known.length - 1 ? '└──' : '├──'}</span><strong>{label}</strong><small>{found ? (type === 'MCNK' ? `${matching.length || 'available'} chunks` : `${matching.length} chunk${matching.length === 1 ? '' : 's'}`) : 'missing'}</small></div>
        {matching.map((row, rowIndex) => <button className="adt-tree-row child" key={`${row.offset}-${rowIndex}`} onClick={() => type === 'MCNK' && onSelect?.(rowIndex)} disabled={type !== 'MCNK'}><span>│   └──</span><span>{row.type}</span><small>0x{row.offset.toString(16)} · {row.size} bytes · {row.valid ? 'valid' : 'invalid'} · {row.parsed ? 'parsed' : 'unparsed'}</small></button>)}
      </div>;
    })}
  </div>;
}

function GridCell({ chunk, selected, onSelect, matches = true }) {
  const missing = !chunk?.valid;
  const warning = (chunk?.warnings || []).length > 0;
  const label = chunk?.sourceAreaName || (chunk?.areaId != null ? `#${chunk.areaId}` : '—');
  return <button className={`adt-grid-cell ${selected ? 'selected' : ''} ${missing ? 'missing' : ''} ${warning ? 'warning' : ''} ${matches ? '' : 'filtered-out'}`} disabled={!matches} onClick={() => onSelect(chunk.index)} title={missing ? 'MCNK missing or invalid' : `${label} · target: ${chunk.targetAreaName || 'unresolved'} · ${chunk.warnings?.join(', ') || 'OK'}`}>
    <span className="adt-grid-index">{chunk.index}</span>
    <strong>{label}</strong>
    <small>{missing ? 'missing' : `${chunk.ix},${chunk.iy}`}</small>
    <i />
  </button>;
}

function ChunkDetail({ chunk, textures, water }) {
  if (!chunk) return <div className="adt-empty"><Info size={20} /><span>Select an MCNK tile to inspect its fields.</span></div>;
  return <div className="adt-detail-scroll">
    <div className="adt-detail-heading"><strong>MCNK[{chunk.index}]</strong><span className={`adt-status ${statusClass(chunk.warnings?.length ? false : true)}`}>{chunk.warnings?.length ? 'Warnings' : 'Valid'}</span></div>
    <div className="adt-values">
      <Value label="Chunk offset" mono>{chunk.offset == null ? '—' : `0x${chunk.offset.toString(16)}`}</Value><Value label="Chunk size">{chunk.size ?? '—'} bytes</Value>
      <Value label="ix / iy">{chunk.ix} / {chunk.iy}</Value><Value label="Flags" mono>{chunk.flags == null ? '—' : `0x${chunk.flags.toString(16)}`}</Value>
      <Value label="Area ID">{chunk.areaId ?? '—'}</Value><Value label="Source area">{chunk.sourceAreaName || 'Unresolved'}</Value><Value label="Target area">{chunk.targetAreaName || 'Unresolved'}</Value>
      <Value label="Position X / Y / Z">{[chunk.position?.x, chunk.position?.y, chunk.position?.z].map(value => fmt(value, 3)).join(' / ')}</Value>
      <Value label="Texture layers">{chunk.textureLayers?.length ?? 0}</Value><Value label="Doodad / WMO refs">{`${chunk.doodadRefs?.length || 0} / ${chunk.wmoRefs?.length || 0}`}</Value>
    </div>
    <div className="adt-subheading">MCVT</div>
    <div className="adt-values compact"><Value label="Heights">{chunk.heights?.count ?? 0}</Value><Value label="Min / max">{fmt(chunk.heights?.min)} / {fmt(chunk.heights?.max)}</Value><Value label="Average">{fmt(chunk.heights?.average)}</Value><Value label="Invalid">{chunk.heights?.invalid ?? 0}</Value></div>
    <div className="adt-subheading">Subchunk offsets</div>
    <div className="adt-offset-list">{Object.entries(chunk.subchunks || {}).map(([name, value]) => <div key={name}><span>{name}</span><strong className={value?.valid ? 'ok' : 'warn'}>{value ? `0x${value.offset.toString(16)} · ${value.size ?? 0} bytes` : 'not present'}</strong></div>)}</div>
    <div className="adt-subheading">Textures</div>
    <div className="adt-reference-list">{(chunk.textureLayers || []).map(layer => <div key={layer.index}><span>Layer {layer.index} · #{layer.textureIdx}</span><strong className={statusClass(layer.exists)}>{layer.path || 'Unresolved'} {layer.exists === true ? '· exists' : layer.exists === false ? '· missing' : '· unresolved'}</strong><small>flags 0x{(layer.flags || 0).toString(16)} · alpha {layer.alphaAvailable ? 'available' : 'none'}</small></div>)}</div>
    <div className="adt-subheading">Objects</div>
    <div className="adt-reference-list">{[...(chunk.doodadRefs || []).map(item => ({ ...item, kind: 'M2' })), ...(chunk.wmoRefs || []).map(item => ({ ...item, kind: 'WMO' }))].map((item, index) => <div key={`${item.kind}-${item.index}-${index}`}><span>{item.kind} ref #{item.index}</span><strong className={statusClass(item.exists)}>{item.path || 'Unresolved'} {item.exists === true ? '· exists' : item.exists === false ? '· missing' : '· unresolved'}</strong></div>)}{!chunk.doodadRefs?.length && !chunk.wmoRefs?.length && <div className="adt-empty-inline">No object references</div>}</div>
    <div className="adt-subheading">Water</div>
    <div className="adt-values compact"><Value label="MH2O">{chunk.water?.present ? 'Present' : 'Not present'}</Value><Value label="Liquid layers">{chunk.water?.layers || 0}</Value><Value label="Types">{water?.liquidTypes?.length ? water.liquidTypes.join(', ') : 'Not decoded'}</Value></div>
    <div className="adt-subheading">Warnings</div><WarningList warnings={chunk.warnings} />
  </div>;
}

function AreaTableEditor({ sourceAreaChoices, targetAreaChoices, newAreaSourceId, onSourceChange, newAreaTemplateId, setNewAreaTemplateId, newAreaName, setNewAreaName, newAreaId, setNewAreaId, newAreaParentId, setNewAreaParentId, newAreaFlags, setNewAreaFlags, newAreaAmbienceId, setNewAreaAmbienceId, newAreaZoneMusicId, setNewAreaZoneMusicId, newAreaIntroSound, setNewAreaIntroSound, newAreaExplorationLevel, setNewAreaExplorationLevel, newAreaFactionGroupMask, setNewAreaFactionGroupMask, stageNewArea, loading, status }) {
  return <Panel title="AreaTable target" meta="Belangrijke 3.3.5-velden voor de nieuwe area" className="adt-area-editor-panel">
    <div className="adt-compare-help">Maak een nieuwe target-entry op basis van een bestaande client-entry. De bronclient wordt niet aangepast; het resultaat komt in de ADT-staging output.</div>
    <div className="adt-area-editor-fields">
      <label>Source area<select value={newAreaSourceId} onChange={event => onSourceChange(event.target.value)}><option value="">Select source area…</option>{sourceAreaChoices.map(area => <option key={`editor-source-${area.id}`} value={area.id}>{area.id} · {area.name || 'Area name unavailable'}</option>)}</select></label>
      <label>Target template<select value={newAreaTemplateId} onChange={event => setNewAreaTemplateId(event.target.value)} disabled={!targetAreaChoices.length}>{targetAreaChoices.map(area => <option key={`editor-template-${area.id}`} value={area.id}>{area.id} · {area.name || 'Area name unavailable'}</option>)}</select></label>
      <label>New name<input value={newAreaName} onChange={event => setNewAreaName(event.target.value)} placeholder="Sparkwater Port" /></label>
      <label>New ID<input value={newAreaId} onChange={event => setNewAreaId(event.target.value)} placeholder="Auto" inputMode="numeric" /></label>
      <label>Parent AreaID<input value={newAreaParentId} onChange={event => setNewAreaParentId(event.target.value)} inputMode="numeric" /></label>
      <label>Faction mask<input value={newAreaFactionGroupMask} onChange={event => setNewAreaFactionGroupMask(event.target.value)} inputMode="numeric" /></label>
      <AreaFlagPicker value={newAreaFlags} onChange={setNewAreaFlags} />
      <label>Ambience ID<input value={newAreaAmbienceId} onChange={event => setNewAreaAmbienceId(event.target.value)} inputMode="numeric" /></label>
      <label>Zone music ID<input value={newAreaZoneMusicId} onChange={event => setNewAreaZoneMusicId(event.target.value)} inputMode="numeric" /></label>
      <label>Intro sound ID<input value={newAreaIntroSound} onChange={event => setNewAreaIntroSound(event.target.value)} inputMode="numeric" /></label>
      <label>Area level<input value={newAreaExplorationLevel} onChange={event => setNewAreaExplorationLevel(event.target.value)} inputMode="numeric" /></label>
      <button className="adt-btn primary" onClick={stageNewArea} disabled={loading || !newAreaName.trim() || !newAreaSourceId}>{loading ? 'Staging…' : 'Stage AreaTable entry'}</button>
    </div>
    {status && <div className="adt-stage-status">{status}</div>}
  </Panel>;
}

const STAGE_ARTIFACTS = [
  { key: 'adt', label: 'ADT tile', description: 'De geselecteerde terrain tile.', required: true },
  { key: 'areaTable', label: 'AreaTable.dbc', description: 'De gestagede area-entry en naamwijzigingen.', available: true },
];

const BUILD_OUTPUTS = [
  { key: 'map', label: '.map', description: 'Server terrain/heightmap output.' },
  { key: 'vmap', label: 'VMap check', description: 'Controleer object-collision dependencies voor deze tile.' },
  { key: 'mmap', label: 'MMAP', description: 'Gerichte pathfinding voor deze tile en omliggende maps.' },
];

function StageCheckbox({ item, checked, onChange }) {
  return <label className={`adt-stage-option ${item.available === false ? 'disabled' : ''}`}>
    <input type="checkbox" checked={checked} disabled={item.available === false} onChange={event => onChange(event.target.checked)} />
    <span><strong>{item.label}</strong><small>{item.description}{item.note ? ` · ${item.note}` : ''}</small></span>
  </label>;
}

function ServerTileStagingPanel({ loading, status, onPrepare, onRunMap, onInspectVmap, onRunMmap, jobRoot, stagedAreaTablePath, areaTableSourceAvailable, selectedArtifacts, setSelectedArtifacts, buildPlan, setBuildPlan }) {
  const selectedStageCount = Object.values(selectedArtifacts).filter(Boolean).length;
  const selectedBuildCount = Object.values(buildPlan).filter(Boolean).length;
  const areaTableReady = Boolean(stagedAreaTablePath || areaTableSourceAvailable);
  const toggleStage = (key, checked) => setSelectedArtifacts(current => ({ ...current, [key]: checked }));
  const toggleBuild = (key, checked) => setBuildPlan(current => ({ ...current, [key]: checked }));
  return <Panel title="Server tile staging" meta="Veilige voorbereiding · output buiten de live server" className="adt-server-stage-panel">
    <div className="adt-server-stage-content"><div><strong>Select what belongs in this staging job</strong><span>Alleen de aangevinkte bestanden en het build-plan worden in de manifest gezet. Client- en serverdata blijven ongewijzigd.</span></div><div className="adt-stage-actions"><button className="adt-btn primary" onClick={onPrepare} disabled={loading || !selectedArtifacts.adt}>{loading ? 'Preparing…' : 'Prepare server tile'}</button>{jobRoot && <><button className="adt-btn" onClick={onRunMap} disabled={loading || !buildPlan.map}>{loading ? 'Generating…' : 'Generate .map'}</button><button className="adt-btn" onClick={onInspectVmap} disabled={loading || !buildPlan.vmap}>{loading ? 'Checking…' : 'Inspect VMap deps'}</button><button className="adt-btn" onClick={onRunMmap} disabled={loading || !buildPlan.mmap || !buildPlan.map}>{loading ? 'Generating…' : 'Generate MMAP'}</button></>}</div></div>
    <div className="adt-stage-sections">
      <div><h3>Client overlay</h3><div className="adt-stage-options">{STAGE_ARTIFACTS.map(item => <StageCheckbox key={item.key} item={{ ...item, available: item.key === 'areaTable' ? areaTableReady : item.available }} checked={Boolean(selectedArtifacts[item.key])} onChange={checked => toggleStage(item.key, checked)} />)}</div></div>
      <div><h3>Server output plan</h3><div className="adt-stage-options">{BUILD_OUTPUTS.map(item => <StageCheckbox key={item.key} item={item} checked={Boolean(buildPlan[item.key])} onChange={checked => toggleBuild(item.key, checked)} />)}</div></div>
      <div className="adt-stage-selection-summary"><strong>{selectedStageCount} client item{selectedStageCount === 1 ? '' : 's'} · {selectedBuildCount} server output{selectedBuildCount === 1 ? '' : 's'}</strong><span>{selectedArtifacts.areaTable && !areaTableReady ? 'AreaTable is aangevinkt maar er is geen bron beschikbaar.' : selectedArtifacts.areaTable ? `AreaTable.dbc wordt meegenomen${stagedAreaTablePath ? ' vanuit staging' : ' vanuit de Current Client'}.` : 'Geen AreaTable.dbc geselecteerd.'}</span></div>
    </div>
    {status && <div className="adt-stage-status">{status}</div>}
  </Panel>;
}

export default function ADTEditorPage() {
  const { worldmapMpqPath } = useConnection();
  const [sourceType, setSourceType] = useState('current');
  const [standalonePath, setStandalonePath] = useState('');
  const [maps, setMaps] = useState([]);
  const [mapName, setMapName] = useState('');
  const [tileX, setTileX] = useState('');
  const [tileY, setTileY] = useState('');
  const [tileQuery, setTileQuery] = useState('');
  const [inspection, setInspection] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [error, setError] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [areaTarget, setAreaTarget] = useState('');
  const nameView = 'source';
  const [stageLoading, setStageLoading] = useState(false);
  const [stageStatus, setStageStatus] = useState('');
  const [stagedAdtPath, setStagedAdtPath] = useState('');
  const [stagedAreaTablePath, setStagedAreaTablePath] = useState('');
  const [serverTileLoading, setServerTileLoading] = useState(false);
  const [serverTileStatus, setServerTileStatus] = useState('');
  const [serverTileJobRoot, setServerTileJobRoot] = useState('');
  const [selectedArtifacts, setSelectedArtifacts] = useState({ adt: true, areaTable: false });
  const [buildPlan, setBuildPlan] = useState({ map: true, vmap: true, mmap: true });
  const [newAreaSourceId, setNewAreaSourceId] = useState('');
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaId, setNewAreaId] = useState('');
  const [newAreaTemplateId, setNewAreaTemplateId] = useState('14');
  const [newAreaParentId, setNewAreaParentId] = useState('');
  const [newAreaFlags, setNewAreaFlags] = useState('64');
  const [newAreaAmbienceId, setNewAreaAmbienceId] = useState('25');
  const [newAreaZoneMusicId, setNewAreaZoneMusicId] = useState('9');
  const [newAreaIntroSound, setNewAreaIntroSound] = useState('0');
  const [newAreaExplorationLevel, setNewAreaExplorationLevel] = useState('0');
  const [newAreaFactionGroupMask, setNewAreaFactionGroupMask] = useState('4');
  const [stagedTargetAreas, setStagedTargetAreas] = useState([]);
  const [areaTableStageLoading, setAreaTableStageLoading] = useState(false);
  const [areaTableStageStatus, setAreaTableStageStatus] = useState('');

  const loadConfigAndMaps = useCallback(async (kind = sourceType) => {
    setMaps([]); setMapName(''); setTileX(''); setTileY(''); setTileQuery('');
    if (kind === 'standalone') return;
    setMapsLoading(true); setError('');
    const result = await window.azeroth.adt.listMaps({ sourceType: kind });
    setMapsLoading(false);
    if (!result.success) { setError(result.error || 'Could not resolve the selected source.'); return; }
    setMaps(result.data || []);
  }, [sourceType]);

  useEffect(() => { if (worldmapMpqPath) loadConfigAndMaps(sourceType); }, [sourceType, worldmapMpqPath, loadConfigAndMaps]);

  const browseStandalone = async () => {
    const picked = await window.azeroth.dialog.openFile({ title: 'Browse ADT File', filters: [{ name: 'ADT files', extensions: ['adt'] }] });
    if (picked) { setStandalonePath(picked); setError(''); await load(picked); }
  };

  const load = async (standaloneOverride = standalonePath) => {
    setLoading(true); setError(''); setStageStatus(''); setInspection(null); setSelectedIndex(0); setAreaFilter(''); setAreaTarget('');
    try {
      const result = await window.azeroth.adt.inspect({ sourceType, standalonePath: standaloneOverride, mapName, tileX: tileX === '' ? null : Number(tileX), tileY: tileY === '' ? null : Number(tileY) });
      if (!result.success) setError(result.error || 'Could not read ADT.'); else setInspection(result);
    } catch (loadError) {
      setError(loadError?.message || 'Could not read ADT.');
    } finally {
      setLoading(false);
    }
  };

  const clear = () => { setInspection(null); setError(''); setSelectedIndex(0); setStageStatus(''); setServerTileStatus(''); setServerTileJobRoot(''); setStagedAdtPath(''); setStagedAreaTablePath(''); setSelectedArtifacts({ adt: true, areaTable: false }); if (sourceType === 'standalone') setStandalonePath(''); };
  const selectedChunk = inspection?.chunks?.[selectedIndex] || null;
  const selectedMap = useMemo(() => {
    const map = maps.find(item => item.name === mapName);
    return map ? { ...map, tiles: [...(map.tiles || [])].sort(compareTiles) } : null;
  }, [maps, mapName]);
  const visibleTiles = useMemo(() => {
    const query = tileQuery.trim().replace(/\s+/g, '').replace(',', '_');
    if (!query) return selectedMap?.tiles || [];
    return (selectedMap?.tiles || []).filter(tile => `${tile.x}_${tile.y}`.includes(query) || `${tile.x},${tile.y}`.includes(tileQuery.trim()));
  }, [selectedMap, tileQuery]);
  const chunkSummary = useMemo(() => summarizeChunks(inspection?.overview?.topChunks), [inspection]);
  const filterAreaId = areaFilter === '' ? null : Number(areaFilter);
  const matchingChunkCount = inspection?.chunks?.filter(chunk => filterAreaId == null || chunk.areaId === filterAreaId).length || 0;
  const sourceAreaChoices = useMemo(() => {
    const sourceById = new Map((inspection?.sourceAreaChoices || []).map(area => [area.id, area]));
    const usedIds = [...new Set((inspection?.chunks || []).map(chunk => chunk.areaId).filter(Number.isInteger))];
    return usedIds.map(id => {
      const summary = inspection?.areaSummary?.find(area => area.areaId === id);
      return sourceById.get(id) || { id, name: summary?.sourceAreaName || summary?.areaName || null, mapId: summary?.sourceMapId ?? null };
    }).sort((a, b) => a.id - b.id);
  }, [inspection]);
  const targetAreaChoices = useMemo(() => [...new Map([...(inspection?.targetAreaChoices || []), ...stagedTargetAreas].map(area => [area.id, area])).values()].sort((a, b) => a.id - b.id), [inspection, stagedTargetAreas]);
  useEffect(() => {
    const area = sourceAreaChoices.find(item => String(item.id) === newAreaSourceId);
    if (area) setNewAreaParentId(area.parentAreaId == null ? '14' : String(area.parentAreaId));
  }, [sourceAreaChoices, newAreaSourceId]);
  useEffect(() => {
    const template = targetAreaChoices.find(item => String(item.id) === newAreaTemplateId);
    if (!template) return;
    setNewAreaFlags(String(template.flags ?? 0));
    setNewAreaAmbienceId(String(template.ambienceId ?? 0));
    setNewAreaZoneMusicId(String(template.zoneMusicId ?? 0));
    setNewAreaIntroSound(String(template.introSound ?? 0));
    setNewAreaExplorationLevel(String(template.explorationLevel ?? 0));
    setNewAreaFactionGroupMask(String(template.factionGroupMask ?? 0));
  }, [targetAreaChoices, newAreaTemplateId]);
  const tileStats = useMemo(() => {
    if (!inspection) return null;
    const chunks = inspection.chunks || [];
    const heights = chunks.flatMap(chunk => [chunk.heights?.min, chunk.heights?.max].filter(Number.isFinite));
    return {
      valid: chunks.filter(chunk => chunk.valid).length,
      warnings: chunks.filter(chunk => chunk.warnings?.length).length,
      areas: inspection.areaSummary?.length || 0,
      textures: inspection.textures?.length || 0,
      m2: inspection.objects?.m2?.length || 0,
      wmo: inspection.objects?.wmo?.length || 0,
      water: inspection.water?.present ? inspection.water.layers : 0,
      minHeight: heights.length ? Math.min(...heights) : null,
      maxHeight: heights.length ? Math.max(...heights) : null,
    };
  }, [inspection]);

  const handleMapChange = (event) => {
    const nextMap = event.target.value;
    const firstTile = [...(maps.find(item => item.name === nextMap)?.tiles || [])].sort(compareTiles)[0];
    setMapName(nextMap);
    setTileQuery('');
    setTileX(firstTile ? String(firstTile.x) : '');
    setTileY(firstTile ? String(firstTile.y) : '');
  };

  const handleTileChange = (event) => {
    const [x, y] = event.target.value.split('_');
    setTileX(x || ''); setTileY(y || '');
  };

  const stageAreaIdChanges = async () => {
    if (!inspection || !Number.isInteger(filterAreaId) || !Number.isInteger(Number(areaTarget))) return;
    setStageLoading(true); setStageStatus(''); setError('');
    try {
      const result = await window.azeroth.adt.stageAreaIds({
        sourceType,
        standalonePath,
        mapName,
        tileX: tileX === '' ? null : Number(tileX),
        tileY: tileY === '' ? null : Number(tileY),
        fromAreaId: filterAreaId,
        toAreaId: Number(areaTarget),
      });
      if (!result.success) setError(result.error || 'Could not stage AreaID changes.');
      else { if (result.outputPath) setStagedAdtPath(result.outputPath); setSelectedArtifacts(current => ({ ...current, adt: true })); setStageStatus(result.outputPath ? `${result.message} Output: ${result.outputPath}` : result.message); }
    } catch (stageError) {
      setError(stageError?.message || 'Could not stage AreaID changes.');
    } finally {
      setStageLoading(false);
    }
  };

  const stageNewArea = async () => {
    if (!newAreaName.trim() || !Number.isInteger(Number(newAreaTemplateId))) return;
    setAreaTableStageLoading(true); setAreaTableStageStatus(''); setError('');
    try {
      const result = await window.azeroth.adt.stageAreaTableArea({ newAreaId: newAreaId === '' ? null : Number(newAreaId), name: newAreaName.trim(), templateAreaId: Number(newAreaTemplateId), parentAreaId: newAreaParentId === '' ? null : Number(newAreaParentId), flags: newAreaFlags, ambienceId: newAreaAmbienceId, zoneMusicId: newAreaZoneMusicId, introSound: newAreaIntroSound, explorationLevel: newAreaExplorationLevel, factionGroupMask: newAreaFactionGroupMask });
      if (!result.success) setError(result.error || 'Could not stage the new AreaTable entry.');
      else { if (result.outputPath) setStagedAreaTablePath(result.outputPath); setSelectedArtifacts(current => ({ ...current, areaTable: true })); setStagedTargetAreas(previous => [...previous, { id: result.areaId, name: result.name, mapId: null }]); setAreaTarget(String(result.areaId)); setAreaTableStageStatus(`${result.message} Output: ${result.outputPath}`); }
    } catch (stageError) {
      setError(stageError?.message || 'Could not stage the new AreaTable entry.');
    } finally {
      setAreaTableStageLoading(false);
    }
  };

  const prepareServerTile = async () => {
    setServerTileLoading(true); setServerTileStatus(''); setError('');
    try {
      const result = await window.azeroth.adt.prepareServerTile({ sourceType, standalonePath, mapName, tileX: tileX === '' ? null : Number(tileX), tileY: tileY === '' ? null : Number(tileY), stagedAdtPath, areaTablePath: stagedAreaTablePath, selectedArtifacts, buildPlan });
      if (!result.success) setError(result.error || 'Could not prepare server tile.');
      else { setServerTileJobRoot(result.jobRoot || ''); setServerTileStatus(`${result.message} Output: ${result.jobRoot}`); }
    } catch (prepareError) {
      setError(prepareError?.message || 'Could not prepare server tile.');
    } finally {
      setServerTileLoading(false);
    }
  };

  const runMapExtractor = async () => {
    if (!serverTileJobRoot) return;
    setServerTileLoading(true); setServerTileStatus(''); setError('');
    try {
      const result = await window.azeroth.adt.runMapExtractor({ jobRoot: serverTileJobRoot });
      if (!result.success) setError(result.error || 'Could not generate the .map file.');
      else setServerTileStatus(`${result.message} ${result.warnings?.length ? `Warnings: ${result.warnings.join('; ')}` : ''}`);
    } catch (extractError) {
      setError(extractError?.message || 'Could not generate the .map file.');
    } finally {
      setServerTileLoading(false);
    }
  };

  const inspectVmapDependencies = async () => {
    if (!serverTileJobRoot) return;
    setServerTileLoading(true); setServerTileStatus(''); setError('');
    try {
      const result = await window.azeroth.adt.inspectVmapDependencies({ jobRoot: serverTileJobRoot });
      if (!result.success) setError(result.error || 'Could not inspect VMap dependencies.');
      else setServerTileStatus(`${result.message} ${result.missingModels?.length ? `Missing: ${result.missingModels.length}` : 'All referenced models are available.'}`);
    } catch (inspectError) {
      setError(inspectError?.message || 'Could not inspect VMap dependencies.');
    } finally {
      setServerTileLoading(false);
    }
  };

  const runMmapExtractor = async () => {
    if (!serverTileJobRoot) return;
    setServerTileLoading(true); setServerTileStatus(''); setError('');
    try {
      const result = await window.azeroth.adt.runMmapExtractor({ jobRoot: serverTileJobRoot });
      if (!result.success) setError(result.error || 'Could not generate the MMAP tile.');
      else setServerTileStatus(`${result.message} ${result.bytes ? `(${result.bytes} bytes)` : ''}`);
    } catch (mmapError) {
      setError(mmapError?.message || 'Could not generate the MMAP tile.');
    } finally {
      setServerTileLoading(false);
    }
  };

  return <div className="adt-page">
    <header className="adt-header"><div><h1><FileSearch size={19} /> ADT Editor</h1><p>Inspect ADT tiles and safely stage AreaID and AreaTable changes.</p></div><div className="adt-readonly"><ShieldCheck size={14} /> Staged output only</div></header>
    <div className="adt-toolbar">
      <label>Source<select value={sourceType} onChange={event => { setSourceType(event.target.value); setInspection(null); setError(''); }}><option value="current">Configured Current Client</option><option value="standalone">Standalone ADT File</option></select></label>
      {sourceType === 'standalone' ? <div className="adt-file-pick"><span title={standalonePath}>{standalonePath || 'No ADT file selected'}</span><button className="adt-btn" onClick={browseStandalone}><FolderOpen size={13} /> Browse ADT File</button></div> : <><label>Map<select value={mapName} onChange={handleMapChange} disabled={mapsLoading || !maps.length}><option value="">{mapsLoading ? 'Loading maps…' : maps.length ? 'Select map…' : 'No maps found'}</option>{maps.map(item => <option key={item.name} value={item.name}>{item.name} ({item.tiles.length} tiles)</option>)}</select></label><label>Find tile<input value={tileQuery} onChange={event => setTileQuery(event.target.value)} placeholder="e.g. 40,31" disabled={!selectedMap} /></label><label>Tile picker<select value={tileX !== '' && tileY !== '' ? `${tileX}_${tileY}` : ''} onChange={handleTileChange} disabled={!selectedMap}><option value="">{selectedMap ? `Select tile… (${visibleTiles.length})` : 'Select map first'}</option>{visibleTiles.map(tile => <option key={`${tile.x}_${tile.y}`} value={`${tile.x}_${tile.y}`}>{tile.x}, {tile.y}</option>)}</select></label>{selectedMap && <small className="adt-tile-hint">{selectedMap.tiles.some(tile => tile.x === Number(tileX) && tile.y === Number(tileY)) ? `${visibleTiles.length} shown · tile selected` : `${visibleTiles.length} shown · custom tile; load will verify directly`}</small>}</>}
      <button className="adt-btn primary" onClick={() => load()} disabled={loading || (sourceType === 'standalone' ? !standalonePath : !mapName || tileX === '' || tileY === '')}>{loading ? <LoaderCircle size={13} className="adt-spin" /> : <FileSearch size={13} />} {loading ? 'Reading…' : sourceType === 'standalone' ? 'Load ADT' : 'Load'}</button><button className="adt-btn" onClick={clear}><RotateCcw size={13} /> Clear</button>
      <div className="adt-toolbar-status"><span className={`adt-dot ${inspection ? 'ok' : error ? 'warn' : 'muted'}`} /> {inspection?.source?.label || SOURCE_OPTIONS.find(item => item.value === sourceType)?.label}</div>
    </div>
    {error && <div className="adt-error"><AlertTriangle size={14} /> {error}</div>}
    <div className="adt-source-note">Source: <strong>{SOURCE_OPTIONS.find(item => item.value === sourceType)?.label}</strong> · {sourceType === 'standalone' ? `Dependency source: ${worldmapMpqPath ? 'Configured Current Client' : 'None'}` : `Current Client: ${displayPath(worldmapMpqPath)}`}</div>
    {inspection ? <>
      <ServerTileStagingPanel loading={serverTileLoading} status={serverTileStatus} onPrepare={prepareServerTile} onRunMap={runMapExtractor} onInspectVmap={inspectVmapDependencies} onRunMmap={runMmapExtractor} jobRoot={serverTileJobRoot} stagedAreaTablePath={stagedAreaTablePath} areaTableSourceAvailable={Boolean(worldmapMpqPath)} selectedArtifacts={selectedArtifacts} setSelectedArtifacts={setSelectedArtifacts} buildPlan={buildPlan} setBuildPlan={setBuildPlan} />
      <AreaTableEditor sourceAreaChoices={sourceAreaChoices} targetAreaChoices={targetAreaChoices} newAreaSourceId={newAreaSourceId} onSourceChange={value => { setNewAreaSourceId(value); setAreaFilter(value); setNewAreaName(sourceAreaChoices.find(area => String(area.id) === value)?.name || ''); }} newAreaTemplateId={newAreaTemplateId} setNewAreaTemplateId={setNewAreaTemplateId} newAreaName={newAreaName} setNewAreaName={setNewAreaName} newAreaId={newAreaId} setNewAreaId={setNewAreaId} newAreaParentId={newAreaParentId} setNewAreaParentId={setNewAreaParentId} newAreaFlags={newAreaFlags} setNewAreaFlags={setNewAreaFlags} newAreaAmbienceId={newAreaAmbienceId} setNewAreaAmbienceId={setNewAreaAmbienceId} newAreaZoneMusicId={newAreaZoneMusicId} setNewAreaZoneMusicId={setNewAreaZoneMusicId} newAreaIntroSound={newAreaIntroSound} setNewAreaIntroSound={setNewAreaIntroSound} newAreaExplorationLevel={newAreaExplorationLevel} setNewAreaExplorationLevel={setNewAreaExplorationLevel} newAreaFactionGroupMask={newAreaFactionGroupMask} setNewAreaFactionGroupMask={setNewAreaFactionGroupMask} stageNewArea={stageNewArea} loading={areaTableStageLoading} status={areaTableStageStatus} />
      <Panel title="Area comparison" meta={`${inspection.areaSummary.length} areas found`} className="adt-area-comparison"><div className="adt-compare-help">Source = the selected ADT and its comparison AreaTable. Target = your configured current client. Use the source dropdown below to find the area, then choose the target ID.</div><div className="adt-table-wrap"><table className="adt-table"><thead><tr><th>Source ID</th><th>Source name</th><th>Same ID in target</th><th>Chunks</th></tr></thead><tbody>{inspection.areaSummary.map(area => <tr key={area.areaId}><td>{area.areaId}</td><td>{area.sourceAreaName || 'Unavailable'}</td><td>{area.targetAreaName || 'Not found'}</td><td>{area.chunkCount}</td></tr>)}{!inspection.areaSummary.length && <tr><td colSpan="4" className="adt-empty-cell">No areas found</td></tr>}</tbody></table></div><div className="adt-new-area"><strong>Create custom target area</strong><span>Use a 3.3.5 target template and give the source area a new ID.</span><div className="adt-new-area-fields"><label>Source area<select value={newAreaSourceId} onChange={event => { const value = event.target.value; setNewAreaSourceId(value); setAreaFilter(value); setNewAreaName(sourceAreaChoices.find(area => String(area.id) === value)?.name || ''); }}><option value="">Select source area…</option>{sourceAreaChoices.map(area => <option key={`new-source-${area.id}`} value={area.id}>{area.id} · {area.name || 'Source name unavailable'}</option>)}</select></label><label>Target template<select value={newAreaTemplateId} onChange={event => setNewAreaTemplateId(event.target.value)} disabled={!targetAreaChoices.length}>{targetAreaChoices.map(area => <option key={`new-template-${area.id}`} value={area.id}>{area.id} · {area.name || 'Target name unavailable'}</option>)}</select></label><label>New name<input value={newAreaName} onChange={event => setNewAreaName(event.target.value)} placeholder="Sparkwater Port" /></label><label>New ID<input value={newAreaId} onChange={event => setNewAreaId(event.target.value)} placeholder="Auto" inputMode="numeric" /></label><button className="adt-btn primary" onClick={stageNewArea} disabled={areaTableStageLoading || !newAreaName.trim() || !newAreaSourceId}>{areaTableStageLoading ? 'Staging…' : 'Stage new area'}</button></div>{areaTableStageStatus && <div className="adt-stage-status">{areaTableStageStatus}</div>}</div></Panel><Panel title="ADT overview" meta={inspection.overview.readStatus} className="adt-overview"><div className="adt-values overview-values"><Value label="Source type">{inspection.source.label}</Value><Value label="Resolved source" mono>{displayPath(inspection.source.path)}</Value><Value label="Dependency source">{inspection.source.dependency}</Value><Value label="Relative ADT path" mono>{inspection.file.relativePath}</Value><Value label="Filename" mono>{inspection.file.name}</Value><Value label="File size">{fmtBytes(inspection.file.bytes)}</Value><Value label="SHA-256" mono>{inspection.file.sha256}</Value><Value label="MVER / type">{`${inspection.overview.version ?? '—'} · ${inspection.overview.detectedType}`}</Value></div><div className="adt-overview-bottom"><div><h3>Top-level chunks</h3><div className="adt-chip-list">{chunkSummary.map(chunk => <span className={`adt-chip ${statusClass(chunk.valid)}`} key={chunk.type}>{chunk.type}{chunk.count > 1 ? ` × ${chunk.count}` : ''} · {chunk.bytes} B total</span>)}</div></div><div><h3>Missing required chunks</h3><div className="adt-inline-text">{inspection.overview.missingRequired.length ? inspection.overview.missingRequired.join(', ') : 'None'}</div></div><div><h3>Parser warnings</h3><WarningList warnings={inspection.overview.warnings} /></div></div></Panel><Panel title="In gewone taal" meta="Wat deze tile praktisch betekent" className="adt-explainer"><div className="adt-explainer-grid"><div><strong>Terrain</strong><span>{tileStats.valid}/256 terrain chunks gelezen{tileStats.warnings ? ` · ${tileStats.warnings} met waarschuwingen` : ' · geen chunkwaarschuwingen'}</span></div><div><strong>Gebieden</strong><span>{tileStats.areas || 'Geen'} area-records gevonden</span></div><div><strong>Hoogte</strong><span>{tileStats.minHeight == null ? 'Niet beschikbaar' : `${fmt(tileStats.minHeight)} tot ${fmt(tileStats.maxHeight)}`}</span></div><div><strong>Assets</strong><span>{tileStats.textures} textures · {tileStats.m2} M2 · {tileStats.wmo} WMO</span></div><div><strong>Water</strong><span>{tileStats.water ? `${tileStats.water} liquid layers gevonden` : 'Geen waterlaag gevonden'}</span></div></div><p>Klik hieronder op een tile. Groen betekent dat de MCNK geldig is; geel betekent dat er iets gecontroleerd moet worden; rood betekent dat de chunk ontbreekt of ongeldig is.</p></Panel>
      <div className="adt-workspace"><div className="adt-main-column"><Panel title="MCNK 16 × 16 grid" meta={`${inspection.chunks.filter(chunk => chunk.valid).length}/256 available · ${nameView === 'source' ? 'Source names' : 'Compare names'} · ${filterAreaId == null ? 'click a tile' : `${matchingChunkCount} matching AreaID ${filterAreaId}`}`} className="adt-grid-panel"><div className="adt-grid-tools"><label>Filter source AreaID<select value={areaFilter} onChange={event => setAreaFilter(event.target.value)}><option value="">All source areas</option>{sourceAreaChoices.map(area => <option key={`filter-${area.id}`} value={area.id}>{area.id} · {area.name || 'Source name unavailable'}</option>)}</select></label><span className="adt-grid-match">{filterAreaId == null ? 'All chunks visible' : `${matchingChunkCount} matching chunks`}</span><label>Set matching IDs to target<select value={areaTarget} onChange={event => setAreaTarget(event.target.value)} disabled={!targetAreaChoices.length}><option value="">Select target area…</option>{targetAreaChoices.map(area => <option key={`target-${area.id}`} value={area.id}>{area.id} · {area.name || 'Target name unavailable'}</option>)}</select></label><button className="adt-btn primary" onClick={stageAreaIdChanges} disabled={stageLoading || filterAreaId == null || !Number.isInteger(Number(areaTarget)) || filterAreaId === Number(areaTarget)}>{stageLoading ? 'Staging…' : 'Stage AreaID changes'}</button></div><div className="adt-grid">{inspection.chunks.map(chunk => <GridCell key={chunk.index} chunk={chunk} selected={selectedIndex === chunk.index} nameView={nameView} matches={filterAreaId == null || chunk.areaId === filterAreaId} onSelect={setSelectedIndex} />)}</div><div className="adt-legend"><span><i className="ok" /> valid</span><span><i className="warn" /> warning</span><span><i className="missing" /> missing</span><span><i className="filtered-out" /> filtered out</span></div>{stageStatus && <div className="adt-stage-status">{stageStatus}</div>}</Panel><Panel title="Raw ADT structure tree" meta={`${inspection.overview.topChunks.length} top-level chunks`}><RawTree overview={inspection.overview} onSelect={setSelectedIndex} /></Panel><Panel title="Area summary" meta={`${inspection.areaSummary.length} source areas`}><div className="adt-table-wrap"><table className="adt-table"><thead><tr><th>Source ID</th><th>Source name</th><th>Target name for same ID</th><th>Chunks</th><th>Status</th></tr></thead><tbody>{inspection.areaSummary.map(area => <tr key={area.areaId}><td>{area.areaId}</td><td>{area.sourceAreaName || 'Unavailable'}</td><td>{area.targetAreaName || 'Not found in target'}</td><td>{area.chunkCount}</td><td><span className={`adt-status ${statusClass(area.status)}`}>{area.status}</span></td></tr>)}{!inspection.areaSummary.length && <tr><td colSpan="5" className="adt-empty-cell">No area records parsed</td></tr>}</tbody></table></div></Panel></div><Panel title="Selected MCNK detail" meta={`Index ${selectedIndex}`} className="adt-detail-panel"><ChunkDetail chunk={selectedChunk} textures={inspection.textures} water={inspection.water} /></Panel></div>
    </> : loading ? <div className="adt-empty-page"><LoaderCircle size={28} className="adt-spin" /><strong>Reading ADT…</strong><span>Parsing chunks and resolving optional dependencies.</span></div> : <div className="adt-empty-page"><FileSearch size={28} /><strong>Select a source and load an ADT</strong><span>The inspector never writes to client, server, MPQ, or ADT files.</span></div>}
  </div>;
}
