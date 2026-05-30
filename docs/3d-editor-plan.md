# 3D World Editor — Implementatieplan

> Doel: Een Unity/Godot-style 3D editor als aparte tab (`/editor3d`) in de bestaande Electron + React app voor het visueel bewerken van spawns in de WoW 3.3.5 (AzerothCore) wereld.

---

## Architectuuroverzicht

### Nieuwe tab integratie
- **Route:** `/editor3d` in `App.jsx`
- **Nav item:** Toevoegen aan `NAV` array in `Layout.jsx` met `Globe` of `Cube` icon
- **Geen bestaande code aangepast** — volledig geïsoleerd component

### Tech stack
- **Three.js** — 3D rendering engine
- **React Three Fiber (R3F)** — declaratieve Three.js voor React
- **@react-three/drei** — OrbitControls, TransformControls, Gizmos
- **Bestaande infra** — MySQL query via `window.azeroth.db.query`, SOAP via `window.azeroth.soap.command`

### NPM dependencies
```
three
@react-three/fiber
@react-three/drei
```

---

## Fase 1: Proof of Concept (geïsoleerd)

### 1a — Basis 3D setup
- `Editor3DPage.jsx` — hoofdpagina met `<Canvas>` van R3F
- `Editor3DScene.jsx` — 3D scene met:
  - **OrbitControls** (rechtsklik draaien, scroll zoomen, middenklik pannen)
  - **Grid helper** (visueel grid voor oriëntatie)
  - **Ambient light** + directional light
  - **Axes helper** (X=rood, Y=groen, Z=blauw)
- Geen data van MySQL nodig — werkt met dummy spawns

### 1b — Billboard spawns
- Spawns renderen als **sprites** (billboards) met gekleurde cirkels + entry ID label
- Kleurcodering gebaseerd op faction-type (oranje = hostile, blauw = Alliance, rood = Horde, grijs = critter)
- Click = selecteren, hover = highlight
- **Geen M2/WMO model loading** — billboards zijn snel en veilig

### 1c — Transform gizmos
- Move gizmo (pijlen) voor XYZ verplaatsing
- Rotate gizmo (ringen) voor rotatie
- Eventueel Scale gizmo
- Gizmo actief alleen bij geselecteerde spawn

### 1d — Unity-style UI panels
- **Toolbar** (boven): Select, Move, Rotate tools
- **Inspector** (rechts): Transform properties (X, Y, Z), spawn properties
- **Hierarchy** (links): Boomstructuur van spawns in scene
- **Viewport** (midden): 3D canvas

### 1e — Isolatie & veiligheid
- React Error Boundary rond 3D canvas
- Scene cleanup bij unmount (`useEffect` return)
- Eventuele crashes blijven beperkt tot `/editor3d` component
- Testbaar met dummy data, geen DB nodig

**Resultaat:** Een werkende 3D view met clickable spawns, gizmos, en panels — zonder risico voor bestaande functionaliteit.

---

## Fase 2: Data Integratie

### 2a — ADT Terrain parsing (3.3.5) ✅
- ✅ `.adt` files uitlezen uit MPQ (via `readAdtBuffer` in `mpq-reader.js`)
- ✅ MCIN chunk zoeken (reversed magic `NICM`), 256 MCNK-offsets lezen
- ✅ MCVT hoogte data parsen (9×9 outer vertices per chunk)
- ✅ `TerrainMesh` in `Editor3DScene.jsx` — pre-allocated `Float32Array`/`Uint32Array` geometry
- ✅ Max 16 unieke tiles geladen op basis van spawn-verdeling
- ✅ Loose MPQ-mappen (map met `.mpq` extensie) ondersteund naast echte archives
- ⬜ Texture layers (alpha maps) voor visuele terrain weergave
- ⬜ Water/lava rendering (liquid data uit ADT)

### 2b — Echte spawn data uit MySQL ✅
- ✅ `creature` + `gameobject` tabellen via `spawns:load` IPC handler
- ✅ AzerothCore schema: `id1` kolom voor creature entry, `ct.faction` (integer)
- ✅ Map selector in toolbar (Eastern Kingdoms, Kalimdor, Outland, Northrend)
- ✅ Limit 1000 spawns, foutmelding bij mislukken
- ✅ Camera centreert automatisch op zwaartepunt van geladen spawns
- ✅ MPQ prioriteit: hogere patch-nummers/letters winnen (patch-3 > patch-2 > patch-a > patch), locale patches (enUS) hoogste prioriteit

### 2c — Database writes ✅
- ✅ Move gizmo update → `UPDATE creature SET position_x = ?, position_y = ?, position_z = ? WHERE guid = ?`
- ✅ Rotatie update → zelfde principe (orientation via Three.js Y-as euler)
- ✅ Confirmatie voor writes: floating save-balk + undo (remount via resetKey)

### 2d — SOAP integratie ✅
- ✅ Teleport naar geselecteerde spawn via `.go xyz` poging + SOAP fallback
- ✅ Fallback: tijdelijke `game_tele` entry aanmaken, `.reload game_tele`, daarna `.tele name <GM character> <temp locatie>`
- ✅ Settings bewaren SOAP GM account + GM Character Name; config-save merge voorkomt verlies van SOAP settings
- ⬜ `.npc add` / `.gobject add` voor nieuwe spawns plaatsen

---

## Fase 3: Geavanceerde Features (optioneel)

### 3a — M2/WMO model preview ✅
- ✅ DBC `CreatureDisplayInfo.dbc` opzoeken → modelbestandspad per entry
- ✅ M2 binair formaat parsen (vertices, indices, UV's) voor 3.3.5
- ✅ BLP-texturen decoderen → Three.js `DataTexture`
- ✅ `InstancedMesh` per displayId (1 draw call per modeltype)
- ✅ Geselecteerde spawn laadt individueel M2-mesh met gizmos
- ✅ `m2Loader.js`: gedeeld materiaal per textuur, schijfcache v2, incomplete cache-entries worden gewist
- ✅ BLP-zoekvolgorde: `RaptorSkin.blp` vóór `Raptor.blp`, listfile-discovery als fallback
- ✅ Instanced hover = lichte schaalvergroting i.p.v. `instanceColor` (voorkomt flat/grijs uiterlijk)
- ⬜ WMO gebouwen / objecten
- ⬜ Animaties (bones / skinning)

### 3b — Performance optimalisaties
- ✅ LOD systeem (`spawnLod.js`): model (0–380) / billboard (380–720) / hidden (>720), gemeten op X/Z
- ✅ `SpawnLodUpdater.jsx`: één `useFrame` voor alle spawns (geen 1000 losse checks)
- ✅ `InstancedMesh` instancing: ~200 wolves = 1 draw call i.p.v. 200
- ✅ Lagere startcamera (+85/+130 offset) → kleiner zichtbaar vlak bij opstarten
- ✅ Prefetch-radius: 430 units (was 1400)
- ✅ Schijfcache voor M2-assets (geen herhaalde MPQ-parsing)
- ✅ **Camera-movement throttle**: LOD-updates en range-checks overslaan wanneer camera <3 units bewoog (XZ); selectieverandering forceert directe update
- ✅ **Set-hergebruik in M2InstanceLayers.useFrame**: `nextSetRef` hergebruikt, snapshot alleen bij wijziging
- ✅ **Fix InstancedMesh key**: was `${displayId}-${entries.length}` → nu `displayId`; geen GPU-remount meer bij elke spawn die range in/uit gaat
- ⬜ **Billboard instancing**: `SpawnVisual`-cirkels zijn nog losse draw calls (200–300 bij mid-range); kunnen gebundeld worden als InstancedMesh net als M2
- ✅ **Inspector "laden…" vs "niet gevonden"**: `getM2AssetState()` onderscheidt idle/loading/loaded/failed; inspector toont rood "niet gevonden" bij mislukte load
- ✅ **File-found cache in mpq-reader**: `fileFoundIn` Map onthoudt in welke archive een bestand zit — herhaalde reads (modellen, texturen) slaan de volledige archive-scan over
- ✅ **DBC warmup op app-start**: `config:load` en `config:save` starten `getM2DbcData()` direct op de achtergrond, zodat DBC al klaar is als de gebruiker de 3D editor opent
- ⬜ **Persistente file-index**: `fileFoundIn` op schijf bewaren zodat ook de allereerste sessie de archive-scan overslaat (nu: eerste scan duurt nog steeds 30s, daarna instant)
- ✅ **`React.memo` op `Editor3DSpawn`**: selectieverandering re-rendert nu alleen 1–2 spawns i.p.v. 1000
- ✅ **`activeTool` alleen naar geselecteerde spawn**: tool-wissel triggert geen re-renders bij niet-geselecteerde spawns
- ✅ **Per-displayId m2Cache subscriptie (`subscribeM2Asset`)**: 1 model laden triggert alleen state-updates bij spawns met dat displayId
- ✅ **`frameloop="demand"` op Canvas**: R3F rendert alleen bij camerabeweging, interactie of model-load — niet continu 60fps
- ✅ **`state.invalidate()` in CameraFlyControls + CameraFrameFocus**: continue frames tijdens vliegen/focus-animatie
- ⬜ **M2 load throttle**: max 4 gelijktijdige IPC-loads; de rest in een wachtrij — voorkomt IPC-overbelasting bij camerabeweging naar nieuw gebied
- ⬜ Web Workers: ADT parsing in achtergrond thread

### 3c — Minimap overlay ✅
- ✅ Worldmap-tegel (2D BLP-afbeelding uit MPQ) als HTML canvas overlay rechtsboven in de 3D viewport
- ✅ Rode stip die de orbit-target camerapositie op de kaart aangeeft (via `CameraTracker` + `controls.target`)
- ✅ Muiswiel-zoom op de minimap (1× t/m 16×), gecentreerd op camerapositie
- ✅ Eigen offset-kalibratie per continent (`azeroth-minimap-offset` in localStorage), los van SpawnMapPage kalibratie
- ⬜ Klikken op minimap = camera vliegt naar die locatie

### 3d — Waypoint paden in 3D ⬜
- ⬜ `waypoints` tabel uitlezen per geselecteerde creature guid
- ⬜ Waypoints renderen als oranje bollen verbonden door lijnen (`<Line>` uit drei)
- ⬜ Waypoints klikbaar + verplaatsbaar (gizmo per punt)
- ⬜ Nieuwe waypoints toevoegen / verwijderen + DB write
- **Waarde**: direct bruikbaar voor AI-pathing editten zonder de game te starten

### 3e — Inspector uitbreiding ⬜
- ⬜ `creature_template` data tonen: level range, health/mana, creature type, movement type, rank (Normal/Elite/Rare)
- ⬜ `creature` extra kolommen: `spawndist` (wander radius) als cirkel in 3D weergeven
- ⬜ Gameobject: `gameobject_template` naam + type tonen

### 3f — Spawn toevoegen / verwijderen ⬜
- ⬜ Rechtermuisknop op terrain → "Spawn plaatsen" → entry invoeren → `.npc add` / `.gobject add` via SOAP
- ⬜ Geselecteerde spawn verwijderen → `DELETE FROM creature WHERE guid = ?` + `.npc delete` SOAP
- Al deels gepland onder 2d

### 3g — Multi-select ⬜
- ⬜ Box-select (klik-sleep in viewport) + shift-klik
- ⬜ Geselecteerde groep samen verplaatsen (offset behouden)
- ⬜ Batch save

### 3h — Visual upgrades ⬜
- ⬜ Terrain texture layers (MCLY/MCAL alpha maps uit ADT) voor zichtbaar terrein i.p.v. groen vlak
- ⬜ Wander-radius cirkel rond geselecteerde spawn (uit `spawndist` DB kolom)
- ⬜ Fog/distance fade
- ⬜ Day/night cycle

---

## Componentenstructuur

```
src/pages/Editor3DPage.jsx         ← hoofdpagina + route
src/components/editor3d/
├── Editor3DScene.jsx              ← <Canvas> + scene setup
├── Editor3DViewport.jsx           ← viewport container + controls
├── Editor3DToolbar.jsx           ← tool selectie (select/move/rotate)
├── Editor3DInspector.jsx         ← properties panel (rechts)
├── Editor3DHierarchy.jsx         ← scene tree (links)
├── Editor3DSpawn.jsx             ← individuele spawn entity
├── Editor3DGrid.jsx              ← grid helper
├── Editor3DErrorBoundary.jsx     ← crash isolatie
└── Editor3D.css                  ← styling
```

## Performance doelen

| Scenario | Doel |
|----------|------|
| Normale scene (<500 spawns) | 60 FPS |
| Dense scene (1000+ spawns) | 30 FPS |
| Interactie response | <100ms |
| Scene load time | <2s (zonder terrain) |
| ADT terrain load | Acceptabel, async |

## MVP Scope (Fase 1)

- [x] `/editor3d` route + tab
- [x] 3D canvas met OrbitControls
- [x] Grid helper + axes
- [x] Billboard spawn rendering (dummy data)
- [x] Click select + highlight
- [x] Move gizmo (transform controls)
- [x] Inspector panel (XYZ readout)
- [x] Toolbar (select vs move tool)
- [x] Error boundary isolation
- [x] Cleanup op unmount

**Niet in MVP:**
- ADT terrain (Fase 2)
- M2/WMO models (Fase 3)
- Waypoints in 3D
- Undo/redo
- Multi-select

---

---

## Aanbevolen volgende stap

**Terrain zichtbaarheid debuggen + hoogte-inkleuring**

De ADT hoogte-mesh is geïmplementeerd maar laadt voor het grootste deel niet in. Waarschijnlijke oorzaken: tile-selectie te beperkt (max 16 tiles op basis van spawn-verdeling), spawn-data valt buiten tile-grenzen, of ADT-parsing levert lege chunks. Aanpak:
1. Debug welke tiles geladen worden vs. welke er zijn
2. Fix tile-selectie zodat het gebied rondom de camera gedekt is
3. Optioneel: hoogte-inkleuring op basis van Z-waarde (sneeuw/gras/steen) als snelle visuele verbetering zonder texture-pipeline

Alternatief als je liever feature-waarde toevoegt: **3d (waypoint paden)**.

---

*Opgesteld: 26 mei 2026*
*Bijgewerkt: 29 mei 2026 — Alle performance-optimalisaties ✅; feature-roadmap uitgebreid met minimap, waypoints, inspector-uitbreiding, spawn add/delete, multi-select*
*Bijgewerkt: 29 mei 2026 — 3c Minimap overlay ✅ (canvas overlay, zoom, orbit-target tracking, eigen kalibratie per continent)*
