import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Plus, Trash2, Save, RefreshCw, ImageOff, Loader2 } from 'lucide-react';
import './CharCustomizationPage.css';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { useBlpTexture } from '../lib/useBlpTexture';
import CharM2Viewer from '../components/char/CharM2Viewer';
import CharCreationPreview from '../components/char/CharCreationPreview';
import TextureMaskEditor from '../components/char/TextureMaskEditor';
import { Pencil } from 'lucide-react';
import { AtlasTemplateRegistry } from '../lib/characterTextures/AtlasTemplateRegistry.js';
import { TextureClassificationService } from '../lib/characterTextures/TextureClassificationService.js';
import { TemplateCorrectionStore } from '../lib/characterTextures/TemplateCorrectionStore.js';
import { TextureRecolorEngine } from '../lib/characterTextures/TextureRecolorEngine.js';
import { AtlasComponentTransferService } from '../lib/characterTextures/AtlasComponentTransferService.js';
import { DEFAULT_COMPONENT_RECTANGLES } from '../lib/characterTextures/AtlasComponentMappingStore.js';
import { ColorSetProvenanceStore } from '../lib/characterTextures/ColorSetProvenanceStore.js';


const RACES = [
  { id: 1,  label: 'Human' },
  { id: 2,  label: 'Orc' },
  { id: 3,  label: 'Dwarf' },
  { id: 4,  label: 'Night Elf' },
  { id: 5,  label: 'Undead' },
  { id: 6,  label: 'Tauren' },
  { id: 7,  label: 'Gnome' },
  { id: 8,  label: 'Troll' },
  { id: 10, label: 'Blood Elf' },
  { id: 11, label: 'Draenei' },
  { id: 12, label: 'Worgen (Custom)' },
];

function getCharacterTextureFamily(texturePath) {
  const match = String(texturePath || '').replace(/\//g, '\\').match(/^Character\\([^\\]+)/i);
  return match?.[1] || null;
}

function findRaceTextureCollisions(records) {
  const byRace = new Map();
  for (const row of records || []) {
    for (const texturePath of [row.tex1, row.tex2, row.tex3]) {
      const family = getCharacterTextureFamily(texturePath);
      if (!family) continue;
      const raceFamilies = byRace.get(row.race) || new Map();
      const familyRows = raceFamilies.get(family) || new Set();
      familyRows.add(row.id);
      raceFamilies.set(family, familyRows);
      byRace.set(row.race, raceFamilies);
    }
  }
  return [...byRace.entries()]
    .filter(([, families]) => families.size > 1)
    .map(([raceId, families]) => ({
      raceId,
      families: [...families.entries()].map(([family, ids]) => ({ family, ids: [...ids].sort((a, b) => a - b) })),
    }));
}

const SECTION_TABS = [
  { id: 0, label: 'Skin' },
  { id: 1, label: 'Face' },
  { id: 2, label: 'Facial Hair' },
  { id: 3, label: 'Hair' },
  { id: 4, label: 'Underclothing' },
];
const colorSetClassifier = new TextureClassificationService(new AtlasTemplateRegistry());
const colorSetCorrectionStore = new TemplateCorrectionStore();
const colorSetRecolorEngine = new TextureRecolorEngine();
const componentTransferService = new AtlasComponentTransferService();
const colorSetProvenanceStore = new ColorSetProvenanceStore();
const bytesToBase64 = bytes => { let binary=''; for(let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(binary); };
const base64ToBytes = value => { const binary=atob(value||''), bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i); return bytes; };
const componentMappingFromPath = value => {
  const path = String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (path.includes('faceupper')) return 'face-upper';
  if (path.includes('facelower')) return 'face-lower';
  if (path.includes('nakedpelvis') || path.includes('underwearpelvis') || path.includes('pelvis')) return 'underwear-pelvis';
  if (path.includes('nakedtorso') || path.includes('underweartorso') || path.includes('torso')) return 'underwear-torso';
  return null;
};
// Blizzard character names use the final numeric suffix as the colour set:
// WorgenMaleSkin00_08 = variation 00, colour 08. Earlier numeric groups are
// face/hair variations and must never be changed by a colour-set export.
const replaceColorIndexInPath = (texturePath, sourceColor, targetColor) => {
  const source = Number(sourceColor);
  const value = String(texturePath || '');
  // Worgen underclothing is a shared neutral overlay in Blizzard's own rows:
  // Color 0–4 all point to this exact file. It must not be renamed per colour.
  if (/character[\\/]worgen[\\/]male[\\/]worgenmalenakedpelvisskin_regular\.blp$/i.test(value)) return value;
  // Most character files end in _<colour>.blp; Skin Extra is the exception:
  // WorgenMaleSkin00_02_Extra.blp still has 02 as its colour slot.
  const match = value.match(/_(\d+)(?=(?:_extra)?\.blp$)/i);
  if (match && Number(match[1]) === source) {
    const digits = match[1];
    const start = match.index + 1;
    return `${value.slice(0, start)}${String(targetColor).padStart(digits.length, '0')}${value.slice(start + digits.length)}`;
  }
  // Worgen underclothing uses *_regular.blp rather than a numbered colour
  // suffix. Give its exported copy the same colour-index convention so this
  // particular colour set gets a unique, DBC-addressable BLP.
  return value.replace(/_regular(?=\.blp$)/i, `_${String(targetColor).padStart(2, '0')}`);
};
const hasColorIndexReplacement = (texturePath, sourceColor, targetColor) => (
  replaceColorIndexInPath(texturePath, sourceColor, targetColor) !== String(texturePath || '')
);
// Worgen Feature is a geoset selector. The client only ships one lower/upper
// facial-hair texture pair per colour; the individual Feature rows select the
// model shape, not separate Hair01..Hair08 BLPs.
const canonicalWorgenFeaturePath = (texturePath, colorIndex) => String(texturePath || '').replace(
  /(facial(?:lower|upper)hair)\d+_\d+(?=\.blp$)/i,
  (_, prefix) => `${prefix}00_${String(colorIndex).padStart(2, '0')}`
);
const getWorgenColorSetStatus = (records, race, sex, colorIndex) => {
  if (race !== 12) return null;
  const rows = records.filter(row => row.race === race && row.sex === sex && row.colorIndex === colorIndex);
  const isDeathKnightSet = rows.some(row => row.baseSection === 0 && row.flags === 5);
  const has = (baseSection, variationIndex, flags = null) => rows.some(row => row.baseSection === baseSection && row.variationIndex === variationIndex && (flags === null || row.flags === flags));
  const missing = [];
  if (isDeathKnightSet) {
    if (!has(0, 0, 5)) missing.push('DK skin');
    const dkFaces = [0, 10, 11, 12, 13, 14].filter(variation => !has(1, variation, 5));
    if (dkFaces.length) missing.push(`DK faces ${dkFaces.join(', ')}`);
    if (!rows.some(row => row.baseSection === 4 && row.flags === 5)) missing.push('DK underwear');
    return { total: rows.length, expected: 8, missing, invalidFacialHairPaths: [], invalidUnderwearPaths: [], unexpectedNpcRows: [], unwantedHairColorRows: [], isDeathKnightSet: true };
  }
  if (!has(0, 0)) missing.push('Skin atlas');
  const playerFaces = [0, 1, 2, 3, 4].filter(variation => !has(1, variation, 1));
  if (playerFaces.length) missing.push(`Player faces ${playerFaces.join(', ')}`);
  const dkFaces = [5, 6, 7, 8, 9].filter(variation => !has(1, variation, 5));
  if (dkFaces.length) missing.push(`DK faces ${dkFaces.join(', ')}`);
  const facialHair = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(variation => !has(2, variation, 17));
  if (facialHair.length) missing.push(`Facial hair ${facialHair.join(', ')}`);
  const hairSlots = [
    ...[0, 1, 2, 3, 4, 5, 6, 7].filter(variation => !has(3, variation, 17)),
    ...[8, 9, 10, 11, 12].filter(variation => !has(3, variation, 18)),
  ];
  if (hairSlots.length) missing.push(`Hair slots ${hairSlots.join(', ')}`);
  // Feature variation is selected by the M2 geoset. The client only ships the
  // Hair00 texture pair per colour; Hair01..Hair08 references resolve black.
  const invalidFacialHairPaths = colorIndex > 4 ? rows.filter(row => row.baseSection === 2 && row.flags === 17 &&
    [row.tex1, row.tex2].filter(Boolean).some(path => !/facial(?:lower|upper)hair00_\d+\.blp$/i.test(path))) : [];
  const invalidUnderwearPaths = rows.filter(row => row.baseSection === 4 && row.tex1 &&
    !/character[\\/]worgen[\\/]male[\\/]worgenmalenakedpelvisskin_regular\.blp$/i.test(row.tex1));
  const unexpectedNpcRows = colorIndex > 4 ? rows.filter(row => row.flags === 8) : [];
  if (!rows.some(row => row.baseSection === 4)) missing.push('Underwear');
  return { total: rows.length, expected: 34, missing, invalidFacialHairPaths, invalidUnderwearPaths, unexpectedNpcRows, unwantedHairColorRows: [], isDeathKnightSet: false };
};
const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));
const imageDataFromPng = png => new Promise((resolve,reject) => { const image=new Image(); image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);resolve(context.getImageData(0,0,image.width,image.height));};image.onerror=reject;image.src=`data:image/png;base64,${png}`; });
async function stageLinkedTexture(dataPath, texturePath, outputPath, targetColor, strength, protectDetails, transfer = null, copyOnly = false, preferStagedSource = true) {
  if (!texturePath) return null;
  // A second custom colour set may be based on an already staged colour set.
  // Prefer that staged BLP before falling back to the untouched client asset.
  const stagedSource = preferStagedSource && window.azeroth?.dbc?.readOutputBlpTexture
    ? await window.azeroth.dbc.readOutputBlpTexture(texturePath)
    : null;
  let source = stagedSource?.success ? stagedSource : await window.azeroth.dbc.readBlpTexture(dataPath, texturePath);
  if (!source?.success || !source.png) return null;
  const image = await imageDataFromPng(source.png);
  const analysis = colorSetClassifier.classify({ path: texturePath, width: image.width, height: image.height });
  const correction = analysis.template && colorSetCorrectionStore.list(analysis.template.id, analysis.template.version).find(item => item.width === image.width && item.height === image.height && item.protectedMask);
  const protectedMask = correction ? base64ToBytes(correction.protectedMask) : null;
  // A saved detailed mask takes precedence. If none exists, recolour the visible
  // face surface so a new Color Set is never left with the old face BLPs.
  const usableProtection = protectedMask?.length === image.width * image.height ? protectedMask : null;
  const mask = new Uint8Array(image.width * image.height);
  let recolored = image.data;
  if (copyOnly) {
    // Skin *_Extra BLPs are independently authored atlases. Clone them to the
    // new colour set without applying the main skin mask as if it were theirs.
  } else if (transfer?.recovery?.originalBase64 && transfer.rect) {
    const sourceOriginal = base64ToBytes(transfer.recovery.originalBase64);
    const sourceEdited = base64ToBytes(transfer.recovery.editedBase64);
    const sourceWidth = transfer.recovery.width, sourceHeight = transfer.recovery.height;
    if (sourceOriginal.length === sourceWidth * sourceHeight * 4 && sourceEdited.length === sourceOriginal.length) {
      recolored = new Uint8ClampedArray(image.data);
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const u = transfer.rect.x + ((x + .5) / image.width) * transfer.rect.width;
        const v = transfer.rect.y + ((y + .5) / image.height) * transfer.rect.height;
        const sx = Math.min(sourceWidth - 1, Math.max(0, Math.floor(u * sourceWidth)));
        const sy = Math.min(sourceHeight - 1, Math.max(0, Math.floor(v * sourceHeight)));
        const sourceOffset = (sy * sourceWidth + sx) * 4, index = y * image.width + x, offset = index * 4;
        if (usableProtection?.[index] || image.data[offset + 3] <= 12 || sourceOriginal[sourceOffset + 3] <= 12) continue;
        const difference = Math.abs(sourceEdited[sourceOffset] - sourceOriginal[sourceOffset]) + Math.abs(sourceEdited[sourceOffset + 1] - sourceOriginal[sourceOffset + 1]) + Math.abs(sourceEdited[sourceOffset + 2] - sourceOriginal[sourceOffset + 2]);
        if (difference < 12) continue;
        // Transfer the source's RGB ratio, not its literal pixels. That carries
        // the recovered fur/skin colour to a face variant while keeping the
        // variant's own shading and details.
        for (let channel = 0; channel < 3; channel++) {
          const ratio = Math.min(6, sourceEdited[sourceOffset + channel] / Math.max(8, sourceOriginal[sourceOffset + channel]));
          recolored[offset + channel] = clampByte(image.data[offset + channel] * ratio);
        }
        mask[index] = 255;
      }
    }
  } else if (transfer?.passes?.length) for (const pass of transfer.passes) {
    const projected = componentTransferService.projectMask(pass.mask, transfer.width, transfer.height, pass.rect, image.width, image.height, usableProtection);
    for (let i = 0; i < projected.length; i++) if (image.data[i * 4 + 3] <= 12) projected[i] = 0;
    recolored = colorSetRecolorEngine.recolor(recolored, projected, pass.targetColor, pass.strength);
    for (let i = 0; i < mask.length; i++) mask[i] ||= projected[i];
  } else {
    for (let i = 0; i < mask.length; i++) mask[i] = image.data[i * 4 + 3] > 12 && !(usableProtection?.[i]) ? 255 : 0;
    recolored = colorSetRecolorEngine.recolor(image.data, mask, targetColor, strength);
  }
  const result = await window.azeroth.dbc.writeBlpTextureEdit(dataPath, texturePath, bytesToBase64(new Uint8Array(recolored.buffer)), bytesToBase64(mask), outputPath, true);
  return result?.success ? result.path : null;
}

function TextureThumb({ blpPath, size = 56, preferOutput = false, refreshKey = 0 }) {
  const client = useBlpTexture(blpPath);
  const [staged, setStaged] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setStaged(null);
    if (!preferOutput || !blpPath || !window.azeroth?.dbc?.readOutputBlpTexture) return undefined;
    window.azeroth.dbc.readOutputBlpTexture(blpPath).then(result => {
      if (!cancelled && result?.success && result.png) setStaged({ dataUrl: `data:image/png;base64,${result.png}`, loading: false, error: null });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [blpPath, preferOutput, refreshKey]);
  const { dataUrl, loading, error } = staged || client;
  if (!blpPath) return <div className="cc-thumb cc-thumb-empty" style={{ width: size, height: size }} title="Geen texture pad">—</div>;
  if (loading) return <div className="cc-thumb cc-thumb-loading" style={{ width: size, height: size }}><Loader2 size={14} className="cc-spin" /></div>;
  if (error)   return <div className="cc-thumb cc-thumb-error" style={{ width: size, height: size }} title={error}><ImageOff size={14} /></div>;
  return (
    <div className="cc-thumb" style={{ width: size, height: size }}>
      <img src={dataUrl} alt={blpPath} />
    </div>
  );
}

function PreviewSlot({ label, path, size = 96 }) {
  const { dataUrl, loading, error } = useBlpTexture(path);
  const missing = !loading && (error || !path);
  return (
    <div className="cc-preview-slot">
      <div className="cc-preview-slot-label">{label}</div>
      <div className={`cc-preview-thumb ${missing ? 'cc-preview-thumb-missing' : ''}`} style={{ width: size, height: size }}>
        {loading ? <Loader2 size={16} className="cc-spin" /> :
         missing ? <><ImageOff size={16} /><span>{path ? 'Niet gevonden' : 'Leeg'}</span></> :
         <img src={dataUrl} alt={path} />}
      </div>
      <div className={`cc-preview-slot-path ${missing && path ? 'cc-path-error' : ''}`} title={path || ''}>
        {path ? path : <em>leeg</em>}
      </div>
    </div>
  );
}

function SwatchItem({ row, isSelected, onClick }) {
  const { dataUrl, loading, error } = useBlpTexture(row.tex1);
  const missing = !loading && (error || !row.tex1);
  return (
    <button
      className={`cc-swatch${isSelected ? ' cc-swatch-selected' : ''}${missing ? ' cc-swatch-error' : ''}`}
      onClick={onClick}
      title={`Var ${row.variationIndex} / Color ${row.colorIndex}${row.tex1 ? '\n' + row.tex1 : '\n(geen texture)'}`}
    >
      {loading ? <Loader2 size={11} className="cc-spin" /> :
       missing ? <ImageOff size={11} /> :
       <img src={dataUrl} alt="" />}
      <span className="cc-swatch-badge">{row.colorIndex}</span>
    </button>
  );
}

function CharVisualPicker({ rows, selectedId, setSelectedId, race, gender, hasDataPath, onEditTexture, textureRefreshKey = 0 }) {
  const pickerRef = useRef(null);

  const selectedRow = useMemo(
    () => rows.find(r => r.id === selectedId) || rows[0] || null,
    [rows, selectedId]
  );

  const groups = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.variationIndex)) map.set(row.variationIndex, []);
      map.get(row.variationIndex).push(row);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([v, items]) => ({ variation: v, items: items.sort((a, b) => a.colorIndex - b.colorIndex) }));
  }, [rows]);

  const handleKeyDown = useCallback((e) => {
    if (!selectedRow || groups.length === 0) return;
    const curGroupIdx = groups.findIndex(g => g.items.some(r => r.id === selectedRow.id));
    if (curGroupIdx === -1) return;
    const curGroup = groups[curGroupIdx];
    const posInGroup = curGroup.items.findIndex(r => r.id === selectedRow.id);

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? curGroup.items[posInGroup + 1] : curGroup.items[posInGroup - 1];
      if (next) setSelectedId(next.id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const nextGroup = e.key === 'ArrowDown' ? groups[curGroupIdx + 1] : groups[curGroupIdx - 1];
      if (nextGroup) {
        const targetPos = Math.min(posInGroup, nextGroup.items.length - 1);
        setSelectedId(nextGroup.items[targetPos].id);
      }
    }
  }, [selectedRow, groups, setSelectedId]);

  useEffect(() => {
    const el = pickerRef.current;
    if (!el) return;
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <aside className="cc-visual-picker" ref={pickerRef} tabIndex={0}>
      <div className="cc-vp-model">
        <CharM2Viewer
          race={race}
          gender={gender}
          skinBlp={selectedRow?.tex1 || null}
          textureRefreshKey={textureRefreshKey}
          active={hasDataPath}
        />
      </div>

      <div className="cc-vp-swatches">
        {!hasDataPath && (
          <div className="cc-preview-warn">Geen WoW Data-pad — textures laden niet.</div>
        )}
        {rows.length === 0 ? (
          <div className="cc-preview-empty">Geen records voor deze selectie.</div>
        ) : (
          groups.map(({ variation, items }) => (
            <div key={variation} className="cc-swatch-group">
              <div className="cc-swatch-group-label">Var {variation}</div>
              <div className="cc-swatch-row">
                {items.map(row => (
                  <SwatchItem
                    key={row.id}
                    row={row}
                    isSelected={selectedRow?.id === row.id}
                    onClick={() => setSelectedId(row.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {selectedRow && (
        <div className="cc-vp-detail">
          <div className="cc-vp-detail-header">
            <span className="cc-vp-detail-id">ID {selectedRow.id}</span>
            <span className="cc-vp-detail-coords">
              Var <strong>{selectedRow.variationIndex}</strong>
              {' / '}
              Color <strong>{selectedRow.colorIndex}</strong>
            </span>
            <span className="cc-vp-detail-flags">{selectedRow.flags === 1 ? 'Player' : 'NPC'}</span>
          </div>
          <div className="cc-vp-slots">
            <div className="cc-vp-slot-with-action">
              <PreviewSlot label="Tex 1" path={selectedRow.tex1} />
              {hasDataPath && selectedRow.tex1 && (
                <button
                  className="cc-btn cc-btn-ghost cc-edit-tex-btn"
                  onClick={() => onEditTexture?.(selectedRow)}
                  title="Texture bewerken (recolor)"
                >
                  <Pencil size={12} /> Bewerk
                </button>
              )}
            </div>
            <PreviewSlot label="Tex 2" path={selectedRow.tex2} />
            <PreviewSlot label="Tex 3" path={selectedRow.tex3} />
          </div>
        </div>
      )}
    </aside>
  );
}

function ColorSetWorkspace({ records, race, gender, hasDataPath, preferOutput = false, onEditTexture, onCompleteLinkedSet, onRemoveInvalidNpcRows, textureRefreshKey = 0 }) {
  const skins = useMemo(() => records.filter(r => r.race === race && r.sex === gender && r.baseSection === 0).sort((a, b) => a.colorIndex - b.colorIndex), [records, race, gender]);
  const [skinId, setSkinId] = useState(null);
  const [faceId, setFaceId] = useState(null);
  const [completionSourceColor, setCompletionSourceColor] = useState('');
  const skin = skins.find(r => r.id === skinId) || skins[0] || null;
  const worgenStatus = useMemo(() => skin ? getWorgenColorSetStatus(records, race, gender, skin.colorIndex) : null, [records, race, gender, skin]);
  const completionSources = useMemo(() => skins.filter(row => row.colorIndex !== skin?.colorIndex), [skins, skin]);
  const setFlags = skin?.flags === 5 ? 5 : 17;
  const faces = useMemo(() => !skin ? [] : records.filter(r => r.race === race && r.sex === gender && r.baseSection === 1 && r.colorIndex === skin.colorIndex && r.flags === (setFlags === 5 ? 5 : 1)).sort((a, b) => a.variationIndex - b.variationIndex), [records, race, gender, skin, setFlags]);
  const underwear = useMemo(() => !skin ? [] : records.filter(r => r.race === race && r.sex === gender && r.baseSection === 4 && r.colorIndex === skin.colorIndex && r.flags === setFlags), [records, race, gender, skin, setFlags]);
  const face = faces.find(r => r.id === faceId) || faces[0] || null;
  const hair = useMemo(() => !skin ? null : records.find(r => r.race === race && r.sex === gender && r.baseSection === 3 && r.colorIndex === skin.colorIndex && r.tex1) || records.find(r => r.race === race && r.sex === gender && r.baseSection === 3 && r.tex1) || null, [records, race, gender, skin]);
  const layers = [
    ...(face ? [{ path: face.tex1, region: 'face-lower' }, { path: face.tex2, region: 'face-upper' }] : []),
    ...(hair?.tex1 ? [{ path: hair.tex1, region: 'hair-primary' }] : []),
  ];
  const linkedComponents = useMemo(() => {
    if (!skin) return [];
    const faceFlags = setFlags === 5 ? 5 : 1;
    const rows = records.filter(row => row.race === race && row.sex === gender && row.colorIndex === skin.colorIndex && [0, 1, 4].includes(row.baseSection) && row.flags === (row.baseSection === 1 ? faceFlags : setFlags));
    const seen = new Map();
    for (const row of rows) for (const [field, path] of [['tex1', row.tex1], ['tex2', row.tex2], ['tex3', row.tex3]]) {
      if (!path) continue;
      const key = path.toLowerCase();
      const item = seen.get(key) || { path, uses: [] };
      item.uses.push({ id: row.id, section: row.baseSection, variation: row.variationIndex, field });
      seen.set(key, item);
    }
    return [...seen.values()];
  }, [records, race, gender, skin, setFlags]);
  const mappingFamilies = useMemo(() => {
    const groups = new Map();
    for (const component of linkedComponents) {
      const family = componentMappingFromPath(component.path);
      if (!family) continue;
      const group = groups.get(family) || { family, files: [] };
      group.files.push(component);
      groups.set(family, group);
    }
    return [...groups.values()];
  }, [linkedComponents]);
  useEffect(() => {
    setFaceId(null);
    const savedSource = skin ? colorSetProvenanceStore.get(skin.race, skin.sex, skin.colorIndex)?.sourceColorIndex : null;
    setCompletionSourceColor(savedSource !== null && savedSource !== undefined ? String(savedSource) : String(completionSources[0]?.colorIndex ?? ''));
  }, [skin?.id]);

  return <div className="cc-set-workspace">
    <aside className="cc-set-skins">
      <strong>Skin / ColorIndex</strong>
      {skins.map(row => <button key={row.id} className={`cc-set-skin ${skin?.id === row.id ? 'active' : ''}`} onClick={() => setSkinId(row.id)}>
        <TextureThumb blpPath={row.tex1} size={42} preferOutput={preferOutput} refreshKey={textureRefreshKey} /><span>Color {row.colorIndex}<small>{row.flags === 5 ? 'DK' : 'Player'}</small></span>
      </button>)}
    </aside>
    <section className="cc-set-preview">
      <CharM2Viewer race={race} gender={gender} skinBlp={skin?.tex1 || null} skinExtraBlp={skin?.tex2 || null} textureLayers={layers} appearance={{ face: face?.variationIndex || 0, hairStyle: hair?.variationIndex || 0, hairColor: hair?.colorIndex || 0 }} preferOutput={preferOutput} textureRefreshKey={textureRefreshKey} active={hasDataPath} />
      {skin && <button className="cc-btn cc-btn-primary" onClick={() => onEditTexture(skin)}><Pencil size={14}/> Bewerk skin</button>}
    </section>
    <aside className="cc-set-parts">
      <strong>Linked components</strong>
      <p className="cc-set-hint">Edit only the Skin. Export creates a new linked CharSections colour set.</p>
      <div className="cc-set-part"><span>Skin atlas</span><button className="cc-btn cc-btn-ghost" onClick={() => onEditTexture(skin)} disabled={!skin}>Edit</button></div>
      {worgenStatus && <div className={`cc-set-completeness ${worgenStatus.missing.length || worgenStatus.invalidFacialHairPaths.length || worgenStatus.invalidUnderwearPaths.length || worgenStatus.unexpectedNpcRows.length || worgenStatus.unwantedHairColorRows.length ? 'incomplete' : 'complete'}`}>
        <strong>Worgen colour set: {worgenStatus.total} / {worgenStatus.expected} records</strong>
        {worgenStatus.missing.length || worgenStatus.invalidFacialHairPaths.length || worgenStatus.invalidUnderwearPaths.length || worgenStatus.unexpectedNpcRows.length || worgenStatus.unwantedHairColorRows.length ? <>
          {worgenStatus.missing.length ? <small>Missing: {worgenStatus.missing.join(' · ')}</small> : null}
          {worgenStatus.invalidFacialHairPaths.length ? <small>Facial-hair BLPs must reuse the selected source colour's existing variation matrix; {worgenStatus.invalidFacialHairPaths.length} row(s) still point to an ungenerated custom range.</small> : null}
          {worgenStatus.invalidUnderwearPaths.length ? <small>Worgen underclothing must reuse `WorgenMaleNakedPelvisSkin_regular.blp`; {worgenStatus.invalidUnderwearPaths.length} custom path(s) must be repaired.</small> : null}
          {worgenStatus.unexpectedNpcRows.length ? <small>{worgenStatus.unexpectedNpcRows.length} Flags 8 NPC row(s) reference Fel Orc assets and do not belong in this custom Worgen colour set. They will be removed.</small> : null}
          {worgenStatus.unexpectedNpcRows.length ? <button className="cc-btn cc-btn-ghost" onClick={() => onRemoveInvalidNpcRows?.(skin)}>Remove invalid NPC rows only</button> : null}
          {worgenStatus.unwantedHairColorRows.length ? <small>{worgenStatus.unwantedHairColorRows.length} BaseSection 3 row(s) incorrectly create a new hair-colour option. They will be removed.</small> : null}
          <label>Copy missing parts from
            <select value={completionSourceColor} onChange={event => setCompletionSourceColor(event.target.value)}>
              {completionSources.map(row => <option key={row.id} value={row.colorIndex}>Color {row.colorIndex}</option>)}
            </select>
          </label>
          <button className="cc-btn cc-btn-primary" disabled={!completionSourceColor} onClick={() => onCompleteLinkedSet?.(skin, Number(completionSourceColor))}>{worgenStatus.missing.length ? 'Complete missing Worgen parts' : 'Repair Worgen support references'}</button>
          <small>Creates or repairs skin-bound face/facial-hair rows and removes accidental hair-colour rows. Your current Skin is kept.</small>
        </> : <small>{worgenStatus.isDeathKnightSet ? 'Complete DK set: its six DK face variations and underwear are intentionally independent from player Features and Hair Color.' : 'Complete: Skin, player/DK faces, facial hair and underwear are present. Hair colours remain independent.'}</small>}
      </div>}
      {skin?.tex2 && <div className="cc-set-blp"><span>Skin extra</span><TextureThumb blpPath={skin.tex2} size={36} preferOutput={preferOutput} refreshKey={textureRefreshKey} /></div>}
      <div className="cc-set-blp-group">
        <span>Underwear ({underwear.length})</span>
        {underwear.length ? underwear.map(row => <div key={row.id} className="cc-set-blp-pair"><TextureThumb blpPath={row.tex1} size={36} preferOutput={preferOutput} refreshKey={textureRefreshKey} /><span>{row.tex2 ? <TextureThumb blpPath={row.tex2} size={36} preferOutput={preferOutput} refreshKey={textureRefreshKey} /> : <em>No torso texture</em>}</span></div>) : <em>No linked record</em>}
        <small>Pelvis; female also has a separate torso overlay.</small>
      </div>
      <div className="cc-set-face-list"><span>Face-varianten ({faces.length})</span>{faces.map(row => <button key={row.id} className={`cc-set-face ${face?.id === row.id ? 'active' : ''}`} onClick={() => setFaceId(row.id)}>Face {row.variationIndex}</button>)}</div>
      {face && <button className="cc-btn cc-btn-ghost" onClick={() => onEditTexture(face)}><Pencil size={14}/> Edit selected face</button>}
      <div className="cc-set-blp-group"><span>All linked BLPs ({linkedComponents.length})</span>{linkedComponents.map(component => <div key={component.path} className="cc-set-blp-pair"><TextureThumb blpPath={component.path} size={32} preferOutput={preferOutput} refreshKey={textureRefreshKey} /><small title={component.path}>{component.uses.map(use => `${use.section === 1 ? `Face ${String(use.variation).padStart(2, '0')}` : use.section === 4 ? 'Underwear' : 'Skin'} / ${use.field}`).join(' · ')}</small></div>)}</div>
      <div className="cc-set-blp-group"><span>Unique atlas mappings ({mappingFamilies.length})</span>{mappingFamilies.map(group => <small key={group.family}>{group.family}: {group.files.length} BLP target{group.files.length !== 1 ? 's' : ''}</small>)}</div>
    </aside>
  </div>;
}

export default function CharCustomizationPage() {
  const { readCharSections, writeCharSections, dbcPath, worldmapMpqPath } = useConnection();

  const [allRecords, setAllRecords] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [saving, setSaving]         = useState(false);
  const [testMode, setTestMode]     = useState(true);
  const [testOutput, setTestOutput] = useState(null);
  const [saveMsg, setSaveMsg]       = useState(null);
  const [dirty, setDirty]           = useState(false);
  const unsavedGuard = useUnsavedGuard(dirty);

  const [race,      setRace]     = useState(1);
  const [gender,    setGender]   = useState(0);
  const [section,   setSection]  = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [viewMode,  setViewMode] = useState('sets'); // 'sets' | 'table' | 'preview'
  const [editingTexRow, setEditingTexRow] = useState(null); // rij waarvan tex1 bewerkt wordt
  const [editingTextureField, setEditingTextureField] = useState('tex1');
  const [editorSaveMode, setEditorSaveMode] = useState('create'); // 'create' | 'update'
  const [textureRefreshKey, setTextureRefreshKey] = useState(0);

  const openTextureEditor = (row, field = 'tex1') => {
    if (!row?.[field]) return;
    setEditingTextureField(field);
    setEditorSaveMode(colorSetProvenanceStore.get(row.race, row.sex, row.colorIndex) ? 'update' : 'create');
    setEditingTexRow(row);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const testResult = testMode ? await window.azeroth.dbc.readCharSectionsTestOutput() : null;
    const r = testResult?.success ? testResult : await readCharSections();
    setLoading(false);
    if (r.success) {
      setAllRecords(r.records);
      setTestOutput(testMode ? testResult : null);
      setDirty(false);
    } else {
      setTestOutput(testMode ? testResult : null);
      setError(r.error);
    }
  }, [readCharSections, testMode]);

  useEffect(() => { load(); }, [load]);

  const toggleTestMode = (enabled) => {
    if (dirty) {
      setSaveMsg('Save or discard the current changes before switching the test build.');
      return;
    }
    setTestMode(enabled);
  };

  // Flags 8 contains the custom NPC-skin set. Keep it in the DBC,
  // but hide it from the normal character-look workflow until that set gets its own editor.
  const normalRecords = allRecords ? allRecords.filter(r => r.flags !== 8) : [];
  const raceTextureCollision = useMemo(
    () => findRaceTextureCollisions(allRecords).find(entry => entry.raceId === race) || null,
    [allRecords, race],
  );
  const visibleRows = allRecords
    ? normalRecords.filter(r => r.race === race && r.sex === gender && r.baseSection === section)
    : [];

  const selectedRow = useMemo(() => {
    if (!allRecords) return null;
    if (selectedId == null) return visibleRows[0] || null;
    return normalRecords.find(r => r.id === selectedId) || visibleRows[0] || null;
  }, [normalRecords, selectedId, visibleRows]);

  const editorOutputPath = useMemo(() => {
    if (!editingTexRow || !allRecords || editingTexRow.baseSection !== 0) return null;
    const provenance = colorSetProvenanceStore.get(editingTexRow.race, editingTexRow.sex, editingTexRow.colorIndex);
    // A derived colour set is editable until the DBC is committed. Re-save to
    // its own staged path instead of allocating a new colour index each time.
    if (provenance && editorSaveMode === 'update' && (editingTextureField === 'tex1' || editingTextureField === 'tex2')) return editingTexRow[editingTextureField];
    const nextColor = allRecords
      .filter(row => row.race === editingTexRow.race && row.sex === editingTexRow.sex && row.baseSection === 0)
      .reduce((max, row) => Math.max(max, row.colorIndex), -1) + 1;
    const sourcePath = editingTexRow[editingTextureField];
    return hasColorIndexReplacement(sourcePath, editingTexRow.colorIndex, nextColor)
      ? replaceColorIndexInPath(sourcePath, editingTexRow.colorIndex, nextColor)
      : null;
  }, [editingTexRow, editingTextureField, allRecords, editorSaveMode]);
  const editingProvenance = useMemo(() => editingTexRow ? colorSetProvenanceStore.get(editingTexRow.race, editingTexRow.sex, editingTexRow.colorIndex) : null, [editingTexRow]);

  const updateField = (id, field, value) => {
    setAllRecords(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    setDirty(true);
  };

  const addRow = () => {
    const maxId = allRecords.reduce((m, r) => Math.max(m, r.id), 0);
    const newRow = {
      id: maxId + 1,
      race,
      sex: gender,
      baseSection: section,
      tex1: '',
      tex2: '',
      tex3: '',
      flags: 1,
      variationIndex: 0,
      colorIndex: 0,
    };
    setAllRecords(prev => [...prev, newRow]);
    setDirty(true);
  };

  const deleteRow = (id) => {
    setAllRecords(prev => prev.filter(r => r.id !== id));
    setDirty(true);
  };

  const handleTextureSaved = async (exportResult) => {
    const sourceRow = editingTexRow;
    const sourceField = editingTextureField;
    const sourceTexturePath = sourceRow?.[sourceField];
    if (!sourceRow || !allRecords) return { success: false, error: 'No source colour set is loaded.' };
    const newRelPath = exportResult?.path;
    const targetSetFlags = exportResult?.targetSetFlags === 5 ? 5 : 17;
    if (!newRelPath) return { success: false, error: 'The BLP export did not return an output path.' };
    const requestedSaveMode = exportResult?.saveMode || editorSaveMode;

    const closeEditorAfterSave = () => {
      setEditingTexRow(null);
      setEditingTextureField('tex1');
      setEditorSaveMode('create');
    };
    try {

    const existingProvenance = colorSetProvenanceStore.get(sourceRow.race, sourceRow.sex, sourceRow.colorIndex);
    if (sourceRow.baseSection === 0 && requestedSaveMode === 'update' && (sourceField === 'tex1' || sourceField === 'tex2') && existingProvenance) {
      let rebuilt = 0, failed = 0;
      if (sourceField === 'tex1' && exportResult.recoveryTransfer) {
        const mappings = { ...DEFAULT_COMPONENT_RECTANGLES, ...(exportResult.componentMappings || {}) };
        const transferFor = component => {
          const rect = mappings[component];
          return rect ? { recovery: exportResult.recoveryTransfer, rect } : null;
        };
        const linked = new Map();
        for (const row of allRecords) {
          if (row.race !== sourceRow.race || row.sex !== sourceRow.sex || row.colorIndex !== sourceRow.colorIndex || ![1, 4].includes(row.baseSection)) continue;
          // Face variations may deliberately use a different flag from the
          // body colour set (Worgen 5–9 are an example). They still belong to
          // this colour index and need the same atlas transfer.
          if (row.baseSection === 4 && row.flags !== sourceRow.flags) continue;
          for (const outputPath of [row.tex1, row.tex2, row.tex3]) {
            const component = componentMappingFromPath(outputPath);
            if (outputPath && component) linked.set(outputPath, component);
          }
        }
        for (const [outputPath, component] of linked) {
          const originalPath = existingProvenance.linkedTextureSources?.[String(outputPath).toLowerCase()]
            || replaceColorIndexInPath(outputPath, sourceRow.colorIndex, existingProvenance.sourceColorIndex);
          if (!originalPath || originalPath === outputPath) { failed++; continue; }
          const staged = await stageLinkedTexture(worldmapMpqPath, originalPath, outputPath, exportResult.targetColor, exportResult.strength, component.startsWith('face-'), transferFor(component), false, false);
          if (staged) rebuilt++; else failed++;
        }
      }
      setAllRecords(prev => prev.map(row => row.id === sourceRow.id ? { ...row, [sourceField]: newRelPath } : row));
      setSelectedId(sourceRow.id);
      setDirty(true);
      setTextureRefreshKey(value => value + 1);
      const syncNote = sourceField === 'tex1' && exportResult.recoveryTransfer ? ` Rebuilt ${rebuilt} linked face/underwear BLPs${failed ? `; ${failed} could not be mapped` : ''}.` : '';
      setSaveMsg(`Updated ${sourceField === 'tex1' ? 'Skin atlas' : 'Skin Extra'} for Color ${sourceRow.colorIndex}; base is Color ${existingProvenance.sourceColorIndex}.${syncNote}`);
      closeEditorAfterSave();
      return { success: true };
    }

    let nextId = allRecords.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    const groupRows = allRecords.filter(r =>
      r.race === sourceRow.race && r.sex === sourceRow.sex && r.baseSection === sourceRow.baseSection
    );

    if (sourceRow.baseSection === 0) {
      const nextColor = groupRows.reduce((m, r) => Math.max(m, r.colorIndex), -1) + 1;
      // A new skin colour is a new colour column in the existing face matrix:
      // keep every face variation, change only its colour suffix/index.
      // BaseSection 3 has intentionally empty BLP fields, but its 13 records
      // are still part of Worgen's client-side customization slot matrix.
      const linkedSections = new Set([0, 1, 2, 3, 4]);
      const sourceSetFlags = sourceRow.flags === 5 ? 5 : 17;
      const templates = allRecords.filter(r =>
        r.race === sourceRow.race && r.sex === sourceRow.sex &&
        r.colorIndex === sourceRow.colorIndex &&
        linkedSections.has(r.baseSection) && (
          sourceSetFlags === 5
            ? (r.baseSection === 1 ? r.flags === 5 : r.flags === 5)
            : (r.baseSection === 1 ? [1, 5].includes(r.flags) : r.baseSection === 3 ? [17, 18].includes(r.flags) : r.flags === 17)
        )
      );
      const sourceMask = exportResult.sourceMaskBase64 ? base64ToBytes(exportResult.sourceMaskBase64) : null;
      const mappings = { ...DEFAULT_COMPONENT_RECTANGLES, ...(exportResult.componentMappings || {}) };
      const transferFor = component => {
        const rect = mappings[component];
        if (exportResult.recoveryTransfer && rect) return { recovery: exportResult.recoveryTransfer, rect };
        const passes = (exportResult.componentPasses || []).map(pass => ({ ...pass, rect: pass.mappings?.[component] || mappings[component] })).filter(pass => pass.rect);
        return passes.length ? { passes, width: exportResult.sourceWidth, height: exportResult.sourceHeight } : null;
      };
      const facePaths = [...new Set(templates.filter(r => r.baseSection === 1).flatMap(r => [r.tex1, r.tex2, r.tex3]).filter(Boolean))];
      const underwearPaths = [...new Set(templates.filter(r => r.baseSection === 4).flatMap(r => [r.tex1, r.tex2, r.tex3]).filter(Boolean))];
      const skinExtraPaths = [...new Set(templates.filter(r => r.baseSection === 0).flatMap(r => [r.tex2, r.tex3]).filter(Boolean))];
      const supportPaths = [...new Set(templates.filter(r => r.baseSection === 2).flatMap(r => [r.tex1, r.tex2, r.tex3]).filter(Boolean))];
      // Some CharSections links are deliberately shared/static (for example
      // Worgen underwear). They are valid in a new colour set without a
      // colour suffix and must stay linked instead of blocking registration.
      const isSkinAtlasExport = sourceField === 'tex1';
      const stagedSkinBase = new Map();
      if (!isSkinAtlasExport && sourceRow.tex1) {
        const outputPath = replaceColorIndexInPath(sourceRow.tex1, sourceRow.colorIndex, nextColor);
        const staged = await stageLinkedTexture(worldmapMpqPath, sourceRow.tex1, outputPath, exportResult.targetColor, exportResult.strength, false, null, true);
        if (staged) stagedSkinBase.set(sourceRow.tex1, staged);
      }
      const stagedSkinExtras = new Map();
      for (const extraPath of skinExtraPaths) {
        const outputPath = replaceColorIndexInPath(extraPath, sourceRow.colorIndex, nextColor);
        const staged = extraPath === sourceTexturePath
          ? newRelPath
          : await stageLinkedTexture(worldmapMpqPath, extraPath, outputPath, exportResult.targetColor, exportResult.strength, false, null, true);
        if (staged) stagedSkinExtras.set(extraPath, staged);
      }
      const stagedFaces = new Map();
      for (const facePath of facePaths) {
        const component = componentMappingFromPath(facePath);
        const outputPath = replaceColorIndexInPath(facePath, sourceRow.colorIndex, nextColor);
        const staged = await stageLinkedTexture(worldmapMpqPath, facePath, outputPath, exportResult.targetColor, exportResult.strength, true, isSkinAtlasExport ? transferFor(component) : null, !isSkinAtlasExport);
        if (staged) stagedFaces.set(facePath, staged);
      }
      const stagedUnderwear = new Map();
      for (const underwearPath of underwearPaths) {
        const component = componentMappingFromPath(underwearPath);
        const outputPath = replaceColorIndexInPath(underwearPath, sourceRow.colorIndex, nextColor);
        if (outputPath === underwearPath) {
          stagedUnderwear.set(underwearPath, underwearPath);
          continue;
        }
        const staged = await stageLinkedTexture(worldmapMpqPath, underwearPath, outputPath, exportResult.targetColor, exportResult.strength, false, isSkinAtlasExport ? transferFor(component) : null, !isSkinAtlasExport);
        if (staged) stagedUnderwear.set(underwearPath, staged);
      }
      const stagedSupport = new Map();
      for (const supportPath of supportPaths) {
        // Worgen base section 2 is an authored support variation, not an atlas
        // crops. Its nine geoset slots share the shipped Hair00 texture pair;
        // Hair01..Hair08 paths in older custom DBCs do not exist in the client.
        if (sourceRow.race === 12) stagedSupport.set(supportPath, canonicalWorgenFeaturePath(supportPath, sourceRow.colorIndex));
        else {
          const outputPath = replaceColorIndexInPath(supportPath, sourceRow.colorIndex, nextColor);
          const staged = await stageLinkedTexture(worldmapMpqPath, supportPath, outputPath, exportResult.targetColor, exportResult.strength, false, null, true);
          if (staged) stagedSupport.set(supportPath, staged);
        }
      }
      const stagedPathFor = texturePath => texturePath === sourceTexturePath ? newRelPath : stagedSkinBase.get(texturePath) || stagedSkinExtras.get(texturePath) || stagedFaces.get(texturePath) || stagedUnderwear.get(texturePath) || stagedSupport.get(texturePath) || texturePath;
      const clones = templates.map(r => ({
        ...r,
        id: nextId++,
        colorIndex: nextColor,
        flags: r.baseSection === 0 || r.baseSection === 4 ? targetSetFlags : r.flags,
        tex1: stagedPathFor(r.tex1),
        tex2: stagedPathFor(r.tex2),
        tex3: stagedPathFor(r.tex3),
      }));
      colorSetProvenanceStore.save({
        race: sourceRow.race,
        sex: sourceRow.sex,
        sourceColorIndex: sourceRow.colorIndex,
        outputColorIndex: nextColor,
        sourceSkinPath: sourceRow.tex1,
        outputSkinPath: stagedPathFor(sourceRow.tex1),
        sourceExtraPath: sourceRow.tex2 || null,
        outputExtraPath: stagedPathFor(sourceRow.tex2),
        sourceFlags: sourceRow.flags,
        outputFlags: targetSetFlags,
      });
      const selected = clones.find(r => r.baseSection === 0 && r.variationIndex === sourceRow.variationIndex);
      setAllRecords(prev => [...prev, ...clones]);
      setTextureRefreshKey(value => value + 1);
      if (selected) setSelectedId(selected.id);
      if (facePaths.length && stagedFaces.size !== facePaths.length) setSaveMsg(`Created Color ${nextColor}, but ${facePaths.length - stagedFaces.size} linked face texture(s) could not be staged.`);
      else setSaveMsg(`Created Color ${nextColor}. The texture and ${clones.length - 1} linked appearance records are staged; press Save to write the test DBC.`);
    } else {
      const sameColorRows = groupRows.filter(r => r.colorIndex === sourceRow.colorIndex);
      const nextVariation = sameColorRows.reduce((m, r) => Math.max(m, r.variationIndex), -1) + 1;
      const newRow = {
        ...sourceRow,
        id: nextId,
        tex1: newRelPath,
        variationIndex: nextVariation,
      };
      setAllRecords(prev => [...prev, newRow]);
      setSelectedId(newRow.id);
    }
    setDirty(true);
    closeEditorAfterSave();
    return { success: true };
    } catch (error) {
      const message = error.message || 'An unexpected linked-texture error occurred.';
      setSaveMsg(`Texture export was not registered: ${message}. The canvas stays open so you can retry or close it manually.`);
      return { success: false, error: message };
    }
  };

  const removeInvalidWorgenNpcRows = (skinRow) => {
    if (!skinRow || skinRow.race !== 12 || skinRow.colorIndex <= 4) return;
    const removed = allRecords.filter(row => row.race === skinRow.race && row.sex === skinRow.sex && row.colorIndex === skinRow.colorIndex && row.flags === 8).length;
    setAllRecords(prev => prev.filter(row => !(row.race === skinRow.race && row.sex === skinRow.sex && row.colorIndex === skinRow.colorIndex && row.flags === 8)));
    if (removed) {
      setDirty(true);
      setSaveMsg(`Removed ${removed} invalid NPC row${removed === 1 ? '' : 's'} from Worgen Color ${skinRow.colorIndex}. Save the test DBC and test this change in isolation.`);
    }
  };

  const completeLinkedSet = async (skinRow, selectedSourceColor = null) => {
    const savedProvenance = colorSetProvenanceStore.get(skinRow.race, skinRow.sex, skinRow.colorIndex);
    const sourceColorIndex = Number.isInteger(selectedSourceColor) ? selectedSourceColor : Number(savedProvenance?.sourceColorIndex);
    const sourceSkinRow = allRecords.find(row => row.race === skinRow.race && row.sex === skinRow.sex && row.baseSection === 0 && row.colorIndex === sourceColorIndex);
    const provenance = {
      ...savedProvenance,
      sourceColorIndex,
      sourceSkinPath: savedProvenance?.sourceSkinPath || sourceSkinRow?.tex1,
    };
    if (!provenance.sourceSkinPath || Number.isNaN(sourceColorIndex)) {
      setSaveMsg(`Choose a source colour before completing Color ${skinRow.colorIndex}.`);
      return;
    }
    setSaving(true);
    try {
      const readImage = async (path) => {
        const staged = window.azeroth?.dbc?.readOutputBlpTexture ? await window.azeroth.dbc.readOutputBlpTexture(path) : null;
        const result = staged?.success ? staged : await window.azeroth.dbc.readBlpTexture(worldmapMpqPath, path);
        return result?.success && result.png ? imageDataFromPng(result.png) : null;
      };
      const [sourceSkin, editedSkin] = await Promise.all([readImage(provenance.sourceSkinPath), readImage(skinRow.tex1)]);
      if (!sourceSkin || !editedSkin || sourceSkin.width !== editedSkin.width || sourceSkin.height !== editedSkin.height) throw new Error('the original and edited Skin atlas could not be read as a matching pair');
      const recovery = {
        originalBase64: bytesToBase64(sourceSkin.data), editedBase64: bytesToBase64(editedSkin.data),
        width: sourceSkin.width, height: sourceSkin.height,
      };
      const mappings = { ...DEFAULT_COMPONENT_RECTANGLES };
      const sourceLinked = allRecords.filter(row => row.race === skinRow.race && row.sex === skinRow.sex && row.colorIndex === provenance.sourceColorIndex && (
        (row.baseSection === 1 && [1, 5].includes(row.flags)) || row.baseSection === 2 || row.baseSection === 3 || row.baseSection === 4
      ));
      if (!sourceLinked.length) throw new Error(`no linked appearance rows exist for source Color ${provenance.sourceColorIndex}`);
      if (skinRow.race === 12) {
        const sourceHas = (baseSection, variationIndex, flags = null) => sourceLinked.some(row => row.baseSection === baseSection && row.variationIndex === variationIndex && (flags === null || row.flags === flags));
        const missingSourceSlots = [
          ...[0, 1, 2, 3, 4].filter(variation => !sourceHas(1, variation, 1)).map(variation => `player face ${variation}`),
          ...[5, 6, 7, 8, 9].filter(variation => !sourceHas(1, variation, 5)).map(variation => `DK face ${variation}`),
          ...[0, 1, 2, 3, 4, 5, 6, 7, 8].filter(variation => !sourceHas(2, variation, 17)).map(variation => `feature ${variation}`),
          ...[0, 1, 2, 3, 4, 5, 6, 7].filter(variation => !sourceHas(3, variation, 17)).map(variation => `hair slot ${variation}`),
          ...[8, 9, 10, 11, 12].filter(variation => !sourceHas(3, variation, 18)).map(variation => `hair slot ${variation}`),
          ...(sourceLinked.some(row => row.baseSection === 4) ? [] : ['underwear']),
        ];
        if (missingSourceSlots.length) throw new Error(`source Color ${sourceColorIndex} is incomplete (${missingSourceSlots.join(', ')}). Choose an intact source colour such as Color 1 or Color 2.`);
      }
      let nextId = allRecords.reduce((max, row) => Math.max(max, row.id), 0) + 1;
      const replacements = new Map();
      const additions = [];
      for (const sourceFace of sourceLinked) {
        const staged = {};
        for (const field of ['tex1', 'tex2', 'tex3']) {
          const sourcePath = sourceFace[field];
          if (!sourcePath) continue;
          const isFace = sourceFace.baseSection === 1;
          const reuseWorgenSupport = skinRow.race === 12 && (sourceFace.baseSection === 2 || sourceFace.baseSection === 4);
          const materialSource = sourcePath;
          const outputPath = reuseWorgenSupport
            ? canonicalWorgenFeaturePath(sourcePath, sourceColorIndex)
            : replaceColorIndexInPath(materialSource, sourceColorIndex, skinRow.colorIndex);
          const existing = allRecords.find(row => row.race === skinRow.race && row.sex === skinRow.sex && row.baseSection === sourceFace.baseSection && String(row[field] || '').toLowerCase() === outputPath.toLowerCase());
          const component = componentMappingFromPath(materialSource);
          const written = reuseWorgenSupport || existing ? outputPath : await stageLinkedTexture(worldmapMpqPath, materialSource, outputPath, '#000000', 1, isFace, isFace ? { recovery, rect: mappings[component] } : null, !isFace, false);
          staged[field] = written || null;
          if (!staged[field]) throw new Error(`could not stage ${sourcePath}`);
        }
        // A Worgen facial-hair variation is a DBC slot, even though every slot
        // deliberately shares the same physical Hair00 BLP pair. Match the
        // slot, never its texture filename, otherwise repairing one variation
        // would overwrite variation 0 repeatedly and leave the others stale.
        const existingRow = allRecords.find(row => row.race === skinRow.race && row.sex === skinRow.sex &&
          row.baseSection === sourceFace.baseSection && row.colorIndex === skinRow.colorIndex &&
          row.flags === sourceFace.flags && row.variationIndex === sourceFace.variationIndex);
        const completed = { ...sourceFace, ...(existingRow || { id: nextId++ }), colorIndex: skinRow.colorIndex, ...staged };
        if (existingRow) replacements.set(existingRow.id, completed); else additions.push(completed);
      }
      setAllRecords(prev => [
        ...prev
          .filter(row => !(skinRow.race === 12 && skinRow.colorIndex > 4 && row.race === skinRow.race && row.sex === skinRow.sex && row.colorIndex === skinRow.colorIndex && row.flags === 8))
          .map(row => replacements.get(row.id) || row),
        ...additions,
      ]);
      setDirty(true);
      setTextureRefreshKey(value => value + 1);
      colorSetProvenanceStore.save({
        ...savedProvenance,
        race: skinRow.race, sex: skinRow.sex, sourceColorIndex, outputColorIndex: skinRow.colorIndex,
        sourceSkinPath: provenance.sourceSkinPath, outputSkinPath: skinRow.tex1,
      });
      setSaveMsg(`Completed Color ${skinRow.colorIndex}: ${sourceLinked.length} skin-bound rows, including the required empty Hair Color slots, are ready to save.`);
    } catch (error) {
      setSaveMsg(`Could not complete linked set: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    const r = await writeCharSections(allRecords, testMode);
    setSaving(false);
    if (r.success) {
      setSaveMsg(testMode ? 'Test DBC written to output\\DBFilesClient' : 'Saved to server DBC');
      setDirty(false);
      setTimeout(() => setSaveMsg(null), 2500);
    } else {
      setSaveMsg('Fout: ' + r.error);
    }
  };

  const writeBaselineTestBuild = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      // Always re-read the configured source DBC, never the staged test DBC.
      const source = await readCharSections();
      if (!source?.success) throw new Error(source?.error || 'Could not read the source CharSections DBC');
      const result = await writeCharSections(source.records, true);
      if (!result?.success) throw new Error(result?.error || 'Could not write the baseline test DBC');
      setSaveMsg('Unchanged source DBC written to output\\DBFilesClient for serializer testing.');
      setTestMode(true);
      setDirty(false);
    } catch (error) {
      setSaveMsg(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const exportPendingRowsCsv = async () => {
    if (!allRecords) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const source = await readCharSections();
      if (!source?.success) throw new Error(source?.error || 'Could not read the source CharSections DBC');
      const sourceIds = new Set(source.records.map(row => row.id));
      const pending = allRecords.filter(row => !sourceIds.has(row.id));
      const result = await window.azeroth.dbc.exportCharSectionsCsv(pending);
      if (!result?.success) throw new Error(result?.error || 'Could not write the CSV');
      setSaveMsg(`Exported ${result.count} proposed insert row${result.count === 1 ? '' : 's'} to output\\DBFilesClient\\CharSections.pending-insert.csv.`);
    } catch (error) {
      setSaveMsg(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
      <div className="cc-page">
      <div className="cc-header">
        <div>
          <h1 className="cc-title">Character Customization</h1>
          <p className="cc-subtitle">CharSections.dbc — skin tones, faces, hair &amp; facial hair per race/gender</p>
        </div>
        <div className="cc-header-actions">
          {!dbcPath && (
            <span className="cc-warn">DBC path niet ingesteld — ga naar Settings</span>
          )}
          {saveMsg && <span className={saveMsg.startsWith('Fout') ? 'cc-error-msg' : 'cc-ok-msg'}>{saveMsg}</span>}
          <label className="cc-test-toggle"><input type="checkbox" checked={testMode} onChange={e => toggleTestMode(e.target.checked)} /> Test output only</label>
          <button className="cc-btn cc-btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={14} />
            Herladen
          </button>
          <button className="cc-btn cc-btn-ghost" onClick={writeBaselineTestBuild} disabled={saving || !dbcPath} title="Writes an unchanged source DBC to output for a serializer-only test">
            Baseline test
          </button>
          <button className="cc-btn cc-btn-ghost" onClick={exportPendingRowsCsv} disabled={saving || !allRecords || !dbcPath} title="Exports only proposed new CharSections rows as CSV; does not write any DBC">
            Export pending CSV
          </button>
          <button className="cc-btn cc-btn-primary" onClick={handleSave} disabled={saving || !allRecords || !dirty}>
            <Save size={14} />
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </div>

      {testMode && <div className={`cc-test-output ${testOutput?.success ? 'ready' : ''}`}>
        {testOutput?.success
          ? <>Test build loaded: <strong>{testOutput.records.length}</strong> CharSections rows and <strong>{testOutput.blpFiles.length}</strong> staged BLPs from <code>output</code>.</>
          : <>Test build mode: no staged CharSections DBC yet. Showing the server DBC; <strong>{testOutput?.blpFiles?.length || 0}</strong> staged BLPs currently found in <code>output\PlayerTextures</code>.</>}
      </div>}

      {raceTextureCollision && <div className="cc-race-collision" role="alert">
        <strong>Race {raceTextureCollision.raceId} texture collision:</strong>{' '}
        {raceTextureCollision.families.map(entry => `${entry.family} (records ${entry.ids.join(', ')})`).join(' · ')}.
        {' '}These character families share one RaceID; verify the affected records before exporting.
      </div>}

      <div className="cc-toolbar">
        <div className="cc-toolbar-group">
          <label className="cc-label">Race</label>
          <select className="cc-select" value={race} onChange={e => setRace(Number(e.target.value))}>
            {RACES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div className="cc-toolbar-group">
          <label className="cc-label">Gender</label>
          <div className="cc-gender-toggle">
            <button
              className={`cc-gender-btn ${gender === 0 ? 'active' : ''}`}
              onClick={() => setGender(0)}
            >Male</button>
            <button
              className={`cc-gender-btn ${gender === 1 ? 'active' : ''}`}
              onClick={() => setGender(1)}
            >Female</button>
          </div>
        </div>
        {dirty && <span className="cc-dirty-badge">● Unsaved</span>}
        <div className="cc-view-toggle">
          <button
            className={`cc-gender-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
          >Advanced</button>
          <button
            className={`cc-gender-btn ${viewMode === 'sets' ? 'active' : ''}`}
            onClick={() => setViewMode('sets')}
          >Color sets</button>
          <button
            className={`cc-gender-btn ${viewMode === 'preview' ? 'active' : ''}`}
            onClick={() => setViewMode('preview')}
          >Preview</button>
        </div>
      </div>

      {viewMode === 'table' && <div className="cc-tabs">
        {SECTION_TABS.map(t => (
          <button
            key={t.id}
            className={`cc-tab ${section === t.id ? 'active' : ''}`}
            onClick={() => setSection(t.id)}
          >{t.label}</button>
        ))}
      </div>}

      <div className="cc-body">
        {loading && <div className="cc-status">Laden…</div>}
        {error   && <div className="cc-status cc-status-err">Fout: {error}</div>}
        {!loading && !error && allRecords && viewMode === 'preview' && (
          <CharCreationPreview
            allRecords={normalRecords}
            race={race}
            gender={gender}
            hasDataPath={!!worldmapMpqPath}
            preferOutput={testMode}
            textureRefreshKey={textureRefreshKey}
          />
        )}
        {!loading && !error && allRecords && viewMode === 'sets' && (
          <ColorSetWorkspace records={normalRecords} race={race} gender={gender} hasDataPath={!!worldmapMpqPath} preferOutput={testMode} onEditTexture={openTextureEditor} onCompleteLinkedSet={completeLinkedSet} onRemoveInvalidNpcRows={removeInvalidWorgenNpcRows} textureRefreshKey={textureRefreshKey} />
        )}
        {!loading && !error && allRecords && viewMode === 'table' && (
          <div className="cc-layout">
            <div className="cc-table-col">
              <div className="cc-table-wrap">
                <table className="cc-table">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Textures</th>
                      <th>ID</th>
                      <th>Variation</th>
                      <th>Color</th>
                      <th>Texture 1</th>
                      <th>Texture 2</th>
                      <th>Texture 3</th>
                      <th>Flags</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="cc-empty">
                          Geen records voor deze combinatie. Gebruik "Rij toevoegen" om te beginnen.
                        </td>
                      </tr>
                    )}
                    {visibleRows.map(row => (
                      <tr
                        key={row.id}
                        className={`cc-row ${selectedRow?.id === row.id ? 'cc-row-selected' : ''}`}
                        onClick={() => setSelectedId(row.id)}
                      >
                        <td>
                          <div className="cc-thumbs-row">
                            <TextureThumb blpPath={row.tex1} size={32} />
                            <TextureThumb blpPath={row.tex2} size={32} />
                            <TextureThumb blpPath={row.tex3} size={32} />
                          </div>
                        </td>
                        <td className="cc-cell-id">{row.id}</td>
                        <td>
                          <input
                            className="cc-input cc-input-sm"
                            type="text"
                            inputMode="numeric"
                            value={row.variationIndex}
                            onChange={e => updateField(row.id, 'variationIndex', Number(e.target.value) || 0)}
                          />
                        </td>
                        <td>
                          <input
                            className="cc-input cc-input-sm"
                            type="text"
                            inputMode="numeric"
                            value={row.colorIndex}
                            onChange={e => updateField(row.id, 'colorIndex', Number(e.target.value) || 0)}
                          />
                        </td>
                        <td>
                          <input
                            className="cc-input cc-input-tex"
                            value={row.tex1}
                            onChange={e => updateField(row.id, 'tex1', e.target.value)}
                            placeholder="pad/naar/texture.blp"
                          />
                        </td>
                        <td>
                          <input
                            className="cc-input cc-input-tex"
                            value={row.tex2}
                            onChange={e => updateField(row.id, 'tex2', e.target.value)}
                            placeholder=""
                          />
                        </td>
                        <td>
                          <input
                            className="cc-input cc-input-tex"
                            value={row.tex3}
                            onChange={e => updateField(row.id, 'tex3', e.target.value)}
                            placeholder=""
                          />
                        </td>
                        <td>
                          <select
                            className="cc-select cc-select-sm"
                            value={row.flags}
                            onChange={e => updateField(row.id, 'flags', Number(e.target.value))}
                          >
                            <option value={1}>1 — Player</option>
                            <option value={0}>0 — NPC only</option>
                          </select>
                        </td>
                        <td>
                          <button className="cc-delete-btn" onClick={e => { e.stopPropagation(); deleteRow(row.id); }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cc-footer">
                <button className="cc-btn cc-btn-ghost" onClick={addRow}>
                  <Plus size={14} />
                  Rij toevoegen
                </button>
                <span className="cc-count">{visibleRows.length} record{visibleRows.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <CharVisualPicker
              rows={visibleRows}
              selectedId={selectedRow?.id ?? null}
              setSelectedId={setSelectedId}
              race={race}
              gender={gender}
              hasDataPath={!!worldmapMpqPath}
              onEditTexture={openTextureEditor}
              textureRefreshKey={textureRefreshKey}
            />
          </div>
        )}
      </div>

      {editingTexRow && (
        <TextureMaskEditor
          dataPath={worldmapMpqPath}
          blpPath={editingTexRow[editingTextureField]}
          outputPath={editorOutputPath}
          sourceColorIndex={editingProvenance?.sourceColorIndex ?? null}
          sourceSkinPath={editingProvenance?.sourceSkinPath ?? null}
          outputSkinPath={editingProvenance?.outputSkinPath ?? null}
          sourceExtraPath={editingProvenance?.sourceExtraPath ?? null}
          sourceBlpPath={editorSaveMode === 'update' && editingTextureField === 'tex2' ? (editingProvenance?.sourceExtraPath ?? null) : null}
          writeSourceBlpPath={editingProvenance ? (editingTextureField === 'tex2' ? editingProvenance.sourceExtraPath : editingProvenance.sourceSkinPath) : null}
          recoverySourceBlpPath={editingTextureField === 'tex1' ? (editingProvenance?.sourceSkinPath ?? null) : null}
          saveMode={editorSaveMode}
          onSaveModeChange={setEditorSaveMode}
          texturePartType={editingTexRow.baseSection === 0 ? (editingTextureField === 'tex2' ? 'skin-extra' : 'skin-atlas') : null}
          preferOutput={testMode}
          textureParts={editingTexRow.baseSection === 0 ? [
            { label: 'Skin atlas', path: editingTexRow.tex1 },
            ...(editingTexRow.tex2 ? [{ label: 'Skin extra (independent overlay)', path: editingTexRow.tex2 }] : []),
          ] : []}
          onSelectTexturePart={path => setEditingTextureField(path === editingTexRow.tex2 ? 'tex2' : 'tex1')}
          initialTargetFlags={editingTexRow.flags}
          race={editingTexRow.race}
          gender={editingTexRow.sex}
          colorIndex={editingTexRow.colorIndex}
          characterRecords={normalRecords}
          onClose={() => { setEditingTexRow(null); setEditingTextureField('tex1'); setEditorSaveMode('create'); }}
          onSaved={handleTextureSaved}
        />
      )}
    </div>
    </>
  );
}
