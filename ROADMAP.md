# Azeroth Editor — Roadmap

## ✅ Afgerond

- Electron + React (Vite) desktop app, MySQL, SOAP, DBC-pad config
- Creature Editor, Item Editor, Quest Editor (MySQL)
- Spell Editor: veld-editor, copy/clone, DBC-write
- Talent Editor: tree weergave, klasse-filter, tabs, prereq-pijlen, velden bewerken, opslaan, klonen, verwijderen, drag-and-drop met prereq-validatie, volledig 15×4 grid, lege cellen klikbaar/aanmaken
- Spawn Map (2D): BLP decoder, continent + zone kaartweergave, creatures/GOs inladen, inspector panel, waypoints, pan/zoom

---

## 🚧 Talent Editor — afronden

- [ ] Prereq instellen via klik op talent in de tree (ipv handmatig ID typen)
- [ ] PrereqTalent_2 en _3 visueel weergeven in de tree
- [ ] Talent tree achtergrondafbeelding (BackgroundFile uit TalentTab.dbc)
- [ ] Undo/redo

---

## 🗺️ Spawn Map — QoL & bugfixes (prioriteitsvolgorde)

### ✅ 1. Fix drag & drop DB-write — `Haiku` ⚡ hoog
~~Visueel slepen werkt al. De mouseup-handler schrijft de nieuwe positie nog niet correct naar MySQL. Kleine bugfix.~~ **KLAAR** — `await` + error handling, drag threshold (5px) geïmplementeerd.

### ✅ 2. Spawn clustering / LOD — `Sonnet` ⚡ hoog
~~Bij zones met veel spawns (Barrens, EPL) zijn markers niet leesbaar. Grid-gebaseerde clustering op basis van zoom-niveau: clusters tonen als cirkel met tellerbadge, splitsen op bij inzoomen.~~ **KLAAR** — grid-clustering (64px cellen), harde drempel op scale 1.5 (daarboven altijd losse markers), klik op cluster zoomt 2.5× in. Extra: kleurcodering per creature-type (oranje = hostile, rood = Horde, blauw = Alliance, grijs = critter), canvas vergroot naar 2048×1536 voor betere spreiding, inspector als floating overlay, auto-fit kaart bij zone-selectie, SQL zone-filtering op coördinaten (geen overlapping zones meer).

### ✅ 3. Zoek & filter spawns — `Haiku` 🔶 medium
~~Zoekbalk in de toolbar: filter zichtbare markers op naam of entry-ID. Niet-overeenkomende markers worden gedempt. Klik op resultaat centreert de kaart.~~ **KLAAR** — zoekbalk filtert op naam of entry-ID, niet-overeenkomende markers gedempt (opacity 0.2), klik op resultaat centreert kaart en opent inspector. Bij actieve zoekterm wordt clustering uitgeschakeld zodat dimming per individuele marker werkt. Herstel na Haiku-rewrite waarbij alle vorige verbeteringen verloren waren gegaan.

### ✅ 4. Worldmap tiles vanuit WoW client (Optie A) — `Haiku` 🔶 medium
~~Configureerbaar pad in Settings dat naar een al-geëxtracteerde WORLDMAP-map wijst buiten het project. Verkleint de repo aanzienlijk en geeft de gebruiker controle over de versie.~~ **KLAAR** — Settings panel "Worldmap Tiles" met optioneel pad-invoer, Validate Path button (telt zones), fallback naar ingebedde `src/background/WORLDMAP`. Ondersteunt PNG en BLP formaten, zone-gebaseerde structuur (Azeroth/, Blackrock/, etc.). IPC handlers: `getTile()`, `listZones()`, `validatePath()`.

### ✅ 5. Continent-overzicht met klikbare zone-overlays — `Sonnet` 🔶 medium
~~Zone-grenzen tekenen als klikbare overlays op het continent-overzicht, berekend vanuit WorldMapArea.dbc bounds. Hover = tooltip met naam, klik = naar zone navigeren zonder dropdown.~~ **KLAAR** — SVG `<rect>` overlays per zone berekend vanuit `WorldMapArea.dbc` bounds (via `continentArea` als referentie-frame). Hover toont goud-gekleurde tooltip met zone-naam (fixed positioned), klik navigeert direct naar de zone. Pan werkt door op de achtergrond te klikken, `onMouseDown` op overlays stopt event-propagatie zodat pan niet activeert.

### ✅ 6. Rechtsklik context-menu — `Sonnet` 🔵 laag
~~Rechtsklik op lege plek: spawn toevoegen. Rechtsklik op marker: coördinaten kopiëren, teleporteer via SOAP (`.go xyz`), spawn verwijderen.~~ **KLAAR** — context-menu op lege kaart (spawn toevoegen via modal met type + entry ID, INSERT + state-update), op marker (coördinaten kopiëren naar klembord, teleporteer via `.go xyz`, spawn verwijderen met DELETE + state-update). Click-outside sluit het menu.

### 6b. Spawn toevoegen — uitgebreide modal — `Sonnet` 🔵 laag
Huidige modal vraagt alleen entry ID + type. Uitbreiden met de velden die AzerothCore nodig heeft voor een bruikbare spawn: **SpawnMask** (welke difficulty), **MovementType** (Idle/Random/Waypoint), **orientation**, **spawntimesecs** (respawn-timer), optioneel **wander_distance** en **phaseMask**. Creature-template naam live ophalen zodra entry ID is ingevoerd (feedback of de entry bestaat). GO's hebben extra velden: **rotation** (quaternion) en **state** (open/closed/activated).

### ✅ 7. Worldmap tiles vanuit WoW client (Optie B — MPQ) — `Sonnet` 🔵 laag / complex
~~Pure JS MPQ-archief reader in main.js zodat BLP-bestanden direct uit `Data/*.mpq` van de WoW-installatie gelezen worden. Dynamisch zoals de client zelf. Zwaar werk, alleen zinvol als optie A niet voldoet.~~ **KLAAR** — `@wowserhq/stormjs` (StormLib via WASM) geïntegreerd als `electron/mpq-reader.js`. User geeft `Data`-root op in Settings; app zoekt automatisch in root + `enUS/` submappen, sorteert op patch-prioriteit, leest tiles direct uit MPQ via listfile-discovery. Herbruikbaar voor toekomstige 3D-model lookups.

---

## 🛤️ Spawn Map — Waypoint Editor (uitbreiden)

- [ ] Waypoint-punten toevoegen via klik op de kaart
- [ ] Punt verwijderen via rechtsklik
- [ ] Patrol-type instellen per punt
- [ ] Wijzigingen live pushen via SOAP

---

## 🧱 World Editor — 3D (aparte route `/editor3d`)

> **Architectuuradvies:** De huidige 2D spawn map is een uitstekende data-editor — snel, lichtgewicht, geschikt voor bulk-bewerkingen. Voor 3D is het verstandig dit als een **aparte pagina** (`/editor3d`) in dezelfde Electron-app te bouwen met Three.js. Probeer de SVG-kaart niet om te bouwen naar 3D — ze dienen verschillende doelen:
>
> - **2D kaart** → overzicht, bulk-posities aanpassen, waypoints tekenen
> - **3D editor** → precisie-plaatsing, rotatie, hoogte, model preview

- [ ] Three.js pagina (`/editor3d`) in Electron
- [ ] Camera: fly-through of orbit control
- [ ] ADT terrain parsing (hoogte + textuurdata)
- [ ] Spawn-markers in 3D space (billboards of model-placeholder)
- [ ] Transform gizmo: move (pijlen), rotate (ringen), scale — zelfde UX als Unity/Godot
- [ ] M2/WMO model preview (optioneel, complex)
- [ ] Wijzigingen terugschrijven naar MySQL

---

## ⚙️ Algemeen

- [ ] Undo/redo over alle editors
- [ ] Recente items bijhouden per editor
- [ ] Zoekfunctie over alle editors
- [ ] Export/import als JSON backup
- [ ] Spell beschrijving live preview
- [ ] Batch-edit meerdere spells
