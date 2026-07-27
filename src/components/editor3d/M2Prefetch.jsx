import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { fetchM2Model, getM2AssetState } from './m2Loader';
import { getSpawnPose, getSpawnsInRange, horizontalDistSq, MODEL_PREFETCH_DIST } from './spawnLod';

const FRAME_INTERVAL = 18;
const PREFETCH_SQ = MODEL_PREFETCH_DIST * MODEL_PREFETCH_DIST;

export default function M2Prefetch({ spawns, transforms }) {
  const { camera } = useThree();
  const frame = useRef(0);
  const lastRequested = useRef(null);

  useFrame(() => {
    frame.current += 1;
    if (frame.current % FRAME_INTERVAL !== 0 || !spawns?.length) return;

    let candidate = null;
    let candidateDist = Infinity;
    for (const s of getSpawnsInRange(spawns, camera, MODEL_PREFETCH_DIST)) {
      if (s.type !== 'creature' || !s.displayId) continue;
      if (getM2AssetState(s.displayId) !== 'idle') continue;
      const { pos } = getSpawnPose(s, transforms);
      const dist = horizontalDistSq(camera, pos);
      if (dist > PREFETCH_SQ || dist >= candidateDist) continue;
      candidate = s.displayId;
      candidateDist = dist;
    }

    if (!candidate || candidate === lastRequested.current) return;
    lastRequested.current = candidate;
    fetchM2Model(candidate).finally(() => { lastRequested.current = null; });
  });

  return null;
}
