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
const INITIAL_WORLD_READY_TILES = 9;
const STATIC_WORLD_MODE = true;
const VIEW_DISTANCE = 1536;
const TERRAIN_RADIUS = 2;
const TEXTURE_RADIUS = 2;
const TEXTURE_INITIAL_RADIUS = 1;
const WMO_RADIUS = 1;
const M2_RADIUS = 1;
const WATER_RADIUS = 1;
const HARDWARE_THREADS = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
const AGGRESSIVE_STREAMING = HARDWARE_THREADS >= 8;
const TERRAIN_BATCH_MAX = AGGRESSIVE_STREAMING ? 16 : 12;
const TEXTURE_BATCH_MAX = AGGRESSIVE_STREAMING ? 4 : 3;
const WMO_BATCH_MAX = AGGRESSIVE_STREAMING ? 10 : 8;
const WATER_BATCH_MAX = AGGRESSIVE_STREAMING ? 6 : 4;
const TERRAIN_REQUEST_CONCURRENCY = AGGRESSIVE_STREAMING ? 2 : 1;
const TEXTURE_REQUEST_CONCURRENCY = AGGRESSIVE_STREAMING ? 2 : 1;
const WMO_REQUEST_CONCURRENCY = AGGRESSIVE_STREAMING ? 2 : 1;
const WATER_REQUEST_CONCURRENCY = AGGRESSIVE_STREAMING ? 2 : 1;
const TEXTURE_UPLOADS_PER_FRAME = AGGRESSIVE_STREAMING ? 4 : 2;
const STREAM_MOVE_DISTANCE = 96;
const DEFAULT_RESOURCE_PROFILE = Object.freeze({
  tier: 'conservative',
  memoryPressure: false,
  textureWorkers: 1,
  wmoWorkers: 1,
  assetIoConcurrency: 3,
  terrainBatchMax: 10,
  textureBatchMax: 2,
  wmoBatchMax: 6,
  waterBatchMax: 3,
  terrainRequestConcurrency: 1,
  textureRequestConcurrency: 1,
  wmoRequestConcurrency: 1,
  waterRequestConcurrency: 1,
  textureUploadsPerFrame: 2,
  wmoAssetConcurrency: 2,
  doodadConcurrency: 2,
  m2RequestConcurrency: 2,
  dprMax: 1,
});

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
  const [water,      setWater]      = useState([]);
  const [tileTextures, setTileTextures] = useState({});

  const [error,      setError]      = useState(null);
  const [focusTick,  setFocusTick]  = useState(0);
  const [streamKey,  setStreamKey]  = useState(0);
  const [worldLoading, setWorldLoading] = useState(true);
  const [nearbyTexturesReady, setNearbyTexturesReady] = useState(false);
  const [resourceProfile, setResourceProfile] = useState(null);
  const [wmoPlacements, setWmoPlacements] = useState([]);
  const [adtM2Placements, setAdtM2Placements] = useState([]);
  const [streamDiagnostics, setStreamDiagnostics] = useState({
    terrainTiles: 0,
    waterTiles: 0,
    wmoPlacements: 0,
    m2Placements: 0,
    pendingTerrain: 0,
    pendingTextures: 0,
    pendingWmo: 0,
    pendingWater: 0,
  });
  const [perfMetrics, setPerfMetrics] = useState({ terrain: null, textures: null, wmo: null });
  const [wmoAssetPending, setWmoAssetPending] = useState(0);
  const [m2AssetPending, setM2AssetPending] = useState(0);
  const [wmoBatchCount, setWmoBatchCount] = useState(0);
  const [m2BatchCount, setM2BatchCount] = useState(0);
  const [rendererStats, setRendererStats] = useState(null);
  const worldLoadTimeoutRef = useRef(null);
  const camPosRef = useRef({ wx: 0, wy: 0 });
  const invalidateRef = useRef(null);
  const perfSamplesRef = useRef({ terrain: [], textures: [], wmo: [] });
  const textureUploadQueueRef = useRef([]);
  const textureUploadFrameRef = useRef(null);
  const streamWindowRef = useRef({ texture: new Set() });
  const cameraMoveRef = useRef(null);
  const activeResourceProfile = resourceProfile || DEFAULT_RESOURCE_PROFILE;
  const resourceProfileRef = useRef(activeResourceProfile);
  resourceProfileRef.current = activeResourceProfile;
  const requestMinimapDraw = useCallback(() => cameraMoveRef.current?.(), []);
  const handleWmoPendingChange = useCallback((count) => setWmoAssetPending(count), []);
  const handleM2PendingChange = useCallback((count) => setM2AssetPending(count), []);
  const handleWmoBatchCount = useCallback((count) => setWmoBatchCount(count), []);
  const handleM2BatchCount = useCallback((count) => setM2BatchCount(count), []);

  useEffect(() => {
    let disposed = false;
    const refreshProfile = async () => {
      try {
        const next = await window.azeroth?.system?.getResourceProfile?.();
        if (!next || disposed) return;
        setResourceProfile(previous => {
          const keys = [
            'tier', 'memoryPressure', 'textureWorkers', 'wmoWorkers', 'assetIoConcurrency',
            'terrainBatchMax', 'textureBatchMax', 'wmoBatchMax', 'waterBatchMax',
            'terrainRequestConcurrency', 'textureRequestConcurrency', 'wmoRequestConcurrency',
            'waterRequestConcurrency', 'textureUploadsPerFrame', 'wmoAssetConcurrency',
            'doodadConcurrency', 'm2RequestConcurrency', 'dprMax',
          ];
          if (previous && keys.every(key => previous[key] === next[key])) return previous;
          return next;
        });
      } catch (_) {}
    };
    void refreshProfile();
    const id = setInterval(refreshProfile, 5000);
    return () => { disposed = true; clearInterval(id); };
  }, []);
  const handleRendererStats = useCallback((next) => {
    setRendererStats(previous => {
      if (previous
        && previous.calls === next.calls
        && previous.triangles === next.triangles
        && previous.geometries === next.geometries
        && previous.textures === next.textures) return previous;
      return next;
    });
  }, []);
  const queueTextureUploads = useCallback((rows) => {
    if (!rows?.length) return;
    textureUploadQueueRef.current.push(...rows);
    if (textureUploadFrameRef.current) return;
    const flush = () => {
      textureUploadFrameRef.current = null;
      const ready = [];
      for (let i = 0; i < resourceProfileRef.current.textureUploadsPerFrame && textureUploadQueueRef.current.length; i++) {
        const next = textureUploadQueueRef.current.shift();
        const key = `${next.tileX}_${next.tileY}`;
        if (streamWindowRef.current.texture.has(key)) ready.push([key, next]);
      }
      if (ready.length) {
        setTileTextures(prev => {
          const next = { ...prev };
          ready.forEach(([key, row]) => { next[key] = row; });
          return next;
        });
        invalidateRef.current?.();
      }
      if (textureUploadQueueRef.current.length) {
        textureUploadFrameRef.current = requestAnimationFrame(flush);
      }
    };
    textureUploadFrameRef.current = requestAnimationFrame(flush);
  }, []);

  useEffect(() => () => {
    if (textureUploadFrameRef.current) cancelAnimationFrame(textureUploadFrameRef.current);
  }, []);

  const recordPerf = useCallback((kind, elapsedMs, tiles) => {
    const samples = perfSamplesRef.current[kind];
    samples.push({ elapsedMs, tiles });
    if (samples.length > 12) samples.shift();
    const totalMs = samples.reduce((sum, item) => sum + item.elapsedMs, 0);
    const totalTiles = samples.reduce((sum, item) => sum + item.tiles, 0);
    setPerfMetrics(prev => ({ ...prev, [kind]: { elapsedMs: totalMs / samples.length, tiles: totalTiles / samples.length } }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSpawns([]);
      setTerrain(null);
      setWater([]);
      setTileTextures({});
      setWmoPlacements([]);
      setAdtM2Placements([]);
      setStreamDiagnostics({ terrainTiles: 0, waterTiles: 0, wmoPlacements: 0, m2Placements: 0, pendingTerrain: 0, pendingTextures: 0, pendingWmo: 0, pendingWater: 0 });
      setWmoAssetPending(0);
      setM2AssetPending(0);
      setWmoBatchCount(0);
      setM2BatchCount(0);
      perfSamplesRef.current = { terrain: [], textures: [], wmo: [] };
      setPerfMetrics({ terrain: null, textures: null, wmo: null });
      textureUploadQueueRef.current = [];
      setSelectedId(null);
      setTransforms({});

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [mapId]);

  // ── World loading overlay ────────────────────────────────────────────────────
  useEffect(() => {
    setWorldLoading(true);
    setNearbyTexturesReady(false);
    clearTimeout(worldLoadTimeoutRef.current);
    worldLoadTimeoutRef.current = setTimeout(() => setWorldLoading(false), 30000);
    return () => clearTimeout(worldLoadTimeoutRef.current);
  }, [mapId, streamKey]);

  // Wait for terrain plus the nearby texture ring before revealing the world.
  const terrainReady = (terrain?.length ?? 0) >= INITIAL_WORLD_READY_TILES;
  useEffect(() => {
    if (terrainReady && nearbyTexturesReady) {
      clearTimeout(worldLoadTimeoutRef.current);
      setWorldLoading(false);
    }
  }, [terrainReady, nearbyTexturesReady]);

  useEffect(() => { setTerrainData(terrain); }, [terrain]);

  // Independent terrain, texture and WMO queues. Each queue is tile-prioritized
  // and may have one IPC batch in flight without blocking the other queues.
  useEffect(() => {
    const mapName = MAP_ADT_NAME[mapId];
    if (!mapName) return;

    let disposed = false;
    let terrainPumpActive = 0;
    let texturePumpActive = 0;
    let wmoPumpActive = 0;
    let waterPumpActive = 0;
    let centerTile = null;
    let lastRefreshPosition = null;
    const terrainByTile = new Map();
    const terrainQueue = new Map();
    const terrainInFlight = new Set();
    const terrainMissing = new Set();
    const textureQueue = new Map();
    const textureInFlight = new Set();
    const textureDone = new Set();
    const wmoByTile = new Map();
    const m2ByTile = new Map();
    const waterByTile = new Map();
    const wmoQueue = new Map();
    const wmoInFlight = new Set();
    const wmoDone = new Set();
    const m2Done = new Set();
    const waterQueue = new Map();
    const waterInFlight = new Set();
    const waterDone = new Set();
    const active = { terrain: new Set(), texture: new Set(), wmo: new Set(), m2: new Set(), water: new Set() };
    let textureRadius = TEXTURE_INITIAL_RADIUS;
    let lastDiagnosticsKey = '';
    streamWindowRef.current = { texture: active.texture };

    const keyFor = (tileX, tileY) => `${tileX}_${tileY}`;
    const distanceOf = item => centerTile
      ? Math.abs(item.tileX - centerTile.tileX) + Math.abs(item.tileY - centerTile.tileY)
      : 0;
    const wantedTiles = radius => {
      if (!centerTile) return [];
      const result = [];
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const tileX = centerTile.tileX + dx, tileY = centerTile.tileY + dy;
        if (tileX < 0 || tileX >= 64 || tileY < 0 || tileY >= 64) continue;
        result.push({ tileX, tileY, key: keyFor(tileX, tileY), d: Math.abs(dx) + Math.abs(dy) });
      }
      return result.sort((a, b) => a.d - b.d);
    };
    const setFrom = tiles => new Set(tiles.map(tile => tile.key));
    const wantedTextureTiles = () => wantedTiles(textureRadius);
    const dedupeWmo = (tileKey, rows) => {
      const seen = new Set();
      return (rows ?? []).filter(row => row?.path).map((row, index) => {
        const path = String(row.path).replace(/\//g, '\\');
        const position = Array.isArray(row.position) ? row.position.map(Number) : [];
        const rotation = Array.isArray(row.rotation) ? row.rotation.map(Number) : [];
        if (position.length !== 3 || !position.every(Number.isFinite)) return null;
        const identity = `${path.toLowerCase()}|${row.uniqueId ?? index}|${position.join(',')}|${rotation.join(',')}`;
        if (seen.has(identity)) return null;
        seen.add(identity);
        return { ...row, key: `${tileKey}|${identity}`, tileKey, path, position, rotation };
      }).filter(Boolean);
    };
    const dedupeM2 = (tileKey, rows) => {
      const seen = new Set();
      return (rows ?? []).filter(row => row?.path).map((row, index) => {
        const path = String(row.path).replace(/\//g, '\\');
        const position = Array.isArray(row.position) ? row.position.map(Number) : [];
        const rotation = Array.isArray(row.rotation) ? row.rotation.map(Number) : [];
        if (position.length !== 3 || !position.every(Number.isFinite)) return null;
        const identity = `${path.toLowerCase()}|${row.uniqueId ?? index}|${position.join(',')}|${rotation.join(',')}`;
        if (seen.has(identity)) return null;
        seen.add(identity);
        return { ...row, key: `${tileKey}|${identity}`, tileKey, path, position, rotation };
      }).filter(Boolean);
    };
    const publishDiagnostics = () => {
      if (disposed) return;
      const next = {
        terrainTiles: terrainByTile.size,
        waterTiles: waterByTile.size,
        wmoPlacements: [...wmoByTile.values()].reduce((total, rows) => total + rows.length, 0),
        m2Placements: [...m2ByTile.values()].reduce((total, rows) => total + rows.length, 0),
        pendingTerrain: terrainQueue.size + terrainInFlight.size,
        pendingTextures: textureQueue.size + textureInFlight.size,
        pendingWmo: wmoQueue.size + wmoInFlight.size,
        pendingWater: waterQueue.size + waterInFlight.size,
      };
      const key = Object.values(next).join('|');
      if (key === lastDiagnosticsKey) return;
      lastDiagnosticsKey = key;
      setStreamDiagnostics(next);
    };

    function evictOutsideWindow() {
      let terrainChanged = false;
      for (const key of terrainByTile.keys()) {
        if (!active.terrain.has(key)) { terrainByTile.delete(key); terrainChanged = true; }
      }
      for (const key of terrainMissing) if (!active.terrain.has(key)) terrainMissing.delete(key);
      for (const key of terrainQueue.keys()) if (!active.terrain.has(key)) terrainQueue.delete(key);

      let wmoChanged = false;
      for (const key of wmoByTile.keys()) {
        if (!active.wmo.has(key)) { wmoByTile.delete(key); wmoChanged = true; }
      }
      for (const key of wmoDone) if (!active.wmo.has(key)) wmoDone.delete(key);
      for (const key of wmoQueue.keys()) if (!active.wmo.has(key)) wmoQueue.delete(key);
      let m2Changed = false;
      for (const key of m2ByTile.keys()) {
        if (!active.m2.has(key)) { m2ByTile.delete(key); m2Changed = true; }
      }
      for (const key of m2Done) if (!active.m2.has(key)) m2Done.delete(key);

      for (const key of textureDone) if (!active.texture.has(key)) textureDone.delete(key);
      for (const key of textureQueue.keys()) if (!active.texture.has(key)) textureQueue.delete(key);
      if (terrainChanged) setTerrain([...terrainByTile.values()]);
      if (wmoChanged) setWmoPlacements([...wmoByTile.values()].flat());
      if (m2Changed) setAdtM2Placements([...m2ByTile.values()].flat());
      for (const key of waterByTile.keys()) {
        if (!active.water.has(key)) waterByTile.delete(key);
      }
      for (const key of waterDone) if (!active.water.has(key)) waterDone.delete(key);
      for (const key of waterQueue.keys()) if (!active.water.has(key)) waterQueue.delete(key);
      if (waterByTile.size) setWater([...waterByTile.values()].flat());
      else if (active.water.size === 0) setWater([]);
      if (active.texture.size) {
        setTileTextures(prev => {
          const next = { ...prev };
          let changed = false;
          for (const key of Object.keys(next)) {
            if (!active.texture.has(key)) { delete next[key]; changed = true; }
          }
          return changed ? next : prev;
        });
      }
    }

    function enqueueWindow() {
      for (const tile of wantedTiles(TERRAIN_RADIUS)) {
        if (!terrainByTile.has(tile.key) && !terrainMissing.has(tile.key)
          && !terrainQueue.has(tile.key) && !terrainInFlight.has(tile.key)) terrainQueue.set(tile.key, tile);
      }
      for (const tile of wantedTextureTiles()) {
        if (!textureDone.has(tile.key)
          && !textureQueue.has(tile.key) && !textureInFlight.has(tile.key)) textureQueue.set(tile.key, tile);
      }
      for (const tile of wantedTiles(WMO_RADIUS)) {
        if (!wmoDone.has(tile.key) && !wmoQueue.has(tile.key) && !wmoInFlight.has(tile.key)) wmoQueue.set(tile.key, tile);
      }
      for (const tile of wantedTiles(WATER_RADIUS)) {
        if (!waterDone.has(tile.key) && !waterQueue.has(tile.key) && !waterInFlight.has(tile.key)) waterQueue.set(tile.key, tile);
      }
    }

    function refreshWindow(force = false) {
      const { wx, wy } = camPosRef.current;
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
      if (!force && lastRefreshPosition
        && Math.hypot(wx - lastRefreshPosition.wx, wy - lastRefreshPosition.wy) < STREAM_MOVE_DISTANCE) return;
      lastRefreshPosition = { wx, wy };
      centerTile = worldToTile(wx, wy);
      active.terrain = setFrom(wantedTiles(TERRAIN_RADIUS));
      active.texture = setFrom(wantedTextureTiles());
      active.wmo = setFrom(wantedTiles(WMO_RADIUS));
      active.m2 = setFrom(wantedTiles(M2_RADIUS));
      active.water = setFrom(wantedTiles(WATER_RADIUS));
      streamWindowRef.current.texture = active.texture;
      evictOutsideWindow();
      enqueueWindow();
      publishDiagnostics();
    }

    function maybeExpandTextureWindow() {
      if (textureRadius >= TEXTURE_RADIUS || !centerTile) return;
      const nearby = wantedTiles(TEXTURE_INITIAL_RADIUS);
      if (nearby.length && nearby.every(tile => textureDone.has(tile.key))) {
        textureRadius = TEXTURE_RADIUS;
        setNearbyTexturesReady(true);
      }
    }

    async function pumpTerrain() {
      const profile = resourceProfileRef.current;
      if (disposed || terrainPumpActive >= profile.terrainRequestConcurrency || !terrainQueue.size) return;
      terrainPumpActive += 1;
      const batch = [...terrainQueue.values()].sort((a, b) => distanceOf(a) - distanceOf(b)).slice(0, profile.terrainBatchMax);
      batch.forEach(tile => { terrainQueue.delete(tile.key); terrainInFlight.add(tile.key); });
      publishDiagnostics();
      try {
        const started = performance.now();
        const result = await window.azeroth.adt.getTerrain({ mapName, tiles: batch.map(({ tileX, tileY }) => ({ tileX, tileY })) });
        recordPerf('terrain', performance.now() - started, result?.data?.length ?? 0);
        if (!result?.success) throw new Error(result?.error || 'Terrain request failed');
        const got = new Map((result.data ?? []).map(tile => [keyFor(tile.tileX, tile.tileY), tile]));
        for (const tile of batch) {
          terrainInFlight.delete(tile.key);
          if (!active.terrain.has(tile.key)) continue;
          if (got.has(tile.key)) terrainByTile.set(tile.key, got.get(tile.key));
          else terrainMissing.add(tile.key);
        }
        if (!disposed) {
          setTerrain([...terrainByTile.values()]);
          enqueueWindow();
        }
      } catch (error) {
        for (const tile of batch) { terrainInFlight.delete(tile.key); if (active.terrain.has(tile.key)) terrainMissing.add(tile.key); }
        if (!disposed) setError(error.message);
      } finally {
        terrainPumpActive -= 1;
        publishDiagnostics();
      }
    }

    async function pumpTextures() {
      const profile = resourceProfileRef.current;
      if (disposed || texturePumpActive >= profile.textureRequestConcurrency || !textureQueue.size) return;
      texturePumpActive += 1;
      const maxBatch = textureRadius === TEXTURE_INITIAL_RADIUS
        ? Math.min(profile.textureBatchMax, 2)
        : profile.textureBatchMax;
      const batch = [...textureQueue.values()].sort((a, b) => distanceOf(a) - distanceOf(b)).slice(0, maxBatch);
      batch.forEach(tile => { textureQueue.delete(tile.key); textureInFlight.add(tile.key); });
      publishDiagnostics();
      try {
        const started = performance.now();
        const result = await window.azeroth.adt.getTextureLayers({ mapName, tiles: batch.map(({ tileX, tileY }) => ({ tileX, tileY })) });
        recordPerf('textures', performance.now() - started, result?.data?.length ?? 0);
        if (!result?.success) throw new Error(result?.error || 'Texture request failed');
        for (const tile of batch) {
          textureInFlight.delete(tile.key);
          if (active.texture.has(tile.key)) textureDone.add(tile.key);
        }
        maybeExpandTextureWindow();
        if (!disposed && result.data?.length) queueTextureUploads(result.data);
      } catch (error) {
        for (const tile of batch) textureInFlight.delete(tile.key);
        if (!disposed) setError(error.message);
      } finally {
        texturePumpActive -= 1;
        publishDiagnostics();
      }
    }

    async function pumpWmo() {
      const profile = resourceProfileRef.current;
      if (disposed || wmoPumpActive >= profile.wmoRequestConcurrency || !wmoQueue.size) return;
      wmoPumpActive += 1;
      const batch = [...wmoQueue.values()].sort((a, b) => distanceOf(a) - distanceOf(b)).slice(0, profile.wmoBatchMax);
      batch.forEach(tile => { wmoQueue.delete(tile.key); wmoInFlight.add(tile.key); });
      publishDiagnostics();
      try {
        const started = performance.now();
        const result = await window.azeroth.adt.getPlacements({ mapName, tiles: batch.map(({ tileX, tileY }) => ({ tileX, tileY })) });
        recordPerf('wmo', performance.now() - started, result?.data?.length ?? 0);
        if (!result?.success) throw new Error(result?.error || 'WMO request failed');
        const rowsByTile = new Map((result.data ?? []).map(row => [keyFor(row.tileX, row.tileY), row]));
        for (const tile of batch) {
          wmoInFlight.delete(tile.key);
          if (!active.wmo.has(tile.key)) continue;
          const rows = rowsByTile.get(tile.key);
          wmoByTile.set(tile.key, dedupeWmo(tile.key, rows?.wmo));
          wmoDone.add(tile.key);
          if (active.m2.has(tile.key)) {
            m2ByTile.set(tile.key, dedupeM2(tile.key, rows?.m2));
            m2Done.add(tile.key);
          }
        }
        if (!disposed) {
          setWmoPlacements([...wmoByTile.values()].flat());
          setAdtM2Placements([...m2ByTile.values()].flat());
        }
      } catch (error) {
        for (const tile of batch) wmoInFlight.delete(tile.key);
        if (!disposed) setError(error.message);
      } finally {
        wmoPumpActive -= 1;
        publishDiagnostics();
      }
    }

    async function pumpWater() {
      const profile = resourceProfileRef.current;
      if (disposed || waterPumpActive >= profile.waterRequestConcurrency || !waterQueue.size) return;
      waterPumpActive += 1;
      const batch = [...waterQueue.values()].sort((a, b) => distanceOf(a) - distanceOf(b)).slice(0, profile.waterBatchMax);
      batch.forEach(tile => { waterQueue.delete(tile.key); waterInFlight.add(tile.key); });
      publishDiagnostics();
      try {
        const result = await window.azeroth.adt.getWater({
          mapName,
          tiles: batch.map(({ tileX, tileY }) => ({ tileX, tileY })),
        });
        if (!result?.success) throw new Error(result?.error || 'Water request failed');
        const rowsByTile = new Map((result.data ?? []).map(row => [keyFor(row.tileX, row.tileY), row]));
        for (const tile of batch) {
          waterInFlight.delete(tile.key);
          if (!active.water.has(tile.key)) continue;
          const row = rowsByTile.get(tile.key);
          waterByTile.set(tile.key, (row?.layers ?? []).map(layer => ({ ...layer, tileKey: tile.key })));
          waterDone.add(tile.key);
        }
        if (!disposed) setWater([...waterByTile.values()].flat());
      } catch (error) {
        for (const tile of batch) waterInFlight.delete(tile.key);
        if (!disposed) setError(error.message);
      } finally {
        waterPumpActive -= 1;
        publishDiagnostics();
      }
    }

    const pump = () => {
      refreshWindow();
      void pumpTerrain();
      void pumpTextures();
      void pumpWmo();
      void pumpWater();
    };
    refreshWindow(true);
    pump();
    const id = setInterval(pump, 150);
    return () => {
      disposed = true;
      clearInterval(id);
      streamWindowRef.current = { texture: new Set() };
    };
  }, [mapId, streamKey, queueTextureUploads]);

  useEffect(() => {
    setTerrain(null);
    setWater([]);
    setTileTextures({});
    setWmoPlacements([]);
    setAdtM2Placements([]);
    setStreamDiagnostics({ terrainTiles: 0, waterTiles: 0, wmoPlacements: 0, m2Placements: 0, pendingTerrain: 0, pendingTextures: 0, pendingWmo: 0, pendingWater: 0 });
    setWmoAssetPending(0);
    setM2AssetPending(0);
    setWmoBatchCount(0);
    setM2BatchCount(0);
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
        setSaveError(`Error for ${spawn.guid}: ${res.error}`);
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
    if (!teleId) return { success: false, error: 'Could not determine a temporary teleport ID' };

    const del = await query('DELETE FROM game_tele WHERE name = ?', [teleName]);
    if (!del.success) return { success: false, error: `Kon tijdelijke teleport niet voorbereiden: ${del.error}` };

    const ins = await query(
      'INSERT INTO game_tele (id, position_x, position_y, position_z, orientation, map, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [teleId, Number(x), Number(y), Number(z), orientation, Number(map), teleName]
    );
    if (!ins.success) return { success: false, error: `Could not save temporary teleport: ${ins.error}` };

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
        staticWorldMode={STATIC_WORLD_MODE}
      />

      {error && <div className="ed3-error-bar">Error: {error}</div>}

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
              <span className="ed3-world-overlay-text">Loading nearby world textures...</span>
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
              water={water}
              tileTextures={tileTextures}
              wdl={null}
              initialTarget={spawnCenter}
              resetKeys={resetKeys}
              focusTarget={focusTarget}
              focusTick={focusTick}
              transforms={transforms}
              camPosRef={camPosRef}
              invalidateRef={invalidateRef}
              staticWorldMode={STATIC_WORLD_MODE}
              viewDistance={VIEW_DISTANCE}
              resourceProfile={activeResourceProfile}
              wmoPlacements={wmoPlacements}
              adtM2Placements={adtM2Placements}
              onWmoPendingChange={handleWmoPendingChange}
              onM2PendingChange={handleM2PendingChange}
              onWmoBatchCount={handleWmoBatchCount}
              onM2BatchCount={handleM2BatchCount}
              onRendererStats={handleRendererStats}
              onCameraMove={requestMinimapDraw}
            />
          </Editor3DErrorBoundary>
          <MinimapOverlay mapId={mapId} camPosRef={camPosRef} cameraMoveRef={cameraMoveRef} />
          {(perfMetrics.terrain || perfMetrics.textures || perfMetrics.wmo || streamDiagnostics.terrainTiles || streamDiagnostics.waterTiles || streamDiagnostics.wmoPlacements || streamDiagnostics.m2Placements || wmoAssetPending || m2AssetPending || wmoBatchCount || m2BatchCount || rendererStats) && (
            <div className="ed3-perf-panel">
              <strong>Streaming</strong>
              <span>View: {VIEW_DISTANCE} yd · Terrain: 5×5 · Textures: near 3×3 → 5×5 · Objects/water: 3×3</span>
              <span>Profile: {activeResourceProfile.tier} · texture workers: {activeResourceProfile.textureWorkers} · WMO workers: {activeResourceProfile.wmoWorkers} · DPR max: {activeResourceProfile.dprMax}</span>
              <span>Active: {streamDiagnostics.terrainTiles} terrain · {streamDiagnostics.waterTiles} water tiles · {streamDiagnostics.wmoPlacements} WMO · {streamDiagnostics.m2Placements} static M2</span>
              <span>GPU batches: {wmoBatchCount} WMO/M2 doodad · {m2BatchCount} static M2</span>
              {rendererStats && <span>Renderer: {rendererStats.calls} draw calls · {rendererStats.triangles.toLocaleString()} triangles · {rendererStats.geometries} geometries · {rendererStats.textures} textures</span>}
              <span>Pending: {streamDiagnostics.pendingTerrain} terrain · {streamDiagnostics.pendingTextures} textures · {streamDiagnostics.pendingWater} water · {streamDiagnostics.pendingWmo} WMO scans · {wmoAssetPending} WMO assets · {m2AssetPending} static M2 assets</span>
              {perfMetrics.terrain && <span>Terrain: {Math.round(perfMetrics.terrain.elapsedMs)} ms / {Math.round(perfMetrics.terrain.tiles)} tiles</span>}
              {perfMetrics.textures && <span>Textures: {Math.round(perfMetrics.textures.elapsedMs)} ms / {Math.round(perfMetrics.textures.tiles)} tiles</span>}
              {perfMetrics.wmo && <span>WMO scan: {Math.round(perfMetrics.wmo.elapsedMs)} ms / {Math.round(perfMetrics.wmo.tiles)} tiles</span>}
            </div>
          )}
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
            {dirtyGuids.size} spawn{dirtyGuids.size > 1 ? 's' : ''} unsaved
          </span>
          {saveError && <span className="ed3-save-bar-error">{saveError}</span>}
          <button className="ed3-save-bar-btn undo" onClick={handleUndo} disabled={saving}>
            Undo changes
          </button>
          <button className="ed3-save-bar-btn save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
         </div>
      )}
    </div>
  );
}
