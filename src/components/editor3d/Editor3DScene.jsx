import { Suspense, useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { CameraFlyControls, CameraFrameFocus, useAltHeld } from './Editor3DCameraControls';
import { threeToWow } from './wowCoords';
import { cameraInput } from './cameraInputState';
import { LIQUID_STYLES, WATER_FALLBACK_TEXTURE, WATER_FRAGMENT, WATER_LIGHT_DIRECTION, WATER_VERTEX } from './waterShader';
import {
  WOW_AMBIENT_COLOR,
  WOW_FOG_COLOR,
  WOW_FOG_FAR,
  WOW_FOG_NEAR,
  WOW_LIGHT_COLOR,
  WOW_SUN_COLOR,
  WOW_SUN_POSITION,
  WOW_SUN_DIRECTION,
  configureWowRenderer,
} from './wowRenderConfig';
import WmoPlacementLayer from './WmoPlacementLayer';
import AdtM2PlacementLayer from './AdtM2PlacementLayer';
import Editor3DSpawn from './Editor3DSpawn';

const UNIT_SIZE = 33.33333 / 8;
const TILE_SIZE = UNIT_SIZE * 128;
const START_CAMERA_HEIGHT = 400;
const START_CAMERA_DISTANCE = 420;
const START_CAMERA_YAW = -Math.PI * (2 / 3);

function startCameraPosition(tx = 0, ty = 0, tz = 0) {
  return [
    tx + Math.sin(START_CAMERA_YAW) * START_CAMERA_DISTANCE,
    ty + START_CAMERA_HEIGHT,
    tz + Math.cos(START_CAMERA_YAW) * START_CAMERA_DISTANCE,
  ];
}

function GridFloor() {
  return <gridHelper args={[200, 40, '#444455', '#2a2a3a']} position={[0, 0, 0]} />;
}
function AxesHelper() { return <axesHelper args={[10]} />; }
function Lights() {
  return (
    <>
      <ambientLight color={WOW_SUN_COLOR} intensity={0.46} />
      <directionalLight position={WOW_SUN_POSITION} color={WOW_SUN_COLOR} intensity={0.92} />
    </>
  );
}

function CameraSetup({ target }) {
  const { camera, controls } = useThree();
  const prev = useRef(null);

  useEffect(() => {
    if (!target || !controls) return;
    const key = target.join(',');
    if (prev.current === key) return;
    prev.current = key;
    const [tx, ty, tz] = target;
    camera.position.set(...startCameraPosition(tx, ty, tz));
    controls.target.set(tx, ty + 40, tz);
    controls.update();
  }, [target, controls, camera]);

  return null;
}

// Hoogte → RGB kleur (blauw/water → groen/gras → grijs/steen → wit/sneeuw)
function heightColor(h, out, off) {
  let r, g, b;
  if (h < 0) {
    // Blauw (water / onder zeeniveau)
    const t = Math.max(0, (h + 300) / 300);
    r = 0.05 + t * 0.05; g = 0.15 + t * 0.2; b = 0.55 + t * 0.2;
  } else if (h < 350) {
    // Groen (gras)
    const t = h / 350;
    r = 0.1  + t * 0.2;  g = 0.45 - t * 0.05; b = 0.1;
  } else if (h < 900) {
    // Grijs (steen)
    const t = (h - 350) / 550;
    r = 0.3  + t * 0.3;  g = 0.4  - t * 0.05; b = 0.1 + t * 0.3;
  } else {
    // Wit (sneeuw)
    const t = Math.min(1, (h - 900) / 600);
    r = 0.6  + t * 0.35; g = 0.65 + t * 0.3;  b = 0.4 + t * 0.55;
  }
  out[off] = r; out[off + 1] = g; out[off + 2] = b;
}

function buildTileGeometry(tile) {
  if (!tile?.v9) return null;
  const { tileX, tileY, v9, v8 } = tile;
  const OG = 129, IG = 128;
  const V9C = OG * OG, V8C = IG * IG;

  const pos = new Float32Array((V9C + V8C) * 3);
  const col = new Float32Array((V9C + V8C) * 3);
  const uv  = new Float32Array((V9C + V8C) * 2);

  const wowBaseY = (32 - tileY) * TILE_SIZE;
  const wowBaseX = (32 - tileX) * TILE_SIZE;

  for (let vy = 0; vy < OG; vy++) {
    for (let vx = 0; vx < OG; vx++) {
      const vi = vy * OG + vx;
      const h  = Math.min(3000, Math.max(-500, v9[vy * OG + vx]));
      // .map/ADT rows run along WoW X; columns run along WoW Y.
      // Three.js uses [-WoW Y, WoW Z, -WoW X].
      pos[vi * 3]     = -(wowBaseY - vx * UNIT_SIZE);
      pos[vi * 3 + 1] = h;
      pos[vi * 3 + 2] = -(wowBaseX - vy * UNIT_SIZE);
      heightColor(h, col, vi * 3);
      uv[vi * 2] = vx / 128; uv[vi * 2 + 1] = vy / 128;
    }
  }

  for (let vy = 0; vy < IG; vy++) {
    for (let vx = 0; vx < IG; vx++) {
      const ii = vy * IG + vx, vi = V9C + ii;
      const h  = Math.min(3000, Math.max(-500, v8[vy * IG + vx]));
      pos[vi * 3]     = -(wowBaseY - (vx + 0.5) * UNIT_SIZE);
      pos[vi * 3 + 1] = h;
      pos[vi * 3 + 2] = -(wowBaseX - (vy + 0.5) * UNIT_SIZE);
      heightColor(h, col, vi * 3);
      uv[vi * 2] = (vx + 0.5) / 128; uv[vi * 2 + 1] = (vy + 0.5) / 128;
    }
  }

  const idx = new Uint32Array(128 * 128 * 12);
  let p = 0;

  for (let row = 0; row < 128; row++) {
    for (let c = 0; c < 128; c++) {
      const chunkX = c >> 3;
      const chunkY = row >> 3;
      const holeMask = tile.holes?.[chunkY * 16 + chunkX] ?? 0;
      const holeBit = ((row & 7) >> 1) * 4 + ((c & 7) >> 1);
      if (holeMask & (1 << holeBit)) continue;
      const tl = row * OG + c, tr = tl + 1;
      const bl = tl + OG,      br = bl + 1;
      const ct = V9C + row * IG + c;
      idx[p++] = tl; idx[p++] = ct; idx[p++] = tr;
      idx[p++] = tr; idx[p++] = ct; idx[p++] = br;
      idx[p++] = br; idx[p++] = ct; idx[p++] = bl;
      idx[p++] = bl; idx[p++] = ct; idx[p++] = tl;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, p), 1));
  geo.computeVertexNormals();
  return geo;
}

function InvalidateExporter({ invalidateRef }) {
  const { invalidate } = useThree();
  useEffect(() => { if (invalidateRef) invalidateRef.current = invalidate; }, [invalidate, invalidateRef]);
  return null;
}

// GPU shader-based terrain texture blending — vervangt de oude CPU pre-compositing aanpak
// (die resolutie-gelimiteerd was bij 8x per-chunk tiling, zie git-history). Elke MCNK chunk
// tegelt zijn texture-layers onafhankelijk 8x; de blend-formule is exact Noggit's
// terrain_frag.glsl texture_blend(): t0*(1-(a0+a1+a2)) + t1*a0 + t2*a1 + t3*a2.
//
// vUv2 is de continue "unit"-coördinaat over de hele tile (0..128, want 16 chunks * 8 units).
// chunkIndex wordt per-fragment berekend (floor(u/8)*16+floor(v/8)) i.p.v. als vertex-attribuut
// doorgegeven — dat voorkomt ambiguïteit op chunk-grens-vertices die door 2 chunks gedeeld worden.
const TERRAIN_VERT = /* glsl */ `
out vec2 vUv2;
out vec3 vWorldNormal;
out vec3 vWorldPosition;

void main() {
  vUv2 = uv * 128.0;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TERRAIN_FRAG = /* glsl */ `
precision highp float;
precision highp int;

uniform sampler2D chunkTexIndexMap; // 256x1, RGBA32F: layer0..3 palette-slot (-1 = ongebruikt)
uniform sampler2DArray paletteArray;
uniform sampler2DArray alphaArray;
uniform vec3 ambientColor;
uniform vec3 lightDir;
uniform vec3 lightColor;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

in vec2 vUv2;
in vec3 vWorldNormal;
in vec3 vWorldPosition;
out vec4 outColor;

vec3 srgbToLinear(vec3 value) {
  return mix(
    value / 12.92,
    pow((value + 0.055) / 1.055, vec3(2.4)),
    step(vec3(0.04045), value)
  );
}

vec4 sampleLayer(float idxF, vec2 uv) {
  int idx = int(idxF + 0.5);
  if (idx < 0) return vec4(0.0);
  vec4 sampled = texture(paletteArray, vec3(uv, float(idx)));
  return vec4(srgbToLinear(sampled.rgb), sampled.a);
}

void main() {
  int cx = clamp(int(floor(vUv2.x / 8.0)), 0, 15);
  int cy = clamp(int(floor(vUv2.y / 8.0)), 0, 15);
  int chunkIndex = cy * 16 + cx;

  vec4 idx4 = texelFetch(chunkTexIndexMap, ivec2(chunkIndex, 0), 0);
  vec2 localUv = fract(vUv2 / 8.0);
  vec3 alpha = texture(alphaArray, vec3(localUv, float(chunkIndex))).rgb;

  float a0 = idx4.y < 0.0 ? 0.0 : alpha.r;
  float a1 = idx4.z < 0.0 ? 0.0 : alpha.g;
  float a2 = idx4.w < 0.0 ? 0.0 : alpha.b;

  vec4 t0 = sampleLayer(idx4.x, vUv2);
  vec4 t1 = sampleLayer(idx4.y, vUv2);
  vec4 t2 = sampleLayer(idx4.z, vUv2);
  vec4 t3 = sampleLayer(idx4.w, vUv2);

  // Legacy ADTs can contain overlapping alpha channels whose sum exceeds 1.
  // Keep the WoW base-weight formula for normal data, but never allow a
  // negative base contribution to create dark/NaN terrain patches.
  vec4 weights = vec4(max(0.0, 1.0 - (a0 + a1 + a2)), a0, a1, a2);
  float weightSum = max(dot(weights, vec4(1.0)), 0.0001);
  weights /= weightSum;
  vec4 blended = t0 * weights.x + t1 * weights.y + t2 * weights.z + t3 * weights.w;

  vec3 n = normalize(vWorldNormal);
  float nDotL = max(dot(n, normalize(-lightDir)), 0.0);
  vec3 lit = blended.rgb * (ambientColor + lightColor * nDotL);
  float fogAmount = smoothstep(fogNear, fogFar, distance(cameraPosition, vWorldPosition));
  vec3 finalColor = mix(lit, fogColor, fogAmount);

  outColor = linearToOutputTexel(vec4(finalColor, 1.0));
}
`;

function TerrainTile({ tile, textureUrl }) {
  const invalidate = useThree(s => s.invalidate);
  const geometry = useMemo(() => buildTileGeometry(tile), [tile]);

  const shaderTextures = useMemo(() => {
    if (!textureUrl || !textureUrl.paletteRgba) return null;
    const { paletteRgba, paletteW, paletteH, paletteCount, chunkTexIndices, chunkAlpha } = textureUrl;

    // Noggit (TextureManager.cpp get_tex_array): GL_RGBA8 zonder sRGB-internalformat + volledige
    // mipmap-chain met GL_LINEAR_MIPMAP_LINEAR. Zonder mipmaps geeft 8x-tiling op een schuine
    // camera-hoek zware aliasing (de "strepen door elkaar" — moiré, geen echte blend-bug).
    // colorSpace blijft NoColorSpace: Noggit doet geen sRGB-decode/encode, dus we matchen dat
    // 1-op-1 i.p.v. een halve linear-workflow toe te passen (sample sRGB-decode zonder output-
    // re-encode gaf eerder een te contrastrijke/verzadigde look).
    const palette = new THREE.DataArrayTexture(new Uint8Array(paletteRgba), paletteW, paletteH, paletteCount);
    palette.format = THREE.RGBAFormat;
    palette.type = THREE.UnsignedByteType;
    palette.colorSpace = THREE.NoColorSpace;
    palette.wrapS = palette.wrapT = THREE.RepeatWrapping;
    palette.minFilter = THREE.LinearMipmapLinearFilter;
    palette.magFilter = THREE.LinearFilter;
    palette.generateMipmaps = true;
    palette.anisotropy = 8;
    palette.needsUpdate = true;

    const alpha = new THREE.DataArrayTexture(new Uint8Array(chunkAlpha), 64, 64, 256);
    alpha.format = THREE.RGBAFormat;
    alpha.type = THREE.UnsignedByteType;
    alpha.wrapS = alpha.wrapT = THREE.ClampToEdgeWrapping;
    alpha.minFilter = alpha.magFilter = THREE.LinearFilter;
    alpha.needsUpdate = true;

    const chunkTexIndexMap = new THREE.DataTexture(new Float32Array(chunkTexIndices), 256, 1, THREE.RGBAFormat, THREE.FloatType);
    chunkTexIndexMap.minFilter = chunkTexIndexMap.magFilter = THREE.NearestFilter;
    chunkTexIndexMap.needsUpdate = true;

    return { palette, alpha, chunkTexIndexMap };
  }, [textureUrl]);

  const minimapTexture = useMemo(() => {
    if (!textureUrl || textureUrl.paletteRgba || typeof textureUrl !== 'string') return null;
    // String URL: minimap placeholder — roteer 90° CCW zodat UV (u=vx=NS, v=vy=EW) klopt
    const tempTex = new THREE.Texture();
    tempTex.colorSpace = THREE.SRGBColorSpace;
    tempTex.flipY = false;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      tempTex.image = canvas;
      tempTex.anisotropy = 8;
      tempTex.needsUpdate = true;
      invalidate();
    };
    img.src = textureUrl;
    return tempTex;
  }, [textureUrl, invalidate]);

  useEffect(() => () => {
    shaderTextures?.palette.dispose();
    shaderTextures?.alpha.dispose();
    shaderTextures?.chunkTexIndexMap.dispose();
  }, [shaderTextures]);
  useEffect(() => () => { minimapTexture?.dispose(); }, [minimapTexture]);
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      {shaderTextures
        ? (
          <shaderMaterial
            glslVersion={THREE.GLSL3}
            side={THREE.DoubleSide}
            vertexShader={TERRAIN_VERT}
            fragmentShader={TERRAIN_FRAG}
            uniforms={{
              chunkTexIndexMap: { value: shaderTextures.chunkTexIndexMap },
              paletteArray: { value: shaderTextures.palette },
              alphaArray: { value: shaderTextures.alpha },
              ambientColor: { value: WOW_AMBIENT_COLOR.clone() },
              lightColor: { value: WOW_LIGHT_COLOR.clone() },
              lightDir: { value: WOW_SUN_DIRECTION.clone() },
              fogColor: { value: new THREE.Color(WOW_FOG_COLOR) },
              fogNear: { value: WOW_FOG_NEAR },
              fogFar: { value: WOW_FOG_FAR },
            }}
          />
        )
        : minimapTexture
          ? <meshLambertMaterial map={minimapTexture} side={THREE.DoubleSide} />
          : <meshLambertMaterial vertexColors side={THREE.DoubleSide} />}
    </mesh>
  );
}

// WDL low-res wereldmesh: 17×17 hoogtes per tile, hele continent in één geometry.
// Iets verlaagd gerenderd zodat de gedetailleerde ADT-tiles er zonder z-fighting overheen liggen.
const WDL_TILE = 533.33333;
const WDL_STEP = WDL_TILE / 16;
const WDL_HALF = 32 * WDL_TILE;

function WdlMesh({ tiles }) {
  const geometry = useMemo(() => {
    if (!tiles?.length) return null;
    const VPT = 17 * 17;
    const pos = new Float32Array(tiles.length * VPT * 3);
    const col = new Float32Array(tiles.length * VPT * 3);
    const idx = new Uint32Array(tiles.length * 16 * 16 * 6);
    let vi = 0, ii = 0, vbase = 0;

    for (const t of tiles) {
      const baseWy = WDL_HALF - t.tileY * WDL_TILE;
      const baseWx = WDL_HALF - t.tileX * WDL_TILE;
      for (let r = 0; r < 17; r++) {
        for (let c = 0; c < 17; c++) {
          const wy = baseWy - r * WDL_STEP;
          const wx = baseWx - c * WDL_STEP;
          const h  = t.heights[r * 17 + c];
          pos[vi]     = -wy;
          pos[vi + 1] =  h;
          pos[vi + 2] = -wx;
          heightColor(h, col, vi);
          vi += 3;
        }
      }
      for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 16; c++) {
          const tl = vbase + r * 17 + c;
          const tr = tl + 1;
          const bl = tl + 17;
          const br = bl + 1;
          idx[ii++] = tl; idx[ii++] = bl; idx[ii++] = tr;
          idx[ii++] = tr; idx[ii++] = bl; idx[ii++] = br;
        }
      }
      vbase += VPT;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return geo;
  }, [tiles]);

  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} position={[0, -1.5, 0]} renderOrder={-1}>
      <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}

function TerrainMesh({ terrainTiles, tileTextures }) {
  if (!terrainTiles?.length) return null;
  return terrainTiles.map(tile => (
    <TerrainTile
      key={`${tile.tileX}_${tile.tileY}`}
      tile={tile}
      textureUrl={tileTextures?.[`${tile.tileX}_${tile.tileY}`] ?? null}
    />
  ));
}

function WorldFog({ viewDistance }) {
  const fogFar = Math.min(viewDistance, WOW_FOG_FAR);
  const fogNear = Math.min(WOW_FOG_NEAR, fogFar - 1);
  return <fog attach="fog" args={[WOW_FOG_COLOR, fogNear, fogFar]} />;
}

function AdaptiveRenderQuality({ maxDpr = 1.5 }) {
  const { gl, invalidate } = useThree();
  const qualityRef = useRef({ dpr: maxDpr, emaMs: 16.7, lastAdjustment: 0 });

  useEffect(() => {
    const minDpr = Math.min(1, maxDpr);
    const dpr = THREE.MathUtils.clamp(maxDpr, minDpr, Math.max(minDpr, maxDpr));
    qualityRef.current.dpr = dpr;
    gl.setPixelRatio(dpr);
  }, [gl, maxDpr]);

  useFrame((state, delta) => {
    const quality = qualityRef.current;
    const minDpr = Math.min(1, maxDpr);
    const frameMs = Math.min(40, Math.max(0.5, delta * 1000));
    quality.emaMs = quality.emaMs * 0.88 + frameMs * 0.12;
    const now = performance.now();
    if (now - quality.lastAdjustment < 600 || maxDpr <= minDpr) return;

    let nextDpr = quality.dpr;
    if (quality.emaMs > 22) nextDpr -= 0.1;
    else if (quality.emaMs < 14) nextDpr += 0.1;
    nextDpr = THREE.MathUtils.clamp(nextDpr, minDpr, maxDpr);
    if (Math.abs(nextDpr - quality.dpr) < 0.05) return;

    quality.dpr = nextDpr;
    quality.lastAdjustment = now;
    gl.setPixelRatio(nextDpr);
    state.invalidate();
  });

  return null;
}

function CameraMotionTracker({ motionRef }) {
  const { camera } = useThree();
  const previousRef = useRef({ position: new THREE.Vector3(), at: 0 });

  useFrame((state) => {
    const now = performance.now();
    const previous = previousRef.current;
    if (!previous.at) {
      previous.position.copy(camera.position);
      previous.at = now;
      return;
    }
    const elapsed = now - previous.at;
    const translating = Object.values(cameraInput.keys).some(Boolean);
    const lookingOnly = cameraInput.flyActive && !translating;
    const speed = lookingOnly || elapsed > 250
      ? 0
      : camera.position.distanceTo(previous.position) / Math.max(1, elapsed) * 1000;
    previous.position.copy(camera.position);
    previous.at = now;
    const currentLevel = motionRef.current.level;
    const nextLevel = speed > 400
      ? 2
      : speed > 130
        ? Math.max(1, currentLevel)
        : speed < 30
          ? 0
          : currentLevel;
    motionRef.current.speed = speed;
    if (motionRef.current.level !== nextLevel) {
      motionRef.current.level = nextLevel;
      state.invalidate();
    }
  });

  return null;
}

function WaterAnimation() {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    let timer = null;
    const tick = () => {
      invalidate();
      timer = setTimeout(tick, 100);
    };
    timer = setTimeout(tick, 100);
    return () => clearTimeout(timer);
  }, [invalidate]);
  return null;
}

function WaterLayer({ layer }) {
  const materialRef = useRef(null);
  const style = LIQUID_STYLES[Number(layer.liquidType)] || LIQUID_STYLES[1];
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = layer.positions instanceof Float32Array
      ? layer.positions
      : new Float32Array(layer.positions || []);
    const indices = layer.indices instanceof Uint32Array
      ? layer.indices
      : new Uint32Array(layer.indices || []);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const uvs = new Float32Array((positions.length / 3) * 2);
    for (let index = 0; index < positions.length / 3; index++) {
      uvs[index * 2] = positions[index * 3] * 0.02;
      uvs[index * 2 + 1] = positions[index * 3 + 2] * 0.02;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, [layer]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(() => ({
    time: { value: 0 },
    waterColor: { value: new THREE.Color(style.color) },
    opacity: { value: style.opacity },
    flowSpeed: { value: style.flowSpeed },
    waveAmplitude: { value: style.waveAmplitude },
    waterTexture: { value: WATER_FALLBACK_TEXTURE },
    hasWaterTexture: { value: 0 },
    lightDirection: { value: WATER_LIGHT_DIRECTION },
    fogColor: { value: new THREE.Color(WOW_FOG_COLOR) },
    fogNear: { value: WOW_FOG_NEAR },
    fogFar: { value: WOW_FOG_FAR },
  }), [style]);

  useFrame(state => {
    if (materialRef.current) materialRef.current.uniforms.time.value = state.clock.elapsedTime;
  });

  return (
    <mesh geometry={geometry} renderOrder={2} frustumCulled dispose={null}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={WATER_VERTEX}
        fragmentShader={WATER_FRAGMENT}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function WaterMesh({ waterLayers }) {
  const groupedLayers = useMemo(() => {
    const groups = new Map();
    for (const layer of waterLayers) {
      const key = `${layer.tileKey}-${layer.liquidType}`;
      if (!groups.has(key)) groups.set(key, { ...layer, positions: [], indices: [] });
      const group = groups.get(key);
      const positions = layer.positions instanceof Float32Array
        ? layer.positions
        : new Float32Array(layer.positions || []);
      const indices = layer.indices instanceof Uint32Array
        ? layer.indices
        : new Uint32Array(layer.indices || []);
      const vertexOffset = group.positions.length / 3;
      group.positions.push(...positions);
      for (const index of indices) group.indices.push(index + vertexOffset);
    }
    return [...groups.entries()].map(([groupKey, layer]) => ({
      ...layer,
      groupKey,
      positions: new Float32Array(layer.positions),
      indices: new Uint32Array(layer.indices),
    }));
  }, [waterLayers]);

  if (!waterLayers?.length) return null;
  return (
    <>
      <WaterAnimation />
      {groupedLayers.map(layer => (
        <WaterLayer
          key={layer.groupKey}
          layer={layer}
        />
      ))}
    </>
  );
}

function CameraTracker({ posRef, onCameraMove }) {
  const { camera, controls } = useThree();
  const lastNotified = useRef(null);
  useFrame(() => {
    if (!posRef) return;
    const p = controls?.target ?? camera.position;
    const w = threeToWow(p.x, p.y, p.z);
    posRef.current = { wx: w.x, wy: w.y };
    const previous = lastNotified.current;
    const moved = !previous || Math.hypot(w.x - previous.wx, w.y - previous.wy) >= 12;
    if (moved) {
      lastNotified.current = { wx: w.x, wy: w.y };
      onCameraMove?.();
    }
  });
  return null;
}

function RendererStats({ onStats }) {
  const { gl } = useThree();
  const lastPublishedAt = useRef(0);
  const lastSignature = useRef('');

  useFrame(() => {
    const now = performance.now();
    if (now - lastPublishedAt.current < 500) return;
    const render = gl.info?.render ?? {};
    const memory = gl.info?.memory ?? {};
    const stats = {
      calls: render.calls ?? 0,
      triangles: render.triangles ?? 0,
      geometries: memory.geometries ?? 0,
      textures: memory.textures ?? 0,
    };
    const signature = `${stats.calls}|${stats.triangles}|${stats.geometries}|${stats.textures}`;
    if (signature === lastSignature.current) return;
    lastPublishedAt.current = now;
    lastSignature.current = signature;
    onStats?.(stats);
  });
  return null;
}

function SceneControls({ activeTool, focusTarget, focusTick, viewDistance, terrainClamp, wmoCollisionRef }) {
  const altHeld = useAltHeld();
  const toolBlocksOrbit = activeTool === 'select' || activeTool === 'move' || activeTool === 'rotate';

  return (
    <>
      <CameraFlyControls terrainClamp={terrainClamp} wmoCollisionRef={wmoCollisionRef} />
      <CameraFrameFocus target={focusTarget} focusTick={focusTick} />
      <OrbitControls
        makeDefault
        mouseButtons={{
          LEFT: toolBlocksOrbit
            ? (altHeld ? THREE.MOUSE.PAN : undefined)
            : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT:  null,
        }}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.45}
        panSpeed={1.4}
        zoomSpeed={1.1}
        screenSpacePanning
        minDistance={2}
        maxDistance={viewDistance}
      />
    </>
  );
}

function WorldTransformGizmo({ object, transform, mode = 'translate', onChange, onDragStart, onDragEnd }) {
  const groupRef = useRef(null);
  const controlsRef = useRef(null);
  const [groupReady, setGroupReady] = useState(false);
  const invalidate = useThree(state => state.invalidate);
  const bindGroup = useCallback((node) => {
    groupRef.current = node;
    setGroupReady(Boolean(node));
  }, []);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const position = transform?.position ?? object.scenePosition ?? [0, 0, 0];
    const rotation = transform?.rotation ?? object.sceneRotation ?? [0, 0, 0];
    const scale = transform?.scale ?? object.sceneScale ?? object.scale ?? 1;
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
    const centerOffset = new THREE.Vector3(...(object.gizmoLocalCenter ?? [0, 0, 0]))
      .multiplyScalar(scale)
      .applyQuaternion(quaternion);
    group.position.fromArray(position).add(centerOffset);
    group.quaternion.copy(quaternion);
    group.scale.setScalar(scale);
    invalidate();
  }, [object, transform, invalidate]);

  useEffect(() => {
    const controls = controlsRef.current;
    const gizmo = controls?.gizmo;
    if (!gizmo?.translate || gizmo.__azerothTranslateArrowPatch) return undefined;
    const originalUpdateMatrixWorld = gizmo.updateMatrixWorld;
    gizmo.updateMatrixWorld = function updateMatrixWorld(force) {
      originalUpdateMatrixWorld.call(this, force);
      if (this.mode !== 'translate') return;
      this.translate.children.forEach((handle) => {
        if (handle.tag === 'fwd') handle.visible = true;
        if (handle.tag === 'bwd') handle.visible = false;
      });
    };
    gizmo.__azerothTranslateArrowPatch = true;
    return () => {
      if (gizmo.__azerothTranslateArrowPatch) {
        gizmo.updateMatrixWorld = originalUpdateMatrixWorld;
        delete gizmo.__azerothTranslateArrowPatch;
      }
    };
  }, [groupReady]);

  const handleChange = useCallback(() => {
    const group = groupRef.current;
    if (!group) return;
    const scale = group.scale.x;
    const centerOffset = new THREE.Vector3(...(object.gizmoLocalCenter ?? [0, 0, 0]))
      .multiplyScalar(scale)
      .applyQuaternion(group.quaternion);
    onChange?.({
      position: group.position.clone().sub(centerOffset).toArray(),
      rotation: group.rotation.toArray().slice(0, 3),
      scale,
    });
  }, [onChange]);

  return (
    <>
      <group
        ref={bindGroup}
        name="selected-world-transform-gizmo"
      />
      {groupReady && (
        <TransformControls
          ref={controlsRef}
          object={groupRef}
          mode={mode}
          space="world"
          size={0.9}
          onChange={handleChange}
          onMouseDown={() => onDragStart?.(object.key)}
          onMouseUp={() => onDragEnd?.(object.key)}
        />
      )}
    </>
  );
}


export default function Editor3DScene({
  spawns, selectedId, onSelect, activeTool, onTransform, terrain, water = [], tileTextures, wdl, initialTarget,
  resetKeys = {}, focusTarget, focusTick, transforms = {}, camPosRef, invalidateRef, wmoPlacements = [],
  adtM2Placements = [], staticWorldMode = false, onCameraMove, onWmoPendingChange, onM2PendingChange,
  onWmoBatchCount, onM2BatchCount, onRendererStats,
  resourceProfile = null,
  viewDistance = 2048,
  onSelectWorldObject, selectedWorldObject = null, onWorldTransform, onWorldTransformStart, onWorldTransformEnd,
  worldTransforms = {},
}) {
  const [wmoPriorityReady, setWmoPriorityReady] = useState(!staticWorldMode);
  const cameraMotionRef = useRef({ speed: 0, level: 0 });
  const wmoCollisionRef = useRef([]);
  const dprMax = resourceProfile?.dprMax ?? 1.5;
  return (
    <Canvas
      frameloop="demand"
      dpr={dprMax}
      gl={{ powerPreference: 'high-performance' }}
      onCreated={({ gl }) => configureWowRenderer(gl)}
      camera={{ position: startCameraPosition(), fov: 60, near: 0.5, far: viewDistance }}
      style={{ background: '#1a1a2e' }}
      onPointerMissed={() => onSelect(null)}
    >
      <InvalidateExporter invalidateRef={invalidateRef} />
      <RendererStats onStats={onRendererStats} />
      <AdaptiveRenderQuality maxDpr={dprMax} />
      <Lights />
      <GridFloor />
      <AxesHelper />
      <WorldFog viewDistance={viewDistance} />
      <CameraSetup target={initialTarget} />
      {wdl && <WdlMesh tiles={wdl} />}
      {terrain && <TerrainMesh terrainTiles={terrain} tileTextures={tileTextures} />}
      <WaterMesh waterLayers={water} />
      <WmoPlacementLayer
        placements={wmoPlacements}
        resourceProfile={resourceProfile}
        onPendingChange={onWmoPendingChange}
        onPriorityReady={setWmoPriorityReady}
        onBatchCount={onWmoBatchCount}
        cameraMotionRef={cameraMotionRef}
        wmoCollisionRef={wmoCollisionRef}
        onSelect={onSelectWorldObject}
        worldTransforms={worldTransforms}
      />
      {staticWorldMode && (
        <AdtM2PlacementLayer
          placements={adtM2Placements}
          resourceProfile={resourceProfile}
          onPendingChange={onM2PendingChange}
          onBatchCount={onM2BatchCount}
          wmoPriorityReady={wmoPriorityReady}
          cameraMotionRef={cameraMotionRef}
          onSelect={onSelectWorldObject}
          worldTransforms={worldTransforms}
        />
      )}

      {staticWorldMode && selectedWorldObject && (
        <WorldTransformGizmo
          key={selectedWorldObject.key}
          object={selectedWorldObject}
          transform={worldTransforms[selectedWorldObject.key]}
          mode={activeTool === 'rotate' ? 'rotate' : 'translate'}
          onChange={next => onWorldTransform?.(selectedWorldObject.key, next)}
          onDragStart={onWorldTransformStart}
          onDragEnd={onWorldTransformEnd}
        />
      )}

      {!staticWorldMode && (
        <Suspense fallback={null}>
          {spawns.filter(s => s.guid === selectedId).map(spawn => (
            <Editor3DSpawn
              key={`${spawn.guid}_${resetKeys[spawn.guid] ?? 0}`}
              spawn={spawn}
              selected
              onSelect={onSelect}
              activeTool={activeTool}
              onTransform={onTransform}
            />
          ))}
        </Suspense>
      )}

      <CameraTracker posRef={camPosRef} onCameraMove={onCameraMove} />
      <SceneControls
        activeTool={activeTool}
        focusTarget={focusTarget}
        focusTick={focusTick}
        viewDistance={viewDistance}
        terrainClamp
        wmoCollisionRef={wmoCollisionRef}
      />
      <CameraMotionTracker motionRef={cameraMotionRef} />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#e74c3c', '#2ecc71', '#3498db']} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  );
}
