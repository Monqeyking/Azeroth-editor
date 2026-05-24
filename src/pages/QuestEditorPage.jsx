import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Save, RotateCcw, ChevronRight, MousePointerClick, Copy } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';

const QUEST_FIELDS = [
  { key: 'ID',                      label: 'Entry',              type: 'number',   readonly: true },
  { key: 'LogTitle',                 label: 'Title',              type: 'text',     required: true },
  { key: 'LogDescription',           label: 'Log Description',    type: 'textarea' },
  { key: 'QuestDescription',         label: 'Quest Description',  type: 'textarea' },
  { key: 'AreaDescription',          label: 'Area Description',   type: 'text' },
  { key: 'QuestCompletionLog',       label: 'Completion Log',     type: 'textarea' },
  { key: 'ObjectiveText1',           label: 'Objective Text 1',   type: 'text' },
  { key: 'ObjectiveText2',           label: 'Objective Text 2',   type: 'text' },
  { key: 'ObjectiveText3',           label: 'Objective Text 3',   type: 'text' },
  { key: 'ObjectiveText4',           label: 'Objective Text 4',   type: 'text' },
  { key: 'QuestLevel',               label: 'Quest Level',        type: 'number' },
  { key: 'MinLevel',                 label: 'Min Level',          type: 'number' },
  { key: 'QuestType',                label: 'Quest Type',         type: 'number' },
  { key: 'QuestSortID',              label: 'Zone/Sort ID',       type: 'number' },
  { key: 'QuestInfoID',              label: 'Quest Info ID',      type: 'number' },
  { key: 'SuggestedGroupNum',        label: 'Suggested Players',  type: 'number' },
  { key: 'TimeAllowed',              label: 'Time Limit (s)',     type: 'number' },
  { key: 'AllowableRaces',           label: 'Allowable Races',    type: 'number' },
  { key: 'Flags',                    label: 'Quest Flags',        type: 'number' },
  { key: 'RewardXPDifficulty',       label: 'XP Difficulty',      type: 'number' },
  { key: 'RewardMoney',              label: 'Money Reward',       type: 'number' },
  { key: 'RewardDisplaySpell',       label: 'Reward Spell',       type: 'number' },
  { key: 'RewardHonor',              label: 'Honor Reward',       type: 'number' },
  { key: 'RewardTitle',              label: 'Reward Title',       type: 'number' },
  { key: 'RewardTalents',            label: 'Reward Talents',     type: 'number' },
  { key: 'RewardArenaPoints',        label: 'Arena Points',       type: 'number' },
  { key: 'RewardItem1',              label: 'Reward Item 1',      type: 'number' },
  { key: 'RewardAmount1',            label: 'Reward Amount 1',    type: 'number' },
  { key: 'RewardItem2',              label: 'Reward Item 2',      type: 'number' },
  { key: 'RewardAmount2',            label: 'Reward Amount 2',    type: 'number' },
  { key: 'RewardChoiceItemID1',      label: 'Choice Item 1',      type: 'number' },
  { key: 'RewardChoiceItemQuantity1',label: 'Choice Amount 1',    type: 'number' },
  { key: 'RewardChoiceItemID2',      label: 'Choice Item 2',      type: 'number' },
  { key: 'RewardChoiceItemQuantity2',label: 'Choice Amount 2',    type: 'number' },
  { key: 'RequiredNpcOrGo1',         label: 'Req NPC/GO 1',       type: 'number' },
  { key: 'RequiredNpcOrGoCount1',    label: 'Req Count 1',        type: 'number' },
  { key: 'RequiredNpcOrGo2',         label: 'Req NPC/GO 2',       type: 'number' },
  { key: 'RequiredNpcOrGoCount2',    label: 'Req Count 2',        type: 'number' },
  { key: 'RequiredItemId1',          label: 'Req Item 1',         type: 'number' },
  { key: 'RequiredItemCount1',       label: 'Req Item Count 1',   type: 'number' },
  { key: 'RequiredItemId2',          label: 'Req Item 2',         type: 'number' },
  { key: 'RequiredItemCount2',       label: 'Req Item Count 2',   type: 'number' },
  { key: 'RewardNextQuest',          label: 'Next Quest',         type: 'number' },
  { key: 'StartItem',                label: 'Start Item',         type: 'number' },
  { key: 'POIContinent',             label: 'POI Continent',      type: 'number' },
  { key: 'POIx',                     label: 'POI X',              type: 'decimal' },
  { key: 'POIy',                     label: 'POI Y',              type: 'decimal' },
];

export default function QuestEditorPage() {
  const { query, soapCommand, soapConfig, findNextId, idRanges } = useConnection();
  const [search, setSearch] = useState('');
  const [quests, setQuests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const searchRef = useRef(null);

  const searchQuests = useCallback(async (term) => {
    setLoading(true);
    const isNum = /^\d+$/.test(term);
    let sql, params;
    if (!term) {
      sql = 'SELECT ID, LogTitle, QuestLevel, QuestType, Flags FROM quest_template ORDER BY ID DESC LIMIT 50';
      params = [];
    } else if (isNum) {
      sql = 'SELECT ID, LogTitle, QuestLevel, QuestType, Flags FROM quest_template WHERE ID = ? LIMIT 50';
      params = [term];
    } else {
      sql = 'SELECT ID, LogTitle, QuestLevel, QuestType, Flags FROM quest_template WHERE LogTitle LIKE ? LIMIT 50';
      params = [`%${term}%`];
    }
    const result = await query(sql, params);
    setQuests(result.data || []);
    setLoading(false);
  }, [query]);

  useEffect(() => { searchQuests(''); }, []);


  useEffect(() => { searchRef.current?.focus(); }, []);

  const selectQuest = async (ID) => {
    const result = await query('SELECT * FROM quest_template WHERE ID = ?', [ID]);
    if (result.data?.[0]) {
      setSelected(result.data[0]);
      setForm(result.data[0]);
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
      const idResult = await findNextId({ table: 'quest_template', idColumn: 'ID', startId: idRanges.quest });
      if (!idResult.success) throw new Error(idResult.error);
      const newId = idResult.nextId;
      const fields = Object.keys(selected);
      const cols = fields.map(k => `\`${k}\``).join(', ');
      const vals = fields.map(k => k === 'ID' ? newId : selected[k]);
      const placeholders = fields.map(() => '?').join(', ');
      const result = await query(`INSERT INTO quest_template (${cols}) VALUES (${placeholders})`, vals);
      if (!result.success) throw new Error(result.error);
      await searchQuests(search);
      await selectQuest(newId);
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
      const fields = Object.keys(form).filter(k => k !== 'ID');
      const sets = fields.map(k => `\`${k}\` = ?`).join(', ');
      const vals = [...fields.map(k => form[k]), form.ID];
      const result = await query(`UPDATE quest_template SET ${sets} WHERE ID = ?`, vals);
      if (result.success) {
        setSelected(form);
        setDirty(false);
        if (soapConfig.user) {
          await soapCommand(`.reload quest_template`);
          setMsg({ type: 'success', text: `Saved & reloaded quest ${form.ID}` });
        } else {
          setMsg({ type: 'success', text: `Saved quest ${form.ID}.` });
        }
        searchQuests(search);
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
    { title: 'Basis Info', keys: ['ID', 'LogTitle', 'LogDescription', 'QuestDescription', 'AreaDescription', 'QuestCompletionLog'] },
    { title: 'Objectives', keys: ['ObjectiveText1', 'ObjectiveText2', 'ObjectiveText3', 'ObjectiveText4'] },
    { title: 'Classification', keys: ['QuestLevel', 'MinLevel', 'QuestType', 'QuestSortID', 'QuestInfoID'] },
    { title: 'Configuration', keys: ['SuggestedGroupNum', 'TimeAllowed', 'AllowableRaces', 'Flags'] },
    { title: 'Rewards', keys: ['RewardXPDifficulty', 'RewardMoney', 'RewardDisplaySpell', 'RewardHonor', 'RewardTitle', 'RewardTalents', 'RewardArenaPoints'] },
    { title: 'Reward Items', keys: ['RewardItem1', 'RewardAmount1', 'RewardItem2', 'RewardAmount2'] },
    { title: 'Reward Choices', keys: ['RewardChoiceItemID1', 'RewardChoiceItemQuantity1', 'RewardChoiceItemID2', 'RewardChoiceItemQuantity2'] },
    { title: 'Requirements', keys: ['RequiredNpcOrGo1', 'RequiredNpcOrGoCount1', 'RequiredNpcOrGo2', 'RequiredNpcOrGoCount2', 'RequiredItemId1', 'RequiredItemCount1', 'RequiredItemId2', 'RequiredItemCount2'] },
    { title: 'Quest Chain', keys: ['RewardNextQuest', 'StartItem'] },
    { title: 'Waypoint', keys: ['POIContinent', 'POIx', 'POIy'] },
  ];

  return (
    <>
      <div className="editor-page-header">
        <h2 className="editor-page-title">Quest Editor</h2>
        <p className="editor-page-subtitle">Manage quest templates and properties</p>
      </div>
      <div className="editor-layout">
        <div className="editor-list">
          <div className="editor-list-header">
            <div className="search-box">
              <Search size={13} />
              <input
                ref={searchRef}
                placeholder="Search title or entry..."
                value={search}
                onChange={e => { setSearch(e.target.value); searchQuests(e.target.value); }}
              />
            </div>
          </div>
          <div className="list-items">
            {loading && <div className="loading-text">Searching...</div>}
            {!loading && quests.map(q => (
              <div
                key={q.ID}
                className={`list-item ${selected?.ID === q.ID ? 'active' : ''}`}
                onClick={() => selectQuest(q.ID)}
              >
                <div className="list-item-main">
                  <span className="list-item-name">{q.LogTitle || '(untitled)'}</span>
                  <ChevronRight size={12} className="list-item-arrow" />
                </div>
                <div className="list-item-meta">
                  <span className="mono">#{q.ID}</span>
                  <span>Lv {q.QuestLevel}</span>
                </div>
              </div>
            ))}
            {!loading && quests.length === 0 && <div className="loading-text">No results</div>}
          </div>
        </div>

        <div className="editor-form">
          {!selected ? (
            <div className="editor-empty">
              <MousePointerClick />
              <p>Select a quest to edit</p>
            </div>
          ) : (
            <>
              <div className="page-header">
                <div>
                  <h1 className="page-title">{selected.LogTitle || '(untitled)'}{dirty && <span style={{color: 'var(--gold)', marginLeft: '8px'}}>●</span>}</h1>
                  <p className="page-sub">Entry #{selected.ID} · quest_template</p>
                </div>
                <div className="header-actions">
                  {dirty && <button className="btn-ghost" onClick={() => { setForm(selected); setDirty(false); }}><RotateCcw size={13}/> Reset</button>}
                  <button className="btn-ghost" onClick={handleCopy} disabled={copying} title="Kloon naar nieuw ID">
                    <Copy size={13}/> {copying ? 'Klonen...' : 'Copy'}
                  </button>
                  <button className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
                    <Save size={13}/> {saving ? 'Saving...' : 'Save & Reload'}
                  </button>
                </div>
              </div>
              {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}
              <div className="form-fields">
                {getFieldSections().map((section, idx) => (
                  <div key={idx}>
                    <h4 className="field-section-title">{section.title}</h4>
                    {section.keys.map(key => {
                      const f = QUEST_FIELDS.find(fld => fld.key === key);
                      if (!f) return null;
                      return (
                        <div key={f.key} className={`field-group ${f.type === 'textarea' ? 'field-wide' : ''}`}>
                          <label>{f.label}</label>
                          {f.type === 'textarea' ? (
                            <textarea rows={3} value={form[f.key] ?? ''} onChange={e => handleChange(f.key, e.target.value)} />
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
