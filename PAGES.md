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

### Sessie 3 (Latest)
- ✅ **Prioriteit 2.6 Phase 2 completed:** Reverse lookup fix voor SpellIconID input veld
- ✅ Root cause identified: `primarySpellIconId` state was not persistent in form; only preview state
- ✅ Fix: Built reverse index `iconToSpellId` mapping during loadTalents
- ✅ Simplified `handleChangeSpellIconId()`: now uses direct index lookup instead of async operations
- ✅ User confirmed: "werkt nu perfect"
- Status: Ready for next priority (2.2, 2.3, 2.4 or move to Prioriteit 3)

### Sessie 2
- ✅ Field-sections added to all 4 editors (Creature, Item, Spell, Quest)
- ✅ Talent Editor icon picker modal implemented (spell search + selection)
- ✅ Talent Editor primary spell icon section added
- Status: Testing validated, moved to reverse lookup implementation

### Sessie 1
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

## Testing Instructions — Prioriteit 2.1: Field-secties

### Voor elke editor (Creature, Item, Spell, Quest):

1. **Open de editor** en selecteer een bestaande entry
   - Creature Editor: Kies bijv. entry #1 (humans)
   - Item Editor: Kies bijv. entry #1
   - Spell Editor: Kies bijv. spell #1
   - Quest Editor: Kies bijv. quest #1

2. **Verificeer sectiontitels**
   - Scroll door het formulier en controleer of je duidelijke section headers ziet (bijv. "BASIS INFO", "SPEEDS", "MODIFIERS")
   - Elk section title moet UPPERCASE zijn en in het goud/muted kleur

3. **Verificeer visuele scheiding**
   - Tussen elke section moet een subtiele horizontale lijn zichtbaar zijn (border-top)
   - Er moet duidelijke spacing zijn tussen sections (niet klem tegen elkaar)

4. **Verificeer field-groepering**
   - CreatureEditor: 9 sections (Basis Info, Levels, Speeds, Combat, Appearance, Modifiers, Loot & Gold, Flags, Behavior)
   - ItemEditor: 9 sections (Basis Info, Classification, Display, Pricing, Requirements, Stats, Properties, Bonuses, Spells & Scripts)
   - SpellEditor: 9 sections (Basis Info, School & Type, Attributes, Timing, Range & Targets, Mechanics, Power & Levels, Effects, Visual & Priority)
   - QuestEditor: 10 sections (Basis Info, Objectives, Classification, Configuration, Rewards, Reward Items, Reward Choices, Requirements, Quest Chain, Waypoint)

5. **Scroll behavior**
   - Scroll helemaal naar beneden in het form
   - Controleer dat de laatste section (bijv. "Behavior" in CreatureEditor) ook duidelijk zichtbaar is
   - Geen truncation of overlap van content

6. **Field alignment**
   - Alle velden binnen een section moeten netjes in het 3-koloms grid uitlijnen
   - Section title moet volledige breedte spanning (grid-column: 1 / -1)

### Expected Result:
- Alle editors tonen hun velden nu in logische, gelabelde sections
- Visuele hiërarchie is duidelijk
- Formulier is veel overzichtelijker voor 40-50+ velden

---

## Testing Instructions — Prioriteit 2.6: Talent Editor Primary Spell Icon (Updated)

### Talent Editor — Multi-rank spell update + Live preview

1. **Open Talent Editor** en selecteer een talent met meerdere ranks hetzelfde spell
   - Bijv. "Anger Management" (Stormstrike, etc.) waar Rank 1, 2, 3 allemaal spell 910 hebben
   - Check: formulier toont "Spell Icon" section bovenaan (voor "Positie")

2. **Verificeer Primary Spell section**
   - Ziet je: "[icon] Primary Spell — Anger Management (3 ranks)"
   - Input veld toont: 910
   - Preview icon: toont icon van spell 910 (groot, 48x48)
   - Icon laadt automatisch (readSpellIcons haalt SpellIconID op)

3. **Wijzig het Spell ID**
   - Typ in het input veld: 1337 (ander spell, bijv. Stormstrike)
   - **Automatische updates:**
     - Alle 3 ranks updaten naar 1337
     - Preview icon update naar icon van spell 1337
     - **Talent node in de tree update ook live** (icon verandert in de grid!)
     - Label toont: "1337 — Stormstrike (3 ranks)"

4. **Verificeer talent tree live preview**
   - Scroll naar de talent tree
   - De node icon verander terwijl je typen → live feedback
   - Formulier markeer als dirty

5. **Reset test**
   - Klik Reset → preview gaat terug naar origineel (910)
   - Talent tree icon gaat ook terug
   - Ander talent selecteren en terug → origineel blijft

6. **Verificeer "Spell IDs per Rank" vereenvoudigd**
   - Scroll naar beneden
   - Ziet je enkel input velden (geen duplicate icons/buttons meer)
   - Rank 1,2,3 tonen allemaal 1337 (up-to-date)

### Expected Result:
- Wijziging primaire spell update **alle ranks tegelijk**
- **Icon preview laadt automatisch** (SpellIconID lookup)
- **Talent tree update live** (visuele feedback)
- Veel schoner UI (geen duplicates)
- Reset werkt correct (terug naar origineel)

---

## Testing Instructions — Prioriteit 2.5: Talent Editor Icon Picker

### Talent Editor — Icon Selector Modal

1. **Open Talent Editor** en selecteer een class + talent tree tab
   - Selecteer bijvoorbeeld "Warrior" → "Fury" tab
   - Kies een talent in de grid

2. **Verifieer SpellRank velden**
   - In het edit panel onder "Spell IDs per Rank" zie je nu:
     - Label (bijv. "Rank 1 — Spell Name")
     - "Wijzig Icon" button
     - Icon preview (als beschikbaar)
     - Spell ID input field

3. **Open icon picker modal**
   - Klik op "Wijzig Icon" button → modal verschijnt
   - Modal toont: header, close button (X), search bar, scrollable spell list

4. **Zoek en selecteer spell**
   - Typ in search bar: bijv. "fireball" of "1234" (spell ID)
   - Lijst filtert automatisch op naam of ID
   - Klik op een spell → preview icon verschijnt naast name/ID
   - Modal sluit automatisch en SpellRank field update

5. **Verifieer update**
   - Na selectie → SpellRank ID field toont nieuwe spell ID
   - Preview icon in het Rank veld toont de nieuwe icon
   - Dirty state wordt aangezet (kan je nu opslaan)

### Expected Result:
- Icon picker modal is intuïtief en responsive
- Zoeken werkt naar naam en spell ID
- Selectie update het formulier direct (ohne to save yet)
- Modal sluit netjes na selectie
- Icons laden correct in preview

---

## Testing Instructions — Prioriteit 2.2–2.4: QoL Polish Sprint

### Voor elke editor (CreatureEditorPage, ItemEditorPage, SpellEditorPage, QuestEditorPage, TalentEditorPage):

#### Test 1: Dirty-state indicator
1. **Open de editor** en selecteer een bestaande entry
2. **Wijzig één veld** (bijv. name, level, spell ID)
   - Controleer: **gele stip (●) verschijnt** naast de entry-naam in de h1/panel-header
3. **Reset** (klik "Reset" button)
   - Controleer: stip verdwijnt, formulier gaat terug naar origineel
4. **Wijzig opnieuw** → stip verschijnt
5. **Sla op** (Ctrl+S of Save button)
   - Controleer: stip verdwijnt na succesvolle save

#### Test 2: Ctrl+S keyboard shortcut
1. **Open editor**, selecteer entry, wijzig veld
2. **Press Ctrl+S** (of Cmd+S op Mac)
   - Controleer: `handleSave()` triggert (success toast zichtbaar)
   - Controleer: **geen page reload** (formulier blijft intact)
   - Controleer: stip verdwijnt
3. **Wijzig opnieuw**, **Press Ctrl+S**, success toast verschijnt opnieuw

#### Test 3: Search bar autofocus
1. **Open editor**
   - Controleer: cursor staat automatisch in zoekbalk (blinking cursor zichtbaar)
   - Controleer: kan direct typen zonder te klikken
2. **Type "test"**
   - Controleer: zoekresultaten filteren direct (geen klik nodig)
3. **Close + reopen editor**
   - Controleer: focus is weer op zoekbalk

#### Test Suite Checklist (per editor):

| Editor | Dirty ● | Ctrl+S | Search Focus |
|--------|---------|--------|--------------|
| CreatureEditor | ✅ | ✅ | ✅ |
| ItemEditor | ✅ | ✅ | ✅ |
| SpellEditor | ✅ | ✅ | ✅ |
| QuestEditor | ✅ | ✅ | ✅ |
| TalentEditor | ✅ | ✅ | ✅* |

\* TalentEditor: spell picker search in modal has autoFocus (no ref-based autofocus needed)

#### Edge Cases:

1. **Dirty indicator persistence**
   - Wijzig veld → stip verschijnt
   - Navigeer naar ander item (in dezelfde editor)
   - Controleer: origineel item toont geen stip meer (state cleared)

2. **Ctrl+S with nothing selected**
   - Selecteer geen item
   - Press Ctrl+S
   - Controleer: nothing happens (handler check: `if (dirty && selected)`)

3. **Multiple rapid saves**
   - Open editor, wijzig, Ctrl+S, Ctrl+S, Ctrl+S (3x snel)
   - Controleer: alle toasts tonen
   - Controleer: geen race conditions (form stays in sync)

### Expected Result:
- ✅ Alle 3 features werken in alle 5 editors
- ✅ Dirty indicator is duidelijk zichtbaar (gele stip)
- ✅ Ctrl+S geeft direct feedback (toast)
- ✅ Search bar is direct bruikbaar (autofocus)
- ✅ No console errors

---

Bijgewerkt: 2026-05-24

---

## QoL Verbeterplan — Sessie 3+

Dit plan beschrijft concrete, prioritized verbeteringen voor look & feel, intuitief gebruik, en testbaarheid. Elke taak is klein genoeg om zelfstandig op te pakken.

### Prioriteit 1 — Layout & Navigatie (hoge impact, weinig risico) ✅ VOLTOOID

**1.1 Editor-header toevoegen aan alle editorpagina's** ✅ GEDAAN
- Probleem: editors starten direct met het split-panel, er is geen duidelijke pagina-titel of context
- Fix: voeg een sticky `.editor-header` toe (32px hoog, border-bottom) met paginanaam + korte beschrijving, vergelijkbaar met DashboardPage `.page-header`
- Bestanden: CreatureEditorPage.jsx, ItemEditorPage.jsx, QuestEditorPage.jsx, SpellEditorPage.jsx + EditorPage.css
- Patroon: `<div className="editor-page-header"><h2>{title}</h2><p>{subtitle}</p></div>`
- **Status:** ✅ Geïmplementeerd in alle 4 editors met duidelijke titels

**1.2 Active list-item beter zichtbaar maken** ✅ GEDAAN
- Probleem: geselecteerd item in de lijst heeft alleen een subtiele goud-tint (`rgba(200,169,110,0.08)`), nauwelijks zichtbaar op donkere achtergrond
- Fix: verhoog naar `rgba(200,169,110,0.14)` + maak de border-left dikker (3px) en helderder (`var(--gold)` i.p.v. `var(--gold-dim)`)
- Bestand: EditorPage.css `.list-item.active`
- **Status:** ✅ CSS aangepast

**1.3 Lege staat editor-panel (empty state)** ✅ GEDAAN
- Probleem: als niets geselecteerd is, toont `.editor-empty` alleen een regel tekst, geen visuele uitnodiging
- Fix: centreer een Lucide-icon (bijv. `<MousePointerClick />`) + twee regels tekst ("Selecteer een item" / "om te beginnen met bewerken"), licht goud gekleurd
- Bestand: EditorPage.css + elke editor-JSX
- **Status:** ✅ Geïmplementeerd in alle 4 editors met MousePointerClick icon

**1.4 Sidebar — actieve nav-item left-border aanpassen** ✅ GEDAAN
- Probleem: de 2px left-border verschuift de padding subtiel (padding-left 10→8), wat een kleine layout-jitter veroorzaakt bij navigatie
- Fix: gebruik `box-shadow: inset 3px 0 0 var(--gold)` i.p.v. border-left om geen layout-shift te veroorzaken
- Bestand: Layout.css `.nav-item.active`
- **Status:** ✅ CSS aangepast, geen jitter meer

---

### Prioriteit 2 — Formulieren & Fields (gebruiksgemak)

**2.1 Field-secties met visuele groepering** ✅ VOLTOOID
- Probleem: alle velden in een 3-koloms grid zonder visuele scheiding, onoverzichtelijk bij 40+ velden
- Fix: voeg `<div className="field-section">` toe met een `<h4 className="field-section-title">` (bijv. "Basis", "Snelheden", "Modifiers", "Loot", "Flags") + een subtiele `border-top` scheidingslijn
- Bestanden: CreatureEditorPage.jsx, ItemEditorPage.jsx, QuestEditorPage.jsx, SpellEditorPage.jsx + EditorPage.css
- **Implementatie:**
  - EditorPage.css: Toegevoegd `.field-section` (grid-column: 1 / -1; margin-top: 24px; border-top: 1px solid var(--border)) en `.field-section-title` (uppercase, muted color, letter-spacing)
  - CreatureEditorPage.jsx: `getFieldSections()` met 9 logische groepen (Basis Info, Levels, Speeds, Combat, Appearance, Modifiers, Loot & Gold, Flags, Behavior)
  - ItemEditorPage.jsx: `getFieldSections()` met 9 groepen (Basis Info, Classification, Display, Pricing, Requirements, Stats, Properties, Bonuses, Spells & Scripts)
  - SpellEditorPage.jsx: `getFieldSections()` met 9 groepen (Basis Info, School & Type, Attributes, Timing, Range & Targets, Mechanics, Power & Levels, Effects, Visual & Priority)
  - QuestEditorPage.jsx: `getFieldSections()` met 10 groepen (Basis Info, Objectives, Classification, Configuration, Rewards, Reward Items, Reward Choices, Requirements, Quest Chain, Waypoint)
  - Form-rendering: Alle 4 editors nu gebruiken `getFieldSections().map(section => ...)` in plaats van directe field mapping
- **Status:** ✅ Geïmplementeerd in alle 4 editors met duidelijke thematische groepering

**2.5 Talent Editor — Icon picker in edit panel** ✅ VOLTOOID
- Probleem: moeilijk om icons/spells te selecteren door handmatig spell IDs in te typen
- Fix: voeg "Wijzig Icon" button toe naast SpellRank velden → modal met searchable spell list met icons
- Implementatie:
  - State: `showSpellPicker`, `pickingRank`, `spellSearchTerm`
  - Modal component: `spell-picker-modal` met overlay, header, search, scrollable list
  - SpellRank velden nu tonen: label + "Wijzig Icon" button + preview icon + input
  - Modal toont alle beschikbare spells (uit `spellNames`) met icons, sorteerbaar op naam/ID
  - Selectie → update `form.SpellRank_X` zonder te saven (save later)
- CSS: nieuwe classes voor `.spell-rank-group`, `.spell-picker-modal`, `.spell-picker-item`, etc.
- **Status:** ✅ Geïmplementeerd; SelectSpell zoeken/filteren werkt

**2.6 Talent Editor — Primary Spell Icon per Talent** ✅ VOLTOOID (inclusief reverse lookup fix)
- Probleem: wijzigen van spell icon moet per rank gebeuren, maar meestal hebben alle ranks dezelfde spell
- Fix: voeg "Spell Icon" section toe bovenaan edit panel met één input + preview
- Implementatie (Fase 1):
  - Detecteer welke ranks hebben dezelfde spell als SpellRank_1 (primary spell)
  - Toon: "Spell Icon ID [2562] (3 ranks) — Anger Management"
  - Bij wijziging: update **alle** ranks die deze spell hebben naar het nieuwe spell ID
  - Preview: één grote icon (48x48, niet per rank)
  - **Auto-load icon**: Bij wijziging van primary spell → haalt automatisch SpellIconID op + laadt PNG
  - **Live talent tree preview**: Wijziging update ook de selected talent node in de tree (live feedback)
  - **Reset on unselect**: Bij navigatie/unselect gaat preview terug naar origineel
  - "Spell IDs per Rank" vereenvoudigd: alleen input, geen duplicate icons/buttons
- CSS: `.spell-icon-master` (highlighted section), `.spell-icon-master-preview` (48px icon)
- **Status Phase 1 (Input editable):** ✅ Geïmplementeerd; multi-rank update + live preview werkt, maar veld springt terug bij edit
- **Status Phase 2 (Reverse lookup):** ✅ VOLTOOID
  - **Probleem:** Input veld springde terug naar originele waarde
  - **Root cause:** `primarySpellIconId` was niet persistent in form state; alleen preview state
  - **Fix:** Reverse index `iconToSpellId` gebouwd in loadTalents → maps iconID → spellID
  - **Logica:** Wanneer user SpellIconID wijzigt → reverse lookup in index → vind welk spell dat icon heeft → update alle matching ranks naar dat spell
  - **Result:** Wijziging is nu persistent; primarySpellId verandert → useEffect re-syncs correct
  - **State added:** `const [iconToSpellId, setIconToSpellId] = useState({})` — gebouwd in loadTalents
  - **Function:** `handleChangeSpellIconId()` simplified — gebruikt `iconToSpellId[newIconId]` direct ipv async lookup
  - **Testing:** ✅ User confirmed: "werkt nu perfect"

**2.2 Dirty-state indicatie in de header** ✅ VOLTOOID
- Probleem: gebruiker weet niet altijd of er unsaved changes zijn
- Fix: toon een kleine gele stip (`●`) naast de Entry/naam in de form-header als `dirty === true`
- Bestanden: alle editor-JSX (CreatureEditorPage, ItemEditorPage, SpellEditorPage, QuestEditorPage, TalentEditorPage)
- Patroon: `{dirty && <span style={{color: 'var(--gold)', marginLeft: '8px'}}>●</span>}`
- **Status:** ✅ Geïmplementeerd in alle 5 editors

**2.3 Save-knop keyboard shortcut (Ctrl+S)** ✅ VOLTOOID
- Probleem: moet muisklik gebruiken om op te slaan
- Fix: `useEffect` met `keydown` listener op `Ctrl+S` → roept `handleSave()` aan; opruimen in cleanup
- Bestanden: alle editor-JSX (zelfde patroon overal)
- Patroon:
  ```javascript
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
  ```
- **Status:** ✅ Geïmplementeerd in alle 5 editors (Creature, Item, Spell, Quest, Talent)

**2.4 Zoekbalk focus bij pagina-load** ✅ VOLTOOID
- Probleem: gebruiker moet handmatig in zoekbalk klikken
- Fix: `useEffect(() => { searchRef.current?.focus(); }, [])` met `ref` op het zoek-input
- Bestanden: alle editor-JSX (CreatureEditorPage, ItemEditorPage, SpellEditorPage, QuestEditorPage)
- Patroon: `const searchRef = useRef(null);` + `<input ref={searchRef} />`
- **Note:** TalentEditorPage heeft spell picker search met `autoFocus` in de modal → geen extra ref nodig
- **Status:** ✅ Geïmplementeerd in 4 editors (Creature, Item, Spell, Quest)

---

### Prioriteit 3 — Feedback & Statusindicaties

**3.1 Toast-notificatie component (herbruikbaar)**
- Probleem: success/error berichten zijn per pagina anders geïmplementeerd, inconsistent gedrag (sommige faden niet weg)
- Fix: maak `src/components/Toast.jsx` + `Toast.css`, exporteer als `<Toast message={msg} />`. Gebruik in alle editors i.p.v. inline `.editor-msg` divs
- Patroon: `{ type: 'success'|'error', text: '...' }` → auto-dismiss na 3s met fadeOut animatie

**3.2 Loading skeleton voor de lijst**
- Probleem: lijst toont niets tijdens het laden, geen feedback
- Fix: toon 6x een `.skeleton-item` placeholder (animated shimmer) tijdens `loading === true`
- Bestanden: EditorPage.css (nieuwe `.skeleton-item` klasse) + alle editor-JSX

**3.3 ConnectPage — "Test verbinding" knop**
- Probleem: de TODO in ConnectPage is al lang open, gebruiker moet blind verbinden
- Fix: voeg een "Test" button toe naast Connect die alleen `query('SELECT 1')` uitvoert en success/error toont zonder navigatie
- Bestand: ConnectPage.jsx

---

### Prioriteit 4 — Save-functionaliteit implementeren

**4.1 CreatureEditorPage save**
- Query: `UPDATE creature_template SET name=?, subname=?, minlevel=?, maxlevel=?, ... WHERE entry=?`
- Na save: eventueel SOAP `.reload creature entry X`
- Dirty-reset na succesvolle save

**4.2 ItemEditorPage save**
- Query: `UPDATE item_template SET name=?, class=?, subclass=?, ... WHERE entry=?`

**4.3 SpellEditorPage save**
- Query: `UPDATE spell_dbc SET Name_Lang_enUS=?, Effect_1=?, ... WHERE ID=?`
- Let op: controleer welke kolommen beschrijfbaar zijn in AzerothCore's spell_dbc tabel

**4.4 QuestEditorPage save**
- Query: `UPDATE quest_template SET Title=?, Details=?, Objectives=?, ... WHERE ID=?`

> **Aanpak voor saves**: Bouw één generieke `buildUpdateQuery(table, pkField, fields, form)` helper in `src/lib/queryHelpers.js` die de UPDATE-query + params opstelt. Hiermee zijn alle vier editors snel te implementeren.

---

### Prioriteit 5 — Testen

**5.1 Handmatige testchecklist per editor**

Voor elke editor doorlopen:
1. [ ] Zoeken op naam (LIKE) → lijst toont resultaten
2. [ ] Zoeken op ID (exact) → correct item geselecteerd
3. [ ] Klik item → form vult correct in
4. [ ] Wijzig een veld → dirty-indicator verschijnt
5. [ ] Reset → form terug naar originele waarden, dirty verdwenen
6. [ ] Save → success toast, dirty verdwenen
7. [ ] Ververs pagina → sla op, herlaad, check of waarden persistent zijn in DB
8. [ ] Lege zoekterm → laad eerste 50 items

**5.2 Electron DevTools snelkoppeling**
- Voeg in `electron/main.js` toe: `globalShortcut.register('F12', () => win.webContents.openDevTools())`
- Makkelijker debuggen zonder code te wijzigen

**5.3 IPC Error logging**
- Zorg dat alle IPC handlers in `electron/main.js` fouten loggen naar `console.error` met de handler-naam als prefix
- Patroon: `catch(e) { console.error('[creatures:save]', e.message); return { error: e.message }; }`

---

### CSS Verbeteringen — Overzicht

| Klasse/Selector | Bestand | Huidige waarde | Aanbevolen waarde |
|---|---|---|---|
| `.list-item.active` | EditorPage.css | `border-left: 2px solid var(--gold-dim)` | `border-left: 3px solid var(--gold)` + `background: rgba(200,169,110,0.14)` |
| `.nav-item.active` | Layout.css | `border-left: 2px solid var(--gold)` | `box-shadow: inset 3px 0 0 var(--gold)` (geen layout-shift) |
| `.editor-empty` | EditorPage.css | alleen tekst | voeg icon + subtekst toe |
| `.field-section-title` | EditorPage.css | (nieuw) | zie Prioriteit 2.1 |
| `.skeleton-item` | EditorPage.css | (nieuw) | shimmer animatie |

---

### Implementatievolgorde (aanbevolen voor Haiku)

1. CSS tweaks (1.2, 1.4) — puur CSS, geen logica
2. Empty state (1.3) — minimale JSX
3. Editor-headers (1.1) — copy-paste patroon
4. Dirty indicator (2.2) — één regel JSX per editor
5. Ctrl+S shortcut (2.3) — zelfde useEffect in alle editors
6. Field-secties (2.1) — JSX herstructurering per editor
7. Zoekbalk autofocus (2.4)
8. Toast component (3.1) — nieuwe component, daarna refactor editors
9. Loading skeleton (3.2)
10. ConnectPage test-knop (3.3)
11. Save queries (Prioriteit 4) — per editor, gebruik queryHelpers.js
12. F12 DevTools + IPC logging (5.2, 5.3)

Bijgewerkt: 2026-05-24
