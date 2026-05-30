import { useRef, useMemo, useLayoutEffect, useState, useEffect, useCallback, useReducer } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getSpawnPose, horizontalDistSq, MODEL_LOAD_DIST } from './spawnLod';
import {
  fetchM2Model,
  getCachedM2Asset,
  getM2Material,
  subscribeM2Cache,
} from './m2Loader';

const MODEL_LOAD_SQ = MODEL_LOAD_DIST * MODEL_LOAD_DIST;
const _dummy = new THREE.Object3D();

function M2InstanceGroup({ displayId, entries, asset, hoveredGuid, onSelect, onHover }) {
  const meshRef = useRef();
  const count = entries.length;
  const material = useMemo(() => getM2Material(asset), [asset]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !count) return;

    for (let i = 0; i < count; i++) {
      const { pos, rotY } = entries[i];
      _dummy.position.set(pos[0], pos[1], pos[2]);
      _dummy.rotation.set(0, rotY, 0);
      _dummy.scale.setScalar(entries[i].guid === hoveredGuid ? 1.06 : 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }, [entries, count, hoveredGuid, asset]);

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    if (e.instanceId == null) return;
    const entry = entries[e.instanceId];
    if (entry) onSelect(entry.guid);
  }, [entries, onSelect]);

  const handleOver = useCallback((e) => {
    e.stopPropagation();
    if (e.instanceId == null) return;
    const entry = entries[e.instanceId];
    if (entry) onHover(entry.guid);
  }, [entries, onHover]);

  const handleOut = useCallback(() => onHover(null), [onHover]);

  if (!count || !asset?.geo) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[asset.geo, material, count]}
      frustumCulled
      onClick={handleClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
    />
  );
}

function rangeSetChanged(prev, next) {
  if (prev.size !== next.size) return true;
  for (const id of next) if (!prev.has(id)) return true;
  return false;
}

const MOVE_SQ = 9; // skip frame als camera <3 units bewoog (XZ)

export default function M2InstanceLayers({ spawns, transforms, selectedId, onSelect }) {
  const { camera, gl } = useThree();
  const [cacheTick, setCacheTick] = useState(0);
  const [rangeTick, bumpRange] = useReducer(n => n + 1, 0);
  const [hoveredGuid, setHoveredGuid] = useState(null);
  const inRangeRef = useRef(new Set());
  const nextSetRef = useRef(new Set()); // hergebruikt, voorkomt GC-druk
  const lastPos    = useRef({ x: Infinity, z: Infinity });

  useEffect(() => subscribeM2Cache(() => setCacheTick(t => t + 1)), []);

  useFrame(() => {
    const { x, z } = camera.position;
    const dx = x - lastPos.current.x;
    const dz = z - lastPos.current.z;
    if (dx * dx + dz * dz < MOVE_SQ) return;
    lastPos.current.x = x;
    lastPos.current.z = z;

    const next = nextSetRef.current;
    next.clear();
    for (const s of spawns) {
      if (s.type !== 'creature' || !s.displayId) continue;
      const { pos } = getSpawnPose(s, transforms);
      if (horizontalDistSq(camera, pos) <= MODEL_LOAD_SQ) next.add(s.guid);
    }

    if (rangeSetChanged(inRangeRef.current, next)) {
      inRangeRef.current = new Set(next); // snapshot voor useMemo
      bumpRange();
    }
  });

  const groups = useMemo(() => {
    const byDisplay = new Map();
    const inRange = inRangeRef.current;

    for (const spawn of spawns) {
      if (spawn.type !== 'creature' || !spawn.displayId) continue;
      if (!inRange.has(spawn.guid)) continue;
      if (spawn.guid === selectedId) continue;

      const asset = getCachedM2Asset(spawn.displayId);
      if (!asset?.geo) continue;

      const pose = getSpawnPose(spawn, transforms);
      if (!byDisplay.has(spawn.displayId)) byDisplay.set(spawn.displayId, { asset, entries: [] });
      byDisplay.get(spawn.displayId).entries.push({ guid: spawn.guid, ...pose });
    }

    return [...byDisplay.entries()].map(([displayId, { asset, entries }]) => ({
      displayId,
      asset,
      entries,
    }));
  }, [spawns, transforms, selectedId, cacheTick, rangeTick]);

  useEffect(() => {
    const ids = new Set();
    const inRange = inRangeRef.current;
    for (const s of spawns) {
      if (s.type !== 'creature' || !s.displayId || !inRange.has(s.guid)) continue;
      if (s.guid === selectedId) continue;
      if (!getCachedM2Asset(s.displayId)) ids.add(s.displayId);
    }
    ids.forEach(id => fetchM2Model(id));
  }, [spawns, selectedId, cacheTick]);

  const handleHover = useCallback((guid) => {
    setHoveredGuid(guid);
    gl.domElement.style.cursor = guid ? 'pointer' : 'default';
  }, [gl]);

  return (
    <>
      {groups.map(({ displayId, asset, entries }) => (
        <M2InstanceGroup
          key={displayId}
          displayId={displayId}
          entries={entries}
          asset={asset}
          hoveredGuid={hoveredGuid}
          onSelect={onSelect}
          onHover={handleHover}
        />
      ))}
    </>
  );
}
