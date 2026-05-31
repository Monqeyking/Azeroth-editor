Project: Azeroth Editor — een Electron + React (Vite) desktoptool voor het beheren van AzerothCore WoW-serverdata via MySQL en SOAP.

Tech stack: Electron 29, React 18, Vite 5, React Router 6, Lucide React, MySQL2, node-soap.

Structuur:
- electron/main.js — Electron main process (IPC, DB, SOAP)
- electron/preload.js — contextBridge
- src/ — React frontend (JSX, geen TypeScript)
- src/assets/icon.ico — app-icoon

## Model Preview (CreatureModelPreview.jsx)
Uses ZamModelViewer (Wowhead cloud renderer) — requires internet.
- Script: `https://wowgaming.altervista.org/modelviewer/scripts/viewer.min.js`
- Content: `https://wowgaming.altervista.org/modelviewer/data/get.php?path=`
- Requires `window.jQuery`, `window.$`, and `window.WH` globals before init
- NPC type = 8, aspect = 0.8
- CSP in main.js covers: wowgaming.altervista.org, wow.zamimg.com, code.jquery.com, fonts.googleapis.com
- Old Three.js/M2 renderer is commented out at the bottom of the file for reference
- CharSections.dbc is parsed in getM2DbcData() for fallback skin texture lookups (still used by the 3D editor map view)

## Creature Editor — model table inputs
- Integer columns (Idx, CreatureDisplayID, VerifiedBuild): type="text" inputMode="numeric" + custom ▲▼ buttons using onMouseDown+preventDefault — exactly one step per click, no auto-repeat
- Decimal columns (DisplayScale, Probability): type="number" step="0.01" with onWheel → blur() to prevent scroll-changing values

## Trainer Spell Editor (TrainerSpellPage.jsx)
Route: `/trainer-spells`, nav item "Trainers" (BookOpen icon).

### Database architectuur — twee systemen naast elkaar
AzerothCore gebruikt TWEE trainer systemen tegelijk:

**Nieuw systeem (primair voor class spells):**
- `trainer` → trainer definitie (Id, Type, Requirement=class ID)
- `creature_default_trainer` → koppelt creature entry aan TrainerId
- `trainer_spell` → spells per TrainerId (TrainerId, SpellId, MoneyCost, ReqLevel, etc.)

**Oud systeem (faction-specifieke spells):**
- `npc_trainer` → ID kan creature entry zijn (SpellID < 0 = template ref) of template ID (SpellID > 0 = echte spell)
- Negatieve SpellID verwijst naar een template: `SpellID = -templateId`

De server combineert beide: `trainer_spell` voor algemene class spells, `npc_trainer` voor faction-specifieke spells (bijv. Seal of Blood vs Seal of Vengeance, racial mounts).

### Paladin trainer IDs (trainer_spell)
- TrainerId=3: alle paladin trainers (Arthur the Faithful, Noellene, etc.)
- TrainerId=5: generieke "Paladin Trainer" NPC
- TrainerId=6: low-level trainers + custom NPC (entry 4000001)

### npc_trainer template IDs (faction-specifiek)
- 200003/200004: gedeelde paladin spells (oud systeem, wordt NIET gebruikt door trainer window)
- 200020: Alliance paladin exclusief (Summon Warhorse, Seal of Vengeance)
- 200021: Horde paladin exclusief (Summon Charger BE, Seal of Corruption)

### DBC bestanden voor trainer spells
Beide DBC bestanden moeten naar server EN client gekopieerd worden na wijzigingen.

**Spell.dbc** — SpellLevel aanpassen voor trainer requirement
- Gelezen/geschreven via bestaande `readSpellFull` / `writeSpellFull` handlers
- SpellLevel = level waarop spell geleerd kan worden (door client getoond)
- Wijzigingen invalideren `spellDbcCache`

**SkillLineAbility.dbc** — bepaalt of een spell toonbaar is bij trainer
- 13 velden × 4 bytes = 52 bytes per record (incl. TradeSkillCategoryID)
- Offset 36 = TrivialSkillLineRankLow: **0** = toonbaar bij trainer, **2** = talent/niet-traineerbaar
- ClassMask bepaalt voor welke class de spell geldig is (Paladin=2, Shaman=64, etc.)
- AcquireMethod (offset 28): altijd 1 voor trainer spells in deze DB
- IPC handlers: `dbc:readSkillLineAbility`, `dbc:writeSkillLineAbility` (schrijft TrivialSkillLineRankLow)
- Voor cross-class spells: nieuw record toevoegen aan DBC (nog niet geïmplementeerd)

### Spell filtering in DBC search
`searchSpellsDbc` ondersteunt `{ trainerSpells: true }` optie:
- Filter: bit 16 (0x10000) gezet EN bit 19 (0x80000) NIET gezet in Attributes
- Earth Shock trainable ranks: Attributes=327680 (bits 16+18)
- Flash of Light: Attributes=65536 (bit 16 alleen)
- NPC-only varianten: Attributes=851968 (bits 16+18+19) → gefilterd

### Rank deduplicatie logica
- Ranked spells (hebben "Rank X" NameSubtext): gegroepeerd per label, confirmed (in trainer_spell) krijgt prioriteit
- WotLK single-rank spells (geen subtext): selecteert laagste ID in bereik 25000-65000 met SpellLevel > 1
- Confirmed (in trainer_spell) wint altijd van niet-confirmed

### Open issues (volgende task)
- Crusader Strike (#35395) verschijnt nog niet bij paladin trainer ondanks correcte trainer_spell entries (TrainerId=3,5,6) en SkillLineAbility.dbc aanpassing
- Cross-class spells toevoegen vereist nieuw SkillLineAbility.dbc record (nog niet geïmplementeerd)
- Spec/SkillLine keuze bij Add Trainer (welke spec een spell valt) nog niet in UI

Voorkeuren:
- Respond in english if it saves tokens.
- Schrijf beknopte code zonder overbodige comments
- Gebruik bestaande patronen uit de codebase, introduceer geen nieuwe libraries tenzij gevraagd
- Sla kleine wijzigingen direct op in de map, geen tussentijdse bevestiging nodig
- Als je vragen hebt over de database structuur. vraag mij dit dan. Ik kan het voor je ophalen.
- Als cache files vergrendeld zijn door npm dev. vraag mij dan eerst om het te stoppen in plaats van het hele file opnieuw te schrijven