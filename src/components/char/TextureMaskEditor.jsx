import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Brush, Eraser, Save, Loader2, RotateCcw } from 'lucide-react';
import './TextureMaskEditor.css';

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

export default function TextureMaskEditor({ dataPath, blpPath, onClose, onSaved }) {
  const canvasRef    = useRef(null); // toont het resultaat (basis + recolor binnen masker)
  const baseRef       = useRef(null); // ImageData van de ongewijzigde texture
  const strengthRef   = useRef(null); // Float32Array(w*h), 0..1 brush-coverage per pixel
  const dimsRef        = useRef({ w: 0, h: 0 });
  const drawingRef     = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [brushSize, setBrushSize]   = useState(24);
  const [brushSoft, setBrushSoft]   = useState(true);
  const [tool, setTool]             = useState('paint'); // 'paint' | 'erase'
  const [targetColor, setTargetColor] = useState('#ff66cc');
  const [strength, setStrength]     = useState(1); // hoeveel van de doelkleur t.o.v. origineel (hue/sat mix)

  // ── Texture laden ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.azeroth.dbc.readBlpTexture(dataPath, blpPath).then(res => {
      if (cancelled) return;
      if (!res?.success) { setError(res?.error || 'Texture kon niet geladen worden'); setLoading(false); return; }
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        const cvs = canvasRef.current;
        if (!cvs) return;
        cvs.width = img.width; cvs.height = img.height;
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, 0, 0);
        baseRef.current = ctx.getImageData(0, 0, img.width, img.height);
        strengthRef.current = new Float32Array(img.width * img.height);
        dimsRef.current = { w: img.width, h: img.height };
        setLoading(false);
      };
      img.onerror = () => { setError('PNG decode mislukt'); setLoading(false); };
      img.src = `data:image/png;base64,${res.png}`;
    }).catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [dataPath, blpPath]);

  // ── Herteken canvas op basis van base + strengthRef + targetColor ───────
  const repaint = useCallback(() => {
    const base = baseRef.current;
    const strengthArr = strengthRef.current;
    if (!base || !strengthArr || !canvasRef.current) return;
    const { w, h } = dimsRef.current;
    const [th, ts] = hexToHsl(targetColor);
    const out = new Uint8ClampedArray(base.data); // kopie

    for (let i = 0; i < w * h; i++) {
      const amt = strengthArr[i] * strength;
      if (amt <= 0) continue;
      const off = i * 4;
      const [, , l] = rgbToHsl(out[off], out[off+1], out[off+2]);
      const [nr, ng, nb] = hslToRgb(th, ts, l); // lightness blijft behouden
      out[off]   = out[off]   + (nr - out[off])   * amt;
      out[off+1] = out[off+1] + (ng - out[off+1]) * amt;
      out[off+2] = out[off+2] + (nb - out[off+2]) * amt;
    }

    const ctx = canvasRef.current.getContext('2d');
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
  }, [targetColor, strength]);

  useEffect(() => { if (!loading && !error) repaint(); }, [loading, error, repaint]);

  // ── Brush paint ───────────────────────────────────────────────────────
  const paintAt = useCallback((cx, cy) => {
    const { w, h } = dimsRef.current;
    const strengthArr = strengthRef.current;
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
        if (tool === 'paint') {
          strengthArr[idx] = Math.min(1, strengthArr[idx] + falloff * 0.35);
        } else {
          strengthArr[idx] = Math.max(0, strengthArr[idx] - falloff * 0.5);
        }
      }
    }
    repaint();
  }, [brushSize, brushSoft, tool, repaint]);

  const canvasToImageCoords = (e) => {
    const cvs = canvasRef.current;
    const rect = cvs.getBoundingClientRect();
    const scaleX = cvs.width / rect.width;
    const scaleY = cvs.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  };

  const onPointerDown = (e) => { drawingRef.current = true; paintAt(...canvasToImageCoords(e)); };
  const onPointerMove = (e) => { if (drawingRef.current) paintAt(...canvasToImageCoords(e)); };
  const onPointerUp   = () => { drawingRef.current = false; };

  const resetMask = () => {
    if (!strengthRef.current) return;
    strengthRef.current.fill(0);
    repaint();
  };

  // ── Opslaan ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    const { w, h } = dimsRef.current;
    const strengthArr = strengthRef.current;
    if (!strengthArr || strengthArr.every(v => v === 0)) {
      setSaveError('Schilder eerst een gebied — geen wijzigingen om op te slaan.');
      return;
    }
    setSaving(true);
    setSaveError(null);

    const ctx = canvasRef.current.getContext('2d');
    const finalRgba = ctx.getImageData(0, 0, w, h).data; // Uint8ClampedArray, bevat al de preview-recolor
    const maskBytes = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) maskBytes[i] = Math.round(strengthArr[i] * 255);

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
    const outRelPath = (dirName ? dirName + '\\' : '') + `${baseName}_custom${Date.now()}.blp`;

    try {
      const res = await window.azeroth.dbc.writeBlpTextureEdit(dataPath, blpPath, editedRgbaBase64, maskBase64, outRelPath);
      if (res?.success) onSaved?.(res.path);
      else setSaveError(res?.error || 'Opslaan mislukt');
    } catch (e) {
      setSaveError(e.message || 'Opslaan mislukt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tme-overlay" onClick={onClose}>
      <div className="tme-modal" onClick={e => e.stopPropagation()}>
        <div className="tme-header">
          <div>
            <h3>Texture bewerken</h3>
            <p className="tme-path" title={blpPath}>{blpPath}</p>
          </div>
          <button className="tme-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="tme-body">
          {loading && <div className="tme-status"><Loader2 size={18} className="cc-spin" /> Laden…</div>}
          {error && <div className="tme-status tme-status-err">Fout: {error}</div>}
          <div style={{ display: (loading || error) ? 'none' : 'flex', gap: 16, width: '100%' }}>
            <div className="tme-canvas-wrap">
              <canvas
                ref={canvasRef}
                className="tme-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              />
            </div>

            <div className="tme-controls">
              <div className="tme-tool-row">
                <button className={`tme-tool-btn ${tool === 'paint' ? 'active' : ''}`} onClick={() => setTool('paint')}>
                  <Brush size={14} /> Schilderen
                </button>
                <button className={`tme-tool-btn ${tool === 'erase' ? 'active' : ''}`} onClick={() => setTool('erase')}>
                  <Eraser size={14} /> Wissen
                </button>
                <button className="tme-tool-btn" onClick={resetMask} title="Masker volledig wissen">
                  <RotateCcw size={14} /> Reset
                </button>
              </div>

              <label className="tme-field">
                Penseelgrootte: {brushSize}px
                <input type="range" min={4} max={80} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} />
              </label>

              <label className="tme-field tme-checkbox">
                <input type="checkbox" checked={brushSoft} onChange={e => setBrushSoft(e.target.checked)} />
                Zachte rand (falloff)
              </label>

              <label className="tme-field">
                Doelkleur
                <input type="color" value={targetColor} onChange={e => setTargetColor(e.target.value)} />
              </label>

              <label className="tme-field">
                Kleurintensiteit: {Math.round(strength * 100)}%
                <input type="range" min={0} max={100} value={strength * 100} onChange={e => setStrength(Number(e.target.value) / 100)} />
              </label>

              <p className="tme-hint">
                Hue &amp; saturation worden vervangen binnen het geschilderde gebied, lightness (schaduw/gradient) blijft behouden.
                Bij opslaan worden alleen de geraakte DXT-blokken opnieuw gecomprimeerd — de rest van de texture blijft bit-identiek.
              </p>

              {saveError && <div className="tme-status tme-status-err">{saveError}</div>}

              <button className="tme-save-btn" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={14} className="cc-spin" /> : <Save size={14} />}
                {saving ? 'Opslaan…' : 'Opslaan als nieuwe texture'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
