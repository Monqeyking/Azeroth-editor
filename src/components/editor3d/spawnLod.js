import { useState, useEffect } from 'react';
import { wowToThree } from './wowCoords';

export const MODEL_LOAD_DIST       = 380;
export const BILLBOARD_LOD_DIST      = 720;
export const MODEL_PREFETCH_MARGIN   = 50;
export const MODEL_PREFETCH_DIST     = MODEL_LOAD_DIST + MODEL_PREFETCH_MARGIN;

const MODEL_LOAD_SQ     = MODEL_LOAD_DIST * MODEL_LOAD_DIST;
const BILLBOARD_LOD_SQ    = BILLBOARD_LOD_DIST * BILLBOARD_LOD_DIST;
const MODEL_PREFETCH_SQ   = MODEL_PREFETCH_DIST * MODEL_PREFETCH_DIST;

const lodMap = new Map();
const listeners = new Map();

export function getSpawnPose(spawn, transforms) {
  const t = transforms?.[spawn.guid];
  if (t?.pos) {
    return {
      pos: [t.pos.x, t.pos.y, t.pos.z],
      rotY: t.rot?.y ?? spawn.orientation ?? 0,
    };
  }
  return { pos: wowToThree(spawn.x, spawn.y, spawn.z), rotY: spawn.orientation ?? 0 };
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
  for (const spawn of spawns) {
    active.add(spawn.guid);
    const { pos } = getSpawnPose(spawn, transforms);
    const lod = computeLod(
      horizontalDistSq(camera, pos),
      spawn.guid === selectedId
    );
    setLod(spawn.guid, lod);
  }
  for (const guid of lodMap.keys()) {
    if (!active.has(guid)) {
      lodMap.delete(guid);
      listeners.get(guid)?.forEach(fn => fn('hidden'));
    }
  }
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
