import { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Save, Plus, Trash2, ArrowRight, Database, Box, Palette, ExternalLink } from 'lucide-react';
import TextureWorkshopPage from './TextureWorkshopPage';
import './ItemSetEditorPage.css';

const EMPTY_SET = () => ({
  id: 0, name: '', patch: 0,
  items: Array(17).fill(0),
  spells: Array(8).fill(0),
  thresholds: Array(8).fill(0),
  requiredSkill: 0, requiredSkillRank: 0,
});


const ensureItemSetNamesTable = async (query) => {
  await query(`
    CREATE TABLE IF NOT EXISTS item_set_names (
      entry INT UNSIGNED NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL DEFAULT '',
      patch INT NOT NULL DEFAULT 0
    )
  `);
};

const mergeSetResults = (dbcRows = [], dbRows = []) => {
  const merged = new Map();
  dbcRows.forEach(row => merged.set(Number(row.entry), { ...row, source: 'DBC' }));
  dbRows.forEach(row => {
    const entry = Number(row.entry);
    merged.set(entry, {
      ...(merged.get(entry) || {}),
      ...row,
      entry,
      source: merged.has(entry) ? 'DBC + custom' : 'custom',
    });
  });
  return [...merged.values()].sort((a, b) => Number(a.entry) - Number(b.entry));
};

// ── Item Search Modal ──────────────────────────────────────────────────────────
function ItemSearchModal({ onSelect, onClose, query }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!term) { setResults([]); return; }
    const t = setTimeout(async () => {
      const isId = /^\d+$/.test(term.trim());
      const sql = isId
        ? 'SELECT entry, name FROM item_template WHERE entry = ? LIMIT 50'
        : 'SELECT entry, name FROM item_template WHERE name LIKE ? LIMIT 50';
      const res = await query(sql, [isId ? Number(term) : `%${term}%`]);
      setResults(res.data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [term, query]);
  return (
    <div className="ise-modal-overlay" onClick={onClose}>
      <div className="ise-modal" onClick={e => e.stopPropagation()}>
        <div className="ise-modal-search">
          <Search size={13} />
          <input ref={inputRef} placeholder="Item name or ID..." value={term}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && onClose()} />
        </div>
        <div className="ise-modal-results">
          {!results.length && term && <div className="ise-modal-empty">No results found</div>}
          {results.map(r => (
            <div key={r.entry} className="ise-modal-row" onClick={() => onSelect(r.entry, r.name)}>
              <span className="ise-id">{r.entry}</span><span>{r.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tab 1: Set Browser ─────────────────────────────────────────────────────────
function SetBrowser({ query, searchItemSets, onEdit, onCreate, onWorkshop }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [armorFilter, setArmorFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [piecesFilter, setPiecesFilter] = useState('');
  const [qualityFilter, setQualityFilter] = useState('');
  const [slotFilter, setSlotFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [usableOnly, setUsableOnly] = useState(false);

  const search = useCallback(async (val) => {
    setLoading(true);
    setStatus('');
    try {
      const trimmed = val.trim();
      const isId = /^\d+$/.test(trimmed);
      const dbcRes = await searchItemSets(trimmed);
      let dbRows = [];

      try {
        await ensureItemSetNamesTable(query);
        const sql = isId
          ? 'SELECT entry, name, patch FROM item_set_names WHERE entry = ? LIMIT 200'
          : 'SELECT entry, name, patch FROM item_set_names WHERE name LIKE ? ORDER BY entry LIMIT 200';
        const dbRes = await query(sql, [isId ? Number(trimmed) : `%${trimmed}%`]);
        dbRows = dbRes.data || [];
      } catch (e) {
        setStatus(`Custom tabel niet leesbaar: ${e.message}`);
      }

      if (!dbcRes.success) {
        setStatus(prev => prev || `DBC niet leesbaar: ${dbcRes.error}`);
      }

      const merged = mergeSetResults(dbcRes.data || [], dbRows);
      const ids = merged.map(row => Number(row.entry)).filter(Boolean);
      let details = [];
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        const detailRes = await query(`SELECT ItemSet, class, subclass, RequiredLevel, AllowableClass, Quality, InventoryType FROM item_template WHERE ItemSet IN (${placeholders})`, ids);
        details = detailRes.data || [];
      }
      const bySet = new Map();
      details.forEach(row => {
        const id = Number(row.ItemSet); if (!bySet.has(id)) bySet.set(id, []); bySet.get(id).push(row);
      });
      setResults(merged.map(row => {
        const items = bySet.get(Number(row.entry)) || [];
        const armor = [...new Set(items.filter(item => Number(item.class) === 4).map(item => ARMOR_SUBCLASSES[item.subclass] || `Subclass ${item.subclass}`))];
        const levels = items.map(item => Number(item.RequiredLevel)).filter(Boolean);
        const masks = items.map(item => Number(item.AllowableClass)).filter(Boolean);
        return { ...row, itemCount: items.length, armor, qualities: [...new Set(items.map(item => Number(item.Quality)))], slots: [...new Set(items.map(item => Number(item.InventoryType)))], minLevel: levels.length ? Math.min(...levels) : 0, maxLevel: levels.length ? Math.max(...levels) : 0, classMask: masks.reduce((mask, value) => mask | value, 0) };
      }));
    } finally {
      setLoading(false);
    }
  }, [query, searchItemSets]);

  useEffect(() => {
    const t = setTimeout(() => search(term), 200);
    return () => clearTimeout(t);
  }, [term, search]);

  const filtered = results.filter(row => {
    if (armorFilter && !row.armor?.includes(armorFilter)) return false;
    if (classFilter && !(Number(row.classMask) & Number(classFilter))) return false;
    if (levelFilter === '1-30' && Number(row.maxLevel) > 30) return false;
    if (levelFilter === '31-50' && (Number(row.maxLevel) < 31 || Number(row.maxLevel) > 50)) return false;
    if (levelFilter === '51-60' && (Number(row.maxLevel) < 51 || Number(row.maxLevel) > 60)) return false;
    if (levelFilter === '61+' && Number(row.maxLevel) < 61) return false;
    if (piecesFilter === '2' && Number(row.itemCount) !== 2) return false;
    if (piecesFilter === '3-4' && (Number(row.itemCount) < 3 || Number(row.itemCount) > 4)) return false;
    if (piecesFilter === '5-7' && (Number(row.itemCount) < 5 || Number(row.itemCount) > 7)) return false;
    if (piecesFilter === '8+' && Number(row.itemCount) < 8) return false;
    if (qualityFilter !== '' && !row.qualities?.includes(Number(qualityFilter))) return false;
    if (slotFilter !== '' && !row.slots?.includes(Number(slotFilter))) return false;
    if (sourceFilter && row.source !== sourceFilter) return false;
    if (usableOnly && !Number(row.itemCount)) return false;
    return true;
  });

  return (
    <div className="ise-browser">
      <div className="ise-browser-top">
        <div className="ise-browser-search">
          <Search size={13} className="ise-search-icon" />
        <input className="ise-search-input" placeholder="Search by name or ID…"
            value={term} onChange={e => setTerm(e.target.value)} />
        </div>
        <button className="ise-btn" onClick={onCreate}><Plus size={14} /> New custom set</button>
      </div>
      <div className="ise-filter-row">
        <label>Armor<select value={armorFilter} onChange={e => setArmorFilter(e.target.value)}><option value="">All armor</option><option>Cloth</option><option>Leather</option><option>Mail</option><option>Plate</option></select></label>
        <label>Class<select value={classFilter} onChange={e => setClassFilter(e.target.value)}><option value="">All classes</option>{CLASS_NAMES.map((name, index) => <option key={name} value={1 << index}>{name}</option>)}</select></label>
        <label>Level<select value={levelFilter} onChange={e => setLevelFilter(e.target.value)}><option value="">All levels</option><option value="1-30">1–30</option><option value="31-50">31–50</option><option value="51-60">51–60</option><option value="61+">61+</option></select></label>
        <label>Pieces<select value={piecesFilter} onChange={e => setPiecesFilter(e.target.value)}><option value="">Any count</option><option value="2">2 pieces</option><option value="3-4">3–4 pieces</option><option value="5-7">5–7 pieces</option><option value="8+">8+ pieces</option></select></label>
        <label>Quality<select value={qualityFilter} onChange={e => setQualityFilter(e.target.value)}><option value="">Any quality</option><option value="2">Uncommon</option><option value="3">Rare</option><option value="4">Epic</option><option value="5">Legendary</option></select></label>
        <label>Contains slot<select value={slotFilter} onChange={e => setSlotFilter(e.target.value)}><option value="">Any slot</option><option value="1">Head</option><option value="3">Shoulder</option><option value="5">Chest</option><option value="7">Legs</option><option value="10">Hands</option><option value="16">Back</option></select></label>
        <label>Source<select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}><option value="">All sources</option><option value="DBC">DBC</option><option value="custom">Custom</option><option value="DBC + custom">DBC + custom</option></select></label>
        <label className="ise-filter-check"><input type="checkbox" checked={usableOnly} onChange={e => setUsableOnly(e.target.checked)} /> Has items</label>
        {(armorFilter || classFilter || levelFilter || piecesFilter || qualityFilter || slotFilter || sourceFilter || usableOnly) && <button className="ise-filter-clear" onClick={() => { setArmorFilter(''); setClassFilter(''); setLevelFilter(''); setPiecesFilter(''); setQualityFilter(''); setSlotFilter(''); setSourceFilter(''); setUsableOnly(false); }}>Clear filters</button>}
      </div>
      {loading && <div className="ise-help">Searching...</div>}
      {status && <div className="ise-warning">{status}</div>}
      <table className="ise-table ise-browser-table">
        <thead><tr><th>ID</th><th>Name</th><th>Armor</th><th>Level</th><th>Classes</th><th>Pieces</th><th>Source</th><th>Patch</th><th></th></tr></thead>
        <tbody>
          {!loading && filtered.length === 0 && (
            <tr><td colSpan={9} className="ise-empty">No sets found</td></tr>
          )}
          {filtered.map(r => (
            <tr key={r.entry} className="ise-clickable-row" onClick={() => onEdit(r.entry)} title="Open in editor">
              <td className="ise-id">{r.entry}</td>
              <td>{r.name}</td>
              <td>{r.armor?.join(' / ') || <span className="ise-muted">—</span>}</td>
              <td>{r.maxLevel ? (r.minLevel && r.minLevel !== r.maxLevel ? `${r.minLevel}–${r.maxLevel}` : r.maxLevel) : <span className="ise-muted">—</span>}</td>
              <td className="ise-browser-classes" title={classMaskLabel(r.classMask)}>{classMaskLabel(r.classMask)}</td>
              <td>{r.itemCount || <span className="ise-muted">—</span>}</td>
              <td className="ise-muted ise-source-cell"><Database size={11} /> {r.source}</td>
              <td className="ise-muted">{r.patch}</td>
              <td>
                <button className="ise-icon-btn" title="Open in Texture Workshop" onClick={(e) => { e.stopPropagation(); onWorkshop(r.entry); }}>
                  <Palette size={13} />
                </button>
                <button className="ise-icon-btn" title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(r.entry); }}>
                  <ArrowRight size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab 2: Set Editor ──────────────────────────────────────────────────────────
const ITEM_CLASSES = { 0: 'Consumable', 1: 'Container', 2: 'Weapon', 3: 'Gem', 4: 'Armor', 5: 'Reagent', 6: 'Projectile', 7: 'Trade Goods', 9: 'Recipe', 11: 'Quiver', 12: 'Quest', 15: 'Miscellaneous', 16: 'Glyph' };
const ARMOR_SUBCLASSES = { 0: 'Miscellaneous', 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 5: 'Cosmetic', 6: 'Shield', 7: 'Libram', 8: 'Idol', 9: 'Totem', 10: 'Sigil' };
const QUALITY_NAMES = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom'];
const INVENTORY_SLOTS = { 1: 'Head', 2: 'Neck', 3: 'Shoulder', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands', 11: 'Finger', 12: 'Trinket', 13: 'One-Hand', 14: 'Off-Hand', 15: 'Ranged', 16: 'Back', 17: 'Two-Hand', 18: 'Bag', 19: 'Tabard', 20: 'Chest', 21: 'Main Hand', 22: 'Off Hand', 23: 'Held In Off-hand', 28: 'Relic' };
const CLASS_NAMES = ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Death Knight', 'Shaman', 'Mage', 'Warlock', 'Monk', 'Druid'];
const classMaskLabel = mask => !Number(mask) || Number(mask) === -1 ? 'All classes' : CLASS_NAMES.filter((name, index) => Number(mask) & (1 << index)).join(', ') || `Mask ${mask}`;
const ITEM_STAT_NAMES = { 0: 'Mana', 1: 'Health', 3: 'Agility', 4: 'Strength', 5: 'Intellect', 6: 'Spirit', 7: 'Stamina', 12: 'Defense Rating', 13: 'Dodge Rating', 14: 'Parry Rating', 15: 'Block Rating', 16: 'Melee Hit Rating', 17: 'Ranged Hit Rating', 18: 'Spell Hit Rating', 19: 'Melee Crit Rating', 20: 'Ranged Crit Rating', 21: 'Spell Crit Rating', 22: 'Melee Hit Avoidance', 23: 'Ranged Hit Avoidance', 24: 'Spell Hit Avoidance', 25: 'Melee Crit Avoidance', 26: 'Ranged Crit Avoidance', 27: 'Spell Crit Avoidance', 28: 'Melee Haste Rating', 29: 'Ranged Haste Rating', 30: 'Spell Haste Rating', 31: 'Hit Rating', 32: 'Crit Rating', 33: 'Hit Avoidance', 34: 'Crit Avoidance', 35: 'Resilience Rating', 36: 'Haste Rating', 37: 'Expertise Rating', 38: 'Attack Power', 39: 'Ranged Attack Power', 40: 'Feral Attack Power', 41: 'Spell Healing', 42: 'Spell Damage', 43: 'Mana per 5 sec.', 44: 'Armor Penetration', 45: 'Spell Power', 46: 'Health per 5 sec.', 47: 'Spell Penetration', 48: 'Block Value' };

function ItemInspector({ itemId, setId, slot, query, readItemIcons, getIcon, readItemDisplayInfos, worldmapMpqPath, onOpenItem }) {
  const [item, setItem] = useState(null);
  const [iconUrl, setIconUrl] = useState('');
  const [display, setDisplay] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setItem(null); setIconUrl(''); setDisplay(null);
    if (!itemId) return undefined;
    (async () => {
      const result = await query('SELECT entry, name, displayid, class, subclass, Quality, ItemLevel, RequiredLevel, AllowableClass, InventoryType, ItemSet, armor, dmg_min1, dmg_max1, delay, stat_type1, stat_value1, stat_type2, stat_value2, stat_type3, stat_value3 FROM item_template WHERE entry = ? LIMIT 1', [itemId]);
      const row = result.data?.[0] || null;
      if (cancelled || !row) return;
      setItem(row);
      const [icons, displays] = await Promise.all([
        readItemIcons([itemId]),
        row.displayid && worldmapMpqPath ? readItemDisplayInfos(worldmapMpqPath, [row.displayid]) : Promise.resolve({ data: {} }),
      ]);
      if (cancelled) return;
      setDisplay(displays.data?.[row.displayid] || null);
      const iconName = icons.data?.[itemId] || displays.data?.[row.displayid]?.icon1 || displays.data?.[row.displayid]?.icon2;
      if (iconName) {
        const image = await getIcon(iconName);
        if (!cancelled && typeof image === 'string') setIconUrl(image);
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [itemId, query, readItemIcons, getIcon, readItemDisplayInfos, worldmapMpqPath]);

  if (!itemId) return <aside className="ise-inspector"><h2>Inspector</h2><div className="ise-inspector-empty">Select an item slot to inspect its stats, display assets, texture paths, and geosets.</div></aside>;
  if (!item) return <aside className="ise-inspector"><h2>Inspector</h2><div className="ise-inspector-empty">Loading item #{itemId}…</div></aside>;
  const stats = [1, 2, 3].map(index => ({ type: item[`stat_type${index}`], value: item[`stat_value${index}`] })).filter(row => Number(row.value));
  const texturePaths = [display?.texture1Path, display?.texture2Path, ...Object.values(display?.componentTexturePaths || {})].filter(Boolean);
  return <aside className="ise-inspector">
    <div className="ise-inspector-title"><h2>Item Inspector</h2><span>Set slot {slot + 1}</span></div>
    <div className="ise-item-heading">
      <div className="ise-item-icon">{iconUrl ? <img src={iconUrl} alt="" /> : <Box size={25} />}</div>
      <div><strong>{item.name}</strong><small>Item #{item.entry} · Display #{item.displayid || '—'}</small></div>
    </div>
    <button className="ise-inspector-link" onClick={() => onOpenItem(item.entry)}><ExternalLink size={13}/> Open full Item Editor</button>
    <section><h3>Stats & requirements</h3><dl className="ise-inspector-grid">
      <div><dt>Type</dt><dd>{ITEM_CLASSES[item.class] || `Class ${item.class}`}{Number(item.class) === 4 ? ` · ${ARMOR_SUBCLASSES[item.subclass] || item.subclass}` : ''}</dd></div>
      <div><dt>Quality / iLvl</dt><dd>{QUALITY_NAMES[item.Quality] || item.Quality} / {item.ItemLevel}</dd></div>
      <div><dt>Required level</dt><dd>{item.RequiredLevel || '—'}</dd></div>
      <div><dt>Inventory slot</dt><dd>{INVENTORY_SLOTS[item.InventoryType] || item.InventoryType || '—'}</dd></div>
      <div><dt>Class restriction</dt><dd title={classMaskLabel(item.AllowableClass)}>{classMaskLabel(item.AllowableClass)}</dd></div>
      <div><dt>Item set</dt><dd>{item.ItemSet ? `#${item.ItemSet}${Number(item.ItemSet) === Number(setId) ? ' · current set' : ''}` : 'Not assigned'}</dd></div>
    </dl>{stats.length ? <div className="ise-stat-list">{stats.map((stat, index) => <span key={index}>{ITEM_STAT_NAMES[stat.type] || `Stat ${stat.type}`}: <b>{stat.value}</b></span>)}</div> : null}{Number(item.armor) ? <div className="ise-stat-list"><span>Armor: <b>{item.armor}</b></span></div> : null}{Number(item.dmg_max1) ? <div className="ise-stat-list"><span>Damage: <b>{item.dmg_min1}–{item.dmg_max1}</b></span><span>Speed: <b>{(Number(item.delay) / 1000).toFixed(2)}</b></span></div> : null}</section>
    <section><h3>Appearance</h3>
      {!display ? <small className="ise-muted">No ItemDisplayInfo assets resolved. Configure client Data to inspect them.</small> : <>
        <div className="ise-asset-line"><b>Models</b><span title={display.model1Path || display.model1 || ''}>{display.model1Path || display.model1 || '—'}{display.model2Path || display.model2 ? ` · ${display.model2Path || display.model2}` : ''}</span></div>
        <div className="ise-asset-line"><b>Textures</b><span>{texturePaths.length ? `${texturePaths.length} resolved BLP asset${texturePaths.length === 1 ? '' : 's'}` : 'No BLP assets'}</span></div>
        {texturePaths.length ? <div className="ise-texture-paths">{texturePaths.map(texture => <code key={texture} title={texture}>{texture}</code>)}</div> : null}
        <div className="ise-geosets"><b>Character geoset groups</b>{[0, 1, 2].map(index => { const value = Number(display.geosets?.[index]) || 0; return <span key={index} title={value ? `ItemDisplayInfo GeosetGroup_${index + 1}: ${value}` : `ItemDisplayInfo GeosetGroup_${index + 1}: no override`}>Group {index + 1}: {value || 'base / no override'}</span>; })}</div>
        <div className="ise-inspector-note"><Palette size={13}/> Helm and shoulders commonly use M2 models; chest, legs, and similar armor normally use component textures plus these character geoset groups. Editing remains read-only until the display-clone workflow is added.</div>
      </>}
    </section>
  </aside>;
}

function SetEditor({ query, searchSpellsDbc, readItemSet, writeItemSet, findNextItemSetId, initialId, createNonce, onSaved, readItemIcons, getIcon, readItemDisplayInfos, worldmapMpqPath, onOpenItem }) {
  const [set, setSet] = useState(EMPTY_SET());
  const [itemNames, setItemNames] = useState({});
  const [spellNames, setSpellNames] = useState({});
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(null);

  const resolveItemName = useCallback(async (id) => {
    if (!id || itemNames[id] !== undefined) return;
    const res = await query('SELECT name FROM item_template WHERE entry = ? LIMIT 1', [id]);
    setItemNames(prev => ({ ...prev, [id]: res.data?.[0]?.name || '?' }));
  }, [query, itemNames]);

  const resolveSpellName = useCallback(async (id) => {
    if (!id || spellNames[id] !== undefined) return;
    const res = await searchSpellsDbc(String(id));
    const match = res.data?.find(s => Number(s.ID) === Number(id));
    const label = match?.Name_Lang_enUS ? `${match.Name_Lang_enUS}${match.NameSubtext_Lang_enUS ? ` (${match.NameSubtext_Lang_enUS})` : ''}` : '?';
    setSpellNames(prev => ({ ...prev, [id]: label }));
  }, [searchSpellsDbc, spellNames]);

  useEffect(() => {
    set.items.forEach(id => id && resolveItemName(id));
    set.spells.forEach(id => id && resolveSpellName(id));
  }, [set.items, set.spells]);

  const loadSet = useCallback(async (id) => {
    let dbRes = { data: [] };
    const dbcRes = await readItemSet(id);
    try {
      await ensureItemSetNamesTable(query);
      dbRes = await query('SELECT * FROM item_set_names WHERE entry = ? LIMIT 1', [id]);
    } catch {
      dbRes = { data: [] };
    }
    const dbRow = dbRes.data?.[0];
    const dbc = dbcRes.success ? dbcRes.data : null;
    setSet({
      id,
      name: dbRow?.name || dbc?.name || '',
      patch: dbRow?.patch ?? 0,
      items: dbc?.items || Array(17).fill(0),
      spells: dbc?.spells || Array(8).fill(0),
      thresholds: dbc?.thresholds || Array(8).fill(0),
      requiredSkill: dbc?.requiredSkill || 0,
      requiredSkillRank: dbc?.requiredSkillRank || 0,
    });
    setStatus(!dbcRes.success ? `⚠ No DBC record for set ID ${id}` : '');
  }, [query, readItemSet]);

  useEffect(() => { if (initialId) loadSet(initialId); }, [initialId, loadSet]);

  const handleNew = async () => {
    const res = await findNextItemSetId();
    setSet({ ...EMPTY_SET(), id: res.success ? res.id : 0 });
    setItemNames({});
    setSpellNames({});
    setStatus('');
  };

  useEffect(() => { if (createNonce) handleNew(); }, [createNonce]);

  const handleSave = async () => {
    setStatus('Saving…');
    try {
      if (!set.id) { setStatus('Choose a valid set ID first.'); return; }
      if (!set.name.trim()) { setStatus('A set name is required.'); return; }
      await ensureItemSetNamesTable(query);
      await query('DELETE FROM item_set_names WHERE entry = ?', [set.id]);
      await query('INSERT INTO item_set_names (entry, name, patch) VALUES (?, ?, ?)', [set.id, set.name, set.patch]);
      const dbcRes = await writeItemSet(set);
      if (!dbcRes.success) { setStatus(`DBC error: ${dbcRes.error}`); return; }
      setStatus('Saved.');
      onSaved?.();
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
  };

  const setItemAtSlot = (i, itemId, name) => {
    setSet(s => { const items = [...s.items]; items[i] = itemId; return { ...s, items }; });
    if (name) setItemNames(prev => ({ ...prev, [itemId]: name }));
  };

  const setBonus = (i, field, val) => {
    setSet(s => { const arr = [...s[field]]; arr[i] = Number(val) || 0; return { ...s, [field]: arr }; });
  };

  return (
    <div className="ise-workbench">
    <div className="ise-editor">
      <div className="ise-toolbar">
        <button className="ise-btn" onClick={handleNew}><Plus size={14} /> New set</button>
        <button className="ise-btn primary" onClick={handleSave}><Save size={14} /> Save set</button>
        {status && <span className="ise-status">{status}</span>}
      </div>

      <div className="ise-form">
        <label>Set ID<input readOnly value={set.id} className="ise-input readonly" /></label>
        <label>Name<input value={set.name} onChange={e => setSet(s => ({ ...s, name: e.target.value }))} className="ise-input" /></label>
        <label>Patch<input type="text" inputMode="numeric" value={set.patch} onChange={e => setSet(s => ({ ...s, patch: Number(e.target.value) || 0 }))} className="ise-input short" /></label>
        <label>Req. Skill<input type="text" inputMode="numeric" value={set.requiredSkill} onChange={e => setSet(s => ({ ...s, requiredSkill: Number(e.target.value) || 0 }))} className="ise-input short" /></label>
        <label>Req. Rank<input type="text" inputMode="numeric" value={set.requiredSkillRank} onChange={e => setSet(s => ({ ...s, requiredSkillRank: Number(e.target.value) || 0 }))} className="ise-input short" /></label>
      </div>

      <div className="ise-sections">
        <section className="ise-section">
          <h2 className="ise-section-title">Set Items <span className="ise-muted">(17 slots)</span></h2>
          <table className="ise-table">
            <thead><tr><th>#</th><th>Item ID</th><th>Name</th><th></th></tr></thead>
            <tbody>
              {set.items.map((itemId, i) => (
                <tr key={i} className={selectedSlot === i ? 'ise-selected-slot' : ''} onClick={() => setSelectedSlot(i)}>
                  <td className="ise-muted">{i + 1}</td>
                  <td>
                    <input type="text" inputMode="numeric" className="ise-cell-input"
                      value={itemId || ''}
                      onChange={e => setItemAtSlot(i, Number(e.target.value) || 0, null)}
                      onBlur={e => { const id = Number(e.target.value); if (id) resolveItemName(id); }} />
                  </td>
                  <td className="ise-name-cell">{itemId ? (itemNames[itemId] ?? '…') : ''}</td>
                  <td>
                    <button className="ise-icon-btn" onClick={() => setModal({ slot: i })}><Search size={12} /></button>
                    {itemId > 0 && <button className="ise-icon-btn danger" onClick={() => setItemAtSlot(i, 0, null)}><Trash2 size={12} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="ise-section">
          <h2 className="ise-section-title">Set Bonuses <span className="ise-muted">(8 max)</span></h2>
          <table className="ise-table">
            <thead><tr><th>Pieces</th><th>Spell ID</th><th>Spell name</th></tr></thead>
            <tbody>
              {set.spells.map((spellId, i) => (
                <tr key={i}>
                  <td>
                    <input type="text" inputMode="numeric" className="ise-cell-input short"
                      value={set.thresholds[i] || ''}
                      onChange={e => setBonus(i, 'thresholds', e.target.value)} />
                  </td>
                  <td>
                    <input type="text" inputMode="numeric" className="ise-cell-input"
                      value={spellId || ''}
                      onChange={e => setBonus(i, 'spells', e.target.value)}
                      onBlur={e => { const id = Number(e.target.value); if (id) resolveSpellName(id); }} />
                  </td>
                  <td className="ise-name-cell">{spellId ? (spellNames[spellId] ?? '…') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {modal && (
        <ItemSearchModal
          query={query}
          onSelect={(id, name) => { setItemAtSlot(modal.slot, id, name); setModal(null); }}
          onClose={() => setModal(null)} />
      )}
    </div>
    <ItemInspector itemId={selectedSlot === null ? 0 : set.items[selectedSlot]} setId={set.id} slot={selectedSlot ?? 0} query={query} readItemIcons={readItemIcons} getIcon={getIcon} readItemDisplayInfos={readItemDisplayInfos} worldmapMpqPath={worldmapMpqPath} onOpenItem={onOpenItem} />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function ItemSetEditorPage() {
  const { query, searchSpellsDbc, readItemSet, searchItemSets, writeItemSet, findNextItemSetId, readItemIcons, getIcon, readItemDisplayInfos, worldmapMpqPath } = useConnection();
  const [tab, setTab] = useState('browse');
  const [editId, setEditId] = useState(null);
  const [browserKey, setBrowserKey] = useState(0);
  const [createNonce, setCreateNonce] = useState(0);
  const [workshopSetId, setWorkshopSetId] = useState(null);

  const handleEdit = (id) => {
    setEditId(id);
    setTab('editor');
  };

  const handleCreate = () => {
    setEditId(null);
    setCreateNonce(n => n + 1);
    setTab('editor');
  };

  return (
    <div className="ise-page">
      <div className="ise-header">
        <h1 className="ise-title">Item Sets</h1>
        <p className="ise-sub">ItemSet.dbc + item_set_names</p>
      </div>

      <div className="ise-tabs">
        <button className={`ise-tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>Browse / New</button>
        <button className={`ise-tab ${tab === 'editor' ? 'active' : ''}`} onClick={() => setTab('editor')}>Edit Set</button>
        <button className={`ise-tab ${tab === 'workshop' ? 'active' : ''}`} onClick={() => setTab('workshop')}>Texture Workshop</button>
      </div>

      <div className="ise-tab-content" style={{ display: tab === 'browse' ? 'block' : 'none' }}>
        <SetBrowser
          key={browserKey}
          query={query}
          searchItemSets={searchItemSets}
          onEdit={handleEdit}
          onCreate={handleCreate}
          onWorkshop={(id) => { setWorkshopSetId(id); setTab('workshop'); }}
        />
      </div>
      <div className="ise-tab-content" style={{ display: tab === 'editor' ? 'block' : 'none' }}>
        <SetEditor
          query={query}
          searchSpellsDbc={searchSpellsDbc}
          readItemSet={readItemSet}
          writeItemSet={writeItemSet}
          findNextItemSetId={findNextItemSetId}
          initialId={editId}
          createNonce={createNonce}
          onSaved={() => setBrowserKey(k => k + 1)}
          readItemIcons={readItemIcons}
          getIcon={getIcon}
          readItemDisplayInfos={readItemDisplayInfos}
          worldmapMpqPath={worldmapMpqPath}
          onOpenItem={() => { window.location.hash = '#/items'; }}
        />
      </div>
      <div className="ise-workshop-tab" style={{ display: tab === 'workshop' ? 'flex' : 'none' }}><TextureWorkshopPage embedded initialSetId={workshopSetId} /></div>
    </div>
  );
}
