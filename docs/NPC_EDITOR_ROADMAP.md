# NPC Editor Roadmap

Goal: turn the current creature and trainer tooling into a fast content-authoring layer for NPCs, professions, and related world data.

## What is already strong

- Creature editor is already a solid base.
- Trainer workflow is usable and connected.
- NPC workflow is becoming the glue between creature data and trainer/profession logic.
- Model preview and preset-based editing already reduce manual work.

## Best next additions

### 1. NPC Workflow as the central hub

Make one screen that links the most common NPC relations:

- creature_template
- creature_template_addon
- creature_default_trainer
- trainer / trainer_spell
- npc_trainer
- gossip_menu / gossip_menu_option
- spawn data
- model data
- faction / npcflag presets

Why this matters:

- fewer tab jumps
- faster authoring
- easier to see what an NPC actually does
- better place to create new custom NPCs from scratch

### 2. Profession Editor tab

A first guided version now exists at `/professions`.

Use it for:

- profession trainers
- skill line mapping
- profession-specific spell groups
- custom profession trainers
- hybrid NPCs that mix vendor / trainer / profession behavior

This keeps professions out of the class trainer flow and makes the UI easier to reason about.

### 3. Validation layer

Add automatic checks and warnings.

Examples:

- npcflag does not match the data below it
- trainer set but no trainer rows exist
- profession trainer without matching skill line
- model or faction looks inconsistent
- gossip menu missing while gossip flag is set
- creature has trainer data but no creature_default_trainer link

This will save a lot of manual verification time.

### 4. Clone / variant workflow

Make it easy to clone existing NPCs and only change the parts that matter.

Good for:

- new trainers
- profession variants
- faction variants
- vendor hybrids
- zone-specific reuses

### 5. Compare mode

Let the editor compare two NPCs or two trainer setups side by side.

Useful comparisons:

- one trainer vs another
- live vs staged edits
- two faction variants
- class trainer vs profession trainer

### 6. Bulk operations

Make repeated editing faster:

- set npcflag on multiple NPCs
- assign same trainer setup to multiple creatures
- update subnames in bulk
- clone spawn-related defaults across a group

## Nice-to-have later

- Relation inspector sidebar
- Search by role, not only by name or entry
- Preset templates like vendor, flight master, banker, quest giver
- Staged changes review queue before save
- Export/import of NPC configs
- Undo history for local editing sessions

## Recommended priority order

### Phase 1

- NPC Workflow as hub
- validation layer
- clone/variant flow

### Phase 2

- Profession Editor tab (guided first version)
- compare mode
- bulk operations

### Phase 3

- relation inspector
- preset templates
- staged changes
- export/import

## Strategic note

The biggest improvement is not adding more fields.
The biggest improvement is making relationships visible and repeatable.

That is what will keep implementation speed high as the content set grows.`r`n