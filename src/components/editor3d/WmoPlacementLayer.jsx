import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  fetchWmoAsset,
  getCachedWmoAsset,
  getWmoAssetState,
  getWmoPendingCount,
  pruneWmoAssetCache,
  subscribeWmoCache,
} from './wmoLoader';
import {
  fetchM2ModelByPath,
  getCachedM2AssetByPath,
  getM2Material,
  getM2PathAssetState,
  getM2PathPendingCount,
  subscribeM2PathCache,
} from './m2Loader';
import { makeAnimator } from './GameObjectPreview';
import { adtPlacementQuaternion, adtPlacementToThree } from './wowCoords';

const MARKER_SIZE = 8;
const WMO_LOAD_DISTANCE = 550;
const WMO_RENDER_DISTANCE = 720;
const WMO_DETAIL_DISTANCE = 300;
const WMO_MID_DISTANCE = 550;
const WMO_TEXTURE_DISTANCE = WMO_MID_DISTANCE;
const DOODAD_LOAD_DISTANCE = 560;
const DOODAD_RENDER_DISTANCE = WMO_DETAIL_DISTANCE;
const VIEW_PRIORITY_DISTANCE = 360;
const WMO_REQUEST_CONCURRENCY = 3;
const DOODAD_REQUEST_CONCURRENCY = 4;

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function sampleParticleKeys(keys, phase, fallback) {
  if (!Array.isArray(keys) || !keys.length) return fallback;
  if (keys.length === 1) return keys[0];
  const scaled = Math.max(0, Math.min(1, phase)) * (keys.length - 1);
  const from = Math.floor(scaled);
  const to = Math.min(from + 1, keys.length - 1);
  const amount = scaled - from;
  const a = keys[from];
  const b = keys[to] || a;
  if (Array.isArray(a)) return a.map((value, index) => value + ((b[index] ?? value) - value) * amount);
  return a + ((b - a) * amount);
}

function particleCount(texturePath) {
  const path = String(texturePath || '').toLowerCase();
  if (path.endsWith('flamelicksmallblue.blp') || path.endsWith('lavalump2.blp')) return 4;
  if (path.includes('smokewispy')) return 3;
  return 2;
}

function DoodadParticleLayer({ asset, matrix }) {
  const groupRef = useRef(null);
  const rows = useMemo(() => (asset.particleEmitters || []).flatMap(emitter => {
    if (!asset.particleTextures?.has(emitter.index)) return [];
    const count = particleCount(emitter.texturePath);
    return Array.from({ length: count }, (_, index) => ({
      emitter,
      index,
      count,
      seed: (index / Math.max(1, count)) * Math.PI * 2,
    }));
  }), [asset]);
  const materials = useMemo(() => {
    const result = new Map();
    for (const emitter of asset.particleEmitters || []) {
      const texture = asset.particleTextures?.get(emitter.index);
      if (!texture) continue;
      const map = texture.clone();
      map.flipY = true;
      map.needsUpdate = true;
      result.set(emitter.index, new THREE.SpriteMaterial({
        map,
        transparent: true,
        alphaTest: 0.01,
        depthTest: true,
        depthWrite: false,
        opacity: 0.7,
        toneMapped: false,
        blending: emitter.blend === 3 || emitter.blend === 4
          ? THREE.AdditiveBlending
          : THREE.NormalBlending,
      }));
    }
    return result;
  }, [asset]);
  const particleSize = useMemo(() => {
    const radius = asset.geo?.boundingSphere?.radius || 2;
    return Math.max(0.35, Math.min(5, radius * 0.55));
  }, [asset]);

  useEffect(() => () => {
    materials.forEach(material => {
      material.map?.dispose();
      material.dispose();
    });
  }, [materials]);

  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.matrix.copy(matrix);
    groupRef.current.matrixAutoUpdate = false;
    groupRef.current.matrixWorldNeedsUpdate = true;
  }, [matrix]);

  useFrame((state) => {
    if (!groupRef.current || !rows.length) return;
    groupRef.current.matrix.copy(matrix);
    groupRef.current.matrixWorldNeedsUpdate = true;
    const elapsedMs = state.clock.getElapsedTime() * 1000;
    rows.forEach((row, rowIndex) => {
      const sprite = groupRef.current.children[rowIndex];
      const material = materials.get(row.emitter.index);
      if (!sprite || !material) return;
      const emitter = row.emitter;
      const lifespanMs = Math.max(700, Math.min(4000, (Number(emitter.lifespan) || 1.2) * 1000));
      const phase = ((elapsedMs + row.index * lifespanMs / Math.max(1, row.count)) % lifespanMs) / lifespanMs;
      const angle = row.seed + elapsedMs * 0.0016;
      const spread = Math.max(
        0.08,
        Math.min(particleSize * 0.38, Math.max(emitter.emissionAreaLength || 0, emitter.emissionAreaWidth || 0) * 0.08),
      );
      const radius = spread * (0.2 + phase * 0.8);
      const point = [...(emitter.position || [0, 0, 0])];
      point[1] += Math.cos(angle) * radius;
      point[2] += Math.sin(angle) * radius * 0.7;
      point[0] += Math.sin(angle * 0.65) * radius * 0.18;
      sprite.position.set(-point[1], point[2], point[0]);
      const color = sampleParticleKeys(emitter.colorKeys, phase, [1, 1, 1]);
      const opacity = sampleParticleKeys(emitter.opacityKeys, phase, 1);
      material.color.setRGB(color[0], color[1], color[2]);
      material.opacity = Math.max(0, Math.min(1, 0.6 * opacity * (0.75 + phase * 0.25)));
      material.rotation = angle * 0.65;
      sprite.scale.setScalar(particleSize * (0.55 + phase * 0.45));
    });
    state.invalidate();
  });

  if (!rows.length) return null;
  return (
    <group ref={groupRef} matrixAutoUpdate={false}>
      {rows.map((row, index) => (
        <sprite
          key={`${row.emitter.index}:${row.index}`}
          material={materials.get(row.emitter.index)}
          renderOrder={100 + row.emitter.index + index}
        />
      ))}
    </group>
  );
}

function WmoMeshBatch({ mesh, instances }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    instances.forEach((matrix, index) => ref.current.setMatrixAt(index, matrix));
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [instances]);

  return (
    <instancedMesh
      ref={ref}
      args={[mesh.geometry, mesh.material, instances.length]}
      frustumCulled
      dispose={null}
    />
  );
}

function DoodadBatch({ asset, instances }) {
  const ref = useRef(null);
  const material = useMemo(() => getM2Material(asset), [asset]);
  const animator = useMemo(() => makeAnimator(asset.animationData), [asset]);

  useEffect(() => {
    if (!ref.current) return;
    instances.forEach((matrix, index) => ref.current.setMatrixAt(index, matrix));
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [instances]);

  useFrame((state) => {
    if (!animator?.isAnimated || !asset.geo) return;
    animator.update(state.clock.getElapsedTime() * 1000, asset.geo);
    asset.geo.computeBoundingSphere();
    state.invalidate();
  });

  return (
    <instancedMesh
      ref={ref}
      args={[asset.geo, material, instances.length]}
      frustumCulled
      dispose={null}
    />
  );
}

function wmoDoodadToThree([x = 0, y = 0, z = 0]) {
  return [y, z, x];
}

function wmoDoodadQuaternion([x = 0, y = 0, z = 0, w = 1]) {
  const raw = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(x, y, z, w));
  const basis = new THREE.Matrix4().set(
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(
    basis.clone().multiply(raw).multiply(basis.clone().transpose()),
  );
}

function doodadsForSet(asset, setIndex, groupIndex = null) {
  if (!asset?.doodads?.length) return [];
  const requestedIndex = Number.isInteger(setIndex) && setIndex >= 0 ? setIndex : 0;
  const selectedIndex = asset.doodadSets?.length && requestedIndex < asset.doodadSets.length ? requestedIndex : 0;
  const selectedSet = asset.doodadSets?.[selectedIndex];
  const start = selectedSet?.start ?? 0;
  const end = start + (selectedSet?.count ?? asset.doodads.length);
  const refs = groupIndex != null ? asset.groupDoodadRefs?.[String(groupIndex)] : null;
  if (Array.isArray(refs)) {
    return refs
      .filter(index => index >= start && index < end && asset.doodads[index])
      .map(index => asset.doodads[index]);
  }
  return asset.doodads.slice(start, end).filter(Boolean);
}

function doodadsForAsset(asset, setIndex, visibleGroups = null) {
  const groups = Object.keys(asset?.groupDoodadRefs || {});
  if (!groups.length) return doodadsForSet(asset, setIndex);
  const rows = [];
  const seen = new Set();
  for (const groupIndex of groups) {
    if (visibleGroups && !visibleGroups.has(Number(groupIndex))) continue;
    for (const doodad of doodadsForSet(asset, setIndex, groupIndex)) {
      const key = doodad.uniqueId ?? `${doodad.path}:${doodad.position?.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...doodad, __wmoGroupIndex: Number(groupIndex) });
    }
  }
  return rows;
}

function getWmoProxySize(asset) {
  if (!asset?.meshes?.length) return MARKER_SIZE;
  const bounds = new THREE.Box3();
  let hasBounds = false;
  for (const mesh of asset.meshes) {
    if (!mesh.geometry?.boundingBox) continue;
    bounds.union(mesh.geometry.boundingBox);
    hasBounds = true;
  }
  if (!hasBounds) return MARKER_SIZE;
  const size = bounds.getSize(new THREE.Vector3());
  return Math.max(MARKER_SIZE, Math.min(160, Math.max(size.x, size.y, size.z)));
}

function isCameraInsideWmo(marker, asset, cameraPosition) {
  const bounds = new THREE.Box3();
  let hasBounds = false;
  for (const mesh of asset?.meshes || []) {
    if (!mesh.geometry?.boundingBox) continue;
    bounds.union(mesh.geometry.boundingBox);
    hasBounds = true;
  }
  if (!hasBounds) return false;
  const markerMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...marker.position),
    marker.quaternion,
    new THREE.Vector3(marker.scale, marker.scale, marker.scale),
  );
  const localCamera = cameraPosition.clone().applyMatrix4(markerMatrix.clone().invert());
  return bounds.containsPoint(localCamera);
}

function getPortalVisibleGroups(marker, asset, cameraPosition) {
  const portalData = asset?.portalData;
  if (!portalData?.portals?.length || !portalData.refs?.length || !portalData.groups) return null;
  const groupEntries = Object.entries(portalData.groups);
  // Large city WMOs use many interconnected groups and are better served by
  // the normal frustum culler; portal traversal is reserved for compact interiors.
  if (groupEntries.length > 64) return null;
  const markerMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...marker.position),
    marker.quaternion,
    new THREE.Vector3(marker.scale, marker.scale, marker.scale),
  );
  const localCamera = cameraPosition.clone().applyMatrix4(markerMatrix.clone().invert());
  const groupBounds = new Map();
  for (const mesh of asset.meshes || []) {
    const groupIndex = Number(mesh.groupIndex);
    if (groupIndex < 0 || !mesh.geometry?.boundingBox) continue;
    const bounds = groupBounds.get(groupIndex) || new THREE.Box3();
    bounds.union(mesh.geometry.boundingBox);
    groupBounds.set(groupIndex, bounds);
  }
  const containing = [...groupBounds.entries()]
    .filter(([, bounds]) => bounds.containsPoint(localCamera))
    .map(([groupIndex]) => groupIndex);
  if (!containing.length) return null;
  const interior = containing.find(groupIndex => (Number(asset.portalData.groups[groupIndex]?.flags) & 0x2000) !== 0);
  if (interior == null) return null;

  const visible = new Set(containing);
  let frontier = containing;
  for (let hop = 0; hop < 2; hop += 1) {
    const next = [];
    for (const groupIndex of frontier) {
      const group = portalData.groups[groupIndex];
      const start = Number(group?.portalRefStart) || 0;
      const end = start + (Number(group?.portalRefCount) || 0);
      for (let refIndex = start; refIndex < end; refIndex += 1) {
        const ref = portalData.refs[refIndex];
        if (!ref || ref.portalIndex < 0 || ref.portalIndex >= portalData.portals.length) continue;
        const otherGroup = Number(ref.groupIndex);
        if (!Number.isInteger(otherGroup) || visible.has(otherGroup)) continue;
        visible.add(otherGroup);
        next.push(otherGroup);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  for (const [groupIndex, group] of groupEntries) {
    if (Number(group?.flags) & 0x10000) visible.add(Number(groupIndex));
  }
  return visible;
}

const WMO_LIQUID_TILE_SIZE = 4.1666667;

function buildWmoLiquidGeometry(liquid) {
  const xverts = Number(liquid?.xverts) || 0;
  const yverts = Number(liquid?.yverts) || 0;
  const xtiles = Number(liquid?.xtiles) || 0;
  const ytiles = Number(liquid?.ytiles) || 0;
  const heights = liquid?.heights;
  if (xverts < 2 || yverts < 2 || xtiles !== xverts - 1 || ytiles !== yverts - 1 || !heights?.length) return null;
  const base = liquid.base || [0, 0, 0];
  const positions = [];
  const uvs = [];
  for (let y = 0; y < yverts; y += 1) {
    for (let x = 0; x < xverts; x += 1) {
      const fileX = base[0] + x * WMO_LIQUID_TILE_SIZE;
      const fileY = base[1] + y * WMO_LIQUID_TILE_SIZE;
      const height = Number(heights[x * yverts + y]);
      positions.push(fileY, base[2] + (Number.isFinite(height) ? height : 0), fileX);
      uvs.push(x / xtiles, y / ytiles);
    }
  }
  const indices = [];
  const flags = liquid.tileFlags || [];
  let visibleTiles = 0;
  for (let y = 0; y < ytiles; y += 1) {
    for (let x = 0; x < xtiles; x += 1) {
      const flag = flags[x * ytiles + y];
      if (flags.length && (flag & 0x3f) === 0) continue;
      visibleTiles += 1;
      const topLeft = y * xverts + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + xverts;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
    }
  }
  if (!visibleTiles) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function WmoLiquidBatch({ liquid, marker }) {
  const geometry = useMemo(() => buildWmoLiquidGeometry(liquid), [liquid]);
  const liquidTexture = useMemo(() => {
    if (!liquid.texture) return null;
    const texture = liquid.texture.clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }, [liquid.texture]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    map: liquidTexture,
    color: liquidTexture ? '#ffffff' : '#4d9fc4',
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }), [liquidTexture]);
  const matrix = useMemo(() => new THREE.Matrix4().compose(
    new THREE.Vector3(...marker.position),
    marker.quaternion,
    new THREE.Vector3(marker.scale, marker.scale, marker.scale),
  ), [marker]);
  useEffect(() => () => {
    geometry?.dispose();
    liquidTexture?.dispose();
    material.dispose();
  }, [geometry, liquidTexture, material]);
  useFrame((state) => {
    if (!liquidTexture) return;
    const time = state.clock.getElapsedTime();
    liquidTexture.offset.set(time * 0.006, time * -0.004);
    state.invalidate();
  });
  if (!geometry) return null;
  return <mesh geometry={geometry} material={material} matrix={matrix} matrixAutoUpdate={false} renderOrder={4} dispose={null} />;
}

export default function WmoPlacementLayer({ placements = [], resourceProfile = null, onPendingChange, onPriorityReady, onBatchCount }) {
  const wmoRequestConcurrency = resourceProfile?.wmoAssetConcurrency ?? WMO_REQUEST_CONCURRENCY;
  const doodadRequestConcurrency = resourceProfile?.doodadConcurrency ?? DOODAD_REQUEST_CONCURRENCY;
  const { camera, invalidate } = useThree();
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#d7a34a',
    transparent: true,
    opacity: 0.55,
    wireframe: true,
  }), []);
  const queueRef = useRef(new Map());
  const doodadQueueRef = useRef(new Map());
  const pumpingRef = useRef(false);
  const doodadPumpingRef = useRef(false);
  const lastCameraSignatureRef = useRef(null);
  const cacheRevisionRef = useRef(0);
  const [, setCacheTick] = useState(0);

  const publishPending = useCallback(() => {
    const rootPending = queueRef.current.size + getWmoPendingCount();
    onPendingChange?.(
      queueRef.current.size + doodadQueueRef.current.size + getWmoPendingCount() + getM2PathPendingCount(),
    );
    onPriorityReady?.(rootPending === 0);
  }, [onPendingChange, onPriorityReady]);

  useEffect(() => {
    const notify = () => {
      cacheRevisionRef.current += 1;
      setCacheTick(value => value + 1);
      invalidate();
      publishPending();
    };
    const unsubscribeWmo = subscribeWmoCache(notify);
    const unsubscribeM2 = subscribeM2PathCache(notify);
    publishPending();
    return () => {
      unsubscribeWmo();
      unsubscribeM2();
    };
  }, [invalidate, publishPending]);

  useEffect(() => {
    lastCameraSignatureRef.current = null;
    onPriorityReady?.(false);
    const activePaths = new Set(placements.map(placement => String(placement.path || '').toLowerCase()));
    for (const key of queueRef.current.keys()) {
      if (!activePaths.has(key.split('|')[0])) queueRef.current.delete(key);
    }
    if (!activePaths.size) doodadQueueRef.current.clear();
    pruneWmoAssetCache(placements.map(placement => placement.path));
    publishPending();
  }, [onPriorityReady, placements, publishPending]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  const markers = useMemo(() => placements.map((placement, index) => {
    const [x, y, z] = placement.position ?? [];
    const [rx, ry, rz] = placement.rotation ?? [];
    if (![x, y, z].every(Number.isFinite) || !placement.path) return null;
    const scale = Number.isFinite(placement.scale) && placement.scale > 0 ? placement.scale : 1;
    const position = adtPlacementToThree(x, y, z);
    return {
      key: placement.key ?? `${placement.tileKey ?? 'tile'}-${placement.path ?? 'wmo'}-${placement.uniqueId ?? index}`,
      path: placement.path,
      position,
      positionVector: new THREE.Vector3(...position),
      quaternion: adtPlacementQuaternion([rx, ry, rz]),
      scale: Math.max(0.35, Math.min(12, scale)),
      tileKey: placement.tileKey,
      doodadSet: Number.isInteger(placement.doodadSet) ? placement.doodadSet : 0,
    };
  }).filter(Boolean), [placements]);

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      const worker = async () => {
        while (queueRef.current.size) {
          const [key, modelPath] = queueRef.current.entries().next().value;
          queueRef.current.delete(key);
          publishPending();
          const request = key.split('|');
          await fetchWmoAsset(modelPath, { includeTextures: request[1] === 'textured' });
          publishPending();
        }
      };
      await Promise.all(Array.from({ length: wmoRequestConcurrency }, worker));
    } finally {
      pumpingRef.current = false;
      publishPending();
    }
  }, [publishPending, wmoRequestConcurrency]);

  const pumpDoodads = useCallback(async () => {
    if (doodadPumpingRef.current) return;
    doodadPumpingRef.current = true;
    try {
      const worker = async () => {
        while (doodadQueueRef.current.size) {
          const [key, modelPath] = doodadQueueRef.current.entries().next().value;
          doodadQueueRef.current.delete(key);
          publishPending();
          await fetchM2ModelByPath(modelPath);
          publishPending();
        }
      };
      await Promise.all(Array.from({ length: doodadRequestConcurrency }, worker));
    } finally {
      doodadPumpingRef.current = false;
      publishPending();
    }
  }, [doodadRequestConcurrency, publishPending]);

  const updateQueues = useCallback(() => {
    if (!markers.length) return;

    camera.updateMatrixWorld();
    const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const cameraDirection = camera.getWorldDirection(new THREE.Vector3());
    const signature = [
      cameraPosition.x, cameraPosition.y, cameraPosition.z,
      cameraDirection.x, cameraDirection.y, cameraDirection.z,
      cacheRevisionRef.current,
    ].map(value => Math.round(value * 100) / 100).join('|');
    if (lastCameraSignatureRef.current === signature) {
      if (queueRef.current.size) void pump();
      if (doodadQueueRef.current.size) void pumpDoodads();
      return;
    }
    lastCameraSignatureRef.current = signature;
    const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);

    const candidates = new Map();
    for (const marker of markers) {
      const distance = horizontalDistance(cameraPosition, marker.positionVector);
      if (distance > WMO_LOAD_DISTANCE) continue;
      const includeTextures = distance <= WMO_TEXTURE_DISTANCE;
      if (getWmoAssetState(marker.path, includeTextures) !== 'idle') continue;
      const inView = frustum.containsPoint(marker.positionVector);
      const priority = distance + (inView ? 0 : VIEW_PRIORITY_DISTANCE);
      const key = marker.path.toLowerCase();
      const previous = candidates.get(key);
      if (!previous || priority < previous.priority) {
        candidates.set(key, { path: marker.path, distance, priority, includeTextures });
      }
    }
    queueRef.current.clear();
    [...candidates.values()]
      .sort((a, b) => a.priority - b.priority || a.distance - b.distance)
      .forEach(candidate => queueRef.current.set(
        `${candidate.path.toLowerCase()}|${candidate.includeTextures ? 'textured' : 'geometry'}`,
        candidate.path,
      ));
    pruneWmoAssetCache(markers
      .filter(marker => horizontalDistance(cameraPosition, marker.positionVector) <= WMO_LOAD_DISTANCE)
      .map(marker => marker.path));

    const rootPending = queueRef.current.size + getWmoPendingCount();
    const doodadCandidates = new Map();
    if (!rootPending) {
      for (const marker of markers) {
        const asset = getCachedWmoAsset(marker.path);
        if (!asset) continue;
        const distance = horizontalDistance(cameraPosition, marker.positionVector);
        const inView = frustum.containsPoint(marker.positionVector);
        const priority = distance + (inView ? 0 : VIEW_PRIORITY_DISTANCE);
        for (const doodad of doodadsForAsset(asset, marker.doodadSet)) {
          if (!doodad?.path || getM2PathAssetState(doodad.path) !== 'idle') continue;
          if (distance > DOODAD_LOAD_DISTANCE) continue;
          const key = doodad.path.toLowerCase();
          const previous = doodadCandidates.get(key);
          if (!previous || priority < previous.priority) doodadCandidates.set(key, { path: doodad.path, distance, priority });
        }
        if (asset.skyboxPath && distance <= DOODAD_LOAD_DISTANCE && getM2PathAssetState(asset.skyboxPath) === 'idle') {
          const key = asset.skyboxPath.toLowerCase();
          const previous = doodadCandidates.get(key);
          if (!previous || priority < previous.priority) doodadCandidates.set(key, { path: asset.skyboxPath, distance, priority: priority - 1 });
        }
      }
    }
    doodadQueueRef.current.clear();
    [...doodadCandidates.values()]
      .sort((a, b) => a.priority - b.priority || a.distance - b.distance)
      .forEach(candidate => doodadQueueRef.current.set(candidate.path.toLowerCase(), candidate.path));

    publishPending();
    if (queueRef.current.size) void pump();
    if (doodadQueueRef.current.size) void pumpDoodads();
  }, [camera, markers, pump, pumpDoodads, publishPending]);

  useEffect(() => {
    lastCameraSignatureRef.current = null;
    updateQueues();
    const id = setInterval(updateQueues, 250);
    return () => clearInterval(id);
  }, [updateQueues]);

  const renderCameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const renderProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const renderFrustum = new THREE.Frustum().setFromProjectionMatrix(renderProjection);
  const rendered = markers
    .map(marker => {
      const distance = horizontalDistance(renderCameraPosition, marker.positionVector);
      return {
        marker,
        distance,
        // Never display the geometry-only fallback as a solid WMO. It is only
        // useful for cache warm-up and otherwise appears as a gray block.
        asset: getCachedWmoAsset(marker.path, true, false),
      };
    })
    .filter(item => item.distance <= WMO_RENDER_DISTANCE);
  const loaded = rendered.filter(item => item.asset?.meshes?.length && item.distance <= WMO_MID_DISTANCE);
  const proxies = rendered.filter(item => !item.asset?.meshes?.length || item.distance > WMO_MID_DISTANCE);
  const portalGroupsByMarker = new Map(loaded.map(({ marker, asset }) => [
    marker.key,
    getPortalVisibleGroups(marker, asset, renderCameraPosition),
  ]));
  const loadedDoodads = loaded.flatMap(({ marker, asset }) => {
    const markerMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...marker.position),
      marker.quaternion,
      new THREE.Vector3(marker.scale, marker.scale, marker.scale),
    );
    return doodadsForAsset(asset, marker.doodadSet, portalGroupsByMarker.get(marker.key)).map((doodad, index) => {
      const doodadAsset = getCachedM2AssetByPath(doodad.path);
      if (!doodadAsset?.geo) return null;
      const scale = Number.isFinite(doodad.scale) && doodad.scale > 0 ? doodad.scale : 1;
      const doodadMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...wmoDoodadToThree(doodad.position)),
        wmoDoodadQuaternion(doodad.rotation),
        new THREE.Vector3(scale, scale, scale),
      );
      const matrix = markerMatrix.clone().multiply(doodadMatrix);
      const bounds = doodadAsset.geo.boundingSphere?.clone().applyMatrix4(matrix);
      return {
        key: `${marker.key}:doodad:${doodad.uniqueId ?? index}`,
        marker,
        doodad,
        asset: doodadAsset,
        matrix,
        visible: !bounds || renderFrustum.intersectsSphere(bounds),
      };
    });
  }).filter(item => item
    && horizontalDistance(renderCameraPosition, item.marker.positionVector) <= DOODAD_RENDER_DISTANCE
    && item.visible);

  const loadedSkyboxes = loaded.flatMap(({ marker, asset }) => {
    if (!asset.skyboxPath || !isCameraInsideWmo(marker, asset, renderCameraPosition)) return [];
    const skyboxAsset = getCachedM2AssetByPath(asset.skyboxPath);
    if (!skyboxAsset?.geo) return [];
    const matrix = new THREE.Matrix4().compose(
      renderCameraPosition.clone(),
      new THREE.Quaternion(),
      new THREE.Vector3(2, 2, 2),
    );
    return [{ key: `${marker.key}:skybox`, marker, asset: skyboxAsset, matrix }];
  });
  const loadedLiquids = loaded.flatMap(({ marker, asset }) => (asset.liquids || [])
    .filter(liquid => {
      const visibleGroups = portalGroupsByMarker.get(marker.key);
      return !visibleGroups || visibleGroups.has(Number(liquid.groupIndex));
    })
    .map((liquid, index) => ({
    key: `${marker.key}:liquid:${liquid.groupIndex ?? index}`,
    marker,
    liquid,
    })));

  const wmoBatches = useMemo(() => {
    const grouped = new Map();
    for (const { marker, asset } of loaded) {
      const visibleGroups = portalGroupsByMarker.get(marker.key);
      const markerMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...marker.position),
        marker.quaternion,
        new THREE.Vector3(marker.scale, marker.scale, marker.scale),
      );
      for (const mesh of asset.meshes || []) {
        if (visibleGroups && mesh.groupIndex >= 0 && !visibleGroups.has(Number(mesh.groupIndex))) continue;
        if (mesh.geometry.boundingBox) {
          const worldBounds = mesh.geometry.boundingBox.clone().applyMatrix4(markerMatrix);
          if (!renderFrustum.intersectsBox(worldBounds)) continue;
        }
        const key = `${marker.path.toLowerCase()}:${marker.tileKey || 'global'}:${mesh.groupIndex}:${mesh.materialIndex}`;
        if (!grouped.has(key)) grouped.set(key, { key, mesh, instances: [] });
        grouped.get(key).instances.push(markerMatrix);
      }
    }
    return [...grouped.values()];
  }, [loaded]);

  const doodadBatches = useMemo(() => {
    const grouped = new Map();
    for (const { marker, doodad, asset, matrix } of loadedDoodads) {
          const key = `${doodad.path.toLowerCase()}:${marker.tileKey || 'global'}`;
      if (!grouped.has(key)) grouped.set(key, { key, asset, instances: [] });
      grouped.get(key).instances.push(matrix);
    }
    return [...grouped.values()];
  }, [loadedDoodads]);

  useEffect(() => {
    onBatchCount?.(wmoBatches.length + doodadBatches.length);
  }, [doodadBatches.length, onBatchCount, wmoBatches.length]);

  if (!markers.length) return null;
  return (
    <>
      <group name="wmo-placement-proxies">
        {proxies.map(({ marker, asset }) => (
          <mesh
            key={marker.key}
            geometry={geometry}
            material={material}
            userData={{ wmoPath: marker.path }}
            position={marker.position}
            quaternion={marker.quaternion}
            scale={getWmoProxySize(asset) * marker.scale}
            frustumCulled
          />
        ))}
      </group>
      <group name="wmo-placement-assets">
        {loadedLiquids.map(({ key, marker, liquid }) => (
          <WmoLiquidBatch key={key} liquid={liquid} marker={marker} />
        ))}
        {loadedDoodads.map(({ key, asset, matrix }) => asset.particleEmitters?.length ? (
          <DoodadParticleLayer key={`${key}:particles`} asset={asset} matrix={matrix} />
        ) : null)}
        {wmoBatches.map(({ key, mesh, instances }) => (
          <WmoMeshBatch key={key} mesh={mesh} instances={instances} />
        ))}
        {doodadBatches.map(({ key, asset, instances }) => (
          <DoodadBatch key={key} asset={asset} instances={instances} />
        ))}
        {loadedSkyboxes.map(({ key, asset, matrix }) => (
          <DoodadBatch key={key} asset={asset} instances={[matrix]} />
        ))}
      </group>
    </>
  );
}
