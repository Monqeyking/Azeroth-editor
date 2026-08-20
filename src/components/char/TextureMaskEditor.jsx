import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X, Brush, Eraser, Save, Loader2, RotateCcw, Shield, ShieldOff, Maximize2, Minimize2, ZoomIn, ZoomOut, LocateFixed, FolderOpen, Pipette } from 'lucide-react';
import './TextureMaskEditor.css';
import { AtlasTemplateRegistry } from '../../lib/characterTextures/AtlasTemplateRegistry.js';
import { TextureClassificationService } from '../../lib/characterTextures/TextureClassificationService.js';
import { SemanticMaskResolver } from '../../lib/characterTextures/SemanticMaskResolver.js';
import { TemplateCorrectionStore } from '../../lib/characterTextures/TemplateCorrectionStore.js';
import CharM2Viewer from './CharM2Viewer.jsx';
import TextureWorkspaceCanvas from './TextureWorkspaceCanvas.jsx';
import { AtlasComponentMappingStore, DEFAULT_COMPONENT_RECTANGLES } from '../../lib/characterTextures/AtlasComponentMappingStore.js';
import { AtlasComponentTransferService } from '../../lib/characterTextures/AtlasComponentTransferService.js';
import { TextureRecolorEngine } from '../../lib/characterTextures/TextureRecolorEngine.js';
import { buildColourMap, buildChangedProtection, applyColourMap } from '../../lib/characterTextures/ColourTransfer.js';

const textureClassifier = new TextureClassificationService(new AtlasTemplateRegistry());
const semanticMaskResolver = new SemanticMaskResolver();
const templateCorrectionStore = new TemplateCorrectionStore();
const componentMappingStore = new AtlasComponentMappingStore();
const componentTransferService = new AtlasComponentTransferService();
const textureRecolorEngine = new TextureRecolorEngine();
const SOURCE_RACES = [[1, 'Human'], [2, 'Orc'], [3, 'Dwarf'], [4, 'Night Elf'], [5, 'Undead'], [6, 'Tauren'], [7, 'Gnome'], [8, 'Troll'], [10, 'Blood Elf'], [11, 'Draenei'], [12, 'Worgen (Custom)']];
const templateWithPolygonOverrides = (template, overrides = {}, customPolygons = [], labelOverrides = {}) => !template ? template : ({ ...template, regions: [...template.regions.map(region => ({ ...region, ...(overrides[region.semantic] ? { polygon: overrides[region.semantic] } : {}), ...(labelOverrides[region.semantic] ? { label: labelOverrides[region.semantic] } : {}) })), ...customPolygons.map(region => ({ ...region, role: 'protected-detail' }))] });
const pngToImageData = png => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); resolve(context.getImageData(0, 0, image.width, image.height)); }; image.onerror = reject; image.src = `data:image/png;base64,${png}`; });
const pointSegmentDistance = (point, start, end) => { const dx=end[0]-start[0], dy=end[1]-start[1], length=dx*dx+dy*dy; const t=length ? Math.max(0, Math.min(1, ((point[0]-start[0])*dx+(point[1]-start[1])*dy)/length)) : 0; return Math.hypot(point[0]-(start[0]+t*dx), point[1]-(start[1]+t*dy)); };
const pointInPolygon = (point, polygon) => polygon.reduce((inside, vertex, index) => { const previous = polygon[(index + polygon.length - 1) % polygon.length]; return ((vertex[1] > point[1]) !== (previous[1] > point[1]) && point[0] < (previous[0] - vertex[0]) * (point[1] - vertex[1]) / (previous[1] - vertex[1]) + vertex[0]) ? !inside : inside; }, false);
const filterDisabledPolygonProtection = (mask, template, polygonVisibility, width, height) => {
  if (!mask || !template || mask.length !== width * height) return mask;
  const disabled = (template.regions || []).filter(region => region.polygon && region.role?.startsWith('protected') && polygonVisibility[region.semantic] === false);
  if (!disabled.length) return mask;
  const filtered = Uint8Array.from(mask);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const point = [(x + .5) / width, (y + .5) / height];
    if (disabled.some(region => pointInPolygon(point, region.polygon))) filtered[y * width + x] = 0;
  }
  return filtered;
};

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

function getPaletteLightnessRange(image, protectedMask = null) {
  const levels = [];
  for (let i = 0; i < image.width * image.height; i++) {
    const o = i * 4;
    if (image.data[o + 3] > 12 && !protectedMask?.[i]) levels.push(rgbToHsl(image.data[o], image.data[o + 1], image.data[o + 2])[2]);
  }
  levels.sort((a, b) => a - b);
  const last = Math.max(0, levels.length - 1);
  return {
    low: levels[Math.floor(last * .05)] ?? 0,
    high: levels[Math.ceil(last * .95)] ?? 1,
  };
}

function remapImageWithPalette(image, palette, protectedMask = null, { paletteInfluence = 1, textureDetailStrength = 1, shadowDepth = 1, sourceLightnessRange = null } = {}) {
  const sourceRange = sourceLightnessRange || getPaletteLightnessRange(image, protectedMask);
  const low = sourceRange.low;
  const high = sourceRange.high;
  const lightnessRange = Math.max(.01, high - low), out = new Uint8ClampedArray(image.data);
  const sourceLuminance = localLuminance(image);
  for (let i = 0; i < image.width * image.height; i++) {
    const o = i * 4;
    if (image.data[o + 3] <= 12 || protectedMask?.[i]) continue;
    const [originalHue, originalSaturation, lightness] = rgbToHsl(image.data[o], image.data[o + 1], image.data[o + 2]);
    // A continuous ramp is important for fur. Picking one of the 24 analysis
    // samples made every subtle source shade collapse into visible bands.
    const [paletteHue, paletteSaturation, paletteLightness] = blendPalette(palette, (lightness - low) / lightnessRange);
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

const DEFAULT_PALETTE_BRUSH_COLORS = ['#111820', '#2d3540', '#596570', '#9ba6ae', '#d5c7a7'];

function applyPaletteBrushPixel(out, offset, color, amount) {
  const [targetHue, targetSaturation, targetLightness] = hexToHsl(color);
  const [, , sourceLightness] = rgbToHsl(out[offset], out[offset + 1], out[offset + 2]);
  const lightness = Math.max(.015, Math.min(.95, targetLightness + (sourceLightness - .5) * .68));
  const [r, g, b] = hslToRgb(targetHue, targetSaturation, lightness);
  out[offset] = Math.round(out[offset] + (r - out[offset]) * amount);
  out[offset + 1] = Math.round(out[offset + 1] + (g - out[offset + 1]) * amount);
  out[offset + 2] = Math.round(out[offset + 2] + (b - out[offset + 2]) * amount);
}

function buildPaletteBrushPasses(pixels, amounts, colors, width, height, mappings) {
  if (!pixels || !amounts) return [];
  const masks = new Map();
  for (let i = 0; i < pixels.length; i++) {
    const paletteIndex = pixels[i], amount = amounts[i];
    if (paletteIndex < 0 || !amount) continue;
    if (!masks.has(paletteIndex)) masks.set(paletteIndex, new Uint8Array(width * height));
    masks.get(paletteIndex)[i] = Math.round(amount * 255);
  }
  return [...masks.entries()].map(([paletteIndex, mask]) => ({
    mask,
    targetColor: colors[paletteIndex],
    strength: 1,
    preserveShading: true,
    paletteBrush: true,
    mappings,
  }));
}

function cloneImageDataValue(image) {
  return image ? new ImageData(new Uint8ClampedArray(image.data), image.width, image.height) : null;
}

function cropImageDataValue(image, rect) {
  if (!image || !rect) return null;
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const sourceOffset = ((rect.y + y) * image.width + rect.x) * 4;
    out.set(image.data.subarray(sourceOffset, sourceOffset + rect.width * 4), y * rect.width * 4);
  }
  return new ImageData(out, rect.width, rect.height);
}

function cropMaskValue(mask, sourceWidth, rect) {
  if (!mask || !rect) return null;
  const out = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    out.set(mask.subarray((rect.y + y) * sourceWidth + rect.x, (rect.y + y) * sourceWidth + rect.x + rect.width), y * rect.width);
  }
  return out;
}

function mergeProtectionMasks(...masks) {
  const length = masks.find(mask => mask?.length)?.length;
  if (!length) return null;
  const merged = new Uint8Array(length);
  let hasProtection = false;
  for (const mask of masks) {
    if (!mask || mask.length !== length) continue;
    for (let i = 0; i < length; i++) {
      if (mask[i] > merged[i]) merged[i] = mask[i];
      if (merged[i]) hasProtection = true;
    }
  }
  return hasProtection ? merged : null;
}

function buildComponentColourMaps(source, edited, protectedMask, mappings) {
  const dynamicProtection = buildChangedProtection(source, edited, protectedMask);
  const transferProtection = protectedMask?.length === source.width * source.height ? protectedMask : dynamicProtection;
  const maps = {};
  for (const [component, rect] of Object.entries(mappings || {})) {
    const pixelRect = {
      x: Math.max(0, Math.min(source.width - 1, Math.round(rect.x * source.width))),
      y: Math.max(0, Math.min(source.height - 1, Math.round(rect.y * source.height))),
      width: Math.max(1, Math.min(source.width, Math.round(rect.width * source.width))),
      height: Math.max(1, Math.min(source.height, Math.round(rect.height * source.height))),
    };
    const sourceComponent = cropImageDataValue(source, pixelRect);
    const editedComponent = cropImageDataValue(edited, pixelRect);
    const componentProtection = cropMaskValue(transferProtection, source.width, pixelRect);
    const map = buildColourMap(sourceComponent, editedComponent, componentProtection);
    if (map.length >= 4) maps[component] = map;
  }
  return { maps, protection: transferProtection };
}

function cloneTransferPasses(passes) {
  return (passes || []).map(pass => ({ ...pass, mask: pass.mask ? Uint8Array.from(pass.mask) : pass.mask }));
}

const imageDataEqual = (left, right) => !!left && !!right && left.width === right.width && left.height === right.height && left.data.length === right.data.length && left.data.every((value, index) => value === right.data[index]);
const normalizeTexturePath = value => String(value || '').replace(/\//g, '\\').toLowerCase();
const flattenTextureParts = parts => (parts || []).flatMap(part => part.faceParts || [part]);
const findTexturePartByPath = (parts, path) => {
  const key = normalizeTexturePath(path);
  return flattenTextureParts(parts).find(part => [part.path, part.sourcePath, part.writeSourcePath, part.outputPath]
    .some(candidate => normalizeTexturePath(candidate) === key)) || null;
};
const hashBytes = bytes => {
  let hash = 2166136261;
  for (let index = 0; index < (bytes?.length || 0); index++) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};
const buildTextureDeltaMask = (previous, current, threshold = 8) => {
  if (!previous || !current || previous.width !== current.width || previous.height !== current.height) return null;
  const mask = new Uint8Array(previous.width * previous.height);
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 4;
    if (previous.data[offset + 3] <= 12 || current.data[offset + 3] <= 12) continue;
    const difference = Math.abs(previous.data[offset] - current.data[offset])
      + Math.abs(previous.data[offset + 1] - current.data[offset + 1])
      + Math.abs(previous.data[offset + 2] - current.data[offset + 2]);
    if (difference >= threshold) mask[i] = 255;
  }
  return mask;
};
const buildUnchangedMask = (deltaMask, protectedMask = null) => {
  if (!deltaMask) return null;
  const mask = new Uint8Array(deltaMask.length);
  for (let i = 0; i < mask.length; i++) if (!deltaMask[i] || protectedMask?.[i]) mask[i] = 255;
  return mask;
};
function applyComponentPasses(image, passes, sourceWidth, sourceHeight, rect, protectedMask) {
  let rgba = new Uint8ClampedArray(image.data);
  for (const pass of passes || []) {
    const passRect = pass?.rect || rect;
    if (!pass?.mask || !pass.targetColor || !passRect) continue;
    const projected = componentTransferService.projectMask(pass.mask, sourceWidth, sourceHeight, passRect, image.width, image.height, protectedMask);
    rgba = textureRecolorEngine.recolor(rgba, projected, pass.targetColor, pass.strength ?? 1, {
      preserveShading: pass.preserveShading !== false,
      paletteBrush: pass.paletteBrush === true,
    });
  }
  return new ImageData(rgba, image.width, image.height);
}

function buildPassCoverage(passes, width, height) {
  const coverage = new Uint8Array(width * height);
  for (const pass of passes || []) {
    if (!pass?.mask || pass.mask.length !== coverage.length) continue;
    for (let i = 0; i < coverage.length; i++) if (pass.mask[i] > coverage[i]) coverage[i] = pass.mask[i];
  }
  return coverage;
}

function projectPassCoverage(passes, sourceWidth, sourceHeight, rect, targetWidth, targetHeight) {
  if (!rect || !passes?.length) return null;
  const coverage = new Uint8Array(targetWidth * targetHeight);
  for (const pass of passes) {
    const passRect = pass?.rect || rect;
    if (!pass?.mask || !passRect) continue;
    const projected = componentTransferService.projectMask(pass.mask, sourceWidth, sourceHeight, passRect, targetWidth, targetHeight);
    for (let i = 0; i < coverage.length; i++) if (projected[i] > coverage[i]) coverage[i] = projected[i];
  }
  return coverage;
}

export default function TextureMaskEditor({ dataPath, blpPath, outputPath = null, texturePartType = null, textureParts = [], onSelectTexturePart, initialTargetFlags = 17, race, gender, characterRecords = [], colorIndex = 0, variationIndex = 0, preferOutput = false, modelVariantId = '', modelVariantArchivePath = '', sourceColorIndex = null, sourceSkinPath = null, outputSkinPath = null, sourceExtraPath = null, sourceBlpPath = null, writeSourceBlpPath = null, recoverySourceBlpPath = null, saveMode = 'create', onSaveModeChange, onClose, onSaved }) {
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
  const paletteBrushPixelsRef = useRef(null);
  const paletteBrushAmountsRef = useRef(null);
  const paletteProtectionRef = useRef(null);
  const extraColourMapRef = useRef(null);
  const stagedPartsRef = useRef(new Map());
  const sessionBasePartsRef = useRef(new Map());
  const recoveryBasePartsRef = useRef(new Map());
  const compositeLayoutRef = useRef(null);
  const loadedTextureKeyRef = useRef(null);
  const restoreModeRef = useRef(false);
  const restoredFinalRef = useRef(null);
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const linkedFaceSyncTimerRef = useRef(null);
  const linkedFaceSyncInFlightRef = useRef(false);
  const linkedFaceSyncPendingRef = useRef(false);
  const linkedFaceSyncRunnerRef = useRef(null);
  const linkedFaceSyncPromiseRef = useRef(null);
  const linkedFaceSyncRevisionRef = useRef(0);
  const componentSessionKeyRef = useRef(null);
  const componentSessionGenerationRef = useRef(0);
  const componentSessionPromiseRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [textureSize, setTextureSize] = useState(null);
  const [importedBlpPath, setImportedBlpPath] = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [templateSaveMsg, setTemplateSaveMsg] = useState(null);

  const [brushSize, setBrushSize]   = useState(24);
  const [brushSoft, setBrushSoft]   = useState(true);
  const [brushShape, setBrushShape] = useState('circle');
  const [tool, setTool]             = useState('paint');
  const [targetColor, setTargetColor] = useState('#ff66cc');
  const [strength, setStrength]     = useState(1); // hoeveel van de doelkleur t.o.v. origineel (hue/sat mix)
  const [preservePaintShading, setPreservePaintShading] = useState(true);
  const [extraBrightnessMatch, setExtraBrightnessMatch] = useState(.38);
  const [extraPaletteSmoothness, setExtraPaletteSmoothness] = useState(.7);
  const [hairTargetColorIndex, setHairTargetColorIndex] = useState(colorIndex);
  const [maskRevision, setMaskRevision] = useState(0);
  const [stagedPreviewRevision, setStagedPreviewRevision] = useState(0);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [workspaceTiles, setWorkspaceTiles] = useState([]);
  const [skinTransferProfile, setSkinTransferProfile] = useState(null);
  // Start from the edited race. A Tauren source is still selectable, but it
  // must not silently become the palette basis when switching texture parts.
  const [sourceRace, setSourceRace] = useState(race || 6);
  const [sourceGender, setSourceGender] = useState(gender);
  const [sourceSkinId, setSourceSkinId] = useState('');
  const [sourcePaletteInfo, setSourcePaletteInfo] = useState(null);
  const [paletteBrushColors, setPaletteBrushColors] = useState(DEFAULT_PALETTE_BRUSH_COLORS);
  const paletteBrushColorsRef = useRef(DEFAULT_PALETTE_BRUSH_COLORS);
  const [paletteBrushColor, setPaletteBrushColor] = useState(DEFAULT_PALETTE_BRUSH_COLORS[2]);
  const [paletteBrushColorIndex, setPaletteBrushColorIndex] = useState(2);
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
  const [palettePreview, setPalettePreview] = useState(null);
  const [previewTransfer, setPreviewTransfer] = useState(null);
  const [stagedAtlasPreview, setStagedAtlasPreview] = useState(null);
  const [loadedFromOutput, setLoadedFromOutput] = useState(false);
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
  // An existing staged colour is a closed editing session: its output BLPs
  // are the working source. MPQ recovery is only for creating a new set.
  const isStagedUpdate = preferOutput && saveMode === 'update';
  const markSkinEdited = useCallback(() => {
    if (texturePartType === 'skin-atlas') {
      linkedFaceSyncRevisionRef.current += 1;
      linkedFaceSyncRunnerRef.current?.();
    }
  }, [texturePartType]);
  const bumpWorkspace = useCallback(() => setWorkspaceRevision(value => value + 1), []);
  const polygonDragRef = useRef(null);
  const polygonDraftRef = useRef(null);
  const polygonCreatingRef = useRef(null);
  const mappingDragRef = useRef(null);

  const beginWorkingEdit = useCallback(() => {
    if (!restoreModeRef.current) return;
    // The restored canvas is already the final result. Keep its export mask
    // for the next save, but stop treating the old operations as active work.
    restoreModeRef.current = false;
  }, []);

  const previewFaceFlags = initialTargetFlags === 5 ? 5 : 1;
  const previewFaces = useMemo(() => characterRecords.filter(row => row.race === race && row.sex === gender && row.baseSection === 1 && row.colorIndex === colorIndex && row.flags === previewFaceFlags), [characterRecords, race, gender, colorIndex, previewFaceFlags]);
  const previewSkin = useMemo(() => characterRecords.find(row => row.race === race && row.sex === gender && row.baseSection === 0 && row.colorIndex === colorIndex) || null, [characterRecords, race, gender, colorIndex]);
  const previewHairs = useMemo(() => characterRecords.filter(row => row.race === race && row.sex === gender && row.baseSection === 3 && row.tex1), [characterRecords, race, gender]);
  const previewFace = previewFaces.find(row => String(row.id) === previewFaceId) || previewFaces[0] || null;
  const previewHair = previewHairs.find(row => String(row.id) === previewHairId) || previewHairs[0] || null;
  const sourceSkins = useMemo(() => characterRecords.filter(row => row.race === sourceRace && row.sex === sourceGender && row.baseSection === 0 && row.tex1), [characterRecords, sourceRace, sourceGender]);
  const selectedSourceSkin = sourceSkins.find(row => String(row.id) === sourceSkinId) || sourceSkins[0] || null;
  const hairColourRows = useMemo(() => {
    if (texturePartType !== 'hair') return [];
    const exact = characterRecords.filter(row => row.race === race && row.sex === gender && row.baseSection === 3 && row.variationIndex === variationIndex && row.flags === initialTargetFlags && row.tex1);
    return exact.length ? exact : characterRecords.filter(row => row.race === race && row.sex === gender && row.baseSection === 3 && row.variationIndex === variationIndex && row.tex1);
  }, [characterRecords, race, gender, variationIndex, initialTargetFlags, texturePartType]);
  const hairColourOptions = useMemo(() => [...new Set(hairColourRows.map(row => Number(row.colorIndex)).filter(Number.isFinite))].sort((a, b) => a - b), [hairColourRows]);
  const selectedHairColourRow = hairColourRows.find(row => Number(row.colorIndex) === Number(hairTargetColorIndex)) || null;

  const choosePaletteBrushColor = useCallback(color => {
    const current = paletteBrushColorsRef.current;
    const existing = current.findIndex(value => value.toLowerCase() === color.toLowerCase());
    const index = existing >= 0 ? existing : current.length;
    if (existing < 0) {
      const next = [...current, color];
      paletteBrushColorsRef.current = next;
      setPaletteBrushColors(next);
    }
    setPaletteBrushColor(color);
    setPaletteBrushColorIndex(index);
    setTool('palette');
  }, []);

  useEffect(() => {
    if (previewHairId) return;
    const linkedHair = previewHairs.find(row => row.colorIndex === colorIndex);
    if (linkedHair || previewHairs[0]) setPreviewHairId(String((linkedHair || previewHairs[0]).id));
  }, [colorIndex, previewHairId, previewHairs]);
  useEffect(() => {
    if (texturePartType !== 'hair') return;
    const current = characterRecords.find(row => row.id != null && row.race === race && row.sex === gender && row.baseSection === 3 && row.tex1 === blpPath);
    if (current) setPreviewHairId(String(current.id));
  }, [blpPath, characterRecords, gender, race, texturePartType]);
  useEffect(() => {
    if (texturePartType !== 'face') return;
    const current = characterRecords.find(row => row.id != null && row.race === race && row.sex === gender && row.baseSection === 1 && [row.tex1, row.tex2, row.tex3].includes(blpPath));
    if (current) setPreviewFaceId(String(current.id));
  }, [blpPath, characterRecords, gender, race, texturePartType]);
  useEffect(() => {
    if (texturePartType !== 'face-group') return;
    const group = textureParts.find(part => String(part.path).toLowerCase() === String(blpPath).toLowerCase());
    const current = characterRecords.find(row => row.id != null && row.race === race && row.sex === gender && row.baseSection === 1 && row.colorIndex === colorIndex && row.flags === (initialTargetFlags === 5 ? 5 : 1) && Number(row.variationIndex) === Number(group?.faceVariation));
    if (current) setPreviewFaceId(String(current.id));
  }, [blpPath, characterRecords, colorIndex, gender, initialTargetFlags, race, texturePartType, textureParts]);
  useEffect(() => { if (selectedSourceSkin && String(selectedSourceSkin.id) !== sourceSkinId) setSourceSkinId(String(selectedSourceSkin.id)); }, [selectedSourceSkin, sourceSkinId]);
  useEffect(() => { if (texturePartType === 'hair') setHairTargetColorIndex(colorIndex); }, [blpPath, texturePartType, colorIndex]);

  useEffect(() => {
    if (restoreModeRef.current) return;
    const original = paletteOriginalRef.current, palette = sourcePaletteRef.current?.palette;
    if (!paletteBaked || !original || !strengthRef.current) return;
    const protectedMask = protectedRef.current;
    if ((texturePartType === 'skin-extra' || texturePartType === 'hair') && extraColourMapRef.current) {
      const transferProtection = new Uint8Array(protectedMask || original.width * original.height);
      baseRef.current = applyColourMap(original, extraColourMapRef.current, respectProtection ? transferProtection : null, extraBrightnessMatch, extraPaletteSmoothness);
      setMaskRevision(value => value + 1);
      return;
    }
    if (!palette) return;
    const transferProtection = new Uint8Array(protectedMask || original.width * original.height);
    if (texturePartType === 'skin-extra' && preserveExtraHair) for (let i = 0; i < transferProtection.length; i++) {
      const o = i * 4;
      const [, saturation, lightness] = rgbToHsl(original.data[o], original.data[o + 1], original.data[o + 2]);
      if (original.data[o + 3] > 12 && lightness < .16 && saturation < .45) transferProtection[i] = 1;
    }
    baseRef.current = remapImageWithPalette(original, palette, respectProtection ? transferProtection : null, { paletteInfluence, textureDetailStrength, shadowDepth });
    if (texturePartType === 'skin-atlas') setPalettePreview(current => current ? { ...current, transferSettings: { paletteInfluence, textureDetailStrength, shadowDepth } } : current);
    setMaskRevision(value => value + 1);
  }, [paletteInfluence, textureDetailStrength, shadowDepth, extraBrightnessMatch, extraPaletteSmoothness, paletteBaked, texturePartType, preserveExtraHair, respectProtection]);

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
      const palettePasses = buildPaletteBrushPasses(paletteBrushPixelsRef.current, paletteBrushAmountsRef.current, paletteBrushColors, canvas.width, canvas.height, componentMappings);
      const passes = [...committedPasses, ...palettePasses];
      if (!paletteBaked) passes.push({ mask: activeMask, targetColor, strength, preserveShading: preservePaintShading, mappings: componentMappings });
      setPreviewTransfer(passes.length ? { passes, width: canvas.width, height: canvas.height } : null);
    }
  }, [targetColor, strength, preservePaintShading, componentMappings, committedPasses, paletteBaked, paletteBrushColors]);
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
    loadedTextureKeyRef.current = null;
    restoreModeRef.current = false;
    restoredFinalRef.current = null;
    setLoading(true);
    setError(null);
    setSemanticAnalysis(null);
    setSemanticMasks(null);
    setPalettePreview(null);
    // A transfer belongs to the currently loaded atlas. Clear the previous
    // part's preview transform before restoring a new staged snapshot.
    setPreviewTransfer(null);
    setLoadedFromOutput(false);
    setCommittedPasses([]);
    setPaletteBaked(false);
    setPalettePreview(null);
    paletteOriginalRef.current = null;
    sourcePaletteRef.current = null;
    paletteProtectionRef.current = null;
    extraColourMapRef.current = null;
    historyRef.current = []; redoRef.current = [];
    const loadPath = importedBlpPath || blpPath;
    const currentPart = textureParts.find(part => String(part.path).toLowerCase() === String(blpPath || '').toLowerCase());
    const compositeParts = currentPart?.faceParts || [];
    const isCompositeFace = texturePartType === 'face-group' && compositeParts.length > 0;
    const staged = isCompositeFace ? null : stagedPartsRef.current.get(normalizeTexturePath(blpPath)) || null;
    // In Test output mode an already exported colour set is the editable
    // source. This makes a second editor session continue from the saved Skin
    // instead of silently reopening the untouched client BLP.
    const stagedTextureResult = image => {
      if (!image?.data || !image.width || !image.height) return null;
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
      return { success: true, png: canvas.toDataURL('image/png').split(',')[1], source: 'staged' };
    };
    const readOneTexture = part => {
      const path = part.path;
      const stagedChild = stagedPartsRef.current.get(normalizeTexturePath(path));
      if (stagedChild?.rgba) return Promise.resolve(stagedTextureResult(stagedChild.rgba));
      return preferOutput && window.azeroth.dbc.readOutputBlpTexture
        ? window.azeroth.dbc.readOutputBlpTexture(path).then(result => result?.success ? result : window.azeroth.dbc.readBlpTexture(dataPath, part.sourcePath || path, modelVariantArchivePath))
        : window.azeroth.dbc.readBlpTexture(dataPath, part.sourcePath || path, modelVariantArchivePath);
    };
    const readTexture = isCompositeFace
      ? Promise.all(compositeParts.map(part => readOneTexture(part))).then(async results => {
        if (results.some(result => !result?.success || !result.png)) return { success: false, error: 'One of the Face textures could not be loaded.' };
        const images = await Promise.all(results.map(result => pngToImageData(result.png)));
        const gap = 12;
        const width = images.reduce((total, image) => total + image.width, 0) + Math.max(0, images.length - 1) * gap;
        const height = Math.max(...images.map(image => image.height));
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d'); let x = 0;
        const rects = images.map((image, index) => { const rect = { x, y: 0, width: image.width, height: image.height, part: compositeParts[index] }; ctx.putImageData(image, x, 0); x += image.width + gap; return rect; });
        compositeLayoutRef.current = { width, height, gap, rects };
        return { success: true, png: canvas.toDataURL('image/png').split(',')[1], source: 'composite' };
      })
      : importedBlpPath
      ? window.azeroth.dbc.readBlpFile(importedBlpPath)
      : readOneTexture({ path: blpPath, sourcePath: sourceBlpPath || blpPath });
    readTexture.then(res => {
      if (cancelled) return;
      if (!res?.success) { setError(res?.error || 'Texture could not be loaded'); setLoading(false); return; }
      setLoadedFromOutput(res.source === 'output');
      const img = new Image();
      img.onload = async () => {
        if (cancelled) return;
        const cvs = canvasRef.current;
        if (!cvs) return;
        cvs.width = img.width; cvs.height = img.height;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, 0, 0);
        baseRef.current = ctx.getImageData(0, 0, img.width, img.height);
        const sessionKey = normalizeTexturePath(blpPath);
        const existingSessionBase = sessionBasePartsRef.current.get(sessionKey) || staged?.sessionBaseRgba || null;
        const sessionBase = existingSessionBase || cloneImageDataValue(baseRef.current);
        if (!importedBlpPath) sessionBasePartsRef.current.set(sessionKey, cloneImageDataValue(sessionBase));
        originalBaseRef.current = cloneImageDataValue(sessionBase);
        if (!importedBlpPath && !staged?.dirty) {
          stagedPartsRef.current.set(sessionKey, { ...(staged || {}), rgba: cloneImageDataValue(baseRef.current), sessionBaseRgba: cloneImageDataValue(sessionBase), dirty: false, sessionBase: true });
        }
        if (isCompositeFace) {
          const layout = compositeLayoutRef.current;
          let restored = false;
          for (const rect of layout?.rects || []) {
            const snapshot = stagedPartsRef.current.get(normalizeTexturePath(rect.part.path));
            if (!snapshot?.rgba || snapshot.rgba.width !== rect.width || snapshot.rgba.height !== rect.height) continue;
            ctx.putImageData(snapshot.rgba, rect.x, rect.y);
            restored = true;
          }
          if (restored) {
            restoreModeRef.current = true;
            baseRef.current = ctx.getImageData(0, 0, img.width, img.height);
          }
        }
        if (staged?.rgba?.width === img.width && staged.rgba.height === img.height) {
          restoreModeRef.current = true;
          restoredFinalRef.current = { snapshot: staged };
          setLoadedFromOutput(true);
          baseRef.current = cloneImageDataValue(staged.rgba);
          ctx.putImageData(baseRef.current, 0, 0);
        }
        recoveryOriginalRef.current = null;
        if (!isCompositeFace && !isStagedUpdate && (importedBlpPath || preferOutput)) {
          const recoveryPath = recoverySourceBlpPath || sourceBlpPath || blpPath;
          const recoveryKey = `${modelVariantArchivePath}|${recoveryPath}`.toLowerCase();
          const cachedRecovery = recoveryBasePartsRef.current.get(recoveryKey);
          if (cachedRecovery) {
            recoveryOriginalRef.current = cloneImageDataValue(cachedRecovery);
          } else {
            const original = await window.azeroth.dbc.readBlpTexture(dataPath, recoveryPath, modelVariantArchivePath);
            if (cancelled) return;
            if (original?.success && original.png) {
              try {
                const originalImage = await pngToImageData(original.png);
                if (originalImage.width === img.width && originalImage.height === img.height) {
                  recoveryBasePartsRef.current.set(recoveryKey, cloneImageDataValue(originalImage));
                  recoveryOriginalRef.current = originalImage;
                }
              } catch { /* recovery remains available as a normal imported texture */ }
            }
          }
        }
        strengthRef.current = new Float32Array(img.width * img.height);
        paletteBrushPixelsRef.current = new Int16Array(img.width * img.height);
        paletteBrushPixelsRef.current.fill(-1);
        paletteBrushAmountsRef.current = new Float32Array(img.width * img.height);
        paletteOriginalRef.current = null;
        sourcePaletteRef.current = null;
        paletteProtectionRef.current = null;
        extraColourMapRef.current = null;
        if (staged?.rgba?.width === img.width && staged.rgba.height === img.height) {
          // A staged RGBA is already the result of these operations. Do not
          // restore their inputs as active state or the next repaint would
          // apply the same colour transform a second time.
          if (staged.paletteBrushColors?.length) {
            paletteBrushColorsRef.current = [...staged.paletteBrushColors];
            setPaletteBrushColors([...staged.paletteBrushColors]);
            setPaletteBrushColor(staged.paletteBrushColor || staged.paletteBrushColors[0]);
            setPaletteBrushColorIndex(staged.paletteBrushColorIndex ?? 0);
          }
          protectedRef.current = staged.protected ? Uint8Array.from(staged.protected) : null;
          strengthRef.current.fill(0);
          paletteBrushPixelsRef.current.fill(-1);
          paletteBrushAmountsRef.current.fill(0);
          setCommittedPasses([]);
          setPaletteBaked(false);
          setExtraBrightnessMatch(staged.extraBrightnessMatch ?? extraBrightnessMatch);
          setExtraPaletteSmoothness(staged.extraPaletteSmoothness ?? extraPaletteSmoothness);
          setPreservePaintShading(staged.preservePaintShading ?? preservePaintShading);
          setRespectProtection(staged.respectProtection ?? respectProtection);
          setPalettePreview(staged.palettePreview || null);
          setSkinTransferProfile(staged.skinTransferProfile || null);
          setSourcePaletteInfo(staged.sourcePaletteInfo || null);
          setTargetColor(staged.targetColor || targetColor);
          setStrength(0);
          setPolygonOverrides(staged.polygonOverrides || {});
          setCustomPolygons(staged.customPolygons || []);
          setLabelOverrides(staged.labelOverrides || {});
          setPreviewRgba(cloneImageDataValue(staged.rgba));
          if (texturePartType === 'skin-atlas') {
            setStagedAtlasPreview({ path: blpPath, rgba: cloneImageDataValue(staged.rgba), transfer: staged.transfer, palette: staged.palettePreview || null });
            // The staged atlas is already final, but the 3D preview still
            // needs the same face transfer to replace the original Face BLPs.
            setPreviewTransfer(staged.transfer || null);
          }
        }
        dimsRef.current = { w: img.width, h: img.height };
        setTextureSize({ width: img.width, height: img.height });
        const analysis = textureClassifier.classify({ path: loadPath, width: img.width, height: img.height, rgba: new Uint8Array(baseRef.current.data), textureType: texturePartType });
        const saved = analysis.template ? templateCorrectionStore.list(analysis.template.id, analysis.template.version).find(c => c.width === img.width && c.height === img.height && c.protectedMask) : null;
        const savedPolygons = staged?.polygonOverrides || saved?.polygonOverrides || {}, savedCustomPolygons = staged?.customPolygons || saved?.customPolygons || [], savedLabels = staged?.labelOverrides || saved?.labelOverrides || {};
        templateBaseRef.current = analysis.template;
        analysis.template = templateWithPolygonOverrides(analysis.template, savedPolygons, savedCustomPolygons, savedLabels);
        const resolved = analysis.template ? semanticMaskResolver.resolve({ template: analysis.template, rgba: new Uint8Array(baseRef.current.data), width: img.width, height: img.height }) : null;
        protectedRef.current = resolved?.protectedMask || new Uint8Array(img.width * img.height);
        if (saved) {
          const correctionMask = base64ToBytes(saved.protectedMask);
          if (correctionMask.length === protectedRef.current.length) for (let i = 0; i < correctionMask.length; i++) protectedRef.current[i] ||= correctionMask[i];
        }
        if (staged?.protected?.length === protectedRef.current.length) protectedRef.current = Uint8Array.from(staged.protected);
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
        setPreviewRgba(cloneImageDataValue(baseRef.current));
        loadedTextureKeyRef.current = loadPath;
        setLoading(false);
      };
      img.onerror = () => { setError('PNG decode mislukt'); setLoading(false); };
      img.src = `data:image/png;base64,${res.png}`;
    }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [dataPath, blpPath, sourceBlpPath, importedBlpPath, texturePartType, modelVariantArchivePath, isStagedUpdate]);

  const openExportedBlp = async () => {
    const filePath = await window.azeroth.dialog.openFile({ title: 'Open exported BLP', filters: [{ name: 'BLP textures', extensions: ['blp'] }] });
    if (filePath) setImportedBlpPath(filePath);
  };

  // ── Herteken canvas op basis van base + strengthRef + targetColor ───────
  const repaint = useCallback((templateOverride) => {
    const base = baseRef.current;
    const strengthArr = strengthRef.current;
    const protectedArr = protectedRef.current;
    if (!base || !strengthArr || !canvasRef.current || loadedTextureKeyRef.current !== (importedBlpPath || blpPath)) return;
    if (restoreModeRef.current) return;
    const { w, h } = dimsRef.current;
    const outBase = new Uint8ClampedArray(base.data);
    let out = outBase;
    const paletteOriginal = paletteBaked && paletteOriginalRef.current?.width === w && paletteOriginalRef.current?.height === h ? paletteOriginalRef.current : null;
    if (paletteOriginal) for (let i = 0; i < w * h; i++) if (!strengthArr[i]) {
      const off = i * 4;
      out[off] = paletteOriginal.data[off]; out[off + 1] = paletteOriginal.data[off + 1]; out[off + 2] = paletteOriginal.data[off + 2]; out[off + 3] = paletteOriginal.data[off + 3];
    }

    for (let i = 0; i < w * h; i++) {
      const amount = respectProtection && protectedArr?.[i] ? 0 : strengthArr[i] * strength;
      if (amount <= 0) continue;
      const offset = i * 4;
      const [targetHue, targetSaturation, targetLightness] = hexToHsl(targetColor);
      const [, , sourceLightness] = rgbToHsl(out[offset], out[offset + 1], out[offset + 2]);
      if (targetLightness <= .02) {
        const blackLightness = preservePaintShading
          ? Math.max(.012, Math.min(.32, .018 + Math.pow(sourceLightness, .85) * .38))
          : 8 / 255;
        const [red, green, blue] = hslToRgb(targetHue, 0, blackLightness);
        out[offset] += (red - out[offset]) * amount;
        out[offset + 1] += (green - out[offset + 1]) * amount;
        out[offset + 2] += (blue - out[offset + 2]) * amount;
      } else {
        const outputLightness = preservePaintShading
          ? ((texturePartType === 'skin-extra' || texturePartType === 'hair')
            ? sourceLightness + (targetLightness - sourceLightness) * extraBrightnessMatch * amount
            : sourceLightness)
          : targetLightness;
        const [red, green, blue] = hslToRgb(targetHue, targetSaturation, outputLightness);
        out[offset] += (red - out[offset]) * amount;
        out[offset + 1] += (green - out[offset + 1]) * amount;
        out[offset + 2] += (blue - out[offset + 2]) * amount;
      }
    }

    const paletteBrushPixels = paletteBrushPixelsRef.current;
    const paletteBrushAmounts = paletteBrushAmountsRef.current;
    if (paletteBrushPixels && paletteBrushAmounts) for (let i = 0; i < w * h; i++) {
      const paletteIndex = paletteBrushPixels[i], amount = paletteBrushAmounts[i];
      if (paletteIndex < 0 || !amount || (respectProtection && protectedArr?.[i])) continue;
      const color = paletteBrushColors[paletteIndex];
      if (color) applyPaletteBrushPixel(out, i * 4, color, amount);
    }

    const ctx = canvasRef.current.getContext('2d');
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
    if (activeTab === 'preview') {
      setPreviewRgba({ data: new Uint8ClampedArray(out), width: w, height: h });
      const activeMask = Uint8Array.from(strengthArr, value => Math.round(value * 255));
      const previewPalettePasses = buildPaletteBrushPasses(paletteBrushPixelsRef.current, paletteBrushAmountsRef.current, paletteBrushColors, w, h, componentMappings);
      const passes = [...committedPasses, ...previewPalettePasses];
      if (!paletteBaked) passes.push({ mask: activeMask, targetColor, strength, preserveShading: preservePaintShading, mappings: componentMappings });
      setPreviewTransfer(passes.length ? { passes, width: w, height: h } : null);
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
  }, [targetColor, strength, preservePaintShading, extraBrightnessMatch, texturePartType, respectProtection, showProtection, showComponentMappings, componentMappings, semanticAnalysis, polygonVisibility, selectedVertex, paletteBaked, activeTab, committedPasses, paletteBrushColors, blpPath, importedBlpPath]);

  useEffect(() => {
    if (loading || error) return;
    if (restoreModeRef.current) return;
    repaint();
  }, [loading, error, repaint, maskRevision]);

  const pushHistory = useCallback(() => {
    if (!strengthRef.current || !protectedRef.current) return;
    historyRef.current.push({ strength: Float32Array.from(strengthRef.current), protected: Uint8Array.from(protectedRef.current), paletteBrushPixels: paletteBrushPixelsRef.current ? Int16Array.from(paletteBrushPixelsRef.current) : null, paletteBrushAmounts: paletteBrushAmountsRef.current ? Float32Array.from(paletteBrushAmountsRef.current) : null, polygonOverrides: JSON.parse(JSON.stringify(polygonOverrides)), customPolygons: JSON.parse(JSON.stringify(customPolygons)) });
    if (historyRef.current.length > 30) historyRef.current.shift();
    redoRef.current = [];
  }, [polygonOverrides, customPolygons]);

  const undoLast = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current.push({ strength: Float32Array.from(strengthRef.current), protected: Uint8Array.from(protectedRef.current), paletteBrushPixels: paletteBrushPixelsRef.current ? Int16Array.from(paletteBrushPixelsRef.current) : null, paletteBrushAmounts: paletteBrushAmountsRef.current ? Float32Array.from(paletteBrushAmountsRef.current) : null, polygonOverrides: JSON.parse(JSON.stringify(polygonOverrides)), customPolygons: JSON.parse(JSON.stringify(customPolygons)) });
    strengthRef.current = previous.strength; protectedRef.current = previous.protected;
    paletteBrushPixelsRef.current = previous.paletteBrushPixels ? Int16Array.from(previous.paletteBrushPixels) : null;
    paletteBrushAmountsRef.current = previous.paletteBrushAmounts ? Float32Array.from(previous.paletteBrushAmounts) : null;
    setPolygonOverrides(previous.polygonOverrides); setCustomPolygons(previous.customPolygons);
    const template = templateWithPolygonOverrides(templateBaseRef.current || semanticAnalysis?.template, previous.polygonOverrides, previous.customPolygons, labelOverrides);
    setSemanticAnalysis(current => current ? { ...current, template } : current);
    repaint();
    markSkinEdited();
  }, [semanticAnalysis, repaint, labelOverrides, markSkinEdited]);

  // ── Brush paint ───────────────────────────────────────────────────────
  const paintAt = useCallback((cx, cy) => {
    beginWorkingEdit();
    const { w, h } = dimsRef.current;
    const strengthArr = strengthRef.current;
    const protectedArr = protectedRef.current;
    if (!strengthArr) return;
    // Auto-fill / learned colour maps use a full-mask baked baseline. The
    // first manual stroke must turn that result into a normal editable base,
    // otherwise every pixel already has strength 1 and a touch-up appears to
    // do nothing.
    if (paletteBaked && (tool === 'paint' || tool === 'palette') && canvasRef.current) {
      baseRef.current = canvasRef.current.getContext('2d').getImageData(0, 0, w, h);
      strengthArr.fill(0);
      // The canvas already contains the baked palette result. Do not replay
      // an older per-pixel palette pass on top of that new baseline.
      paletteBrushPixelsRef.current?.fill(-1);
      paletteBrushAmountsRef.current?.fill(0);
      paletteOriginalRef.current = null;
      paletteProtectionRef.current = null;
      setPaletteBaked(false);
    }
    const r = brushSize;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const distance = brushShape === 'square' ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.hypot(dx, dy);
        if (distance > r) continue;
        const falloff = brushSoft ? Math.max(0, 1 - distance / r) : 1;
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
        if ((tool === 'paint' || tool === 'erase' || tool === 'palette') && respectProtection && (protectedArr?.[idx] || protectedByLayer)) continue;
        if (tool === 'paint') {
          // A direct paint stroke replaces the palette-brush result at this
          // pixel. Clear the older palette pass here, otherwise repaint()
          // applies the old fill after the new colour and the stroke looks
          // lighter/double-recoloured.
          if (paletteBrushAmountsRef.current) {
            paletteBrushAmountsRef.current[idx] = 0;
            if (paletteBrushPixelsRef.current) paletteBrushPixelsRef.current[idx] = -1;
          }
          strengthArr[idx] = Math.min(1, strengthArr[idx] + falloff * 0.35);
        } else if (tool === 'palette') {
          if (paletteBrushPixelsRef.current && paletteBrushAmountsRef.current) {
            paletteBrushPixelsRef.current[idx] = paletteBrushColorIndex;
            paletteBrushAmountsRef.current[idx] = Math.min(1, paletteBrushAmountsRef.current[idx] + falloff * 0.35);
          }
        } else if (tool === 'erase') {
          strengthArr[idx] = Math.max(0, strengthArr[idx] - falloff * 0.5);
          if (paletteBrushAmountsRef.current) paletteBrushAmountsRef.current[idx] = Math.max(0, paletteBrushAmountsRef.current[idx] - falloff * 0.5);
        } else if (tool === 'protect') {
          protectedArr[idx] = 1;
          strengthArr[idx] = 0;
        } else if (tool === 'unprotect') {
          protectedArr[idx] = 0;
        }
      }
    }
    repaint();
    markSkinEdited();
    bumpWorkspace();
  }, [beginWorkingEdit, brushSize, brushSoft, brushShape, tool, paletteBrushColorIndex, respectProtection, semanticAnalysis, polygonVisibility, repaint, paletteBaked, markSkinEdited, bumpWorkspace]);

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
    protectedRef.current = filterDisabledPolygonProtection(resolved.protectedMask, template, polygonVisibility, w, h);
    setSemanticAnalysis(prev => ({ ...prev, template }));
    setSemanticMasks(resolved.masks);
    repaint();
    markSkinEdited();
  }, [semanticAnalysis, repaint, labelOverrides, polygonVisibility, markSkinEdited]);

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
    historyRef.current.push({ strength: Float32Array.from(strengthRef.current), protected: Uint8Array.from(protectedRef.current), paletteBrushPixels: paletteBrushPixelsRef.current ? Int16Array.from(paletteBrushPixelsRef.current) : null, paletteBrushAmounts: paletteBrushAmountsRef.current ? Float32Array.from(paletteBrushAmountsRef.current) : null, polygonOverrides: JSON.parse(JSON.stringify(polygonOverrides)), customPolygons: JSON.parse(JSON.stringify(customPolygons)) });
    strengthRef.current = next.strength; protectedRef.current = next.protected;
    paletteBrushPixelsRef.current = next.paletteBrushPixels ? Int16Array.from(next.paletteBrushPixels) : null;
    paletteBrushAmountsRef.current = next.paletteBrushAmounts ? Float32Array.from(next.paletteBrushAmounts) : null;
    setPolygonOverrides(next.polygonOverrides); setCustomPolygons(next.customPolygons);
    const template = templateWithPolygonOverrides(templateBaseRef.current || semanticAnalysis?.template, next.polygonOverrides, next.customPolygons, labelOverrides);
    setSemanticAnalysis(current => current ? { ...current, template } : current); repaint();
    markSkinEdited();
  }, [semanticAnalysis, polygonOverrides, customPolygons, repaint, markSkinEdited]);

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

  const onPointerDown = (e) => { if (e.button === 1 || e.button === 2 || e.shiftKey) { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); panDragRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, pan }; return; } if (mappingPointerDown(e)) return; if (polygonEdit) { polygonPointerDown(e); return; } if (tool === 'eyedropper') { pickColourAt(...canvasToImageCoords(e)); return; } e.currentTarget.setPointerCapture?.(e.pointerId); pushHistory(); updateBrushCursor(e); drawingRef.current = true; paintAt(...canvasToImageCoords(e)); };
  const onPointerMove = (e) => { if (panDragRef.current) { const start = panDragRef.current; setPan({ x: start.pan.x + e.clientX - start.x, y: start.pan.y + e.clientY - start.y }); return; } if (mappingDragRef.current) { const [cx, cy] = canvasToImageCoords(e), { w, h } = dimsRef.current, drag = mappingDragRef.current; setComponentMappings(current => { const rect = current[mappingComponent]; return { ...current, [mappingComponent]: { ...rect, x: Math.max(0, Math.min(1 - rect.width, cx / w - drag.offsetX)), y: Math.max(0, Math.min(1 - rect.height, cy / h - drag.offsetY)) } }; }); return; } if (polygonEdit && polygonDragRef.current) { const [cx, cy] = canvasToImageCoords(e), { w, h } = dimsRef.current, drag = polygonDragRef.current; if (drag.polygon) { const point = [Math.max(0, Math.min(1, cx / w)), Math.max(0, Math.min(1, cy / h))]; const next = drag.index == null ? drag.startPolygon.map(([x, y]) => [Math.max(0, Math.min(1, x + point[0] - drag.origin[0])), Math.max(0, Math.min(1, y + point[1] - drag.origin[1]))]) : [...drag.polygon]; if (drag.index != null) next[drag.index] = point; drag.polygon = next; previewPolygon(drag.semantic, next); } return; } if (tool !== 'eyedropper') updateBrushCursor(e); if (drawingRef.current) paintAt(...canvasToImageCoords(e)); };
  const onPointerUp   = (e) => { drawingRef.current = false; mappingDragRef.current = null; finishPolygonDrag(); if (panDragRef.current?.pointerId === e.pointerId) panDragRef.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); };
  const onPointerLeave = () => { if (panDragRef.current) return; drawingRef.current = false; mappingDragRef.current = null; finishPolygonDrag(); setBrushCursor(null); };
  useEffect(() => {
    const canvasWrap = canvasWrapRef.current;
    if (!canvasWrap) return undefined;
    const onWheel = event => { event.preventDefault(); setZoom(value => Math.max(.5, Math.min(8, Number((value + (event.deltaY < 0 ? .15 : -.15)).toFixed(2))))); };
    canvasWrap.addEventListener('wheel', onWheel, { passive: false });
    return () => canvasWrap.removeEventListener('wheel', onWheel);
  }, []);

  const resetMask = () => {
    beginWorkingEdit();
    restoreModeRef.current = false;
    restoredFinalRef.current = null;
    setLoadedFromOutput(false);
    if (!strengthRef.current) return;
    strengthRef.current.fill(0);
    paletteBrushPixelsRef.current?.fill(-1);
    paletteBrushAmountsRef.current?.fill(0);
    paletteProtectionRef.current = null;
    setCommittedPasses([]);
    setPaletteBaked(false);
    setPalettePreview(null);
    paletteOriginalRef.current = null;
    const sessionKey = normalizeTexturePath(blpPath);
    const sessionBase = sessionBasePartsRef.current.get(sessionKey) || stagedPartsRef.current.get(sessionKey)?.sessionBaseRgba || originalBaseRef.current;
    if (sessionBase) {
      baseRef.current = cloneImageDataValue(sessionBase);
      const context = canvasRef.current?.getContext('2d');
      if (context) context.putImageData(baseRef.current, 0, 0);
      const existing = stagedPartsRef.current.get(sessionKey);
      stagedPartsRef.current.set(sessionKey, { ...(existing || {}), rgba: cloneImageDataValue(sessionBase), sessionBaseRgba: cloneImageDataValue(sessionBase), dirty: false, sessionBase: true });
    }
    repaint();
    markSkinEdited();
    bumpWorkspace();
  };

  const fillMask = () => {
    beginWorkingEdit();
    const base = baseRef.current, mask = strengthRef.current, protectedMask = protectedRef.current;
    if (!base || !mask) return;
    pushHistory();
    if (tool === 'palette' && paletteBrushPixelsRef.current && paletteBrushAmountsRef.current) {
      for (let i = 0; i < mask.length; i++) {
        if (base.data[i * 4 + 3] <= 12 || (respectProtection && protectedMask?.[i])) continue;
        paletteBrushPixelsRef.current[i] = paletteBrushColorIndex;
        paletteBrushAmountsRef.current[i] = 1;
      }
      repaint();
      markSkinEdited();
      bumpWorkspace();
      return;
    }
    for (let i = 0; i < mask.length; i++) {
      const editable = base.data[i * 4 + 3] > 12 && !(respectProtection && protectedMask?.[i]);
      mask[i] = editable ? 1 : 0;
      if (tool === 'paint' && editable && paletteBrushAmountsRef.current) {
        paletteBrushAmountsRef.current[i] = 0;
        if (paletteBrushPixelsRef.current) paletteBrushPixelsRef.current[i] = -1;
      }
    }
    repaint();
    markSkinEdited();
    bumpWorkspace();
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

  const buildCurrentComponentTransfer = (width, height) => {
    const activeMask = Uint8Array.from(strengthRef.current || [], value => Math.round(value * 255));
    const palettePasses = buildPaletteBrushPasses(paletteBrushPixelsRef.current, paletteBrushAmountsRef.current, paletteBrushColors, width, height, componentMappings);
    const persistedPasses = texturePartType === 'skin-atlas'
      ? stagedPartsRef.current.get(normalizeTexturePath(blpPath))?.transfer?.passes || []
      : [];
    const passes = [...persistedPasses, ...committedPasses, ...palettePasses];
    if (!paletteBaked) passes.push({ mask: activeMask, targetColor, strength, preserveShading: preservePaintShading, mappings: componentMappings });
    return passes.length ? { passes: cloneTransferPasses(passes), width, height } : null;
  };

  const stageCurrentTexturePart = () => {
    if (texturePartType === 'face' || texturePartType === 'face-group') {
      return stagedPartsRef.current.get(normalizeTexturePath(blpPath)) || null;
    }
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base || !strengthRef.current) return null;
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    if (texturePartType === 'face-group') {
      const layout = compositeLayoutRef.current;
      const snapshots = [];
      for (const rect of layout?.rects || []) {
        const part = rect.part;
        const cropped = cropImageDataValue(rgba, rect);
        const original = cropImageDataValue(originalBaseRef.current, rect);
        if (!cropped || !original) continue;
        const maskStrength = new Float32Array(rect.width * rect.height);
        const protectedMask = new Uint8Array(rect.width * rect.height);
        for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) {
          const sourceIndex = (rect.y + y) * canvas.width + rect.x + x;
          const targetIndex = y * rect.width + x;
          maskStrength[targetIndex] = strengthRef.current[sourceIndex] || 0;
          protectedMask[targetIndex] = protectedRef.current?.[sourceIndex] || 0;
        }
        const previous = stagedPartsRef.current.get(normalizeTexturePath(part.path));
        const preserveAutoLink = !!(previous?.autoLinked && imageDataEqual(cropped, previous.rgba));
        const snapshot = {
          rgba: cropped,
          sessionBaseRgba: previous?.sessionBaseRgba || sessionBasePartsRef.current.get(normalizeTexturePath(part.path)) || original,
          dirty: !imageDataEqual(cropped, original),
          ...(preserveAutoLink ? {
            autoLinked: true,
            syncSignature: previous.syncSignature,
            syncSourceRgba: cloneImageDataValue(previous.syncSourceRgba),
          } : {}),
          texturePartType: 'face',
          recoveryOriginal: null,
          componentMappings: JSON.parse(JSON.stringify(componentMappings)),
          maskStrength,
          protected: protectedMask,
          paletteBrushPixels: null,
          paletteBrushAmounts: null,
          paletteBrushColors: [...paletteBrushColors],
          paletteBrushColor,
          paletteBrushColorIndex,
          paletteOriginal: null,
          paletteProtection: null,
          extraColourMap: null,
          sourcePalette: null,
          committedPasses: [],
          paletteBaked: false,
          extraBrightnessMatch,
          extraPaletteSmoothness,
          preservePaintShading,
          respectProtection,
          palettePreview: null,
          skinTransferProfile: null,
          sourcePaletteInfo: null,
          targetColor,
          strength,
          baseExportMask: previous ? buildSnapshotMask(previous) : null,
          polygonOverrides: JSON.parse(JSON.stringify(polygonOverrides)),
          customPolygons: JSON.parse(JSON.stringify(customPolygons)),
          labelOverrides: JSON.parse(JSON.stringify(labelOverrides)),
          transfer: null,
        };
        stagedPartsRef.current.set(normalizeTexturePath(part.path), snapshot);
        snapshots.push(snapshot);
      }
      if (snapshots.length) {
        setStagedPreviewRevision(value => value + 1);
        bumpWorkspace();
      }
      return snapshots;
    }
    const transfer = buildCurrentComponentTransfer(canvas.width, canvas.height);
    const sessionKey = normalizeTexturePath(blpPath);
    const sessionBase = sessionBasePartsRef.current.get(sessionKey) || originalBaseRef.current;
    const snapshot = {
      rgba: cloneImageDataValue(rgba),
      sessionBaseRgba: sessionBase ? cloneImageDataValue(sessionBase) : null,
      dirty: !!sessionBase && !imageDataEqual(rgba, sessionBase),
      texturePartType,
      recoveryOriginal: cloneImageDataValue(recoveryOriginalRef.current),
      componentMappings: JSON.parse(JSON.stringify(componentMappings)),
      maskStrength: Float32Array.from(strengthRef.current),
      protected: protectedRef.current ? Uint8Array.from(protectedRef.current) : null,
      paletteBrushPixels: paletteBrushPixelsRef.current ? Int16Array.from(paletteBrushPixelsRef.current) : null,
      paletteBrushAmounts: paletteBrushAmountsRef.current ? Float32Array.from(paletteBrushAmountsRef.current) : null,
      paletteBrushColors: [...paletteBrushColors],
      paletteBrushColor,
      paletteBrushColorIndex,
      paletteOriginal: cloneImageDataValue(paletteOriginalRef.current),
      paletteProtection: paletteProtectionRef.current ? Uint8Array.from(paletteProtectionRef.current) : null,
      extraColourMap: extraColourMapRef.current ? extraColourMapRef.current.map(entry => ({ ...entry, source: [...entry.source], target: [...entry.target] })) : null,
      sourcePalette: sourcePaletteRef.current ? { ...sourcePaletteRef.current, palette: sourcePaletteRef.current.palette?.map(entry => [...entry]) } : null,
      committedPasses: cloneTransferPasses(committedPasses),
      paletteBaked,
      extraBrightnessMatch,
      extraPaletteSmoothness,
      preservePaintShading,
      respectProtection,
      palettePreview,
      skinTransferProfile,
      sourcePaletteInfo,
      targetColor,
      strength,
      baseExportMask: restoredFinalRef.current?.snapshot ? buildSnapshotMask(restoredFinalRef.current.snapshot) : null,
      polygonOverrides: JSON.parse(JSON.stringify(polygonOverrides)),
      customPolygons: JSON.parse(JSON.stringify(customPolygons)),
      labelOverrides: JSON.parse(JSON.stringify(labelOverrides)),
      transfer,
    };
    stagedPartsRef.current.set(sessionKey, snapshot);
    if (texturePartType === 'skin-atlas') setStagedAtlasPreview({ path: blpPath, rgba: snapshot.rgba, transfer, palette: palettePreview });
    setStagedPreviewRevision(value => value + 1);
    bumpWorkspace();
    return snapshot;
  };

  const stageLinkedFaceSnapshots = async () => {
    if (texturePartType !== 'skin-atlas' || !canvasRef.current) return;
    if (componentSessionPromiseRef.current) await componentSessionPromiseRef.current;
    const syncRevision = linkedFaceSyncRevisionRef.current;
    const canvas = canvasRef.current;
    const edited = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    // The immutable session base is the only baseline for editor transfers.
    // recoveryOriginal is still used by export metadata, but must not become
    // the source for a second in-session Face sync.
    const original = sessionBasePartsRef.current.get(normalizeTexturePath(blpPath)) || originalBaseRef.current;
    if (!original) return;
    if (original.width !== edited.width || original.height !== edited.height) return;
    // Linked components must use the Skin's semantic protection as a hard
    // boundary. A changed protected pixel is still protected for the linked
    // Face transfer; otherwise a later pass can overwrite eyes/teeth.
    const linkedSkinProtection = filterDisabledPolygonProtection(protectedRef.current, semanticAnalysis?.template, polygonVisibility, edited.width, edited.height) || null;
    const currentTransfer = buildCurrentComponentTransfer(edited.width, edited.height);
    const transferPasses = currentTransfer?.passes?.filter(pass => pass?.mask?.length === edited.width * edited.height && pass.targetColor && pass.mask.some(value => value > 0)) || [];
    const syncSignature = [
      edited.width,
      edited.height,
      hashBytes(edited.data),
      hashBytes(linkedSkinProtection),
      JSON.stringify(componentMappings),
      extraPaletteSmoothness,
    ].join('|');
    const faceParts = textureParts.flatMap(part => part.faceParts || []).filter(part => part.type === 'face');
    let changed = false;
    for (const part of faceParts) {
      if (syncRevision !== linkedFaceSyncRevisionRef.current) return;
      const key = normalizeTexturePath(part.path);
      const existing = stagedPartsRef.current.get(key);
      if (existing?.autoLinked && existing.syncSignature === syncSignature) continue;
      if (existing?.dirty && !existing.autoLinked) continue;
      const sourcePath = part.sourcePath || part.path;
      const syncSource = original;
      const changedMask = buildTextureDeltaMask(original, edited);
      const changedProtection = linkedSkinProtection;
      let image = sessionBasePartsRef.current.get(normalizeTexturePath(key)) || existing?.sessionBaseRgba || null;
      if (!image) {
        const result = await window.azeroth.dbc.readBlpTexture(dataPath, sourcePath, modelVariantArchivePath);
        if (!result?.success || !result.png) continue;
        image = await pngToImageData(result.png);
        sessionBasePartsRef.current.set(normalizeTexturePath(key), cloneImageDataValue(image));
      }
      const analysis = textureClassifier.classify({ path: sourcePath, width: image.width, height: image.height, rgba: new Uint8Array(image.data), textureType: 'face' });
      const correction = analysis.template && templateCorrectionStore.list(analysis.template.id, analysis.template.version).find(item => item.width === image.width && item.height === image.height && item.protectedMask);
      const localProtection = correction
        ? filterDisabledPolygonProtection(base64ToBytes(correction.protectedMask), analysis.template, polygonVisibility, image.width, image.height)
        : null;
      const rect = componentMappings[part.region];
      const componentPasses = transferPasses
        .map(pass => ({ ...pass, rect: pass.mappings?.[part.region] || pass.rect || rect }))
        .filter(pass => pass.rect);
      const atlasRect = rect ? {
        x: Math.max(0, Math.min(edited.width - 1, Math.round(rect.x * edited.width))),
        y: Math.max(0, Math.min(edited.height - 1, Math.round(rect.y * edited.height))),
        width: Math.max(1, Math.min(edited.width, Math.round(rect.width * edited.width))),
        height: Math.max(1, Math.min(edited.height, Math.round(rect.height * edited.height))),
      } : null;
      const skinPassCoverage = componentPasses.length
        ? buildPassCoverage(componentPasses, edited.width, edited.height)
        : null;
      const sourceComponent = atlasRect ? cropImageDataValue(syncSource, atlasRect) : null;
      const editedComponent = atlasRect ? cropImageDataValue(edited, atlasRect) : null;
      const componentProtection = atlasRect
        ? mergeProtectionMasks(
          cropMaskValue(buildUnchangedMask(changedMask, changedProtection), edited.width, atlasRect),
          cropMaskValue(skinPassCoverage, edited.width, atlasRect),
        )
        : buildUnchangedMask(changedMask, changedProtection);
      const colourMap = sourceComponent && editedComponent
        ? buildColourMap(sourceComponent, editedComponent, componentProtection)
        : buildColourMap(syncSource, edited, mergeProtectionMasks(buildUnchangedMask(changedMask, changedProtection), skinPassCoverage));
      const atlasProtection = rect && changedProtection
        ? componentTransferService.projectMask(changedProtection, edited.width, edited.height, rect, image.width, image.height)
        : null;
      const protectedMask = mergeProtectionMasks(atlasProtection, localProtection);
      const projectedFacePassCoverage = projectPassCoverage(componentPasses, edited.width, edited.height, rect, image.width, image.height);
      const facePassCoverage = projectedFacePassCoverage
        ? Uint8Array.from(projectedFacePassCoverage, value => value > 0 ? 0 : 255)
        : null;
      // Rebuild from the immutable Face base. The general Skin colour map is
      // applied only outside explicit paint-pass areas, preserving Face
      // shading. Explicit passes then override their own projected pixels.
      let mapped = cloneImageDataValue(image);
      let hasTransferWork = false;
      if (colourMap.length >= 4) {
        mapped = applyColourMap(mapped, colourMap, protectedMask, 1, extraPaletteSmoothness, facePassCoverage);
        hasTransferWork = true;
      }
      if (componentPasses.length) {
        mapped = applyComponentPasses(mapped, componentPasses, edited.width, edited.height, rect, protectedMask);
        hasTransferWork = true;
      }
      if (!hasTransferWork && colourMap.length) {
        mapped = applyColourMap(mapped, colourMap, protectedMask, 1, extraPaletteSmoothness);
        hasTransferWork = true;
      }
      if (!hasTransferWork) {
        if (existing?.autoLinked) {
          stagedPartsRef.current.set(key, {
            ...existing,
            rgba: mapped,
            dirty: false,
            syncSignature,
            syncSourceRgba: cloneImageDataValue(edited),
            sessionBaseRgba: existing.sessionBaseRgba || sessionBasePartsRef.current.get(normalizeTexturePath(key)) || cloneImageDataValue(image),
            sessionBase: true,
          });
          changed = true;
        }
        continue;
      }
      if (syncRevision !== linkedFaceSyncRevisionRef.current) return;
      const mask = new Uint8Array(image.width * image.height);
      for (let i = 0; i < mask.length; i++) if (image.data[i * 4 + 3] > 12 && !protectedMask?.[i]) mask[i] = 255;
      stagedPartsRef.current.set(key, {
        rgba: mapped,
        sessionBaseRgba: existing?.sessionBaseRgba || sessionBasePartsRef.current.get(normalizeTexturePath(key)) || cloneImageDataValue(image),
        dirty: true,
        autoLinked: true,
        texturePartType: 'face',
        componentMappings: {},
        maskStrength: Float32Array.from(mask, value => value / 255),
        protected: protectedMask,
        baseExportMask: mask,
        paletteBrushPixels: null,
        paletteBrushAmounts: null,
        paletteBrushColors: [],
        paletteBrushColor: '#000000',
        paletteBrushColorIndex: 0,
        paletteOriginal: null,
        paletteProtection: null,
        extraColourMap: colourMap,
        sourcePalette: null,
        committedPasses: [],
        paletteBaked: true,
        extraBrightnessMatch,
        extraPaletteSmoothness,
        preservePaintShading,
        respectProtection,
        palettePreview: null,
        skinTransferProfile: { source: `Skin → linked ${part.region || 'Face'}`, samples: colourMap.reduce((total, entry) => total + entry.count, 0) },
        sourcePaletteInfo: null,
        targetColor,
        strength: 1,
        polygonOverrides: {},
        customPolygons: [],
        labelOverrides: {},
        transfer: null,
        syncSignature,
        syncSourceRgba: cloneImageDataValue(edited),
      });
      changed = true;
    }
    if (changed) setStagedPreviewRevision(value => value + 1);
  };

  const stageComponentSessionBases = useCallback(async () => {
    const componentParts = textureParts.flatMap(part => part.faceParts || [part]).filter(part => ['skin-atlas', 'face', 'skin-extra', 'hair'].includes(part.type));
    if (!componentParts.length || !dataPath) {
      return;
    }
    const sessionKey = [modelVariantArchivePath, ...componentParts.map(part => `${part.path}|${part.sourcePath || part.path}`)].join('::').toLowerCase();
    if (componentSessionKeyRef.current === sessionKey) {
      return;
    }
    const generation = ++componentSessionGenerationRef.current;
    const loaded = await Promise.all(componentParts.map(async part => {
      const key = normalizeTexturePath(part.path);
      const existing = stagedPartsRef.current.get(key);
      if (existing?.dirty || sessionBasePartsRef.current.has(key)) return null;
      const result = preferOutput && window.azeroth.dbc.readOutputBlpTexture
        ? await window.azeroth.dbc.readOutputBlpTexture(part.path).then(value => value?.success ? value : window.azeroth.dbc.readBlpTexture(dataPath, part.sourcePath || part.path, modelVariantArchivePath))
        : await window.azeroth.dbc.readBlpTexture(dataPath, part.sourcePath || part.path, modelVariantArchivePath);
      if (!result?.success || !result.png) return null;
      return { key, rgba: await pngToImageData(result.png) };
    }));
    let changed = false;
    for (const item of loaded) {
      if (!item) continue;
      if (generation !== componentSessionGenerationRef.current) return;
      if (stagedPartsRef.current.get(item.key)?.dirty) continue;
      const sessionBase = cloneImageDataValue(item.rgba);
      sessionBasePartsRef.current.set(item.key, sessionBase);
      stagedPartsRef.current.set(item.key, {
        rgba: cloneImageDataValue(item.rgba),
        sessionBaseRgba: sessionBase,
        dirty: false,
        sessionBase: true,
        texturePartType: componentParts.find(part => String(part.path).toLowerCase() === item.key)?.type || 'component',
      });
      changed = true;
    }
    componentSessionKeyRef.current = sessionKey;
    if (changed) setStagedPreviewRevision(value => value + 1);
  }, [dataPath, modelVariantArchivePath, preferOutput, textureParts]);

  useEffect(() => {
    const promise = stageComponentSessionBases().catch(() => {});
    componentSessionPromiseRef.current = promise;
    return () => {
      if (componentSessionPromiseRef.current === promise) componentSessionPromiseRef.current = null;
    };
  }, [stageComponentSessionBases]);

  linkedFaceSyncRunnerRef.current = () => {
    if (linkedFaceSyncTimerRef.current) clearTimeout(linkedFaceSyncTimerRef.current);
    linkedFaceSyncTimerRef.current = setTimeout(async () => {
      linkedFaceSyncTimerRef.current = null;
      if (linkedFaceSyncInFlightRef.current) {
        linkedFaceSyncPendingRef.current = true;
        return;
      }
      linkedFaceSyncInFlightRef.current = true;
      const syncPromise = stageLinkedFaceSnapshots();
      linkedFaceSyncPromiseRef.current = syncPromise;
      try {
        await syncPromise;
      } finally {
        if (linkedFaceSyncPromiseRef.current === syncPromise) linkedFaceSyncPromiseRef.current = null;
        linkedFaceSyncInFlightRef.current = false;
        if (linkedFaceSyncPendingRef.current) {
          linkedFaceSyncPendingRef.current = false;
          linkedFaceSyncRunnerRef.current?.();
        }
      }
    }, 2000);
  };

  useEffect(() => () => {
    if (linkedFaceSyncTimerRef.current) clearTimeout(linkedFaceSyncTimerRef.current);
  }, []);

  const selectTexturePart = async (path) => {
    // Faces are derived, read-only views of the Skin transfer. Staging a
    // generated Face snapshot here would mark it as a manual dirty edit and
    // make the next Skin sync skip that Face permanently.
    if (texturePartType !== 'face' && texturePartType !== 'face-group') stageCurrentTexturePart();
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
    if (texturePartType === 'skin-atlas') {
      if (linkedFaceSyncTimerRef.current) clearTimeout(linkedFaceSyncTimerRef.current);
      linkedFaceSyncTimerRef.current = null;
      await stageLinkedFaceSnapshots();
    }
    // Mark the old canvas as loading before the parent swaps BLP props. This
    // prevents the pending profile from being applied to the previous Skin.
    setLoading(true);
    onSelectTexturePart?.(path);
  };

  const flushLinkedSkinSync = async () => {
    if (texturePartType !== 'skin-atlas') return;
    if (linkedFaceSyncTimerRef.current) clearTimeout(linkedFaceSyncTimerRef.current);
    linkedFaceSyncTimerRef.current = null;
    linkedFaceSyncPendingRef.current = false;
    if (linkedFaceSyncPromiseRef.current) await linkedFaceSyncPromiseRef.current;
    await stageLinkedFaceSnapshots();
  };

  const loadLinkedSkinProfile = async () => {
    if (sourceSkinPath && outputSkinPath) {
      const [sourceResult, outputResult] = await Promise.all([
        window.azeroth.dbc.readBlpTexture(dataPath, sourceSkinPath, modelVariantArchivePath),
        window.azeroth?.dbc?.readOutputBlpTexture ? window.azeroth.dbc.readOutputBlpTexture(outputSkinPath) : window.azeroth.dbc.readBlpTexture(dataPath, outputSkinPath, modelVariantArchivePath),
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
    const result = output?.success ? output : await window.azeroth.dbc.readBlpTexture(dataPath, skinPath, modelVariantArchivePath);
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
        window.azeroth.dbc.readBlpTexture(dataPath, sourceSkinPath, modelVariantArchivePath),
        window.azeroth?.dbc?.readOutputBlpTexture
          ? window.azeroth.dbc.readOutputBlpTexture(outputSkinPath)
          : window.azeroth.dbc.readBlpTexture(dataPath, outputSkinPath, modelVariantArchivePath),
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
      const map = buildColourMap(sourceImage, outputImage, protectedMask);
      return map.length >= 12 ? map : null;
    } catch {
      return null;
    }
  };

  const applyHairColourTransfer = async () => {
    beginWorkingEdit();
    const sourcePath = sourceBlpPath || blpPath;
    const targetPath = selectedHairColourRow?.tex1;
    if (!sourcePath || !targetPath || !baseRef.current || !strengthRef.current) return;
    setTemplateSaveMsg(null);
    const [sourceResult, targetResult] = await Promise.all([
      window.azeroth.dbc.readBlpTexture(dataPath, sourcePath, modelVariantArchivePath),
      preferOutput && window.azeroth?.dbc?.readOutputBlpTexture
        ? window.azeroth.dbc.readOutputBlpTexture(targetPath).then(output => output?.success ? output : window.azeroth.dbc.readBlpTexture(dataPath, targetPath, modelVariantArchivePath))
        : window.azeroth.dbc.readBlpTexture(dataPath, targetPath, modelVariantArchivePath),
    ]);
    if (!sourceResult?.success || !sourceResult.png || !targetResult?.success || !targetResult.png) {
      setTemplateSaveMsg(`Could not load the Hair colour ${hairTargetColorIndex} source or target BLP.`);
      return;
    }
    const [sourceImage, targetImage] = await Promise.all([pngToImageData(sourceResult.png), pngToImageData(targetResult.png)]);
    if (sourceImage.width !== targetImage.width || sourceImage.height !== targetImage.height) {
      setTemplateSaveMsg('The selected Hair colours use different texture dimensions and cannot share a colour map.');
      return;
    }
    const colourMap = buildColourMap(sourceImage, targetImage);
    if (colourMap.length < 4) {
      setTemplateSaveMsg('The selected Hair colours did not contain a reliable colour transform.');
      return;
    }
    pushHistory();
    const base = baseRef.current;
    const protectedMask = respectProtection ? protectedRef.current : null;
    paletteOriginalRef.current = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    extraColourMapRef.current = colourMap;
    baseRef.current = applyColourMap(base, colourMap, protectedMask, extraBrightnessMatch, extraPaletteSmoothness);
    for (let i = 0; i < strengthRef.current.length; i++) strengthRef.current[i] = base.data[i * 4 + 3] > 12 && !protectedMask?.[i] ? 1 : 0;
    paletteProtectionRef.current = Uint8Array.from(protectedMask || new Uint8Array(base.width * base.height));
    setStrength(0);
    setPaletteBaked(true);
    setSkinTransferProfile({ source: `Hair colour ${colorIndex} → ${hairTargetColorIndex}`, samples: colourMap.reduce((total, entry) => total + entry.count, 0) });
    setMaskRevision(value => value + 1);
    setTemplateSaveMsg(`Applied Hair colour ${hairTargetColorIndex} while preserving the current Hair texture detail.`);
  };

  const applySkinColourTransfer = async () => {
    beginWorkingEdit();
    const colourMap = await loadLinkedSkinColourMap();
    if (colourMap && baseRef.current && strengthRef.current) {
      pushHistory();
      const base = baseRef.current;
      const protectedMask = respectProtection ? protectedRef.current : null;
      paletteOriginalRef.current = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
      extraColourMapRef.current = colourMap;
      baseRef.current = applyColourMap(base, colourMap, protectedMask, extraBrightnessMatch, extraPaletteSmoothness);
      for (let i = 0; i < strengthRef.current.length; i++) {
        strengthRef.current[i] = base.data[i * 4 + 3] > 12 && !protectedMask?.[i] ? 1 : 0;
      }
      paletteProtectionRef.current = Uint8Array.from(protectedMask || new Uint8Array(base.width * base.height));
      setStrength(0);
      setPaletteBaked(true);
      setSkinTransferProfile({ source: `Colour ${sourceColorIndex} → Colour ${colorIndex} pixel map`, samples: colourMap.reduce((total, entry) => total + entry.count, 0) });
      setMaskRevision(value => value + 1);
      setTemplateSaveMsg(`Applied the learned Colour ${sourceColorIndex} → ${colorIndex} transform to Skin Extra (${colourMap.length} colour clusters).`);
      return;
    }
    extraColourMapRef.current = null;
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
    beginWorkingEdit();
    if (!selectedSourceSkin?.tex1 || !baseRef.current || !strengthRef.current) return;
    setTemplateSaveMsg(null);
    const output = preferOutput && window.azeroth?.dbc?.readOutputBlpTexture
      ? await window.azeroth.dbc.readOutputBlpTexture(selectedSourceSkin.tex1)
      : null;
    const sourceArchivePath = sourceRace === 12 ? modelVariantArchivePath : '';
    const result = output?.success ? output : await window.azeroth.dbc.readBlpTexture(dataPath, selectedSourceSkin.tex1, sourceArchivePath);
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
    const effectiveProtection = respectProtection ? transferProtection : new Uint8Array(transferProtection.length);
    const previousProtection = paletteProtectionRef.current;
    const paletteAlreadyApplied = paletteBaked
      && paletteOriginalRef.current?.width === base.width
      && paletteOriginalRef.current?.height === base.height
      && sourcePaletteRef.current?.sourceId === selectedSourceSkin.id;
    const baseline = paletteAlreadyApplied ? paletteOriginalRef.current : base;
    const baselineCopy = new ImageData(new Uint8ClampedArray(baseline.data), baseline.width, baseline.height);
    const transferSettings = {
      paletteInfluence,
      textureDetailStrength,
      shadowDepth,
      sourceLightnessRange: getPaletteLightnessRange(baseline, effectiveProtection),
    };
    const remapped = remapImageWithPalette(baselineCopy, palette, effectiveProtection, transferSettings);
    const nextBase = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    const nextStrength = Float32Array.from(strengthRef.current);
    const sameProtectionSize = previousProtection?.length === effectiveProtection.length && paletteAlreadyApplied;
    for (let i = 0; i < nextStrength.length; i++) {
      const editable = base.data[i * 4 + 3] > 12 && !effectiveProtection[i];
      const wasProtected = sameProtectionSize ? !!previousProtection[i] : false;
      const isProtected = !!effectiveProtection[i];
      if (!editable || (!wasProtected && isProtected)) {
        const offset = i * 4;
        nextBase.data[offset] = baselineCopy.data[offset];
        nextBase.data[offset + 1] = baselineCopy.data[offset + 1];
        nextBase.data[offset + 2] = baselineCopy.data[offset + 2];
        nextBase.data[offset + 3] = baselineCopy.data[offset + 3];
        nextStrength[i] = 0;
      } else if (!sameProtectionSize || (wasProtected && !isProtected)) {
        const offset = i * 4;
        nextBase.data[offset] = remapped.data[offset];
        nextBase.data[offset + 1] = remapped.data[offset + 1];
        nextBase.data[offset + 2] = remapped.data[offset + 2];
        nextBase.data[offset + 3] = remapped.data[offset + 3];
        nextStrength[i] = 1;
      }
    }
    paletteOriginalRef.current = baselineCopy;
    paletteProtectionRef.current = Uint8Array.from(effectiveProtection);
    baseRef.current = nextBase;
    setStrength(0); // The palette is baked into the temporary canvas base; the mask remains exportable.
    setPaletteBaked(true);
    sourcePaletteRef.current = { sourceId: selectedSourceSkin.id, palette };
    const nextColours = [...paletteBrushColorsRef.current, ...palette.map(([h, s, l]) => hslToHex(h, s, l))].filter((colour, index, all) => all.findIndex(item => item.toLowerCase() === colour.toLowerCase()) === index);
    paletteBrushColorsRef.current = nextColours;
    setPaletteBrushColors(nextColours);
    if (texturePartType === 'skin-atlas') setPalettePreview({ palette, protectedMask: Uint8Array.from(effectiveProtection), width: base.width, height: base.height, mappings: componentMappings, transferSettings });
    setSourcePaletteInfo(palette.map(([h, s, l]) => hslToHex(h, s, l)));
    setMaskRevision(value => value + 1);
    markSkinEdited();
    setTemplateSaveMsg(`Applied ${SOURCE_RACES.find(([id]) => id === sourceRace)?.[1] || 'source'} body palette to editable body pixels.`);
  };

  const changeTargetColor = nextColor => {
    beginWorkingEdit();
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
      paletteProtectionRef.current = null;
      setPaletteBaked(false);
    }
    paletteBrushPixelsRef.current?.fill(-1);
    paletteBrushAmountsRef.current?.fill(0);
    setTargetColor(nextColor);
    markSkinEdited();
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
    markSkinEdited();
  };

  const buildSnapshotMask = snapshot => {
    const rgba = snapshot.rgba, length = rgba.width * rgba.height, mask = new Uint8Array(length);
    if (snapshot.baseExportMask?.length === length) mask.set(snapshot.baseExportMask);
    for (const pass of snapshot.committedPasses || []) if (pass.mask && pass.mask.length === length) for (let i = 0; i < length; i++) if (pass.mask[i]) mask[i] = pass.mask[i];
    if (snapshot.recoveryOriginal) for (let i = 0; i < length; i++) mask[i] = rgba.data[i * 4 + 3] > 12 ? 255 : 0;
    else if (snapshot.maskStrength) for (let i = 0; i < length; i++) mask[i] = Math.max(mask[i], Math.round(snapshot.maskStrength[i] * 255));
    if (snapshot.paletteBrushAmounts) for (let i = 0; i < length; i++) if (!snapshot.respectProtection || !snapshot.protected?.[i]) mask[i] = Math.max(mask[i], Math.round(snapshot.paletteBrushAmounts[i] * 255));
    if (snapshot.paletteBaked && snapshot.paletteProtection) for (let i = 0; i < length; i++) if (!snapshot.respectProtection || !snapshot.paletteProtection[i]) mask[i] = rgba.data[i * 4 + 3] > 12 ? 255 : mask[i];
    return mask;
  };

  const writeStagedTexturePart = async (part, snapshot) => {
    if (!part?.path || !snapshot?.rgba) return null;
    const baseName = part.path.replace(/\\/g, '/').split('/').pop().replace(/\.blp$/i, '');
    const dirName = part.path.replace(/\\/g, '/').split('/').slice(0, -1).join('\\');
    const outRelPath = part.outputPath || ((dirName ? `${dirName}\\` : '') + `${baseName}_custom${Date.now()}.blp`);
    const rgbaBase64 = bytesToBase64(new Uint8Array(snapshot.rgba.data));
    const maskBase64 = bytesToBase64(buildSnapshotMask(snapshot));
    const result = await window.azeroth.dbc.writeBlpTextureEdit(dataPath, part.writeSourcePath || part.sourcePath || part.path, rgbaBase64, maskBase64, outRelPath, true, false, modelVariantArchivePath);
    if (!result?.success) return null;
    const componentTransfer = snapshot.texturePartType === 'skin-atlas' && snapshot.recoveryOriginal
      ? buildComponentColourMaps(snapshot.recoveryOriginal, snapshot.rgba, snapshot.protected, snapshot.componentMappings)
      : null;
    const snapshotPalettePasses = buildPaletteBrushPasses(
      snapshot.paletteBrushPixels,
      snapshot.paletteBrushAmounts,
      snapshot.paletteBrushColors || [],
      snapshot.rgba.width,
      snapshot.rgba.height,
      snapshot.componentMappings,
    );
    const snapshotActivePass = snapshot.maskStrength?.some(value => value > 0)
      ? {
        mask: Uint8Array.from(snapshot.maskStrength, value => Math.round(value * 255)),
        targetColor: snapshot.targetColor,
        strength: snapshot.strength,
        preserveShading: snapshot.preservePaintShading,
        mappings: snapshot.componentMappings,
      }
      : null;
        const snapshotTransferPasses = [...(snapshot.committedPasses || []), ...snapshotPalettePasses, ...(snapshotActivePass ? [snapshotActivePass] : [])];
    const usedPaletteColors = [...new Set(snapshotTransferPasses.map(pass => pass?.targetColor).filter(Boolean))];
    const recoveryTransfer = snapshot.texturePartType === 'skin-atlas' && snapshot.recoveryOriginal ? {
      originalBase64: bytesToBase64(new Uint8Array(snapshot.recoveryOriginal.data)),
      editedBase64: rgbaBase64,
      width: snapshot.rgba.width,
      height: snapshot.rgba.height,
      colourMap: componentTransfer?.maps?.['skin-atlas'] || buildColourMap(snapshot.recoveryOriginal, snapshot.rgba, snapshot.protected),
      componentColourMaps: componentTransfer?.maps || {},
      mode: snapshot.paletteBaked || snapshot.paletteBrushAmounts?.some(value => value > 0) ? 'palette' : 'flat',
      passes: snapshotTransferPasses,
      paletteColors: usedPaletteColors,
      preservePaintShading: snapshot.preservePaintShading,
      brightnessMatch: snapshot.extraBrightnessMatch,
      paletteSmoothness: snapshot.extraPaletteSmoothness,
      atlasProtectionBase64: snapshot.protected
        ? bytesToBase64(componentTransfer?.protection || snapshot.protected)
        : null,
      atlasWidth: snapshot.rgba.width,
      atlasHeight: snapshot.rgba.height,
    } : null;
    return { path: result.path, sourcePath: part.path, rowId: part.recordId, field: part.field, baseSection: part.baseSection, type: part.type, componentMappings: snapshot.componentMappings, recoveryTransfer };
  };

  // ── Opslaan ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Capture the active workspace component before exporting. This is
      // important when Hair or Skin Extra was painted and Save is clicked
      // before another workspace tile is selected.
      if (texturePartType !== 'face' && texturePartType !== 'face-group') {
        stageCurrentTexturePart();
      }
      await flushLinkedSkinSync();
    } catch (error) {
      setSaveError(error?.message || 'Linked texture sync failed before save.');
      setSaving(false);
      return;
    }
    const { w, h } = dimsRef.current;
    const strengthArr = strengthRef.current;
    const recoveryOriginal = recoveryOriginalRef.current;
    const hasRecovery = recoveryOriginal?.width === w && recoveryOriginal?.height === h;
    const hasCommittedPass = committedPasses.some(pass => pass.mask?.some(value => value > 0));
    const hasPaletteBrush = paletteBrushAmountsRef.current?.some(value => value > 0);
    const hasPaletteBaked = paletteBaked && paletteProtectionRef.current;
    const restoredSnapshot = restoredFinalRef.current?.snapshot;
    const hasRestoredFinal = restoredSnapshot?.dirty && restoredSnapshot.rgba?.width === w && restoredSnapshot.rgba?.height === h;
    const hasDirtyStagedPart = [...stagedPartsRef.current.values()].some(snapshot => snapshot?.dirty);
    if (!strengthArr || (strengthArr.every(v => v === 0) && !hasCommittedPass && !hasRecovery && !hasPaletteBrush && !hasPaletteBaked && !hasRestoredFinal && !hasDirtyStagedPart)) {
      setSaveError('Paint an area first — there are no changes to save.');
      setSaving(false);
      return;
    }

    const ctx = canvasRef.current.getContext('2d');
    const finalRgba = ctx.getImageData(0, 0, w, h).data; // Uint8ClampedArray, bevat al de preview-recolor
    const maskBytes = new Uint8Array(w * h);
    if (hasRestoredFinal) maskBytes.set(buildSnapshotMask(restoredSnapshot));
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
    if (paletteBrushAmountsRef.current) for (let i = 0; i < maskBytes.length; i++) {
      if (!respectProtection || !protectedRef.current?.[i]) maskBytes[i] = Math.max(maskBytes[i], Math.round(paletteBrushAmountsRef.current[i] * 255));
    }
    if (hasPaletteBaked) for (let i = 0; i < maskBytes.length; i++) {
      if (!respectProtection || !paletteProtectionRef.current[i]) maskBytes[i] = finalRgba[i * 4 + 3] > 12 ? 255 : maskBytes[i];
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

    if (texturePartType === 'face-group') {
      const group = textureParts.find(part => String(part.path).toLowerCase() === String(blpPath).toLowerCase());
      const layout = compositeLayoutRef.current;
      const finalImage = new ImageData(new Uint8ClampedArray(finalRgba), w, h);
      const exports = [];
      for (const rect of layout?.rects || []) {
        const part = group?.faceParts?.find(item => String(item.path).toLowerCase() === String(rect.part.path).toLowerCase()) || rect.part;
        const rgba = cropImageDataValue(finalImage, rect);
        const childMask = new Uint8Array(rect.width * rect.height);
        for (let y = 0; y < rect.height; y++) childMask.set(maskBytes.subarray((rect.y + y) * w + rect.x, (rect.y + y) * w + rect.x + rect.width), y * rect.width);
        const childBase64 = toBase64(new Uint8Array(rgba.data));
        const childMaskBase64 = toBase64(childMask);
        const baseName = part.path.replace(/\\/g, '/').split('/').pop().replace(/\.blp$/i, '');
        const dirName = part.path.replace(/\\/g, '/').split('/').slice(0, -1).join('\\');
        const outRelPath = part.outputPath || ((dirName ? `${dirName}\\` : '') + `${baseName}_custom${Date.now()}.blp`);
        const result = await window.azeroth.dbc.writeBlpTextureEdit(dataPath, part.writeSourcePath || part.sourcePath || part.path, childBase64, childMaskBase64, outRelPath, true, false, modelVariantArchivePath);
        if (!result?.success) {
          setSaveError(result?.error || `Could not save ${part.label || 'Face texture'}`);
          return;
        }
        exports.push({ path: result.path, sourcePath: part.path, rowId: part.recordId, field: part.field, baseSection: 1, type: 'face', componentMappings });
      }
      if (!exports.length) {
        setSaveError('No Face textures were available to save.');
        return;
      }
      const currentPaths = new Set((group?.faceParts || []).map(item => normalizeTexturePath(item.path)));
      for (const [stagedPath, snapshot] of stagedPartsRef.current) {
        if (currentPaths.has(stagedPath) || !snapshot?.dirty) continue;
        const part = findTexturePartByPath(textureParts, stagedPath);
        if (!part) {
          setSaveError(`Could not resolve staged texture ${stagedPath} for export.`);
          return;
        }
        const stagedExport = await writeStagedTexturePart(part, snapshot);
        if (!stagedExport) {
          setSaveError(`Could not save staged texture ${part.label || part.path}.`);
          return;
        }
        exports.push(stagedExport);
      }
      const registration = await onSaved?.({ path: exports[0].path, exports, saveMode, targetSetFlags, targetColor, strength, sourceMaskBase64: maskBase64, sourceWidth: w, sourceHeight: h, componentMappings, componentPasses: [], recoveryTransfer: null });
      if (registration?.success === false) setSaveError(`Face textures staged, but the colour set was not registered: ${registration.error}`);
      return;
    }

    const baseName = blpPath.replace(/\\/g, '/').split('/').pop().replace(/\.blp$/i, '');
    const dirName  = blpPath.replace(/\\/g, '/').split('/').slice(0, -1).join('\\');
    const outRelPath = outputPath || ((dirName ? dirName + '\\' : '') + `${baseName}_custom${Date.now()}.blp`);

    try {
      // Derived colour sets are loaded from their staged BLP, but encoding
      // still needs the original client BLP header/compression source.
      const res = await window.azeroth.dbc.writeBlpTextureEdit(dataPath, writeSourceBlpPath || sourceBlpPath || blpPath, editedRgbaBase64, maskBase64, outRelPath, true, false, modelVariantArchivePath);
      if (res?.success) {
        const effectiveProtectedMask = filterDisabledPolygonProtection(protectedRef.current, semanticAnalysis?.template, polygonVisibility, w, h);
        if (saveAsTemplateCorrection && semanticAnalysis?.template && effectiveProtectedMask) {
          templateCorrectionStore.save({
            id: `${semanticAnalysis.template.id}:protected-details`, templateId: semanticAnalysis.template.id, templateVersion: semanticAnalysis.template.version,
            width: w, height: h, protectedMask: bytesToBase64(effectiveProtectedMask), semantic: 'protected-details',
            polygonOverrides,
            customPolygons,
            labelOverrides,
          });
        }
        const palettePasses = buildPaletteBrushPasses(paletteBrushPixelsRef.current, paletteBrushAmountsRef.current, paletteBrushColors, w, h, componentMappings);
        const activePass = { mask: Uint8Array.from(strengthRef.current, value => Math.round(value * 255)), targetColor, strength, mappings: componentMappings };
        const paletteMode = !!(hasPaletteBaked || hasPaletteBrush);
        // Keep every committed and palette pass. The linked face/extra
        // exporters use these masks to reproduce the final painted atlas;
        // reducing palette mode to one colour map loses local accents.
        const transferPasses = [...committedPasses, ...palettePasses, ...(activePass.mask.some(value => value > 0) ? [activePass] : [])];
        const usedPaletteColors = [...new Set(transferPasses.map(pass => pass?.targetColor).filter(Boolean))];
        const componentTransfer = hasRecovery
          ? buildComponentColourMaps(recoveryOriginal, new ImageData(new Uint8ClampedArray(finalRgba), w, h), effectiveProtectedMask, componentMappings)
          : null;
        const recoveryTransfer = hasRecovery ? {
          originalBase64: toBase64(new Uint8Array(recoveryOriginal.data.buffer.slice(0))),
          editedBase64: editedRgbaBase64,
          width: w,
          height: h,
          colourMap: componentTransfer?.maps?.['skin-atlas'] || buildColourMap(recoveryOriginal, new ImageData(new Uint8ClampedArray(finalRgba), w, h), effectiveProtectedMask),
          componentColourMaps: componentTransfer?.maps || {},
          mode: paletteMode ? 'palette' : 'flat',
          passes: transferPasses,
          paletteColors: usedPaletteColors,
          preservePaintShading,
          brightnessMatch: extraBrightnessMatch,
          paletteSmoothness: extraPaletteSmoothness,
          atlasProtectionBase64: effectiveProtectedMask
            ? toBase64(componentTransfer?.protection || new Uint8Array(effectiveProtectedMask))
            : null,
          atlasWidth: w,
          atlasHeight: h,
        } : null;
        const currentPart = findTexturePartByPath(textureParts, blpPath) || { path: blpPath, recordId: null, field: null, baseSection: texturePartType === 'hair' ? 3 : 0, type: texturePartType };
        const exports = [{ path: res.path, sourcePath: currentPart.path, rowId: currentPart.recordId, field: currentPart.field, baseSection: currentPart.baseSection, type: currentPart.type, componentMappings, recoveryTransfer }];
        for (const [stagedPath, snapshot] of stagedPartsRef.current) {
          if (stagedPath === normalizeTexturePath(blpPath) || !snapshot?.dirty) continue;
          const part = findTexturePartByPath(textureParts, stagedPath);
          if (!part) {
            setSaveError(`Could not resolve staged texture ${stagedPath} for export.`);
            return;
          }
          const stagedExport = await writeStagedTexturePart(part, snapshot);
          if (!stagedExport) {
            setSaveError(`Could not save staged texture ${part.label || part.path}.`);
            return;
          }
          exports.push(stagedExport);
        }
        const registration = await onSaved?.({ path: res.path, exports, saveMode, targetSetFlags, targetColor, strength, sourceMaskBase64: maskBase64, sourceWidth: w, sourceHeight: h, componentMappings, componentPasses: transferPasses, recoveryTransfer });
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
    const effectiveProtectedMask = filterDisabledPolygonProtection(protectedRef.current, semanticAnalysis.template, polygonVisibility, w, h);
    templateCorrectionStore.save({
      id: `${semanticAnalysis.template.id}:protected-details`, templateId: semanticAnalysis.template.id, templateVersion: semanticAnalysis.template.version,
      width: w, height: h, protectedMask: bytesToBase64(effectiveProtectedMask), semantic: 'protected-details', polygonOverrides, customPolygons, labelOverrides,
    });
    setReusedCorrection(true); setTemplateSaveMsg('Protection and polygons saved for this template.');
    setTimeout(() => setTemplateSaveMsg(null), 2500);
  };

  const atlasPreviewPath = textureParts.find(part => part.type === 'skin-atlas')?.path;
  const stagedAtlasForPreview = stagedAtlasPreview?.path?.toLowerCase() === String(atlasPreviewPath || '').toLowerCase() ? stagedAtlasPreview : null;
  const previewAtlasRgba = texturePartType === 'skin-atlas' ? previewRgba : stagedAtlasForPreview?.rgba;
  const previewAtlasTransfer = texturePartType === 'skin-atlas' ? previewTransfer : stagedAtlasForPreview?.transfer;
  const previewAtlasPalette = texturePartType === 'skin-atlas' ? palettePreview : stagedAtlasForPreview?.palette;
  const previewAtlasIsFinal = texturePartType === 'skin-atlas' ? loadedFromOutput : !!stagedAtlasForPreview;
  const extraPreviewPart = textureParts.find(part => part.type === 'skin-extra');
  const previewSkinExtraRgba = texturePartType === 'skin-extra'
    ? previewRgba
    : stagedPartsRef.current.get(normalizeTexturePath(extraPreviewPart?.path))?.rgba || null;
  const previewHairPart = texturePartType === 'hair'
    ? textureParts.find(part => String(part.path).toLowerCase() === String(blpPath).toLowerCase())
    : textureParts.find(part => part.type === 'hair' && String(part.path).toLowerCase() === String(previewHair?.tex1 || '').toLowerCase());
  const previewHairRgba = texturePartType === 'hair'
    ? previewRgba
    : stagedPartsRef.current.get(normalizeTexturePath(previewHairPart?.path))?.rgba || null;
  const stagedFaceRgba = path => {
    if (!path) return null;
    if (texturePartType === 'face' && String(path).toLowerCase() === String(blpPath).toLowerCase()) return previewRgba;
    if (texturePartType === 'face-group') {
      const layout = compositeLayoutRef.current;
      const rect = layout?.rects?.find(item => String(item.part.path).toLowerCase() === String(path).toLowerCase());
      if (rect && previewRgba?.data) return cropImageDataValue(previewRgba, rect);
    }
    return stagedPartsRef.current.get(normalizeTexturePath(path))?.rgba || null;
  };
  const previewFaceLowerRgba = stagedFaceRgba(previewFace?.tex1);
  const previewFaceUpperRgba = stagedFaceRgba(previewFace?.tex2);
  const workspaceParts = useMemo(() => {
    const parts = [];
    const hairParts = [];
    const faceParts = [];
    const seen = new Set();
    for (const part of textureParts) {
      if (part.type === 'face-group') {
        for (const child of part.faceParts || []) {
          const key = normalizeTexturePath(child.path);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          faceParts.push({ ...child, key, selectionPath: part.path, label: `${part.label} · ${child.label}` });
        }
        continue;
      }
      const key = normalizeTexturePath(part.path);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const tile = { ...part, key, selectionPath: part.path };
      if (part.type === 'hair') hairParts.push(tile);
      else parts.push(tile);
    }
    return [...parts, ...hairParts, ...faceParts];
  }, [textureParts]);

  useEffect(() => {
    if (!workspaceParts.length) {
      setWorkspaceTiles([]);
      return;
    }
    const canvas = canvasRef.current;
    const activeKey = String(blpPath || '').toLowerCase();
    const current = canvas ? canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height) : null;
    const activeFaceLayout = texturePartType === 'face-group' ? compositeLayoutRef.current : null;
    const tiles = workspaceParts.map(part => {
      let rgba = null;
      if (texturePartType === 'face-group' && String(part.selectionPath || '').toLowerCase() === activeKey && current) {
        const rect = activeFaceLayout?.rects?.find(item => String(item.part.path).toLowerCase() === part.key);
        rgba = rect ? cropImageDataValue(current, rect) : null;
      } else if (part.key === activeKey && current && texturePartType !== 'face-group') {
        rgba = cloneImageDataValue(current);
      } else {
        rgba = stagedPartsRef.current.get(normalizeTexturePath(part.key))?.rgba || null;
      }
      return { key: part.key, label: part.label, selectionPath: part.selectionPath, rgba };
    });
    setWorkspaceTiles(tiles);
  }, [workspaceParts, blpPath, texturePartType, previewRgba, stagedPreviewRevision, workspaceRevision]);
  const liveCanvas = <div className="tme-live-canvas-viewport"><div className={`tme-canvas-stack ${polygonEdit ? 'polygon-editing' : ''}`} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><canvas ref={canvasRef} className={`tme-canvas ${tool === 'eyedropper' ? 'tme-canvas-eyedropper' : ''}`} onContextMenu={e => e.preventDefault()} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave} /><canvas ref={protectionOverlayRef} className="tme-protection-overlay" />{brushCursor && !polygonEdit && tool !== 'eyedropper' && <div className={`tme-brush-cursor ${tool}${brushSoft ? ' soft' : ''}${brushShape === 'square' ? ' square' : ''}`} style={{ left: `${brushCursor.left}%`, top: `${brushCursor.top}%`, width: `${brushCursor.width}%`, height: `${brushCursor.height}%` }} />}</div></div>;
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
              {textureParts.length > 1 && <div className="tme-workspace-summary"><strong>Unified texture workspace</strong><span>{workspaceParts.length} linked texture tiles</span><span>Click a tile to edit it. Skin transfers to Faces only; Skin Extra and Hair stay manual.</span></div>}
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
              {textureParts.length > 1 && <TextureWorkspaceCanvas tiles={workspaceTiles} activeKey={blpPath} onSelect={selectTexturePart} />}
              {liveCanvas}
              <div className="tme-canvas-status"><span>{tool}</span><span>{targetColor}</span><span>{brushSize}px</span>{textureSize && <span>{textureSize.width} × {textureSize.height}px</span>}{mappingEdit && <span>Moving {mappingComponent}</span>}</div>
            </div>

            <div className="tme-controls">
              {semanticAnalysis && (
                <div className="tme-semantic-controls">
                  <strong>Semantic analysis: {semanticAnalysis.status === 'ready' ? 'ready' : semanticAnalysis.status === 'review' ? 'review' : 'manual'}</strong>
                  <span> {Math.round((semanticAnalysis.confidence?.total ?? 0) * 100)}% · {semanticAnalysis.template?.id || 'no template'}</span>
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
                {(texturePartType === 'skin-atlas' || texturePartType === 'skin-extra' || texturePartType === 'face-group' || texturePartType === 'hair') && <button className={`tme-tool-btn ${tool === 'palette' ? 'active' : ''}`} onClick={() => choosePaletteBrushColor(paletteBrushColor)} title="Paint with a discrete palette tint while preserving local light and dark detail">Palette brush</button>}
                <button className="tme-tool-btn" onClick={fillMask} title="Fill all editable, non-protected pixels with the target colour">Fill</button>
                {semanticAnalysis?.template?.match?.textureType === 'skin-atlas' && <button className={`tme-tool-btn ${mappingEdit ? 'active' : ''}`} onClick={() => { setShowComponentMappings(true); setMappingEdit(value => !value); }} title="Drag the selected component rectangle on the canvas">Mappings</button>}
                <button className="tme-tool-btn" onClick={resetMask} title="Clear mask completely">
                  <RotateCcw size={14} /> Reset
                </button>
              </div>

              {texturePartType === 'skin-atlas' && <details className="tme-collapsible">
                <summary>Source body palette</summary>
                <label className="tme-field">Source race<select value={sourceRace} onChange={e => { setSourceRace(Number(e.target.value)); setSourceSkinId(''); }}>{SOURCE_RACES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label className="tme-field">Source gender<select value={sourceGender} onChange={e => { setSourceGender(Number(e.target.value)); setSourceSkinId(''); }}><option value={0}>Male</option><option value={1}>Female</option></select></label>
                <label className="tme-field">Source colour set<select value={sourceSkinId} onChange={e => setSourceSkinId(e.target.value)} disabled={!sourceSkins.length}>{sourceSkins.map(row => <option key={row.id} value={row.id}>Colour {row.colorIndex} · Flags {row.flags}</option>)}</select></label>
                <button className="tme-tool-btn" onClick={applySourceBodyPalette} disabled={!selectedSourceSkin} title="Analyse the source palette; on re-apply, only newly unprotected pixels are changed">Analyse & apply body palette</button>
                <div className="tme-source-swatches" aria-label="Discrete palette brush colours">
                  {paletteBrushColors.map((colour, index) => <button key={`${colour}-${index}`} type="button" className={tool === 'palette' && paletteBrushColorIndex === index ? 'active' : ''} style={{ backgroundColor: colour }} onClick={() => choosePaletteBrushColor(colour)} title={`Paint with ${colour}`} aria-label={`Paint with palette colour ${colour}`} />)}
                  <label className="tme-palette-colour-picker">Custom <input type="color" value={paletteBrushColor} onChange={e => choosePaletteBrushColor(e.target.value)} /></label>
                  <span>Palette brush keeps the local luminance/detail; colours stay discrete instead of mixing.</span>
                </div>
                <label className="tme-field">Palette influence: {Math.round(paletteInfluence * 100)}%<input type="range" min="0" max="1" step="0.05" value={paletteInfluence} onChange={e => setPaletteInfluence(Number(e.target.value))} /></label>
                <label className="tme-field">Texture detail: {Math.round(textureDetailStrength * 100)}%<input type="range" min="0" max="2" step="0.05" value={textureDetailStrength} onChange={e => setTextureDetailStrength(Number(e.target.value))} /></label>
                <label className="tme-field">Shadow depth: {Math.round(shadowDepth * 100)}%<input type="range" min="0" max="2" step="0.05" value={shadowDepth} onChange={e => setShadowDepth(Number(e.target.value))} /></label>
                {sourcePaletteInfo && <div className="tme-source-swatches" aria-label="Source fur palette">
                  {sourcePaletteInfo.map((colour, index) => <button key={`${colour}-${index}`} type="button" className={colour.toLowerCase() === targetColor.toLowerCase() ? 'active' : ''} style={{ backgroundColor: colour }} onClick={() => changeTargetColor(colour)} title={`Use ${colour} as target colour`} aria-label={`Use palette colour ${colour} as target colour`} />)}
                  <span>Choose a sampled colour as Target colour</span>
                </div>}
              </details>}

              {texturePartType === 'skin-extra' && <button className="tme-tool-btn" onClick={applySkinColourTransfer} title="Apply the Skin colour transform while keeping the original Extra texture lighting and detail">
                Analyse & apply Skin colour
              </button>}
              {texturePartType === 'skin-extra' && <details className="tme-collapsible">
                <summary>Skin Extra palette brush</summary>
                <div className="tme-source-swatches" aria-label="Skin Extra palette brush colours">
                  {paletteBrushColors.map((colour, index) => <button key={`${colour}-${index}`} type="button" className={tool === 'palette' && paletteBrushColorIndex === index ? 'active' : ''} style={{ backgroundColor: colour }} onClick={() => choosePaletteBrushColor(colour)} title={`Paint with ${colour}`} aria-label={`Paint with palette colour ${colour}`} />)}
                  <label className="tme-palette-colour-picker">Custom <input type="color" value={paletteBrushColor} onChange={e => choosePaletteBrushColor(e.target.value)} /></label>
                  <span>Paints the Extra texture directly while preserving its local light and dark detail.</span>
                </div>
              </details>}
              {texturePartType === 'face-group' && <details className="tme-collapsible">
                <summary>Face palette brush</summary>
                <div className="tme-source-swatches" aria-label="Face palette brush colours">
                  {paletteBrushColors.map((colour, index) => <button key={`${colour}-${index}`} type="button" className={tool === 'palette' && paletteBrushColorIndex === index ? 'active' : ''} style={{ backgroundColor: colour }} onClick={() => choosePaletteBrushColor(colour)} title={`Paint with ${colour}`} aria-label={`Paint with face palette colour ${colour}`} />)}
                  <label className="tme-palette-colour-picker">Custom <input type="color" value={paletteBrushColor} onChange={e => choosePaletteBrushColor(e.target.value)} /></label>
                  <span>Paints both Face Lower and Upper while preserving local detail.</span>
                </div>
              </details>}
              {texturePartType === 'hair' && <>
                <label className="tme-field" title="Choose the existing Hair colour whose colour distribution should be transferred to the current Hair texture.">
                  Target Hair colour
                  <select value={hairTargetColorIndex} onChange={e => setHairTargetColorIndex(Number(e.target.value))} disabled={!hairColourOptions.length}>
                    {hairColourOptions.map(value => <option key={value} value={value}>Colour {String(value).padStart(2, '0')}</option>)}
                  </select>
                </label>
                <button className="tme-tool-btn" onClick={applyHairColourTransfer} disabled={!selectedHairColourRow} title="Learn the selected Hair colour and apply it while preserving the current texture details">
                  Analyse &amp; apply Hair colour
                </button>
                <details className="tme-collapsible">
                  <summary>Hair palette brush</summary>
                  <div className="tme-source-swatches" aria-label="Hair palette brush colours">
                    {paletteBrushColors.map((colour, index) => <button key={`${colour}-${index}`} type="button" className={tool === 'palette' && paletteBrushColorIndex === index ? 'active' : ''} style={{ backgroundColor: colour }} onClick={() => choosePaletteBrushColor(colour)} title={`Paint with ${colour}`} aria-label={`Use hair palette colour ${colour}`} />)}
                    <label className="tme-palette-colour-picker">Custom <input type="color" value={paletteBrushColor} onChange={e => choosePaletteBrushColor(e.target.value)} /></label>
                    <span>Paints Hair while preserving its local light and dark detail.</span>
                  </div>
                </details>
              </>}
              {texturePartType === 'skin-extra' && skinTransferProfile && <span className="tme-viewport-hint">Profile: {skinTransferProfile.source}{skinTransferProfile.samples ? ` (${skinTransferProfile.samples} pixels)` : ''}</span>}
              {texturePartType === 'skin-extra' && <label className="tme-field" title="0% keeps the original Extra lightness; 100% applies the full Skin lightness difference.">Match Skin brightness: {Math.round(extraBrightnessMatch * 100)}%<input type="range" min="0" max="1" step="0.05" value={extraBrightnessMatch} onChange={e => setExtraBrightnessMatch(Number(e.target.value))} /></label>}
              {texturePartType === 'skin-extra' && <label className="tme-field" title="0% uses one exact matching colour cluster; higher values blend nearby Skin palette matches for a softer transition.">Palette transition smoothness: {Math.round(extraPaletteSmoothness * 100)}%<input type="range" min="0" max="1" step="0.05" value={extraPaletteSmoothness} onChange={e => setExtraPaletteSmoothness(Number(e.target.value))} /></label>}
              {texturePartType === 'hair' && <label className="tme-field" title="0% keeps the current Hair lightness; 100% applies the full lightness difference of the selected Hair colour.">Match Hair brightness: {Math.round(extraBrightnessMatch * 100)}%<input type="range" min="0" max="1" step="0.05" value={extraBrightnessMatch} onChange={e => setExtraBrightnessMatch(Number(e.target.value))} /></label>}
              {texturePartType === 'hair' && <label className="tme-field" title="Higher values blend nearby colours from the selected Hair palette for a softer transition.">Palette transition smoothness: {Math.round(extraPaletteSmoothness * 100)}%<input type="range" min="0" max="1" step="0.05" value={extraPaletteSmoothness} onChange={e => setExtraPaletteSmoothness(Number(e.target.value))} /></label>}

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

              <div className="tme-field">
                Brush shape
                <div className="tme-tool-row tme-brush-shapes">
                  <button type="button" className={`tme-tool-btn${brushShape === 'circle' ? ' active' : ''}`} onClick={() => setBrushShape('circle')}>Circle</button>
                  <button type="button" className={`tme-tool-btn${brushShape === 'square' ? ' active' : ''}`} onClick={() => setBrushShape('square')}>Square</button>
                </div>
              </div>

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
          {activeTab === 'preview' && <div className="tme-model-preview"><div className="tme-preview-controls">{previewFaces.length > 0 && <label>Face<select value={previewFaceId} onChange={e => setPreviewFaceId(e.target.value)}>{previewFaces.map(row => <option key={row.id} value={row.id}>Face {row.variationIndex}</option>)}</select></label>}{previewHairs.length > 0 && <label>Hair<select value={previewHairId} onChange={e => setPreviewHairId(e.target.value)}><option value="">None</option>{previewHairs.map(row => <option key={row.id} value={row.id}>Style {row.variationIndex} / colour {row.colorIndex}</option>)}</select></label>}</div>{previewAtlasRgba || previewRgba || previewSkinExtraRgba || previewHairRgba ? <CharM2Viewer race={race} gender={gender} modelVariantId={modelVariantId} modelVariantArchivePath={modelVariantArchivePath} skinBlp={previewSkin?.tex1 || blpPath} skinExtraBlp={previewSkin?.tex2 || null} skinRgba={previewAtlasRgba || null} skinRgbaFinal={previewAtlasIsFinal} skinExtraRgba={previewSkinExtraRgba} hairRgba={previewHairRgba} componentTransfer={previewAtlasTransfer || null} componentPalette={previewAtlasPalette || null} appearance={{ face: previewFace?.variationIndex || 0, hairStyle: previewHair?.variationIndex || 0, hairColor: previewHair?.colorIndex || 0 }} textureLayers={[...(previewFace ? [{ path: previewFace.tex1, region: 'face-lower', rgba: previewFaceLowerRgba }, { path: previewFace.tex2, region: 'face-upper', rgba: previewFaceUpperRgba }] : []), ...(previewHair ? [{ path: previewHair.tex1, region: 'hair-primary' }] : [])]} preferOutput={preferOutput} textureRefreshKey={`${stagedPreviewRevision}:${texturePartType}:${blpPath || ''}`} active={!!dataPath} /> : <span>Open the preview after the texture has loaded.</span>}</div>}
        </div>
      </div>
    </div>
  );
}
