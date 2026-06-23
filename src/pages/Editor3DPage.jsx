import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import Editor3DErrorBoundary from '../components/editor3d/Editor3DErrorBoundary';
import Editor3DScene from '../components/editor3d/Editor3DScene';
import Editor3DToolbar from '../components/editor3d/Editor3DToolbar';
import Editor3DHierarchy from '../components/editor3d/Editor3DHierarchy';
import Editor3DInspector from '../components/editor3d/Editor3DInspector';
import MinimapOverlay from '../components/editor3d/MinimapOverlay';
import './Editor3DPage.css';
import { cameraInput } from '../components/editor3d/cameraInputState';
import { wowToThree, threeToWow } from '../components/editor3d/wowCoords';
import { setTerrainData } from '../components/editor3d/spawnLod';

const TILE_SIZE = 533.33333;
const MAP_HALF  = 32 * TILE_SIZE;
const ENABLE_MINIMAP_FALLBACK = false;

const MAP_ADT_NAME = {
  0:   'Azeroth',
  1:   'Kalimdor',
  530: 'Expansion01',
  571: 'Northrend',
};

function worldToTile(x, y) {
  return {
    tileX: Math.floor((MAP_HALF - x) / TILE_SIZE),
    tileY: Math.floor((MAP_HALF - y) / TILE_SIZE),
  };
}

// Three.js → WoW coördinaten (inverse van wowToThree in Editor3DSpawn)
// wowToThree: [y, z, -x]  →  Three(x,y,z) = WoW(y, z, -x)
// inverse:    WoW(x,y,z)  = Three(y, z, -x) → wow_x=-t.z, wow_y=t.x, wow_z=t.y
function spawnThreePosition(spawn, transform) {
  if (transform?.pos) return [transform.pos.x, transform.pos.y, transform.pos.z];
  return wowToThree(spawn.x, spawn.y, spawn.z);
}

export default function Editor3DPage() {
  const { query, soapCommand, soapConfig, mapsPath } = useConnection();
  const [activeTool, setActiveTool] = useState('select');
  const [selectedId, setSelectedId] = useState(null);
  const [spawns,     setSpawns]     = useState([]);
  const [transforms, setTransforms] = useState({});
  const [dirtyGuids, setDirtyGuids] = useState(new Set());
  const [resetKeys,  setResetKeys]  = useState({});
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState(null);
  const [mapId,         setMapId]         = useState(1);
  const [spawnsVisible, setSpawnsVisible] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [terrain,    setTerrain]    = useState(null);
  const [tileTextures, setTileTextures] = useState({});
  const [texturesEnabled, setTexturesEnabled] = useState(true); // debug toggle: 't' = texture aan/uit (isoleert geometry/lighting van texture-bugs)

  const [error,      setError]      = useState(null);
  const [focusTick,  setFocusTick]  = useState(0);
  const [streamKey,  setStreamKey]  = useState(0);
  const [worldLoading, setWorldLoading] = useState(true);
  const worldLoadTimeoutRef = useRef(null);
  const camPosRef = useRef({ wx: 0, wy: 0 });
  const invalidateRef = useRef(null);
  const [debugInfo, setDebugInfo] = useState({ batchMs: 0, tilesLoaded: 0, texLoaded: 0, inFlight: false });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSpawns([]);
      setTerrain(null);
      setTileTextures({});
      setSelectedId(null);
      setTransforms({});

      try {
        const res = await window.azeroth.spawns.load({ mapId, limit: 1000 });
        if (cancelled) return;
        if (!res.success) { setError(res.error ?? 'Kan spawns niet laden'); return; }
        setSpawns(res.data);

        if (res.data.length && camPosRef.current.wx === 0 && camPosRef.current.wy === 0) {
          const n = res.data.length;
          const wx = res.data.reduce((s, sp) => s + sp.x, 0) / n;
          const wy = res.data.reduce((s, sp) => s + sp.y, 0) / n;
          camPosRef.current = { wx, wy };
          invalidateRef.current?.();
          // Debug: log eerste 5 spawns met hun hoogte
          const sample = res.data.slice(0, 5);
          console.log('[spawns] hoogte sample (WoW Z = Three.js Y):',
            sample.map(s => `${s.name ?? s.guid} z=${s.z?.toFixed(1)}`).join(', '));
          console.log('[spawns] centroid:', { wx: wx.toFixed(1), wy: wy.toFixed(1) });
        }

        // Terrein wordt gestreamd rond de camera (zie streaming-effect hieronder)
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [mapId]);

  // ── World loading overlay ────────────────────────────────────────────────────
  useEffect(() => {
    setWorldLoading(true);
    clearTimeout(worldLoadTimeoutRef.current);
    worldLoadTimeoutRef.current = setTimeout(() => setWorldLoading(false), 4000);
    return () => clearTimeout(worldLoadTimeoutRef.current);
  }, [mapId]);

  // Clear overlay wanneer eerste terrain batch klaar is
  const terrainReady = !!(terrain?.length);
  useEffect(() => {
    if (terrainReady) {
      clearTimeout(worldLoadTimeoutRef.current);
      setWorldLoading(false);
    }
  }, [terrainReady]);

  // Sync terrain tiles naar spawnLod module voor height snapping
  useEffect(() => { setTerrainData(terrain); }, [terrain]);

  // ── Terrain streaming: laad tiles rond de camera, evict wat ver weg is ──────
  const TILE_RADIUS = 4;   // 9×9 blok rond camera
  const MAX_TILES   = 200;
  const BATCH_MAX   = 16;  // max tiles per IPC zodat main process responsief blijft

  useEffect(() => {
    const mapName = MAP_ADT_NAME[mapId];
    if (!mapName) return;

    let disposed = false;
    let terrainInFlight = false;
    let textureInFlight = false;
    const loaded   = new Set();
    const missing  = new Set();
    const texQueue = []; // tiles die terrain hebben maar nog geen texture

    async function tickTerrain() {
      if (disposed || terrainInFlight) return;
      const { wx, wy } = camPosRef.current;
      if (wx === 0 && wy === 0) return;

      const { tileX: cX, tileY: cY } = worldToTile(wx, wy);
      const want = [];
      for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy++) {
        for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
          const tx = cX + dx, ty = cY + dy;
          if (tx < 0 || tx >= 64 || ty < 0 || ty >= 64) continue;
          const key = `${tx}_${ty}`;
          if (loaded.has(key) || missing.has(key)) continue;
          want.push({ tileX: tx, tileY: ty, d: Math.abs(dx) + Math.abs(dy) });
        }
      }
      if (!want.length) return;

      want.sort((a, b) => a.d - b.d);
      const batch = want.slice(0, BATCH_MAX).map(({ tileX, tileY }) => ({ tileX, tileY }));
      batch.forEach(t => loaded.add(`${t.tileX}_${t.tileY}`));

      terrainInFlight = true;
      setDebugInfo(p => ({ ...p, inFlight: true }));
      const t0 = performance.now();
      try {
        const tr = await window.azeroth.adt.getTerrain({ mapName, tiles: batch });
        if (disposed) return;
        if (!tr.success) { batch.forEach(t => loaded.delete(`${t.tileX}_${t.tileY}`)); return; }

        const got = new Set(tr.data.map(t => `${t.tileX}_${t.tileY}`));
        batch.forEach(t => {
          const key = `${t.tileX}_${t.tileY}`;
          if (!got.has(key)) { missing.add(key); loaded.delete(key); }
        });
        if (!tr.data.length) return;

        const evicted = [];
        const { tileX: curX, tileY: curY } = worldToTile(camPosRef.current.wx, camPosRef.current.wy);
        setTerrain(prev => {
          const merged = [...(prev ?? []), ...tr.data];
          if (merged.length > MAX_TILES) {
            merged.sort((a, b) =>
              (Math.abs(a.tileX - curX) + Math.abs(a.tileY - curY)) -
              (Math.abs(b.tileX - curX) + Math.abs(b.tileY - curY)));
            for (const t of merged.splice(MAX_TILES)) {
              const key = `${t.tileX}_${t.tileY}`;
              loaded.delete(key);
              evicted.push(key);
            }
          }
          return merged;
        });

        const tileBatch = tr.data.map(({ tileX, tileY }) => ({ tileX, tileY }));

        // Minimap tiles look plausible but hide failed splat textures. During
        // validation, failed tiles deliberately keep their height coloring.
        if (ENABLE_MINIMAP_FALLBACK) {
          window.azeroth.adt.getTileTextures({ mapName, tiles: tileBatch }).then(tex => {
            if (disposed || !tex.success) return;
            setTileTextures(prev => {
              const next = { ...prev };
              for (const key of evicted) delete next[key];
              for (const { tileX, tileY, png } of tex.data) {
                const key = `${tileX}_${tileY}`;
                if (!next[key] || typeof next[key] === 'string') next[key] = png;
              }
              return next;
            });
            invalidateRef.current?.();
          });
        }

        // Voeg toe aan texture queue (in batches van TEX_BATCH verwerkt door tickTexture)
        for (const { tileX, tileY } of tileBatch) texQueue.push({ tileX, tileY, evicted });
        setDebugInfo(p => ({ ...p, tilesLoaded: p.tilesLoaded + tileBatch.length }));
        console.log(`[terrain] batch ${tileBatch.length} tiles in ${(performance.now()-t0).toFixed(0)}ms`);
      } finally {
        terrainInFlight = false;
        setDebugInfo(p => ({ ...p, inFlight: textureInFlight }));
      }
    }

    async function tickTexture() {
      if (disposed || textureInFlight || !texQueue.length) return;
      const TEX_BATCH = 4; // klein houden: compositing blokkeert main process
      const items = texQueue.splice(0, TEX_BATCH);
      const tileBatch = items.map(({ tileX, tileY }) => ({ tileX, tileY }));

      textureInFlight = true;
      setDebugInfo(p => ({ ...p, inFlight: true }));
      const t0 = performance.now();
      try {
        const tex = await window.azeroth.adt.getTextureLayers({ mapName, tiles: tileBatch });
        const elapsed = performance.now() - t0;
        console.log(`[texture] ${tileBatch.length} tiles palette geladen in ${elapsed.toFixed(0)}ms`);
        if (!disposed && tex.success && tex.data.length) {
          setTileTextures(prev => {
            const next = { ...prev };
            for (const { tileX, tileY, paletteRgba, paletteW, paletteH, paletteCount, chunkTexIndices, chunkAlpha } of tex.data) {
              next[`${tileX}_${tileY}`] = { paletteRgba, paletteW, paletteH, paletteCount, chunkTexIndices, chunkAlpha };
            }
            return next;
          });
          invalidateRef.current?.();
          setDebugInfo(p => ({ ...p, texLoaded: p.texLoaded + tex.data.length, batchMs: Math.round(elapsed) }));
        }
      } finally {
        textureInFlight = false;
        setDebugInfo(p => ({ ...p, inFlight: terrainInFlight }));
      }
    }

    const id = setInterval(() => { tickTerrain(); tickTexture(); }, 600);
    return () => { disposed = true; clearInterval(id); };
  }, [mapId, streamKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setTerrain(null);
    setTileTextures({});
    setStreamKey(k => k + 1);
  }, [mapsPath]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (cameraInput.flyActive && 'wasdeq'.includes(key)) return;
      if (key === 'q') setActiveTool('select');
      if (key === 'w') setActiveTool('move');
      if (key === 'e') setActiveTool('rotate');
      if (key === 'f' && selectedId) {
        e.preventDefault();
        setFocusTick(t => t + 1);
      }
      if (e.key === 'Escape') setSelectedId(null);
      if (key === 't' && !e.ctrlKey && !e.metaKey) {
        setTexturesEnabled(v => { console.log(`[debug] textures ${!v ? 'AAN' : 'UIT'}`); return !v; });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const handleSelect    = useCallback((guid) => setSelectedId(guid), []);
  const handleAddSpawn  = useCallback((spawn) => {
    setSpawns(prev => prev.some(s => s.guid === spawn.guid) ? prev : [...prev, spawn]);
  }, []);
  const handleTransform = useCallback((guid, pos, rot) => {
    setTransforms(prev => ({ ...prev, [guid]: { pos, rot } }));
    setDirtyGuids(prev => { const s = new Set(prev); s.add(guid); return s; });
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!dirtyGuids.size) return;
    setSaving(true);
    setSaveError(null);
    const toSave = spawns.filter(s => dirtyGuids.has(s.guid));
    for (const spawn of toSave) {
      const t = transforms[spawn.guid];
      if (!t?.pos) continue;
      const wow = threeToWow(t.pos.x, t.pos.y, t.pos.z);
      // orientatie: Three.js Y-as rotatie = WoW orientation (rotatie om verticale as)
      const orientation = t.rot?.y ?? spawn.orientation ?? 0;
      const res = await window.azeroth.spawns.update({
        guid: spawn.guid,
        type: spawn.type ?? 'creature',
        x: wow.x, y: wow.y, z: wow.z,
        orientation,
      });
      if (!res.success) {
        setSaveError(`Fout bij ${spawn.guid}: ${res.error}`);
        setSaving(false);
        return;
      }
      // Originele DB-waarden bijwerken zodat undo correct werkt na save
      setSpawns(prev => prev.map(s =>
        s.guid === spawn.guid
          ? { ...s, x: wow.x, y: wow.y, z: wow.z, orientation }
          : s
      ));
    }
    setDirtyGuids(new Set());
    setSaving(false);
  }, [dirtyGuids, spawns, transforms]);

  const handleUndo = useCallback(() => {
    // Verwijder dirty transforms en force remount van de betrokken spawns
    setTransforms(prev => {
      const next = { ...prev };
      dirtyGuids.forEach(guid => delete next[guid]);
      return next;
    });
    setResetKeys(prev => {
      const next = { ...prev };
      dirtyGuids.forEach(guid => { next[guid] = (prev[guid] ?? 0) + 1; });
      return next;
    });
    setDirtyGuids(new Set());
    setSaveError(null);
  }, [dirtyGuids]);

  const handleTeleport = useCallback(async (command) => {
    const direct = await soapCommand(command);
    const isGoFault = !direct.success && String(direct.error ?? '').includes('.gobject');
    if (!isGoFault) return direct;

    const playerName = soapConfig.characterName?.trim();
    if (!playerName) {
      return {
        success: false,
        error: `${direct.error}\n\nSOAP .go werkt zonder speler-context niet. Vul Settings -> GM Character Name in voor teleport fallback.`,
      };
    }

    const match = String(command).match(/^\.?go\s+xyz\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+)/i);
    if (!match) return direct;

    const [, x, y, z, map] = match;
    const teleName = `azeroth_editor_${Date.now()}`;
    const orientation = 0;

    const idResult = await query('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM game_tele');
    if (!idResult.success) return { success: false, error: `Kon tijdelijke teleport ID niet bepalen: ${idResult.error}` };
    const teleId = idResult.data?.[0]?.id;
    if (!teleId) return { success: false, error: 'Kon tijdelijke teleport ID niet bepalen' };

    const del = await query('DELETE FROM game_tele WHERE name = ?', [teleName]);
    if (!del.success) return { success: false, error: `Kon tijdelijke teleport niet voorbereiden: ${del.error}` };

    const ins = await query(
      'INSERT INTO game_tele (id, position_x, position_y, position_z, orientation, map, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [teleId, Number(x), Number(y), Number(z), orientation, Number(map), teleName]
    );
    if (!ins.success) return { success: false, error: `Kon tijdelijke teleport niet opslaan: ${ins.error}` };

    await soapCommand('.reload game_tele');
    const escapedPlayer = playerName.replace(/"/g, '');
    let fallback = await soapCommand(`.tele name ${escapedPlayer} ${teleName}`);
    if (!fallback.success) {
      fallback = await soapCommand(`tele name ${escapedPlayer} ${teleName}`);
    }
    if (!fallback.success) {
      fallback = await soapCommand(`.teleport name ${escapedPlayer} ${teleName}`);
    }
    if (!fallback.success) {
      fallback = await soapCommand(`teleport name ${escapedPlayer} ${teleName}`);
    }

    await query('DELETE FROM game_tele WHERE id = ?', [teleId]);
    await soapCommand('.reload game_tele');

    return fallback.success ? { ...fallback, result: fallback.result || `Teleported ${escapedPlayer}` } : fallback;
  }, [query, soapCommand, soapConfig.characterName]);

  const selectedSpawn = useMemo(
    () => spawns.find(s => s.guid === selectedId) ?? null,
    [spawns, selectedId]
  );

  const focusTarget = useMemo(() => {
    if (!selectedSpawn) return null;
    return spawnThreePosition(selectedSpawn, transforms[selectedId]);
  }, [selectedSpawn, selectedId, transforms]);

  // Centroïd in Three.js ruimte (WoW → Three.js: [y, z, -x])
  const spawnCenter = useMemo(() => {
    if (!spawns.length) return null;
    let sx = 0, sy = 0, sz = 0;
    for (const s of spawns) { sx += -s.y; sy += s.z; sz += -s.x; }
    return [sx / spawns.length, sy / spawns.length, sz / spawns.length];
  }, [spawns]);

  return (
    <div className="ed3-root">
      <Editor3DToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        mapId={mapId}
        onMapChange={setMapId}
        loading={loading}
        spawnCount={loading ? null : spawns.length}
        spawnsVisible={spawnsVisible}
        onToggleSpawns={() => setSpawnsVisible(v => !v)}
      />

      {error && <div className="ed3-error-bar">Fout: {error}</div>}
      <div style={{position:'absolute',top:40,right:8,zIndex:999,background:'rgba(0,0,0,.65)',color:'#9f9',fontFamily:'monospace',fontSize:11,padding:'4px 8px',borderRadius:4,pointerEvents:'none',lineHeight:1.6}}>
        tiles: {debugInfo.tilesLoaded} | tex: {debugInfo.texLoaded} | last: {debugInfo.batchMs}ms{debugInfo.inFlight ? ' ⏳' : ''}
      </div>

      <div className="ed3-workspace">
        <Editor3DHierarchy
          spawns={spawns}
          selectedId={selectedId}
          onSelect={handleSelect}
          onAddSpawn={handleAddSpawn}
          mapId={mapId}
        />

        <div className="ed3-viewport">
          {worldLoading && (
            <div className="ed3-world-overlay">
              <span className="ed3-world-overlay-text">Wereld laden…</span>
            </div>
          )}
          <Editor3DErrorBoundary>
            <Editor3DScene
              spawns={spawnsVisible ? spawns : []}
              selectedId={selectedId}
              onSelect={handleSelect}
              activeTool={activeTool}
              onTransform={handleTransform}
              terrain={terrain}
              tileTextures={texturesEnabled ? tileTextures : {}}
              wdl={null}
              initialTarget={spawnCenter}
              resetKeys={resetKeys}
              focusTarget={focusTarget}
              focusTick={focusTick}
              transforms={transforms}
              camPosRef={camPosRef}
              invalidateRef={invalidateRef}
            />
          </Editor3DErrorBoundary>
          <MinimapOverlay mapId={mapId} camPosRef={camPosRef} />
        </div>

        <Editor3DInspector
          spawn={selectedSpawn}
          transform={selectedId ? transforms[selectedId] ?? null : null}
          dirty={selectedId ? dirtyGuids.has(selectedId) : false}
          onSave={handleSave}
          saving={saving}
          mapId={mapId}
          onTeleport={handleTeleport}
        />
      </div>

      {dirtyGuids.size > 0 && (
        <div className="ed3-save-bar">
          <span className="ed3-save-bar-msg">
            {dirtyGuids.size} spawn{dirtyGuids.size > 1 ? 's' : ''} niet opgeslagen
          </span>
          {saveError && <span className="ed3-save-bar-error">{saveError}</span>}
          <button className="ed3-save-bar-btn undo" onClick={handleUndo} disabled={saving}>
            Ongedaan maken
          </button>
          <button className="ed3-save-bar-btn save" onClick={handleSave} disabled={saving}>
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
         </div>
      )}
    </div>
  );
}
