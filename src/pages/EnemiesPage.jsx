import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { Search, Save, RotateCcw, Skull, Eye, EyeOff, Check, Square, ClipboardCopy, AlertTriangle, MousePointerClick } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';
import './EnemiesPage.css';

const VISIBILITY_OPTIONS = [
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'legacy', label: 'Legacy' },
  { value: 'classic+', label: 'Classic+' },
  { value: 'custom', label: 'Custom' },
];

const RANK_OPTIONS = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Elite' },
  { value: 2, label: 'Rare Elite' },
  { value: 3, label: 'Boss' },
  { value: 4, label: 'Rare' },
];

const ENEMY_PRESETS = [
  { id: 'vanilla', label: 'Vanilla', sub: 'Baseline Classic tuning', desc: 'Leave content visible and keep the original creature feel intact.', visibilityStatus: 'visible', phaseTag: 'vanilla', progressionTag: 'base', hpMultiplier: 1.00, damageMultiplier: 1.00, armorMultiplier: 1.00, color: '#c8a96e' },
  { id: 'classic-light', label: 'Classic+ Light', sub: 'Small bump', desc: 'A modest enemy bump for new Classic+ content without over-scaling.', visibilityStatus: 'classic+', phaseTag: 'classic+', progressionTag: 'light', hpMultiplier: 1.15, damageMultiplier: 1.08, armorMultiplier: 1.05, color: '#7abeee' },
  { id: 'classic-standard', label: 'Classic+ Standard', sub: 'Default Classic+ pass', desc: 'A balanced default for most modern Classic+ enemy tuning.', visibilityStatus: 'classic+', phaseTag: 'classic+', progressionTag: 'standard', hpMultiplier: 1.30, damageMultiplier: 1.18, armorMultiplier: 1.12, color: '#8a5acc' },
  { id: 'classic-hard', label: 'Classic+ Hard', sub: 'Tough encounter tuning', desc: 'Use for elite camps, dangerous zones, and boss-like outdoor enemies.', visibilityStatus: 'classic+', phaseTag: 'classic+', progressionTag: 'hard', hpMultiplier: 1.50, damageMultiplier: 1.35, armorMultiplier: 1.22, color: '#dc7a4f' },
];

const DEFAULT_META = { visibility_status: 'visible', phase_tag: '', progression_tag: '', notes: '', hp_multiplier: '1.00', damage_multiplier: '1.00', armor_multiplier: '1.00' };
const DEFAULT_DRAFT = { level: '1', rank: '0' };

const CREATURE_TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: '0', label: 'None' },
  { value: '1', label: 'Beast' },
  { value: '2', label: 'Dragonkin' },
  { value: '3', label: 'Demon' },
  { value: '4', label: 'Elemental' },
  { value: '5', label: 'Giant' },
  { value: '6', label: 'Undead' },
  { value: '7', label: 'Humanoid' },
  { value: '8', label: 'Critter' },
  { value: '9', label: 'Mechanical' },
  { value: '10', label: 'Not Specified' },
  { value: '11', label: 'Totem' },
  { value: '12', label: 'Non-Combat Pet' },
  { value: '13', label: 'Gas Cloud' },
];

const NPC_FLAG_MASKS = {
  TRAINER: 1 << 4,
  CLASS_TRAINER: 1 << 5,
  PROFESSION_TRAINER: 1 << 6,
  VENDOR: 1 << 7,
  VENDOR_ARMOR: 1 << 8,
  VENDOR_FOOD: 1 << 9,
  VENDOR_POISON: 1 << 10,
  VENDOR_REAGENT: 1 << 11,
  REPAIR: 1 << 12,
  REPAIR_ARMOR: 1 << 13,
  REPAIR_WEAPON: 1 << 14,
  AUCTIONEER: 1 << 15,
  STABLE_MASTER: 1 << 16,
  BANKER: 1 << 17,
  TABARD: 1 << 19,
  BATTLEMASTER: 1 << 20,
  BANK: 1 << 21,
  INNKEEPER: 1 << 22,
  MAILBOX: 1 << 23,
  MAIL: 1 << 24,
};

const NPC_SERVICE_MASK =
  NPC_FLAG_MASKS.TRAINER |
  NPC_FLAG_MASKS.CLASS_TRAINER |
  NPC_FLAG_MASKS.PROFESSION_TRAINER |
  NPC_FLAG_MASKS.VENDOR |
  NPC_FLAG_MASKS.VENDOR_ARMOR |
  NPC_FLAG_MASKS.VENDOR_FOOD |
  NPC_FLAG_MASKS.VENDOR_POISON |
  NPC_FLAG_MASKS.VENDOR_REAGENT |
  NPC_FLAG_MASKS.REPAIR |
  NPC_FLAG_MASKS.REPAIR_ARMOR |
  NPC_FLAG_MASKS.REPAIR_WEAPON |
  NPC_FLAG_MASKS.AUCTIONEER |
  NPC_FLAG_MASKS.STABLE_MASTER |
  NPC_FLAG_MASKS.BANKER |
  NPC_FLAG_MASKS.TABARD |
  NPC_FLAG_MASKS.BATTLEMASTER |
  NPC_FLAG_MASKS.BANK |
  NPC_FLAG_MASKS.INNKEEPER |
  NPC_FLAG_MASKS.MAILBOX |
  NPC_FLAG_MASKS.MAIL;

const UNIT_NON_COMBAT_MASK = (1 << 1) | (1 << 8) | (1 << 17) | (1 << 19);
const FLAGS_EXTRA_NON_COMBAT_MASK = (1 << 1) | (1 << 11);

const FACTION_FILTER_OPTIONS = [
  { value: 'enemy', label: 'Enemy only' },
  { value: 'all', label: 'All factions' },
];

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasFlag(value, mask) {
  return (num(value, 0) & mask) !== 0;
}

function text(value) {
  return value == null ? '' : String(value);
}

function mult(value) {
  return num(value, 1).toFixed(2);
}

function approx(a, b) {
  return Math.abs(num(a, 1) - num(b, 1)) < 0.0001;
}

function normalizePresetKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getPresetIdFromRow(row, meta) {
  for (const preset of ENEMY_PRESETS) {
    if (
      normalizePresetKey(meta.visibility_status) === preset.visibilityStatus &&
      normalizePresetKey(meta.phase_tag) === normalizePresetKey(preset.phaseTag) &&
      normalizePresetKey(meta.progression_tag) === normalizePresetKey(preset.progressionTag) &&
      approx(row.hp_multiplier, preset.hpMultiplier) &&
      approx(row.damage_multiplier, preset.damageMultiplier) &&
      approx(row.armor_multiplier, preset.armorMultiplier)
    ) return preset.id;
  }
  return 'custom';
}

function getPresetLabel(id) {
  return ENEMY_PRESETS.find(p => p.id === id)?.label || 'Custom';
}

function buildPresetDraft(preset) {
  return {
    visibility_status: preset.visibilityStatus,
    phase_tag: preset.phaseTag,
    progression_tag: preset.progressionTag,
    hp_multiplier: preset.hpMultiplier.toFixed(2),
    damage_multiplier: preset.damageMultiplier.toFixed(2),
    armor_multiplier: preset.armorMultiplier.toFixed(2),
  };
}

function formatLevel(row) {
  const min = num(row.minlevel, 0);
  const max = num(row.maxlevel, 0);
  if (!min && !max) return 'Lv ?';
  if (min && max && min !== max) return `Lv ${min}-${max}`;
  return `Lv ${min || max}`;
}

function getCreatureTypeLabel(value) {
  return CREATURE_TYPE_OPTIONS.find(opt => opt.value === String(value))?.label || 'Type ' + value;
}

function normalizeLowerRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    out[String(key).toLowerCase()] = value;
  }
  return out;
}

function normalizeFactionMeta(row) {
  const lower = normalizeLowerRow(row);
  const id = num(lower.id ?? lower.entry, NaN);
  if (!Number.isFinite(id)) return null;
  const faction = num(lower.faction, 0);
  const factionGroup = num(lower.factiongroup ?? lower.faction_group, 0);
  const friendGroup = num(lower.friendgroup ?? lower.friend_group, 0);
  const enemyGroup = num(lower.enemygroup ?? lower.enemy_group, 0);
  const enemies = [0, 1, 2, 3].map(i => num(lower['enemies_' + i], 0)).filter(Boolean);
  const friends = [0, 1, 2, 3].map(i => num(lower['friend_' + i], 0)).filter(Boolean);
  const hasEnemySignal = enemyGroup !== 0 || enemies.length > 0;
  const hasFriendlySignal = friendGroup !== 0 || friends.length > 0;
  const isEnemy = hasEnemySignal ? true : (hasFriendlySignal ? false : null);
  return { id, faction, factionGroup, friendGroup, enemyGroup, enemies, friends, isEnemy };
}

function isServiceNpc(row) {
  if (hasFlag(row.npcflag, NPC_SERVICE_MASK)) return true;
  if (hasFlag(row.unit_flags, UNIT_NON_COMBAT_MASK)) return true;
  if (hasFlag(row.flags_extra, FLAGS_EXTRA_NON_COMBAT_MASK)) return true;
  return false;
}

function enemyDecision(row, factionMetaById) {
  const type = num(row.type, 0);
  if (type === 8 || type === 11 || type === 12) return { scope: 'Non-combat', enemy: false, reason: 'type' };
  if (isServiceNpc(row)) return { scope: 'Service', enemy: false, reason: 'service' };
  const rank = num(row.rank, 0);
  if (rank === 3) return { scope: 'Boss', enemy: true, reason: 'boss-rank' };
  const meta = resolveFactionMeta(row, factionMetaById);
  if (meta?.isEnemy === true) return { scope: 'Enemy', enemy: true, reason: 'enemy-template' };
  if (meta?.isEnemy === false) return { scope: 'Neutral', enemy: false, reason: 'neutral-template' };
  return { scope: 'Unknown', enemy: true, reason: 'fallback' };
}

function resolveFactionMeta(row, factionMetaById) {
  const factionId = num(row.faction, 0);
  return factionMetaById?.get(factionId) || factionMetaById?.get(Number(row.faction)) || null;
}

function isEnemyCreature(row, factionMetaById) {
  return enemyDecision(row, factionMetaById).enemy;
}

function formatFactionLabel(factionId, factionMetaById) {
  const id = num(factionId, 0);
  if (!id) return 'Faction 0';
  const meta = factionMetaById?.get(id);
  if (meta?.name) return meta.name + ' (#' + id + ')';
  return 'Faction #' + id;
}

function getEnemyScopeLabel(row, factionMetaById) {
  return enemyDecision(row, factionMetaById).scope;
}

function toDraft(row) {
  return {
    level: String(num(row.minlevel ?? row.maxlevel ?? 1, 1)),
    rank: String(num(row.rank, 0)),
    hp_multiplier: text(row.hp_multiplier ?? 1),
    damage_multiplier: text(row.damage_multiplier ?? 1),
    armor_multiplier: text(row.armor_multiplier ?? 1),
  };
}

function toMeta(row) {
  return {
    visibility_status: text(row.visibility_status || 'visible'),
    phase_tag: text(row.phase_tag),
    progression_tag: text(row.progression_tag),
    notes: text(row.notes),
  };
}

export default function EnemiesPage() {
  const { query } = useConnection();
  const [search, setSearch] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState('all');
  const [factionFilter, setFactionFilter] = useState('enemy');
  const [creatureTypeFilter, setCreatureTypeFilter] = useState('all');
  const [minLevelFilter, setMinLevelFilter] = useState('');
  const [maxLevelFilter, setMaxLevelFilter] = useState('');
  const [creatures, setCreatures] = useState([]);
  const [factionCatalog, setFactionCatalog] = useState([]);
  const [selectedCreature, setSelectedCreature] = useState(null);
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const [meta, setMeta] = useState(DEFAULT_META);
  const [spawnInfo, setSpawnInfo] = useState({ count: 0, maps: '' });
  const [selectedEntries, setSelectedEntries] = useState(() => new Set());
  const [activePresetId, setActivePresetId] = useState('classic-standard');
  const [pendingSelection, setPendingSelection] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [tableReady, setTableReady] = useState(false);
  const selectedEntryRef = useRef(null);
  const unsavedGuard = useUnsavedGuard(dirty);
  const factionMetaById = useMemo(() => new Map(factionCatalog.map(row => [row.id, row])), [factionCatalog]);

  useEffect(() => {
    selectedEntryRef.current = selectedCreature?.entry || null;
  }, [selectedCreature]);
  const currentPresetId = useMemo(() => {
    if (!selectedCreature) return 'custom';
    return getPresetIdFromRow(
      {
        hp_multiplier: draft.hp_multiplier,
        damage_multiplier: draft.damage_multiplier,
        armor_multiplier: draft.armor_multiplier,
      },
      meta
    );
  }, [draft, meta, selectedCreature]);

  const visibleCreatureIds = useMemo(() => creatures.map(c => c.entry), [creatures]);
  const selectedCount = selectedEntries.size;

  const applyListDefaults = useCallback((rows) => {
    setCreatures(rows);
    setSelectedEntries(prev => new Set([...prev].filter(id => rows.some(r => r.entry === id))));
  }, []);

  const ensureMetaTable = useCallback(async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS enemy_editor_meta (
        entry INT NOT NULL PRIMARY KEY,
        visibility_status VARCHAR(20) NOT NULL DEFAULT 'visible',
        phase_tag VARCHAR(64) NOT NULL DEFAULT '',
        progression_tag VARCHAR(64) NOT NULL DEFAULT '',
        notes TEXT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    setTableReady(true);
  }, [query]);

  const loadFactionCatalog = useCallback(async () => {
    try {
      let templateRows = [];
      try {
        const templateRes = await query('SELECT * FROM faction_template');
        templateRows = templateRes.data || [];
      } catch {}

      const templateMap = new Map();
      for (const row of templateRows) {
        const meta = normalizeFactionMeta(row);
        if (!meta) continue;
        templateMap.set(meta.id, meta);
        if (meta.faction) templateMap.set(meta.faction, meta);
      }

      const usedRes = await query('SELECT ct.faction AS factionId, COUNT(*) AS creatureCount FROM creature_template ct GROUP BY ct.faction ORDER BY creatureCount DESC, factionId ASC');
      const next = (usedRes.data || [])
        .map(row => {
          const id = num(row.factionId, 0);
          const meta = templateMap.get(id) || null;
          return {
            id,
            label: 'Faction #' + id,
            count: num(row.creatureCount, 0),
            isEnemy: meta?.isEnemy ?? null,
            factionGroup: meta?.factionGroup ?? 0,
            friendGroup: meta?.friendGroup ?? 0,
            enemyGroup: meta?.enemyGroup ?? 0,
          };
        })
        .sort((a, b) => b.count - a.count || a.id - b.id);
      setFactionCatalog(next);
    } catch (err) {
      setFactionCatalog([]);
    }
  }, [query]);

  const loadSpawnInfo = useCallback(async (entry) => {
    const res = await query(
      'SELECT COUNT(*) AS spawnCount, GROUP_CONCAT(DISTINCT map ORDER BY map SEPARATOR ", ") AS maps FROM creature WHERE id1 = ?',
      [entry]
    );
    const row = res.data?.[0] || {};
    setSpawnInfo({ count: num(row.spawnCount, 0), maps: text(row.maps) });
  }, [query]);

  const loadMetaRow = useCallback(async (entry) => {
    const res = await query('SELECT visibility_status, phase_tag, progression_tag, notes FROM enemy_editor_meta WHERE entry = ? LIMIT 1', [entry]);
    return res.data?.[0] || null;
  }, [query]);

  const upsertMetaRow = useCallback(async (entry, patch, preserveNotes = true) => {
    const current = await loadMetaRow(entry);
    const next = {
      visibility_status: patch.visibility_status ?? current?.visibility_status ?? 'visible',
      phase_tag: patch.phase_tag ?? current?.phase_tag ?? '',
      progression_tag: patch.progression_tag ?? current?.progression_tag ?? '',
      notes: preserveNotes ? (patch.notes ?? current?.notes ?? '') : (patch.notes ?? ''),
    };
    const hasMeta = next.visibility_status !== 'visible' || next.phase_tag.trim() !== '' || next.progression_tag.trim() !== '' || next.notes.trim() !== '';

    if (!hasMeta) {
      if (current) await query('DELETE FROM enemy_editor_meta WHERE entry = ?', [entry]);
      return;
    }

    if (current) {
      await query(
        'UPDATE enemy_editor_meta SET visibility_status = ?, phase_tag = ?, progression_tag = ?, notes = ? WHERE entry = ?',
        [next.visibility_status, next.phase_tag, next.progression_tag, next.notes, entry]
      );
    } else {
      await query(
        'INSERT INTO enemy_editor_meta (entry, visibility_status, phase_tag, progression_tag, notes) VALUES (?,?,?,?,?)',
        [entry, next.visibility_status, next.phase_tag, next.progression_tag, next.notes]
      );
    }
  }, [loadMetaRow, query]);

  const loadCreature = useCallback(async (row) => {
    if (!row) return;
    setLoading(true);
    const metaRow = await loadMetaRow(row.entry);
    await loadSpawnInfo(row.entry);
    const currentMeta = metaRow || {};
    setSelectedCreature(row);
    setDraft(toDraft({ ...row, ...currentMeta }));
    setMeta(toMeta(currentMeta));
    setActivePresetId(getPresetIdFromRow(
      {
        hp_multiplier: currentMeta.hp_multiplier ?? row.hp_multiplier ?? 1,
        damage_multiplier: currentMeta.damage_multiplier ?? row.damage_multiplier ?? 1,
        armor_multiplier: currentMeta.armor_multiplier ?? row.armor_multiplier ?? 1,
      },
      toMeta(currentMeta)
    ));
    setPendingSelection(null);
    setDirty(false);
    setMsg(null);
    setLoading(false);
  }, [loadMetaRow, loadSpawnInfo]);

  const loadCreatures = useCallback(async (term, visibility, faction, creatureType, minLevel, maxLevel) => {
    setLoading(true);
    const trimmed = term.trim();
    const isNumeric = /^\d+$/.test(trimmed);
    const params = [];
    let sql = `
      SELECT
        ct.entry,
        ct.name,
        ct.minlevel,
        ct.maxlevel,
        ct.rank,
        ct.type,
        ct.faction,
        ct.npcflag,
        ct.unit_flags,
        ct.flags_extra,
        COALESCE(em.visibility_status, 'visible') AS visibility_status,
        COALESCE(em.phase_tag, '') AS phase_tag,
        COALESCE(em.progression_tag, '') AS progression_tag,
        COALESCE(em.notes, '') AS notes,
        COALESCE(ct.HealthModifier, 1) AS hp_multiplier,
        COALESCE(ct.DamageModifier, 1) AS damage_multiplier,
        COALESCE(ct.ArmorModifier, 1) AS armor_multiplier,
        COALESCE(sp.spawnCount, 0) AS spawn_count,
        COALESCE(sp.maps, '') AS maps
      FROM creature_template ct
      LEFT JOIN enemy_editor_meta em ON em.entry = ct.entry
      LEFT JOIN (
        SELECT id1 AS entry, COUNT(*) AS spawnCount, GROUP_CONCAT(DISTINCT map ORDER BY map SEPARATOR ', ') AS maps
        FROM creature
        GROUP BY id1
      ) sp ON sp.entry = ct.entry
      WHERE 1=1
    `;
    if (trimmed) {
      if (isNumeric) {
        sql += ' AND ct.entry = ?';
        params.push(Number(trimmed));
      } else {
        sql += ' AND ct.name LIKE ?';
        params.push(`%${trimmed}%`);
      }
    }
    if (visibility !== 'all') {
      sql += " AND COALESCE(em.visibility_status, 'visible') = ?";
      params.push(visibility);
    }
    if (faction !== 'all' && faction !== 'enemy') {
      sql += ' AND ct.faction = ?';
      params.push(Number(faction));
    }
    if (creatureType !== 'all') {
      sql += ' AND ct.type = ?';
      params.push(Number(creatureType));
    }
    if (minLevel !== '') {
      sql += ' AND ct.maxlevel >= ?';
      params.push(Number(minLevel));
    }
    if (maxLevel !== '') {
      sql += ' AND ct.minlevel <= ?';
      params.push(Number(maxLevel));
    }
    sql += ' ORDER BY CASE WHEN ct.rank = 3 THEN 0 WHEN ct.rank = 2 THEN 1 WHEN ct.rank = 1 THEN 2 ELSE 3 END ASC, ct.entry DESC LIMIT 500';
    const res = await query(sql, params);
    const rows = (res.data || []).map(row => {
      const decision = enemyDecision(row, factionMetaById);
      return {
        ...row,
        faction_label: formatFactionLabel(row.faction, factionMetaById),
        enemy_scope: decision.scope,
        enemy_reason: decision.reason,
      };
    });
    let filteredRows = faction === 'all'
      ? rows
      : rows.filter(row => row.enemy_reason !== 'service' && row.enemy_reason !== 'type' && row.enemy_reason !== 'neutral-template');
    let fallbackUsed = false;
    if (faction === 'enemy' && filteredRows.length === 0 && rows.length > 0) {
      filteredRows = rows;
      fallbackUsed = true;
    }
    applyListDefaults(filteredRows);
    if (fallbackUsed) setMsg({ type: 'warning', text: 'Strict enemy filter returned no rows, so showing all creatures for now.' });
    if (!selectedEntryRef.current && filteredRows[0]) {
      await loadCreature(filteredRows[0]);
    } else if (selectedEntryRef.current) {
      const next = filteredRows.find(r => r.entry === selectedEntryRef.current);
      if (next) setSelectedCreature(next);
    }
    setLoading(false);
    return rows;
  }, [applyListDefaults, factionMetaById, loadCreature, query]);

  useEffect(() => {
    ensureMetaTable().catch(err => setMsg({ type: 'error', text: err.message }));
  }, [ensureMetaTable]);

  useEffect(() => {
    if (!tableReady) return;
    loadFactionCatalog().catch(err => setMsg({ type: 'error', text: err.message }));
  }, [loadFactionCatalog, tableReady]);

  useEffect(() => {
    if (!tableReady) return;
    const timer = setTimeout(() => {
      loadCreatures(search, visibilityFilter, factionFilter, creatureTypeFilter, minLevelFilter, maxLevelFilter).catch(err => setMsg({ type: 'error', text: err.message }));
    }, 120);
    return () => clearTimeout(timer);
    }, [loadCreatures, search, tableReady, visibilityFilter, factionFilter, creatureTypeFilter, minLevelFilter, maxLevelFilter]);

  const markDirty = () => setDirty(true);

  const updateDraft = (key, value) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    markDirty();
  };

  const updateMeta = (key, value) => {
    setMeta(prev => ({ ...prev, [key]: value }));
    markDirty();
  };

  const requestSelect = async (row) => {
    if (!row || row.entry === selectedCreature?.entry) return;
    if (dirty) {
      setPendingSelection(row.entry);
      return;
    }
    await loadCreature(row);
  };

  const reloadSelectedFromRow = async () => {
    const fresh = creatures.find(r => r.entry === selectedCreature?.entry);
    if (fresh) await loadCreature(fresh);
  };
  const saveSelected = useCallback(async (nextSelection = null, snapshot = {}) => {
    if (!selectedCreature) return false;
    setSaving(true);
    setMsg(null);
    try {
      const entry = selectedCreature.entry;
      const effectiveDraft = snapshot.draft || draft;
      const effectiveMeta = snapshot.meta || meta;
      const level = Math.max(1, num(effectiveDraft.level, 1));
      const rank = num(effectiveDraft.rank, 0);
      const hpMultiplier = num(effectiveDraft.hp_multiplier, 1);
      const damageMultiplier = num(effectiveDraft.damage_multiplier, 1);
      const armorMultiplier = num(effectiveDraft.armor_multiplier, 1);

      await query(
        'UPDATE creature_template SET minlevel = ?, maxlevel = ?, rank = ?, HealthModifier = ?, DamageModifier = ?, ArmorModifier = ? WHERE entry = ?',
        [level, level, rank, hpMultiplier, damageMultiplier, armorMultiplier, entry]
      );
      await upsertMetaRow(entry, {
        visibility_status: effectiveMeta.visibility_status,
        phase_tag: effectiveMeta.phase_tag,
        progression_tag: effectiveMeta.progression_tag,
        notes: effectiveMeta.notes,
      });

      const rows = await loadCreatures(search, visibilityFilter, factionFilter, creatureTypeFilter, minLevelFilter, maxLevelFilter);
      const refreshed = rows.find(r => r.entry === entry);
      if (refreshed) {
        setSelectedCreature(refreshed);
      } else {
        setSelectedCreature({ ...selectedCreature, minlevel: level, maxlevel: level, rank, hp_multiplier: hpMultiplier, damage_multiplier: damageMultiplier, armor_multiplier: armorMultiplier });
      }
      setDraft({
        level: String(level),
        rank: String(rank),
        hp_multiplier: hpMultiplier.toFixed(2),
        damage_multiplier: damageMultiplier.toFixed(2),
        armor_multiplier: armorMultiplier.toFixed(2),
      });
      setMeta({
        visibility_status: effectiveMeta.visibility_status,
        phase_tag: effectiveMeta.phase_tag,
        progression_tag: effectiveMeta.progression_tag,
        notes: effectiveMeta.notes,
      });
      setDirty(false);
      setMsg({ type: 'success', text: `Saved entry #${entry}` });
      if (nextSelection) {
        const nextRow = rows.find(r => r.entry === nextSelection) || creatures.find(r => r.entry === nextSelection);
        if (nextRow) await loadCreature(nextRow);
      }
      return true;
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
      return false;
    } finally {
      setSaving(false);
    }
  }, [creatures, draft, loadCreatures, loadCreature, meta, query, search, selectedCreature, upsertMetaRow, visibilityFilter]);

  const resetSelected = async () => {
    if (!selectedCreature) return;
    const fresh = creatures.find(r => r.entry === selectedCreature.entry) || selectedCreature;
    await loadCreature(fresh);
  };

  const presetForCurrent = useMemo(() => {
    if (!selectedCreature) return 'custom';
    return getPresetIdFromRow(
      {
        hp_multiplier: draft.hp_multiplier,
        damage_multiplier: draft.damage_multiplier,
        armor_multiplier: draft.armor_multiplier,
      },
      meta
    );
  }, [draft, meta, selectedCreature]);

  useEffect(() => {
    if (!selectedCreature) return;
    setActivePresetId(presetForCurrent);
  }, [selectedCreature]);

  const toggleSelectedEntry = (entry) => {
    setSelectedEntries(prev => {
      const next = new Set(prev);
      if (next.has(entry)) next.delete(entry);
      else next.add(entry);
      return next;
    });
  };

  const selectVisibleEntries = () => {
    setSelectedEntries(new Set(visibleCreatureIds));
  };

  const clearSelection = () => setSelectedEntries(new Set());

  const applyPresetToEntry = async (entry, preset) => {
    await query(
      'UPDATE creature_template SET HealthModifier = ?, DamageModifier = ?, ArmorModifier = ? WHERE entry = ?',
      [preset.hpMultiplier, preset.damageMultiplier, preset.armorMultiplier, entry]
    );
    await upsertMetaRow(entry, buildPresetDraft(preset), true);
  };

  const applyPresetToTargets = async (targets) => {
    const preset = ENEMY_PRESETS.find(p => p.id === activePresetId);
    if (!preset || !targets.length) return;
    setBulkBusy(true);
    setMsg(null);
    try {
      for (const entry of targets) {
        await applyPresetToEntry(entry, preset);
      }
      const rows = await loadCreatures(search, visibilityFilter, factionFilter, creatureTypeFilter, minLevelFilter, maxLevelFilter);
      const current = rows.find(r => r.entry === selectedCreature?.entry);
      if (current) await loadCreature(current);
      setMsg({ type: 'success', text: `Applied ${preset.label} to ${targets.length} creature(s)` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setBulkBusy(false);
    }
  };

  const quickVisibility = async (value) => {
    const nextMeta = { ...meta, visibility_status: value };
    setMeta(nextMeta);
    markDirty();
    await saveSelected(null, { meta: nextMeta, draft });
  };

  const handleRowClick = async (row) => {
    if (!row) return;
    if (selectedCreature?.entry === row.entry) {
      await reloadSelectedFromRow();
      return;
    }
    await requestSelect(row);
  };

  const pendingRow = pendingSelection ? creatures.find(r => r.entry === pendingSelection) : null;
  const selectedMaps = spawnInfo.maps ? spawnInfo.maps.split(',').map(s => s.trim()).filter(Boolean) : [];
  return (
    <div className="enemies-page fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Enemies</h1>
          <p className="page-sub">A focused creature balancing and visibility layer for Classic+ work</p>
        </div>
        <div className="enemies-header-meta">
          <div className="enemies-kpi">
            <span className="enemies-kpi-label">Loaded</span>
            <strong>{creatures.length}</strong>
          </div>
          <div className="enemies-kpi">
            <span className="enemies-kpi-label">Selected</span>
            <strong>{selectedCount}</strong>
          </div>
        </div>
      </div>

      {msg && <div className={`editor-msg ${msg.type}`} style={{ marginBottom: 12 }}>{msg.text}</div>}

      <div className="enemies-toolbar">
        <div className="enemies-search field-group">
          <label>Search creatures</label>
          <div className="search-input-wrap">
            <Search size={14} />
            <input type="text" placeholder="Name or entry" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="field-group enemies-filter">
          <label>Visibility filter</label>
          <select value={visibilityFilter} onChange={e => setVisibilityFilter(e.target.value)}>
            <option value="all">All</option>
            {VISIBILITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>

        <div className="field-group enemies-filter">
          <label>Faction filter</label>
          <select value={factionFilter} onChange={e => setFactionFilter(e.target.value)} title="Enemy only keeps explicit hostile combat factions and hides service NPCs like vendors and trainers">
            {FACTION_FILTER_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            {factionCatalog.length > 0 && <optgroup label="Creature factions">
              {factionCatalog.map(opt => <option key={opt.id} value={String(opt.id)}>{opt.label} ({opt.count}){opt.isEnemy === true ? ' Enemy' : opt.isEnemy === false ? ' Neutral' : ' Unknown'}</option>)}
            </optgroup>}
          </select>
        </div>

        <div className="field-group enemies-filter">
          <label>Creature type</label>
          <select value={creatureTypeFilter} onChange={e => setCreatureTypeFilter(e.target.value)}>
            {CREATURE_TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>

        <div className="field-group enemies-filter">
          <label>Min level</label>
          <input type="number" min="1" value={minLevelFilter} onChange={e => setMinLevelFilter(e.target.value)} placeholder="Any" />
        </div>

        <div className="field-group enemies-filter">
          <label>Max level</label>
          <input type="number" min="1" value={maxLevelFilter} onChange={e => setMaxLevelFilter(e.target.value)} placeholder="Any" />
        </div>

        <div className="enemies-toolbar-actions">
          <button type="button" className="btn-ghost" onClick={selectVisibleEntries} disabled={!creatures.length}><Check size={13} /> Select filtered</button>
          <button type="button" className="btn-ghost" onClick={clearSelection} disabled={!selectedCount}><Square size={13} /> Clear selection</button>
          <button type="button" className="btn-ghost" onClick={() => loadCreatures(search, visibilityFilter, factionFilter, creatureTypeFilter, minLevelFilter, maxLevelFilter)} disabled={loading || !tableReady}><RotateCcw size={13} /> Refresh</button>
        </div>
      </div>

      <div className="enemies-layout">
        <section className="enemies-list-panel">
          <div className="enemies-panel-head">
            <div>
              <div className="enemies-panel-title">Creature list</div>
              <div className="enemies-panel-sub">{loading ? 'Loading...' : `${creatures.length} result(s)`}</div>
            </div>
            <div className="enemies-panel-sub">Hidden content stays recoverable in editor metadata.</div>
          </div>

          <div className="enemies-list">
            {creatures.length ? creatures.map(row => {
              const active = selectedCreature?.entry === row.entry;
              const checked = selectedEntries.has(row.entry);
              const presetId = getPresetIdFromRow(row, row);
              const typeLabel = getCreatureTypeLabel(row.type);
              const factionLabel = row.faction_label || formatFactionLabel(row.faction, factionMetaById);
              const enemyScope = row.enemy_scope || getEnemyScopeLabel(row, factionMetaById);
              return (
                <div key={row.entry} className={`enemy-row${active ? ' active' : ''}`} onClick={() => handleRowClick(row)} role="button" tabIndex={0}>
                  <label className="enemy-check" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSelectedEntry(row.entry)} />
                  </label>
                  <div className="enemy-row-body">
                    <div className="enemy-row-top">
                      <div className="enemy-row-name"><Skull size={13} /><span>{row.name || 'Unnamed creature'}</span></div>
                      <span className={`enemy-pill enemy-pill-${normalizePresetKey(row.visibility_status)}`}>{row.visibility_status}</span>
                    </div>
                    <div className="enemy-row-meta-line">
                      <span>#{row.entry}</span>
                      <span>{formatLevel(row)}</span>
                      <span>Rank {row.rank}</span>
                      <span>{typeLabel}</span>
                      <span>{factionLabel}</span>
                      <span>{enemyScope}</span>
                      {row.enemy_reason && <span>{row.enemy_reason}</span>}
                      {num(row.spawn_count, 0) > 0 && <span>{row.spawn_count} spawn(s){row.maps ? ` on ${row.maps}` : ''}</span>}
                    </div>
                    <div className="enemy-row-stats">
                      <span>HP x{mult(row.hp_multiplier)}</span>
                      <span>Dmg x{mult(row.damage_multiplier)}</span>
                      <span>Armor x{mult(row.armor_multiplier)}</span>
                      <span className={`enemy-match enemy-match-${presetId}`}>{getPresetLabel(presetId)}</span>
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="editor-empty"><MousePointerClick /><p>No creatures match the current search and visibility filter.</p></div>
            )}
          </div>
        </section>

        <section className="enemies-detail-panel">
          <div className="enemies-panel-head">
            <div>
              <div className="enemies-panel-title">{selectedCreature ? (selectedCreature.name || `Creature #${selectedCreature.entry}`) : 'Select a creature'}</div>
              <div className="enemies-panel-sub">
                {selectedCreature
                  ? `Entry #${selectedCreature.entry} · stored ${formatLevel(selectedCreature)} · current preset ${getPresetLabel(currentPresetId)}`
                  : 'Pick a row on the left to edit balance and visibility metadata.'}
              </div>
            </div>
            {selectedCreature && (
              <div className="enemies-detail-badges">
                <span className={`enemy-pill enemy-pill-${normalizePresetKey(meta.visibility_status)}`}>{meta.visibility_status}</span>
                <span className={`enemy-match enemy-match-${currentPresetId}`}>{getPresetLabel(currentPresetId)}</span>
              </div>
            )}
          </div>

          {pendingSelection && dirty && (
            <div className="editor-msg warning">
              <AlertTriangle size={13} />
              <span>Unsaved changes on entry #{selectedCreature?.entry}. Save or discard before switching to entry #{pendingSelection}.</span>
              <div className="enemies-inline-actions">
                <button type="button" className="btn-primary" onClick={async () => {
                  const target = pendingRow;
                  const ok = await saveSelected(pendingSelection);
                  if (ok && target) await loadCreature(target);
                  setPendingSelection(null);
                }} disabled={saving || !pendingRow}><Save size={13} /> Save & switch</button>
                <button type="button" className="btn-ghost" onClick={async () => {
                  const target = pendingRow;
                  setDirty(false);
                  setPendingSelection(null);
                  if (target) await loadCreature(target);
                }} disabled={!pendingRow}>Discard</button>
                <button type="button" className="btn-ghost" onClick={() => setPendingSelection(null)}>Cancel</button>
              </div>
            </div>
          )}

          {!selectedCreature ? (
            <div className="editor-empty"><MousePointerClick /><p>Select an enemy to inspect and tune it.</p></div>
          ) : (
            <>
              <div className="enemy-preset-grid">
                {ENEMY_PRESETS.map(preset => {
                  const active = activePresetId === preset.id;
                  return (
                    <button key={preset.id} type="button" className={`enemy-preset-card${active ? ' active' : ''}`} style={{ '--preset-color': preset.color }} onClick={() => setActivePresetId(preset.id)}>
                      <div className="enemy-preset-top"><span className="enemy-preset-label">{preset.label}</span>{active && <Check size={13} />}</div>
                      <span className="enemy-preset-sub">{preset.sub}</span>
                      <p className="enemy-preset-desc">{preset.desc}</p>
                    </button>
                  );
                })}
              </div>

              <div className="enemy-form-grid">
                <div className="field-group"><label>Level</label><input type="number" min="1" value={draft.level} onChange={e => updateDraft('level', e.target.value)} /></div>
                <div className="field-group"><label>Rank</label><select value={draft.rank} onChange={e => updateDraft('rank', e.target.value)}>{RANK_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                <div className="field-group"><label>HP multiplier</label><input type="number" step="0.01" value={draft.hp_multiplier} onChange={e => updateDraft('hp_multiplier', e.target.value)} onWheel={e => e.target.blur()} /></div>
                <div className="field-group"><label>Damage multiplier</label><input type="number" step="0.01" value={draft.damage_multiplier} onChange={e => updateDraft('damage_multiplier', e.target.value)} onWheel={e => e.target.blur()} /></div>
                <div className="field-group"><label>Armor multiplier</label><input type="number" step="0.01" value={draft.armor_multiplier} onChange={e => updateDraft('armor_multiplier', e.target.value)} onWheel={e => e.target.blur()} /></div>
                <div className="field-group"><label>Visibility status</label><select value={meta.visibility_status} onChange={e => updateMeta('visibility_status', e.target.value)}>{VISIBILITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                <div className="field-group"><label>Phase tag</label><input type="text" value={meta.phase_tag} onChange={e => updateMeta('phase_tag', e.target.value)} placeholder="classic+ / vanilla / custom" /></div>
                <div className="field-group"><label>Progression tag</label><input type="text" value={meta.progression_tag} onChange={e => updateMeta('progression_tag', e.target.value)} placeholder="light / standard / hard" /></div>
              </div>

              <div className="enemy-visibility-quick">
                <span className="enemy-visibility-label"><Eye size={13} /> Quick visibility</span>
                <div className="enemies-inline-actions">
                  <button type="button" className="btn-ghost" onClick={() => quickVisibility('visible')} disabled={saving}><Eye size={13} /> Visible</button>
                  <button type="button" className="btn-ghost" onClick={() => quickVisibility('hidden')} disabled={saving}><EyeOff size={13} /> Hidden</button>
                </div>
              </div>

              <div className="field-group enemy-notes">
                <label>Notes</label>
                <textarea rows="4" value={meta.notes} onChange={e => updateMeta('notes', e.target.value)} placeholder="Why this enemy is scaled or hidden..." />
              </div>

              <div className="enemy-info-grid">
                <div className="enemy-info-card">
                  <div className="enemy-info-label">Filter reason</div>
                  <strong>{selectedCreature ? (selectedCreature.enemy_reason || getEnemyScopeLabel(selectedCreature, factionMetaById)) : 'n/a'}</strong>
                  <span>{selectedCreature ? 'Why this creature is currently included or excluded by the enemy filter.' : 'Select a creature to inspect classification.'}</span>
                </div>
                <div className="enemy-info-card">
                  <div className="enemy-info-label">Spawn locations</div>
                  <strong>{spawnInfo.count || 0}</strong>
                  <span>{selectedMaps.length ? `Maps: ${selectedMaps.join(', ')}` : 'No world spawns found yet'}</span>
                </div>
                <div className="enemy-info-card">
                  <div className="enemy-info-label">Original range</div>
                  <strong>{formatLevel(selectedCreature)}</strong>
                  <span>{selectedCreature.minlevel !== selectedCreature.maxlevel ? 'Stored as a range in creature_template' : 'Single level entry'}</span>
                </div>
                <div className="enemy-info-card">
                  <div className="enemy-info-label">Editor layer</div>
                  <strong>{getPresetLabel(currentPresetId)}</strong>
                  <span>Visibility and notes live in a separate editor metadata table.</span>
                </div>
              </div>

              <div className="enemies-action-row">
                <button type="button" className="btn-primary" onClick={() => saveSelected()} disabled={saving || !selectedCreature}><Save size={13} /> {saving ? 'Saving...' : 'Save enemy'}</button>
                <button type="button" className="btn-ghost" onClick={resetSelected} disabled={saving || !dirty}><RotateCcw size={13} /> Reset</button>
                <button type="button" className="btn-ghost" onClick={() => applyPresetToTargets(selectedEntries.size ? [...selectedEntries] : visibleCreatureIds)} disabled={bulkBusy || !creatures.length}><ClipboardCopy size={13} /> {bulkBusy ? 'Applying...' : `Apply ${getPresetLabel(activePresetId)} to ${selectedEntries.size ? `${selectedEntries.size} selected` : `${visibleCreatureIds.length} filtered`}`}</button>
              </div>
            </>
          )}
        </section>
      </div>

      {dirty && unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
    </div>
  );
}










