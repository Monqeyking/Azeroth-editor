import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, BookOpen, Copy, GitBranch, Hammer, MousePointerClick, Plus, RotateCcw, Save, Search } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import CreatureModelPreview from '../components/creature/CreatureModelPreview';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import '../pages/DashboardPage.css';
import './EditorPage.css';
import './NPCWorkflowPage.css';
import './ProfessionEditorPage.css';

const PROFESSION_PRESETS = [
  { id: 'alchemy', label: 'Alchemy', skillLine: 171, subname: 'Master Alchemist', npcflag: 83, greeting: 'I can teach you the secrets of alchemy.', color: '#9AD8B8' },
  { id: 'blacksmithing', label: 'Blacksmithing', skillLine: 164, subname: 'Master Blacksmith', npcflag: 83, greeting: 'Need a stronger blade or armor?', color: '#D8A06A' },
  { id: 'enchanting', label: 'Enchanting', skillLine: 333, subname: 'Master Enchanter', npcflag: 83, greeting: 'I can help empower your gear.', color: '#76D1FF' },
  { id: 'engineering', label: 'Engineering', skillLine: 202, subname: 'Engineering Trainer', npcflag: 83, greeting: 'Gears, gadgets, and glorious explosions.', color: '#F3B16A' },
  { id: 'inscription', label: 'Inscription', skillLine: 773, subname: 'Master Scribe', npcflag: 83, greeting: 'Let us write power into every glyph.', color: '#D6B5FF' },
  { id: 'jewelcrafting', label: 'Jewelcrafting', skillLine: 755, subname: 'Master Jewelcrafter', npcflag: 83, greeting: 'Precious stones can be shaped into power.', color: '#FFBAE6' },
  { id: 'leatherworking', label: 'Leatherworking', skillLine: 165, subname: 'Master Leatherworker', npcflag: 83, greeting: 'Fine hides, stitched for battle.', color: '#D2A26A' },
  { id: 'tailoring', label: 'Tailoring', skillLine: 197, subname: 'Master Tailor', npcflag: 83, greeting: 'Need robes, bags, or bolts of cloth?', color: '#E2D7D0' },
  { id: 'cooking', label: 'Cooking', skillLine: 185, subname: 'Grand Master Cook', npcflag: 83, greeting: 'I have a recipe for every appetite.', color: '#FFCF7A' },
  { id: 'first-aid', label: 'First Aid', skillLine: 129, subname: 'Grand Master Medic', npcflag: 83, greeting: 'I can teach you to patch wounds fast.', color: '#FF9C9C' },
  { id: 'fishing', label: 'Fishing', skillLine: 356, subname: 'Master Angler', npcflag: 83, greeting: 'The best catches are patient.', color: '#8FD3FF' },
  { id: 'mining', label: 'Mining', skillLine: 186, subname: 'Master Miner', npcflag: 83, greeting: 'The richest veins are deeper down.', color: '#D9C894' },
  { id: 'herbalism', label: 'Herbalism', skillLine: 182, subname: 'Master Herbalist', npcflag: 83, greeting: 'The right herb can change everything.', color: '#8FD7A2' },
  { id: 'skinning', label: 'Skinning', skillLine: 393, subname: 'Master Skinner', npcflag: 83, greeting: 'Bring me hides worth working.', color: '#CFAE7C' },
  { id: 'custom', label: 'Custom / new', skillLine: 0, subname: 'Profession Trainer', npcflag: 83, greeting: 'I can teach you a profession.', color: '#8E97AA' },
];

const PROFESSION_SKILL_LABELS = PROFESSION_PRESETS.reduce((acc, preset) => {
  if (preset.skillLine) acc[preset.skillLine] = preset.label;
  return acc;
}, {});

const PROFESSION_FILTER_OPTIONS = [
  { value: 'all', label: 'All professions' },
  ...PROFESSION_PRESETS.filter((preset) => preset.id !== 0).map((preset) => ({
    value: String(preset.id),
    label: preset.label,
  })),
  { value: 'custom', label: 'Custom / new' },
];


const EMPTY_FORM = () => ({ entry: '', name: '', subname: '', faction: 0, gossip_menu_id: 0, npcflag: 83 });
const EMPTY_TRAINER = () => ({ trainerId: '', type: 2, requirement: 0, greeting: '' });
const EMPTY_MODEL = () => ({ creatureDisplayId: '', displayScale: 1, probability: 1, verifiedBuild: 0 });

function hasFlag(value, bit) { return (Number(value) & bit) !== 0; }
function formatCount(value) { return Number(value || 0).toLocaleString(); }
function moneyToText(copper = 0) {
  const value = Number(copper) || 0;
  return `${Math.floor(value / 10000)}g ${Math.floor((value % 10000) / 100)}s ${value % 100}c`;
}
function buildVariantName(name) {
  const base = (name || 'New NPC').trim();
  if (!base) return 'New Profession Variant';
  return /variant$/i.test(base) ? `${base} 2` : `${base} Variant`;
}
function presetById(id) { return PROFESSION_PRESETS.find(p => p.id === id) || PROFESSION_PRESETS[PROFESSION_PRESETS.length - 1]; }
function presetBySkillLine(skillLine) { return PROFESSION_PRESETS.find(p => Number(p.skillLine) === Number(skillLine)) || presetById('custom'); }
function normalizeModelRow(row) {
  if (!row) return EMPTY_MODEL();
  return {
    creatureDisplayId: row.CreatureDisplayID ? String(row.CreatureDisplayID) : '',
    displayScale: row.DisplayScale ?? 1,
    probability: row.Probability ?? 1,
    verifiedBuild: row.VerifiedBuild ?? 0,
  };
}
function summarizeSkillLines(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const skillLine = Number(row.ReqSkillLine || 0);
    const current = groups.get(skillLine) || { skillLine, count: 0, minLevel: null, maxLevel: null };
    current.count += 1;
    const level = Number(row.ReqLevel || 0);
    current.minLevel = current.minLevel === null ? level : Math.min(current.minLevel, level);
    current.maxLevel = current.maxLevel === null ? level : Math.max(current.maxLevel, level);
    groups.set(skillLine, current);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.skillLine - b.skillLine);
}
function skillLineLabel(skillLine) { return PROFESSION_SKILL_LABELS[Number(skillLine)] || (skillLine ? `SkillLine ${skillLine}` : 'No skill line'); }
function derivePresetId(form, trainerRow, skillRows) {
  const dominantSkillLine = (skillRows || [])
    .filter(row => Number(row.skillLine ?? row.ReqSkillLine ?? 0) > 0)
    .sort((a, b) => (b.count || 0) - (a.count || 0) || Number(a.skillLine ?? a.ReqSkillLine ?? 0) - Number(b.skillLine ?? b.ReqSkillLine ?? 0))[0];
  const skillLine = Number(dominantSkillLine?.skillLine ?? dominantSkillLine?.ReqSkillLine ?? 0);
  if (skillLine) {
    const preset = presetBySkillLine(skillLine);
    if (preset.id !== 'custom') return preset.id;
  }
  if (hasFlag(form.npcflag, 64) || trainerRow?.Type === 2) return 'custom';
  return 'custom';
}

export default function ProfessionEditorPage() {
  const { query, findNextId, idRanges, soapConfig, soapCommand } = useConnection();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [professionFilter, setProfessionFilter] = useState('all');
  const [createPreset, setCreatePreset] = useState('leatherworking');
  const [createName, setCreateName] = useState('New Profession NPC');
  const [creating, setCreating] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM());
  const [trainer, setTrainer] = useState(EMPTY_TRAINER());
  const [trainerSpellCount, setTrainerSpellCount] = useState(0);
  const [trainerSpellRows, setTrainerSpellRows] = useState([]);
  const [skillRows, setSkillRows] = useState([]);
  const [legacy, setLegacy] = useState({ total: 0, templateRefs: 0, directRows: 0 });
  const [model, setModel] = useState(EMPTY_MODEL());
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});
  const [presetId, setPresetId] = useState('custom');
  const searchRef = useRef(null);
  const unsavedGuard = useUnsavedGuard(dirty);
  const markDirty = useCallback(() => setDirty(true), []);


  const searchProfessionNpc = useCallback(async (term, professionValue = 'all') => {
    setLoading(true);
    const raw = String(term || '').trim();
    const isNum = /^\d+$/.test(raw);
    const whereParts = ['(t.Type = 2 OR (ct.npcflag & 64) <> 0)'];
    const havingParts = [];
    const params = [];

    if (professionValue && professionValue !== 'all') {
      const professionPreset = professionValue === 'custom' ? presetById('custom') : presetById(professionValue);
      if (professionPreset?.id === 'custom') {
        havingParts.push('SUM(CASE WHEN ts.ReqSkillLine > 0 THEN 1 ELSE 0 END) = 0');
      } else if (professionPreset?.skillLine) {
        havingParts.push('SUM(CASE WHEN ts.ReqSkillLine = ? THEN 1 ELSE 0 END) > 0');
        params.push(professionPreset.skillLine);
      }
    }

    if (raw) {
      whereParts.push(isNum ? 'ct.entry = ?' : '(ct.name LIKE ? OR ct.subname LIKE ?)');
      if (isNum) params.push(Number(raw));
      else params.push(`%${raw}%`, `%${raw}%`);
    }

    const sql = `
      SELECT ct.entry, ct.name, ct.subname, ct.npcflag, ct.faction,
             cdt.TrainerId, t.Type, t.Requirement,
             COUNT(DISTINCT ts.SpellId) AS spellCount,
             COUNT(DISTINCT ts.ReqSkillLine) AS skillLineCount,
             GROUP_CONCAT(DISTINCT ts.ReqSkillLine ORDER BY ts.ReqSkillLine SEPARATOR ',') AS skillLines
      FROM creature_template ct
      LEFT JOIN creature_default_trainer cdt ON cdt.CreatureId = ct.entry
      LEFT JOIN trainer t ON t.Id = cdt.TrainerId
      LEFT JOIN trainer_spell ts ON ts.TrainerId = t.Id
      WHERE ${whereParts.join(' AND ')}
      GROUP BY ct.entry, ct.name, ct.subname, ct.npcflag, ct.faction, cdt.TrainerId, t.Type, t.Requirement
      ${havingParts.length ? `HAVING ${havingParts.join(' AND ')}` : ''}
      ORDER BY spellCount DESC, ct.entry DESC
      LIMIT 60`;
    const res = await query(sql, params);
    setEntries(res.data || []);
    setLoading(false);
  }, [query]);

  const loadNpc = useCallback(async (entry) => {
    const [tplRes, trainerRes, spellCountRes, spellRowsRes, skillRes, legacyRes, modelRes] = await Promise.all([
      query('SELECT entry, name, subname, faction, gossip_menu_id, npcflag FROM creature_template WHERE entry = ?', [entry]),
      query('SELECT cdt.TrainerId, t.Type, t.Requirement, t.Greeting FROM creature_default_trainer cdt JOIN trainer t ON t.Id = cdt.TrainerId WHERE cdt.CreatureId = ? LIMIT 1', [entry]),
      query('SELECT COUNT(*) AS c FROM trainer_spell WHERE TrainerId = (SELECT TrainerId FROM creature_default_trainer WHERE CreatureId = ? LIMIT 1)', [entry]),
      query('SELECT SpellId, ReqLevel, MoneyCost, ReqSkillLine FROM trainer_spell WHERE TrainerId = (SELECT TrainerId FROM creature_default_trainer WHERE CreatureId = ? LIMIT 1) ORDER BY ReqLevel, SpellId LIMIT 6', [entry]),
      query('SELECT ts.ReqSkillLine, ts.ReqLevel FROM trainer_spell ts WHERE ts.TrainerId = (SELECT TrainerId FROM creature_default_trainer WHERE CreatureId = ? LIMIT 1) ORDER BY ts.ReqSkillLine, ts.ReqLevel', [entry]),
      query('SELECT COUNT(*) AS total, SUM(SpellID < 0) AS templateRefs, SUM(SpellID > 0) AS directRows FROM npc_trainer WHERE ID = ?', [entry]),
      query('SELECT CreatureDisplayID, DisplayScale, Probability, VerifiedBuild FROM creature_template_model WHERE CreatureID = ? ORDER BY Idx LIMIT 1', [entry]),
    ]);

    const row = tplRes.data?.[0];
    if (!row) return;
    const trainerRow = trainerRes.data?.[0] || null;
    const skills = skillRes.data || [];
    setSelected(row);
    setForm({ entry: row.entry, name: row.name || '', subname: row.subname || '', faction: row.faction ?? 0, gossip_menu_id: row.gossip_menu_id ?? 0, npcflag: row.npcflag ?? 83 });
    setTrainer({ trainerId: trainerRow?.TrainerId ?? '', type: trainerRow?.Type ?? 2, requirement: trainerRow?.Requirement ?? 0, greeting: trainerRow?.Greeting ?? '' });
    setTrainerSpellCount(Number(spellCountRes.data?.[0]?.c || 0));
    setTrainerSpellRows((spellRowsRes.data || []).map(row => ({
      spellId: Number(row.SpellId || 0),
      reqLevel: Number(row.ReqLevel || 0),
      moneyCost: Number(row.MoneyCost || 0),
      reqSkillLine: Number(row.ReqSkillLine || 0),
    })));
    setSkillRows(summarizeSkillLines(skills));
    setLegacy({ total: Number(legacyRes.data?.[0]?.total || 0), templateRefs: Number(legacyRes.data?.[0]?.templateRefs || 0), directRows: Number(legacyRes.data?.[0]?.directRows || 0) });
    setModel(normalizeModelRow(modelRes.data?.[0]));
    setPresetId(derivePresetId(row, trainerRow, skills));
    setDirty(false);
    setMsg(null);
    setErrors({});
  }, [query]);

  useEffect(() => { searchProfessionNpc(search, professionFilter); }, [professionFilter, search, searchProfessionNpc]);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const entry = Number(searchParams.get('entry')) || 0;
    if (!entry) return;
    loadNpc(entry);
  }, [location.search, loadNpc, searchParams]);

  const activePreset = useMemo(() => presetById(presetId), [presetId]);
  const skillLineSummary = useMemo(() => skillRows.find(row => Number(row.skillLine) > 0) || skillRows[0] || null, [skillRows]);
  const skillLineCount = skillRows.length;
  const activeProfessionFilter = useMemo(() => PROFESSION_FILTER_OPTIONS.find(option => option.value === professionFilter) || PROFESSION_FILTER_OPTIONS[0], [professionFilter]);
  const searchStatusText = useMemo(() => {
    const parts = [];
    if (professionFilter !== 'all') parts.push(`Profession: ${activeProfessionFilter.label}`);
    if (search.trim()) parts.push(`Search: "${search.trim()}"`);
    return parts.length ? `Filtered by ${parts.join(' � ')}` : 'Showing profession NPCs';
  }, [activeProfessionFilter.label, professionFilter, search]);
  const hasSearchFilter = search.trim().length > 0 || professionFilter !== 'all';
  const filteredCount = entries.length;


  const warnings = useMemo(() => {
    const next = [];
    const flagValue = Number(form.npcflag) || 0;
    if (!hasFlag(flagValue, 16)) next.push({ tone: 'warn', text: 'Profession trainers should keep the base Trainer flag (16).' });
    if (!hasFlag(flagValue, 64)) next.push({ tone: 'warn', text: 'Profession trainers usually need npcflag 64 (Profession Trainer).' });
    if (trainer.type !== 2) next.push({ tone: 'warn', text: 'Trainer type should stay on 2 for profession trainers.' });
    if (trainer.requirement !== 0) next.push({ tone: 'warn', text: 'Profession trainers normally use requirement 0.' });
    if (!trainer.trainerId) next.push({ tone: 'info', text: 'No trainer link is set yet. Save will create one automatically.' });
    if (skillLineCount === 0) next.push({ tone: 'warn', text: 'No trainer_spell rows were found. This NPC has no visible profession recipes yet.' });
    if (skillLineCount > 1) next.push({ tone: 'info', text: 'Multiple skill lines are attached to this trainer. Keep an eye on cross-profession mixes.' });
    if (legacy.templateRefs > 0) next.push({ tone: 'info', text: 'Legacy npc_trainer template references were detected. Treat this as a special case and only use known templates.' });
    else if (legacy.total > 0) next.push({ tone: 'info', text: `Legacy npc_trainer rows exist (${formatCount(legacy.total)}). This NPC is not purely trainer_spell-driven.` });
    if (skillLineSummary && activePreset.skillLine && Number(activePreset.skillLine) !== Number(skillLineSummary.skillLine)) {
      next.push({ tone: 'warn', text: `Detected profession ${activePreset.label} expects ${skillLineLabel(activePreset.skillLine)}, but the current trainer is gated by ${skillLineLabel(skillLineSummary.skillLine)}.` });
    }
    return next;
  }, [activePreset.label, activePreset.skillLine, form.npcflag, legacy.templateRefs, legacy.total, skillLineCount, skillLineSummary, trainer.requirement, trainer.trainerId, trainer.type]);
  const setField = useCallback((key, value) => { setForm(prev => ({ ...prev, [key]: value })); markDirty(); }, [markDirty]);
  const setTrainerField = useCallback((key, value) => { setTrainer(prev => ({ ...prev, [key]: value })); markDirty(); }, [markDirty]);
  const applyPreset = useCallback((id) => {
    const preset = presetById(id);
    setPresetId(id);
    setForm(prev => ({ ...prev, npcflag: preset.npcflag, subname: preset.subname }));
    setTrainer(prev => ({ ...prev, type: 2, requirement: 0, greeting: preset.greeting }));
    markDirty();
  }, [markDirty]);

  const validate = () => {
    const next = {};
    if (!form.name?.trim()) next.name = 'Name is required';
    if (trainer.type !== 2) next.type = 'Profession trainers should use type 2';
    if (Number(form.npcflag || 0) === 0) next.npcflag = 'Npcflag should not be empty';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const ensureTrainerId = async () => {
    if (trainer.trainerId) return Number(trainer.trainerId);
    const res = await findNextId({ table: 'trainer', idColumn: 'Id', startId: 4000000 });
    if (!res.success) throw new Error(res.error || 'Unable to allocate trainer id');
    return Number(res.nextId);
  };

  const loadCurrent = async () => { if (selected?.entry) await loadNpc(selected.entry); };

  const saveWorkflow = async () => {
    if (!validate()) return;
    setSaving(true);
    setMsg(null);
    try {
      const updateFields = ['name', 'subname', 'faction', 'gossip_menu_id', 'npcflag'];
      const sets = updateFields.map(k => `\`${k}\` = ?`).join(', ');
      const values = updateFields.map(k => form[k]);
      const tplRes = await query(`UPDATE creature_template SET ${sets} WHERE entry = ?`, [...values, form.entry]);
      if (!tplRes.success) throw new Error(tplRes.error);

      const trainerId = await ensureTrainerId();
      const trainerRes = await query('INSERT INTO trainer (Id, Type, Requirement, Greeting, VerifiedBuild) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE Type = VALUES(Type), Requirement = VALUES(Requirement), Greeting = VALUES(Greeting)', [trainerId, 2, 0, trainer.greeting || '']);
      if (!trainerRes.success) throw new Error(trainerRes.error);
      const linkRes = await query('INSERT INTO creature_default_trainer (CreatureId, TrainerId) VALUES (?, ?) ON DUPLICATE KEY UPDATE TrainerId = VALUES(TrainerId)', [form.entry, trainerId]);
      if (!linkRes.success) throw new Error(linkRes.error);
      setTrainer(prev => ({ ...prev, trainerId, type: 2, requirement: 0 }));

      if (model.creatureDisplayId) {
        await query('DELETE FROM creature_template_model WHERE CreatureID = ?', [form.entry]);
        await query('INSERT INTO creature_template_model (CreatureID, Idx, CreatureDisplayID, DisplayScale, Probability, VerifiedBuild) VALUES (?,?,?,?,?,?)', [form.entry, 0, Number(model.creatureDisplayId), Number(model.displayScale) || 1, Number(model.probability) || 1, Number(model.verifiedBuild) || 0]);
      } else {
        await query('DELETE FROM creature_template_model WHERE CreatureID = ?', [form.entry]);
      }

      setDirty(false);
      await loadCurrent();
      if (soapConfig.user) {
        await soapCommand('.reload creature_template');
        setMsg({ type: 'success', text: `Saved entry ${form.entry} and reloaded creature_template` });
      } else {
        setMsg({ type: 'success', text: `Saved entry ${form.entry}` });
      }
      searchProfessionNpc(search, professionFilter);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setSaving(false);
  };

  const resetForm = () => { if (selected) loadNpc(selected.entry); };
  const openCreatureEditor = () => { navigate(selected?.entry ? `/creatures?entry=${selected.entry}` : '/creatures'); };
  const openTrainerSpells = () => { navigate(trainer.trainerId ? `/trainer-spells?trainerId=${trainer.trainerId}` : '/trainer-spells'); };
  const openNpcWorkflow = () => { navigate(selected?.entry ? `/npc-workflow?entry=${selected.entry}` : '/npc-workflow'); };

  const createProfessionNpc = async () => {
    setCreating(true);
    setMsg(null);
    try {
      const preset = presetById(createPreset);
      const res = await findNextId({ table: 'creature_template', idColumn: 'entry', startId: idRanges.creature || 4000000 });
      if (!res.success) throw new Error(res.error || 'Unable to allocate creature entry');
      const entry = Number(res.nextId);
      const name = (createName || preset.label || 'New Profession NPC').trim();
      const trainerId = await ensureTrainerId();
      const insert = await query('INSERT INTO creature_template (entry, name, subname, minlevel, maxlevel, faction, npcflag, scale, speed_walk, speed_run, unit_class, rank, type, AIName, MovementType, RegenHealth, ScriptName) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [entry, name, preset.subname, 1, 1, 12, preset.npcflag, 1, 1, 1.14286, 1, 0, 7, '', 0, 1, '']);
      if (!insert.success) throw new Error(insert.error);
      await query('INSERT INTO trainer (Id, Type, Requirement, Greeting, VerifiedBuild) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE Type = VALUES(Type), Requirement = VALUES(Requirement), Greeting = VALUES(Greeting)', [trainerId, 2, 0, preset.greeting]);
      await query('INSERT INTO creature_default_trainer (CreatureId, TrainerId) VALUES (?, ?) ON DUPLICATE KEY UPDATE TrainerId = VALUES(TrainerId)', [entry, trainerId]);
      await searchProfessionNpc(search, professionFilter);
      await loadNpc(entry);
      if (soapConfig.user) await soapCommand('.reload creature_template');
      setCreateName('New Profession NPC');
      setMsg({ type: 'success', text: `Created profession NPC entry ${entry}` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setCreating(false);
  };

  const cloneVariant = async () => {
    if (!selected) return;
    setCreating(true);
    setMsg(null);
    try {
      const res = await findNextId({ table: 'creature_template', idColumn: 'entry', startId: idRanges.creature || 4000000 });
      if (!res.success) throw new Error(res.error || 'Unable to allocate creature entry');
      const entry = Number(res.nextId);
      const trainerId = await ensureTrainerId();
      const insert = await query('INSERT INTO creature_template (entry, name, subname, minlevel, maxlevel, faction, npcflag, gossip_menu_id, scale, speed_walk, speed_run, unit_class, rank, type, AIName, MovementType, RegenHealth, ScriptName) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [entry, buildVariantName(form.name || selected.name), form.subname || presetById(presetId).subname, selected.minlevel ?? 1, selected.maxlevel ?? 1, Number(form.faction) || 12, Number(form.npcflag) || 83, Number(form.gossip_menu_id) || 0, selected.scale ?? 1, selected.speed_walk ?? 1, selected.speed_run ?? 1.14286, selected.unit_class ?? 1, selected.rank ?? 0, selected.type ?? 7, selected.AIName ?? '', selected.MovementType ?? 0, selected.RegenHealth ?? 1, selected.ScriptName ?? '']);
      if (!insert.success) throw new Error(insert.error);
      await query('INSERT INTO trainer (Id, Type, Requirement, Greeting, VerifiedBuild) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE Type = VALUES(Type), Requirement = VALUES(Requirement), Greeting = VALUES(Greeting)', [trainerId, 2, 0, trainer.greeting || presetById(presetId).greeting]);
      await query('INSERT INTO creature_default_trainer (CreatureId, TrainerId) VALUES (?, ?) ON DUPLICATE KEY UPDATE TrainerId = VALUES(TrainerId)', [entry, trainerId]);
      if (model.creatureDisplayId) await query('INSERT INTO creature_template_model (CreatureID, Idx, CreatureDisplayID, DisplayScale, Probability, VerifiedBuild) VALUES (?,?,?,?,?,?)', [entry, 0, Number(model.creatureDisplayId), Number(model.displayScale) || 1, Number(model.probability) || 1, Number(model.verifiedBuild) || 0]);
      await searchProfessionNpc(search, professionFilter);
      await loadNpc(entry);
      if (soapConfig.user) await soapCommand('.reload creature_template');
      setMsg({ type: 'success', text: `Cloned ${selected.entry} to ${entry}` });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setCreating(false);
  };

  return (
    <>
      {unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
      <div className="editor-page-header">
        <h2 className="editor-page-title">Profession Editor</h2>
        <p className="editor-page-subtitle">A guided profession workflow for fast NPC setup, relation inspection, and clone-based authoring.</p>
      </div>
      <div className="editor-layout prof-layout">
        <div className="editor-list">
          <div className="editor-list-header">
            <div className="search-box">
              <Search size={13} />
              <input ref={searchRef} placeholder="Search profession trainers by name or entry" value={search} onChange={e => { const next = e.target.value; setSearch(next); searchProfessionNpc(next, professionFilter); }} />
            </div>
            <div className="prof-filter-card">
              <label>Profession filter</label>
              <select value={professionFilter} onChange={e => { const next = e.target.value; setProfessionFilter(next); searchProfessionNpc(search, next); }}>
                {PROFESSION_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <small>Use this to show only Blacksmithing, Inscription, or custom profession trainers.</small>
            </div>
            <div className="prof-create-card">
              <label>New profession preset</label>
              <select value={createPreset} onChange={e => setCreatePreset(e.target.value)}>
                {PROFESSION_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
              <input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="New profession NPC name" />
              <button type="button" className="btn-primary" onClick={createProfessionNpc} disabled={creating}><Plus size={13} /> {creating ? 'Creating...' : 'Create NPC'}</button>
            </div>
            <div className="prof-search-status">
              <span>{searchStatusText}</span>
              <strong>{filteredCount} result{filteredCount === 1 ? '' : 's'}</strong>
              {hasSearchFilter && (
                <button type="button" className="prof-search-clear" onClick={() => { setSearch(''); setProfessionFilter('all'); searchProfessionNpc('', 'all'); }}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="list-items">
            {loading && <div className="loading-text">Searching...</div>}
            {!loading && entries.map(row => {
              const summarySkill = row.skillLines ? String(row.skillLines).split(',')[0] : '';
              return (
                <button key={row.entry} type="button" className={`list-item prof-list-item ${selected?.entry === row.entry ? 'active' : ''}`} onClick={() => loadNpc(row.entry)}>
                  <div className="list-item-main"><span className="list-item-name">{row.name}</span><Search size={12} className="list-item-arrow" /></div>
                  <div className="list-item-meta"><span className="mono">#{row.entry}</span><span>{skillLineLabel(summarySkill)}</span><span>{formatCount(row.spellCount)} spells</span></div>
                </button>
              );
            })}
            {!loading && entries.length === 0 && <div className="loading-text">No results</div>}
          </div>
        </div>
        <div className="editor-form prof-form">
          {!selected ? (
            <div className="editor-empty"><MousePointerClick /><p>Select a profession NPC to inspect or create one from a preset.</p></div>
          ) : (
            <>
              <div className="page-header prof-header">
                <div>
                  <div className="prof-kicker">Profession workflow</div>
                  <h1 className="page-title">{form.name || selected.name}</h1>
                  <p className="page-sub">Entry #{form.entry} � creature_template + trainer + trainer_spell</p>
                </div>
                <div className="header-actions prof-actions">
                  <button type="button" className="btn-ghost" onClick={openNpcWorkflow}><GitBranch size={13} /> NPC Workflow</button>
                  <button type="button" className="btn-ghost" onClick={openTrainerSpells}><BookOpen size={13} /> Trainer Spells</button>
                  <button type="button" className="btn-ghost" onClick={openCreatureEditor}><Hammer size={13} /> Creature Editor</button>
                  <button type="button" className="btn-ghost" onClick={cloneVariant} disabled={creating}><Copy size={13} /> {creating ? 'Cloning...' : 'Clone Variant'}</button>
                  <button type="button" className="btn-ghost" onClick={resetForm}><RotateCcw size={13} /> Reset</button>
                  <button type="button" className="btn-primary" onClick={saveWorkflow} disabled={saving}><Save size={13} /> {saving ? 'Saving...' : 'Save Workflow'}</button>
                </div>
              </div>
              {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}
              <div className="prof-summary-grid">
                <div className="prof-summary-card"><span className="prof-summary-label">Selected NPC</span><strong>#{form.entry}</strong><small>{form.subname || 'No subname'}</small></div>
                <div className="prof-summary-card"><span className="prof-summary-label">Detected profession</span><strong>{activePreset.label}</strong><small>{skillLineLabel(activePreset.skillLine)}</small></div>
                <div className="prof-summary-card"><span className="prof-summary-label">Trainer link</span><strong>{trainer.trainerId || 'New'}</strong><small>{trainer.type === 2 ? 'Profession trainer' : 'Trainer type mismatch'}</small></div>
                <div className="prof-summary-card"><span className="prof-summary-label">Skill-line gate</span><strong>{skillLineSummary ? skillLineLabel(skillLineSummary.skillLine) : 'None yet'}</strong><small>{skillLineCount} gate{skillLineCount === 1 ? '' : 's'}</small></div>
                <div className="prof-summary-card"><span className="prof-summary-label">Recipe count</span><strong>{formatCount(trainerSpellCount)}</strong><small>trainer_spell rows</small></div>
              </div>
              <div className="prof-workflow-grid">
                <div className="field-section prof-section">
                  <div className="field-section-title">Profession blueprint</div>
                  <p className="field-hint">The page auto-detects the profession from trainer_spell. Use the cards below only if you want to override that detected profile.</p>
                  <div className="prof-detected-banner">
                    <span className="prof-detected-label">Current profession</span>
                    <strong>{activePreset.label}</strong>
                    <small>{skillLineLabel(activePreset.skillLine)}</small>
                  </div>
                  <div className="prof-preset-rail">
                    {PROFESSION_PRESETS.map(preset => <button key={preset.id} type="button" className={`prof-preset${presetId === preset.id ? ' active' : ''}${preset.id === 'custom' ? ' prof-preset--custom' : ''}`} style={{ '--preset-color': preset.color }} onClick={() => applyPreset(preset.id)}><span>{preset.label}</span><small>{skillLineLabel(preset.skillLine)}</small></button>)}
                  </div>
                  <div className="prof-quick-links">
                    <button type="button" className="btn-ghost" onClick={openNpcWorkflow}><GitBranch size={13} /> Inspect creature links</button>
                    <button type="button" className="btn-ghost" onClick={openTrainerSpells}><BookOpen size={13} /> Edit recipes / trainer spells</button>
                    <button type="button" className="btn-ghost" onClick={openCreatureEditor}><Hammer size={13} /> Open creature template</button>
                  </div>
                  <div className="prof-two-col">
                    <div className="field-group"><label>Name</label><input type="text" value={form.name} onChange={e => setField('name', e.target.value)} />{errors.name && <span className="field-error">{errors.name}</span>}</div>
                    <div className="field-group"><label>Subname</label><input type="text" value={form.subname} onChange={e => setField('subname', e.target.value)} /></div>
                  </div>
                  <div className="prof-two-col">
                    <div className="field-group"><label>Faction</label><input type="number" value={form.faction} onChange={e => setField('faction', Number(e.target.value) || 0)} /></div>
                    <div className="field-group"><label>Gossip Menu ID</label><input type="number" value={form.gossip_menu_id} onChange={e => setField('gossip_menu_id', Number(e.target.value) || 0)} /></div>
                  </div>
                  <div className="prof-two-col">
                    <div className="field-group"><label>Creature entry</label><input type="number" value={form.entry} readOnly /></div>
                    <div className="field-group"><label>Suggested skill line</label><input type="text" value={skillLineSummary ? skillLineLabel(skillLineSummary.skillLine) : skillLineLabel(activePreset.skillLine)} readOnly /></div>
                  </div>
                </div>
                <div className="field-section prof-section">
                  <div className="field-section-title">Visual anchor</div>
                  <p className="field-hint">The profession workflow stays visual, so the creature model remains visible while you edit the trainer setup.</p>
                  <CreatureModelPreview displayId={model.creatureDisplayId} displayScale={model.displayScale} active={!!model.creatureDisplayId} />
                  <div className="prof-two-col">
                    <div className="field-group"><label>Creature Display ID</label><input type="number" value={model.creatureDisplayId} onChange={e => { setModel(prev => ({ ...prev, creatureDisplayId: e.target.value })); markDirty(); }} /></div>
                    <div className="field-group"><label>Display Scale</label><input type="number" step="0.01" value={model.displayScale} onChange={e => { setModel(prev => ({ ...prev, displayScale: Number(e.target.value) || 1 })); markDirty(); }} /></div>
                  </div>
                  <div className="prof-two-col">
                    <div className="field-group"><label>Probability</label><input type="number" step="0.01" value={model.probability} onChange={e => { setModel(prev => ({ ...prev, probability: Number(e.target.value) || 1 })); markDirty(); }} /></div>
                    <div className="field-group"><label>Verified Build</label><input type="number" value={model.verifiedBuild} onChange={e => { setModel(prev => ({ ...prev, verifiedBuild: Number(e.target.value) || 0 })); markDirty(); }} /></div>
                  </div>
                </div>
                <div className="field-section prof-section">
                  <div className="field-section-title">Relation inspection</div>
                  <div className="prof-relation-grid">
                    <div className="prof-relation-card"><span>Trainer row</span><strong>{trainer.trainerId || 'New'}</strong><small>Type {trainer.type} � Req {trainer.requirement}</small></div>
                    <div className="prof-relation-card"><span>Trainer spells</span><strong>{formatCount(trainerSpellCount)}</strong><small>Linked through trainer_spell</small></div>
                    <div className="prof-relation-card"><span>Legacy rows</span><strong>{formatCount(legacy.total)}</strong><small>{legacy.templateRefs > 0 ? `${legacy.templateRefs} template refs` : `${legacy.directRows} direct rows`}</small></div>
                    <div className="prof-relation-card"><span>Distinct gates</span><strong>{skillLineCount}</strong><small>{skillLineSummary ? `${skillLineSummary.minLevel}-${skillLineSummary.maxLevel} req level` : 'No skill gates yet'}</small></div>
                  </div>
                  <div className="npcwf-warning-box prof-warning-box">
                    <div className="npcwf-warning-head"><AlertTriangle size={14} /><strong>Workflow warnings</strong></div>
                    {warnings.length > 0 ? <div className="npcwf-warning-list">{warnings.map((warning, idx) => <div key={`${warning.text}-${idx}`} className={`npcwf-warning-item ${warning.tone}`}><span>{warning.tone === 'warn' ? 'Warning' : 'Info'}</span><p>{warning.text}</p></div>)}</div> : <p className="npcwf-warning-empty">No obvious inconsistencies detected. The profession NPC is ready for save or clone.</p>}
                  </div>
                  <div className="prof-future-grid">
                    <div className="prof-future-card"><strong>Recipe authoring</strong><p>Future phase: recipe groups, reagent previews, and spell-family filters without mixing them into class trainer flow.</p></div>
                    <div className="prof-future-card"><strong>Variant support</strong><p>Use clone to branch a faction or zone variant while keeping the linked trainer shape intact.</p></div>
                    <div className="prof-future-card"><strong>Legacy special cases</strong><p>Only known legacy `npc_trainer` templates should be treated as exceptions, mainly for paladin content.</p></div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}





