import { useEffect, useRef, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { cameraInput } from './cameraInputState';

const FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

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

export function CameraFlyControls() {
  const { camera, controls, gl } = useThree();
  const rightDown = useRef(false);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const move = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const el = gl.domElement;
    const preventMenu = (e) => e.preventDefault();

    const onPointerDown = (e) => {
      if (e.button !== 2) return;
      rightDown.current = true;
      cameraInput.flyActive = true;
      el.setPointerCapture?.(e.pointerId);
    };
    const onPointerUp = (e) => {
      if (e.button !== 2) return;
      rightDown.current = false;
      cameraInput.flyActive = false;
      el.releasePointerCapture?.(e.pointerId);
    };
    const onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (!FLY_KEYS.has(e.key.toLowerCase())) return;
      if (!rightDown.current) return;
      e.preventDefault();
      setFlyKey(e.key, true);
    };
    const onKeyUp = (e) => {
      if (!FLY_KEYS.has(e.key.toLowerCase())) return;
      setFlyKey(e.key, false);
    };
    const clearFly = () => {
      rightDown.current = false;
      cameraInput.flyActive = false;
      Object.keys(cameraInput.keys).forEach(k => { cameraInput.keys[k] = false; });
    };

    el.addEventListener('contextmenu', preventMenu);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearFly);
    return () => {
      el.removeEventListener('contextmenu', preventMenu);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearFly);
      clearFly();
    };
  }, [gl]);

  useFrame((state, delta) => {
    if (!controls || !rightDown.current) return;
    const { forward: f, back, left, right: r, down, up } = cameraInput.keys;
    if (!f && !back && !left && !r && !down && !up) return;

    const dist = Math.max(camera.position.distanceTo(controls.target), 8);
    const speed = dist * 2.2 * delta;

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

    if (move.lengthSq() < 1e-8) return;
    move.normalize().multiplyScalar(speed);

    camera.position.add(move);
    controls.target.add(move);
    controls.update();
    state.invalidate(); // vraag volgende frame aan voor continue fly-beweging
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
