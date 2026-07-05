import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Copy, GitBranch, MousePointerClick, Plus, RotateCcw, Save, Search, Sparkles } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import CreatureModelPreview from '../components/creature/CreatureModelPreview';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import '../pages/DashboardPage.css';
import './EditorPage.css';
import './NPCWorkflowPage.css';

const CLASS_OPTIONS = [
  { value: 1, label: 'Warrior' },
  { value: 2, label: 'Paladin' },
  { value: 3, label: 'Hunter' },
  { value: 4, label: 'Rogue' },
  { value: 5, label: 'Priest' },
  { value: 6, label: 'Death Knight' },
  { value: 7, label: 'Shaman' },
  { value: 8, label: 'Mage' },
  { value: 9, label: 'Warlock' },
  { value: 11, label: 'Druid' },
];

const FLAG_BITS = [
  { bit: 1, label: 'Gossip' },
  { bit: 2, label: 'Quest Giver' },
  { bit: 16, label: 'Trainer' },
  { bit: 32, label: 'Class Trainer' },
  { bit: 64, label: 'Profession Trainer' },
  { bit: 128, label: 'Vendor' },
  { bit: 256, label: 'Vendor Ammo' },
  { bit: 512, label: 'Vendor Food' },
  { bit: 1024, label: 'Vendor Poison' },
  { bit: 2048, label: 'Vendor Reagent' },
  { bit: 4096, label: 'Repairer' },
  { bit: 8192, label: 'Flight Master' },
  { bit: 16384, label: 'Spirit Healer' },
  { bit: 32768, label: 'Spirit Guide' },
  { bit: 65536, label: 'Innkeeper' },
  { bit: 131072, label: 'Banker' },
  { bit: 262144, label: 'Petitioner' },
  { bit: 524288, label: 'Tabard Designer' },
  { bit: 1048576, label: 'Battlemaster' },
  { bit: 2097152, label: 'Auctioneer' },
  { bit: 4194304, label: 'Stable Master' },
  { bit: 8388608, label: 'Guild Banker' },
  { bit: 16777216, label: 'Spellclick' },
  { bit: 67108864, label: 'Mailbox' },
];

const ROLE_PRESETS = [
  { id: 'generic', label: 'Generic NPC', npcflag: 0, trainerEnabled: false },
  { id: 'class-trainer', label: 'Class Trainer', npcflag: 51, trainerEnabled: true, trainerType: 0, requirement: 2, greeting: 'Hello, ready for training?' },
  { id: 'profession-trainer', label: 'Profession Trainer', npcflag: 83, trainerEnabled: true, trainerType: 2, requirement: 0, greeting: 'Greetings! Ready to learn a trade?' },
  { id: 'vendor', label: 'Vendor', npcflag: 131, trainerEnabled: false },
];

const EMPTY_FORM = () => ({
  entry: '',
  name: '',
  subname: '',
  faction: 0,
  gossip_menu_id: 0,
  npcflag: 0,
});

const EMPTY_TRAINER = () => ({
  trainerId: '',
  type: 0,
  requirement: 0,
  greeting: '',
});

const EMPTY_MODEL = () => ({
  creatureDisplayId: '',
  displayScale: 1,
  probability: 1,
  verifiedBuild: 0,
});

function normalizeModelRow(row) {
  if (!row) return EMPTY_MODEL();
  return {
    creatureDisplayId: row.CreatureDisplayID ? String(row.CreatureDisplayID) : '',
    displayScale: row.DisplayScale ?? 1,
    probability: row.Probability ?? 1,
    verifiedBuild: row.VerifiedBuild ?? 0,
  };
}

function hasFlag(value, bit) {
  return (Number(value) & bit) !== 0;
}

function setFlag(value, bit, on) {
  const next = Number(value) || 0;
  return on ? (next | bit) : (next & ~bit);
}

function flagsToSet(value) {
  const n = Number(value) || 0;
  return new Set(FLAG_BITS.filter(f => hasFlag(n, f.bit)).map(f => f.bit));
}

function presetById(id) {
  return ROLE_PRESETS.find(p => p.id === id) || ROLE_PRESETS[0];
}

function deriveRole(npcflag, trainerRow) {
  const n = Number(npcflag) || 0;
  if (hasFlag(n, 64) || trainerRow?.Type === 2) return 'profession-trainer';
  if (hasFlag(n, 32) || trainerRow?.Type === 0 || trainerRow?.Type === 1) return 'class-trainer';
  if (hasFlag(n, 128)) return 'vendor';
  return 'generic';
}

function formatCount(n) {
  return Number(n || 0).toLocaleString();
}
function buildVariantName(name) {
  const base = (name || 'New NPC').trim();
  if (!base) return 'New NPC Variant';
  if (/variant$/i.test(base)) return `${base} 2`;
  return `${base} Variant`;
}

export default function NPCWorkflowPage() {
  const { query, findNextId, soapConfig, soapCommand, idRanges } = useConnection();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [createRole, setCreateRole] = useState('class-trainer');
  const [createName, setCreateName] = useState('New NPC');
  const [creating, setCreating] = useState(false);
  const [creatures, setCreatures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM());
  const [role, setRole] = useState('generic');
  const [trainerEnabled, setTrainerEnabled] = useState(false);
  const [trainer, setTrainer] = useState(EMPTY_TRAINER());
  const [trainerSpellCount, setTrainerSpellCount] = useState(0);
  const [legacyCount, setLegacyCount] = useState(0);
  const [model, setModel] = useState(EMPTY_MODEL());
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState({});
  const workflowWarnings = useMemo(() => {
    const warnings = [];
    const flagValue = Number(form.npcflag) || 0;
    const trainerType = Number(trainer.type) || 0;
    const trainerRequirement = Number(trainer.requirement) || 0;

    if (trainerEnabled && !hasFlag(flagValue, 16)) {
      warnings.push({ tone: 'warn', text: 'Trainer link is enabled, but npcflag 16 (Trainer) is missing.' });
    }

    if (role === 'class-trainer' && !hasFlag(flagValue, 32)) {
      warnings.push({ tone: 'warn', text: 'Class trainer preset usually needs npcflag 32 (Class Trainer).' });
    }

    if (role === 'profession-trainer' && !hasFlag(flagValue, 64)) {
      warnings.push({ tone: 'warn', text: 'Profession trainer preset usually needs npcflag 64 (Profession Trainer).' });
    }

    if (trainerEnabled && role === 'vendor') {
      warnings.push({ tone: 'warn', text: 'Vendor preset is active, but trainer linking is still enabled.' });
    }

    if (trainerEnabled && trainerType === 0 && !trainerRequirement) {
      warnings.push({ tone: 'error', text: 'Class trainers need a class requirement before saving.' });
    }

    if (trainerEnabled && trainerType === 2) {
      warnings.push({ tone: 'info', text: 'Profession editing lives in the separate Profession Editor tab. Use it for recipes, reagent gates, and profession-specific variants.' });
    }

    if (legacyCount > 0) {
      warnings.push({ tone: 'info', text: `Legacy npc_trainer rows detected (${formatCount(legacyCount)}). Treat this NPC as a special-case legacy mapping.` });
    }

    return warnings;
  }, [form.npcflag, legacyCount, role, trainer.requirement, trainer.type, trainerEnabled]);

  const searchRef = useRef(null);
  const unsavedGuard = useUnsavedGuard(dirty);

  const rolePreset = useMemo(() => presetById(role), [role]);
  const selectedFlags = useMemo(() => flagsToSet(form.npcflag), [form.npcflag]);

  const markDirty = useCallback(() => setDirty(true), []);

  const searchCreatures = useCallback(async (term) => {
    setLoading(true);
    const isNum = /^\d+$/.test(term);
    const sql = !term
      ? 'SELECT entry, `name`, subname, npcflag, faction FROM creature_template ORDER BY entry DESC LIMIT 50'
      : isNum
        ? 'SELECT entry, `name`, subname, npcflag, faction FROM creature_template WHERE entry = ? LIMIT 50'
        : 'SELECT entry, `name`, subname, npcflag, faction FROM creature_template WHERE `name` LIKE ? ORDER BY entry DESC LIMIT 50';
    const params = !term ? [] : [isNum ? Number(term) : `%${term}%`];
    const res = await query(sql, params);
    setCreatures(res.data || []);
    setLoading(false);
  }, [query]);

  const loadCreature = useCallback(async (entry) => {
    const [tplRes, linkRes, spellCountRes, legacyRes, modelRes] = await Promise.all([
      query('SELECT * FROM creature_template WHERE entry = ?', [entry]),
      query(
        'SELECT cdt.TrainerId, t.Type, t.Requirement, t.Greeting FROM creature_default_trainer cdt JOIN trainer t ON t.Id = cdt.TrainerId WHERE cdt.CreatureId = ? LIMIT 1',
        [entry]
      ),
      query(
        'SELECT COUNT(*) AS c FROM trainer_spell WHERE TrainerId = (SELECT TrainerId FROM creature_default_trainer WHERE CreatureId = ? LIMIT 1)',
        [entry]
      ),
      query('SELECT COUNT(*) AS c FROM npc_trainer WHERE ID = ?', [entry]),
      query('SELECT Idx, CreatureDisplayID, DisplayScale, Probability, VerifiedBuild FROM creature_template_model WHERE CreatureID = ? ORDER BY Idx LIMIT 1', [entry]),
    ]);

    const row = tplRes.data?.[0];
    if (!row) return;
    const trainerRow = linkRes.data?.[0] || null;
    setSelected(row);
    setForm({
      entry: row.entry,
      name: row.name || '',
      subname: row.subname || '',
      faction: row.faction ?? 0,
      gossip_menu_id: row.gossip_menu_id ?? 0,
      npcflag: row.npcflag ?? 0,
    });
    const nextRole = deriveRole(row.npcflag, trainerRow);
    const preset = presetById(nextRole);
    setRole(nextRole);
    setTrainerEnabled(preset.trainerEnabled || !!trainerRow);
    setTrainer({
      trainerId: trainerRow?.TrainerId ?? '',
      type: trainerRow?.Type ?? preset.trainerType ?? 0,
      requirement: trainerRow?.Requirement ?? preset.requirement ?? 0,
      greeting: trainerRow?.Greeting ?? preset.greeting ?? '',
    });
    setTrainerSpellCount(Number(spellCountRes.data?.[0]?.c || 0));
    setLegacyCount(Number(legacyRes.data?.[0]?.c || 0));
    setModel(normalizeModelRow(modelRes.data?.[0]));
    setDirty(false);
    setMsg(null);
    setErrors({});
  }, [query]);

  useEffect(() => { searchCreatures(''); }, [searchCreatures]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const entry = Number(searchParams.get('entry')) || 0;
    if (!entry) return;
    loadCreature(entry);
  }, [location.search, loadCreature, searchParams]);

  const applyPreset = useCallback((nextRole) => {
    const preset = presetById(nextRole);
    setRole(nextRole);
    setTrainerEnabled(preset.trainerEnabled);
    setForm(prev => ({ ...prev, npcflag: preset.npcflag }));
    if (preset.trainerEnabled) {
      setTrainer(prev => ({
        ...prev,
        type: preset.trainerType ?? prev.type,
        requirement: preset.requirement ?? prev.requirement,
        greeting: preset.greeting ?? prev.greeting,
      }));
    } else {
      setTrainer(prev => ({ ...prev, type: 0, requirement: 0 }));
    }
    markDirty();
  }, [markDirty]);

  const handleChange = useCallback((key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    markDirty();
  }, [markDirty]);

  const toggleFlag = useCallback((bit, on) => {
    setForm(prev => ({ ...prev, npcflag: setFlag(prev.npcflag, bit, on) }));
    markDirty();
  }, [markDirty]);

  const updateTrainer = useCallback((key, value) => {
    setTrainer(prev => ({ ...prev, [key]: value }));
    markDirty();
  }, [markDirty]);

  const validate = () => {
    const next = {};
    if (!form.name?.trim()) next.name = 'Name is required';
    if (trainerEnabled && role === 'class-trainer' && !Number(trainer.requirement)) next.requirement = 'Pick a class requirement';
    if (trainerEnabled && !Number(trainer.type) && role === 'profession-trainer') next.type = 'Trainer type missing';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const ensureTrainerId = async () => {
    if (trainer.trainerId) return Number(trainer.trainerId);
    const res = await findNextId({ table: 'trainer', idColumn: 'Id', startId: 4000000 });
    if (!res.success) throw new Error(res.error || 'Unable to allocate trainer id');
    return Number(res.nextId);
  };

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

      if (trainerEnabled) {
        const trainerId = await ensureTrainerId();
        await query(
          'INSERT INTO trainer (Id, Type, Requirement, Greeting, VerifiedBuild) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE Type = VALUES(Type), Requirement = VALUES(Requirement), Greeting = VALUES(Greeting)',
          [trainerId, Number(trainer.type) || 0, Number(trainer.requirement) || 0, trainer.greeting || '']
        );
        await query(
          'INSERT INTO creature_default_trainer (CreatureId, TrainerId) VALUES (?, ?) ON DUPLICATE KEY UPDATE TrainerId = VALUES(TrainerId)',
          [form.entry, trainerId]
        );
        setTrainer(prev => ({ ...prev, trainerId }));
      } else {
        await query('DELETE FROM creature_default_trainer WHERE CreatureId = ?', [form.entry]);
      }

      if (model.creatureDisplayId) {
        await query('DELETE FROM creature_template_model WHERE CreatureID = ?', [form.entry]);
        await query(
          'INSERT INTO creature_template_model (CreatureID, Idx, CreatureDisplayID, DisplayScale, Probability, VerifiedBuild) VALUES (?,?,?,?,?,?)',
          [form.entry, 0, Number(model.creatureDisplayId), Number(model.displayScale) || 1, Number(model.probability) || 1, Number(model.verifiedBuild) || 0]
        );
      } else {
        await query('DELETE FROM creature_template_model WHERE CreatureID = ?', [form.entry]);
      }

      setSelected(prev => prev ? { ...prev, ...form } : prev);
      setDirty(false);
      await loadCreature(form.entry);
      if (soapConfig.user) {
        await soapCommand('.reload creature_template');
        setMsg({ type: 'success', text: `✓ Saved entry ${form.entry} and reloaded creature_template` });
      } else {
        setMsg({ type: 'success', text: `✓ Saved entry ${form.entry}` });
      }
      searchCreatures(search);
    } catch (err) {
      setMsg({ type: 'error', text: `✗ ${err.message}` });
    }
    setSaving(false);
  };

  const resetForm = () => {
    if (!selected) return;
    loadCreature(selected.entry);
  };

  const openCreatureEditor = () => {
    if (selected?.entry) navigate(`/creatures?entry=${selected.entry}`);
    else navigate('/creatures');
  };

  const createNewNpc = async () => {
    setCreating(true);
    setMsg(null);
    try {
      const res = await findNextId({ table: 'creature_template', idColumn: 'entry', startId: idRanges.creature || 4000000 });
      if (!res.success) throw new Error(res.error || 'Unable to allocate creature entry');
      const entry = Number(res.nextId);
      const preset = presetById(createRole);
      const name = (createName || preset.label || 'New NPC').trim();
      const npcflag = preset.npcflag;
      const faction = createRole === 'generic' ? 35 : 12;
      const trainerId = preset.trainerEnabled ? await ensureTrainerId() : null;
      const insert = await query(
        'INSERT INTO creature_template (entry, name, subname, minlevel, maxlevel, faction, npcflag, scale, speed_walk, speed_run, unit_class, rank, type, AIName, MovementType, RegenHealth, ScriptName) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [entry, name, preset.trainerEnabled ? preset.label : '', 1, 1, faction, npcflag, 1, 1, 1.14286, 1, 0, 7, '', 0, 1, '']
      );
      if (!insert.success) throw new Error(insert.error);
      if (trainerId) {
        await query(
          'INSERT INTO trainer (Id, Type, Requirement, Greeting, VerifiedBuild) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE Type = VALUES(Type), Requirement = VALUES(Requirement), Greeting = VALUES(Greeting)',
          [trainerId, Number(preset.trainerType) || 0, Number(preset.requirement) || 0, preset.greeting || '']
        );
        await query('INSERT INTO creature_default_trainer (CreatureId, TrainerId) VALUES (?, ?) ON DUPLICATE KEY UPDATE TrainerId = VALUES(TrainerId)', [entry, trainerId]);
      }
      await searchCreatures(search);
      await loadCreature(entry);
      setCreateName('New NPC');
      setMsg({ type: 'success', text: `✓ Created entry ${entry}` });
      if (soapConfig.user) await soapCommand('.reload creature_template');
    } catch (err) {
      setMsg({ type: 'error', text: `✗ ${err.message}` });
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
      const name = buildVariantName(form.name || selected.name);
      const trainerId = trainerEnabled ? (trainer.trainerId ? Number(trainer.trainerId) : await ensureTrainerId()) : null;

      const insert = await query(
        'INSERT INTO creature_template (entry, name, subname, minlevel, maxlevel, faction, npcflag, gossip_menu_id, scale, speed_walk, speed_run, unit_class, rank, type, AIName, MovementType, RegenHealth, ScriptName) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          entry,
          name,
          form.subname || '',
          selected.minlevel ?? 1,
          selected.maxlevel ?? 1,
          Number(form.faction) || 0,
          Number(form.npcflag) || 0,
          Number(form.gossip_menu_id) || 0,
          selected.scale ?? 1,
          selected.speed_walk ?? 1,
          selected.speed_run ?? 1.14286,
          selected.unit_class ?? 1,
          selected.rank ?? 0,
          selected.type ?? 7,
          selected.AIName ?? '',
          selected.MovementType ?? 0,
          selected.RegenHealth ?? 1,
          selected.ScriptName ?? '',
        ]
      );
      if (!insert.success) throw new Error(insert.error);

      if (trainerId) {
        await query(
          'INSERT INTO trainer (Id, Type, Requirement, Greeting, VerifiedBuild) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE Type = VALUES(Type), Requirement = VALUES(Requirement), Greeting = VALUES(Greeting)',
          [trainerId, Number(trainer.type) || 0, Number(trainer.requirement) || 0, trainer.greeting || '']
        );
        await query('INSERT INTO creature_default_trainer (CreatureId, TrainerId) VALUES (?, ?) ON DUPLICATE KEY UPDATE TrainerId = VALUES(TrainerId)', [entry, trainerId]);
      }

      if (model.creatureDisplayId) {
        await query('DELETE FROM creature_template_model WHERE CreatureID = ?', [entry]);
        await query(
          'INSERT INTO creature_template_model (CreatureID, Idx, CreatureDisplayID, DisplayScale, Probability, VerifiedBuild) VALUES (?,?,?,?,?,?)',
          [entry, 0, Number(model.creatureDisplayId), Number(model.displayScale) || 1, Number(model.probability) || 1, Number(model.verifiedBuild) || 0]
        );
      }

      await searchCreatures(search);
      await loadCreature(entry);
      setMsg({ type: 'success', text: `✓ Cloned entry ${selected.entry} to ${entry}` });
      if (soapConfig.user) await soapCommand('.reload creature_template');
    } catch (err) {
      setMsg({ type: 'error', text: `✗ ${err.message}` });
    }
    setCreating(false);
  };

  const classLabel = CLASS_OPTIONS.find(c => Number(c.value) === Number(trainer.requirement))?.label || 'None';

  return (
    <>
      {unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
      <div className="editor-page-header">
        <h2 className="editor-page-title">NPC Workflow</h2>
        <p className="editor-page-subtitle">Assemble creature templates, trainer links, and role presets in one guided flow</p>
      </div>

      <div className="editor-layout npcwf-layout">
        <div className="editor-list">
          <div className="editor-list-header">
            <div className="search-box">
              <Search size={13} />
              <input
                ref={searchRef}
                placeholder="Search creature name or entry..."
                value={search}
                onChange={e => { setSearch(e.target.value); searchCreatures(e.target.value); }}
              />
            </div>
            <div className="npcwf-create-card">
              <label>New NPC role</label>
              <select value={createRole} onChange={e => setCreateRole(e.target.value)}>
                <option value="class-trainer">Class Trainer</option>
                <option value="profession-trainer">Profession Trainer</option>
                <option value="vendor">Vendor</option>
                <option value="generic">Generic NPC</option>
              </select>
              <input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="New NPC name" />
              <button type="button" className="btn-primary" onClick={createNewNpc} disabled={creating}>
                <Plus size={13} /> {creating ? 'Creating...' : 'Create NPC'}
              </button>
            </div>
          </div>
          <div className="list-items">
            {loading && <div className="loading-text">Searching...</div>}
            {!loading && creatures.map(c => (
              <div key={c.entry} className={`list-item ${selected?.entry === c.entry ? 'active' : ''}`} onClick={() => loadCreature(c.entry)}>
                <div className="list-item-main">
                  <span className="list-item-name">{c.name}</span>
                  <ChevronRight size={12} className="list-item-arrow" />
                </div>
                <div className="list-item-meta">
                  <span className="mono">#{c.entry}</span>
                  <span>{c.subname || 'No subname'}</span>
                </div>
              </div>
            ))}
            {!loading && creatures.length === 0 && <div className="loading-text">No results</div>}
          </div>
        </div>

        <div className="editor-form npcwf-form">
          {!selected ? (
            <div className="editor-empty">
              <MousePointerClick />
              <p>Select a creature to start a workflow</p>
            </div>
          ) : (
            <>
              <div className="page-header npcwf-header">
                <div>
                  <h1 className="page-title">{form.name || selected.name}</h1>
                  <p className="page-sub">Entry #{form.entry} · creature_template</p>
                </div>
                <div className="header-actions npcwf-actions">
                  <button type="button" className="btn-ghost" onClick={openCreatureEditor} title="Open the creature editor">
                    <GitBranch size={13} /> Creature Editor
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => navigate(trainerEnabled && trainer.trainerId ? `/trainer-spells?trainerId=${trainer.trainerId}` : '/trainer-spells')} title="Open trainer spell editor">
                    Trainers
                  </button>
                  <button type="button" className="btn-ghost" onClick={cloneVariant} disabled={creating} title="Clone this NPC into a new variant">
                    <Copy size={13} /> {creating ? 'Cloning...' : 'Clone Variant'}
                  </button>
                  <button type="button" className="btn-ghost" onClick={resetForm} title="Reset from database">
                    <RotateCcw size={13} /> Reset
                  </button>
                  <button type="button" className="btn-primary" onClick={saveWorkflow} disabled={saving} title="Save workflow">
                    <Save size={13} /> {saving ? 'Saving...' : 'Save Workflow'}
                  </button>
                </div>
              </div>

              {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}

              <div className="npcwf-summary-grid">
                <div className="npcwf-summary-card">
                  <span className="npcwf-summary-label">Role</span>
                  <strong>{rolePreset.label}</strong>
                </div>
                <div className="npcwf-summary-card">
                  <span className="npcwf-summary-label">NPC Flags</span>
                  <strong>{Number(form.npcflag) || 0}</strong>
                </div>
                <div className="npcwf-summary-card">
                  <span className="npcwf-summary-label">Trainer Link</span>
                  <strong>{trainerEnabled ? (trainer.trainerId || 'New') : 'Disabled'}</strong>
                </div>
                <div className="npcwf-summary-card">
                  <span className="npcwf-summary-label">Trainer Spells</span>
                  <strong>{formatCount(trainerSpellCount)}</strong>
                </div>
              </div>

              <div className="form-fields npcwf-fields">
                <div className="field-section">
                  <h3 className="field-section-title">Creature Template</h3>
                  <div className="npcwf-role-row">
                    {ROLE_PRESETS.map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`npcwf-preset${role === preset.id ? ' active' : ''}`}
                        onClick={() => applyPreset(preset.id)}
                      >
                        <Sparkles size={12} /> {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="field-group">
                    <label>Name</label>
                    <input type="text" value={form.name} onChange={e => handleChange('name', e.target.value)} />
                    {errors.name && <span className="field-error">{errors.name}</span>}
                  </div>
                  <div className="npcwf-two-col">
                    <div className="field-group">
                      <label>Subname</label>
                      <input type="text" value={form.subname} onChange={e => handleChange('subname', e.target.value)} />
                    </div>
                    <div className="field-group">
                      <label>Faction</label>
                      <input type="number" value={form.faction} onChange={e => handleChange('faction', Number(e.target.value) || 0)} />
                    </div>
                  </div>
                  <div className="npcwf-two-col">
                    <div className="field-group">
                      <label>Gossip Menu ID</label>
                      <input type="number" value={form.gossip_menu_id} onChange={e => handleChange('gossip_menu_id', Number(e.target.value) || 0)} />
                    </div>
                    <div className="field-group">
                      <label>Creature Entry</label>
                      <input type="number" value={form.entry} readOnly />
                    </div>
                  </div>
                </div>

                <div className="field-section">
                  <h3 className="field-section-title">Model Setup</h3>
                  <p className="field-hint">Use this for the trainer's display model. One row is enough for most NPCs.</p>
                  <div className="npcwf-two-col">
                    <div className="field-group">
                      <label>Creature Display ID</label>
                      <input type="number" value={model.creatureDisplayId} onChange={e => { setModel(prev => ({ ...prev, creatureDisplayId: e.target.value })); markDirty(); }} />
                    </div>
                    <div className="field-group">
                      <label>Display Scale</label>
                      <input type="number" step="0.01" value={model.displayScale} onChange={e => { setModel(prev => ({ ...prev, displayScale: Number(e.target.value) || 1 })); markDirty(); }} />
                    </div>
                  </div>
                  <div className="npcwf-two-col">
                    <div className="field-group">
                      <label>Probability</label>
                      <input type="number" step="0.01" value={model.probability} onChange={e => { setModel(prev => ({ ...prev, probability: Number(e.target.value) || 1 })); markDirty(); }} />
                    </div>
                    <div className="field-group">
                      <label>Verified Build</label>
                      <input type="number" value={model.verifiedBuild} onChange={e => { setModel(prev => ({ ...prev, verifiedBuild: Number(e.target.value) || 0 })); markDirty(); }} />
                    </div>
                  </div>
                </div>

                <div className="field-section">
                  <CreatureModelPreview
                    displayId={model.creatureDisplayId}
                    displayScale={model.displayScale}
                    active={!!model.creatureDisplayId}
                  />
                  <h3 className="field-section-title">NPC Flags</h3>
                  <p className="field-hint">The bitmask is combined under the hood. Presets prefill the common combinations.</p>
                  <div className="npcwf-flag-box">
                    <div className="npcwf-flag-toprow">
                      <strong>{Number(form.npcflag) || 0}</strong>
                      <span>{selectedFlags.size} bits active</span>
                    </div>
                    <div className="npcwf-flag-grid">
                      {FLAG_BITS.map(flag => {
                        const checked = selectedFlags.has(flag.bit);
                        return (
                          <label key={flag.bit} className={`npcwf-flag-item${checked ? ' active' : ''}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => toggleFlag(flag.bit, e.target.checked)}
                            />
                            <span>{flag.label}</span>
                            <small>{flag.bit}</small>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="field-section">
                  <h3 className="field-section-title">Trainer Setup</h3>
                  <label className="npcwf-switch">
                    <input
                      type="checkbox"
                      checked={trainerEnabled}
                      onChange={e => { setTrainerEnabled(e.target.checked); markDirty(); }}
                    />
                    <span>Enable trainer link</span>
                  </label>
                  {trainerEnabled && (
                    <>
                      <div className="npcwf-two-col">
                        <div className="field-group">
                          <label>Trainer ID</label>
                          <input
                            type="text"
                            value={trainer.trainerId}
                            onChange={e => updateTrainer('trainerId', e.target.value)}
                            placeholder="Leave empty to auto-allocate"
                          />
                        </div>
                        <div className="field-group">
                          <label>Trainer Type</label>
                          <select value={trainer.type} onChange={e => updateTrainer('type', Number(e.target.value) || 0)}>
                            <option value={0}>Class trainer</option>
                            <option value={2}>Profession trainer</option>
                          </select>
                        </div>
                      </div>
                      <div className="npcwf-two-col">
                        <div className="field-group">
                          <label>Requirement</label>
                          {Number(trainer.type) === 0 ? (
                            <select value={trainer.requirement} onChange={e => updateTrainer('requirement', Number(e.target.value) || 0)}>
                              <option value={0}>Select class</option>
                              {CLASS_OPTIONS.map(cls => <option key={cls.value} value={cls.value}>{cls.label}</option>)}
                            </select>
                          ) : (
                            <input type="number" value={trainer.requirement} readOnly />
                          )}
                          {errors.requirement && <span className="field-error">{errors.requirement}</span>}
                        </div>
                        <div className="field-group">
                          <label>Trainer Spell Count</label>
                          <input type="text" value={formatCount(trainerSpellCount)} readOnly />
                        </div>
                      </div>
                      <div className="field-group">
                        <label>Greeting</label>
                        <textarea value={trainer.greeting} onChange={e => updateTrainer('greeting', e.target.value)} rows={3} />
                      </div>
                      <div className="npcwf-note">
                        Linked creature_default_trainer + trainer row. Current class requirement: {classLabel}.
                      </div>
                      <div className="npcwf-note npcwf-plan-note">
                        Profession trainers use the separate Profession Editor tab for recipes, reagents, and skill-line gating.
                      </div>
                    </>
                  )}
                </div>

                <div className="field-section">
                  <h3 className="field-section-title">Checks</h3>
                  <div className="npcwf-check-grid">
                    <div className="npcwf-check-card">
                      <span>Legacy npc_trainer rows</span>
                      <strong>{formatCount(legacyCount)}</strong>
                    </div>
                    <div className="npcwf-check-card">
                      <span>Selected flags</span>
                      <strong>{selectedFlags.size}</strong>
                    </div>
                    <div className="npcwf-check-card">
                      <span>Trainer link</span>
                      <strong>{trainerEnabled ? 'Enabled' : 'Disabled'}</strong>
                    </div>
                    <div className="npcwf-check-card">
                      <span>Role preset</span>
                      <strong>{rolePreset.label}</strong>
                    </div>
                  </div>
                  <div className="npcwf-warning-box">
                    <div className="npcwf-warning-head">
                      <AlertTriangle size={14} />
                      <strong>Workflow warnings</strong>
                    </div>
                    {workflowWarnings.length > 0 ? (
                      <div className="npcwf-warning-list">
                        {workflowWarnings.map((warning, idx) => (
                          <div key={`${warning.text}-${idx}`} className={`npcwf-warning-item ${warning.tone}`}>
                            <span>{warning.tone === 'error' ? 'Error' : warning.tone === 'warn' ? 'Warning' : 'Info'}</span>
                            <p>{warning.text}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="npcwf-warning-empty">No obvious inconsistencies detected. This NPC is ready for saving or cloning.</p>
                    )}
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
