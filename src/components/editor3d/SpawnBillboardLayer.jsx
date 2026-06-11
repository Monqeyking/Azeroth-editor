import { useRef, useMemo, useEffect, useCallback, useState, useReducer } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { getSpawnPose, horizontalDistSq, BILLBOARD_LOD_DIST, MODEL_LOAD_DIST, useTerrainTick } from './spawnLod';
import { getCachedM2Asset, subscribeM2Cache } from './m2Loader';

const BILLBOARD_SQ = BILLBOARD_LOD_DIST * BILLBOARD_LOD_DIST;
const MODEL_SQ     = MODEL_LOAD_DIST    * MODEL_LOAD_DIST;
const LABEL_COUNT  = 30;
const MOVE_SQ      = 4;

const FACTION_COLOR = {
  hostile:  new THREE.Color('#e67e22'),
  alliance: new THREE.Color('#3498db'),
  horde:    new THREE.Color('#e74c3c'),
  critter:  new THREE.Color('#95a5a6'),
  friendly: new THREE.Color('#2ecc71'),
  default:  new THREE.Color('#9b59b6'),
};
const GO_COLOR  = new THREE.Color('#f1c40f');
const SEL_COLOR = new THREE.Color('#ffffff');
const _dummy    = new THREE.Object3D();

function spawnColor(spawn) {
  if (spawn.type === 'gameobject') return GO_COLOR;
  return FACTION_COLOR[String(spawn.faction ?? '').toLowerCase()] ?? FACTION_COLOR.default;
}

// Gedeelde geometrieën — nooit disposed
const CIRCLE_GEO = new THREE.CircleGeometry(0.75, 16);
const RING_GEO   = new THREE.RingGeometry(0.75, 0.93, 16);

// ─── Gecombineerde circle + ring mesh die elke frame billboard-oriëntatie bijhoudt ──
function BillboardMeshes({ entries, selectedId, hoveredGuid }) {
  const { camera } = useThree();
  const circleRef  = useRef();
  const ringRef    = useRef();
  const colorDirty = useRef(true);

  const circleMat = useMemo(
    () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
    []
  );
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    []
  );
  useEffect(() => () => { circleMat.dispose(); ringMat.dispose(); }, [circleMat, ringMat]);

  // Kleuren markeren als dirty bij wijziging
  useEffect(() => { colorDirty.current = true; }, [entries, selectedId, hoveredGuid]);

  useFrame(() => {
    const circle = circleRef.current;
    const ring   = ringRef.current;
    if (!circle || !ring || !entries.length) return;

    const q = camera.quaternion;

    for (let i = 0; i < entries.length; i++) {
      const [px, py, pz] = entries[i].pos;

      _dummy.position.set(px, py, pz);
      _dummy.quaternion.copy(q);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      circle.setMatrixAt(i, _dummy.matrix);

      _dummy.scale.setScalar(1.2);
      _dummy.updateMatrix();
      ring.setMatrixAt(i, _dummy.matrix);
    }
    circle.instanceMatrix.needsUpdate = true;
    ring.instanceMatrix.needsUpdate   = true;

    if (colorDirty.current) {
      for (let i = 0; i < entries.length; i++) {
        const { spawn } = entries[i];
        const c = (spawn.guid === selectedId || spawn.guid === hoveredGuid)
          ? SEL_COLOR
          : spawnColor(spawn);
        circle.setColorAt(i, c);
        ring.setColorAt(i, c);
      }
      circle.instanceColor.needsUpdate = true;
      ring.instanceColor.needsUpdate   = true;
      colorDirty.current = false;
    }
  });

  const n = entries.length;
  if (!n) return null;

  return (
    <>
      <instancedMesh ref={circleRef} args={[CIRCLE_GEO, circleMat, n]} frustumCulled={false} />
      <instancedMesh ref={ringRef}   args={[RING_GEO,   ringMat,   n]} frustumCulled={false} />
    </>
  );
}

// ─── Labels voor dichtstbijzijnde spawns ──────────────────────────────────────
function SpawnLabels({ entries, selectedId, hoveredGuid, camera }) {
  const labeled = useMemo(() => {
    const priority = [];
    const rest     = [];
    for (const e of entries) {
      if (e.spawn.guid === selectedId || e.spawn.guid === hoveredGuid) priority.push(e);
      else rest.push(e);
    }
    rest.sort((a, b) => horizontalDistSq(camera, a.pos) - horizontalDistSq(camera, b.pos));
    return [...priority, ...rest.slice(0, LABEL_COUNT)];
  }, [entries, selectedId, hoveredGuid, camera]);

  if (!labeled.length) return null;
  return (
    <>
      {labeled.map(({ spawn, pos }) => (
        <Text
          key={spawn.guid}
          position={[pos[0], pos[1] + 1.3, pos[2]]}
          fontSize={0.55}
          color="white"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.06}
          outlineColor="#000000"
        >
          {String(spawn.entry ?? spawn.id ?? '?')}
        </Text>
      ))}
    </>
  );
}

// ─── Eenvoudige ray-sphere picker (geen drie raycaster overhead) ──────────────
const _ray    = new THREE.Ray();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.0);
const _hit    = new THREE.Vector3();

function useSpawnPicker({ entries, onSelect, onHover, camera, gl }) {
  const ref = useRef(entries);
  ref.current = entries;

  useEffect(() => {
    const canvas = gl.domElement;

    function pick(e, isClick) {
      const rect = canvas.getBoundingClientRect();
      const nx =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const ny = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

      _ray.origin.setFromMatrixPosition(camera.matrixWorld);
      _ray.direction.set(nx, ny, 0.5).unproject(camera).sub(_ray.origin).normalize();

      let best = null, bestDSq = Infinity;
      for (const entry of ref.current) {
        _sphere.center.set(entry.pos[0], entry.pos[1], entry.pos[2]);
        if (!_ray.intersectSphere(_sphere, _hit)) continue;
        const dSq = _ray.origin.distanceToSquared(_hit);
        if (dSq < bestDSq) { bestDSq = dSq; best = entry; }
      }

      if (isClick) {
        onSelect(best?.spawn.guid ?? null);
      } else {
        onHover(best?.spawn.guid ?? null);
        canvas.style.cursor = best ? 'pointer' : 'default';
      }
    }

    const onClick = (e) => pick(e, true);
    const onMove  = (e) => pick(e, false);
    canvas.addEventListener('click',     onClick);
    canvas.addEventListener('mousemove', onMove);
    return () => {
      canvas.removeEventListener('click',     onClick);
      canvas.removeEventListener('mousemove', onMove);
      canvas.style.cursor = 'default';
    };
  }, [camera, gl, onSelect, onHover]);
}

// ─── Hoofd component ──────────────────────────────────────────────────────────
export default function SpawnBillboardLayer({ spawns, transforms, selectedId, onSelect }) {
  const { camera, gl } = useThree();
  const [hoveredGuid, setHoveredGuid] = useState(null);
  const [cacheTick,   setCacheTick]   = useState(0);
  const [tick,        bump]           = useReducer(n => n + 1, 0);
  const terrainTick = useTerrainTick();
  const lastPos = useRef({ x: Infinity, z: Infinity });

  useEffect(() => subscribeM2Cache(() => setCacheTick(t => t + 1)), []);

  useFrame(() => {
    const { x, z } = camera.position;
    const dx = x - lastPos.current.x;
    const dz = z - lastPos.current.z;
    if (dx * dx + dz * dz < MOVE_SQ) return;
    lastPos.current.x = x;
    lastPos.current.z = z;
    bump();
  });

  const entries = useMemo(() => {
    const result = [];
    for (const spawn of spawns) {
      if (spawn.guid === selectedId) continue;
      const { pos } = getSpawnPose(spawn, transforms);
      const dSq = horizontalDistSq(camera, pos);
      if (dSq > BILLBOARD_SQ) continue;
      // Creature met M2-model in model-range → door M2InstanceLayers
      if (spawn.type === 'creature' && spawn.displayId && getCachedM2Asset(spawn.displayId) && dSq <= MODEL_SQ) continue;
      result.push({ spawn, pos });
    }
    return result;
  }, [spawns, transforms, selectedId, tick, cacheTick, terrainTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = useCallback((guid) => onSelect(guid), [onSelect]);
  const handleHover  = useCallback((guid) => setHoveredGuid(guid), []);

  useSpawnPicker({ entries, onSelect: handleSelect, onHover: handleHover, camera, gl });

  return (
    <>
      <BillboardMeshes entries={entries} selectedId={selectedId} hoveredGuid={hoveredGuid} />
      <SpawnLabels     entries={entries} selectedId={selectedId} hoveredGuid={hoveredGuid} camera={camera} />
    </>
  );
}
