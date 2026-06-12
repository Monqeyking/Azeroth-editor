import { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Loader, ArrowLeft } from 'lucide-react';
import './WorldMapPage.css';

const IMG_W = 2048, IMG_H = 1536;

const CONTINENTS = [
  { mapId: 0,   label: 'Eastern Kingdoms', folder: 'Azeroth',     base: 'Azeroth',     expansion: 0 },
  { mapId: 1,   label: 'Kalimdor',         folder: 'Kalimdor',    base: 'Kalimdor',    expansion: 0 },
  { mapId: 530, label: 'Outland',           folder: 'Expansion01', base: 'Expansion01', expansion: 1 },
  { mapId: 571, label: 'Northrend',         folder: 'Northrend',   base: 'Northrend',   expansion: 2 },
];

const EXP_LABEL = ['Classic', 'TBC', 'WotLK'];

function zoneCenter(zone, cont) {
  if (!cont) return null;
  const cy = (zone.locLeft  + zone.locRight)  / 2;
  const cx = (zone.locTop   + zone.locBottom) / 2;
  const px = (cont.locLeft  - cy) / (cont.locLeft  - cont.locRight)  * IMG_W;
  const py = (cont.locTop   - cx) / (cont.locTop   - cont.locBottom) * IMG_H;
  if (px < -60 || px > IMG_W + 60 || py < -60 || py > IMG_H + 60) return null;
  return { px, py };
}

// ── Continent detail view ──────────────────────────────────────────────────────
function ContinentView({ cont, areas, worldmapMpqPath, onBack }) {
  const [imgSrc, setImgSrc]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale]     = useState(1);
  const [pan, setPan]         = useState({ x: 0, y: 0 });
  const vpRef                 = useRef(null);
  const dragging              = useRef(false);
  const lastMouse             = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setLoading(true);
    setImgSrc(null);
    window.azeroth.worldmap.getZoneImage(cont.folder, cont.base, worldmapMpqPath).then(res => {
      if (res.success) setImgSrc(res.data);
      setLoading(false);
    });
  }, [cont, worldmapMpqPath]);

  useEffect(() => {
    if (!imgSrc || !vpRef.current) return;
    const { width, height } = vpRef.current.getBoundingClientRect();
    const s = Math.min(width / IMG_W, height / IMG_H) * 0.92;
    setScale(s);
    setPan({ x: (width - IMG_W * s) / 2, y: (height - IMG_H * s) / 2 });
  }, [imgSrc]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setScale(s => Math.min(6, Math.max(0.15, s * factor)));
  }, []);

  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const onMouseDown = (e) => { if (e.button !== 0) return; dragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; };
  const onMouseMove = (e) => { if (!dragging.current) return; setPan(p => ({ x: p.x + e.clientX - lastMouse.current.x, y: p.y + e.clientY - lastMouse.current.y })); lastMouse.current = { x: e.clientX, y: e.clientY }; };
  const onMouseUp   = () => { dragging.current = false; };

  const contArea  = areas.find(a => a.mapId === cont.mapId && a.areaId === 0);
  const zoneAreas = areas.filter(a => a.mapId === cont.mapId && a.areaId > 0 && a.internalName);

  return (
    <div className="wm-detail fade-in">
      <div className="wm-detail-bar">
        <button className="wm-back-btn" onClick={onBack}>
          <ArrowLeft size={13} /> World
        </button>
        <span className="wm-detail-title">{cont.label}</span>
        <span className="wm-exp-chip">{EXP_LABEL[cont.expansion]}</span>
      </div>

      <div
        className="wm-viewport"
        ref={vpRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: dragging.current ? 'grabbing' : 'grab' }}
      >
        {loading && <div className="wm-placeholder"><Loader size={20} className="spin" /><span>Map laden…</span></div>}

        {imgSrc && (
          <div className="wm-inner" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0' }}>
            <div className="wm-canvas" style={{ width: IMG_W, height: IMG_H }}>
              <img src={imgSrc} width={IMG_W} height={IMG_H} draggable={false} alt="" />
              {contArea && zoneAreas.map(zone => {
                const pos = zoneCenter(zone, contArea);
                if (!pos) return null;
                return (
                  <div key={zone.id} className="wm-zone-label" style={{ left: pos.px, top: pos.py }}>
                    {zone.internalName}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Continent thumbnail (world overview) ──────────────────────────────────────
function ContinentThumb({ cont, worldmapMpqPath, onClick }) {
  const [imgSrc, setImgSrc]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.azeroth.worldmap.getZoneImage(cont.folder, cont.base, worldmapMpqPath).then(res => {
      if (res.success) setImgSrc(res.data);
      setLoading(false);
    });
  }, [cont, worldmapMpqPath]);

  return (
    <button className="wm-thumb" onClick={onClick} title={`Open ${cont.label}`}>
      {loading && <div className="wm-thumb-loading"><Loader size={16} className="spin" /></div>}
      {imgSrc && <img src={imgSrc} alt={cont.label} draggable={false} />}
      <div className="wm-thumb-label">
        <span>{cont.label}</span>
        <span className="wm-exp-chip">{EXP_LABEL[cont.expansion]}</span>
      </div>
    </button>
  );
}

// ── World overview ─────────────────────────────────────────────────────────────
function WorldOverview({ continents, worldmapMpqPath, onSelect }) {
  return (
    <div className="wm-overview fade-in">
      <div className="wm-overview-grid">
        {continents.map(c => (
          <ContinentThumb
            key={c.mapId}
            cont={c}
            worldmapMpqPath={worldmapMpqPath}
            onClick={() => onSelect(c)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function WorldMapPage() {
  const { dbcPath, worldmapMpqPath } = useConnection();

  const [classicOnly, setClassicOnly] = useState(true);
  const [selected, setSelected]       = useState(null);
  const [areas, setAreas]             = useState([]);

  const visible = classicOnly ? CONTINENTS.filter(c => c.expansion === 0) : CONTINENTS;

  useEffect(() => {
    if (!dbcPath) return;
    window.azeroth.worldmap.readWorldMapAreas(dbcPath).then(res => {
      if (res.success) setAreas(res.areas);
    });
  }, [dbcPath]);

  // If selected continent hidden by filter, go back to overview
  useEffect(() => {
    if (selected && !visible.find(c => c.mapId === selected.mapId)) setSelected(null);
  }, [classicOnly]);

  return (
    <div className="wm-page fade-in">
      <div className="wm-toolbar">
        <span className="wm-toolbar-title">World Map</span>
        <label className="wm-classic-toggle">
          <input
            type="checkbox"
            checked={classicOnly}
            onChange={e => setClassicOnly(e.target.checked)}
          />
          <span>Classic only</span>
        </label>
      </div>

      {!worldmapMpqPath ? (
        <div className="wm-placeholder" style={{ flex: 1 }}>
          Stel het World Map-pad in via Settings
        </div>
      ) : selected ? (
        <ContinentView
          cont={selected}
          areas={areas}
          worldmapMpqPath={worldmapMpqPath}
          onBack={() => setSelected(null)}
        />
      ) : (
        <WorldOverview
          continents={visible}
          worldmapMpqPath={worldmapMpqPath}
          onSelect={setSelected}
        />
      )}
    </div>
  );
}
