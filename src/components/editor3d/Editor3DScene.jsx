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

const UNIT_SIZE = 33.33333 / 8;

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
    camera.position.set(tx, ty + 85, tz + 130);
    controls.target.set(tx, ty + 12, tz);
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

function TerrainMesh({ terrainTiles }) {
  const geometry = useMemo(() => {
    if (!terrainTiles?.length) return null;

    const validTiles = terrainTiles.filter(t => t?.chunks?.length);
    if (!validTiles.length) return null;

    // Globale tile-bounding box berekenen
    let minTX = Infinity, maxTX = -Infinity, minTY = Infinity, maxTY = -Infinity;
    validTiles.forEach(t => {
      if (t.tileX < minTX) minTX = t.tileX;
      if (t.tileX > maxTX) maxTX = t.tileX;
      if (t.tileY < minTY) minTY = t.tileY;
      if (t.tileY > maxTY) maxTY = t.tileY;
    });

    // Eén globale vertex grid — aangrenzende tiles delen rand-vertices (geen naad)
    const GW = (maxTX - minTX + 1) * 128 + 1;
    const GH = (maxTY - minTY + 1) * 128 + 1;

    const allPos = new Float32Array(GW * GH * 3);
    const allCol = new Float32Array(GW * GH * 3);

    validTiles.forEach(tile => {
      const tCol = (tile.tileX - minTX) * 128;
      const tRow = (tile.tileY - minTY) * 128;

      for (const chunk of tile.chunks) {
        if (!chunk) continue;
        const { ix, iy, posX, posY, posZ, outer } = chunk;
        // posX = WoW.y → Three.x (neg) | posY = WoW.x → Three.z | posZ = hoogte

        // ── DEBUG HEIGHT OFFSET ──────────────────────────────────────────────
        if (ix === 8 && iy === 8 && tile.tileX === 32 && tile.tileY === 39) {
          console.log('[TERRAIN DEBUG] tile 32_39 chunk ix=8 iy=8 —',
            'posX=', posX.toFixed(4),
            'posY=', posY.toFixed(4),
            'posZ=', posZ.toFixed(4),
            '| outer[0]=',  outer[0].toFixed(4),
            'outer[40]=', outer[40].toFixed(4),
            'outer[80]=', outer[80].toFixed(4),
            '| Three.y (midden) =', (posZ + outer[40]).toFixed(4)
          );
        }
        // ── END DEBUG ────────────────────────────────────────────────────────

        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            const gRow = tRow + iy * 8 + r;
            const gCol = tCol + ix * 8 + c;
            if (gRow >= GH || gCol >= GW) continue;
            const gi   = (gRow * GW + gCol) * 3;
            const wowY = posX - r * UNIT_SIZE;
            const wowX = posY - c * UNIT_SIZE;
            const wowZ = posZ + outer[r * 9 + c];
            allPos[gi]     = -wowY;
            allPos[gi + 1] =  wowZ;
            allPos[gi + 2] =  wowX;
            heightColor(wowZ, allCol, gi);
          }
        }
      }
    });

    const allIdx = new Uint32Array(validTiles.length * 128 * 128 * 6);
    let idxPtr = 0;

    validTiles.forEach(tile => {
      const tCol = (tile.tileX - minTX) * 128;
      const tRow = (tile.tileY - minTY) * 128;

      for (let row = 0; row < 128; row++) {
        for (let col = 0; col < 128; col++) {
          const tl = (tRow + row) * GW + (tCol + col);
          const tr = tl + 1;
          const bl = tl + GW;
          const br = bl + 1;
          allIdx[idxPtr++] = tl;
          allIdx[idxPtr++] = bl;
          allIdx[idxPtr++] = tr;
          allIdx[idxPtr++] = tr;
          allIdx[idxPtr++] = bl;
          allIdx[idxPtr++] = br;
        }
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(allPos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(allCol, 3));
    geo.setIndex(new THREE.BufferAttribute(allIdx.subarray(0, idxPtr), 1));
    geo.computeVertexNormals();
    return geo;
  }, [terrainTiles]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
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
        maxDistance={8000}
      />
    </>
  );
}

export default function Editor3DScene({
  spawns, selectedId, onSelect, activeTool, onTransform, terrain, initialTarget, resetKeys = {},
  focusTarget, focusTick, transforms = {}, camPosRef,
}) {
  return (
    <Canvas
      frameloop="demand"
      camera={{ position: [0, 42, 65], fov: 60, near: 0.1, far: 10000 }}
      style={{ background: '#1a1a2e' }}
      onPointerMissed={() => onSelect(null)}
    >
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

      {terrain && <TerrainMesh terrainTiles={terrain} />}

      <Suspense fallback={null}>
        {spawns.map(spawn => {
          const sel = spawn.guid === selectedId;
          return (
            <Editor3DSpawn
              key={`${spawn.guid}_${resetKeys[spawn.guid] ?? 0}`}
              spawn={spawn}
              selected={sel}
              onSelect={onSelect}
              activeTool={sel ? activeTool : null}
              onTransform={onTransform}
            />
          );
        })}
      </Suspense>

      <CameraTracker posRef={camPosRef} />
      <SceneControls activeTool={activeTool} focusTarget={focusTarget} focusTick={focusTick} />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#e74c3c', '#2ecc71', '#3498db']} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  );
}
