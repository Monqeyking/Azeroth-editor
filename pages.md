# Azeroth Editor — Pages Overview

> Status-overzicht van alle editor-pagina's. Bijgewerkt: 2026-06-01

---

## 🎯 Project Doel

**Classic+ op WotLK engine.** Het doel is een aangepaste WoW-server die een "Classic+" ervaring biedt — Vanilla-sfeer en progressie, maar gebouwd op de stabiele WotLK (AzerothCore) engine. Dit betekent:

- **Custom content** als eerste prioriteit: nieuwe quests, creatures, items, spells — allemaal via eigen ID ranges (4000000+)
- **Vanilla-stijl progressie**: geen dungeon finder, geen flying in old world, klassieke quest chains en reputatie
- **Balans op WotLK engine**: class mechanics, talent trees en spells worden aangepast richting Vanilla/TBC feel
- **DBC-aanpassingen**: SpellLevel, SkillLineAbility, talent trees — server én client moeten synchroon blijven

Elke editor-pagina moet dit doel ondersteunen: snel custom content kunnen aanmaken, aanpassen en testen zonder SQL handwerk.

---

## ✅ ConnectPage
MySQL verbinding setup. Slaat config.json op, redirect naar dashboard bij succes.

---

## ✅ SettingsPage
- SOAP config (host, port, GM user/pass, test-knop)
- DBC-pad instelling
- Custom ID ranges (start-IDs per systeem, default 4000000)

---

## ✅ DashboardPage
COUNT-stats voor creature/item/quest/spell. Recent creatures tabel.

---

## ✅ RaceClassPage (`/races`)
Race+class combinatie beheer. Synct naar DB én DBC (`CharBaseInfo.dbc`).

**UI:** Horizontale race-balk (Alliance/Horde) met WoW race-iconen. Klik = selecteer race. Eronder class-grid met class-iconen + checkbox per class.

**Checkbox aan:** wizard opent met startpositie pre-ingevuld. INSERT in `playercreateinfo`, actie-balk gekopieerd van zelfde class, entry in `CharBaseInfo.dbc`.

**Checkbox uit:** bevestigingsdialoog → DELETE uit `playercreateinfo`, `playercreateinfo_action`, DBC entry verwijderd.

---

## ✅ TalentEditorPage (`/talents`)
DBC-based (Talent.dbc, Spell.dbc, SpellIcon.dbc). Visuele 15×4 grid per class/tab. Drag-and-drop, prereq-pijlen, icon picker modal, live model preview.

---

## ✅ SpellEditorPage (`/spells`)
Spell.dbc via IPC (`dbc:readSpellFull` / `dbc:writeSpellFull`).

**Features:**
- Zoeken op naam/ID
- Velden gegroepeerd in secties
- `SchoolMask` → bitmask checkboxes
- `SpellFamily` → correcte dropdown (0=Generic t/m 16=Pet)
- `PowerType` → dropdown incl. Focus, Happiness, Rune
- `DefenseType` → dropdown
- `Effect_1/2/3` → getal + naam (uit volledige SPELL_EFFECTS tabel, 134 entries)
- `EffectAura_1/2/3` → getal + naam (uit AzerothCore Doxygen, 293 entries)
- `Attributes / AttributesEx` → getal + uitklapbare flags-lijst (TrinityCore-correct)
- Effect slots gegroepeerd per slot (Effect + BasePoints + AuraType + TriggerSpell)
- Clone → Trainer workflow (kloont spell + voegt toe aan trainer_spell / npc_trainer)
- Ctrl+S opslaan

**Backlog:**
- [ ] DK verbergen via toggle (voor Vanilla-focus)

---

## ✅ TrainerSpellPage (`/trainer-spells`)
Beheer van trainer_spell (nieuw systeem) en npc_trainer (oud systeem) naast elkaar.

**Architectuur:** zie CLAUDE.md voor uitgebreide documentatie over de twee parallelle trainer-systemen, Paladin trainer IDs, en DBC bestanden.

---

## ✅ CreatureEditorPage (`/creatures`)
Uitgebreide creature editor (~1374 regels). Inclusief model preview via ZamModelViewer.

---

## ✅ SpawnMapPage (`/map`)
Spawn-locaties op kaart.

---

## ✅ SqlEditorPage (`/sql`)
Directe SQL-query editor.

---

## ✅ Editor3DPage (`/3d`)
3D map/model viewer.

---

## 🔧 ItemEditorPage (`/items`) — Verbetering gepland

**Huidige staat:** Basis CRUD op `item_template`. Heeft al: class dropdown, quality dropdown, bonding dropdown. Kale getallen voor de rest.

**Geplande verbeteringen:**

### 1. Enum dropdowns
| Veld | Huidige staat | Plan |
|---|---|---|
| `InventoryType` | getal | dropdown: 0=Non-equip, 1=Head, 2=Neck, 3=Shoulders, 4=Body, 5=Chest, 6=Waist, 7=Legs, 8=Feet, 9=Wrists, 10=Hands, 11=Finger, 12=Trinket, 13=Weapon, 14=Shield, 15=Ranged, 16=Back, 17=2H Weapon, 18=Bag, 19=Tabard, 20=Robe, 21=Main Hand, 22=Off Hand, 23=Held in Off-hand, 24=Ammo, 25=Thrown, 26=Ranged Right, 27=Quiver, 28=Relic |
| `stat_type1` t/m `stat_type5` | getal | dropdown: 3=Agility, 4=Strength, 5=Intellect, 6=Spirit, 7=Stamina, 12=Defense Skill, 13=Dodge, 14=Parry, 15=Block, 32=Crit, 36=Haste, 38=Attack Power, 45=Spell Power etc. |
| `subclass` | getal | contextafhankelijke dropdown op basis van `class` (Weapon: Sword/Axe/Mace/etc., Armor: Cloth/Leather/Mail/Plate) |
| `dmg_type1` | ontbreekt | dropdown: 0=Physical, 1=Holy, 2=Fire, 3=Nature, 4=Frost, 5=Shadow, 6=Arcane |

### 2. Bitmasks
| Veld | Plan |
|---|---|
| `AllowableClass` | bitmask checkboxes (Warrior=1, Paladin=2, Hunter=4, Rogue=8, Priest=16, Shaman=64, Mage=128, Warlock=256, Druid=1024) |
| `AllowableRace` | bitmask checkboxes (Human=1, Orc=2, Dwarf=4, NightElf=8, Undead=16, Tauren=32, Gnome=64, Troll=128, BloodElf=512, Draenei=1024) |
| `Flags` | flags-knop met uitklapbare lijst van item flags |
| `FlagsExtra` | flags-knop |

### 3. Ontbrekende velden toevoegen
- `spellid_2` t/m `spellid_5` + `spelltrigger_1` t/m `spelltrigger_5`
- `spellcategorycooldown_1`, `spellcooldown_1`
- `dmg_min2`, `dmg_max2`, `dmg_type1`, `dmg_type2`
- `stat_type3` t/m `stat_type10`, `stat_value3` t/m `stat_value10`
- `delay` (weapon speed in ms)
- `ammo_type`
- `Material` (dropdown: -1=Consumable, 1=Metal, 2=Wood, 3=Liquid, 4=Jewelry, 5=Chain, 6=Plate, 7=Cloth, 8=Leather)

### 4. WoW-stijl item tooltip preview
Readonly tooltip-panel rechtsonder: toont naam in quality-kleur, item level, type, stats, spells, flavortekst — zoals de in-game tooltip. Puur frontend, geen extra IPC.

### 5. ✅ Filters + Bulk Edit (gebouwd 2026-05-31)
Class/subclass/quality filterdrops in listpanel. Bulk edit paneel (zichtbaar bij actieve filter): veld + waarde + twee-staps confirm met exact itemcount → één UPDATE query.

### 6. ✅ Create tab (gebouwd 2026-05-31)
Nieuw item aanmaken met auto-ID. "Use selected as template" kopieert alle velden van het geselecteerde item. Na aanmaken: terug naar Edit met nieuw item geselecteerd.

### 7. ✅ Scaling tab — Heirloom (gebouwd 2026-05-31)
Alleen actief bij Quality=7. Beheert `scalingstatdistribution_dbc`. Check-before-alter: bepaalt kolomnaam op basis van slot + materiaal (`PlateHelmArmor` etc.), checkt via `INFORMATION_SCHEMA`, draait `ALTER TABLE` + `UPDATE ROUND(ChestArmor × factor)` bij ontbrekende kolom. Bulk "Alle Maxlevel → 60". Preview tabel armor + stats per level.

### 8. QoL — nog te doen
- [ ] **Display ID icon preview** — item icon naast Display ID veld via `wow.zamimg.com/images/wow/icons/`
- [ ] **Sell/Buy price calculator** — goud/zilver/koper inputs die samenvoegen tot 1 integer (i.p.v. raw getal)
- [ ] **ScalingStatValue smart dropdown** — automatisch juiste waarde voorstellen op basis van slot + materiaal

---

## 🔧 QuestEditorPage (`/quests`) — Verbetering gepland

**Huidige staat:** Basis CRUD op `quest_template`. Tekstvelden + veel kale getallen.

**Geplande verbeteringen:**

### 1. Enum dropdowns
| Veld | Plan |
|---|---|
| `QuestType` | dropdown: 0=Normal, 1=Daily, 21=Weekly, 41=PvP, 62=Raid, 88=Elite, 102=Dungeon, 45=Heroic Dungeon |
| `AllowableRaces` | bitmask (zelfde als item AllowableRace) |
| `RewardXPDifficulty` | dropdown: 0=Trivial, 1=Easy, 2=Normal, 3=Difficult, 4=Very Difficult |

### 2. Flags bitmask
`Flags` → uitklapbare bitmask. Belangrijkste flags:
- bit 0: Stay Alive
- bit 2: Deliver More
- bit 6: Exploration
- bit 8: Sharable
- bit 11: Daily
- bit 12: Flags PvP
- bit 20: Weekly

### 3. NPC/Item naam lookups
`RequiredNpcOrGo1/2/3/4` en `RequiredItemId1/2` tonen nu kale entry-nummers. Plan: naam ophalen via DB query en tonen naast het getal (zoals `enum` type in Spell Editor maar dan live lookup).

`RewardItem1/2` en `RewardChoiceItemID1/2/3/4/5/6` zelfde behandeling.

### 4. Ontbrekende velden
- `PrevQuestId` / `NextQuestId` / `ExclusiveGroup` (quest chain)
- `RequiredFactionId1/2` + `RequiredFactionValue1/2` (reputatie requirement)
- `RewardFactionID1` t/m `RewardFactionID5` + values (reputatie rewards)
- `RewardSpell` (geleerde spell bij voltooiing)
- `SourceItemId` (quest start item)
- `IncompleteEmote` / `CompleteEmote`

### 5. Quest chain visualisatie
Mini-diagram dat `PrevQuestId` / `NextQuestId` / `ExclusiveGroup` toont als een keten. Klikbaar om naar die quest te navigeren.

---

## 📋 Globale backlog

- [ ] **Vanilla-filter toggle** — DK verbergen/tonen, WotLK-only content filteren uit dropdowns
- [ ] **Talent tree revamp** — aangepaste boom voor Vanilla-stijl
- [ ] **Crusader Strike ranks** — custom spell workflow: baseline melee + holy damage per rank
- [ ] **Loot table editor** (`/loot`) — `creature_loot_template` + `item_loot_template`. Hoog dagelijks gebruik bij custom content, nog volledig afwezig
- [ ] **Quest Editor refactor** — zelfde behandeling als Item Editor: enum dropdowns, bitmasks, naam lookups, ontbrekende velden, quest chain visualisatie
- [ ] **Gossip/NPC text editor** — `npc_text`, `gossip_menu`, `gossip_menu_option`. Nu alleen via SQL
- [ ] **Achievement editor** — `achievement_dbc` / `achievement_criteria_dbc` voor custom progressie
