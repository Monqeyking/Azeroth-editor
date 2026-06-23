import { Suspense, useMemo, useEffect, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import Editor3DSpawn from './Editor3DSpawn';
import { CameraFlyControls, CameraFrameFocus, useAltHeld } from './Editor3DCameraControls';
import { threeToWow } from './wowCoords';
import M2Prefetch from './M2Prefetch';
import M2InstanceLayers from './M2InstanceLayers';
import SpawnLodUpdater from './SpawnLodUpdater';
import SpawnBillboardLayer from './SpawnBillboardLayer';

const UNIT_SIZE = 33.33333 / 8;
const TILE_SIZE = UNIT_SIZE * 128;

function GridFloor() {
  return <gridHelper args={[200, 40, '#444455', '#2a2a3a']} position={[0, 0, 0]} />;
}
function AxesHelper() { return <axesHelper args={[10]} />; }
function Lights() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[50, 80, 30]} intensity={1.2} />
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
    camera.position.set(tx, ty + 250, tz + 180);
    controls.target.set(tx, ty + 20, tz);
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

void main() {
  vUv2 = uv * 128.0;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
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

in vec2 vUv2;
in vec3 vWorldNormal;
out vec4 outColor;

vec4 sampleLayer(float idxF, vec2 uv) {
  int idx = int(idxF + 0.5);
  if (idx < 0) return vec4(0.0);
  return texture(paletteArray, vec3(uv, float(idx)));
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

  vec4 blended = t0 * (1.0 - (a0 + a1 + a2)) + t1 * a0 + t2 * a1 + t3 * a2;

  vec3 n = normalize(vWorldNormal);
  float nDotL = max(dot(n, normalize(-lightDir)), 0.0);
  vec3 lit = blended.rgb * (ambientColor + lightColor * nDotL);

  outColor = vec4(lit, 1.0);
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
              ambientColor: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
              lightColor: { value: new THREE.Vector3(1.2, 1.2, 1.2) },
              lightDir: { value: new THREE.Vector3(-50, -80, -30).normalize() },
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

function CameraTracker({ posRef }) {
  const { camera, controls } = useThree();
  useFrame(() => {
    if (!posRef) return;
    const p = controls?.target ?? camera.position;
    const w = threeToWow(p.x, p.y, p.z);
    posRef.current = { wx: w.x, wy: w.y };
  });
  return null;
}

function SceneControls({ activeTool, focusTarget, focusTick }) {
  const altHeld = useAltHeld();
  const toolBlocksOrbit = activeTool === 'select' || activeTool === 'move' || activeTool === 'rotate';

  return (
    <>
      <CameraFlyControls />
      <CameraFrameFocus target={focusTarget} focusTick={focusTick} />
      <OrbitControls
        makeDefault
        mouseButtons={{
          LEFT: toolBlocksOrbit
            ? (altHeld ? THREE.MOUSE.PAN : undefined)
            : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT:  THREE.MOUSE.ROTATE,
        }}
        enableDamping
        dampingFactor={0.06}
        rotateSpeed={0.45}
        panSpeed={1.4}
        zoomSpeed={1.1}
        screenSpacePanning
        minDistance={2}
        maxDistance={30000}
      />
    </>
  );
}


export default function Editor3DScene({
  spawns, selectedId, onSelect, activeTool, onTransform, terrain, tileTextures, wdl, initialTarget,
  resetKeys = {}, focusTarget, focusTick, transforms = {}, camPosRef, invalidateRef,
}) {
  return (
    <Canvas
      frameloop="demand"
      camera={{ position: [0, 42, 65], fov: 60, near: 0.5, far: 60000 }}
      style={{ background: '#1a1a2e' }}
      onPointerMissed={() => onSelect(null)}
    >
      <InvalidateExporter invalidateRef={invalidateRef} />
      <Lights />
      <GridFloor />
      <AxesHelper />
      <CameraSetup target={initialTarget} />
      <SpawnLodUpdater spawns={spawns} transforms={transforms} selectedId={selectedId} />
      <M2Prefetch spawns={spawns} transforms={transforms} />
      <M2InstanceLayers
        spawns={spawns}
        transforms={transforms}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <SpawnBillboardLayer
        spawns={spawns}
        transforms={transforms}
        selectedId={selectedId}
        onSelect={onSelect}
      />

      {wdl && <WdlMesh tiles={wdl} />}
      {terrain && <TerrainMesh terrainTiles={terrain} tileTextures={tileTextures} />}

      {/* Alleen de selected spawn mounten voor gizmo's */}
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

      <CameraTracker posRef={camPosRef} />
      <SceneControls activeTool={activeTool} focusTarget={focusTarget} focusTick={focusTick} />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#e74c3c', '#2ecc71', '#3498db']} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  );
}
