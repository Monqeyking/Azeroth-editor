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

### 3a — M2/WMO model preview ⬜
- ⬜ DBC `CreatureDisplayInfo.dbc` opzoeken → modelbestandspad per entry
- ⬜ M2 binair formaat parsen (vertices, indices, UV's, bones) voor 3.3.5
- ⬜ BLP-texturen decoderen → Three.js textures
- ⬜ `SkinnedMesh` bouwen per spawn
- **Huidig:** billboards (gekleurde cirkels + entry ID) als placeholder

### 3b — Performance optimalisaties ⬜
- ⬜ LOD: spawns verder weg renderen als simpele puntjes
- ⬜ Frustum culling: niet-zichtbare objecten niet renderen
- ⬜ Instancing: zelfde spawn types delen geometrie
- ⬜ Web Workers: ADT parsing in achtergrond thread

### 3c — Visual upgrades ⬜
- ⬜ Fog/distance fade
- ⬜ Minimap overlay
- ⬜ Waypoint lijnen in 3D
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

## Volgende stap

De meest logische vervolgstap is **2c (database writes)** — zodat verplaatste spawns ook daadwerkelijk opgeslagen worden. Of **3a (M2 models)** als je de visuele weergave wilt verbeteren.

---

*Opgesteld: 26 mei 2026*
*Bijgewerkt: 27 mei 2026 — Fase 1 volledig ✅, Fase 2a + 2b + 2c volledig ✅*
