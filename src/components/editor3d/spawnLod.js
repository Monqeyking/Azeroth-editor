import { useState, useEffect } from 'react';
import { wowToThree } from './wowCoords';

export const MODEL_LOAD_DIST       = 380;
export const BILLBOARD_LOD_DIST      = 720;
export const MODEL_PREFETCH_MARGIN   = 50;
export const MODEL_PREFETCH_DIST     = MODEL_LOAD_DIST + MODEL_PREFETCH_MARGIN;
const SPAWN_CELL_SIZE = BILLBOARD_LOD_DIST;

// ─── Terrain height snapping ──────────────────────────────────────────────────
const _TS   = 533.33333;
const _HALF = 32 * _TS;
const _US   = _TS / 128;
let _terrainTiles     = [];
let _terrainByKey     = new Map();
let _terrainTick      = 0;
const _terrainListeners = new Set();
const _spawnPoseCache = new Map();

export function setTerrainData(tiles) {
  _terrainTiles = tiles ?? [];
  _terrainByKey = new Map(_terrainTiles.map(tile => [`${tile.tileX}_${tile.tileY}`, tile]));
  _spawnPoseCache.clear();
  _terrainTick++;
  _terrainListeners.forEach(fn => fn(_terrainTick));
}

export function useTerrainTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    _terrainListeners.add(setTick);
    return () => _terrainListeners.delete(setTick);
  }, []);
  return tick;
}

export function getTerrainHeight(wx, wy) {
  const tileX = Math.floor((_HALF - wx) / _TS);
  const tileY = Math.floor((_HALF - wy) / _TS);
  const tile  = _terrainByKey.get(`${tileX}_${tileY}`);
  if (!tile?.v9) return null;
  // v9 rows follow WoW X (tileX); columns follow WoW Y (tileY).
  const gx = Math.max(0, Math.min(128, ((32 - tileY) * _TS - wy) / _US));
  const gy = Math.max(0, Math.min(128, ((32 - tileX) * _TS - wx) / _US));
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(128, x0 + 1), y1 = Math.min(128, y0 + 1);
  const cellX = Math.min(127, Math.max(0, x0));
  const cellY = Math.min(127, Math.max(0, y0));
  const holeMask = tile.holes?.[(cellY >> 3) * 16 + (cellX >> 3)] ?? 0;
  const holeBit = (((cellY & 7) >> 1) * 4) + ((cellX & 7) >> 1);
  if (holeMask & (1 << holeBit)) return null;
  const tx = gx - x0, ty = gy - y0;
  const h00 = tile.v9[y0 * 129 + x0], h10 = tile.v9[y0 * 129 + x1];
  const h01 = tile.v9[y1 * 129 + x0], h11 = tile.v9[y1 * 129 + x1];
  return (h00 + (h10 - h00) * tx) * (1 - ty) + (h01 + (h11 - h01) * tx) * ty;
}

const MODEL_LOAD_SQ     = MODEL_LOAD_DIST * MODEL_LOAD_DIST;
const BILLBOARD_LOD_SQ    = BILLBOARD_LOD_DIST * BILLBOARD_LOD_DIST;
const MODEL_PREFETCH_SQ   = MODEL_PREFETCH_DIST * MODEL_PREFETCH_DIST;

const lodMap = new Map();
const listeners = new Map();
const spawnIndexCache = new WeakMap();
let activeSpawnGuids = new Set();

function spawnCellKey(x, z) {
  return `${Math.floor(x / SPAWN_CELL_SIZE)}_${Math.floor(z / SPAWN_CELL_SIZE)}`;
}

function getSpawnIndex(spawns) {
  let index = spawnIndexCache.get(spawns);
  if (index) return index;
  index = { cells: new Map(), byGuid: new Map() };
  for (const spawn of spawns) {
    const pos = wowToThree(spawn.x, spawn.y, spawn.z);
    const key = spawnCellKey(pos[0], pos[2]);
    if (!index.cells.has(key)) index.cells.set(key, []);
    index.cells.get(key).push(spawn);
    index.byGuid.set(spawn.guid, spawn);
  }
  spawnIndexCache.set(spawns, index);
  return index;
}

export function getSpawnsInRange(spawns, camera, radius) {
  const index = getSpawnIndex(spawns);
  const minX = Math.floor((camera.position.x - radius) / SPAWN_CELL_SIZE);
  const maxX = Math.floor((camera.position.x + radius) / SPAWN_CELL_SIZE);
  const minZ = Math.floor((camera.position.z - radius) / SPAWN_CELL_SIZE);
  const maxZ = Math.floor((camera.position.z + radius) / SPAWN_CELL_SIZE);
  const result = [];
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    const cell = index.cells.get(`${x}_${z}`);
    if (cell) result.push(...cell);
  }
  return result;
}

export function getSpawnPose(spawn, transforms) {
  const t = transforms?.[spawn.guid];
  if (t?.pos) {
    return {
      pos: [t.pos.x, t.pos.y, t.pos.z],
      rotY: t.rot?.y ?? spawn.orientation ?? 0,
    };
  }
  const cacheKey = `${spawn.type}_${spawn.guid}`;
  const cached = _spawnPoseCache.get(cacheKey);
  if (cached) return cached;
  const th = getTerrainHeight(spawn.x, spawn.y);
  const pose = { pos: wowToThree(spawn.x, spawn.y, th ?? spawn.z), rotY: spawn.orientation ?? 0 };
  _spawnPoseCache.set(cacheKey, pose);
  return pose;
}

export function horizontalDistSq(camera, pos) {
  const dx = camera.position.x - pos[0];
  const dz = camera.position.z - pos[2];
  return dx * dx + dz * dz;
}

export function computeLod(distSqH, forceModel = false) {
  if (forceModel) return 'model';
  if (distSqH <= MODEL_LOAD_SQ) return 'model';
  if (distSqH <= BILLBOARD_LOD_SQ) return 'billboard';
  return 'hidden';
}

export function getSpawnLod(guid) {
  return lodMap.get(guid) ?? 'hidden';
}

export function subscribeSpawnLod(guid, fn) {
  if (!listeners.has(guid)) listeners.set(guid, new Set());
  listeners.get(guid).add(fn);
  fn(getSpawnLod(guid));
  return () => listeners.get(guid)?.delete(fn);
}

function setLod(guid, lod) {
  if (lodMap.get(guid) === lod) return;
  lodMap.set(guid, lod);
  listeners.get(guid)?.forEach(fn => fn(lod));
}

export function updateAllSpawnLod(spawns, transforms, camera, selectedId) {
  const active = new Set();
  for (const spawn of getSpawnsInRange(spawns, camera, BILLBOARD_LOD_DIST)) {
    active.add(spawn.guid);
    const { pos } = getSpawnPose(spawn, transforms);
    const lod = computeLod(
      horizontalDistSq(camera, pos),
      spawn.guid === selectedId
    );
    setLod(spawn.guid, lod);
  }
  if (selectedId && !active.has(selectedId)) {
    const selected = getSpawnIndex(spawns).byGuid.get(selectedId);
    if (selected) { active.add(selectedId); setLod(selectedId, 'model'); }
  }
  for (const guid of activeSpawnGuids) {
    if (!active.has(guid)) setLod(guid, 'hidden');
  }
  activeSpawnGuids = active;
}

export function isInPrefetchRange(camera, spawn, transforms) {
  const { pos } = getSpawnPose(spawn, transforms);
  return horizontalDistSq(camera, pos) <= MODEL_PREFETCH_SQ;
}

export function useSpawnLod(guid, selected) {
  const [lod, setLod] = useState(() => getSpawnLod(guid));
  useEffect(() => {
    if (selected) setLod('model');
    return subscribeSpawnLod(guid, setLod);
  }, [guid, selected]);
  return selected ? 'model' : lod;
}
