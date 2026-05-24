# Azeroth Editor — Roadmap

## ✅ Afgerond

- Electron + React (Vite) desktop app, MySQL, SOAP, DBC-pad config
- Creature Editor, Item Editor, Quest Editor (MySQL)
- Spell Editor: veld-editor, copy/clone, DBC-write
- Talent Editor: tree weergave, klasse-filter, tabs, prereq-pijlen, velden bewerken, opslaan, klonen, verwijderen, drag-and-drop met prereq-validatie, volledig 15×4 grid, lege cellen klikbaar/aanmaken

---

## 🚧 Talent Editor — afronden

- [ ] Prereq instellen via klik op talent in de tree (ipv handmatig ID typen)
- [ ] PrereqTalent_2 en _3 visueel weergeven in de tree
- [ ] Talent tree achtergrondafbeelding (BackgroundFile uit TalentTab.dbc)
- [ ] Undo/redo

---

## 🗺️ World Editor — Fase 1: Spawn Map (MVP)

Doel: 2D kaartweergave van een WoW-map met klikbare/sleepbare creature- en gameobject-spawns. Zelfde patroon als bestaande editors (MySQL query → React render → edit panel), maar visueel op een kaart.

- [ ] Kaartviewer: minimap-tiles laden als achtergrond per MapID
- [ ] Creature-spawns inladen uit MySQL en plotten als iconen op de kaart
- [ ] Gameobject-spawns inladen en plotten
- [ ] Klik op spawn → edit panel (positie, orientation, template, etc.)
- [ ] Spawn verslepen → positie updaten in MySQL (+ live via SOAP)
- [ ] Rechtermuisklik op kaart → nieuw spawn plaatsen op die coördinaten
- [ ] Filter op type, template ID, faction

---

## 🛤️ World Editor — Fase 2: Waypoint Editor

- [ ] Waypoints inladen per creature (`waypoints` tabel)
- [ ] Path visueel tekenen op de kaart met SVG-lijnen
- [ ] Punten toevoegen, verplaatsen, verwijderen
- [ ] Patrol-type instellen

---

## 🧱 World Editor — Fase 3: 3D Preview

- [ ] Three.js integreren in Electron
- [ ] 3D overhead view met spawn-markers
- [ ] ADT terrain parsing (hoogte/textuurdata)
- [ ] M2/WMO model preview (optioneel)

---

## ⚙️ Algemeen

- [ ] Undo/redo over alle editors
- [ ] Recente items bijhouden per editor
- [ ] Zoekfunctie over alle editors
- [ ] Export/import als JSON backup
- [ ] Spell beschrijving live preview
- [ ] Batch-edit meerdere spells
