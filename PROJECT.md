# Azeroth Editor — Project Overview

> Status, roadmap, backlog en QoL voor de Classic+ Editor.
> Bijgewerkt: 2026-06-02.

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
| CreatureEditorPage | `/creatures` | Volledige creature editor (~1400 regels). Tabs: General, Models, Addon, Trainer, Vendor, Spawns. ZamModelViewer preview. |
| ItemEditorPage | `/items` | `item_template` CRUD met class/quality/bonding dropdowns. Filters + bulk edit, Create tab, Scaling tab voor heirlooms. Zie *Verbeteringen gepland* hieronder. |
| QuestEditorPage | `/quests` | `quest_template` CRUD. Tekstvelden + getallen. Zie *Verbeteringen gepland* hieronder. |
| SpellEditorPage | `/spells` | `Spell.dbc` via IPC. SchoolMask checkboxes, SpellFamily/PowerType/DefenseType dropdowns, Effect/EffectAura met namen (134/293 entries), Attributes flags-lijst, Clone → Trainer workflow, Ctrl+S. |
| TalentEditorPage | `/talents` | DBC-based (Talent.dbc, Spell.dbc, SpellIcon.dbc). Visuele 15×4 grid per class/tab. Drag-and-drop, prereq-pijlen, icon picker, live model preview. |
| TrainerSpellPage | `/trainer-spells` | Beheer `trainer_spell` (nieuw systeem) en `npc_trainer` (oud systeem). Zie CLAUDE.md voor architectuurdetails. |
| LootEditorPage | `/loot` | `creature_loot_template` + `item_loot_template` + `gameobject_loot_template`. Multi-row editor, DELETE+INSERT save. |
| ItemSetEditorPage | `/item-sets` | `ItemSet.dbc` + custom `item_set_names`. 17 item slots, 8 bonus thresholds, auto-ID voor custom sets. |
| VendorEditorPage | `/vendors` | `npc_vendor` per NPC. Inline edit van maxcount/incrtime/ExtendedCost/VerifiedBuild, item lookup modal. |
| RaceClassPage | `/races` | Race+class combinatie. Sync DB ↔ `CharBaseInfo.dbc`. Wizard bij checkbox-aan kopieert startpositie en action bar van zelfde class. |
| CharCustomizationPage | `/char-customization` | `CharSections.dbc` editor (skin/face/facial hair/hair/underclothing per race+gender). |
| SpawnMapPage | `/map` | Spawn-locaties op kaart (WIP). |
| Editor3DPage | `/editor3d` | 3D map/model viewer (WIP). |
| SqlEditorPage | `/sql` | Raw SQL editor. Ctrl+Enter execute, table render, error display. Nav onder WIP-divider (Terminal icon). |

---

## 🔧 Verbeteringen voor bestaande editors

### ItemEditorPage

**Enum dropdowns nog te bouwen:**
- `InventoryType` (29 waarden, 0=Non-equip t/m 28=Relic)
- `stat_type1..10` (Agility=3, Strength=4, Stamina=7, Crit=32, Haste=36, Spell Power=45, etc.)
- `subclass` (context-afhankelijk op `class`: Weapon → Sword/Axe/Mace, Armor → Cloth/Leather/Mail/Plate)
- `dmg_type1/2` (0=Physical t/m 6=Arcane)
- `Material` (-1=Consumable, 1=Metal, 2=Wood, 3=Liquid, 4=Jewelry, 5=Chain, 6=Plate, 7=Cloth, 8=Leather)

**Bitmasks via FlagsSelector:**
- `AllowableClass`, `AllowableRace`, `Flags`, `FlagsExtra`

**Ontbrekende velden toevoegen:**
- `spellid_2..5` + `spelltrigger_1..5`
- `spellcategorycooldown_1`, `spellcooldown_1`
- `dmg_min2`, `dmg_max2`, `dmg_type1`, `dmg_type2`
- `stat_type3..10`, `stat_value3..10`
- `delay` (weapon speed ms), `ammo_type`

**Verder:**
- WoW-stijl tooltip preview rechtsonder (quality-color naam, item level, stats, flavor) — pure frontend, geen IPC.
- Display ID icon preview via `wow.zamimg.com/images/wow/icons/`.
- Gold/silver/koper inputs voor `BuyPrice`/`SellPrice` (samenvoegen tot 1 integer).
- ScalingStatValue smart suggestion op basis van slot + materiaal.

### QuestEditorPage

**Enum dropdowns:**
- `QuestType` (0=Normal, 1=Daily, 21=Weekly, 41=PvP, 62=Raid, 88=Elite, 102=Dungeon, 45=Heroic)
- `RewardXPDifficulty` (0=Trivial t/m 4=Very Difficult)
- `AllowableRaces` als bitmask

**Flags bitmask** (belangrijkste bits: 0=Stay Alive, 2=Deliver More, 6=Exploration, 8=Sharable, 11=Daily, 12=PvP, 20=Weekly)

**NPC/Item naam lookups** voor `RequiredNpcOrGo1..4`, `RequiredItemId1..2`, `RewardItem1/2`, `RewardChoiceItemID1..6` (DB join op `creature_template` / `item_template`).

**Ontbrekende velden:**
- Chain: `PrevQuestId`, `NextQuestId`, `ExclusiveGroup`
- Reputation requirement: `RequiredFactionId1/2` + `RequiredFactionValue1/2`
- Reputation rewards: `RewardFactionID1..5` + values
- `RewardSpell`, `SourceItemId`, `IncompleteEmote`, `CompleteEmote`

**Quest chain visualisatie:** mini-diagram van `PrevQuestId`/`NextQuestId`/`ExclusiveGroup`, klikbaar.

### ItemSetEditorPage uitbreidingen

- Clone existing set → custom Classic+ tier.
- Wizard: armor items selecteren → set genereren → schrijf `ItemSet.dbc` + update `item_template.ItemSet`.
- Spell lookup modal voor set bonus spells.
- Validatie: item class/subclass/slot tonen zodat verkeerde set-items opvallen.

### TrainerSpellPage open issues

- Crusader Strike (#35395) verschijnt niet bij paladin trainer ondanks correcte `trainer_spell` entries en `SkillLineAbility.dbc` aanpassing.
- Cross-class spells toevoegen vereist nieuw `SkillLineAbility.dbc` record (nog niet geïmplementeerd).
- Spec/SkillLine keuze bij Add Trainer (welke spec een spell valt) nog niet in UI.

---

## 🗺️ Roadmap nieuwe features

### Tier 1 — Hoge impact, lage complexiteit

**Gossip / NPC Text Editor** — `npc_text`, `gossip_menu`, `gossip_menu_option`. Start met lijst-view (geen visuele boom v1). Essentieel voor elke custom NPC. Route: `/gossip`, icon `MessageSquare`.

### Tier 2 — Hoge impact, middelhoge complexiteit

**Conditions Editor** — force multiplier voor Vendor, Gossip, Loot, Trainer editors. Begin met meest gebruikte types (item required, quest completed, class/race check), raw-veld als fallback.

**GameObject Editor** — `gameobject_template` + spawns. Chests, deuren, portals, questobjecten. Bouwt op SpawnMapPage. Complexiteit in de vele GO-types met eigen data-velden.

### Tier 3 — Middelhoge impact, hoge complexiteit

**Quest Hub Builder** — wizard die NPC + spawn + gossip + quests + rewards als pakket aanmaakt. Bouwen *nadat* Vendor, Gossip en Quest volwassen zijn.

**Zone Content Planner** — aggregatieview per zone: quests, creatures, spawns, loot, vendors, quest chains. Meest waardevol als alle onderliggende editors er zijn.

### Tier 4 — Langetermijn

- **Faction/Reputation Editor** — `faction_template`, `reputation_reward_rate`, `reputation_spillover_template`. Custom reputaties, rewards, quest reputation flow.
- **Balance/Progression Matrix** — level bracket overzicht voor item level, rewards, mobs, spells, dungeon drops. Deels analytisch.
- **Smart AI (SAI) Editor** — `smart_scripts`. Visuele event→action builder met dropdowns voor event_type/action_type. Hoogste waarde voor NPC scripting, meest complex.
- **Broadcast Text Editor** — `broadcast_text`. Inline edit met emote/sound.
- **Phase Manager** — `phase_area` + conditions. Progressive content releases (bv Naxxramas pas in Phase 3).
- **Dual-faction Quest Tagger** — kloon quest naar Alliance/Horde variant, set `AllowableRaces` + `ExclusiveGroup` + `BreadcrumbForQuestId`.
- **Quest Reward Preview** — XP preview op basis van `QuestLevel`/`RewardXPDifficulty`/character level slider, gold formatted, item icons via wowhead.
- **Game Tele Editor** — `game_tele` CRUD.
- **Achievement Editor** — `achievement_dbc` / `achievement_criteria_dbc` voor custom progressie.
- **Content Pack / Patch Builder** — bundel custom content boven eigen ID ranges, exporteer SQL + DBC patch. Kroon op het werk.

---

## 🔒 Classic+ Lockdown & Client Patch Workflow (planned)

Doel: WotLK client als engine, TBC/WotLK content visueel en functioneel blokkeren zodat de server als Classic+ wereld voelt.

**Onderscheid:**
- **Editor:** beheert DB/DBC/config, scant lekken, maakt patchbestanden, exporteert SQL/DBC/client assets.
- **Launcher/Patcher:** verspreidt patches bij spelers, controleert versies, downloadt MPQ/patch bestanden, start client. Apart traject.

### Modules

1. **Expansion Lockdown Dashboard** — checklist/status van blokkades: Outland portals, Northrend transports, DK creation, flying trainers, Dungeon Finder, WotLK/TBC trainers/vendors/quests/spawns scanbaar.
2. **Access Gate Scanner** — zoek resterende routes naar Outland/Northrend: portal spells, GO portals, gossip teleports, transport routes, quest teleports, NPC/SAI scripts met teleport. Fix-knop waar mogelijk.
3. **Transport / Portal Blocker** — boats, zeppelins, portals, teleport NPCs. Markeer als Classic allowed/blocked.
4. **World Map / Area Lock Editor** — `Map.dbc`, `WorldMapArea.dbc`, `WorldMapOverlay.dbc`. Outland/Northrend entries verbergen of neutraliseren.
5. **Expansion Content Filter** — content labelen als Vanilla/TBC/WotLK/Custom Classic+. Filters in alle editors, bulk actions voor WotLK-only.
6. **Trainer Spell Pruner** — per class trainer spells tonen met expansion label. WotLK-only blokkeren, custom Vanilla-style progression. Sync met `trainer_spell` + `npc_trainer` + DBC.
7. **Client Patch Builder** — exporteer aangepaste DBCs, world map UI assets, texture overrides. Patch manifest met versie/hash. Server DB export + client patch export naast elkaar voor sync-controle.

### Globale Classic+ backlog

- **Vanilla-filter toggle** — DK verbergen/tonen, WotLK-only content uit dropdowns.
- **Talent tree revamp** — aangepaste boom voor Vanilla-stijl.
- **Crusader Strike ranks** — custom spell workflow: baseline melee + holy damage per rank.

---

## ⚡ QoL Backlog

> Cross-cutting verbeteringen die het dagelijks werken sneller, veiliger en consistenter maken.

### Top-5 prio (max effect, min werk)

1. SqlEditor aansluiten (route + nav)
2. Toast-systeem
3. Unsaved-changes guard
4. Klikbare ID-lookups cross-editor
5. SOAP "Test now" knoppen

### Quick wins

- [x] **SqlEditor aansluiten** — pagina bestaat, alleen route `/sql` + nav-item toevoegen. (2026-06-03)
- [ ] **Toast/notification systeem** — `<ToastProvider>` in `ConnectionContext`, `useToast()` hook (`.success/.error/.info`). Vervang stille saves overal.
- [x] **Unsaved-changes guard** — `useBlocker` (React Router 6) op editors met `dirty` state. Modal bij navigatie. (2026-06-02)
- [ ] **Recent edited universeel** — alleen `CreatureEditorPage` gebruikt `localStorage.recent_creatures`. Patroon uitrollen naar Items, Quests, Spells, Trainers.
- [ ] **Sidebar pinned shortcuts** — localStorage-lijst met vaak gebruikte entries boven NAV_MAIN.

### Cross-editor navigatie

- [ ] **Command palette (Ctrl+P)** — global quick-jump: typ naam/ID, spring naar juiste editor.
- [ ] **Klikbare ID-lookups** — `<EntityLink type="..." id={...} />` overal waar raw entry/ID staat. Targets accepteren `?entry=` query param voor auto-select.
- [ ] **Back-references panel** — CreatureEditor: "verkoopt 12 items / 3 quests / 4 spawns" met directe links.

### Veiligheidsnet voor bulk-edits / DBC writes

- [ ] **Diff preview vóór save** — modal: "field X: 100 → 150 (× 1247 rows)" met confirm.
- [ ] **Auto-backup DBC's** — `.bak.<timestamp>` in `dbcPath/_backups/` bij elke write. Settings krijgt "Restore backup" lijst.
- [ ] **mysqldump-knop in Settings** — per tabel snapshot via IPC. Veiligheidsnet vóór risky bulk-edits.

### Test-in-game (SOAP is er al)

- [ ] **"Test now" knoppen** — CreatureEditor `.npc add <entry>`, ItemEditor `.additem <entry>`, SpellEditor `.cast <id>`.
- [ ] **Server status widget Dashboard** — uptime, players online, recent SOAP errors via poll.
- [ ] **GM commands quick panel** — `.reload <table>`, `.server info`, `.account onlinelist`.

### Per-editor polish

- [ ] **FlagsSelector "show all" toggle** — naast huidige "alleen geselecteerde bits" een "alle flags zichtbaar" modus.
- [ ] **SQL Preview panel** — collapsible sectie onderaan formulier toont `UPDATE ... SET ... WHERE` (alleen gewijzigde velden) vóór save.
- [ ] **Meerdere verbindingsprofielen** — sla max 5 recente DB-verbindingen op in `config.json` (zonder wachtwoord), klikbare snelkoppelingen.

### UI / algemeen

- [ ] **Resizable list/edit splitter** — list-panes zijn vaste breedte.
- [ ] **Loading skeletons** in plaats van `'...'` strings.
- [ ] **Auto-reconnect MySQL** — server restart breekt nu de tool tot hard reload. Detect dropped connection en retry.

---

## 📐 Architectuur korte refresh

Volledige details staan in `CLAUDE.md`. Korte samenvatting:

- **Stack:** Electron 29, React 18, Vite 5, React Router 6 (data router — `createHashRouter` + `RouterProvider`, vereist voor `useBlocker`), Lucide React, MySQL2, node-soap.
- **IPC:** `electron/main.js` ↔ `electron/preload.js` (contextBridge) ↔ `window.azeroth.*` in React.
- **Globale state:** `ConnectionContext` voor dbConfig, soapConfig, dbcPath, ID ranges. Alle DB/DBC calls lopen hierdoorheen.
- **DBC writes:** moeten naar server- én client-copy. Bestaande pattern in `writeSpellFull`/`writeTalent`/`writeItemSet`.
- **Custom ID ranges:** default 4000000+ per type. Configureerbaar in Settings, persistent in `config.json`.

---

## 🔁 Workflow bij voltooide taken

Wanneer een feature klaar is en de gebruiker "voltooid" / "klaar" / "werkt" zegt:

1. **PROJECT.md** — verplaats item naar de Voltooide tabel of vink af in QoL/backlog (`[x]` + datum, blijft staan als history).
2. **CLAUDE.md** — alleen aanpassen bij nieuwe architectuur, IPC handlers of niet-vanzelfsprekend gedrag dat een volgende sessie moet weten.

Geen tussentijdse bevestiging vragen voor doc-updates — direct meeschrijven met de code-commit.
