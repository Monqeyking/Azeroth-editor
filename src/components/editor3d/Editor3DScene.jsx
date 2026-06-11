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
      pos[vi * 3]     =   wowBaseY - vy * UNIT_SIZE;
      pos[vi * 3 + 1] = h;
      pos[vi * 3 + 2] = -(wowBaseX - vx * UNIT_SIZE);
      heightColor(h, col, vi * 3);
      uv[vi * 2] = vx / 128; uv[vi * 2 + 1] = vy / 128;
    }
  }

  for (let vy = 0; vy < IG; vy++) {
    for (let vx = 0; vx < IG; vx++) {
      const ii = vy * IG + vx, vi = V9C + ii;
      const h  = Math.min(3000, Math.max(-500, v8[vy * IG + vx]));
      pos[vi * 3]     =   wowBaseY - (vy + 0.5) * UNIT_SIZE;
      pos[vi * 3 + 1] = h;
      pos[vi * 3 + 2] = -(wowBaseX - (vx + 0.5) * UNIT_SIZE);
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

function TerrainTile({ tile, textureUrl }) {
  const invalidate = useThree(s => s.invalidate);
  const geometry = useMemo(() => buildTileGeometry(tile), [tile]);

  const texture = useMemo(() => {
    if (!textureUrl) return null;

    // Raw RGBA van compositor worker → DataTexture (synchroon, geen PNG decode)
    if (typeof textureUrl === 'object' && textureUrl.rgba) {
      const tex = new THREE.DataTexture(
        new Uint8Array(textureUrl.rgba),
        textureUrl.w, textureUrl.h,
        THREE.RGBAFormat
      );
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      return tex;
    }

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

  useEffect(() => () => { texture?.dispose(); },  [texture]);
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      {texture
        ? <meshLambertMaterial map={texture} side={THREE.DoubleSide} />
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
          pos[vi]     =  wy;
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
