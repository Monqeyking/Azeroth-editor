# Azeroth Editor — Docs

> Electron 29 + React 18 (Vite) desktoptool voor AzerothCore WoW-serverdata via MySQL en SOAP.
> **Laatste update:** 2026-05-30

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
SOAP config (host, port, GM user/pass, test-knop) + DBC-pad instelling.

### ✅ DashboardPage
COUNT-stats voor creature/item/quest/spell. Recent creatures tabel.

### ✅ TalentEditorPage
DBC-based (Talent.dbc, Spell.dbc, SpellIcon.dbc). Visuele 15×4 grid per class/tab. Drag-and-drop, prereq-pijlen, icon picker modal, primary spell icon met live preview. Opslaan → DBC write-back.

**DBC-offsets Spell.dbc:** Name_Lang_enUS = offset 544, SpellIconID = offset 532.

### ✅ SpellEditorPage
MySQL `spell_dbc`. 56 velden in 9 secties. Search op naam/ID.

### ✅ ItemEditorPage
MySQL `item_template`. 37 velden in 9 secties. Quality kleur-badges.

### ✅ QuestEditorPage
MySQL `quest_template`. 50+ velden in 10 secties.

### ✅ CreatureEditorPage ← meest complex
MySQL `creature_template` + gerelateerde tabellen. Keira3-workflow:

**Sub-tabs:** General, Template Model, Addon, Trainer, Vendor, World Spawns

**Multi-table save:** `creature_template`, `creature_template_addon`, `npc_trainer`, `npc_vendor`, `creature`

**Split reference 50/50:** tweede creature parallel laden, per-sectie copy-knoppen.

**Template Model tab:**
- `creature_template_model` multi-row editor (Idx, CreatureDisplayID, DisplayScale, Probability, VerifiedBuild)
- Integer kolommen: `type="text" inputMode="numeric"` + ▲▼ buttons via onMouseDown+preventDefault
- Decimal kolommen: `type="number" step="0.01"` + onWheel → blur()
- Live NPC preview via ZamModelViewer (type 2, NPC_TYPE=8)
- **Mainhand / Offhand inputs:** item ID + naam (live lookup uit `item_template`) + screenshot thumbnail
  - Thumbnail URL: `https://wow.zamimg.com/modelviewer/wrath/webthumbs/item/{displayId % 256}/{displayId}.webp`
  - `displayId` komt uit `item_template.displayid`
  - Auto-geladen bij creature select via `creature_equip_template` (ID=1, ItemID1=MH, ItemID2=OH)
  - Visueel-only (niet opgeslagen)
- Layout: NPC model links, MH+OH thumbnails rechts ernaast

### ✅ SpawnMap (`/map`)
2D kaart. BLP decoder, continent/zone tiles via MPQ. Creature + GO spawns, clustering, pan/zoom, inspector, waypoints, drag-and-drop DB-write, spawn zoeken/filteren.

### ✅ 3D Editor (`/editor3d`)
Three.js + R3F. ADT terrain, MySQL spawns, move/rotate gizmo, M2 instancing + LOD, minimap overlay, SOAP teleport. Details: `docs/3d-editor-plan.md`.

---

## ZamModelViewer — Technische notities

**Script:** `https://wowgaming.altervista.org/modelviewer/scripts/viewer.min.js`
**Content:** `https://wowgaming.altervista.org/modelviewer/data/get.php?path=`

**Ondersteunde types:**
- `type: 2` — NPC/creature (✅ werkt via altervista)
- `type: 1` — character (❌ niet ondersteund door altervista script)
- `type: 3` — item (❌ altervista heeft geen item data; wow.zamimg.com heeft CORS-blokkade)
- `type: 4` — ongeldig ("Bad viewer type given")

**Conclusie:** 3D item previews zijn niet mogelijk. Gebruik in plaats daarvan statische Wowhead webthumbs (zie Template Model tab hierboven).

**CSP (electron/main.js) dekt:** wowgaming.altervista.org, wow.zamimg.com, code.jquery.com, fonts.googleapis.com

**Vereiste globals:**
```js
window.WH = { debug: () => {}, defaultAnimation: 'Stand', WebP: { getImageExtension: () => '.webp' } }
window.$ = window.jQuery
```

---

## Backlog (prioriteitsvolgorde)

### 🔴 Hoog

**Creature Equipment Editor (tab)**
Tabel: `creature_equip_template` — `CreatureID`, `ID` (slot 1–3), `ItemID1/2/3`, `VerifiedBuild`
- Multi-row editor (één rij per equipment set)
- Item naam-lookup uit `item_template`
- Koppelen aan mainhand/offhand preview in Model tab

**Smart AI Editor (SAI)**
Tabel: `smart_scripts` — meest bewerkte tabel op elke server
- Visuele event → action builder
- Inline documentatie per event/action ID
- Link via `entryorguid`
- Zie Keira3 als referentie

**Creature Loot Editor**
Tabel: `creature_loot_template`
- Multi-row: ItemEntry, Chance, MinCount, MaxCount, QuestRequired, LootMode, GroupId
- Item naam-lookup, drop-chance balk
- `reference_loot_template` voor gedeelde loot pools

### 🟡 Medium

**Creature Text tab** — `creature_text` (say/yell/gossip rijen)

**NPC Gossip / Text Editor** — `npc_text`, `gossip_menu`, `gossip_menu_option`
- Dialog tree preview
- `broadcast_text` lookup

**Waypoint Editor** — `waypoints` / `creature_addon.path_id`
- Patrol paden tekenen op de SpawnMap minimap

**Quest Editor uitbreiden** — `quest_template_addon`, `conditions`, reward previews, quest chain navigatie

**Global Search** — één zoekbalk over creature/item/quest/gameobject/spell

**SQL Export / Diff View**
- Gegenereerde INSERT/UPDATE SQL vóór opslaan tonen
- Copy to clipboard of opslaan als .sql

### 🔵 Laag

**Item Editor uitbreiden** — stat/socket/resistance velden, flag/bitmask selectors

**Spell Editor** — `spell_dbc` / `spell_custom_attr`, description preview

**Gameobject Editor** — zelfde patroon als Creature Editor

**Raw SQL Editor** — vrije query invoer (Keira3 `sql-editor` patroon)

**Verbindingsprofielen** — max 5 opslaan (zonder wachtwoord)

---

## Algemene QoL backlog

- [ ] Undo/redo over alle editors
- [ ] Toast-notificatie als herbruikbaar component (`src/components/Toast.jsx`)
- [ ] Loading skeleton voor lijsten (shimmer animatie)
- [ ] ConnectPage — "Test verbinding" knop (zonder navigatie)
- [ ] Recente items voor alle editors (creature heeft al `localStorage`)
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
