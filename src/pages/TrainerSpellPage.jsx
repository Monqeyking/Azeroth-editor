import { useState, useCallback, useEffect, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { useSearchParams } from 'react-router-dom';
import { Search, ChevronRight, ChevronDown, Trash2, Plus, Save, MousePointerClick } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';
import './TrainerSpellPage.css';
import TrainerSpellVisualPanel from './TrainerSpellVisualPanel';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';

export default function TrainerSpellPage() {
  const { searchSpellsDbc, readSpellFull, writeSpellFull, readSkillLineAbility, addSkillLineAbility, query } = useConnection();
  const [search, setSearch] = useState('');
  const [spellGroups, setSpellGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedName, setSelectedName] = useState(null);
  const [ranks, setRanks] = useState([]);
  const [trainersMap, setTrainersMap] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [rankFull, setRankFull] = useState({});   // full DBC record per rank ID
  const [rankEdits, setRankEdits] = useState({});
  const unsavedGuard = useUnsavedGuard(Object.keys(rankEdits).length > 0);
  const [trainerDraft, setTrainerDraft] = useState({ trainerId: '', moneyCost: '0', reqLevel: '0', search: '', skillLine: '' });
  const [trainerList, setTrainerList] = useState([]);   // alle trainer templates
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uiMode, setUiMode] = useState('visual');
  const searchRef = useRef(null);
  const [searchParams] = useSearchParams();
  const prefillRef = useRef(false);

  const searchSpells = useCallback(async (term) => {
    setLoading(true);
    const res = await searchSpellsDbc(term, { trainerSpells: true, limit: 200, excludeProcSpells: true });
    const rows = res.data || [];
    const map = new Map();
    for (const r of rows) {
      const name = r.Name_Lang_enUS;
      if (!map.has(name)) map.set(name, { Name_Lang_enUS: name, rankCount: 0 });
      map.get(name).rankCount++;
    }
    const groups = [...map.values()].sort((a, b) => a.Name_Lang_enUS.localeCompare(b.Name_Lang_enUS));
    setSpellGroups(groups.slice(0, 50));
    setLoading(false);
  }, [searchSpellsDbc]);

  useEffect(() => { searchSpells(''); }, []);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const CLASS_NAMES = { 1:'Warrior',2:'Paladin',3:'Hunter',4:'Rogue',5:'Priest',6:'Death Knight',7:'Shaman',8:'Mage',9:'Warlock',11:'Druid' };

  const SKILL_LINE_OPTIONS = {
    1:  [{ id: 26,  label: 'General' }, { id: 100, label: 'Arms' }, { id: 256, label: 'Fury' }, { id: 257, label: 'Protection' }],
    2:  [{ id: 594, label: 'General' }, { id: 317, label: 'Holy' }, { id: 267, label: 'Protection' }, { id: 184, label: 'Retribution' }],
    3:  [{ id: 50,  label: 'General' }, { id: 163, label: 'Beast Mastery' }, { id: 164, label: 'Marksmanship' }, { id: 165, label: 'Survival' }],
    4:  [{ id: 253, label: 'General' }, { id: 182, label: 'Assassination' }, { id: 181, label: 'Combat' }, { id: 183, label: 'Subtlety' }],
    5:  [{ id: 56,  label: 'General' }, { id: 78,  label: 'Discipline' }, { id: 613, label: 'Holy' }, { id: 236, label: 'Shadow' }],
    6:  [{ id: 770, label: 'General' }, { id: 398, label: 'Blood' }, { id: 399, label: 'Frost' }, { id: 400, label: 'Unholy' }],
    7:  [{ id: 261, label: 'General' }, { id: 373, label: 'Elemental' }, { id: 374, label: 'Enhancement' }, { id: 375, label: 'Restoration' }],
    8:  [{ id: 6,   label: 'General' }, { id: 237, label: 'Arcane' }, { id: 8,   label: 'Fire' }, { id: 454, label: 'Frost' }],
    9:  [{ id: 593, label: 'General' }, { id: 355, label: 'Affliction' }, { id: 354, label: 'Demonology' }, { id: 593, label: 'Destruction' }],
    11: [{ id: 574, label: 'General' }, { id: 134, label: 'Balance' }, { id: 134, label: 'Feral Combat' }, { id: 573, label: 'Restoration' }],
  };

  const TRAINER_LABELS = {
    1: 'Warrior Main', 2: 'Warrior Starter',
    3: 'Paladin Main', 6: 'Paladin Starter',
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

  useEffect(() => {
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
      const rows = (res.data || []).map(t => {
        const className = CLASS_NAMES[t.Requirement] || `Type${t.Requirement}`;
        const friendlyName = TRAINER_LABELS[t.TrainerId] || t.trainerNames || className;
        const label = `${friendlyName} (ID ${t.TrainerId})`;
        return { ...t, label, className };
      });
      setTrainerList(rows);
    });
  }, []);

  useEffect(() => {
    const trainerId = Number(searchParams.get('trainerId')) || 0;
    if (!trainerId || prefillRef.current || trainerList.length === 0) return;
    const preset = trainerList.find(t => Number(t.TrainerId) === trainerId);
    setTrainerDraft(d => ({
      ...d,
      trainerId: String(trainerId),
      search: preset?.label || preset?.trainerNames || String(trainerId),
    }));
    prefillRef.current = true;
    setMsg({ type: 'info', text: 'Prefilled trainer #' + trainerId + ' from NPC Workflow' });
  }, [searchParams, trainerList]);

  const loadTrainers = useCallback(async (spellId) => {
    const res = await query(
      `SELECT ts.TrainerId, ts.MoneyCost, ts.ReqLevel,
              GROUP_CONCAT(DISTINCT ct.name ORDER BY ct.name SEPARATOR ', ') AS trainerNames
       FROM trainer_spell ts
       JOIN creature_default_trainer cdt ON cdt.TrainerId = ts.TrainerId
       JOIN creature_template ct ON ct.entry = cdt.CreatureId
       WHERE ts.SpellId = ?
       GROUP BY ts.TrainerId, ts.MoneyCost, ts.ReqLevel`,
      [spellId]
    );
    return res.data || [];
  }, [query]);

  const selectName = useCallback(async (name) => {
    setSelectedName(name);
    setExpandedId(null);
    setRankEdits({});
    setRankFull({});
    setMsg(null);

    // Zoek alle kandidaat-ranks via DBC
    const res = await searchSpellsDbc(name, { trainerSpells: true, limit: 500, excludeProcSpells: true });
    const candidates = (res.data || []).filter(r => r.Name_Lang_enUS === name);

    if (!candidates.length) { setRanks([]); setRankFull({}); setTrainersMap({}); return; }

    // Welke IDs zitten al in trainer_spell?
    const ids = candidates.map(r => r.ID);
    const ntRes = await query(
      `SELECT DISTINCT SpellId FROM trainer_spell WHERE SpellId IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const inTrainer = new Set((ntRes.data || []).map(r => r.SpellId));

    // Splits in ranked (heeft "Rank X" subtext) en unranked
    const rankedByLabel = new Map();
    const unranked = [];
    for (const r of candidates) {
      if (r.NameSubtext_Lang_enUS?.startsWith('Rank')) {
        const label = r.NameSubtext_Lang_enUS;
        if (!rankedByLabel.has(label)) rankedByLabel.set(label, []);
        rankedByLabel.get(label).push(r);
      } else {
        unranked.push(r);
      }
    }

    const deduplicated = [];

    if (rankedByLabel.size > 0) {
      // Ranked spell (klassiek): dedupliceer per rank-label
      for (const group of rankedByLabel.values()) {
        const confirmed = group.filter(r => inTrainer.has(r.ID));
        deduplicated.push(...(confirmed.length ? confirmed : group));
      }
    } else {
      // WotLK single-rank spell: toon Ã©Ã©n entry
      const confirmed = unranked.filter(r => inTrainer.has(r.ID));
      if (confirmed.length > 0) {
        deduplicated.push(...confirmed);
      } else {
        // Voorkeur: WotLK main spell range (25000-65000), SpellLevel > 1
        // Valt terug op laagste ID met SpellLevel > 0
        const mainRange = unranked.filter(r => r.SpellLevel > 1 && r.ID >= 25000 && r.ID < 65000);
        const withLevel = unranked.filter(r => r.SpellLevel > 0);
        const pool = mainRange.length > 0 ? mainRange : withLevel.length > 0 ? withLevel : unranked;
        const best = [...pool].sort((a, b) => a.ID - b.ID)[0];
        if (best) deduplicated.push(best);
      }
    }

    // Lees volledig DBC-record per rank
    const fullMap = {};
    await Promise.all(deduplicated.map(async r => {
      const full = await readSpellFull(r.ID);
      if (full.data) fullMap[r.ID] = full.data;
    }));

    const rankRows = deduplicated
      .map(r => ({
        ID: r.ID,
        SpellLevel: fullMap[r.ID]?.SpellLevel ?? 0,
        EffectBasePoints_1: fullMap[r.ID]?.EffectBasePoints_1 ?? 0,
        rankLabel: r.NameSubtext_Lang_enUS,
        confirmed: inTrainer.has(r.ID),
      }))
      .sort((a, b) => a.SpellLevel - b.SpellLevel || a.ID - b.ID);

    setRanks(rankRows);
    setRankFull(fullMap);

    const tMap = {};
    await Promise.all(rankRows.map(async r => {
      tMap[r.ID] = await loadTrainers(r.ID);
    }));
    setTrainersMap(tMap);
  }, [searchSpellsDbc, readSpellFull, loadTrainers]);

  const toggleExpand = (id, spellLevel) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setTrainerDraft({ trainerId: '', moneyCost: '0', reqLevel: String(spellLevel || 0), search: '', skillLine: '' });
    }
  };

  const setEdit = (rankId, field, value) => {
    setRankEdits(e => ({ ...e, [rankId]: { ...e[rankId], [field]: value } }));
  };

  const saveRank = async (e, rankId) => {
    e.stopPropagation();
    const edits = rankEdits[rankId];
    if (!edits || !Object.keys(edits).length) return;
    const base = rankFull[rankId];
    if (!base) return;
    setSaving(true);
    setMsg(null);
    try {
      const updated = {
        ...base,
        ...(edits.basePoints !== undefined ? { EffectBasePoints_1: edits.basePoints } : {}),
        ...(edits.spellLevel !== undefined ? { SpellLevel: edits.spellLevel } : {}),
      };
      const r = await writeSpellFull(updated);
      if (!r.success) throw new Error(r.error);
      setRankFull(f => ({ ...f, [rankId]: updated }));
      setRanks(prev => prev.map(rank =>
        rank.ID === rankId
          ? { ...rank, SpellLevel: updated.SpellLevel, EffectBasePoints_1: updated.EffectBasePoints_1 }
          : rank
      ));
      setRankEdits(e => { const next = { ...e }; delete next[rankId]; return next; });
      setMsg({ type: 'success', text: `âœ“ Spell #${rankId} opgeslagen in Spell.dbc` });
    } catch (err) {
      setMsg({ type: 'error', text: `âœ— ${err.message}` });
    }
    setSaving(false);
  };

  const addTrainer = async (e, rankId) => {
    e.stopPropagation();
    const { trainerId, moneyCost, reqLevel, skillLine } = trainerDraft;
    if (!trainerId) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await query(
        `INSERT INTO trainer_spell (TrainerId, SpellId, MoneyCost, ReqSkillLine, ReqSkillRank, ReqAbility1, ReqAbility2, ReqAbility3, ReqLevel, VerifiedBuild)
         VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, 0)
         ON DUPLICATE KEY UPDATE MoneyCost = VALUES(MoneyCost), ReqLevel = VALUES(ReqLevel)`,
        [Number(trainerId), rankId, Number(moneyCost) || 0, Number(reqLevel) || 0]
      );
      if (!r.success) throw new Error(r.error);

      // Controleer of SLA-entry bestaat; zo niet, voeg toe (kopieer van bekende Paladin-entry structuur)
      const slaRead = await readSkillLineAbility(rankId);
      if (slaRead.success && slaRead.data.length === 0) {
        const trainer = trainerList.find(x => x.TrainerId === Number(trainerId));
        const classMask = trainer ? (1 << (trainer.Requirement - 1)) : 0;
        const refSla = await readSkillLineAbility(35395);
        const refMaxId = refSla.success && refSla.data.length > 0 ? refSla.data[0].ID : 21980;
        const newId = refMaxId + rankId;
        const classOptions = SKILL_LINE_OPTIONS[trainer?.Requirement] || [];
        const resolvedSkillLine = skillLine
          ? Number(skillLine)
          : classOptions.length > 0 ? classOptions[0].id
          : (refSla.success && refSla.data.length > 0 ? refSla.data[0].SkillLine : 184);
        const slaResult = await addSkillLineAbility({
          ID: newId,
          SkillLine: resolvedSkillLine,
          Spell: rankId,
          RaceMask: 0,
          ClassMask: classMask,
          MinSkillLineRank: 0,
          SupercededBySpell: 0,
          AcquireMethod: 1,
        });
        if (!slaResult.success) {
          console.warn('SkillLineAbility.dbc: kon geen entry toevoegen voor spell', rankId, slaResult.error);
        }
      }
      const newTrainers = await loadTrainers(rankId);
      setTrainersMap(m => ({ ...m, [rankId]: newTrainers }));
      setTrainerDraft({ trainerId: '', moneyCost: '0', reqLevel: '0', search: '' });
      setMsg({ type: 'success', text: `âœ“ Trainer ${trainerId} toegevoegd aan spell #${rankId}` });
    } catch (err) {
      setMsg({ type: 'error', text: `âœ— ${err.message}` });
    }
    setSaving(false);
  };

  const removeTrainer = async (e, rankId, trainerId) => {
    e.stopPropagation();
    setSaving(true);
    try {
      const r = await query(
        `DELETE FROM trainer_spell WHERE TrainerId = ? AND SpellId = ?`,
        [trainerId, rankId]
      );
      if (!r.success) throw new Error(r.error);
      const newTrainers = await loadTrainers(rankId);
      setTrainersMap(m => ({ ...m, [rankId]: newTrainers }));
    } catch (err) {
      setMsg({ type: 'error', text: `âœ— ${err.message}` });
    }
    setSaving(false);
  };

  return (
    <>
      {unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
      <div className="editor-page-header">
        <h2 className="editor-page-title">Trainer Spell Editor</h2>
        <p className="editor-page-subtitle">Manage spell ranks and trainer assignments</p>
      </div>
      <div className="tsv-mode-switch">
        <button className={`tsv-mode-btn ${uiMode === 'visual' ? 'active' : ''}`} onClick={() => setUiMode('visual')}>Visual</button>
        <button className={`tsv-mode-btn ${uiMode === 'advanced' ? 'active' : ''}`} onClick={() => setUiMode('advanced')}>Advanced</button>
      </div>
      {uiMode === 'visual' && <TrainerSpellVisualPanel />}
      <div className="editor-layout" style={{ display: uiMode === 'advanced' ? 'flex' : 'none' }}>

        <div className="editor-list">
          <div className="editor-list-header">
            <div className="search-box">
              <Search size={13} />
              <input
                ref={searchRef}
                placeholder="Search spell name..."
                value={search}
                onChange={e => { setSearch(e.target.value); searchSpells(e.target.value); }}
              />
            </div>
          </div>
          <div className="list-items">
            {loading && <div className="loading-text">Searching...</div>}
            {!loading && spellGroups.map(g => (
              <div
                key={g.Name_Lang_enUS}
                className={`list-item ${selectedName === g.Name_Lang_enUS ? 'active' : ''}`}
                onClick={() => selectName(g.Name_Lang_enUS)}
              >
                <div className="list-item-main">
                  <span className="list-item-name">{g.Name_Lang_enUS}</span>
                  <ChevronRight size={12} className="list-item-arrow" />
                </div>
                <div className="list-item-meta">
                  <span>{g.rankCount} rank{g.rankCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
            ))}
            {!loading && spellGroups.length === 0 && <div className="loading-text">No results</div>}
          </div>
        </div>

        <div className="editor-form">
          {!selectedName ? (
            <div className="editor-empty">
              <MousePointerClick />
              <p>Select a spell to edit</p>
            </div>
          ) : (
            <div className="ts-content">
              <div className="page-header">
                <div>
                  <h1 className="page-title">{selectedName}</h1>
                  <p className="page-sub">{ranks.length} rank{ranks.length !== 1 ? 's' : ''} Â· Spell.dbc + trainer_spell</p>
                </div>
              </div>

              {msg && <div className={`editor-msg ${msg.type}`} style={{ margin: '12px 28px 0' }}>{msg.text}</div>}

              <div className="ts-table-wrap">
                <table className="creature-data-table ts-rank-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Spell ID</th>
                      <th>Spell Level</th>
                      <th>Base Points</th>
                      <th>Trainers</th>
                      <th style={{ width: '28px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranks.map((rank, idx) => {
                      const trainers = trainersMap[rank.ID] || [];
                      const isExpanded = expandedId === rank.ID;
                      const edits = rankEdits[rank.ID] || {};
                      const isDirty = Object.keys(edits).length > 0;
                      const curBase = edits.basePoints !== undefined ? edits.basePoints : rank.EffectBasePoints_1;
                      const curLevel = edits.spellLevel !== undefined ? edits.spellLevel : rank.SpellLevel;

                      return [
                        <tr
                          key={rank.ID}
                          onClick={() => toggleExpand(rank.ID, rank.SpellLevel)}
                          className={`ts-rank-row ${isExpanded ? 'ts-rank-row--open' : ''}`}
                        >
                          <td>
                            <span className="mono">{rank.rankLabel || `Rank ${idx + 1}`}</span>
                            {rank.confirmed && <span className="ts-confirmed" title="In npc_trainer"> â—</span>}
                          </td>
                          <td><span className="mono">#{rank.ID}</span></td>
                          <td>{rank.SpellLevel}</td>
                          <td>
                            {rank.EffectBasePoints_1}
                            {isDirty && <span className="ts-dirty-dot">â—</span>}
                          </td>
                          <td className={trainers.length ? '' : 'ts-muted'}>
                            {trainers.length ? `${trainers.length} trainer${trainers.length !== 1 ? 's' : ''}` : 'â€”'}
                          </td>
                          <td>
                            {isExpanded
                              ? <ChevronDown size={12} style={{ color: 'var(--gold)' }} />
                              : <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />}
                          </td>
                        </tr>,

                        isExpanded && (
                          <tr key={`${rank.ID}-exp`} className="ts-expand-row">
                            <td colSpan={6} style={{ padding: 0 }}>
                              <div className="ts-expand-panel" onClick={e => e.stopPropagation()}>

                                <div className="ts-expand-col">
                                  <div className="field-section-title">Spell Data</div>
                                  <div className="ts-field-row">
                                    <label>Base Points</label>
                                    <input
                                      type="number"
                                      value={curBase}
                                      onChange={e => setEdit(rank.ID, 'basePoints', Number(e.target.value))}
                                    />
                                  </div>
                                  <div className="ts-field-row">
                                    <label>Spell Level</label>
                                    <input
                                      type="number"
                                      value={curLevel}
                                      onChange={e => setEdit(rank.ID, 'spellLevel', Number(e.target.value))}
                                    />
                                  </div>
                                  <button
                                    className="btn-primary ts-save-btn"
                                    onClick={e => saveRank(e, rank.ID)}
                                    disabled={saving || !isDirty}
                                  >
                                    <Save size={12} /> Save
                                  </button>
                                </div>

                                <div className="ts-expand-col ts-expand-col--trainers">
                                  <div className="field-section-title">Trainers</div>
                                  {trainers.length === 0 && (
                                    <p className="ts-no-trainers">No trainers assigned</p>
                                  )}
                                  {trainers.map(t => {
                                    const tInfo = trainerList.find(x => x.TrainerId === t.TrainerId);
                                    return (
                                    <div key={t.TrainerId} className="ts-trainer-row">
                                      <div className="ts-trainer-info">
                                        <span className="mono ts-trainer-id">ID {t.TrainerId}</span>
                                        <span className="ts-trainer-name">{tInfo?.label || t.trainerNames || '(unknown)'}</span>
                                        <span className="ts-trainer-meta">{t.MoneyCost}c Â· Req {t.ReqLevel}</span>
                                      </div>
                                      <button
                                        className="btn-ghost ts-remove-btn"
                                        onClick={e => removeTrainer(e, rank.ID, t.TrainerId)}
                                        disabled={saving}
                                        title="Remove trainer"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                    );
                                  })}
                                  <div className="field-section-title" style={{ marginTop: '10px' }}>Add Trainer</div>
                                  <div className="ts-trainer-search-wrap">
                                    <input
                                      type="text"
                                      placeholder="Zoek op klasse (bijv. Paladin)..."
                                      value={trainerDraft.search}
                                      onChange={e => setTrainerDraft(d => ({ ...d, search: e.target.value, trainerId: '' }))}
                                      className="ts-draft-input ts-trainer-search"
                                    />
                                    {trainerDraft.search && (() => {
                                      const q = trainerDraft.search.toLowerCase();
                                      const hits = trainerList.filter(t =>
                                        t.label.toLowerCase().includes(q)
                                      ).slice(0, 8);
                                      return hits.length > 0 ? (
                                        <div className="ts-trainer-dropdown">
                                          {hits.map(t => (
                                            <button
                                              key={t.TrainerId}
                                              className="ts-trainer-option"
                                              onClick={e => { e.stopPropagation(); setTrainerDraft(d => ({ ...d, trainerId: String(t.TrainerId), search: t.label })); }}
                                            >
                                              <span className="mono ts-trainer-id">ID {t.TrainerId}</span>
                                              <span className="ts-trainer-name">{t.label}</span>
                                              <span className="ts-trainer-meta">{t.spellCount} spells</span>
                                            </button>
                                          ))}
                                        </div>
                                      ) : null;
                                    })()}
                                  </div>
                                  {trainerDraft.trainerId && (() => {
                                    const selTrainer = trainerList.find(x => x.TrainerId === Number(trainerDraft.trainerId));
                                    const skillOptions = SKILL_LINE_OPTIONS[selTrainer?.Requirement] || [];
                                    return (
                                    <div style={{ marginTop: '6px' }}>
                                      <div className="ts-add-trainer-row">
                                        <span className="ts-selected-trainer">{trainerDraft.search} (ID {trainerDraft.trainerId})</span>
                                        <input
                                          type="number"
                                          placeholder="Cost (c)"
                                          value={trainerDraft.moneyCost}
                                          onChange={e => setTrainerDraft(d => ({ ...d, moneyCost: e.target.value }))}
                                          className="ts-draft-input ts-draft-input--cost"
                                        />
                                        <input
                                          type="number"
                                          placeholder="Req Lvl"
                                          value={trainerDraft.reqLevel}
                                          onChange={e => setTrainerDraft(d => ({ ...d, reqLevel: e.target.value }))}
                                          className="ts-draft-input ts-draft-input--lvl"
                                        />
                                      </div>
                                      {skillOptions.length > 0 && (
                                        <div className="ts-field-row" style={{ marginTop: '6px' }}>
                                          <label>SkillLine</label>
                                          <select
                                            className="ts-draft-select"
                                            value={trainerDraft.skillLine || String(skillOptions[0].id)}
                                            onChange={e => setTrainerDraft(d => ({ ...d, skillLine: e.target.value }))}
                                          >
                                            {skillOptions.map(o => (
                                              <option key={`${o.id}-${o.label}`} value={String(o.id)}>{o.label} ({o.id})</option>
                                            ))}
                                          </select>
                                        </div>
                                      )}
                                      <button
                                        className="btn-primary"
                                        style={{ marginTop: '8px' }}
                                        onClick={e => addTrainer(e, rank.ID)}
                                        disabled={saving}
                                      >
                                        <Plus size={12} /> Add
                                      </button>
                                    </div>
                                    );
                                  })()}
                                </div>

                              </div>
                            </td>
                          </tr>
                        )
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}



