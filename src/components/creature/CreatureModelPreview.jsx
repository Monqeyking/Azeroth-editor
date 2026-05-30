import { useEffect, useRef } from 'react';

const JQUERY_SCRIPT  = 'https://code.jquery.com/jquery-3.7.1.min.js';
const VIEWER_SCRIPT  = 'https://wowgaming.altervista.org/modelviewer/scripts/viewer.min.js';
const CONTENT_PATH   = 'https://wowgaming.altervista.org/modelviewer/data/get.php?path=';
const NPC_TYPE       = 8;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

let initPromise = null;
function initViewer() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!window.jQuery) await loadScript(JQUERY_SCRIPT);
    if (!window.WH) {
      window.WH = {
        debug: () => {},
        defaultAnimation: 'Stand',
        WebP: { getImageExtension: () => '.webp' },
      };
    }
    window.$ = window.jQuery;
    if (typeof window.ZamModelViewer === 'undefined') {
      await loadScript(VIEWER_SCRIPT);
    }
  })();
  return initPromise;
}


export default function CreatureModelPreview({ displayId, displayScale = 1, active = true }) {
  const containerRef = useRef(null);
  const viewerRef    = useRef(null);

  useEffect(() => {
    if (!active || !displayId) return;
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    initViewer().then(() => {
      if (cancelled || !el || typeof window.ZamModelViewer === 'undefined') return;
      viewerRef.current?.destroy?.();
      el.innerHTML = '';
      viewerRef.current = new window.ZamModelViewer({
        type: 2,
        contentPath: CONTENT_PATH,
        container: window.jQuery(el),
        aspect: 0.8,
        hd: false,
        models: { id: Number(displayId), type: NPC_TYPE },
      });
    }).catch(e => console.error('[viewer] init failed:', e));

    return () => {
      cancelled = true;
      viewerRef.current?.destroy?.();
      viewerRef.current = null;
    };
  }, [displayId, active]);

  if (!active) return null;

  return (
    <div className="creature-model-preview">
      <div className="creature-model-preview-head">
        <span>Idx preview · Display #{displayId || '—'}</span>
        {displayScale !== 1 && <span className="mono">×{displayScale}</span>}
      </div>
      <div className="creature-model-preview-viewport" ref={containerRef}>
        {!displayId && (
          <span className="creature-model-preview-status">Pick a row or enter a CreatureDisplayID</span>
        )}
      </div>
    </div>
  );
}
