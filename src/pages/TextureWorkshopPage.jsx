import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Search, Image as ImageIcon, Box, Palette, Lock, AlertTriangle } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import { useBlpTexture } from '../lib/useBlpTexture';
import './TextureWorkshopPage.css';

const SLOT_NAMES = { 1: 'Head', 2: 'Neck', 3: 'Shoulder', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands', 11: 'Finger', 12: 'Trinket', 16: 'Back', 19: 'Tabard', 20: 'Chest' };

function TexturePreview({ path, active, onSelect }) {
  const { dataUrl, loading } = useBlpTexture(path);
  return <button className={`tw-texture-card${active ? ' active' : ''}`} onClick={onSelect} title={path}>
    <div className="tw-texture-image">{dataUrl ? <img src={dataUrl} alt="" /> : <ImageIcon size={22} />}{loading && <span className="tw-loading">Loading</span>}</div>
    <code>{path}</code>
  </button>;
}

export default function TextureWorkshopPage() {
  const { query, searchItemSets, readItemSet, readItemDisplayInfos, worldmapMpqPath } = useConnection();
  const [term, setTerm] = useState('');
  const [sets, setSets] = useState([]);
  const [selectedSet, setSelectedSet] = useState(null);
  const [rows, setRows] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedTexture, setSelectedTexture] = useState('');
  const [status, setStatus] = useState('Search for an ItemSet to begin.');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const result = await searchItemSets(term.trim());
        setSets(result.success ? result.data || [] : []);
      } catch { setSets([]); }
    }, 220);
    return () => clearTimeout(timer);
  }, [term, searchItemSets]);

  const openSet = useCallback(async (id) => {
    setLoading(true); setRows([]); setSelectedItem(null); setSelectedTexture(''); setStatus('Resolving source items and client display assets…');
    try {
      const source = await readItemSet(Number(id));
      if (!source.success) throw new Error(source.error || 'ItemSet could not be read');
      setSelectedSet(source.data);
      const dbcIds = source.data.items.map(Number).filter(Boolean);
      const dbResult = await query('SELECT entry, name, displayid, InventoryType, Quality, ItemLevel, RequiredLevel FROM item_template WHERE ItemSet = ? OR entry IN (' + (dbcIds.length ? dbcIds.map(() => '?').join(',') : '0') + ') ORDER BY InventoryType, entry', [Number(id), ...dbcIds]);
      const itemsById = new Map((dbResult.data || []).map(item => [Number(item.entry), item]));
      const orderedIds = [...dbcIds, ...(dbResult.data || []).map(item => Number(item.entry)).filter(itemId => !dbcIds.includes(itemId))];
      const displayIds = [...new Set(orderedIds.map(itemId => Number(itemsById.get(itemId)?.displayid)).filter(Boolean))];
      const displays = worldmapMpqPath && displayIds.length ? await readItemDisplayInfos(worldmapMpqPath, displayIds) : { data: {} };
      const resolved = orderedIds.map((itemId, index) => {
        const item = itemsById.get(itemId) || { entry: itemId, name: 'Missing item_template record', displayid: 0 };
        const display = displays.data?.[item.displayid] || null;
        const textures = [...new Set([display?.texture1Path, display?.texture2Path, ...Object.values(display?.componentTexturePaths || {})].filter(Boolean))];
        return { ...item, sourceSlot: index < dbcIds.length ? index + 1 : null, display, textures };
      });
      setRows(resolved);
      setSelectedItem(resolved[0] || null);
      setSelectedTexture(resolved[0]?.textures?.[0] || '');
      const missing = resolved.filter(row => !row.display).length;
      setStatus(`${resolved.length} source item${resolved.length === 1 ? '' : 's'} resolved${missing ? ` · ${missing} display asset${missing === 1 ? '' : 's'} unavailable` : ''}.`);
    } catch (error) { setStatus(error.message || 'Could not resolve this ItemSet.'); }
    finally { setLoading(false); }
  }, [query, readItemDisplayInfos, readItemSet, worldmapMpqPath]);

  const texturePaths = useMemo(() => [...new Set(rows.flatMap(row => row.textures))], [rows]);

  return <div className="tw-page">
    <header className="tw-header"><div><h1><Palette size={20} /> Texture Workshop</h1><p>Inspect item-set textures now; recolor export and safe variant generation follow in later phases.</p></div><div className="tw-readonly"><Lock size={13} /> Phase 1 · Read only</div></header>
    <main className="tw-workspace">
      <section className="tw-panel tw-source-panel">
        <div className="tw-panel-title"><Layers size={15} /> Source ItemSet</div>
        <label className="tw-search"><Search size={14} /><input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search ItemSets by name or ID" /></label>
        <div className="tw-set-list">{sets.map(set => <button key={set.entry} className={Number(selectedSet?.id) === Number(set.entry) ? 'active' : ''} onClick={() => openSet(set.entry)}><span>#{set.entry}</span>{set.name || 'Unnamed ItemSet'}</button>)}{!sets.length && <p>No matching ItemSets.</p>}</div>
        <div className="tw-source-status">{loading ? 'Resolving assets…' : status}</div>
        <div className="tw-item-list">{rows.map(row => <button key={`${row.entry}-${row.sourceSlot || 'extra'}`} className={selectedItem?.entry === row.entry ? 'active' : ''} onClick={() => { setSelectedItem(row); setSelectedTexture(row.textures[0] || ''); }}><Box size={14} /><span><b>{SLOT_NAMES[row.InventoryType] || (row.sourceSlot ? `Set slot ${row.sourceSlot}` : 'Extra item')}</b>{row.name}</span><em>#{row.displayid || '—'}</em></button>)}</div>
      </section>

      <section className="tw-panel tw-preview-panel">
        <div className="tw-panel-title"><ImageIcon size={15} /> Texture preview</div>
        {selectedItem ? <><div className="tw-item-summary"><b>{selectedItem.name}</b><span>Item #{selectedItem.entry} · ItemDisplayInfo #{selectedItem.displayid || '—'}</span>{selectedItem.display && <span>Models: {selectedItem.display.model1Path || selectedItem.display.model1 || '—'}{selectedItem.display.model2Path || selectedItem.display.model2 ? ` · ${selectedItem.display.model2Path || selectedItem.display.model2}` : ''}</span>}</div>
          <div className="tw-preview-grid">{selectedItem.textures.length ? selectedItem.textures.map(path => <TexturePreview key={path} path={path} active={selectedTexture === path} onSelect={() => setSelectedTexture(path)} />) : <div className="tw-empty"><AlertTriangle size={18} /> No resolvable BLP textures for this display.</div>}</div></> : <div className="tw-empty">Select a source set and item to inspect its textures.</div>}
      </section>

      <aside className="tw-panel tw-variant-panel">
        <div className="tw-panel-title"><Palette size={15} /> Variant settings</div>
        <div className="tw-phase-note"><Lock size={16} /><div><b>Generation is locked in Phase 1</b><span>Original client assets and database records cannot be changed from this page yet.</span></div></div>
        <label>Variant name<input disabled placeholder="e.g. Arcanist Regalia — Frost" /></label>
        <label>Spec theme<input disabled placeholder="e.g. Frost Mage" /></label>
        <div className="tw-control-grid"><label>Hue shift<input disabled type="range" /></label><label>Saturation<input disabled type="range" /></label><label>Brightness<input disabled type="range" /></label><label>Contrast<input disabled type="range" /></label></div>
        <button className="tw-generate" disabled>Generate safe variant</button>
        <small>Phase 2 adds recolor preview + output BLP export. Phase 3 clones ItemDisplayInfo, item_template, and ItemSet records.</small>
      </aside>
    </main>
    <section className="tw-assets"><div className="tw-panel-title">Full-set texture assets <span>{texturePaths.length}</span></div>{texturePaths.length ? <div className="tw-assets-list">{texturePaths.map(path => <button key={path} className={selectedTexture === path ? 'active' : ''} onClick={() => setSelectedTexture(path)}><ImageIcon size={13} /><code>{path}</code></button>)}</div> : <p>Resolved texture paths will appear here.</p>}</section>
  </div>;
}
