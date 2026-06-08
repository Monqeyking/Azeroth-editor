import { useState, useEffect } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Save, Plus, CheckCircle, Search, ChevronDown, ChevronUp } from 'lucide-react';

// ── Armor column naming (mirrors ScalingStatValues.dbc convention) ─────────
const MATERIAL_NAMES = { 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate' };

// InventoryType → slot name used in column names
const SLOT_COL_NAMES = {
  1: 'Helm', 3: 'Shoulder', 5: 'Chest', 6: 'Waist',
  7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands', 20: 'Chest',
};

function getArmorColumn(inventoryType, subclass) {
  if (inventoryType === 16) return 'ClothCloakArmor'; // cloak = always cloth
  const mat  = MATERIAL_NAMES[subclass];
  const slot = SLOT_COL_NAMES[inventoryType];
  if (!mat || !slot) return null;
  // ScalingStatValues.dbc heeft alleen Shoulder/Chest/Cloak armor kolommen
  if (slot !== 'Shoulder' && slot !== 'Chest') return null;
  return `${mat}${slot}Armor`;
}

// ── Stat type labels (shared subset) ─────────────────────────────────────
const STAT_TYPE_OPTIONS = [
  '0:None',
  '3:Agility','4:Strength','5:Intellect','6:Spirit','7:Stamina',
  '12:Defense Rating','13:Dodge Rating','14:Parry Rating','15:Block Rating',
  '16:Melee Hit Rating','17:Ranged Hit Rating','18:Spell Hit Rating',
  '19:Melee Crit','20:Ranged Crit','21:Spell Crit',
  '27:Melee Haste Rating','28:Ranged Haste Rating','29:Spell Haste Rating',
  '31:Hit Rating','32:Crit Rating','35:Resilience','36:Haste Rating',
  '37:Expertise','38:Attack Power','39:Ranged AP',
  '43:Mana Regen','44:Armor Pen','45:Spell Power','46:Health Regen',
];
const STAT_LABELS = {
  3:'Agi',4:'Str',5:'Int',6:'Spi',7:'Sta',
  12:'Def',13:'Dod',14:'Par',15:'Blk',
  16:'HitM',17:'HitR',18:'HitS',19:'CritM',20:'CritR',21:'CritS',
  27:'HasteM',28:'HasteR',29:'HasteS',
  31:'Hit',32:'Crit',35:'Res',36:'Haste',37:'Exp',
  38:'AP',39:'RAP',43:'MP5',44:'ArPen',45:'SP',46:'HP5',
};
const STAT_NAMES_FULL = {
  3:'Agility',4:'Strength',5:'Intellect',6:'Spirit',7:'Stamina',
  12:'Defense',13:'Dodge',14:'Parry',15:'Block',
  16:'Hit Melee',17:'Hit Ranged',18:'Hit Spell',
  19:'Crit Melee',20:'Crit Ranged',21:'Crit Spell',
  27:'Haste Melee',28:'Haste Ranged',29:'Haste Spell',
  31:'Hit Rating',32:'Crit Rating',35:'Resilience',36:'Haste Rating',
  37:'Expertise',38:'Attack Power',39:'Ranged AP',
  43:'Mana Regen',44:'Armor Pen',45:'Spell Power',46:'Health Regen',
};

export default function ItemScalingTab({ editForm, onItemFieldChange }) {
  const {
    readScalingStatDistribution, writeScalingStatDistribution,
    addScalingStatDistribution, findNextScalingStatDistributionId,
    readScalingStatValues,
  } = useConnection();

  const [dist,       setDist]       = useState(null);
  const [distForm,   setDistForm]   = useState(null);
  const [distDirty,  setDistDirty]  = useState(false);
  const [distSaving, setDistSaving] = useState(false);
  const [previewRows,setPreviewRows]= useState([]);
  const [msg,        setMsg]        = useState(null);

  const [browseOpen, setBrowseOpen] = useState(true);
  const [allDists,   setAllDists]   = useState(null);
  const [browseSearch, setBrowseSearch] = useState('');

  const distId   = Number(editForm?.ScalingStatDistribution) || 0;
  const invType  = Number(editForm?.InventoryType) || 0;
  const subclass = Number(editForm?.subclass) || 0;
  const armorCol = getArmorColumn(invType, subclass);
  const slotName = SLOT_COL_NAMES[invType];
  const matName  = MATERIAL_NAMES[subclass];

  // ── Load distribution ──────────────────────────────────────────────────
  useEffect(() => {
    if (distId > 0) loadDist(distId);
    else { setDist(null); setDistForm(null); setDistDirty(false); }
  }, [distId]);

  // ── Browse all distributions ───────────────────────────────────────────
  useEffect(() => { loadAllDists(); }, []);

  const loadAllDists = async () => {
    if (allDists) return;
    const r = await readScalingStatDistribution();
    if (!r.success) { setMsg({ type:'error', text:`Bladeren mislukt: ${r.error}` }); setAllDists([]); return; }
    setAllDists((r.data || []).slice().sort((a, b) => b.ID - a.ID));
  };

  const distSummary = (d) => Array.from({ length: 10 }, (_, i) => i + 1)
    .map(i => ({ id: Number(d[`StatID_${i}`]), bonus: Number(d[`Bonus_${i}`]) }))
    .filter(s => s.id > 0)
    .map(s => `${STAT_NAMES_FULL[s.id] || `Stat ${s.id}`} (${(s.bonus / 100).toFixed(1)}%)`);

  const filteredDists = (allDists || []).filter(d => {
    if (!browseSearch.trim()) return true;
    const q = browseSearch.toLowerCase();
    if (String(d.ID).includes(q)) return true;
    return distSummary(d).some(s => s.toLowerCase().includes(q));
  });

  const loadDist = async (id) => {
    const r = await readScalingStatDistribution(id);
    if (r.success && r.data?.[0]) {
      setDist(r.data[0]);
      setDistForm({ ...r.data[0] });
      setDistDirty(false);
    } else {
      setDist(null);
      setDistForm(null);
    }
  };

  // ── Load preview data ──────────────────────────────────────────────────
  useEffect(() => {
    if (dist) loadPreview();
  }, [dist]);

  const loadPreview = async () => {
    const r = await readScalingStatValues();
    setPreviewRows(r.success ? (r.data || []) : []);
  };

  // ── Distribution actions ───────────────────────────────────────────────
  const handleDistChange = (key, val) => {
    setDistForm(f => ({ ...f, [key]: val }));
    setDistDirty(true);
  };

  const handleNewDist = async () => {
    setMsg(null);
    const next = await findNextScalingStatDistributionId(1);
    if (!next.success) { setMsg({ type:'error', text: next.error }); return; }
    const newId = next.nextId;
    const blank = { ID: newId, Maxlevel: 60 };
    for (let i = 1; i <= 10; i++) { blank[`StatID_${i}`] = -1; blank[`Bonus_${i}`] = 0; }
    const r = await addScalingStatDistribution(blank);
    if (!r.success) { setMsg({ type:'error', text: r.error }); return; }
    setAllDists(null);
    onItemFieldChange('ScalingStatDistribution', newId);
    setMsg({ type:'success', text:`Distributie #${newId} aangemaakt` });
  };

  const handleSaveDist = async () => {
    if (!distForm) return;
    setDistSaving(true);
    setMsg(null);
    const r = await writeScalingStatDistribution(distForm);
    if (!r.success) {
      setMsg({ type:'error', text: r.error });
      setDistSaving(false);
      return;
    }
    setDist({ ...distForm });
    setDistDirty(false);
    setAllDists(null);
    loadAllDists();
    setMsg({ type:'success', text:'Distributie opgeslagen in ScalingStatDistribution.dbc' });
    setDistSaving(false);
  };

  const handleSetAllMaxlevel60 = async () => {
    setMsg(null);
    const r = await readScalingStatDistribution();
    if (!r.success) { setMsg({ type:'error', text: r.error }); return; }
    for (const d of r.data || []) {
      if (d.Maxlevel === 60) continue;
      await writeScalingStatDistribution({ ...d, Maxlevel: 60 });
    }
    if (distForm) handleDistChange('Maxlevel', 60);
    setAllDists(null);
    loadAllDists();
    setMsg({ type:'success', text:'✓ Alle distributies: Maxlevel → 60' });
  };

  // ── Derived preview values ─────────────────────────────────────────────
  const maxLevel   = Number(distForm?.Maxlevel) || 60;
  const activeStats = distForm
    ? Array.from({ length: 10 }, (_, i) => i + 1)
        .filter(i => Number(distForm[`StatID_${i}`]) > 0)
    : [];
  const previewFiltered = previewRows.filter(r => r.Charlevel >= 1 && r.Charlevel <= maxLevel);

  const computeStat = (row, bonusKey) =>
    Math.round((row.PrimaryBudget || 0) * Number(distForm?.[bonusKey] || 0) / 10000);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ padding:'20px 28px', overflowY:'auto', height:'100%' }}>

      {/* ── Header row ── */}
      <div style={{ display:'flex', gap:'12px', alignItems:'flex-end', flexWrap:'wrap', marginBottom:'20px' }}>
        <div className="field-group" style={{ marginBottom:0 }}>
          <label>ScalingStatDistribution ID</label>
          <input type="number" value={editForm?.ScalingStatDistribution ?? 0} style={{ width:'130px' }}
            onChange={e => onItemFieldChange('ScalingStatDistribution', Number(e.target.value))} />
        </div>

        <div className="field-group" style={{ marginBottom:0 }}>
          <label>ScalingStatValue</label>
          <input type="number" value={editForm?.ScalingStatValue ?? 0} style={{ width:'100px' }}
            onChange={e => onItemFieldChange('ScalingStatValue', Number(e.target.value))} />
        </div>

        <div className="field-group" style={{ marginBottom:0 }}>
          <label>Armor budget kolom</label>
          <code style={{ padding:'6px 10px', background:'var(--bg-panel)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', fontSize:'12px', color: armorCol ? 'var(--gold)' : 'var(--text-muted)' }}>
            {armorCol || '— n.v.t. —'}
          </code>
        </div>

        <div style={{ marginLeft:'auto', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
          <button className="btn-ghost" onClick={handleNewDist}>
            <Plus size={13}/> Nieuwe distributie
          </button>
          <button className="btn-ghost" style={{ color:'var(--gold)' }} onClick={handleSetAllMaxlevel60}>
            Alle Maxlevel → 60
          </button>
        </div>
      </div>

      {/* ── Browse existing distributions ── */}
      <div style={{ marginBottom:'20px', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)' }}>
        <button
          onClick={() => { const next = !browseOpen; setBrowseOpen(next); if (next) loadAllDists(); }}
          style={{ width:'100%', display:'flex', alignItems:'center', gap:'8px', padding:'10px 14px', background:'var(--bg-panel)', border:'none', cursor:'pointer', color:'var(--text-primary)', fontSize:'12px', fontWeight:600 }}>
          {browseOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
          Bestaande distributies bladeren ({allDists ? allDists.length : '...'})
          <span style={{ fontWeight:400, color:'var(--text-muted)', marginLeft:'auto' }}>kies een bestaande set stats i.p.v. een ID te raden</span>
        </button>
        {browseOpen && (
          <div style={{ padding:'12px 14px', borderTop:'1px solid var(--border)' }}>
            <div className="search-box" style={{ marginBottom:'10px' }}>
              <Search size={13} />
              <input placeholder="Zoek op ID of stat (bijv. 'Stamina')" value={browseSearch}
                onChange={e => setBrowseSearch(e.target.value)} style={{ width:'100%' }} />
            </div>
            <div style={{ maxHeight:'260px', overflowY:'auto', display:'flex', flexDirection:'column', gap:'4px' }}>
              {allDists === null && <div style={{ fontSize:'11px', color:'var(--text-muted)' }}>Laden...</div>}
              {allDists && filteredDists.length === 0 && <div style={{ fontSize:'11px', color:'var(--text-muted)' }}>Geen resultaten</div>}
              {filteredDists.map(d => {
                const summary = distSummary(d);
                const isActive = d.ID === distId;
                return (
                  <button key={d.ID}
                    onClick={() => onItemFieldChange('ScalingStatDistribution', d.ID)}
                    style={{ textAlign:'left', display:'flex', alignItems:'center', gap:'10px', padding:'8px 10px',
                      background: isActive ? 'rgba(200,169,110,0.12)' : 'var(--bg-dark)',
                      border:`1px solid ${isActive ? 'rgba(200,169,110,0.4)' : 'var(--border)'}`,
                      borderRadius:'var(--radius-sm)', cursor:'pointer', color:'var(--text-primary)', fontSize:'11px' }}>
                    <span style={{ fontWeight:700, color: isActive ? 'var(--gold)' : 'var(--text-primary)', minWidth:'36px' }}>#{d.ID}</span>
                    <span style={{ color:'var(--text-muted)', minWidth:'70px' }}>Lvl 1-{d.Maxlevel}</span>
                    <span style={{ flex:1 }}>{summary.length ? summary.join(', ') : <span style={{ color:'var(--text-muted)' }}>geen stats</span>}</span>
                    {isActive && <CheckCircle size={13} style={{ color:'var(--gold)' }}/>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {msg && (
        <div className={`editor-msg ${msg.type}`} style={{ marginBottom:'16px' }}>{msg.text}</div>
      )}

      {/* ── No distribution ── */}
      {!distId && (
        <div className="editor-empty" style={{ minHeight:'160px' }}>
          <p>Stel een ScalingStatDistribution ID in of maak een nieuwe aan.</p>
        </div>
      )}

      {distId > 0 && !distForm && (
        <div className="editor-empty" style={{ minHeight:'160px' }}>
          <p>Distributie #{distId} niet gevonden in ScalingStatDistribution.dbc.</p>
        </div>
      )}

      {distForm && (
        <>
          {/* ── Distribution editor ── */}
          <div style={{ display:'flex', alignItems:'center', gap:'16px', marginBottom:'14px', flexWrap:'wrap' }}>
            <h4 className="field-section-title" style={{ margin:0 }}>
              Distributie #{distForm.ID}{distDirty && <span style={{ color:'var(--gold)', marginLeft:'6px' }}>●</span>}
            </h4>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <label style={{ fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px', color:'var(--text-muted)' }}>Maxlevel</label>
              <input type="number" value={distForm.Maxlevel ?? 60} style={{ width:'70px' }}
                onChange={e => handleDistChange('Maxlevel', Number(e.target.value))} />
              <span style={{ fontSize:'11px', color:'var(--text-muted)' }}>(bovengrens van "Levels 1-X" in de tooltip)</span>
              {[60, 70, 80].map(lvl => (
                <button key={lvl} className="btn-ghost" style={{ padding:'4px 8px', fontSize:'11px', opacity: Number(distForm.Maxlevel)===lvl ? 1 : 0.6 }}
                  onClick={() => handleDistChange('Maxlevel', lvl)}>
                  → {lvl}
                </button>
              ))}
            </div>
            <button className="btn-primary" style={{ marginLeft:'auto' }}
              onClick={handleSaveDist} disabled={distSaving || !distDirty}>
              <Save size={13}/> {distSaving ? 'Opslaan...' : 'Opslaan'}
            </button>
          </div>

          {/* Stat slots (5×2 grid) */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px', marginBottom:'28px' }}>
            {Array.from({ length:10 }, (_, i) => i+1).map(i => (
              <div key={i}>
                <div style={{ fontSize:'10px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'4px' }}>
                  Stat {i}
                </div>
                <select
                  value={String(Math.max(0, distForm[`StatID_${i}`] ?? 0))}
                  onChange={e => handleDistChange(`StatID_${i}`, Number(e.target.value) || -1)}
                  style={{ width:'100%', marginBottom:'4px' }}>
                  {STAT_TYPE_OPTIONS.map(o => {
                    const [v,...r] = o.split(':');
                    return <option key={v} value={v}>{r.join(':')}</option>;
                  })}
                </select>
                <input type="number" step="0.01"
                  value={Number(((distForm[`Bonus_${i}`] ?? 0) / 100).toFixed(2))}
                  onChange={e => handleDistChange(`Bonus_${i}`, Math.round(Number(e.target.value) * 100))}
                  style={{ width:'100%' }}
                  placeholder="% van budget" />
                <div style={{ fontSize:'9px', color:'var(--text-muted)', marginTop:'2px' }}>% van PrimaryBudget</div>
              </div>
            ))}
          </div>

          {/* ── Preview table ── */}
          {previewFiltered.length > 0 && (
            <>
              <h4 className="field-section-title" style={{ borderTop:'1px solid var(--border)', paddingTop:'16px', marginBottom:'12px' }}>
                Stat preview — level 1 t/m {maxLevel}
                <span style={{ marginLeft:'8px', fontWeight:400, color:'var(--text-muted)', textTransform:'none', letterSpacing:0 }}>
                  (stats via PrimaryBudget, armor via {armorCol || '—'})
                </span>
              </h4>
              <div style={{ overflowX:'auto', maxHeight:'320px', overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)' }}>
                <table className="creature-data-table" style={{ minWidth:'300px', fontSize:'11px' }}>
                  <thead>
                    <tr>
                      <th style={{ position:'sticky', top:0, background:'var(--bg-panel)', zIndex:1 }}>Lvl</th>
                      {armorCol && (
                        <th style={{ position:'sticky', top:0, background:'var(--bg-panel)', zIndex:1 }}>Armor</th>
                      )}
                      {activeStats.map(i => (
                        <th key={i} style={{ position:'sticky', top:0, background:'var(--bg-panel)', zIndex:1 }}>
                          {STAT_LABELS[Number(distForm[`StatID_${i}`])] || `S${i}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewFiltered.map(row => (
                      <tr key={row.ID}>
                        <td style={{ color:'var(--text-muted)' }}>{row.Charlevel}</td>
                        {armorCol && (
                          <td style={{ color: row[armorCol] != null ? 'var(--gold)' : '#ee7070' }}>
                            {row[armorCol] ?? <span style={{ color:'#ee7070', fontSize:'10px' }}>missing</span>}
                          </td>
                        )}
                        {activeStats.map(i => (
                          <td key={i} style={{ color:'#1eff00' }}>
                            +{computeStat(row, `Bonus_${i}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
