Project: Azeroth Editor — een Electron + React (Vite) desktoptool voor het beheren van AzerothCore WoW-serverdata via MySQL en SOAP.

Tech stack: Electron 29, React 18, Vite 5, React Router 6, Lucide React, MySQL2, node-soap.

Structuur:
- electron/main.js — Electron main process (IPC, DB, SOAP)
- electron/preload.js — contextBridge
- src/ — React frontend (JSX, geen TypeScript)
- src/assets/icon.ico — app-icoon

Voorkeuren:
- Reageer in het Nederlands
- Schrijf beknopte code zonder overbodige comments
- Gebruik bestaande patronen uit de codebase, introduceer geen nieuwe libraries tenzij gevraagd
- Sla kleine wijzigingen direct op in de map, geen tussentijdse bevestiging nodig
- Als je vragen hebt over de database structuur. vraag mij dit dan. Ik kan het voor je ophalen.