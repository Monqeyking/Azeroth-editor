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

### 4. Worldmap tiles vanuit WoW client (Optie A) — `Haiku` 🔶 medium
Configureerbaar pad in Settings dat naar een al-geëxtracteerde WORLDMAP-map wijst buiten het project. Verkleint de repo aanzienlijk en geeft de gebruiker controle over de versie.

### 5. Continent-overzicht met klikbare zone-overlays — `Sonnet` 🔶 medium
Zone-grenzen tekenen als klikbare overlays op het continent-overzicht, berekend vanuit WorldMapArea.dbc bounds. Hover = tooltip met naam, klik = naar zone navigeren zonder dropdown.

### 6. Rechtsklik context-menu — `Sonnet` 🔵 laag
Rechtsklik op lege plek: spawn toevoegen. Rechtsklik op marker: coördinaten kopiëren, teleporteer via SOAP (`.go xyz`), spawn verwijderen.

### 7. Worldmap tiles vanuit WoW client (Optie B — MPQ) — `Opus` 🔵 laag / complex
Pure JS MPQ-archief reader in main.js zodat BLP-bestanden direct uit `Data/*.mpq` van de WoW-installatie gelezen worden. Dynamisch zoals de client zelf. Zwaar werk, alleen zinvol als optie A niet voldoet.

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
