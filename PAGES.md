# Azeroth Editor - Pages & Features Dokumentatie

Een gedetailleerd overzicht van alle pagina's, hun features, technische implementatie, placeholders en teststatus. Dit document helpt toekomstige sessies sneller de codebase te begrijpen zonder elke keer alles opnieuw te moeten lezen.

---

## 1. TalentEditorPage.jsx

**Status:** ✅ Werkend (icon loading afgerond in sessie 1)

### Doel
Visuele WoW 3.3.5 talent tree editor met DBC-bestanden (geen MySQL). Laat classspecifieke talents zien in een grid, met spell icons en bewerk-panel.

### Features Geïmplementeerd
- **Talent tabs per class**: Laad alleen relevante talent tabs via ClassMask filtering (bitwise AND)
- **DBC-lezing** (drie-staps pipeline):
  1. `readTalents()` → Talent.dbc → spellRank_1 IDs
  2. `readSpells()` → Spell.dbc → spell names + spellIconID (met correcte offsets!)
  3. `readSpellIcons()` → SpellIcon.dbc → TextureFilename
  4. `getIcon()` → Laad PNG van `/src/static/icons/`, return base64 dataURL
- **Visuele grid**: 60px talent nodes met gaps van 10px, dynamische grootte op basis van maxRow/maxCol
- **Icon display**: Spell icons als backgrounds in talent nodes, fallback op afgekorte spell name
- **Rank indicator**: Toont max rank (1-9) in rode badge
- **Edit panel**: 
  - Positie (TierID, ColumnIndex)
  - Prerequisite talent + rank
  - SpellRank_1 t/m SpellRank_5 (met spell name hints)
  - "Opslaan" button (enkel talent), "Alles" button (alle talents in tab)
- **State cleanup**: Bij class-switch worden spell names/icons gewist (geen kontaminatie)

### Technische Details

**DBC-offsets voor Spell.dbc (kritiek!):**
- Name_Lang_enUS: offset 544 (field 136)
- SpellIconID: offset 532 (field 133)
- Per field = 4 bytes, dus field N = offset (N * 4)

**ClassMask filtering:**
```javascript
const classMask = 1 << (cls.id - 1);  // id 1-10
const match = (t.ClassMask & classMask) !== 0;
```

**Icon loading pipeline:**
```
Talent.SpellRank_1 (e.g. 16039)
  → Spell.dbc[16039].SpellIconID (e.g. 122)
    → SpellIcon.dbc[122].TextureFilename (e.g. "Interface\Icons\Spell_Nature_EarthBindTotem")
      → Strip "Interface\Icons\" + add ".png"
        → getIcon("Spell_Nature_EarthBindTotem.png")
          → /src/static/icons/Spell_Nature_EarthBindTotem.png
            → base64 dataURL (cached)
```

### Placeholders / TODO
- [ ] `saveTalent()` / `writeTalent()` → DBC write-back nog niet getest in full workflow
- [ ] Prerequisite talent validatie (crossreference naar andere talent IDs)
- [ ] MaxRank berekening (huidige: telt tot 9 ranks, maar kan verder gaan)
- [ ] Tooltip verbeteringen (meer info over preq's)
- [ ] Undo/Redo functionaliteit
- [ ] Batch prerequisite editor

### Getest ✅
- Class selector + ClassMask filtering
- Tab loading per class
- Talent grid rendering
- Spell name + icon loading (complete pipeline)
- Edit panel form binding
- Dirty state tracking
- Reset & save functionality
- Message feedback (success/error)

### Nog uit te voeren
- [ ] Full DBC write-back test (bij locale setup)
- [ ] Edge cases: talents zonder spell, broken icon filenames
- [ ] Performance bij 100+ talents
- [ ] Prerequisite chain validation
- [ ] Span across multiple columns/tiers

---

## 2. DashboardPage.jsx

**Status:** ✅ Werkend (MySQL-based)

### Doel
Overzichtspagina met database stats en recent creatures.

### Features Geïmplementeerd
- **Stat cards**: 4x cards (creatures, items, quests, spells) met COUNT(*) queries
- **Recently Added Creatures**: Tabel van laatste 8 creatures, sorteer op entry DESC
- **Database info**: Host, port, user, database display
- **Live indicator**: Green "Live" badge met pulsing status

### Queries
```sql
SELECT COUNT(*) as c FROM creature_template
SELECT COUNT(*) as c FROM item_template
SELECT COUNT(*) as c FROM quest_template
SELECT COUNT(*) as c FROM spell_dbc
SELECT entry, name, minlevel, maxlevel, rank FROM creature_template ORDER BY entry DESC LIMIT 8
```

### Placeholders / TODO
- [ ] Real-time refresh per X seconden
- [ ] Trend indicators (↑ new creatures this session)
- [ ] Pie charts per creature type
- [ ] Recent edits tracking

### Getest ✅
- Dashboard loads
- Stat queries work
- Creatures tabel render

---

## 3. ConnectPage.jsx

**Status:** ✅ Werkend

### Doel
MySQL verbinding setup UI.

### Features Geïmplementeerd
- **Form fields**: host, port, user, password, database
- **Persistent storage**: "Remember credentials" checkbox → config.json
- **Error handling**: dbError display
- **Connection state**: isConnecting button disabled state
- **Auto-redirect**: Nav to `/dashboard` on success

### Config Persistence
```javascript
window.azeroth.config.load() / save({ db, rememberMe })
```

### Placeholders / TODO
- [ ] Test connection button (ping database)
- [ ] Presets (localhost defaults)
- [ ] SSL/TLS toggle
- [ ] SSH tunnel setup

### Getest ✅
- Form input binding
- Config save/load
- Navigation on connect

---

## 4. SettingsPage.jsx

**Status:** ✅ Werkend

### Doel
Configuratie voor SOAP (live server commands) en DBC file path.

### Features Geïmplementeerd
- **SOAP Settings**:
  - Host, Port, Username (GM account), Password
  - "Test Connection" button → executes `.server info`
  - Success/error message display
- **DBC Path Settings**:
  - Path input (e.g., `D:\CaioCore\CaioServer\data\dbc`)
  - Save button → updates context
- **Feedback messages**: 2s "Saved!" toasts

### SOAP Flow
```javascript
window.azeroth.soap.command({ host, port, user, password, command: '.server info' })
```

### DBC Path Context
```javascript
const { dbcPath, setDbcPath } = useConnection();
```

Wordt gebruikt in TalentEditorPage / andere DBC readers als base directory.

### Placeholders / TODO
- [ ] SOAP command history
- [ ] Connection caching (dont test every click)
- [ ] Auto-discover DBC path
- [ ] Multiple SOAP profiles

### Getest ✅
- Form binding
- Config persistence
- Test connection UI

---

## 5. SpellEditorPage.jsx

**Status:** ⚠️ Gedeeltelijk (UI klaar, save nog niet volledig)

### Doel
MySQL-based spell editor met search en massive field set.

### Features Geïmplementeerd
- **Search**: By ID (exact) of Name_Lang_enUS (LIKE)
- **Spell list**: Scrollable list met ID, Name, SchoolMask, DefenseType
- **Field set**: 56 fields (name, subtext, description, school, effects, damage, icons, etc.)
- **Field types**: text, textarea, number, decimal, select
- **Edit panel**: Schoon form layout, dirty tracking, save button
- **Field structure:**
  ```javascript
  { key: 'Name_Lang_enUS', label: 'Name (enUS)', type: 'text' },
  { key: 'SpellIconID', label: 'Icon ID', type: 'number' },
  { key: 'Effect_1', label: 'Effect 1', type: 'number' },
  { key: 'EffectBasePoints_1', label: 'Base Points 1', type: 'number' },
  // ... etc
  ```

### Database
```sql
SELECT * FROM spell_dbc WHERE ID = ?
```

### Placeholders / TODO
- [ ] Icon preview in editor (fetch via TalentEditorPage logic)
- [ ] Effect type dropdowns (e.g., 1=Instant, 2=DoT)
- [ ] School enum mapping (1=Holy, 2=Fire, etc.)
- [ ] Validation (MaxLevel > 0, ManaCost >= 0)
- [ ] Batch edit (edit multiple spells)
- [ ] Category/Mechanic lookups

### Getest ⚠️
- Search works
- Field binding works
- [ ] Save to DB (query implementation niet gelezen)

---

## 6. CreatureEditorPage.jsx

**Status:** ⚠️ Gedeeltelijk (UI klaar, save/SOAP sync nog niet volledig)

### Doel
MySQL creature editor met SOAP live-sync support.

### Features Geïmplementeerd
- **Search**: By entry (exact) of name (LIKE)
- **Creature list**: Entry, Name, Level range, Rank badge
- **Field set**: 47 fields (name, level, faction, speeds, class, rank, type, family, modifiers, loot, AI, script, etc.)
- **Field types**: text, number, decimal, select (rank, type, movement)
- **Rank display**: Color-coded badges (Normal=green, Elite=blue, Boss=gold)
- **Type display**: Humanoid, Beast, Dragon, Undead, etc.
- **Speed fields**: Walk, Run, Swim, Flight (decimal)
- **SOAP integration**: After save, execute command on live server
- **Delete button**: Marks creature for deletion (placeholder)

### Database
```sql
SELECT * FROM creature_template WHERE entry = ?
SELECT entry, name, minlevel, maxlevel, rank FROM creature_template LIMIT 50
```

### SOAP Workflow (placeholder)
```javascript
const { soapCommand, soapConfig } = useConnection();
// After save: soapCommand({ ...soapConfig, command: 'reload creature entry X' })
```

### Placeholders / TODO
- [ ] Save to creature_template implementation
- [ ] SOAP reload command (`.reload creature entry X`)
- [ ] Delete confirmation dialog
- [ ] Loot table preview (lootid → item_loot_template)
- [ ] AI name autocomplete
- [ ] Script name validation
- [ ] Faction enum dropdown
- [ ] Family dropdown

### Getest ⚠️
- Search / list rendering works
- [ ] Save flow
- [ ] SOAP sync

---

## 7. ItemEditorPage.jsx

**Status:** ⚠️ Gedeeltelijk (UI klaar, save nog niet)

### Doel
MySQL item editor met quality color coding.

### Features Geïmplementeerd
- **Search**: By entry or name
- **Item list**: Entry, Name, Quality badge (poor=gray, common=white, rare=blue, epic=purple, legendary=orange)
- **Field set**: 37 fields (name, class, subclass, display, quality, price, level, bonding, stats, spell, script)
- **Quality colors**: 7 WoW quality tiers met eigen kleur
- **Field types**: text, number, decimal, select (class, quality, bonding)
- **Stat system**: 2x stat type/value pairs
- **Spell system**: 1x spell ID + trigger effect

### Database
```sql
SELECT * FROM item_template WHERE entry = ?
```

### Placeholders / TODO
- [ ] Save to DB
- [ ] Class/subclass enum mapping
- [ ] Inventory type dropdown
- [ ] Stat type lookup (1=Strength, 3=Stamina, etc.)
- [ ] Stat value validator
- [ ] Item icons via TalentEditorPage icon logic
- [ ] Required level color coding

### Getest ⚠️
- List / search works
- Quality display works

---

## 8. QuestEditorPage.jsx

**Status:** ⚠️ Gedeeltelijk (UI klaar, save nog niet)

### Doel
MySQL quest editor, massive quest fields (rewards, requirements, objectives).

### Features Geïmplementeerd
- **Search**: By ID or title
- **Quest list**: ID, Title, Level, Zone
- **Field set**: 50+ fields (title, description, level, objectives 1-4, rewards items/money/xp, requirements NPC/items, choice items, etc.)
- **Field types**: text, textarea, number, select
- **Reward item system**: 2x item + quantity, 2x choice item + quantity
- **Requirement system**: 2x NPC/GO + count, 2x item + count
- **Objective system**: 4x objective text

### Database
```sql
SELECT * FROM quest_template WHERE ID = ?
```

### Placeholders / TODO
- [ ] Save to DB
- [ ] Zone/Sort ID lookup
- [ ] NPC entry autocomplete
- [ ] Objective type mapping
- [ ] Reward spell preview
- [ ] Completion log formatting helper
- [ ] Quest chain navigation (next quest links)
- [ ] Difficulty scaling (level vs xp)

### Getest ⚠️
- List / search works

---

## Quick Reference: DBC vs MySQL

| Feature | DBC (Binary) | MySQL |
|---------|--------------|-------|
| **TalentEditor** | ✅ Full working | ❌ Not applicable |
| **SpellEditor** | ❌ Not used (info only in icons) | ✅ Partial |
| **CreatureEditor** | ❌ Not applicable | ⚠️ Partial |
| **ItemEditor** | ❌ Not applicable | ⚠️ Partial |
| **QuestEditor** | ❌ Not applicable | ⚠️ Partial |
| **Dashboard** | ❌ Not used | ✅ Stats only |

---

## Session History & Notes

### Sessie 1 (Latest)
- ✅ Icon loading pipeline fixed (Spell.dbc offsets corrected: 544 for name, 532 for iconID)
- ✅ TalentEditorPage now fully functional
- ⚠️ Git setup started (node_modules size issue with GitHub)
- Status: Code ready, deployment blocked

### Known Issues
- node_modules/electron/dist/electron.exe (168 MB) exceeds GitHub's 100 MB file limit
  - Solution: Use `git filter-repo --path node_modules --invert-paths` OR create clean repo with only src/electron/config

---

## Tips voor Debugging

### Icon Loading Fails?
1. Check /src/static/icons/ directory exists
2. Verify PNG filenames match TextureFilename from SpellIcon.dbc (strip "Interface\Icons\", add ".png")
3. Check browser console for base64 encoding errors
4. Log in electron/main.js:icons:get handler

### Spell Names Empty?
1. Verify Spell.dbc offsets (544 for name, 532 for iconID) — use debug script
2. Test with `spell 16039` (should be "Convection", iconID 122)
3. Check string block boundaries in readDbcFile()

### ClassMask Not Filtering?
1. Verify ClassMask binary encoding: `1 << (classId - 1)`
2. Log: `console.log('classMask:', classMask, 'binary:', classMask.toString(2))`
3. Check TalentTab.dbc records have proper ClassMask values

### DBC File Read Errors?
1. Check path in SettingsPage (must point to valid DBC directory)
2. Verify file exists: `fs.existsSync(path.join(dbcPath, 'Spell.dbc'))`
3. Check WDBC header (first 4 bytes must be 0x57424443 = "WDBC")

---

## Performance Considerations

- **Large talent trees**: 100+ talents → grid recalculates dimensions on every node
  - Fix: Memoize maxRow/maxCol calculations
- **Icon caching**: Currently in-memory, survives within session
  - Risk: Memory leak if loading 1000s of icons
  - Fix: Implement LRU cache or localStorage

---

## Environment Setup

```bash
# DBC path (SettingsPage)
D:\CaioCore\CaioServer\data\dbc

# Icon directory (hardcoded)
/src/static/icons/

# SOAP server (SettingsPage)
localhost:7878 (default)

# MySQL (ConnectPage)
localhost:3306 / acore_wotlk_world (default)
```

---

## Code Patterns Used

- **Context API**: ConnectionContext.jsx für globale DB/DBC state
- **React Hooks**: useState, useEffect, useCallback, useContext
- **IPC Bridge**: window.azeroth.* methods (preload.js)
- **Error Handling**: {success, error} response pattern
- **Form State**: form={...}, dirty tracking, reset logic
- **CSS**: Separate .css files per page (DashboardPage.css, EditorPage.css, etc.)

---

Bijgewerkt: 2026-05-24
