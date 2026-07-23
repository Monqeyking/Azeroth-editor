import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X, Brush, Eraser, Save, Loader2, RotateCcw, Shield, ShieldOff, Maximize2, Minimize2, ZoomIn, ZoomOut, LocateFixed, FolderOpen, Pipette } from 'lucide-react';
import './TextureMaskEditor.css';
import { AtlasTemplateRegistry } from '../../lib/characterTextures/AtlasTemplateRegistry.js';
import { TextureClassificationService } from '../../lib/characterTextures/TextureClassificationService.js';
import { SemanticMaskResolver } from '../../lib/characterTextures/SemanticMaskResolver.js';
import { TemplateCorrectionStore } from '../../lib/characterTextures/TemplateCorrectionStore.js';
import CharM2Viewer from './CharM2Viewer.jsx';
import { AtlasComponentMappingStore, DEFAULT_COMPONENT_RECTANGLES } from '../../lib/characterTextures/AtlasComponentMappingStore.js';

const textureClassifier = new TextureClassificationService(new AtlasTemplateRegistry());
const semanticMaskResolver = new SemanticMaskResolver();
const templateCorrectionStore = new TemplateCorrectionStore();
const componentMappingStore = new AtlasComponentMappingStore();
const SOURCE_RACES = [[1, 'Human'], [2, 'Orc'], [3, 'Dwarf'], [4, 'Night Elf'], [5, 'Undead'], [6, 'Tauren'], [7, 'Gnome'], [8, 'Troll'], [10, 'Blood Elf'], [11, 'Draenei'], [12, 'Worgen (Custom)']];
const templateWithPolygonOverrides = (template, overrides = {}, customPolygons = [], labelOverrides = {}) => !template ? template : ({ ...template, regions: [...template.regions.map(region => ({ ...region, ...(overrides[region.semantic] ? { polygon: overrides[region.semantic] } : {}), ...(labelOverrides[region.semantic] ? { label: labelOverrides[region.semantic] } : {}) })), ...customPolygons.map(region => ({ ...region, role: 'protected-detail' }))] });
const pngToImageData = png => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); resolve(context.getImageData(0, 0, image.width, image.height)); }; image.onerror = reject; image.src = `data:image/png;base64,${png}`; });
const pointSegmentDistance = (point, start, end) => { const dx=end[0]-start[0], dy=end[1]-start[1], length=dx*dx+dy*dy; const t=length ? Math.max(0, Math.min(1, ((point[0]-start[0])*dx+(point[1]-start[1])*dy)/length)) : 0; return Math.hypot(point[0]-(start[0]+t*dx), point[1]-(start[1]+t*dy)); };
const pointInPolygon = (point, polygon) => polygon.reduce((inside, vertex, index) => { const previous = polygon[(index + polygon.length - 1) % polygon.length]; return ((vertex[1] > point[1]) !== (previous[1] > point[1]) && point[0] < (previous[0] - vertex[0]) * (point[1] - vertex[1]) / (previous[1] - vertex[1]) + vertex[0]) ? !inside : inside; }, false);

// Visual styling is deliberately independent from the region's protection role.
// A guide can look like Eyes/Nose/Teeth without becoming a non-paintable area.
const drawSemanticPolygonOverlay = (ctx, region, width, height, selectedVertex) => {
  const cyan = '#1ebeff', edge = '#e6fbff';
  ctx.save();
  ctx.beginPath();
  region.polygon.forEach(([x, y], index) => index ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height));
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = .32;
  ctx.fillStyle = cyan;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = .48;
  ctx.strokeStyle = edge;
  ctx.lineWidth = .5;
  for (let offset = -height; offset < width; offset += 7) {
    ctx.beginPath(); ctx.moveTo(offset, 0); ctx.lineTo(offset + height, height); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = edge;
  ctx.fillStyle = selectedVertex?.semantic === region.semantic ? '#ffe788' : edge;
  ctx.shadowColor = cyan;
  ctx.shadowBlur = 5;
  // Keep the editable boundary precise even when the atlas is zoomed in.
  ctx.lineWidth = .45;
  ctx.beginPath();
  region.polygon.forEach(([x, y], index) => index ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height));
  ctx.closePath();
  ctx.stroke();
  region.polygon.forEach(([x, y], index) => {
    ctx.beginPath(); ctx.arc(x * width, y * height, selectedVertex?.semantic === region.semantic && selectedVertex.index === index ? 5 : 4, 0, Math.PI * 2); ctx.fill();
  });
};

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value || ''), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// RGB (0-255) → HSL (h: 0-360, s/l: 0-1)
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

// HSL → RGB (0-255)
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60)       [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function hexToHsl(hex) {
  const v = parseInt(hex.slice(1), 16);
  return rgbToHsl((v >> 16) & 255, (v >> 8) & 255, v & 255);
}

const rgbDistance = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const hslToHex = (h, s, l) => `#${hslToRgb(h, s, l).map(value => value.toString(16).padStart(2, '0')).join('')}`;
const hueDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

function buildSkinColourMap(source, edited, protectedMask = null) {
  const bins = new Map();
  for (let i = 0; i < source.width * source.height; i++) {
    const o = i * 4;
    if (source.data[o + 3] <= 12 || edited.data[o + 3] <= 12 || protectedMask?.[i]) continue;
    const key = `${source.data[o] >> 5}:${source.data[o + 1] >> 5}:${source.data[o + 2] >> 5}`;
    const row = bins.get(key) || { count: 0, source: [0, 0, 0], target: [0, 0, 0] };
    row.count++;
    for (let c = 0; c < 3; c++) { row.source[c] += source.data[o + c]; row.target[c] += edited.data[o + c]; }
    bins.set(key, row);
  }
  return [...bins.values()].filter(row => row.count >= 8).map(row => ({
    source: row.source.map(value => value / row.count), target: row.target.map(value => value / row.count), count: row.count,
  }));
}

function applySkinColourMap(image, colourMap, protectedMask = null) {
  const out = new Uint8ClampedArray(image.data);
  for (let i = 0; i < image.width * image.height; i++) {
    const o = i * 4;
    if (image.data[o + 3] <= 12 || protectedMask?.[i]) continue;
    let match = null, best = Infinity;
    for (const entry of colourMap) {
      const d = (image.data[o] - entry.source[0]) ** 2 + (image.data[o + 1] - entry.source[1]) ** 2 + (image.data[o + 2] - entry.source[2]) ** 2;
      if (d < best) { best = d; match = entry; }
    }
    if (!match) continue;
    for (let c = 0; c < 3; c++) {
      const ratio = match.target[c] / Math.max(14, match.source[c]);
      out[o + c] = Math.max(0, Math.min(255, Math.round(image.data[o + c] * Math.min(5, ratio))));
    }
  }
  return new ImageData(out, image.width, image.height);
}

function analyseBodyPalette(image, protectedMask) {
  const buckets = Array.from({ length: 24 }, () => []);
  for (let y = 0; y < image.height; y += 3) for (let x = 0; x < image.width; x += 3) {
    // The WotLK skin atlas keeps face variants in its lower-left quadrant.
    if (x < image.width * .5 && y > image.height * .625) continue;
    const i = y * image.width + x, o = i * 4;
    if (image.data[o + 3] <= 12 || protectedMask?.[i]) continue;
    const [h, s, l] = rgbToHsl(image.data[o], image.data[o + 1], image.data[o + 2]);
    if (s < .06 || l < .04 || l > .96) continue;
    buckets[Math.floor(h / 15)].push([h, s, l]);
  }
  const dominant = buckets.reduce((best, bucket) => bucket.length > best.length ? bucket : best, []);
  if (dominant.length < 24) return null;
  const referenceHue = dominant.reduce((sum, color) => sum + color[0], 0) / dominant.length;
  const fur = buckets.flat().filter(([h]) => hueDistance(h, referenceHue) < 25).sort((a, b) => a[2] - b[2]);
  if (fur.length < 24) return null;
  // Keep a deterministic set of actual source-fur samples. The target never
  // contributes RGB values: it only selects a lightness position in this LUT.
  return Array.from({ length: 24 }, (_, index) => fur[Math.min(fur.length - 1, Math.round((fur.length - 1) * index / 23))]);
}

function blendPalette(palette, amount) {
  const scaled = Math.max(0, Math.min(1, amount)) * (palette.length - 1), index = Math.min(palette.length - 2, Math.floor(scaled)), local = scaled - index;
  return palette[index].map((value, channel) => value + (palette[index + 1][channel] - value) * local);
}

function localLuminance(image, radius = 4) {
  const { width, height, data } = image, stride = width + 1;
  const values = new Float32Array(width * height);
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowTotal = 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, o = i * 4;
      const value = (data[o] * .2126 + data[o + 1] * .7152 + data[o + 2] * .0722) / 255;
      values[i] = value;
      rowTotal += value;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowTotal;
    }
  }
  const average = new Float32Array(values.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const left = Math.max(0, x - radius), top = Math.max(0, y - radius), right = Math.min(width - 1, x + radius), bottom = Math.min(height - 1, y + radius);
    const total = integral[(bottom + 1) * stride + right + 1] - integral[top * stride + right + 1] - integral[(bottom + 1) * stride + left] + integral[top * stride + left];
    average[y * width + x] = total / ((right - left + 1) * (bottom - top + 1));
  }
  return { values, average };
}

function remapImageWithPalette(image, palette, protectedMask = null, { paletteInfluence = 1, textureDetailStrength = 1, shadowDepth = 1 } = {}) {
  const levels = [];
  for (let i = 0; i < image.width * image.height; i++) {
    const o = i * 4;
    if (image.data[o + 3] > 12 && !protectedMask?.[i]) levels.push(rgbToHsl(image.data[o], image.data[o + 1], image.data[o + 2])[2]);
  }
  levels.sort((a, b) => a - b);
  const low = levels[Math.floor(Math.max(0, levels.length - 1) * .05)] ?? 0;
  const high = levels[Math.ceil(Math.max(0, levels.length - 1) * .95)] ?? 1;
  const range = Math.max(.01, high - low), out = new Uint8ClampedArray(image.data);
  const sourceLuminance = localLuminance(image);
  for (let i = 0; i < image.width * image.height; i++) {
    const o = i * 4;
    if (image.data[o + 3] <= 12 || protectedMask?.[i]) continue;
    const [originalHue, originalSaturation, lightness] = rgbToHsl(image.data[o], image.data[o + 1], image.data[o + 2]);
    // A continuous ramp is important for fur. Picking one of the 24 analysis
    // samples made every subtle source shade collapse into visible bands.
    const [paletteHue, paletteSaturation, paletteLightness] = blendPalette(palette, (lightness - low) / range);
    // The palette chooses the new overall colour ramp. Keep the difference
    // between this pixel and its local neighbourhood from the Worgen source:
    // those tiny variations are the painted fur strands and should not turn
    // into one flat colour on the model.
    const hueDelta = ((paletteHue - originalHue + 540) % 360) - 180;
    const hue = (originalHue + hueDelta * paletteInfluence + 360) % 360;
    const saturation = originalSaturation + (paletteSaturation - originalSaturation) * paletteInfluence;
    let textureDetail = (sourceLuminance.values[i] - sourceLuminance.average[i]) * textureDetailStrength;
    if (textureDetail < 0) textureDetail *= shadowDepth;
    const baseLightness = lightness + (paletteLightness - lightness) * paletteInfluence;
    const sourceLightness = Math.max(0, Math.min(1, baseLightness + textureDetail));
    const [r, g, b] = hslToRgb(hue, saturation, sourceLightness);
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
  }
  return new ImageData(out, image.width, image.height);
}

export default function TextureMaskEditor({ dataPath, blpPath, outputPath = null, texturePartType = null, textureParts = [], onSelectTexturePart, initialTargetFlags = 17, race, gender, characterRecords = [], colorIndex = 0, preferOutput = false, sourceColorIndex = null, sourceSkinPath = null, outputSkinPath = null, sourceExtraPath = null, sourceBlpPath = null, writeSourceBlpPath = null, recoverySourceBlpPath = null, saveMode = 'create', onSaveModeChange, onClose, onSaved }) {
  const canvasRef    = useRef(null); // toont het resultaat (basis + recolor binnen masker)
  const protectionOverlayRef = useRef(null);
  const baseRef       = useRef(null); // ImageData van de ongewijzigde texture
  const originalBaseRef = useRef(null);
  const paletteOriginalRef = useRef(null);
  const recoveryOriginalRef = useRef(null);
  const strengthRef   = useRef(null); // Float32Array(w*h), 0..1 brush-coverage per pixel
  const protectedRef  = useRef(null); // Uint8Array(w*h), 1 = nooit recoloren
  const dimsRef        = useRef({ w: 0, h: 0 });
  const drawingRef     = useRef(false);
  const panDragRef     = useRef(null);
  const canvasWrapRef = useRef(null);
  const templateBaseRef = useRef(null);
  const skinSourceRef = useRef(null);
  const sourcePaletteRef = useRef(null);
  const historyRef = useRef([]);
  const redoRef = useRef([]);

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [textureSize, setTextureSize] = useState(null);
  const [importedBlpPath, setImportedBlpPath] = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [templateSaveMsg, setTemplateSaveMsg] = useState(null);

  const [brushSize, setBrushSize]   = useState(24);
  const [brushSoft, setBrushSoft]   = useState(true);
  const [tool, setTool]             = useState('paint');
  const [targetColor, setTargetColor] = useState('#ff66cc');
  const [strength, setStrength]     = useState(1); // hoeveel van de doelkleur t.o.v. origineel (hue/sat mix)
  const [preservePaintShading, setPreservePaintShading] = useState(true);
  const [extraBrightnessMatch, setExtraBrightnessMatch] = useState(.38);
  const [maskRevision, setMaskRevision] = useState(0);
  const [skinTransferProfile, setSkinTransferProfile] = useState(null);
  const [sourceRace, setSourceRace] = useState(6);
  const [sourceGender, setSourceGender] = useState(gender);
  const [sourceSkinId, setSourceSkinId] = useState('');
  const [sourcePaletteInfo, setSourcePaletteInfo] = useState(null);
  const [paletteInfluence, setPaletteInfluence] = useState(1);
  const [textureDetailStrength, setTextureDetailStrength] = useState(1);
  const [shadowDepth, setShadowDepth] = useState(1);
  const [preserveExtraHair, setPreserveExtraHair] = useState(true);
  const [targetSetFlags, setTargetSetFlags] = useState(initialTargetFlags === 5 ? 5 : 17);
  const [semanticAnalysis, setSemanticAnalysis] = useState(null);
  const [semanticMasks, setSemanticMasks] = useState(null);
  const [semanticOptions, setSemanticOptions] = useState([]);
  const [semanticRegion, setSemanticRegion] = useState('');
  const [saveAsTemplateCorrection, setSaveAsTemplateCorrection] = useState(false);
  const [reusedCorrection, setReusedCorrection] = useState(false);
  const [respectProtection, setRespectProtection] = useState(true);
  const [showProtection, setShowProtection] = useState(true);
  const [showComponentMappings, setShowComponentMappings] = useState(true);
  const [componentMappings, setComponentMappings] = useState(DEFAULT_COMPONENT_RECTANGLES);
  const [mappingComponent, setMappingComponent] = useState('face-lower');
  const [mappingEdit, setMappingEdit] = useState(false);
  const [activeTab, setActiveTab] = useState('canvas');
  const [previewRgba, setPreviewRgba] = useState(null);
  const [previewExtraRgba, setPreviewExtraRgba] = useState(null);
  const [palettePreview, setPalettePreview] = useState(null);
  const [previewTransfer, setPreviewTransfer] = useState(null);
  const [paletteBaked, setPaletteBaked] = useState(false);
  const [committedPasses, setCommittedPasses] = useState([]);
  const [previewFaceId, setPreviewFaceId] = useState('');
  const [previewHairId, setPreviewHairId] = useState('');
  const [brushCursor, setBrushCursor] = useState(null);
  const [maximized, setMaximized] = useState(false);
  const [polygonOverrides, setPolygonOverrides] = useState({});
  const [polygonEdit, setPolygonEdit] = useState(false);
  const [polygonSemantic, setPolygonSemantic] = useState('');
  const [customPolygons, setCustomPolygons] = useState([]);
  const [labelOverrides, setLabelOverrides] = useState({});
  const [polygonVisibility, setPolygonVisibility] = useState({});
  const [selectedVertex, setSelectedVertex] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const polygonDragRef = useRef(null);
  const polygonDraftRef = useRef(null);
  const polygonCreatingRef = useRef(null);
  const mappingDragRef = useRef(null);

  const previewFaces = useMemo(() => characterRecords.filter(row => row.race === race && row.sex === gender && row.baseSection === 1 && row.colorIndex === colorIndex), [characterRecords, race, gender, colorIndex]);
  const previewSkin = useMemo(() => characterRecords.find(row => row.race === race && row.sex === gender && row.baseSection === 0 && row.colorIndex === colorIndex) || null, [characterRecords, race, gender, colorIndex]);
  const previewHairs = useMemo(() => characterRecords.filter(row => row.race === race && row.sex === gender && row.baseSection === 3 && row.tex1), [characterRecords, race, gender]);
  const previewFace = previewFaces.find(row => String(row.id) === previewFaceId) || previewFaces[0] || null;
  const previewHair = previewHairs.find(row => String(row.id) === previewHairId) || previewHairs[0] || null;
  const sourceSkins = useMemo(() => characterRecords.filter(row => row.race === sourceRace && row.sex === sourceGender && row.baseSection === 0 && row.tex1), [characterRecords, sourceRace, sourceGender]);
  const selectedSourceSkin = sourceSkins.find(row => String(row.id) === sourceSkinId) || sourceSkins[0] || null;

  useEffect(() => {
    if (!previewHairId && previewHairs[0]) setPreviewHairId(String(previewHairs[0].id));
  }, [previewHairId, previewHairs]);
  useEffect(() => { if (selectedSourceSkin && String(selectedSourceSkin.id) !== sourceSkinId) setSourceSkinId(String(selectedSourceSkin.id)); }, [selectedSourceSkin, sourceSkinId]);

  useEffect(() => {
    const original = paletteOriginalRef.current, palette = sourcePaletteRef.current?.palette;
    if (!paletteBaked || !original || !palette || !strengthRef.current) return;
    const protectedMask = protectedRef.current;
    const transferProtection = new Uint8Array(protectedMask || original.width * original.height);
    if (texturePartType === 'skin-extra' && preserveExtraHair) for (let i = 0; i < transferProtection.length; i++) {
      const o = i * 4;
      const [, saturation, lightness] = rgbToHsl(original.data[o], original.data[o + 1], original.data[o + 2]);
      if (original.data[o + 3] > 12 && lightness < .16 && saturation < .45) transferProtection[i] = 1;
    }
    baseRef.current = remapImageWithPalette(original, palette, respectProtection ? transferProtection : null, { paletteInfluence, textureDetailStrength, shadowDepth });
    if (texturePartType === 'skin-atlas') setPalettePreview(current => current ? { ...current, transferSettings: { paletteInfluence, textureDetailStrength, shadowDepth } } : current);
    setMaskRevision(value => value + 1);
  }, [paletteInfluence, textureDetailStrength, shadowDepth, paletteBaked, texturePartType, preserveExtraHair, respectProtection]);

  const capturePreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const protectedMask = protectedRef.current, base = baseRef.current;
      if (protectedMask && base) for (let i = 0; i < protectedMask.length; i++) if (protectedMask[i]) {
        const offset = i * 4;
        image.data[offset] = base.data[offset]; image.data[offset + 1] = base.data[offset + 1]; image.data[offset + 2] = base.data[offset + 2]; image.data[offset + 3] = base.data[offset + 3];
      }
      setPreviewRgba({ data: image.data, width: canvas.width, height: canvas.height });
      const activeMask = Uint8Array.from(strengthRef.current || [], value => Math.round(value * 255));
      setPreviewTransfer(paletteBaked ? null : { passes: [...committedPasses, { mask: activeMask, targetColor, strength, preserveShading: preservePaintShading, mappings: componentMappings }], width: canvas.width, height: canvas.height });
    }
  }, [targetColor, strength, preservePaintShading, componentMappings, committedPasses, paletteBaked]);
  const openPreview = () => { capturePreview(); setActiveTab('preview'); };
  useEffect(() => {
    if (activeTab !== 'preview') return;
    const timer = setInterval(capturePreview, 5000);
    return () => clearInterval(timer);
  }, [activeTab, capturePreview]);

  useEffect(() => {
    const layoutId = semanticAnalysis?.template?.id;
    if (!layoutId) return;
    setComponentMappings({ ...DEFAULT_COMPONENT_RECTANGLES, ...componentMappingStore.list(layoutId) });
  }, [semanticAnalysis?.template?.id]);

  // ── Texture laden ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSemanticAnalysis(null);
    setSemanticMasks(null);
    setPreviewExtraRgba(null);
    setPalettePreview(null);
    setCommittedPasses([]);
    setPaletteBaked(false);
    setPalettePreview(null);
    historyRef.current = []; redoRef.current = [];
    const loadPath = importedBlpPath || blpPath;
    // In Test output mode an already exported colour set is the editable
    // source. This makes a second editor session continue from the saved Skin
    // instead of silently reopening the untouched client BLP.
    const readTexture = importedBlpPath
      ? window.azeroth.dbc.readBlpFile(importedBlpPath)
      : preferOutput && window.azeroth.dbc.readOutputBlpTexture
        ? window.azeroth.dbc.readOutputBlpTexture(blpPath).then(result => result?.success ? result : window.azeroth.dbc.readBlpTexture(dataPath, sourceBlpPath || blpPath))
        : window.azeroth.dbc.readBlpTexture(dataPath, sourceBlpPath || blpPath);
    readTexture.then(res => {
      if (cancelled) return;
      if (!res?.success) { setError(res?.error || 'Texture kon niet geladen worden'); setLoading(false); return; }
      const img = new Image();
      img.onload = async () => {
        if (cancelled) return;
        const cvs = canvasRef.current;
        if (!cvs) return;
        cvs.width = img.width; cvs.height = img.height;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, 0, 0);
        baseRef.current = ctx.getImageData(0, 0, img.width, img.height);
        originalBaseRef.current = new ImageData(new Uint8ClampedArray(baseRef.current.data), img.width, img.height);
        recoveryOriginalRef.current = null;
        if (importedBlpPath || preferOutput) {
          const original = await window.azeroth.dbc.readBlpTexture(dataPath, recoverySourceBlpPath || sourceBlpPath || blpPath);
          if (cancelled) return;
          if (original?.success && original.png) {
            try {
              const originalImage = await pngToImageData(original.png);
              if (originalImage.width === img.width && originalImage.height === img.height) recoveryOriginalRef.current = originalImage;
            } catch { /* recovery remains available as a normal imported texture */ }
          }
        }
        strengthRef.current = new Float32Array(img.width * img.height);
        dimsRef.current = { w: img.width, h: img.height };
        setTextureSize({ width: img.width, height: img.height });
        const analysis = textureClassifier.classify({ path: loadPath, width: img.width, height: img.height, rgba: new Uint8Array(baseRef.current.data), textureType: texturePartType });
        const saved = analysis.template ? templateCorrectionStore.list(analysis.template.id, analysis.template.version).find(c => c.width === img.width && c.height === img.height && c.protectedMask) : null;
        const savedPolygons = saved?.polygonOverrides || {}, savedCustomPolygons = saved?.customPolygons || [], savedLabels = saved?.labelOverrides || {};
        templateBaseRef.current = analysis.template;
        analysis.template = templateWithPolygonOverrides(analysis.template, savedPolygons, savedCustomPolygons, savedLabels);
        const resolved = analysis.template ? semanticMaskResolver.resolve({ template: analysis.template, rgba: new Uint8Array(baseRef.current.data), width: img.width, height: img.height }) : null;
        protectedRef.current = resolved?.protectedMask || new Uint8Array(img.width * img.height);
        if (saved) {
          const correctionMask = base64ToBytes(saved.protectedMask);
          if (correctionMask.length === protectedRef.current.length) for (let i = 0; i < correctionMask.length; i++) protectedRef.current[i] ||= correctionMask[i];
        }
        setReusedCorrection(!!saved);
        setSemanticAnalysis(analysis);
        setSemanticMasks(resolved?.masks || null);
        setPolygonOverrides(savedPolygons);
        setCustomPolygons(savedCustomPolygons);
        setLabelOverrides(savedLabels);
        setPolygonSemantic(analysis.template?.regions?.find(region => region.role === 'protected-detail' && region.polygon)?.semantic || '');
        const options = [...new Map((analysis.template?.regions || []).filter(region => region.editorVisible).map(region => [region.semantic, region.label || region.semantic])).entries()];
        setSemanticOptions(options);
        setSemanticRegion(options[0]?.[0] || '');
        setLoading(false);
      };
      img.onerror = () => { setError('PNG decode mislukt'); setLoading(false); };
      img.src = `data:image/png;base64,${res.png}`;
    }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [dataPath, blpPath, sourceBlpPath, importedBlpPath, texturePartType]);

  const openExportedBlp = async () => {
    const filePath = await window.azeroth.dialog.openFile({ title: 'Open exported BLP', filters: [{ name: 'BLP textures', extensions: ['blp'] }] });
    if (filePath) setImportedBlpPath(filePath);
  };

  // ── Herteken canvas op basis van base + strengthRef + targetColor ───────
  const repaint = useCallback((templateOverride) => {
    const base = baseRef.current;
    const strengthArr = strengthRef.current;
    const protectedArr = protectedRef.current;
    if (!base || !strengthArr || !canvasRef.current) return;
    const { w, h } = dimsRef.current;
    const [th, ts, tl] = hexToHsl(targetColor);
    const out = new Uint8ClampedArray(base.data); // kopie
    const paletteOriginal = paletteBaked && paletteOriginalRef.current?.width === w && paletteOriginalRef.current?.height === h ? paletteOriginalRef.current : null;
    if (paletteOriginal) for (let i = 0; i < w * h; i++) if (!strengthArr[i]) {
      const off = i * 4;
      out[off] = paletteOriginal.data[off]; out[off + 1] = paletteOriginal.data[off + 1]; out[off + 2] = paletteOriginal.data[off + 2]; out[off + 3] = paletteOriginal.data[off + 3];
    }

    for (let i = 0; i < w * h; i++) {
      const amt = respectProtection && protectedArr?.[i] ? 0 : strengthArr[i] * strength;
      if (amt <= 0) continue;
      const off = i * 4;
      const [, , l] = rgbToHsl(out[off], out[off+1], out[off+2]);
      if (tl <= .02) {
        // Black is a colour, never an alpha operation. Preserve the source
        // pixel's luminance as a very dark greyscale ramp: a muzzle then keeps
        // its fur strands and highlights instead of becoming one flat block.
        const blackLightness = preservePaintShading
          ? Math.max(.012, Math.min(.32, .018 + Math.pow(l, .85) * .38))
          : 8 / 255;
        const [nr, ng, nb] = hslToRgb(th, 0, blackLightness);
        out[off]   += (nr - out[off]) * amt;
        out[off+1] += (ng - out[off+1]) * amt;
        out[off+2] += (nb - out[off+2]) * amt;
      } else {
        const outputLightness = preservePaintShading
          ? (texturePartType === 'skin-extra' ? l + (tl - l) * extraBrightnessMatch * amt : l)
          : tl;
        const [nr, ng, nb] = hslToRgb(th, ts, outputLightness);
        out[off]   = out[off]   + (nr - out[off])   * amt;
        out[off+1] = out[off+1] + (ng - out[off+1]) * amt;
        out[off+2] = out[off+2] + (nb - out[off+2]) * amt;
      }
    }

    const ctx = canvasRef.current.getContext('2d');
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
    if (activeTab === 'preview') {
      setPreviewRgba({ data: new Uint8ClampedArray(out), width: w, height: h });
      const activeMask = Uint8Array.from(strengthArr, value => Math.round(value * 255));
      setPreviewTransfer(paletteBaked ? null : { passes: [...committedPasses, { mask: activeMask, targetColor, strength, preserveShading: preservePaintShading, mappings: componentMappings }], width: w, height: h });
    }
    const overlay = protectionOverlayRef.current;
    if (overlay) {
      overlay.width = w; overlay.height = h;
      const overlayCtx = overlay.getContext('2d');
      overlayCtx.clearRect(0, 0, w, h);
      if (showProtection && protectedArr) {
        const pixels = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!protectedArr[i]) continue;
          const off = i * 4, stripe = (x + y) % 8 < 4;
          pixels[off] = 30; pixels[off + 1] = 190; pixels[off + 2] = 255; pixels[off + 3] = stripe ? 185 : 105;
        }
        overlayCtx.putImageData(new ImageData(pixels, w, h), 0, 0);
      }
      if (showProtection) {
        const candidates = (templateOverride || semanticAnalysis?.template)?.regions?.filter(region => region.polygon && polygonVisibility[region.semantic] !== false) || [];
        for (const candidate of candidates) drawSemanticPolygonOverlay(overlayCtx, candidate, w, h, selectedVertex);
        overlayCtx.shadowBlur = 0;
      }
      if (showComponentMappings && semanticAnalysis?.template?.match?.textureType === 'skin-atlas') {
        overlayCtx.save(); overlayCtx.setLineDash([3, 2]); overlayCtx.lineWidth = .75; overlayCtx.font = '9px sans-serif';
        for (const [name, rect] of Object.entries(componentMappings)) {
          overlayCtx.strokeStyle = '#ffcb5b'; overlayCtx.strokeRect(rect.x * w, rect.y * h, rect.width * w, rect.height * h);
          overlayCtx.fillStyle = '#ffdf8a'; overlayCtx.fillText(name, rect.x * w + 3, rect.y * h + 11);
        }
        overlayCtx.restore();
      }
    }
  }, [targetColor, strength, preservePaintShading, extraBrightnessMatch, texturePartType, respectProtection, showProtection, showComponentMappings, componentMappings, semanticAnalysis, polygonVisibility, selectedVertex, paletteBaked, activeTab, committedPasses]);

  useEffect(() => { if (!loading && !error) repaint(); }, [loading, error, repaint, maskRevision]);

  const pushHistory = useCallback(() => {
    if (!strengthRef.current || !protectedRef.current) return;
    historyRef.current.push({ strength: Float32Array.from(strengthRef.current), protected: Uint8Array.from(protectedRef.current), polygonOverrides: JSON.parse(JSON.stringify(polygonOverrides)), customPolygons: JSON.parse(JSON.stringify(customPolygons)) });
    if (historyRef.current.length > 30) historyRef.current.shift();
    redoRef.current = [];
  }, [polygonOverrides, customPolygons]);

  const undoLast = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current.push({ strength: Float32Array.from(strengthRef.current), protected: Uint8Array.from(protectedRef.current), polygonOverrides: JSON.parse(JSON.stringify(polygonOverrides)), customPolygons: JSON.parse(JSON.stringify(customPolygons)) });
    strengthRef.current = previous.strength; protectedRef.current = previous.protected;
    setPolygonOverrides(previous.polygonOverrides); setCustomPolygons(previous.customPolygons);
    const template = templateWithPolygonOverrides(templateBaseRef.current || semanticAnalysis?.template, previous.polygonOverrides, previous.customPolygons, labelOverrides);
    setSemanticAnalysis(current => current ? { ...current, template } : current);
    repaint();
  }, [semanticAnalysis, repaint, labelOverrides]);

  // ── Brush paint ───────────────────────────────────────────────────────
  const paintAt = useCallback((cx, cy) => {
    const { w, h } = dimsRef.current;
    const strengthArr = strengthRef.current;
    const protectedArr = protectedRef.current;
    if (!strengthArr) return;
    // Auto-fill / learned colour maps use a full-mask baked baseline. The
    // first manual stroke must turn that result into a normal editable base,
    // otherwise every pixel already has strength 1 and a touch-up appears to
    // do nothing.
    if (paletteBaked && tool === 'paint' && canvasRef.current) {
      baseRef.current = canvasRef.current.getContext('2d').getImageData(0, 0, w, h);
      strengthArr.fill(0);
      paletteOriginalRef.current = null;
      setPaletteBaked(false);
    }
    const r = brushSize;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        const falloff = brushSoft ? Math.max(0, 1 - d / r) : 1;
        const idx = y * w + x;
        // Keep direct painting in sync with the layer visibility toggles. The
        // cached pixel mask already honours them, but this polygon hit-test is
        // also needed before that cache has been rebuilt.
        const protectedByLayer = semanticAnalysis?.template?.regions?.some(region => (
          region.role === 'protected-detail'
          && region.polygon
          && polygonVisibility[region.semantic] !== false
          && pointInPolygon([x / w, y / h], region.polygon)
        ));
        if ((tool === 'paint' || tool === 'erase') && respectProtection && (protectedArr?.[idx] || protectedByLayer)) continue;
        if (tool === 'paint') {
          strengthArr[idx] = Math.min(1, strengthArr[idx] + falloff * 0.35);
        } else if (tool === 'erase') {
          strengthArr[idx] = Math.max(0, strengthArr[idx] - falloff * 0.5);
        } else if (tool === 'protect') {
          protectedArr[idx] = 1;
          strengthArr[idx] = 0;
        } else if (tool === 'unprotect') {
          protectedArr[idx] = 0;
        }
      }
    }
    repaint();
  }, [brushSize, brushSoft, tool, respectProtection, semanticAnalysis, polygonVisibility, repaint, paletteBaked]);

  const canvasToImageCoords = (e) => {
    const cvs = canvasRef.current;
    const rect = cvs.getBoundingClientRect();
    const scaleX = cvs.width / rect.width;
    const scaleY = cvs.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  };

  const updateBrushCursor = (e) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) { setBrushCursor(null); return; }
    setBrushCursor({ left: x / rect.width * 100, top: y / rect.height * 100, width: brushSize * 2 / cvs.width * 100, height: brushSize * 2 / cvs.height * 100 });
  };

  const rebuildPolygonProtection = useCallback((overrides, custom, labels = labelOverrides) => {
    if (!semanticAnalysis?.template || !baseRef.current) return;
    const template = templateWithPolygonOverrides(templateBaseRef.current || semanticAnalysis.template, overrides, custom, labels);
    const { w, h } = dimsRef.current;
    const resolvedTemplate = { ...template, regions: template.regions.filter(region => !region.role?.startsWith('protected') || polygonVisibility[region.semantic] !== false) };
    const resolved = semanticMaskResolver.resolve({ template: resolvedTemplate, rgba: new Uint8Array(baseRef.current.data), width: w, height: h });
    protectedRef.current = resolved.protectedMask;
    setSemanticAnalysis(prev => ({ ...prev, template }));
    setSemanticMasks(resolved.masks);
    repaint();
  }, [semanticAnalysis, repaint, labelOverrides, polygonVisibility]);

  useEffect(() => {
    if (semanticAnalysis?.template && baseRef.current) rebuildPolygonProtection(polygonOverrides, customPolygons);
  }, [polygonVisibility]);

  const applyPolygon = useCallback((semantic, polygon) => {
    const customIndex = customPolygons.findIndex(item => item.semantic === semantic);
    const nextOverrides = customIndex >= 0 ? polygonOverrides : { ...polygonOverrides, [semantic]: polygon };
    const nextCustom = customIndex >= 0 ? customPolygons.map((item, index) => index === customIndex ? { ...item, polygon } : item) : customPolygons;
    setPolygonOverrides(nextOverrides); setCustomPolygons(nextCustom); rebuildPolygonProtection(nextOverrides, nextCustom);
  }, [polygonOverrides, customPolygons, rebuildPolygonProtection]);

  // During a drag we only redraw the lightweight canvas overlay. Resolving pixel masks
  // and React state updates happen once when the pointer is released.
  const previewPolygon = useCallback((semantic, polygon) => {
    const draft = polygonDraftRef.current;
    if (!draft) return;
    const customIndex = draft.custom.findIndex(item => item.semantic === semantic);
    if (customIndex >= 0) draft.custom = draft.custom.map((item, index) => index === customIndex ? { ...item, polygon } : item);
    else draft.overrides = { ...draft.overrides, [semantic]: polygon };
    const template = templateWithPolygonOverrides(templateBaseRef.current || semanticAnalysis?.template, draft.overrides, draft.custom, labelOverrides);
    repaint(template);
  }, [semanticAnalysis, repaint]);

  const finishPolygonDrag = useCallback(() => {
    const draft = polygonDraftRef.current;
    polygonDragRef.current = null;
    polygonDraftRef.current = null;
    if (!draft) return;
    setPolygonOverrides(draft.overrides);
    setCustomPolygons(draft.custom);
    rebuildPolygonProtection(draft.overrides, draft.custom);
  }, [rebuildPolygonProtection]);

  const addCustomPolygon = () => {
    const semantic = `custom-${Date.now()}`;
    const nextCustom = [...customPolygons, { semantic, label: `New region ${customPolygons.length + 1}`, polygon: [] }];
    polygonCreatingRef.current = semantic;
    setCustomPolygons(nextCustom); setPolygonSemantic(semantic); setPolygonEdit(true);
    setSemanticAnalysis(current => current ? { ...current, template: templateWithPolygonOverrides(templateBaseRef.current || current.template, polygonOverrides, nextCustom, labelOverrides) } : current);
    setTemplateSaveMsg('Click three points on the texture to place the new polygon.');
  };

  const removeCustomPolygon = () => {
    const nextCustom = customPolygons.filter(item => item.semantic !== polygonSemantic);
    if (nextCustom.length === customPolygons.length) return;
    setCustomPolygons(nextCustom); setPolygonSemantic(semanticAnalysis?.template?.regions?.find(region => region.role === 'protected-detail' && region.polygon && region.semantic !== polygonSemantic)?.semantic || ''); rebuildPolygonProtection(polygonOverrides, nextCustom);
  };

  const redoLast = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push({ strength: Float32Array.from(strengthRef.current), protected: Uint8Array.from(protectedRef.current), polygonOverrides: JSON.parse(JSON.stringify(polygonOverrides)), customPolygons: JSON.parse(JSON.stringify(customPolygons)) });
    strengthRef.current = next.strength; protectedRef.current = next.protected;
    setPolygonOverrides(next.polygonOverrides); setCustomPolygons(next.customPolygons);
    const template = templateWithPolygonOverrides(templateBaseRef.current || semanticAnalysis?.template, next.polygonOverrides, next.customPolygons, labelOverrides);
    setSemanticAnalysis(current => current ? { ...current, template } : current); repaint();
  }, [semanticAnalysis, polygonOverrides, customPolygons, repaint]);

  const deleteSelectedVertex = useCallback(() => {
    if (!selectedVertex) return;
    const region = semanticAnalysis?.template?.regions?.find(item => item.semantic === selectedVertex.semantic);
    if (!region?.polygon || region.polygon.length <= 3) return;
    pushHistory(); const next = region.polygon.filter((_, index) => index !== selectedVertex.index);
    setSelectedVertex(null); applyPolygon(selectedVertex.semantic, next);
  }, [selectedVertex, semanticAnalysis, pushHistory, applyPolygon]);

  const updateCustomPolygon = (field, value) => {
    const next = customPolygons.map(item => item.semantic === polygonSemantic ? { ...item, [field]: value } : item);
    setCustomPolygons(next); rebuildPolygonProtection(polygonOverrides, next);
  };

  const updatePolygonLabel = value => {
    const customIndex = customPolygons.findIndex(item => item.semantic === polygonSemantic);
    if (customIndex >= 0) { updateCustomPolygon('label', value); return; }
    const nextLabels = { ...labelOverrides, [polygonSemantic]: value };
    setLabelOverrides(nextLabels);
    rebuildPolygonProtection(polygonOverrides, customPolygons, nextLabels);
  };

  const copyTemplateJson = async () => {
    const data = JSON.stringify({ version: 1, templateId: semanticAnalysis?.template?.id, polygonOverrides, customPolygons, labelOverrides }, null, 2);
    try { await navigator.clipboard.writeText(data); setTemplateSaveMsg('Template JSON copied to clipboard.'); } catch { setTemplateSaveMsg('Clipboard access is unavailable.'); }
  };

  const pasteTemplateJson = () => {
    const value = window.prompt('Paste a previously copied template JSON:');
    if (!value) return;
    try {
      const data = JSON.parse(value);
      if (!data || typeof data !== 'object' || !data.polygonOverrides || !Array.isArray(data.customPolygons)) throw new Error();
      const nextLabels = data.labelOverrides || {};
      setPolygonOverrides(data.polygonOverrides); setCustomPolygons(data.customPolygons); setLabelOverrides(nextLabels); rebuildPolygonProtection(data.polygonOverrides, data.customPolygons, nextLabels); setTemplateSaveMsg('Template JSON loaded. Save protection to keep it.');
    } catch { setTemplateSaveMsg('Invalid template JSON.'); }
  };

  useEffect(() => {
    const onKeyDown = event => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redoLast() : undoLast(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redoLast(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelectedVertex(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoLast, redoLast, deleteSelectedVertex]);

  const polygonPointerDown = (e) => {
    const [cx, cy] = canvasToImageCoords(e), { w, h } = dimsRef.current;
    const region = semanticAnalysis?.template?.regions?.find(item => item.semantic === polygonSemantic && item.polygon);
    if (!region) return;
    const point = [cx / w, cy / h];
    if (polygonCreatingRef.current === polygonSemantic) {
      const nextCustom = customPolygons.map(item => item.semantic === polygonSemantic ? { ...item, polygon: [...item.polygon, point] } : item);
      const created = nextCustom.find(item => item.semantic === polygonSemantic);
      setCustomPolygons(nextCustom);
      if (created.polygon.length >= 3) {
        polygonCreatingRef.current = null;
        rebuildPolygonProtection(polygonOverrides, nextCustom);
        setTemplateSaveMsg('Polygon created. Drag vertices or edges to refine it.');
      } else {
        setSemanticAnalysis(current => current ? { ...current, template: templateWithPolygonOverrides(templateBaseRef.current || current.template, polygonOverrides, nextCustom, labelOverrides) } : current);
      }
      return;
    }
    const index = region.polygon.findIndex(([x, y]) => Math.hypot(x - point[0], y - point[1]) < .018);
    const next = [...region.polygon];
    const beginDrag = () => { polygonDraftRef.current = { overrides: { ...polygonOverrides }, custom: customPolygons.map(item => ({ ...item, polygon: [...item.polygon] })) }; };
    if (index >= 0) { pushHistory(); beginDrag(); setSelectedVertex({ semantic: polygonSemantic, index }); polygonDragRef.current = { semantic: polygonSemantic, index, polygon: region.polygon }; return; }
    const segment = next.findIndex((vertex, i) => pointSegmentDistance(point, vertex, next[(i + 1) % next.length]) < .012);
    if (segment >= 0) { pushHistory(); beginDrag(); next.splice(segment + 1, 0, point); polygonDragRef.current = { semantic: polygonSemantic, index: segment + 1, polygon: next }; previewPolygon(polygonSemantic, next); return; }
    if (pointInPolygon(point, region.polygon)) { pushHistory(); beginDrag(); polygonDragRef.current = { semantic: polygonSemantic, origin: point, polygon: region.polygon, startPolygon: region.polygon }; }
  };

  const mappingPointerDown = e => {
    if (!mappingEdit) return false;
    const rect = componentMappings[mappingComponent];
    const [cx, cy] = canvasToImageCoords(e), { w, h } = dimsRef.current;
    const point = [cx / w, cy / h];
    if (!rect || point[0] < rect.x || point[0] > rect.x + rect.width || point[1] < rect.y || point[1] > rect.y + rect.height) return false;
    mappingDragRef.current = { offsetX: point[0] - rect.x, offsetY: point[1] - rect.y };
    return true;
  };

  const onPointerDown = (e) => { if (e.button === 1 || e.button === 2 || e.shiftKey) { e.preventDefault(); panDragRef.current = { x: e.clientX, y: e.clientY, pan }; return; } if (mappingPointerDown(e)) return; if (polygonEdit) { polygonPointerDown(e); return; } if (tool === 'eyedropper') { pickColourAt(...canvasToImageCoords(e)); return; } pushHistory(); updateBrushCursor(e); drawingRef.current = true; paintAt(...canvasToImageCoords(e)); };
  const onPointerMove = (e) => { if (panDragRef.current) { const start = panDragRef.current; setPan({ x: start.pan.x + e.clientX - start.x, y: start.pan.y + e.clientY - start.y }); return; } if (mappingDragRef.current) { const [cx, cy] = canvasToImageCoords(e), { w, h } = dimsRef.current, drag = mappingDragRef.current; setComponentMappings(current => { const rect = current[mappingComponent]; return { ...current, [mappingComponent]: { ...rect, x: Math.max(0, Math.min(1 - rect.width, cx / w - drag.offsetX)), y: Math.max(0, Math.min(1 - rect.height, cy / h - drag.offsetY)) } }; }); return; } if (polygonEdit && polygonDragRef.current) { const [cx, cy] = canvasToImageCoords(e), { w, h } = dimsRef.current, drag = polygonDragRef.current; if (drag.polygon) { const point = [Math.max(0, Math.min(1, cx / w)), Math.max(0, Math.min(1, cy / h))]; const next = drag.index == null ? drag.startPolygon.map(([x, y]) => [Math.max(0, Math.min(1, x + point[0] - drag.origin[0])), Math.max(0, Math.min(1, y + point[1] - drag.origin[1]))]) : [...drag.polygon]; if (drag.index != null) next[drag.index] = point; drag.polygon = next; previewPolygon(drag.semantic, next); } return; } if (tool !== 'eyedropper') updateBrushCursor(e); if (drawingRef.current) paintAt(...canvasToImageCoords(e)); };
  const onPointerUp   = () => { drawingRef.current = false; mappingDragRef.current = null; finishPolygonDrag(); panDragRef.current = null; };
  const onPointerLeave = () => { drawingRef.current = false; mappingDragRef.current = null; finishPolygonDrag(); panDragRef.current = null; setBrushCursor(null); };
  useEffect(() => {
    const canvasWrap = canvasWrapRef.current;
    if (!canvasWrap) return undefined;
    const onWheel = event => { event.preventDefault(); setZoom(value => Math.max(.5, Math.min(8, Number((value + (event.deltaY < 0 ? .15 : -.15)).toFixed(2))))); };
    canvasWrap.addEventListener('wheel', onWheel, { passive: false });
    return () => canvasWrap.removeEventListener('wheel', onWheel);
  }, []);

  const resetMask = () => {
    if (!strengthRef.current) return;
    strengthRef.current.fill(0);
    setCommittedPasses([]);
    setPaletteBaked(false);
    setPalettePreview(null);
    paletteOriginalRef.current = null;
    if (originalBaseRef.current) baseRef.current = new ImageData(new Uint8ClampedArray(originalBaseRef.current.data), originalBaseRef.current.width, originalBaseRef.current.height);
    repaint();
  };

  const fillMask = () => {
    const base = baseRef.current, mask = strengthRef.current, protectedMask = protectedRef.current;
    if (!base || !mask) return;
    pushHistory();
    for (let i = 0; i < mask.length; i++) mask[i] = base.data[i * 4 + 3] > 12 && !(respectProtection && protectedMask?.[i]) ? 1 : 0;
    repaint();
  };

  const deriveSkinTransferProfile = (current = baseRef.current, sourceProtection = protectedRef.current, baseline = recoveryOriginalRef.current) => {
    if (!current) return null;
    const canCompare = baseline?.width === current.width && baseline?.height === current.height;
    let hueX = 0, hueY = 0, saturation = 0, lightness = 0, weightTotal = 0, samples = 0;

    for (let i = 0; i < current.width * current.height; i++) {
      const offset = i * 4;
      if (current.data[offset + 3] <= 12 || sourceProtection?.[i]) continue;
      const rgb = [current.data[offset], current.data[offset + 1], current.data[offset + 2]];
      const originalRgb = canCompare ? [baseline.data[offset], baseline.data[offset + 1], baseline.data[offset + 2]] : null;
      // When the original client BLP is available, use only genuinely changed
      // pixels. A custom colour-index may exist only in output, in which case
      // sampling the editable Skin remains a deterministic fallback.
      if (originalRgb && rgbDistance(rgb, originalRgb) < 28) continue;
      const [h, s, l] = rgbToHsl(...rgb);
      if (s < .08 || l < .06 || l > .94) continue;
      const weight = s * (.35 + Math.abs(l - .5));
      hueX += Math.cos(h * Math.PI / 180) * weight;
      hueY += Math.sin(h * Math.PI / 180) * weight;
      saturation += s * weight;
      lightness += l * weight;
      weightTotal += weight;
      samples++;
    }
    if (!weightTotal || samples < 32) return null;
    const hue = (Math.atan2(hueY, hueX) * 180 / Math.PI + 360) % 360;
    return {
      targetColor: hslToHex(hue, saturation / weightTotal, lightness / weightTotal),
      strength: 1,
      source: canCompare ? 'saved Skin delta' : 'saved Skin sampling',
      samples,
    };
  };

  const selectTexturePart = (path) => {
    if (texturePartType === 'skin-atlas' && strengthRef.current?.some(value => value > 0)) {
      // The profile is intentionally colour/luminance based rather than a UV
      // copy: Skin Extra has a different layout, but should inherit the same
      // hue, saturation and strength while preserving its own shading.
      const profile = { targetColor, strength, source: 'active paint' };
      setSkinTransferProfile(profile);
    } else if (texturePartType === 'skin-atlas') {
      const canvas = canvasRef.current;
      const current = canvas ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height) : baseRef.current;
      const sourceProtection = protectedRef.current ? Uint8Array.from(protectedRef.current) : null;
      const baseline = recoveryOriginalRef.current ? new ImageData(new Uint8ClampedArray(recoveryOriginalRef.current.data), recoveryOriginalRef.current.width, recoveryOriginalRef.current.height) : null;
      skinSourceRef.current = { image: current, protectedMask: sourceProtection, baseline };
      setSkinTransferProfile(deriveSkinTransferProfile(current, sourceProtection, baseline));
    }
    // Mark the old canvas as loading before the parent swaps BLP props. This
    // prevents the pending profile from being applied to the previous Skin.
    setLoading(true);
    onSelectTexturePart?.(path);
  };

  const loadLinkedSkinProfile = async () => {
    if (sourceSkinPath && outputSkinPath) {
      const [sourceResult, outputResult] = await Promise.all([
        window.azeroth.dbc.readBlpTexture(dataPath, sourceSkinPath),
        window.azeroth?.dbc?.readOutputBlpTexture ? window.azeroth.dbc.readOutputBlpTexture(outputSkinPath) : window.azeroth.dbc.readBlpTexture(dataPath, outputSkinPath),
      ]);
      if (sourceResult?.success && sourceResult.png && outputResult?.success && outputResult.png) {
        const [sourceImage, outputImage] = await Promise.all([pngToImageData(sourceResult.png), pngToImageData(outputResult.png)]);
        if (sourceImage.width === outputImage.width && sourceImage.height === outputImage.height) {
          const analysis = textureClassifier.classify({ path: outputSkinPath, width: outputImage.width, height: outputImage.height, rgba: new Uint8Array(outputImage.data), textureType: 'skin-atlas' });
          const protectedMask = analysis.template ? semanticMaskResolver.resolve({ template: analysis.template, rgba: new Uint8Array(outputImage.data), width: outputImage.width, height: outputImage.height }).protectedMask : null;
          const profile = deriveSkinTransferProfile(outputImage, protectedMask, sourceImage);
          if (profile) return { ...profile, source: `Color ${sourceColorIndex} → Color ${colorIndex} delta` };
        }
      }
    }
    const skinPath = textureParts.find(part => part.path !== blpPath && /skin atlas/i.test(part.label))?.path || textureParts.find(part => /skin atlas/i.test(part.label))?.path;
    if (!skinPath) return null;
    const output = preferOutput && window.azeroth?.dbc?.readOutputBlpTexture
      ? await window.azeroth.dbc.readOutputBlpTexture(skinPath)
      : null;
    const result = output?.success ? output : await window.azeroth.dbc.readBlpTexture(dataPath, skinPath);
    if (!result?.success || !result.png) return null;
    const image = await pngToImageData(result.png);
    const analysis = textureClassifier.classify({ path: skinPath, width: image.width, height: image.height, rgba: new Uint8Array(image.data), textureType: 'skin-atlas' });
    const resolved = analysis.template ? semanticMaskResolver.resolve({ template: analysis.template, rgba: new Uint8Array(image.data), width: image.width, height: image.height }) : null;
    const source = { image, protectedMask: resolved?.protectedMask || null, baseline: null };
    skinSourceRef.current = source;
    return deriveSkinTransferProfile(source.image, source.protectedMask, source.baseline);
  };

  // A Skin Extra does not share the Skin atlas UV layout. Instead of copying
  // pixels, learn the actual colour transform from the base colour set to the
  // saved target Skin, then apply that transform to the Extra's own pixels.
  const loadLinkedSkinColourMap = async () => {
    if (!sourceSkinPath || !outputSkinPath) return null;
    try {
      const [sourceResult, outputResult] = await Promise.all([
        window.azeroth.dbc.readBlpTexture(dataPath, sourceSkinPath),
        window.azeroth?.dbc?.readOutputBlpTexture
          ? window.azeroth.dbc.readOutputBlpTexture(outputSkinPath)
          : window.azeroth.dbc.readBlpTexture(dataPath, outputSkinPath),
      ]);
      if (!sourceResult?.success || !sourceResult.png || !outputResult?.success || !outputResult.png) return null;
      const [sourceImage, outputImage] = await Promise.all([pngToImageData(sourceResult.png), pngToImageData(outputResult.png)]);
      if (sourceImage.width !== outputImage.width || sourceImage.height !== outputImage.height) return null;
      const analysis = textureClassifier.classify({
        path: outputSkinPath,
        width: outputImage.width,
        height: outputImage.height,
        rgba: new Uint8Array(outputImage.data),
        textureType: 'skin-atlas',
      });
      const protectedMask = analysis.template
        ? semanticMaskResolver.resolve({ template: analysis.template, rgba: new Uint8Array(outputImage.data), width: outputImage.width, height: outputImage.height }).protectedMask
        : null;
      const map = buildSkinColourMap(sourceImage, outputImage, protectedMask);
      return map.length >= 12 ? map : null;
    } catch {
      return null;
    }
  };

  const applySkinColourTransfer = async () => {
    const colourMap = await loadLinkedSkinColourMap();
    if (colourMap && baseRef.current && strengthRef.current) {
      pushHistory();
      const base = baseRef.current;
      const protectedMask = respectProtection ? protectedRef.current : null;
      paletteOriginalRef.current = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
      baseRef.current = applySkinColourMap(base, colourMap, protectedMask);
      for (let i = 0; i < strengthRef.current.length; i++) {
        strengthRef.current[i] = base.data[i * 4 + 3] > 12 && !protectedMask?.[i] ? 1 : 0;
      }
      setStrength(0);
      setPaletteBaked(true);
      setSkinTransferProfile({ source: `Colour ${sourceColorIndex} → Colour ${colorIndex} pixel map`, samples: colourMap.reduce((total, entry) => total + entry.count, 0) });
      setMaskRevision(value => value + 1);
      setTemplateSaveMsg(`Applied the learned Colour ${sourceColorIndex} → ${colorIndex} transform to Skin Extra (${colourMap.length} colour clusters).`);
      return;
    }
    const source = skinSourceRef.current;
    const profile = skinTransferProfile || deriveSkinTransferProfile(source?.image, source?.protectedMask, source?.baseline) || await loadLinkedSkinProfile();
    if (!profile || !baseRef.current || !strengthRef.current) {
      setTemplateSaveMsg('Could not analyse the linked Skin atlas. Check that Test output only is enabled and the saved Skin BLP exists.');
      return;
    }
    setSkinTransferProfile(profile);
    pushHistory();
    setTargetColor(profile.targetColor);
    setStrength(profile.strength);
    const base = baseRef.current, mask = strengthRef.current, protectedMask = protectedRef.current;
    for (let i = 0; i < mask.length; i++) {
      mask[i] = base.data[i * 4 + 3] > 12 && !(respectProtection && protectedMask?.[i]) ? 1 : 0;
    }
    setMaskRevision(value => value + 1);
  };

  const applySourceBodyPalette = async () => {
    if (!selectedSourceSkin?.tex1 || !baseRef.current || !strengthRef.current) return;
    setTemplateSaveMsg(null);
    const output = preferOutput && window.azeroth?.dbc?.readOutputBlpTexture
      ? await window.azeroth.dbc.readOutputBlpTexture(selectedSourceSkin.tex1)
      : null;
    const result = output?.success ? output : await window.azeroth.dbc.readBlpTexture(dataPath, selectedSourceSkin.tex1);
    if (!result?.success || !result.png) { setTemplateSaveMsg('Could not load the selected source Skin BLP.'); return; }
    const source = await pngToImageData(result.png);
    const sourceAnalysis = textureClassifier.classify({ path: selectedSourceSkin.tex1, width: source.width, height: source.height, rgba: new Uint8Array(source.data), textureType: 'skin-atlas' });
    const sourceMask = sourceAnalysis.template ? semanticMaskResolver.resolve({ template: sourceAnalysis.template, rgba: new Uint8Array(source.data), width: source.width, height: source.height }).protectedMask : null;
    const palette = analyseBodyPalette(source, sourceMask);
    if (!palette) { setTemplateSaveMsg('The selected Skin did not contain a reliable dominant body palette.'); return; }
    pushHistory();
    const base = baseRef.current, protectedMask = protectedRef.current;
    const transferProtection = new Uint8Array(protectedMask || base.width * base.height);
    if (texturePartType === 'skin-extra' && preserveExtraHair) for (let i = 0; i < transferProtection.length; i++) {
      const o = i * 4;
      const [, saturation, lightness] = rgbToHsl(base.data[o], base.data[o + 1], base.data[o + 2]);
      if (base.data[o + 3] > 12 && lightness < .16 && saturation < .45) transferProtection[i] = 1;
    }
    paletteOriginalRef.current = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    const transferSettings = { paletteInfluence, textureDetailStrength, shadowDepth };
    const remapped = remapImageWithPalette(base, palette, respectProtection ? transferProtection : null, transferSettings);
    for (let i = 0; i < strengthRef.current.length; i++) strengthRef.current[i] = base.data[i * 4 + 3] > 12 && !(respectProtection && transferProtection[i]) ? 1 : 0;
    baseRef.current = remapped;
    setStrength(0); // The palette is baked into the temporary canvas base; the mask remains exportable.
    setPaletteBaked(true);
    sourcePaletteRef.current = { sourceId: selectedSourceSkin.id, palette };
    if (texturePartType === 'skin-atlas') setPalettePreview({ palette, protectedMask: Uint8Array.from(protectedMask || []), width: base.width, height: base.height, mappings: componentMappings, transferSettings });
    setSourcePaletteInfo(palette.map(([h, s, l]) => hslToHex(h, s, l)));
    setMaskRevision(value => value + 1);
    setTemplateSaveMsg(`Applied ${SOURCE_RACES.find(([id]) => id === sourceRace)?.[1] || 'source'} body palette to editable body pixels.`);
  };

  const changeTargetColor = nextColor => {
    if (nextColor === targetColor || !canvasRef.current || !baseRef.current || !strengthRef.current) { setTargetColor(nextColor); return; }
    // Flatten the current colour pass into the temporary working base before a
    // new colour starts. Source BLPs remain untouched until explicit export.
    const { w, h } = dimsRef.current;
    const mask = Uint8Array.from(strengthRef.current, value => Math.round(value * 255));
    if (mask.some(value => value)) setCommittedPasses(current => [...current, { mask, targetColor, strength, preserveShading: preservePaintShading, mappings: componentMappings }]);
    baseRef.current = canvasRef.current.getContext('2d').getImageData(0, 0, w, h);
    strengthRef.current.fill(0);
    // Palette auto-fill is already baked into `baseRef`. Once the user starts
    // a new colour pass, make that baked result the new working baseline so
    // repaint cannot restore the pre-palette BLP underneath it.
    if (paletteBaked) {
      paletteOriginalRef.current = null;
      setPaletteBaked(false);
    }
    setTargetColor(nextColor);
  };

  const pickColourAt = (cx, cy) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(cx)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(cy)));
    const [red, green, blue, alpha] = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    if (alpha <= 12) return;
    changeTargetColor(`#${[red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('')}`);
    setTool('paint');
  };

  const useSemanticMask = () => {
    const mask = semanticMasks?.[semanticRegion];
    if (!mask || !strengthRef.current) return;
    for (let i = 0; i < mask.length; i++) strengthRef.current[i] = mask[i] / 255;
    repaint();
  };

  // ── Opslaan ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    const { w, h } = dimsRef.current;
    const strengthArr = strengthRef.current;
    const recoveryOriginal = recoveryOriginalRef.current;
    const hasRecovery = recoveryOriginal?.width === w && recoveryOriginal?.height === h;
    const hasCommittedPass = committedPasses.some(pass => pass.mask?.some(value => value > 0));
    if (!strengthArr || (strengthArr.every(v => v === 0) && !hasCommittedPass && !hasRecovery)) {
      setSaveError('Paint an area first — there are no changes to save.');
      return;
    }
    setSaving(true);
    setSaveError(null);

    const ctx = canvasRef.current.getContext('2d');
    const finalRgba = ctx.getImageData(0, 0, w, h).data; // Uint8ClampedArray, bevat al de preview-recolor
    const maskBytes = new Uint8Array(w * h);
    // Earlier colours are flattened into the canvas when the target changes.
    // Export the union so every visible paint pass reaches the BLP encoder.
    for (const pass of committedPasses) {
      const passMask = pass.mask;
      if (!passMask || passMask.length !== maskBytes.length) continue;
      for (let i = 0; i < maskBytes.length; i++) if (passMask[i]) maskBytes[i] = passMask[i];
    }
    for (let i = 0; i < w * h; i++) {
      const active = Math.round(strengthArr[i] * 255);
      maskBytes[i] = hasRecovery ? (finalRgba[i * 4 + 3] > 12 ? 255 : 0) : Math.max(maskBytes[i], active);
    }

    const toBase64 = (bytes) => {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    };

    const editedRgbaBase64 = toBase64(new Uint8Array(finalRgba.buffer.slice(0)));
    const maskBase64 = toBase64(maskBytes);

    const baseName = blpPath.replace(/\\/g, '/').split('/').pop().replace(/\.blp$/i, '');
    const dirName  = blpPath.replace(/\\/g, '/').split('/').slice(0, -1).join('\\');
    const outRelPath = outputPath || ((dirName ? dirName + '\\' : '') + `${baseName}_custom${Date.now()}.blp`);

    try {
      // Derived colour sets are loaded from their staged BLP, but encoding
      // still needs the original client BLP header/compression source.
      const res = await window.azeroth.dbc.writeBlpTextureEdit(dataPath, writeSourceBlpPath || sourceBlpPath || blpPath, editedRgbaBase64, maskBase64, outRelPath, true);
      if (res?.success) {
        if (saveAsTemplateCorrection && semanticAnalysis?.template && protectedRef.current) {
          templateCorrectionStore.save({
            id: `${semanticAnalysis.template.id}:protected-details`, templateId: semanticAnalysis.template.id, templateVersion: semanticAnalysis.template.version,
            width: w, height: h, protectedMask: bytesToBase64(protectedRef.current), semantic: 'protected-details',
            polygonOverrides,
            customPolygons,
            labelOverrides,
          });
        }
        const activePass = { mask: Uint8Array.from(strengthRef.current, value => Math.round(value * 255)), targetColor, strength, mappings: componentMappings };
        const recoveryTransfer = hasRecovery ? {
          originalBase64: toBase64(new Uint8Array(recoveryOriginal.data.buffer.slice(0))),
          editedBase64: editedRgbaBase64,
          width: w,
          height: h,
        } : null;
        const registration = await onSaved?.({ path: res.path, saveMode, targetSetFlags, targetColor, strength, sourceMaskBase64: maskBase64, sourceWidth: w, sourceHeight: h, componentMappings, componentPasses: [...committedPasses, activePass], recoveryTransfer });
        if (registration?.success === false) setSaveError(`BLP staged, but the new colour set was not registered: ${registration.error}`);
      }
      else setSaveError(res?.error || 'Save failed');
    } catch (e) {
      setSaveError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveTemplateProtection = () => {
    if (!semanticAnalysis?.template || !protectedRef.current) return;
    const { w, h } = dimsRef.current;
    templateCorrectionStore.save({
      id: `${semanticAnalysis.template.id}:protected-details`, templateId: semanticAnalysis.template.id, templateVersion: semanticAnalysis.template.version,
      width: w, height: h, protectedMask: bytesToBase64(protectedRef.current), semantic: 'protected-details', polygonOverrides, customPolygons, labelOverrides,
    });
    setReusedCorrection(true); setTemplateSaveMsg('Protection and polygons saved for this template.');
    setTimeout(() => setTemplateSaveMsg(null), 2500);
  };

  return (
    <div className="tme-overlay" onClick={onClose}>
      <div className={`tme-modal ${maximized ? 'tme-modal-maximized' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="tme-header">
          <div>
            <h3>Edit texture</h3>
            <p className="tme-path" title={importedBlpPath || blpPath}>{importedBlpPath || blpPath}</p>
          </div>
          <div className="tme-header-actions"><button className="tme-tool-btn" onClick={openExportedBlp} title="Open a previously exported BLP without overwriting it"><FolderOpen size={15} /> Open exported BLP</button><button className="tme-close" onClick={() => setMaximized(value => !value)} title={maximized ? 'Venster herstellen' : 'Venster maximaliseren'}>{maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button><button className="tme-close" onClick={onClose}><X size={16} /></button></div>
        </div>
        <div className="tme-tool-row tme-preview-tabs"><button className={`tme-tool-btn ${activeTab === 'preview' ? 'active' : ''}`} onClick={() => activeTab === 'preview' ? setActiveTab('canvas') : openPreview()}>{activeTab === 'preview' ? 'Close 3D Preview' : '3D Preview'}</button></div>

        <div className={`tme-body ${activeTab === 'preview' ? 'tme-preview-mode' : ''}`}>
          {loading && <div className="tme-status"><Loader2 size={18} className="cc-spin" /> Loading…</div>}
          {error && <div className="tme-status tme-status-err">Error: {error}</div>}
          <div className="tme-workspace" style={{ display: (loading || error) ? 'none' : 'grid' }}>
            <aside className="tme-left-panel">
              <h4>Layers</h4>
              {textureParts.length > 1 && <label className="tme-field">
                Texture part
                <select value={blpPath} onChange={e => selectTexturePart(e.target.value)}>
                  {textureParts.map(part => <option key={part.path} value={part.path}>{part.label}</option>)}
                </select>
                <span className="tme-part-hint">Atlas components are projected from Skin. Independent BLPs open on their own canvas.</span>
              </label>}
              {texturePartType === 'skin-extra' && sourceColorIndex != null && <div className="tme-analysis"><strong>Linked colour transform</strong><span>Base Color {sourceColorIndex} → Color {colorIndex}</span><span>Editing original Extra, exporting to the linked output set.</span></div>}
              {semanticAnalysis && <>
                <div className="tme-analysis"><strong>Semantic analysis: {semanticAnalysis.status === 'ready' ? 'ready' : semanticAnalysis.status === 'review' ? 'review' : 'manual'}</strong><span>{Math.round((semanticAnalysis.confidence?.total ?? 0) * 100)}% · {semanticAnalysis.template?.id || 'no template'}</span>{reusedCorrection && <span>Saved correction applied</span>}</div>
                {semanticAnalysis?.template?.match?.textureType === 'skin-atlas' && <details className="tme-collapsible"><summary>Component mappings</summary><select value={mappingComponent} onChange={e => setMappingComponent(e.target.value)}>{Object.keys(componentMappings).map(name => <option key={name}>{name}</option>)}</select>{['x','y','width','height'].map(key => <label className="tme-field" key={key}>{key}<input type="number" min="0" max="1" step="0.005" value={componentMappings[mappingComponent]?.[key] ?? 0} onChange={e => setComponentMappings(current => ({ ...current, [mappingComponent]: { ...current[mappingComponent], [key]: Math.max(0, Math.min(1, Number(e.target.value) || 0)) } }))} /></label>)}<button className="tme-tool-btn" onClick={() => { componentMappingStore.save(semanticAnalysis.template.id, componentMappings); setTemplateSaveMsg('Component mappings saved for this atlas layout.'); }}>Save component mappings</button></details>}
                {(semanticAnalysis.template?.regions || []).some(region => region.polygon) && <details className="tme-collapsible"><summary>Protection layers</summary><select value={polygonSemantic} onChange={e => setPolygonSemantic(e.target.value)}>{semanticAnalysis.template.regions.filter(region => region.polygon).map(region => <option key={region.semantic} value={region.semantic}>{region.label || region.semantic.replace('-candidate', '')}</option>)}</select><button className={`tme-tool-btn ${polygonEdit ? 'active' : ''}`} onClick={() => setPolygonEdit(value => !value)}>{polygonEdit ? 'Finish polygon' : 'Edit polygon'}</button><div className="tme-tool-row"><button className="tme-tool-btn" onClick={addCustomPolygon}>New region</button>{customPolygons.some(item => item.semantic === polygonSemantic) && <button className="tme-tool-btn" onClick={removeCustomPolygon}>Remove region</button>}</div><div className="tme-polygon-layers">{semanticAnalysis.template.regions.filter(region => region.polygon).map(region => <label key={region.semantic}><input type="checkbox" checked={polygonVisibility[region.semantic] !== false} onChange={e => setPolygonVisibility(current => ({ ...current, [region.semantic]: e.target.checked }))} /><span style={{ background: '#1ebeff' }} />{region.label || region.semantic.replace('-candidate', '')}</label>)}</div>{polygonEdit && <span className="tme-polygon-hint">Drag a vertex to move it · drag inside the polygon to move the layer · click a line to add a vertex.</span>}<div className="tme-tool-row"><button className="tme-tool-btn" onClick={copyTemplateJson}>Copy JSON</button><button className="tme-tool-btn" onClick={pasteTemplateJson}>Paste JSON</button></div></details>}
              </>}
                {(semanticAnalysis?.template?.regions || []).some(region => region.polygon) && <button className="tme-tool-btn tme-save-protection" onClick={saveTemplateProtection}><Save size={14} /> Save protection/polygons</button>}
                {templateSaveMsg && <div className="tme-template-ok">{templateSaveMsg}</div>}
            </aside>
            <div ref={canvasWrapRef} className="tme-canvas-wrap">
              <div className={`tme-canvas-stack ${polygonEdit ? 'polygon-editing' : ''}`} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><canvas ref={canvasRef} className={`tme-canvas ${tool === 'eyedropper' ? 'tme-canvas-eyedropper' : ''}`} onContextMenu={e => e.preventDefault()} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave} /><canvas ref={protectionOverlayRef} className="tme-protection-overlay" />{brushCursor && !polygonEdit && tool !== 'eyedropper' && <div className={`tme-brush-cursor ${tool}${brushSoft ? ' soft' : ''}`} style={{ left: `${brushCursor.left}%`, top: `${brushCursor.top}%`, width: `${brushCursor.width}%`, height: `${brushCursor.height}%` }} />}</div><div className="tme-canvas-status"><span>{tool}</span><span>{targetColor}</span><span>{brushSize}px</span>{textureSize && <span>{textureSize.width} × {textureSize.height}px</span>}{mappingEdit && <span>Moving {mappingComponent}</span>}</div>
            </div>

            <div className="tme-controls">
              {semanticAnalysis && (
                <div className="tme-semantic-controls">
                  <strong>Semantic analysis: {semanticAnalysis.status === 'ready' ? 'ready' : semanticAnalysis.status === 'review' ? 'review' : 'manual'}</strong>
                  <span> {Math.round((semanticAnalysis.confidence?.total ?? 0) * 100)}% · {semanticAnalysis.template?.id || 'geen template'}</span>
                  {reusedCorrection && <span> · opgeslagen correctie toegepast</span>}
                  {semanticOptions.length > 0 && <>
                    <select value={semanticRegion} onChange={e => setSemanticRegion(e.target.value)}>
                      {semanticOptions.map(([name, label]) => <option key={name} value={name}>{label}</option>)}
                    </select>
                    <button className="tme-tool-btn" onClick={useSemanticMask}>Use suggested mask</button>
                  </>}
                  {(semanticAnalysis.template?.regions || []).some(region => region.role === 'protected-detail' && region.polygon) && <>
                    <select value={polygonSemantic} onChange={e => setPolygonSemantic(e.target.value)}>{semanticAnalysis.template.regions.filter(region => region.role === 'protected-detail' && region.polygon).map(region => <option key={region.semantic} value={region.semantic}>{region.label || region.semantic.replace('-candidate', '')}</option>)}</select>
                    <button className={`tme-tool-btn ${polygonEdit ? 'active' : ''}`} onClick={() => setPolygonEdit(value => !value)}>{polygonEdit ? 'Finish polygon' : 'Edit polygon'}</button>
                    <div className="tme-tool-row"><button className="tme-tool-btn" onClick={addCustomPolygon}>New region</button>{customPolygons.some(item => item.semantic === polygonSemantic) && <button className="tme-tool-btn" onClick={removeCustomPolygon}>Remove region</button>}</div>
                    <div className="tme-polygon-layers">{semanticAnalysis.template.regions.filter(region => region.role === 'protected-detail' && region.polygon).map(region => <label key={region.semantic}><input type="checkbox" checked={polygonVisibility[region.semantic] !== false} onChange={e => setPolygonVisibility(current => ({ ...current, [region.semantic]: e.target.checked }))} /><span style={{ background: region.color || '#00c8ff' }} />{region.label || region.semantic.replace('-candidate', '')}</label>)}</div>
                    {customPolygons.some(item => item.semantic === polygonSemantic) && <><label className="tme-field">Region name<input value={customPolygons.find(item => item.semantic === polygonSemantic)?.label || ''} onChange={e => updateCustomPolygon('label', e.target.value)} /></label><label className="tme-field">Region colour<input type="color" value={customPolygons.find(item => item.semantic === polygonSemantic)?.color || '#00c8ff'} onChange={e => updateCustomPolygon('color', e.target.value)} /></label></>}
                    {polygonEdit && <span className="tme-polygon-hint">Click a vertex to drag it · click a line to add a vertex · Delete removes the selected vertex.</span>}
                    <div className="tme-tool-row"><button className="tme-tool-btn" onClick={copyTemplateJson}>Copy JSON</button><button className="tme-tool-btn" onClick={pasteTemplateJson}>Paste JSON</button></div>
                  </>}
                </div>
              )}
              <div className="tme-tool-row">
                <button className={`tme-tool-btn ${tool === 'paint' ? 'active' : ''}`} onClick={() => setTool('paint')}>
                  <Brush size={14} /> Paint
                </button>
                <button className={`tme-tool-btn ${tool === 'erase' ? 'active' : ''}`} onClick={() => setTool('erase')}>
                  <Eraser size={14} /> Erase
                </button>
                <button className={`tme-tool-btn ${tool === 'eyedropper' ? 'active' : ''}`} onClick={() => setTool('eyedropper')} title="Pick a pixel colour from the canvas">
                  <Pipette size={14} /> Eyedropper
                </button>
                <button className="tme-tool-btn" onClick={fillMask} title="Fill all editable, non-protected pixels with the target colour">Fill</button>
                {semanticAnalysis?.template?.match?.textureType === 'skin-atlas' && <button className={`tme-tool-btn ${mappingEdit ? 'active' : ''}`} onClick={() => { setShowComponentMappings(true); setMappingEdit(value => !value); }} title="Drag the selected component rectangle on the canvas">Mappings</button>}
                <button className="tme-tool-btn" onClick={resetMask} title="Masker volledig wissen">
                  <RotateCcw size={14} /> Reset
                </button>
              </div>

              {texturePartType === 'skin-atlas' && <details className="tme-collapsible">
                <summary>Source body palette</summary>
                <label className="tme-field">Source race<select value={sourceRace} onChange={e => { setSourceRace(Number(e.target.value)); setSourceSkinId(''); }}>{SOURCE_RACES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label className="tme-field">Source gender<select value={sourceGender} onChange={e => { setSourceGender(Number(e.target.value)); setSourceSkinId(''); }}><option value={0}>Male</option><option value={1}>Female</option></select></label>
                <label className="tme-field">Source colour set<select value={sourceSkinId} onChange={e => setSourceSkinId(e.target.value)} disabled={!sourceSkins.length}>{sourceSkins.map(row => <option key={row.id} value={row.id}>Colour {row.colorIndex} · Flags {row.flags}</option>)}</select></label>
                <button className="tme-tool-btn" onClick={applySourceBodyPalette} disabled={!selectedSourceSkin} title="Analyse dominant source fur colours and fill only editable body pixels">Analyse & auto fill body</button>
                <label className="tme-field">Palette influence: {Math.round(paletteInfluence * 100)}%<input type="range" min="0" max="1" step="0.05" value={paletteInfluence} onChange={e => setPaletteInfluence(Number(e.target.value))} /></label>
                <label className="tme-field">Texture detail: {Math.round(textureDetailStrength * 100)}%<input type="range" min="0" max="2" step="0.05" value={textureDetailStrength} onChange={e => setTextureDetailStrength(Number(e.target.value))} /></label>
                <label className="tme-field">Shadow depth: {Math.round(shadowDepth * 100)}%<input type="range" min="0" max="2" step="0.05" value={shadowDepth} onChange={e => setShadowDepth(Number(e.target.value))} /></label>
                {sourcePaletteInfo && <div className="tme-source-swatches" aria-label="Source fur palette">
                  {sourcePaletteInfo.map((colour, index) => <button key={`${colour}-${index}`} type="button" className={colour.toLowerCase() === targetColor.toLowerCase() ? 'active' : ''} style={{ backgroundColor: colour }} onClick={() => changeTargetColor(colour)} title={`Use ${colour} as target colour`} aria-label={`Use palette colour ${colour} as target colour`} />)}
                  <span>Choose a sampled colour as Target colour</span>
                </div>}
              </details>}

              {texturePartType === 'skin-extra' && <button className="tme-tool-btn" onClick={applySkinColourTransfer} title="Analyse the linked saved Skin and apply its colour profile to Skin Extra">
                Analyse & apply Skin colour
              </button>}
              {texturePartType === 'skin-extra' && skinTransferProfile && <span className="tme-viewport-hint">Profile: {skinTransferProfile.source}{skinTransferProfile.samples ? ` (${skinTransferProfile.samples} pixels)` : ''}</span>}
              {texturePartType === 'skin-extra' && <label className="tme-field">Match Skin brightness: {Math.round(extraBrightnessMatch * 100)}%<input type="range" min="0" max="1" step="0.05" value={extraBrightnessMatch} onChange={e => setExtraBrightnessMatch(Number(e.target.value))} /></label>}

              <div className="tme-tool-row">
                <button className="tme-tool-btn" onClick={() => setZoom(value => Math.max(.5, Number((value - .25).toFixed(2))))}><ZoomOut size={14} /> Uitzoomen</button>
                <button className="tme-tool-btn" onClick={() => setZoom(value => Math.min(8, Number((value + .25).toFixed(2))))}><ZoomIn size={14} /> Inzoomen</button>
                <button className="tme-tool-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Zoom en positie herstellen"><LocateFixed size={14} /> {Math.round(zoom * 100)}%</button>
              </div>
              <span className="tme-viewport-hint">Mouse wheel = zoom · right mouse or Shift + drag = pan · Ctrl+Z = undo</span>

              <label className="tme-field">
                Brush size: {brushSize}px
                <input type="range" min={4} max={80} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} />
              </label>

              <label className="tme-field tme-checkbox">
                <input type="checkbox" checked={brushSoft} onChange={e => setBrushSoft(e.target.checked)} />
                Soft edge (falloff)
              </label>

              <label className="tme-field tme-checkbox" title="Keep the original texture's light and dark detail while applying the selected colour.">
                <input type="checkbox" checked={preservePaintShading} onChange={e => setPreservePaintShading(e.target.checked)} />
                Preserve texture shading
              </label>

              {semanticAnalysis?.template && <label className="tme-field tme-checkbox">
                <input type="checkbox" checked={saveAsTemplateCorrection} onChange={e => setSaveAsTemplateCorrection(e.target.checked)} />
                Reuse protection for this template
              </label>}
              <label className="tme-field tme-checkbox">
                <input type="checkbox" checked={respectProtection} onChange={e => setRespectProtection(e.target.checked)} />
                Respect protected details
              </label>
              <label className="tme-field tme-checkbox">
                <input type="checkbox" checked={showProtection} onChange={e => setShowProtection(e.target.checked)} />
                Show protected areas (cyan)
              </label>

              <label className="tme-field">
                Target colour
                <input type="color" value={targetColor} onChange={e => changeTargetColor(e.target.value)} />
              </label>

              <label className="tme-field">
                New colour set
                <select value={targetSetFlags} onChange={e => setTargetSetFlags(Number(e.target.value))}>
                  <option value={17}>Player (Flags 17 / faces 1)</option>
                  <option value={5}>Death Knight (Flags 5)</option>
                </select>
              </label>

              <label className="tme-field">
                Save behaviour
                <select value={saveMode} onChange={e => onSaveModeChange?.(e.target.value)}>
                  <option value="create">Create new colour set</option>
                  {sourceColorIndex != null && <option value="update">Update Color {colorIndex}</option>}
                </select>
              </label>
              <span className="tme-viewport-hint">{saveMode === 'update' ? `Updates the staged Color ${colorIndex} BLPs; the client originals stay untouched.` : 'Creates a new ColorIndex and leaves this colour set unchanged.'}</span>

              <label className="tme-field">
                Colour intensity: {Math.round(strength * 100)}%
                <input type="range" min={0} max={100} value={strength * 100} onChange={e => setStrength(Number(e.target.value) / 100)} />
              </label>

              <p className="tme-hint">
                Hue &amp; saturation worden vervangen binnen het geschilderde gebied, lightness (schaduw/gradient) blijft behouden.
                De BLP wordt alleen als staging-export geschreven naar output\PlayerTextures; de clientbron blijft onaangeraakt.
              </p>

              {saveError && <div className="tme-status tme-status-err">{saveError}</div>}

              <button className="tme-save-btn" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={14} className="cc-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : 'Save as new texture'}
              </button>
            </div>
          </div>
          {activeTab === 'preview' && <div className="tme-model-preview"><div className="tme-preview-controls">{previewFaces.length > 0 && <label>Face<select value={previewFaceId} onChange={e => setPreviewFaceId(e.target.value)}>{previewFaces.map(row => <option key={row.id} value={row.id}>Face {row.variationIndex}</option>)}</select></label>}{previewHairs.length > 0 && <label>Hair<select value={previewHairId} onChange={e => setPreviewHairId(e.target.value)}><option value="">None</option>{previewHairs.map(row => <option key={row.id} value={row.id}>Style {row.variationIndex} / colour {row.colorIndex}</option>)}</select></label>}</div>{previewRgba ? <CharM2Viewer race={race} gender={gender} skinBlp={previewSkin?.tex1 || blpPath} skinExtraBlp={previewSkin?.tex2 || null} skinRgba={texturePartType === 'skin-atlas' ? previewRgba : null} skinExtraRgba={texturePartType === 'skin-extra' ? previewRgba : null} componentTransfer={texturePartType === 'skin-atlas' ? previewTransfer : null} componentPalette={texturePartType === 'skin-atlas' ? palettePreview : null} appearance={{ face: previewFace?.variationIndex || 0, hairStyle: previewHair?.variationIndex || 0, hairColor: previewHair?.colorIndex || 0 }} textureLayers={[...(previewFace ? [{ path: previewFace.tex1, region: 'face-lower' }, { path: previewFace.tex2, region: 'face-upper' }] : []), ...(previewHair ? [{ path: previewHair.tex1, region: 'hair-primary' }] : [])]} preferOutput={preferOutput} active={!!dataPath} /> : <span>Open the preview after the texture has loaded.</span>}</div>}
        </div>
      </div>
    </div>
  );
}
