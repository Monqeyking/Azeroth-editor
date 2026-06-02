import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Save, RotateCcw, ChevronRight, MousePointerClick, Copy, Zap, Plus, ClipboardCopy, Layers } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import ItemScalingTab from './ItemScalingTab';

// ── Constants ──────────────────────────────────────────────────────────────
const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e55c3c', '#e6cc80'];
const QUALITY_LABELS = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom'];

const ITEM_CLASSES = [
  '0:Consumable','1:Container','2:Weapon','3:Gem','4:Armor','5:Reagent',
  '6:Projectile','7:Trade Goods','8:Generic','9:Recipe','10:Money',
  '11:Quiver','12:Quest','13:Key','14:Permanent','15:Misc',
];

const INVENTORY_TYPE_OPTIONS = [
  '0:Non-equip','1:Head','2:Neck','3:Shoulders','4:Body','5:Chest','6:Waist','7:Legs',
  '8:Feet','9:Wrists','10:Hands','11:Finger','12:Trinket','13:Weapon','14:Shield',
  '15:Ranged','16:Back','17:Two-Hand','18:Bag','19:Tabard','20:Robe','21:Main Hand',
  '22:Off Hand','23:Held Off-hand','24:Ammo','25:Thrown','26:Ranged Right','27:Quiver','28:Relic',
];

const STAT_TYPE_OPTIONS = [
  '0:None','3:Agility','4:Strength','5:Intellect','6:Spirit','7:Stamina',
  '12:Defense Rating','13:Dodge Rating','14:Parry Rating','15:Block Rating',
  '16:Hit (Melee)','17:Hit (Ranged)','18:Hit (Spell)','19:Crit (Melee)',
  '20:Crit (Ranged)','21:Crit (Spell)','28:Hit Rating','29:Crit Rating',
  '31:Resilience','32:Haste (Spell)','36:Haste Rating','38:Attack Power',
  '39:Ranged Attack Power','41:Feral AP','44:Armor Pen','45:Spell Power',
  '46:Mana Regen','47:Armor Pen Rating','49:Block Value',
];

const DMG_TYPE_OPTIONS      = ['0:Physical','1:Holy','2:Fire','3:Nature','4:Frost','5:Shadow','6:Arcane'];
const MATERIAL_OPTIONS      = ['-1:Consumable','0:Undefined','1:Metal','2:Wood','3:Liquid','4:Jewelry','5:Chain','6:Plate','7:Cloth','8:Leather'];
const SPELL_TRIGGER_OPTIONS = ['0:On Use','1:On Equip','2:Chance on Hit','4:Soulstone','5:Use (no delay)','6:Learn on Pickup'];

const SUBCLASS_OPTIONS = {
  0:  ['0:Consumable','1:Potion','2:Elixir','3:Flask','4:Scroll','5:Food & Drink','6:Item Enhancement','7:Bandage','8:Healthstone'],
  1:  ['0:Bag','1:Soul Bag','2:Herb Bag','3:Enchanting Bag','4:Engineering Bag','5:Gem Bag','6:Mining Bag','7:Leatherworking Bag','8:Inscription Bag'],
  2:  ['0:1H Axe','1:2H Axe','2:Bow','3:Gun','4:1H Mace','5:2H Mace','6:Polearm','7:1H Sword','8:2H Sword','10:Staff','13:Fist Weapon','14:Misc','15:Dagger','16:Thrown','18:Crossbow','19:Wand','20:Fishing Pole'],
  3:  ['0:Red','1:Blue','2:Yellow','3:Purple','4:Green','5:Orange','6:Meta','7:Simple','8:Prismatic'],
  4:  ['0:Misc','1:Cloth','2:Leather','3:Mail','4:Plate','6:Shield','7:Libram','8:Idol','9:Totem','10:Sigil'],
  5:  ['0:Reagent'],
  6:  ['2:Arrow','3:Bullet'],
  7:  ['0:Trade Goods','1:Parts','2:Explosives','3:Devices','4:Jewelcrafting','5:Cloth','6:Leather','7:Metal & Stone','8:Meat','9:Herb','10:Elemental','11:Other','12:Enchanting'],
  9:  ['0:Book','1:Leatherworking','2:Tailoring','3:Engineering','4:Blacksmithing','5:Cooking','6:Alchemy','7:First Aid','8:Enchanting','9:Fishing','10:Jewelcrafting','11:Inscription'],
  11: ['2:Quiver','3:Ammo Pouch'],
  12: ['0:Quest'],
  13: ['0:Key','1:Lockpick'],
  15: ['0:Junk','1:Reagent','2:Companion Pet','3:Holiday','4:Other','5:Mount'],
};

const ALLOWABLE_CLASS_BITS = { 1:'Warrior',2:'Paladin',4:'Hunter',8:'Rogue',16:'Priest',64:'Shaman',128:'Mage',256:'Warlock',1024:'Druid' };
const ALLOWABLE_RACE_BITS  = { 1:'Human',2:'Orc',4:'Dwarf',8:'Night Elf',16:'Undead',32:'Tauren',64:'Gnome',128:'Troll',512:'Blood Elf',1024:'Draenei' };

const ITEM_FLAGS_BITS = {
  1:'No Pickup',2:'Conjured',4:'Has Loot',8:'Heroic',16:'Deprecated',32:'No User Destroy',
  64:'PlayerCast',128:'No Equip Cooldown',256:'Multi-Loot Quest',512:'Is Wrapper',
  2048:'Multi-Drop',4096:'Refundable',8192:'Petition',16384:'Has Text',32768:'No Disenchant',
  65536:'Real Duration',131072:'No Creator',262144:'Is Prospectable',524288:'Unique Equip',
  2097152:'No Durability Loss',4194304:'Use When Shapeshifted',8388608:'Has Quest Glow',
  16777216:'Hide Unusable Recipe',33554432:'Not Usable in Arena',67108864:'Bind to Account',
  134217728:'No Reagent Cost',268435456:'Is Millable',2147483648:'BoP Tradeable',
};

const ITEM_FLAGS_EXTRA_BITS = {
  1:'Horde Only',2:'Alliance Only',4:'Can Roll Need',256:'Need Rolls Disabled',
  512:'Caster Weapon',1024:'No Stats',8192:'Brawlers',
};

const BULK_FIELDS = [
  { key: 'stackable',     label: 'Stackable'     },
  { key: 'MaxCount',      label: 'Max Count'     },
  { key: 'BuyPrice',      label: 'Buy Price'     },
  { key: 'SellPrice',     label: 'Sell Price'    },
  { key: 'RequiredLevel', label: 'Required Level'},
  { key: 'ItemLevel',     label: 'Item Level'    },
  { key: 'BuyCount',      label: 'Buy Count'     },
  { key: 'bonding',       label: 'Bonding'       },
  { key: 'Quality',       label: 'Quality'       },
  { key: 'Flags',         label: 'Flags'         },
];

// ── Create defaults ────────────────────────────────────────────────────────
const buildCreateDefaults = () => {
  const d = {
    name: '', description: '', class: 4, subclass: 4, Quality: 7,
    InventoryType: 1, bonding: 1, displayid: 0, ItemLevel: 1,
    RequiredLevel: 1, AllowableClass: -1, AllowableRace: -1,
    BuyPrice: 0, SellPrice: 0, BuyCount: 1, MaxCount: 1, stackable: 1,
    armor: 0, delay: 0, ammo_type: 0,
    dmg_min1: 0, dmg_max1: 0, dmg_type1: 0,
    dmg_min2: 0, dmg_max2: 0, dmg_type2: 0,
    Flags: 0, FlagsExtra: 0, Material: 0, PageText: 0, ScriptName: '',
    spellcooldown_1: -1, spellcategorycooldown_1: -1,
  };
  for (let i = 1; i <= 10; i++) { d[`stat_type${i}`] = 0; d[`stat_value${i}`] = 0; }
  for (let i = 1; i <= 5; i++)  { d[`spellid_${i}`] = 0; d[`spelltrigger_${i}`] = 0; }
  return d;
};
const CREATE_DEFAULTS = buildCreateDefaults();

// ── Tooltip helpers ────────────────────────────────────────────────────────
const STAT_NAMES = {
  3:'Agility',4:'Strength',5:'Intellect',6:'Spirit',7:'Stamina',
  12:'Defense Rating',13:'Dodge Rating',14:'Parry Rating',15:'Block Rating',
  16:'Hit Rating',17:'Hit Rating',18:'Hit Rating',19:'Crit Rating',20:'Crit Rating',
  21:'Spell Crit Rating',28:'Hit Rating',29:'Crit Rating',31:'Resilience',
  32:'Haste Rating',36:'Haste Rating',38:'Attack Power',39:'Ranged Attack Power',
  41:'Feral Attack Power',44:'Armor Penetration',45:'Spell Power',
  46:'MP5',47:'Armor Pen Rating',49:'Block Value',
};
const INV_LABELS = {
  1:'Head',2:'Neck',3:'Shoulder',4:'Shirt',5:'Chest',6:'Waist',7:'Legs',8:'Feet',
  9:'Wrist',10:'Hands',11:'Finger',12:'Trinket',13:'One-Hand',14:'Off Hand',
  15:'Ranged',16:'Back',17:'Two-Hand',18:'Bag',19:'Tabard',20:'Chest',
  21:'Main Hand',22:'Off Hand',23:'Held in Off-hand',24:'Ammo',25:'Thrown',
  26:'Ranged',27:'Quiver',28:'Relic',
};
const CLASS_LABELS  = { 0:'Consumable',1:'Container',2:'Weapon',3:'Gem',4:'Armor',5:'Reagent',6:'Projectile',7:'Trade Good',8:'Generic',9:'Recipe',10:'Money',11:'Quiver',12:'Quest',13:'Key',14:'Permanent',15:'Misc' };
const BONDING_TEXT  = ['','Binds when picked up','Binds when equipped','Binds when used','Quest Item'];
const DMG_LABEL     = ['','Holy','Fire','Nature','Frost','Shadow','Arcane'];
const TRIGGER_TEXT  = ['Use','Equip','Chance on Hit','','','Use',''];

// ── ItemTooltip ────────────────────────────────────────────────────────────
function ItemTooltip({ form }) {
  const q = Number(form.Quality) || 0;
  const color = QUALITY_COLORS[q] || '#fff';
  const inv = Number(form.InventoryType) || 0;
  const cls = Number(form.class) || 0;
  const isWeapon = cls === 2;
  const hasArmor = Number(form.armor) > 0;

  const stats = [];
  for (let i = 1; i <= 10; i++) {
    const t = Number(form[`stat_type${i}`]), v = Number(form[`stat_value${i}`]);
    if (t > 0 && v !== 0) stats.push({ t, v });
  }
  const spells = [];
  for (let i = 1; i <= 5; i++) {
    const id = Number(form[`spellid_${i}`]), trigger = Number(form[`spelltrigger_${i}`]) || 0;
    if (id > 0) spells.push({ id, trigger });
  }

  const allowClass = Number(form.AllowableClass);
  const allowRace  = Number(form.AllowableRace);
  const classNames = allowClass > 0 && allowClass !== -1
    ? Object.entries(ALLOWABLE_CLASS_BITS).filter(([b]) => (allowClass & Number(b)) !== 0).map(([,n]) => n).join(', ') : null;
  const raceNames  = allowRace > 0 && allowRace !== -1
    ? Object.entries(ALLOWABLE_RACE_BITS).filter(([b]) => (allowRace & Number(b)) !== 0).map(([,n]) => n).join(', ') : null;

  const dMin1 = parseFloat(form.dmg_min1) || 0, dMax1 = parseFloat(form.dmg_max1) || 0;
  const dMin2 = parseFloat(form.dmg_min2) || 0, dMax2 = parseFloat(form.dmg_max2) || 0;
  const dType1 = Number(form.dmg_type1) || 0, dType2 = Number(form.dmg_type2) || 0;
  const delay  = Number(form.delay) || 0;

  return (
    <div style={{ background:'#1a0a2e',border:'2px solid #6e3f8e',borderRadius:'4px',padding:'10px 14px',fontFamily:'"Trebuchet MS",serif',fontSize:'12px',lineHeight:'1.55',color:'#ffd200',boxShadow:'0 0 20px rgba(110,63,142,0.5)' }}>
      <div style={{ color, fontWeight:700, fontSize:'13px', marginBottom:'4px' }}>{form.name || 'Unnamed Item'}</div>

      {Number(form.bonding) > 0  && <div style={{color:'#fff'}}>{BONDING_TEXT[Number(form.bonding)]}</div>}
      {Number(form.MaxCount) === 1 && <div style={{color:'#fff'}}>Unique</div>}

      {inv > 0 && (
        <div style={{display:'flex',justifyContent:'space-between',color:'#fff'}}>
          <span>{INV_LABELS[inv]||''}</span><span>{CLASS_LABELS[cls]||''}</span>
        </div>
      )}

      {isWeapon && (dMin1>0||dMax1>0) && (
        <>
          <div style={{color:'#fff'}}>{dMin1} – {dMax1} Damage{dType1>0?` (${DMG_LABEL[dType1]})`:''}</div>
          {(dMin2>0||dMax2>0) && <div style={{color:'#fff'}}>{dMin2} – {dMax2} Damage{dType2>0?` (${DMG_LABEL[dType2]})`:''}</div>}
          {delay>0 && (
            <div style={{display:'flex',justifyContent:'space-between',color:'#fff'}}>
              <span>Speed {(delay/1000).toFixed(1)}</span>
              {(dMin1+dMax1)>0 && <span>{(((dMin1+dMax1)/2)/(delay/1000)).toFixed(1)} dps</span>}
            </div>
          )}
        </>
      )}

      {hasArmor && <div style={{color:'#fff'}}>{form.armor} Armor</div>}
      {stats.map(({t,v},i) => <div key={i} style={{color:'#1eff00'}}>{v>0?'+':''}{v} {STAT_NAMES[t]||`Stat(${t})`}</div>)}
      {(hasArmor||isWeapon) && <div style={{color:'#fff',marginTop:'2px'}}>Durability 100 / 100</div>}
      {classNames && <div style={{color:'#ffd200'}}>Classes: {classNames}</div>}
      {raceNames  && <div style={{color:'#ffd200'}}>Races: {raceNames}</div>}
      {Number(form.ItemLevel)>0     && <div style={{color:'#fff'}}>Item Level {form.ItemLevel}</div>}
      {Number(form.RequiredLevel)>0 && <div style={{color:'#fff'}}>Requires Level {form.RequiredLevel}</div>}
      {spells.map(({id,trigger},i) => <div key={i} style={{color:'#1eff00',marginTop:'2px'}}>{TRIGGER_TEXT[trigger]||'Use'}: Spell #{id}</div>)}

      {form.description && (
        <div style={{color:'#ffd200',fontStyle:'italic',marginTop:'6px',borderTop:'1px solid #6e3f8e',paddingTop:'6px'}}>
          "{form.description}"
        </div>
      )}
      {Number(form.SellPrice)>0 && (() => {
        const g=Math.floor(form.SellPrice/10000), s=Math.floor((form.SellPrice%10000)/100), c=form.SellPrice%100;
        return (
          <div style={{marginTop:'6px',borderTop:'1px solid #6e3f8e',paddingTop:'6px',color:'#fff',fontSize:'11px'}}>
            Sell Price:{g>0&&<span style={{color:'#ffd200'}}> {g}g</span>}{s>0&&<span style={{color:'#c0c0c0'}}> {s}s</span>}<span style={{color:'#cd7f32'}}> {c}c</span>
          </div>
        );
      })()}
    </div>
  );
}

// ── Shared form fields ─────────────────────────────────────────────────────
function ItemFormFields({ form, onChange }) {
  const [expandedFlags, setExpandedFlags] = useState({});

  const sel  = (key, opts, style={}) => (
    <select value={String(form[key]??'')} onChange={e=>onChange(key,e.target.value)} style={style}>
      {opts.map(o=>{ const [v,...r]=o.split(':'); return <option key={v} value={v}>{r.join(':')}</option>; })}
    </select>
  );
  const num  = (key, style={}) => (
    <input type="number" value={form[key]??0} onChange={e=>onChange(key,e.target.value)} style={style} />
  );
  const dec  = (key, style={}) => (
    <input type="number" step="0.01" value={form[key]??0}
      onChange={e=>onChange(key,e.target.value)} onWheel={e=>e.target.blur()} style={style} />
  );
  const txt  = (key, style={}) => (
    <input type="text" value={form[key]??''} onChange={e=>onChange(key,e.target.value)} style={style} />
  );

  const bitmask = (key, bits) => {
    const cur = Number(form[key])||0;
    const eff = cur<0 ? 0x7FFFFFFF : cur;
    return (
      <div style={{display:'flex',flexWrap:'wrap',gap:'5px 10px',paddingTop:'2px'}}>
        {Object.entries(bits).map(([bit,name]) => {
          const b=Number(bit);
          return (
            <label key={b} style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'11px',cursor:'pointer',whiteSpace:'nowrap'}}>
              <input type="checkbox" checked={(eff&b)!==0} onChange={()=>onChange(key,(Number(form[key])||0)^b)} />
              {name}
            </label>
          );
        })}
      </div>
    );
  };

  const flagsField = (key, bits) => {
    const expanded = expandedFlags[key];
    const cur = Number(form[key])||0;
    return (
      <div style={{display:'flex',gap:'6px',alignItems:'center',position:'relative'}}>
        <input type="number" value={form[key]??0} style={{width:'100px'}} onChange={e=>onChange(key,Number(e.target.value))} />
        <button type="button" className="btn-ghost" style={{padding:'2px 8px',fontSize:'11px'}}
          onClick={()=>setExpandedFlags(s=>({...s,[key]:!s[key]}))}>
          flags {expanded?'▲':'▼'}
        </button>
        {expanded && (
          <div style={{position:'absolute',top:'100%',left:0,zIndex:20,background:'var(--bg-panel)',border:'1px solid var(--border)',borderRadius:'6px',padding:'8px 12px',fontSize:'11px',maxHeight:'240px',overflowY:'auto',marginTop:'4px',minWidth:'220px'}}>
            {Object.entries(bits).map(([bv,name]) => {
              const b=Number(bv);
              return (
                <label key={b} style={{display:'flex',alignItems:'center',gap:'6px',padding:'2px 0',cursor:'pointer',whiteSpace:'nowrap'}}>
                  <input type="checkbox" checked={(cur&b)!==0} onChange={()=>onChange(key,cur^b)} />
                  {name}
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const subclassSel = () => {
    const opts = SUBCLASS_OPTIONS[Number(form.class)];
    return opts?.length ? sel('subclass',opts) : num('subclass');
  };

  const FG = ({label,children,style={}}) => (
    <div className="field-group" style={style}><label>{label}</label>{children}</div>
  );

  return (
    <div className="form-fields">

      {/* Row 1: Basis | Classification | Display & Pricing */}
      <div>
        <h4 className="field-section-title">Basis Info</h4>
        <FG label="Name">{txt('name')}</FG>
        <FG label="Description">{txt('description')}</FG>
        <FG label="Bonding">{sel('bonding',['0:No Bind','1:Bind on Pickup','2:Bind on Equip','3:Bind on Use','4:Quest Item'])}</FG>
        <FG label="Max Count">{num('MaxCount')}</FG>
        <FG label="Stackable">{num('stackable')}</FG>
      </div>

      <div>
        <h4 className="field-section-title">Classification</h4>
        <FG label="Class">{sel('class',ITEM_CLASSES)}</FG>
        <FG label="Subclass">{subclassSel()}</FG>
        <FG label="Quality">{sel('Quality',['0:Poor','1:Common','2:Uncommon','3:Rare','4:Epic','5:Legendary','6:Artifact','7:Heirloom'])}</FG>
        <FG label="Inventory Type">{sel('InventoryType',INVENTORY_TYPE_OPTIONS)}</FG>
        <FG label="Material">{sel('Material',MATERIAL_OPTIONS)}</FG>
      </div>

      <div>
        <h4 className="field-section-title">Display & Pricing</h4>
        <FG label="Display ID">{num('displayid')}</FG>
        <FG label="Item Level">{num('ItemLevel')}</FG>
        <FG label="Buy Price">{num('BuyPrice')}</FG>
        <FG label="Sell Price">{num('SellPrice')}</FG>
        <FG label="Buy Count">{num('BuyCount')}</FG>
      </div>

      {/* Requirements (full width) */}
      <div style={{gridColumn:'1/-1',borderTop:'1px solid var(--border)',paddingTop:'16px'}}>
        <h4 className="field-section-title">Requirements</h4>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
          <FG label="Required Level">{num('RequiredLevel')}</FG>
          <div /><div />
          <FG label={<>Allowable Class <span style={{color:'var(--text-muted)',fontWeight:400,textTransform:'none',letterSpacing:0}}>(-1 = all)</span></>}
            style={{gridColumn:'1/-1'}}>
            <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
              <input type="number" value={form.AllowableClass??-1} style={{width:'80px'}} onChange={e=>onChange('AllowableClass',Number(e.target.value))} />
              {bitmask('AllowableClass',ALLOWABLE_CLASS_BITS)}
            </div>
          </FG>
          <FG label={<>Allowable Race <span style={{color:'var(--text-muted)',fontWeight:400,textTransform:'none',letterSpacing:0}}>(-1 = all)</span></>}
            style={{gridColumn:'1/-1'}}>
            <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
              <input type="number" value={form.AllowableRace??-1} style={{width:'80px'}} onChange={e=>onChange('AllowableRace',Number(e.target.value))} />
              {bitmask('AllowableRace',ALLOWABLE_RACE_BITS)}
            </div>
          </FG>
        </div>
      </div>

      {/* Combat | Properties | Misc */}
      <div style={{borderTop:'1px solid var(--border)',paddingTop:'16px'}}>
        <h4 className="field-section-title">Combat</h4>
        <FG label="Armor">{num('armor')}</FG>
        <FG label="Speed (ms)">{num('delay')}</FG>
        <FG label="Ammo Type">{num('ammo_type')}</FG>
        <FG label="Min Dmg 1">{dec('dmg_min1')}</FG>
        <FG label="Max Dmg 1">{dec('dmg_max1')}</FG>
        <FG label="Dmg Type 1">{sel('dmg_type1',DMG_TYPE_OPTIONS)}</FG>
        <FG label="Min Dmg 2">{dec('dmg_min2')}</FG>
        <FG label="Max Dmg 2">{dec('dmg_max2')}</FG>
        <FG label="Dmg Type 2">{sel('dmg_type2',DMG_TYPE_OPTIONS)}</FG>
      </div>

      <div style={{borderTop:'1px solid var(--border)',paddingTop:'16px'}}>
        <h4 className="field-section-title">Properties</h4>
        <FG label="Flags">{flagsField('Flags',ITEM_FLAGS_BITS)}</FG>
        <FG label="Flags Extra">{flagsField('FlagsExtra',ITEM_FLAGS_EXTRA_BITS)}</FG>
      </div>

      <div style={{borderTop:'1px solid var(--border)',paddingTop:'16px'}}>
        <h4 className="field-section-title">Misc</h4>
        <FG label="Page Text">{num('PageText')}</FG>
        <FG label="Script Name">{txt('ScriptName')}</FG>
      </div>

      {/* Scaling (full width) */}
      <div style={{gridColumn:'1/-1',borderTop:'1px solid var(--border)',paddingTop:'16px'}}>
        <h4 className="field-section-title">Scaling <span style={{fontWeight:400,color:'var(--text-muted)',textTransform:'none',letterSpacing:0}}>(heirloom)</span></h4>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px'}}>
          <FG label="ScalingStatDistribution">{num('ScalingStatDistribution')}</FG>
          <FG label="ScalingStatValue">{num('ScalingStatValue')}</FG>
        </div>
      </div>

      {/* Stats (full width) */}
      <div style={{gridColumn:'1/-1',borderTop:'1px solid var(--border)',paddingTop:'16px'}}>
        <h4 className="field-section-title">Stats</h4>
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px'}}>
          {Array.from({length:10},(_,i)=>i+1).map(i=>(
            <div key={i}>
              <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:'4px'}}>Stat {i}</div>
              <select value={String(form[`stat_type${i}`]??0)} onChange={e=>onChange(`stat_type${i}`,e.target.value)} style={{width:'100%',marginBottom:'4px'}}>
                {STAT_TYPE_OPTIONS.map(o=>{const [v,...r]=o.split(':');return <option key={v} value={v}>{r.join(':')}</option>;})}
              </select>
              <input type="number" value={form[`stat_value${i}`]??0} onChange={e=>onChange(`stat_value${i}`,e.target.value)} style={{width:'100%'}} placeholder="Value" />
            </div>
          ))}
        </div>
      </div>

      {/* Spells (full width) */}
      <div style={{gridColumn:'1/-1',borderTop:'1px solid var(--border)',paddingTop:'16px'}}>
        <h4 className="field-section-title">Spell Effects</h4>
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'10px'}}>
          {[1,2,3,4,5].map(i=>(
            <div key={i}>
              <div style={{fontSize:'10px',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:'4px'}}>Spell {i}</div>
              <input type="number" value={form[`spellid_${i}`]??0} onChange={e=>onChange(`spellid_${i}`,e.target.value)} style={{width:'100%',marginBottom:'4px'}} placeholder="Spell ID" />
              <select value={String(form[`spelltrigger_${i}`]??0)} onChange={e=>onChange(`spelltrigger_${i}`,e.target.value)} style={{width:'100%',marginBottom:i===1?'4px':0}}>
                {SPELL_TRIGGER_OPTIONS.map(o=>{const [v,...r]=o.split(':');return <option key={v} value={v}>{r.join(':')}</option>;})}
              </select>
              {i===1 && <>
                <input type="number" value={form.spellcooldown_1??-1} onChange={e=>onChange('spellcooldown_1',e.target.value)} style={{width:'100%',marginBottom:'4px'}} placeholder="Cooldown (ms)" />
                <input type="number" value={form.spellcategorycooldown_1??-1} onChange={e=>onChange('spellcategorycooldown_1',e.target.value)} style={{width:'100%'}} placeholder="Cat. Cooldown (ms)" />
              </>}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function ItemEditorPage() {
  const { query, soapCommand, soapConfig, findNextId, idRanges } = useConnection();
  const [search, setSearch]     = useState('');
  const [items, setItems]       = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm]         = useState({});
  const [dirty, setDirty]       = useState(false);
  const unsavedGuard = useUnsavedGuard(dirty);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState(null);
  const [loading, setLoading]   = useState(false);
  const [copying, setCopying]   = useState(false);
  const [activeTab, setActiveTab] = useState('edit');
  const [scalingTab, setScalingTab] = useState(false); // tracks if scaling tab visited

  // Filters
  const [filterClass,    setFilterClass]    = useState('');
  const [filterSubclass, setFilterSubclass] = useState('');
  const [filterQuality,  setFilterQuality]  = useState('');

  // Bulk edit
  const [bulkField,    setBulkField]    = useState('stackable');
  const [bulkValue,    setBulkValue]    = useState('');
  const [bulkCount,    setBulkCount]    = useState(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkMsg,      setBulkMsg]      = useState(null);
  const [bulkConfirm,  setBulkConfirm]  = useState(false);

  // Create tab
  const [createForm,      setCreateForm]      = useState({ ...CREATE_DEFAULTS });
  const [createEntryId,   setCreateEntryId]   = useState(null);
  const [createIdLoading, setCreateIdLoading] = useState(false);
  const [createSaving,    setCreateSaving]    = useState(false);
  const [createMsg,       setCreateMsg]       = useState(null);

  const searchRef = useRef(null);
  const hasFilters = filterClass !== '' || filterSubclass !== '' || filterQuality !== '';

  const buildWhere = (term, fc, fsc, fq) => {
    const conditions = [], params = [];
    if (term) {
      if (/^\d+$/.test(term)) { conditions.push('entry = ?'); params.push(term); }
      else { conditions.push('`name` LIKE ?'); params.push(`%${term}%`); }
    }
    if (fc  !== '') { conditions.push('`class` = ?');  params.push(fc); }
    if (fsc !== '') { conditions.push('subclass = ?'); params.push(fsc); }
    if (fq  !== '') { conditions.push('Quality = ?');  params.push(fq); }
    return { conditions, params };
  };

  const searchItems = useCallback(async (term, fc, fsc, fq) => {
    setLoading(true);
    const { conditions, params } = buildWhere(term, fc, fsc, fq);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(
      `SELECT entry, \`name\`, \`class\`, Quality, ItemLevel, RequiredLevel FROM item_template ${where} ORDER BY entry DESC LIMIT 50`,
      params
    );
    setItems(result.data || []);
    setLoading(false);
  }, [query]);

  const fetchBulkCount = useCallback(async (fc, fsc, fq) => {
    if (fc==='' && fsc==='' && fq==='') { setBulkCount(null); return; }
    const { conditions, params } = buildWhere('', fc, fsc, fq);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await query(`SELECT COUNT(*) AS cnt FROM item_template ${where}`, params);
    setBulkCount(result.data?.[0]?.cnt ?? 0);
  }, [query]);

  useEffect(() => { searchItems('','','',''); }, []);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    searchItems(search, filterClass, filterSubclass, filterQuality);
    fetchBulkCount(filterClass, filterSubclass, filterQuality);
    setBulkMsg(null); setBulkConfirm(false);
  }, [filterClass, filterSubclass, filterQuality]);

  const handleFilterClass = (val) => { setFilterClass(val); setFilterSubclass(''); };

  const selectItem = async (entry) => {
    const result = await query('SELECT * FROM item_template WHERE entry = ?', [entry]);
    if (result.data?.[0]) {
      const item = result.data[0];
      setSelected(item);
      setForm(item);
      setDirty(false);
      setMsg(null);
      if (Number(item.Quality) !== 7) setActiveTab(t => t === 'scaling' ? 'edit' : t);
    }
  };

  const handleEditChange  = (key, val) => { setForm(f=>({...f,[key]:val})); setDirty(true); };
  const handleCreateChange = (key, val) => setCreateForm(f=>({...f,[key]:val}));

  // Switch to Create tab — fetch next ID if not yet done
  const openCreateTab = async () => {
    setActiveTab('create');
    setCreateMsg(null);
    if (!createEntryId) {
      setCreateIdLoading(true);
      const res = await findNextId({ table:'item_template', idColumn:'entry', startId: idRanges.item });
      if (res.success) setCreateEntryId(res.nextId);
      setCreateIdLoading(false);
    }
  };

  // Load selected item as template for create form
  const handleUseAsTemplate = () => {
    if (!selected) return;
    const { entry, ...rest } = selected;
    setCreateForm({ ...rest, name: `${selected.name} (copy)` });
    setCreateMsg(null);
  };

  const handleCreateReset = () => {
    setCreateForm({ ...CREATE_DEFAULTS });
    setCreateMsg(null);
  };

  const handleCreate = async () => {
    if (!createEntryId || !createForm.name?.trim()) {
      setCreateMsg({ type:'error', text:'Naam is verplicht.' });
      return;
    }
    setCreateSaving(true);
    setCreateMsg(null);
    try {
      const data   = { ...createForm, entry: createEntryId };
      const fields = Object.keys(data);
      const cols   = fields.map(k=>`\`${k}\``).join(', ');
      const vals   = fields.map(k=>data[k]);
      const result = await query(
        `INSERT INTO item_template (${cols}) VALUES (${fields.map(()=>'?').join(', ')})`,
        vals
      );
      if (!result.success) throw new Error(result.error);
      if (soapConfig?.user) await soapCommand('.reload item_template');

      // Switch to Edit and select the new item
      await searchItems(search, filterClass, filterSubclass, filterQuality);
      await selectItem(createEntryId);
      setActiveTab('edit');
      setMsg({ type:'success', text:`✓ Item #${createEntryId} aangemaakt` });

      // Reset create state for next item
      setCreateEntryId(null);
      setCreateForm({ ...CREATE_DEFAULTS });
    } catch (e) {
      setCreateMsg({ type:'error', text:`✗ ${e.message}` });
    }
    setCreateSaving(false);
  };

  const handleCopy = async () => {
    if (!selected) return;
    setCopying(true); setMsg(null);
    try {
      const idResult = await findNextId({ table:'item_template', idColumn:'entry', startId:idRanges.item });
      if (!idResult.success) throw new Error(idResult.error);
      const newId  = idResult.nextId;
      const fields = Object.keys(selected);
      const result = await query(
        `INSERT INTO item_template (${fields.map(k=>`\`${k}\``).join(', ')}) VALUES (${fields.map(()=>'?').join(', ')})`,
        fields.map(k=>k==='entry'?newId:selected[k])
      );
      if (!result.success) throw new Error(result.error);
      await searchItems(search, filterClass, filterSubclass, filterQuality);
      await selectItem(newId);
      setMsg({ type:'success', text:`✓ Gekloond naar entry #${newId}` });
    } catch (e) {
      setMsg({ type:'error', text:`✗ Klonen mislukt: ${e.message}` });
    }
    setCopying(false);
  };

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      const fields = Object.keys(form).filter(k=>k!=='entry');
      const result = await query(
        `UPDATE item_template SET ${fields.map(k=>`\`${k}\` = ?`).join(', ')} WHERE entry = ?`,
        [...fields.map(k=>form[k]), form.entry]
      );
      if (result.success) {
        setSelected(form); setDirty(false);
        if (soapConfig?.user) { await soapCommand('.reload item_template'); setMsg({ type:'success', text:`Saved & reloaded item ${form.entry}` }); }
        else setMsg({ type:'success', text:`Saved item ${form.entry}.` });
        searchItems(search, filterClass, filterSubclass, filterQuality);
      } else {
        setMsg({ type:'error', text:result.error });
      }
    } catch (e) { setMsg({ type:'error', text:e.message }); }
    setSaving(false);
  };

  const handleBulkApply = async () => {
    if (!bulkConfirm) { setBulkConfirm(true); return; }
    if (!hasFilters || bulkValue==='') return;
    setBulkApplying(true); setBulkMsg(null);
    try {
      const { conditions, params } = buildWhere('', filterClass, filterSubclass, filterQuality);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await query(`UPDATE item_template SET \`${bulkField}\` = ? ${where}`, [bulkValue, ...params]);
      if (!result.success) throw new Error(result.error);
      if (soapConfig?.user) await soapCommand('.reload item_template');
      setBulkMsg({ type:'success', text:`✓ ${bulkCount} items bijgewerkt` });
      setBulkConfirm(false);
      searchItems(search, filterClass, filterSubclass, filterQuality);
    } catch (e) { setBulkMsg({ type:'error', text:`✗ ${e.message}` }); }
    setBulkApplying(false);
  };

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey||e.metaKey) && e.key==='s') {
        e.preventDefault();
        if (activeTab==='edit' && dirty && selected) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, dirty, selected, form]);

  const subclassOpts = SUBCLASS_OPTIONS[Number(filterClass)] || [];
  const tooltipForm  = activeTab === 'create' ? createForm : form;

  return (
    <>
      {unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
      <div className="editor-page-header">
        <h2 className="editor-page-title">Item Editor</h2>
        <p className="editor-page-subtitle">Manage item templates and properties</p>
      </div>
      <div className="editor-layout">

        {/* ── List panel ── */}
        <div className="editor-list" style={{width:'300px'}}>
          <div className="editor-list-header" style={{flexDirection:'column',gap:'6px'}}>
            <div className="search-box">
              <Search size={13} />
              <input ref={searchRef} placeholder="Search name or entry..." value={search}
                onChange={e=>{ setSearch(e.target.value); searchItems(e.target.value,filterClass,filterSubclass,filterQuality); }} />
            </div>
            <div style={{display:'flex',gap:'4px'}}>
              <select value={filterClass} onChange={e=>handleFilterClass(e.target.value)}
                style={{flex:1,fontSize:'12px',padding:'4px 6px',background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)'}}>
                <option value=''>All classes</option>
                {ITEM_CLASSES.map(o=>{const [v,...r]=o.split(':');return <option key={v} value={v}>{r.join(':')}</option>;})}
              </select>
              {subclassOpts.length>0 && (
                <select value={filterSubclass} onChange={e=>setFilterSubclass(e.target.value)}
                  style={{flex:1,fontSize:'12px',padding:'4px 6px',background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)'}}>
                  <option value=''>All</option>
                  {subclassOpts.map(o=>{const [v,...r]=o.split(':');return <option key={v} value={v}>{r.join(':')}</option>;})}
                </select>
              )}
            </div>
            <select value={filterQuality} onChange={e=>setFilterQuality(e.target.value)}
              style={{fontSize:'12px',padding:'4px 6px',background:'var(--bg-dark)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)'}}>
              <option value=''>All qualities</option>
              {QUALITY_LABELS.map((lbl,i)=><option key={i} value={i} style={{color:QUALITY_COLORS[i]}}>{lbl}</option>)}
            </select>
            {hasFilters && (
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:'11px',color:'var(--gold)'}}>
                <span>{bulkCount!==null?`${bulkCount} items totaal`:'Filter actief'}</span>
                <button style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'11px',padding:'0'}}
                  onClick={()=>{setFilterClass('');setFilterSubclass('');setFilterQuality('');}}>
                  ✕ reset
                </button>
              </div>
            )}
          </div>

          <div className="list-items">
            {loading && <div className="loading-text">Searching...</div>}
            {!loading && items.map(item=>(
              <div key={item.entry} className={`list-item ${selected?.entry===item.entry?'active':''}`}
                onClick={()=>selectItem(item.entry)}>
                <div className="list-item-main">
                  <span className="list-item-name" style={{color:QUALITY_COLORS[item.Quality]||'#fff'}}>{item.name}</span>
                  <ChevronRight size={12} className="list-item-arrow" />
                </div>
                <div className="list-item-meta">
                  <span className="mono">#{item.entry}</span>
                  <span>iLvl {item.ItemLevel}</span>
                  <span style={{color:QUALITY_COLORS[item.Quality]}}>{QUALITY_LABELS[item.Quality]||'?'}</span>
                </div>
              </div>
            ))}
            {!loading && items.length===0 && <div className="loading-text">No results</div>}
          </div>

          {/* Bulk edit */}
          {hasFilters && (
            <div style={{borderTop:'1px solid var(--border)',padding:'12px',background:'var(--bg-dark)',flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'8px'}}>
                <Zap size={12} style={{color:'var(--gold)'}} />
                <span style={{fontSize:'11px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.5px',color:'var(--gold)'}}>Bulk Edit</span>
                {bulkCount!==null && <span style={{fontSize:'11px',color:'var(--text-muted)',marginLeft:'auto'}}>{bulkCount} items</span>}
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                <select value={bulkField} onChange={e=>{setBulkField(e.target.value);setBulkConfirm(false);setBulkMsg(null);}}
                  style={{fontSize:'12px',padding:'5px 8px',background:'var(--bg-panel)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)'}}>
                  {BULK_FIELDS.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
                <input type="number" placeholder="Nieuwe waarde..." value={bulkValue}
                  onChange={e=>{setBulkValue(e.target.value);setBulkConfirm(false);setBulkMsg(null);}}
                  style={{fontSize:'12px',padding:'5px 8px',background:'var(--bg-panel)',border:'1px solid var(--border)',borderRadius:'var(--radius-sm)',color:'var(--text-primary)'}} />
                <button onClick={handleBulkApply} disabled={bulkApplying||bulkValue===''||bulkCount===0}
                  style={{padding:'6px 10px',fontSize:'12px',fontWeight:600,background:bulkConfirm?'rgba(204,74,74,0.2)':'rgba(200,169,110,0.15)',border:`1px solid ${bulkConfirm?'rgba(204,74,74,0.5)':'rgba(200,169,110,0.3)'}`,borderRadius:'var(--radius-sm)',color:bulkConfirm?'#ee7070':'var(--gold)',cursor:bulkValue===''||bulkCount===0?'not-allowed':'pointer',opacity:bulkApplying?0.6:1}}>
                  {bulkApplying?'Bezig...':bulkConfirm?`⚠ Bevestig: ${bulkCount} items`:`Apply → ${bulkCount??'?'} items`}
                </button>
                {bulkMsg && (
                  <div style={{fontSize:'11px',padding:'4px 8px',borderRadius:'var(--radius-sm)',background:bulkMsg.type==='success'?'rgba(74,170,106,0.1)':'rgba(204,74,74,0.1)',border:`1px solid ${bulkMsg.type==='success'?'rgba(74,170,106,0.3)':'rgba(204,74,74,0.3)'}`,color:bulkMsg.type==='success'?'#6dca88':'#ee7070'}}>
                    {bulkMsg.text}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Form panel ── */}
        <div className="editor-form">

          {/* Tab bar */}
          <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'var(--bg-panel)',flexShrink:0}}>
            <button className={`creature-subtab ${activeTab==='edit'?'active':''}`} onClick={()=>setActiveTab('edit')}>
              Edit
            </button>
            <button className={`creature-subtab ${activeTab==='create'?'active':''}`} onClick={openCreateTab}>
              <Plus size={12} style={{marginRight:'4px'}} /> Create New
            </button>
            <button className={`creature-subtab ${activeTab==='scaling'?'active':''} ${Number(selected?.Quality)!==7?'locked':''}`}
              onClick={()=>{ if(Number(selected?.Quality)===7){ setActiveTab('scaling'); setScalingTab(true); } }}
              title={Number(selected?.Quality)===7 ? 'Heirloom scaling configureren' : 'Alleen beschikbaar voor Heirloom items'}>
              <Layers size={12} style={{marginRight:'4px'}} /> Scaling
            </button>
          </div>

          {activeTab === 'edit' ? (
            /* ── Edit tab ── */
            !selected ? (
              <div className="editor-empty">
                <MousePointerClick />
                <p>Select an item to edit</p>
              </div>
            ) : (
              <>
                <div className="page-header">
                  <div>
                    <h1 className="page-title" style={{color:QUALITY_COLORS[selected.Quality]||'var(--gold-bright)'}}>
                      {selected.name}{dirty&&<span style={{color:'var(--gold)',marginLeft:'8px'}}>●</span>}
                    </h1>
                    <p className="page-sub">Entry #{selected.entry} · item_template</p>
                  </div>
                  <div className="header-actions">
                    {dirty && <button className="btn-ghost" onClick={()=>{setForm(selected);setDirty(false);}}><RotateCcw size={13}/> Reset</button>}
                    <button className="btn-ghost" onClick={handleCopy} disabled={copying}><Copy size={13}/> {copying?'Klonen...':'Copy'}</button>
                    <button className="btn-primary" onClick={handleSave} disabled={saving||!dirty}><Save size={13}/> {saving?'Saving...':'Save & Reload'}</button>
                  </div>
                </div>
                {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}
                {Number(form.Quality)===7 && (
                  <div style={{padding:'4px 28px 0',fontSize:'11px',color:'var(--gold)'}}>
                    Heirloom —{' '}
                    <button style={{background:'none',border:'none',color:'var(--gold)',cursor:'pointer',fontSize:'11px',padding:0,textDecoration:'underline'}}
                      onClick={()=>setActiveTab('scaling')}>
                      configureer scaling →
                    </button>
                  </div>
                )}
                <div className="field-group" style={{padding:'0 28px 0',marginTop:'4px'}}>
                  <label style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.5px',color:'var(--text-muted)'}}>Entry</label>
                  <input type="number" value={form.entry??''} readOnly style={{width:'120px'}} />
                </div>
                <ItemFormFields form={form} onChange={handleEditChange} />
              </>
            )
          ) : (
            /* ── Create tab ── */
            <div>
              <div className="page-header">
                <div>
                  <h1 className="page-title" style={{color:'var(--gold-bright)'}}>
                    Create New Item
                  </h1>
                  <p className="page-sub">
                    Entry: {createIdLoading ? 'Loading...' : createEntryId ? `#${createEntryId}` : '—'}
                  </p>
                </div>
                <div className="header-actions">
                  {selected && (
                    <button className="btn-ghost" onClick={handleUseAsTemplate} title={`Laad "${selected.name}" als template`}>
                      <ClipboardCopy size={13} /> Use selected as template
                    </button>
                  )}
                  <button className="btn-ghost" onClick={handleCreateReset}>
                    <RotateCcw size={13} /> Blank
                  </button>
                  <button className="btn-primary" onClick={handleCreate} disabled={createSaving||createIdLoading||!createEntryId}>
                    <Plus size={13} /> {createSaving ? 'Aanmaken...' : 'Create'}
                  </button>
                </div>
              </div>

              {!selected && (
                <div className="editor-msg info" style={{margin:'0 28px 0'}}>
                  Tip: selecteer een item in de lijst en gebruik "Use selected as template" om snel een variatie te maken.
                </div>
              )}
              {createMsg && <div className={`editor-msg ${createMsg.type}`}>{createMsg.text}</div>}

              <ItemFormFields form={createForm} onChange={handleCreateChange} />
            </div>
          )}
          {activeTab === 'scaling' && (
            selected ? (
              <ItemScalingTab
                editForm={form}
                onItemFieldChange={handleEditChange}
              />
            ) : (
              <div className="editor-empty">
                <Layers />
                <p>Selecteer een item om scaling te configureren</p>
              </div>
            )
          )}

        </div>

        {/* ── Tooltip panel ── */}
        <div style={{width:'260px',flexShrink:0,borderLeft:'1px solid var(--border)',background:'var(--bg-panel)',overflowY:'auto',display:'flex',flexDirection:'column'}}>
          {(selected || activeTab==='create') ? (
            <>
              <div style={{padding:'10px 12px',borderBottom:'1px solid var(--border)',fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'1px',color:'var(--text-muted)'}}>
                Preview {activeTab==='create'&&<span style={{color:'var(--gold)',fontWeight:400,textTransform:'none'}}>(new)</span>}
              </div>
              <div style={{padding:'12px'}}>
                <ItemTooltip form={tooltipForm} />
              </div>
            </>
          ) : (
            <div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-muted)',fontSize:'12px',padding:'20px',textAlign:'center'}}>
              Select an item to see the tooltip preview
            </div>
          )}
        </div>

      </div>
    </>
  );
}
