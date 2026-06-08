import { useEffect, useState } from 'react';
import { useConnection } from './ConnectionContext';
import { requestBlpTexture, configureBlpBatchLoader } from './blpBatchLoader';

let configured = false;
function ensureConfigured(readBlpTextures) {
  if (configured) return;
  configureBlpBatchLoader(readBlpTextures);
  configured = true;
}

export function useBlpTexture(blpPath) {
  const { worldmapMpqPath, readBlpTextures } = useConnection();
  ensureConfigured(readBlpTextures);

  const [state, setState] = useState(() => {
    if (!blpPath) return { dataUrl: null, loading: false, error: null, w: 0, h: 0 };
    return { dataUrl: null, loading: true, error: null, w: 0, h: 0 };
  });

  useEffect(() => {
    if (!blpPath) { setState({ dataUrl: null, loading: false, error: null, w: 0, h: 0 }); return; }
    let cancelled = false;
    setState({ dataUrl: null, loading: true, error: null, w: 0, h: 0 });
    requestBlpTexture(worldmapMpqPath, blpPath)
      .then(r => {
        if (cancelled) return;
        setState({ dataUrl: r.dataUrl, loading: false, error: null, w: r.w, h: r.h });
      })
      .catch(e => {
        if (cancelled) return;
        setState({ dataUrl: null, loading: false, error: e.message || 'Niet gevonden', w: 0, h: 0 });
      });
    return () => { cancelled = true; };
  }, [worldmapMpqPath, blpPath]);

  return state;
}

export function clearBlpTextureCache() {
  configured = false;
}
