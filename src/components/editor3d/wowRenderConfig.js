import * as THREE from 'three';

export const WOW_FOG_COLOR = '#1a1a2e';
export const WOW_FOG_NEAR = 700;
export const WOW_FOG_FAR = 1350;
export const WOW_SUN_POSITION = [50, 80, 30];
export const WOW_SUN_DIRECTION = new THREE.Vector3(-50, -80, -30).normalize();
export const WOW_AMBIENT_COLOR = new THREE.Vector3(0.46, 0.46, 0.46);
export const WOW_LIGHT_COLOR = new THREE.Vector3(0.92, 0.88, 0.78);
export const WOW_SUN_COLOR = '#fff4dc';

export function configureWowRenderer(gl) {
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.NoToneMapping;
  gl.toneMappingExposure = 1;
}

export function configureWowColorTexture(texture) {
  if (!texture) return texture;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
