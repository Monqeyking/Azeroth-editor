import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Search, Save, RotateCcw, ChevronRight, MousePointerClick, Copy, Wand2, X } from 'lucide-react';
import './DashboardPage.css';
import './EditorPage.css';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';

const SPELL_CLASS_SET = { 0:'Generic',3:'Mage',4:'Warrior',5:'Warlock',6:'Priest',7:'Druid',8:'Rogue',9:'Hunter',10:'Paladin',11:'Shaman',13:'Potion',14:'Death Knight',16:'Pet' };
const SCHOOL_MASK_BITS = { 1:'Physical',2:'Holy',4:'Fire',8:'Nature',16:'Frost',32:'Shadow',64:'Arcane' };
const SPELL_EFFECTS = {
  0:'None',1:'Instant Kill',2:'School Damage',3:'Dummy',4:'Portal Teleport',5:'Teleport Units',
  6:'Apply Aura',7:'Environmental Damage',8:'Power Drain',9:'Health Leech',10:'Heal',
  11:'Bind',12:'Portal',13:'Ritual Base',14:'Ritual Specialize',15:'Ritual Activate Portal',
  16:'Quest Complete',17:'Weapon Damage +',18:'Resurrect',19:'Add Extra Attacks',20:'Dodge',
  21:'Evade',22:'Parry',23:'Block',24:'Create Item',25:'Weapon',26:'Defense',
  27:'Persistent Area Aura',28:'Summon',29:'Leap',30:'Energize',31:'Weapon % Damage',
  32:'Trigger Missile',33:'Open Lock',34:'Summon Change Item',35:'Apply Area Aura Party',
  36:'Learn Spell',37:'Spell Defense',38:'Dispel',39:'Language',40:'Dual Wield',
  41:'Jump',42:'Jump (dest)',43:'Teleport Units Face Caster',44:'Skill Step',
  45:'Add Honor',46:'Spawn',47:'Trade Skill',48:'Stealth',49:'Detect',50:'Trans Door',
  51:'Force Critical Hit',52:'Guarantee Hit',53:'Enchant Item',54:'Enchant Item Temporary',
  55:'Tame Creature',56:'Summon Pet',57:'Learn Pet Spell',58:'Weapon Damage',
  59:'Create Random Item',60:'Proficiency',61:'Send Event',62:'Power Burn',63:'Threat',
  64:'Trigger Spell',65:'Apply Area Aura Raid',66:'Create Mana Gem',67:'Heal Max Health',
  68:'Interrupt Cast',69:'Distract',70:'Pull',71:'Pickpocket',72:'Add Farsight',
  73:'Untrain Talents',74:'Apply Glyph',75:'Heal Mechanical',76:'Summon Object Wild',
  77:'Script Effect',78:'Attack',79:'Sanctuary',80:'Add Combo Points',
  82:'Bind Sight',83:'Duel',84:'Stuck',85:'Summon Player',86:'Activate Object',
  87:'Gameobject Damage',88:'Gameobject Repair',89:'Gameobject Set Destruction State',
  90:'Kill Credit',91:'Threat All',92:'Enchant Held Item',93:'Force Deselect',
  94:'Self Resurrect',95:'Skinning',96:'Charge',97:'Cast Button',98:'Knock Back',
  99:'Disenchant',100:'Inebriate',101:'Feed Pet',102:'Dismiss Pet',103:'Reputation',
  104:'Summon Object Slot1',105:'Summon Object Slot2',106:'Summon Object Slot3',107:'Summon Object Slot4',
  108:'Dispel Mechanic',109:'Resurrect Pet',110:'Destroy All Totems',111:'Durability Damage',
  113:'Resurrect New',114:'Attack Me',115:'Durability Damage %',116:'Skin Player Corpse',
  117:'Spirit Heal',118:'Skill',119:'Apply Area Aura Pet',120:'Teleport Graveyard',
  121:'Normalized Weapon Dmg',123:'Send Taxi',124:'Pull Towards',125:'Modify Threat %',
  126:'Steal Beneficial Buff',127:'Prospecting',128:'Apply Area Aura Friend',
  129:'Apply Area Aura Enemy',130:'Redirect Threat',131:'Play Sound',132:'Play Music',
  133:'Unlearn Specialization',134:'Kill Credit 2',
};
const SPELL_AURAS = {
  0:'None',
  1:'Bind Sight',
  2:'Mod Possess',
  3:'Periodic Damage',
  4:'Dummy',
  5:'Mod Confuse',
  6:'Mod Charm',
  7:'Mod Fear',
  8:'Periodic Heal',
  9:'Mod Attackspeed',
  10:'Mod Threat',
  11:'Mod Taunt',
  12:'Mod Stun',
  13:'Mod Damage Done',
  14:'Mod Damage Taken',
  15:'Damage Shield',
  16:'Mod Stealth',
  17:'Mod Stealth Detect',
  18:'Mod Invisibility',
  19:'Mod Invisibility Detect',
  20:'Obs Mod Health',
  21:'Obs Mod Power',
  22:'Mod Resistance',
  23:'Periodic Trigger Spell',
  24:'Periodic Energize',
  25:'Mod Pacify',
  26:'Mod Root',
  27:'Mod Silence',
  28:'Reflect Spells',
  29:'Mod Stat',
  30:'Mod Skill',
  31:'Mod Increase Speed',
  32:'Mod Increase Mounted Speed',
  33:'Mod Decrease Speed',
  34:'Mod Increase Health',
  35:'Mod Increase Energy',
  36:'Mod Shapeshift',
  37:'Effect Immunity',
  38:'State Immunity',
  39:'School Immunity',
  40:'Damage Immunity',
  41:'Dispel Immunity',
  42:'Proc Trigger Spell',
  43:'Proc Trigger Damage',
  44:'Track Creatures',
  45:'Track Resources',
  47:'Mod Parry Percent',
  48:'Periodic Trigger Spell From Client',
  49:'Mod Dodge Percent',
  50:'Mod Critical Healing Amount',
  51:'Mod Block Percent',
  52:'Mod Weapon Crit Percent',
  53:'Periodic Leech',
  54:'Mod Hit Chance',
  55:'Mod Spell Hit Chance',
  56:'Transform',
  57:'Mod Spell Crit Chance',
  58:'Mod Increase Swim Speed',
  59:'Mod Damage Done Creature',
  60:'Mod Pacify Silence',
  61:'Mod Scale',
  62:'Periodic Health Funnel',
  64:'Periodic Mana Leech',
  65:'Mod Casting Speed Not Stack',
  66:'Feign Death',
  67:'Mod Disarm',
  68:'Mod Stalked',
  69:'School Absorb',
  70:'Extra Attacks',
  71:'Mod Spell Crit Chance School',
  72:'Mod Power Cost School Pct',
  73:'Mod Power Cost School',
  74:'Reflect Spells School',
  75:'Mod Language',
  76:'Far Sight',
  77:'Mechanic Immunity',
  78:'Mounted',
  79:'Mod Damage Percent Done',
  80:'Mod Percent Stat',
  81:'Split Damage Pct',
  82:'Water Breathing',
  83:'Mod Base Resistance',
  84:'Mod Regen',
  85:'Mod Power Regen',
  86:'Channel Death Item',
  87:'Mod Damage Percent Taken',
  88:'Mod Health Regen Percent',
  89:'Periodic Damage Percent',
  91:'Mod Detect Range',
  92:'Prevents Fleeing',
  93:'Mod Unattackable',
  94:'Interrupt Regen',
  95:'Ghost',
  96:'Spell Magnet',
  97:'Mana Shield',
  98:'Mod Skill Talent',
  99:'Mod Attack Power',
  100:'Auras Visible',
  101:'Mod Resistance Pct',
  102:'Mod Melee Attack Power Versus',
  103:'Mod Total Threat',
  104:'Water Walk',
  105:'Feather Fall',
  106:'Hover',
  107:'Add Flat Modifier',
  108:'Add Pct Modifier',
  109:'Add Target Trigger',
  110:'Mod Power Regen Percent',
  111:'Add Caster Hit Trigger',
  112:'Override Class Scripts',
  113:'Mod Ranged Damage Taken',
  114:'Mod Ranged Damage Taken Pct',
  115:'Mod Healing',
  116:'Mod Regen During Combat',
  117:'Mod Mechanic Resistance',
  118:'Mod Healing Pct',
  120:'Untrackable',
  121:'Empathy',
  122:'Mod Offhand Damage Pct',
  123:'Mod Target Resistance',
  124:'Mod Ranged Attack Power',
  125:'Mod Melee Damage Taken',
  126:'Mod Melee Damage Taken Pct',
  127:'Ranged Attack Power Attacker Bonus',
  128:'Mod Possess Pet',
  129:'Mod Speed Always',
  130:'Mod Mounted Speed Always',
  131:'Mod Ranged Attack Power Versus',
  132:'Mod Increase Energy Percent',
  133:'Mod Increase Health Percent',
  134:'Mod Mana Regen Interrupt',
  135:'Mod Healing Done',
  136:'Mod Healing Done Percent',
  137:'Mod Total Stat Percentage',
  138:'Mod Melee Haste',
  139:'Force Reaction',
  140:'Mod Ranged Haste',
  141:'Mod Ranged Ammo Haste',
  142:'Mod Base Resistance Pct',
  143:'Mod Resistance Exclusive',
  144:'Safe Fall',
  145:'Mod Pet Talent Points',
  146:'Allow Tame Pet Type',
  147:'Mechanic Immunity Mask',
  148:'Retain Combo Points',
  149:'Reduce Pushback',
  150:'Mod Shield Blockvalue Pct',
  151:'Track Stealthed',
  152:'Mod Detected Range',
  153:'Split Damage Flat',
  154:'Mod Stealth Level',
  155:'Mod Water Breathing',
  156:'Mod Reputation Gain',
  157:'Pet Damage Multi',
  158:'Mod Shield Blockvalue',
  159:'No Pvp Credit',
  160:'Mod Aoe Avoidance',
  161:'Mod Health Regen In Combat',
  162:'Power Burn',
  163:'Mod Crit Damage Bonus',
  165:'Melee Attack Power Attacker Bonus',
  166:'Mod Attack Power Pct',
  167:'Mod Ranged Attack Power Pct',
  168:'Mod Damage Done Versus',
  169:'Mod Crit Percent Versus',
  170:'Detect Amore',
  171:'Mod Speed Not Stack',
  172:'Mod Mounted Speed Not Stack',
  174:'Mod Spell Damage Of Stat Percent',
  175:'Mod Spell Healing Of Stat Percent',
  176:'Spirit Of Redemption',
  177:'Aoe Charm',
  178:'Mod Debuff Resistance',
  179:'Mod Attacker Spell Crit Chance',
  180:'Mod Flat Spell Damage Versus',
  182:'Mod Resistance Of Stat Percent',
  183:'Mod Critical Threat',
  184:'Mod Attacker Melee Hit Chance',
  185:'Mod Attacker Ranged Hit Chance',
  186:'Mod Attacker Spell Hit Chance',
  187:'Mod Attacker Melee Crit Chance',
  188:'Mod Attacker Ranged Crit Chance',
  189:'Mod Rating',
  190:'Mod Faction Reputation Gain',
  191:'Use Normal Movement Speed',
  192:'Mod Melee Ranged Haste',
  193:'Melee Slow',
  194:'Mod Target Absorb School',
  195:'Mod Target Ability Absorb School',
  196:'Mod Cooldown',
  197:'Mod Attacker Spell And Weapon Crit Chance',
  199:'Mod Increases Spell Pct To Hit',
  200:'Mod Xp Pct',
  201:'Fly',
  202:'Ignore Combat Result',
  203:'Mod Attacker Melee Crit Damage',
  204:'Mod Attacker Ranged Crit Damage',
  205:'Mod School Crit Dmg Taken',
  206:'Mod Increase Flight Speed',
  207:'Mod Increase Mounted Flight Speed',
  208:'Mod Flight Speed Always',
  209:'Mod Mounted Flight Speed Always',
  210:'Mod Flight Speed Not Stacking',
  211:'Mod Flight Speed Mounted Not Stacking',
  212:'Mod Ranged Attack Power Of Stat Percent',
  213:'Mod Rage From Damage Dealt',
  215:'Arena Preparation',
  216:'Haste Spells',
  217:'Mod Melee Haste 2',
  218:'Haste Ranged',
  219:'Mod Mana Regen From Stat',
  220:'Mod Rating From Stat',
  221:'Mod Detaunt',
  223:'Raid Proc From Charge',
  225:'Raid Proc From Charge With Value',
  226:'Periodic Dummy',
  227:'Periodic Trigger Spell With Value',
  228:'Detect Stealth',
  229:'Mod Aoe Damage Avoidance',
  231:'Proc Trigger Spell With Value',
  232:'Mechanic Duration Mod',
  233:'Change Model For All Humanoids',
  234:'Mechanic Duration Mod Not Stack',
  235:'Mod Dispel Resist',
  236:'Control Vehicle',
  237:'Mod Spell Damage Of Attack Power',
  238:'Mod Spell Healing Of Attack Power',
  239:'Mod Scale 2',
  240:'Mod Expertise',
  241:'Force Move Forward',
  242:'Mod Spell Damage From Healing',
  243:'Mod Faction',
  244:'Comprehend Language',
  245:'Mod Aura Duration By Dispel',
  246:'Mod Aura Duration By Dispel Not Stack',
  247:'Clone Caster',
  248:'Mod Combat Result Chance',
  249:'Convert Rune',
  250:'Mod Increase Health 2',
  251:'Mod Enemy Dodge',
  252:'Mod Speed Slow All',
  253:'Mod Block Crit Chance',
  254:'Mod Disarm Offhand',
  255:'Mod Mechanic Damage Taken Percent',
  256:'No Reagent Use',
  257:'Mod Target Resist By Spell Class',
  259:'Mod Hot Pct',
  260:'Screen Effect',
  261:'Phase',
  262:'Ability Ignore Aurastate',
  263:'Allow Only Ability',
  267:'Mod Immune Aura Apply School',
  268:'Mod Attack Power Of Stat Percent',
  269:'Mod Ignore Target Resist Modifiers',
  270:'Mod Ability Ignore Target Resist',
  271:'Mod Damage From Caster',
  272:'Ignore Melee Reset',
  273:'X Ray',
  274:'Ability Consume No Ammo',
  275:'Mod Ignore Shapeshift',
  276:'Mod Damage Done For Mechanic',
  277:'Mod Max Affected Targets',
  278:'Mod Disarm Ranged',
  279:'Initialize Images',
  280:'Mod Armor Penetration Pct',
  281:'Mod Honor Gain Pct',
  282:'Mod Base Health Pct',
  283:'Mod Healing Received',
  284:'Linked',
  285:'Mod Attack Power Of Armor',
  286:'Ability Periodic Crit',
  287:'Deflect Spells',
  288:'Ignore Hit Direction',
  289:'Prevent Durability Loss',
  290:'Mod Crit Pct',
  291:'Mod Xp Quest Pct',
  292:'Open Stable',
  293:'Override Spells',
  294:'Prevent Regenerate Power',
  296:'Set Vehicle Id',
  297:'Block Spell Family',
  298:'Strangulate',
  300:'Share Damage Pct',
  301:'School Heal Absorb',
  303:'Mod Damage Done Versus Aurastate',
  304:'Mod Fake Inebriate',
  305:'Mod Minimum Speed',
  307:'Heal Absorb Test',
  308:'Mod Crit Chance For Caster',
  310:'Mod Creature Aoe Damage Avoidance',
  314:'Prevent Resurrection',
  315:'Underwater Walking',
  316:'Periodic Haste',
};
const ATTRIBUTES_FLAGS = {
  0:'UNK0',1:'Req Ammo',2:'On Next Swing',3:'Is Replenishment',4:'Ability',
  5:'Trade Spell',6:'Passive',7:'Hidden Client Side',8:'Hidden Spell Book',
  9:'UNK9 (Ignore Damage Reduction?)',10:'Targets Dead',11:'Outdoors Only',
  12:'Daytime Only',13:'Night Only',14:'Indoors Only',15:'Outdoors Only',
  16:'Not Usable While Shapeshifted',17:'Only Usable in Stealth',18:"Don't Affect Sheath State",
  19:'Scale with Caster Level',20:'Stop Attacking After Cast',21:'Prevent Physical Avoidance',
  22:'Auto-face Target During Cast',23:'Castable While Dead',24:'Castable While Mounted',
  25:'Cooldown Starts on Expiry',26:'Negative Spell',27:'Castable While Sitting',
  28:'Cannot Use in Combat',29:'Pierce Invulnerability',30:'Periodic Resistance Checks',
  31:'Aura Cannot Be Cancelled',
};
const ATTRIBUTES_EX_FLAGS = {
  0:'Dismiss Pet on Cast',1:'Drain All Power',2:'Channeled (type 1)',
  3:'Ignore Redirection (Grounding Totem)',4:'UNK4',5:'Does Not Break Stealth',
  6:'Channeled (type 2)',7:'Ignore Reflection Effects',8:'Target Cannot Be in Combat',
  9:'Starts Auto-attack',10:'No Threat / No Aggro',11:"Aura Won't Refresh Duration on Recast",
  12:'Pickpocket',13:'Farsight Aura',14:'Track Target While Channeling',
  15:'Immunity Cancels Preapplied Auras',16:'Unaffected by School Immunities',
  17:'Cannot Be Autocast by Pet',18:'Prevents Anim (NYI)',19:'Cannot Be Self-cast',
  20:'Req Combo Points (type 1)',21:'UNK21',22:'Req Combo Points (type 2)',23:'UNK23',
  24:'Fishing',25:'UNK25',26:'Require All Targets',27:'UNK27 (Melee spell?)',
  28:'Hide in Aura Bar',29:'Show Spell Name During Channel',30:'Enable at Dodge',31:'UNK31',
};

const SKILL_LINE_OPTIONS = {
  1:  [{ id: 26,  label: 'General' }, { id: 100, label: 'Arms' }, { id: 256, label: 'Fury' }, { id: 257, label: 'Protection' }],
  2:  [{ id: 594, label: 'General' }, { id: 317, label: 'Holy' }, { id: 267, label: 'Protection' }, { id: 184, label: 'Retribution' }],
  3:  [{ id: 50,  label: 'General' }, { id: 163, label: 'Beast Mastery' }, { id: 164, label: 'Marksmanship' }, { id: 165, label: 'Survival' }],
  4:  [{ id: 253, label: 'General' }, { id: 182, label: 'Assassination' }, { id: 181, label: 'Combat' }, { id: 183, label: 'Subtlety' }],
  5:  [{ id: 56,  label: 'General' }, { id: 78,  label: 'Discipline' }, { id: 613, label: 'Holy' }, { id: 236, label: 'Shadow' }],
  6:  [{ id: 770, label: 'General' }, { id: 398, label: 'Blood' }, { id: 399, label: 'Frost' }, { id: 400, label: 'Unholy' }],
  7:  [{ id: 261, label: 'General' }, { id: 373, label: 'Elemental' }, { id: 374, label: 'Enhancement' }, { id: 375, label: 'Restoration' }],
  8:  [{ id: 6,   label: 'General' }, { id: 237, label: 'Arcane' }, { id: 8,   label: 'Fire' }, { id: 454, label: 'Frost' }],
  9:  [{ id: 593, label: 'General' }, { id: 355, label: 'Affliction' }, { id: 354, label: 'Demonology' }, { id: 356, label: 'Destruction' }],
  11: [{ id: 574, label: 'General' }, { id: 134, label: 'Balance' }, { id: 573, label: 'Feral Combat' }, { id: 572, label: 'Restoration' }],
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

const SPELL_FIELDS = [
  { key: 'ID',                       label: 'Entry',              type: 'number',  readonly: true },
  { key: 'Name_Lang_enUS',           label: 'Name (enUS)',        type: 'text' },
  { key: 'NameSubtext_Lang_enUS',    label: 'Subtext',            type: 'text' },
  { key: 'Description_Lang_enUS',    label: 'Description',        type: 'textarea' },
  { key: 'AuraDescription_Lang_enUS',label: 'Aura Description',   type: 'textarea' },
  { key: 'SchoolMask',               label: 'School Mask',        type: 'bitmask', options: SCHOOL_MASK_BITS },
  { key: 'DefenseType',              label: 'Defense Type',       type: 'select', options: ['0:None','1:Magic','2:Melee','3:Ranged'] },
  { key: 'Category',                 label: 'Category',           type: 'number' },
  { key: 'Mechanic',                 label: 'Mechanic',           type: 'number' },
  { key: 'Attributes',               label: 'Attributes',         type: 'flags', options: ATTRIBUTES_FLAGS },
  { key: 'AttributesEx',             label: 'Attributes Ex',      type: 'flags', options: ATTRIBUTES_EX_FLAGS },
  { key: 'AttributesEx2',            label: 'Attributes Ex2',     type: 'number' },
  { key: 'AttributesEx3',            label: 'Attributes Ex3',     type: 'number' },
  { key: 'CastingTimeIndex',         label: 'Cast Time Index',    type: 'number' },
  { key: 'RecoveryTime',             label: 'Cooldown (ms)',      type: 'number' },
  { key: 'CategoryRecoveryTime',     label: 'Category CD (ms)',   type: 'number' },
  { key: 'DurationIndex',            label: 'Duration Index',     type: 'number' },
  { key: 'RangeIndex',               label: 'Range Index',        type: 'number' },
  { key: 'Speed',                    label: 'Speed',              type: 'decimal' },
  { key: 'CumulativeAura',           label: 'Stack Amount',       type: 'number' },
  { key: 'ProcTypeMask',             label: 'Proc Flags',         type: 'number' },
  { key: 'ProcChance',               label: 'Proc Chance (%)',    type: 'number' },
  { key: 'ProcCharges',              label: 'Proc Charges',       type: 'number' },
  { key: 'MaxLevel',                 label: 'Max Level',          type: 'number' },
  { key: 'BaseLevel',                label: 'Base Level',         type: 'number' },
  { key: 'SpellLevel',               label: 'Spell Level',        type: 'number' },
  { key: 'PowerType',                label: 'Power Type',         type: 'select', options: ['-2:Health','0:Mana','1:Rage','2:Focus','3:Energy','4:Happiness','5:Rune','6:Runic Power'] },
  { key: 'ManaCost',                 label: 'Mana Cost',          type: 'number' },
  { key: 'ManaCostPct',              label: 'Mana Cost %',        type: 'number' },
  { key: 'ManaPerSecond',            label: 'Mana/Second',        type: 'number' },
  { key: 'MaxTargetLevel',           label: 'Max Target Level',   type: 'number' },
  { key: 'MaxTargets',               label: 'Max Targets',        type: 'number' },
  { key: 'SpellClassSet',            label: 'Spell Family',       type: 'select', options: Object.entries(SPELL_CLASS_SET).map(([v,l]) => `${v}:${l}`), numeric: true },
  { key: 'Effect_1',                 label: 'Effect 1',           type: 'enum', options: SPELL_EFFECTS },
  { key: 'Effect_2',                 label: 'Effect 2',           type: 'enum', options: SPELL_EFFECTS },
  { key: 'Effect_3',                 label: 'Effect 3',           type: 'enum', options: SPELL_EFFECTS },
  { key: 'EffectBasePoints_1',       label: 'Base Points 1',      type: 'number' },
  { key: 'EffectBasePoints_2',       label: 'Base Points 2',      type: 'number' },
  { key: 'EffectBasePoints_3',       label: 'Base Points 3',      type: 'number' },
  { key: 'EffectAura_1',             label: 'Aura Type 1',        type: 'enum', options: SPELL_AURAS },
  { key: 'EffectAura_2',             label: 'Aura Type 2',        type: 'enum', options: SPELL_AURAS },
  { key: 'EffectAura_3',             label: 'Aura Type 3',        type: 'enum', options: SPELL_AURAS },
  { key: 'EffectTriggerSpell_1',     label: 'Trigger Spell 1',    type: 'number' },
  { key: 'EffectTriggerSpell_2',     label: 'Trigger Spell 2',    type: 'number' },
  { key: 'EffectTriggerSpell_3',     label: 'Trigger Spell 3',    type: 'number' },
  { key: 'SpellIconID',              label: 'Icon ID',            type: 'number' },
  { key: 'SpellVisualID_1',          label: 'Visual ID',          type: 'number' },
  { key: 'SpellPriority',            label: 'Priority',           type: 'number' },
];

export default function SpellEditorPage() {
  const { searchSpellsDbc, readSpellFull, writeSpellFull, findNextSpellId, copySpellDbc, idRanges, readSkillLineAbility, addSkillLineAbility, query, readCastTimes, readDurations, readRanges, dbcPath } = useConnection();
  const [search, setSearch] = useState('');
  const [spells, setSpells] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({});
  const [dirty, setDirty] = useState(false);
  const unsavedGuard = useUnsavedGuard(dirty);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [clonePanel, setClonePanel] = useState(null);
  const [cloneSaving, setCloneSaving] = useState(false);
  const [trainerList, setTrainerList] = useState([]);
  const [slaData, setSlaData] = useState(null);   // SkillLineAbility record voor geselecteerde spell
  const [expandedFlags, setExpandedFlags] = useState({});
  const [castTimes, setCastTimes] = useState({});
  const [durations, setDurations] = useState({});
  const [ranges, setRanges] = useState({});
  const [trainerOnly, setTrainerOnly] = useState(false);
  const [classFilter, setClassFilter] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [idMin, setIdMin] = useState('');
  const [idMax, setIdMax] = useState('');
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [activeView, setActiveView] = useState('spells'); // 'spells' | 'compare'
  const [compareDbcPath, setCompareDbcPath] = useState(null);
  const [compareResults, setCompareResults] = useState([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [copyingCompareId, setCopyingCompareId] = useState(null);
  const [compareSelected, setCompareSelected] = useState(null);
  const [hideCompareMatches, setHideCompareMatches] = useState(false);
  const searchRef = useRef(null);

  // Fingerprint: name + subtext (rank) + level/school/class/attributes — so a same-named
  // spell that Epoch tuned differently (different level/school/attrs) is NOT treated as a
  // duplicate and stays visible, while a truly identical spell gets hidden.
  const spellSignature = (s) => [
    (s.Name_Lang_enUS || '').trim().toLowerCase(),
    (s.NameSubtext_Lang_enUS || '').trim().toLowerCase(),
    s.SpellLevel, s.SchoolMask, s.SpellClassSet, s.Attributes,
  ].join('|');

  const localSigSet = useMemo(
    () => new Set(spells.map(spellSignature)),
    [spells]
  );
  const compareSigSet = useMemo(
    () => new Set(compareResults.map(spellSignature)),
    [compareResults]
  );
  const visibleSpells = useMemo(() => {
    if (!hideCompareMatches || activeView !== 'compare') return spells;
    return spells.filter(s => !compareSigSet.has(spellSignature(s)));
  }, [spells, hideCompareMatches, activeView, compareSigSet]);
  const visibleCompareResults = useMemo(() => {
    if (!hideCompareMatches) return compareResults;
    return compareResults.filter(s => !localSigSet.has(spellSignature(s)));
  }, [compareResults, hideCompareMatches, localSigSet]);

  const searchSpells = useCallback(async (term) => {
    setLoading(true);
    const options = { limit: 200 };
    if (trainerOnly) options.trainerSpells = true;
    if (classFilter !== '') options.classFilter = classFilter;
    if (schoolFilter !== '') options.schoolFilter = schoolFilter;
    if (idMin !== '') options.idMin = idMin;
    if (idMax !== '') options.idMax = idMax;
    if (duplicatesOnly) options.duplicatesOnly = true;
    const result = await searchSpellsDbc(term, options);
    setSpells(result.data || []);
    setLoading(false);

    if (compareDbcPath) {
      setCompareLoading(true);
      const cmpResult = await window.azeroth.dbc.searchSpells(compareDbcPath, term, options);
      setCompareResults(cmpResult.data || []);
      setCompareLoading(false);
    } else {
      setCompareResults([]);
    }
  }, [searchSpellsDbc, trainerOnly, classFilter, schoolFilter, idMin, idMax, duplicatesOnly, compareDbcPath]);

  useEffect(() => { searchSpells(search); }, [trainerOnly, classFilter, schoolFilter, idMin, idMax, duplicatesOnly, compareDbcPath]);

  const handlePickCompareFile = async () => {
    const filePath = await window.azeroth.dialog.openFile({
      title: 'Select external Spell.dbc',
      filters: [{ name: 'DBC files', extensions: ['dbc'] }],
    });
    if (!filePath) return;
    const folder = filePath.replace(/[\\/][^\\/]*$/, '');
    setCompareDbcPath(folder);
    setActiveView('compare');
  };

  const handleClearCompareFile = () => {
    setCompareDbcPath(null);
    setCompareResults([]);
    setActiveView('spells');
  };

  const handleCopyFromCompare = async (row) => {
    if (!compareDbcPath) return;
    const label = row.Name_Lang_enUS || '(unnamed)';
    if (!window.confirm(`Copy "${label}" (#${row.ID}) from the compare file into the local Spell.dbc at a new custom ID?`)) return;
    setCopyingCompareId(row.ID);
    setMsg(null);
    try {
      const idResult = await findNextSpellId(idRanges.spell);
      if (!idResult.success) throw new Error(idResult.error);
      const newId = idResult.nextId;
      const result = await window.azeroth.dbc.copySpellCrossFile(compareDbcPath, row.ID, dbcPath, newId);
      if (!result.success) throw new Error(result.error);
      await searchSpells(search);
      setCompareSelected(null);
      await selectSpell(newId);
      setMsg({ type: 'success', text: `✓ "${label}" copied to local ID #${newId}` });
    } catch (e) {
      setMsg({ type: 'error', text: `✗ Copy failed: ${e.message}` });
    }
    setCopyingCompareId(null);
  };

  const selectCompareSpell = async (id) => {
    if (!compareDbcPath) return;
    const result = await window.azeroth.dbc.readSpellFull(compareDbcPath, id);
    if (result.success) {
      setSelected(null);
      setCompareSelected(result.data);
      setMsg(null);
    }
  };

  useEffect(() => {
    readCastTimes().then(r => { if (r.success) setCastTimes(r.data); });
    readDurations().then(r => { if (r.success) setDurations(r.data); });
    readRanges().then(r => { if (r.success) setRanges(r.data); });
  }, []);

  useEffect(() => { searchRef.current?.focus(); }, []);

  const selectSpell = async (ID) => {
    const result = await readSpellFull(ID);
    if (result.data) {
      setCompareSelected(null);
      setSelected(result.data);
      setForm(result.data);
      setDirty(false);
      setMsg(null);
    }
    const slaRes = await readSkillLineAbility(ID);
    setSlaData(slaRes.success && slaRes.data.length > 0 ? slaRes.data[0] : null);
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
      const idResult = await findNextSpellId(idRanges.spell);
      if (!idResult.success) throw new Error(idResult.error);
      const newId = idResult.nextId;
      const result = await copySpellDbc(selected.ID, newId);
      if (!result.success) throw new Error(result.error);
      const nameResult = await writeSpellFull({ ID: newId, Name_Lang_enUS: `Copy of ${selected.Name_Lang_enUS || ''}`.trim() });
      if (!nameResult.success) throw new Error(nameResult.error);
      await searchSpells(search);
      await selectSpell(newId);
      setMsg({ type: 'success', text: `✓ Gekloond naar ID #${newId}` });
    } catch (e) {
      setMsg({ type: 'error', text: `✗ Klonen mislukt: ${e.message}` });
    }
    setCopying(false);
  };

  const handleCloneAsTrainer = async () => {
    if (!selected) return;
    setCopying(true);
    setMsg(null);
    setClonePanel(null);
    try {
      const idResult = await findNextSpellId(idRanges.spell);
      if (!idResult.success) throw new Error(idResult.error);
      const newId = idResult.nextId;
      const cloneResult = await copySpellDbc(selected.ID, newId);
      if (!cloneResult.success) throw new Error(cloneResult.error);
      await searchSpells(search);
      await selectSpell(newId);
      const srcSlaRes = await readSkillLineAbility(selected.ID);
      const srcSla = srcSlaRes.success && srcSlaRes.data.length > 0 ? srcSlaRes.data[0] : null;
      setClonePanel({
        newId,
        sourceId: selected.ID,
        spellLevel: selected.SpellLevel ?? 1,
        trainerId: '',
        npcEntry: '',
        reqLevel: selected.SpellLevel ?? 1,
        moneyCost: 0,
        basePoints: selected.EffectBasePoints_1 ?? 0,
        dieSides: selected.EffectDieSides_1 ?? 0,
        realPPL: selected.EffectRealPointsPerLevel_1 ?? 0,
        baseLevel: selected.BaseLevel ?? 0,
        maxLevel: selected.MaxLevel ?? 0,
        skillLine: srcSla ? String(srcSla.SkillLine) : '184',
        srcSla,
      });
      if (trainerList.length === 0) {
        const res = await query(
          `SELECT t.Id, t.Type, t.Requirement,
            GROUP_CONCAT(DISTINCT ct.name ORDER BY ct.name SEPARATOR ' / ') AS TrainerType,
            COUNT(DISTINCT cdt.CreatureId) AS AantalNPCs,
            SUM((SELECT COUNT(*) FROM creature c WHERE c.id1 = cdt.CreatureId)) AS TotalSpawns
           FROM trainer t
           JOIN creature_default_trainer cdt ON cdt.TrainerId = t.Id
           JOIN creature_template ct ON ct.entry = cdt.CreatureId
           GROUP BY t.Id
           HAVING TotalSpawns > 0 AND t.Id != 5
           ORDER BY t.Requirement, t.Id`
        );
        setTrainerList(res.data || []);
      }
    } catch (e) {
      setMsg({ type: 'error', text: `✗ Klonen mislukt: ${e.message}` });
    }
    setCopying(false);
  };

  const handleSaveCloneTrainer = async () => {
    if (!clonePanel) return;
    const { newId, sourceId, spellLevel, trainerId, npcEntry, reqLevel, moneyCost, basePoints, dieSides, realPPL, baseLevel, maxLevel, skillLine, srcSla } = clonePanel;
    if (!trainerId && !npcEntry) { setMsg({ type: 'error', text: 'Vul minimaal TrainerId of NPC Entry in' }); return; }
    setCloneSaving(true);
    setMsg(null);
    try {
      // 1. Spell velden wegschrijven
      await writeSpellFull({
        ID: newId,
        SpellLevel: Number(spellLevel),
        BaseLevel: Number(baseLevel),
        MaxLevel: Number(maxLevel),
        EffectBasePoints_1: Number(basePoints),
        EffectDieSides_1: Number(dieSides),
        EffectRealPointsPerLevel_1: Number(realPPL),
      });

      // 2. SLA entry toevoegen
      const slaNewRead = await readSkillLineAbility(newId);
      if (slaNewRead.success && slaNewRead.data.length === 0) {
        const newSlaId = srcSla ? srcSla.ID + newId : newId;
        await addSkillLineAbility({
          ID: newSlaId,
          SkillLine: Number(skillLine) || (srcSla ? srcSla.SkillLine : 184),
          Spell: newId,
          RaceMask: 0,
          ClassMask: srcSla ? srcSla.ClassMask : 2,
          SupercededBySpell: 0,
          AcquireMethod: 1,
          TrivialSkillLineRankLow: 0,
        });
      }

      const results = [];

      // 3. trainer_spell INSERT (nieuw systeem)
      if (trainerId) {
        await query(
          'INSERT INTO trainer_spell (TrainerId, SpellId, MoneyCost, ReqSkillLine, ReqSkillRank, ReqAbility1, ReqAbility2, ReqAbility3, ReqLevel) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?) ON DUPLICATE KEY UPDATE MoneyCost=VALUES(MoneyCost), ReqLevel=VALUES(ReqLevel)',
          [Number(trainerId), newId, Number(moneyCost), Number(reqLevel)]
        );
        results.push(`trainer_spell (TrainerId ${trainerId})`);
      }

      // 4. npc_trainer INSERT (oud systeem)
      if (npcEntry) {
        await query(
          'INSERT INTO npc_trainer (ID, SpellID, MoneyCost, ReqSkillLine, ReqSkillRank, ReqLevel, ReqSpell) VALUES (?, ?, ?, 0, 0, ?, 0) ON DUPLICATE KEY UPDATE MoneyCost=VALUES(MoneyCost), ReqLevel=VALUES(ReqLevel)',
          [Number(npcEntry), newId, Number(moneyCost), Number(reqLevel)]
        );
        results.push(`npc_trainer (NPC entry ${npcEntry})`);
      }

      setClonePanel(null);
      setMsg({ type: 'success', text: `✓ Spell #${newId} gekloned + ingevoerd in ${results.join(' & ')}` });
    } catch (e) {
      setMsg({ type: 'error', text: `✗ ${e.message}` });
    }
    setCloneSaving(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const result = await writeSpellFull(form);
      if (result.success) {
        setSelected(form);
        setDirty(false);
        setMsg({ type: 'success', text: `✓ Spell ${form.ID} opgeslagen in Spell.dbc` });
        searchSpells(search);
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

  const formatCastTime = (idx) => {
    const ms = castTimes[idx];
    if (ms === undefined) return '';
    if (ms === 0) return 'Instant';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, '')}s cast`;
  };

  const formatDuration = (idx) => {
    const d = durations[idx];
    if (!d) return '';
    const ms = d.duration;
    if (ms === -1) return 'Permanent';
    if (ms === 0) return 'Instant';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${ms / 1000}s`;
    if (ms < 3600000) return `${ms / 60000}min`;
    return `${ms / 3600000}h`;
  };

  const formatRange = (idx) => {
    const r = ranges[idx];
    if (!r) return '';
    if (r.rangeMax === 0) return 'Self';
    if (r.name) return `${r.rangeMax}yd (${r.name})`;
    return `${r.rangeMax}yd`;
  };

  const getIndexHint = (key, value) => {
    if (key === 'CastingTimeIndex') return formatCastTime(value);
    if (key === 'DurationIndex') return formatDuration(value);
    if (key === 'RangeIndex') return formatRange(value);
    return '';
  };

  const formatReadOnlyField = (f, value) => {
    if (f.type === 'bitmask') {
      const names = Object.entries(f.options).filter(([bit]) => ((Number(value) || 0) & Number(bit)) !== 0).map(([, name]) => name);
      return names.length ? names.join(', ') : '—';
    }
    if (f.type === 'flags') {
      const names = Object.entries(f.options).filter(([bit]) => ((Number(value) || 0) & (1 << Number(bit))) !== 0).map(([, name]) => name);
      return names.length ? `${value ?? 0} (${names.join(', ')})` : (value ?? 0);
    }
    if (f.type === 'select') {
      const opt = f.options.find(o => o.split(':')[0] === String(value));
      return opt ? opt.split(':').slice(1).join(':') : (value ?? '—');
    }
    if (f.type === 'enum') {
      return f.options[value] ?? (value ?? '—');
    }
    const hint = getIndexHint(f.key, value);
    if (hint) return `${value ?? '—'} (${hint})`;
    return (value === '' || value === null || value === undefined) ? '—' : value;
  };

  const getFieldSections = () => [
    { title: 'Basis Info', keys: ['ID', 'Name_Lang_enUS', 'NameSubtext_Lang_enUS', 'Description_Lang_enUS', 'AuraDescription_Lang_enUS'] },
    { title: 'School & Type', keys: ['SchoolMask', 'DefenseType', 'Category', 'Mechanic'] },
    { title: 'Attributes', keys: ['Attributes', 'AttributesEx', 'AttributesEx2', 'AttributesEx3'] },
    { title: 'Timing', keys: ['CastingTimeIndex', 'RecoveryTime', 'CategoryRecoveryTime', 'DurationIndex', 'Speed'] },
    { title: 'Range & Targets', keys: ['RangeIndex', 'MaxTargetLevel', 'MaxTargets'] },
    { title: 'Mechanics', keys: ['CumulativeAura', 'ProcTypeMask', 'ProcChance', 'ProcCharges'] },
    { title: 'Power & Levels', keys: ['MaxLevel', 'BaseLevel', 'SpellLevel', 'PowerType', 'ManaCost', 'ManaCostPct', 'ManaPerSecond'] },
    { title: 'Effect Slot 1', keys: ['Effect_1', 'EffectBasePoints_1', 'EffectAura_1', 'EffectTriggerSpell_1'] },
    { title: 'Effect Slot 2', keys: ['Effect_2', 'EffectBasePoints_2', 'EffectAura_2', 'EffectTriggerSpell_2'] },
    { title: 'Effect Slot 3', keys: ['Effect_3', 'EffectBasePoints_3', 'EffectAura_3', 'EffectTriggerSpell_3'] },
    { title: 'Visual & Priority', keys: ['SpellClassSet', 'SpellIconID', 'SpellVisualID_1', 'SpellPriority'] },
  ];

  return (
    <>
      {unsavedGuard.blocked && <UnsavedChangesModal onConfirm={unsavedGuard.confirm} onCancel={unsavedGuard.cancel} />}
      <div className="editor-page-header">
        <h2 className="editor-page-title">Spell Editor</h2>
        <p className="editor-page-subtitle">Manage spell data and properties</p>
      </div>
      <div className="editor-layout">
        <div className="editor-list" style={activeView === 'compare' ? { flex: '2 1 0', minWidth: '520px' } : undefined}>
          <div className="editor-list-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px' }}>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: '11px', padding: '3px 8px', fontWeight: activeView === 'spells' ? 600 : 400, borderBottom: activeView === 'spells' ? '2px solid var(--accent)' : '2px solid transparent' }}
                onClick={() => setActiveView('spells')}
              >
                Spells
              </button>
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: '11px', padding: '3px 8px', fontWeight: activeView === 'compare' ? 600 : 400, borderBottom: activeView === 'compare' ? '2px solid var(--accent)' : '2px solid transparent' }}
                onClick={() => { if (!compareDbcPath) handlePickCompareFile(); else setActiveView('compare'); }}
              >
                Compare
              </button>
              {compareDbcPath && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}>
                  ({compareDbcPath.split(/[\\/]/).pop()})
                  <button type="button" className="btn-ghost" style={{ fontSize: '10px', padding: '1px 5px' }} title="Change/clear compare file" onClick={handleClearCompareFile}>
                    <X size={10} />
                  </button>
                </span>
              )}
            </div>
            <div className="search-box">
              <Search size={13} />
              <input
                ref={searchRef}
                placeholder="Search name or entry..."
                value={search}
                onChange={e => { setSearch(e.target.value); searchSpells(e.target.value); }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '6px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={trainerOnly} onChange={e => setTrainerOnly(e.target.checked)} />
                Trainer-visible
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={duplicatesOnly} onChange={e => setDuplicatesOnly(e.target.checked)} />
                Duplicate names only
              </label>
              <select
                value={classFilter}
                onChange={e => setClassFilter(e.target.value)}
                style={{ fontSize: '11px' }}
                title="Class (Spell Family) — approximate, see SpellClassSet"
              >
                <option value="">All classes</option>
                {Object.entries(SPELL_CLASS_SET).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <select
                value={schoolFilter}
                onChange={e => setSchoolFilter(e.target.value)}
                style={{ fontSize: '11px' }}
                title="School (SchoolMask)"
              >
                <option value="">All schools</option>
                {Object.entries(SCHOOL_MASK_BITS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                <span style={{ color: 'var(--text-muted)' }}>ID</span>
                <input
                  type="number"
                  placeholder="min"
                  value={idMin}
                  onChange={e => setIdMin(e.target.value)}
                  style={{ width: '70px', fontSize: '11px' }}
                />
                <span style={{ color: 'var(--text-muted)' }}>–</span>
                <input
                  type="number"
                  placeholder="max"
                  value={idMax}
                  onChange={e => setIdMax(e.target.value)}
                  style={{ width: '70px', fontSize: '11px' }}
                />
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: '11px', padding: '2px 6px' }}
                  title="Preset: ID ≥ 4,000,000"
                  onClick={() => { setIdMin('4000000'); setIdMax(''); }}
                >
                  Custom range
                </button>
                {(idMin !== '' || idMax !== '') && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: '11px', padding: '2px 6px' }}
                    onClick={() => { setIdMin(''); setIdMax(''); }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
          {activeView === 'spells' ? (
            <div className="list-items">
              {loading && <div className="loading-text">Searching...</div>}
              {!loading && spells.map(s => (
                <div
                  key={s.ID}
                  className={`list-item ${selected?.ID === s.ID ? 'active' : ''}`}
                  onClick={() => selectSpell(s.ID)}
                >
                  <div className="list-item-main">
                    <span className="list-item-name">{s.Name_Lang_enUS || '(unnamed)'}</span>
                    <ChevronRight size={12} className="list-item-arrow" />
                  </div>
                  <div className="list-item-meta">
                    <span className="mono">#{s.ID}</span>
                  </div>
                </div>
              ))}
              {!loading && spells.length === 0 && <div className="loading-text">No results</div>}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--border)' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 8px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                  <span>Local</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 400, textTransform: 'none', cursor: 'pointer', fontSize: '10px' }} title="Verberg spells die ook in het compare-bestand voorkomen (op naam)">
                    <input
                      type="checkbox"
                      checked={hideCompareMatches}
                      onChange={e => setHideCompareMatches(e.target.checked)}
                    />
                    Hide duplicates
                  </label>
                </div>
                <div className="list-items">
                  {loading && <div className="loading-text">Searching...</div>}
                  {!loading && visibleSpells.map(s => (
                    <div
                      key={s.ID}
                      className={`list-item ${selected?.ID === s.ID ? 'active' : ''}`}
                      onClick={() => selectSpell(s.ID)}
                    >
                      <div className="list-item-main">
                        <span className="list-item-name">{s.Name_Lang_enUS || '(unnamed)'}</span>
                        <ChevronRight size={12} className="list-item-arrow" />
                      </div>
                      <div className="list-item-meta">
                        <span className="mono">#{s.ID}</span>
                      </div>
                    </div>
                  ))}
                  {!loading && visibleSpells.length === 0 && <div className="loading-text">No results</div>}
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 8px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                  <span>Compare file ({compareDbcPath?.split(/[\\/]/).pop()})</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 400, textTransform: 'none', cursor: 'pointer', fontSize: '10px' }} title="Verberg spells die ook in je lokale Spell.dbc voorkomen (op naam)">
                    <input
                      type="checkbox"
                      checked={hideCompareMatches}
                      onChange={e => setHideCompareMatches(e.target.checked)}
                    />
                    Hide duplicates
                  </label>
                </div>
                <div className="list-items">
                  {compareLoading && <div className="loading-text">Searching...</div>}
                  {!compareLoading && visibleCompareResults.map(s => (
                    <div
                      key={s.ID}
                      className={`list-item ${compareSelected?.ID === s.ID ? 'active' : ''}`}
                      onClick={() => selectCompareSpell(s.ID)}
                    >
                      <div className="list-item-main">
                        <span className="list-item-name">{s.Name_Lang_enUS || '(unnamed)'}</span>
                        <button
                          type="button"
                          className="btn-ghost"
                          title="Copy to local Spell.dbc"
                          disabled={copyingCompareId === s.ID}
                          onClick={(e) => { e.stopPropagation(); handleCopyFromCompare(s); }}
                          style={{ fontSize: '10px', padding: '2px 5px', display: 'flex', alignItems: 'center', gap: '3px' }}
                        >
                          <Copy size={10} /> {copyingCompareId === s.ID ? '...' : 'Copy'}
                        </button>
                      </div>
                      <div className="list-item-meta">
                        <span className="mono">#{s.ID}</span>
                      </div>
                    </div>
                  ))}
                  {!compareLoading && visibleCompareResults.length === 0 && <div className="loading-text">No results</div>}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="editor-form">
          {compareSelected ? (
            <>
              <div className="page-header">
                <div>
                  <h1 className="page-title">{compareSelected.Name_Lang_enUS || '(unnamed)'}</h1>
                  <p className="page-sub">Entry #{compareSelected.ID} · {compareDbcPath?.split(/[\\/]/).pop()} (read-only)</p>
                </div>
                <div className="header-actions">
                  <button
                    className="btn-primary"
                    onClick={() => handleCopyFromCompare(compareSelected)}
                    disabled={copyingCompareId === compareSelected.ID}
                  >
                    <Copy size={13}/> {copyingCompareId === compareSelected.ID ? 'Copying...' : 'Copy to local'}
                  </button>
                </div>
              </div>
              {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}
              <div className="form-fields">
                {getFieldSections().map((section, idx) => (
                  <div key={idx}>
                    <h4 className="field-section-title">{section.title}</h4>
                    {section.keys.map(key => {
                      const f = SPELL_FIELDS.find(fld => fld.key === key);
                      if (!f) return null;
                      return (
                        <div key={f.key} className={`field-group ${f.type === 'textarea' ? 'field-wide' : ''}`}>
                          <label>{f.label}</label>
                          <div className="mono" style={{ fontSize: '13px', padding: '6px 0', whiteSpace: 'pre-wrap' }}>
                            {formatReadOnlyField(f, compareSelected[f.key])}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          ) : !selected ? (
            <div className="editor-empty">
              <MousePointerClick />
              <p>Select a spell to edit</p>
            </div>
          ) : (
            <>
              <div className="page-header">
                <div>
                  <h1 className="page-title">{selected.Name_Lang_enUS || '(unnamed)'}{dirty && <span style={{color: 'var(--gold)', marginLeft: '8px'}}>●</span>}</h1>
                  <p className="page-sub">Entry #{selected.ID} · Spell.dbc</p>
                </div>
                <div className="header-actions">
                  {dirty && <button className="btn-ghost" onClick={() => { setForm(selected); setDirty(false); }}><RotateCcw size={13}/> Reset</button>}
                  <button className="btn-ghost" onClick={handleCopy} disabled={copying} title="Kloon naar nieuw ID">
                    <Copy size={13}/> {copying ? 'Klonen...' : 'Copy'}
                  </button>
                  <button className="btn-ghost" onClick={handleCloneAsTrainer} disabled={copying} title="Kloon naar custom range + voeg toe aan trainer_spell">
                    <Wand2 size={13}/> Clone → Trainer
                  </button>
                  <button className="btn-primary" onClick={handleSave} disabled={saving || !dirty}>
                    <Save size={13}/> {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              {msg && <div className={`editor-msg ${msg.type}`}>{msg.text}</div>}
              {clonePanel && (
                <div className="editor-msg info" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>Gekloned naar #{clonePanel.newId} — voeg toe aan trainer_spell</strong>
                    <button className="btn-ghost" onClick={() => setClonePanel(null)} style={{ padding: '2px 6px' }}><X size={12}/></button>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      SpellLevel
                      <input type="number" value={clonePanel.spellLevel} style={{ width: '80px' }}
                        onChange={e => setClonePanel(p => ({ ...p, spellLevel: e.target.value }))} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      BaseLevel
                      <input type="number" value={clonePanel.baseLevel} style={{ width: '80px' }}
                        onChange={e => setClonePanel(p => ({ ...p, baseLevel: e.target.value }))} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      MaxLevel
                      <input type="number" value={clonePanel.maxLevel} style={{ width: '80px' }}
                        onChange={e => setClonePanel(p => ({ ...p, maxLevel: e.target.value }))} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      ReqLevel
                      <input type="number" value={clonePanel.reqLevel} style={{ width: '80px' }}
                        onChange={e => setClonePanel(p => ({ ...p, reqLevel: e.target.value }))} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      MoneyCost (copper)
                      <input type="number" value={clonePanel.moneyCost} style={{ width: '110px' }}
                        onChange={e => setClonePanel(p => ({ ...p, moneyCost: e.target.value }))} />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(100,150,220,0.2)' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      Base Points <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(damage -1)</span>
                      <input type="number" value={clonePanel.basePoints} style={{ width: '100px' }}
                        onChange={e => setClonePanel(p => ({ ...p, basePoints: e.target.value }))} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      Die Sides <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(range)</span>
                      <input type="number" value={clonePanel.dieSides} style={{ width: '90px' }}
                        onChange={e => setClonePanel(p => ({ ...p, dieSides: e.target.value }))} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      PPL <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(pts/level)</span>
                      <input type="number" step="0.1" value={clonePanel.realPPL} style={{ width: '90px' }}
                        onChange={e => setClonePanel(p => ({ ...p, realPPL: e.target.value }))} />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(100,150,220,0.2)' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      TrainerId <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(trainer_spell)</span>
                      <select value={clonePanel.trainerId} style={{ minWidth: '220px' }}
                        onChange={e => setClonePanel(p => ({ ...p, trainerId: e.target.value }))}>
                        <option value=''>— geen —</option>
                        {trainerList.map(t => {
                          const friendly = TRAINER_LABELS[t.Id] || t.TrainerType || '(geen naam)';
                          return (
                            <option key={t.Id} value={t.Id}>
                              {friendly} (ID {t.Id})
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                      NPC Entry <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(npc_trainer)</span>
                      <input type="number" value={clonePanel.npcEntry} style={{ width: '100px' }} placeholder="bv. 4000001"
                        onChange={e => setClonePanel(p => ({ ...p, npcEntry: e.target.value }))} />
                    </label>
                    {(() => {
                      const selTrainer = trainerList.find(t => String(t.Id) === String(clonePanel.trainerId));
                      const opts = SKILL_LINE_OPTIONS[selTrainer?.Requirement] || [];
                      if (!opts.length) return null;
                      return (
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                          SkillLine <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(SkillLineAbility.dbc)</span>
                          <select value={clonePanel.skillLine}
                            onChange={e => setClonePanel(p => ({ ...p, skillLine: e.target.value }))}>
                            {opts.map(o => (
                              <option key={`${o.id}-${o.label}`} value={String(o.id)}>{o.label} ({o.id})</option>
                            ))}
                          </select>
                        </label>
                      );
                    })()}
                    <button className="btn-primary" onClick={handleSaveCloneTrainer} disabled={cloneSaving}>
                      <Save size={13}/> {cloneSaving ? 'Opslaan...' : 'Opslaan'}
                    </button>
                  </div>
                </div>
              )}
              {slaData !== undefined && (
                <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-darker)' }}>
                  <h4 className="field-section-title" style={{ marginBottom: '8px' }}>SkillLineAbility.dbc</h4>
                  {slaData === null ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Geen entry gevonden voor dit spell</span>
                  ) : (
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                        SkillLine
                        {(() => {
                          const allOpts = Object.values(SKILL_LINE_OPTIONS).flat();
                          const known = allOpts.find(o => o.id === slaData.SkillLine);
                          return (
                            <select
                              value={String(slaData.SkillLine)}
                              onChange={async e => {
                                const newSla = { ...slaData, SkillLine: Number(e.target.value) };
                                const r = await addSkillLineAbility(newSla);
                                if (r.success) setSlaData(newSla);
                                else setMsg({ type: 'error', text: `✗ SkillLine: ${r.error}` });
                              }}
                              style={{ minWidth: '180px' }}
                            >
                              {known
                                ? Object.values(SKILL_LINE_OPTIONS).flat()
                                    .filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i)
                                    .map(o => <option key={o.id} value={String(o.id)}>{o.label} ({o.id})</option>)
                                : <option value={String(slaData.SkillLine)}>{slaData.SkillLine}</option>
                              }
                            </select>
                          );
                        })()}
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                        ClassMask
                        <input type="number" value={slaData.ClassMask} style={{ width: '90px' }}
                          onChange={async e => {
                            const newSla = { ...slaData, ClassMask: Number(e.target.value) };
                            const r = await addSkillLineAbility(newSla);
                            if (r.success) setSlaData(newSla);
                          }} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                        AcquireMethod
                        <select value={String(slaData.AcquireMethod)}
                          onChange={async e => {
                            const newSla = { ...slaData, AcquireMethod: Number(e.target.value) };
                            const r = await addSkillLineAbility(newSla);
                            if (r.success) setSlaData(newSla);
                          }}
                          style={{ width: '130px' }}>
                          <option value="1">1 — Trainer</option>
                          <option value="0">0 — Overig</option>
                        </select>
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
                        Trivial (0=zichtbaar)
                        <select value={String(slaData.TrivialSkillLineRankLow ?? 0)}
                          onChange={async e => {
                            const newSla = { ...slaData, TrivialSkillLineRankLow: Number(e.target.value) };
                            const r = await addSkillLineAbility(newSla);
                            if (r.success) setSlaData(newSla);
                          }}
                          style={{ width: '150px' }}>
                          <option value="0">0 — Toonbaar bij trainer</option>
                          <option value="2">2 — Talent/niet-traineerbaar</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )}
              <div className="form-fields">
                {getFieldSections().map((section, idx) => (
                  <div key={idx}>
                    <h4 className="field-section-title">{section.title}</h4>
                    {section.keys.map(key => {
                      const f = SPELL_FIELDS.find(fld => fld.key === key);
                      if (!f) return null;
                      return (
                        <div key={f.key} className={`field-group ${f.type === 'textarea' ? 'field-wide' : ''}`}>
                          <label>{f.label}</label>
                          {f.type === 'textarea' ? (
                            <textarea rows={2} value={form[f.key] ?? ''} onChange={e => handleChange(f.key, e.target.value)} />
                          ) : f.type === 'select' ? (
                            <select value={String(form[f.key] ?? '')} onChange={e => handleChange(f.key, e.target.value)}>
                              {f.options.map(o => {
                                const [val, ...rest] = o.split(':');
                                return <option key={val} value={val}>{rest.join(':')}</option>;
                              })}
                            </select>
                          ) : f.type === 'enum' ? (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <input type="number" value={form[f.key] ?? 0} style={{ width: '70px' }}
                                onChange={e => handleChange(f.key, Number(e.target.value))} />
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                {f.options[form[f.key]] ?? ''}
                              </span>
                            </div>
                          ) : f.type === 'bitmask' ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '2px' }}>
                              {Object.entries(f.options).map(([bit, name]) => {
                                const b = Number(bit);
                                const checked = ((Number(form[f.key]) || 0) & b) !== 0;
                                return (
                                  <label key={b} style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={checked}
                                      onChange={() => handleChange(f.key, ((Number(form[f.key]) || 0) ^ b))} />
                                    {name}
                                  </label>
                                );
                              })}
                            </div>
                          ) : f.type === 'flags' ? (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', position: 'relative' }}>
                              <input type="number" value={form[f.key] ?? 0} style={{ width: '90px' }}
                                onChange={e => handleChange(f.key, Number(e.target.value))} />
                              <button type="button" className="btn-ghost" style={{ padding: '1px 6px', fontSize: '11px' }}
                                onClick={() => setExpandedFlags(s => ({ ...s, [f.key]: !s[f.key] }))}>
                                flags {expandedFlags[f.key] ? '▲' : '▼'}
                              </button>
                              {expandedFlags[f.key] && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 10, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px', fontSize: '11px', maxWidth: '300px', lineHeight: '1.8', marginTop: '4px', whiteSpace: 'nowrap' }}>
                                  {Object.entries(f.options).filter(([bit]) => ((Number(form[f.key]) || 0) & (1 << Number(bit))) !== 0).map(([bit, name]) => (
                                    <div key={bit} style={{ color: 'var(--gold)' }}>bit {bit} — {name}</div>
                                  ))}
                                  {Object.entries(f.options).every(([bit]) => ((Number(form[f.key]) || 0) & (1 << Number(bit))) === 0) && (
                                    <div style={{ color: 'var(--text-muted)' }}>(geen flags gezet)</div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (() => {
                            const hint = getIndexHint(f.key, form[f.key]);
                            return hint ? (
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <input type={f.type} value={form[f.key] ?? ''} onChange={e => handleChange(f.key, e.target.value)} readOnly={f.readonly} />
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>{hint}</span>
                              </div>
                            ) : (
                              <input type={f.type} value={form[f.key] ?? ''} onChange={e => handleChange(f.key, e.target.value)} readOnly={f.readonly} />
                            );
                          })()}
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
