// Usage: node scripts/csv-to-schema.js <path-to-csv-folder>
// Reads all .csv files in the folder, parses the header row,
// and upserts entries into KNOWN_SCHEMAS in src/pages/DbcSqlPage.jsx.
//
// Each CSV must have field names in row 1 (comma-separated, optionally quoted).
// The DBC filename key is derived from the CSV filename: Spell.csv → 'Spell.dbc'

const fs   = require('fs');
const path = require('path');

const CSV_DIR  = process.argv[2] || path.join(__dirname, '..', '..', 'SQL DBC');
const JSX_FILE = path.join(__dirname, '..', 'src', 'pages', 'DbcSqlPage.jsx');

// Files we manage manually — skip auto-generation for these
const MANUAL_OVERRIDES = new Set([
  'CharStartOutfit.dbc', // composite field; binary layout differs from CSV
]);

function parseCsvHeaders(filePath) {
  const firstLine = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)[0];
  return firstLine.split(',').map(h => h.replace(/^"|"$/g, '').trim());
}

function buildSchemaEntry(dbcName, headers) {
  const lines = [`  '${dbcName}': [`];
  const ROW = 6; // fields per line
  for (let i = 0; i < headers.length; i += ROW) {
    const chunk = headers.slice(i, i + ROW).map(h => `'${h}'`).join(',');
    lines.push('    ' + chunk + ',');
  }
  lines.push('  ],');
  return lines.join('\n');
}

const csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
if (!csvFiles.length) {
  console.error('No .csv files found in', CSV_DIR);
  process.exit(1);
}

let jsx = fs.readFileSync(JSX_FILE, 'utf8');

let added = 0, skipped = 0;

for (const csvFile of csvFiles.sort()) {
  const dbcName = csvFile.replace('.csv', '.dbc');

  if (MANUAL_OVERRIDES.has(dbcName)) {
    console.log(`SKIP (manual override): ${dbcName}`);
    skipped++;
    continue;
  }

  const headers = parseCsvHeaders(path.join(CSV_DIR, csvFile));
  const entry   = buildSchemaEntry(dbcName, headers);

  // Check if key already exists
  const keyPattern = new RegExp(`'${dbcName.replace('.', '\\.')}'\\s*:`);
  if (keyPattern.test(jsx)) {
    // Replace existing entry
    const blockRe = new RegExp(
      `(\\s*(?:\\/\\/[^\\n]*\\n\\s*)*'${dbcName.replace('.', '\\.')}': \\[[\\s\\S]*?\\],)`,
      'm'
    );
    if (blockRe.test(jsx)) {
      jsx = jsx.replace(blockRe, '\n' + entry);
      console.log(`UPDATE: ${dbcName} (${headers.length} fields)`);
    } else {
      console.log(`WARN: could not replace existing entry for ${dbcName}`);
    }
  } else {
    // Insert before closing };
    jsx = jsx.replace(/^(\s*\};)$/m, entry + '\n$1');
    console.log(`ADD:    ${dbcName} (${headers.length} fields)`);
  }
  added++;
}

fs.writeFileSync(JSX_FILE, jsx, 'utf8');
console.log(`\nDone — ${added} schemas written, ${skipped} skipped.`);
