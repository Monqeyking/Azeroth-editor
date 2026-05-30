Project: Azeroth Editor — een Electron + React (Vite) desktoptool voor het beheren van AzerothCore WoW-serverdata via MySQL en SOAP.

Tech stack: Electron 29, React 18, Vite 5, React Router 6, Lucide React, MySQL2, node-soap.

Structuur:
- electron/main.js — Electron main process (IPC, DB, SOAP)
- electron/preload.js — contextBridge
- src/ — React frontend (JSX, geen TypeScript)
- src/assets/icon.ico — app-icoon

## Model Preview (CreatureModelPreview.jsx)
Uses ZamModelViewer (Wowhead cloud renderer) — requires internet.
- Script: `https://wowgaming.altervista.org/modelviewer/scripts/viewer.min.js`
- Content: `https://wowgaming.altervista.org/modelviewer/data/get.php?path=`
- Requires `window.jQuery`, `window.$`, and `window.WH` globals before init
- NPC type = 8, aspect = 0.8
- CSP in main.js covers: wowgaming.altervista.org, wow.zamimg.com, code.jquery.com, fonts.googleapis.com
- Old Three.js/M2 renderer is commented out at the bottom of the file for reference
- CharSections.dbc is parsed in getM2DbcData() for fallback skin texture lookups (still used by the 3D editor map view)

## Creature Editor — model table inputs
- Integer columns (Idx, CreatureDisplayID, VerifiedBuild): type="text" inputMode="numeric" + custom ▲▼ buttons using onMouseDown+preventDefault — exactly one step per click, no auto-repeat
- Decimal columns (DisplayScale, Probability): type="number" step="0.01" with onWheel → blur() to prevent scroll-changing values

Voorkeuren:
- Respond in english if it saves tokens.
- Schrijf beknopte code zonder overbodige comments
- Gebruik bestaande patronen uit de codebase, introduceer geen nieuwe libraries tenzij gevraagd
- Sla kleine wijzigingen direct op in de map, geen tussentijdse bevestiging nodig
- Als je vragen hebt over de database structuur. vraag mij dit dan. Ik kan het voor je ophalen.
- Als cache files vergrendeld zijn door npm dev. vraag mij dan eerst om het te stoppen in plaats van het hele file opnieuw te schrijven