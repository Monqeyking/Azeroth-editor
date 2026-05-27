const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { createClient } = require('node-soap');
const AdmZip = require('adm-zip');
let mpqReader = null;
const MPQ_STUB = {
  isDataPath: () => false,
  findMpqFiles: () => [],
  listWorldmapZones: async () => [],
  readTileBuffer: async () => null,
  readAdtBuffer: async () => null,
  validateDataPath: async () => ({ success: false, error: 'MPQ reader niet beschikbaar' }),
};
function getMpqReader() {
  if (!mpqReader) {
    try { mpqReader = require('./mpq-reader'); }
    catch (e) { console.error('mpq-reader load failed:', e); mpqReader = MPQ_STUB; }
  }
  return mpqReader;
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Force custom taskbar icon in dev mode (Windows)
app.setAppUserModelId('com.azeroth.editor');

let mainWindow;
let dbConnection = null;
let iconsZip = null;
let iconCache = {};
let spellDbcCache = null;

// DBC field offsets for Spell.dbc (WotLK 3.3.5a)
// Offset = MySQL column index × 4 (each DBC field is 4 bytes)
const SPELL_OFFSETS = {
  ID:                       { offset: 0,   type: 'uint32' },
  Category:                 { offset: 4,   type: 'uint32' },
  Mechanic:                 { offset: 12,  type: 'uint32' },
  Attributes:               { offset: 16,  type: 'uint32' },
  AttributesEx:             { offset: 20,  type: 'uint32' },
  AttributesEx2:            { offset: 24,  type: 'uint32' },
  AttributesEx3:            { offset: 28,  type: 'uint32' },
  CastingTimeIndex:         { offset: 112, type: 'uint32' },
  RecoveryTime:             { offset: 116, type: 'uint32' },
  CategoryRecoveryTime:     { offset: 120, type: 'uint32' },
  ProcTypeMask:             { offset: 136, type: 'uint32' },
  ProcChance:               { offset: 140, type: 'uint32' },
  ProcCharges:              { offset: 144, type: 'uint32' },
  MaxLevel:                 { offset: 148, type: 'uint32' },
  BaseLevel:                { offset: 152, type: 'uint32' },
  SpellLevel:               { offset: 156, type: 'uint32' },
  DurationIndex:            { offset: 160, type: 'uint32' },
  PowerType:                { offset: 164, type: 'int32'  },
  ManaCost:                 { offset: 168, type: 'uint32' },
  ManaPerSecond:            { offset: 176, type: 'uint32' },
  RangeIndex:               { offset: 184, type: 'uint32' },
  Speed:                    { offset: 188, type: 'float'  },
  CumulativeAura:           { offset: 196, type: 'uint32' },
  Effect_1:                 { offset: 284, type: 'uint32' },
  Effect_2:                 { offset: 288, type: 'uint32' },
  Effect_3:                 { offset: 292, type: 'uint32' },
  EffectBasePoints_1:       { offset: 320, type: 'int32'  },
  EffectBasePoints_2:       { offset: 324, type: 'int32'  },
  EffectBasePoints_3:       { offset: 328, type: 'int32'  },
  EffectAura_1:             { offset: 380, type: 'uint32' },
  EffectAura_2:             { offset: 384, type: 'uint32' },
  EffectAura_3:             { offset: 388, type: 'uint32' },
  EffectTriggerSpell_1:     { offset: 464, type: 'uint32' },
  EffectTriggerSpell_2:     { offset: 468, type: 'uint32' },
  EffectTriggerSpell_3:     { offset: 472, type: 'uint32' },
  SpellVisualID_1:          { offset: 524, type: 'uint32' },
  SpellIconID:              { offset: 532, type: 'uint32' },
  SpellPriority:            { offset: 540, type: 'uint32' },
  ManaCostPct:              { offset: 816, type: 'uint32' },
  MaxTargetLevel:           { offset: 828, type: 'uint32' },
  SpellClassSet:            { offset: 832, type: 'uint32' },
  MaxTargets:               { offset: 848, type: 'uint32' },
  DefenseType:              { offset: 852, type: 'uint32' },
  SchoolMask:               { offset: 900, type: 'uint32' },
  Name_Lang_enUS:           { offset: 544, type: 'string' },
  NameSubtext_Lang_enUS:    { offset: 612, type: 'string' },
  Description_Lang_enUS:    { offset: 680, type: 'string' },
  AuraDescription_Lang_enUS:{ offset: 748, type: 'string' },
};

// ─── Config persistence ──────────────────────────────────────────────────────
function getConfigPath() {
  return path.join(app.getPath('userData'), 'azeroth-editor-config.json');
}

ipcMain.handle('config:load', () => {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { success: true, data };
    }
    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('config:save', (_, config) => {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Window ────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    icon: path.join(__dirname, '../src/assets/icon.ico'),
    backgroundColor: '#0a0c10',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0c10',
      symbolColor: '#c8a96e',
      height: 32
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Database ───────────────────────────────────────────────────────────────
ipcMain.handle('db:connect', async (_, config) => {
  try {
    dbConnection = await mysql.createConnection({
      host: config.host || 'localhost',
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database || 'acore_wotlk_world'
    });
    await dbConnection.execute('SELECT 1');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('db:query', async (_, sql, params = []) => {
  if (!dbConnection) return { success: false, error: 'Not connected' };
  try {
    const [rows] = await dbConnection.execute(sql, params);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('db:disconnect', async () => {
  if (dbConnection) {
    await dbConnection.end();
    dbConnection = null;
  }
  return { success: true };
});

// ─── SOAP ───────────────────────────────────────────────────────────────────
ipcMain.handle('soap:command', async (_, { host, port, user, password, command }) => {
  return new Promise((resolve) => {
    const url = `http://${host}:${port}/RPC2`;
    const auth = Buffer.from(`${user}:${password}`).toString('base64');

    createClient(url, {
      wsdl_headers: { Authorization: `Basic ${auth}` }
    }, (err, client) => {
      if (err) return resolve({ success: false, error: err.message });

      client.executeCommand({ command }, (err2, result) => {
        if (err2) return resolve({ success: false, error: err2.message });
        resolve({ success: true, result: result?.result || 'OK' });
      });
    });
  });
});

// ─── Icons handling (from unzipped files) ──────────────────────────────────────
function getIconsDir() {
  const possiblePaths = [
    path.join(__dirname, '../src/static'),
    path.join(process.cwd(), 'src/static'),
    'D:\\CaioCore Tools\\azeroth-editor\\src\\static'
  ];

  for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {      return testPath;
    }
  }  return null;
}

ipcMain.handle('icons:get', async (_, dbcPath, iconPath) => {
  try {
    if (!iconPath) {      return null;
    }

    // Clean the path: strip "Interface\Icons\" prefix and extract filename
    let iconName = iconPath;
    if (iconName.includes('\\')) {
      iconName = iconName.split('\\').pop();
    }
    if (iconName.includes('/')) {
      iconName = iconName.split('/').pop();
    }
    if (iconCache[iconName]) {      return iconCache[iconName];
    }

    const iconsDir = getIconsDir();
    if (!iconsDir) {      return null;
    }

    // Try multiple file extensions (filename already has no extension)
    const extensions = ['.png', '.blp', '.tga'];
    for (const ext of extensions) {
      const fullIconPath = path.join(iconsDir, iconName + ext);
      if (fs.existsSync(fullIconPath)) {
        const data = fs.readFileSync(fullIconPath);
        const base64 = data.toString('base64');
        const mimeType = ext === '.png' ? 'image/png' : 'image/x-tga';
        const dataUrl = `data:${mimeType};base64,${base64}`;
        iconCache[iconName] = dataUrl;
        console.log(`icons:get - ✓ Loaded icon: ${iconName}${ext} (${data.length} bytes)`);
        return dataUrl;
      }
    }

    console.log(`icons:get - ✗ Icon not found: ${iconName} (looked in ${iconsDir})`);
    return null;
  } catch (e) {    return null;
  }
});

// ─── Worldmap Tiles Loader ─────────────────────────────────────────────────────
ipcMain.handle('worldmap:listZones', async (_, dataPath) => {
  try {
    if (dataPath && getMpqReader().isDataPath(dataPath)) {
      return await getMpqReader().listWorldmapZones(dataPath);
    }
    // Fallback: geëxtraheerde WORLDMAP-map
    const base = resolveWorldmapDir(dataPath);
    if (!base) return [];
    return fs.readdirSync(base).filter(item => fs.statSync(path.join(base, item)).isDirectory());
  } catch (e) {
    console.error('worldmap:listZones error:', e);
    return [];
  }
});

ipcMain.handle('worldmap:validatePath', async (_, dataPath) => {
  try {
    if (!dataPath || !fs.existsSync(dataPath)) {
      return { success: false, error: 'Pad bestaat niet' };
    }
    if (getMpqReader().isDataPath(dataPath)) {
      return await getMpqReader().validateDataPath(dataPath);
    }
    // Geëxtraheerde map: check op zone-submappen
    const items = fs.readdirSync(dataPath);
    const zoneCount = items.filter(item => {
      try { return fs.statSync(path.join(dataPath, item)).isDirectory(); } catch { return false; }
    }).length;
    if (zoneCount > 0) {
      return { success: true, type: 'directory', message: `${zoneCount} zone(s) gevonden (geëxtraheerde map)`, count: zoneCount };
    }
    return { success: false, error: 'Geen MPQ bestanden of zone-mappen gevonden' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Talent Background Loader ──────────────────────────────────────────────────
ipcMain.handle('talents:getBackground', async (_, backgroundFile) => {
  try {
    if (!backgroundFile) {
      console.log('talents:getBackground - empty backgroundFile');
      return null;
    }

    // Try multiple potential paths for flexibility (dev vs production)
    const possiblePaths = [
      path.join(__dirname, '..', 'src', 'background', 'Talents'),
      path.join(app.getAppPath(), 'src', 'background', 'Talents'),
      path.join(process.cwd(), 'src', 'background', 'Talents'),
    ];

    let tilesDir = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        tilesDir = p;
        break;
      }
    }

    if (!tilesDir) {
      console.log(`talents:getBackground - Tiles directory not found. Tried: ${possiblePaths.join(', ')}`);
      return null;
    }
    console.log(`talents:getBackground - Using tiles directory: ${tilesDir}`);

    const tiles = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'];
    const result = {};

    for (const t of tiles) {
      let foundPath = null;
      const variations = [t, t.toUpperCase(), t.toLowerCase()];
      
      for (const v of variations) {
        const testPath = path.join(tilesDir, `${backgroundFile}-${v}.png`);
        if (fs.existsSync(testPath)) {
          foundPath = testPath;
          break;
        }
      }

      // Fallback case-insensitive search in directory (e.g. for Linux)
      if (!foundPath) {
        try {
          const files = fs.readdirSync(tilesDir);
          const targetName = `${backgroundFile}-${t}`.toLowerCase();
          const match = files.find(f => f.toLowerCase() === `${targetName}.png`);
          if (match) {
            foundPath = path.join(tilesDir, match);
          }
        } catch (err) {
          // ignore
        }
      }

      if (!foundPath) {
        console.log(`talents:getBackground - Missing tile ${t} for ${backgroundFile}`);
        return null;
      }

      const data = fs.readFileSync(foundPath);
      result[t] = `data:image/png;base64,${data.toString('base64')}`;
    }

    console.log(`talents:getBackground - ✓ Loaded 4 background tiles for: ${backgroundFile}`);
    return result;
  } catch (e) {
    console.error('talents:getBackground error:', e);
    return null;
  }
});

// ─── DBC Reader ────────────────────────────────────────────────────────────────
function readStringFromBlock(buffer, stringOffset, stringBlock) {
  if (stringOffset === 0) return '';
  let end = stringOffset;
  while (end < stringBlock.length && stringBlock[end] !== 0) end++;
  return stringBlock.toString('utf8', stringOffset, end);
}

function readUInt32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

async function readDbcFile(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 20) return null;

    const magic = buffer.toString('ascii', 0, 4);
    if (magic !== 'WDBC') return null;

    const recordCount = readUInt32LE(buffer, 4);
    const fieldCount = readUInt32LE(buffer, 8);
    const recordSize = readUInt32LE(buffer, 12);
    const stringBlockSize = readUInt32LE(buffer, 16);

    const headerSize = 20;
    const dataEnd = headerSize + (recordCount * recordSize);
    const dataBuffer = buffer.slice(headerSize, dataEnd);
    const stringBlock = buffer.slice(dataEnd, dataEnd + stringBlockSize);

    return { recordCount, fieldCount, recordSize, dataBuffer, stringBlock };
  } catch (e) {
    return null;
  }
}

async function loadSpellDbc(dbcPath) {
  const filePath = path.join(dbcPath, 'Spell.dbc');
  if (spellDbcCache?.filePath === filePath) return spellDbcCache.dbc;
  const dbc = await readDbcFile(filePath);
  if (dbc) spellDbcCache = { filePath, dbc };
  return dbc;
}

ipcMain.handle('dbc:searchSpells', async (_, dbcPath, term) => {
  try {
    const dbc = await loadSpellDbc(dbcPath);
    if (!dbc) return { success: false, error: 'Kon Spell.dbc niet lezen' };

    const results = [];
    const isNum = /^\d+$/.test(term);
    const termNum = isNum ? parseInt(term) : 0;
    const termLower = term ? term.toLowerCase() : '';

    for (let i = 0; i < dbc.recordCount && results.length < 50; i++) {
      const off = i * dbc.recordSize;
      const id = dbc.dataBuffer.readUInt32LE(off);
      if (!term || (isNum && id === termNum) || !isNum) {
        const nameRef = dbc.dataBuffer.readUInt32LE(off + 544);
        const name = readStringFromBlock(null, nameRef, dbc.stringBlock);
        if (isNum ? id === termNum : (!term || name.toLowerCase().includes(termLower))) {
          results.push({
            ID: id,
            Name_Lang_enUS: name,
            SchoolMask: dbc.dataBuffer.readUInt32LE(off + 900),
            DefenseType: dbc.dataBuffer.readUInt32LE(off + 852),
          });
        }
      }
    }
    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:readSpellFull', async (_, dbcPath, id) => {
  try {
    const dbc = await loadSpellDbc(dbcPath);
    if (!dbc) return { success: false, error: 'Kon Spell.dbc niet lezen' };

    for (let i = 0; i < dbc.recordCount; i++) {
      const off = i * dbc.recordSize;
      if (dbc.dataBuffer.readUInt32LE(off) !== id) continue;

      const rec = {};
      for (const [key, f] of Object.entries(SPELL_OFFSETS)) {
        if (f.type === 'string') {
          const ref = dbc.dataBuffer.readUInt32LE(off + f.offset);
          rec[key] = readStringFromBlock(null, ref, dbc.stringBlock);
        } else if (f.type === 'float') {
          rec[key] = dbc.dataBuffer.readFloatLE(off + f.offset);
        } else if (f.type === 'int32') {
          rec[key] = dbc.dataBuffer.readInt32LE(off + f.offset);
        } else {
          rec[key] = dbc.dataBuffer.readUInt32LE(off + f.offset);
        }
      }
      return { success: true, data: rec };
    }
    return { success: false, error: `Spell ${id} niet gevonden` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:writeSpellFull', async (_, dbcPath, spell) => {
  try {
    const filePath = path.join(dbcPath, 'Spell.dbc');
    const raw = fs.readFileSync(filePath);

    const recordCount = raw.readUInt32LE(4);
    const recordSize = raw.readUInt32LE(12);
    const origStrBlockSize = raw.readUInt32LE(16);
    const headerSize = 20;
    const dataSize = recordCount * recordSize;
    const strBlockStart = headerSize + dataSize;

    let recordIndex = -1;
    for (let i = 0; i < recordCount; i++) {
      if (raw.readUInt32LE(headerSize + i * recordSize) === spell.ID) { recordIndex = i; break; }
    }
    if (recordIndex === -1) return { success: false, error: 'Spell niet gevonden' };

    const recordBase = headerSize + recordIndex * recordSize;
    const origStrBlock = raw.slice(strBlockStart, strBlockStart + origStrBlockSize);

    const STRING_KEYS = ['Name_Lang_enUS', 'NameSubtext_Lang_enUS', 'Description_Lang_enUS', 'AuraDescription_Lang_enUS'];
    const newStrRefs = {};
    const extraParts = [];
    let extraOffset = origStrBlockSize;

    for (const key of STRING_KEYS) {
      if (spell[key] === undefined) continue;
      const f = SPELL_OFFSETS[key];
      const oldRef = raw.readUInt32LE(recordBase + f.offset);
      const oldStr = readStringFromBlock(null, oldRef, origStrBlock);
      const newStr = spell[key] || '';
      if (newStr === oldStr) continue;
      newStrRefs[key] = extraOffset;
      const strBuf = Buffer.from(newStr + '\0', 'utf8');
      extraParts.push(strBuf);
      extraOffset += strBuf.length;
    }

    const newBuffer = extraParts.length > 0
      ? Buffer.concat([raw, ...extraParts])
      : Buffer.from(raw);

    if (extraParts.length > 0) newBuffer.writeUInt32LE(extraOffset, 16);

    for (const [key, f] of Object.entries(SPELL_OFFSETS)) {
      if (f.type === 'string' || key === 'ID' || spell[key] === undefined) continue;
      const val = Number(spell[key]);
      const pos = recordBase + f.offset;
      if (f.type === 'float') newBuffer.writeFloatLE(val, pos);
      else if (f.type === 'int32') newBuffer.writeInt32LE(val | 0, pos);
      else newBuffer.writeUInt32LE(val >>> 0, pos);
    }

    for (const [key, ref] of Object.entries(newStrRefs)) {
      newBuffer.writeUInt32LE(ref, recordBase + SPELL_OFFSETS[key].offset);
    }

    fs.writeFileSync(filePath, newBuffer);
    spellDbcCache = null;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:findNextSpellId', async (_, dbcPath, startId) => {
  try {
    const dbc = await loadSpellDbc(dbcPath);
    if (!dbc) return { success: false, error: 'Kon Spell.dbc niet lezen' };
    const usedIds = new Set();
    for (let i = 0; i < dbc.recordCount; i++) usedIds.add(dbc.dataBuffer.readUInt32LE(i * dbc.recordSize));
    let nextId = Number(startId);
    while (usedIds.has(nextId)) nextId++;
    return { success: true, nextId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:copySpell', async (_, dbcPath, sourceId, newId) => {
  try {
    const filePath = path.join(dbcPath, 'Spell.dbc');
    const buffer = fs.readFileSync(filePath);

    const recordCount = buffer.readUInt32LE(4);
    const recordSize = buffer.readUInt32LE(12);
    const stringBlockSize = buffer.readUInt32LE(16);
    const headerSize = 20;
    const dataSize = recordCount * recordSize;

    let sourceIndex = -1;
    for (let i = 0; i < recordCount; i++) {
      const id = buffer.readUInt32LE(headerSize + i * recordSize);
      if (id === sourceId) sourceIndex = i;
      if (id === newId) return { success: false, error: `ID ${newId} bestaat al` };
    }
    if (sourceIndex === -1) return { success: false, error: 'Bron spell niet gevonden' };

    const newBuffer = Buffer.alloc(headerSize + (recordCount + 1) * recordSize + stringBlockSize);
    buffer.copy(newBuffer, 0, 0, headerSize);
    newBuffer.writeUInt32LE(recordCount + 1, 4);
    buffer.copy(newBuffer, headerSize, headerSize, headerSize + dataSize);

    const srcOff = headerSize + sourceIndex * recordSize;
    const newOff = headerSize + dataSize;
    buffer.copy(newBuffer, newOff, srcOff, srcOff + recordSize);
    newBuffer.writeUInt32LE(newId, newOff);
    buffer.copy(newBuffer, headerSize + (recordCount + 1) * recordSize, headerSize + dataSize, headerSize + dataSize + stringBlockSize);

    fs.writeFileSync(filePath, newBuffer);
    spellDbcCache = null;
    return { success: true, newId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:readTalentTabs', async (_, dbcPath) => {
  try {
    const filePath = path.join(dbcPath, 'TalentTab.dbc');
    console.log('Reading TalentTab.dbc from:', filePath);
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: false, error: `Could not read TalentTab.dbc at ${filePath}` };

    console.log(`TalentTab.dbc: ${dbc.recordCount} records, record size: ${dbc.recordSize}`);
    const data = [];
    for (let i = 0; i < dbc.recordCount; i++) {
      const offset = i * dbc.recordSize;
      const nameRef = readUInt32LE(dbc.dataBuffer, offset + 4);
      const bgFileRef = readUInt32LE(dbc.dataBuffer, offset + 92);
      const rec = {
        ID: readUInt32LE(dbc.dataBuffer, offset + 0),
        Name_Lang_enUS: readStringFromBlock(dbc.dataBuffer, nameRef, dbc.stringBlock),
        SpellIconID: readUInt32LE(dbc.dataBuffer, offset + 72),
        ClassMask: readUInt32LE(dbc.dataBuffer, offset + 80),
        OrderIndex: readUInt32LE(dbc.dataBuffer, offset + 88),
        BackgroundFile: readStringFromBlock(dbc.dataBuffer, bgFileRef, dbc.stringBlock)
      };
      data.push(rec);
    }
    console.log('=== ALL TALENT TABS ===');
    data.forEach(t => {
      console.log(`ID=${t.ID}, ClassMask=${t.ClassMask} (binary: ${t.ClassMask.toString(2).padStart(11, '0')}), Name="${t.Name_Lang_enUS}", OrderIndex=${t.OrderIndex}`);
    });
    console.log(`Loaded ${data.length} talent tabs`);
    return { success: true, data };
  } catch (e) {
    console.error('Error reading TalentTab.dbc:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:readTalents', async (_, dbcPath, tabId) => {
  try {
    const filePath = path.join(dbcPath, 'Talent.dbc');
    console.log('=== readTalents: TabID =', tabId);
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: false, error: 'Could not read Talent.dbc' };

    const data = [];
    for (let i = 0; i < dbc.recordCount; i++) {
      const offset = i * dbc.recordSize;
      const rec = {
        ID: readUInt32LE(dbc.dataBuffer, offset + 0),
        TabID: readUInt32LE(dbc.dataBuffer, offset + 4),
        TierID: readUInt32LE(dbc.dataBuffer, offset + 8),
        ColumnIndex: readUInt32LE(dbc.dataBuffer, offset + 12),
        SpellRank_1: readUInt32LE(dbc.dataBuffer, offset + 16),
        SpellRank_2: readUInt32LE(dbc.dataBuffer, offset + 20),
        SpellRank_3: readUInt32LE(dbc.dataBuffer, offset + 24),
        SpellRank_4: readUInt32LE(dbc.dataBuffer, offset + 28),
        SpellRank_5: readUInt32LE(dbc.dataBuffer, offset + 32),
        SpellRank_6: readUInt32LE(dbc.dataBuffer, offset + 36),
        SpellRank_7: readUInt32LE(dbc.dataBuffer, offset + 40),
        SpellRank_8: readUInt32LE(dbc.dataBuffer, offset + 44),
        SpellRank_9: readUInt32LE(dbc.dataBuffer, offset + 48),
        PrereqTalent_1: readUInt32LE(dbc.dataBuffer, offset + 52),
        PrereqTalent_2: readUInt32LE(dbc.dataBuffer, offset + 56),
        PrereqTalent_3: readUInt32LE(dbc.dataBuffer, offset + 60),
        PrereqRank_1: readUInt32LE(dbc.dataBuffer, offset + 64),
        PrereqRank_2: readUInt32LE(dbc.dataBuffer, offset + 68),
        PrereqRank_3: readUInt32LE(dbc.dataBuffer, offset + 72)
      };

      if (rec.TabID === tabId) {
        data.push(rec);
      }
    }
    console.log(`readTalents: Loaded ${data.length} talents for TabID ${tabId}`);
    if (data.length > 0) {
      const spellIds = [];
      data.forEach((t, idx) => {
        for (let i = 1; i <= 9; i++) {
          const sid = t[`SpellRank_${i}`];
          if (sid > 0) spellIds.push(sid);
        }
        if (idx < 3) console.log(`  Talent ${t.ID}: spells [${t.SpellRank_1}, ${t.SpellRank_2}, ${t.SpellRank_3}]`);
      });
      console.log(`Total unique spell IDs needed: ${new Set(spellIds).size}`);
    }
    return { success: true, data };
  } catch (e) {
    console.error('Error reading Talent.dbc:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:readSpellIcons', async (_, dbcPath, iconIds) => {
  try {
    const filePath = path.join(dbcPath, 'SpellIcon.dbc');
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: true, data: {} };

    console.log(`\n=== readSpellIcons: Looking for ${iconIds.length} icon IDs ===`);
    console.log(`First 10 icon IDs:`, iconIds.slice(0, 10).join(','));
    const icons = {};
    for (let i = 0; i < dbc.recordCount; i++) {
      const offset = i * dbc.recordSize;
      const id = readUInt32LE(dbc.dataBuffer, offset + 0);
      if (iconIds.includes(id)) {
        // TextureFilename is at offset 4 (field 1)
        const filenameRef = readUInt32LE(dbc.dataBuffer, offset + 4);
        const filename = readStringFromBlock(dbc.dataBuffer, filenameRef, dbc.stringBlock);
        icons[id] = filename;
        console.log(`  SpellIcon ${id}: "${filename}"`);
      }
    }
    console.log(`readSpellIcons: Found ${Object.keys(icons).length} icon filenames\n`);
    return { success: true, data: icons };
  } catch (e) {
    console.error('readSpellIcons error:', e);
    return { success: true, data: {} };
  }
});

ipcMain.handle('dbc:readSpells', async (_, dbcPath, spellIds) => {
  try {
    const filePath = path.join(dbcPath, 'Spell.dbc');
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: true, data: {} };

    // DEBUG: Find correct offsets by analyzing spell 16039
    if (spellIds.includes(16039)) {
      console.log(`\n=== DEBUG: Analyzing spell 16039 to find offsets ===`);
      console.log(`Expected: Name="Convection", SpellIconID=122`);

      // Find spell 16039
      for (let i = 0; i < dbc.recordCount; i++) {
        const offset = i * dbc.recordSize;
        const spellId = readUInt32LE(dbc.dataBuffer, offset + 0);

        if (spellId === 16039) {
          console.log(`Found spell 16039 at record index ${i}`);

          // Verify offset 524 contains SpellIconID = 122
          const iconId524 = readUInt32LE(dbc.dataBuffer, offset + 524);
          console.log(`  Offset 524: ${iconId524} (expected 122: ${iconId524 === 122 ? '✓' : '✗'})`);

          // Scan all offsets to find string reference to "Convection"
          console.log(`  Scanning for "Convection"...`);
          for (let fieldOffset = 520; fieldOffset <= 600; fieldOffset += 4) {
            const val = readUInt32LE(dbc.dataBuffer, offset + fieldOffset);
            if (val > 0 && val < dbc.stringBlock.length) {
              const str = readStringFromBlock(dbc.dataBuffer, val, dbc.stringBlock);
              if (str === 'Convection') {
                console.log(`  ✓ FOUND: Offset ${fieldOffset} contains string ref to "Convection"`);
                console.log(`    This is the Name_Lang_enUS offset!`);
              }
            }
          }
          break;
        }
      }
    }

    console.log(`\n=== readSpells: Looking for ${spellIds.length} spell IDs ===`);
    const spells = {};
    for (let i = 0; i < dbc.recordCount; i++) {
      const offset = i * dbc.recordSize;
      const spellId = readUInt32LE(dbc.dataBuffer, offset + 0);
      if (spellIds.includes(spellId)) {
        // SpellIconID is at offset 532 (field 133)
        const spellIconId = readUInt32LE(dbc.dataBuffer, offset + 532);

        // Name_Lang_enUS is at offset 544 (field 136)
        const nameRef = readUInt32LE(dbc.dataBuffer, offset + 544);
        const name = readStringFromBlock(dbc.dataBuffer, nameRef, dbc.stringBlock);
        spells[spellId] = { name, spellIconId };
        console.log(`  Spell ${spellId}: "${name}" (iconId=${spellIconId})`);
      }
    }
    console.log(`readSpells: Found ${Object.keys(spells).length} spells with names\n`);
    return { success: true, data: spells };
  } catch (e) {
    console.error('readSpells error:', e);
    return { success: true, data: {} };
  }
});

// ─── Find next free ID ────────────────────────────────────────────────────────
ipcMain.handle('db:findNextId', async (_, { table, idColumn, startId }) => {
  if (!dbConnection) return { success: false, error: 'Not connected' };
  try {
    const [rows] = await dbConnection.execute(
      `SELECT \`${idColumn}\` FROM \`${table}\` WHERE \`${idColumn}\` >= ? ORDER BY \`${idColumn}\` ASC LIMIT 5000`,
      [Number(startId)]
    );
    const usedIds = new Set(rows.map(r => Number(r[idColumn])));
    let nextId = Number(startId);
    while (usedIds.has(nextId)) nextId++;
    return { success: true, nextId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('dbc:findNextTalentId', async (_, dbcPath, startId) => {
  try {
    const filePath = path.join(dbcPath, 'Talent.dbc');
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: false, error: 'Kon Talent.dbc niet lezen' };
    const usedIds = new Set();
    for (let i = 0; i < dbc.recordCount; i++) {
      usedIds.add(readUInt32LE(dbc.dataBuffer, i * dbc.recordSize));
    }
    let nextId = Number(startId);
    while (usedIds.has(nextId)) nextId++;
    return { success: true, nextId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:copyTalent', async (_, dbcPath, sourceId, newId) => {
  try {
    const filePath = path.join(dbcPath, 'Talent.dbc');
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 20) return { success: false, error: 'Ongeldig DBC bestand' };
    if (buffer.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'Ongeldig DBC header' };

    const recordCount = buffer.readUInt32LE(4);
    const recordSize = buffer.readUInt32LE(12);
    const stringBlockSize = buffer.readUInt32LE(16);
    const headerSize = 20;

    let sourceIndex = -1;
    for (let i = 0; i < recordCount; i++) {
      if (buffer.readUInt32LE(headerSize + i * recordSize) === sourceId) { sourceIndex = i; break; }
    }
    if (sourceIndex === -1) return { success: false, error: 'Bron talent niet gevonden' };
    for (let i = 0; i < recordCount; i++) {
      if (buffer.readUInt32LE(headerSize + i * recordSize) === newId) return { success: false, error: `ID ${newId} bestaat al` };
    }

    const dataSize = recordCount * recordSize;
    const newBuffer = Buffer.alloc(headerSize + (recordCount + 1) * recordSize + stringBlockSize);
    buffer.copy(newBuffer, 0, 0, headerSize);
    newBuffer.writeUInt32LE(recordCount + 1, 4);
    buffer.copy(newBuffer, headerSize, headerSize, headerSize + dataSize);
    const srcOffset = headerSize + sourceIndex * recordSize;
    const newOffset = headerSize + dataSize;
    buffer.copy(newBuffer, newOffset, srcOffset, srcOffset + recordSize);
    newBuffer.writeUInt32LE(newId, newOffset);
    buffer.copy(newBuffer, headerSize + (recordCount + 1) * recordSize, headerSize + dataSize, headerSize + dataSize + stringBlockSize);

    fs.writeFileSync(filePath, newBuffer);
    return { success: true, newId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:writeTalent', async (_, dbcPath, talent) => {
  try {
    const filePath = path.join(dbcPath, 'Talent.dbc');
    const buffer = fs.readFileSync(filePath);

    if (buffer.length < 20) return { success: false, error: 'Invalid DBC file' };

    const magic = buffer.toString('ascii', 0, 4);
    if (magic !== 'WDBC') return { success: false, error: 'Invalid DBC header' };

    const recordCount = buffer.readUInt32LE(4);
    const recordSize = buffer.readUInt32LE(12);
    const headerSize = 20;

    // Find record index
    let recordIndex = -1;
    for (let i = 0; i < recordCount; i++) {
      const offset = headerSize + (i * recordSize);
      const id = buffer.readUInt32LE(offset);
      if (id === talent.ID) {
        recordIndex = i;
        break;
      }
    }

    if (recordIndex === -1) return { success: false, error: 'Talent not found' };

    const offset = headerSize + (recordIndex * recordSize);
    const tempBuffer = Buffer.alloc(buffer.length);
    buffer.copy(tempBuffer);

    // Write fields (3.3.5 Talent.dbc structure - based on DBC field order)
    tempBuffer.writeUInt32LE(talent.TierID || 0, offset + 8);
    tempBuffer.writeUInt32LE(talent.ColumnIndex || 0, offset + 12);
    for (let i = 1; i <= 9; i++) {
      const spellId = talent[`SpellRank_${i}`] || 0;
      tempBuffer.writeUInt32LE(spellId, offset + 16 + ((i - 1) * 4));
    }
    tempBuffer.writeUInt32LE(talent.PrereqTalent_1 || 0, offset + 52);
    tempBuffer.writeUInt32LE(talent.PrereqTalent_2 || 0, offset + 56);
    tempBuffer.writeUInt32LE(talent.PrereqTalent_3 || 0, offset + 60);
    tempBuffer.writeUInt32LE(talent.PrereqRank_1 || 0, offset + 64);
    tempBuffer.writeUInt32LE(talent.PrereqRank_2 || 0, offset + 68);
    tempBuffer.writeUInt32LE(talent.PrereqRank_3 || 0, offset + 72);

    fs.writeFileSync(filePath, tempBuffer);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:deleteTalent', async (_, dbcPath, talentId) => {
  try {
    const filePath = path.join(dbcPath, 'Talent.dbc');
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'WDBC')
      return { success: false, error: 'Ongeldig DBC bestand' };

    const recordCount  = buffer.readUInt32LE(4);
    const recordSize   = buffer.readUInt32LE(12);
    const strBlockSize = buffer.readUInt32LE(16);
    const headerSize   = 20;
    const dataSize     = recordCount * recordSize;

    let idx = -1;
    for (let i = 0; i < recordCount; i++) {
      if (buffer.readUInt32LE(headerSize + i * recordSize) === talentId) { idx = i; break; }
    }
    if (idx === -1) return { success: false, error: 'Talent niet gevonden' };

    const newBuf = Buffer.alloc(headerSize + (recordCount - 1) * recordSize + strBlockSize);
    buffer.copy(newBuf, 0, 0, headerSize);
    newBuf.writeUInt32LE(recordCount - 1, 4);
    buffer.copy(newBuf, headerSize, headerSize, headerSize + idx * recordSize);
    buffer.copy(newBuf, headerSize + idx * recordSize, headerSize + (idx + 1) * recordSize, headerSize + dataSize);
    buffer.copy(newBuf, headerSize + (recordCount - 1) * recordSize, headerSize + dataSize, buffer.length);
    fs.writeFileSync(filePath, newBuf);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('minimap:getTile', async (_, minimapPath, mapId, col, row) => {
  try {
    const filename = `Map_${mapId}_${col}_${row}`;
    const tilePath = path.join(minimapPath, `Map_${mapId}`, filename);
    for (const ext of ['.png', '.jpg', '.jpeg', '.PNG', '.JPG']) {
      const fullPath = tilePath + ext;
      if (fs.existsSync(fullPath)) {
        const data = fs.readFileSync(fullPath);
        const mime = ext.toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
        return { success: true, data: `data:${mime};base64,${data.toString('base64')}` };
      }
    }
    return { success: false };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── BLP2 / DXT1 decoder ───────────────────────────────────────────────────────
function decodeBLP(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'BLP2') throw new Error('Geen BLP2');
  const w      = buffer.readUInt32LE(12);
  const h      = buffer.readUInt32LE(16);
  const offset = buffer.readUInt32LE(20);
  const size   = buffer.readUInt32LE(84);
  const src    = buffer.slice(offset, offset + size);
  const rgba   = Buffer.alloc(w * h * 4);

  // DXT1: 4×4 blokken, 8 bytes per blok
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);

  function rgb565(c) {
    return [(c >> 11 & 31) * 255 / 31 | 0, (c >> 5 & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
  }

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const bi  = (by * bw + bx) * 8;
      const c0v = src.readUInt16LE(bi);
      const c1v = src.readUInt16LE(bi + 2);
      const lut = src.readUInt32LE(bi + 4);
      const c0  = rgb565(c0v);
      const c1  = rgb565(c1v);
      let colors;
      if (c0v > c1v) {
        colors = [
          c0,
          c1,
          [((c0[0]*2+c1[0])/3)|0, ((c0[1]*2+c1[1])/3)|0, ((c0[2]*2+c1[2])/3)|0],
          [((c0[0]+c1[0]*2)/3)|0, ((c0[1]+c1[1]*2)/3)|0, ((c0[2]+c1[2]*2)/3)|0],
        ];
      } else {
        colors = [
          c0,
          c1,
          [((c0[0]+c1[0])/2)|0, ((c0[1]+c1[1])/2)|0, ((c0[2]+c1[2])/2)|0],
          [0,0,0],
        ];
      }
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const ix = bx * 4 + px;
          const iy = by * 4 + py;
          if (ix >= w || iy >= h) continue;
          const idx = (lut >> ((py * 4 + px) * 2)) & 3;
          const [r,g,b] = colors[idx];
          const off = (iy * w + ix) * 4;
          rgba[off]   = r;
          rgba[off+1] = g;
          rgba[off+2] = b;
          rgba[off+3] = 255;
        }
      }
    }
  }
  return { rgba, w, h };
}

// PNG schrijven zonder externe library (DEFLATE via zlib)
const zlib = require('zlib');

function rgbaToPNG(rgba, w, h) {
  const png_sig = Buffer.from([137,80,78,71,13,10,26,10]);

  function chunk(type, data) {
    const buf = Buffer.alloc(12 + data.length);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4, 'ascii');
    data.copy(buf, 8);
    let crc = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) {
      crc ^= buf[i];
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    buf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
    return buf;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // bit depth 8, RGB

  // Bouw raw scanlines op (RGB, filter byte 0)
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = y * (1 + w * 3) + 1 + x * 3;
      raw[d]   = rgba[s];
      raw[d+1] = rgba[s+1];
      raw[d+2] = rgba[s+2];
    }
  }

  const idat = zlib.deflateSync(raw, { level: 1 });
  return Buffer.concat([
    png_sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Compositeer 12 BLP-tiles (4 kolommen × 3 rijen) naar één PNG
// ── Hulpfunctie: zoek geëxtraheerde WORLDMAP-map ─────────────────────────────
function resolveWorldmapDir(configuredPath) {
  if (configuredPath && fs.existsSync(configuredPath) && !getMpqReader().isDataPath(configuredPath)) {
    return configuredPath;
  }
  const fallbacks = [
    path.join(__dirname, '..', 'src', 'background', 'WORLDMAP'),
    path.join(app.getAppPath(), 'src', 'background', 'WORLDMAP'),
    path.join(process.cwd(), 'src', 'background', 'WORLDMAP'),
  ];
  return fallbacks.find(p => fs.existsSync(p)) || null;
}

// ─── Spawn loader ─────────────────────────────────────────────────────────────
ipcMain.handle('spawns:load', async (_, { mapId, limit = 1000 }) => {
  if (!dbConnection) return { success: false, error: 'Niet verbonden' };
  try {
    const m = parseInt(mapId, 10);
    const lc = parseInt(limit, 10);
    const lg = Math.floor(lc / 2);
    const [creatures] = await dbConnection.query(
      `SELECT CONCAT('c_', c.guid) AS guid, c.id1 AS entry, ct.name,
              c.position_x AS x, c.position_y AS y, c.position_z AS z,
              'creature' AS type, ct.faction AS faction
       FROM creature c
       JOIN creature_template ct ON c.id1 = ct.entry
       WHERE c.map = ${m} LIMIT ${lc}`
    );
    const [gameobjects] = await dbConnection.query(
      `SELECT CONCAT('g_', g.guid) AS guid, g.id AS entry, gt.name,
              g.position_x AS x, g.position_y AS y, g.position_z AS z,
              'gameobject' AS type, NULL AS faction
       FROM gameobject g
       JOIN gameobject_template gt ON g.id = gt.entry
       WHERE g.map = ${m} LIMIT ${lg}`
    );
    return { success: true, data: [...creatures, ...gameobjects] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── ADT terrain parser ───────────────────────────────────────────────────────
const UNIT_SIZE = 33.33333 / 8; // = 4.16666 yards per outer vertex step

function parseAdt(buf) {
  let offset = 0;
  let mcinData = -1;

  // Zoek MCIN chunk (magic reversed = 'NICM')
  while (offset + 8 <= buf.length) {
    const magic = buf.slice(offset, offset + 4).toString('ascii');
    const size  = buf.readUInt32LE(offset + 4);
    if (magic === 'NICM') { mcinData = offset + 8; break; }
    if (size === 0) break;
    offset += 8 + size;
  }
  if (mcinData === -1) return null;

  const chunks = [];
  for (let i = 0; i < 256; i++) {
    const mcnkOff = buf.readUInt32LE(mcinData + i * 16);
    if (!mcnkOff || mcnkOff + 8 > buf.length) { chunks.push(null); continue; }

    const magic = buf.slice(mcnkOff, mcnkOff + 4).toString('ascii');
    if (magic !== 'KNCM') { chunks.push(null); continue; }

    const ds       = mcnkOff + 8; // MCNK data start
    const ix       = buf.readUInt32LE(ds + 4);
    const iy       = buf.readUInt32LE(ds + 8);
    const offsMCVT = buf.readUInt32LE(ds + 20);
    const posX     = buf.readFloatLE(ds + 104);
    const posY     = buf.readFloatLE(ds + 108);
    const posZ     = buf.readFloatLE(ds + 112);

    if (!offsMCVT || ds + offsMCVT + 8 + 580 > buf.length) { chunks.push(null); continue; }

    const hStart = ds + offsMCVT + 8; // sla MCVT magic+size over
    const heights = [];
    for (let vRow = 0; vRow < 9; vRow++) {
      for (let vCol = 0; vCol < 9; vCol++) {
        heights.push(buf.readFloatLE(hStart + (vRow * 17 + vCol) * 4));
      }
    }
    chunks.push({ ix, iy, posX, posY, posZ, heights });
  }
  return chunks;
}
ipcMain.handle('adt:getTerrain', async (_, { mapName, tiles }) => {
  try {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) return { success: true, data: [] };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const dataPath = cfg.worldmapMpqPath;
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) return { success: true, data: [] };

    const result = [];
    for (const { tileX, tileY } of tiles) {
      const buf = await getMpqReader().readAdtBuffer(dataPath, mapName, tileX, tileY);
      if (!buf) continue;
      const chunks = parseAdt(buf);
      if (chunks) result.push({ tileX, tileY, chunks });
    }
    return { success: true, data: result };
  } catch (e) {
    console.error('adt:getTerrain error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('worldmap:getZoneImage', async (_, folderName, baseName, dataPath) => {
  try {
    const COLS = 4, ROWS = 3;
    const tileW = 256, tileH = 256;
    const fullW = COLS * tileW;
    const fullH = ROWS * tileH;
    const composite = Buffer.alloc(fullW * fullH * 4, 0);

    const useMpq = dataPath && getMpqReader().isDataPath(dataPath);

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col + 1;
        let blpBuf = null;

        if (useMpq) {
          blpBuf = await getMpqReader().readTileBuffer(dataPath, folderName, idx);
        } else {
          const dir = resolveWorldmapDir(dataPath);
          if (dir) {
            const p = path.join(dir, folderName, `${baseName}${idx}.blp`);
            if (fs.existsSync(p)) blpBuf = fs.readFileSync(p);
          }
        }

        if (!blpBuf) continue;

        const { rgba, w, h } = decodeBLP(blpBuf);
        const ox = col * tileW;
        const oy = row * tileH;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const src = (y * w + x) * 4;
            const dst = ((oy + y) * fullW + (ox + x)) * 4;
            composite[dst]     = rgba[src];
            composite[dst + 1] = rgba[src + 1];
            composite[dst + 2] = rgba[src + 2];
            composite[dst + 3] = rgba[src + 3];
          }
        }
      }
    }

    const png = rgbaToPNG(composite, fullW, fullH);
    return { success: true, data: `data:image/png;base64,${png.toString('base64')}` };
  } catch (e) {
    console.error('worldmap:getZoneImage error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('worldmap:readWorldMapAreas', async (_, dbcPath) => {
  try {
    const buffer = fs.readFileSync(path.join(dbcPath, 'WorldMapArea.dbc'));
    if (buffer.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'Geen DBC' };
    const recordCount  = buffer.readUInt32LE(4);
    const recordSize   = buffer.readUInt32LE(12);
    const strBlockSize = buffer.readUInt32LE(16);
    const headerSize   = 20;
    const strStart     = headerSize + recordCount * recordSize;

    function readStr(offset) {
      if (!offset) return '';
      let end = offset;
      while (strStart + end < buffer.length && buffer[strStart + end] !== 0) end++;
      return buffer.slice(strStart + offset, strStart + end).toString('utf8');
    }

    const areas = [];
    for (let i = 0; i < recordCount; i++) {
      const b = headerSize + i * recordSize;
      areas.push({
        id:           buffer.readUInt32LE(b),
        mapId:        buffer.readUInt32LE(b + 4),
        areaId:       buffer.readUInt32LE(b + 8),
        internalName: readStr(buffer.readUInt32LE(b + 12)),
        locLeft:      buffer.readFloatLE(b + 16),
        locRight:     buffer.readFloatLE(b + 20),
        locTop:       buffer.readFloatLE(b + 24),
        locBottom:    buffer.readFloatLE(b + 28),
      });
    }
    return { success: true, areas };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
