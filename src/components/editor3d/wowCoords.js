export function wowToThree(x, y, z) {
  return [-y, z, x];
}

export function threeToWow(tx, ty, tz) {
  return { x: tz, y: -tx, z: ty };
}
