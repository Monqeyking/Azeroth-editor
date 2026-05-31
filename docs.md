# Azeroth Editor — Docs

> Electron 29 + React 18 (Vite) desktoptool voor AzerothCore WoW-serverdata via MySQL en SOAP.
> **Laatste update:** 2026-05-31 (sessie 5)

---

## Tech Stack

| Laag | Technologie |
|---|---|
| Desktop | Electron 29 |
| Frontend | React 18, Vite 5, React Router 6, Lucide React |
| Database | MySQL2 (IPC via electron/main.js) |
| Live server | node-soap (SOAP `.reload` commands) |
| Model preview | ZamModelViewer (wowgaming.altervista.org — cloud, vereist internet) |

**Structuur:**
- `electron/main.js` — main process (IPC, DB, SOAP)
- `electron/preload.js` — contextBridge (`window.azeroth.*`)
- `src/` — React frontend (JSX, geen TypeScript)

---

## Pagina's & Status

### ✅ ConnectPage
MySQL verbinding setup. Form → config.json opslaan. Redirect naar dashboard bij succes.

### ✅ SettingsPage
SOAP config (host, port, GM user/pass, test-knop) + DBC-pad instelling + Custom ID ranges (start-IDs per systeem, default 4000000).

### ✅ DashboardPage
COUNT-stats voor creature/item/quest/spell. Recent creatures tabel.

### ✅ RaceClassPage (`/races`)
Race+class combinatie beheer. Synct naar zowel DB als DBC.

**UI:** Horizontale race-balk (Alliance/Horde) met WoW race-iconen. Klik = selecteer race, rest dimt. Eronder class-grid met class-iconen + checkbox per class.

**Checkbox aan:** wizard opent met startpositie pre-ingevuld vanuit template. Bij aanmaken: INSERT in `playercreateinfo`, actie-balk gekopieerd van zelfde class, entry toegevoegd aan `CharBaseInfo.dbc`.

**Checkbox uit:** bevestigingsdialoog → DELETE uit `playercreateinfo`, `playercreateinfo_action`, bitmask rijen uit `spell_custom`/`skills`, entry verwijderd uit `CharBaseInfo.dbc`.

**DBC write-back:** `CharBaseInfo.dbc` — structuur: WDBC header (20 bytes) + records van 2 bytes (uint8 race, uint8 class) + 1 byte string block. IPC: `dbc:readCharBaseInfo`, `dbc:writeCharBaseInfo`.

### ✅ TalentEditorPage
DBC-based (Talent.dbc, Spell.dbc, SpellIcon.dbc). Visuele 15×4 grid per class/tab. Drag-and-drop, prereq-pijlen, icon picker modal, primary spell icon met live preview. Opslaan → DBC write-back.

**DBC-offsets Spell.dbc:** Name_Lang_enUS = offset 544, SpellIconID = offset 532.

### ✅ SpellEditorPage
Spell.dbc via IPC (`dbc:readSpellFull` / `dbc:writeSpellFull`). Search op naam/ID. Velden in secties.

**Clone → Trainer workflow:**
1. Selecteer bronspell → klik **Clone → Trainer**
2. Systeem kloont spell naar volgende vrije ID in custom range (Settings → ID Ranges)
3. Panel toont pre-ingevulde velden vanuit bronspell:
   - SpellLevel, BaseLevel, MaxLevel, ReqLevel, MoneyCost
   - EffectBasePoints_1, EffectDieSides_1, EffectRealPointsPerLevel_1
   - TrainerId dropdown (alleen trainers met actieve spawns, friendly labels)
   - NPC Entry (npc_trainer directe entry)
4. Opslaan doet: `writeSpellFull` + `addSkillLineAbility` (ClassMask van bronspell) + INSERT `trainer_spell` + INSERT `npc_trainer`
5. Daarna: Spell.dbc + SkillLineAbility.dbc naar server + client, cache wissen, worldserver herstarten

**Bekende SPELL_OFFSETS (electron/main.js):**

| Veld | Offset | Type |
|---|---|---|
| ID | 0 | uint32 |
| Attributes / Ex / Ex2 / Ex3 | 16–28 | uint32 |
| CastingTimeIndex | 112 | uint32 |
| RecoveryTime / CategoryRecoveryTime | 116 / 120 | uint32 |
| MaxLevel / BaseLevel / SpellLevel | 148 / 152 / 156 | uint32 |
| DurationIndex | 160 | uint32 |
| ManaCost / ManaPerSecond / ManaCostPct | 168 / 176 / 816 | uint32 |
| RangeIndex | 184 | uint32 |
| Speed | 188 | float |
| Effect_1/2/3 | 284 / 288 / 292 | uint32 |
| EffectDieSides_1/2/3 | 296 / 300 / 304 | int32 |
| EffectRealPointsPerLevel_1/2/3 | 308 / 312 / 316 | float |
| EffectBasePoints_1/2/3 | 320 / 324 / 328 | int32 |
| EffectAura_1/2/3 | 380 / 384 / 388 | uint32 |
| EffectTriggerSpell_1/2/3 | 464 / 468 / 472 | uint32 |
| SpellIconID | 532 | uint32 |
| Name_Lang_enUS | 544 | string |
| SpellClassSet | 832 | uint32 |
| SchoolMask | 900 | uint32 |

**Nog toe te voegen aan SPELL_OFFSETS (backlog):**

| Veld | Offset | Type | Waarvoor |
|---|---|---|---|
| AttributesEx4/5/6/7 | 32 / 36 / 40 / 44 | uint32 | Extra flags |
| EffectChainTarget_1/2/3 | 416 / 420 / 424 | uint32 | Chain/cleave targets |
| EffectMiscValue_1/2/3 | 440 / 444 / 448 | int32 | Misc effect waarden |
| EffectMiscValueB_1/2/3 | 452 / 456 / 460 | int32 | Misc effect B |
| EffectPointsPerComboPoint_1/2/3 | 476 / 480 / 484 | float | Rogue combo scaling |
| SpellClassMaskA_1/2/3 | 836 / 840 / 844 | uint32 | Talent interactie flags |
| EffectAuraPeriod_1/2/3 | 392 / 396 / 400 | uint32 | DoT tick interval |
| EffectRadiusIndex_1/2/3 | 368 / 372 / 376 | uint32 | AoE radius |
| StartRecoveryTime | 824 | uint32 | GCD override (ms) |
| EffectBonusMultiplier_1/2/3 | 864 / 868 / 872 | float | Spell power coëfficiënt ⭐ |

### ✅ ItemEditorPage
MySQL `item_template`. 37 velden in 9 secties. Quality kleur-badges.

### ✅ QuestEditorPage
MySQL `quest_template`. 50+ velden in 10 secties.

### ✅ CreatureEditorPage
MySQL `creature_template` + gerelateerde tabellen. Sub-tabs: General, Template Model, Addon, Trainer, Vendor, World Spawns.

**Trainer tab:**
- **Spell Templates** — npc_trainer template refs (negatief SpellID). Veelgebruikt: 200003 (lvl 1-6), 200004 (lvl 8-80 gedeeld), 200020 (Alliance: Warhorse + Seal of Vengeance), 200021 (Horde: BE Charger + Seal of Corruption). Template info live opgehaald (count + level range).
- **Trainer Definition** — `creature_default_trainer` → `trainer` (Type, Requirement, Greeting). Create New of Link Existing.
- **Trainer Spells (nieuw systeem)** — samenvatting van `trainer_spell` entries voor gelinkte TrainerId. Verwijst naar Trainer Spell Editor voor beheer.
- **Direct Spells (legacy)** — npc_trainer positieve SpellIDs. Alleen zichtbaar als er data is.

> **Beide systemen draaien naast elkaar.** Server laadt `npc_trainer` (template refs + directe spells) én `trainer`/`trainer_spell`/`creature_default_trainer`. Beide zijn functioneel.

**Template Model tab:** multi-row editor met ZamModelViewer live preview. MH/OH weapon thumbnails via `creature_equip_template`.

### ✅ TrainerSpellPage (`/trainer-spells`)
Spell-first workflow voor trainer content. Zoek spell op naam → zie alle ranks → per rank: trainers beheren, BasePoints/SpellLevel bewerken.

**Trainer labels:** friendly names op basis van ID (bijv. "Paladin Main (ID 3)", "Paladin Starter (ID 6)"). Ghost trainers (geen spawns) worden uitgefilterd. TrainerId 5 (TTR test NPC) expliciet uitgesloten.

**Dual INSERT:** voegt spell toe aan zowel `trainer_spell` (TrainerId) als `npc_trainer` (NPC entry) tegelijk.

**SkillLineAbility.dbc offsets:**
- 0: ID, 4: SkillLine, 8: Spell, 12: RaceMask, 16: ClassMask
- 28: AcquireMethod (1 = trainer), 32: SupercededBySpell
- 36: TrivialSkillLineRankLow (0 = toonbaar bij trainer, >0 = niet-traineerbaar)
- IPC: `dbc:readSkillLineAbility`, `dbc:addSkillLineAbility`

### ✅ SpawnMap (`/map`)
2D kaart. BLP decoder, continent/zone tiles via MPQ. Creature + GO spawns, clustering, pan/zoom, inspector, waypoints, drag-and-drop DB-write, spawn zoeken/filteren.

### ✅ 3D Editor (`/editor3d`)
Three.js + R3F. ADT terrain, MySQL spawns, move/rotate gizmo, M2 instancing + LOD, minimap overlay, SOAP teleport.

---

## Trainer Systeem — Architectuur

AzerothCore gebruikt **twee trainer systemen naast elkaar**:

**Oud systeem (`npc_trainer`):**
- `ID` = creature entry, `SpellID` negatief = template ref, positief = directe spell
- Templates 200003/200004/200020/200021 bevatten gedeelde en faction-specifieke spells
- Wordt **wel** geladen door deze server build (ondanks ontbreken in ObjectMgr.cpp — zit in ander bestand)

**Nieuw systeem (`trainer` + `trainer_spell` + `creature_default_trainer`):**
- `creature_default_trainer.CreatureId` → `TrainerId` → `trainer_spell.SpellId`
- `LoadTrainers()` filtert talent-spells via `GetTalentSpellCost()` → deze worden genegeerd
- Trainer labels (bekend): 1/2 Warrior, 3/6 Paladin, 7/8 Hunter, 9/10 Rogue, 11/12 Priest, 13 Death Knight, 14/15 Shaman, 16/17 Mage, 31/32 Warlock, 33/34 Druid

**Crusader Strike — opgelost:**
Spell 35395 zit in Talent.dbc → wordt genegeerd door `GetTalentSpellCost()`. Oplossing: kloon naar custom ID (4000000+), voeg SLA toe (ClassMask=2, AcquireMethod=1, TrivialSkillLineRankLow=0), voeg toe aan trainer_spell + npc_trainer. Dit is nu geautomatiseerd via de **Clone → Trainer** knop in de Spell Editor.

---

## ZamModelViewer — Technische notities

- `type: 2` — NPC/creature ✅ | `type: 1` — character ❌ | `type: 3` — item ❌ (CORS)
- CSP dekt: wowgaming.altervista.org, wow.zamimg.com, code.jquery.com, fonts.googleapis.com
- Vereiste globals: `window.WH`, `window.$ = window.jQuery`

---

## Backlog (prioriteitsvolgorde)

### 🔴 Hoog

**Spell Editor — readable field labels**
Numerieke velden tonen met betekenisvolle labels:
- `SpellClassSet`: 1=Warrior, 2=Paladin, 3=Hunter, 4=Rogue, 5=Priest, 6=DK, 7=Shaman, 8=Mage, 9=Warlock, 10=Druid (of Paladin in sommige builds), 11=Druid
- `SchoolMask`: bitmask — 1=Fysiek, 2=Holy, 4=Fire, 8=Nature, 16=Frost, 32=Shadow, 64=Arcane
- `PowerType`: -2=Gezondheid, 0=Mana, 1=Rage, 3=Energy, 6=Runic Power
- `DefenseType`: 0=None, 1=Magic, 2=Melee, 3=Ranged
- `Effect_1/2/3`: effect type ID → naam (64=SchoolDamage, 2=SchoolPeriodic, 6=ApplyAura, etc.)
- `EffectAura_1/2/3`: aura type ID → naam (3=PeriodicDamage, 13=ModDamageDone, etc.)
- `Attributes / AttributesEx`: bitmask met checkboxes of hover-labels

**Spell Editor — ontbrekende DBC velden toevoegen**
Priority: EffectBonusMultiplier (spell power coëff), SpellClassMaskA (talent flags), EffectChainTarget, StartRecoveryTime (GCD).

**Spell Editor — spell_bonus_data koppeling**
Tabel `spell_bonus_data` bevat server-side spell power bonus (direct_bonus, dot_bonus, ap_bonus). Bij Clone → Trainer automatisch een rij aanmaken op basis van bronspell.

**Spell Editor — spell_ranks koppeling**
Tabel `spell_ranks` koppelt rank-ketens. Bij het aanmaken van meerdere ranks automatisch de keten bijwerken.

**Creature Equipment Editor (tab)**
Tabel: `creature_equip_template` — multi-row editor, item naam-lookup, koppelen aan model preview.

**Smart AI Editor (SAI)**
Tabel: `smart_scripts` — visuele event → action builder, inline documentatie per event/action ID.

**Creature Loot Editor**
Tabel: `creature_loot_template` — multi-row, item naam-lookup, drop-chance balk, `reference_loot_template`.

### 🟡 Medium

**Creature Text tab** — `creature_text` (say/yell/gossip rijen)

**NPC Gossip / Text Editor** — `npc_text`, `gossip_menu`, `gossip_menu_option`

**Waypoint Editor** — patrol paden tekenen op SpawnMap minimap

**Quest Editor uitbreiden** — `quest_template_addon`, reward previews, quest chain navigatie

**Global Search** — één zoekbalk over creature/item/quest/spell

**SQL Export / Diff View** — gegenereerde SQL tonen vóór opslaan

### 🔵 Laag

**Item Editor uitbreiden** — stat/socket/resistance velden, flag/bitmask selectors

**Gameobject Editor** — zelfde patroon als Creature Editor

**Raw SQL Editor** — vrije query invoer

**Verbindingsprofielen** — max 5 opslaan (zonder wachtwoord)

---

## Algemene QoL backlog

- [ ] Undo/redo over alle editors
- [ ] Toast-notificatie als herbruikbaar component (`src/components/Toast.jsx`)
- [ ] Loading skeleton voor lijsten (shimmer animatie)
- [ ] ConnectPage — "Test verbinding" knop (zonder navigatie)
- [ ] Recente items voor alle editors
- [ ] Clone uitbreiden — gerelateerde rijen meeklonen (trainer, vendor, model, addon)
- [ ] `game_tele` editor pagina
- [ ] Export/import als JSON backup

---

## Spawn Map — open punten

- [ ] Waypoint-punten toevoegen via klik op kaart
- [ ] ZamModelViewer popup bij klik op spawn
- [ ] Terrain hoogte tonen op hover
- [ ] Uitgebreide spawn-modal (SpawnMask, MovementType, orientation, phaseMask)

---

## 3D Editor — open punten

- [ ] Waypoint paden in 3D
- [ ] Inspector: `creature_template` velden + wander-radius cirkel
- [ ] Spawn toevoegen/verwijderen via rechtsklik
- [ ] Terrain texture layers (optioneel, zwaar)

---

## Code Patterns

```js
// IPC query
const result = await query('SELECT * FROM table WHERE id = ?', [id]);
// result.data = array of rows

// Dirty tracking
const markDirty = () => setDirty(true);

// Ctrl+S shortcut
useEffect(() => {
  const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (dirty && selected) handleSave(); }};
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [dirty, selected, handleSave]);
```

**Context API:** `ConnectionContext.jsx` — globale DB/DBC/SOAP state
**Response pattern:** `{ success: true, data: [...] }` of `{ error: '...' }`
**CSS:** aparte `.css` per pagina (`DashboardPage.css`, `EditorPage.css`, etc.)
