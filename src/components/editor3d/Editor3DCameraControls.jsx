import { useEffect, useRef, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { cameraInput } from './cameraInputState';
import { getTerrainHeight } from './terrainHeight';

const FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);
const NOGGIT_CAMERA_SPEEDS = { '1': 15, '2': 50, '3': 200, '4': 800 };
const DEFAULT_CAMERA_SPEED = 200.6;
const MOUSE_LOOK_SENSITIVITY = 0.0025;
const GROUND_CLEARANCE = 3;
const MAX_CAMERA_ABOVE_GROUND = 500;

function getWmoFloorHeight(entries, x, z, cameraY) {
  if (!Array.isArray(entries) || !entries.length) return null;
  let floor = null;
  for (const entry of entries) {
    if (x < entry.minX || x > entry.maxX || z < entry.minZ || z > entry.maxZ) continue;
    // Do not catch the camera from above a WMO roof. Once it enters the
    // loaded WMO volume, the highest matching floor becomes the clamp.
    if (cameraY > entry.maxY + 8) continue;
    if (floor == null || entry.floorY > floor) floor = entry.floorY;
  }
  return floor;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function setFlyKey(key, down) {
  const k = key.toLowerCase();
  if (k === 'w') cameraInput.keys.forward = down;
  if (k === 's') cameraInput.keys.back = down;
  if (k === 'a') cameraInput.keys.left = down;
  if (k === 'd') cameraInput.keys.right = down;
  if (k === 'q') cameraInput.keys.down = down;
  if (k === 'e') cameraInput.keys.up = down;
}

export function useAltHeld() {
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const onDown = (e) => { if (e.key === 'Alt') setAltHeld(true); };
    const onUp = (e) => { if (e.key === 'Alt') setAltHeld(false); };
    const onBlur = () => setAltHeld(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return altHeld;
}

export function CameraFlyControls({
  terrainClamp = true,
  maxAboveGround = MAX_CAMERA_ABOVE_GROUND,
  wmoCollisionRef = null,
}) {
  const { camera, controls, gl, invalidate } = useThree();
  const rightDown = useRef(false);
  const lastPointer = useRef(null);
  const speedRef = useRef(DEFAULT_CAMERA_SPEED);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const move = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const el = gl.domElement;
    const preventMenu = (e) => e.preventDefault();

    const onPointerDown = (e) => {
      if (e.button !== 2) return;
      rightDown.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      cameraInput.flyActive = true;
      el.setPointerCapture?.(e.pointerId);
      invalidate();
    };
    const onPointerUp = (e) => {
      if (e.type !== 'pointercancel' && e.button !== 2) return;
      rightDown.current = false;
      lastPointer.current = null;
      cameraInput.flyActive = false;
      el.releasePointerCapture?.(e.pointerId);
      invalidate();
    };
    const onPointerMove = (e) => {
      if (!rightDown.current || !controls) return;
      const previous = lastPointer.current || { x: e.clientX, y: e.clientY };
      const dx = e.clientX - previous.x;
      const dy = e.clientY - previous.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      if (!dx && !dy) return;

      const targetDistance = Math.max(camera.position.distanceTo(controls.target), 8);
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      euler.y -= dx * MOUSE_LOOK_SENSITIVITY;
      euler.x = THREE.MathUtils.clamp(
        euler.x - dy * MOUSE_LOOK_SENSITIVITY,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01,
      );
      camera.quaternion.setFromEuler(euler);
      camera.getWorldDirection(forward);
      controls.target.copy(camera.position).addScaledVector(forward, targetDistance);
      controls.update();
      invalidate();
    };
    const onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (e.shiftKey && NOGGIT_CAMERA_SPEEDS[key] != null) {
        if (e.repeat) return;
        e.preventDefault();
        speedRef.current = NOGGIT_CAMERA_SPEEDS[key];
        invalidate();
        return;
      }
      if (key === 'o' || key === 'p') {
        if (e.repeat) return;
        e.preventDefault();
        speedRef.current *= key === 'o' ? 0.5 : 2;
        invalidate();
        return;
      }
      if (!FLY_KEYS.has(key)) return;
      if (!rightDown.current) return;
      e.preventDefault();
      setFlyKey(e.key, true);
      invalidate();
    };
    const onKeyUp = (e) => {
      if (!FLY_KEYS.has(e.key.toLowerCase())) return;
      setFlyKey(e.key, false);
      invalidate();
    };
    const clearFly = () => {
      rightDown.current = false;
      lastPointer.current = null;
      cameraInput.flyActive = false;
      Object.keys(cameraInput.keys).forEach(k => { cameraInput.keys[k] = false; });
    };

    el.addEventListener('contextmenu', preventMenu);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('pointermove', onPointerMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearFly);
    return () => {
      el.removeEventListener('contextmenu', preventMenu);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearFly);
      clearFly();
    };
  }, [controls, gl, invalidate]);

  useFrame((state, delta) => {
    if (!controls) return;
    const { forward: f, back, left, right: r, down, up } = cameraInput.keys;
    if (rightDown.current && (f || back || left || r || down || up)) {
      // Do not compensate for a blocked render frame: that turns a short load hitch
      // into a large camera jump after the frame resumes.
      const speed = speedRef.current * Math.min(delta, 1 / 30);

      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
      forward.normalize();

      right.crossVectors(forward, camera.up).normalize();

      move.set(0, 0, 0);
      if (f) move.add(forward);
      if (back) move.sub(forward);
      if (r) move.add(right);
      if (left) move.sub(right);
      if (up) move.y += 1;
      if (down) move.y -= 1;

      if (move.lengthSq() >= 1e-8) {
        move.normalize().multiplyScalar(speed);
        camera.position.add(move);
        controls.target.add(move);
        controls.update();
        state.invalidate();
      }
    }

    if (terrainClamp) {
      const ground = getTerrainHeight(-camera.position.z, -camera.position.x);
      const wmoFloor = getWmoFloorHeight(
        wmoCollisionRef?.current,
        camera.position.x,
        camera.position.z,
        camera.position.y,
      );
      const collisionGround = Math.max(
        ground == null ? -Infinity : ground,
        wmoFloor == null ? -Infinity : wmoFloor,
      );
      const minCameraY = Number.isFinite(collisionGround)
        ? collisionGround + GROUND_CLEARANCE
        : null;
      const maxCameraY = ground == null || maxAboveGround == null
        ? null
        : ground + Math.max(GROUND_CLEARANCE, maxAboveGround);
      if (minCameraY != null && camera.position.y < minCameraY) {
        const lift = minCameraY - camera.position.y;
        camera.position.y += lift;
        controls.target.y += lift;
        controls.update();
        state.invalidate();
      } else if (maxCameraY != null && camera.position.y > maxCameraY) {
        const drop = camera.position.y - maxCameraY;
        camera.position.y -= drop;
        controls.target.y -= drop;
        controls.update();
        state.invalidate();
      }
    }
  });

  return null;
}

export function CameraFrameFocus({ target, focusTick }) {
  const { camera, controls } = useThree();
  const anim = useRef(null);
  const offsetDir = useMemo(() => new THREE.Vector3(), []);
  const toPos = useMemo(() => new THREE.Vector3(), []);
  const toTarget = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!target || !controls || focusTick == null || focusTick === 0) return;

    const [tx, ty, tz] = target;
    toTarget.set(tx, ty, tz);

    offsetDir.copy(camera.position).sub(controls.target);
    let dist = offsetDir.length();
    if (dist < 12) {
      offsetDir.set(0.45, 0.35, 0.85);
      dist = 28;
    } else {
      dist = THREE.MathUtils.clamp(dist, 18, 120);
    }
    offsetDir.normalize().multiplyScalar(dist);
    toPos.copy(toTarget).add(offsetDir);

    anim.current = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: toPos.clone(),
      toTarget: toTarget.clone(),
      t: 0,
      duration: 0.4,
    };
  }, [target, focusTick, controls, camera, offsetDir, toPos, toTarget]);

  useFrame((state, delta) => {
    const a = anim.current;
    if (!a || !controls) return;

    a.t += delta / a.duration;
    const k = easeOutCubic(Math.min(1, a.t));

    camera.position.lerpVectors(a.fromPos, a.toPos, k);
    controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
    controls.update();

    if (k < 1) state.invalidate(); // doorgaan tot animatie klaar is
    else anim.current = null;
  });

  return null;
}
