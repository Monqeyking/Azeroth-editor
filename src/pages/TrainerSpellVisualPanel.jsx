import { useCallback, useEffect, useMemo, useState } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { BookOpen, Filter, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import './TrainerSpellVisualPanel.css';

const CLASSES = [
  { id: 1, name: 'Warrior', color: '#C79C6E' },
  { id: 2, name: 'Paladin', color: '#F58CBA' },
  { id: 3, name: 'Hunter', color: '#ABD473' },
  { id: 4, name: 'Rogue', color: '#FFF569' },
  { id: 5, name: 'Priest', color: '#FFFFFF' },
  { id: 6, name: 'Death Knight', color: '#C41E3A' },
  { id: 7, name: 'Shaman', color: '#0070DE' },
  { id: 8, name: 'Mage', color: '#69CCF0' },
  { id: 9, name: 'Warlock', color: '#9482C9' },
  { id: 11, name: 'Druid', color: '#FF7D0A' },
];

const TRAINER_LABELS = {
  1: 'Warrior Main', 2: 'Warrior Starter',
  3: 'Paladin Main', 5: 'Paladin Generic', 6: 'Paladin Low-Level',
  7: 'Hunter Main', 8: 'Hunter Starter',
  9: 'Rogue Main', 10: 'Rogue Starter',
  11: 'Priest Main', 12: 'Priest Starter',
  13: 'Death Knight',
  14: 'Shaman Main', 15: 'Shaman Starter',
  16: 'Mage Main', 17: 'Mage Starter',
  31: 'Warlock Main', 32: 'Warlock Starter',
  33: 'Druid Main', 34: 'Druid Starter',
  35: 'Riding', 36: 'Cold Weather Flying', 37: 'Riding (low)',
  125: 'Pet Trainer',
};

const SKILL_LINE_OPTIONS = {
  1:  [{ id: 26,  label: 'General' }, { id: 100, label: 'Arms' }, { id: 256, label: 'Fury' }, { id: 257, label: 'Protection' }],
  2:  [{ id: 594, label: 'General' }, { id: 317, label: 'Holy' }, { id: 267, label: 'Protection' }, { id: 184, label: 'Retribution' }],
  3:  [{ id: 50,  label: 'General' }, { id: 163, label: 'Beast Mastery' }, { id: 164, label: 'Marksmanship' }, { id: 165, label: 'Survival' }],
  4:  [{ id: 253, label: 'General' }, { id: 182, label: 'Assassination' }, { id: 181, label: 'Combat' }, { id: 183, label: 'Subtlety' }],
  5:  [{ id: 56,  label: 'General' }, { id: 78, label: 'Discipline' }, { id: 613, label: 'Holy' }, { id: 236, label: 'Shadow' }],
  6:  [{ id: 770, label: 'General' }, { id: 398, label: 'Blood' }, { id: 399, label: 'Frost' }, { id: 400, label: 'Unholy' }],
  7:  [{ id: 261, label: 'General' }, { id: 373, label: 'Elemental' }, { id: 374, label: 'Enhancement' }, { id: 375, label: 'Restoration' }],
  8:  [{ id: 6,   label: 'General' }, { id: 237, label: 'Arcane' }, { id: 8,   label: 'Fire' }, { id: 454, label: 'Frost' }],
  9:  [{ id: 593, label: 'General' }, { id: 355, label: 'Affliction' }, { id: 354, label: 'Demonology' }, { id: 593, label: 'Destruction' }],
  11: [{ id: 574, label: 'General' }, { id: 134, label: 'Balance' }, { id: 134, label: 'Feral Combat' }, { id: 573, label: 'Restoration' }],
};

const PALADIN_GROUPS = [
  { key: 'paladin-main', label: 'Main paladin trainers', kind: 'trainer_spell', trainerIds: [3], badge: 'TrainerId 3' },
  { key: 'paladin-generic', label: 'Generic paladin trainer', kind: 'trainer_spell', trainerIds: [5], badge: 'TrainerId 5' },
  { key: 'paladin-low', label: 'Low-level paladin trainers', kind: 'trainer_spell', trainerIds: [6], badge: 'TrainerId 6' },
  { key: 'paladin-alliance', label: 'Alliance override', kind: 'npc_trainer', trainerIds: [200020], badge: 'Template 200020' },
  { key: 'paladin-horde', label: 'Horde override', kind: 'npc_trainer', trainerIds: [200021], badge: 'Template 200021' },
];

function classNameById(id) {
  return CLASSES.find(c => c.id === id)?.name || `Class ${id}`;
}

function moneyToText(copper = 0) {
  const value = Number(copper) || 0;
  const gold = Math.floor(value / 10000);
  const silver = Math.floor((value % 10000) / 100);
  const copperPart = value % 100;
  return `${gold}g ${silver}s ${copperPart}c`;
}

function copperToMoneyParts(copper = 0) {
  const value = Math.max(0, Number(copper) || 0);
  return {
    gold: Math.floor(value / 10000),
    silver: Math.floor((value % 10000) / 100),
    copper: value % 100,
  };
}

function moneyPartsToCopper(gold = 0, silver = 0, copper = 0) {
  return (Number(gold) || 0) * 10000 + (Number(silver) || 0) * 100 + (Number(copper) || 0);
}

function parseIdList(text) {
  return text
    .split(/[^0-9]+/)
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v > 0);
}

function uniqKey(row) {
  return `${row.Name_Lang_enUS || ''}|${row.NameSubtext_Lang_enUS || ''}`;
}

function badgeForStatus(status) {
  if (status === 'trainable') return 'Trainable';
  if (status === 'learned') return 'Learned';
  if (status === 'too-low') return 'Level too low';
  if (status === 'blocked') return 'Blocked';
  if (status === 'hidden') return 'Hidden';
  return 'Check';
}

function formatHex(value, width = 8) {
  return `0x${(Number(value) || 0).toString(16).toUpperCase().padStart(width, '0')}`;
}

function buildTrainerTooltip(row, { archived = false, kind = 'trainer_spell' } = {}) {
  const lines = [
    `${row.name} (#${row.spellId})`,
    row.subtext ? `Rank/Subtext: ${row.subtext}` : 'Rank/Subtext: none',
    `Required level: ${row.minLevel}`,
    `Spell level: ${row.spellLevel}`,
    `Money cost: ${moneyToText(row.moneyCost)}`,
    `Sources: ${row.sourceCount || 0}`,
    `Trainer IDs: ${(row.sources || []).map(src => src.TrainerId).join(', ') || 'none'}`,
    `View: ${archived ? 'archived' : 'live'} (${kind})`,
    `Status: ${badgeForStatus(row.status)}`,
    `Attributes: ${formatHex(row.attributes)}`,
  ];

  const sla = row.sla?.[0] || null;
  if (sla) {
    lines.push(`ClassMask: ${formatHex(sla.ClassMask)}`);
    lines.push(`AcquireMethod: ${Number(sla.AcquireMethod || 0)}`);
    lines.push(`TrivialSkillLineRankLow: ${Number(sla.TrivialSkillLineRankLow || 0)}`);
  }

  const spell = row.spell || null;
  if (spell) {
    const procTypeMask = Number(spell.ProcTypeMask || 0);
    const procChance = Number(spell.ProcChance || 0);
    const procCharges = Number(spell.ProcCharges || 0);
    const triggerSpells = [
      Number(spell.EffectTriggerSpell_1 || 0),
      Number(spell.EffectTriggerSpell_2 || 0),
      Number(spell.EffectTriggerSpell_3 || 0),
    ].filter(Boolean);
    lines.push(`ProcTypeMask: ${formatHex(procTypeMask)}`);
    lines.push(`ProcChance: ${procChance}`);
    lines.push(`ProcCharges: ${procCharges}`);
    lines.push(`Trigger spells: ${triggerSpells.length ? triggerSpells.join(', ') : 'none'}`);
  }

  return lines.join('\n');
}

function buildAddResultTooltip(row) {
  const procTypeMask = Number(row.ProcTypeMask || 0);
  const procChance = Number(row.ProcChance || 0);
  const procCharges = Number(row.ProcCharges || 0);
  const triggerSpells = [
    Number(row.EffectTriggerSpell_1 || 0),
    Number(row.EffectTriggerSpell_2 || 0),
    Number(row.EffectTriggerSpell_3 || 0),
  ].filter(Boolean);

  const lines = [
    `${row.Name_Lang_enUS || 'Unknown'} (#${row.ID})`,
    row.NameSubtext_Lang_enUS ? `Rank/Subtext: ${row.NameSubtext_Lang_enUS}` : 'Rank/Subtext: none',
    `Spell level: ${Number(row.SpellLevel || 0)}`,
    `Attributes: ${formatHex(row.Attributes)}`,
    `Proc-like: ${row.HasProcLikeBehavior ? 'yes' : 'no'}`,
    `ProcTypeMask: ${formatHex(procTypeMask)}`,
    `ProcChance: ${procChance}`,
    `ProcCharges: ${procCharges}`,
    `Trigger spells: ${triggerSpells.length ? triggerSpells.join(', ') : 'none'}`
  ];

  return lines.join('\n');
}

export default function TrainerSpellVisualPanel() {
  const { query, searchSpellsDbc, readSpellFull, readSkillLineAbility, addSkillLineAbility, readSpellIcons, getIcon } = useConnection();
  const [selectedClassId, setSelectedClassId] = useState(2);
  const [trainerCatalog, setTrainerCatalog] = useState([]);
  const [selectedGroupKey, setSelectedGroupKey] = useState('paladin-main');
  const [spellRows, setSpellRows] = useState([]);
  const [selectedSpellId, setSelectedSpellId] = useState(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingSpells, setLoadingSpells] = useState(false);
  const [msg, setMsg] = useState(null);
  const [playerLevel, setPlayerLevel] = useState(40);
  const [playerFaction, setPlayerFaction] = useState('alliance');
  const [learnedInput, setLearnedInput] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [addSelected, setAddSelected] = useState([]);
  const [addOnlyTrainable, setAddOnlyTrainable] = useState(true);
  const [addHideProcLike, setAddHideProcLike] = useState(true);
  const [addMinLevel, setAddMinLevel] = useState('');
  const [addMaxLevel, setAddMaxLevel] = useState('');
  const [addSkillLine, setAddSkillLine] = useState('');
  const [moneyCostDraft, setMoneyCostDraft] = useState('0');
  const [moneyGoldDraft, setMoneyGoldDraft] = useState('0');
  const [moneySilverDraft, setMoneySilverDraft] = useState('0');
  const [moneyCopperDraft, setMoneyCopperDraft] = useState('0');
  const [savingMoneyCost, setSavingMoneyCost] = useState(false);
  const [adding, setAdding] = useState(false);
  const [viewMinLevel, setViewMinLevel] = useState('60');
  const [viewMaxLevel, setViewMaxLevel] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [removeSelection, setRemoveSelection] = useState([]);
  const [viewMode, setViewMode] = useState('live');

  const learnedSet = useMemo(() => new Set(parseIdList(learnedInput)), [learnedInput]);
  const classBit = useMemo(() => 1 << Math.max(0, selectedClassId - 1), [selectedClassId]);
  const trainerSpellScopeIds = useMemo(() => {
    const ids = trainerCatalog
      .filter(t => Number(t.Requirement) === selectedClassId)
      .map(t => Number(t.TrainerId));
    return [...new Set(ids)];
  }, [selectedClassId, trainerCatalog]);

  useEffect(() => {
    let alive = true;
    setLoadingCatalog(true);
    query(
      `SELECT t.Id AS TrainerId, t.Type, t.Requirement,
              GROUP_CONCAT(DISTINCT ct.name ORDER BY ct.name SEPARATOR ', ') AS trainerNames,
              COUNT(DISTINCT ts.SpellId) AS spellCount
       FROM trainer t
       JOIN creature_default_trainer cdt ON cdt.TrainerId = t.Id
       JOIN creature_template ct ON ct.entry = cdt.CreatureId
       LEFT JOIN trainer_spell ts ON ts.TrainerId = t.Id
       GROUP BY t.Id, t.Type, t.Requirement
       ORDER BY t.Requirement, t.Id`
    ).then(res => {
      if (!alive) return;
      const rows = (res.data || []).map(t => {
        const className = classNameById(t.Requirement);
        const friendlyName = TRAINER_LABELS[t.TrainerId] || t.trainerNames || className;
        return {
          ...t,
          className,
          label: `${friendlyName} (ID ${t.TrainerId})`,
        };
      });
      setTrainerCatalog(rows);
      setLoadingCatalog(false);
    }).catch(() => {
      if (!alive) return;
      setTrainerCatalog([]);
      setLoadingCatalog(false);
    });
    return () => { alive = false; };
  }, [query]);

  const groupOptions = useMemo(() => {
    const trainers = trainerCatalog.filter(t => Number(t.Requirement) === selectedClassId)
      .sort((a, b) => a.TrainerId - b.TrainerId);
    if (selectedClassId === 2) return PALADIN_GROUPS;
    const allIds = trainers.map(t => t.TrainerId);
    const options = [{
      key: `class-${selectedClassId}-all`,
      label: `${classNameById(selectedClassId)} trainers`,
      kind: 'trainer_spell',
      trainerIds: allIds,
      badge: `${allIds.length} trainers`,
    }];
    for (const t of trainers) {
      options.push({
        key: `trainer-${t.TrainerId}`,
        label: TRAINER_LABELS[t.TrainerId] || t.label,
        kind: 'trainer_spell',
        trainerIds: [t.TrainerId],
        badge: `${t.spellCount} spells`,
      });
    }
    return options;
  }, [trainerCatalog, selectedClassId]);

  useEffect(() => {
    if (!groupOptions.length) return;
    if (!groupOptions.some(g => g.key === selectedGroupKey)) {
      setSelectedGroupKey(groupOptions[0].key);
    }
  }, [groupOptions, selectedGroupKey]);

  const selectedGroup = useMemo(() => groupOptions.find(g => g.key === selectedGroupKey) || null, [groupOptions, selectedGroupKey]);
  const legacyTemplateOptions = useMemo(() => selectedClassId === 2 ? PALADIN_GROUPS.filter(g => g.kind === 'npc_trainer') : [], [selectedClassId]);

  const handleClassPresetClick = useCallback((classId) => {
    setSelectedClassId(classId);
    setSelectedGroupKey(classId === 2 ? 'paladin-main' : `class-${classId}-all`);
  }, []);

  const isArchivedView = viewMode === 'archived' && selectedGroup?.kind === 'trainer_spell';

  const loadSelectedGroup = useCallback(async () => {
    if (!selectedGroup) {
      setSpellRows([]);
      setSelectedSpellId(null);
      return;
    }
    if (viewMode === 'archived' && selectedGroup.kind !== 'trainer_spell') {
      setSpellRows([]);
      setSelectedSpellId(null);
      setMsg({ type: 'info', text: 'Archived view is only available for trainer_spell groups.' });
      return;
    }
    setLoadingSpells(true);
    setMsg(null);
    try {
      let baseRows = [];
      if (selectedGroup.kind === 'trainer_spell') {
        const ids = selectedGroup.trainerIds || [];
        if (ids.length) {
          const table = isArchivedView ? 'trainer_spell_60plus' : 'trainer_spell';
          const res = await query(
            `SELECT ts.TrainerId, ts.SpellId, ts.MoneyCost, ts.ReqLevel, ts.ReqSkillLine, ts.ReqSkillRank,
                    t.Requirement, t.Type,
                    GROUP_CONCAT(DISTINCT ct.name ORDER BY ct.name SEPARATOR ', ') AS trainerNames
             FROM ${table} ts
             JOIN trainer t ON t.Id = ts.TrainerId
             LEFT JOIN creature_default_trainer cdt ON cdt.TrainerId = t.Id
             LEFT JOIN creature_template ct ON ct.entry = cdt.CreatureId
             WHERE ts.TrainerId IN (${ids.map(() => '?').join(',')})
             GROUP BY ts.TrainerId, ts.SpellId, ts.MoneyCost, ts.ReqLevel, ts.ReqSkillLine, ts.ReqSkillRank, t.Requirement, t.Type
             ORDER BY ts.ReqLevel, ts.SpellId`,
            ids
          );
          baseRows = res.data || [];
        }
      } else {
        const ids = selectedGroup.trainerIds || [];
        if (ids.length) {
          const res = await query(
            `SELECT ID AS TrainerId, SpellID AS SpellId, MoneyCost, ReqSkillLine, ReqSkillRank, ReqLevel, ReqSpell
             FROM npc_trainer
             WHERE ID IN (${ids.map(() => '?').join(',')}) AND SpellID > 0
             ORDER BY ReqLevel, SpellID`,
            ids
          );
          baseRows = res.data || [];
        }
      }

      const grouped = new Map();
      for (const row of baseRows) {
        const current = grouped.get(row.SpellId) || { spellId: row.SpellId, sources: [] };
        current.sources.push(row);
        grouped.set(row.SpellId, current);
      }

      const spellIds = [...grouped.keys()];
      const spellMap = {};
      const iconIds = new Set();
      const slaMap = {};

      await Promise.all(spellIds.map(async spellId => {
        const [spellRes, slaRes] = await Promise.all([
          readSpellFull(spellId),
          readSkillLineAbility(spellId),
        ]);
        const spell = spellRes.success ? spellRes.data : null;
        const sla = slaRes.success ? (slaRes.data || []) : [];
        spellMap[spellId] = spell;
        slaMap[spellId] = sla;
        if (spell?.SpellIconID) iconIds.add(spell.SpellIconID);
      }));

      const iconFiles = {};
      if (iconIds.size > 0) {
        const iconsRes = await readSpellIcons([...iconIds]);
        if (iconsRes.success) {
          Object.assign(iconFiles, iconsRes.data || {});
        }
      }

      const iconUrls = {};
      await Promise.all([...iconIds].map(async iconId => {
        const filename = iconFiles[iconId];
        if (filename) iconUrls[iconId] = await getIcon(filename);
      }));

      const rows = [...grouped.values()].map(item => {
        const spell = spellMap[item.spellId] || null;
        const sla = slaMap[item.spellId] || [];
        const iconId = spell?.SpellIconID || 0;
        const source = item.sources[0] || {};
        return {
          ...item,
          spell,
          sla,
          iconId,
          iconUrl: iconId ? iconUrls[iconId] || null : null,
          name: spell?.Name_Lang_enUS || `#${item.spellId}`,
          subtext: spell?.NameSubtext_Lang_enUS || '',
          spellLevel: Number(spell?.SpellLevel || 0),
          minLevel: Number(source.ReqLevel || spell?.SpellLevel || 0),
          moneyCost: Number(source.MoneyCost || 0),
          attributes: Number(spell?.Attributes || 0),
        };
      }).sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name) || a.spellId - b.spellId);

      setSpellRows(rows);
      setSelectedSpellId(rows[0]?.spellId ?? null);
    } catch (err) {
      setSpellRows([]);
      setSelectedSpellId(null);
      setMsg({ type: 'error', text: err.message });
    }
    setLoadingSpells(false);
  }, [getIcon, isArchivedView, query, readSkillLineAbility, readSpellFull, readSpellIcons, selectedGroup, viewMode]);

  useEffect(() => {
    loadSelectedGroup();
  }, [loadSelectedGroup]);

  const visibleRows = useMemo(() => {
    return spellRows.map(row => {
      const sla = row.sla?.[0] || null;
      const classMask = Number(sla?.ClassMask || 0);
      const attr = Number(row.attributes || 0);
      const learned = learnedSet.has(row.spellId);
      const factionBlocked = selectedGroupKey.includes('alliance') ? playerFaction === 'horde' : selectedGroupKey.includes('horde') ? playerFaction === 'alliance' : false;
      const tooLow = playerLevel < row.minLevel;
      const classOk = !classMask || (classMask & classBit) !== 0;
      const trainableAttr = (attr & 0x10000) !== 0 && (attr & 0x80000) === 0;
      const slaOk = !!sla && Number(sla.AcquireMethod || 0) === 1 && Number(sla.TrivialSkillLineRankLow || 0) === 0;
      let status = 'trainable';
      if (learned) status = 'learned';
      else if (tooLow) status = 'too-low';
      else if (factionBlocked) status = 'hidden';
      else if (!sla) status = 'blocked';
      else if (!classOk) status = 'blocked';
      else if (!slaOk) status = 'blocked';
      else if (!trainableAttr) status = 'hidden';
      return { ...row, learned, tooLow, factionBlocked, classOk, trainableAttr, slaOk, status, sourceCount: row.sources.length };
    });
  }, [classBit, learnedSet, playerLevel, playerFaction, selectedGroupKey, spellRows]);
  const filteredRows = useMemo(() => {
    const min = Number(viewMinLevel || 0);
    const max = Number(viewMaxLevel || 0);
    return visibleRows.filter(row => {
      if (min > 0 && row.minLevel < min) return false;
      if (max > 0 && row.minLevel > max) return false;
      return true;
    });
  }, [viewMaxLevel, viewMinLevel, visibleRows]);

  const activeRow = filteredRows.find(r => r.spellId === selectedSpellId) || filteredRows[0] || null;
  const selectedRemovalRows = useMemo(() => filteredRows.filter(row => removeSelection.includes(row.spellId)), [filteredRows, removeSelection]);
  const selectedRemovalCount = selectedRemovalRows.length;
  const addSkillLineOptions = useMemo(() => SKILL_LINE_OPTIONS[selectedClassId] || [], [selectedClassId]);
  const moneyCostCopper = useMemo(() => moneyPartsToCopper(moneyGoldDraft, moneySilverDraft, moneyCopperDraft), [moneyGoldDraft, moneySilverDraft, moneyCopperDraft]);

  const loadAddResults = useCallback(async () => {
    if (!showAdd) return;
    const term = addSearch.trim();
    if (!term) {
      setAddResults([]);
      return;
    }
    const normalizedTerm = term.replace(/[^a-z0-9]+/gi, ' ').trim();
    const res = await searchSpellsDbc(normalizedTerm || term, { trainerSpells: true, limit: 200, excludeProcSpells: false });
    const rows = res.success ? (res.data || []) : [];
    const visible = [];
    const procFallback = [];
    const seen = new Set();
    for (const row of rows) {
      const key = uniqKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      const level = Number(row.SpellLevel || 0);
      if (addOnlyTrainable && ((Number(row.Attributes || 0) & 0x10000) === 0 || (Number(row.Attributes || 0) & 0x80000) !== 0)) continue;
      if (addMinLevel && level < Number(addMinLevel)) continue;
      if (addMaxLevel && level > Number(addMaxLevel)) continue;
      if (row.HasProcLikeBehavior) {
        procFallback.push(row);
        if (addHideProcLike) continue;
      }
      visible.push(row);
    }
    setAddResults(visible.length > 0 ? visible : procFallback);
  }, [addHideProcLike, addMaxLevel, addMinLevel, addOnlyTrainable, addSearch, searchSpellsDbc, showAdd]);

  useEffect(() => {
    if (showAdd && !addSkillLine && addSkillLineOptions.length > 0) {
      setAddSkillLine(String(addSkillLineOptions[0].id));
    }
  }, [addSkillLine, addSkillLineOptions, showAdd]);

  useEffect(() => {
    const parts = copperToMoneyParts(activeRow?.moneyCost ?? 0);
    setMoneyGoldDraft(String(parts.gold));
    setMoneySilverDraft(String(parts.silver));
    setMoneyCopperDraft(String(parts.copper));
  }, [activeRow?.spellId, activeRow?.moneyCost]);

  useEffect(() => {
    const id = setTimeout(() => { loadAddResults(); }, 140);
    return () => clearTimeout(id);
  }, [loadAddResults]);

  useEffect(() => {
    setRemoveSelection([]);
  }, [selectedGroupKey]);

  useEffect(() => {
    setRemoveSelection([]);
  }, [viewMode]);

  const toggleAddSelected = (id) => {
    setAddSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleAdd = async () => {
    if (!selectedGroup || addSelected.length === 0) return;
    setAdding(true);
    setMsg(null);
    try {
      const spellIds = addSelected.slice();
      for (const spellId of spellIds) {
        const spell = addResults.find(r => r.ID === spellId);
        const reqLevel = Number(spell?.SpellLevel || 0);
        if (selectedGroup.kind === 'trainer_spell') {
          for (const trainerId of selectedGroup.trainerIds || []) {
            await query(
              `INSERT INTO trainer_spell (TrainerId, SpellId, MoneyCost, ReqSkillLine, ReqSkillRank, ReqAbility1, ReqAbility2, ReqAbility3, ReqLevel, VerifiedBuild)
               VALUES (?, ?, 0, 0, 0, 0, 0, 0, ?, 0)
               ON DUPLICATE KEY UPDATE ReqLevel = VALUES(ReqLevel)`,
              [trainerId, spellId, reqLevel]
            );
          }

          const slaRead = await readSkillLineAbility(spellId);
          const classMask = 1 << Math.max(0, selectedClassId - 1);
          const hasClassSla = slaRead.success && (slaRead.data || []).some(row => (Number(row.ClassMask || 0) & classMask) !== 0);
          if (!hasClassSla) {
            const refSla = await readSkillLineAbility(35395);
            const refMaxId = refSla.success && (refSla.data || []).length > 0
              ? Math.max(...refSla.data.map(row => Number(row.ID) || 0))
              : 21980;
            const classOptions = SKILL_LINE_OPTIONS[selectedClassId] || [];
            const resolvedSkillLine = Number(addSkillLine) || (refSla.success && (refSla.data || []).length > 0
              ? Number(refSla.data[0].SkillLine || 184)
              : (classOptions.length > 0 ? classOptions[0].id : 184));
            const slaResult = await addSkillLineAbility({
              ID: refMaxId + spellId,
              SkillLine: resolvedSkillLine,
              Spell: spellId,
              RaceMask: 0,
              ClassMask: classMask,
              AcquireMethod: 1,
              TrivialSkillLineRankLow: 0,
              SupercededBySpell: 0,
            });
            if (!slaResult.success) {
              console.warn('SkillLineAbility.dbc: kon geen entry toevoegen voor spell', spellId, slaResult.error);
            }
          }
        } else {
          for (const npcId of selectedGroup.trainerIds || []) {
            await query(
              `INSERT INTO npc_trainer (ID, SpellID, MoneyCost, ReqSkillLine, ReqSkillRank, ReqLevel, ReqSpell)
               VALUES (?, ?, 0, 0, 0, ?, 0)
               ON DUPLICATE KEY UPDATE ReqLevel = VALUES(ReqLevel)`,
              [npcId, spellId, reqLevel]
            );
          }
        }
      }
      setShowAdd(false);
      setAddSelected([]);
      await loadSelectedGroup();
      setMsg({ type: 'success', text: `Added ${spellIds.length} spell${spellIds.length !== 1 ? 's' : ''}` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setAdding(false);
  };

  const moveTrainerSpellToArchive = async (trainerId, spellId) => {
    await query('DELETE FROM trainer_spell_60plus WHERE TrainerId = ? AND SpellId = ?', [trainerId, spellId]);
    await query('INSERT INTO trainer_spell_60plus SELECT * FROM trainer_spell WHERE TrainerId = ? AND SpellId = ?', [trainerId, spellId]);
    await query('DELETE FROM trainer_spell WHERE TrainerId = ? AND SpellId = ?', [trainerId, spellId]);
  };

  const restoreTrainerSpellFromArchive = async (trainerId, spellId) => {
    await query('DELETE FROM trainer_spell WHERE TrainerId = ? AND SpellId = ?', [trainerId, spellId]);
    await query('INSERT INTO trainer_spell SELECT * FROM trainer_spell_60plus WHERE TrainerId = ? AND SpellId = ?', [trainerId, spellId]);
    await query('DELETE FROM trainer_spell_60plus WHERE TrainerId = ? AND SpellId = ?', [trainerId, spellId]);
  };

  const deleteTrainerSpellPermanently = async (spellId) => {
    if (!trainerSpellScopeIds.length) return;
    const placeholders = trainerSpellScopeIds.map(() => '?').join(',');
    await query(`DELETE FROM trainer_spell WHERE SpellId = ? AND TrainerId IN (${placeholders})`, [spellId, ...trainerSpellScopeIds]);
    await query(`DELETE FROM trainer_spell_60plus WHERE SpellId = ? AND TrainerId IN (${placeholders})`, [spellId, ...trainerSpellScopeIds]);
  };

  const saveMoneyCost = async () => {
    if (!activeRow || !selectedGroup) return;
    const cost = Number(moneyCostCopper);
    if (!Number.isFinite(cost) || cost < 0) return;
    setSavingMoneyCost(true);
    setMsg(null);
    try {
      if (selectedGroup.kind === 'trainer_spell') {
        const placeholders = trainerSpellScopeIds.map(() => '?').join(',');
        await query(`UPDATE trainer_spell SET MoneyCost = ? WHERE SpellId = ? AND TrainerId IN (${placeholders})`, [cost, activeRow.spellId, ...trainerSpellScopeIds]);
        await query(`UPDATE trainer_spell_60plus SET MoneyCost = ? WHERE SpellId = ? AND TrainerId IN (${placeholders})`, [cost, activeRow.spellId, ...trainerSpellScopeIds]);
      } else {
        const ids = selectedGroup.trainerIds || [];
        const placeholders = ids.map(() => '?').join(',');
        if (ids.length) {
          await query(`UPDATE npc_trainer SET MoneyCost = ? WHERE SpellID = ? AND ID IN (${placeholders})`, [cost, activeRow.spellId, ...ids]);
        }
      }
      await loadSelectedGroup();
      setMsg({ type: 'success', text: `Updated money cost for Spell #${activeRow.spellId}` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSavingMoneyCost(false);
  };

  const handleRemoveSource = async (row, src) => {
    const kind = selectedGroup?.kind || 'trainer_spell';
    const text = kind === 'trainer_spell'
      ? `${isArchivedView ? 'Restore' : 'Archive'} trainer_spell row for TrainerId ${src.TrainerId} and SpellId ${row.spellId}?`
      : `Delete npc_trainer row for ID ${src.TrainerId} and SpellID ${row.spellId}?`;
    if (!window.confirm(text)) return;
    setMsg(null);
    try {
      if (kind === 'trainer_spell') {
        if (isArchivedView) {
          await restoreTrainerSpellFromArchive(src.TrainerId, row.spellId);
        } else {
          await moveTrainerSpellToArchive(src.TrainerId, row.spellId);
        }
      } else {
        await query('DELETE FROM npc_trainer WHERE ID = ? AND SpellID = ?', [src.TrainerId, row.spellId]);
      }
      await loadSelectedGroup();
      setMsg({ type: 'success', text: `${isArchivedView ? 'Restored' : 'Archived'} Spell #${row.spellId}` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
  };


  const handleDeleteSource = async (row, src) => {
    const kind = selectedGroup?.kind || 'trainer_spell';
    const text = kind === 'trainer_spell'
      ? `Permanently delete Spell #${row.spellId} from all ${trainerSpellScopeIds.length} trainer_spell rows in this class?`
      : `Delete npc_trainer row for ID ${src.TrainerId} and SpellID ${row.spellId}?`;
    if (!window.confirm(text)) return;
    setMsg(null);
    try {
      if (kind === 'trainer_spell') {
        await deleteTrainerSpellPermanently(row.spellId);
      } else {
        await query('DELETE FROM npc_trainer WHERE ID = ? AND SpellID = ?', [src.TrainerId, row.spellId]);
      }
      await loadSelectedGroup();
      setMsg({ type: 'success', text: selectedGroup?.kind === 'trainer_spell' ? `Deleted Spell #${row.spellId} from shared trainer rows` : `Deleted Spell #${row.spellId}` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
  };

  const handleBulkArchiveRestore = async () => {
    if (!selectedGroup || selectedRemovalRows.length === 0) return;
    const totalRows = selectedRemovalRows.reduce((sum, row) => sum + row.sources.length, 0);
    const preview = selectedRemovalRows
      .slice(0, 6)
      .map(row => `${row.name} (#${row.spellId})`)
      .join(', ');
    const scope = selectedGroup.kind === 'npc_trainer' ? 'npc_trainer' : 'trainer_spell';
    const verb = isArchivedView ? 'Restore' : (scope === 'trainer_spell' ? 'Archive' : 'Remove');
    const ok = window.confirm(
      `${verb} ${selectedRemovalRows.length} selected spells (${totalRows} rows) from ${selectedGroup.label}?\n\nPreview: ${preview}${selectedRemovalRows.length > 6 ? ' ...' : ''}`
    );
    if (!ok) return;
    setBulkBusy(true);
    setMsg(null);
    try {
      for (const row of selectedRemovalRows) {
        for (const src of row.sources) {
          if (scope === 'trainer_spell') {
            if (isArchivedView) {
              await restoreTrainerSpellFromArchive(src.TrainerId, row.spellId);
            } else {
              await moveTrainerSpellToArchive(src.TrainerId, row.spellId);
            }
          } else {
            await query('DELETE FROM npc_trainer WHERE ID = ? AND SpellID = ?', [src.TrainerId, row.spellId]);
          }
        }
      }
      await loadSelectedGroup();
      setRemoveSelection([]);
      setMsg({ type: 'success', text: `${verb}d ${selectedRemovalRows.length} selected spell${selectedRemovalRows.length !== 1 ? 's' : ''} from ${selectedGroup.label}` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setBulkBusy(false);
  };

  const handleBulkDeleteSelected = async () => {
    if (!selectedGroup || selectedRemovalRows.length === 0) return;
    const totalRows = selectedRemovalRows.reduce((sum, row) => sum + row.sources.length, 0);
    const preview = selectedRemovalRows
      .slice(0, 6)
      .map(row => `${row.name} (#${row.spellId})`)
      .join(', ');
    const kind = selectedGroup.kind === 'npc_trainer' ? 'npc_trainer' : 'trainer_spell';
    const target = isArchivedView ? 'archive' : 'live table';
    const ok = window.confirm(
      `Permanently delete ${selectedRemovalRows.length} selected spells (${totalRows} rows) from ${selectedGroup.label} (${target})?\n\nPreview: ${preview}${selectedRemovalRows.length > 6 ? ' ...' : ''}`
    );
    if (!ok) return;
    setBulkBusy(true);
    setMsg(null);
    try {
      for (const row of selectedRemovalRows) {
        for (const src of row.sources) {
          if (kind === 'trainer_spell') {
            await deleteTrainerSpellPermanently(row.spellId);
          } else {
            await query('DELETE FROM npc_trainer WHERE ID = ? AND SpellID = ?', [src.TrainerId, row.spellId]);
          }
        }
      }
      await loadSelectedGroup();
      setRemoveSelection([]);
      setMsg({ type: 'success', text: kind === 'trainer_spell' ? `Deleted ${selectedRemovalRows.length} selected shared spell${selectedRemovalRows.length !== 1 ? 's' : ''} from ${selectedGroup.label}` : `Deleted ${selectedRemovalRows.length} selected spell${selectedRemovalRows.length !== 1 ? 's' : ''} from ${selectedGroup.label}` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setBulkBusy(false);
  };
  return (
    <div className="tsv-shell">
      <div className="tsv-hero">
        <div>
          <div className="tsv-kicker"><BookOpen size={14} /> Visual trainer editor</div>
          <h3 className="tsv-title">WoW-style trainer view</h3>
          <p className="tsv-subtitle">Browse trainer spells, inspect diagnostics, and add or remove exact database rows.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)} disabled={!selectedGroup}>
          <Plus size={13} /> Add spells
        </button>
      </div>

      <div className="tsv-toolbar">
        <div className="tsv-class-rail">
          {CLASSES.map(cls => (
            <button
              key={cls.id}
              className={`tsv-chip ${selectedClassId === cls.id ? 'active' : ''}`}
              style={{ '--cls-color': cls.color }}
              onClick={() => handleClassPresetClick(cls.id)}
            >
              {cls.name}
            </button>
          ))}
                </div>
        {legacyTemplateOptions.length > 0 && (
          <div className="tsv-legacy-rail">
            <span className="tsv-legacy-label">Legacy npc_trainer templates</span>
            {legacyTemplateOptions.map(group => (
              <button
                key={group.key}
                className={`tsv-legacy-chip ${selectedGroupKey === group.key ? 'active' : ''}`}
                onClick={() => setSelectedGroupKey(group.key)}
              >
                <span className="tsv-group-label">{group.label}</span>
                <span className="tsv-group-badge">{group.badge}</span>
              </button>
            ))}
          </div>
        )}
        <div className="tsv-group-rail">
          {loadingCatalog && <span className="tsv-muted">Loading trainers...</span>}
          {!loadingCatalog && groupOptions.map(group => (
            <button
              key={group.key}
              className={`tsv-group-card ${selectedGroupKey === group.key ? 'active' : ''}`}
              onClick={() => setSelectedGroupKey(group.key)}
            >
              <span className="tsv-group-label">{group.label}</span>
              <span className="tsv-group-badge">{group.badge}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tsv-filters">
        <label className="tsv-field">
          <span>Player level</span>
          <input type="number" value={playerLevel} onChange={e => setPlayerLevel(Number(e.target.value) || 0)} />
        </label>
        <label className="tsv-field">
          <span>Faction</span>
          <select value={playerFaction} onChange={e => setPlayerFaction(e.target.value)}>
            <option value="alliance">Alliance</option>
            <option value="horde">Horde</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="tsv-field tsv-field--wide">
          <span>Learned spells</span>
          <input value={learnedInput} onChange={e => setLearnedInput(e.target.value)} placeholder="35395, 19750, 19740" />
        </label>
        <label className="tsv-field">
          <span>Show min level</span>
          <input type="number" value={viewMinLevel} onChange={e => setViewMinLevel(e.target.value)} />
        </label>
        <label className="tsv-field">
          <span>Show max level</span>
          <input type="number" value={viewMaxLevel} onChange={e => setViewMaxLevel(e.target.value)} />
        </label>
        <button className="btn-ghost" onClick={loadSelectedGroup}>
          <Filter size={13} /> Refresh
        </button>
      </div>
      <div className="tsv-view-toggle">
        <button className={`tsv-view-btn ${viewMode === 'live' ? 'active' : ''}`} onClick={() => setViewMode('live')}>Live</button>
        <button className={`tsv-view-btn ${viewMode === 'archived' ? 'active' : ''}`} onClick={() => setViewMode('archived')} disabled={selectedGroup?.kind !== 'trainer_spell'}>Archived</button>
      </div>
      <div className="tsv-selection-bar">
        <span className="tsv-muted">{filteredRows.length} visible, {selectedRemovalCount} selected for {isArchivedView ? 'restore' : 'archive'}</span>
        <div className="tsv-selection-actions">
          <button className="btn-ghost" onClick={() => setRemoveSelection(filteredRows.map(row => row.spellId))} disabled={!selectedGroup || filteredRows.length === 0}>
            Select visible
          </button>
          <button className="btn-ghost" onClick={() => setRemoveSelection([])} disabled={removeSelection.length === 0}>
            Clear selection
          </button>
          <button className="btn-ghost" onClick={handleBulkArchiveRestore} disabled={bulkBusy || !selectedGroup || selectedRemovalCount === 0}>
            <Trash2 size={13} /> {bulkBusy ? (isArchivedView ? 'Restoring...' : 'Archiving...') : (isArchivedView ? `Restore selected (${selectedRemovalCount})` : `Archive selected (${selectedRemovalCount})`) }
          </button>
          <button className="btn-ghost danger" onClick={handleBulkDeleteSelected} disabled={bulkBusy || !selectedGroup || selectedRemovalCount === 0}>
            <Trash2 size={13} /> {bulkBusy ? 'Deleting...' : 'Delete selected'}
          </button>
        </div>
      </div>
      {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}

      <div className="tsv-body">
        <div className="tsv-grid-pane">
          {loadingSpells && <div className="tsv-empty">Loading spells...</div>}
          {!loadingSpells && filteredRows.length === 0 && <div className="tsv-empty">{isArchivedView ? 'No archived spells for this trainer.' : 'No spells match the current filters.'}</div>}
          {!loadingSpells && filteredRows.map(row => (
            <button
              key={row.spellId}
              className={`tsv-card ${selectedSpellId === row.spellId ? 'active' : ''} ${row.status}`}
              onClick={() => setSelectedSpellId(row.spellId)}
              title={buildTrainerTooltip(row, { archived: isArchivedView, kind: selectedGroup?.kind || 'trainer_spell' })}
            >
              <div className="tsv-card-top">
                <label className="tsv-remove-check" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={removeSelection.includes(row.spellId)}
                    onChange={() => setRemoveSelection(prev => prev.includes(row.spellId) ? prev.filter(id => id !== row.spellId) : [...prev, row.spellId])}
                  />
                </label>
                <div className="tsv-icon-wrap">
                  {row.iconUrl ? <img src={row.iconUrl} alt="" /> : <Sparkles size={18} />}
                </div>
                <div className="tsv-card-text">
                  <div className="tsv-card-name">{row.name}</div>
                  <div className="tsv-card-sub">{row.subtext || 'No rank'}</div>
                </div>
                <span className={`tsv-status tsv-status--${row.status}`}>{badgeForStatus(row.status)}</span>
              </div>
              <div className="tsv-card-meta">
                <span>#{row.spellId}</span>
                <span>Lvl {row.minLevel}</span>
                <span>{moneyToText(row.moneyCost)}</span>
                <span>{row.sourceCount} source{row.sourceCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="tsv-source-row">
                {row.sources.map(src => (
                  <span key={`${src.TrainerId}-${row.spellId}`} className="tsv-source-pill" onClick={e => e.stopPropagation()}>
                    <span>{selectedGroup?.kind === 'npc_trainer' ? `ID ${src.TrainerId}` : `Trainer ${src.TrainerId}`}</span>
                    <span className="tsv-source-actions">
                      <button type="button" onClick={() => handleRemoveSource(row, src)} title={isArchivedView ? 'Restore this row to trainer_spell' : 'Archive this row to trainer_spell_60plus'}>
                        <Trash2 size={11} />
                      </button>
                      <button type="button" className="danger" onClick={() => handleDeleteSource(row, src)} title={selectedGroup?.kind === 'npc_trainer' ? 'Delete npc_trainer row permanently' : 'Delete this spell from all shared trainer_spell rows in this class'}>
                        <X size={11} />
                      </button>
                    </span>
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <div className="tsv-side-pane">
          {!activeRow ? (
            <div className="tsv-empty">Select a spell to inspect diagnostics.</div>
          ) : (
            <>
              <div className="tsv-detail-head">
                <h4>{activeRow.name}</h4>
                <div className="tsv-detail-sub">Spell #{activeRow.spellId}</div>
              </div>
              <div className="tsv-detail-group">
                <div><span>Required level</span><strong>{activeRow.minLevel}</strong></div>
                <div><span>Player level</span><strong>{playerLevel}</strong></div>
                <div><span>Spell level</span><strong>{activeRow.spellLevel}</strong></div>
                <div><span>Faction</span><strong>{playerFaction}</strong></div>
                <div className="tsv-detail-edit">
                  <label className="tsv-field">
                    <span>Gold</span>
                    <input type="number" min="0" value={moneyGoldDraft} onChange={e => setMoneyGoldDraft(e.target.value)} />
                  </label>
                  <label className="tsv-field">
                    <span>Silver</span>
                    <input type="number" min="0" max="99" value={moneySilverDraft} onChange={e => setMoneySilverDraft(e.target.value)} />
                  </label>
                  <label className="tsv-field">
                    <span>Copper</span>
                    <input type="number" min="0" max="99" value={moneyCopperDraft} onChange={e => setMoneyCopperDraft(e.target.value)} />
                  </label>
                  <button className="btn-ghost" onClick={saveMoneyCost} disabled={savingMoneyCost || !selectedGroup}>
                    {savingMoneyCost ? 'Saving...' : 'Save cost'}
                  </button>
                </div>
              </div>
              <div className="tsv-diagnostics">
                <div className={`tsv-diag ${activeRow.learned ? 'ok' : ''}`}>{activeRow.learned ? 'Already learned' : 'Not learned'}</div>
                <div className={`tsv-diag ${activeRow.tooLow ? 'warn' : 'ok'}`}>{activeRow.tooLow ? 'Player level too low' : 'Player level ok'}</div>
                <div className={`tsv-diag ${activeRow.slaOk ? 'ok' : 'warn'}`}>{activeRow.slaOk ? 'SkillLineAbility allows trainer use' : 'SkillLineAbility may block training'}</div>
                <div className={`tsv-diag ${activeRow.classOk ? 'ok' : 'warn'}`}>{activeRow.classOk ? 'ClassMask matches' : 'ClassMask mismatch'}</div>
                <div className={`tsv-diag ${activeRow.trainableAttr ? 'ok' : 'warn'}`}>{activeRow.trainableAttr ? 'Trainer spell flag present' : 'Possible hidden or NPC-only spell'}</div>
                <div className={`tsv-diag ${activeRow.factionBlocked ? 'warn' : 'ok'}`}>{activeRow.factionBlocked ? 'Faction preview blocks this spell' : 'Faction preview allows this spell'}</div>
              </div>
              <div className="tsv-source-list">
                {activeRow.sources.map(src => (
                  <div key={`${src.TrainerId}-${activeRow.spellId}`} className="tsv-source-row-2">
                    <span>{selectedGroup?.kind === 'npc_trainer' ? `npc_trainer ID ${src.TrainerId}` : `trainer_spell TrainerId ${src.TrainerId}`}</span>
                    <span>{moneyToText(src.MoneyCost)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="tsv-modal">
          <div className="tsv-modal-backdrop" onClick={() => setShowAdd(false)} />
          <div className="tsv-modal-panel">
            <div className="tsv-modal-head">
              <div>
                <h4>Add spells</h4>
                <p>Add to {selectedGroup?.label || 'selected group'}</p>
              </div>
              <button className="btn-ghost" onClick={() => setShowAdd(false)}><X size={13} /></button>
            </div>
            <div className="tsv-modal-filters">
              <div className="search-box">
                <Search size={13} />
                <input value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="Search by name or ID" autoFocus />
              </div>
              <label className="tsv-check"><input type="checkbox" checked={addOnlyTrainable} onChange={e => setAddOnlyTrainable(e.target.checked)} /> Only trainable</label>
              <label className="tsv-check"><input type="checkbox" checked={addHideProcLike} onChange={e => setAddHideProcLike(e.target.checked)} /> Hide proc-like</label>
              <select className="tsv-mini-input" value={addSkillLine} onChange={e => setAddSkillLine(e.target.value)}>
                {addSkillLineOptions.map(opt => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <input type="number" placeholder="Min lvl" value={addMinLevel} onChange={e => setAddMinLevel(e.target.value)} className="tsv-mini-input" />
              <input type="number" placeholder="Max lvl" value={addMaxLevel} onChange={e => setAddMaxLevel(e.target.value)} className="tsv-mini-input" />
            </div>
            <div className="tsv-add-list">
              {addResults.map(row => (
                <button
                  key={row.ID}
                  className={`tsv-add-item ${addSelected.includes(row.ID) ? 'active' : ''}`}
                  onClick={() => toggleAddSelected(row.ID)}
                  title={buildAddResultTooltip(row)}
                >
                  <span className="tsv-add-item-name">{row.Name_Lang_enUS}</span>
                  <span className="tsv-add-item-sub">{row.NameSubtext_Lang_enUS || 'No rank'} - #{row.ID} - Lvl {row.SpellLevel}{row.HasProcLikeBehavior ? ' - Proc-like' : ''}</span>
                </button>
              ))}
              {addSearch && addResults.length === 0 && <div className="tsv-empty">No results</div>}
            </div>
            <div className="tsv-modal-actions">
              <span className="tsv-muted">{addSelected.length} selected</span>
              <button className="btn-primary" onClick={handleAdd} disabled={adding || addSelected.length === 0}>
                <Plus size={13} /> {adding ? 'Adding...' : 'Add selected'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}












