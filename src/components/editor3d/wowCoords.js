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
