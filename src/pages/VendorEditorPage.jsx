import { useState, useCallback, useEffect, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Plus, Trash2, Save } from 'lucide-react';
import './VendorEditorPage.css';

const QUALITY_COLOR = {
  0: '#9d9d9d', // Poor
  1: '#ffffff', // Common
  2: '#1eff00', // Uncommon
  3: '#0070dd', // Rare
  4: '#a335ee', // Epic
  5: '#ff8000', // Legendary
  6: '#e6cc80', // Artifact
};

const EMPTY_ROW = (entry = 0) => ({
  entry, slot: 0, item: 0, maxcount: 0, incrtime: 0, ExtendedCost: 0, type: 1, VerifiedBuild: 0,
});

// ── Subname autocomplete ──────────────────────────────────────────────────────
function SubnameSearch({ query, value, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!value) { setSuggestions([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      const res = await query(
        `SELECT DISTINCT ct.subname FROM creature_template ct
         WHERE ct.subname LIKE ? AND ct.subname != ''
         AND EXISTS (SELECT 1 FROM npc_vendor nv WHERE nv.entry = ct.entry)
         ORDER BY ct.subname LIMIT 20`,
        [`%${value}%`]
      );
      setSuggestions((res.data || []).map(r => r.subname));
      setOpen(true);
    }, 200);
    return () => clearTimeout(t);
  }, [value, query]);

  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="vendor-entry-wrap" ref={wrapRef}>
      <div className="vendor-entry-field">
        <input
          className="vendor-entry-input"
          placeholder="Subname filter…"
          value={value}
          onChange={e => { onChange(e.target.value); }}
          onFocus={() => suggestions.length && setOpen(true)}
          onKeyDown={e => e.key === 'Escape' && setOpen(false)}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="vendor-entry-dropdown">
          {suggestions.map(s => (
            <div key={s} className="vendor-entry-option" onMouseDown={() => { onChange(s); setOpen(false); }}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── NPC zoekbalk met filters ──────────────────────────────────────────────────
function NpcSearch({ query, onLoad }) {
  const [term, setTerm] = useState('');
  const [subname, setSubname] = useState('');
  const [minItems, setMinItems] = useState('');
  const [repairOnly, setRepairOnly] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!term) { setSuggestions([]); setOpen(false); return; }
    const isId = /^\d+$/.test(term.trim());
    const t = setTimeout(async () => {
      const conditions = ['EXISTS (SELECT 1 FROM npc_vendor nv WHERE nv.entry = ct.entry)'];
      const params = [];

      if (isId) {
        conditions.unshift('ct.entry = ?');
        params.push(Number(term));
      } else {
        conditions.unshift('ct.name LIKE ?');
        params.push(`%${term}%`);
      }
      if (subname) { conditions.push('ct.subname LIKE ?'); params.push(`%${subname}%`); }
      if (repairOnly) conditions.push('(ct.npcflag & 4096) > 0');
      if (minItems && Number(minItems) > 0) {
        conditions.push('(SELECT COUNT(*) FROM npc_vendor nv2 WHERE nv2.entry = ct.entry) >= ?');
        params.push(Number(minItems));
      }

      const sql = `SELECT ct.entry, ct.name, ct.subname,
        (SELECT COUNT(*) FROM npc_vendor nv3 WHERE nv3.entry = ct.entry) AS itemCount
        FROM creature_template ct WHERE ${conditions.join(' AND ')} LIMIT 20`;
      const res = await query(sql, params);
      setSuggestions(res.data || []);
      setOpen(true);
    }, 200);
    return () => clearTimeout(t);
  }, [term, subname, minItems, repairOnly, query]);

  useEffect(() => {
    const handler = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (entry, name) => {
    setTerm(String(entry));
    setLabel(name);
    setSuggestions([]);
    setOpen(false);
    onLoad(entry, name);
  };

  const handleKey = e => {
    if (e.key === 'Enter') {
      const id = Number(term);
      if (id) { setOpen(false); onLoad(id, ''); }
    }
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="vendor-search-wrap">
      <div className="vendor-filters">
        <div className="vendor-entry-wrap" ref={wrapRef}>
          <div className="vendor-entry-field">
            <Search size={13} className="vendor-entry-icon" />
            <input
              className="vendor-entry-input"
              placeholder="Naam of entry ID…"
              value={term}
              onChange={e => { setTerm(e.target.value); setLabel(''); }}
              onKeyDown={handleKey}
              onFocus={() => suggestions.length && setOpen(true)}
            />
            {label && <span className="vendor-entry-label">{label}</span>}
          </div>
          {open && suggestions.length > 0 && (
            <div className="vendor-entry-dropdown">
              {suggestions.map(r => (
                <div key={r.entry} className="vendor-entry-option" onMouseDown={() => select(r.entry, r.name)}>
                  <span className="vendor-entry-id">{r.entry}</span>
                  <span className="vendor-entry-name">{r.name}</span>
                  {r.subname ? <span className="vendor-entry-sub">{r.subname}</span> : null}
                  <span className="vendor-entry-count">{r.itemCount} items</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <SubnameSearch query={query} value={subname} onChange={setSubname} />

        <div className="vendor-entry-field vendor-filter-field vendor-filter-narrow">
          <input
            className="vendor-entry-input"
            type="number"
            placeholder="Min. items"
            value={minItems}
            onChange={e => setMinItems(e.target.value)}
            onWheel={e => e.target.blur()}
            style={{ width: 70 }}
          />
        </div>

        <label className="vendor-filter-check">
          <input type="checkbox" checked={repairOnly} onChange={e => setRepairOnly(e.target.checked)} />
          Repair
        </label>
      </div>
    </div>
  );
}

// ── Item zoekmodal ────────────────────────────────────────────────────────────
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
        ? 'SELECT entry, name, Quality FROM item_template WHERE entry = ? LIMIT 50'
        : 'SELECT entry, name, Quality FROM item_template WHERE name LIKE ? LIMIT 50';
      const res = await query(sql, [isId ? Number(term) : `%${term}%`]);
      setResults(res.data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [term, query]);

  return (
    <div className="vendor-modal-overlay" onClick={onClose}>
      <div className="vendor-modal" onClick={e => e.stopPropagation()}>
        <div className="vendor-modal-search">
          <Search size={13} />
          <input
            ref={inputRef}
            placeholder="Naam of item ID..."
            value={term}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && onClose()}
          />
        </div>
        <div className="vendor-modal-results">
          {results.length === 0 && term && <div className="vendor-modal-empty">Geen resultaten</div>}
          {results.map(r => (
            <div key={r.entry} className="vendor-modal-row" onClick={() => onSelect(r.entry, r.name)}>
              <span className="vendor-modal-id">{r.entry}</span>
              <span style={{ color: QUALITY_COLOR[r.Quality] }}>{r.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Hoofdpagina ───────────────────────────────────────────────────────────────
export default function VendorEditorPage() {
  const { query } = useConnection();
  const [entryId, setEntryId] = useState(null);
  const [npcName, setNpcName] = useState('');
  const [rows, setRows] = useState([]);
  const [itemNames, setItemNames] = useState({});
  const [itemQualities, setItemQualities] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [searchFor, setSearchFor] = useState(null); // row index

  const fetchNames = useCallback(async (rowList) => {
    const ids = [...new Set(rowList.map(r => Number(r.item)).filter(Boolean))];
    if (!ids.length) return;
    const ph = ids.map(() => '?').join(',');
    const res = await query(`SELECT entry, name, Quality FROM item_template WHERE entry IN (${ph})`, ids);
    const names = {}, qualities = {};
    (res.data || []).forEach(r => { names[r.entry] = r.name; qualities[r.entry] = r.Quality; });
    setItemNames(names);
    setItemQualities(prev => ({ ...prev, ...qualities }));
  }, [query]);

  const load = useCallback(async (id, name) => {
    setEntryId(id);
    setNpcName(name);
    const res = await query('SELECT * FROM npc_vendor WHERE entry = ? ORDER BY slot, item', [id]);
    const data = res.data?.length ? res.data : [EMPTY_ROW(id)];
    setRows(data);
    setLoaded(true);
    setStatus('');
    await fetchNames(data);
  }, [query, fetchNames]);

  const update = (i, col, val) => {
    setRows(prev => { const next = [...prev]; next[i] = { ...next[i], [col]: val }; return next; });
  };

  const resolveItemName = async (itemId) => {
    const id = Number(itemId);
    if (!id) return;
    const res = await query('SELECT name, Quality FROM item_template WHERE entry = ? LIMIT 1', [id]);
    const row = res.data?.[0];
    if (row) {
      setItemNames(prev => ({ ...prev, [id]: row.name }));
      setItemQualities(prev => ({ ...prev, [id]: row.Quality }));
    }
  };

  const addRow = () => setRows(prev => [...prev, EMPTY_ROW(entryId)]);
  const deleteRow = (i) => setRows(prev => prev.filter((_, j) => j !== i));

  const handleItemSelect = (rowIndex, itemEntry, itemName) => {
    setRows(prev => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], item: itemEntry };
      return next;
    });
    setItemNames(prev => ({ ...prev, [itemEntry]: itemName }));
    setSearchFor(null);
  };

  const save = async () => {
    if (!loaded || !entryId) return;
    setSaving(true);
    setStatus('');
    try {
      await query('DELETE FROM npc_vendor WHERE entry = ?', [entryId]);
      for (const row of rows) {
        if (!Number(row.item)) continue;
        await query(
          'INSERT INTO npc_vendor (entry, slot, item, maxcount, incrtime, ExtendedCost, type, VerifiedBuild) VALUES (?,?,?,?,?,?,?,?)',
          [entryId, row.slot ?? 0, row.item, row.maxcount ?? 0, row.incrtime ?? 0, row.ExtendedCost ?? 0, row.type ?? 1, row.VerifiedBuild ?? 0]
        );
      }
      setStatus('Opgeslagen.');
    } catch (e) {
      setStatus('Fout: ' + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="vendor-editor">
      <h1 className="vendor-editor-title">Vendor Editor</h1>
      <p className="vendor-editor-subtitle">Beheer vendor-items voor NPCs via npc_vendor</p>

      <div className="vendor-toolbar">
        <NpcSearch query={query} onLoad={load} />
      </div>

      {loaded && (
        <>
          <div className="vendor-table-wrap">
            <table className="vendor-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="vendor-td-name">Naam</th>
                  <th>Slot</th>
                  <th>MaxCount</th>
                  <th>IncrTime</th>
                  <th>ExtendedCost</th>
                  <th>Type</th>
                  <th>VerifiedBuild</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td className="vendor-td-item">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.item ?? 0}
                        onChange={e => update(i, 'item', e.target.value.replace(/\D/, ''))}
                        onBlur={e => resolveItemName(e.target.value)}
                        style={{ width: 70 }}
                      />
                    </td>
                    <td className="vendor-td-name">
                      <div className="vendor-td-name-cell">
                        <span className="vendor-item-name" style={{ color: QUALITY_COLOR[itemQualities[Number(row.item)]] }}>{itemNames[Number(row.item)] || ''}</span>
                        <button className="btn-ghost icon-btn vendor-search-btn" type="button" onClick={() => setSearchFor(i)} title="Zoek item">
                          <Search size={11} />
                        </button>
                      </div>
                    </td>
                    {['slot', 'maxcount', 'incrtime', 'ExtendedCost'].map(col => (
                      <td key={col} style={{ width: col === 'incrtime' ? 80 : 70 }}>
                        <input
                          type="number"
                          step="1"
                          value={row[col] ?? 0}
                          onChange={e => update(i, col, e.target.value)}
                          onWheel={e => e.target.blur()}
                        />
                      </td>
                    ))}
                    <td style={{ width: 55 }}>
                      <input
                        type="number"
                        step="1"
                        value={row.type ?? 1}
                        onChange={e => update(i, 'type', e.target.value)}
                        onWheel={e => e.target.blur()}
                      />
                    </td>
                    <td style={{ width: 90 }}>
                      <input
                        type="number"
                        step="1"
                        value={row.VerifiedBuild ?? 0}
                        onChange={e => update(i, 'VerifiedBuild', e.target.value)}
                        onWheel={e => e.target.blur()}
                      />
                    </td>
                    <td>
                      <button className="btn-ghost icon-btn" onClick={() => deleteRow(i)} title="Verwijder">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="vendor-footer">
            <button className="btn-ghost icon-btn" onClick={addRow}>
              <Plus size={14} /> Item toevoegen
            </button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              <Save size={14} /> {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
            <span className="vendor-row-count">{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
            {status && <span className="vendor-status">{status}</span>}
          </div>
        </>
      )}

      {searchFor !== null && (
        <ItemSearchModal
          query={query}
          onSelect={(entry, name) => handleItemSelect(searchFor, entry, name)}
          onClose={() => setSearchFor(null)}
        />
      )}
    </div>
  );
}
