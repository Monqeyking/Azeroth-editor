import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { prefetchM2Models } from './m2Loader';
import { isInPrefetchRange } from './spawnLod';

const FRAME_INTERVAL = 24;
const MAX_IDS = 32;

export default function M2Prefetch({ spawns, transforms }) {
  const { camera } = useThree();
  const frame = useRef(0);
  const lastKey = useRef('');

  useFrame(() => {
    frame.current += 1;
    if (frame.current % FRAME_INTERVAL !== 0 || !spawns?.length) return;

    const ids = new Set();
    for (const s of spawns) {
      if (s.type !== 'creature' || !s.displayId) continue;
      if (!isInPrefetchRange(camera, s, transforms)) continue;
      ids.add(s.displayId);
      if (ids.size >= MAX_IDS) break;
    }

    if (!ids.size) return;
    const key = [...ids].sort((a, b) => a - b).join(',');
    if (key === lastKey.current) return;
    lastKey.current = key;
    prefetchM2Models([...ids]);
  });

  return null;
}
