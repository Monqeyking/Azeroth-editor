#!/usr/bin/env node
// Fetches WoWDBDefs (.dbd) from GitHub and generates KNOWN_SCHEMAS + KNOWN_STRING_COLS
// for build 12340 (WotLK 3.3.5a). Writes to src/lib/dbcSchemas.js — never touches JSX.
//
// Usage:
//   node scripts/dbd-to-schema.js "D:\path\to\dbc\folder"   ← scan all DBC files in folder
//   node scripts/dbd-to-schema.js Spell.dbc Map.dbc          ← specific files only

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const SCHEMAS_FILE  = path.join(__dirname, '..', 'src', 'lib', 'dbcSchemas.js');
const DBD_BASE      = 'https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/definitions/';
const BUILD_PATTERN = /3\.3\.[0-9]+\.12340/;
// WotLK 3.3.5a has 16 locale slots + 1 flags field per locstring (NOT 8+1)
const WOW_LOCALES   = ['enUS','koKR','frFR','deDE','zhCN','zhTW','esES','esMX','ruRU','deDE2','esES2','esMX2','ptBR','ptPT','itIT','Unk'];

// DBC files already covered by dbc-from-source.js (DBCfmt.h) — skip these
function loadExistingDbcNames() {
  if (!fs.existsSync(SCHEMAS_FILE)) return new Set();
  const content = fs.readFileSync(SCHEMAS_FILE, 'utf8');
  const names = new Set();
  const re = /^\s+'([^']+\.dbc)':\s*\[/gm;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1]);
  return names;
}

// Manually defined schemas that can't be auto-generated
const MANUAL_SCHEMAS = {
  'CharStartOutfit.dbc': {
    fields: [
      'ID','CompositeKey',
      'ItemID_1','ItemID_2','ItemID_3','ItemID_4','ItemID_5','ItemID_6',
      'ItemID_7','ItemID_8','ItemID_9','ItemID_10','ItemID_11','ItemID_12',
      'ItemID_13','ItemID_14','ItemID_15','ItemID_16','ItemID_17','ItemID_18',
      'ItemID_19','ItemID_20','ItemID_21','ItemID_22','ItemID_23','ItemID_24',
      'DisplayItemID_1','DisplayItemID_2','DisplayItemID_3','DisplayItemID_4',
      'DisplayItemID_5','DisplayItemID_6','DisplayItemID_7','DisplayItemID_8',
      'DisplayItemID_9','DisplayItemID_10','DisplayItemID_11','DisplayItemID_12',
      'DisplayItemID_13','DisplayItemID_14','DisplayItemID_15','DisplayItemID_16',
      'DisplayItemID_17','DisplayItemID_18','DisplayItemID_19','DisplayItemID_20',
      'DisplayItemID_21','DisplayItemID_22','DisplayItemID_23','DisplayItemID_24',
      'InventoryType_1','InventoryType_2','InventoryType_3','InventoryType_4',
      'InventoryType_5','InventoryType_6','InventoryType_7','InventoryType_8',
      'InventoryType_9','InventoryType_10','InventoryType_11','InventoryType_12',
      'InventoryType_13','InventoryType_14','InventoryType_15','InventoryType_16',
      'InventoryType_17','InventoryType_18','InventoryType_19','InventoryType_20',
      'InventoryType_21','InventoryType_22','InventoryType_23','InventoryType_24',
    ],
    stringCols: [],
  },
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return fetch(res.headers.location).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function parseDbdForBuild12340(dbd) {
  const lines = dbd.split(/\r?\n/);

  // Parse COLUMNS section for type info
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

  // Find BUILD block for 3.3.5a (12340)
  let buildStart = -1;
  for (let j = 0; j < lines.length; j++) {
    if (lines[j].startsWith('BUILD') && BUILD_PATTERN.test(lines[j])) { buildStart = j; break; }
  }
  if (buildStart === -1) return null;

  // Skip BUILD/LAYOUT lines, then collect fields
  let k = buildStart;
  while (k < lines.length && (lines[k].startsWith('BUILD') || lines[k].startsWith('LAYOUT'))) k++;

  const fields     = [];
  const stringCols = []; // indices of string/locstring fields

  while (k < lines.length) {
    const line = lines[k].trim();
    if (!line || line.startsWith('BUILD') || line.startsWith('LAYOUT')) break;
    if (!line.startsWith('//')) {
      const clean    = line.replace(/^\$[^$]+\$/, '').trim();
      const arrMatch = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]+>)?\[(\d+)\]/);
      const plain    = clean.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:<[^>]+>)?$/);

      if (arrMatch) {
        const name  = arrMatch[1];
        const count = parseInt(arrMatch[2], 10);
        for (let n = 0; n < count; n++) fields.push(`${name}_${n}`);
      } else if (plain) {
        const name = plain[1];
        const type = columnTypes[name] || 'int';
        if (type === 'locstring') {
          const base = fields.length;
          WOW_LOCALES.forEach((loc, n) => { stringCols.push(base + n); fields.push(`${name}_${loc}`); });
          fields.push(`${name}_flags`);
        } else if (type === 'string') {
          stringCols.push(fields.length);
          fields.push(name);
        } else {
          fields.push(name);
        }
      }
    }
    k++;
  }

  return fields.length ? { fields, stringCols } : null;
}

function serializeSchemas(schemas, stringColsMap) {
  const ROW = 6;
  const lines = [
    '// Auto-generated by scripts/dbd-to-schema.js — do not edit by hand.',
    '// Run: node scripts/dbd-to-schema.js "path/to/dbc/folder"',
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

  lines.push('// Indices of string fields per DBC (resolved to text at load time)');
  lines.push('export const KNOWN_STRING_COLS = {');
  for (const [dbcName, cols] of Object.entries(stringColsMap)) {
    if (cols.length) lines.push(`  '${dbcName}': [${cols.join(',')}],`);
  }
  lines.push('};', '');

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);

  let targets;
  if (args.length === 1 && fs.existsSync(args[0]) && fs.statSync(args[0]).isDirectory()) {
    const dir = args[0];
    targets = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.dbc'));
    console.log(`Scanning ${dir} — found ${targets.length} DBC files\n`);
  } else if (args.length) {
    targets = args.map(a => a.endsWith('.dbc') ? a : a + '.dbc');
  } else {
    console.error('Usage: node scripts/dbd-to-schema.js <dbc-folder-path>');
    process.exit(1);
  }

  // Load existing schema keys (from dbc-from-source.js) — preserve these, don't overwrite
  const existingNames = loadExistingDbcNames();
  console.log(`  Preserving ${existingNames.size} existing schemas (from DBCfmt.h)\n`);

  // Extract existing schemas text to re-embed in output
  const existingContent = fs.existsSync(SCHEMAS_FILE) ? fs.readFileSync(SCHEMAS_FILE, 'utf8') : '';

  // Parse existing KNOWN_SCHEMAS and KNOWN_STRING_COLS blocks so we can re-emit them
  // We'll just keep the existing file content for the preserved entries, building a fresh merged map
  const schemas    = {};
  const stringCols = {};

  let added = 0, preserved = 0, notFound = 0, failed = 0;

  for (const dbcFile of targets) {
    const dbcName = dbcFile.endsWith('.dbc') ? dbcFile : dbcFile + '.dbc';
    const dbdName = dbcName.replace('.dbc', '.dbd');

    // Already covered by dbc-from-source.js — will be merged in after loop
    if (existingNames.has(dbcName)) {
      preserved++;
      continue;
    }

    process.stdout.write(`Fetching ${dbdName}... `);
    let dbd;
    try {
      dbd = await fetch(DBD_BASE + dbdName);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      failed++;
      continue;
    }

    const parsed = parseDbdForBuild12340(dbd);
    if (!parsed) {
      console.log(`no 3.3.5/12340 build found`);
      notFound++;
      continue;
    }

    schemas[dbcName]    = parsed.fields;
    stringCols[dbcName] = parsed.stringCols;
    console.log(`OK (${parsed.fields.length} fields, ${parsed.stringCols.length} string cols)`);
    added++;
  }

  // Merge: re-parse existing schemas from file and merge new ones in
  const existingSchemaMap    = {};
  const existingStringColMap = {};

  // Isolate sections to avoid cross-contamination
  const strColMarker   = existingContent.indexOf('export const KNOWN_STRING_COLS');
  const schemasSection = strColMarker > 0
    ? existingContent.slice(0, strColMarker)
    : existingContent;
  const strColSection  = strColMarker > 0
    ? existingContent.slice(strColMarker)
    : '';

  // Parse KNOWN_SCHEMAS block (multi-line arrays of quoted field names)
  const schemaBlockRe = /^\s+'([^']+\.dbc)':\s*\[([^\]]*)\]/gms;
  let sm;
  while ((sm = schemaBlockRe.exec(schemasSection)) !== null) {
    if (!existingNames.has(sm[1])) continue;
    const fieldStrs = sm[2].match(/'([^']*)'/g);
    existingSchemaMap[sm[1]] = fieldStrs ? fieldStrs.map(s => s.replace(/'/g, '')) : [];
  }

  // Parse KNOWN_STRING_COLS block (single-line arrays of numbers)
  const strColBlockRe = /^\s+'([^']+\.dbc)':\s*\[([^\]]+)\]/gm;
  let sc;
  while ((sc = strColBlockRe.exec(strColSection)) !== null) {
    existingStringColMap[sc[1]] = sc[2].split(',').map(Number).filter(n => !isNaN(n));
  }

  // Merge: existing (DBCfmt.h) first, then new (WoWDBDefs)
  const merged    = { ...existingSchemaMap,    ...schemas };
  const mergedStr = { ...existingStringColMap, ...stringCols };

  fs.writeFileSync(SCHEMAS_FILE, serializeSchemas(merged, mergedStr), 'utf8');
  console.log(`\nDone — ${added} fetched from WoWDBDefs, ${preserved} preserved from DBCfmt.h, ${notFound} no WotLK build, ${failed} errors.`);
  console.log(`Total: ${Object.keys(merged).length} schemas → ${SCHEMAS_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
