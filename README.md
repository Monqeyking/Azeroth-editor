<<<<<<< HEAD
# Azeroth Editor

A desktop editor for AzerothCore (WotLK 3.3.5a) built with Electron + React.

## Features

- **Creature Editor** — full creature_template editing with live reload
- **Item Editor** — item stats, quality, bonding, spells
- **Quest Editor** — objectives, rewards, text, chains
- **Spell Editor** — spell_template properties
- **Dashboard** — live database stats
- **SOAP Integration** — `.reload` commands sent automatically on save

---

## Setup

### Prerequisites

- Node.js 18+
- AzerothCore running locally
- MySQL accessible on localhost:3306

### 1. Enable SOAP in worldserver.conf

```ini
SOAP.Enabled = 1
SOAP.IP      = 127.0.0.1
SOAP.Port    = 7878
```

### 2. Install & run

```bash
npm install
npm run dev
```

### 3. Connect

On launch, enter your MySQL credentials:
- Host: `localhost`
- Port: `3306`
- User: your MySQL user (e.g. `acore`)
- Password: your password
- Database: `acore_wotlk_world`

### 4. Configure SOAP (optional but recommended)

Go to **Settings** and enter your GM account credentials for live reload support.

---

## Build .exe

```bash
npm run build
```

Output will be in `dist-electron/`.

---

## Roadmap

- [ ] 2D spawn map (Leaflet + WoW map tiles)
- [ ] Loot table editor
- [ ] NPC vendor editor
- [ ] Waypoint editor
- [ ] 3D world viewer (Three.js + ADT parser)
=======
# Azeroth-editor
>>>>>>> b134bcb61bf2bffe893c98312b5bcdd888ecd365
