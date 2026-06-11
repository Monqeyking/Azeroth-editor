# Azeroth Editor — Project Overview

> Status, roadmap, backlog en referentie voor de Classic+ Editor.
> Bijgewerkt: 2026-06-10.

---

## 🎯 Project Doel

**Classic+ op WotLK engine.** Een aangepaste WoW-server die een "Classic+" ervaring biedt — Vanilla-sfeer en progressie, gebouwd op de stabiele WotLK (AzerothCore) engine.

- **Custom content** als prioriteit: nieuwe quests, creatures, items, spells — allemaal via eigen ID ranges (4000000+).
- **Vanilla-stijl progressie**: geen dungeon finder, geen flying in old world, klassieke quest chains en reputatie.
- **Balans op WotLK engine**: class mechanics, talent trees en spells aangepast richting Vanilla/TBC feel.
- **DBC-aanpassingen**: SpellLevel, SkillLineAbility, talent trees — server én client synchroon.

Elke editor moet dit doel ondersteunen: snel custom content kunnen aanmaken, aanpassen en testen zonder SQL handwerk.

---

## ✅ Voltooide editors

| Pagina | Route | Korte omschrijving |
|---|---|---|
| ConnectPage | `/connect` | MySQL config, slaat `config.json` op, redirect na succes. |
| SettingsPage | `/settings` | SOAP config (host/port/GM), DBC-pad, custom ID ranges (default 4000000). |
| DashboardPage | `/dashboard` | COUNT-stats voor creature/item/quest/spell + recent creatures tabel. |
| CreatureEditorPage | `/creatures` | Volledige creature editor. Tabs: General, Models, Addon, Trainer, Vendor, Spawns. ZamModelViewer preview. |
| ItemEditorPage | `/items` | `item_template` CRUD met class/quality/bonding dropdowns. Filters + bulk edit, Create tab, Scaling tab. |
| QuestEditorPage | `/quests` | `quest_template` CRUD. Tekstvelden + getallen. |
| SpellEditorPage | `/spells` | `Spell.dbc` via IPC. SchoolMask checkboxes, dropdowns, Effect/EffectAura, Attributes flags, Clone → Trainer workflow, Ctrl+S. |
| TalentEditorPage | `/talents` | DBC-based. Visuele 15×4 grid per class/tab. Drag-and-drop, prereq-pijlen, icon picker, live preview. |
| TrainerSpellPage | `/trainer-spells` | Beheer `trainer_spell` (nieuw systeem) en `npc_trainer` (oud systeem). Zie architectuursectie. |
| LootEditorPage | `/loot` | `creature_loot_template` + `item_loot_template` + `gameobject_loot_template`. Multi-row editor. |
| ItemSetEditorPage | `/item-sets` | `ItemSet.dbc` + custom `item_set_names`. 17 item slots, 8 bonus thresholds. |
| VendorEditorPage | `/vendors` | `npc_vendor` per NPC. Inline edit, item lookup modal. |
| RaceClassPage | `/races` | Race+class combinatie. Sync DB ↔ `CharBaseInfo.dbc`. Wizard bij checkbox-aan. |
| CharCustomizationPage | `/char-customization` | `CharSections.dbc` editor (skin/face/facial hair/hair/underclothing per race+gender). |
| SpawnMapPage | `/map` | 2D kaart. BLP decoder, continent/zone tiles via MPQ. Creature + GO spawns, clustering, pan/zoom, inspector, waypoints, drag-and-drop. |
| Editor3DPage | `/editor3d` | 3D world editor: terrain streaming via AzerothCore `.map` files (naadloos V9/V8), minimap-textures, M2 instancing + LOD, billboard-layer, spawn toggle, move/rotate gizmo's, SOAP teleport. TILE_RADIUS=4 (9×9), MAX_TILES=200. |
| SqlEditorPage | `/sql` | Raw SQL editor. Ctrl+Enter execute, table render, error display. |

---

## 🔧 Verbeteringen voor bestaande editors

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

**Readable field labels:** `SpellClassSet`, `SchoolMask`, `PowerType`, `DefenseType`, `Effect_1/2/3` (ID → naam), `EffectAura_1/2/3` (ID → naam), Attributes bitmask checkboxes.

**Ontbrekende DBC velden (prioriteit):** `EffectBonusMultiplier` (spell power coëff ⭐), `SpellClassMaskA` (talent flags), `EffectChainTarget`, `StartRecoveryTime` (GCD override), `EffectAuraPeriod` (DoT tick interval), `EffectRadiusIndex` (AoE radius).

**`spell_bonus_data` koppeling:** bij Clone → Trainer automatisch rij aanmaken op basis van bronspell.

**`spell_ranks` koppeling:** rank-keten automatisch bijwerken bij meerdere ranks.

### TrainerSpellPage open issues

- Crusader Strike (#35395) verschijnt niet bij paladin trainer ondanks correcte entries (workaround: Clone → Trainer in Spell Editor).
- Cross-class spells toevoegen vereist nieuw `SkillLineAbility.dbc` record (nog niet geïmplementeerd).
- Spec/SkillLine keuze bij Add Trainer nog niet in UI.

### ItemSetEditorPage uitbreidingen

- Clone existing set → custom Classic+ tier.
- Wizard: armor items selecteren → set genereren → schrijf DBC + update `item_template.ItemSet`.
- Spell lookup modal voor set bonus spells.
- Validatie: item class/subclass/slot tonen.

### Editor3DPage open issues (zie ook `PROMPT_next_session.md`)

- **Echte terrain texturen** — splatmap rendering via ADT MTEX/MCLY/MCAL + ShaderMaterial. Zie `PROMPT_next_session.md` voor volledig plan.
- Spawn rendering performance: billboard layer aangemaakt, picker-concurrentie met OrbitControls nog te bekijken.
- Spawns spatial laden (bounding-box query rond camera i.p.v. limit 1000).
- Cache caps main process (blpTextureCache, minimapTexCache etc. groeien onbegrensd).
- Dependency mismatch: `@react-three/drei@10` vereist fiber 9 + React 19, project draait fiber 8 + React 18.

---

## 🗺️ Roadmap nieuwe features

### Tier 1 — Hoge impact, lage complexiteit

**Gossip / NPC Text Editor** — `npc_text`, `gossip_menu`, `gossip_menu_option`. Start met lijst-view. Route: `/gossip`, icon `MessageSquare`.

### Tier 2 — Hoge impact, middelhoge complexiteit

**Conditions Editor** — force multiplier voor Vendor, Gossip, Loot, Trainer editors. Begin met meest gebruikte types.

**GameObject Editor** — `gameobject_template` + spawns. Bouwt op SpawnMapPage.

**Character Skin & Item Retexture** — zie sectie hieronder.

### Tier 3 — Middelhoge impact, hoge complexiteit

**Quest Hub Builder** — wizard die NPC + spawn + gossip + quests + rewards als pakket aanmaakt.

**Zone Content Planner** — aggregatieview per zone: quests, creatures, spawns, loot, vendors.

### Tier 4 — Langetermijn

- **Faction/Reputation Editor** — `faction_template`, `reputation_reward_rate`, custom reputaties.
- **SAI Editor** — `smart_scripts`. Visuele event→action builder.
- **Broadcast Text Editor** — `broadcast_text`. Inline edit met emote/sound.
- **Phase Manager** — `phase_area` + conditions.
- **Dual-faction Quest Tagger** — kloon quest naar Alliance/Horde variant.
- **Achievement Editor** — custom progressie via `achievement_dbc`.
- **Content Pack / Patch Builder** — bundel custom content, exporteer SQL + DBC patch.
- **Game Tele Editor** — `game_tele` CRUD.

---

## 🎨 Character Skin & Item Retexture (gepland)

Geïnspireerd op MangosSuperUI's retexture pipeline. Doel: custom skins voor characters en items maken zonder externe tools.

### Hoe MangosSuperUI het doet (referentie)

**Item Retexture pipeline (volledig AI-powered):**
1. Originele item M2 + BLP texture ophalen uit MPQ
2. Ollama genereert een Flux-prompt ("flat 2D texture, top-down view, WoW vanilla aesthetic")
3. ComfyUI (Flux GGUF model, 25 steps, euler/simple sampler) genereert de texture — txt2img of img2img (instelbare denoiseStrength)
4. Resize naar exacte vanilla BLP dimensies (SkiaSharp)
5. BLP encoder: PNG → BLP (DXT1 of ongecomprimeerd)
6. M2 binary patchen: texture filename offset aanpassen naar custom BLP path
7. Nieuw `ItemDisplayInfo.dbc` display ID alloceren (boven 60000, max van bestaande + 1)
8. Alles bundelen in `patch-M.MPQ`: custom BLPs + M2s + gepatcht DBC — kopiëren naar WoW/Data

**Character Skin Compositor:**
- `CharSections.dbc` uitlezen: variationIndex=0, colorIndex=0, BaseSection=Face
- Body BLP laden als canvas
- Face_lower (0, 192, 128×64) en face_upper (0, 160, 128×32) eroverheen blenden
- Output: composited PNG voor preview of export

**DB tabel die zij gebruiken:** `custom_item_retexture` (display_id, texture_filename, custom_blp LONGBLOB, custom_m2 LONGBLOB, prompt, style_direction, created_at)

### Onze aanpak (gefaseerd)

**Fase 1 — Character skin preview (geen AI, direct nuttig)**
- `CharSections.dbc` uitlezen (skeleton al aanwezig in CharCustomizationPage)
- Body BLP + face overlay compositen met `sharp` (Node.js package)
- Preview tonen in CreatureEditorPage of nieuw `/skins` tabblad
- Vereist: BLP decoder (✅ aanwezig), `sharp` package (nieuw)
- Geschatte complexiteit: medium

**Fase 2 — Item retexture zonder AI**
- Handmatig PNG/BLP uploaden als vervanging voor bestaand item texture
- M2 binary patchen (texture filename offset aanpassen)
- `ItemDisplayInfo.dbc` clonen naar custom ID (60000+)
- MPQ schrijven met nieuwe bestanden (vereist MPQ builder in main.js)
- Vereist: BLP encoder (nog niet aanwezig), MPQ schrijven (deels aanwezig via StormLib)
- Geschatte complexiteit: hoog

**Fase 3 — AI-integratie (optioneel, vereist lokale ComfyUI + Ollama)**
- ComfyUI Flux workflow via API (txt2img of img2img)
- Ollama voor automatische prompt generatie
- denoiseStrength instelbaar per retexture
- Alleen starten als ComfyUI/Ollama lokaal beschikbaar is

---

## 🔒 Classic+ Lockdown & Client Patch Workflow (planned)

### Modules

1. **Expansion Lockdown Dashboard** — checklist: Outland portals, Northrend transports, DK creation, flying trainers, Dungeon Finder scanbaar.
2. **Access Gate Scanner** — routes naar Outland/Northrend: portal spells, GO portals, gossip teleports, transports.
3. **Transport / Portal Blocker** — boats, zeppelins, portals, teleport NPCs.
4. **World Map / Area Lock Editor** — `Map.dbc`, `WorldMapArea.dbc`, `WorldMapOverlay.dbc`.
5. **Expansion Content Filter** — content labelen als Vanilla/TBC/WotLK/Custom Classic+.
6. **Trainer Spell Pruner** — WotLK-only spells blokkeren, custom Vanilla-style progression.
7. **Client Patch Builder** — exporteer DBCs, world map assets, texture overrides. Patch manifest met versie/hash.

### Globale Classic+ backlog

- Vanilla-filter toggle (DK verbergen, WotLK-only content uit dropdowns)
- Talent tree revamp richting Vanilla-stijl
- Crusader Strike ranks via Clone → Trainer workflow

---

## ⚡ QoL Backlog

### Top prioriteit

- [x] **SqlEditor aansluiten** — route `/sql` + nav-item. (2026-06-03)
- [x] **Unsaved-changes guard** — `useBlocker` op alle editors met dirty state. (2026-06-02)
- [ ] **Toast/notification systeem** — `useToast()` hook (`.success/.error/.info`). Vervang stille saves.
- [ ] **Recent edited universeel** — patroon van `localStorage.recent_creatures` uitrollen naar Items, Quests, Spells.
- [ ] **Sidebar pinned shortcuts** — localStorage-lijst met vaak gebruikte entries.

### Cross-editor navigatie

- [ ] **Command palette (Ctrl+P)** — global quick-jump: typ naam/ID, spring naar juiste editor.
- [ ] **Klikbare ID-lookups** — `<EntityLink type="..." id={...} />` overal waar raw entry/ID staat.
- [ ] **Back-references panel** — "verkoopt 12 items / 3 quests / 4 spawns" met directe links.

### Veiligheidsnet

- [ ] **Diff preview vóór save** — modal met gewijzigde velden + confirm.
- [ ] **Auto-backup DBC's** — `.bak.<timestamp>` in `dbcPath/_backups/` bij elke write.
- [ ] **mysqldump-knop in Settings** — per tabel snapshot via IPC.

### Test-in-game

- [ ] **"Test now" knoppen** — `.npc add`, `.additem`, `.cast` via SOAP.
- [ ] **Server status widget Dashboard** — uptime, players online via poll.
- [ ] **GM commands quick panel** — `.reload <table>`, `.server info`, `.account onlinelist`.

### Per-editor polish

- [ ] **SQL Preview panel** — collapsible sectie toont `UPDATE ... SET ... WHERE` vóór save.
- [ ] **FlagsSelector "show all" toggle** — alle flags zichtbaar naast gefilterde weergave.
- [ ] **Meerdere verbindingsprofielen** — max 5 recente DB-verbindingen in `config.json`.
- [ ] **Resizable list/edit splitter** — list-panes zijn nu vaste breedte.
- [ ] **Auto-reconnect MySQL** — detect dropped connection en retry.

---

## 📐 Architectuur & Technische Referentie

Volledige details in `CLAUDE.md`. Samenvatting:

- **Stack:** Electron 29, React 18, Vite 5, React Router 6 (`createHashRouter` + `RouterProvider`, vereist voor `useBlocker`), Lucide React, MySQL2, node-soap.
- **IPC:** `electron/main.js` ↔ `electron/preload.js` (contextBridge) ↔ `window.azeroth.*` in React.
- **Globale state:** `ConnectionContext` voor dbConfig, soapConfig, dbcPath, ID ranges.
- **DBC writes:** moeten naar server- én client-copy. Bestaande pattern in `writeSpellFull`/`writeTalent`/`writeItemSet`.
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

**Nieuw systeem (`trainer` + `trainer_spell` + `creature_default_trainer`):** `creature_default_trainer.CreatureId` → `TrainerId` → `trainer_spell.SpellId`. `LoadTrainers()` filtert talent-spells via `GetTalentSpellCost()`.

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

- `type: 2` = NPC/creature ✅ | `type: 1` = character ❌ | `type: 3` = item ❌ (CORS)
- CSP: wowgaming.altervista.org, wow.zamimg.com, code.jquery.com, fonts.googleapis.com
- Vereiste globals: `window.WH`, `window.$ = window.jQuery`

---

## 🔁 Workflow bij voltooide taken

Wanneer een feature klaar is ("voltooid" / "klaar" / "werkt"):

1. **PROJECT.md** — verplaats naar Voltooide tabel of vink af in backlog (`[x]` + datum).
2. **CLAUDE.md** — alleen aanpassen bij nieuwe architectuur, IPC handlers of niet-vanzelfsprekend gedrag.

Geen tussentijdse bevestiging vragen — direct meeschrijven.
