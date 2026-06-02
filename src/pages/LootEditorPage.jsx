import { useState, useCallback, useEffect, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Plus, Trash2, Save, Search } from 'lucide-react';
import './LootEditorPage.css';

const LOOT_TABLES = {
  Creature:   'creature_loot_template',
  Gameobject: 'gameobject_loot_template',
};

const SOURCE_TABLES = {
  Creature:   'creature_template',
  Gameobject: 'gameobject_template',
};

const EMPTY_ROW = (entry = 0) => ({
  Entry: entry, Item: 0, Reference: 0, Chance: 100,
  QuestRequired: 0, LootMode: 1, GroupId: 0, MinCount: 1, MaxCount: 1,
});

// ── Entry zoekbalk met autocomplete ──────────────────────────────────────────
function EntrySearch({ lootType, query, onLoad }) {
  const [term, setTerm] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const wrapRef = useRef(null);
  const sourceTable = SOURCE_TABLES[lootType];

  useEffect(() => { setTerm(''); setLabel(''); setSuggestions([]); setOpen(false); }, [lootType]);

  useEffect(() => {
    if (!term) { setSuggestions([]); setOpen(false); return; }
    const isId = /^\d+$/.test(term.trim());
    const t = setTimeout(async () => {
      const sql = isId
        ? `SELECT entry, name FROM ${sourceTable} WHERE entry = ? LIMIT 20`
        : `SELECT entry, name FROM ${sourceTable} WHERE name LIKE ? LIMIT 20`;
      const res = await query(sql, [isId ? Number(term) : `%${term}%`]);
      setSuggestions(res.data || []);
      setOpen(true);
    }, 200);
    return () => clearTimeout(t);
  }, [term, sourceTable, query]);

  // Sluit dropdown bij klik buiten
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
    onLoad(entry);
  };

  const handleKey = e => {
    if (e.key === 'Enter') {
      const id = Number(term);
      if (id) { setOpen(false); onLoad(id); }
    }
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="loot-entry-wrap" ref={wrapRef}>
      <div className="loot-entry-field">
        <Search size={13} className="loot-entry-icon" />
        <input
          className="loot-entry-input"
          placeholder={`Zoek ${lootType} op naam of ID…`}
          value={term}
          onChange={e => { setTerm(e.target.value); setLabel(''); }}
          onKeyDown={handleKey}
          onFocus={() => suggestions.length && setOpen(true)}
        />
        {label && <span className="loot-entry-label">{label}</span>}
      </div>
      {open && suggestions.length > 0 && (
        <div className="loot-entry-dropdown">
          {suggestions.map(r => (
            <div key={r.entry} className="loot-entry-option" onMouseDown={() => select(r.entry, r.name)}>
              <span className="loot-modal-id">{r.entry}</span>
              <span>{r.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Item zoekmodal (bestaand) ─────────────────────────────────────────────────
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
    <div className="loot-modal-overlay" onClick={onClose}>
      <div className="loot-modal" onClick={e => e.stopPropagation()}>
        <div className="loot-modal-search">
          <Search size={13} />
          <input
            ref={inputRef}
            placeholder="Naam of item ID..."
            value={term}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && onClose()}
          />
        </div>
        <div className="loot-modal-results">
          {results.length === 0 && term && <div className="loot-modal-empty">Geen resultaten</div>}
          {results.map(r => (
            <div key={r.entry} className="loot-modal-row" onClick={() => onSelect(r.entry, r.name)}>
              <span className="loot-modal-id">{r.entry}</span>
              <span>{r.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Hoofdpagina ───────────────────────────────────────────────────────────────
export default function LootEditorPage() {
  const { query } = useConnection();
  const [lootType, setLootType] = useState('Creature');
  const [entryId, setEntryId] = useState(null);
  const [entryName, setEntryName] = useState('');
  const [rows, setRows] = useState([]);
  const [itemNames, setItemNames] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [searchFor, setSearchFor] = useState(null);

  const table = LOOT_TABLES[lootType];

  const fetchNames = useCallback(async (rowList) => {
    const ids = [...new Set(rowList.map(r => Number(r.Item)).filter(Boolean))];
    if (!ids.length) return;
    const ph = ids.map(() => '?').join(',');
    const res = await query(`SELECT entry, name FROM item_template WHERE entry IN (${ph})`, ids);
    const map = {};
    (res.data || []).forEach(r => { map[r.entry] = r.name; });
    setItemNames(map);
  }, [query]);

  const load = useCallback(async (id) => {
    setEntryId(id);
    const res = await query(`SELECT * FROM ${table} WHERE Entry = ? ORDER BY GroupId, Item`, [id]);
    const data = res.data?.length ? res.data : [EMPTY_ROW(id)];
    setRows(data);
    setLoaded(true);
    setStatus('');
    await fetchNames(data);
  }, [table, query, fetchNames]);

  const update = (i, col, val) => {
    setRows(prev => { const next = [...prev]; next[i] = { ...next[i], [col]: val }; return next; });
  };

  const resolveItemName = async (itemId) => {
    if (!itemId || !Number(itemId)) return;
    const res = await query('SELECT name FROM item_template WHERE entry = ? LIMIT 1', [Number(itemId)]);
    const name = res.data?.[0]?.name;
    if (name) setItemNames(prev => ({ ...prev, [Number(itemId)]: name }));
  };

  const addRow = () => setRows(prev => [...prev, EMPTY_ROW(entryId)]);
  const deleteRow = (i) => setRows(prev => prev.filter((_, j) => j !== i));

  const save = async () => {
    if (!loaded || !entryId) return;
    setSaving(true);
    try {
      await query(`DELETE FROM ${table} WHERE Entry = ?`, [entryId]);
      for (const row of rows) {
        await query(
          `INSERT INTO ${table} (Entry, Item, Reference, Chance, QuestRequired, LootMode, GroupId, MinCount, MaxCount) VALUES (?,?,?,?,?,?,?,?,?)`,
          [entryId, row.Item, row.Reference, row.Chance, row.QuestRequired, row.LootMode, row.GroupId, row.MinCount, row.MaxCount]
        );
      }
      setStatus('Opgeslagen.');
    } catch (e) {
      setStatus('Fout: ' + e.message);
    }
    setSaving(false);
  };

  const groupTotals = rows.reduce((acc, r) => {
    const g = Number(r.GroupId);
    acc[g] = (acc[g] || 0) + Number(r.Chance || 0);
    return acc;
  }, {});
  const overGroups = Object.entries(groupTotals).filter(([k, v]) => Number(k) > 0 && v > 100).map(([k]) => Number(k));

  return (
    <div className="loot-editor">
      <h1 className="loot-editor-title">Loot Editor</h1>
      <p className="loot-editor-subtitle">Beheer loot tabellen voor creatures, items en gameobjects</p>

      <div className="loot-toolbar">
        <div className="loot-segmented">
          {Object.keys(LOOT_TABLES).map(t => (
            <button key={t} className={lootType === t ? 'active' : ''} onClick={() => {
              setLootType(t); setLoaded(false); setRows([]); setItemNames({}); setStatus(''); setEntryId(null); setEntryName('');
            }}>
              {t}
            </button>
          ))}
        </div>
        <EntrySearch lootType={lootType} query={query} onLoad={load} />
      </div>

      {loaded && (
        <>
          <div className="loot-table-wrap">
            <table className="loot-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="loot-th-name">Naam</th>
                  <th>Reference</th>
                  <th>Chance</th>
                  <th>QuestReq</th>
                  <th>LootMode</th>
                  <th>GroupId</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={overGroups.includes(Number(row.GroupId)) ? 'loot-row-warn' : ''}>
                    <td className="loot-td-item">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.Item ?? 0}
                        onChange={e => update(i, 'Item', e.target.value.replace(/\D/, ''))}
                        onBlur={e => resolveItemName(e.target.value)}
                        style={{ width: 70 }}
                      />
                    </td>
                    <td className="loot-td-name">
                      <span className="loot-item-name">{itemNames[Number(row.Item)] || ''}</span>
                      <button className="btn-ghost icon-btn loot-search-btn" type="button" onClick={() => setSearchFor(i)} title="Zoek item">
                        <Search size={11} />
                      </button>
                    </td>
                    {['Reference', 'Chance', 'QuestRequired', 'LootMode', 'GroupId', 'MinCount', 'MaxCount'].map(col => (
                      <td key={col}>
                        <input
                          type="number"
                          step={col === 'Chance' ? '0.01' : '1'}
                          value={row[col] ?? 0}
                          onChange={e => update(i, col, e.target.value)}
                          onWheel={e => e.target.blur()}
                        />
                      </td>
                    ))}
                    <td>
                      <button className="btn-ghost icon-btn" type="button" onClick={() => deleteRow(i)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {overGroups.length > 0 && (
            <div className="loot-group-totals">
              {overGroups.map(g => (
                <span key={g} className="loot-warning">⚠ GroupId {g}: {groupTotals[g].toFixed(2)}% &gt; 100%</span>
              ))}
            </div>
          )}

          <div className="loot-footer">
            <button className="btn-ghost" type="button" onClick={addRow}>
              <Plus size={13} /> Rij toevoegen
            </button>
            <button className="btn-primary" type="button" onClick={save} disabled={saving}>
              <Save size={13} /> {saving ? 'Opslaan...' : 'Opslaan'}
            </button>
            <span className="loot-row-count">{rows.length} rijen</span>
            {status && <span className="loot-row-count">{status}</span>}
          </div>
        </>
      )}

      {searchFor !== null && (
        <ItemSearchModal
          query={query}
          onClose={() => setSearchFor(null)}
          onSelect={(entry, name) => {
            update(searchFor, 'Item', entry);
            setItemNames(prev => ({ ...prev, [entry]: name }));
            setSearchFor(null);
          }}
        />
      )}
    </div>
  );
}
