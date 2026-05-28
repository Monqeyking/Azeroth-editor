import { Suspense, useMemo, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import Editor3DSpawn from './Editor3DSpawn';

const UNIT_SIZE = 33.33333 / 8;
const GRID      = 129;
const VERTS     = GRID * GRID;

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
    camera.position.set(tx, ty + 400, tz + 500);
    controls.target.set(tx, ty, tz);
    controls.update();
  }, [target, controls, camera]);

  return null;
}

function TerrainMesh({ terrainTiles }) {
  const geometry = useMemo(() => {
    if (!terrainTiles?.length) return null;

    const validTiles = terrainTiles.filter(t => t?.chunks?.length);
    if (!validTiles.length) return null;

    // Pre-alloceer één aaneengesloten buffer voor alle tiles
    const totalVerts = validTiles.length * VERTS;
    const allPos     = new Float32Array(totalVerts * 3);

    // Indices: 128×128 quads per tile, 6 indices per quad
    const idxCount   = validTiles.length * 128 * 128 * 6;
    const allIdx     = new Uint32Array(idxCount);
    let   idxPtr     = 0;

    validTiles.forEach((tile, tileI) => {
      const vBase  = tileI * VERTS;
      const posOff = vBase * 3;

      // Vul posities voor deze tile
      for (const chunk of tile.chunks) {
        if (!chunk) continue;
        const { ix, iy, posX, posY, posZ, heights } = chunk;

        for (let vRow = 0; vRow < 9; vRow++) {
          for (let vCol = 0; vCol < 9; vCol++) {
            const gridRow = iy * 8 + vRow;
            const gridCol = ix * 8 + vCol;
            if (gridRow >= GRID || gridCol >= GRID) continue;

            const gi = posOff + (gridRow * GRID + gridCol) * 3;
            const wX = posX - vRow * UNIT_SIZE;
            const wY = posY - vCol * UNIT_SIZE;
            const wZ = posZ + (heights[vRow * 9 + vCol] ?? 0);

            allPos[gi]     = -wY;
            allPos[gi + 1] =  wZ;
            allPos[gi + 2] =  wX;
          }
        }
      }

      // Indices voor 128×128 quads
      for (let row = 0; row < GRID - 1; row++) {
        for (let col = 0; col < GRID - 1; col++) {
          const tl = vBase + row * GRID + col;
          const tr = tl + 1;
          const bl = tl + GRID;
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
    geo.setIndex(new THREE.BufferAttribute(allIdx, 1));
    geo.computeVertexNormals();
    return geo;
  }, [terrainTiles]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial color="#3b6024" side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function Editor3DScene({ spawns, selectedId, onSelect, activeTool, onTransform, terrain, initialTarget, resetKeys = {} }) {
  return (
    <Canvas
      camera={{ position: [0, 60, 80], fov: 60, near: 0.1, far: 10000 }}
      style={{ background: '#1a1a2e' }}
      onPointerMissed={() => onSelect(null)}
    >
      <Lights />
      <GridFloor />
      <AxesHelper />
      <CameraSetup target={initialTarget} />

      {terrain && <TerrainMesh terrainTiles={terrain} />}

      <Suspense fallback={null}>
        {spawns.map(spawn => (
          <Editor3DSpawn
            key={`${spawn.guid}_${resetKeys[spawn.guid] ?? 0}`}
            spawn={spawn}
            selected={spawn.guid === selectedId}
            onSelect={onSelect}
            activeTool={activeTool}
            onTransform={onTransform}
          />
        ))}
      </Suspense>

      <OrbitControls
        makeDefault
        mouseButtons={{
          LEFT:   activeTool === 'select' || activeTool === 'move' || activeTool === 'rotate'
                    ? undefined
                    : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT:  THREE.MOUSE.ROTATE,
        }}
        enableDamping
        dampingFactor={0.08}
      />

      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#e74c3c', '#2ecc71', '#3498db']} labelColor="white" />
      </GizmoHelper>
    </Canvas>
  );
}
