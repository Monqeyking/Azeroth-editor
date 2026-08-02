import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Search, Image as ImageIcon, Box, Palette, Lock, AlertTriangle, Download, CheckCircle2, UserRound } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import { useBlpTexture } from '../lib/useBlpTexture';
import TextureWorkshopGenerator from './TextureWorkshopGenerator';
import TextureWorkshopCharacterModal from './TextureWorkshopCharacterModal';
import './TextureWorkshopPage.css';

const SLOT_NAMES = { 1: 'Head', 2: 'Neck', 3: 'Shoulder', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands', 11: 'Finger', 12: 'Trinket', 16: 'Back', 19: 'Tabard', 20: 'Chest' };
const defaults = { hue: 0, saturation: 0, brightness: 0, contrast: 0, paletteStrength: 100, primary: '', secondary: '', accent: '', colorMappings: [] };
const PALETTE_PRESETS = { Gold: ['#5e3505', '#c9871e', '#ffe6a8'], Silver: ['#344052', '#a7b6c9', '#f4f8ff'], Frost: ['#123552', '#48a9dc', '#d0f8ff'], Fel: ['#123c16', '#43b94c', '#d1ff7d'], Crimson: ['#5a121b', '#bd3c48', '#ffd0b2'], Reset: ['', '', ''] };
const toBase64 = bytes => { let value = ''; for (let i = 0; i < bytes.length; i += 0x8000) value += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(value); };
const slug = value => String(value || 'variant').trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'variant';
const colorBytes = value => value ? [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)] : null;
const rgbHex = rgb => `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const analyzeColors = png => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data, buckets = new Map(); let sampled = 0; for (let i = 0; i < data.length; i += 16) { if (data[i + 3] < 80) continue; sampled++; const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`, row = buckets.get(key) || { count: 0, sum: [0, 0, 0] }; row.count++; row.sum[0] += data[i]; row.sum[1] += data[i + 1]; row.sum[2] += data[i + 2]; buckets.set(key, row); } const selected = []; for (const row of [...buckets.values()].sort((a, b) => b.count - a.count)) { const rgb = row.sum.map(value => value / row.count); if (selected.every(other => Math.hypot(rgb[0] - other.rgb[0], rgb[1] - other.rgb[1], rgb[2] - other.rgb[2]) > 58)) selected.push({ rgb, count: row.count }); if (selected.length === 4) break; } resolve(selected.map(row => ({ rgb: row.rgb, weight: row.count, sampled }))); }; image.onerror = () => reject(new Error('Texture analysis failed.')); image.src = `data:image/png;base64,${png}`; });
const mergeSetColors = groups => { const all = groups.flat(), total = all.reduce((sum, row) => sum + row.weight, 0), merged = []; for (const row of [...all].sort((a,b) => b.weight - a.weight)) { const match = merged.find(candidate => Math.hypot(...row.rgb.map((value, index) => value - candidate.rgb[index])) < 62); if (match) { const weight = match.weight + row.weight; match.rgb = match.rgb.map((value, index) => (value * match.weight + row.rgb[index] * row.weight) / weight); match.weight = weight; } else if (merged.length < 4) merged.push({ rgb: [...row.rgb], weight: row.weight }); } return merged.sort((a,b) => b.weight-a.weight).map((row,index) => ({ id:`set-channel-${index}`, source:rgbHex(row.rgb), target:rgbHex(row.rgb), coverage:Math.max(1,Math.round(row.weight / Math.max(1,total) * 100)), enabled:true, tolerance:74 })); };
const mergeSetColorsEight = groups => { const all = groups.flat(), total = all.reduce((sum,row)=>sum+row.weight,0), merged=[]; for(const row of [...all].sort((a,b)=>b.weight-a.weight)){const match=merged.find(candidate=>Math.hypot(...row.rgb.map((value,index)=>value-candidate.rgb[index]))<42);if(match){const weight=match.weight+row.weight;match.rgb=match.rgb.map((value,index)=>(value*match.weight+row.rgb[index]*row.weight)/weight);match.weight=weight;}else if(merged.length<8)merged.push({rgb:[...row.rgb],weight:row.weight});}return merged.sort((a,b)=>b.weight-a.weight).map((row,index)=>({id:`set-channel-${index}`,source:rgbHex(row.rgb),target:rgbHex(row.rgb),coverage:Math.max(1,Math.round(row.weight/Math.max(1,total)*100)),enabled:true,tolerance:58})); };
const mergeSetColorsTwelve = groups => { const all=groups.flat(),total=all.reduce((sum,row)=>sum+row.weight,0),merged=[];for(const row of [...all].sort((a,b)=>b.weight-a.weight)){const match=merged.find(candidate=>Math.hypot(...row.rgb.map((value,index)=>value-candidate.rgb[index]))<30);if(match){const weight=match.weight+row.weight;match.rgb=match.rgb.map((value,index)=>(value*match.weight+row.rgb[index]*row.weight)/weight);match.weight=weight;}else if(merged.length<12)merged.push({rgb:[...row.rgb],weight:row.weight});}return merged.sort((a,b)=>b.weight-a.weight).map((row,index)=>({id:`set-channel-${index}`,source:rgbHex(row.rgb),target:rgbHex(row.rgb),coverage:Math.max(1,Math.round(row.weight/Math.max(1,total)*100)),enabled:true,tolerance:48})); };
const analyzeColorsDynamic = png => new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data,buckets=new Map();let sampled=0;for(let i=0;i<data.length;i+=16){if(data[i+3]<80)continue;sampled++;const key=`${data[i]>>4},${data[i+1]>>4},${data[i+2]>>4}`,row=buckets.get(key)||{count:0,sum:[0,0,0]};row.count++;row.sum[0]+=data[i];row.sum[1]+=data[i+1];row.sum[2]+=data[i+2];buckets.set(key,row);}const selected=[];for(const row of [...buckets.values()].sort((a,b)=>b.count-a.count)){if(row.count<Math.max(3,sampled*.006))break;const rgb=row.sum.map(value=>value/row.count);if(selected.every(other=>Math.hypot(...rgb.map((value,index)=>value-other.rgb[index]))>26))selected.push({rgb,weight:row.count});if(selected.length===24)break;}resolve(selected);};image.onerror=()=>reject(new Error('Texture analysis failed.'));image.src=`data:image/png;base64,${png}`;});
const mergeSetColorsAdaptive = groups => { const all=groups.flat(),total=all.reduce((sum,row)=>sum+row.weight,0),merged=[];for(const row of [...all].sort((a,b)=>b.weight-a.weight)){const match=merged.find(candidate=>Math.hypot(...row.rgb.map((value,index)=>value-candidate.rgb[index]))<24);if(match){const weight=match.weight+row.weight;match.rgb=match.rgb.map((value,index)=>(value*match.weight+row.rgb[index]*row.weight)/weight);match.weight=weight;}else merged.push({rgb:[...row.rgb],weight:row.weight});}return merged.filter(row=>row.weight/Math.max(1,total)>=.012).slice(0,20).map((row,index)=>({id:`set-channel-${index}`,source:rgbHex(row.rgb),target:rgbHex(row.rgb),coverage:Math.max(1,Math.round(row.weight/Math.max(1,total)*100)),enabled:true,tolerance:42})); };
const paletteTone = (colors, lightness) => { const a = colors[0] || colors[1] || colors[2], b = colors[1] || a, c = colors[2] || b; if (!a) return null; const t = Math.max(0, Math.min(1, lightness)); const from = t < .5 ? a : b, to = t < .5 ? b : c, local = t < .5 ? t * 2 : (t - .5) * 2; return from.map((value, index) => value * (1 - local) + to[index] * local); };
const sourcePrefix = path => slug(String(path || '').replace(/\\/g, '/').split('/').pop().replace(/\.blp$/i, '').replace(/_[A-Z]_\d+[A-Za-z0-9]*$/, '')).toLowerCase();

function adjustTexture(png, profile) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const hue = Number(profile.hue) / 360, saturation = 1 + Number(profile.saturation) / 100, brightness = Number(profile.brightness) / 100, contrast = 1 + Number(profile.contrast) / 100, palette = [colorBytes(profile.primary), colorBytes(profile.secondary), colorBytes(profile.accent)];
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const original = [data[i], data[i + 1], data[i + 2]], mapping = (profile.colorMappings || []).filter(row => row.enabled && colorBytes(row.source) && colorBytes(row.target)).sort((a, b) => Math.hypot(...original.map((value, index) => value - colorBytes(a.source)[index])) - Math.hypot(...original.map((value, index) => value - colorBytes(b.source)[index])))[0];
        let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
        let h = 0, s = max ? delta / max : 0;
        if (delta) h = ((max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta) / 6 + 1) % 1;
        const v = max; h = (h + hue + 1) % 1; s = Math.min(1, Math.max(0, s * saturation));
        const c = v * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = v - c;
        [r, g, b] = h < 1 / 6 ? [c, x, 0] : h < 2 / 6 ? [x, c, 0] : h < 3 / 6 ? [0, c, x] : h < 4 / 6 ? [0, x, c] : h < 5 / 6 ? [x, 0, c] : [c, 0, x];
        let next = [r + m, g + m, b + m].map(value => Math.min(1, Math.max(0, ((value - .5) * contrast + .5) + brightness)) * 255);
        const lightness = (next[0] + next[1] + next[2]) / 765, mappedTarget = mapping && Math.hypot(...original.map((value, index) => value - colorBytes(mapping.source)[index])) <= Number(mapping.tolerance || 74) ? colorBytes(mapping.target) : null, replacement = mappedTarget || paletteTone(palette, lightness);
        if (replacement) { const amount = mappedTarget ? 1 : Math.max(0, Math.min(1, Number(profile.paletteStrength ?? 100) / 100)); next = next.map((value, index) => value * (1 - amount) + replacement[index] * amount); }
        data[i] = Math.round(next[0]); data[i + 1] = Math.round(next[1]); data[i + 2] = Math.round(next[2]);
      }
      ctx.putImageData(new ImageData(new Uint8ClampedArray(data), canvas.width, canvas.height), 0, 0);
      resolve({ url: canvas.toDataURL('image/png'), rgba: new Uint8Array(data), width: canvas.width, height: canvas.height });
    };
    image.onerror = () => reject(new Error('The texture preview could not be decoded.'));
    image.src = `data:image/png;base64,${png}`;
  });
}

function TexturePreview({ path, active, onSelect, previewUrl }) {
  const { dataUrl, loading } = useBlpTexture(path);
  return <button className={`tw-texture-card${active ? ' active' : ''}`} onClick={onSelect} title={path}><div className="tw-texture-image">{dataUrl ? <img src={active && previewUrl ? previewUrl : dataUrl} alt="" /> : <ImageIcon size={22} />}{loading && <span className="tw-loading">Loading</span>}</div><code>{path}</code></button>;
}

function FullSetTexturePreview({ path, active, onSelect, profile }) {
  const { dataUrl, loading } = useBlpTexture(path);
  const [previewUrl, setPreviewUrl] = useState(null);
  useEffect(() => { let cancelled = false; if (!dataUrl) { setPreviewUrl(null); return undefined; } const png = dataUrl.split(',')[1]; adjustTexture(png, profile).then(result => { if (!cancelled) setPreviewUrl(result.url); }).catch(() => { if (!cancelled) setPreviewUrl(dataUrl); }); return () => { cancelled = true; }; }, [dataUrl, profile]);
  return <button className={`tw-set-texture${active ? ' active' : ''}`} onClick={onSelect} title={path}><div>{dataUrl ? <img src={previewUrl || dataUrl} alt="" /> : <ImageIcon size={18} />}{loading && <span>Loading</span>}</div><code>{path.split('\\').pop()}</code></button>;
}

export default function TextureWorkshopPage({ embedded = false, initialSetId = null }) {
  const { query, searchItemSets, readItemSet, readItemDisplayInfos, readBlpTexture, worldmapMpqPath } = useConnection();
  const [term, setTerm] = useState(''), [sets, setSets] = useState([]), [selectedSet, setSelectedSet] = useState(null), [rows, setRows] = useState([]), [selectedItem, setSelectedItem] = useState(null), [selectedTexture, setSelectedTexture] = useState(''), [status, setStatus] = useState('Search for an ItemSet to begin.'), [loading, setLoading] = useState(false), [profile, setProfile] = useState(defaults), [variantName, setVariantName] = useState(''), [variantSuffix, setVariantSuffix] = useState(''), [preview, setPreview] = useState(null), [exporting, setExporting] = useState(false), [exports, setExports] = useState([]), [showCharacterPreview, setShowCharacterPreview] = useState(false);

  const [previewMode, setPreviewMode] = useState('after');
  useEffect(() => { const timer = setTimeout(async () => { try { const result = await searchItemSets(term.trim()); setSets(result.success ? result.data || [] : []); } catch { setSets([]); } }, 220); return () => clearTimeout(timer); }, [term, searchItemSets]);
  const openSet = useCallback(async (id) => {
    setLoading(true); setRows([]); setSelectedItem(null); setSelectedTexture(''); setPreview(null); setExports([]); setStatus('Resolving source items and client display assets...');
    try {
      const source = await readItemSet(Number(id)); if (!source.success) throw new Error(source.error || 'ItemSet could not be read'); setSelectedSet(source.data);
      const dbcIds = source.data.items.map(Number).filter(Boolean);
      const dbResult = await query(`SELECT entry, name, displayid, InventoryType, Quality, ItemLevel, RequiredLevel FROM item_template WHERE ItemSet = ? OR entry IN (${dbcIds.length ? dbcIds.map(() => '?').join(',') : '0'}) ORDER BY InventoryType, entry`, [Number(id), ...dbcIds]);
      const byId = new Map((dbResult.data || []).map(item => [Number(item.entry), item])), orderedIds = [...dbcIds, ...(dbResult.data || []).map(item => Number(item.entry)).filter(itemId => !dbcIds.includes(itemId))];
      const displayIds = [...new Set(orderedIds.map(itemId => Number(byId.get(itemId)?.displayid)).filter(Boolean))], displays = worldmapMpqPath && displayIds.length ? await readItemDisplayInfos(worldmapMpqPath, displayIds) : { data: {} };
      const resolved = orderedIds.map((itemId, index) => { const item = byId.get(itemId) || { entry: itemId, name: 'Missing item_template record', displayid: 0 }; const display = displays.data?.[item.displayid] || null; return { ...item, sourceSlot: index < dbcIds.length ? index + 1 : null, display, textures: [...new Set([display?.texture1Path, display?.texture2Path, ...Object.values(display?.componentTexturePaths || {})].filter(Boolean))] }; });
      setRows(resolved); setSelectedItem(resolved[0] || null); setSelectedTexture(resolved[0]?.textures?.[0] || ''); setStatus(`${resolved.length} source items resolved${resolved.filter(row => !row.display).length ? '; some display assets are unavailable.' : '.'}`);
    } catch (error) { setStatus(error.message || 'Could not resolve this ItemSet.'); } finally { setLoading(false); }
  }, [query, readItemDisplayInfos, readItemSet, worldmapMpqPath]);
  useEffect(() => {
    if (initialSetId && Number(selectedSet?.id) !== Number(initialSetId)) openSet(initialSetId);
  }, [initialSetId, openSet, selectedSet?.id]);
  const texturePaths = useMemo(() => [...new Set(rows.flatMap(row => row.textures))], [rows]);
  useEffect(() => {
    let cancelled = false; setPreview(null);
    if (!selectedTexture || !worldmapMpqPath) return undefined;
    readBlpTexture(worldmapMpqPath, selectedTexture).then(result => result?.success && result.png ? adjustTexture(result.png, profile) : Promise.reject(new Error(result?.error || 'Texture unavailable'))).then(value => { if (!cancelled) setPreview(value); }).catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
  }, [profile, readBlpTexture, selectedTexture, worldmapMpqPath]);
  useEffect(() => { let cancelled = false; if (!texturePaths.length || !worldmapMpqPath) return undefined; Promise.all(texturePaths.map(path => readBlpTexture(worldmapMpqPath, path).then(result => result?.success && result.png ? analyzeColorsDynamic(result.png) : []).catch(() => []))).then(groups => { if (!cancelled) setProfile(current => ({ ...current, colorMappings: mergeSetColorsAdaptive(groups) })); }); return () => { cancelled = true; }; }, [texturePaths, readBlpTexture, worldmapMpqPath]);
  const updateProfile = (key, value) => setProfile(current => ({ ...current, [key]: value }));
  const updateColorMapping = (index, key, value) => setProfile(current => ({ ...current, colorMappings: current.colorMappings.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) }));
const applyPalettePreset = name => { const [primary, secondary, accent] = PALETTE_PRESETS[name]; setProfile(current => { if (name === 'Reset') return { ...current, primary, secondary, accent, colorMappings: current.colorMappings.map(row => ({ ...row, enabled: false, target: row.source })) }; const palette = [colorBytes(primary), colorBytes(secondary), colorBytes(accent)]; return { ...current, primary: '', secondary: '', accent: '', colorMappings: current.colorMappings.map(row => { const source = colorBytes(row.source) || [0, 0, 0], lightness = (source[0] + source[1] + source[2]) / 765, target = paletteTone(palette, lightness); return { ...row, target: target ? rgbHex(target) : row.target }; }) }; }); };
  const exportTexture = async (texturePath, transformed = null) => {
    const texture = transformed || await readBlpTexture(worldmapMpqPath, texturePath).then(result => result?.success && result.png ? adjustTexture(result.png, profile) : Promise.reject(new Error(result?.error || 'Texture unavailable')));
    const normalized = texturePath.replace(/\\/g, '/'), directory = normalized.split('/').slice(0, -1).join('\\');
    const outRelPath = `${directory ? `${directory}\\` : ''}${sourcePrefix(texturePath)}_${slug(variantSuffix).toLowerCase()}.blp`;
    const result = await window.azeroth.dbc.writeBlpTextureEdit(worldmapMpqPath, texturePath, toBase64(texture.rgba), toBase64(new Uint8Array(texture.width * texture.height).fill(255)), outRelPath, 'mpq-output', true);
    if (!result?.success) throw new Error(result?.error || 'BLP export failed');
    return { source: texturePath, output: result.path, absolutePath: result.stagedPath };
  };
  const exportSelected = async () => {
    if (!selectedTexture || !preview || !worldmapMpqPath) return;
    if (!variantSuffix.trim()) { setStatus('Enter a variant suffix before exporting.'); return; }
    setExporting(true);
    try {
      const row = await exportTexture(selectedTexture, preview); setExports(current => [row, ...current]);
    } catch (error) { setStatus(error.message || 'BLP export failed.'); } finally { setExporting(false); }
  };
  const exportSet = async () => {
    if (!texturePaths.length || !variantSuffix.trim() || !worldmapMpqPath) { setStatus('Select a set and enter a variant suffix before exporting.'); return; }
    setExporting(true); const created = [], failed = [];
    for (const texturePath of texturePaths) { try { created.push(await exportTexture(texturePath)); } catch (error) { failed.push(`${texturePath}: ${error.message || 'Export failed'}`); } }
    setExports(current => [...created, ...current]); setStatus(`Exported ${created.length} texture${created.length === 1 ? '' : 's'}${failed.length ? `; ${failed.length} failed.` : '.'}`); setExporting(false);
  };

  return <div className="tw-page">
    {!embedded && <header className="tw-header"><div><h1><Palette size={20} /> Texture Workshop</h1><p>Preview non-destructive item-set recolors and export unique loose BLP assets.</p></div><div className="tw-readonly"><Lock size={13} /> Phase 2 / No MPQ writes</div></header>}
    <main className="tw-workspace">
      <section className="tw-panel tw-source-panel"><div className="tw-panel-title"><Layers size={15} /> Source ItemSet</div><label className="tw-search"><Search size={14} /><input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search ItemSets by name or ID" /></label><div className="tw-set-list">{sets.map(set => <button key={set.entry} className={Number(selectedSet?.id) === Number(set.entry) ? 'active' : ''} onClick={() => openSet(set.entry)}><span>#{set.entry}</span>{set.name || 'Unnamed ItemSet'}</button>)}{!sets.length && <p>No matching ItemSets.</p>}</div><div className="tw-source-status">{loading ? 'Resolving assets...' : status}</div><div className="tw-item-list">{rows.map(row => <button key={`${row.entry}-${row.sourceSlot || 'extra'}`} className={selectedItem?.entry === row.entry ? 'active' : ''} onClick={() => { setSelectedItem(row); setSelectedTexture(row.textures[0] || ''); }}><Box size={14} /><span><b>{SLOT_NAMES[row.InventoryType] || (row.sourceSlot ? `Set slot ${row.sourceSlot}` : 'Extra item')}</b>{row.name}</span><em>#{row.displayid || 'None'}</em></button>)}</div></section>
      <section className="tw-panel tw-preview-panel"><div className="tw-panel-title"><ImageIcon size={15} /> Recolor preview <div className="tw-before-after"><button className={previewMode === 'before' ? 'active' : ''} onClick={() => setPreviewMode('before')}>Before</button><button className={previewMode === 'after' ? 'active' : ''} onClick={() => setPreviewMode('after')}>After</button></div></div>{selectedItem ? <><div className="tw-item-summary"><b>{selectedItem.name}</b><span>Item #{selectedItem.entry} / ItemDisplayInfo #{selectedItem.displayid || 'None'}</span>{selectedItem.display && <span>Models: {selectedItem.display.model1Path || selectedItem.display.model1 || 'None'}</span>}</div><div className="tw-preview-grid">{selectedItem.textures.length ? selectedItem.textures.map(path => <TexturePreview key={path} path={path} active={selectedTexture === path} previewUrl={previewMode === 'after' ? preview?.url : null} onSelect={() => setSelectedTexture(path)} />) : <div className="tw-empty"><AlertTriangle size={18} /> No resolvable BLP textures for this display.</div>}</div>{selectedTexture && <div className="tw-selected-path"><span>Selected BLP</span><code>{selectedTexture}</code></div>}</> : <div className="tw-empty">Select a source set and item to inspect its textures.</div>}</section>
      <aside className="tw-panel tw-variant-panel"><div className="tw-panel-title"><Palette size={15} /> Recolor profile</div><label>Variant name<input value={variantName} onChange={e => setVariantName(e.target.value)} placeholder="e.g. Arcanist Regalia - Frost" /></label><label>Variant suffix<input value={variantSuffix} onChange={e => setVariantSuffix(e.target.value)} placeholder="e.g. frost" /></label><div className="tw-derived-name">{selectedTexture ? `${sourcePrefix(selectedTexture)}_${slug(variantSuffix || 'variant').toLowerCase()}.blp` : 'Select a texture to preview its name.'}</div><div className="tw-control-grid">{[['hue', 'Hue shift', -180, 180], ['saturation', 'Saturation', -100, 100], ['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100]].map(([key, label, min, max]) => <label key={key}>{label}<span>{profile[key]}</span><input type="range" min={min} max={max} value={profile[key]} onChange={e => updateProfile(key, Number(e.target.value))} /></label>)}</div><div className="tw-palette-row"><b>Palette replacement</b><small>Optional: dark, mid, and bright tones map to primary, secondary, and accent.</small>{['primary', 'secondary', 'accent'].map(key => <label key={key}>{key}<input type="color" value={profile[key] || '#ffffff'} onChange={e => updateProfile(key, e.target.value)} /></label>)}</div><button className="tw-generate" disabled={!preview || exporting} onClick={exportSelected}><Download size={14} /> {exporting ? 'Exporting BLP...' : 'Export selected BLP'}</button><button className="tw-generate tw-generate-secondary" disabled={!texturePaths.length || exporting} onClick={exportSet}><Layers size={14} /> {exporting ? 'Exporting set...' : `Export full set (${texturePaths.length})`}</button><small>Writes output using each source BLP's original Item path. Existing output files are never overwritten.</small></aside>
    </main>
    <section className="tw-palette-presets"><span>Palette presets</span>{Object.keys(PALETTE_PRESETS).map(name => <button key={name} onClick={() => applyPalettePreset(name)} className={name === 'Reset' ? 'reset' : ''}>{name !== 'Reset' && <i style={{ background: PALETTE_PRESETS[name][1] }} />}{name}</button>)}<label>Palette blend <input type="range" min="0" max="100" value={profile.paletteStrength ?? 100} onChange={e => updateProfile('paletteStrength', Number(e.target.value))} /><b>{profile.paletteStrength ?? 100}%</b></label><small>Preserves dark, mid and bright detail instead of flattening a texture into one colour.</small></section>
    {profile.colorMappings.length ? <section className="tw-color-analysis"><b>Detected colour regions</b><small>Only enabled regions are recolored; the rest of this BLP is preserved.</small>{profile.colorMappings.map((row, index) => <label key={row.id}><input type="checkbox" checked={row.enabled} onChange={e => updateColorMapping(index, 'enabled', e.target.checked)} /><i style={{ background: row.source }} /><code>{row.source.toUpperCase()} · {row.coverage || '?'}%</code><input type="color" value={row.target} onChange={e => updateColorMapping(index, 'target', e.target.value)} title="New target colour" /><input type="range" min="20" max="180" value={row.tolerance} onChange={e => updateColorMapping(index, 'tolerance', Number(e.target.value))} title="Colour tolerance" /></label>)}</section> : null}
    <section className="tw-mapping-summary"><b>Set-wide mapping</b><span>{profile.colorMappings.filter(row => row.enabled).length} enabled regions · {texturePaths.length} resolved textures</span><small>Region choices stay shared across this set.</small></section>
    <section className="tw-assets"><div className="tw-panel-title">Live full-set preview <span>{texturePaths.length}</span></div>{texturePaths.length ? <div className="tw-set-texture-grid">{texturePaths.map(path => <FullSetTexturePreview key={path} path={path} active={selectedTexture === path} profile={profile} onSelect={() => setSelectedTexture(path)} />)}</div> : <p>Resolved texture paths will appear here.</p>}{exports.length ? <div className="tw-export-log">{exports.map(row => <div key={row.output}><CheckCircle2 size={13} /><code>{row.output}</code></div>)}</div> : null}</section>
    <button className="tw-floating-character" disabled={!rows.length} onClick={() => setShowCharacterPreview(true)}><UserRound size={15} /> Character preview</button>
    <TextureWorkshopGenerator sourceSet={selectedSet} rows={rows} exportedTextures={exports} />
    {showCharacterPreview && <TextureWorkshopCharacterModal rows={rows} profile={profile} onClose={() => setShowCharacterPreview(false)} />}
  </div>;
}
