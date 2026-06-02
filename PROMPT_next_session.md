# Next Session Prompt — Azeroth Editor

## Status na 2026-06-02 walkthrough

- ✅ Menu reorganisatie (NAV_MAIN + NAV_WIP met separator) — done
- ✅ Vendor Editor (`/vendors`) — done
- 📋 Alle status/roadmap/QoL samengevoegd in `PROJECT.md` (ROADMAP.md, pages.md en KEIRA3_UPGRADE_TASKS.md verwijderd)
- 📋 Volgende grote feature: Gossip / NPC Text Editor

---

## 1. Volgende focus — QoL pakket (aanbevolen)

Begin met de top-5 uit de QoL Backlog (zie `PROJECT.md`). Te bouwen in deze volgorde, los te shippen:

### a) SqlEditor aansluiten (5 min)
`src/pages/SqlEditorPage.jsx` bestaat al volledig. Toevoegen aan:
- `src/App.jsx` — `<Route path="sql" element={<SqlEditorPage />} />`
- `src/components/layout/Layout.jsx` — nav-item in NAV_WIP of footer, `Terminal` of `Code2` icon (Lucide)

### b) Toast-systeem (~1u)
- `src/components/Toast.jsx` + `ToastProvider` context (geen lib)
- `useToast()` hook: `toast.success / .error / .info`
- Mount provider in `App.jsx` rond `<Layout>`
- Vervang stille saves in CreatureEditor / ItemEditor / SpellEditor / TalentEditor / VendorEditor / TrainerSpellPage met `toast.success("...")` / `toast.error("...")`

### c) Unsaved-changes guard (~30 min)
- `useBlocker` van React Router 6 in elke editor met `dirty` state
- Modal: "Wijzigingen niet opgeslagen. Weet je het zeker?"
- Hergebruik bestaande `dirty` flags

### d) Klikbare ID-lookups cross-editor (~2u)
- Componentje `<EntityLink type="creature|item|quest|spell" id={...} />`
- Toont ID als knop, klik navigeert `/creatures?entry=` etc.
- Targets accepteren `?entry=` query param, auto-selecteren bij mount
- Plaatsen in: CreatureEditor `lootid`, QuestEditor `RequiredNpcOrGo*` / `RewardItem*`, ItemEditor `ItemSet` / `spellid_*`

### e) SOAP "Test now" knoppen (~1u)
- CreatureEditor: `.npc add <entry>` (+ optioneel `.go xyz` als spawn known)
- ItemEditor: `.additem <entry>`
- SpellEditor: `.cast <id>`
- Hergebruik `soapCommand` uit `ConnectionContext`
- Tonen toast met output

---

## 2. Alternatief — Gossip / NPC Text Editor (nieuwe feature)

Als je liever feature-werk doet ipv QoL. Beheert:
- `npc_text` — gespreksballonteksten
- `gossip_menu` — koppelt NPC entry aan menu ID
- `gossip_menu_option` — individuele menu-opties (tekst, actie, condition)

Start met simpele lijst-view (geen visuele boom in v1). Vraag tabelstructuur als nodig.

Route: `/gossip`, icon: `MessageSquare` (Lucide), in NAV_MAIN na "Vendors".

---

## Workflow

- Schrijf beknopte code zonder overbodige comments
- Gebruik bestaande patronen, geen nieuwe libraries
- Sla direct op in `D:\CaioCore Tools\azeroth-editor\`
- **Bij voltooide taak:** update `PROJECT.md` (verplaats naar Voltooide editors of vink af in QoL Backlog). Zie CLAUDE.md sectie "Docs-onderhoud bij voltooide taken".
