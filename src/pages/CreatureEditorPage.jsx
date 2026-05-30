import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Plus, Save, RotateCcw, Copy, ChevronRight, MousePointerClick, Columns2, ClipboardCopy, Trash2 } from 'lucide-react';
import FlagsSelector from '../components/FlagsSelector';
import CreatureModelPreview from '../components/creature/CreatureModelPreview';
import { prefetchM2Models } from '../components/editor3d/m2Loader';
import '../pages/DashboardPage.css';
import './EditorPage.css';

const NPC_FLAG = { TRAINER: 16, CLASS_TRAINER: 32, PROFESSION_TRAINER: 64, VENDOR: 128 };

const TRAINER_TYPES = [
  { value: 0, label: 'Class' },
  { value: 1, label: 'Mount' },
  { value: 2, label: 'Tradeskill' },
  { value: 3, label: 'Pet' },
];

const TRAINER_CLASSES = [
  { value: 1, label: 'Warrior' }, { value: 2, label: 'Paladin' }, { value: 3, label: 'Hunter' },
  { value: 4, label: 'Rogue' }, { value: 5, label: 'Priest' }, { value: 6, label: 'Death Knight' },
  { value: 7, label: 'Shaman' }, { value: 8, label: 'Mage' }, { value: 9, label: 'Warlock' },
  { value: 11, label: 'Druid' },
];

const MODEL_COLUMNS = ['Idx', 'CreatureDisplayID', 'DisplayScale', 'Probability', 'VerifiedBuild'];

const SUB_TABS = [
  { id: 'general', label: 'General Fields' },
  { id: 'models', label: 'Template Model' },
  { id: 'addon', label: 'Addon' },
  { id: 'trainer', label: 'Trainer Settings', role: 'trainer' },
  { id: 'vendor', label: 'Vendor Items', role: 'vendor' },
  { id: 'spawns', label: 'World Spawns', role: 'spawn' },
];

const ADDON_FIELDS = [
  { key: 'path_id', label: 'Path ID', type: 'number' },
  { key: 'mount', label: 'Mount', type: 'number' },
  { key: 'bytes1', label: 'Bytes1', type: 'number' },
  { key: 'bytes2', label: 'Bytes2', type: 'number' },
  { key: 'emote', label: 'Emote', type: 'number' },
  { key: 'aiAnimKit', label: 'AI Anim Kit', type: 'number' },
  { key: 'movementAnimKit', label: 'Movement Anim Kit', type: 'number' },
  { key: 'meleeAnimKit', label: 'Melee Anim Kit', type: 'number' },
  { key: 'visibilityDistanceType', label: 'Visibility Distance', type: 'number' },
  { key: 'auras', label: 'Auras', type: 'text' },
];

const EMPTY_ADDON = () => ({
  path_id: 0, mount: 0, bytes1: 0, bytes2: 0, emote: 0,
  aiAnimKit: 0, movementAnimKit: 0, meleeAnimKit: 0, visibilityDistanceType: 0, auras: '',
});

const EMPTY_MODEL_ROW = (idx = 0) => ({
  Idx: idx, CreatureDisplayID: 0, DisplayScale: 1, Probability: 1, VerifiedBuild: 0,
});

function normalizeModelRows(rows) {
  if (!rows?.length) return [EMPTY_MODEL_ROW(0)];
  return rows.map((r, i) => ({
    Idx: r.Idx ?? i,
    CreatureDisplayID: r.CreatureDisplayID ?? 0,
    DisplayScale: r.DisplayScale ?? 1,
    Probability: r.Probability ?? 1,
    VerifiedBuild: r.VerifiedBuild ?? 0,
  }));
}

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
  { key: 'RangeAttackTime',  label: 'Range Attack Time', type: 'number' },
  { key: 'unit_class',       label: 'Unit Class',      type: 'number' },
  { key: 'rank',             label: 'Rank',            type: 'select', options: ['0:Normal','1:Elite','2:Rare Elite','3:Boss','4:Rare'] },
  { key: 'type',             label: 'Type',            type: 'select', options: ['0:None','1:Beast','2:Dragonkin','3:Demon','4:Elemental','5:Giant','6:Undead','7:Humanoid','8:Critter','9:Mechanical','10:Not Specified','11:Totem','12:Non-Combat Pet','13:Gas Cloud'] },
  { key: 'family',           label: 'Family',          type: 'number' },
  { key: 'HealthModifier',   label: 'Health Modifier', type: 'decimal' },
  { key: 'ManaModifier',     label: 'Mana Modifier',   type: 'decimal' },
  { key: 'ArmorModifier',    label: 'Armor Modifier',  type: 'decimal' },
  { key: 'DamageModifier',   label: 'Damage Modifier', type: 'decimal' },
  { key: 'ExperienceModifier', label: 'XP Modifier',   type: 'decimal' },
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

const FIELD_SECTIONS = [
  { id: 'basis', title: 'Basis Info', keys: ['entry', 'name', 'subname'] },
  { id: 'levels', title: 'Levels', keys: ['minlevel', 'maxlevel'] },
  { id: 'speeds', title: 'Speeds', keys: ['speed_walk', 'speed_run', 'speed_swim', 'speed_flight'] },
  { id: 'combat', title: 'Combat', keys: ['BaseAttackTime', 'RangeAttackTime', 'unit_class'] },
  { id: 'appearance', title: 'Appearance', keys: ['faction', 'rank', 'type', 'family', 'scale', 'HoverHeight'] },
  { id: 'modifiers', title: 'Modifiers', keys: ['HealthModifier', 'ManaModifier', 'ArmorModifier', 'DamageModifier', 'ExperienceModifier'] },
  { id: 'loot', title: 'Loot & Gold', keys: ['lootid', 'pickpocketloot', 'skinloot', 'mingold', 'maxgold'] },
  { id: 'flags', title: 'Flags', keys: ['npcflag', 'unit_flags', 'unit_flags2', 'dynamicflags', 'flags_extra'] },
  { id: 'behavior', title: 'Behavior', keys: ['AIName', 'MovementType', 'RegenHealth', 'detection_range', 'ScriptName'] },
];

const EMPTY_TRAINER_SPELL = () => ({ SpellID: 0, MoneyCost: 0, ReqSkillLine: 0, ReqSkillRank: 0, ReqLevel: 0, ReqSpell: 0 });
const EMPTY_VENDOR_ROW = () => ({ item: 0, maxcount: 0, incrtime: 0, ExtendedCost: 0 });
const EMPTY_SPAWN = () => ({
  guid: null, map: 1, zoneId: 0, position_x: -2316.5, position_y: -396.2, position_z: -9.4,
  orientation: 3.14, spawnMask: 1, phaseMask: 1,
});

function hasFlag(flags, bit) { return (Number(flags) & bit) !== 0; }
function setFlag(flags, bit, on) {
  const n = Number(flags) || 0;
  return on ? (n | bit) : (n & ~bit);
}

function deriveRoles(npcflag) {
  const f = Number(npcflag) || 0;
  return {
    trainer: hasFlag(f, NPC_FLAG.TRAINER),
    vendor: hasFlag(f, NPC_FLAG.VENDOR),
    spawn: false,
  };
}

function deriveTrainerMeta(npcflag) {
  const f = Number(npcflag) || 0;
  if (hasFlag(f, NPC_FLAG.PROFESSION_TRAINER)) return { type: 2, class: 0 };
  if (hasFlag(f, NPC_FLAG.CLASS_TRAINER)) return { type: 1, class: 2 };
  return { type: 0, class: 0 };
}

function applyTrainerFlags(npcflag, meta) {
  let f = setFlag(setFlag(setFlag(npcflag, NPC_FLAG.TRAINER, true), NPC_FLAG.CLASS_TRAINER, meta.type === 1), NPC_FLAG.PROFESSION_TRAINER, meta.type === 2);
  return f;
}

export default function CreatureEditorPage() {
  const { query, soapCommand, soapConfig, findNextId, idRanges } = useConnection();
  const [search, setSearch] = useState('');
  const [creatures, setCreatures] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [roles, setRoles] = useState({ trainer: false, vendor: false, spawn: false });
  const [trainerMeta, setTrainerMeta] = useState({ type: 0, class: 2 });
  const [trainerSpells, setTrainerSpells] = useState([]);
  const [templateMeta, setTemplateMeta] = useState({});
  const [trainerDef, setTrainerDef] = useState(null);
  const [refTrainerDef, setRefTrainerDef] = useState(null);
  const [trainerDefMode, setTrainerDefMode] = useState(null); // null | 'create' | 'link'
  const [vendorItems, setVendorItems] = useState([]);
  const [spawnData, setSpawnData] = useState(EMPTY_SPAWN());
  const [addonData, setAddonData] = useState(EMPTY_ADDON());
  const [modelRows, setModelRows] = useState([EMPTY_MODEL_ROW(0)]);
  const [selectedModelIdx, setSelectedModelIdx] = useState(0);
  const [weaponSlots, setWeaponSlots] = useState({ mainhand: '', offhand: '' });
  const [weaponNames, setWeaponNames] = useState({ mainhand: '', offhand: '' });
  const [weaponDisplayIds, setWeaponDisplayIds] = useState({ mainhand: '', offhand: '' });
  const [refWeaponSlots, setRefWeaponSlots] = useState({ mainhand: '', offhand: '' });
  const [refWeaponNames, setRefWeaponNames] = useState({ mainhand: '', offhand: '' });
  const [refWeaponDisplayIds, setRefWeaponDisplayIds] = useState({ mainhand: '', offhand: '' });
  const [activeSubTab, setActiveSubTab] = useState('general');
  const [refActiveSubTab, setRefActiveSubTab] = useState('general');
  const [splitRef, setSplitRef] = useState(false);
  const [refSearch, setRefSearch] = useState('');
  const [refResults, setRefResults] = useState([]);
  const [refLoading, setRefLoading] = useState(false);
  const [refEntry, setRefEntry] = useState(null);
  const [refForm, setRefForm] = useState({});
  const [refTrainerMeta, setRefTrainerMeta] = useState({ type: 0, class: 2 });
  const [refTrainerSpells, setRefTrainerSpells] = useState([]);
  const [refVendorItems, setRefVendorItems] = useState([]);
  const [refSpawnData, setRefSpawnData] = useState(EMPTY_SPAWN());
  const [refAddonData, setRefAddonData] = useState(EMPTY_ADDON());
  const [refModelRows, setRefModelRows] = useState([EMPTY_MODEL_ROW(0)]);
  const [refSelectedModelIdx, setRefSelectedModelIdx] = useState(0);
  const [refRoles, setRefRoles] = useState({ trainer: false, vendor: false, spawn: false });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [copying, setCopying] = useState(false);
  const searchRef = useRef(null);
  const refSearchRef = useRef(null);

  const saveRecent = useCallback((entry) => {
    try {
      let recent = JSON.parse(localStorage.getItem('recent_creatures') || '[]');
      recent = recent.filter(e => e !== entry);
      recent.unshift(entry);
      localStorage.setItem('recent_creatures', JSON.stringify(recent.slice(0, 10)));
    } catch { /* noop */ }
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

  const loadRelatedData = useCallback(async (entry) => {
    const [trainerRes, vendorRes, spawnRes, addonRes, modelRes, equipRes, trainerDefRes] = await Promise.all([
      query('SELECT SpellID, MoneyCost, ReqSkillLine, ReqSkillRank, ReqLevel, ReqSpell FROM npc_trainer WHERE ID = ?', [entry]),
      query('SELECT item, maxcount, incrtime, ExtendedCost FROM npc_vendor WHERE entry = ? ORDER BY slot', [entry]),
      query('SELECT guid, map, position_x, position_y, position_z, orientation, spawnMask, phaseMask FROM creature WHERE id1 = ? LIMIT 1', [entry]),
      query('SELECT path_id, mount, bytes1, bytes2, emote, aiAnimKit, movementAnimKit, meleeAnimKit, visibilityDistanceType, auras FROM creature_template_addon WHERE entry = ?', [entry]),
      query('SELECT Idx, CreatureDisplayID, DisplayScale, Probability, VerifiedBuild FROM creature_template_model WHERE CreatureID = ? ORDER BY Idx', [entry]),
      query('SELECT ItemID1, ItemID2, ItemID3 FROM creature_equip_template WHERE CreatureID = ? AND ID = 1 LIMIT 1', [entry]),
      query('SELECT cdt.TrainerId, t.Type, t.Requirement, t.Greeting FROM creature_default_trainer cdt JOIN trainer t ON t.Id = cdt.TrainerId WHERE cdt.CreatureId = ? LIMIT 1', [entry]),
    ]);
    return {
      trainerSpells: trainerRes.data || [],
      vendorItems: vendorRes.data || [],
      spawn: spawnRes.data?.[0] || null,
      addon: addonRes.data?.[0] || null,
      models: modelRes.data || [],
      equip: equipRes.data?.[0] || null,
      trainerDef: trainerDefRes.data?.[0] || null,
    };
  }, [query]);

  useEffect(() => { searchCreatures(''); }, []);
  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const tab = SUB_TABS.find(t => t.id === activeSubTab);
    if (tab?.role && !roles[tab.role]) setActiveSubTab('general');
  }, [roles, activeSubTab]);

  const selectCreature = async (entry) => {
    const result = await query('SELECT * FROM creature_template WHERE entry = ?', [entry]);
    if (!result.data?.[0]) return;
    const row = result.data[0];
    const related = await loadRelatedData(entry);
    const roleFlags = deriveRoles(row.npcflag);
    setSelected(row);
    setForm(row);
    setRoles({ ...roleFlags, spawn: !!related.spawn });
    setTrainerMeta(deriveTrainerMeta(row.npcflag));
    setTrainerSpells(related.trainerSpells);
    setTrainerDef(related.trainerDef);
    setTrainerDefMode(null);
    setVendorItems(related.vendorItems.length ? related.vendorItems : [EMPTY_VENDOR_ROW()]);
    setSpawnData(related.spawn ? { ...related.spawn, zoneId: 0 } : EMPTY_SPAWN());
    setAddonData(related.addon ? { ...related.addon } : EMPTY_ADDON());
    const models = normalizeModelRows(related.models);
    setModelRows(models);
    setSelectedModelIdx(0);
    prefetchM2Models(models.map(m => m.CreatureDisplayID).filter(Boolean));
    const mh = related.equip?.ItemID1 || 0;
    const oh = related.equip?.ItemID2 || 0;
    setWeaponSlots({ mainhand: mh ? String(mh) : '', offhand: oh ? String(oh) : '' });
    const [mhRes, ohRes] = await Promise.all([
      mh ? query(`SELECT name, displayid FROM item_template WHERE entry = ${mh} LIMIT 1`) : Promise.resolve(null),
      oh ? query(`SELECT name, displayid FROM item_template WHERE entry = ${oh} LIMIT 1`) : Promise.resolve(null),
    ]);
    setWeaponNames({ mainhand: mhRes?.data?.[0]?.name ?? '', offhand: ohRes?.data?.[0]?.name ?? '' });
    setWeaponDisplayIds({ mainhand: mhRes?.data?.[0]?.displayid ? String(mhRes.data[0].displayid) : '', offhand: ohRes?.data?.[0]?.displayid ? String(ohRes.data[0].displayid) : '' });
    setDirty(false);
    setMsg(null);
    setErrors({});
    setActiveSubTab('general');
    saveRecent(entry);
  };

  const searchReference = useCallback(async (term) => {
    setRefLoading(true);
    const isNum = /^\d+$/.test(term);
    let sql, params;
    if (!term) {
      sql = 'SELECT entry, `name`, minlevel, maxlevel, `rank` FROM creature_template ORDER BY entry DESC LIMIT 30';
      params = [];
    } else if (isNum) {
      sql = 'SELECT entry, `name`, minlevel, maxlevel, `rank` FROM creature_template WHERE entry = ? LIMIT 30';
      params = [term];
    } else {
      sql = 'SELECT entry, `name`, minlevel, maxlevel, `rank` FROM creature_template WHERE `name` LIKE ? LIMIT 30';
      params = [`%${term}%`];
    }
    const result = await query(sql, params);
    setRefResults(result.data || []);
    setRefLoading(false);
  }, [query]);

  const loadReference = async (entry) => {
    const result = await query('SELECT * FROM creature_template WHERE entry = ?', [entry]);
    if (!result.data?.[0]) return;
    const row = result.data[0];
    const related = await loadRelatedData(entry);
    setRefEntry(entry);
    setRefForm(row);
    setRefTrainerMeta(deriveTrainerMeta(row.npcflag));
    setRefTrainerSpells(related.trainerSpells);
    setRefTrainerDef(related.trainerDef);
    setRefVendorItems(related.vendorItems);
    setRefSpawnData(related.spawn ? { ...related.spawn, zoneId: 0 } : EMPTY_SPAWN());
    setRefAddonData(related.addon ? { ...related.addon } : EMPTY_ADDON());
    const refModels = normalizeModelRows(related.models);
    setRefModelRows(refModels);
    setRefSelectedModelIdx(0);
    prefetchM2Models(refModels.map(m => m.CreatureDisplayID).filter(Boolean));
    const refMh = related.equip?.ItemID1 || 0;
    const refOh = related.equip?.ItemID2 || 0;
    setRefWeaponSlots({ mainhand: refMh ? String(refMh) : '', offhand: refOh ? String(refOh) : '' });
    const [refMhRes, refOhRes] = await Promise.all([
      refMh ? query(`SELECT name, displayid FROM item_template WHERE entry = ${refMh} LIMIT 1`) : Promise.resolve(null),
      refOh ? query(`SELECT name, displayid FROM item_template WHERE entry = ${refOh} LIMIT 1`) : Promise.resolve(null),
    ]);
    setRefWeaponNames({ mainhand: refMhRes?.data?.[0]?.name ?? '', offhand: refOhRes?.data?.[0]?.name ?? '' });
    setRefWeaponDisplayIds({ mainhand: refMhRes?.data?.[0]?.displayid ? String(refMhRes.data[0].displayid) : '', offhand: refOhRes?.data?.[0]?.displayid ? String(refOhRes.data[0].displayid) : '' });
    setRefRoles({ ...deriveRoles(row.npcflag), spawn: !!related.spawn });
    setRefActiveSubTab('general');
  };

  const validateForm = () => {
    const newErrors = {};
    if (!form.name || form.name.trim() === '') newErrors.name = 'Name is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const markDirty = () => setDirty(true);

  const handleChange = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    markDirty();
  };

  const toggleRole = (role, enabled) => {
    setRoles(r => ({ ...r, [role]: enabled }));
    if (role === 'trainer') {
      setForm(f => {
        let npcflag = Number(f.npcflag) || 0;
        if (enabled) npcflag = applyTrainerFlags(npcflag, trainerMeta);
        else npcflag = setFlag(setFlag(setFlag(npcflag, NPC_FLAG.TRAINER, false), NPC_FLAG.CLASS_TRAINER, false), NPC_FLAG.PROFESSION_TRAINER, false);
        return { ...f, npcflag };
      });
      if (enabled && activeSubTab === 'general') setActiveSubTab('trainer');
    } else if (role === 'vendor') {
      setForm(f => ({ ...f, npcflag: setFlag(f.npcflag, NPC_FLAG.VENDOR, enabled) }));
      if (enabled) setActiveSubTab('vendor');
    } else if (role === 'spawn') {
      if (enabled) setActiveSubTab('spawns');
    }
    markDirty();
  };

  const updateTrainerMeta = (patch) => {
    setTrainerMeta(prev => {
      const next = { ...prev, ...patch };
      setForm(f => ({ ...f, npcflag: applyTrainerFlags(f.npcflag, next) }));
      return next;
    });
    markDirty();
  };

  const saveTrainerData = async (entry) => {
    await query('DELETE FROM npc_trainer WHERE ID = ?', [entry]);
    for (const row of trainerSpells) {
      if (!row.SpellID) continue;
      await query(
        'INSERT INTO npc_trainer (ID, SpellID, MoneyCost, ReqSkillLine, ReqSkillRank, ReqLevel, ReqSpell) VALUES (?,?,?,?,?,?,?)',
        [entry, row.SpellID, row.MoneyCost || 0, row.ReqSkillLine || 0, row.ReqSkillRank || 0, row.ReqLevel || 0, row.ReqSpell || 0]
      );
    }
  };

  const saveTrainerDef = async (entry) => {
    if (!trainerDef?.TrainerId) return;
    await query(
      'INSERT INTO trainer (Id, Type, Requirement, Greeting, VerifiedBuild) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE Type=VALUES(Type), Requirement=VALUES(Requirement), Greeting=VALUES(Greeting)',
      [trainerDef.TrainerId, trainerDef.Type || 0, trainerDef.Requirement || 0, trainerDef.Greeting || '']
    );
    await query(
      'INSERT INTO creature_default_trainer (CreatureId, TrainerId) VALUES (?,?) ON DUPLICATE KEY UPDATE TrainerId=VALUES(TrainerId)',
      [entry, trainerDef.TrainerId]
    );
  };

  const saveVendorData = async (entry) => {
    await query('DELETE FROM npc_vendor WHERE entry = ?', [entry]);
    let slot = 0;
    for (const row of vendorItems) {
      if (!row.item) continue;
      await query(
        'INSERT INTO npc_vendor (entry, slot, item, maxcount, incrtime, ExtendedCost) VALUES (?,?,?,?,?,?)',
        [entry, slot++, row.item, row.maxcount || 0, row.incrtime || 0, row.ExtendedCost || 0]
      );
    }
  };

  const saveAddonData = async (entry) => {
    const cols = ADDON_FIELDS.map(f => f.key);
    const hasData = cols.some(k => addonData[k] !== undefined && addonData[k] !== '' && Number(addonData[k]) !== 0);
    const existing = await query('SELECT entry FROM creature_template_addon WHERE entry = ?', [entry]);
    if (!hasData && !existing.data?.length) return;
    if (!hasData) {
      await query('DELETE FROM creature_template_addon WHERE entry = ?', [entry]);
      return;
    }
    const vals = cols.map(k => addonData[k] ?? (typeof ADDON_FIELDS.find(f => f.key === k)?.type === 'text' ? '' : 0));
    if (existing.data?.length) {
      const sets = cols.map(k => `\`${k}\` = ?`).join(', ');
      await query(`UPDATE creature_template_addon SET ${sets} WHERE entry = ?`, [...vals, entry]);
    } else {
      await query(
        `INSERT INTO creature_template_addon (entry, ${cols.map(k => `\`${k}\``).join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
        [entry, ...vals]
      );
    }
  };

  const saveModelData = async (entry) => {
    await query('DELETE FROM creature_template_model WHERE CreatureID = ?', [entry]);
    for (const row of modelRows) {
      if (!row.CreatureDisplayID) continue;
      await query(
        'INSERT INTO creature_template_model (CreatureID, Idx, CreatureDisplayID, DisplayScale, Probability, VerifiedBuild) VALUES (?,?,?,?,?,?)',
        [entry, row.Idx, row.CreatureDisplayID, row.DisplayScale ?? 1, row.Probability ?? 1, row.VerifiedBuild ?? 0]
      );
    }
  };

  const saveSpawnData = async (entry) => {
    const s = spawnData;
    if (s.guid) {
      await query(
        'UPDATE creature SET map=?, position_x=?, position_y=?, position_z=?, orientation=?, spawnMask=?, phaseMask=? WHERE guid=?',
        [s.map, s.position_x, s.position_y, s.position_z, s.orientation, s.spawnMask, s.phaseMask, s.guid]
      );
    } else {
      const idResult = await findNextId({ table: 'creature', idColumn: 'guid', startId: 1 });
      if (!idResult.success) throw new Error(idResult.error);
      const guid = idResult.nextId;
      await query(
        'INSERT INTO creature (guid, id1, map, position_x, position_y, position_z, orientation, spawnMask, phaseMask) VALUES (?,?,?,?,?,?,?,?,?)',
        [guid, entry, s.map, s.position_x, s.position_y, s.position_z, s.orientation, s.spawnMask, s.phaseMask]
      );
      setSpawnData(prev => ({ ...prev, guid }));
    }
  };

  const handleSave = useCallback(async () => {
    if (!validateForm()) {
      setMsg({ type: 'error', text: 'Please fix validation errors before saving' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const fields = Object.keys(form).filter(k => k !== 'entry');
      const sets = fields.map(k => `\`${k}\` = ?`).join(', ');
      const vals = [...fields.map(k => form[k]), form.entry];
      const result = await query(`UPDATE creature_template SET ${sets} WHERE entry = ?`, vals);
      if (!result.success) throw new Error(result.error);

      if (roles.trainer) {
        await saveTrainerData(form.entry);
        await saveTrainerDef(form.entry);
      }
      if (roles.vendor) await saveVendorData(form.entry);
      if (roles.spawn) await saveSpawnData(form.entry);
      await saveAddonData(form.entry);
      await saveModelData(form.entry);

      setSelected(form);
      setDirty(false);
      setErrors({});
      if (soapConfig.user) {
        await soapCommand(`.reload creature_template`);
        if (roles.spawn) await soapCommand(`.reload creature`);
        await soapCommand(`.reload creature entry ${form.entry}`);
        setMsg({ type: 'success', text: `✓ Saved & reloaded entry ${form.entry}` });
      } else {
        setMsg({ type: 'success', text: `✓ Saved entry ${form.entry}. Configure SOAP in Settings for live reload.` });
      }
      searchCreatures(search);
    } catch (e) {
      setMsg({ type: 'error', text: `✗ Error: ${e.message}` });
    }
    setSaving(false);
  }, [form, roles, trainerSpells, vendorItems, spawnData, addonData, modelRows, query, soapConfig, soapCommand, search, searchCreatures, findNextId]);

  useEffect(() => {
    const ids = [...new Set(trainerSpells.filter(r => Number(r.SpellID) < 0).map(r => Math.abs(Number(r.SpellID))))];
    if (!ids.length) return;
    const missing = ids.filter(id => !templateMeta[id]);
    if (!missing.length) return;
    Promise.all(missing.map(id =>
      query('SELECT MIN(ReqLevel) as minLvl, MAX(ReqLevel) as maxLvl, COUNT(*) as cnt FROM npc_trainer WHERE ID = ?', [id])
        .then(res => ({ id, ...(res.data?.[0] || {}) }))
    )).then(results => {
      setTemplateMeta(prev => {
        const next = { ...prev };
        results.forEach(r => { next[r.id] = r; });
        return next;
      });
    });
  }, [trainerSpells, query]);

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
    await query('INSERT INTO creature_template (entry, name, minlevel, maxlevel, rank, type) VALUES (?,?,?,?,?,?)',
      [newEntry, 'New Creature', 1, 1, 0, 0]);
    await searchCreatures(search);
    selectCreature(newEntry);
  };

  const handleReset = () => {
    if (!selected) return;
    selectCreature(selected.entry);
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
      const result = await query(`INSERT INTO creature_template (${cols}) VALUES (${fields.map(() => '?').join(', ')})`, vals);
      if (!result.success) throw new Error(result.error);
      await searchCreatures(search);
      await selectCreature(newId);
      setMsg({ type: 'success', text: `✓ Gekloond naar entry #${newId}` });
    } catch (e) {
      setMsg({ type: 'error', text: `✗ Klonen mislukt: ${e.message}` });
    }
    setCopying(false);
  };

  const copySectionFromRef = (sectionId) => {
    if (!refForm.entry) return;
    if (sectionId === 'trainer') {
      setTrainerSpells(refTrainerSpells.map(r => ({ ...r })));
      setTrainerMeta({ ...refTrainerMeta });
      setRoles(r => ({ ...r, trainer: true }));
      setForm(f => ({ ...f, npcflag: applyTrainerFlags(f.npcflag, refTrainerMeta) }));
    } else if (sectionId === 'vendor') {
      setVendorItems(refVendorItems.length ? refVendorItems.map(r => ({ ...r })) : [EMPTY_VENDOR_ROW()]);
      setRoles(r => ({ ...r, vendor: true }));
      setForm(f => ({ ...f, npcflag: setFlag(f.npcflag, NPC_FLAG.VENDOR, true) }));
    } else if (sectionId === 'spawns') {
      setSpawnData({ ...refSpawnData, guid: null });
      setRoles(r => ({ ...r, spawn: true }));
    } else if (sectionId === 'addon') {
      setAddonData({ ...refAddonData });
    } else if (sectionId === 'models') {
      const copied = normalizeModelRows(refModelRows);
      setModelRows(copied);
      setSelectedModelIdx(0);
      prefetchM2Models(copied.map(m => m.CreatureDisplayID).filter(Boolean));
    } else {
      const section = FIELD_SECTIONS.find(s => s.id === sectionId);
      if (!section) return;
      const patch = {};
      section.keys.forEach(k => { if (refForm[k] !== undefined) patch[k] = refForm[k]; });
      setForm(f => ({ ...f, ...patch }));
    }
    markDirty();
  };

  const isTabLocked = (tab, tabRoles) => tab.role && !tabRoles[tab.role];
  const isRefTabAvailable = (tab) => {
    if (!tab.role) return true;
    if (tab.role === 'trainer') return refRoles.trainer || refTrainerSpells.length > 0;
    if (tab.role === 'vendor') return refRoles.vendor || refVendorItems.length > 0;
    if (tab.role === 'spawn') return refRoles.spawn || !!refSpawnData.guid;
    return refRoles[tab.role];
  };

  useEffect(() => {
    const tab = SUB_TABS.find(t => t.id === refActiveSubTab);
    if (tab && !isRefTabAvailable(tab)) setRefActiveSubTab('general');
  }, [refRoles, refTrainerSpells, refVendorItems, refSpawnData, refActiveSubTab]);

  const renderField = (f, value, onChange, readOnly, fieldErrors) => {
    const hasError = fieldErrors?.[f.key];
    return (
      <div key={f.key} className={`field-group ${hasError ? 'field-error' : ''}`}>
        <label>{f.label}{f.required && <span style={{ color: 'var(--accent-red)' }}>*</span>}</label>
        {f.type === 'flags' ? (
          readOnly
            ? <input type="number" value={value ?? 0} readOnly />
            : <FlagsSelector field={f.field} value={value ?? 0} onChange={onChange} label={f.label} />
        ) : f.type === 'select' ? (
          <select value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={readOnly || f.readonly}>
            {f.options.map(o => {
              const [val, lbl] = o.split(':');
              return <option key={val} value={val}>{lbl}</option>;
            })}
          </select>
        ) : (
          <input
            type={f.type === 'decimal' ? 'number' : f.type}
            step={f.type === 'decimal' ? '0.01' : undefined}
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            readOnly={readOnly || f.readonly}
            title={hasError ? fieldErrors[f.key] : ''}
          />
        )}
        {hasError && <span style={{ fontSize: '11px', color: 'var(--accent-red)' }}>{fieldErrors[f.key]}</span>}
      </div>
    );
  };

  const renderGeneralPanel = (data, onFieldChange, readOnly, onCopySection) => (
    <>
      {!readOnly && (
        <div className="creature-role-checklist">
          <label><input type="checkbox" checked={roles.trainer} onChange={e => toggleRole('trainer', e.target.checked)} /> Is Trainer</label>
          <label><input type="checkbox" checked={roles.vendor} onChange={e => toggleRole('vendor', e.target.checked)} /> Is Vendor</label>
          <label><input type="checkbox" checked={roles.spawn} onChange={e => toggleRole('spawn', e.target.checked)} /> Spawn in World</label>
        </div>
      )}
      {FIELD_SECTIONS.map(section => (
        <div key={section.id} className="creature-section-block">
          <div className="creature-section-head">
            <h4 className="field-section-title">{section.title}</h4>
            {readOnly && onCopySection && (
              <button type="button" className="btn-ghost creature-copy-section" onClick={() => onCopySection(section.id)} title="Copy section to draft">
                <ClipboardCopy size={12} />
              </button>
            )}
          </div>
          <div className="form-fields creature-section-fields">
            {section.keys.map(key => {
              const f = CREATURE_FIELDS.find(fld => fld.key === key);
              if (!f) return null;
              return renderField(f, data[key], v => onFieldChange(f.key, v), readOnly, readOnly ? {} : errors);
            })}
          </div>
        </div>
      ))}
    </>
  );

  const renderTrainerPanel = (spells, meta, setSpells, setMeta, readOnly, onCopySection, tmplMeta = {}, tDef = null, setTDef = null, defMode = null, setDefMode = null) => {
    const templateRefs = spells.filter(r => Number(r.SpellID) < 0);
    const directSpells = spells.filter(r => Number(r.SpellID) > 0);

    const updateRow = (idx, patch) => {
      const next = [...spells];
      next[idx] = { ...next[idx], ...patch };
      setSpells(next);
      markDirty();
    };
    const removeRow = (idx) => { setSpells(spells.filter((_, j) => j !== idx)); markDirty(); };

    const templateGlobalIdx = (tRef) => spells.indexOf(tRef);
    const spellGlobalIdx = (sRef) => spells.indexOf(sRef);

    return (
      <div className="creature-section-block">
        <div className="creature-section-head">
          <h4 className="field-section-title">Trainer Configuration</h4>
          {readOnly && onCopySection && (
            <button type="button" className="btn-ghost creature-copy-section" onClick={() => onCopySection('trainer')} title="Copy trainer data to draft">
              <ClipboardCopy size={12} />
            </button>
          )}
        </div>
        {tDef && (
          <>
            <h5 className="field-subsection-title">
              Trainer Definition
              {tDef._isNew && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>NEW — wordt aangemaakt bij Save</span>}
            </h5>
            <div className="creature-meta-row">
              <div className="field-group">
                <label>Trainer ID</label>
                <input type="text" inputMode="numeric" value={tDef.TrainerId} readOnly={readOnly || !!tDef._isNew}
                  style={tDef._isNew ? { opacity: 0.6 } : {}}
                  onChange={e => setTDef?.({ ...tDef, TrainerId: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="field-group">
                <label>Type</label>
                <select value={tDef.Type ?? 0} disabled={readOnly}
                  onChange={e => { setTDef?.({ ...tDef, Type: Number(e.target.value) }); markDirty(); }}>
                  {TRAINER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              {(tDef.Type === 0 || tDef.Type === 3) && (
                <div className="field-group">
                  <label>Required Class</label>
                  <select value={tDef.Requirement ?? 0} disabled={readOnly}
                    onChange={e => { setTDef?.({ ...tDef, Requirement: Number(e.target.value) }); markDirty(); }}>
                    <option value={0}>—</option>
                    {TRAINER_CLASSES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              )}
              {tDef.Type === 1 && (
                <div className="field-group">
                  <label>Required Race</label>
                  <input type="text" inputMode="numeric" value={tDef.Requirement ?? 0} readOnly={readOnly}
                    onChange={e => { setTDef?.({ ...tDef, Requirement: parseInt(e.target.value) || 0 }); markDirty(); }} />
                </div>
              )}
              {tDef.Type === 2 && (
                <div className="field-group">
                  <label>Required Spell ID</label>
                  <input type="text" inputMode="numeric" value={tDef.Requirement ?? 0} readOnly={readOnly}
                    onChange={e => { setTDef?.({ ...tDef, Requirement: parseInt(e.target.value) || 0 }); markDirty(); }} />
                </div>
              )}
            </div>
            <div className="creature-meta-row">
              <div className="field-group" style={{ flex: 1 }}>
                <label>Greeting</label>
                <input type="text" value={tDef.Greeting ?? ''} readOnly={readOnly}
                  onChange={e => { setTDef?.({ ...tDef, Greeting: e.target.value }); markDirty(); }} />
              </div>
            </div>
          </>
        )}
        {!tDef && !readOnly && defMode === null && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button type="button" className="btn-ghost creature-add-row" onClick={async () => {
              const res = await query('SELECT COALESCE(MAX(Id),0)+1 AS nextId FROM trainer');
              const nextId = res.data?.[0]?.nextId || 1;
              setTDef({ TrainerId: nextId, Type: 0, Requirement: 0, Greeting: '', _isNew: true });
              setDefMode('create');
              markDirty();
            }}>
              <Plus size={12} /> Create New Trainer
            </button>
            <button type="button" className="btn-ghost creature-add-row" onClick={() => setDefMode('link')}>
              Link Existing Trainer
            </button>
          </div>
        )}
        {!tDef && !readOnly && defMode === 'link' && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px' }}>
            <div className="field-group">
              <label>Trainer ID</label>
              <input type="text" inputMode="numeric" placeholder="bijv. 3"
                onBlur={async e => {
                  const id = parseInt(e.target.value);
                  if (!id) return;
                  const res = await query('SELECT Id, Type, Requirement, Greeting FROM trainer WHERE Id = ?', [id]);
                  if (res.data?.[0]) {
                    setTDef({ TrainerId: res.data[0].Id, Type: res.data[0].Type, Requirement: res.data[0].Requirement, Greeting: res.data[0].Greeting });
                    setDefMode(null);
                    markDirty();
                  }
                }}
              />
            </div>
            <button type="button" className="btn-ghost" onClick={() => setDefMode(null)}>Cancel</button>
          </div>
        )}

        <h5 className="field-subsection-title">Trainer Templates</h5>
        <p className="field-hint">Negative SpellID references — links this trainer to a shared spell group.</p>
        <table className="creature-data-table">
          <thead>
            <tr><th>Template ID</th><th>Info</th>{!readOnly && <th></th>}</tr>
          </thead>
          <tbody>
            {templateRefs.length === 0 && (
              <tr><td colSpan={readOnly ? 2 : 3} style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No templates assigned</td></tr>
            )}
            {templateRefs.map((row, i) => {
              const gi = templateGlobalIdx(row);
              const tid = Math.abs(Number(row.SpellID));
              const tm = tmplMeta[tid];
              const desc = tm ? `${tm.cnt} spell${tm.cnt !== 1 ? 's' : ''} · Lvl ${tm.minLvl}–${tm.maxLvl}` : null;
              return (
                <tr key={i}>
                  <td>
                    <input
                      type="text" inputMode="numeric"
                      value={tid}
                      readOnly={readOnly}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        updateRow(gi, { SpellID: isNaN(v) ? 0 : -Math.abs(v) });
                      }}
                    />
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '11px', whiteSpace: 'nowrap' }}>
                    {desc ?? '—'}
                  </td>
                  {!readOnly && (
                    <td>
                      <button type="button" className="btn-ghost icon-btn" onClick={() => removeRow(gi)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!readOnly && (
          <button type="button" className="btn-ghost creature-add-row"
            onClick={() => { setSpells([...spells, { SpellID: -200000, MoneyCost: 0, ReqSkillLine: 0, ReqSkillRank: 0, ReqLevel: 0, ReqSpell: 0 }]); markDirty(); }}>
            <Plus size={12} /> Add Template
          </button>
        )}

        <h5 className="field-subsection-title" style={{ marginTop: '1rem' }}>Direct Spells</h5>
        <p className="field-hint">Individual spells added directly to this trainer (positive SpellID).</p>
        <table className="creature-data-table">
          <thead>
            <tr><th>SpellID</th><th>Cost</th><th>Req Skill</th><th>Skill Rank</th><th>Req Lvl</th><th>Req Spell</th>{!readOnly && <th></th>}</tr>
          </thead>
          <tbody>
            {directSpells.length === 0 && (
              <tr><td colSpan={readOnly ? 6 : 7} style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No direct spells</td></tr>
            )}
            {directSpells.map((row, i) => {
              const gi = spellGlobalIdx(row);
              return (
                <tr key={i}>
                  {['SpellID', 'MoneyCost', 'ReqSkillLine', 'ReqSkillRank', 'ReqLevel', 'ReqSpell'].map(col => (
                    <td key={col}>
                      <input type="text" inputMode="numeric" value={row[col] ?? 0} readOnly={readOnly}
                        onChange={e => updateRow(gi, { [col]: e.target.value })} />
                    </td>
                  ))}
                  {!readOnly && (
                    <td>
                      <button type="button" className="btn-ghost icon-btn" onClick={() => removeRow(gi)}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!readOnly && (
          <button type="button" className="btn-ghost creature-add-row"
            onClick={() => { setSpells([...spells, EMPTY_TRAINER_SPELL()]); markDirty(); }}>
            <Plus size={12} /> Add Spell
          </button>
        )}
      </div>
    );
  };

  const renderVendorPanel = (items, setItems, readOnly, onCopySection) => (
    <div className="creature-section-block">
      <div className="creature-section-head">
        <h4 className="field-section-title">Vendor Items</h4>
        {readOnly && onCopySection && (
          <button type="button" className="btn-ghost creature-copy-section" onClick={() => onCopySection('vendor')} title="Copy vendor items to draft">
            <ClipboardCopy size={12} />
          </button>
        )}
      </div>
      <table className="creature-data-table">
        <thead>
          <tr><th>Item</th><th>Max Count</th><th>Incr Time</th><th>Extended Cost</th>{!readOnly && <th></th>}</tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i}>
              {['item', 'maxcount', 'incrtime', 'ExtendedCost'].map(col => (
                <td key={col}>
                  <input type="number" value={row[col] ?? 0} readOnly={readOnly}
                    onChange={e => {
                      const next = [...items];
                      next[i] = { ...next[i], [col]: e.target.value };
                      setItems(next);
                      markDirty();
                    }} />
                </td>
              ))}
              {!readOnly && (
                <td>
                  <button type="button" className="btn-ghost icon-btn" onClick={() => { setItems(items.filter((_, j) => j !== i)); markDirty(); }}>
                    <Trash2 size={12} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button type="button" className="btn-ghost creature-add-row" onClick={() => { setItems([...items, EMPTY_VENDOR_ROW()]); markDirty(); }}>
          <Plus size={12} /> Add Item
        </button>
      )}
    </div>
  );

  const renderSpawnPanel = (spawn, setSpawn, readOnly, onCopySection) => (
    <div className="creature-section-block">
      <div className="creature-section-head">
        <h4 className="field-section-title">World Spawn</h4>
        {readOnly && onCopySection && (
          <button type="button" className="btn-ghost creature-copy-section" onClick={() => onCopySection('spawns')} title="Copy spawn data to draft">
            <ClipboardCopy size={12} />
          </button>
        )}
      </div>
      <div className="form-fields creature-section-fields">
        {[
          { key: 'map', label: 'Map' }, { key: 'zoneId', label: 'Zone' },
          { key: 'position_x', label: 'X', decimal: true }, { key: 'position_y', label: 'Y', decimal: true },
          { key: 'position_z', label: 'Z', decimal: true }, { key: 'orientation', label: 'Orientation', decimal: true },
          { key: 'spawnMask', label: 'Spawn Mask' }, { key: 'phaseMask', label: 'Phase Mask' },
        ].map(f => (
          <div key={f.key} className="field-group">
            <label>{f.label}</label>
            <input type="number" step={f.decimal ? '0.01' : undefined} value={spawn[f.key] ?? ''} readOnly={readOnly}
              onChange={e => { setSpawn({ ...spawn, [f.key]: e.target.value }); markDirty(); }} />
          </div>
        ))}
        {spawn.guid && <div className="creature-spawn-guid">Existing spawn GUID: {spawn.guid}</div>}
      </div>
    </div>
  );

  const renderModelsPanel = (rows, setRows, selIdx, setSelIdx, readOnly, onCopySection, previewActive, weapons, setWeapons, wNames, setWNames, wDisplayIds, setWDisplayIds) => {
    const selected = rows[selIdx] ?? rows[0];
    const updateRow = (i, col, val) => {
      const next = [...rows];
      next[i] = { ...next[i], [col]: val };
      setRows(next);
      if (col === 'CreatureDisplayID' && val) prefetchM2Models([Number(val)]);
      markDirty();
    };

    return (
      <div className="creature-section-block creature-models-panel">
        <div className="creature-section-head">
          <h4 className="field-section-title">Template Model</h4>
          {readOnly && onCopySection && (
            <button type="button" className="btn-ghost creature-copy-section" onClick={() => onCopySection('models')} title="Copy all models to draft">
              <ClipboardCopy size={12} />
            </button>
          )}
        </div>
        {!readOnly && (
          <div className="creature-model-toolbar">
            <button type="button" className="btn-ghost creature-add-row" onClick={() => {
              const nextIdx = rows.length ? Math.max(...rows.map(r => Number(r.Idx) || 0)) + 1 : 0;
              setRows([...rows, EMPTY_MODEL_ROW(nextIdx)]);
              setSelIdx(rows.length);
              markDirty();
            }}>
              <Plus size={12} /> Add row
            </button>
            <button type="button" className="btn-ghost" disabled={!rows.length}
              onClick={() => {
                const row = rows[selIdx];
                if (!row) return;
                const nextIdx = Math.max(...rows.map(r => Number(r.Idx) || 0)) + 1;
                setRows([...rows, { ...row, Idx: nextIdx }]);
                markDirty();
              }}>
              <Copy size={12} /> Duplicate row
            </button>
            <button type="button" className="btn-ghost" disabled={rows.length <= 1}
              onClick={() => {
                const next = rows.filter((_, i) => i !== selIdx);
                setRows(next.length ? next : [EMPTY_MODEL_ROW(0)]);
                setSelIdx(0);
                markDirty();
              }}>
              <Trash2 size={12} /> Delete row
            </button>
          </div>
        )}
        <table className="creature-data-table creature-model-table">
          <thead>
            <tr>{MODEL_COLUMNS.map(c => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.Idx}-${i}`}
                className={i === selIdx ? 'creature-model-row-sel' : ''}
                onClick={() => setSelIdx(i)}>
                {MODEL_COLUMNS.map(col => (
                  <td key={col}>
                    {col === 'DisplayScale' || col === 'Probability' ? (
                      <input
                        type="number" step="0.01"
                        value={row[col] ?? ''}
                        readOnly={readOnly}
                        onChange={e => updateRow(i, col, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onWheel={e => e.target.blur()}
                      />
                    ) : (
                      <div className="int-spin" onClick={e => e.stopPropagation()}>
                        <input
                          type="text" inputMode="numeric"
                          value={row[col] ?? ''}
                          readOnly={readOnly || col === 'Idx'}
                          onChange={e => { if (/^\d*$/.test(e.target.value)) updateRow(i, col, e.target.value); }}
                        />
                        {col !== 'Idx' && !readOnly && <>
                          <button
                            tabIndex={-1}
                            onMouseDown={e => { e.preventDefault(); updateRow(i, col, String(Number(row[col] || 0) + 1)); }}
                          >▲</button>
                          <button
                            tabIndex={-1}
                            onMouseDown={e => { e.preventDefault(); updateRow(i, col, String(Math.max(0, Number(row[col] || 0) - 1))); }}
                          >▼</button>
                        </>}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="creature-preview-row">
          <CreatureModelPreview
            displayId={selected?.CreatureDisplayID}
            displayScale={selected?.DisplayScale ?? 1}
            active={previewActive}
          />
          <div className="creature-weapon-slots">
            {[['mainhand', 'Mainhand'], ['offhand', 'Offhand']].map(([slot, label]) => (
              <div key={slot} className="weapon-slot-block">
                <div className="field-group">
                  <label>{label}</label>
                  <div className="weapon-id-row">
                    <input
                      type="text" inputMode="numeric"
                      value={weapons?.[slot] ?? ''}
                      readOnly={readOnly}
                      placeholder="Item ID"
                      onChange={async e => {
                        const val = e.target.value;
                        if (!/^\d*$/.test(val)) return;
                        setWeapons(w => ({ ...w, [slot]: val }));
                        if (val && Number(val)) {
                          const res = await query(`SELECT name, displayid FROM item_template WHERE entry = ${Number(val)} LIMIT 1`);
                          setWNames(n => ({ ...n, [slot]: res?.data?.[0]?.name ?? '' }));
                          setWDisplayIds(d => ({ ...d, [slot]: res?.data?.[0]?.displayid ? String(res.data[0].displayid) : '' }));
                        } else {
                          setWNames(n => ({ ...n, [slot]: '' }));
                          setWDisplayIds(d => ({ ...d, [slot]: '' }));
                        }
                      }}
                    />
                    {wNames?.[slot] && <span className="weapon-name">{wNames[slot]}</span>}
                  </div>
                </div>
                {wDisplayIds?.[slot] && (
                  <div className="weapon-thumb-wrap">
                    <img
                      className="weapon-thumb"
                      src={`https://wow.zamimg.com/modelviewer/wrath/webthumbs/item/${Number(wDisplayIds[slot]) % 256}/${wDisplayIds[slot]}.webp`}
                      alt={wNames?.[slot] || slot}
                      onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderAddonPanel = (addon, setAddon, readOnly, onCopySection) => (
    <div className="creature-section-block">
      <div className="creature-section-head">
        <h4 className="field-section-title">Template Addon</h4>
        {readOnly && onCopySection && (
          <button type="button" className="btn-ghost creature-copy-section" onClick={() => onCopySection('addon')} title="Copy addon data to draft">
            <ClipboardCopy size={12} />
          </button>
        )}
      </div>
      <div className="form-fields creature-section-fields">
        {ADDON_FIELDS.map(f => (
          <div key={f.key} className="field-group">
            <label>{f.label}</label>
            <input
              type={f.type === 'text' ? 'text' : 'number'}
              value={addon[f.key] ?? ''}
              readOnly={readOnly}
              onChange={e => { setAddon({ ...addon, [f.key]: e.target.value }); markDirty(); }}
            />
          </div>
        ))}
      </div>
    </div>
  );

  const renderSubTabPanels = (readOnly, copyHandler, tabId, tabRoles) => {
    const show = (id, roleKey) => tabId === id && (!roleKey || tabRoles[roleKey]);

    return (
      <>
        <div className="creature-subtab-panel" hidden={!show('general')}>
          {renderGeneralPanel(
            readOnly ? refForm : form,
            readOnly ? () => {} : handleChange,
            readOnly,
            readOnly ? copyHandler : null
          )}
        </div>
        <div className="creature-subtab-panel" hidden={!show('models')}>
          {renderModelsPanel(
            readOnly ? refModelRows : modelRows,
            readOnly ? () => {} : setModelRows,
            readOnly ? refSelectedModelIdx : selectedModelIdx,
            readOnly ? setRefSelectedModelIdx : setSelectedModelIdx,
            readOnly,
            readOnly ? copyHandler : null,
            tabId === 'models',
            readOnly ? refWeaponSlots : weaponSlots,
            readOnly ? setRefWeaponSlots : setWeaponSlots,
            readOnly ? refWeaponNames : weaponNames,
            readOnly ? setRefWeaponNames : setWeaponNames,
            readOnly ? refWeaponDisplayIds : weaponDisplayIds,
            readOnly ? setRefWeaponDisplayIds : setWeaponDisplayIds,
          )}
        </div>
        <div className="creature-subtab-panel" hidden={!show('addon')}>
          {renderAddonPanel(
            readOnly ? refAddonData : addonData,
            readOnly ? () => {} : setAddonData,
            readOnly,
            readOnly ? copyHandler : null
          )}
        </div>
        <div className="creature-subtab-panel" hidden={!show('trainer', 'trainer')}>
          {renderTrainerPanel(
            readOnly ? refTrainerSpells : trainerSpells,
            readOnly ? refTrainerMeta : trainerMeta,
            readOnly ? () => {} : setTrainerSpells,
            readOnly ? () => {} : updateTrainerMeta,
            readOnly,
            readOnly ? copyHandler : null,
            templateMeta,
            readOnly ? refTrainerDef : trainerDef,
            readOnly ? null : (v) => { setTrainerDef(v); markDirty(); },
            trainerDefMode,
            readOnly ? null : setTrainerDefMode
          )}
        </div>
        <div className="creature-subtab-panel" hidden={!show('vendor', 'vendor')}>
          {renderVendorPanel(
            readOnly ? refVendorItems : vendorItems,
            readOnly ? () => {} : setVendorItems,
            readOnly,
            readOnly ? copyHandler : null
          )}
        </div>
        <div className="creature-subtab-panel" hidden={!show('spawns', 'spawn')}>
          {renderSpawnPanel(
            readOnly ? refSpawnData : spawnData,
            readOnly ? () => {} : setSpawnData,
            readOnly,
            readOnly ? copyHandler : null
          )}
        </div>
      </>
    );
  };

  const renderSubTabs = (readOnly) => {
    const tabId = readOnly ? refActiveSubTab : activeSubTab;
    const setTabId = readOnly ? setRefActiveSubTab : setActiveSubTab;
    const tabRoles = readOnly ? refRoles : roles;

    return (
      <div className={`creature-subtabs ${readOnly ? 'creature-subtabs-ref' : ''}`}>
        {SUB_TABS.map(tab => {
          const locked = readOnly ? !isRefTabAvailable(tab) : isTabLocked(tab, tabRoles);
          return (
            <button
              key={tab.id}
              type="button"
              className={`creature-subtab ${tabId === tab.id ? 'active' : ''} ${locked ? 'locked' : ''}`}
              onClick={() => !locked && setTabId(tab.id)}
              disabled={locked}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderEditorBody = (readOnly, copyHandler) => {
    const tabId = readOnly ? refActiveSubTab : activeSubTab;
    const tabRoles = readOnly ? refRoles : roles;

    return (
      <>
        {renderSubTabs(readOnly)}
        <div className="creature-tab-panels">
          {renderSubTabPanels(readOnly, copyHandler, tabId, tabRoles)}
        </div>
      </>
    );
  };

  return (
    <>
      <div className="editor-page-header">
        <h2 className="editor-page-title">Creature Editor</h2>
        <p className="editor-page-subtitle">Manage creature templates, trainers, vendors & spawns</p>
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
              <div key={c.entry} className={`list-item ${selected?.entry === c.entry ? 'active' : ''}`} onClick={() => selectCreature(c.entry)}>
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

        <div className={`editor-form creature-editor-workspace ${splitRef ? 'split-ref' : ''}`}>
          {!selected ? (
            <div className="editor-empty">
              <MousePointerClick />
              <p>Select a creature to edit</p>
            </div>
          ) : (
            <div className={`creature-workspace-grid ${splitRef ? 'split' : ''}`}>
              <div className="creature-draft-pane">
                <div className="page-header">
                  <div>
                    <h1 className="page-title">
                      {selected.name}
                      {dirty && <span style={{ color: 'var(--gold)', marginLeft: '8px' }}>●</span>}
                    </h1>
                    <p className="page-sub">Entry #{selected.entry} · creature_template</p>
                  </div>
                  <div className="header-actions">
                    <button type="button" className={`btn-ghost ${splitRef ? 'active' : ''}`} onClick={() => setSplitRef(s => !s)} title="Toggle reference split">
                      <Columns2 size={13} /> Reference Split
                    </button>
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

                {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}
                {renderEditorBody(false)}
              </div>

              {splitRef && (
                <div className="creature-ref-pane">
                  <div className="creature-ref-header">
                    <h3>Reference</h3>
                    <p className="page-sub">Read-only · copy sections into draft</p>
                  </div>
                  <div className="creature-ref-search">
                    <div className="search-box">
                      <Search size={13} />
                      <input
                        ref={refSearchRef}
                        placeholder="Load reference creature..."
                        value={refSearch}
                        onChange={e => { setRefSearch(e.target.value); searchReference(e.target.value); }}
                      />
                    </div>
                  </div>
                  <div className="creature-ref-list">
                    {refLoading && <div className="loading-text">Searching...</div>}
                    {!refLoading && refResults.map(c => (
                      <button key={c.entry} type="button"
                        className={`creature-ref-item ${refEntry === c.entry ? 'active' : ''}`}
                        onClick={() => loadReference(c.entry)}>
                        <span>{c.name}</span>
                        <span className="mono">#{c.entry}</span>
                      </button>
                    ))}
                  </div>
                  {refEntry ? (
                    <div className="creature-ref-content">
                      <div className="creature-ref-title">{refForm.name} <span className="mono">#{refEntry}</span></div>
                      {renderEditorBody(true, copySectionFromRef)}
                    </div>
                  ) : (
                    <div className="creature-ref-empty">Search and pick a creature to use as reference</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function RankTag({ rank }) {
  const labels = ['Normal', 'Elite', 'Rare Elite', 'Boss', 'Rare'];
  const cls = rank === 3 ? 'tag-gold' : rank >= 1 ? 'tag-blue' : 'tag-green';
  return <span className={`tag ${cls}`}>{labels[rank] || 'Normal'}</span>;
}
