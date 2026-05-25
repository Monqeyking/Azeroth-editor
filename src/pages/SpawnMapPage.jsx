import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Loader } from 'lucide-react';
import './SpawnMapPage.css';

const IMG_W = 1024, IMG_H = 768;

const CONTINENTS = [
  { mapId: 0,   name: 'Eastern Kingdoms', folder: 'Azeroth',     base: 'Azeroth' },
  { mapId: 1,   name: 'Kalimdor',         folder: 'Kalimdor',    base: 'Kalimdor' },
  { mapId: 530, name: 'Outland',          folder: 'Expansion01', base: 'Expansion01' },
  { mapId: 571, name: 'Northrend',        folder: 'Northrend',   base: 'Northrend' },
];

const RANK_NAMES  = ['Normal', 'Elite', 'Rare Elite', 'Boss', 'Rare'];
const MOVE_NAMES  = ['Idle', 'Random', 'Waypoint'];

function worldToZonePx(wx, wy, area) {
  return {
    px: (area.locLeft - wy)  / (area.locLeft  - area.locRight)  * IMG_W,
    py: (area.locTop  - wx)  / (area.locTop   - area.locBottom) * IMG_H,
  };
}

function zonePxToWorld(px, py, area) {
  return {
    wx: area.locTop  - (py / IMG_H) * (area.locTop  - area.locBottom),
    wy: area.locLeft - (px / IMG_W) * (area.locLeft - area.locRight),
  };
}

export default function SpawnMapPage() {
  const { query, dbcPath } = useConnection();

  // World map areas (from DBC)
  const [worldAreas, setWorldAreas] = useState([]);
  const [areasError, setAreasError] = useState('');

  // Selection
  const [continent, setContinent] = useState(CONTINENTS[0]);
  const [zone, setZone]           = useState(null);

  // Images
  const [bgImage, setBgImage]       = useState(null);
  const [imgLoading, setImgLoading] = useState(false);

  // Spawns
  const [creatures,    setCreatures]    = useState([]);
  const [gameobjects,  setGameobjects]  = useState([]);
  const [waypoints,    setWaypoints]    = useState([]);
  const [showCreatures, setShowCreatures] = useState(true);
  const [showGOs,       setShowGOs]       = useState(true);
  const [spawnLoading,  setSpawnLoading]  = useState(false);

  // Selection
  const [selected, setSelected] = useState(null);

  // Pan + zoom
  const [pan,   setPan]   = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const viewRef  = useRef(null);
  const panRef   = useRef({ active: false, sx: 0, sy: 0, px: 0, py: 0 });
  const scaleRef = useRef(1);
  const zoneRef  = useRef(null);

  // Drag spawn
  const dragRef    = useRef(null);
  const [dragPos, setDragPos] = useState(null); // { guid, px, py }
  const dragPosRef = useRef(null);
  const DRAG_THRESHOLD = 5; // px - minimum distance before drag activates

  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { zoneRef.current  = zone;  }, [zone]);

  // ── Load WorldMapArea.dbc ──────────────────────────────────────────────────
  useEffect(() => {
    if (!dbcPath) return;
    window.azeroth.worldmap.readWorldMapAreas(dbcPath).then(res => {
      if (res.success) setWorldAreas(res.areas);
      else setAreasError(res.error);
    });
  }, [dbcPath]);

  // ── Load background image ─────────────────────────────────────────────────
  useEffect(() => {
    const folder = zone ? zone.internalName : continent.folder;
    const base   = zone ? zone.internalName : continent.base;
    setImgLoading(true);
    setBgImage(null);
    window.azeroth.worldmap.getZoneImage(folder, base).then(res => {
      if (res.success) setBgImage(res.data);
      setImgLoading(false);
    });
    setPan({ x: 0, y: 0 });
    setScale(1);
    setSelected(null);
    setDragPos(null);
    dragRef.current = null;
  }, [continent, zone]);

  // ── Load spawns when zone changes ─────────────────────────────────────────
  useEffect(() => {
    if (!zone) { setCreatures([]); setGameobjects([]); setWaypoints([]); return; }
    setSpawnLoading(true);
    Promise.all([
      query(
        `SELECT c.guid, c.id1 AS entry, c.position_x AS wx, c.position_y AS wy,
                c.position_z AS wz, c.orientation, c.MovementType,
                ct.name, ct.minlevel, ct.maxlevel, ct.faction, ct.rank,
                ct.DamageModifier, ct.AIName, ct.ScriptName
         FROM creature c
         JOIN creature_template ct ON ct.entry = c.id1
         WHERE c.map = ? LIMIT 5000`,
        [zone.mapId]
      ),
      query(
        `SELECT g.guid, g.id AS entry, g.position_x AS wx, g.position_y AS wy,
                g.position_z AS wz, g.orientation, gt.name
         FROM gameobject g
         JOIN gameobject_template gt ON gt.entry = g.id
         WHERE g.map = ? LIMIT 5000`,
        [zone.mapId]
      ),
    ]).then(([c, g]) => {
      setCreatures(c?.data || []);
      setGameobjects(g?.data || []);
      setSpawnLoading(false);
    });
  }, [zone]);

  // ── Load waypoints for selected creature ──────────────────────────────────
  useEffect(() => {
    if (!selected || selected.type !== 'creature' || selected.spawn.MovementType !== 2) {
      setWaypoints([]);
      return;
    }
    query(
      `SELECT point, position_x AS wx, position_y AS wy, position_z AS wz, delay, move_type
       FROM waypoint_data WHERE id = ? ORDER BY point`,
      [selected.spawn.guid]
    ).then(res => setWaypoints(res?.data || []));
  }, [selected]);

  // ── Global mouse handlers ─────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      const p = panRef.current;
      if (p.active) {
        setPan({ x: p.px + e.clientX - p.sx, y: p.py + e.clientY - p.sy });
      }
      if (dragRef.current) {
        // Abort drag if left mouse button is released
        if (!(e.buttons & 1)) {
          dragRef.current = null;
          dragPosRef.current = null;
          setDragPos(null);
          return;
        }

        const { startX, startY, origPx, origPy, guid, active } = dragRef.current;
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (!active && distance >= DRAG_THRESHOLD) {
          dragRef.current.active = true;
        }

        if (active) {
          const curPx = origPx + (e.clientX - startX) / scaleRef.current;
          const curPy = origPy + (e.clientY - startY) / scaleRef.current;
          const pos = { guid, px: curPx, py: curPy };
          dragPosRef.current = pos;
          setDragPos({ ...pos });
        }
      }
    };

    const onUp = async () => {
      panRef.current.active = false;
      if (dragRef.current && dragPosRef.current) {
        const { guid, type } = dragRef.current;
        const { px, py }     = dragPosRef.current;
        const area = zoneRef.current;
        if (area) {
          const { wx, wy } = zonePxToWorld(px, py, area);
          try {
            if (type === 'creature') {
              const res = await query('UPDATE creature SET position_x=?, position_y=? WHERE guid=?', [wx, wy, guid]);
              if (res.success) {
                setCreatures(prev => prev.map(c => c.guid === guid ? { ...c, wx, wy } : c));
              } else {
                console.error('Failed to update creature position:', res.error);
              }
            } else {
              const res = await query('UPDATE gameobject SET position_x=?, position_y=? WHERE guid=?', [wx, wy, guid]);
              if (res.success) {
                setGameobjects(prev => prev.map(g => g.guid === guid ? { ...g, wx, wy } : g));
              } else {
                console.error('Failed to update gameobject position:', res.error);
              }
            }
          } catch (err) {
            console.error('Error updating spawn position:', err);
          }
        }
        dragRef.current    = null;
        dragPosRef.current = null;
        setDragPos(null);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, [query]);

  const onViewMouseDown = useCallback((e) => {
    if (e.button !== 0 || e.target.closest('.spawn-marker,.wp-node-group')) return;
    panRef.current = { active: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    e.preventDefault();
  }, [pan]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const vp = viewRef.current?.getBoundingClientRect();
    if (!vp) return;
    const cx    = e.clientX - vp.left;
    const cy    = e.clientY - vp.top;
    const delta = e.deltaY > 0 ? 0.85 : 1.15;
    const ns    = Math.min(10, Math.max(0.1, scaleRef.current * delta));
    const ratio = ns / scaleRef.current;
    setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }));
    setScale(ns);
  }, []);

  // ── Wheel listener (passive: false for preventDefault) ───────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.addEventListener('wheel', onWheel, { passive: false });
    return () => view.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const startDrag = useCallback((e, spawn, type) => {
    if (!zoneRef.current) return;
    e.stopPropagation();
    const { px, py } = worldToZonePx(spawn.wx, spawn.wy, zoneRef.current);
    dragRef.current    = { guid: spawn.guid, type, startX: e.clientX, startY: e.clientY, origPx: px, origPy: py, active: false };
    dragPosRef.current = null;
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────
  const zonesForContinent = worldAreas
    .filter(a => a.mapId === continent.mapId && a.areaId > 0 && a.internalName && a.locLeft !== a.locRight)
    .sort((a, b) => a.internalName.localeCompare(b.internalName));

  // ── Render helpers ────────────────────────────────────────────────────────
  function spawnPx(spawn) {
    if (!zone) return { px: -9999, py: -9999 };
    if (dragPos?.guid === spawn.guid) return { px: dragPos.px, py: dragPos.py };
    return worldToZonePx(spawn.wx, spawn.wy, zone);
  }

  function inBounds({ px, py }) {
    return px > -20 && px < IMG_W + 20 && py > -20 && py < IMG_H + 20;
  }

  const isSel = (spawn) => selected?.spawn?.guid === spawn.guid;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="spawn-map-page">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="spawn-map-toolbar">
        <select className="map-select" value={continent.mapId}
          onChange={e => {
            setContinent(CONTINENTS.find(c => c.mapId === +e.target.value));
            setZone(null);
          }}>
          {CONTINENTS.map(c => <option key={c.mapId} value={c.mapId}>{c.name}</option>)}
        </select>

        <select className="map-select" value={zone?.id ?? ''}
          onChange={e => setZone(e.target.value ? worldAreas.find(a => a.id === +e.target.value) : null)}>
          <option value="">— Continent overzicht —</option>
          {zonesForContinent.map(a => (
            <option key={a.id} value={a.id}>{a.internalName}</option>
          ))}
        </select>

        {zone && <>
          <button className={`spawn-toggle ${showCreatures ? 'active' : ''}`}
            onClick={() => setShowCreatures(v => !v)}>
            <span className="spawn-dot creature" /> Creatures
          </button>
          <button className={`spawn-toggle ${showGOs ? 'active' : ''}`}
            onClick={() => setShowGOs(v => !v)}>
            <span className="spawn-dot gameobject" /> Objects
          </button>
        </>}

        {(imgLoading || spawnLoading) && (
          <span className="spawn-loading">
            <Loader size={12} className="spin" />
            {spawnLoading ? 'Spawns laden…' : 'Afbeelding laden…'}
          </span>
        )}
        {!zone && !imgLoading && (
          <span className="spawn-hint">Selecteer een zone om spawns te bekijken</span>
        )}
        {areasError && <span className="spawn-hint" style={{ color: 'var(--danger)' }}>DBC: {areasError}</span>}
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="spawn-map-body">
        <div className="map-viewport" ref={viewRef}
          onMouseDown={onViewMouseDown}>
          <div className="map-world"
            style={{
              transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})`,
              transformOrigin: '0 0',
              width: IMG_W,
              height: IMG_H,
            }}>
            {bgImage && (
              <img src={bgImage} width={IMG_W} height={IMG_H}
                style={{ display: 'block', imageRendering: 'pixelated' }}
                draggable={false} />
            )}
            {!bgImage && !imgLoading && (
              <div className="map-no-image">Geen afbeelding gevonden</div>
            )}

            {zone && (
              <svg className="map-svg" width={IMG_W} height={IMG_H}>
                {/* Gameobject markers */}
                {showGOs && gameobjects.map(go => {
                  const pos = spawnPx(go);
                  if (!inBounds(pos)) return null;
                  return (
                    <rect key={`go-${go.guid}`}
                      x={pos.px - 3} y={pos.py - 3} width={6} height={6}
                      className={`spawn-go spawn-marker${isSel(go) ? ' sel' : ''}`}
                      onClick={() => setSelected({ type: 'go', spawn: go })}
                      onMouseDown={e => startDrag(e, go, 'go')}
                    />
                  );
                })}

                {/* Creature markers */}
                {showCreatures && creatures.map(c => {
                  const pos = spawnPx(c);
                  if (!inBounds(pos)) return null;
                  return (
                    <circle key={`c-${c.guid}`}
                      cx={pos.px} cy={pos.py} r={4}
                      className={`spawn-creature spawn-marker${isSel(c) ? ' sel' : ''}`}
                      onClick={() => setSelected({ type: 'creature', spawn: c })}
                      onMouseDown={e => startDrag(e, c, 'creature')}
                    />
                  );
                })}

                {/* Waypoints */}
                {waypoints.length > 1 && waypoints.map((wp, i) => {
                  const next = waypoints[(i + 1) % waypoints.length];
                  const a    = worldToZonePx(wp.wx,   wp.wy,   zone);
                  const b    = worldToZonePx(next.wx, next.wy, zone);
                  return (
                    <line key={`wpl-${i}`}
                      x1={a.px} y1={a.py} x2={b.px} y2={b.py}
                      className="wp-line" />
                  );
                })}
                {waypoints.map((wp, i) => {
                  const { px, py } = worldToZonePx(wp.wx, wp.wy, zone);
                  return (
                    <g key={`wpn-${i}`} className="wp-node-group">
                      <circle cx={px} cy={py} r={4} className="wp-node" />
                      <text x={px + 6} y={py + 4} className="wp-label">{wp.point}</text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>

        {/* ── Inspector ────────────────────────────────────────────────── */}
        {selected && (
          <div className="spawn-inspector">
            <div className="insp-header">
              <span className={`insp-badge ${selected.type === 'creature' ? 'creature' : 'go'}`}>
                {selected.type === 'creature' ? 'NPC' : 'GO'}
              </span>
              <span className="insp-name">{selected.spawn.name}</span>
              <button className="insp-close" onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="insp-body">
              <div className="insp-section">Spawn</div>
              <div className="insp-row">
                <span className="insp-key">GUID</span>
                <span className="insp-val">{selected.spawn.guid}</span>
              </div>
              <div className="insp-row">
                <span className="insp-key">Entry</span>
                <span className="insp-val">{selected.spawn.entry}</span>
              </div>
              <div className="insp-row">
                <span className="insp-key">X (N/S)</span>
                <span className="insp-val">{selected.spawn.wx?.toFixed(2)}</span>
              </div>
              <div className="insp-row">
                <span className="insp-key">Y (E/W)</span>
                <span className="insp-val">{selected.spawn.wy?.toFixed(2)}</span>
              </div>
              <div className="insp-row">
                <span className="insp-key">Z</span>
                <span className="insp-val">{selected.spawn.wz?.toFixed(2)}</span>
              </div>

              {selected.type === 'creature' && <>
                <div className="insp-section">Template</div>
                <div className="insp-row">
                  <span className="insp-key">Level</span>
                  <span className="insp-val">{selected.spawn.minlevel}–{selected.spawn.maxlevel}</span>
                </div>
                <div className="insp-row">
                  <span className="insp-key">Faction</span>
                  <span className="insp-val">{selected.spawn.faction}</span>
                </div>
                <div className="insp-row">
                  <span className="insp-key">Rank</span>
                  <span className="insp-val">{RANK_NAMES[selected.spawn.rank] ?? selected.spawn.rank}</span>
                </div>
                <div className="insp-row">
                  <span className="insp-key">Dmg mod</span>
                  <span className="insp-val">{selected.spawn.DamageModifier?.toFixed(2)}</span>
                </div>
                <div className="insp-row">
                  <span className="insp-key">Beweging</span>
                  <span className="insp-val">{MOVE_NAMES[selected.spawn.MovementType] ?? selected.spawn.MovementType}</span>
                </div>
                <div className="insp-row">
                  <span className="insp-key">AI</span>
                  <span className="insp-val">{selected.spawn.AIName || '—'}</span>
                </div>
                <div className="insp-row">
                  <span className="insp-key">Script</span>
                  <span className="insp-val">{selected.spawn.ScriptName || '—'}</span>
                </div>
                {waypoints.length > 0 && <>
                  <div className="insp-section">Waypoints ({waypoints.length})</div>
                  {waypoints.map(wp => (
                    <div key={wp.point} className="insp-row">
                      <span className="insp-key">#{wp.point}</span>
                      <span className="insp-val">{wp.wx?.toFixed(0)}, {wp.wy?.toFixed(0)}</span>
                    </div>
                  ))}
                </>}
              </>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
