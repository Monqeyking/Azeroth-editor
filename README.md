# Azeroth Editor

A desktop editor for AzerothCore (WotLK 3.3.5a) built with Electron + React.

---

## Features

### Editors
| Editor | Description |
|---|---|
| **Creature Editor** | Full `creature_template` editing with model preview (Wowhead renderer), display info, stats, loot, flags |
| **Trainer Spell Editor** | Manage trainer spells via `trainer_spell` + `npc_trainer`, edit `Spell.dbc` level requirements and `SkillLineAbility.dbc` trainability |
| **Vendor Editor** | `npc_vendor` items per creature entry |
| **Item Editor** | Item stats, quality, bonding, display, spells |
| **Item Set Editor** | `ItemSet.dbc` editing |
| **Loot Editor** | `creature_loot_template` / `item_loot_template` |
| **Quest Editor** | Objectives, rewards, text, chains |
| **Spell Editor** | `Spell.dbc` full record editing |
| **Talent Editor** | `Talent.dbc` tree editing with background preview |
| **Races & Classes** | `CharBaseInfo.dbc`, race/class combos |
| **Char Customization** | `CharSections.dbc` skin/hair/feature rows |

### World & Tools
| Tool | Description |
|---|---|
| **3D World Editor** | ADT terrain streaming (5×5 tile window), WDL low-res overview, spawn billboards, minimap textures, M2 model preview |
| **Spawn Map** | 2D overhead spawn map with zone overlay |
| **Expansion Lock** | Toggle Outland/Northrend access via `disables` table + presets (Vanilla / TBC / WotLK) |

### SQL
| Tool | Description |
|---|---|
| **DBC SQL Editor** | HeidiSQL-style editor — query any `.dbc` file via in-memory SQLite. Float toggle per column, known schemas, CSV export, query history, auto-run on select |
| **Database SQL Editor** | Raw MySQL query editor against the connected database |

### Dashboard
- Live server status (auth + world)
- Two embedded terminal panels — real-time output via `node-pty` (ConPTY), command input per server
- Quick start/stop controls

---

## Setup

### Prerequisites

- Node.js 18+
- AzerothCore running locally (WotLK 3.3.5a)
- MySQL accessible on `localhost:3306`

### 1. Enable SOAP in `worldserver.conf`

```ini
SOAP.Enabled = 1
SOAP.IP      = 127.0.0.1
SOAP.Port    = 7878
```

### 2. Install & run

```bash
npm install --legacy-peer-deps
npm run rebuild        # compiles node-pty and better-sqlite3 for Electron
npm run dev
```

> **Note:** `node-pty` and `better-sqlite3` are native modules that must be compiled against the Electron version. Always run `npm run rebuild` after installing new native dependencies or upgrading Electron.

### 3. Connect

On launch, enter your MySQL credentials:
- Host: `localhost`
- Port: `3306`
- User: your MySQL user (e.g. `acore`)
- Password: your password
- Database: `acore_wotlk_world`

### 4. Configure paths in Settings

| Setting | Example | Used by |
|---|---|---|
| DBC path | `D:\CaioCore\CaioServer\data\DBFilesClient` | All DBC editors, DBC SQL Editor |
| Data path | `D:\CaioCore\CaioServer\data` | 3D Editor (ADT/BLP/MPQ), Spawn Map |
| Auth server exe | `D:\CaioCore\CaioServer\authserver.exe` | Dashboard terminal |
| World server exe | `D:\CaioCore\CaioServer\worldserver.exe` | Dashboard terminal |
| Expansions folder | `D:\CaioCore\CaioServer\data\Expansions` | Expansion Lock DBC snapshots |

### 5. SOAP credentials (optional but recommended)

In **Settings**, enter your GM account credentials. Used to send `.reload` commands to the live server after saving DBC or database changes.

---

## Build .exe

```bash
npm run build
```

Output will be in `dist-electron/`.

---

## Tech stack

- **Electron 29** — main process, IPC, native modules
- **React 18 + Vite 5** — frontend
- **React Router 6** (data router / `createHashRouter`) — routing with `useBlocker` for unsaved-change guards
- **MySQL2** — database connection
- **node-soap** — SOAP client for live reload
- **node-pty** — ConPTY for real server process output (bypasses Windows pipe buffering)
- **better-sqlite3** — in-memory SQLite for DBC-as-SQL querying
- **Three.js / @react-three/fiber** — 3D terrain renderer
- **Lucide React** — icons
