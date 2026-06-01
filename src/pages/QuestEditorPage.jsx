import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Save, RotateCcw, ChevronRight, MousePointerClick, Copy } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';

// ── Constants ──────────────────────────────────────────────────────────────
const QUEST_TYPE_OPTIONS = [
  '0:Normal','1:Daily','21:Weekly','41:PvP','45:Heroic Dungeon','62:Raid','88:Elite','102:Dungeon',
];

const XP_DIFFICULTY_OPTIONS = [
  '0:Trivial','1:Easy','2:Normal','3:Difficult','4:Very Difficult',
];

const ALLOWABLE_RACE_BITS = {
  1:'Human',2:'Orc',4:'Dwarf',8:'Night Elf',16:'Undead',
  32:'Tauren',64:'Gnome',128:'Troll',512:'Blood Elf',1024:'Draenei',
};

const ALLOWABLE_CLASS_BITS = {
  1:'Warrior',2:'Paladin',4:'Hunter',8:'Rogue',16:'Priest',
  64:'Shaman',128:'Mage',256:'Warlock',1024:'Druid',
};

const SPECIAL_FLAGS_BITS = {
  1:'Repeatable',2:'Needs Event',4:'Auto-Accept',8:'Auto-Take',
};

const ADDON_FIELDS = new Set([
  'MaxLevel','AllowableClasses','SourceSpellID','PrevQuestID','NextQuestID',
  'ExclusiveGroup','BreadcrumbForQuestId','RewardMailTemplateID','RewardMailDelay',
  'RequiredSkillID','RequiredSkillPoints','RequiredMinRepFaction','RequiredMaxRepFaction',
  'RequiredMinRepValue','RequiredMaxRepValue','ProvidedItemCount','SpecialFlags',
]);

const QUEST_FLAGS_BITS = {
  1:'Stay Alive',
  4:'Deliver More',
  64:'Exploration',
  256:'Sharable',
  512:'Epic Quest',
  1024:'Raid Quest',
  2048:'Daily',
  4096:'PvP (flagged)',
  8192:'No Share',
  16384:'No QuestID',
  32768:'Seasonal Superquest',
  65536:'Tracking',
  131072:'Deprecate Rep Req',
  262144:'Failed',
  1048576:'Weekly',
};

// ── NameHint component — async lookup for creature/GO/item names ───────────
function NameHint({ id, type, query }) {
  const [name, setName] = useState(null);
  const prevId = useRef(null);

  useEffect(() => {
    const n = Number(id);
    if (!n || n === prevId.current) return;
    prevId.current = n;
    setName(null);

    let sql, params;
    if (type === 'item') {
      sql = 'SELECT name FROM item_template WHERE entry = ? LIMIT 1';
      params = [Math.abs(n)];
    } else if (type === 'npcgo') {
      if (n > 0) {
        sql = 'SELECT name FROM creature_template WHERE entry = ? LIMIT 1';
        params = [n];
      } else {
        sql = 'SELECT name FROM gameobject_template WHERE entry = ? LIMIT 1';
        params = [-n];
      }
    } else if (type === 'quest') {
      sql = 'SELECT LogTitle AS name FROM quest_template WHERE ID = ? LIMIT 1';
      params = [Math.abs(n)];
    } else if (type === 'spell') {
      sql = null;
    }

    if (!sql) return;
    query(sql, params).then(r => {
      if (r.data?.[0]?.name) setName(r.data[0].name);
    });
  }, [id, type, query]);

  if (!Number(id) || !name) return null;
  return (
    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px', fontStyle: 'italic' }}>
      {name}
    </span>
  );
}

// ── QuestChainVisualizer ───────────────────────────────────────────────────
function QuestChainVisualizer({ form, query, onNavigate }) {
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!form?.ID) { setChain(null); return; }
    let cancelled = false;

    const fetchNode = async (id) => {
      const res = await query(
        `SELECT qt.ID, qt.LogTitle, qta.PrevQuestID, qta.NextQuestID, qta.ExclusiveGroup
         FROM quest_template qt
         LEFT JOIN quest_template_addon qta ON qt.ID = qta.ID
         WHERE qt.ID = ?`,
        [id]
      );
      return res.data?.[0] ?? null;
    };

    const fetchNextGroup = async (prevId) => {
      const res = await query(
        `SELECT qt.ID, qt.LogTitle, qta.PrevQuestID, qta.NextQuestID, qta.ExclusiveGroup
         FROM quest_template qt
         LEFT JOIN quest_template_addon qta ON qt.ID = qta.ID
         WHERE qta.PrevQuestID = ?`,
        [prevId]
      );
      return res.data ?? [];
    };

    const build = async () => {
      setLoading(true);
      setError(null);
      try {
        const current = await fetchNode(form.ID);
        if (!current || cancelled) return;

        // Walk back to root
        let root = current;
        for (let i = 0; i < 10; i++) {
          if (!root.PrevQuestID) break;
          const prev = await fetchNode(root.PrevQuestID);
          if (!prev) break;
          root = prev;
        }

        // Walk forward from root, building full chain as flat steps
        const steps = [root];
        for (let i = 0; i < 10; i++) {
          const last = steps[steps.length - 1];
          const nexts = await fetchNextGroup(last.ID);
          if (!nexts.length) break;
          // For now follow first branch; parallel branches handled below
          steps.push(nexts[0]);
          if (nexts[0].ID === form.ID) break; // reached current, no need to go further unless we want to show future
        }

        // Also walk forward from current to show future quests
        let node = current;
        for (let i = 0; i < 5; i++) {
          const nexts = await fetchNextGroup(node.ID);
          if (!nexts.length) break;
          // Only add if not already in steps
          if (!steps.find(s => s.ID === nexts[0].ID)) steps.push(nexts[0]);
          node = nexts[0];
        }

        if (!cancelled) setChain({ steps, currentId: form.ID });
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    build();
    return () => { cancelled = true; };
  }, [form?.ID]);

  if (loading) return <div style={{ marginBottom: '16px', color: 'var(--text-muted)', fontSize: '11px' }}>Loading chain…</div>;
  if (error) return <div style={{ marginBottom: '16px', color: '#e55', fontSize: '11px' }}>Chain error: {error}</div>;
  if (!chain) return null;

  const nodeStyle = (isCurrent) => ({
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '5px 10px',
    borderRadius: '4px',
    border: isCurrent ? '2px solid var(--gold)' : '1px solid var(--border)',
    background: isCurrent ? 'rgba(198,158,72,0.12)' : 'var(--bg-dark)',
    color: isCurrent ? 'var(--gold)' : 'var(--text-muted)',
    cursor: isCurrent ? 'default' : 'pointer',
    minWidth: '80px',
    maxWidth: '140px',
    fontSize: isCurrent ? '12px' : '11px',
    fontWeight: isCurrent ? 600 : 400,
    transition: 'border-color 0.15s',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  const arrow = <span style={{ color: 'var(--text-muted)', margin: '0 4px', alignSelf: 'center' }}>→</span>;

  const node = (q) => {
    const isCurrent = q.ID === chain.currentId;
    return (
      <div key={q.ID} style={nodeStyle(isCurrent)} onClick={isCurrent ? undefined : () => onNavigate(q.ID)} title={q.LogTitle}>
        <span style={{ fontSize: '9px', opacity: 0.7 }}>#{q.ID}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{q.LogTitle || '(untitled)'}</span>
      </div>
    );
  };

  return (
    <div style={{ marginBottom: '16px', padding: '10px 12px', background: 'var(--bg-panel)', borderRadius: '6px', border: '1px solid var(--border)', overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 'max-content', direction: 'ltr' }}>
        {chain.steps.map((q, i) => (
          <React.Fragment key={q.ID}>
            {i > 0 && arrow}
            {node(q)}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── QuestFormFields ────────────────────────────────────────────────────────
function QuestFormFields({ form, onChange, query, onNavigate }) {
  const [expandedFlags, setExpandedFlags] = useState(false);
  const [tab, setTab] = useState('General');

  const sel = (key, opts) => (
    <select value={String(form[key] ?? '')} onChange={e => onChange(key, e.target.value)}>
      {opts.map(o => { const [v, ...r] = o.split(':'); return <option key={v} value={v}>{r.join(':')}</option>; })}
    </select>
  );

  const num = (key, style = {}) => (
    <input type="number" value={form[key] ?? 0} onChange={e => onChange(key, e.target.value)} style={style} />
  );

  const txt = (key) => (
    <input type="text" value={form[key] ?? ''} onChange={e => onChange(key, e.target.value)} />
  );

  const ta = (key, rows = 3) => (
    <textarea rows={rows} value={form[key] ?? ''} onChange={e => onChange(key, e.target.value)} />
  );

  const bitmask = (key, bits) => {
    const cur = Number(form[key]) || 0;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 10px', paddingTop: '2px' }}>
        {Object.entries(bits).map(([bit, name]) => {
          const b = Number(bit);
          return (
            <label key={b} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={(cur & b) !== 0} onChange={() => onChange(key, cur ^ b)} />
              {name}
            </label>
          );
        })}
      </div>
    );
  };

  const flagsField = () => {
    const cur = Number(form.Flags) || 0;
    return (
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', position: 'relative' }}>
        <input type="number" value={form.Flags ?? 0} style={{ width: '110px' }} onChange={e => onChange('Flags', Number(e.target.value))} />
        <button type="button" className="btn-ghost" style={{ padding: '2px 8px', fontSize: '11px' }}
          onClick={() => setExpandedFlags(s => !s)}>
          flags {expandedFlags ? '▲' : '▼'}
        </button>
        {expandedFlags && (
          <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 12px', fontSize: '11px', maxHeight: '240px', overflowY: 'auto', marginTop: '4px', minWidth: '220px' }}>
            {Object.entries(QUEST_FLAGS_BITS).map(([bv, name]) => {
              const b = Number(bv);
              return (
                <label key={b} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={(cur & b) !== 0} onChange={() => onChange('Flags', cur ^ b)} />
                  {name}
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const npcgoField = (key, label, countKey) => (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
      <div className="field-group" style={{ margin: 0, flex: '0 0 auto' }}>
        <label>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {num(key, { width: '100px' })}
          <NameHint id={form[key]} type="npcgo" query={query} />
        </div>
      </div>
      <div className="field-group" style={{ margin: 0, flex: '0 0 auto' }}>
        <label>Count</label>
        {num(countKey, { width: '60px' })}
      </div>
    </div>
  );

  const itemField = (key, label, countKey) => (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
      <div className="field-group" style={{ margin: 0, flex: '0 0 auto' }}>
        <label>{label}</label>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {num(key, { width: '100px' })}
          <NameHint id={form[key]} type="item" query={query} />
        </div>
      </div>
      {countKey && (
        <div className="field-group" style={{ margin: 0, flex: '0 0 auto' }}>
          <label>Count</label>
          {num(countKey, { width: '60px' })}
        </div>
      )}
    </div>
  );

  const FG = ({ label, children, style = {} }) => (
    <div className="field-group" style={style}><label>{label}</label>{children}</div>
  );

  const H5 = ({ children }) => (
    <h5 style={{ margin: '12px 0 8px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</h5>
  );

  const BitmaskRow = ({ fieldKey, bits, label, note }) => (
    <div style={{ marginTop: '12px' }}>
      <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}{note && <span style={{ fontWeight: 400 }}> {note}</span>}
      </label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="number" value={form[fieldKey] ?? 0} style={{ width: '80px' }} onChange={e => onChange(fieldKey, Number(e.target.value))} />
        {bitmask(fieldKey, bits)}
      </div>
    </div>
  );

  const tabs = ['General', 'Texts', 'Objectives', 'Rewards', 'Chain'];

  return (
    <>
      <div className="creature-subtabs" style={{ marginBottom: '16px' }}>
        {tabs.map(t => (
          <button key={t} className={`creature-subtab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/* ── General ── */}
      {tab === 'General' && (
        <div className="form-fields">
          <div>
            <h4 className="field-section-title">Basis Info</h4>
            <FG label="Entry"><input type="number" value={form.ID ?? ''} readOnly style={{ opacity: 0.6 }} /></FG>
            <FG label="Title">{txt('LogTitle')}</FG>
            <FG label="Quest Type">{sel('QuestType', QUEST_TYPE_OPTIONS)}</FG>
            <FG label="Quest Level">{num('QuestLevel')}</FG>
            <FG label="Min Level">{num('MinLevel')}</FG>
            <FG label="Max Level">{num('MaxLevel')}</FG>
            <FG label="Suggested Players">{num('SuggestedGroupNum')}</FG>
            <FG label="Time Limit (s)">{num('TimeAllowed')}</FG>
            <FG label="Req. Player Kills">{num('RequiredPlayerKills')}</FG>
          </div>
          <div>
            <h4 className="field-section-title">Classification</h4>
            <FG label="Zone/Sort ID">{num('QuestSortID')}</FG>
            <FG label="Quest Info ID">{num('QuestInfoID')}</FG>
            <FG label="XP Difficulty">{sel('RewardXPDifficulty', XP_DIFFICULTY_OPTIONS)}</FG>
            <FG label="Source Spell ID">{num('SourceSpellID')}</FG>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <FG label="Quest Flags">{flagsField()}</FG>
            <BitmaskRow fieldKey="AllowableRaces" bits={ALLOWABLE_RACE_BITS} label="Allowable Races" note="(0 = all)" />
            <BitmaskRow fieldKey="AllowableClasses" bits={ALLOWABLE_CLASS_BITS} label="Allowable Classes" note="(0 = all)" />
            <BitmaskRow fieldKey="SpecialFlags" bits={SPECIAL_FLAGS_BITS} label="Special Flags" />
          </div>
        </div>
      )}

      {/* ── Texts ── */}
      {tab === 'Texts' && (
        <div style={{ padding: '20px 28px 32px', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '16px' }}>
          <FG label="Log Description">{ta('LogDescription', 5)}</FG>
          <FG label="Quest Description">{ta('QuestDescription', 5)}</FG>
          <FG label="Area Description">{txt('AreaDescription')}</FG>
          <FG label="Completion Log">{ta('QuestCompletionLog', 5)}</FG>
          <FG label="Objective Text 1">{txt('ObjectiveText1')}</FG>
          <FG label="Objective Text 2">{txt('ObjectiveText2')}</FG>
          <FG label="Objective Text 3">{txt('ObjectiveText3')}</FG>
          <FG label="Objective Text 4">{txt('ObjectiveText4')}</FG>
        </div>
      )}

      {/* ── Objectives ── */}
      {tab === 'Objectives' && (
        <div style={{ padding: '20px 28px 32px' }}>
          <H5>Required NPC / Game Object</H5>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 10px' }}>Positive = creature entry, Negative = GO entry</p>
          {npcgoField('RequiredNpcOrGo1', 'NPC/GO 1', 'RequiredNpcOrGoCount1')}
          {npcgoField('RequiredNpcOrGo2', 'NPC/GO 2', 'RequiredNpcOrGoCount2')}
          {npcgoField('RequiredNpcOrGo3', 'NPC/GO 3', 'RequiredNpcOrGoCount3')}
          {npcgoField('RequiredNpcOrGo4', 'NPC/GO 4', 'RequiredNpcOrGoCount4')}

          <H5>Required Items</H5>
          {[1,2,3,4,5,6].map(i => itemField(`RequiredItemId${i}`, `Item ${i}`, `RequiredItemCount${i}`))}

          <H5>Item Drops (provided to player during quest)</H5>
          {[1,2,3,4].map(i => itemField(`ItemDrop${i}`, `Drop ${i}`, `ItemDropQuantity${i}`))}

          <H5>Faction Requirements</H5>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '8px', maxWidth: '500px' }}>
            <FG label="Faction 1 ID">{num('RequiredFactionId1')}</FG>
            <FG label="Faction 1 Value">{num('RequiredFactionValue1')}</FG>
            <FG label="Faction 2 ID">{num('RequiredFactionId2')}</FG>
            <FG label="Faction 2 Value">{num('RequiredFactionValue2')}</FG>
          </div>

          <H5>Skill Requirement</H5>
          <div style={{ display: 'flex', gap: '12px' }}>
            <FG label="Skill ID">{num('RequiredSkillID')}</FG>
            <FG label="Skill Points">{num('RequiredSkillPoints')}</FG>
          </div>

          <H5>Reputation Requirement</H5>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '8px', maxWidth: '500px' }}>
            <FG label="Min Rep Faction">{num('RequiredMinRepFaction')}</FG>
            <FG label="Min Rep Value">{num('RequiredMinRepValue')}</FG>
            <FG label="Max Rep Faction">{num('RequiredMaxRepFaction')}</FG>
            <FG label="Max Rep Value">{num('RequiredMaxRepValue')}</FG>
          </div>
        </div>
      )}

      {/* ── Rewards ── */}
      {tab === 'Rewards' && (
        <div style={{ padding: '20px 28px 32px' }}>
          <H5>Currency</H5>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', maxWidth: '700px' }}>
            <FG label="Money flat (copper)">{num('RewardMoney')}</FG>
            <FG label="Money DBC (copper)" style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {num('RewardMoneyDifficulty')}
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {(() => { const c=Number(form.RewardMoneyDifficulty)||0; const g=Math.floor(c/10000),s=Math.floor((c%10000)/100),co=c%100; return c>0?`${g>0?g+'g ':''} ${s>0?s+'s ':''} ${co}c`.trim():''; })()}
                </span>
              </div>
            </FG>
            <FG label="Honor">{num('RewardHonor')}</FG>
            <FG label="Kill Honor">{num('RewardKillHonor')}</FG>
            <FG label="Arena Points">{num('RewardArenaPoints')}</FG>
            <FG label="Reward Title">{num('RewardTitle')}</FG>
            <FG label="Reward Talents">{num('RewardTalents')}</FG>
            <FG label="Reward Spell">{num('RewardSpell')}</FG>
            <FG label="Reward Display Spell">{num('RewardDisplaySpell')}</FG>
          </div>

          <H5>Reward Items (guaranteed)</H5>
          {[1,2,3,4].map(i => itemField(`RewardItem${i}`, `Item ${i}`, `RewardAmount${i}`))}

          <H5>Reward Choice Items</H5>
          {[1,2,3,4,5,6].map(i => itemField(`RewardChoiceItemID${i}`, `Choice ${i}`, `RewardChoiceItemQuantity${i}`))}

          <H5>Faction Rewards</H5>
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '6px', alignItems: 'flex-end' }}>
              <FG label={`Faction ${i} ID`} style={{ margin: 0 }}>{num(`RewardFactionID${i}`)}</FG>
              <FG label="Value" style={{ margin: 0 }}>{num(`RewardFactionValue${i}`)}</FG>
              <FG label="Override" style={{ margin: 0 }}>{num(`RewardFactionOverride${i}`)}</FG>
            </div>
          ))}

          <H5>Reward Mail</H5>
          <div style={{ display: 'flex', gap: '12px' }}>
            <FG label="Mail Template ID">{num('RewardMailTemplateID')}</FG>
            <FG label="Mail Delay (s)">{num('RewardMailDelay')}</FG>
          </div>
        </div>
      )}

      {/* ── Chain ── */}
      {tab === 'Chain' && (
        <div style={{ padding: '20px 28px 32px' }}>
          <QuestChainVisualizer form={form} query={query} onNavigate={onNavigate} />
          <H5>Quest Chain</H5>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '12px', maxWidth: '600px' }}>
            <FG label="Prev Quest ID">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {num('PrevQuestID')}
                <NameHint id={form.PrevQuestID} type="quest" query={query} />
              </div>
            </FG>
            <FG label="Next Quest ID">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {num('NextQuestID')}
                <NameHint id={form.NextQuestID} type="quest" query={query} />
              </div>
            </FG>
            <FG label="Reward Next Quest">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {num('RewardNextQuest')}
                <NameHint id={form.RewardNextQuest} type="quest" query={query} />
              </div>
            </FG>
            <FG label="Breadcrumb For Quest">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {num('BreadcrumbForQuestId')}
                <NameHint id={form.BreadcrumbForQuestId} type="quest" query={query} />
              </div>
            </FG>
            <FG label="Exclusive Group">{num('ExclusiveGroup')}</FG>
            <FG label="Start Item">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {num('StartItem')}
                <NameHint id={form.StartItem} type="item" query={query} />
              </div>
            </FG>
            <FG label="Provided Item Count">{num('ProvidedItemCount')}</FG>
          </div>

          <H5>Map / Waypoint</H5>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <FG label="POI Continent">{num('POIContinent')}</FG>
            <FG label="POI X"><input type="number" step="0.01" value={form.POIx ?? 0} onChange={e => onChange('POIx', e.target.value)} onWheel={e => e.target.blur()} /></FG>
            <FG label="POI Y"><input type="number" step="0.01" value={form.POIy ?? 0} onChange={e => onChange('POIy', e.target.value)} onWheel={e => e.target.blur()} /></FG>
            <FG label="POI Priority">{num('POIPriority')}</FG>
          </div>
        </div>
      )}
    </>
  );
}

// ── QuestFilters ──────────────────────────────────────────────────────────
const CLASS_OPTIONS = [
  { bit: 1, label: 'Warrior' }, { bit: 2, label: 'Paladin' }, { bit: 4, label: 'Hunter' },
  { bit: 8, label: 'Rogue' }, { bit: 16, label: 'Priest' }, { bit: 64, label: 'Shaman' },
  { bit: 128, label: 'Mage' }, { bit: 256, label: 'Warlock' }, { bit: 1024, label: 'Druid' },
];

function QuestFilters({ filters, setFilters }) {
  const [classOpen, setClassOpen] = useState(false);
  const popoverRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (popoverRef.current && !popoverRef.current.contains(e.target)) setClassOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleClass = (bit) => setFilters(f => ({ ...f, classes: f.classes ^ bit }));
  const selectedLabels = CLASS_OPTIONS.filter(c => (filters.classes & c.bit) !== 0).map(c => c.label);
  const hasFilters = filters.type || filters.classes > 0 || filters.faction || filters.levelMin || filters.levelMax;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '0 10px 10px' }}>
      <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))} style={{ fontSize: '11px' }}>
        <option value="">All types</option>
        <option value="0">Normal</option>
        <option value="1">Daily</option>
        <option value="21">Weekly</option>
        <option value="41">PvP</option>
        <option value="62">Raid</option>
        <option value="88">Elite</option>
        <option value="102">Dungeon</option>
      </select>

      <select value={filters.faction} onChange={e => setFilters(f => ({ ...f, faction: e.target.value }))} style={{ fontSize: '11px' }}>
        <option value="">All factions</option>
        <option value="alliance">Alliance</option>
        <option value="horde">Horde</option>
      </select>

      {/* Class multi-select */}
      <div style={{ position: 'relative' }} ref={popoverRef}>
        <button
          type="button"
          onClick={() => setClassOpen(o => !o)}
          style={{ width: '100%', textAlign: 'left', fontSize: '11px', padding: '4px 8px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '4px', color: selectedLabels.length ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedLabels.length ? selectedLabels.join(', ') : 'All classes'}
          </span>
          <span style={{ marginLeft: '4px', opacity: 0.6 }}>▼</span>
        </button>

        {classOpen && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', marginTop: '2px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
            {CLASS_OPTIONS.map(({ bit, label }) => (
              <label key={bit} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 2px', fontSize: '11px', cursor: 'pointer' }}>
                <input type="checkbox" checked={(filters.classes & bit) !== 0} onChange={() => toggleClass(bit)} />
                {label}
              </label>
            ))}
            {filters.classes > 0 && (
              <button className="btn-ghost" style={{ fontSize: '10px', padding: '2px 6px', marginTop: '4px' }}
                onClick={() => setFilters(f => ({ ...f, classes: 0 }))}>
                ✕ clear
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <input type="number" placeholder="Lv min" value={filters.levelMin}
          onChange={e => setFilters(f => ({ ...f, levelMin: e.target.value }))}
          style={{ fontSize: '11px', width: '60px', padding: '3px 6px' }} />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>–</span>
        <input type="number" placeholder="Lv max" value={filters.levelMax}
          onChange={e => setFilters(f => ({ ...f, levelMax: e.target.value }))}
          style={{ fontSize: '11px', width: '60px', padding: '3px 6px' }} />
      </div>

      {filters.classes > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: 'pointer' }}>
          <input type="checkbox" checked={filters.classExact} onChange={e => setFilters(f => ({ ...f, classExact: e.target.checked }))} />
          <span style={{ color: filters.classExact ? 'var(--gold)' : 'var(--text-muted)' }}>
            {filters.classExact ? 'Exact match' : 'Includes (any)'}
          </span>
        </label>
      )}

      {hasFilters && (
        <button className="btn-ghost" style={{ fontSize: '10px', padding: '2px 6px', alignSelf: 'flex-start' }}
          onClick={() => setFilters({ type: '', classes: 0, classExact: true, faction: '', levelMin: '', levelMax: '' })}>
          ✕ clear all
        </button>
      )}
    </div>
  );
}

// ── QuestEditorPage ────────────────────────────────────────────────────────
export default function QuestEditorPage() {
  const { query, soapCommand, soapConfig, findNextId, idRanges } = useConnection();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ type: '', classes: 0, classExact: true, faction: '', levelMin: '', levelMax: '' });
  const [quests, setQuests] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [activeTab, setActiveTab] = useState('edit');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  const CREATE_DEFAULTS = { LogTitle: '', QuestType: 0, QuestLevel: 1, MinLevel: 1, AllowableRaces: 0, Flags: 0, RewardXPDifficulty: 2, RewardMoney: 0, RewardMoneyDifficulty: 0 };
  const [createForm, setCreateForm] = useState({ ...CREATE_DEFAULTS });
  const [createId, setCreateId] = useState(null);
  const [createIdLoading, setCreateIdLoading] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createMsg, setCreateMsg] = useState(null);

  const searchRef = useRef(null);

  const ALLIANCE_MASK = 1 | 4 | 8 | 64 | 1024;
  const HORDE_MASK    = 2 | 16 | 32 | 128 | 512;

  const doSearch = useCallback(async (term, f) => {
    setLoading(true);
    const isNum = /^\d+$/.test(term);
    const conditions = [];
    const params = [];

    if (term) {
      if (isNum) { conditions.push('qt.ID = ?'); params.push(Number(term)); }
      else        { conditions.push('qt.LogTitle LIKE ?'); params.push(`%${term}%`); }
    }
    if (f.type !== '')     { conditions.push('qt.QuestType = ?');   params.push(Number(f.type)); }
    if (f.levelMin !== '') { conditions.push('qt.QuestLevel >= ?'); params.push(Number(f.levelMin)); }
    if (f.levelMax !== '') { conditions.push('qt.QuestLevel <= ?'); params.push(Number(f.levelMax)); }
    if (f.faction === 'alliance') { conditions.push(`qt.AllowableRaces & ${ALLIANCE_MASK} != 0`); }
    if (f.faction === 'horde')    { conditions.push(`qt.AllowableRaces & ${HORDE_MASK} != 0`); }

    const needsAddon = f.classes > 0;
    const join = needsAddon ? 'LEFT JOIN quest_template_addon qta ON qt.ID = qta.ID' : '';
    if (f.classes > 0) {
      if (f.classExact) {
        conditions.push('qta.AllowableClasses = ?');
        params.push(f.classes);
      } else {
        conditions.push('qta.AllowableClasses & ? != 0');
        params.push(f.classes);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT qt.ID, qt.LogTitle, qt.QuestLevel, qt.QuestType
                 FROM quest_template qt ${join} ${where}
                 ORDER BY qt.ID DESC LIMIT 100`;
    const result = await query(sql, params);
    setQuests(result.data || []);
    setLoading(false);
  }, [query]);

  useEffect(() => { doSearch(search, filters); }, [search, filters]);

  const refreshList = useCallback(() => doSearch(search, filters), [search, filters, doSearch]);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const selectQuest = async (ID) => {
    const [main, addon] = await Promise.all([
      query('SELECT * FROM quest_template WHERE ID = ?', [ID]),
      query('SELECT * FROM quest_template_addon WHERE ID = ?', [ID]),
    ]);
    if (main.data?.[0]) {
      const merged = { ...main.data[0], ...(addon.data?.[0] || {}) };
      setSelected(merged);
      setForm(merged);
      setDirty(false);
      setMsg(null);
    }
  };

  const handleChange = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const openCreateTab = async () => {
    setActiveTab('create');
    setCreateMsg(null);
    if (!createId) {
      setCreateIdLoading(true);
      const res = await findNextId({ table: 'quest_template', idColumn: 'ID', startId: idRanges.quest });
      if (res.success) setCreateId(res.nextId);
      setCreateIdLoading(false);
    }
  };

  const handleUseAsTemplate = () => {
    if (!selected) return;
    const { ID, ...rest } = selected;
    setCreateForm({ ...rest, LogTitle: `${selected.LogTitle || ''} (copy)` });
    setCreateMsg(null);
  };

  const handleCreate = async () => {
    if (!createId || !createForm.LogTitle?.trim()) {
      setCreateMsg({ type: 'error', text: 'Title is verplicht.' });
      return;
    }
    setCreateSaving(true);
    setCreateMsg(null);
    try {
      // Insert quest_template (only non-addon fields)
      const mainData = { ID: createId, ...Object.fromEntries(Object.entries(createForm).filter(([k]) => !ADDON_FIELDS.has(k))) };
      const mainFields = Object.keys(mainData);
      const r1 = await query(
        `INSERT INTO quest_template (${mainFields.map(k=>`\`${k}\``).join(',')}) VALUES (${mainFields.map(()=>'?').join(',')})`,
        mainFields.map(k => mainData[k])
      );
      if (!r1.success) throw new Error(r1.error);

      // Insert quest_template_addon
      const addonFields = [...ADDON_FIELDS];
      const addonVals = [createId, ...addonFields.map(k => createForm[k] ?? 0)];
      await query(
        `INSERT IGNORE INTO quest_template_addon (ID, ${addonFields.map(k=>`\`${k}\``).join(',')}) VALUES (${addonVals.map(()=>'?').join(',')})`,
        addonVals
      );

      if (soapConfig?.user) await soapCommand('.reload quest_template');

      await refreshList();
      await selectQuest(createId);
      setActiveTab('edit');
      setMsg({ type: 'success', text: `✓ Quest #${createId} aangemaakt` });
      setCreateId(null);
      setCreateForm({ ...CREATE_DEFAULTS });
    } catch (e) {
      setCreateMsg({ type: 'error', text: `✗ ${e.message}` });
    }
    setCreateSaving(false);
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
      const addonFields = [...ADDON_FIELDS];
      const addonVals = [newId, ...addonFields.map(k => selected[k] ?? 0)];
      await query(
        `INSERT IGNORE INTO quest_template_addon (ID, ${addonFields.map(k=>`\`${k}\``).join(',')}) VALUES (${addonVals.map(()=>'?').join(',')})`,
        addonVals
      );
      await refreshList();
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
      const mainFields = Object.keys(form).filter(k => k !== 'ID' && !ADDON_FIELDS.has(k));
      const addonFields = [...ADDON_FIELDS];

      const mainSets = mainFields.map(k => `\`${k}\` = ?`).join(', ');
      const mainVals = [...mainFields.map(k => form[k]), form.ID];
      const r1 = await query(`UPDATE quest_template SET ${mainSets} WHERE ID = ?`, mainVals);
      if (!r1.success) throw new Error(r1.error);

      const addonSets = addonFields.map(k => `\`${k}\` = ?`).join(', ');
      const addonVals = [...addonFields.map(k => form[k] ?? 0), form.ID];
      const r2 = await query(
        `INSERT INTO quest_template_addon (ID, ${addonFields.map(k=>`\`${k}\``).join(',')}) VALUES (?, ${addonFields.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${addonSets}`,
        [form.ID, ...addonFields.map(k => form[k] ?? 0), ...addonVals]
      );
      if (!r2.success) throw new Error(r2.error);

      setSelected(form);
      setDirty(false);
      if (soapConfig.user) {
        await soapCommand(`.reload quest_template`);
        setMsg({ type: 'success', text: `Saved & reloaded quest ${form.ID}` });
      } else {
        setMsg({ type: 'success', text: `Saved quest ${form.ID}.` });
      }
      refreshList();
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

  const QUEST_TYPE_LABEL = { 0:'Normal',1:'Daily',21:'Weekly',41:'PvP',45:'H.Dungeon',62:'Raid',88:'Elite',102:'Dungeon' };

  return (
    <>
      <div className="editor-page-header">
        <h2 className="editor-page-title">Quest Editor</h2>
        <p className="editor-page-subtitle">Manage quest templates and properties</p>
      </div>
      <div className="editor-layout">
        <div className="editor-list" style={{ width: '300px' }}>
          <div className="editor-list-header">
            <div className="search-box">
              <Search size={13} />
              <input
                ref={searchRef}
                placeholder="Search title or entry..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <QuestFilters filters={filters} setFilters={setFilters} />
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
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{QUEST_TYPE_LABEL[q.QuestType] || ''}</span>
                </div>
              </div>
            ))}
            {!loading && quests.length === 0 && <div className="loading-text">No results</div>}
          </div>
        </div>

        <div className="editor-form">
          {/* Tab bar */}
          <div className="creature-subtabs" style={{ padding: '8px 16px 0', borderBottom: '1px solid var(--border)' }}>
            <button className={`creature-subtab ${activeTab === 'edit' ? 'active' : ''}`} onClick={() => setActiveTab('edit')}>Edit</button>
            <button className={`creature-subtab ${activeTab === 'create' ? 'active' : ''}`} onClick={openCreateTab}>
              + New Quest
            </button>
          </div>

          {/* ── Edit tab ── */}
          {activeTab === 'edit' && (
            !selected ? (
              <div className="editor-empty">
                <MousePointerClick />
                <p>Select a quest to edit</p>
              </div>
            ) : (
              <>
                <div className="page-header">
                  <div>
                    <h1 className="page-title">
                      {selected.LogTitle || '(untitled)'}
                      {dirty && <span style={{ color: 'var(--gold)', marginLeft: '8px' }}>●</span>}
                    </h1>
                    <p className="page-sub">Entry #{selected.ID} · quest_template</p>
                  </div>
                  <div className="header-actions">
                    {dirty && <button className="btn-ghost" onClick={() => { setForm(selected); setDirty(false); }}><RotateCcw size={13} /> Reset</button>}
                    <button className="btn-ghost" onClick={handleCopy} disabled={copying}>
                      <Copy size={13} /> {copying ? 'Klonen...' : 'Copy'}
                    </button>
                    <button className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
                      <Save size={13} /> {saving ? 'Saving...' : 'Save & Reload'}
                    </button>
                  </div>
                </div>
                {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}
                <QuestFormFields form={form} onChange={handleChange} query={query} onNavigate={selectQuest} />
              </>
            )
          )}

          {/* ── Create tab ── */}
          {activeTab === 'create' && (
            <>
              <div className="page-header">
                <div>
                  <h1 className="page-title">
                    New Quest
                    <span style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: 400, marginLeft: '10px' }}>
                      {createIdLoading ? 'Fetching ID...' : createId ? `#${createId}` : ''}
                    </span>
                  </h1>
                  <p className="page-sub">quest_template + quest_template_addon</p>
                </div>
                <div className="header-actions">
                  {selected && (
                    <button className="btn-ghost" onClick={handleUseAsTemplate} title="Kopieer geselecteerde quest als template">
                      <Copy size={13} /> Use "{selected.LogTitle?.slice(0, 20) || 'selected'}" as template
                    </button>
                  )}
                  <button className="btn-ghost" onClick={() => { setCreateForm({ ...CREATE_DEFAULTS }); setCreateMsg(null); }}>
                    <RotateCcw size={13} /> Reset
                  </button>
                  <button className="btn-primary" onClick={handleCreate} disabled={createSaving || createIdLoading || !createId}>
                    <Save size={13} /> {createSaving ? 'Aanmaken...' : 'Create Quest'}
                  </button>
                </div>
              </div>
              {createMsg && <div className={`editor-msg ${createMsg.type}`}>{createMsg.text}</div>}
              <QuestFormFields form={createForm} onChange={(k, v) => setCreateForm(f => ({ ...f, [k]: v }))} query={query} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
