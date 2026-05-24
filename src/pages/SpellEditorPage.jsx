import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Save, RotateCcw, ChevronRight, MousePointerClick, Copy } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';

const SPELL_FIELDS = [
  { key: 'ID',                       label: 'Entry',              type: 'number',  readonly: true },
  { key: 'Name_Lang_enUS',           label: 'Name (enUS)',        type: 'text' },
  { key: 'NameSubtext_Lang_enUS',    label: 'Subtext',            type: 'text' },
  { key: 'Description_Lang_enUS',    label: 'Description',        type: 'textarea' },
  { key: 'AuraDescription_Lang_enUS',label: 'Aura Description',   type: 'textarea' },
  { key: 'SchoolMask',               label: 'School Mask',        type: 'number' },
  { key: 'DefenseType',              label: 'Defense Type',       type: 'select', options: ['0:None','1:Magic','2:Melee','3:Ranged'] },
  { key: 'Category',                 label: 'Category',           type: 'number' },
  { key: 'Mechanic',                 label: 'Mechanic',           type: 'number' },
  { key: 'Attributes',               label: 'Attributes',         type: 'number' },
  { key: 'AttributesEx',             label: 'Attributes Ex',      type: 'number' },
  { key: 'AttributesEx2',            label: 'Attributes Ex2',     type: 'number' },
  { key: 'AttributesEx3',            label: 'Attributes Ex3',     type: 'number' },
  { key: 'CastingTimeIndex',         label: 'Cast Time Index',    type: 'number' },
  { key: 'RecoveryTime',             label: 'Cooldown (ms)',      type: 'number' },
  { key: 'CategoryRecoveryTime',     label: 'Category CD (ms)',   type: 'number' },
  { key: 'DurationIndex',            label: 'Duration Index',     type: 'number' },
  { key: 'RangeIndex',               label: 'Range Index',        type: 'number' },
  { key: 'Speed',                    label: 'Speed',              type: 'decimal' },
  { key: 'CumulativeAura',           label: 'Stack Amount',       type: 'number' },
  { key: 'ProcTypeMask',             label: 'Proc Flags',         type: 'number' },
  { key: 'ProcChance',               label: 'Proc Chance (%)',    type: 'number' },
  { key: 'ProcCharges',              label: 'Proc Charges',       type: 'number' },
  { key: 'MaxLevel',                 label: 'Max Level',          type: 'number' },
  { key: 'BaseLevel',                label: 'Base Level',         type: 'number' },
  { key: 'SpellLevel',               label: 'Spell Level',        type: 'number' },
  { key: 'PowerType',                label: 'Power Type',         type: 'number' },
  { key: 'ManaCost',                 label: 'Mana Cost',          type: 'number' },
  { key: 'ManaCostPct',              label: 'Mana Cost %',        type: 'number' },
  { key: 'ManaPerSecond',            label: 'Mana/Second',        type: 'number' },
  { key: 'MaxTargetLevel',           label: 'Max Target Level',   type: 'number' },
  { key: 'MaxTargets',               label: 'Max Targets',        type: 'number' },
  { key: 'SpellClassSet',            label: 'Spell Family',       type: 'number' },
  { key: 'Effect_1',                 label: 'Effect 1',           type: 'number' },
  { key: 'Effect_2',                 label: 'Effect 2',           type: 'number' },
  { key: 'Effect_3',                 label: 'Effect 3',           type: 'number' },
  { key: 'EffectBasePoints_1',       label: 'Base Points 1',      type: 'number' },
  { key: 'EffectBasePoints_2',       label: 'Base Points 2',      type: 'number' },
  { key: 'EffectBasePoints_3',       label: 'Base Points 3',      type: 'number' },
  { key: 'EffectAura_1',             label: 'Aura Type 1',        type: 'number' },
  { key: 'EffectAura_2',             label: 'Aura Type 2',        type: 'number' },
  { key: 'EffectAura_3',             label: 'Aura Type 3',        type: 'number' },
  { key: 'EffectTriggerSpell_1',     label: 'Trigger Spell 1',    type: 'number' },
  { key: 'EffectTriggerSpell_2',     label: 'Trigger Spell 2',    type: 'number' },
  { key: 'EffectTriggerSpell_3',     label: 'Trigger Spell 3',    type: 'number' },
  { key: 'SpellIconID',              label: 'Icon ID',            type: 'number' },
  { key: 'SpellVisualID_1',          label: 'Visual ID',          type: 'number' },
  { key: 'SpellPriority',            label: 'Priority',           type: 'number' },
];

export default function SpellEditorPage() {
  const { searchSpellsDbc, readSpellFull, writeSpellFull, findNextSpellId, copySpellDbc, idRanges } = useConnection();
  const [search, setSearch] = useState('');
  const [spells, setSpells] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const searchRef = useRef(null);

  const searchSpells = useCallback(async (term) => {
    setLoading(true);
    const result = await searchSpellsDbc(term);
    setSpells(result.data || []);
    setLoading(false);
  }, [searchSpellsDbc]);

  useEffect(() => { searchSpells(''); }, []);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const selectSpell = async (ID) => {
    const result = await readSpellFull(ID);
    if (result.data) {
      setSelected(result.data);
      setForm(result.data);
      setDirty(false);
      setMsg(null);
    }
  };

  const handleChange = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const handleCopy = async () => {
    if (!selected) return;
    setCopying(true);
    setMsg(null);
    try {
      const idResult = await findNextSpellId(idRanges.spell);
      if (!idResult.success) throw new Error(idResult.error);
      const newId = idResult.nextId;
      const result = await copySpellDbc(selected.ID, newId);
      if (!result.success) throw new Error(result.error);
      const nameResult = await writeSpellFull({ ID: newId, Name_Lang_enUS: `Copy of ${selected.Name_Lang_enUS || ''}`.trim() });
      if (!nameResult.success) throw new Error(nameResult.error);
      await searchSpells(search);
      await selectSpell(newId);
      setMsg({ type: 'success', text: `✓ Gekloond naar ID #${newId}` });
    } catch (e) {
      setMsg({ type: 'error', text: `✗ Klonen mislukt: ${e.message}` });
    }
    setCopying(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const result = await writeSpellFull(form);
      if (result.success) {
        setSelected(form);
        setDirty(false);
        setMsg({ type: 'success', text: `✓ Spell ${form.ID} opgeslagen in Spell.dbc` });
        searchSpells(search);
      } else {
        setMsg({ type: 'error', text: result.error });
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
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

  const getFieldSections = () => [
    { title: 'Basis Info', keys: ['ID', 'Name_Lang_enUS', 'NameSubtext_Lang_enUS', 'Description_Lang_enUS', 'AuraDescription_Lang_enUS'] },
    { title: 'School & Type', keys: ['SchoolMask', 'DefenseType', 'Category', 'Mechanic'] },
    { title: 'Attributes', keys: ['Attributes', 'AttributesEx', 'AttributesEx2', 'AttributesEx3'] },
    { title: 'Timing', keys: ['CastingTimeIndex', 'RecoveryTime', 'CategoryRecoveryTime', 'DurationIndex', 'Speed'] },
    { title: 'Range & Targets', keys: ['RangeIndex', 'MaxTargetLevel', 'MaxTargets'] },
    { title: 'Mechanics', keys: ['CumulativeAura', 'ProcTypeMask', 'ProcChance', 'ProcCharges'] },
    { title: 'Power & Levels', keys: ['MaxLevel', 'BaseLevel', 'SpellLevel', 'PowerType', 'ManaCost', 'ManaCostPct', 'ManaPerSecond'] },
    { title: 'Effects', keys: ['Effect_1', 'Effect_2', 'Effect_3', 'EffectBasePoints_1', 'EffectBasePoints_2', 'EffectBasePoints_3', 'EffectAura_1', 'EffectAura_2', 'EffectAura_3', 'EffectTriggerSpell_1', 'EffectTriggerSpell_2', 'EffectTriggerSpell_3'] },
    { title: 'Visual & Priority', keys: ['SpellClassSet', 'SpellIconID', 'SpellVisualID_1', 'SpellPriority'] },
  ];

  return (
    <>
      <div className="editor-page-header">
        <h2 className="editor-page-title">Spell Editor</h2>
        <p className="editor-page-subtitle">Manage spell data and properties</p>
      </div>
      <div className="editor-layout">
        <div className="editor-list">
          <div className="editor-list-header">
            <div className="search-box">
              <Search size={13} />
              <input
                ref={searchRef}
                placeholder="Search name or entry..."
                value={search}
                onChange={e => { setSearch(e.target.value); searchSpells(e.target.value); }}
              />
            </div>
          </div>
          <div className="list-items">
            {loading && <div className="loading-text">Searching...</div>}
            {!loading && spells.map(s => (
              <div
                key={s.ID}
                className={`list-item ${selected?.ID === s.ID ? 'active' : ''}`}
                onClick={() => selectSpell(s.ID)}
              >
                <div className="list-item-main">
                  <span className="list-item-name">{s.Name_Lang_enUS || '(unnamed)'}</span>
                  <ChevronRight size={12} className="list-item-arrow" />
                </div>
                <div className="list-item-meta">
                  <span className="mono">#{s.ID}</span>
                </div>
              </div>
            ))}
            {!loading && spells.length === 0 && <div className="loading-text">No results</div>}
          </div>
        </div>

        <div className="editor-form">
          {!selected ? (
            <div className="editor-empty">
              <MousePointerClick />
              <p>Select a spell to edit</p>
            </div>
          ) : (
            <>
              <div className="page-header">
                <div>
                  <h1 className="page-title">{selected.Name_Lang_enUS || '(unnamed)'}{dirty && <span style={{color: 'var(--gold)', marginLeft: '8px'}}>●</span>}</h1>
                  <p className="page-sub">Entry #{selected.ID} · Spell.dbc</p>
                </div>
                <div className="header-actions">
                  {dirty && <button className="btn-ghost" onClick={() => { setForm(selected); setDirty(false); }}><RotateCcw size={13}/> Reset</button>}
                  <button className="btn-ghost" onClick={handleCopy} disabled={copying} title="Kloon naar nieuw ID">
                    <Copy size={13}/> {copying ? 'Klonen...' : 'Copy'}
                  </button>
                  <button className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
                    <Save size={13}/> {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}
              <div className="form-fields">
                {getFieldSections().map((section, idx) => (
                  <div key={idx}>
                    <h4 className="field-section-title">{section.title}</h4>
                    {section.keys.map(key => {
                      const f = SPELL_FIELDS.find(fld => fld.key === key);
                      if (!f) return null;
                      return (
                        <div key={f.key} className={`field-group ${f.type === 'textarea' ? 'field-wide' : ''}`}>
                          <label>{f.label}</label>
                          {f.type === 'textarea' ? (
                            <textarea rows={2} value={form[f.key] ?? ''} onChange={e => handleChange(f.key, e.target.value)} />
                          ) : f.type === 'select' ? (
                            <select value={form[f.key] ?? ''} onChange={e => handleChange(f.key, e.target.value)}>
                              {f.options.map(o => {
                                const [val, lbl] = o.split(':');
                                return <option key={val} value={val}>{lbl}</option>;
                              })}
                            </select>
                          ) : (
                            <input type={f.type} value={form[f.key] ?? ''} onChange={e => handleChange(f.key, e.target.value)} readOnly={f.readonly} />
                          )}
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
