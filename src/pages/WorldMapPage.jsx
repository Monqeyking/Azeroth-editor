import { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Loader, ArrowLeft, MapPin, Plus, Trash2 } from 'lucide-react';
import './WorldMapPage.css';

const IMG_W = 1024, IMG_H = 768;  // world overview (4×3 tiles @ 256px)
const DETAIL_W = 2048, DETAIL_H = 1536;
const CLIENT_FRAME_W = 1002, CLIENT_FRAME_H = 668;

// Continent areas: positions as fractions of the world overview image
// cx/cy = center, rx/ry = half-width/height of clickable area
const WORLD_AREAS = [
  { mapId: 0,   label: 'Eastern Kingdoms', expansion: 0, cx: 0.775, cy: 0.53, rx: 0.12, ry: 0.30 },
  { mapId: 1,   label: 'Kalimdor',         expansion: 0, cx: 0.265, cy: 0.53, rx: 0.14, ry: 0.32 },
  { mapId: 571, label: 'Northrend',         expansion: 2, cx: 0.510, cy: 0.23, rx: 0.20, ry: 0.18 },
  { mapId: 530, label: 'Outland',           expansion: 1, cx: null,  cy: null },  // not on world map
];

const EXP_CLASS = ['classic', 'tbc', 'wotlk'];
// Captured from the active Patch-B client through UpdateMapHighlight().
// The client crops the top-left portion of the Highlight BLP before scaling it.
const CLIENT_HIGHLIGHTS = {
  0: { cropX: 0.531915, cropY: 1, sizeX: 0.299401, sizeY: 0.844311, offsetX: 0.623752, offsetY: 0.026946 },
  1: { cropX: 0.590909, cropY: 1, sizeX: 0.311377, sizeY: 0.790419, offsetX: 0.088822, offsetY: 0.079102 },
};
const CLIENT_ZONE_CENTERS = {
  0: { Alterac:[.472066,.294032], Arathi:[.530305,.374998], Badlands:[.548948,.604491], BlastedLands:[.537407,.816051], BurningSteppes:[.50373,.659401], DeadwindPass:[.513733,.774147], DunMorogh:[.473309,.553355], Duskwood:[.469225,.770596], EasternPlaguelands:[.576795,.217594], Elwynn:[.460229,.705832], Hinterlands:[.553979,.310367], Hilsbrad:[.469698,.346589], Ironforge:[.48605,.524134], LochModan:[.550369,.548605], Redridge:[.530009,.714443], SearingGorge:[.495415,.609818], Silverpine:[.416194,.306816], Stormwind:[.430281,.683593], Stranglethorn:[.482098,.884765], SwampOfSorrows:[.55028,.760742], Tirisfal:[.432559,.218837], Undercity:[.443368,.251792], Westfall:[.418562,.768465], WesternPlaguelands:[.503789,.235793], Wetlands:[.524356,.468438] },
  1: { Ashenvale:[.495925,.409602], Aszhara:[.621718,.372917], Barrens:[.530175,.593707], Darkshore:[.472827,.271057], Darnassis:[.398301,.118796], Desolace:[.409817,.56441], Durotar:[.588939,.51987], Dustwallow:[.561595,.675951], Felwood:[.497283,.309101], Feralas:[.410326,.712636], Moonglade:[.532666,.206986], Mulgore:[.477922,.602666], Ogrimmar:[.582843,.448117], Silithus:[.442143,.811948], StonetalonMountains:[.441916,.469216], Tanaris:[.563463,.85496], Teldrassil:[.429292,.10865], ThousandNeedles:[.535327,.743207], ThunderBluff:[.46391,.570566], UngoroCrater:[.499548,.815218], Winterspring:[.568842,.270378] },
};
const CLIENT_ZONE_HIGHLIGHTS = {
  0: { Alterac:[.079546,.079546,.432293,.254259], Arathi:[.102273,.102273,.479168,.323862], Badlands:[.070668,.070668,.513614,.569157], BlastedLands:[.095171,.095171,.489821,.768465], BurningSteppes:[.083215,.083186,.462123,.617808], DeadwindPass:[.071023,.071023,.478221,.738636], DunMorogh:[.139915,.139915,.403351,.483397], Duskwood:[.076705,.076705,.430872,.732244], EasternPlaguelands:[.114524,.114524,.519533,.160331], Elwynn:[.098604,.098633,.410927,.656515], Hinterlands:[.109375,.109375,.499291,.25568], Hilsbrad:[.090909,.090909,.424244,.301134], LochModan:[.078362,.078392,.511188,.509409], Redridge:[.061672,.061701,.499173,.683593], SearingGorge:[.063388,.063388,.463721,.578124], Silverpine:[.119319,.119319,.356535,.247157], Stormwind:[.049361,.049361,.4056,.658912], Stranglethorn:[.181286,.181286,.391455,.794122], SwampOfSorrows:[.065164,.065164,.517698,.72816], Tirisfal:[.128374,.128374,.368372,.15465], Westfall:[.099432,.099432,.368846,.718749], WesternPlaguelands:[.122159,.122159,.44271,.174714], Wetlands:[.117484,.117454,.465615,.409711] },
  1: { Ashenvale:[.156704,.156675,.417573,.331265], Aszhara:[.137795,.137823,.55282,.304006], Barrens:[.275364,.275392,.392493,.456011], Darkshore:[.17799,.17799,.383832,.182062], Darnassis:[.028759,.028766,.383921,.104413], Desolace:[.12217,.122198,.348732,.503311], Durotar:[.143683,.143683,.517098,.448028], Dustwallow:[.142664,.142664,.490263,.604619], Felwood:[.156251,.156251,.419158,.230975], Feralas:[.18886,.18886,.315897,.618206], Moonglade:[.062727,.062755,.501303,.175608], Mulgore:[.139607,.139607,.408118,.532862], Ogrimmar:[.038114,.038129,.563786,.429052], Silithus:[.094656,.094685,.394815,.764606], StonetalonMountains:[.1327,.132728,.375566,.402851], Tanaris:[.187501,.187501,.469713,.761209], Teldrassil:[.138361,.138333,.360111,.039483], ThousandNeedles:[.119566,.119566,.475544,.683424], ThunderBluff:[.028363,.028363,.449729,.556385], UngoroCrater:[.100544,.100544,.449276,.764946], Winterspring:[.192936,.192936,.472374,.17391] },
};
function zoneCenter(zone, cont, W, H) {
  if (!cont) return null;
  const native = CLIENT_ZONE_CENTERS[cont.mapId]?.[zone.internalName];
  if (native) return { px: native[0] * CLIENT_FRAME_W * (W / IMG_W), py: native[1] * CLIENT_FRAME_H * (H / IMG_H) };
  const x = (zone.locLeft + zone.locRight) / 2;
  const y = (zone.locTop + zone.locBottom) / 2;
  const px = (cont.locLeft - x) / (cont.locLeft - cont.locRight) * W;
  const py = (cont.locTop - y) / (cont.locTop - cont.locBottom) * H;
  if (px < -60 || px > W + 60 || py < -60 || py > H + 60) return null;
  return { px, py };
}

// ── Continent detail view ──────────────────────────────────────────────────────
function ContinentView({ mapId, label, expansion, areas, layout, dbcPath, worldmapMpqPath, markers, onAddMarker, onUpdateMarker, onDeleteMarker, onBack }) {
  const cont   = WORLD_AREAS.find(a => a.mapId === mapId);
  const folder = mapId === 0 ? 'Azeroth' : mapId === 1 ? 'Kalimdor' : mapId === 530 ? 'Expansion01' : 'Northrend';

  const [imgSrc, setImgSrc]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [tileStatus, setTileStatus] = useState(null);
  const [scale, setScale]     = useState(1);
  const [pan, setPan]         = useState({ x: 0, y: 0 });
  const [placing, setPlacing] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);
  const [hoveredZone, setHoveredZone] = useState(null);
  const [overlays, setOverlays] = useState([]);
  const [overlayImages, setOverlayImages] = useState([]);
  const [zoneImgSrc, setZoneImgSrc] = useState(null);
  const [zoneHighlightSrc, setZoneHighlightSrc] = useState(null);
  const vpRef    = useRef(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setLoading(true); setImgSrc(null); setError(''); setTileStatus(null); setSelectedMarker(null);
    window.azeroth.worldmap.getZoneImage(folder, folder, worldmapMpqPath).then(res => {
      if (res.success) { setImgSrc(res.data); setTileStatus(res); }
      else setError(res.error || `No world-map tiles found for ${folder}.`);
      setLoading(false);
    }).catch(() => { setError(`Could not load ${folder}.`); setLoading(false); });
  }, [mapId, worldmapMpqPath]);

  useEffect(() => { if (dbcPath) window.azeroth.worldmap.readOverlays(dbcPath).then(res => res.success && setOverlays(res.overlays || [])); }, [dbcPath]);
  const activeZone = areas.find(area => area.id === selectedZone);
  const hoverZone = areas.find(area => area.id === hoveredZone);
  useEffect(() => {
    if (!activeZone) { setZoneImgSrc(null); return; }
    let cancelled = false;
    setZoneImgSrc(null);
    window.azeroth.worldmap.getZoneImage(activeZone.internalName, activeZone.internalName, worldmapMpqPath).then(res => {
      if (!cancelled && res.success) setZoneImgSrc(res.data);
    });
    return () => { cancelled = true; };
  }, [activeZone?.id, worldmapMpqPath]);
  useEffect(() => {
    const layout = hoverZone && CLIENT_ZONE_HIGHLIGHTS[mapId]?.[hoverZone.internalName];
    if (!layout) { setZoneHighlightSrc(null); return; }
    let cancelled = false;
    window.azeroth.dbc.readBlpTexture(worldmapMpqPath, `Interface\\WorldMap\\${hoverZone.internalName}\\${hoverZone.internalName}Highlight.blp`).then(res => {
      if (!cancelled) setZoneHighlightSrc(res.success ? `data:image/png;base64,${res.png}` : null);
    });
    return () => { cancelled = true; };
  }, [hoverZone?.internalName, mapId, worldmapMpqPath]);
  useEffect(() => {
    const zone = areas.find(area => area.id === selectedZone);
    const selected = overlays.filter(overlay => overlay.mapAreaId === selectedZone);
    if (!zone || !selected.length) { setOverlayImages([]); return; }
    let cancelled = false;
    Promise.all(selected.map(overlay => window.azeroth.worldmap.getOverlayImage(zone.internalName, overlay.textureName, overlay.width, overlay.height, worldmapMpqPath).then(res => res.success ? { ...overlay, data: res.data } : null))).then(images => { if (!cancelled) setOverlayImages(images.filter(Boolean)); });
    return () => { cancelled = true; };
  }, [selectedZone, overlays, areas, worldmapMpqPath]);

  const displayImgSrc = activeZone ? zoneImgSrc : imgSrc;
  useEffect(() => {
    if (!displayImgSrc || !vpRef.current) return;
    const { width, height } = vpRef.current.getBoundingClientRect();
    const s = Math.min(width / DETAIL_W, height / DETAIL_H) * 0.92;
    setScale(s);
    setPan({ x: (width - DETAIL_W * s) / 2, y: (height - DETAIL_H * s) / 2 });
  }, [displayImgSrc]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setScale(s => Math.min(6, Math.max(0.15, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
  }, []);

  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const onMouseDown = (e) => { if (e.button !== 0) return; dragging.current = true; moved.current = false; lastMouse.current = { x: e.clientX, y: e.clientY }; };
  const onMouseMove = (e) => { if (!dragging.current) return; const dx = e.clientX - lastMouse.current.x, dy = e.clientY - lastMouse.current.y; if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true; setPan(p => ({ x: p.x + dx, y: p.y + dy })); lastMouse.current = { x: e.clientX, y: e.clientY }; };
  const onMouseUp   = () => { dragging.current = false; };
  const addMarkerAt = (e) => {
    onMouseUp();
    if (!placing || moved.current || !vpRef.current) return;
    const rect = vpRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / scale;
    const y = (e.clientY - rect.top - pan.y) / scale;
    if (x < 0 || y < 0 || x > DETAIL_W || y > DETAIL_H) return;
    onAddMarker({ mapId, x: +(x / DETAIL_W).toFixed(5), y: +(y / DETAIL_H).toFixed(5) });
    setPlacing(false);
  };
  const mapMarkers = markers.filter(marker => marker.mapId === mapId);
  const activeMarker = mapMarkers.find(marker => marker.id === selectedMarker);

  const contArea  = areas.find(a => a.mapId === mapId && a.areaId === 0);
  const zoneAreas = areas.filter(a => a.mapId === mapId && a.areaId > 0 && a.internalName);

  return (
    <div className="wm-detail fade-in">
      <div className="wm-detail-bar">
        <button className="wm-back-btn" onClick={onBack}><ArrowLeft size={13} /> World</button>
        <span className="wm-detail-title">{label}</span>
        {activeZone && <button className="wm-back-btn" onClick={() => setSelectedZone(null)}><ArrowLeft size={13} /> {label}</button>}
        <span className={`wm-exp-chip exp-${EXP_CLASS[expansion]}`}>{['Classic','TBC','WotLK'][expansion]}</span>
        {tileStatus && <span className={`wm-tile-status${tileStatus.missingTiles?.length ? ' warn' : ''}`}>{tileStatus.foundTiles}/12 tiles</span>}
        {layout && <span className="wm-tile-status">layout {layout.leftBoundary}–{layout.rightBoundary} / {layout.topBoundary}–{layout.bottomBoundary} · {layout.offsetX.toFixed(3)}, {layout.offsetY.toFixed(3)} · {layout.scale.toFixed(2)}</span>}
        <button className={`wm-edit-btn${placing ? ' active' : ''}`} onClick={() => setPlacing(value => !value)}><Plus size={13} /> Mark zone</button>
      </div>
      <div
        className="wm-viewport"
        ref={vpRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={addMarkerAt}
        style={{ cursor: placing ? 'crosshair' : dragging.current ? 'grabbing' : 'grab' }}
      >
        {loading && <div className="wm-placeholder"><Loader size={20} className="spin" /><span>Loading map…</span></div>}
        {error && <div className="wm-placeholder"><span>{error}</span></div>}
        {displayImgSrc && (
          <div className="wm-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0' }}>
            <div className="wm-canvas" style={{ width: DETAIL_W, height: DETAIL_H }}>
              <img src={displayImgSrc} width={DETAIL_W} height={DETAIL_H} draggable={false} alt="" />
              {!activeZone && contArea && zoneAreas.map(zone => {
                const pos = zoneCenter(zone, contArea, DETAIL_W, DETAIL_H);
                if (!pos) return null;
                return (
                  <button key={zone.id} className={`wm-zone-label${selectedZone === zone.id ? ' selected' : ''}`} style={{ left: pos.px, top: pos.py }} onMouseEnter={() => setHoveredZone(zone.id)} onMouseLeave={() => setHoveredZone(null)} onClick={() => setSelectedZone(zone.id)}>
                    {zone.internalName}
                  </button>
                );
              })}
              {!activeZone && hoverZone && zoneHighlightSrc && (() => {
                const layout = CLIENT_ZONE_HIGHLIGHTS[mapId]?.[hoverZone.internalName];
                if (!layout) return null;
                const [sizeX, sizeY, offsetX, offsetY] = layout;
                const width = sizeX * CLIENT_FRAME_W * (DETAIL_W / IMG_W), height = sizeY * CLIENT_FRAME_H * (DETAIL_H / IMG_H);
                return <div className="wm-continent-highlight" style={{ left: offsetX * CLIENT_FRAME_W * (DETAIL_W / IMG_W), top: offsetY * CLIENT_FRAME_H * (DETAIL_H / IMG_H), width, height }}><img src={zoneHighlightSrc} style={{ width, height: height / .6640625 }} alt="" /></div>;
              })()}
              {overlayImages.map(overlay => <img key={overlay.id} className="wm-game-overlay" src={overlay.data} style={{ left: overlay.offsetX * (DETAIL_W / IMG_W), top: overlay.offsetY * (DETAIL_H / IMG_H), width: overlay.width * (DETAIL_W / IMG_W), height: overlay.height * (DETAIL_H / IMG_H) }} draggable={false} alt="" />)}
              {mapMarkers.map(marker => (
                <button key={marker.id} className={`wm-marker${selectedMarker === marker.id ? ' selected' : ''}`} style={{ left: marker.x * DETAIL_W, top: marker.y * DETAIL_H, '--marker-color': marker.color }} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setSelectedMarker(marker.id); }} title={marker.label}>
                  <MapPin size={20} fill="currentColor" />
                  <span>{marker.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {activeMarker && <aside className="wm-marker-editor">
          <div className="wm-marker-editor-title">Zone marker</div>
          <label>Name<input value={activeMarker.label} onChange={e => onUpdateMarker(activeMarker.id, { label: e.target.value })} /></label>
          <label>Color<input type="color" value={activeMarker.color} onChange={e => onUpdateMarker(activeMarker.id, { color: e.target.value })} /></label>
          <label>Note<textarea rows="3" value={activeMarker.note || ''} onChange={e => onUpdateMarker(activeMarker.id, { note: e.target.value })} /></label>
          <div className="wm-marker-coords">Map {mapId} · {Math.round(activeMarker.x * DETAIL_W)}, {Math.round(activeMarker.y * DETAIL_H)}</div>
          <button className="wm-delete-btn" onClick={() => { onDeleteMarker(activeMarker.id); setSelectedMarker(null); }}><Trash2 size={13} /> Remove marker</button>
        </aside>}
      </div>
    </div>
  );
}

// ── Canvas draw helper ─────────────────────────────────────────────────────────
// Samples a ring of points just outside the continent's bounding ellipse and
// picks a cool/grey-leaning one — i.e. actual sea, not the warm gold of landmass
// or stray ink-line art. Used so the erase color matches the local water tone
// instead of a single global sample (which could land on the center swirl art).
function sampleLocalSeaColor(ctx, cx, cy, rx, ry) {
  const points = 10;
  const samples = [];
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2;
    const px = Math.round((cx + Math.cos(t) * rx * 1.4) * IMG_W);
    const py = Math.round((cy + Math.sin(t) * ry * 1.4) * IMG_H);
    if (px < 3 || py < 3 || px > IMG_W - 3 || py > IMG_H - 3) continue;
    const d = ctx.getImageData(px - 2, py - 2, 4, 4).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = 0; j < d.length; j += 4) { r += d[j]; g += d[j + 1]; b += d[j + 2]; n++; }
    if (n > 0) samples.push([r / n, g / n, b / n]);
  }
  if (samples.length === 0) return [55, 55, 48];
  // warmth = how gold/brown (land-like) a sample is; sort cool→warm and pick a cool one
  samples.sort((a, b) => ((a[0] + a[1]) / 2 - a[2]) - ((b[0] + b[1]) / 2 - b[2]));
  return samples[Math.floor(samples.length * 0.25)];
}

// Repaints only the land-colored pixels inside the continent's bounding box with
// the local sea tone, leaving actual ocean pixels untouched. Result follows the
// real (irregular) coastline instead of leaving a visible ellipse/circle behind.
function eraseLandmass(ctx, cx, cy, rx, ry) {
  const [or_, og_, ob_] = sampleLocalSeaColor(ctx, cx, cy, rx, ry);
  const seaWarmth = (or_ + og_) / 2 - ob_;
  const threshold = seaWarmth + 18;

  const x0 = Math.max(0, Math.floor((cx - rx * 1.3) * IMG_W));
  const y0 = Math.max(0, Math.floor((cy - ry * 1.3) * IMG_H));
  const x1 = Math.min(IMG_W, Math.ceil((cx + rx * 1.3) * IMG_W));
  const y1 = Math.min(IMG_H, Math.ceil((cy + ry * 1.3) * IMG_H));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  const imgData = ctx.getImageData(x0, y0, w, h);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const warmth = (data[i] + data[i + 1]) / 2 - data[i + 2];
    if (warmth > threshold) {
      data[i] = or_; data[i + 1] = og_; data[i + 2] = ob_;
    }
  }
  ctx.putImageData(imgData, x0, y0);
}

function drawWorldCanvas(canvas, img) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, IMG_W, IMG_H);
  ctx.drawImage(img, 0, 0, IMG_W, IMG_H);
}

// ── World overview ─────────────────────────────────────────────────────────────
function WorldOverview({ classicOnly, worldmapMpqPath, onSelect }) {
  const [loaded, setLoaded]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState(null);
  const [scale, setScale]     = useState(1);
  const [pan, setPan]         = useState({ x: 0, y: 0 });
  const [highlightSrc, setHighlightSrc] = useState(null);
  const vpRef     = useRef(null);
  const canvasRef = useRef(null);
  const imgRef    = useRef(null);   // HTMLImageElement, kept alive
  const dragging  = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const moved     = useRef(false);

  const visibleAreas = WORLD_AREAS.filter(a => a.cx !== null && (!classicOnly || a.expansion === 0));

  useEffect(() => {
    setLoading(true); setLoaded(false);
    // classicOnly → preferOldest: zoek de tiles vóór de WotLK-patches (lichking.mpq /
    // patch-3.mpq), waar Northrend nog niet op de wereldkaart getekend stond.
    window.azeroth.worldmap.getZoneImage('World', 'World', worldmapMpqPath, classicOnly).then(res => {
      if (!res.success) { setLoading(false); return; }
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        setLoaded(true);
        setLoading(false);
      };
      img.src = res.data;
    });
  }, [worldmapMpqPath, classicOnly]);

  useEffect(() => {
    const area = WORLD_AREAS.find(item => item.mapId === hovered);
    if (!area || !worldmapMpqPath) { setHighlightSrc(null); return; }
    const folder = area.mapId === 0 ? 'Azeroth' : area.mapId === 1 ? 'Kalimdor' : 'Northrend';
    let cancelled = false;
    window.azeroth.dbc.readBlpTexture(worldmapMpqPath, `Interface\\WorldMap\\${folder}\\${folder}Highlight.blp`).then(res => {
      if (!cancelled) setHighlightSrc(res.success ? `data:image/png;base64,${res.png}` : null);
    });
    return () => { cancelled = true; };
  }, [hovered, worldmapMpqPath]);

  // Patch-B already contains the Classic+ artwork. Keep the original pixels intact.
  useEffect(() => {
    if (!loaded || !canvasRef.current || !imgRef.current) return;
    drawWorldCanvas(canvasRef.current, imgRef.current);
  }, [loaded]);

  // Center on load
  useEffect(() => {
    if (!loaded || !vpRef.current) return;
    const { width, height } = vpRef.current.getBoundingClientRect();
    const s = Math.min(width / IMG_W, height / IMG_H) * 0.96;
    setScale(s);
    setPan({ x: (width - IMG_W * s) / 2, y: (height - IMG_H * s) / 2 });
  }, [loaded]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setScale(s => Math.min(5, Math.max(0.3, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12))));
  }, []);

  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragging.current = true;
    moved.current = false;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x, dy = e.clientY - lastMouse.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    lastMouse.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseUp = () => { dragging.current = false; };

  return (
    <div
      className="wm-viewport"
      ref={vpRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ cursor: dragging.current ? 'grabbing' : 'default' }}
    >
      {loading && <div className="wm-placeholder"><Loader size={20} className="spin" /><span>Loading world map…</span></div>}

      {loaded && (
        <div className="wm-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0' }}>
          <div className="wm-canvas" style={{ width: IMG_W, height: IMG_H }}>
            {/* Canvas: base image + screen-blend glow */}
            <canvas ref={canvasRef} width={IMG_W} height={IMG_H} style={{ display: 'block' }} />
            {highlightSrc && (() => {
              const layout = CLIENT_HIGHLIGHTS[hovered];
              if (!layout) return null;
              const width = layout.sizeX * CLIENT_FRAME_W, height = layout.sizeY * CLIENT_FRAME_H;
              return <div className="wm-continent-highlight" style={{ left: layout.offsetX * CLIENT_FRAME_W, top: layout.offsetY * CLIENT_FRAME_H, width, height }}><img src={highlightSrc} style={{ width: width / layout.cropX, height: height / layout.cropY }} alt="" /></div>;
            })()}

            {/* Invisible hit areas for hover/click — positioned over each continent */}
            {visibleAreas.map(area => (
              <div
                key={area.mapId}
                className={`wm-continent-area${hovered === area.mapId ? ' hovered' : ''}`}
                style={{
                  left:   (area.cx - area.rx) * IMG_W,
                  top:    (area.cy - area.ry) * IMG_H,
                  width:  area.rx * 2 * IMG_W,
                  height: area.ry * 2 * IMG_H,
                }}
                onMouseEnter={() => setHovered(area.mapId)}
                onMouseLeave={() => setHovered(null)}
                onMouseDown={onMouseDown}
                onMouseUp={() => { onMouseUp(); if (!moved.current) onSelect(area); }}
              >
                <span className="wm-continent-name">{area.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function WorldMapPage() {
  const { dbcPath, worldmapMpqPath } = useConnection();
  const [classicOnly, setClassicOnly] = useState(true);
  const [selected, setSelected]       = useState(null);
  const [areas, setAreas]             = useState([]);
  const [continents, setContinents]   = useState([]);
  const [markers, setMarkers]         = useState([]);

  useEffect(() => {
    if (!dbcPath) return;
    window.azeroth.worldmap.readWorldMapAreas(dbcPath).then(res => {
      if (res.success) setAreas(res.areas);
    });
    window.azeroth.worldmap.readContinents(dbcPath).then(res => {
      if (res.success) setContinents(res.continents);
    });
  }, [dbcPath]);

  useEffect(() => {
    let cancelled = false;
    window.azeroth.config.load().then(res => {
      if (!cancelled && res.success) setMarkers(Array.isArray(res.data?.worldMapMarkers) ? res.data.worldMapMarkers : []);
    });
    return () => { cancelled = true; };
  }, []);

  const saveMarkers = useCallback((next) => {
    setMarkers(next);
    window.azeroth.config.save({ worldMapMarkers: next });
  }, []);
  const addMarker = useCallback(({ mapId, x, y }) => {
    const id = `wm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    saveMarkers([...markers, { id, mapId, x, y, label: 'New zone', note: '', color: '#e3ad32' }]);
  }, [markers, saveMarkers]);
  const updateMarker = useCallback((id, patch) => saveMarkers(markers.map(marker => marker.id === id ? { ...marker, ...patch } : marker)), [markers, saveMarkers]);
  const deleteMarker = useCallback((id) => saveMarkers(markers.filter(marker => marker.id !== id)), [markers, saveMarkers]);

  useEffect(() => {
    if (selected && classicOnly && selected.expansion > 0) setSelected(null);
  }, [classicOnly]);

  return (
    <div className="wm-page fade-in">
      <div className="wm-toolbar">
        {selected ? (
          <>
            <button className="wm-back-btn" onClick={() => setSelected(null)}><ArrowLeft size={13} /> World</button>
            <span className="wm-detail-title">{selected.label}</span>
            <span className={`wm-exp-chip exp-${EXP_CLASS[selected.expansion]}`}>{['Classic','TBC','WotLK'][selected.expansion]}</span>
          </>
        ) : (
          <span className="wm-toolbar-title">World Map</span>
        )}
        <label className="wm-classic-toggle">
          <input type="checkbox" checked={classicOnly} onChange={e => setClassicOnly(e.target.checked)} />
          <span>Classic only</span>
        </label>
      </div>

      {!worldmapMpqPath ? (
        <div className="wm-placeholder" style={{ flex: 1 }}>Set the World Map path in Settings</div>
      ) : selected ? (
        <ContinentView
          key={selected.mapId}
          mapId={selected.mapId}
          label={selected.label}
          expansion={selected.expansion}
          areas={areas}
          layout={continents.find(continent => continent.mapId === selected.mapId)}
          dbcPath={dbcPath}
          worldmapMpqPath={worldmapMpqPath}
          markers={markers}
          onAddMarker={addMarker}
          onUpdateMarker={updateMarker}
          onDeleteMarker={deleteMarker}
          onBack={() => setSelected(null)}
        />
      ) : (
        <WorldOverview
          classicOnly={classicOnly}
          worldmapMpqPath={worldmapMpqPath}
          onSelect={setSelected}
        />
      )}
    </div>
  );
}
