import { useState, useEffect } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Save, Plus, AlertTriangle, CheckCircle, Info } from 'lucide-react';

// ── Armor column naming (mirrors scalingstatvalues_dbc convention) ─────────
const MATERIAL_NAMES = { 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate' };

// InventoryType → slot name used in column names
const SLOT_COL_NAMES = {
  1: 'Helm', 3: 'Shoulder', 5: 'Chest', 6: 'Waist',
  7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands', 20: 'Chest',
};

// Armor factor relative to Chest (per slot)
const SLOT_CHEST_FACTOR = {
  Helm: 0.92, Shoulder: 0.75, Chest: 1.00, Waist: 0.75,
  Legs: 1.00, Feet: 0.75, Wrist: 0.56, Hands: 0.75,
};

// Existing columns — no ALTER needed
const EXISTING_COLUMNS = new Set([
  'ClothShoulderArmor', 'LeatherShoulderArmor', 'MailShoulderArmor', 'PlateShoulderArmor',
  'ClothChestArmor', 'LeatherChestArmor', 'MailChestArmor', 'PlateChestArmor',
  'ClothCloakArmor',
]);

function getArmorColumn(inventoryType, subclass) {
  if (inventoryType === 16) return 'ClothCloakArmor'; // cloak = always cloth
  const mat  = MATERIAL_NAMES[subclass];
  const slot = SLOT_COL_NAMES[inventoryType];
  if (!mat || !slot) return null;
  return `${mat}${slot}Armor`;
}

// ── Stat type labels (shared subset) ─────────────────────────────────────
const STAT_TYPE_OPTIONS = [
  '0:None','3:Agility','4:Strength','5:Intellect','6:Spirit','7:Stamina',
  '12:Defense Rating','13:Dodge Rating','14:Parry Rating','15:Block Rating',
  '28:Hit Rating','29:Crit Rating','31:Resilience','32:Haste Rating',
  '36:Haste Rating','38:Attack Power','45:Spell Power','46:Mana Regen',
];
const STAT_LABELS = {
  3:'Agi',4:'Str',5:'Int',6:'Spi',7:'Sta',12:'Def',13:'Dod',14:'Par',
  15:'Blk',28:'Hit',29:'Crit',31:'Res',32:'Haste',36:'Haste',
  38:'AP',45:'SP',46:'MP5',
};

export default function ItemScalingTab({ editForm, onItemFieldChange }) {
  const { query } = useConnection();

  const [dist,       setDist]       = useState(null);
  const [distForm,   setDistForm]   = useState(null);
  const [distDirty,  setDistDirty]  = useState(false);
  const [distSaving, setDistSaving] = useState(false);
  const [colStatus,  setColStatus]  = useState(null); // null|'exists'|'missing'|'creating'|'created'
  const [previewRows,setPreviewRows]= useState([]);
  const [msg,        setMsg]        = useState(null);

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

  const loadDist = async (id) => {
    const r = await query('SELECT * FROM scalingstatdistribution_dbc WHERE ID = ?', [id]);
    if (r.data?.[0]) {
      setDist(r.data[0]);
      setDistForm({ ...r.data[0] });
      setDistDirty(false);
    }
  };

  // ── Check armor column ─────────────────────────────────────────────────
  useEffect(() => {
    if (!armorCol) { setColStatus(null); return; }
    if (EXISTING_COLUMNS.has(armorCol)) { setColStatus('exists'); return; }
    checkColumn(armorCol);
  }, [armorCol]);

  const checkColumn = async (col) => {
    const r = await query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'scalingstatvalues_dbc'
         AND COLUMN_NAME  = ?`,
      [col]
    );
    setColStatus(Number(r.data?.[0]?.cnt) > 0 ? 'exists' : 'missing');
  };

  const ensureColumn = async (col) => {
    if (colStatus === 'exists' || colStatus === 'created') return true;
    setColStatus('creating');
    try {
      const factor    = SLOT_CHEST_FACTOR[slotName] || 1.0;
      const chestCol  = `${matName}ChestArmor`;
      await query(`ALTER TABLE scalingstatvalues_dbc ADD COLUMN \`${col}\` INT NOT NULL DEFAULT 0`);
      await query(`UPDATE scalingstatvalues_dbc SET \`${col}\` = ROUND(\`${chestCol}\` * ${factor})`);
      setColStatus('created');
      return true;
    } catch (e) {
      setColStatus('missing');
      setMsg({ type: 'error', text: `Column aanmaken mislukt: ${e.message}` });
      return false;
    }
  };

  // ── Load preview data ──────────────────────────────────────────────────
  useEffect(() => {
    if (dist) loadPreview();
  }, [dist, colStatus]);

  const loadPreview = async () => {
    const r = await query(
      'SELECT * FROM scalingstatvalues_dbc ORDER BY Charlevel ASC'
    );
    setPreviewRows(r.data || []);
  };

  // ── Distribution actions ───────────────────────────────────────────────
  const handleDistChange = (key, val) => {
    setDistForm(f => ({ ...f, [key]: val }));
    setDistDirty(true);
  };

  const handleNewDist = async () => {
    setMsg(null);
    const r = await query('SELECT MAX(ID) AS maxId FROM scalingstatdistribution_dbc');
    const newId = (Number(r.data?.[0]?.maxId) || 0) + 1;
    const blank = { ID: newId, Maxlevel: 60 };
    for (let i = 1; i <= 10; i++) { blank[`StatID_${i}`] = 0; blank[`Bonus_${i}`] = 0; }
    const keys = Object.keys(blank);
    const ins  = await query(
      `INSERT INTO scalingstatdistribution_dbc (${keys.map(k=>`\`${k}\``).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,
      keys.map(k => blank[k])
    );
    if (!ins.success) { setMsg({ type:'error', text: ins.error }); return; }
    onItemFieldChange('ScalingStatDistribution', newId);
    setMsg({ type:'success', text:`Distributie #${newId} aangemaakt` });
  };

  const handleSaveDist = async () => {
    if (!distForm) return;
    setDistSaving(true);
    setMsg(null);
    try {
      // Ensure armor column exists (auto-create if missing)
      if (armorCol && colStatus === 'missing') {
        const ok = await ensureColumn(armorCol);
        if (!ok) { setDistSaving(false); return; }
      }

      const fields = Object.keys(distForm).filter(k => k !== 'ID');
      const r = await query(
        `UPDATE scalingstatdistribution_dbc SET ${fields.map(k=>`\`${k}\` = ?`).join(', ')} WHERE ID = ?`,
        [...fields.map(k => distForm[k]), distForm.ID]
      );
      if (!r.success) throw new Error(r.error);

      setDist({ ...distForm });
      setDistDirty(false);
      setMsg({ type:'success', text:'Distributie opgeslagen' });
      await loadPreview();
    } catch (e) {
      setMsg({ type:'error', text: e.message });
    }
    setDistSaving(false);
  };

  const handleSetAllMaxlevel60 = async () => {
    setMsg(null);
    const r = await query('UPDATE scalingstatdistribution_dbc SET Maxlevel = 60');
    if (!r.success) { setMsg({ type:'error', text: r.error }); return; }
    if (distForm) handleDistChange('Maxlevel', 60);
    setMsg({ type:'success', text:`✓ Alle distributies: Maxlevel → 60` });
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

  // ── Column status badge ────────────────────────────────────────────────
  const ColBadge = () => {
    if (!armorCol) return null;
    const map = {
      exists:   { icon: <CheckCircle size={12}/>, color:'#6dca88', text:'kolom bestaat' },
      missing:  { icon: <AlertTriangle size={12}/>, color:'#e6a817', text:'wordt aangemaakt bij opslaan' },
      creating: { icon: <Info size={12}/>, color:'var(--text-muted)', text:'aanmaken...' },
      created:  { icon: <CheckCircle size={12}/>, color:'#6dca88', text:'zojuist aangemaakt' },
    };
    const s = map[colStatus];
    if (!s) return null;
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:'4px', fontSize:'11px', color: s.color }}>
        {s.icon} {s.text}
      </span>
    );
  };

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
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <code style={{ padding:'6px 10px', background:'var(--bg-panel)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', fontSize:'12px', color: armorCol ? 'var(--gold)' : 'var(--text-muted)' }}>
              {armorCol || '— n.v.t. —'}
            </code>
            <ColBadge />
          </div>
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
          <p>Distributie #{distId} niet gevonden in scalingstatdistribution_dbc.</p>
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
                  value={String(distForm[`StatID_${i}`] ?? 0)}
                  onChange={e => handleDistChange(`StatID_${i}`, Number(e.target.value))}
                  style={{ width:'100%', marginBottom:'4px' }}>
                  {STAT_TYPE_OPTIONS.map(o => {
                    const [v,...r] = o.split(':');
                    return <option key={v} value={v}>{r.join(':')}</option>;
                  })}
                </select>
                <input type="number"
                  value={distForm[`Bonus_${i}`] ?? 0}
                  onChange={e => handleDistChange(`Bonus_${i}`, Number(e.target.value))}
                  style={{ width:'100%' }}
                  placeholder="Bonus (×0.0001)" />
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
