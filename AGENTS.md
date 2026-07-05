Project: Azeroth Editor Ã¢â‚¬â€ een Electron + React (Vite) desktoptool voor het beheren van AzerothCore WoW-serverdata via MySQL en SOAP.

Tech stack: Electron 29, React 18, Vite 5, React Router 6 (data router), Lucide React, MySQL2, node-soap.

Structuur:
- electron/main.js Ã¢â‚¬â€ Electron main process (IPC, DB, SOAP)
- electron/preload.js Ã¢â‚¬â€ contextBridge
- src/ Ã¢â‚¬â€ React frontend (JSX, geen TypeScript)
- src/assets/icon.ico Ã¢â‚¬â€ app-icoon

## React Router setup
- `src/App.jsx` gebruikt `createHashRouter` + `RouterProvider` (data router), **niet** `<HashRouter>` + `<Routes>`.
- Reden: `useBlocker` (in `useUnsavedGuard.js`, gebruikt door alle editors met unsaved-guard) werkt in React Router 6 alleen binnen een data router. Declaratieve `<HashRouter>` gooit `useBlocker must be used within a data router`.
- Bij uitbreiding van routes: voeg toe aan de `createHashRouter([...])` array, niet aan een `<Routes>` block.

## Model Preview (CreatureModelPreview.jsx)
Uses ZamModelViewer (Wowhead cloud renderer) Ã¢â‚¬â€ requires internet.
- Script: `https://wowgaming.altervista.org/modelviewer/scripts/viewer.min.js`
- Content: `https://wowgaming.altervista.org/modelviewer/data/get.php?path=`
- Requires `window.jQuery`, `window.$`, and `window.WH` globals before init
- NPC type = 8, aspect = 0.8
- CSP in main.js covers: wowgaming.altervista.org, wow.zamimg.com, code.jquery.com, fonts.googleapis.com
- Old Three.js/M2 renderer is commented out at the bottom of the file for reference
- CharSections.dbc is parsed in getM2DbcData() for fallback skin texture lookups (still used by the 3D editor map view)

## BLP texture loading
- IPC: `dbc:readBlpTexture(dataPath, blpPath)` in `main.js` Ã¢â‚¬â€ single BLP uit MPQ of losse file, decodeert, encodeert naar PNG, geeft base64 terug.
- Batch IPC: `dbc:readBlpTextures(dataPath, blpPaths)` Ã¢â‚¬â€ array in, array uit. Opent elke MPQ maximaal 1Ãƒâ€” ongeacht hoeveel BLPs erin zitten (gebruikt `mpqReader.openArchive`).
- Performance: gebruikt `readBlpFromMpqs` (`electron/mpq-reader.js`) die een **listfile pre-index** bouwt op eerste aanvraag Ã¢â‚¬â€ `Map<lowerBlpPath, mpqAbsPath>` zodat BLP-lookups O(1) zijn i.p.v. full MPQ-scan per lookup.
- Cache: `blpTextureCache` in `main.js` bewaart RGBA ÃƒÂ©n PNG base64 Ã¢â‚¬â€ herhaalde IPC calls slaan de `rgbaToPNG` (zlib) encoding over.
- Renderer batching: `src/lib/blpBatchLoader.js` Ã¢â‚¬â€ module-level debounced batcher (16ms window). Meerdere `useBlpTexture` calls in dezelfde tick worden gebundeld tot ÃƒÂ©ÃƒÂ©n IPC.
- Renderer hook: `src/lib/useBlpTexture.js` Ã¢â‚¬â€ gebruikt de batch loader, module-level dataURL cache, hergebruikt resultaten over component remounts.

## Glue UI editor (UIEditorPage)
- Route `/ui-editor` sits under World & Tools.
- Reads glue XML/Lua from the client MPQs through `glue:readTextFile` and uses `worldmapMpqPath` as the client Data root.
- Writes exports to `D:\CaioCore Tools\azeroth-editor\output\Interface\...` through `glue:writeTextFile` in `electron/main.js`.
- Current presets: Login, Character Select, Character Create.

## 3D Editor terrain pipeline (Editor3DPage)
- **Tile streaming**: interval (600ms) laadt ADT-tiles in 5Ãƒâ€”5 blok rond `camPosRef`, max 12/batch, evict >81 tiles. Negative caching voor ontbrekende tiles (oceaan).
- **Indexen**: `mpq-reader.js` `_indexFromListfile(dataPath, ext)` bouwt Map<lowerPath, mpqPath> per extensie (.blp/.adt/.wdl). Alle tile/minimap/wdl reads zijn O(1). **Nooit full MPQ scans per tile** Ã¢â‚¬â€ blokkeert main process, bevriest de app.
- **IPC**: `adt:getTerrain`, `adt:getTileTextures` (minimap BLP Ã¢â€ â€™ PNG dataURL per tile, md5translate.trs fallback), `adt:getWdl` (low-res 17Ãƒâ€”17 heightmap hele map).
- **Rendering**: per-tile mesh met minimap-texture (fallback hoogte-kleuring); `WdlMesh` = heel continent low-res, -1.5y verlaagd onder hi-res tiles. Camera far=60000, OrbitControls maxDistance=30000.
- **Index-swap**: bestandsnamen `<map>_<A>_<B>` met A = renderer tileY, B = renderer tileX. Consequent aangehouden in readAdtBuffer/readMinimapBlp/parseWdl.
- **CSP**: `blob:` in script-src + `cdn.jsdelivr.net` in connect-src vereist voor drei `<Text>` (troika worker/fonts).
- Open issues: WDL garbage-height "pilaren", spawn billboards/labels niet instanced, drei 10 Ã¢â€ â€ fiber 8 mismatch. Zie `PROMPT_next_session.md`.

## Creature Editor Ã¢â‚¬â€ model table inputs
- Integer columns (Idx, CreatureDisplayID, VerifiedBuild): type="text" inputMode="numeric" + custom Ã¢â€“Â²Ã¢â€“Â¼ buttons using onMouseDown+preventDefault Ã¢â‚¬â€ exactly one step per click, no auto-repeat
- Decimal columns (DisplayScale, Probability): type="number" step="0.01" with onWheel Ã¢â€ â€™ blur() to prevent scroll-changing values

## Trainer Spell Editor (TrainerSpellPage.jsx)
Route: `/trainer-spells`, nav item "Trainers" (BookOpen icon).

### Database architectuur Ã¢â‚¬â€ twee systemen naast elkaar
AzerothCore gebruikt TWEE trainer systemen tegelijk:

**Nieuw systeem (primair voor class spells):**
- `trainer` Ã¢â€ â€™ trainer definitie (Id, Type, Requirement=class ID)
- `creature_default_trainer` Ã¢â€ â€™ koppelt creature entry aan TrainerId
- `trainer_spell` Ã¢â€ â€™ spells per TrainerId (TrainerId, SpellId, MoneyCost, ReqLevel, etc.)

**Oud systeem (faction-specifieke spells):**
- `npc_trainer` Ã¢â€ â€™ ID kan creature entry zijn (SpellID < 0 = template ref) of template ID (SpellID > 0 = echte spell)
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

**Spell.dbc** Ã¢â‚¬â€ SpellLevel aanpassen voor trainer requirement
- Gelezen/geschreven via bestaande `readSpellFull` / `writeSpellFull` handlers
- SpellLevel = level waarop spell geleerd kan worden (door client getoond)
- Wijzigingen invalideren `spellDbcCache`

**SkillLineAbility.dbc** Ã¢â‚¬â€ bepaalt of een spell toonbaar is bij trainer
- 13 velden Ãƒâ€” 4 bytes = 52 bytes per record (incl. TradeSkillCategoryID)
- Offset 36 = TrivialSkillLineRankLow: **0** = toonbaar bij trainer, **2** = talent/niet-traineerbaar
- ClassMask bepaalt voor welke class de spell geldig is (Paladin=2, Shaman=64, etc.)
- AcquireMethod (offset 28): altijd 1 voor trainer spells in deze DB
- IPC handlers: `dbc:readSkillLineAbility`, `dbc:writeSkillLineAbility` (schrijft TrivialSkillLineRankLow)
- Voor cross-class spells: nieuw record toevoegen aan DBC (nog niet geÃƒÂ¯mplementeerd)

### Spell filtering in DBC search
`searchSpellsDbc` ondersteunt `{ trainerSpells: true }` optie:
- Filter: bit 16 (0x10000) gezet EN bit 19 (0x80000) NIET gezet in Attributes
- Earth Shock trainable ranks: Attributes=327680 (bits 16+18)
- Flash of Light: Attributes=65536 (bit 16 alleen)
- NPC-only varianten: Attributes=851968 (bits 16+18+19) Ã¢â€ â€™ gefilterd

### Rank deduplicatie logica
- Ranked spells (hebben "Rank X" NameSubtext): gegroepeerd per label, confirmed (in trainer_spell) krijgt prioriteit
- WotLK single-rank spells (geen subtext): selecteert laagste ID in bereik 25000-65000 met SpellLevel > 1
- Confirmed (in trainer_spell) wint altijd van niet-confirmed

### Open issues (volgende task)
- Crusader Strike (#35395) verschijnt nog niet bij paladin trainer ondanks correcte trainer_spell entries (TrainerId=3,5,6) en SkillLineAbility.dbc aanpassing
- Cross-class spells toevoegen vereist nieuw SkillLineAbility.dbc record (nog niet geÃƒÂ¯mplementeerd)
- Spec/SkillLine keuze bij Add Trainer (welke spec een spell valt) nog niet in UI

Voorkeuren:
- Respond in english if it saves tokens.
- Schrijf beknopte code zonder overbodige comments
- Gebruik bestaande patronen uit de codebase, introduceer geen nieuwe libraries tenzij gevraagd
- Sla kleine wijzigingen direct op in de map, geen tussentijdse bevestiging nodig
- Als je vragen hebt over de database structuur. vraag mij dit dan. Ik kan het voor je ophalen.
- Als cache files vergrendeld zijn door npm dev. vraag mij dan eerst om het te stoppen in plaats van het hele file opnieuw te schrijven

## Docs-onderhoud bij voltooide taken

Wanneer de gebruiker bevestigt dat een taak/feature voltooid is ("klaar", "werkt", "voltooid", "ship het"):

1. **PROJECT.md** Ã¢â‚¬â€ single source of truth voor status, roadmap en backlog. Verplaats item van Roadmap/Verbeteringen naar de "Voltooide editors" tabel met korte omschrijving, of vink af in QoL Backlog / Classic+ backlog met `[x]` + datum (`YYYY-MM-DD`). Afgevinkte QoL/backlog items blijven staan als history.
2. **AGENTS.md** Ã¢â‚¬â€ alleen aanpassen als de feature nieuwe architectuur, IPC-handlers of niet-vanzelfsprekend gedrag introduceert dat een volgende sessie moet weten. Geen logregels per kleine wijziging.

Geen tussentijdse bevestiging vragen voor deze doc-updates Ã¢â‚¬â€ direct meeschrijven met de code-commit zodat de docs in sync blijven.

## Imported Claude Cowork project instructions

## Enemies Editor Ã¢â‚¬â€ v1 notes
- Route `/enemies` reuses `creature_template` for level, rank, and multipliers; editor-only visibility/status notes live in `enemy_editor_meta` and are created lazily by the page.
- Hidden enemies are never deleted; the page only changes editor classification so content stays recoverable.
