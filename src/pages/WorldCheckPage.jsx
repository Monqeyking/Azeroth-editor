import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileArchive, FolderOpen, ImageOff, LoaderCircle, Map as MapIcon, RefreshCw } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import './WorldCheckPage.css';

const DEFAULT_COMPARE_PATH = '';
const TILE_X = Array.from({ length: 8 }, (_, i) => i + 28);
const TILE_Y = Array.from({ length: 11 }, (_, i) => i + 35);
const AREA_NAMES = { 0: 'Kalimdor', 14: 'Durotar', 17: 'Barrens', 36: 'Alterac', 11: 'Wetlands', 148: 'Darkshore', 331: 'Ashenvale', 357: 'Feralas', 400: 'Thousand Needles', 405: 'Desolace', 215: 'Mulgore', 1377: 'Silithus' };

function formatBytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function serverCompareChanged(tile) {
  return ['map', 'vmap', 'mmap'].some(type => ['modified', 'only-current', 'only-compare'].includes(tile?.serverCompare?.[type]?.status));
}

function serverCompareLabel(tile) {
  if (!tile?.serverCompare?.configured) return '';
  const changed = ['map', 'vmap', 'mmap'].filter(type => ['modified', 'only-current', 'only-compare'].includes(tile.serverCompare?.[type]?.status));
  return changed.length ? `Server data differs: ${changed.join(', ')}` : 'Server data identical';
}

function serverCompareDetail(tile) {
  if (!tile?.serverCompare?.configured) return '';
  return ['map', 'vmap', 'mmap'].map(type => {
    const item = tile.serverCompare[type] || {};
    return `${type}: ${item.status || 'not-compared'} (${formatBytes(item.current?.bytes)} vs ${formatBytes(item.compare?.bytes)})`;
  }).join(' · ');
}

function TileCard({ tile, selected, onSelect, focusDurotar, previewLoading, previewMode }) {
  const present = tile?.adt?.exists || tile?.status !== 'missing';
  const zoneLabel = tile?.zoneStatus === 'durotar' ? 'Durotar' : tile?.zoneStatus === 'mixed' ? 'Mixed' : tile?.zoneStatus === 'adjacent' ? 'Adjacent' : 'ADT missing';
  const validationLabel = tile?.status === 'complete' ? 'Ready' : tile?.status === 'missing-assets' ? 'Missing refs' : tile?.status === 'missing' ? 'ADT missing' : 'Click to validate';
  const compareLabel = previewMode === 'compare' ? (serverCompareChanged(tile) ? 'Server geometry differs' : tile?.compareConsistencyStatus === 'inconsistent' ? 'Minimap/ADT mismatch' : tile?.compareStatus === 'modified' ? 'World modified' : tile?.compareStatus === 'only-current' ? 'Only A' : tile?.compareStatus === 'only-compare' ? 'Only B' : tile?.comparePreviewStatus === 'modified' ? 'Minimap differs' : tile?.compareStatus === 'identical' ? 'Identical' : tile?.compareStatus === 'compare-invalid' ? 'B invalid' : '') : '';
  const currentPreview = tile?.preview?.png;
  const comparePreview = tile?.comparePreview?.png;
  const activePreview = previewMode === 'compare' ? comparePreview : currentPreview;
  return (
    <button className={`wc-tile ${present ? 'available' : 'missing'} ${tile?.zoneStatus || ''}${focusDurotar && tile?.zoneStatus === 'adjacent' ? ' outside' : ''}${selected ? ' selected' : ''}`} onClick={() => onSelect(tile)}>
      {activePreview ? <img src={activePreview} alt={previewMode === 'compare' ? 'Data compare map' : 'Current client'} /> : previewLoading && tile?.adt?.exists ? <span className="wc-tile-empty"><LoaderCircle size={16} className="wc-spin" /></span> : <span className="wc-tile-empty"><ImageOff size={16} /></span>}
      <span className="wc-tile-label">
        <strong>{tile?.tileX},{tile?.tileY}</strong>
        <span>{zoneLabel} · {compareLabel || validationLabel}</span>
      </span>
      <span className="wc-tile-dot" />
    </button>
  );
}

function PreviewPane({ label, preview, loading, alt }) {
  return (
    <div className="wc-preview-pane">
      <span className="wc-preview-label">{label}</span>
      <div className="wc-detail-preview">
        {preview?.png ? <img src={preview.png} alt={alt} /> : loading ? <div><LoaderCircle size={22} className="wc-spin" /><span>Loading minimap…</span></div> : <div><ImageOff size={22} /><span>No minimap preview</span></div>}
      </div>
    </div>
  );
}

export default function WorldCheckPage() {
  const { worldmapMpqPath, mapsPath } = useConnection();
  const [sourcePath, setSourcePath] = useState('');
  const [compareDraft, setCompareDraft] = useState('');
  const [serverMapsPath, setServerMapsPath] = useState('');
  const [serverComparePath, setServerComparePath] = useState('');
  const [serverCompareDraft, setServerCompareDraft] = useState('');
  const [scan, setScan] = useState(null);
  const [selected, setSelected] = useState(null);
  const [focusDurotar, setFocusDurotar] = useState(true);
  const [previewMode, setPreviewMode] = useState('original');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [inspectingKey, setInspectingKey] = useState(null);
  const [exportKeys, setExportKeys] = useState(() => new Set());
  const [exportStatus, setExportStatus] = useState(null);
  const [error, setError] = useState(null);
  const scanRunRef = useRef(0);
  const runScan = useCallback(async (requestedComparePath, requestedServerComparePath) => {
    const runId = ++scanRunRef.current;
    const pathToScan = (worldmapMpqPath || '').trim();
    const comparePathToScan = (requestedComparePath || '').trim();
    const serverPathToScan = (mapsPath || '').trim();
    const serverComparePathToScan = (requestedServerComparePath || '').trim();
    if (!pathToScan) {
      setError('Current Client is not configured in Settings.');
      return;
    }
    setSourcePath(pathToScan);
    setCompareDraft(comparePathToScan);
    setServerMapsPath(serverPathToScan);
    setServerComparePath(serverComparePathToScan);
    setServerCompareDraft(serverComparePathToScan);
    setLoading(true);
    setError(null);
    setSelected(null);
    setExportKeys(new Set());
    setExportStatus(null);
    try {
      await window.azeroth.config.save({ worldCheckComparePath: comparePathToScan, worldCheckServerComparePath: serverComparePathToScan });
      const result = await window.azeroth.worldCheck.scanDurotar(pathToScan, serverPathToScan, true, comparePathToScan, serverComparePathToScan);
      if (!result.success) throw new Error(result.error || 'Durotar scan failed.');
      setScan(result);
      setSelected(result.tiles.find(tile => tile.adt?.exists && ['durotar', 'mixed'].includes(tile.zoneStatus)) || result.tiles.find(tile => tile.adt?.exists) || result.tiles[0] || null);
      setPreviewLoading(true);
      try {
        const previewTiles = result.tiles.filter(tile => tile.adt?.exists).map(tile => ({ tileX: tile.tileX, tileY: tile.tileY }));
        const previewResult = await window.azeroth.worldCheck.getPreviews(pathToScan, previewTiles);
        const comparePreviewResult = result.compareSource?.valid
          ? await window.azeroth.worldCheck.getPreviews(result.compareSource.basePath, previewTiles, result.compareSource.overlayPath || '')
          : { success: false, error: result.compareSource?.configured ? 'Compare source is not a valid WoW Data folder.' : '' };
        if (runId !== scanRunRef.current) return;
        if (!previewResult.success) throw new Error(`Current Client: ${previewResult.error || 'Minimap previews could not be loaded.'}`);
        const previews = new Map((previewResult.previews || []).map(preview => [`${preview.tileX}_${preview.tileY}`, preview]));
        const comparePreviews = new Map((comparePreviewResult.previews || []).map(preview => [`${preview.tileX}_${preview.tileY}`, preview]));
        const mergePreviews = tile => {
          const key = `${tile.tileX}_${tile.tileY}`;
          const preview = previews.get(key);
          const comparePreview = comparePreviews.get(key);
          const comparePreviewStatus = preview?.sha256 && comparePreview?.sha256 ? preview.sha256 === comparePreview.sha256 ? 'identical' : 'modified' : comparePreview ? 'only-compare' : 'missing';
          const compareConsistencyStatus = comparePreviewStatus === 'modified' && tile.compareStatus === 'identical' ? 'inconsistent' : 'consistent';
          return { ...tile, preview: preview ? { ...tile.preview, ...preview } : tile.preview, comparePreview: comparePreview ? { ...tile.comparePreview, ...comparePreview } : tile.comparePreview, comparePreviewStatus, compareConsistencyStatus };
        };
        setScan(current => current ? { ...current, tiles: current.tiles.map(mergePreviews) } : current);
        setSelected(current => {
          if (!current) return current;
          return mergePreviews(current);
        });
        if (comparePreviewResult.error && result.compareSource?.configured) setError(`Data Compare Map: ${comparePreviewResult.error}`);
      } catch (e) {
        if (runId === scanRunRef.current) setError(`Minimap previews: ${e.message}`);
      } finally {
        if (runId === scanRunRef.current) setPreviewLoading(false);
      }
    } catch (e) {
      setScan(null);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [mapsPath, worldmapMpqPath]);

  useEffect(() => {
    let cancelled = false;
    window.azeroth.config.load().then(result => {
      if (cancelled) return;
      const configuredCompare = result.success ? result.data?.worldCheckComparePath : null;
      const configuredServerCompare = result.success ? result.data?.worldCheckServerComparePath : null;
      const initialComparePath = configuredCompare || DEFAULT_COMPARE_PATH;
      setCompareDraft(initialComparePath);
      setServerComparePath(configuredServerCompare || '');
      setServerCompareDraft(configuredServerCompare || '');
      if (worldmapMpqPath) runScan(initialComparePath, configuredServerCompare || '');
    });
    return () => { cancelled = true; };
  }, [runScan, worldmapMpqPath]);

  const availableCount = useMemo(() => scan?.tiles?.filter(tile => tile.adt?.exists).length || 0, [scan]);
  const durotarCount = useMemo(() => scan?.tiles?.filter(tile => tile.zoneStatus === 'durotar' || tile.zoneStatus === 'mixed').length || 0, [scan]);
  const selectedKey = selected ? `${selected.tileX}_${selected.tileY}` : null;

  const pickServerCompare = async () => {
    const picked = await window.azeroth.dialog.openFolder({ title: 'Select compare server data, maps, vmaps or mmaps folder' });
    if (picked) setServerCompareDraft(picked);
  };

  const pickCompare = async () => {
    const picked = await window.azeroth.dialog.openFolder({ title: 'Select compare client or Data folder' });
    if (picked) setCompareDraft(picked);
  };

  const toggleExportTile = useCallback((tile) => {
    const key = `${tile.tileX}_${tile.tileY}`;
    setExportKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectModifiedTiles = useCallback(() => {
    setExportKeys(new Set((scan?.tiles || []).filter(tile => tile.compareStatus === 'modified' || tile.compareStatus === 'only-compare').map(tile => `${tile.tileX}_${tile.tileY}`)));
  }, [scan]);

  const exportServerData = useCallback(async () => {
    const tiles = [...exportKeys].map(key => {
      const [tileX, tileY] = key.split('_').map(Number);
      return { tileX, tileY };
    });
    if (!tiles.length) {
      setError('Select at least one tile before exporting server data.');
      return;
    }
    setError(null);
    setExportStatus({ busy: true, message: 'Building staging export…' });
    try {
      const result = await window.azeroth.worldCheck.exportServerData(serverMapsPath, tiles);
      if (!result.success) throw new Error(result.error || 'Server data export failed.');
      setExportStatus({ busy: false, message: `Exported ${result.exported.length} .map file(s) to ${result.outputPath}`, result });
    } catch (e) {
      setExportStatus({ busy: false, message: e.message, error: true });
    }
  }, [exportKeys, serverMapsPath]);

  const handleSelectTile = useCallback(async (tile) => {
    setSelected(tile);
    if (!tile?.adt?.exists || ['complete', 'missing-assets'].includes(tile.status)) return;
    const key = `${tile.tileX}_${tile.tileY}`;
    setInspectingKey(key);
    try {
      const result = await window.azeroth.worldCheck.inspectTile(sourcePath, serverMapsPath, tile.tileX, tile.tileY, false, serverComparePath);
      if (!result.success) throw new Error(result.error || 'Tile validation failed.');
      const updatedTile = { ...result.tile, preview: { ...tile.preview, ...result.tile.preview } };
      setScan(current => current ? { ...current, tiles: current.tiles.map(item => item.tileX === tile.tileX && item.tileY === tile.tileY ? { ...item, ...updatedTile, preview: { ...item.preview, ...updatedTile.preview } } : item) } : current);
      setSelected(current => current && `${current.tileX}_${current.tileY}` === key ? { ...current, ...updatedTile, preview: { ...current.preview, ...updatedTile.preview } } : current);
    } catch (e) {
      setError(e.message);
    } finally {
      setInspectingKey(current => current === key ? null : current);
    }
  }, [serverComparePath, serverMapsPath, sourcePath]);

  const loadSelectedPreview = useCallback(async () => {
    if (!selected?.adt?.exists || selected.preview?.png || previewLoading) return;
    const tile = selected;
    const key = `${tile.tileX}_${tile.tileY}`;
    setPreviewLoading(true);
    setError(null);
    try {
      const result = await window.azeroth.worldCheck.inspectTile(sourcePath, serverMapsPath, tile.tileX, tile.tileY, true, serverComparePath);
      if (!result.success) throw new Error(result.error || 'Tile preview failed.');
      setScan(current => current ? { ...current, tiles: current.tiles.map(item => item.tileX === tile.tileX && item.tileY === tile.tileY ? { ...item, ...result.tile, compare: tile.compare, compareStatus: tile.compareStatus, comparePreview: tile.comparePreview, comparePreviewStatus: tile.comparePreviewStatus } : item) } : current);
      setSelected(current => current && `${current.tileX}_${current.tileY}` === key ? { ...current, ...result.tile, compare: tile.compare, compareStatus: tile.compareStatus, comparePreview: tile.comparePreview, comparePreviewStatus: tile.comparePreviewStatus } : current);
    } catch (e) {
      setError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [previewLoading, selected, serverComparePath, serverMapsPath, sourcePath]);

  return (
    <div className="wc-page">
      <header className="wc-header">
        <div>
      <h1><MapIcon size={19} /> World Check</h1>
          <p>Read-only inspection checkpoint for the current client · Durotar</p>
        </div>
        <span className="wc-readonly"><CheckCircle2 size={13} /> No client or server writes</span>
      </header>

      <div className="wc-toolbar">
        <div className="wc-source-row">
          <label className="wc-source-label">Data Compare Map</label>
          <input value={compareDraft} onChange={e => setCompareDraft(e.target.value)} placeholder="Compare client root or Data folder" />
          <button className="btn-ghost" onClick={pickCompare}><FolderOpen size={13} /> Browse</button>
        </div>
        <div className="wc-source-row">
          <label className="wc-source-label">Compare server data</label>
          <input value={serverCompareDraft} onChange={e => setServerCompareDraft(e.target.value)} placeholder="Optional second server dataset" />
          <button className="btn-ghost" onClick={pickServerCompare}><FolderOpen size={13} /> Browse</button>
        </div>
        <button className="btn-primary" onClick={() => runScan(compareDraft, serverCompareDraft)} disabled={loading || !worldmapMpqPath}>
          {loading ? <LoaderCircle size={13} className="wc-spin" /> : <RefreshCw size={13} />}
          {loading ? 'Reading…' : 'Read'}
        </button>
        <label className="wc-view-select"><span>View</span><select value={focusDurotar ? 'durotar' : 'all'} onChange={e => setFocusDurotar(e.target.value === 'durotar')}><option value="durotar">Durotar focus</option><option value="all">All 88 tiles</option></select></label>
        <div className="wc-preview-toggle"><span>Preview</span><button className={previewMode === 'original' ? 'active' : ''} onClick={() => setPreviewMode('original')}>Original</button><button className={previewMode === 'compare' ? 'active' : ''} onClick={() => setPreviewMode('compare')}>Compare</button></div>
        <div className="wc-export-controls"><span>{exportKeys.size} selected</span><button className="btn-ghost" onClick={selectModifiedTiles} disabled={!scan}>Select modified</button><button className="btn-ghost" onClick={() => setExportKeys(new Set())} disabled={!exportKeys.size}>Clear</button><button className="btn-primary" onClick={exportServerData} disabled={!exportKeys.size || !serverMapsPath || exportStatus?.busy}>{exportStatus?.busy ? 'Exporting…' : 'Export Server Data'}</button></div>
        {scan && <span className="wc-source-note">A: {scan.sourcePath} · B: {scan.compareSource?.configured ? scan.compareSource.valid ? scan.compareSource.path : 'invalid path' : 'not configured'} · server maps are read-only validation input</span>}
      </div>

      {error && <div className="wc-error"><AlertTriangle size={15} /> {error}</div>}
      {exportStatus && <div className={`wc-export-status ${exportStatus.error ? 'error' : ''}`}>{exportStatus.message}</div>}

      <div className="wc-summary">
        <div><span>Zone</span><strong>Durotar</strong><small>Map 1 · Kalimdor</small></div>
        <div><span>Durotar coverage</span><strong>{scan ? `${durotarCount}/88` : '—'}</strong><small>Area ID 14 · mixed tiles included</small></div>
        <div><span>ADT tiles</span><strong>{scan ? `${availableCount}/88` : '—'}</strong><small>Current client</small></div>
        <div><span>WDT</span><strong className={scan?.mapFiles?.wdt?.exists ? 'ok' : 'muted'}>{scan ? (scan.mapFiles.wdt.exists ? 'Present' : 'Missing') : '—'}</strong><small>Kalimdor.wdt</small></div>
        <div><span>WDL</span><strong className={scan?.mapFiles?.wdl?.exists ? 'ok' : 'muted'}>{scan ? (scan.mapFiles.wdl.exists ? 'Present' : 'Missing') : '—'}</strong><small>Kalimdor.wdl</small></div>
        <div><span>Server .map</span><strong className={scan?.serverValidation?.found === 88 ? 'ok' : 'muted'}>{scan ? `${scan.serverValidation.found}/88` : '—'}</strong><small>{scan?.serverValidation?.configured ? `${scan.serverValidation.valid} valid${scan.serverValidation.resolvedPath ? ` · ${scan.serverValidation.resolvedPath}` : ''}` : 'Not configured'}</small></div>
        <div><span>Server data</span><strong className={scan?.serverDataValidation?.maps === 88 ? 'ok' : 'muted'}>{scan ? `${scan.serverDataValidation.maps}/88` : '—'}</strong><small>{scan?.serverDataValidation?.configured ? `map · ${scan.serverDataValidation.vmaps}/88 vmap · ${scan.serverDataValidation.mmaps}/88 mmap` : 'Not configured'}</small></div>
        <div><span>Server compare</span><strong className={scan?.serverDataValidation?.compareConfigured ? 'ok' : 'muted'}>{scan?.serverDataValidation?.compareConfigured ? 'Available' : 'Not set'}</strong><small>{scan?.serverDataValidation?.compareConfigured ? `${scan.serverDataValidation.compareMaps}/88 map · ${scan.serverDataValidation.compareVmaps}/88 vmap · ${scan.serverDataValidation.compareMmaps}/88 mmap` : 'Presence only until a second server path is supplied'}</small></div>
      </div>

      <div className="wc-workspace">
        <section className="wc-panel wc-grid-panel">
          <div className="wc-panel-title"><span>{focusDurotar ? 'Durotar tile coverage' : 'Kalimdor tile area'}</span><small>vertical X 28–35 · horizontal Y 35–45</small></div>
          <div className="wc-grid-wrap">
            <div className="wc-axis wc-axis-y">{TILE_X.map(x => <span key={x}>{x}</span>)}</div>
            <div>
              <div className="wc-grid-axis-x">{TILE_Y.map(y => <span key={y}>{y}</span>)}</div>
              <div className="wc-grid">
                {TILE_X.flatMap(tileX => TILE_Y.map(tileY => {
                  const tile = scan?.tiles?.find(item => item.tileX === tileX && item.tileY === tileY) || { tileX, tileY, status: 'missing', zoneStatus: 'missing' };
                  const tileKey = `${tileX}_${tileY}`;
                  return <div className="wc-tile-wrap" key={tileKey}><TileCard tile={tile} selected={selectedKey === tileKey} onSelect={handleSelectTile} focusDurotar={focusDurotar} previewLoading={previewLoading} previewMode={previewMode} /><label className="wc-tile-check" title="Include tile in server-data staging export"><input type="checkbox" checked={exportKeys.has(tileKey)} onChange={() => toggleExportTile(tile)} disabled={!tile.adt?.exists} /><span /></label></div>;
                }))}
              </div>
            </div>
          </div>
          <div className="wc-legend"><span><i className="durotar" /> Durotar</span><span><i className="mixed" /> Mixed tile</span><span><i className="adjacent" /> Adjacent zone</span><span><i className="missing" /> ADT missing</span></div>
        </section>

        <aside className="wc-panel wc-detail-panel">
          <div className="wc-panel-title"><span>Selected tile</span><small>{selected ? `${selected.tileX},${selected.tileY}` : 'None'}</small></div>
          {!selected ? (
            <div className="wc-empty"><FileArchive size={22} /><span>Read and select a tile.</span></div>
          ) : (
            <div className="wc-detail">
              <div className="wc-detail-preview-actions">
                <span>Visual previews</span>
                <button className="btn-ghost" onClick={loadSelectedPreview} disabled={previewLoading || !selected.adt?.exists || !!selected.preview?.png}>
                  {previewLoading ? <LoaderCircle size={12} className="wc-spin" /> : <MapIcon size={12} />}
                  {selected.preview?.png ? 'Loaded' : 'Load preview'}
                </button>
              </div>
              <PreviewPane label={previewMode === 'compare' ? 'Data Compare Map (B)' : 'Current Client (A)'} preview={previewMode === 'compare' ? selected.comparePreview : selected.preview} loading={previewLoading} alt={`${previewMode === 'compare' ? 'Compare source' : 'Current client'} tile ${selected.tileX},${selected.tileY}`} />
              <h2>Tile {selected.tileX},{selected.tileY}</h2>
              <span className={`wc-status ${selected.status}`}>{inspectingKey === selectedKey ? 'Validating dependencies…' : selected.status === 'complete' ? 'Dependencies complete' : selected.status === 'missing-assets' ? 'Missing referenced assets' : selected.status === 'missing' ? 'ADT missing' : 'Click tile to validate'}</span>
              {previewMode === 'compare' && selected.compareStatus && selected.compareStatus !== 'not-configured' && <span className={`wc-compare-status ${selected.compareStatus}`}>{selected.compareStatus === 'identical' ? 'Identical ADT' : selected.compareStatus === 'modified' ? 'Modified ADT' : selected.compareStatus === 'only-current' ? 'Only in Current Client' : selected.compareStatus === 'only-compare' ? 'Only in Data Compare Map' : 'Compare source unavailable'}</span>}
              {previewMode === 'compare' && selected.serverCompare?.configured && <span className={`wc-compare-status ${serverCompareChanged(selected) ? 'warning' : 'identical'}`}>{serverCompareLabel(selected)}</span>}
              {previewMode === 'compare' && selected.comparePreviewStatus === 'modified' && <span className="wc-compare-status visual">{serverCompareChanged(selected) ? 'Minimap differs · server data also differs' : 'Minimap differs · no server file difference'}</span>}
              {previewMode === 'compare' && selected.compareConsistencyStatus === 'inconsistent' && <span className="wc-compare-status warning">Minimap/ADT mismatch · investigate source</span>}
              <dl>
                <dt>ADT file</dt><dd className="wc-mono">World\Maps\Kalimdor\{selected.fileName}</dd>
                <dt>ADT size</dt><dd>{formatBytes(selected.adt?.bytes)}</dd>
                <dt>ADT SHA-256</dt><dd className="wc-mono wc-hash">{selected.adt?.sha256 || 'Not available'}</dd>
                <dt>Minimap</dt><dd>{selected.preview?.exists ? 'Available' : 'Not available'}</dd>
                {previewMode === 'compare' && <><dt>Minimap compare</dt><dd>{selected.comparePreviewStatus === 'modified' ? 'Different visual preview' : selected.comparePreviewStatus === 'identical' ? 'Identical visual preview' : 'Not available'}</dd><dt>Compare ADT</dt><dd>{selected.compare?.exists ? `${formatBytes(selected.compare.bytes)} · ${selected.compare.sha256 === selected.adt?.sha256 ? 'identical' : 'different'}` : selected.compareStatus === 'not-configured' ? 'Not configured' : 'Missing'}</dd></>}
                <dt>Server map</dt><dd>{selected.serverData?.configured ? selected.serverData.map?.exists ? `Present · ${selected.serverData.map.fileName}` : `Missing · ${selected.serverData.map?.fileName || '001xxxxx.map'}` : 'Not configured'}</dd>
                <dt>Server vmap</dt><dd>{selected.serverData?.configured ? selected.serverData.vmap?.exists ? `Present · ${selected.serverData.vmap.fileName}` : `Missing · ${selected.serverData.vmap?.fileName || '001_xx_yy.vmtile'}` : 'Not configured'}</dd>
                <dt>Server mmap</dt><dd>{selected.serverData?.configured ? selected.serverData.mmap?.exists ? `Present · ${selected.serverData.mmap.fileName}` : `Missing · ${selected.serverData.mmap?.fileName || '001xxxxx.mmtile'}` : 'Not configured'}</dd>
                {selected.serverCompare?.configured && <><dt>Server compare</dt><dd>{serverCompareDetail(selected)}</dd></>}
                <dt>Areas</dt><dd className="wc-mono">{selected.area?.counts ? Object.entries(selected.area.counts).sort((a, b) => Number(b[1]) - Number(a[1])).map(([id, count]) => `${AREA_NAMES[id] || `Area ${id}`} (${count})`).join(', ') : 'Not parsed'}</dd>
                <dt>Server .map</dt><dd>{selected.serverMap?.configured ? selected.serverMap.exists ? (selected.serverMap.valid ? `Present and valid · ${selected.serverMap.fileName}` : `Present but invalid · ${selected.serverMap.fileName}`) : `Missing · ${selected.serverMap.fileName}` : 'Not configured'}</dd>
              </dl>
              <div className="wc-dependencies">
                <div className="wc-dependencies-title">Referenced assets <small>{inspectingKey === selectedKey ? 'Loading…' : `${selected.referenceSummary?.found || 0}/${selected.referenceSummary?.total || 0} found`}</small></div>
                {[
                  ['textures', 'Textures'],
                  ['m2', 'M2 models'],
                  ['wmo', 'WMO buildings'],
                ].map(([type, label]) => {
                  const refs = selected.references?.[type] || [];
                  const missing = refs.filter(reference => !reference.exists).length;
                  return (
                    <div className="wc-dependency-group" key={type}>
                      <div className="wc-dependency-heading"><span>{label}</span><small className={missing ? 'missing' : 'ok'}>{refs.length ? `${refs.length - missing}/${refs.length}` : 'none'}</small></div>
                      {refs.length > 0 && <ul>{refs.map(reference => <li key={reference.path} className={reference.exists ? 'found' : 'missing'}><span>{reference.path}</span><strong>{reference.exists ? formatBytes(reference.bytes) : 'Missing'}</strong></li>)}</ul>}
                    </div>
                  );
                })}
              </div>
              <div className="wc-next-note"><AlertTriangle size={14} /> Server map files were only read for validation. No files were copied or changed.</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
