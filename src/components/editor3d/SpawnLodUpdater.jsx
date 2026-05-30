import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { updateAllSpawnLod } from './spawnLod';

const MOVE_SQ = 9; // skip frame als camera <3 units bewoog (XZ)

export default function SpawnLodUpdater({ spawns, transforms, selectedId }) {
  const { camera } = useThree();
  const lastPos = useRef({ x: Infinity, z: Infinity });

  // Bij selectieverandering: forceer volgende frame een update
  useEffect(() => { lastPos.current.x = Infinity; }, [selectedId]);

  useFrame(() => {
    const { x, z } = camera.position;
    const dx = x - lastPos.current.x;
    const dz = z - lastPos.current.z;
    if (dx * dx + dz * dz < MOVE_SQ) return;
    lastPos.current.x = x;
    lastPos.current.z = z;
    updateAllSpawnLod(spawns, transforms, camera, selectedId);
  });

  return null;
}
