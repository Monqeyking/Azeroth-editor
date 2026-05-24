import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Plus, Save, RotateCcw, Trash2, RefreshCw, ChevronRight, MousePointerClick, Copy } from 'lucide-react';
import FlagsSelector from '../components/FlagsSelector';
import '../pages/DashboardPage.css';
import './EditorPage.css';

const CREATURE_FIELDS = [
  { key: 'entry',            label: 'Entry',           type: 'number',  readonly: true },
  { key: 'name',             label: 'Name',            type: 'text',    required: true },
  { key: 'subname',          label: 'Subname',         type: 'text' },
  { key: 'minlevel',         label: 'Min Level',       type: 'number' },
  { key: 'maxlevel',         label: 'Max Level',       type: 'number' },
  { key: 'faction',          label: 'Faction',         type: 'number' },
  { key: 'npcflag',          label: 'NPC Flags',       type: 'flags', field: 'npcflag' },
  { key: 'speed_walk',       label: 'Walk Speed',      type: 'decimal' },
  { key: 'speed_run',        label: 'Run Speed',       type: 'decimal' },
  { key: 'speed_swim',       label: 'Swim Speed',      type: 'decimal' },
  { key: 'speed_flight',     label: 'Flight Speed',    type: 'decimal' },
  { key: 'BaseAttackTime',   label: 'Attack Time',     type: 'number' },
  { key: 'RangeAttackTime',  label: 'Range Attack Time',type: 'number' },
  { key: 'unit_class',       label: 'Unit Class',      type: 'number' },
  { key: 'rank',             label: 'Rank',            type: 'select', options: ['0:Normal','1:Elite','2:Rare Elite','3:Boss','4:Rare'] },
  { key: 'type',             label: 'Type',            type: 'select', options: ['0:None','1:Beast','2:Dragonkin','3:Demon','4:Elemental','5:Giant','6:Undead','7:Humanoid','8:Critter','9:Mechanical','10:Not Specified','11:Totem','12:Non-Combat Pet','13:Gas Cloud'] },
  { key: 'family',           label: 'Family',          type: 'number' },
  { key: 'HealthModifier',   label: 'Health Modifier', type: 'decimal' },
  { key: 'ManaModifier',     label: 'Mana Modifier',   type: 'decimal' },
  { key: 'ArmorModifier',    label: 'Armor Modifier',  type: 'decimal' },
  { key: 'DamageModifier',   label: 'Damage Modifier', type: 'decimal' },
  { key: 'ExperienceModifier',label: 'XP Modifier',    type: 'decimal' },
  { key: 'scale',            label: 'Scale',           type: 'decimal' },
  { key: 'lootid',           label: 'Loot ID',         type: 'number' },
  { key: 'pickpocketloot',   label: 'Pickpocket Loot', type: 'number' },
  { key: 'skinloot',         label: 'Skin Loot',       type: 'number' },
  { key: 'mingold',          label: 'Min Gold',        type: 'number' },
  { key: 'maxgold',          label: 'Max Gold',        type: 'number' },
  { key: 'unit_flags',       label: 'Unit Flags',      type: 'flags', field: 'unit_flags' },
  { key: 'unit_flags2',      label: 'Unit Flags 2',    type: 'flags', field: 'unit_flags2' },
  { key: 'dynamicflags',     label: 'Dynamic Flags',   type: 'flags', field: 'dynamicflags' },
  { key: 'AIName',           label: 'AI Name',         type: 'text' },
  { key: 'MovementType',     label: 'Movement Type',   type: 'select', options: ['0:Idle','1:Random','2:Waypoint'] },
  { key: 'HoverHeight',      label: 'Hover Height',    type: 'decimal' },
  { key: 'RegenHealth',      label: 'Regen Health',    type: 'number' },
  { key: 'detection_range',  label: 'Detection Range', type: 'decimal' },
  { key: 'ScriptName',       label: 'Script Name',     type: 'text' },
  { key: 'flags_extra',      label: 'Extra Flags',     type: 'flags', field: 'flags_extra' },
];

export default function CreatureEditorPage() {
  const { query, soapCommand, soapConfig, findNextId, idRanges } = useConnection();
  const [search, setSearch] = useState('');
  const [creatures, setCreatures] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [copying, setCopying] = useState(false);
  const searchRef = useRef(null);

  // Load recent creatures from localStorage
  const loadRecent = useCallback(() => {
    try {
      const recent = JSON.parse(localStorage.getItem('recent_creatures') || '[]');
      return recent.slice(0, 5);
    } catch {
      return [];
    }
  }, []);

  // Save creature to recent list
  const saveRecent = useCallback((entry) => {
    try {
      let recent = JSON.parse(localStorage.getItem('recent_creatures') || '[]');
      recent = recent.filter(e => e !== entry);
      recent.unshift(entry);
      localStorage.setItem('recent_creatures', JSON.stringify(recent.slice(0, 10)));
    } catch {
      // Silent fail
    }
  }, []);

  const searchCreatures = useCallback(async (term) => {
    setLoading(true);
    const isNum = /^\d+$/.test(term);
    let sql, params;
    if (!term) {
      sql = 'SELECT entry, `name`, minlevel, maxlevel, `rank`, `type` FROM creature_template ORDER BY entry DESC LIMIT 50';
      params = [];
    } else if (isNum) {
      sql = 'SELECT entry, `name`, minlevel, maxlevel, `rank`, `type` FROM creature_template WHERE entry = ? LIMIT 50';
      params = [term];
    } else {
      sql = 'SELECT entry, `name`, minlevel, maxlevel, `rank`, `type` FROM creature_template WHERE `name` LIKE ? LIMIT 50';
      params = [`%${term}%`];
    }
    const result = await query(sql, params);
    setCreatures(result.data || []);
    setLoading(false);
  }, [query]);

  useEffect(() => { searchCreatures(''); }, []);


  useEffect(() => { searchRef.current?.focus(); }, []);

  const selectCreature = async (entry) => {
    const result = await query('SELECT * FROM creature_template WHERE entry = ?', [entry]);
    if (result.data?.[0]) {
      setSelected(result.data[0]);
      setForm(result.data[0]);
      setDirty(false);
      setMsg(null);
      setErrors({});
      saveRecent(entry);
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!form.name || form.name.trim() === '') {
      newErrors.name = 'Name is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!validateForm()) {
      setMsg({ type: 'error', text: 'Please fix validation errors before saving' });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const fields = Object.keys(form).filter(k => k !== 'entry');
      const sets = fields.map(k => `\`${k}\` = ?`).join(', ');
      const vals = fields.map(k => form[k]);
      vals.push(form.entry);
      const result = await query(`UPDATE creature_template SET ${sets} WHERE entry = ?`, vals);
      if (result.success) {
        setSelected(form);
        setDirty(false);
        setErrors({});
        setMsg({ type: 'success', text: 'Saved! Reloading server...' });
        // Live reload via SOAP
        if (soapConfig.user) {
          await soapCommand(`.reload creature_template`);
          setMsg({ type: 'success', text: `✓ Saved & reloaded entry ${form.entry}` });
        } else {
          setMsg({ type: 'success', text: `✓ Saved entry ${form.entry}. Configure SOAP in Settings for live reload.` });
        }
        searchCreatures(search);
      } else {
        setMsg({ type: 'error', text: `✗ Save failed: ${result.error}` });
      }
    } catch (e) {
      setMsg({ type: 'error', text: `✗ Error: ${e.message}` });
    }
    setSaving(false);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && selected) handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dirty, selected, handleSave]);

  const handleCreate = async () => {
    const result = await query('SELECT MAX(entry) as m FROM creature_template');
    const newEntry = (result.data?.[0]?.m || 0) + 1;
    const blank = { entry: newEntry, name: 'New Creature', minlevel: 1, maxlevel: 1, rank: 0, type: 0, minhealth: 100, maxhealth: 100 };
    await query(`INSERT INTO creature_template (entry, name, minlevel, maxlevel, rank, type) VALUES (?,?,?,?,?,?)`,
      [newEntry, blank.name, 1, 1, 0, 0]);
    await searchCreatures(search);
    selectCreature(newEntry);
  };

  const handleReset = () => {
    setForm(selected);
    setDirty(false);
  };

  const handleCopy = async () => {
    if (!selected) return;
    setCopying(true);
    setMsg(null);
    try {
      const idResult = await findNextId({ table: 'creature_template', idColumn: 'entry', startId: idRanges.creature });
      if (!idResult.success) throw new Error(idResult.error);
      const newId = idResult.nextId;
      const fields = Object.keys(selected);
      const cols = fields.map(k => `\`${k}\``).join(', ');
      const vals = fields.map(k => k === 'entry' ? newId : selected[k]);
      const placeholders = fields.map(() => '?').join(', ');
      const result = await query(`INSERT INTO creature_template (${cols}) VALUES (${placeholders})`, vals);
      if (!result.success) throw new Error(result.error);
      await searchCreatures(search);
      await selectCreature(newId);
      setMsg({ type: 'success', text: `✓ Gekloond naar entry #${newId}` });
    } catch (e) {
      setMsg({ type: 'error', text: `✗ Klonen mislukt: ${e.message}` });
    }
    setCopying(false);
  };

  // Group fields into sections for better organization
  const getFieldSections = () => [
    { title: 'Basis Info', keys: ['entry', 'name', 'subname'] },
    { title: 'Levels', keys: ['minlevel', 'maxlevel'] },
    { title: 'Speeds', keys: ['speed_walk', 'speed_run', 'speed_swim', 'speed_flight'] },
    { title: 'Combat', keys: ['BaseAttackTime', 'RangeAttackTime', 'unit_class'] },
    { title: 'Appearance', keys: ['faction', 'type', 'family', 'scale', 'HoverHeight'] },
    { title: 'Modifiers', keys: ['HealthModifier', 'ManaModifier', 'ArmorModifier', 'DamageModifier', 'ExperienceModifier'] },
    { title: 'Loot & Gold', keys: ['lootid', 'pickpocketloot', 'skinloot', 'mingold', 'maxgold'] },
    { title: 'Flags', keys: ['npcflag', 'unit_flags', 'unit_flags2', 'dynamicflags', 'flags_extra'] },
    { title: 'Behavior', keys: ['AIName', 'MovementType', 'RegenHealth', 'detection_range', 'ScriptName'] },
  ];

  return (
    <>
      <div className="editor-page-header">
        <h2 className="editor-page-title">Creature Editor</h2>
        <p className="editor-page-subtitle">Manage creature templates and properties</p>
      </div>
      <div className="editor-layout">
        {/* List panel */}
        <div className="editor-list">
          <div className="editor-list-header">
          <div className="search-box">
            <Search size={13} />
            <input
              ref={searchRef}
              placeholder="Search name or entry..."
              value={search}
              onChange={e => { setSearch(e.target.value); searchCreatures(e.target.value); }}
            />
          </div>
          <button className="btn-primary icon-btn" onClick={handleCreate} title="New Creature">
            <Plus size={14} />
          </button>
          </div>

          <div className="list-items">
            {loading && <div className="loading-text">Searching...</div>}
            {!loading && creatures.map(c => (
              <div
                key={c.entry}
                className={`list-item ${selected?.entry === c.entry ? 'active' : ''}`}
                onClick={() => selectCreature(c.entry)}
              >
                <div className="list-item-main">
                  <span className="list-item-name">{c.name}</span>
                  <ChevronRight size={12} className="list-item-arrow" />
                </div>
                <div className="list-item-meta">
                  <span className="mono">#{c.entry}</span>
                  <span>Lv {c.minlevel === c.maxlevel ? c.minlevel : `${c.minlevel}-${c.maxlevel}`}</span>
                  <RankTag rank={c.rank} />
                </div>
              </div>
            ))}
            {!loading && creatures.length === 0 && <div className="loading-text">No results</div>}
          </div>
        </div>

        {/* Edit panel */}
      <div className="editor-form">
        {!selected ? (
          <div className="editor-empty">
            <MousePointerClick />
            <p>Select a creature to edit</p>
          </div>
        ) : (
          <>
            <div className="page-header">
              <div>
                <h1 className="page-title">{selected.name}{dirty && <span style={{color: 'var(--gold)', marginLeft: '8px'}}>●</span>}</h1>
                <p className="page-sub">Entry #{selected.entry} · creature_template</p>
              </div>
              <div className="header-actions">
                {dirty && (
                  <button className="btn-ghost" onClick={handleReset} title="Discard changes">
                    <RotateCcw size={13} /> Reset
                  </button>
                )}
                <button className="btn-ghost" onClick={handleCopy} disabled={copying} title="Kloon dit record naar een nieuw ID">
                  <Copy size={13} /> {copying ? 'Klonen...' : 'Copy'}
                </button>
                <button className="btn-primary" onClick={handleSave} disabled={saving || !dirty} title="Save changes (Ctrl+S)">
                  <Save size={13} /> {saving ? 'Saving...' : 'Save & Reload'}
                </button>
              </div>
            </div>

            {msg && (
              <div className={`editor-msg ${msg.type}`}>
                {msg.text}
              </div>
            )}

            <div className="form-fields">
              {getFieldSections().map((section, idx) => (
                <div key={idx}>
                  <h4 className="field-section-title">{section.title}</h4>
                  {section.keys.map(key => {
                    const f = CREATURE_FIELDS.find(fld => fld.key === key);
                    if (!f) return null;
                    const hasError = errors[f.key];
                    return (
                      <div key={f.key} className={`field-group ${hasError ? 'field-error' : ''}`}>
                        <label>{f.label}{f.required && <span style={{color: 'var(--accent-red)'}}>*</span>}</label>
                        {f.type === 'flags' ? (
                          <FlagsSelector field={f.field} value={form[f.key] ?? 0} onChange={v => handleChange(f.key, v)} label={f.label} />
                        ) : f.type === 'select' ? (
                          <select value={form[f.key] ?? ''} onChange={e => handleChange(f.key, e.target.value)} disabled={f.readonly} style={hasError ? {borderColor: 'var(--accent-red)'} : {}}>
                            {f.options.map(o => {
                              const [val, lbl] = o.split(':');
                              return <option key={val} value={val}>{lbl}</option>;
                            })}
                          </select>
                        ) : (
                          <input
                            type={f.type === 'decimal' ? 'number' : f.type}
                            step={f.type === 'decimal' ? '0.01' : undefined}
                            value={form[f.key] ?? ''}
                            onChange={e => handleChange(f.key, e.target.value)}
                            readOnly={f.readonly}
                            style={hasError ? {borderColor: 'var(--accent-red)'} : {}}
                            title={hasError ? errors[f.key] : ''}
                          />
                        )}
                        {hasError && <span style={{fontSize: '11px', color: 'var(--accent-red)'}}>{errors[f.key]}</span>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
          )}
        </div>
      </div>
    </>
  );
}

function RankTag({ rank }) {
  const labels = ['Normal','Elite','Rare Elite','Boss','Rare'];
  const cls = rank === 3 ? 'tag-gold' : rank >= 1 ? 'tag-blue' : 'tag-green';
  return <span className={`tag ${cls}`}>{labels[rank] || 'Normal'}</span>;
}
