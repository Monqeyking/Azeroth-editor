#!/usr/bin/env node
// Generates KNOWN_SCHEMAS + KNOWN_STRING_COLS from AzerothCore source files.
// For DBC files not in DBCfmt.h, optionally fetches from WoWDBDefs.
//
// Usage:
//   node scripts/dbc-from-source.js <DataStores-path>
//   node scripts/dbc-from-source.js <DataStores-path> <dbc-folder>   ← also fetches WoWDBDefs for remaining files

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const SCHEMAS_FILE  = path.join(__dirname, '..', 'src', 'lib', 'dbcSchemas.js');
const DATASTORES    = process.argv[2];
const DBC_FOLDER    = process.argv[3] || null;

if (!DATASTORES || !fs.existsSync(DATASTORES)) {
  console.error('Usage: node scripts/dbc-from-source.js <DataStores-path> [dbc-folder]');
  process.exit(1);
}

// ── Manual overrides (byte-packed DBC files) ─────────────────────────────────

const MANUAL_SCHEMAS = {
  'CharStartOutfit.dbc': {
    // recordSize=296 → 74 uint32 fields; bbbX (Race/Class/Gender/outfitID) pack into 1 uint32
    fields: [
      'ID', 'Race_Class_Gender_OutfitID',
      ...Array.from({length: 24}, (_, i) => `ItemId_${i}`),
      ...Array.from({length: 24}, (_, i) => `ItemDisplayId_${i}`),
      ...Array.from({length: 24}, (_, i) => `ItemInventorySlot_${i}`),
    ],
    stringCols: [],
  },
};

// ── 1. Parse DBCfmt.h ────────────────────────────────────────────────────────

function parseDbcFmt(fmtPath) {
  const src = fs.readFileSync(fmtPath, 'utf8');
  const result = {};
  const re = /char\s+constexpr\s+(\w+fmt)\s*\[\s*\]\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) result[m[1]] = m[2];
  return result;
}

function fmtNameToDbc(fmtName) {
  const map = {
    'Achievementfmt':                    'Achievement.dbc',
    'AchievementCategoryfmt':            'Achievement_Category.dbc',
    'AchievementCriteriafmt':            'Achievement_Criteria.dbc',
    'AreaTableEntryfmt':                 'AreaTable.dbc',
    'AreaGroupEntryfmt':                 'AreaGroup.dbc',
    'AreaPOIEntryfmt':                   'AreaPOI.dbc',
    'AuctionHouseEntryfmt':              'AuctionHouse.dbc',
    'BankBagSlotPricesEntryfmt':         'BankBagSlotPrices.dbc',
    'BarberShopStyleEntryfmt':           'BarberShopStyle.dbc',
    'BattlemasterListEntryfmt':          'BattlemasterList.dbc',
    'CharStartOutfitEntryfmt':           'CharStartOutfit.dbc',
    'CharSectionsEntryfmt':              'CharSections.dbc',
    'CharTitlesEntryfmt':                'CharTitles.dbc',
    'ChatChannelsEntryfmt':              'ChatChannels.dbc',
    'ChrClassesEntryfmt':                'ChrClasses.dbc',
    'ChrRacesEntryfmt':                  'ChrRaces.dbc',
    'CinematicCameraEntryfmt':           'CinematicCamera.dbc',
    'CinematicSequencesEntryfmt':        'CinematicSequences.dbc',
    'CreatureDisplayInfofmt':            'CreatureDisplayInfo.dbc',
    'CreatureDisplayInfoExtrafmt':       'CreatureDisplayInfoExtra.dbc',
    'CreatureFamilyfmt':                 'CreatureFamily.dbc',
    'CreatureModelDatafmt':              'CreatureModelData.dbc',
    'CreatureSpellDatafmt':              'CreatureSpellData.dbc',
    'CreatureTypefmt':                   'CreatureType.dbc',
    'CurrencyTypesfmt':                  'CurrencyTypes.dbc',
    'DestructibleModelDatafmt':          'DestructibleModelData.dbc',
    'DungeonEncounterfmt':               'DungeonEncounter.dbc',
    'DurabilityCostsfmt':                'DurabilityCosts.dbc',
    'DurabilityQualityfmt':              'DurabilityQuality.dbc',
    'EmotesEntryfmt':                    'Emotes.dbc',
    'EmotesTextEntryfmt':                'EmotesText.dbc',
    'EmotesTextSoundEntryfmt':           'EmotesTextSound.dbc',
    'FactionEntryfmt':                   'Faction.dbc',
    'FactionTemplateEntryfmt':           'FactionTemplate.dbc',
    'GameObjectArtKitfmt':               'GameObjectArtKit.dbc',
    'GameObjectDisplayInfofmt':          'GameObjectDisplayInfo.dbc',
    'GemPropertiesEntryfmt':             'GemProperties.dbc',
    'GlyphPropertiesfmt':                'GlyphProperties.dbc',
    'GlyphSlotfmt':                      'GlyphSlot.dbc',
    'GtBarberShopCostBasefmt':           'gtBarberShopCostBase.dbc',
    'GtCombatRatingsfmt':                'gtCombatRatings.dbc',
    'GtChanceToMeleeCritBasefmt':        'gtChanceToMeleeCritBase.dbc',
    'GtChanceToMeleeCritfmt':            'gtChanceToMeleeCrit.dbc',
    'GtChanceToSpellCritBasefmt':        'gtChanceToSpellCritBase.dbc',
    'GtChanceToSpellCritfmt':            'gtChanceToSpellCrit.dbc',
    'GtNPCManaCostScalerfmt':            'gtNPCManaCostScaler.dbc',
    'GtOCTClassCombatRatingScalarfmt':   'gtOCTClassCombatRatingScalar.dbc',
    'GtOCTRegenHPfmt':                   'gtOCTRegenHP.dbc',
    'GtRegenHPPerSptfmt':                'gtRegenHPPerSpt.dbc',
    'GtRegenMPPerSptfmt':                'gtRegenMPPerSpt.dbc',
    'Holidaysfmt':                       'Holidays.dbc',
    'Itemfmt':                           'Item.dbc',
    'ItemBagFamilyfmt':                  'ItemBagFamily.dbc',
    'ItemDisplayTemplateEntryfmt':       'ItemDisplayInfo.dbc',
    'ItemExtendedCostEntryfmt':          'ItemExtendedCost.dbc',
    'ItemLimitCategoryEntryfmt':         'ItemLimitCategory.dbc',
    'ItemRandomPropertiesfmt':           'ItemRandomProperties.dbc',
    'ItemRandomSuffixfmt':               'ItemRandomSuffix.dbc',
    'ItemSetEntryfmt':                   'ItemSet.dbc',
    'LFGDungeonEntryfmt':                'LFGDungeons.dbc',
    'LightEntryfmt':                     'Light.dbc',
    'LiquidTypefmt':                     'LiquidType.dbc',
    'LockEntryfmt':                      'Lock.dbc',
    'MailTemplateEntryfmt':              'MailTemplate.dbc',
    'MapEntryfmt':                       'Map.dbc',
    'MapDifficultyEntryfmt':             'MapDifficulty.dbc',
    'MovieEntryfmt':                     'Movie.dbc',
    'NamesReservedfmt':                  'NamesReserved.dbc',
    'NamesProfanityfmt':                 'NamesProfanity.dbc',
    'OverrideSpellDatafmt':              'OverrideSpellData.dbc',
    'PowerDisplayfmt':                   'PowerDisplay.dbc',
    'QuestSortEntryfmt':                 'QuestSort.dbc',
    'QuestXPfmt':                        'QuestXP.dbc',
    'QuestFactionRewardfmt':             'QuestFactionReward.dbc',
    'PvPDifficultyfmt':                  'PvpDifficulty.dbc',
    'RandomPropertiesPointsfmt':         'RandPropPoints.dbc',
    'ScalingStatDistributionfmt':        'ScalingStatDistribution.dbc',
    'ScalingStatValuesfmt':              'ScalingStatValues.dbc',
    'SkillLinefmt':                      'SkillLine.dbc',
    'SkillLineAbilityfmt':               'SkillLineAbility.dbc',
    'SkillRaceClassInfofmt':             'SkillRaceClassInfo.dbc',
    'SkillTiersfmt':                     'SkillTiers.dbc',
    'SoundEntriesfmt':                   'SoundEntries.dbc',
    'SpellCastTimefmt':                  'SpellCastTimes.dbc',
    'SpellCategoryfmt':                  'SpellCategory.dbc',
    'SpellDifficultyfmt':                'SpellDifficulty.dbc',
    'SpellDurationfmt':                  'SpellDuration.dbc',
    'SpellEntryfmt':                     'Spell.dbc',
    'SpellFocusObjectfmt':               'SpellFocusObject.dbc',
    'SpellItemEnchantmentfmt':           'SpellItemEnchantment.dbc',
    'SpellItemEnchantmentConditionfmt':  'SpellItemEnchantmentCondition.dbc',
    'SpellRadiusfmt':                    'SpellRadius.dbc',
    'SpellRangefmt':                     'SpellRange.dbc',
    'SpellRuneCostfmt':                  'SpellRuneCost.dbc',
    'SpellShapeshiftFormEntryfmt':       'SpellShapeshiftForm.dbc',
    'SpellVisualfmt':                    'SpellVisual.dbc',
    'StableSlotPricesfmt':               'StableSlotPrices.dbc',
    'SummonPropertiesfmt':               'SummonProperties.dbc',
    'TalentEntryfmt':                    'Talent.dbc',
    'TalentTabEntryfmt':                 'TalentTab.dbc',
    'TaxiNodesEntryfmt':                 'TaxiNodes.dbc',
    'TaxiPathEntryfmt':                  'TaxiPath.dbc',
    'TaxiPathNodeEntryfmt':              'TaxiPathNode.dbc',
    'TeamContributionPointsfmt':         'TeamContributionPoints.dbc',
    'TotemCategoryEntryfmt':             'TotemCategory.dbc',
    'TransportAnimationfmt':             'TransportAnimation.dbc',
    'TransportRotationfmt':              'TransportRotation.dbc',
    'VehicleEntryfmt':                   'Vehicle.dbc',
    'VehicleSeatEntryfmt':               'VehicleSeat.dbc',
    'WMOAreaTableEntryfmt':              'WMOAreaTable.dbc',
    'WorldMapAreaEntryfmt':              'WorldMapArea.dbc',
    'WorldMapOverlayEntryfmt':           'WorldMapOverlay.dbc',
  };
  return map[fmtName] || null;
}

// ── 2. Parse DBCStructure.h for field names ──────────────────────────────────

function parseStructure(structPath) {
  const src    = fs.readFileSync(structPath, 'utf8');
  const result = {};
  const structRe = /struct\s+(\w+)\s*\{([^}]+)\}/gs;
  let sm;
  while ((sm = structRe.exec(src)) !== null) {
    const body   = sm[2];
    const fields = [];
    const lineRe = /^\s*(\/\/)?\s*((?:[\w:<>,\s*]+?)\s+)(\w+)(?:\[([^\]]+)\])?\s*;\s*\/\/\s*(\d+)(?:-(\d+))?/gm;
    let lm;
    while ((lm = lineRe.exec(body)) !== null) {
      const typeStr  = lm[2].trim();
      const name     = lm[3];
      const startIdx = parseInt(lm[5], 10);
      const endIdx   = lm[6] ? parseInt(lm[6], 10) : startIdx;
      const isString = typeStr.includes('char');
      fields.push({ name, startIdx, count: endIdx - startIdx + 1, isString });
    }
    result[sm[1]] = fields;
  }
  return result;
}

function fmtToStructName(fmtName) {
  const map = {
    'Achievementfmt':             'AchievementEntry',
    'AchievementCategoryfmt':     'AchievementCategoryEntry',
    'AchievementCriteriafmt':     'AchievementCriteriaEntry',
    'AreaTableEntryfmt':          'AreaTableEntry',
    'AreaGroupEntryfmt':          'AreaGroupEntry',
    'AreaPOIEntryfmt':            'AreaPOIEntry',
    'AuctionHouseEntryfmt':       'AuctionHouseEntry',
    'BankBagSlotPricesEntryfmt':  'BankBagSlotPricesEntry',
    'BarberShopStyleEntryfmt':    'BarberShopStyleEntry',
    'BattlemasterListEntryfmt':   'BattlemasterListEntry',
    'CharSectionsEntryfmt':       'CharSectionsEntry',
    'CharTitlesEntryfmt':         'CharTitlesEntry',
    'ChatChannelsEntryfmt':       'ChatChannelsEntry',
    'ChrClassesEntryfmt':         'ChrClassesEntry',
    'ChrRacesEntryfmt':           'ChrRacesEntry',
    'CinematicCameraEntryfmt':    'CinematicCameraEntry',
    'CinematicSequencesEntryfmt': 'CinematicSequencesEntry',
    'CreatureDisplayInfofmt':     'CreatureDisplayInfoEntry',
    'CreatureDisplayInfoExtrafmt':'CreatureDisplayInfoExtraEntry',
    'CreatureFamilyfmt':          'CreatureFamilyEntry',
    'CreatureModelDatafmt':       'CreatureModelDataEntry',
    'CreatureSpellDatafmt':       'CreatureSpellDataEntry',
    'CreatureTypefmt':            'CreatureTypeEntry',
    'DungeonEncounterfmt':        'DungeonEncounterEntry',
    'DurabilityCostsfmt':         'DurabilityCostsEntry',
    'DurabilityQualityfmt':       'DurabilityQualityEntry',
    'EmotesEntryfmt':             'EmotesEntry',
    'EmotesTextEntryfmt':         'EmotesTextEntry',
    'EmotesTextSoundEntryfmt':    'EmotesTextSoundEntry',
    'FactionEntryfmt':            'FactionEntry',
    'FactionTemplateEntryfmt':    'FactionTemplateEntry',
    'GemPropertiesEntryfmt':      'GemPropertiesEntry',
    'GlyphPropertiesfmt':         'GlyphPropertiesEntry',
    'GlyphSlotfmt':               'GlyphSlotEntry',
    'ItemSetEntryfmt':            'ItemSetEntry',
    'LFGDungeonEntryfmt':         'LFGDungeonEntry',
    'MapEntryfmt':                'MapEntry',
    'MapDifficultyEntryfmt':      'MapDifficultyEntry',
    'OverrideSpellDatafmt':       'OverrideSpellDataEntry',
    'ScalingStatDistributionfmt': 'ScalingStatDistributionEntry',
    'ScalingStatValuesfmt':       'ScalingStatValuesEntry',
    'SkillLinefmt':               'SkillLineEntry',
    'SkillLineAbilityfmt':        'SkillLineAbilityEntry',
    'SkillRaceClassInfofmt':      'SkillRaceClassInfoEntry',
    'SpellEntryfmt':              'SpellEntry',
    'SpellItemEnchantmentfmt':    'SpellItemEnchantmentEntry',
    'TalentEntryfmt':             'TalentEntry',
    'TalentTabEntryfmt':          'TalentTabEntry',
    'TaxiNodesEntryfmt':          'TaxiNodesEntry',
    'TaxiPathNodeEntryfmt':       'TaxiPathNodeEntry',
    'TotemCategoryEntryfmt':      'TotemCategoryEntry',
    'VehicleEntryfmt':            'VehicleEntry',
    'VehicleSeatEntryfmt':        'VehicleSeatEntry',
    'WMOAreaTableEntryfmt':       'WMOAreaTableEntry',
    'WorldMapAreaEntryfmt':       'WorldMapAreaEntry',
  };
  return map[fmtName] || null;
}

function buildFieldNames(fmt, structFields) {
  const names = Array.from({ length: fmt.length }, (_, i) => `field_${i}`);
  if (!structFields || !structFields.length) return names;
  for (const f of structFields) {
    if (f.count === 1) {
      if (f.startIdx < names.length) names[f.startIdx] = f.name;
    } else {
      for (let k = 0; k < f.count; k++) {
        const idx = f.startIdx + k;
        if (idx < names.length) names[idx] = `${f.name}_${k}`;
      }
    }
  }
  return names;
}

// ── 3. WoWDBDefs fetch ───────────────────────────────────────────────────────

const DBD_BASE      = 'https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/definitions/';
const BUILD_PATTERN = /3\.3\.[0-9]+\.12340/;
// WotLK 3.3.5a: 16 locale slots + 1 flags per locstring
const WOW_LOCALES   = ['enUS','koKR','frFR','deDE','zhCN','zhTW','esES','esMX','ruRU','deDE2','esES2','esMX2','ptBR','ptPT','itIT','Unk'];

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return fetchUrl(res.headers.location).then(resolve, reject);
      if (res.statusCode !== 200)
        return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function parseDbdForBuild12340(dbd) {
  const lines = dbd.split(/\r?\n/);
  const columnTypes = {};
  let i = 0;
  while (i < lines.length && lines[i].trim() !== 'COLUMNS') i++;
  i++;
  while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('BUILD') && !lines[i].startsWith('LAYOUT')) {
    const line = lines[i].trim();
    if (line && !line.startsWith('//')) {
      const m = line.match(/^(\w+)\s+([A-Za-z_][A-Za-z0-9_<>:]*)/);
      if (m) columnTypes[m[2].replace(/<[^>]+>/g, '')] = m[1];
    }
    i++;
  }
  let buildStart = -1;
  for (let j = 0; j < lines.length; j++) {
    if (lines[j].startsWith('BUILD') && BUILD_PATTERN.test(lines[j])) { buildStart = j; break; }
  }
  if (buildStart === -1) return null;
  let k = buildStart;
  while (k < lines.length && (lines[k].startsWith('BUILD') || lines[k].startsWith('LAYOUT'))) k++;
  const fields = [], strCols = [], floatCols = [];
  while (k < lines.length) {
    const line = lines[k].trim();
    if (!line || line.startsWith('BUILD') || line.startsWith('LAYOUT')) break;
    if (!line.startsWith('//')) {
      const clean    = line.replace(/^\$[^$]+\$/, '').trim();
      const arrMatch = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]+>)?\[(\d+)\]/);
      const plain    = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]+>)?$/);
      if (arrMatch) {
        const name = arrMatch[1], count = parseInt(arrMatch[2], 10);
        const type = columnTypes[name] || 'int';
        for (let n = 0; n < count; n++) {
          if (type === 'float') floatCols.push(fields.length);
          fields.push(`${name}_${n}`);
        }
      } else if (plain) {
        const name = plain[1], type = columnTypes[name] || 'int';
        if (type === 'locstring') {
          const base = fields.length;
          WOW_LOCALES.forEach((loc, n) => { strCols.push(base + n); fields.push(`${name}_${loc}`); });
          fields.push(`${name}_flags`);
        } else if (type === 'string') {
          strCols.push(fields.length);
          fields.push(name);
        } else {
          if (type === 'float') floatCols.push(fields.length);
          fields.push(name);
        }
      }
    }
    k++;
  }
  return fields.length ? { fields, strCols, floatCols } : null;
}

// ── 4. Serialize output ──────────────────────────────────────────────────────

function serializeSchemas(schemas, stringColsMap, floatColsMap) {
  const ROW   = 6;
  const lines = [
    '// Auto-generated by scripts/dbc-from-source.js — do not edit by hand.',
    '// Sources: DBCfmt.h + DBCStructure.h (server-side), WoWDBDefs (client-only)',
    '',
    'export const KNOWN_SCHEMAS = {',
  ];
  for (const [dbcName, fields] of Object.entries(schemas)) {
    lines.push(`  '${dbcName}': [`);
    for (let i = 0; i < fields.length; i += ROW) {
      lines.push('    ' + fields.slice(i, i + ROW).map(f => `'${f}'`).join(',') + ',');
    }
    lines.push('  ],');
  }
  lines.push('};', '');
  lines.push('// String field indices per DBC (resolved to text at load time)');
  lines.push('export const KNOWN_STRING_COLS = {');
  for (const [dbcName, cols] of Object.entries(stringColsMap)) {
    if (cols.length) lines.push(`  '${dbcName}': [${cols.join(',')}],`);
  }
  lines.push('};', '');
  lines.push('// Float field indices per DBC (displayed as IEEE 754 float)');
  lines.push('export const KNOWN_FLOAT_COLS = {');
  for (const [dbcName, cols] of Object.entries(floatColsMap)) {
    if (cols.length) lines.push(`  '${dbcName}': [${cols.join(',')}],`);
  }
  lines.push('};', '');
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  const fmtPath    = path.join(DATASTORES, 'DBCfmt.h');
  const structPath = path.join(DATASTORES, 'DBCStructure.h');

  if (!fs.existsSync(fmtPath))    { console.error('DBCfmt.h not found');    process.exit(1); }
  if (!fs.existsSync(structPath)) { console.error('DBCStructure.h not found'); process.exit(1); }

  console.log('Parsing DBCfmt.h...');
  const fmtStrings = parseDbcFmt(fmtPath);
  console.log('  ' + Object.keys(fmtStrings).length + ' format strings found');

  console.log('Parsing DBCStructure.h...');
  const structs = parseStructure(structPath);
  console.log('  ' + Object.keys(structs).length + ' structs found');

  const schemas    = {};
  const stringCols = {};
  const floatCols  = {};

  // Manual overrides
  for (const [dbcName, m] of Object.entries(MANUAL_SCHEMAS)) {
    schemas[dbcName]    = m.fields;
    stringCols[dbcName] = m.stringCols;
    floatCols[dbcName]  = m.floatCols || [];
    console.log('  ' + dbcName + ': ' + m.fields.length + ' fields (manual)');
  }

  // DBCfmt.h — struct names first, then optionally override with WoWDBDefs names
  // When DBC_FOLDER is provided we fetch WoWDBDefs for AzerothCore DBCs too so
  // column names match WDBX (ShapeshiftMask instead of Stances, etc.)
  const acEntries = []; // collect for potential WoWDBDefs override
  for (const [fmtName, fmt] of Object.entries(fmtStrings)) {
    const dbcName = fmtNameToDbc(fmtName);
    if (!dbcName || MANUAL_SCHEMAS[dbcName]) continue;
    const sName      = fmtToStructName(fmtName);
    const sFields    = sName ? (structs[sName] || null) : null;
    const structStrIdx = new Set();
    if (sFields) {
      for (const f of sFields) {
        if (f.isString) {
          for (let k = 0; k < f.count; k++) structStrIdx.add(f.startIdx + k);
        }
      }
    }
    const strCols = [], fltCols = [];
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] === 's' || (fmt[i] === 'x' && structStrIdx.has(i))) strCols.push(i);
      else if (fmt[i] === 'f') fltCols.push(i);
    }
    schemas[dbcName]    = buildFieldNames(fmt, sFields);
    stringCols[dbcName] = strCols;
    floatCols[dbcName]  = fltCols;
    acEntries.push({ dbcName, fmtLen: fmt.length, strCols, fltCols });
    console.log('  ' + dbcName + ': ' + fmt.length + ' fields, ' + strCols.length + ' string cols');
  }

  // When fetching WoWDBDefs anyway, override AzerothCore struct names with WoWDBDefs names
  // if the expanded field count matches exactly (ensures correct column alignment)
  if (DBC_FOLDER) {
    console.log('\nOverriding AzerothCore names with WoWDBDefs where count matches...');
    var wdbOk = 0, wdbSkip = 0;
    for (const { dbcName, fmtLen, strCols, fltCols } of acEntries) {
      const dbdName = dbcName.replace(/\.dbc$/i, '.dbd');
      var dbd;
      try { dbd = await fetchUrl(DBD_BASE + dbdName); }
      catch (e) { wdbSkip++; continue; }
      const parsed = parseDbdForBuild12340(dbd);
      if (parsed && parsed.fields.length === fmtLen) {
        schemas[dbcName] = parsed.fields;
        // Keep format-based strCols/floatCols (accurate for binary), WoWDBDefs names only
        const mergedStr = new Set([...strCols, ...parsed.strCols]);
        stringCols[dbcName] = [...mergedStr].sort((a, b) => a - b);
        // floatCols: format-based are authoritative; WoWDBDefs float detection as supplement
        const mergedFlt = new Set([...fltCols, ...parsed.floatCols]);
        floatCols[dbcName] = [...mergedFlt].sort((a, b) => a - b);
        wdbOk++;
        process.stdout.write('.');
      } else {
        wdbSkip++;
      }
    }
    console.log('\n  ' + wdbOk + ' overridden, ' + wdbSkip + ' kept struct names');
  }

  // WoWDBDefs fallback for client-only DBC files
  if (DBC_FOLDER && fs.existsSync(DBC_FOLDER)) {
    const covered  = new Set(Object.keys(schemas));
    const allFiles = fs.readdirSync(DBC_FOLDER).filter(function(f) { return f.toLowerCase().endsWith('.dbc'); });
    const missing  = allFiles.filter(function(f) { return !covered.has(f); });
    console.log('\nFetching WoWDBDefs for ' + missing.length + ' uncovered DBC files...');
    var ok = 0, noWotlk = 0, err = 0;
    for (const dbcFile of missing) {
      const dbdName = dbcFile.replace(/\.dbc$/i, '.dbd');
      process.stdout.write('  ' + dbcFile + '... ');
      var dbd;
      try { dbd = await fetchUrl(DBD_BASE + dbdName); }
      catch (e) { console.log('SKIP (' + e.message + ')'); err++; continue; }
      const parsed = parseDbdForBuild12340(dbd);
      if (!parsed) { console.log('no WotLK build'); noWotlk++; continue; }
      schemas[dbcFile]    = parsed.fields;
      stringCols[dbcFile] = parsed.strCols;
      floatCols[dbcFile]  = parsed.floatCols;
      console.log('OK (' + parsed.fields.length + ' fields, ' + parsed.strCols.length + ' str, ' + parsed.floatCols.length + ' float)');
      ok++;
    }
    console.log('WoWDBDefs: ' + ok + ' ok, ' + noWotlk + ' no WotLK build, ' + err + ' errors');
  }

  fs.writeFileSync(SCHEMAS_FILE, serializeSchemas(schemas, stringCols, floatCols), 'utf8');
  console.log('\nTotal: ' + Object.keys(schemas).length + ' schemas -> ' + SCHEMAS_FILE);
}

main().catch(function(e) { console.error(e); process.exit(1); });
