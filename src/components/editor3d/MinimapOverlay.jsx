import { useEffect, useRef, useState } from 'react';
import { useConnection } from '../../lib/ConnectionContext';

const IMG_W = 2048, IMG_H = 1536;
const MM_W = 200, MM_H = 150;
const ZOOM_MIN = 1, ZOOM_MAX = 16;
const CAL_KEY = 'azeroth-minimap-offset';

const CONTINENT_MAP = {
  0:   { folder: 'Azeroth',      base: 'Azeroth' },
  1:   { folder: 'Kalimdor',     base: 'Kalimdor' },
  530: { folder: 'Expansion01',  base: 'Expansion01' },
  571: { folder: 'Northrend',    base: 'Northrend' },
};

function loadOffset(mapId) {
  try {
    const raw = JSON.parse(localStorage.getItem(CAL_KEY)) || {};
    return { dx: raw[mapId]?.dx ?? 0, dy: raw[mapId]?.dy ?? 0 };
  } catch { return { dx: 0, dy: 0 }; }
}

function saveOffset(mapId, dx, dy) {
  try {
    const raw = JSON.parse(localStorage.getItem(CAL_KEY)) || {};
    raw[mapId] = { dx, dy };
    localStorage.setItem(CAL_KEY, JSON.stringify(raw));
  } catch {}
}

function worldToImgPx(wx, wy, area, dx, dy) {
  const px = (area.locLeft - wy) / (area.locLeft - area.locRight) * IMG_W + dx;
  const py = (area.locTop  - wx) / (area.locTop  - area.locBottom) * IMG_H + dy;
  return { px, py };
}

export default function MinimapOverlay({ mapId, camPosRef }) {
  const { dbcPath, worldmapMpqPath } = useConnection();
  const canvasRef  = useRef(null);
  const dataRef    = useRef({ img: null, area: null });
  const zoomRef    = useRef(1);
  const rafRef     = useRef(null);
  const lastKey    = useRef('');
  const offsetRef  = useRef(loadOffset(mapId));

  const [hovering,  setHovering]  = useState(false);
  const [calOpen,   setCalOpen]   = useState(false);
  const [offset,    setOffset]    = useState(() => loadOffset(mapId));

  // Herlaad offset als mapId wisselt
  useEffect(() => {
    const o = loadOffset(mapId);
    offsetRef.current = o;
    setOffset(o);
    lastKey.current = '';
  }, [mapId]);

  // Sync offsetRef bij wijziging
  useEffect(() => {
    offsetRef.current = offset;
    lastKey.current = '';
  }, [offset]);

  const adjustOffset = (field, delta) => {
    setOffset(prev => {
      const next = { ...prev, [field]: prev[field] + delta };
      saveOffset(mapId, next.dx, next.dy);
      return next;
    });
  };

  const resetOffset = () => {
    setOffset({ dx: 0, dy: 0 });
    saveOffset(mapId, 0, 0);
  };

  // Laad afbeelding + gebiedsdata
  useEffect(() => {
    const cont = CONTINENT_MAP[mapId];
    if (!cont || !worldmapMpqPath) return;

    dataRef.current = { img: null, area: null };
    lastKey.current = '';
    let cancelled = false;

    Promise.all([
      window.azeroth.worldmap.getZoneImage(cont.folder, cont.base, worldmapMpqPath),
      dbcPath
        ? window.azeroth.worldmap.readWorldMapAreas(dbcPath)
        : Promise.resolve({ success: false }),
    ]).then(([imgRes, areasRes]) => {
      if (cancelled) return;

      let img = null;
      if (imgRes.success) { img = new Image(); img.src = imgRes.data; }

      let area = null;
      if (areasRes.success) {
        const all = areasRes.areas;
        const entry = all.find(a => a.mapId === mapId && a.areaId === 0);
        if (entry && entry.locLeft !== entry.locRight) {
          area = entry;
        } else {
          const zones = all.filter(a => a.mapId === mapId && a.areaId > 0 && a.locLeft !== a.locRight);
          if (zones.length) {
            area = {
              locLeft:   Math.max(...zones.map(z => z.locLeft)),
              locRight:  Math.min(...zones.map(z => z.locRight)),
              locTop:    Math.max(...zones.map(z => z.locTop)),
              locBottom: Math.min(...zones.map(z => z.locBottom)),
            };
          }
        }
      }

      dataRef.current = { img, area };
      lastKey.current = '';
    });

    return () => { cancelled = true; };
  }, [mapId, dbcPath, worldmapMpqPath]);

  // Scroll = zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -1 : 1;
      zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current + delta));
      lastKey.current = '';
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // RAF draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw() {
      rafRef.current = requestAnimationFrame(draw);

      const { img, area } = dataRef.current;
      const pos  = camPosRef?.current;
      const zoom = zoomRef.current;
      const { dx, dy } = offsetRef.current;
      const posKey = pos ? `${pos.wx.toFixed(1)},${pos.wy.toFixed(1)}` : '';
      const key = posKey + (img?.complete ? '1' : '0') + zoom + dx + dy;
      if (key === lastKey.current) return;
      lastKey.current = key;

      ctx.clearRect(0, 0, MM_W, MM_H);
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, MM_W, MM_H);

      if (img?.complete && area) {
        const { px: camPx, py: camPy } = pos
          ? worldToImgPx(pos.wx, pos.wy, area, dx, dy)
          : { px: IMG_W / 2, py: IMG_H / 2 };

        const srcW = IMG_W / zoom;
        const srcH = IMG_H / zoom;
        let srcX = camPx - srcW / 2;
        let srcY = camPy - srcH / 2;
        srcX = Math.max(0, Math.min(IMG_W - srcW, srcX));
        srcY = Math.max(0, Math.min(IMG_H - srcH, srcY));

        ctx.drawImage(img, srcX * 0.5, srcY * 0.5, srcW * 0.5, srcH * 0.5, 0, 0, MM_W, MM_H);

        if (pos) {
          const dotX = (camPx - srcX) / srcW * MM_W;
          const dotY = (camPy - srcY) / srcH * MM_H;
          ctx.beginPath();
          ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#ff2222';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else if (img?.complete) {
        ctx.drawImage(img, 0, 0, MM_W, MM_H);
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [camPosRef]);

  if (!worldmapMpqPath) return null;

  return (
    <div
      className="ed3-minimap-wrap"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <canvas
        ref={canvasRef}
        width={MM_W}
        height={MM_H}
        className="ed3-minimap"
        title="Scroll om in/uit te zoomen"
      />

      {hovering && (
        <button
          className="ed3-minimap-cal-btn"
          onClick={() => setCalOpen(v => !v)}
          title="Offset aanpassen"
        >⊞</button>
      )}

      {calOpen && (
        <div className="ed3-minimap-cal">
          <div className="ed3-minimap-cal-row">
            <span>X</span>
            <button onClick={() => adjustOffset('dx', -10)}>−</button>
            <span className="ed3-minimap-cal-val">{offset.dx}</span>
            <button onClick={() => adjustOffset('dx', +10)}>+</button>
          </div>
          <div className="ed3-minimap-cal-row">
            <span>Y</span>
            <button onClick={() => adjustOffset('dy', -10)}>−</button>
            <span className="ed3-minimap-cal-val">{offset.dy}</span>
            <button onClick={() => adjustOffset('dy', +10)}>+</button>
          </div>
          <button className="ed3-minimap-cal-reset" onClick={resetOffset}>reset</button>
          <button className="ed3-minimap-cal-reset" onClick={() => setCalOpen(false)}>sluiten</button>
        </div>
      )}
    </div>
  );
}
