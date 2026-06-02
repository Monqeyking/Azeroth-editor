import { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Save, Plus, Trash2, ArrowRight, Database } from 'lucide-react';
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
          <input ref={inputRef} placeholder="Naam of item ID..." value={term}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && onClose()} />
        </div>
        <div className="ise-modal-results">
          {!results.length && term && <div className="ise-modal-empty">Geen resultaten</div>}
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
function SetBrowser({ query, searchItemSets, onEdit, onCreate }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

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

      setResults(mergeSetResults(dbcRes.data || [], dbRows));
    } finally {
      setLoading(false);
    }
  }, [query, searchItemSets]);

  useEffect(() => {
    const t = setTimeout(() => search(term), 200);
    return () => clearTimeout(t);
  }, [term, search]);

  return (
    <div className="ise-browser">
      <div className="ise-browser-top">
        <div className="ise-browser-search">
          <Search size={13} className="ise-search-icon" />
        <input className="ise-search-input" placeholder="Zoek op naam of ID…"
            value={term} onChange={e => setTerm(e.target.value)} />
        </div>
        <button className="ise-btn" onClick={onCreate}><Plus size={14} /> Nieuwe custom set</button>
      </div>
      {loading && <div className="ise-help">Zoeken...</div>}
      {status && <div className="ise-warning">{status}</div>}
      <table className="ise-table ise-browser-table">
        <thead><tr><th>ID</th><th>Naam</th><th>Bron</th><th>Patch</th><th></th></tr></thead>
        <tbody>
          {!loading && results.length === 0 && (
            <tr><td colSpan={5} className="ise-empty">Geen sets gevonden</td></tr>
          )}
          {results.map(r => (
            <tr key={r.entry} className="ise-clickable-row" onClick={() => onEdit(r.entry)} title="Open in editor">
              <td className="ise-id">{r.entry}</td>
              <td>{r.name}</td>
              <td className="ise-muted ise-source-cell"><Database size={11} /> {r.source}</td>
              <td className="ise-muted">{r.patch}</td>
              <td>
                <button className="ise-icon-btn" title="Bewerken" onClick={(e) => { e.stopPropagation(); onEdit(r.entry); }}>
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
function SetEditor({ query, searchSpellsDbc, readItemSet, writeItemSet, findNextItemSetId, initialId, createNonce, onSaved }) {
  const [set, setSet] = useState(EMPTY_SET());
  const [itemNames, setItemNames] = useState({});
  const [spellNames, setSpellNames] = useState({});
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState('');

  const resolveItemName = useCallback(async (id) => {
    if (!id || itemNames[id] !== undefined) return;
    const res = await query('SELECT name FROM item_template WHERE entry = ? LIMIT 1', [id]);
    setItemNames(prev => ({ ...prev, [id]: res.data?.[0]?.name || '?' }));
  }, [query, itemNames]);

  const resolveSpellName = useCallback(async (id) => {
    if (!id || spellNames[id] !== undefined) return;
    const res = await searchSpellsDbc(String(id));
    const match = res.data?.find(s => s.id === id);
    setSpellNames(prev => ({ ...prev, [id]: match?.name || '?' }));
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
    setStatus(!dbcRes.success ? `⚠ Geen DBC record voor ID ${id}` : '');
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
    setStatus('Opslaan…');
    try {
      if (!set.id) { setStatus('Kies eerst een geldige Set ID.'); return; }
      if (!set.name.trim()) { setStatus('Naam is verplicht.'); return; }
      await ensureItemSetNamesTable(query);
      await query('DELETE FROM item_set_names WHERE entry = ?', [set.id]);
      await query('INSERT INTO item_set_names (entry, name, patch) VALUES (?, ?, ?)', [set.id, set.name, set.patch]);
      const dbcRes = await writeItemSet(set);
      if (!dbcRes.success) { setStatus(`Fout DBC: ${dbcRes.error}`); return; }
      setStatus('Opgeslagen!');
      onSaved?.();
    } catch (e) {
      setStatus(`Fout: ${e.message}`);
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
    <div className="ise-editor">
      <div className="ise-toolbar">
        <button className="ise-btn" onClick={handleNew}><Plus size={14} /> Nieuw</button>
        <button className="ise-btn primary" onClick={handleSave}><Save size={14} /> Opslaan</button>
        {status && <span className="ise-status">{status}</span>}
      </div>

      <div className="ise-form">
        <label>Set ID<input readOnly value={set.id} className="ise-input readonly" /></label>
        <label>Naam<input value={set.name} onChange={e => setSet(s => ({ ...s, name: e.target.value }))} className="ise-input" /></label>
        <label>Patch<input type="text" inputMode="numeric" value={set.patch} onChange={e => setSet(s => ({ ...s, patch: Number(e.target.value) || 0 }))} className="ise-input short" /></label>
        <label>Req. Skill<input type="text" inputMode="numeric" value={set.requiredSkill} onChange={e => setSet(s => ({ ...s, requiredSkill: Number(e.target.value) || 0 }))} className="ise-input short" /></label>
        <label>Req. Rank<input type="text" inputMode="numeric" value={set.requiredSkillRank} onChange={e => setSet(s => ({ ...s, requiredSkillRank: Number(e.target.value) || 0 }))} className="ise-input short" /></label>
      </div>

      <div className="ise-sections">
        <section className="ise-section">
          <h2 className="ise-section-title">Items <span className="ise-muted">(17 slots)</span></h2>
          <table className="ise-table">
            <thead><tr><th>#</th><th>Item ID</th><th>Naam</th><th></th></tr></thead>
            <tbody>
              {set.items.map((itemId, i) => (
                <tr key={i}>
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
          <h2 className="ise-section-title">Set Bonussen <span className="ise-muted">(8 max)</span></h2>
          <table className="ise-table">
            <thead><tr><th>Threshold</th><th>Spell ID</th><th>Spell naam</th></tr></thead>
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
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function ItemSetEditorPage() {
  const { query, searchSpellsDbc, readItemSet, searchItemSets, writeItemSet, findNextItemSetId } = useConnection();
  const [tab, setTab] = useState('browse');
  const [editId, setEditId] = useState(null);
  const [browserKey, setBrowserKey] = useState(0);
  const [createNonce, setCreateNonce] = useState(0);

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
        <button className={`ise-tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>Zoeken / nieuw</button>
        <button className={`ise-tab ${tab === 'editor' ? 'active' : ''}`} onClick={() => setTab('editor')}>Bewerken</button>
      </div>

      {tab === 'browse' && (
        <SetBrowser
          key={browserKey}
          query={query}
          searchItemSets={searchItemSets}
          onEdit={handleEdit}
          onCreate={handleCreate}
        />
      )}
      {tab === 'editor' && (
        <SetEditor
          query={query}
          searchSpellsDbc={searchSpellsDbc}
          readItemSet={readItemSet}
          writeItemSet={writeItemSet}
          findNextItemSetId={findNextItemSetId}
          initialId={editId}
          createNonce={createNonce}
          onSaved={() => setBrowserKey(k => k + 1)}
        />
      )}
    </div>
  );
}
