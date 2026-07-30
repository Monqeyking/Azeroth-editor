import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnection } from '../../lib/ConnectionContext';
import CharM2Viewer from '../char/CharM2Viewer';

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

function LocalCustomPreview({ displayId, displayScale, active }) {
  const { readCreatureDisplayCreator, readItemDisplayInfos, worldmapMpqPath } = useConnection();
  const [creatorData, setCreatorData] = useState(null);
  const [itemAssets, setItemAssets] = useState({});

  useEffect(() => {
    let cancelled = false;
    readCreatureDisplayCreator().then(result => { if (!cancelled && result.success) setCreatorData(result); });
    return () => { cancelled = true; };
  }, [readCreatureDisplayCreator]);

  const preview = useMemo(() => {
    const display = creatorData?.displays?.find(row => Number(row.id) === Number(displayId));
    const extra = display?.extra;
    if (!display || !extra) return null;
    const race = Number(extra.race), gender = Number(extra.gender);
    const rows = creatorData.charSections || [];
    const skin = rows.find(row => row.race === race && row.gender === gender && row.baseSection === 0 && row.variation === 0 && row.color === Number(extra.skin));
    const face = rows.find(row => row.race === race && row.gender === gender && row.baseSection === 1 && row.variation === Number(extra.face) && row.color === Number(extra.skin));
    const hair = rows.find(row => row.race === race && row.gender === gender && row.baseSection === 3 && row.variation === Number(extra.hairStyle) && row.color === Number(extra.hairColor));
    const facialColor = race === 12 ? Number(extra.skin) : Number(extra.hairColor);
    const facial = Number(extra.facialHair) ? rows.find(row => row.race === race && row.gender === gender && row.baseSection === 2 && row.variation === Number(extra.facialHair) && row.color === facialColor) : null;
    return { race, gender, skin, extra, layers: [
      ...(face ? [{ path: face.texture, region: 'face-lower' }, { path: face.texture2, region: 'face-upper' }] : []),
      ...(hair?.texture ? [{ path: hair.texture, region: 'hair-primary' }] : []),
      ...(facial ? [{ path: facial.texture, region: 'face-lower' }, { path: facial.texture2, region: 'face-upper' }] : []),
    ].filter(layer => layer.path) };
  }, [creatorData, displayId]);

  const itemIds = useMemo(() => [...new Set((preview?.extra?.npcItemDisplays || []).map(Number).filter(Boolean))], [preview]);
  useEffect(() => {
    let cancelled = false;
    if (!worldmapMpqPath || !itemIds.length || !preview) { setItemAssets({}); return undefined; }
    readItemDisplayInfos(worldmapMpqPath, itemIds, { race: preview.race, gender: preview.gender }).then(result => {
      if (!cancelled && result.success) setItemAssets(result.data || {});
    });
    return () => { cancelled = true; };
  }, [readItemDisplayInfos, worldmapMpqPath, itemIds.join('|'), preview]);

  const equipment = useMemo(() => {
    const displays = preview?.extra?.npcItemDisplays || [];
    const priorities = [11, 13, 10, 13, 18, 10, 11, 19, 20, 17, 23];
    const textureLayers = displays.flatMap((id, slot) => Object.entries(itemAssets[Number(id)]?.componentTexturePaths || {})
      .filter(([, path]) => path)
      .map(([region, path]) => ({ path, region, priority: priorities[slot] || 0 }))).sort((a, b) => a.priority - b.priority);
    const attachedModels = [];
    const add = (slot, attachmentId, asset, key) => {
      const modelPath = asset?.[`${key}Path`];
      if (modelPath) attachedModels.push({ slot, attachmentId, modelPath, texturePath: asset?.[`${key.replace('model', 'texture')}Path`] || '', offset: [0, 0, 0] });
    };
    add('helm', 11, itemAssets[Number(displays[0])], 'model1');
    add('shoulder-left', 6, itemAssets[Number(displays[1])], 'model1');
    add('shoulder-right', 5, itemAssets[Number(displays[1])], 'model2');
    add('belt-buckle', 53, itemAssets[Number(displays[4])], 'model1');
    add('cape', 12, itemAssets[Number(displays[10])], 'model1');
    const itemGeosets = {};
    const use = (slot, mappings) => mappings.forEach(([group, index, transform]) => {
      const value = itemAssets[Number(displays[slot])]?.geosets?.[index];
      if (Number.isFinite(value)) itemGeosets[group] = transform ? transform(value) : value;
    });
    use(10, [[15, 0]]); use(8, [[4, 0], [23, 1]]); use(6, [[5, 0], [20, 1, value => value === 0 ? 1 : value - 1]]);
    use(4, [[18, 0]]); use(5, [[11, 0], [9, 1], [13, 2]]); use(2, [[8, 0], [10, 1], [13, 2], [22, 3], [28, 4]]);
    use(3, [[8, 0], [10, 1], [13, 2], [22, 3], [28, 4]]); use(9, [[12, 0]]);
    return { textureLayers, attachedModels, itemGeosets };
  }, [preview, itemAssets]);

  return <div className="creature-model-preview creature-model-preview-local">
    <div className="creature-model-preview-head"><span>Local custom preview · Display #{displayId}</span>{displayScale !== 1 && <span className="mono">×{displayScale}</span>}</div>
    <div className="creature-model-preview-viewport">{preview ? <CharM2Viewer race={preview.race} gender={preview.gender} skinBlp={preview.skin?.texture || null} skinExtraBlp={preview.skin?.texture2 || null} appearance={{ face: preview.extra.face, hairStyle: preview.extra.hairStyle, hairColor: preview.extra.hairColor, facialHair: preview.extra.facialHair }} textureLayers={[...preview.layers, ...equipment.textureLayers]} attachedModels={equipment.attachedModels} itemGeosets={equipment.itemGeosets} active={active && !!worldmapMpqPath} /> : <span className="creature-model-preview-status">Loading local Display DBC data…</span>}</div>
  </div>;
}


export default function CreatureModelPreview({ displayId, displayScale = 1, active = true }) {
  const { idRanges } = useConnection();
  const containerRef = useRef(null);
  const viewerRef    = useRef(null);
  const isCustomDisplay = Number(displayId) >= Number(idRanges.display || 4000000);

  useEffect(() => {
    if (!active || !displayId || isCustomDisplay) return;
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
  }, [displayId, active, isCustomDisplay]);

  if (!active) return null;
  if (isCustomDisplay) return <LocalCustomPreview displayId={displayId} displayScale={displayScale} active={active} />;

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
