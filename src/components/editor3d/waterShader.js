import * as THREE from 'three';

export const LIQUID_STYLES = {
  1: { color: '#3b9ed0', opacity: 0.48, flowSpeed: 0.34, waveAmplitude: 0.025 },
  2: { color: '#2d78ad', opacity: 0.5, flowSpeed: 0.58, waveAmplitude: 0.04 },
  3: { color: '#d15d2b', opacity: 0.78, flowSpeed: 0.16, waveAmplitude: 0.012 },
  4: { color: '#78a936', opacity: 0.62, flowSpeed: 0.22, waveAmplitude: 0.02 },
  5: { color: '#3b9ed0', opacity: 0.48, flowSpeed: 0.3, waveAmplitude: 0.025 },
};

export const WATER_FALLBACK_TEXTURE = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
})();

export const WATER_LIGHT_DIRECTION = new THREE.Vector3(0.45, 0.85, 0.35).normalize();

export const WATER_VERTEX = /* glsl */ `
uniform float time;
uniform float flowSpeed;
uniform float waveAmplitude;
varying vec2 vWaterUv;
varying vec3 vWaterWorldPosition;
varying vec3 vWaterNormal;

void main() {
  vWaterUv = uv;
  vec3 transformed = position;
  float waveArgA = (position.x * 0.08 + position.z * 0.06) + time * flowSpeed;
  float waveArgB = (position.x * 0.04 - position.z * 0.1) + time * flowSpeed * 0.7;
  float waveA = sin(waveArgA);
  float waveB = cos(waveArgB);
  transformed.y += (waveA + waveB * 0.45) * waveAmplitude;
  float slopeX = waveAmplitude * (0.08 * cos(waveArgA) - 0.018 * sin(waveArgB));
  float slopeZ = waveAmplitude * (0.06 * cos(waveArgA) + 0.045 * sin(waveArgB));
  vWaterNormal = normalize(mat3(modelMatrix) * normalize(vec3(-slopeX, 1.0, -slopeZ)));
  vWaterWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

export const WATER_FRAGMENT = /* glsl */ `
uniform vec3 waterColor;
uniform float opacity;
uniform float time;
uniform float flowSpeed;
uniform sampler2D waterTexture;
uniform float hasWaterTexture;
uniform vec3 lightDirection;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec2 vWaterUv;
varying vec3 vWaterWorldPosition;
varying vec3 vWaterNormal;

void main() {
  vec2 detailUvA = vWaterUv * 5.0 + vec2(time * flowSpeed * 0.18, -time * flowSpeed * 0.12);
  vec2 detailUvB = vWaterUv * 11.0 + vec2(-time * flowSpeed * 0.1, time * flowSpeed * 0.16);
  float detailA = sin((detailUvA.x + detailUvA.y) * 6.0) * 0.5 + 0.5;
  float detailB = cos((detailUvB.x - detailUvB.y) * 4.0 + detailA * 2.0) * 0.5 + 0.5;
  float detail = detailA * 0.55 + detailB * 0.45;
  vec3 normal = normalize(vWaterNormal);
  vec3 viewDirection = normalize(cameraPosition - vWaterWorldPosition);
  float facing = abs(dot(normal, viewDirection));
  float fresnel = pow(1.0 - facing, 2.2);
  vec3 baseColor = waterColor;
  float alpha = opacity;
  if (hasWaterTexture > 0.5) {
    vec4 textureA = sRGBTransferEOTF(texture2D(waterTexture, fract(detailUvA)));
    vec4 textureB = sRGBTransferEOTF(texture2D(waterTexture, fract(detailUvB)));
    baseColor = mix(textureA.rgb, textureB.rgb, 0.3);
    alpha *= mix(textureA.a, textureB.a, 0.3);
  }
  vec3 deepColor = baseColor * vec3(0.52, 0.76, 1.12);
  vec3 surfaceColor = baseColor * vec3(1.12, 1.08, 0.94);
  vec3 layeredColor = mix(deepColor, surfaceColor, 0.28 + detail * 0.42);
  layeredColor = mix(layeredColor, vec3(0.65, 0.9, 1.0), fresnel * 0.34);
  float diffuse = 0.78 + max(dot(normal, normalize(lightDirection)), 0.0) * 0.22;
  float specular = pow(max(dot(reflect(-normalize(lightDirection), normal), viewDirection), 0.0), 28.0);
  layeredColor *= diffuse;
  layeredColor += vec3(0.72, 0.9, 1.0) * specular * (0.18 + fresnel * 0.5);
  float fogAmount = smoothstep(fogNear, fogFar, distance(cameraPosition, vWaterWorldPosition));
  layeredColor = mix(layeredColor, fogColor, fogAmount);
  gl_FragColor = linearToOutputTexel(vec4(layeredColor, alpha * (0.9 + fresnel * 0.1)));
}
`;
