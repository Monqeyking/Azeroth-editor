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
  { id: 12, name: 'Worgen',    faction: 'alliance', icon: 'race_worgen_male' },
  { id: 5,  name: 'Undead',    faction: 'horde',    icon: 'race_scourge_male' },
  { id: 6,  name: 'Tauren',    faction: 'horde',    icon: 'race_tauren_male' },
  { id: 8,  name: 'Troll',     faction: 'horde',    icon: 'race_troll_male' },
  { id: 10, name: 'Blood Elf', faction: 'horde',    icon: 'race_bloodelf_female' },
  { id: 9,  name: 'Goblin',    faction: 'horde',    icon: 'race_goblin_male' },
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
const PRIMARY_STAT_FIELDS = [
  { key: 'str', label: 'Strength' },
  { key: 'agi', label: 'Agility' },
  { key: 'sta', label: 'Stamina' },
  { key: 'inte', label: 'Intellect' },
  { key: 'spi', label: 'Spirit' },
];
const CLASS_STAT_FIELDS = [
  { key: 'basehp', label: 'Base HP' },
  { key: 'basemana', label: 'Base Mana' },
];
const TOTEM_TYPES = [
  { id: 1, label: 'Fire Totem' },
  { id: 2, label: 'Earth Totem' },
  { id: 3, label: 'Water Totem' },
  { id: 4, label: 'Air Totem' },
];
const ICON_BASE = 'https://wow.zamimg.com/images/wow/icons/medium/';

const OUTFIT_SLOTS = ['Head', 'Neck', 'Shoulder', 'Shirt', 'Chest', 'Waist', 'Legs', 'Feet', 'Wrist', 'Hands', 'Ring 1', 'Ring 2', 'Trinket 1', 'Trinket 2', 'Back', 'Main hand', 'Off hand', 'Ranged', 'Tabard', 'Slot 20', 'Slot 21', 'Slot 22', 'Slot 23', 'Slot 24'];
const sourceKey = (race, classId) => `${race}:${classId}`;
const OUTFIT_BUILDER_SLOTS = [4, 9, 5, 6, 7, 15, 16].map(slotIndex => ({ slotIndex, name: OUTFIT_SLOTS[slotIndex] }));
const sourceLabel = (race, classId) => `${RACES.find(r => r.id === race)?.name || `Race ${race}`} ${CLASSES.find(c => c.id === classId)?.name || `Class ${classId}`}`;

function getMaskFromId(id) {
  return 1 << (Number(id) - 1);
}

function rankLabel(rank) {
  const num = Number(rank) || 0;
  return num > 0 ? `Rank ${num}` : 'Passive';
}

function genderLabel(gender) {
  return gender === 0 ? 'Male' : gender === 1 ? 'Female' : `Gender ${gender}`;
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ raceId, classId, query, dbcPath, readSkillLineTree, readCharStartOutfit, onClose, onMsg }) {
  const [tab, setTab] = useState('position');
  const [posForm, setPosForm] = useState(null);
  const [posDirty, setPosDirty] = useState(false);
  const [posSaving, setPosSaving] = useState(false);
  const [actions, setActions] = useState([]);
  const [spellNames, setSpellNames] = useState({});
  const [actionsDirty, setActionsDirty] = useState(false);
  const [actionsSaving, setActionsSaving] = useState(false);
  const [statRows, setStatRows] = useState([]);
  const [classStatRows, setClassStatRows] = useState([]);
  const [statsDirty, setStatsDirty] = useState(false);
  const [statsSaving, setStatsSaving] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [skillRows, setSkillRows] = useState([]);
  const [skillTree, setSkillTree] = useState([]);
  const [startBarSpells, setStartBarSpells] = useState([]);
  const [startOutfits, setStartOutfits] = useState([]);
  const [outfitNames, setOutfitNames] = useState({});
  const [totemRows, setTotemRows] = useState([]);
  const [totemsDirty, setTotemsDirty] = useState(false);
  const [totemsSaving, setTotemsSaving] = useState(false);
  const [skillTreeError, setSkillTreeError] = useState('');

  const raceName  = RACES.find(r => r.id === raceId)?.name  ?? raceId;
  const className = CLASSES.find(c => c.id === classId)?.name ?? classId;
  const classColor = CLASSES.find(c => c.id === classId)?.color;
  const raceMask = getMaskFromId(raceId);
  const classMask = getMaskFromId(classId);
  const isShaman = Number(classId) === 7;

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

  useEffect(() => {
    query(
      'SELECT skill, rank FROM playercreateinfo_skills WHERE raceMask = ? AND classMask = ? ORDER BY skill',
      [raceMask, classMask]
    ).then(r => {
      setSkillRows((r.data || []).map(row => ({
        skill: Number(row.skill),
        rank: Number(row.rank) || 0,
      })));
    }).catch(() => {
      setSkillRows([]);
    });
  }, [query, raceMask, classMask]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      query('SELECT Race, Strength, Agility, Stamina, Intellect, Spirit FROM player_race_stats WHERE Race = ?', [raceId]),
      query('SELECT Class, Level, BaseHP, BaseMana, Strength, Agility, Stamina, Intellect, Spirit FROM player_class_stats WHERE Class = ? ORDER BY Level', [classId]),
    ]).then(([raceStats, classStats]) => {
      if (cancelled) return;
      const mappedRaceStats = (raceStats.data || []).map(row => ({
        race: Number(row.Race),
        str: Number(row.Strength) || 0,
        agi: Number(row.Agility) || 0,
        sta: Number(row.Stamina) || 0,
        inte: Number(row.Intellect) || 0,
        spi: Number(row.Spirit) || 0,
      }));
      const mappedClassStats = (classStats.data || []).map(row => ({
        classId: Number(row.Class),
        level: Number(row.Level),
        basehp: Number(row.BaseHP) || 0,
        basemana: Number(row.BaseMana) || 0,
        str: Number(row.Strength) || 0,
        agi: Number(row.Agility) || 0,
        sta: Number(row.Stamina) || 0,
        inte: Number(row.Intellect) || 0,
        spi: Number(row.Spirit) || 0,
      }));

      if (!raceStats.success) {
        setStatsError(raceStats.error || 'Could not load player_race_stats');
        setStatRows([]);
        setClassStatRows(mappedClassStats);
        setStatsDirty(false);
        return;
      }

      if (!classStats.success) {
        setStatsError(classStats.error || 'Could not load player_class_stats');
        setStatRows(mappedRaceStats);
        setClassStatRows([]);
        setStatsDirty(false);
        return;
      }

      setStatsError('');
      setStatRows(mappedRaceStats);
      setClassStatRows(mappedClassStats);
      setStatsDirty(false);
    }).catch(err => {
      if (cancelled) return;
      setStatsError(err?.message || 'Could not load starting stats');
      setStatRows([]);
      setClassStatRows([]);
      setStatsDirty(false);
    });

    return () => {
      cancelled = true;
    };
  }, [query, raceId, classId]);

  useEffect(() => {
    if (!isShaman) {
      setTotemRows([]);
      setTotemsDirty(false);
      return;
    }
    query('SELECT TotemID, RaceID, ModelID FROM player_totem_model WHERE RaceID = ? ORDER BY TotemID', [raceId])
      .then(r => {
        const byId = new Map((r.data || []).map(row => [Number(row.TotemID), { totemId: Number(row.TotemID), raceId: Number(row.RaceID), modelId: Number(row.ModelID) || 0 }]));
        setTotemRows(TOTEM_TYPES.map(t => byId.get(t.id) || { totemId: t.id, raceId, modelId: 0 }));
        setTotemsDirty(false);
      })
      .catch(() => {
        setTotemRows(TOTEM_TYPES.map(t => ({ totemId: t.id, raceId, modelId: 0 })));
        setTotemsDirty(false);
      });
  }, [isShaman, query, raceId]);

  useEffect(() => {
    readCharStartOutfit({ race: raceId, classId }).then(async result => {
      if (!result?.success) {
        setStartOutfits([]);
        setOutfitNames({});
        return;
      }
      const rows = result.data || [];
      setStartOutfits(rows);
      const itemIds = [...new Set(rows.flatMap(row => row.items || []).map(item => Number(item.itemId)).filter(id => id > 0))];
      if (!itemIds.length) {
        setOutfitNames({});
        return;
      }

      try {
        const placeholders = itemIds.map(() => '?').join(',');
        const namesRes = await query(`SELECT entry, name FROM item_template WHERE entry IN (${placeholders})`, itemIds);
        const map = {};
        (namesRes.data || []).forEach(row => { map[Number(row.entry)] = row.name; });
        setOutfitNames(map);
      } catch {
        setOutfitNames({});
      }
    }).catch(() => {
      setStartOutfits([]);
      setOutfitNames({});
    });
  }, [readCharStartOutfit, query, raceId, classId]);

  useEffect(() => {
    const spellIds = [...new Set(
      actions
        .filter(a => Number(a.type) === 0 && Number(a.action) > 0)
        .map(a => Number(a.action))
    )];
    if (!spellIds.length) {
      setSkillTree([]);
      setStartBarSpells([]);
      setSkillTreeError('');
      return;
    }

    readSkillLineTree({ spellIds, raceMask, classMask }).then(result => {
      if (!result?.success) {
        setSkillTree([]);
        setStartBarSpells([]);
        setSkillTreeError(result?.error || 'Could not read skill line data');
        return;
      }

      const grouped = new Map();
      const startBar = [];
      for (const action of actions) {
        if (Number(action.type) !== 0 || Number(action.action) <= 0) continue;
        const spellId = Number(action.action);
        const spellName = spellNames[spellId] || `Spell #${spellId}`;
        const spellData = result.data?.[spellId] || { matches: [], allMatches: [] };
        const matches = spellData.matches || [];
        const allMatches = spellData.allMatches || [];
        const nodes = matches.length ? matches : [
          { skillLineId: 0, skillLineName: 'Unmapped', categoryName: 'Other', minSkillLineRank: 0 }
        ];
        const hasOtherRaceMatch = !matches.length && allMatches.some(row => Number(row.raceMask) && !(Number(row.raceMask) & raceMask));

        startBar.push({
          button: Number(action.button),
          spellId,
          spellName,
          hasMatch: matches.length > 0,
          hasOtherRaceMatch,
          topLabel: matches[0]?.skillLineName || allMatches[0]?.skillLineName || 'No direct combo match',
        });

        for (const node of nodes) {
          const groupKey = `${node.categoryName}::${node.skillLineId}`;
          if (!grouped.has(groupKey)) {
            grouped.set(groupKey, {
              categoryName: node.categoryName,
              skillLineId: node.skillLineId,
              skillLineName: node.skillLineName,
              items: [],
            });
          }
          grouped.get(groupKey).items.push({
            button: Number(action.button),
            spellId,
            spellName,
            minSkillLineRank: Number(node.minSkillLineRank) || 0,
            suspect: !matches.length,
            otherRaceOnly: hasOtherRaceMatch,
          });
        }
      }

      const tree = [...grouped.values()]
        .map(group => ({
          ...group,
          items: group.items.sort((a, b) => a.button - b.button || a.spellName.localeCompare(b.spellName)),
        }))
        .sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.skillLineName.localeCompare(b.skillLineName));

      setStartBarSpells(startBar.sort((a, b) => a.button - b.button || a.spellName.localeCompare(b.spellName)));
      setSkillTree(tree);
      setSkillTreeError('');
    });
  }, [actions, spellNames, readSkillLineTree, raceMask, classMask]);

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
  const updatePrimaryStat = (field, value) => {
    setStatRows(rows => rows.map(row => ({ ...row, [field]: Number(value) || 0 })));
    setStatsDirty(true);
  };

  const updateClassStat = (field, value) => {
    setClassStatRows(rows => rows.map(row => row.level === 1 ? { ...row, [field]: Number(value) || 0 } : row));
    setStatsDirty(true);
  };

  const saveStats = async () => {
    const raceStats = statRows[0];
    const classLevelOne = classStatRows.find(row => row.level === 1);
    if (!raceStats) {
      onMsg({ type: 'error', text: `No player_race_stats row found for ${raceName}` });
      return;
    }
    if (!classLevelOne) {
      onMsg({ type: 'error', text: `No level 1 player_class_stats row found for ${className}` });
      return;
    }

    setStatsSaving(true);
    const raceResult = await query(
      'UPDATE player_race_stats SET Strength = ?, Agility = ?, Stamina = ?, Intellect = ?, Spirit = ? WHERE Race = ?',
      [raceStats.str, raceStats.agi, raceStats.sta, raceStats.inte, raceStats.spi, raceId]
    );
    if (!raceResult.success) {
      setStatsSaving(false);
      onMsg({ type: 'error', text: `Could not save player_race_stats: ${raceResult.error}` });
      return;
    }

    const classResult = await query(
      'UPDATE player_class_stats SET BaseHP = ?, BaseMana = ?, Strength = ?, Agility = ?, Stamina = ?, Intellect = ?, Spirit = ? WHERE Class = ? AND Level = 1',
      [classLevelOne.basehp, classLevelOne.basemana, classLevelOne.str, classLevelOne.agi, classLevelOne.sta, classLevelOne.inte, classLevelOne.spi, classId]
    );
    if (!classResult.success) {
      setStatsSaving(false);
      onMsg({ type: 'error', text: `player_race_stats saved, but player_class_stats failed: ${classResult.error}` });
      return;
    }

    setStatsDirty(false);
    setStatsSaving(false);
    onMsg({ type: 'success', text: `Starting stats saved for ${raceName} ${className}` });
  };

  const saveTotems = async () => {
    setTotemsSaving(true);
    for (const row of totemRows) {
      await query('INSERT INTO player_totem_model (TotemID, RaceID, ModelID) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ModelID = VALUES(ModelID)', [row.totemId, raceId, row.modelId]);
    }
    setTotemsDirty(false);
    setTotemsSaving(false);
    onMsg({ type: 'success', text: `? Totem models saved for ${raceName}` });
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
          <button className={tab === 'skills' ? 'active' : ''} onClick={() => setTab('skills')}>
            Skill Tree {(skillTree.length > 0 || skillRows.length > 0) && <span className="rc-tab-count">{skillTree.length + skillRows.length}</span>}
          </button>
          <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
            Starting Stats {(statRows.length > 0 || classStatRows.length > 0) && <span className="rc-tab-count">L1</span>}
          </button>
          <button className={tab === 'outfits' ? 'active' : ''} onClick={() => setTab('outfits')}>
            Start Outfit {startOutfits.length > 0 && <span className="rc-tab-count">{startOutfits.length}</span>}
          </button>
          {isShaman && (
            <button className={tab === 'totems' ? 'active' : ''} onClick={() => setTab('totems')}>
              Totems <span className="rc-tab-count">4</span>
            </button>
          )}
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
      {tab === 'stats' && (
        <div className="rc-detail-body">
          {statsError ? (
            <div className="rc-skill-empty">{statsError}</div>
          ) : (
            <>
              <div className="rc-stats-grid">
                <div className="rc-stats-card">
                  <div className="rc-skill-section-head">
                    <span className="rc-skill-section-title">Level 1 Primary Stats</span>
                    <span className="rc-skill-section-sub">From player_race_stats for this race only</span>
                  </div>
                  {statRows[0] ? (
                    <div className="rc-stats-fields">
                      {PRIMARY_STAT_FIELDS.map(field => (
                        <label key={field.key} className="rc-wizard-field">
                          <span>{field.label}</span>
                          <input
                            type="number"
                            step="1"
                            value={statRows[0]?.[field.key] ?? 0}
                            onChange={e => updatePrimaryStat(field.key, e.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="rc-skill-empty">No player_race_stats row found for this race.</div>
                  )}
                </div>

                <div className="rc-stats-card">
                  <div className="rc-skill-section-head">
                    <span className="rc-skill-section-title">Level 1 Class Baseline</span>
                    <span className="rc-skill-section-sub">From player_class_stats level 1 for this class</span>
                  </div>
                  <div className="rc-stats-note">
                    These values are class-wide at level 1. The final character result is class baseline plus race stats.
                  </div>
                  {classStatRows.find(row => row.level === 1) ? (
                    <div className="rc-stats-fields two-col">
                      {CLASS_STAT_FIELDS.map(field => (
                        <label key={field.key} className="rc-wizard-field">
                          <span>{field.label}</span>
                          <input
                            type="number"
                            step="1"
                            value={classStatRows.find(row => row.level === 1)?.[field.key] ?? 0}
                            onChange={e => updateClassStat(field.key, e.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="rc-skill-empty">No level 1 player_class_stats row found for this class.</div>
                  )}
                </div>
              </div>

              <div className="rc-stats-preview">
                <div className="rc-skill-section-head">
                  <span className="rc-skill-section-title">Level Preview</span>
                  <span className="rc-skill-section-sub">Quick read-only sanity check for the first few levels</span>
                </div>
                <div className="rc-action-table-wrap">
                  <table className="rc-action-table">
                    <thead>
                      <tr>
                        <th>Level</th>
                        <th>Str</th>
                        <th>Agi</th>
                        <th>Sta</th>
                        <th>Int</th>
                        <th>Spi</th>
                        <th>Base HP</th>
                        <th>Base Mana</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classStatRows.slice(0, 5).map(row => {
                        const raceRow = statRows[0] || { str: 0, agi: 0, sta: 0, inte: 0, spi: 0 };
                        return (
                          <tr key={row.level}>
                            <td>{row.level}</td>
                            <td>{row.str + raceRow.str}</td>
                            <td>{row.agi + raceRow.agi}</td>
                            <td>{row.sta + raceRow.sta}</td>
                            <td>{row.inte + raceRow.inte}</td>
                            <td>{row.spi + raceRow.spi}</td>
                            <td>{row.basehp ?? '-'}</td>
                            <td>{row.basemana ?? '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rc-detail-footer">
                <button className="btn-save" onClick={saveStats} disabled={!statsDirty || statsSaving}>
                  <Save size={13} />
                  {statsSaving ? 'Saving...' : 'Save Starting Stats'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'outfits' && (
        <div className="rc-detail-body">
          {startOutfits.length > 0 ? (
            <div className="rc-outfit-list">
              {startOutfits.map(outfit => (
                <div key={`${outfit.id}-${outfit.gender}-${outfit.outfitId}`} className="rc-outfit-card">
                  <div className="rc-outfit-head">
                    <span className="rc-outfit-title">{genderLabel(outfit.gender)}</span>
                    <span className="rc-outfit-meta">Record {outfit.id}</span>
                    <span className="rc-outfit-meta">Race {outfit.race}</span>
                    <span className="rc-outfit-meta">Class {outfit.classId}</span>
                    <span className="rc-outfit-meta">Outfit {outfit.outfitId}</span>
                    <span className="rc-outfit-meta">{outfit.items.length} items</span>
                    <div className="rc-outfit-debug">
                      <span className="rc-outfit-meta">Packed tuple {outfit.race}/{outfit.classId}/{outfit.gender}/{outfit.outfitId}</span>
                    </div>
                  </div>
                  <div className="rc-outfit-items">
                    {outfit.items.map(item => (
                      <div key={`${outfit.id}-${item.slotIndex}-${item.itemId}`} className="rc-outfit-item">
                        <span className="rc-outfit-slot">Inv {item.inventorySlot || item.slotIndex}</span>
                        <span className="rc-outfit-name">{outfitNames[item.itemId] || `Item #${item.itemId || 0}`}</span>
                        <span className="rc-outfit-meta">Item {item.itemId > 0 ? item.itemId : '-'}</span>
                        <span className="rc-outfit-meta">Display {item.displayId > 0 ? item.displayId : '-'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rc-skill-empty">No CharStartOutfit rows found for this combo.</div>
          )}
        </div>
      )}
      {tab === 'totems' && isShaman && (
        <div className="rc-detail-body">
          <div className="rc-totem-list">
            {TOTEM_TYPES.map(type => {
              const row = totemRows.find(entry => entry.totemId === type.id) || { modelId: 0 };
              return (
                <label key={type.id} className="rc-totem-row">
                  <span className="rc-totem-label">{type.label}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="rc-action-input md"
                    value={row.modelId ?? 0}
                    onChange={e => updateTotemModel(type.id, e.target.value)}
                  />
                  <span className="rc-totem-meta">ModelID</span>
                </label>
              );
            })}
          </div>
          <div className="rc-detail-footer">
            <button className="btn-save" onClick={saveTotems} disabled={!totemsDirty || totemsSaving}>
              <Save size={13} />
              {totemsSaving ? 'Saving?' : 'Save Totems'}
            </button>
          </div>
        </div>
      )}

      {tab === 'skills' && (
        <div className="rc-detail-body">
          <div className="rc-skill-section">
            <div className="rc-skill-section-head">
              <span className="rc-skill-section-title">Start Bar Spells</span>
              <span className="rc-skill-section-sub">Exact race+class action-bar rows, including inherited references</span>
            </div>
            {startBarSpells.length > 0 ? (
              <div className="rc-startbar-list">
                {startBarSpells.map(item => (
                  <div key={`${item.button}-${item.spellId}`} className="rc-startbar-item">
                    <span className="rc-skill-button">#{item.button}</span>
                    <span className="rc-skill-spell">{item.spellName}</span>
                    <span className="rc-skill-meta">Spell {item.spellId}</span>
                    <span className="rc-skill-meta">{item.topLabel}</span>
                    {!item.hasMatch && <span className="rc-suspect-badge">No direct combo match</span>}
                    {item.hasOtherRaceMatch && <span className="rc-suspect-badge warn">Inherited reference</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rc-skill-empty">No spell actions on the start bar for this combo.</div>
            )}
          </div>

          <div className="rc-skill-section">
            <div className="rc-skill-section-head">
              <span className="rc-skill-section-title">Combo Skills</span>
              <span className="rc-skill-section-sub">playercreateinfo_skills rows plus grouped skillline references</span>
            </div>

            {skillRows.length > 0 && (
              <div className="rc-skill-ranks">
                {skillRows.map(row => (
                  <div key={row.skill} className="rc-skill-rank-pill">
                    <span className="rc-skill-rank-id">Skill #{row.skill}</span>
                    <span className="rc-skill-rank-value">{rankLabel(row.rank)}</span>
                  </div>
                ))}
              </div>
            )}

            {skillTreeError && <div className="rc-skill-empty">{skillTreeError}</div>}

            {!skillTreeError && skillTree.length > 0 && (
              <div className="rc-skill-tree">
                {skillTree.map(group => (
                  <div key={`${group.categoryName}-${group.skillLineId}`} className="rc-skill-group">
                    <div className="rc-skill-group-head">
                      <span className="rc-skill-category">{group.categoryName}</span>
                      <span className="rc-skill-line-name">{group.skillLineName}</span>
                      <span className="rc-skill-count">{group.items.length}</span>
                    </div>
                    <div className="rc-skill-items">
                      {group.items.map(item => (
                        <div key={`${group.skillLineId}-${item.spellId}-${item.button}`} className="rc-skill-item">
                          <span className="rc-skill-button">#{item.button}</span>
                          <span className="rc-skill-spell">{item.spellName}</span>
                          <span className="rc-skill-meta">Spell {item.spellId}</span>
                          {item.minSkillLineRank > 0 && <span className="rc-skill-meta">{rankLabel(item.minSkillLineRank)}</span>}
                          {item.suspect && <span className="rc-suspect-badge">No direct combo match</span>}
                          {item.otherRaceOnly && <span className="rc-suspect-badge warn">Inherited reference</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!skillTreeError && skillTree.length === 0 && skillRows.length === 0 && (
              <div className="rc-skill-empty">
                No grouped combo skills found yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RaceClassPage() {
  const { query, dbcPath, readSkillLineTree, readCharStartOutfit, appendCharStartOutfit } = useConnection();
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
    const outfitResult = await readCharStartOutfit({});
    const outfits = outfitResult.success ? outfitResult.data : [];
    const sources = [...new Map(outfits.map(row => [sourceKey(row.race, row.classId), { key: sourceKey(row.race, row.classId), race: row.race, classId: row.classId }])).values()];
    const outfitSource = sources.find(source => source.race === raceId)?.key
      ?? sources.find(source => source.classId === classId && RACES.find(r => r.id === source.race)?.faction === RACES.find(r => r.id === raceId)?.faction)?.key
      ?? sources[0]?.key
      ?? '';
    const totemSource = dbCombos.find(combo => combo.class === 7 && RACES.find(r => r.id === combo.race)?.faction === RACES.find(r => r.id === raceId)?.faction)?.race ?? '';
    setWizard({ raceId, classId, form, templateSource, outfits, sources, outfitSource, slotSources: {}, totemSource });
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
        'INSERT IGNORE INTO playercreateinfo (race, `class`, map, zone, position_x, position_y, position_z, orientation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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

      if (classId === 7) {
      if (wizard.outfitSource) {
        const outfitRows = [0, 1].map(gender => ({
          race: raceId,
          classId,
          gender,
          outfitId: 0,
          items: OUTFIT_SLOTS.map((_, slotIndex) => {
            const [sourceRace, sourceClass] = String(wizard.slotSources[slotIndex] || wizard.outfitSource).split(':').map(Number);
            const source = wizard.outfits.find(row => row.race === sourceRace && row.classId === sourceClass && row.gender === gender);
            return source?.items.find(item => item.slotIndex === slotIndex) || { slotIndex, itemId: 0, displayId: 0, inventorySlot: 0 };
          }).filter(item => item.itemId || item.displayId || item.inventorySlot),
        }));
        const outfitResult = await appendCharStartOutfit(outfitRows);
        if (!outfitResult.success) throw new Error(`Start outfit failed: ${outfitResult.error}`);
      }

        const donor = dbCombos.find(c => c.race === Number(wizard.totemSource)) ?? dbCombos.find(c => c.class === 7 && RACES.find(r => r.id === c.race)?.faction === RACES.find(r => r.id === raceId)?.faction)
          ?? dbCombos.find(c => c.class === 7);
        if (donor) {
          const donorTotems = await query('SELECT TotemID, ModelID FROM player_totem_model WHERE RaceID = ? ORDER BY TotemID', [donor.race]);
          for (const row of donorTotems.data || []) {
            await query('INSERT INTO player_totem_model (TotemID, RaceID, ModelID) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ModelID = VALUES(ModelID)', [row.TotemID, raceId, row.ModelID]);
          }
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

  const activeRaces = RACES.filter(r =>
    CLASSES.some(cls => hasCombo(r.id, cls.id))
  );
  const selectedRaceData = activeRaces.find(r => r.id === selectedRace);

  useEffect(() => {
    if (activeRaces.length && !selectedRaceData) {
      setSelectedRace(activeRaces[0].id);
      setDetailCombo(null);
    }
  }, [activeRaces, selectedRaceData]);

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
            {activeRaces.filter(r => r.faction === faction).map(r => {
              const count = CLASSES.filter(cls => hasCombo(r.id, cls.id)).length;
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
            readSkillLineTree={readSkillLineTree}
            readCharStartOutfit={readCharStartOutfit}
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
            <div className="rc-outfit-builder">
              <label className="rc-wizard-field">
                <span>Start outfit base</span>
                <select value={wizard.outfitSource} onChange={e => setWizard(w => ({ ...w, outfitSource: e.target.value, slotSources: {} }))}>
                  {wizard.sources.map(source => <option key={source.key} value={source.key}>{sourceLabel(source.race, source.classId)}</option>)}
                </select>
              </label>
              <div className="rc-outfit-slots">
                {OUTFIT_BUILDER_SLOTS.map(({ name, slotIndex }) => (
                  <label key={name} className="rc-wizard-field">
                    <span>{name}</span>
                    <select value={wizard.slotSources[slotIndex] || wizard.outfitSource} onChange={e => setWizard(w => ({ ...w, slotSources: { ...w.slotSources, [slotIndex]: e.target.value } }))}>
                      {wizard.sources.map(source => <option key={source.key} value={source.key}>{sourceLabel(source.race, source.classId)}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {wizard.classId === 7 && <label className="rc-wizard-field">
                <span>Totem model set</span>
                <select value={wizard.totemSource} onChange={e => setWizard(w => ({ ...w, totemSource: e.target.value }))}>
                  {RACES.filter(r => dbCombos.some(c => c.race === r.id && c.class === 7)).map(r => <option key={r.id} value={r.id}>{r.name} Shaman</option>)}
                </select>
              </label>}
            </div>

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





