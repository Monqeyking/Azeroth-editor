import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { AlertTriangle, X, Plus, Trash2, Save } from 'lucide-react';
import './EditorPage.css';
import './RaceClassPage.css';

const RACES = [
  { id: 1,  name: 'Human',     faction: 'alliance', icon: 'race_human_male' },
  { id: 3,  name: 'Dwarf',     faction: 'alliance', icon: 'race_dwarf_male' },
  { id: 4,  name: 'Night Elf', faction: 'alliance', icon: 'race_nightelf_female' },
  { id: 7,  name: 'Gnome',     faction: 'alliance', icon: 'race_gnome_male' },
  { id: 11, name: 'Draenei',   faction: 'alliance', icon: 'race_draenei_female' },
  { id: 2,  name: 'Orc',       faction: 'horde',    icon: 'race_orc_male' },
  { id: 5,  name: 'Undead',    faction: 'horde',    icon: 'race_scourge_male' },
  { id: 6,  name: 'Tauren',    faction: 'horde',    icon: 'race_tauren_male' },
  { id: 8,  name: 'Troll',     faction: 'horde',    icon: 'race_troll_male' },
  { id: 10, name: 'Blood Elf', faction: 'horde',    icon: 'race_bloodelf_female' },
];

const CLASSES = [
  { id: 1,  name: 'Warrior',      color: '#c69b3a', icon: 'classicon_warrior' },
  { id: 2,  name: 'Paladin',      color: '#f58cba', icon: 'classicon_paladin' },
  { id: 3,  name: 'Hunter',       color: '#abd473', icon: 'classicon_hunter' },
  { id: 4,  name: 'Rogue',        color: '#fff569', icon: 'classicon_rogue' },
  { id: 5,  name: 'Priest',       color: '#ffffff', icon: 'classicon_priest' },
  { id: 6,  name: 'Death Knight', color: '#c41e3a', icon: 'classicon_deathknight' },
  { id: 7,  name: 'Shaman',       color: '#0070de', icon: 'classicon_shaman' },
  { id: 8,  name: 'Mage',         color: '#69ccf0', icon: 'classicon_mage' },
  { id: 9,  name: 'Warlock',      color: '#9482c9', icon: 'classicon_warlock' },
  { id: 11, name: 'Druid',        color: '#ff7d0a', icon: 'classicon_druid' },
];

const PCI_FIELDS = [
  { key: 'map',         label: 'Map' },
  { key: 'zone',        label: 'Zone' },
  { key: 'position_x', label: 'Position X', step: '0.0001' },
  { key: 'position_y', label: 'Position Y', step: '0.0001' },
  { key: 'position_z', label: 'Position Z', step: '0.0001' },
  { key: 'orientation', label: 'Orientation', step: '0.0001' },
];

const ACTION_TYPES = { 0: 'Spell', 1: 'Item', 64: 'Macro', 128: 'CMacro' };
const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/medium/';

// ── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ raceId, classId, query, dbcPath, onClose, onMsg }) {
  const [tab, setTab] = useState('position');
  const [posForm, setPosForm] = useState(null);
  const [posDirty, setPosDirty] = useState(false);
  const [posSaving, setPosSaving] = useState(false);
  const [actions, setActions] = useState([]);
  const [spellNames, setSpellNames] = useState({});
  const [actionsDirty, setActionsDirty] = useState(false);
  const [actionsSaving, setActionsSaving] = useState(false);

  const raceName  = RACES.find(r => r.id === raceId)?.name  ?? raceId;
  const className = CLASSES.find(c => c.id === classId)?.name ?? classId;
  const classColor = CLASSES.find(c => c.id === classId)?.color;

  // Load position
  useEffect(() => {
    query('SELECT * FROM playercreateinfo WHERE race = ? AND `class` = ?', [raceId, classId])
      .then(r => { if (r.data?.[0]) setPosForm({ ...r.data[0] }); });
  }, [raceId, classId]);

  // Load actions + spell names
  useEffect(() => {
    query(
      'SELECT button, action, type FROM playercreateinfo_action WHERE race = ? AND `class` = ? ORDER BY button',
      [raceId, classId]
    ).then(async r => {
      const rows = (r.data || []).map((a, i) => ({ ...a, _key: i }));
      setActions(rows);

      // Batch spell name lookup — only type=0 (spell) actions
      const spellIds = [...new Set(rows.filter(a => Number(a.type) === 0 && Number(a.action) > 0).map(a => Number(a.action)))];
      if (spellIds.length) {
        const map = {};
        // 1. MySQL spell_dbc
        const placeholders = spellIds.map(() => '?').join(',');
        const dbNames = await query(
          `SELECT ID, Name_Lang_enUS FROM spell_dbc WHERE ID IN (${placeholders})`,
          spellIds
        );
        (dbNames.data || []).forEach(s => { map[Number(s.ID)] = s.Name_Lang_enUS; });
        // 2. Spell.dbc fallback voor IDs niet in DB
        const missing = spellIds.filter(id => !map[id]);
        if (missing.length) {
          const dbcNames = await window.azeroth.dbc.readSpells(dbcPath, missing);
          if (dbcNames?.data) {
            Object.entries(dbcNames.data).forEach(([id, s]) => { map[Number(id)] = s.name; });
          }
        }
        setSpellNames(map);
      }
    });
  }, [raceId, classId]);

  const lookupSpellName = async (spellId) => {
    if (!spellId || spellNames[spellId]) return;
    const r = await query('SELECT ID, Name_Lang_enUS FROM spell_dbc WHERE ID = ?', [Number(spellId)]);
    if (r.data?.[0]) {
      setSpellNames(m => ({ ...m, [spellId]: r.data[0].Name_Lang_enUS }));
    } else {
      const d = await window.azeroth.dbc.readSpells(dbcPath, [Number(spellId)]);
      if (d?.data?.[spellId]) setSpellNames(m => ({ ...m, [spellId]: d.data[spellId].name }));
    }
  };

  const savePosition = async () => {
    setPosSaving(true);
    const r = await query(
      'UPDATE playercreateinfo SET map=?, zone=?, position_x=?, position_y=?, position_z=?, orientation=? WHERE race=? AND `class`=?',
      [posForm.map, posForm.zone, posForm.position_x, posForm.position_y, posForm.position_z, posForm.orientation, raceId, classId]
    );
    setPosSaving(false);
    if (r.success) { setPosDirty(false); onMsg({ type: 'success', text: `✓ Start position saved for ${raceName} ${className}` }); }
    else onMsg({ type: 'error', text: `✗ ${r.error}` });
  };

  const saveActions = async () => {
    setActionsSaving(true);
    await query('DELETE FROM playercreateinfo_action WHERE race = ? AND `class` = ?', [raceId, classId]);
    for (const a of actions) {
      await query(
        'INSERT INTO playercreateinfo_action (race, `class`, button, action, type) VALUES (?, ?, ?, ?, ?)',
        [raceId, classId, a.button, a.action, a.type]
      );
    }
    setActionsDirty(false);
    setActionsSaving(false);
    onMsg({ type: 'success', text: `✓ Action bar saved for ${raceName} ${className} (${actions.length} entries)` });
  };

  const addAction = () => {
    setActions(a => [...a, { button: 0, action: 0, type: 0, _key: Date.now() }]);
    setActionsDirty(true);
  };

  const removeAction = (key) => {
    setActions(a => a.filter(r => r._key !== key));
    setActionsDirty(true);
  };

  const updateAction = (key, field, value) => {
    setActions(a => a.map(r => r._key === key ? { ...r, [field]: value } : r));
    setActionsDirty(true);
    if (field === 'action' && Number(actions.find(r => r._key === key)?.type) === 0) {
      lookupSpellName(Number(value));
    }
  };

  return (
    <div className="rc-detail">
      <div className="rc-detail-header">
        <span className="rc-detail-title" style={{ color: classColor }}>
          {raceName} — {className}
        </span>
        <div className="rc-detail-tabs">
          <button className={tab === 'position' ? 'active' : ''} onClick={() => setTab('position')}>
            Start Position
          </button>
          <button className={tab === 'actions' ? 'active' : ''} onClick={() => setTab('actions')}>
            Action Bar {actions.length > 0 && <span className="rc-tab-count">{actions.length}</span>}
          </button>
        </div>
        <button className="rc-wizard-close" onClick={onClose}><X size={14} /></button>
      </div>

      {tab === 'position' && posForm && (
        <div className="rc-detail-body">
          <div className="rc-wizard-fields">
            {PCI_FIELDS.map(f => (
              <label key={f.key} className="rc-wizard-field">
                <span>{f.label}</span>
                <input
                  type="number"
                  step={f.step ?? '1'}
                  value={posForm[f.key] ?? 0}
                  onChange={e => { setPosForm(p => ({ ...p, [f.key]: e.target.value })); setPosDirty(true); }}
                />
              </label>
            ))}
          </div>
          <div className="rc-detail-footer">
            <button className="btn-save" onClick={savePosition} disabled={!posDirty || posSaving}>
              <Save size={13} />
              {posSaving ? 'Saving…' : 'Save Position'}
            </button>
          </div>
        </div>
      )}

      {tab === 'actions' && (
        <div className="rc-detail-body">
          <div className="rc-action-table-wrap">
            <table className="rc-action-table">
              <thead>
                <tr>
                  <th>Button</th>
                  <th>Action ID</th>
                  <th>Type</th>
                  <th>Spell name</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {actions.map(a => (
                  <tr key={a._key}>
                    <td>
                      <input
                        type="text" inputMode="numeric"
                        value={a.button}
                        onChange={e => updateAction(a._key, 'button', e.target.value)}
                        className="rc-action-input sm"
                      />
                    </td>
                    <td>
                      <input
                        type="text" inputMode="numeric"
                        value={a.action}
                        onChange={e => updateAction(a._key, 'action', e.target.value)}
                        onBlur={e => Number(a.type) === 0 && lookupSpellName(Number(e.target.value))}
                        className="rc-action-input md"
                      />
                    </td>
                    <td>
                      <select
                        value={a.type}
                        onChange={e => updateAction(a._key, 'type', Number(e.target.value))}
                        className="rc-action-select"
                      >
                        {Object.entries(ACTION_TYPES).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td className="rc-action-spellname">
                      {Number(a.type) === 0
                        ? (spellNames[Number(a.action)]
                            ?? <span className="rc-unknown">#{a.action} (not in spell_dbc)</span>)
                        : <span className="rc-unknown">—</span>
                      }
                    </td>
                    <td>
                      <button className="rc-action-del" onClick={() => removeAction(a._key)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rc-detail-footer">
            <button className="rc-action-add" onClick={addAction}>
              <Plus size={13} /> Add row
            </button>
            <button className="btn-save" onClick={saveActions} disabled={!actionsDirty || actionsSaving}>
              <Save size={13} />
              {actionsSaving ? 'Saving…' : `Save Action Bar`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RaceClassPage() {
  const { query, dbcPath } = useConnection();
  const [dbCombos, setDbCombos]   = useState([]);
  const [dbcCombos, setDbcCombos] = useState([]);
  const [selectedRace, setSelectedRace] = useState(1);
  const [detailCombo, setDetailCombo]   = useState(null); // {raceId, classId}
  const [loading, setLoading]           = useState(false);
  const [msg, setMsg]                   = useState(null);
  const [confirmDisable, setConfirmDisable] = useState(null);
  const [wizard, setWizard]             = useState(null);
  const [wizardSaving, setWizardSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const r = await query('SELECT race, `class` FROM playercreateinfo', []);
    if (r.data) setDbCombos(r.data.map(c => ({ race: Number(c.race), class: Number(c.class) })));
    const d = await window.azeroth.dbc.readCharBaseInfo(dbcPath);
    if (d.success) setDbcCombos(d.combos.map(c => ({ race: Number(c.race), class: Number(c.class) })));
    setLoading(false);
  }, [query, dbcPath]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const hasCombo = (raceId, classId) =>
    dbCombos.some(c => c.race === raceId && c.class === classId) &&
    dbcCombos.some(c => c.race === raceId && c.class === classId);

  const openWizard = async (raceId, classId) => {
    setDetailCombo(null);
    let tmpl = dbCombos.find(c => c.race === raceId) ?? dbCombos.find(c => c.class === classId);
    let form = { map: 0, zone: 0, position_x: 0, position_y: 0, position_z: 0, orientation: 0 };
    let templateSource = null;
    if (tmpl) {
      const r = await query('SELECT * FROM playercreateinfo WHERE race = ? AND `class` = ?', [tmpl.race, tmpl.class]);
      if (r.data?.[0]) {
        const t = r.data[0];
        form = { map: t.map, zone: t.zone, position_x: t.position_x, position_y: t.position_y, position_z: t.position_z, orientation: t.orientation };
        templateSource = `${RACES.find(r => r.id === tmpl.race)?.name} ${CLASSES.find(c => c.id === tmpl.class)?.name}`;
      }
    }
    setWizard({ raceId, classId, form, templateSource });
  };

  const handleToggle = (raceId, classId, checked) => {
    setMsg(null);
    if (checked) openWizard(raceId, classId);
    else { setDetailCombo(null); setConfirmDisable({ raceId, classId }); }
  };

  const handleDisable = async () => {
    const { raceId, classId } = confirmDisable;
    setConfirmDisable(null);
    const raceMask = 1 << (raceId - 1);
    const classMask = 1 << (classId - 1);
    await query('DELETE FROM playercreateinfo WHERE race = ? AND `class` = ?', [raceId, classId]);
    await query('DELETE FROM playercreateinfo_action WHERE race = ? AND `class` = ?', [raceId, classId]);
    await query('DELETE FROM playercreateinfo_spell_custom WHERE racemask = ? AND classmask = ?', [raceMask, classMask]);
    await query('DELETE FROM playercreateinfo_skills WHERE raceMask = ? AND classMask = ?', [raceMask, classMask]);
    const newDbc = dbcCombos.filter(c => !(c.race === raceId && c.class === classId));
    const dbcResult = await window.azeroth.dbc.writeCharBaseInfo(dbcPath, newDbc);
    const rn = RACES.find(r => r.id === raceId)?.name;
    const cn = CLASSES.find(c => c.id === classId)?.name;
    setMsg(dbcResult.success
      ? { type: 'success', text: `✓ ${rn} ${cn} removed from DB + CharBaseInfo.dbc` }
      : { type: 'error',   text: `DB deleted but DBC write failed: ${dbcResult.error}` }
    );
    await loadAll();
  };

  const handleWizardSave = async () => {
    const { raceId, classId, form } = wizard;
    setWizardSaving(true);
    setMsg(null);
    try {
      const r = await query(
        'INSERT INTO playercreateinfo (race, `class`, map, zone, position_x, position_y, position_z, orientation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [raceId, classId, form.map, form.zone, form.position_x, form.position_y, form.position_z, form.orientation]
      );
      if (!r.success) throw new Error(r.error);

      const actionTmpl = dbCombos.find(c => c.class === classId);
      let copiedActions = 0;
      if (actionTmpl) {
        const actions = await query('SELECT button, action, type FROM playercreateinfo_action WHERE race = ? AND `class` = ?', [actionTmpl.race, actionTmpl.class]);
        if (actions.data?.length) {
          for (const a of actions.data) {
            await query('INSERT IGNORE INTO playercreateinfo_action (race, `class`, button, action, type) VALUES (?, ?, ?, ?, ?)', [raceId, classId, a.button, a.action, a.type]);
          }
          copiedActions = actions.data.length;
        }
      }

      const newDbc = [...dbcCombos, { race: raceId, class: classId }];
      const dbcResult = await window.azeroth.dbc.writeCharBaseInfo(dbcPath, newDbc);
      if (!dbcResult.success) throw new Error(`DB saved but DBC write failed: ${dbcResult.error}`);

      const rn = RACES.find(r => r.id === raceId)?.name;
      const cn = CLASSES.find(c => c.id === classId)?.name;
      setMsg({ type: 'success', text: `✓ ${rn} ${cn} created${copiedActions ? ` · ${copiedActions} action bar entries copied` : ''} · CharBaseInfo.dbc updated` });
      setWizard(null);
      await loadAll();
    } catch (e) {
      setMsg({ type: 'error', text: `✗ ${e.message}` });
    }
    setWizardSaving(false);
  };

  const selectedRaceData = RACES.find(r => r.id === selectedRace);

  return (
    <div className="rc-page">
      <div className="editor-page-header">
        <h1 className="editor-page-title">Race &amp; Class</h1>
        <p className="editor-page-subtitle">
          Manage available race+class combinations — syncs to <code>playercreateinfo</code> + <code>CharBaseInfo.dbc</code>
          {loading && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>Loading…</span>}
        </p>
      </div>

      {msg && (
        <div className={`rc-msg ${msg.type}`}>
          {msg.text}
          <button onClick={() => setMsg(null)}><X size={14} /></button>
        </div>
      )}

      {/* Race bar */}
      <div className="rc-race-bar">
        {['alliance', 'horde'].map(faction => (
          <div key={faction} className="rc-faction-strip">
            <span className={`rc-faction-label ${faction}`}>
              {faction === 'alliance' ? 'Alliance' : 'Horde'}
            </span>
            {RACES.filter(r => r.faction === faction).map(r => {
              const count = dbCombos.filter(c => c.race === r.id).length;
              return (
                <button
                  key={r.id}
                  className={`rc-race-btn ${r.faction} ${selectedRace === r.id ? 'active' : 'dimmed'}`}
                  onClick={() => { setSelectedRace(r.id); setWizard(null); setDetailCombo(null); }}
                  title={r.name}
                >
                  <img src={`${ICON_BASE}${r.icon}.jpg`} alt={r.name} className="rc-race-icon" />
                  <span className="rc-race-name">{r.name}</span>
                  <span className="rc-race-count">{count}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Class grid */}
      <div className="rc-main">
        <div className="rc-section-title">
          <span className={`rc-faction-dot ${selectedRaceData?.faction}`} />
          {selectedRaceData?.name} — available classes
          {detailCombo && <span className="rc-section-hint">Click a class again to close the panel</span>}
        </div>

        <div className="rc-class-grid">
          {CLASSES.map(cls => {
            const enabled  = hasCombo(selectedRace, cls.id);
            const selected = detailCombo?.raceId === selectedRace && detailCombo?.classId === cls.id;
            return (
              <div
                key={cls.id}
                className={`rc-class-card ${enabled ? 'enabled' : ''} ${selected ? 'selected' : ''}`}
                onClick={() => enabled && setDetailCombo(d =>
                  d?.raceId === selectedRace && d?.classId === cls.id ? null : { raceId: selectedRace, classId: cls.id }
                )}
              >
                <span className="rc-class-name" style={{ color: enabled ? cls.color : undefined }}>
                  {cls.name}
                </span>
                <img className="rc-class-icon" src={`${ICON_BASE}${cls.icon}.jpg`} alt={cls.name} />
                <input
                  type="checkbox"
                  checked={enabled}
                  onClick={e => e.stopPropagation()}
                  onChange={e => handleToggle(selectedRace, cls.id, e.target.checked)}
                />
              </div>
            );
          })}
        </div>

        {/* Detail panel (open when a class card is selected) */}
        {detailCombo && detailCombo.raceId === selectedRace && (
          <DetailPanel
            raceId={detailCombo.raceId}
            classId={detailCombo.classId}
            query={query}
            dbcPath={dbcPath}
            onClose={() => setDetailCombo(null)}
            onMsg={setMsg}
          />
        )}

        {/* Wizard (new combo) */}
        {wizard && wizard.raceId === selectedRace && (
          <div className="rc-wizard">
            <div className="rc-wizard-header">
              <strong>
                New combination: {RACES.find(r => r.id === wizard.raceId)?.name}{' '}
                {CLASSES.find(c => c.id === wizard.classId)?.name}
              </strong>
              {wizard.templateSource && (
                <span className="rc-wizard-template">Based on: {wizard.templateSource}</span>
              )}
              <button className="rc-wizard-close" onClick={() => setWizard(null)}><X size={14} /></button>
            </div>
            <div className="rc-wizard-fields">
              {PCI_FIELDS.map(f => (
                <label key={f.key} className="rc-wizard-field">
                  <span>{f.label}</span>
                  <input
                    type="number"
                    step={f.step ?? '1'}
                    value={wizard.form[f.key]}
                    onChange={e => setWizard(w => ({ ...w, form: { ...w.form, [f.key]: e.target.value } }))}
                  />
                </label>
              ))}
            </div>
            <div className="rc-wizard-footer">
              <span className="rc-wizard-note">Action bar copied from same class. DBC updated automatically.</span>
              <button className="btn-save" onClick={handleWizardSave} disabled={wizardSaving}>
                {wizardSaving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmDisable && (
        <div className="rc-overlay">
          <div className="rc-dialog">
            <AlertTriangle size={20} className="rc-dialog-icon" />
            <p>
              Remove <strong>
                {RACES.find(r => r.id === confirmDisable.raceId)?.name}{' '}
                {CLASSES.find(c => c.id === confirmDisable.classId)?.name}
              </strong>?
            </p>
            <p className="rc-dialog-sub">
              Deletes from <code>playercreateinfo</code>, <code>playercreateinfo_action</code>, exact-match bitmask rows in <code>spell_custom</code> / <code>skills</code>, and removes the entry from <code>CharBaseInfo.dbc</code>.
            </p>
            <div className="rc-dialog-btns">
              <button onClick={() => setConfirmDisable(null)}>Cancel</button>
              <button className="btn-danger" onClick={handleDisable}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
