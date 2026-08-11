import * as THREE from 'three';

const TILE_SIZE = 533.33333;
const WORLD_HALF = 32 * TILE_SIZE;

export function wowToThree(x, y, z) {
  return [-y, z, -x];
}

export function threeToWow(tx, ty, tz) {
  return { x: -tz, y: -tx, z: ty };
}

export function adtPlacementToThree(x, y, z) {
  return [x - WORLD_HALF, y, z - WORLD_HALF];
}

export function adtPlacementQuaternion([rx = 0, ry = 0, rz = 0], yawOffset = 0) {
  const deg = Math.PI / 180;
  const internal = new THREE.Matrix4()
    .makeRotationZ((ry + yawOffset) * deg)
    .multiply(new THREE.Matrix4().makeRotationY(rx * deg))
    .multiply(new THREE.Matrix4().makeRotationX(rz * deg));
  const basis = new THREE.Matrix4().set(
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(
    basis.clone().multiply(internal).multiply(basis.clone().transpose()),
  );
}

export function adtPlacementRotationFromEuler(euler, yawOffset = 0) {
  const deg = 180 / Math.PI;
  const basis = new THREE.Matrix4().set(
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  );
  const internal = basis.clone()
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...euler)))
    .multiply(basis.clone().transpose());
  const angles = new THREE.Euler().setFromRotationMatrix(internal, 'ZYX');
  return [angles.y * deg, angles.z * deg - yawOffset, angles.x * deg];
}

export function wmoDoodadQuaternionFromThree(quaternion) {
  const basis = new THREE.Matrix4().set(
    0, 1, 0, 0,
    0, 0, 1, 0,
    1, 0, 0, 0,
    0, 0, 0, 1,
  );
  const raw = basis.clone().transpose()
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(quaternion))
    .multiply(basis);
  return new THREE.Quaternion().setFromRotationMatrix(raw).toArray();
}
