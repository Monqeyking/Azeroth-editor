import { useRef, useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Billboard, Text } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { wowToThree } from './wowCoords';
import { useM2Model, getCachedM2Asset, subscribeM2Asset } from './m2Loader';
import { getTerrainHeight } from './spawnLod';
import { useSpawnLod } from './spawnLod';

function M2Mesh({ asset, selected, hovered, onClick, onOver, onOut }) {
  const s = hovered ? 1.15 : 1.0;
  if (!asset?.geo) return null;
  return (
    <mesh
      geometry={asset.geo}
      scale={[s, s, s]}
      onClick={onClick}
      onPointerOver={onOver}
      onPointerOut={onOut}
    >
      {asset.texture
        ? <meshLambertMaterial map={asset.texture} side={THREE.DoubleSide} transparent alphaTest={0.1} color={selected ? '#aaddff' : 'white'} />
        : <meshLambertMaterial color={selected ? '#aaddff' : '#ccaa88'} side={THREE.DoubleSide} />
      }
    </mesh>
  );
}

const FACTION_COLOR = {
  hostile:  '#e67e22',
  alliance: '#3498db',
  horde:    '#e74c3c',
  critter:  '#95a5a6',
  friendly: '#2ecc71',
  default:  '#9b59b6',
};

function factionColor(spawn) {
  if (spawn.type === 'gameobject') return '#f1c40f';
  const f = String(spawn.faction ?? '').toLowerCase();
  return FACTION_COLOR[f] ?? FACTION_COLOR.default;
}

function SpawnPivot({ color, selected, hovered, onClick, onOver, onOut }) {
  const s = hovered ? 1.3 : selected ? 1.15 : 1.0;
  return (
    <mesh scale={[s, s, s]} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
      <sphereGeometry args={[0.28, 16, 12]} />
      <meshBasicMaterial color={selected ? '#fff' : color} />
    </mesh>
  );
}

function SpawnVisual({ color, selected, hovered, entry, compact, onClick, onOver, onOut }) {
  const s = (hovered ? 1.3 : selected ? 1.15 : 1.0) * (compact ? 0.72 : 1);
  const r = compact ? 0.52 : 0.75;
  return (
    <Billboard>
      <mesh scale={[s * 1.2, s * 1.2, 1]}>
        <ringGeometry args={[r, r + 0.18, 16]} />
        <meshBasicMaterial color={selected ? '#fff' : color} transparent opacity={selected ? 0.85 : compact ? 0.28 : 0.4} />
      </mesh>
      <mesh scale={[s, s, 1]} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
        <circleGeometry args={[r, 16]} />
        <meshBasicMaterial color={selected ? '#fff' : color} transparent opacity={compact ? 0.65 : 0.9} />
      </mesh>
      {!compact && (
        <Text
          position={[0, 1.3, 0]}
          fontSize={0.55}
          color="white"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.06}
          outlineColor="#000000"
        >
          {String(entry ?? '?')}
        </Text>
      )}
    </Billboard>
  );
}

function FixedAxis({ color, rotation, onPointerDown, onPointerMove, onPointerUp }) {
  return (
    <group
      rotation={rotation}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <mesh position={[0, 0.95, 0]} renderOrder={20}>
        <cylinderGeometry args={[0.025, 0.025, 1.9, 8]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 2.05, 0]} renderOrder={20}>
        <coneGeometry args={[0.13, 0.34, 16]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.0, 0]} visible={false}>
        <cylinderGeometry args={[0.2, 0.2, 2.25, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

function FixedMoveGizmo({ objectRef, visualRef, controls, onChange }) {
  const { camera, gl } = useThree();
  const gizmoRef = useRef(null);
  const dragRef = useRef(null);
  const plane = useMemo(() => new THREE.Plane(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const axisTmp = useMemo(() => new THREE.Vector3(), []);

  const endDrag = useCallback((e) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    e.target.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    if (controls) controls.enabled = true;
    gl.domElement.style.cursor = 'pointer';
  }, [controls, gl]);

  const moveDrag = useCallback((e) => {
    const drag = dragRef.current;
    const object = objectRef.current;
    if (!drag || !object) return;

    e.stopPropagation();
    if (!e.ray.intersectPlane(plane, hit)) return;

    const delta = hit.dot(drag.axis) - drag.startT;
    object.position.copy(drag.startPosition).addScaledVector(drag.axis, delta);
    visualRef.current?.position.copy(object.position);
    onChange?.();
  }, [hit, objectRef, onChange, plane, visualRef]);

  const startDrag = useCallback((axis) => (e) => {
    const object = objectRef.current;
    if (!object) return;

    e.stopPropagation();
    e.target.setPointerCapture?.(e.pointerId);
    if (controls) controls.enabled = false;
    gl.domElement.style.cursor = 'grabbing';

    const startPosition = object.position.clone();
    eye.copy(camera.position).sub(startPosition).normalize();

    axisTmp.copy(axis).multiplyScalar(eye.dot(axis));
    const planeNormal = eye.clone().sub(axisTmp);
    if (planeNormal.lengthSq() < 1e-6) {
      planeNormal.set(axis.y, axis.z, axis.x);
    }
    planeNormal.normalize();
    plane.setFromNormalAndCoplanarPoint(planeNormal, startPosition);
    e.ray.intersectPlane(plane, hit);

    dragRef.current = {
      axis: axis.clone(),
      startPosition,
      startT: hit.dot(axis),
    };
  }, [axisTmp, camera, controls, eye, gl, hit, objectRef, plane]);

  const axisX = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const axisY = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const axisZ = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  useFrame(() => {
    if (gizmoRef.current && objectRef.current) {
      gizmoRef.current.quaternion.copy(objectRef.current.quaternion).invert();
    }
  });

  return (
    <group ref={gizmoRef} scale={[1.8, 1.8, 1.8]}>
      <FixedAxis
        color="#ff3333"
        rotation={[0, 0, -Math.PI / 2]}
        onPointerDown={startDrag(axisX)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      />
      <FixedAxis
        color="#33ff33"
        rotation={[0, 0, 0]}
        onPointerDown={startDrag(axisY)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      />
      <FixedAxis
        color="#3388ff"
        rotation={[Math.PI / 2, 0, 0]}
        onPointerDown={startDrag(axisZ)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      />
    </group>
  );
}

function FixedRotateRing({ color, rotation, onPointerDown, onPointerMove, onPointerUp }) {
  return (
    <group rotation={rotation}>
      <mesh
        renderOrder={20}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <torusGeometry args={[1.55, 0.018, 8, 96]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
      </mesh>
      <mesh
        visible={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <torusGeometry args={[1.55, 0.16, 8, 64]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

function FixedRotateGizmo({ objectRef, visualRef, controls, onChange }) {
  const { gl } = useThree();
  const gizmoRef = useRef(null);
  const dragRef = useRef(null);
  const plane = useMemo(() => new THREE.Plane(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const startVector = useMemo(() => new THREE.Vector3(), []);
  const currentVector = useMemo(() => new THREE.Vector3(), []);
  const crossVector = useMemo(() => new THREE.Vector3(), []);

  const endDrag = useCallback((e) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    e.target.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    if (controls) controls.enabled = true;
    gl.domElement.style.cursor = 'pointer';
  }, [controls, gl]);

  const moveDrag = useCallback((e) => {
    const drag = dragRef.current;
    const object = objectRef.current;
    if (!drag || !object) return;

    e.stopPropagation();
    if (!e.ray.intersectPlane(plane, hit)) return;

    currentVector.copy(hit).sub(drag.center).normalize();
    const angle = Math.atan2(
      crossVector.copy(drag.startVector).cross(currentVector).dot(drag.axis),
      drag.startVector.dot(currentVector)
    );

    object.quaternion
      .copy(drag.startQuaternion)
      .premultiply(new THREE.Quaternion().setFromAxisAngle(drag.axis, angle));
    visualRef.current?.position.copy(object.position);
    onChange?.();
  }, [crossVector, currentVector, hit, objectRef, onChange, plane, visualRef]);

  const startDrag = useCallback((axis) => (e) => {
    const object = objectRef.current;
    if (!object) return;

    e.stopPropagation();
    e.target.setPointerCapture?.(e.pointerId);
    if (controls) controls.enabled = false;
    gl.domElement.style.cursor = 'grabbing';

    const center = object.position.clone();
    plane.setFromNormalAndCoplanarPoint(axis, center);
    if (!e.ray.intersectPlane(plane, hit)) return;

    startVector.copy(hit).sub(center).normalize();
    dragRef.current = {
      axis: axis.clone(),
      center,
      startVector: startVector.clone(),
      startQuaternion: object.quaternion.clone(),
    };
  }, [controls, gl, hit, objectRef, plane, startVector]);

  const axisX = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const axisY = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const axisZ = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  useFrame(() => {
    if (gizmoRef.current && objectRef.current) {
      gizmoRef.current.quaternion.copy(objectRef.current.quaternion).invert();
    }
  });

  return (
    <group ref={gizmoRef} scale={[1.5, 1.5, 1.5]}>
      <FixedRotateRing
        color="#ff3333"
        rotation={[0, Math.PI / 2, 0]}
        onPointerDown={startDrag(axisX)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      />
      <FixedRotateRing
        color="#33ff33"
        rotation={[Math.PI / 2, 0, 0]}
        onPointerDown={startDrag(axisY)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      />
      <FixedRotateRing
        color="#3388ff"
        rotation={[0, 0, 0]}
        onPointerDown={startDrag(axisZ)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
      />
    </group>
  );
}

function Editor3DSpawn({ spawn, selected, onSelect, activeTool, onTransform }) {
  const anchorRef    = useRef(null);
  const visualRef    = useRef(null);
  const [hovered, setHovered] = useState(false);
  const { gl, controls } = useThree();
  const lod = useSpawnLod(spawn.guid, selected);

  const isCreature = spawn.type === 'creature';
  const displayId = isCreature ? spawn.displayId : null;
  const inModelLod = lod === 'model';
  const inBillboardLod = lod === 'billboard';
  const isHidden = lod === 'hidden';

  const [m2Ready, setM2Ready] = useState(() => !!getCachedM2Asset(displayId));
  useEffect(() => subscribeM2Asset(displayId, () => setM2Ready(!!getCachedM2Asset(displayId))), [displayId]);
  const m2Asset = useM2Model(displayId, isCreature && inModelLod && selected);
  const instanced = isCreature && inModelLod && !selected && m2Ready;
  const renderM2Mesh = !!m2Asset && selected;
  const showBillboard = inBillboardLod || (inModelLod && !renderM2Mesh && !instanced);
  const showPivot = inModelLod && !renderM2Mesh && !instanced && isCreature;

  const showMoveGizmo = selected && activeTool === 'move';
  const showRotateGizmo = selected && activeTool === 'rotate';

  // Callback-ref: positie via Three.js zetten (voorkomt React-prop snap-back bij re-render).
  // De anchor zelf blijft vrij van billboarding; alleen de visual draait naar de camera.
  const attachAnchor = useCallback((node) => {
    anchorRef.current = node;
    if (node) {
      const th = getTerrainHeight(spawn.x, spawn.y);
      const [tx, ty, tz] = wowToThree(spawn.x, spawn.y, th ?? spawn.z);
      node.position.set(tx, ty, tz);
      visualRef.current?.position.set(tx, ty, tz);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const attachVisual = useCallback((node) => {
    visualRef.current = node;
    if (node) {
      const th = getTerrainHeight(spawn.x, spawn.y);
      const [tx, ty, tz] = wowToThree(spawn.x, spawn.y, th ?? spawn.z);
      node.position.set(tx, ty, tz);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cursor reset bij unmount
  useEffect(() => () => { gl.domElement.style.cursor = 'default'; }, [gl]);

  const handleClick = (e) => { e.stopPropagation(); onSelect(spawn.guid); };
  const handleOver  = (e) => { e.stopPropagation(); setHovered(true);  gl.domElement.style.cursor = 'pointer'; };
  const handleOut   = ()  => { setHovered(false); gl.domElement.style.cursor = 'default'; };
  const handleTransformChange = useCallback(() => {
    if (onTransform && anchorRef.current) {
      const { x, y, z }             = anchorRef.current.position;
      const { x: rx, y: ry, z: rz } = anchorRef.current.rotation;
      visualRef.current?.position.copy(anchorRef.current.position);
      onTransform(spawn.guid, { x, y, z }, { x: rx, y: ry, z: rz });
    }
  }, [onTransform, spawn.guid]);

  return (
    <>
      <group ref={attachAnchor}>
        {showPivot && (
          <SpawnPivot
            color={factionColor(spawn)}
            selected={selected}
            hovered={hovered}
            onClick={handleClick}
            onOver={handleOver}
            onOut={handleOut}
          />
        )}
        {showMoveGizmo && (
          <FixedMoveGizmo
            objectRef={anchorRef}
            visualRef={visualRef}
            controls={controls}
            onChange={handleTransformChange}
          />
        )}
        {showRotateGizmo && (
          <FixedRotateGizmo
            objectRef={anchorRef}
            visualRef={visualRef}
            controls={controls}
            onChange={handleTransformChange}
          />
        )}
      </group>

      {!isHidden && (
        <group ref={attachVisual}>
          {renderM2Mesh
            ? <M2Mesh
                asset={m2Asset}
                selected={selected}
                hovered={hovered}
                onClick={handleClick}
                onOver={handleOver}
                onOut={handleOut}
              />
            : showBillboard && !instanced && (
              <SpawnVisual
                color={factionColor(spawn)}
                selected={selected}
                hovered={hovered}
                entry={spawn.entry ?? spawn.id}
                compact={inBillboardLod}
                onClick={handleClick}
                onOver={handleOver}
                onOut={handleOut}
              />
            )
          }
        </group>
      )}
    </>
  );
}

export default memo(Editor3DSpawn);
