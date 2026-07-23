# Azeroth Editor Ã¢â‚¬â€ Project Overview

> Status, roadmap, backlog en referentie voor de Classic+ Editor.
> Bijgewerkt: 2026-06-28.

---

## Ã°Å¸Å½Â¯ Project Doel

**Classic+ op WotLK engine.** Een aangepaste WoW-server die een "Classic+" ervaring biedt Ã¢â‚¬â€ Vanilla-sfeer en progressie, gebouwd op de stabiele WotLK (AzerothCore) engine.

- **Custom content** als prioriteit: nieuwe quests, creatures, items, spells Ã¢â‚¬â€ allemaal via eigen ID ranges (4000000+).
- **Vanilla-stijl progressie**: geen dungeon finder, geen flying in old world, klassieke quest chains en reputatie.
- **Balans op WotLK engine**: class mechanics, talent trees en spells aangepast richting Vanilla/TBC feel.
- **DBC-aanpassingen**: SpellLevel, SkillLineAbility, talent trees Ã¢â‚¬â€ server ÃƒÂ©n client synchroon.

Elke editor moet dit doel ondersteunen: snel custom content kunnen aanmaken, aanpassen en testen zonder SQL handwerk.

---

## Ã¢Å“â€¦ Voltooide editors

| Pagina | Route | Korte omschrijving |
|---|---|---|
| ConnectPage | `/connect` | MySQL config, slaat `config.json` op, redirect na succes. |
| SettingsPage | `/settings` | SOAP config (host/port/GM), DBC-pad, custom ID ranges (default 4000000). |
| DashboardPage | `/dashboard` | COUNT-stats voor creature/item/quest/spell + recent creatures tabel. |
| CreatureEditorPage | `/creatures` | Volledige creature editor. Tabs: General, Models, Addon, Trainer, Vendor, Spawns. ZamModelViewer preview. |
| EnemiesPage | `/enemies` | Creature balancing en visibility editor voor Classic+. Presets, bulk apply en editor-only visibility notes. |
| ItemEditorPage | `/items` | `item_template` CRUD met class/quality/bonding dropdowns. Filters + bulk edit, Create tab, Scaling tab. |
| QuestEditorPage | `/quests` | `quest_template` CRUD. Tekstvelden + getallen. |
| SpellEditorPage | `/spells` | `Spell.dbc` via IPC. SchoolMask checkboxes, dropdowns, Effect/EffectAura, Attributes flags, Clone Ã¢â€ â€™ Trainer workflow, Ctrl+S, Compare-tab tegen extern Spell.dbc (read-only, copy-to-local). |
| TalentEditorPage | `/talents` | DBC-based. Visuele 15Ãƒâ€”4 grid per class/tab. Drag-and-drop, prereq-pijlen, icon picker, live preview, Compare-toggle tegen extern Talent.dbc (read-only split-view, zelfde class/tree selectie). |
| TrainerSpellPage | `/trainer-spells` | Beheer `trainer_spell` (nieuw systeem) en `npc_trainer` (oud systeem). Zie architectuursectie. |
| ProfessionEditorPage | `/professions` | Guided profession workflow met presets, relation inspectie, warnings en clone/variant support. |
| LootEditorPage | `/loot` | `creature_loot_template` + `item_loot_template` + `gameobject_loot_template`. Multi-row editor. |
| ItemSetEditorPage | `/item-sets` | `ItemSet.dbc` + custom `item_set_names`. 17 item slots, 8 bonus thresholds. |
| VendorEditorPage | `/vendors` | `npc_vendor` per NPC. Inline edit, item lookup modal. |
| RaceClassPage | `/races` | Race+class combinatie. Sync DB Ã¢â€ â€ `CharBaseInfo.dbc`. Wizard bij checkbox-aan. |
| CharCustomizationPage | `/char-customization` | `CharSections.dbc` editor (skin/face/facial hair/hair/underclothing per race+gender). Custom-race exports must keep every `RaceID` namespace isolated; Fel Orc rows incorrectly tagged as Race 12 collided with Worgen selections and caused unstable client behavior. |
| SpawnMapPage | `/map` | 2D kaart. BLP decoder, continent/zone tiles via MPQ. Creature + GO spawns, clustering, pan/zoom, inspector, waypoints, drag-and-drop. |
| Editor3DPage | `/editor3d` | 3D world editor: terrain streaming via AzerothCore `.map` files (naadloos V9/V8), minimap-textures, M2 instancing + LOD, billboard-layer, spawn toggle, move/rotate gizmo's, SOAP teleport. TILE_RADIUS=4 (9Ãƒâ€”9), MAX_TILES=200. |
| UIEditorPage | `/ui-editor` | MPQ-backed glue UI editor for login, character select, and character create. Exports to `output\Interface\GlueXML\...`. |
| CreatureDisplaysPage | `/creature-displays` | WMV-style character display creator. Reads client DBC/assets for preview, writes CreatureDisplayInfo DBC records to the configured server path. Character M2 preview supports WotLK armor component atlas compositing, geosets, helm/shoulder/belt attachments, and WMV-equivalent item texture priority. Bake texture writes a loose BLP under `output\BakedNPCTextures` and Save sets the matching non-empty BakeName in CreatureDisplayInfoExtra field 20. |
| SqlEditorPage | `/sql` | Raw SQL editor. Ctrl+Enter execute, table render, error display. |

---

## Ã°Å¸â€Â§ Verbeteringen voor bestaande editors

### ItemEditorPage

**Enum dropdowns nog te bouwen:** `InventoryType` (29 waarden), `stat_type1..10`, `subclass` (context-afhankelijk op `class`), `dmg_type1/2`, `Material`.

**Bitmasks via FlagsSelector:** `AllowableClass`, `AllowableRace`, `Flags`, `FlagsExtra`.

**Ontbrekende velden:** `spellid_2..5` + `spelltrigger_1..5`, cooldowns, `dmg_min/max2`, extra stats, `delay`, `ammo_type`.

**Verder:** WoW-stijl tooltip preview, Display ID icon preview via zamimg, gold/silver/koper inputs voor `BuyPrice`/`SellPrice`, ScalingStatValue smart suggestion op basis van slot + materiaal.

### QuestEditorPage

**Enum dropdowns:** `QuestType`, `RewardXPDifficulty`, `AllowableRaces` bitmask, `Flags` bitmask.

**NPC/Item naam lookups** voor `RequiredNpcOrGo1..4`, `RequiredItemId1..2`, reward items.

**Ontbrekende velden:** chain (`PrevQuestId`, `NextQuestId`, `ExclusiveGroup`), reputation requirements/rewards, `RewardSpell`, `SourceItemId`, emotes.

**Quest chain visualisatie:** mini-diagram van `PrevQuestId`/`NextQuestId`, klikbaar.

### SpellEditorPage

**Readable field labels:** `SpellClassSet`, `SchoolMask`, `PowerType`, `DefenseType`, `Effect_1/2/3` (ID Ã¢â€ â€™ naam), `EffectAura_1/2/3` (ID Ã¢â€ â€™ naam), Attributes bitmask checkboxes.

**Ontbrekende DBC velden (prioriteit):** `EffectBonusMultiplier` (spell power coÃƒÂ«ff Ã¢Â­Â), `SpellClassMaskA` (talent flags), `EffectChainTarget`, `StartRecoveryTime` (GCD override), `EffectAuraPeriod` (DoT tick interval), `EffectRadiusIndex` (AoE radius).

**`spell_bonus_data` koppeling:** bij Clone Ã¢â€ â€™ Trainer automatisch rij aanmaken op basis van bronspell.

**`spell_ranks` koppeling:** rank-keten automatisch bijwerken bij meerdere ranks.

### TrainerSpellPage open issues

- Crusader Strike (#35395) verschijnt niet bij paladin trainer ondanks correcte entries (workaround: Clone Ã¢â€ â€™ Trainer in Spell Editor).
- Cross-class spells toevoegen vereist nieuw `SkillLineAbility.dbc` record (nog niet geÃƒÂ¯mplementeerd).
- Spec/SkillLine keuze bij Add Trainer nog niet in UI.

### ItemSetEditorPage uitbreidingen

- Clone existing set Ã¢â€ â€™ custom Classic+ tier.
- Wizard: armor items selecteren Ã¢â€ â€™ set genereren Ã¢â€ â€™ schrijf DBC + update `item_template.ItemSet`.
- Spell lookup modal voor set bonus spells.
- Validatie: item class/subclass/slot tonen.

### Editor3DPage open issues (zie ook `PROMPT_next_session.md`)

- **Echte terrain texturen** Ã¢â‚¬â€ splatmap rendering via ADT MTEX/MCLY/MCAL + ShaderMaterial. Zie `PROMPT_next_session.md` voor volledig plan.
- Spawn rendering performance: billboard layer aangemaakt, picker-concurrentie met OrbitControls nog te bekijken.
- Spawns spatial laden (bounding-box query rond camera i.p.v. limit 1000).
- Cache caps main process (blpTextureCache, minimapTexCache etc. groeien onbegrensd).
- Dependency mismatch: `@react-three/drei@10` vereist fiber 9 + React 19, project draait fiber 8 + React 18.

---

## Ã°Å¸â€”ÂºÃ¯Â¸Â Roadmap nieuwe features

### Tier 1 Ã¢â‚¬â€ Hoge impact, lage complexiteit

**Gossip / NPC Text Editor** Ã¢â‚¬â€ `npc_text`, `gossip_menu`, `gossip_menu_option`. Start met lijst-view. Route: `/gossip`, icon `MessageSquare`.

### Tier 2 Ã¢â‚¬â€ Hoge impact, middelhoge complexiteit

**Conditions Editor** Ã¢â‚¬â€ force multiplier voor Vendor, Gossip, Loot, Trainer editors. Begin met meest gebruikte types.

**GameObject Editor** Ã¢â‚¬â€ `gameobject_template` + spawns. Bouwt op SpawnMapPage.

**Character Skin & Item Retexture** Ã¢â‚¬â€ zie sectie hieronder.

### Tier 3 Ã¢â‚¬â€ Middelhoge impact, hoge complexiteit

**Quest Hub Builder** Ã¢â‚¬â€ wizard die NPC + spawn + gossip + quests + rewards als pakket aanmaakt.

**Zone Content Planner** Ã¢â‚¬â€ aggregatieview per zone: quests, creatures, spawns, loot, vendors.

### Tier 4 Ã¢â‚¬â€ Langetermijn

- **Faction/Reputation Editor** Ã¢â‚¬â€ `faction_template`, `reputation_reward_rate`, custom reputaties.
- **SAI Editor** Ã¢â‚¬â€ `smart_scripts`. Visuele eventÃ¢â€ â€™action builder.
- **Broadcast Text Editor** Ã¢â‚¬â€ `broadcast_text`. Inline edit met emote/sound.
- **Phase Manager** Ã¢â‚¬â€ `phase_area` + conditions.
- **Dual-faction Quest Tagger** Ã¢â‚¬â€ kloon quest naar Alliance/Horde variant.
- **Achievement Editor** Ã¢â‚¬â€ custom progressie via `achievement_dbc`.
- **Content Pack / Patch Builder** Ã¢â‚¬â€ bundel custom content, exporteer SQL + DBC patch.
- **Game Tele Editor** Ã¢â‚¬â€ `game_tele` CRUD.

---

## Ã°Å¸Å½Â¨ Character Skin & Item Retexture (gepland)

GeÃƒÂ¯nspireerd op MangosSuperUI's retexture pipeline. Doel: custom skins voor characters en items maken zonder externe tools.

### Hoe MangosSuperUI het doet (referentie)

**Item Retexture pipeline (volledig AI-powered):**
1. Originele item M2 + BLP texture ophalen uit MPQ
2. Ollama genereert een Flux-prompt ("flat 2D texture, top-down view, WoW vanilla aesthetic")
3. ComfyUI (Flux GGUF model, 25 steps, euler/simple sampler) genereert de texture Ã¢â‚¬â€ txt2img of img2img (instelbare denoiseStrength)
4. Resize naar exacte vanilla BLP dimensies (SkiaSharp)
5. BLP encoder: PNG Ã¢â€ â€™ BLP (DXT1 of ongecomprimeerd)
6. M2 binary patchen: texture filename offset aanpassen naar custom BLP path
7. Nieuw `ItemDisplayInfo.dbc` display ID alloceren (boven 60000, max van bestaande + 1)
8. Alles bundelen in `patch-M.MPQ`: custom BLPs + M2s + gepatcht DBC Ã¢â‚¬â€ kopiÃƒÂ«ren naar WoW/Data

**Character Skin Compositor:**
- `CharSections.dbc` uitlezen: variationIndex=0, colorIndex=0, BaseSection=Face
- Body BLP laden als canvas
- Face_lower (0, 192, 128Ãƒâ€”64) en face_upper (0, 160, 128Ãƒâ€”32) eroverheen blenden
- Output: composited PNG voor preview of export

**DB tabel die zij gebruiken:** `custom_item_retexture` (display_id, texture_filename, custom_blp LONGBLOB, custom_m2 LONGBLOB, prompt, style_direction, created_at)

### Onze aanpak (gefaseerd)

**Fase 1 Ã¢â‚¬â€ Character skin preview (geen AI, direct nuttig)**
- `CharSections.dbc` uitlezen (skeleton al aanwezig in CharCustomizationPage)
- Body BLP + face overlay compositen met `sharp` (Node.js package)
- Preview tonen in CreatureEditorPage of nieuw `/skins` tabblad
- Vereist: BLP decoder (Ã¢Å“â€¦ aanwezig), `sharp` package (nieuw)
- Geschatte complexiteit: medium

**Fase 2 Ã¢â‚¬â€ Item retexture zonder AI**
- Handmatig PNG/BLP uploaden als vervanging voor bestaand item texture
- M2 binary patchen (texture filename offset aanpassen)
- `ItemDisplayInfo.dbc` clonen naar custom ID (60000+)
- MPQ schrijven met nieuwe bestanden (vereist MPQ builder in main.js)
- Vereist: BLP encoder (nog niet aanwezig), MPQ schrijven (deels aanwezig via StormLib)
- Geschatte complexiteit: hoog

**Fase 3 Ã¢â‚¬â€ AI-integratie (optioneel, vereist lokale ComfyUI + Ollama)**
- ComfyUI Flux workflow via API (txt2img of img2img)
- Ollama voor automatische prompt generatie
- denoiseStrength instelbaar per retexture
- Alleen starten als ComfyUI/Ollama lokaal beschikbaar is

---

## Ã°Å¸â€â€™ Classic+ Lockdown & Client Patch Workflow (planned)

### Modules

1. **Expansion Lockdown Dashboard** Ã¢â‚¬â€ checklist: Outland portals, Northrend transports, DK creation, flying trainers, Dungeon Finder scanbaar.
2. **Access Gate Scanner** Ã¢â‚¬â€ routes naar Outland/Northrend: portal spells, GO portals, gossip teleports, transports.
3. **Transport / Portal Blocker** Ã¢â‚¬â€ boats, zeppelins, portals, teleport NPCs.
4. **World Map / Area Lock Editor** Ã¢â‚¬â€ `Map.dbc`, `WorldMapArea.dbc`, `WorldMapOverlay.dbc`.
5. **Expansion Content Filter** Ã¢â‚¬â€ content labelen als Vanilla/TBC/WotLK/Custom Classic+.
6. **Trainer Spell Pruner** Ã¢â‚¬â€ WotLK-only spells blokkeren, custom Vanilla-style progression.
7. **Client Patch Builder** Ã¢â‚¬â€ exporteer DBCs, world map assets, texture overrides. Patch manifest met versie/hash.

### Globale Classic+ backlog

- Vanilla-filter toggle (DK verbergen, WotLK-only content uit dropdowns)
- Talent tree revamp richting Vanilla-stijl
- Crusader Strike ranks via Clone Ã¢â€ â€™ Trainer workflow

---

## Ã¢Å¡Â¡ QoL Backlog

### Top prioriteit

- [x] **SqlEditor aansluiten** Ã¢â‚¬â€ route `/sql` + nav-item. (2026-06-03)
- [x] **Unsaved-changes guard** Ã¢â‚¬â€ `useBlocker` op alle editors met dirty state. (2026-06-02)
- [ ] **Toast/notification systeem** Ã¢â‚¬â€ `useToast()` hook (`.success/.error/.info`). Vervang stille saves.
- [ ] **Recent edited universeel** Ã¢â‚¬â€ patroon van `localStorage.recent_creatures` uitrollen naar Items, Quests, Spells.
- [ ] **Sidebar pinned shortcuts** Ã¢â‚¬â€ localStorage-lijst met vaak gebruikte entries.

### Cross-editor navigatie

- [ ] **Command palette (Ctrl+P)** Ã¢â‚¬â€ global quick-jump: typ naam/ID, spring naar juiste editor.
- [ ] **Klikbare ID-lookups** Ã¢â‚¬â€ `<EntityLink type="..." id={...} />` overal waar raw entry/ID staat.
- [ ] **Back-references panel** Ã¢â‚¬â€ "verkoopt 12 items / 3 quests / 4 spawns" met directe links.

### Veiligheidsnet

- [ ] **Diff preview vÃƒÂ³ÃƒÂ³r save** Ã¢â‚¬â€ modal met gewijzigde velden + confirm.
- [ ] **Auto-backup DBC's** Ã¢â‚¬â€ `.bak.<timestamp>` in `dbcPath/_backups/` bij elke write.
- [ ] **mysqldump-knop in Settings** Ã¢â‚¬â€ per tabel snapshot via IPC.

### Test-in-game

- [ ] **"Test now" knoppen** Ã¢â‚¬â€ `.npc add`, `.additem`, `.cast` via SOAP.
- [ ] **Server status widget Dashboard** Ã¢â‚¬â€ uptime, players online via poll.
- [ ] **GM commands quick panel** Ã¢â‚¬â€ `.reload <table>`, `.server info`, `.account onlinelist`.

### Per-editor polish

- [ ] **SQL Preview panel** Ã¢â‚¬â€ collapsible sectie toont `UPDATE ... SET ... WHERE` vÃƒÂ³ÃƒÂ³r save.
- [ ] **FlagsSelector "show all" toggle** Ã¢â‚¬â€ alle flags zichtbaar naast gefilterde weergave.
- [ ] **Meerdere verbindingsprofielen** Ã¢â‚¬â€ max 5 recente DB-verbindingen in `config.json`.
- [ ] **Resizable list/edit splitter** Ã¢â‚¬â€ list-panes zijn nu vaste breedte.
- [ ] **Auto-reconnect MySQL** Ã¢â‚¬â€ detect dropped connection en retry.

---

## Ã°Å¸â€œÂ Architectuur & Technische Referentie

Volledige details in `CLAUDE.md`. Samenvatting:

- **Stack:** Electron 29, React 18, Vite 5, React Router 6 (`createHashRouter` + `RouterProvider`, vereist voor `useBlocker`), Lucide React, MySQL2, node-soap.
- **IPC:** `electron/main.js` Ã¢â€ â€ `electron/preload.js` (contextBridge) Ã¢â€ â€ `window.azeroth.*` in React.
- **Globale state:** `ConnectionContext` voor dbConfig, soapConfig, dbcPath, ID ranges.
- **DBC writes:** moeten naar server- ÃƒÂ©n client-copy. Bestaande pattern in `writeSpellFull`/`writeTalent`/`writeItemSet`.
- **Custom ID ranges:** default 4000000+ per type. Configureerbaar in Settings, persistent in `config.json`.

### Code Patterns

```js
// IPC query
const result = await query('SELECT * FROM table WHERE id = ?', [id]);
// result.data = array of rows, result.success bool

// Dirty tracking
const markDirty = () => setDirty(true);

// Ctrl+S shortcut
useEffect(() => {
  const onKey = e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (dirty && selected) handleSave();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [dirty, selected, handleSave]);
```

**Response pattern:** `{ success: true, data: [...] }` of `{ success: false, error: '...' }`

**CSS:** aparte `.css` per pagina (`DashboardPage.css`, `EditorPage.css`, etc.)

### Trainer Systeem Architectuur

AzerothCore gebruikt **twee trainer systemen naast elkaar:**

**Oud systeem (`npc_trainer`):** ID = creature entry, SpellID negatief = template ref, positief = directe spell. Templates 200003/200004 gedeeld, 200020 Alliance, 200021 Horde.

**Nieuw systeem (`trainer` + `trainer_spell` + `creature_default_trainer`):** `creature_default_trainer.CreatureId` Ã¢â€ â€™ `TrainerId` Ã¢â€ â€™ `trainer_spell.SpellId`. `LoadTrainers()` filtert talent-spells via `GetTalentSpellCost()`.

**Bekende TrainerIds:** 1/2 Warrior, 3/6 Paladin, 7/8 Hunter, 9/10 Rogue, 11/12 Priest, 13 Death Knight, 14/15 Shaman, 16/17 Mage, 31/32 Warlock, 33/34 Druid.

### Spell.dbc veld offsets

| Veld | Offset | Type |
|---|---|---|
| ID | 0 | uint32 |
| Attributes / Ex / Ex2 / Ex3 | 16 / 20 / 24 / 28 | uint32 |
| AttributesEx4/5/6/7 | 32 / 36 / 40 / 44 | uint32 |
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
| EffectRadiusIndex_1/2/3 | 368 / 372 / 376 | uint32 |
| EffectAura_1/2/3 | 380 / 384 / 388 | uint32 |
| EffectAuraPeriod_1/2/3 | 392 / 396 / 400 | uint32 |
| EffectChainTarget_1/2/3 | 416 / 420 / 424 | uint32 |
| EffectMiscValue_1/2/3 | 440 / 444 / 448 | int32 |
| EffectTriggerSpell_1/2/3 | 464 / 468 / 472 | uint32 |
| SpellIconID | 532 | uint32 |
| Name_Lang_enUS | 544 | string |
| StartRecoveryTime | 824 | uint32 |
| SpellClassSet | 832 | uint32 |
| SpellClassMaskA_1/2/3 | 836 / 840 / 844 | uint32 |
| EffectBonusMultiplier_1/2/3 | 864 / 868 / 872 | float |
| SchoolMask | 900 | uint32 |

### SkillLineAbility.dbc offsets

| Offset | Veld |
|---|---|
| 0 | ID |
| 4 | SkillLine |
| 8 | Spell |
| 12 | RaceMask |
| 16 | ClassMask |
| 28 | AcquireMethod (1 = trainer) |
| 32 | SupercededBySpell |
| 36 | TrivialSkillLineRankLow (0 = toonbaar bij trainer) |

### ZamModelViewer

- `type: 2` = NPC/creature Ã¢Å“â€¦ | `type: 1` = character Ã¢ÂÅ’ | `type: 3` = item Ã¢ÂÅ’ (CORS)
- CSP: wowgaming.altervista.org, wow.zamimg.com, code.jquery.com, fonts.googleapis.com
- Vereiste globals: `window.WH`, `window.$ = window.jQuery`

---

## Ã°Å¸â€Â Workflow bij voltooide taken

Wanneer een feature klaar is ("voltooid" / "klaar" / "werkt"):

1. **PROJECT.md** Ã¢â‚¬â€ verplaats naar Voltooide tabel of vink af in backlog (`[x]` + datum).
2. **CLAUDE.md** Ã¢â‚¬â€ alleen aanpassen bij nieuwe architectuur, IPC handlers of niet-vanzelfsprekend gedrag.

Geen tussentijdse bevestiging vragen Ã¢â‚¬â€ direct meeschrijven.
