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
// Blizzard character names carry the colour set as a numeric path segment.
// Keep that convention: FaceLower_14_00 and Skin00_14 become their 15 variants.
// Only the first matching segment is the colour slot; later numbers are usually
// a face/hair variation and must remain untouched.
const replaceColorIndexInPath = (texturePath, sourceColor, targetColor) => {
  const source = Number(sourceColor);
  let replaced = false;
  const path = String(texturePath || '').replace(/(^|[_-])(\d+)(?=[_\\/. -]|$)/g, (match, prefix, digits) => {
    if (replaced || Number(digits) !== source) return match;
    replaced = true;
    return `${prefix}${String(targetColor).padStart(digits.length, '0')}`;
  });
  // Worgen underclothing uses *_regular.blp rather than a numbered colour
  // suffix. Give its exported copy the same colour-index convention so this
  // particular colour set gets a unique, DBC-addressable BLP.
  return replaced ? path : path.replace(/_regular(?=\.blp$)/i, `_${String(targetColor).padStart(2, '0')}`);
};
const hasColorIndexReplacement = (texturePath, sourceColor, targetColor) => (
  replaceColorIndexInPath(texturePath, sourceColor, targetColor) !== String(texturePath || '')
);
const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));
const imageDataFromPng = png => new Promise((resolve,reject) => { const image=new Image(); image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);resolve(context.getImageData(0,0,image.width,image.height));};image.onerror=reject;image.src=`data:image/png;base64,${png}`; });
async function stageLinkedTexture(dataPath, texturePath, outputPath, targetColor, strength, protectDetails, transfer = null, copyOnly = false) {
  if (!texturePath) return null;
  const source = await window.azeroth.dbc.readBlpTexture(dataPath, texturePath);
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

function TextureThumb({ blpPath, size = 56 }) {
  const { dataUrl, loading, error } = useBlpTexture(blpPath);
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

function CharVisualPicker({ rows, selectedId, setSelectedId, race, gender, hasDataPath, onEditTexture }) {
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

function ColorSetWorkspace({ records, race, gender, hasDataPath, onEditTexture }) {
  const skins = useMemo(() => records.filter(r => r.race === race && r.sex === gender && r.baseSection === 0).sort((a, b) => a.colorIndex - b.colorIndex), [records, race, gender]);
  const [skinId, setSkinId] = useState(null);
  const [faceId, setFaceId] = useState(null);
  const skin = skins.find(r => r.id === skinId) || skins[0] || null;
  const setFlags = skin?.flags === 5 ? 5 : 17;
  const faces = useMemo(() => !skin ? [] : records.filter(r => r.race === race && r.sex === gender && r.baseSection === 1 && r.colorIndex === skin.colorIndex && r.flags === (setFlags === 5 ? 5 : 1)).sort((a, b) => a.variationIndex - b.variationIndex), [records, race, gender, skin, setFlags]);
  const underwear = useMemo(() => !skin ? [] : records.filter(r => r.race === race && r.sex === gender && r.baseSection === 4 && r.colorIndex === skin.colorIndex && r.flags === setFlags), [records, race, gender, skin, setFlags]);
  const face = faces.find(r => r.id === faceId) || faces[0] || null;
  const layers = face ? [{ path: face.tex1, region: 'face-lower' }, { path: face.tex2, region: 'face-upper' }] : [];
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
  useEffect(() => { setFaceId(null); }, [skin?.id]);

  return <div className="cc-set-workspace">
    <aside className="cc-set-skins">
      <strong>Skin / ColorIndex</strong>
      {skins.map(row => <button key={row.id} className={`cc-set-skin ${skin?.id === row.id ? 'active' : ''}`} onClick={() => setSkinId(row.id)}>
        <TextureThumb blpPath={row.tex1} size={42} /><span>Color {row.colorIndex}<small>{row.flags === 5 ? 'DK' : 'Player'}</small></span>
      </button>)}
    </aside>
    <section className="cc-set-preview">
      <CharM2Viewer race={race} gender={gender} skinBlp={skin?.tex1 || null} textureLayers={layers} active={hasDataPath} />
      {skin && <button className="cc-btn cc-btn-primary" onClick={() => onEditTexture(skin)}><Pencil size={14}/> Bewerk skin</button>}
    </section>
    <aside className="cc-set-parts">
      <strong>Linked components</strong>
      <p className="cc-set-hint">Edit only the Skin. Export creates a new linked CharSections colour set.</p>
      <div className="cc-set-part"><span>Skin atlas</span><button className="cc-btn cc-btn-ghost" onClick={() => onEditTexture(skin)} disabled={!skin}>Edit</button></div>
      {skin?.tex2 && <div className="cc-set-blp"><span>Skin extra</span><TextureThumb blpPath={skin.tex2} size={36} /></div>}
      <div className="cc-set-blp-group">
        <span>Underwear ({underwear.length})</span>
        {underwear.length ? underwear.map(row => <div key={row.id} className="cc-set-blp-pair"><TextureThumb blpPath={row.tex1} size={36} /><span>{row.tex2 ? <TextureThumb blpPath={row.tex2} size={36} /> : <em>No torso texture</em>}</span></div>) : <em>No linked record</em>}
        <small>Pelvis; female also has a separate torso overlay.</small>
      </div>
      <div className="cc-set-face-list"><span>Face-varianten ({faces.length})</span>{faces.map(row => <button key={row.id} className={`cc-set-face ${face?.id === row.id ? 'active' : ''}`} onClick={() => setFaceId(row.id)}>Face {row.variationIndex}</button>)}</div>
      {face && <button className="cc-btn cc-btn-ghost" onClick={() => onEditTexture(face)}><Pencil size={14}/> Edit selected face</button>}
      <div className="cc-set-blp-group"><span>All linked BLPs ({linkedComponents.length})</span>{linkedComponents.map(component => <div key={component.path} className="cc-set-blp-pair"><TextureThumb blpPath={component.path} size={32} /><small title={component.path}>{component.uses.map(use => `${use.section === 1 ? `Face ${String(use.variation).padStart(2, '0')}` : use.section === 4 ? 'Underwear' : 'Skin'} / ${use.field}`).join(' · ')}</small></div>)}</div>
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
  const [saveMsg, setSaveMsg]       = useState(null);
  const [dirty, setDirty]           = useState(false);
  const unsavedGuard = useUnsavedGuard(dirty);

  const [race,      setRace]     = useState(1);
  const [gender,    setGender]   = useState(0);
  const [section,   setSection]  = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [viewMode,  setViewMode] = useState('sets'); // 'sets' | 'table' | 'preview'
  const [editingTexRow, setEditingTexRow] = useState(null); // rij waarvan tex1 bewerkt wordt

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await readCharSections();
    setLoading(false);
    if (r.success) {
      setAllRecords(r.records);
      setDirty(false);
    } else {
      setError(r.error);
    }
  }, [readCharSections]);

  useEffect(() => { load(); }, [load]);

  // Flags 8 contains the custom NPC-skin set. Keep it in the DBC,
  // but hide it from the normal character-look workflow until that set gets its own editor.
  const normalRecords = allRecords ? allRecords.filter(r => r.flags !== 8) : [];
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
    const nextColor = allRecords
      .filter(row => row.race === editingTexRow.race && row.sex === editingTexRow.sex && row.baseSection === 0)
      .reduce((max, row) => Math.max(max, row.colorIndex), -1) + 1;
    return hasColorIndexReplacement(editingTexRow.tex1, editingTexRow.colorIndex, nextColor)
      ? replaceColorIndexInPath(editingTexRow.tex1, editingTexRow.colorIndex, nextColor)
      : null;
  }, [editingTexRow, allRecords]);

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
    setEditingTexRow(null);
    if (!sourceRow || !allRecords) return;
    const newRelPath = exportResult?.path;
    const targetSetFlags = exportResult?.targetSetFlags === 5 ? 5 : 17;
    if (!newRelPath) return;

    let nextId = allRecords.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    const groupRows = allRecords.filter(r =>
      r.race === sourceRow.race && r.sex === sourceRow.sex && r.baseSection === sourceRow.baseSection
    );

    if (sourceRow.baseSection === 0) {
      const nextColor = groupRows.reduce((m, r) => Math.max(m, r.colorIndex), -1) + 1;
      const linkedSections = new Set([0, 1, 4]);
      const sourceSetFlags = sourceRow.flags === 5 ? 5 : 17;
      const templates = allRecords.filter(r =>
        r.race === sourceRow.race && r.sex === sourceRow.sex &&
        r.colorIndex === sourceRow.colorIndex &&
        linkedSections.has(r.baseSection) &&
        r.flags === (r.baseSection === 1 ? (sourceSetFlags === 5 ? 5 : 1) : sourceSetFlags)
      );
      const sourceMask = exportResult.sourceMaskBase64 ? base64ToBytes(exportResult.sourceMaskBase64) : null;
      const mappings = { ...DEFAULT_COMPONENT_RECTANGLES, ...(exportResult.componentMappings || {}) };
      const transferFor = component => {
        const rect = mappings[component];
        if (exportResult.recoveryTransfer && rect) return { recovery: exportResult.recoveryTransfer, rect };
        const passes = (exportResult.componentPasses || []).map(pass => ({ ...pass, rect: pass.mappings?.[component] || mappings[component] })).filter(pass => pass.rect);
        return passes.length ? { passes, width: exportResult.sourceWidth, height: exportResult.sourceHeight } : null;
      };
      const facePaths = [...new Set(templates.filter(r => r.baseSection === 1).flatMap(r => [r.tex1, r.tex2]).filter(Boolean))];
      const underwearPaths = [...new Set(templates.filter(r => r.baseSection === 4).flatMap(r => [r.tex1, r.tex2, r.tex3]).filter(Boolean))];
      const skinExtraPaths = [...new Set(templates.filter(r => r.baseSection === 0).flatMap(r => [r.tex2, r.tex3]).filter(Boolean))];
      const allLinkedPaths = [sourceRow.tex1, ...skinExtraPaths, ...facePaths, ...underwearPaths];
      const unmappable = allLinkedPaths.filter(path => !hasColorIndexReplacement(path, sourceRow.colorIndex, nextColor));
      if (unmappable.length) {
        setSaveMsg(`Export stopped: ${unmappable.length} linked BLP path(s) do not contain ColorIndex ${sourceRow.colorIndex}.`);
        return;
      }
      const stagedSkinExtras = new Map();
      for (const extraPath of skinExtraPaths) {
        const outputPath = replaceColorIndexInPath(extraPath, sourceRow.colorIndex, nextColor);
        const staged = await stageLinkedTexture(worldmapMpqPath, extraPath, outputPath, exportResult.targetColor, exportResult.strength, false, null, true);
        if (staged) stagedSkinExtras.set(extraPath, staged);
      }
      const stagedFaces = new Map();
      for (const facePath of facePaths) {
        const component = componentMappingFromPath(facePath);
        const outputPath = replaceColorIndexInPath(facePath, sourceRow.colorIndex, nextColor);
        const staged = await stageLinkedTexture(worldmapMpqPath, facePath, outputPath, exportResult.targetColor, exportResult.strength, true, transferFor(component));
        if (staged) stagedFaces.set(facePath, staged);
      }
      const stagedUnderwear = new Map();
      for (const underwearPath of underwearPaths) {
        const component = componentMappingFromPath(underwearPath);
        const outputPath = replaceColorIndexInPath(underwearPath, sourceRow.colorIndex, nextColor);
        const staged = await stageLinkedTexture(worldmapMpqPath, underwearPath, outputPath, exportResult.targetColor, exportResult.strength, false, transferFor(component));
        if (staged) stagedUnderwear.set(underwearPath, staged);
      }
      const clones = templates.map(r => ({
        ...r,
        id: nextId++,
        colorIndex: nextColor,
        flags: r.baseSection === 1 ? (targetSetFlags === 5 ? 5 : 1) : targetSetFlags,
        tex1: r.id === sourceRow.id ? newRelPath : stagedSkinExtras.get(r.tex1) || stagedFaces.get(r.tex1) || stagedUnderwear.get(r.tex1) || r.tex1,
        tex2: stagedSkinExtras.get(r.tex2) || stagedFaces.get(r.tex2) || stagedUnderwear.get(r.tex2) || r.tex2,
        tex3: stagedSkinExtras.get(r.tex3) || stagedFaces.get(r.tex3) || stagedUnderwear.get(r.tex3) || r.tex3,
      }));
      const selected = clones.find(r => r.baseSection === 0 && r.variationIndex === sourceRow.variationIndex);
      setAllRecords(prev => [...prev, ...clones]);
      if (selected) setSelectedId(selected.id);
      if (facePaths.length && stagedFaces.size !== facePaths.length) setSaveMsg(`Skin geëxporteerd; ${facePaths.length - stagedFaces.size} face-texture(s) wachten nog op een opgeslagen beschermmasker.`);
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
          <label className="cc-test-toggle"><input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} /> Test output only</label>
          <button className="cc-btn cc-btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={14} />
            Herladen
          </button>
          <button className="cc-btn cc-btn-primary" onClick={handleSave} disabled={saving || !allRecords || !dirty}>
            <Save size={14} />
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </div>

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
          />
        )}
        {!loading && !error && allRecords && viewMode === 'sets' && (
          <ColorSetWorkspace records={normalRecords} race={race} gender={gender} hasDataPath={!!worldmapMpqPath} onEditTexture={setEditingTexRow} />
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
              onEditTexture={setEditingTexRow}
            />
          </div>
        )}
      </div>

      {editingTexRow && (
        <TextureMaskEditor
          dataPath={worldmapMpqPath}
          blpPath={editingTexRow.tex1}
          outputPath={editorOutputPath}
          initialTargetFlags={editingTexRow.flags}
          race={editingTexRow.race}
          gender={editingTexRow.sex}
          colorIndex={editingTexRow.colorIndex}
          characterRecords={normalRecords}
          onClose={() => setEditingTexRow(null)}
          onSaved={handleTextureSaved}
        />
      )}
    </div>
    </>
  );
}
