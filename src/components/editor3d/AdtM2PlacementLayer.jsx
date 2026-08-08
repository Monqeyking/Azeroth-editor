import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  adtPlacementQuaternion,
  adtPlacementToThree,
} from './wowCoords';
import {
  fetchM2ModelByPath,
  getCachedM2AssetByPath,
  getM2Material,
  getM2PathAssetState,
  getM2PathPendingCount,
  pruneM2PathAssetCache,
  subscribeM2PathCache,
} from './m2Loader';

const LOAD_DISTANCE = 720;
const RENDER_DISTANCE = 420;
const VIEW_PRIORITY_DISTANCE = 360;
const REQUEST_CONCURRENCY = 4;

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function M2InstanceBatch({ asset, instances }) {
  const ref = useRef(null);
  const material = useMemo(() => getM2Material(asset), [asset]);

  useEffect(() => {
    if (!ref.current) return;
    instances.forEach((matrix, index) => ref.current.setMatrixAt(index, matrix));
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [instances]);

  return (
    <instancedMesh
      ref={ref}
      args={[asset.geo, material, instances.length]}
      frustumCulled
      dispose={null}
    />
  );
}

export default function AdtM2PlacementLayer({ placements = [], resourceProfile = null, onPendingChange, onBatchCount, wmoPriorityReady = true }) {
  const requestConcurrency = resourceProfile?.m2RequestConcurrency ?? REQUEST_CONCURRENCY;
  const { camera, invalidate } = useThree();
  const queueRef = useRef(new Map());
  const pumpingRef = useRef(false);
  const lastCameraSignatureRef = useRef(null);
  const cacheRevisionRef = useRef(0);
  const [, setCacheTick] = useState(0);

  const publishPending = useCallback(() => {
    onPendingChange?.(queueRef.current.size + getM2PathPendingCount());
  }, [onPendingChange]);

  useEffect(() => {
    const notify = () => {
      cacheRevisionRef.current += 1;
      setCacheTick(value => value + 1);
      invalidate();
      publishPending();
    };
    const unsubscribe = subscribeM2PathCache(notify);
    publishPending();
    return unsubscribe;
  }, [invalidate, publishPending]);

  useEffect(() => {
    lastCameraSignatureRef.current = null;
    const activePaths = new Set(placements.map(placement => String(placement.path || '').toLowerCase()));
    for (const key of queueRef.current.keys()) if (!activePaths.has(key)) queueRef.current.delete(key);
    pruneM2PathAssetCache(placements.map(placement => placement.path));
    publishPending();
  }, [placements, publishPending]);

  const markers = useMemo(() => placements.map((placement, index) => {
    const [x, y, z] = placement.position ?? [];
    const [rx, ry, rz] = placement.rotation ?? [];
    if (![x, y, z].every(Number.isFinite) || !placement.path) return null;
    const scale = Number.isFinite(placement.scale) && placement.scale > 0 ? placement.scale : 1;
    const position = adtPlacementToThree(x, y, z);
    return {
      key: placement.key ?? `${placement.tileKey ?? 'tile'}-${placement.path}-${placement.uniqueId ?? index}`,
      path: placement.path,
      position,
      positionVector: new THREE.Vector3(...position),
      quaternion: adtPlacementQuaternion([rx, ry, rz], 180),
      scale: Math.max(0.05, Math.min(20, scale)),
      tileKey: placement.tileKey,
      uniqueId: placement.uniqueId,
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
          await fetchM2ModelByPath(modelPath);
          publishPending();
        }
      };
      await Promise.all(Array.from({ length: requestConcurrency }, worker));
    } finally {
      pumpingRef.current = false;
      publishPending();
    }
  }, [publishPending, requestConcurrency]);

  const updateQueues = useCallback(() => {
    if (!markers.length) return;
    if (!wmoPriorityReady) {
      queueRef.current.clear();
      publishPending();
      return;
    }

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
      return;
    }
    lastCameraSignatureRef.current = signature;
    const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);

    const candidates = new Map();
    for (const marker of markers) {
      if (getM2PathAssetState(marker.path) !== 'idle') continue;
      const distance = horizontalDistance(cameraPosition, marker.positionVector);
      if (distance > LOAD_DISTANCE) continue;
      const inView = frustum.containsPoint(marker.positionVector);
      const priority = distance + (inView ? 0 : VIEW_PRIORITY_DISTANCE);
      const key = marker.path.toLowerCase();
      const previous = candidates.get(key);
      if (!previous || priority < previous.priority) candidates.set(key, { path: marker.path, distance, priority });
    }
    queueRef.current.clear();
    [...candidates.values()]
      .sort((a, b) => a.priority - b.priority || a.distance - b.distance)
      .forEach(candidate => queueRef.current.set(candidate.path.toLowerCase(), candidate.path));
    publishPending();
    if (queueRef.current.size) void pump();
  }, [camera, markers, pump, publishPending, wmoPriorityReady]);

  useEffect(() => {
    lastCameraSignatureRef.current = null;
    updateQueues();
    const id = setInterval(updateQueues, 250);
    return () => clearInterval(id);
  }, [updateQueues]);

  const renderCameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const rendered = markers
    .filter(marker => horizontalDistance(renderCameraPosition, marker.positionVector) <= RENDER_DISTANCE)
    .map(marker => ({ marker, asset: getCachedM2AssetByPath(marker.path) }));
  const batches = useMemo(() => {
    const grouped = new Map();
    for (const { marker, asset } of rendered) {
      if (!asset?.geo) continue;
      const key = `${marker.path.toLowerCase()}:${marker.tileKey || 'global'}`;
      if (!grouped.has(key)) grouped.set(key, { key, asset, instances: [] });
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...marker.position),
        marker.quaternion,
        new THREE.Vector3(marker.scale, marker.scale, marker.scale),
      );
      grouped.get(key).instances.push(matrix);
    }
    return [...grouped.values()];
  }, [rendered]);

  useEffect(() => {
    onBatchCount?.(batches.length);
  }, [batches.length, onBatchCount]);

  return (
    <group name="adt-m2-placement-assets">
      {batches.map(({ key, asset, instances }) => (
        <M2InstanceBatch
          key={key}
          asset={asset}
          instances={instances}
        />
      ))}
    </group>
  );
}
