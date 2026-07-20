import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { X, Brush, Eraser, Save, Loader2, RotateCcw, Shield, ShieldOff, Maximize2, Minimize2, ZoomIn, ZoomOut, LocateFixed, FolderOpen } from 'lucide-react';
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

export default function TextureMaskEditor({ dataPath, blpPath, outputPath = null, initialTargetFlags = 17, race, gender, characterRecords = [], colorIndex = 0, onClose, onSaved }) {
  const canvasRef    = useRef(null); // toont het resultaat (basis + recolor binnen masker)
  const protectionOverlayRef = useRef(null);
  const baseRef       = useRef(null); // ImageData van de ongewijzigde texture
  const originalBaseRef = useRef(null);
  const recoveryOriginalRef = useRef(null);
  const strengthRef   = useRef(null); // Float32Array(w*h), 0..1 brush-coverage per pixel
  const protectedRef  = useRef(null); // Uint8Array(w*h), 1 = nooit recoloren
  const dimsRef        = useRef({ w: 0, h: 0 });
  const drawingRef     = useRef(false);
  const panDragRef     = useRef(null);
  const canvasWrapRef = useRef(null);
  const templateBaseRef = useRef(null);
  const historyRef = useRef([]);
  const redoRef = useRef([]);

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [importedBlpPath, setImportedBlpPath] = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [templateSaveMsg, setTemplateSaveMsg] = useState(null);

  const [brushSize, setBrushSize]   = useState(24);
  const [brushSoft, setBrushSoft]   = useState(true);
  const [tool, setTool]             = useState('paint');
  const [targetColor, setTargetColor] = useState('#ff66cc');
  const [strength, setStrength]     = useState(1); // hoeveel van de doelkleur t.o.v. origineel (hue/sat mix)
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
  const [previewTransfer, setPreviewTransfer] = useState(null);
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
  const previewHairs = useMemo(() => characterRecords.filter(row => row.race === race && row.sex === gender && row.baseSection === 3 && row.tex1), [characterRecords, race, gender]);
  const previewFace = previewFaces.find(row => String(row.id) === previewFaceId) || previewFaces[0] || null;
  const previewHair = previewHairs.find(row => String(row.id) === previewHairId) || previewHairs[0] || null;

  useEffect(() => {
    if (!previewHairId && previewHairs[0]) setPreviewHairId(String(previewHairs[0].id));
  }, [previewHairId, previewHairs]);

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
      setPreviewTransfer({ passes: [...committedPasses, { mask: activeMask, targetColor, strength, mappings: componentMappings }], width: canvas.width, height: canvas.height });
    }
  }, [targetColor, strength, componentMappings, committedPasses]);
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
    setCommittedPasses([]);
    historyRef.current = []; redoRef.current = [];
    const loadPath = importedBlpPath || blpPath;
    const readTexture = importedBlpPath
      ? window.azeroth.dbc.readBlpFile(importedBlpPath)
      : window.azeroth.dbc.readBlpTexture(dataPath, blpPath);
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
        if (importedBlpPath) {
          const original = await window.azeroth.dbc.readBlpTexture(dataPath, blpPath);
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
        const analysis = textureClassifier.classify({ path: loadPath, width: img.width, height: img.height, rgba: new Uint8Array(baseRef.current.data) });
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
  }, [dataPath, blpPath, importedBlpPath]);

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

    for (let i = 0; i < w * h; i++) {
      const amt = respectProtection && protectedArr?.[i] ? 0 : strengthArr[i] * strength;
      if (amt <= 0) continue;
      const off = i * 4;
      const [, , l] = rgbToHsl(out[off], out[off+1], out[off+2]);
      if (tl <= .02) {
        // Black is colour, never an alpha operation. Blend towards a tiny
        // near-black floor so it remains visibly black while avoiding a flat,
        // compression-prone zero block in BLP/DXT output.
        const black = 8;
        out[off]   += (black - out[off]) * amt;
        out[off+1] += (black - out[off+1]) * amt;
        out[off+2] += (black - out[off+2]) * amt;
      } else {
        const [nr, ng, nb] = hslToRgb(th, ts, l);
        out[off]   = out[off]   + (nr - out[off])   * amt;
        out[off+1] = out[off+1] + (ng - out[off+1]) * amt;
        out[off+2] = out[off+2] + (nb - out[off+2]) * amt;
      }
    }

    const ctx = canvasRef.current.getContext('2d');
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
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
  }, [targetColor, strength, respectProtection, showProtection, showComponentMappings, componentMappings, semanticAnalysis, polygonVisibility, selectedVertex]);

  useEffect(() => { if (!loading && !error) repaint(); }, [loading, error, repaint]);

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
  }, [brushSize, brushSoft, tool, respectProtection, semanticAnalysis, polygonVisibility, repaint]);

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

  const onPointerDown = (e) => { if (e.button === 1 || e.button === 2 || e.shiftKey) { e.preventDefault(); panDragRef.current = { x: e.clientX, y: e.clientY, pan }; return; } if (mappingPointerDown(e)) return; if (polygonEdit) { polygonPointerDown(e); return; } pushHistory(); updateBrushCursor(e); drawingRef.current = true; paintAt(...canvasToImageCoords(e)); };
  const onPointerMove = (e) => { if (panDragRef.current) { const start = panDragRef.current; setPan({ x: start.pan.x + e.clientX - start.x, y: start.pan.y + e.clientY - start.y }); return; } if (mappingDragRef.current) { const [cx, cy] = canvasToImageCoords(e), { w, h } = dimsRef.current, drag = mappingDragRef.current; setComponentMappings(current => { const rect = current[mappingComponent]; return { ...current, [mappingComponent]: { ...rect, x: Math.max(0, Math.min(1 - rect.width, cx / w - drag.offsetX)), y: Math.max(0, Math.min(1 - rect.height, cy / h - drag.offsetY)) } }; }); return; } if (polygonEdit && polygonDragRef.current) { const [cx, cy] = canvasToImageCoords(e), { w, h } = dimsRef.current, drag = polygonDragRef.current; if (drag.polygon) { const point = [Math.max(0, Math.min(1, cx / w)), Math.max(0, Math.min(1, cy / h))]; const next = drag.index == null ? drag.startPolygon.map(([x, y]) => [Math.max(0, Math.min(1, x + point[0] - drag.origin[0])), Math.max(0, Math.min(1, y + point[1] - drag.origin[1]))]) : [...drag.polygon]; if (drag.index != null) next[drag.index] = point; drag.polygon = next; previewPolygon(drag.semantic, next); } return; } updateBrushCursor(e); if (drawingRef.current) paintAt(...canvasToImageCoords(e)); };
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

  const changeTargetColor = nextColor => {
    if (nextColor === targetColor || !canvasRef.current || !baseRef.current || !strengthRef.current) { setTargetColor(nextColor); return; }
    // Flatten the current colour pass into the temporary working base before a
    // new colour starts. Source BLPs remain untouched until explicit export.
    const { w, h } = dimsRef.current;
    const mask = Uint8Array.from(strengthRef.current, value => Math.round(value * 255));
    if (mask.some(value => value)) setCommittedPasses(current => [...current, { mask, targetColor, strength, mappings: componentMappings }]);
    baseRef.current = canvasRef.current.getContext('2d').getImageData(0, 0, w, h);
    strengthRef.current.fill(0);
    setTargetColor(nextColor);
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
    if (!strengthArr || (strengthArr.every(v => v === 0) && !hasRecovery)) {
      setSaveError('Paint an area first — there are no changes to save.');
      return;
    }
    setSaving(true);
    setSaveError(null);

    const ctx = canvasRef.current.getContext('2d');
    const finalRgba = ctx.getImageData(0, 0, w, h).data; // Uint8ClampedArray, bevat al de preview-recolor
    const maskBytes = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) maskBytes[i] = hasRecovery ? (finalRgba[i * 4 + 3] > 12 ? 255 : 0) : Math.round(strengthArr[i] * 255);

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
      const res = await window.azeroth.dbc.writeBlpTextureEdit(dataPath, blpPath, editedRgbaBase64, maskBase64, outRelPath, true);
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
        onSaved?.({ path: res.path, targetSetFlags, targetColor, strength, sourceMaskBase64: maskBase64, sourceWidth: w, sourceHeight: h, componentMappings, componentPasses: [...committedPasses, activePass], recoveryTransfer });
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
              {semanticAnalysis && <>
                <div className="tme-analysis"><strong>Semantic analysis: {semanticAnalysis.status === 'ready' ? 'ready' : semanticAnalysis.status === 'review' ? 'review' : 'manual'}</strong><span>{Math.round(semanticAnalysis.confidence.total * 100)}% · {semanticAnalysis.template?.id || 'no template'}</span>{reusedCorrection && <span>Saved correction applied</span>}</div>
                {semanticAnalysis?.template?.match?.textureType === 'skin-atlas' && <details className="tme-collapsible"><summary>Component mappings</summary><select value={mappingComponent} onChange={e => setMappingComponent(e.target.value)}>{Object.keys(componentMappings).map(name => <option key={name}>{name}</option>)}</select>{['x','y','width','height'].map(key => <label className="tme-field" key={key}>{key}<input type="number" min="0" max="1" step="0.005" value={componentMappings[mappingComponent]?.[key] ?? 0} onChange={e => setComponentMappings(current => ({ ...current, [mappingComponent]: { ...current[mappingComponent], [key]: Math.max(0, Math.min(1, Number(e.target.value) || 0)) } }))} /></label>)}<button className="tme-tool-btn" onClick={() => { componentMappingStore.save(semanticAnalysis.template.id, componentMappings); setTemplateSaveMsg('Component mappings saved for this atlas layout.'); }}>Save component mappings</button></details>}
                {(semanticAnalysis.template?.regions || []).some(region => region.polygon) && <details className="tme-collapsible"><summary>Protection layers</summary><select value={polygonSemantic} onChange={e => setPolygonSemantic(e.target.value)}>{semanticAnalysis.template.regions.filter(region => region.polygon).map(region => <option key={region.semantic} value={region.semantic}>{region.label || region.semantic.replace('-candidate', '')}</option>)}</select><button className={`tme-tool-btn ${polygonEdit ? 'active' : ''}`} onClick={() => setPolygonEdit(value => !value)}>{polygonEdit ? 'Finish polygon' : 'Edit polygon'}</button><div className="tme-tool-row"><button className="tme-tool-btn" onClick={addCustomPolygon}>New region</button>{customPolygons.some(item => item.semantic === polygonSemantic) && <button className="tme-tool-btn" onClick={removeCustomPolygon}>Remove region</button>}</div><div className="tme-polygon-layers">{semanticAnalysis.template.regions.filter(region => region.polygon).map(region => <label key={region.semantic}><input type="checkbox" checked={polygonVisibility[region.semantic] !== false} onChange={e => setPolygonVisibility(current => ({ ...current, [region.semantic]: e.target.checked }))} /><span style={{ background: '#1ebeff' }} />{region.label || region.semantic.replace('-candidate', '')}</label>)}</div>{polygonEdit && <span className="tme-polygon-hint">Drag a vertex to move it · drag inside the polygon to move the layer · click a line to add a vertex.</span>}<div className="tme-tool-row"><button className="tme-tool-btn" onClick={copyTemplateJson}>Copy JSON</button><button className="tme-tool-btn" onClick={pasteTemplateJson}>Paste JSON</button></div></details>}
              </>}
                {(semanticAnalysis?.template?.regions || []).some(region => region.polygon) && <button className="tme-tool-btn tme-save-protection" onClick={saveTemplateProtection}><Save size={14} /> Save protection/polygons</button>}
                {templateSaveMsg && <div className="tme-template-ok">{templateSaveMsg}</div>}
            </aside>
            <div ref={canvasWrapRef} className="tme-canvas-wrap">
              <div className={`tme-canvas-stack ${polygonEdit ? 'polygon-editing' : ''}`} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><canvas ref={canvasRef} className="tme-canvas" onContextMenu={e => e.preventDefault()} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerLeave} /><canvas ref={protectionOverlayRef} className="tme-protection-overlay" />{brushCursor && !polygonEdit && <div className={`tme-brush-cursor ${tool}${brushSoft ? ' soft' : ''}`} style={{ left: `${brushCursor.left}%`, top: `${brushCursor.top}%`, width: `${brushCursor.width}%`, height: `${brushCursor.height}%` }}><span>{brushSize}px</span></div>}</div><div className="tme-canvas-status"><span>{tool}</span><span>{targetColor}</span><span>{brushSize}px</span>{mappingEdit && <span>Moving {mappingComponent}</span>}</div>
            </div>

            <div className="tme-controls">
              {semanticAnalysis && (
                <div className="tme-semantic-controls">
                  <strong>Semantic analysis: {semanticAnalysis.status === 'ready' ? 'ready' : semanticAnalysis.status === 'review' ? 'review' : 'manual'}</strong>
                  <span> {Math.round(semanticAnalysis.confidence.total * 100)}% · {semanticAnalysis.template?.id || 'geen template'}</span>
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
                <button className="tme-tool-btn" onClick={fillMask} title="Fill all editable, non-protected pixels with the target colour">Fill</button>
                {semanticAnalysis?.template?.match?.textureType === 'skin-atlas' && <button className={`tme-tool-btn ${mappingEdit ? 'active' : ''}`} onClick={() => { setShowComponentMappings(true); setMappingEdit(value => !value); }} title="Drag the selected component rectangle on the canvas">Mappings</button>}
                <button className="tme-tool-btn" onClick={resetMask} title="Masker volledig wissen">
                  <RotateCcw size={14} /> Reset
                </button>
              </div>

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
          {activeTab === 'preview' && <div className="tme-model-preview"><div className="tme-preview-controls">{previewFaces.length > 0 && <label>Face<select value={previewFaceId} onChange={e => setPreviewFaceId(e.target.value)}>{previewFaces.map(row => <option key={row.id} value={row.id}>Face {row.variationIndex}</option>)}</select></label>}{previewHairs.length > 0 && <label>Hair<select value={previewHairId} onChange={e => setPreviewHairId(e.target.value)}><option value="">None</option>{previewHairs.map(row => <option key={row.id} value={row.id}>Style {row.variationIndex} / colour {row.colorIndex}</option>)}</select></label>}</div>{previewRgba ? <CharM2Viewer race={race} gender={gender} skinBlp={blpPath} skinRgba={previewRgba} componentTransfer={previewTransfer} appearance={{ face: previewFace?.variationIndex || 0, hairStyle: previewHair?.variationIndex || 0, hairColor: previewHair?.colorIndex || 0 }} textureLayers={[...(previewFace ? [{ path: previewFace.tex1, region: 'face-lower' }, { path: previewFace.tex2, region: 'face-upper' }] : []), ...(previewHair ? [{ path: previewHair.tex1, region: 'hair-primary' }] : [])]} active={!!dataPath} /> : <span>Open the preview after the texture has loaded.</span>}</div>}
        </div>
      </div>
    </div>
  );
}
