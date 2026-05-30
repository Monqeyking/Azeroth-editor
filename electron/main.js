const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const http = require('http');
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
let soapRequestId = 0;

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

function warmupM2Dbc(cfg) {
  if (!cfg?.worldmapMpqPath) return;
  const dp = cfg.worldmapMpqPath;
  setImmediate(() => {
    try {
      if (getMpqReader().isDataPath(dp)) {
        console.log('[m2 warmup] DBC laden gestart op achtergrond');
        getM2DbcData(dp).catch(e => console.warn('[m2 warmup] DBC fout:', e.message));
      }
    } catch (_) {}
  });
}

ipcMain.handle('config:load', () => {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      warmupM2Dbc(data);
      return { success: true, data };
    }
    return { success: true, data: null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('config:save', (_, config) => {
  try {
    const configPath = getConfigPath();
    let current = {};
    if (fs.existsSync(configPath)) {
      current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    const merged = { ...current, ...config };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
    warmupM2Dbc(merged);
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

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval';" +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://wowgaming.altervista.org https://code.jquery.com http://wow.zamimg.com https://wow.zamimg.com;" +
          "connect-src 'self' https://wowgaming.altervista.org http://wow.zamimg.com https://wow.zamimg.com ws://localhost:*;" +
          "img-src 'self' data: blob: https://wowgaming.altervista.org http://wow.zamimg.com https://wow.zamimg.com;" +
          "style-src 'self' 'unsafe-inline' https://wowgaming.altervista.org http://wow.zamimg.com https://wow.zamimg.com https://fonts.googleapis.com;" +
          "font-src 'self' data: https://fonts.gstatic.com https://wowgaming.altervista.org http://wow.zamimg.com https://wow.zamimg.com;" +
          "worker-src 'self' blob:;"
        ]
      }
    });
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
    const requestId = ++soapRequestId;
    const soapCommand = String(command ?? '').trim();
    const auth = Buffer.from(`${user}:${password}`).toString('base64');

    function escapeXml(value) {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    }

    function sendSoapCommand(attemptCommand, attempt) {
      const escapedCommand = escapeXml(attemptCommand);
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:AC">
  <SOAP-ENV:Body>
    <ns1:executeCommand><command>${escapedCommand}</command></ns1:executeCommand>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

      console.log(`[SOAP ${requestId}.${attempt}] target:`, `${host}:${port}`, 'user:', user || '(empty)');
      console.log(`[SOAP ${requestId}.${attempt}] raw command:`, JSON.stringify(command));
      console.log(`[SOAP ${requestId}.${attempt}] command:`, attemptCommand);
      console.log(`[SOAP ${requestId}.${attempt}] command length:`, attemptCommand.length);
      console.log(`[SOAP ${requestId}.${attempt}] command chars:`, [...attemptCommand].map(ch => `${ch}:${ch.charCodeAt(0)}`).join(' '));
      console.log(`[SOAP ${requestId}.${attempt}] request body:`, body);

      const req = http.request({
        hostname: host,
        port: Number(port),
        path: '/RPC2',
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8',
          'SOAPAction': 'urn:AC#executeCommand',
          'Authorization': `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(body),
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log(`[SOAP ${requestId}.${attempt}] status:`, res.statusCode);
          console.log(`[SOAP ${requestId}.${attempt}] response:`, data);
          const result = data.match(/<result>([\s\S]*?)<\/result>/);
          const fault  = data.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
          const parsedFault = fault ? fault[1].replace(/&#xD;/g, '\r').trim() : null;
          if (result) console.log(`[SOAP ${requestId}.${attempt}] parsed result:`, result[1].trim());
          if (parsedFault) console.log(`[SOAP ${requestId}.${attempt}] parsed fault:`, parsedFault);

          const shouldRetryWithoutDot =
            attempt === 1 &&
            attemptCommand.startsWith('.go ') &&
            parsedFault?.includes('.gobject');
          if (shouldRetryWithoutDot) {
            const retryCommand = attemptCommand.slice(1);
            console.log(`[SOAP ${requestId}.${attempt}] .go matched .gobject; retrying as:`, retryCommand);
            sendSoapCommand(retryCommand, attempt + 1);
            return;
          }

          if (res.statusCode === 200) {
            resolve({ success: true, result: result ? result[1].trim() : 'OK' });
          } else {
            const msg = parsedFault ?? (result ? result[1].trim() : data);
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${msg}` });
          }
        });
      });

      req.on('error', (e) => {
        console.log(`[SOAP ${requestId}.${attempt}] request error:`, e.message);
        resolve({ success: false, error: e.message });
      });
      req.write(body);
      req.end();
    }

    sendSoapCommand(soapCommand, 1);
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

// ── BLP2 decoder (DXT1 / DXT3 / DXT5 / paletted) ────────────────────────────
function rgb565(c) {
  return [(c >> 11 & 31) * 255 / 31 | 0, (c >> 5 & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
}

function dxt1Colors(src, bi) {
  const c0v = src.readUInt16LE(bi);
  const c1v = src.readUInt16LE(bi + 2);
  const c0  = rgb565(c0v);
  const c1  = rgb565(c1v);
  if (c0v > c1v) {
    return [c0, c1,
      [((c0[0]*2+c1[0])/3)|0, ((c0[1]*2+c1[1])/3)|0, ((c0[2]*2+c1[2])/3)|0],
      [((c0[0]+c1[0]*2)/3)|0, ((c0[1]+c1[1]*2)/3)|0, ((c0[2]+c1[2]*2)/3)|0],
    ];
  }
  return [c0, c1, [((c0[0]+c1[0])/2)|0, ((c0[1]+c1[1])/2)|0, ((c0[2]+c1[2])/2)|0], [0,0,0]];
}

function writeDXTPixels(src, colorBase, lut, rgba, bx, by, w, h, alphas) {
  const colors = dxt1Colors(src, colorBase);
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const ix = bx * 4 + px; const iy = by * 4 + py;
      if (ix >= w || iy >= h) continue;
      const pidx = py * 4 + px;
      const [r,g,b] = colors[(lut >> (pidx * 2)) & 3];
      const off = (iy * w + ix) * 4;
      rgba[off] = r; rgba[off+1] = g; rgba[off+2] = b;
      rgba[off+3] = alphas ? alphas[pidx] : 255;
    }
  }
}

function decodeDXT1(src, rgba, w, h) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const bi = (by * bw + bx) * 8;
      writeDXTPixels(src, bi, src.readUInt32LE(bi + 4), rgba, bx, by, w, h, null);
    }
}

function decodeDXT3(src, rgba, w, h) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const bi = (by * bw + bx) * 16;
      const alphas = [];
      for (let i = 0; i < 8; i++) {
        const b = src[bi + i];
        alphas.push((b & 0xF) * 17, ((b >> 4) & 0xF) * 17);
      }
      writeDXTPixels(src, bi + 8, src.readUInt32LE(bi + 12), rgba, bx, by, w, h, alphas);
    }
}

function decodeDXT5(src, rgba, w, h) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const bi = (by * bw + bx) * 16;
      const a0 = src[bi], a1 = src[bi + 1];
      const at = a0 > a1
        ? [a0, a1,
            ((6*a0+1*a1)/7+.5)|0, ((5*a0+2*a1)/7+.5)|0,
            ((4*a0+3*a1)/7+.5)|0, ((3*a0+4*a1)/7+.5)|0,
            ((2*a0+5*a1)/7+.5)|0, ((1*a0+6*a1)/7+.5)|0]
        : [a0, a1,
            ((4*a0+1*a1)/5+.5)|0, ((3*a0+2*a1)/5+.5)|0,
            ((2*a0+3*a1)/5+.5)|0, ((1*a0+4*a1)/5+.5)|0,
            0, 255];
      let aibig = BigInt(0);
      for (let b = 0; b < 6; b++) aibig |= BigInt(src[bi + 2 + b]) << BigInt(b * 8);
      const alphas = [];
      for (let i = 0; i < 16; i++) { alphas.push(at[Number(aibig & 7n)]); aibig >>= 3n; }
      writeDXTPixels(src, bi + 8, src.readUInt32LE(bi + 12), rgba, bx, by, w, h, alphas);
    }
}

function decodeBLP(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'BLP2') throw new Error('Geen BLP2');
  const encoding      = buffer.readUInt8(8);
  const alphaDepth    = buffer.readUInt8(9);
  const alphaEncoding = buffer.readUInt8(10);
  const w             = buffer.readUInt32LE(12);
  const h             = buffer.readUInt32LE(16);
  const offset        = buffer.readUInt32LE(20);
  const size          = buffer.readUInt32LE(84);
  const src           = buffer.slice(offset, offset + size);
  const rgba          = Buffer.alloc(w * h * 4, 255);

  if (encoding === 2) {
    if (alphaEncoding === 7) decodeDXT5(src, rgba, w, h);
    else if (alphaEncoding === 1) decodeDXT3(src, rgba, w, h);
    else decodeDXT1(src, rgba, w, h);
  } else {
    // Paletted (encoding === 1): palette at offset 148 (256 × uint32 BGRA)
    for (let i = 0; i < Math.min(w * h, src.length); i++) {
      const p = 148 + src[i] * 4;
      rgba[i*4]   = buffer[p+2];
      rgba[i*4+1] = buffer[p+1];
      rgba[i*4+2] = buffer[p];
      rgba[i*4+3] = alphaDepth ? (src[w*h + i] ?? 255) : 255;
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
              'creature' AS type, ct.faction AS faction,
              ctm.CreatureDisplayID AS displayId
       FROM creature c
       JOIN creature_template ct ON c.id1 = ct.entry
       LEFT JOIN creature_template_model ctm ON ctm.CreatureID = ct.entry AND ctm.Idx = 0
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

ipcMain.handle('spawns:search', async (_, { query, mapId, limit = 50 }) => {
  if (!dbConnection) return { success: false, error: 'Niet verbonden' };
  try {
    const m  = parseInt(mapId, 10);
    const lm = parseInt(limit, 10);
    const lh = Math.floor(lm / 2);
    const like = `%${query}%`;
    const entryNum = parseInt(query, 10);
    const entryFilter = Number.isFinite(entryNum) ? entryNum : -1;

    const [creatures] = await dbConnection.query(
      `SELECT CONCAT('c_', c.guid) AS guid, c.id1 AS entry, ct.name,
              c.position_x AS x, c.position_y AS y, c.position_z AS z,
              'creature' AS type, ct.faction AS faction
       FROM creature c
       JOIN creature_template ct ON c.id1 = ct.entry
       WHERE c.map = ? AND (ct.name LIKE ? OR c.id1 = ?)
       LIMIT ?`,
      [m, like, entryFilter, lm]
    );
    const [gameobjects] = await dbConnection.query(
      `SELECT CONCAT('g_', g.guid) AS guid, g.id AS entry, gt.name,
              g.position_x AS x, g.position_y AS y, g.position_z AS z,
              'gameobject' AS type, NULL AS faction
       FROM gameobject g
       JOIN gameobject_template gt ON g.id = gt.entry
       WHERE g.map = ? AND (gt.name LIKE ? OR g.id = ?)
       LIMIT ?`,
      [m, like, entryFilter, lh]
    );
    return { success: true, data: [...creatures, ...gameobjects] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('spawns:update', async (_, { guid, type, x, y, z, orientation }) => {
  if (!dbConnection) return { success: false, error: 'Niet verbonden' };
  try {
    const numGuid = parseInt(String(guid).replace(/^[cg]_/, ''), 10);
    const table   = type === 'gameobject' ? 'gameobject' : 'creature';
    await dbConnection.execute(
      `UPDATE ${table} SET position_x=?, position_y=?, position_z=?, orientation=? WHERE guid=?`,
      [x, y, z, orientation, numGuid]
    );
    return { success: true };
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

    const hStart = ds + offsMCVT + 8;
    // MCVT: 17 floats per rij: 9 outer + 8 inner (staggered centers)
    // outer[r][c] = hStart + (r*17 + c) * 4          (r=0..8, c=0..8)
    // inner[r][c] = hStart + (r*17 + 9 + c) * 4      (r=0..7, c=0..7)
    const outer = new Float32Array(9 * 9);
    const inner = new Float32Array(8 * 8);
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        outer[r * 9 + c] = buf.readFloatLE(hStart + (r * 17 + c) * 4);
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        inner[r * 8 + c] = buf.readFloatLE(hStart + (r * 17 + 9 + c) * 4);
    // ── DEBUG HEIGHT OFFSET ──────────────────────────────────────────────────
    if (ix === 8 && iy === 8) {
      console.log('[ADT DEBUG] chunk ix=8 iy=8 —',
        'posX=', posX.toFixed(4),
        'posY=', posY.toFixed(4),
        'posZ=', posZ.toFixed(4),
        '| outer[0]=',   outer[0].toFixed(4),
        'outer[40]=',  outer[40].toFixed(4),
        'outer[80]=',  outer[80].toFixed(4),
        '| posZ+outer[40]=', (posZ + outer[40]).toFixed(4)
      );
    }
    // ── END DEBUG ────────────────────────────────────────────────────────────
    chunks.push({ ix, iy, posX, posY, posZ, outer, inner });
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
      const buf = await getMpqReader().readAdtBuffer(dataPath, mapName, tileY, tileX);
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

// ─── M2 model loader ──────────────────────────────────────────────────────────
const m2DiskCache = require('./m2-disk-cache');
const { runM2Load } = require('./m2-load-queue');
const {
  parseSkinFile, resolveVisibleGeosets, buildGeosetDebugInfo, buildIndicesFromSkin,
  parseCharHairGeosets, parseFacialHairGeosets, parseCreatureDisplayInfoExtra,
} = require('./m2-geoset');

function modelNeedsCreatureTexture(geo) {
  if (!geo?.textures?.length) return false;
  return geo.textures.some(t => {
    if (t.type >= 11 && t.type <= 13) return true;
    if (t.type === 0 && t.filename && !/PARTICLE|REFLECT|ENVIRON|GLOW|SPARKLE/i.test(t.filename))
      return true;
    return false;
  });
}

function variantHasTexture(result) {
  return !!(result?.textureRgba && result.textureW > 0 && result.textureH > 0);
}

function isCompleteVariant(result, geo) {
  if (!result) return false;
  if (!modelNeedsCreatureTexture(geo)) return true;
  return variantHasTexture(result);
}

function tryLoadM2VariantFromDisk(userData, variantKey, modelPath) {
  const diskVar = m2DiskCache.readDiskVariant(userData, variantKey);
  if (!diskVar || diskVar.modelPath !== modelPath || !diskVar.indices?.length) return null;

  let geo = m2GeometryCache.get(modelPath);
  if (!geo) return null;

  const result = {
    positions: geo.positions,
    normals:   geo.normals,
    uvs:       geo.uvs,
    indices:   new Uint32Array(diskVar.indices),
    textureRgba: diskVar.textureRgba,
    textureW:    diskVar.textureW,
    textureH:    diskVar.textureH,
    modelPath,
    texturePath: null,
  };

  if (!isCompleteVariant(result, geo)) {
    m2DiskCache.deleteDiskVariant(userData, variantKey);
    return null;
  }
  return result;
}

function getM2DataPath() {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) return null;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const dataPath = cfg.worldmapMpqPath;
  if (!dataPath || !getMpqReader().isDataPath(dataPath)) return null;
  return dataPath;
}

// DBC helpers
function parseDBC(buf) {
  if (!buf || buf.toString('ascii', 0, 4) !== 'WDBC') return null;
  const numRecords   = buf.readUInt32LE(4);
  const recordSize   = buf.readUInt32LE(12);
  const strBlockSize = buf.readUInt32LE(16);
  const dataStart    = 20;
  const strStart     = dataStart + numRecords * recordSize;
  return { buf, numRecords, recordSize, strBlockSize, dataStart, strStart };
}

function dbcStr(dbc, offset, corr = 1) {
  if (!offset) return '';
  const pos = dbc.strStart + offset - corr;
  if (pos < dbc.strStart || pos >= dbc.buf.length) return '';
  let end = pos;
  while (end < dbc.buf.length && dbc.buf[end] !== 0) end++;
  return dbc.buf.toString('utf8', pos, end);
}

function dbcStrCdi(dbc, offset) {
  if (!offset) return '';
  const a = dbcStr(dbc, offset, 0);
  const b = dbcStr(dbc, offset, 1);
  if (!a) return b;
  if (!b) return a;
  return a.length >= b.length ? a : b;
}

// DBC index: Map<id, recordOffset>
function dbcBuildIndex(dbc) {
  const map = new Map();
  for (let i = 0; i < dbc.numRecords; i++) {
    const off = dbc.dataStart + i * dbc.recordSize;
    map.set(dbc.buf.readUInt32LE(off), off);
  }
  return map;
}

// Module-level caches
let m2DbcCachePromise = null;
let m2DbcCachePath    = null;
const m2ModelCache     = new Map(); // displayId → result|null
const m2VariantCache   = new Map(); // modelPath|texVars → result
const m2GeometryCache  = new Map(); // modelPath → { positions, normals, uvs, textures, skin }
const m2SkinCache      = new Map(); // modelPath → parsed .skin
const blpTextureCache  = new Map(); // blpPath (lower) → { textureRgba, textureW, textureH }
const m2VariantInflight  = new Map(); // variantKey → Promise<result|null>
const m2DisplayInflight  = new Map(); // displayId → Promise<result|null>

function getM2DbcData(dataPath) {
  if (m2DbcCachePath === dataPath && m2DbcCachePromise) return m2DbcCachePromise;

  m2DbcCachePath    = dataPath;
  m2DbcCachePromise = (async () => {
    const reader = getMpqReader();
    async function readDbc(name) {
      const buf = await reader.readFileFromMpqs(dataPath, `DBFilesClient\\${name}`);
      return buf ? parseDBC(buf) : null;
    }

    const [cdiDbc, cmdDbc, cdieDbc, hairDbc, facialDbc, charSectionsDbc] = await Promise.all([
      readDbc('CreatureDisplayInfo.dbc'),
      readDbc('CreatureModelData.dbc'),
      readDbc('CreatureDisplayInfoExtra.dbc'),
      readDbc('CharHairGeosets.dbc'),
      readDbc('CharacterFacialHairStyles.dbc'),
      readDbc('CharSections.dbc'),
    ]);

    const displayInfo = new Map();
    const modelData   = new Map();

    if (cdiDbc) {
      for (const [id, off] of dbcBuildIndex(cdiDbc)) {
        displayInfo.set(id, {
          modelId:  cdiDbc.buf.readUInt32LE(off + 4),
          extendedDisplayInfoId: cdiDbc.buf.readUInt32LE(off + 12),
          creatureGeosetData: cdiDbc.buf.readUInt32LE(off + 60),
          texVar1:  dbcStrCdi(cdiDbc, cdiDbc.buf.readUInt32LE(off + 24)),
          texVar2:  dbcStrCdi(cdiDbc, cdiDbc.buf.readUInt32LE(off + 28)),
          texVar3:  dbcStrCdi(cdiDbc, cdiDbc.buf.readUInt32LE(off + 32)),
        });
      }
    }

    if (cmdDbc) {
      for (const [id, off] of dbcBuildIndex(cmdDbc)) {
        modelData.set(id, {
          modelPath: dbcStr(cmdDbc, cmdDbc.buf.readUInt32LE(off + 8), 0),
        });
      }
    }

    const sortedModelIds = [...modelData.keys()].sort((a,b) => a-b);
    const sortedDisplayIds = [...displayInfo.keys()].sort((a,b) => a-b);
    console.log(`[m2 DBC] CDI recordSize=${cdiDbc?.recordSize} strBlockSize=${cdiDbc?.strBlockSize}, CMD recordSize=${cmdDbc?.recordSize} strBlockSize=${cmdDbc?.strBlockSize}`);
    // Raw CMD offset waarden bij record+8 (de modelPath string ref)
    if (cmdDbc) {
      const rawOffsets = [];
      for (let i = 0; i < Math.min(5, cmdDbc.numRecords); i++) {
        const off = cmdDbc.dataStart + i * cmdDbc.recordSize;
        rawOffsets.push(`id=${cmdDbc.buf.readUInt32LE(off)} off4=${cmdDbc.buf.readUInt32LE(off+4)} off8=${cmdDbc.buf.readUInt32LE(off+8)}`);
      }
      console.log(`[m2 DBC] CMD eerste records (id/off4/off8):`, rawOffsets);
    }
    console.log(`[m2 DBC] geladen: ${displayInfo.size} displayInfo, ${modelData.size} modelData`);
    console.log(`[m2 DBC] eerste modelData IDs:`, sortedModelIds.slice(0, 15));
    console.log(`[m2 DBC] eerste modelData paden:`, sortedModelIds.slice(0, 5).map(id => `${id}=${modelData.get(id)?.modelPath}`));
    console.log(`[m2 DBC] eerste displayInfo IDs:`, sortedDisplayIds.slice(0, 5));
    console.log(`[m2 DBC] eerste displayInfo entries:`, sortedDisplayIds.slice(0, 3).map(id => `${id}=${JSON.stringify(displayInfo.get(id))}`));
    return {
      dataPath, displayInfo, modelData,
      cdieDbc, charHair: parseCharHairGeosets(hairDbc), facialHair: parseFacialHairGeosets(facialDbc),
      charSections: parseCharSections(charSectionsDbc),
    };
  })();

  return m2DbcCachePromise;
}

function parseM2(buf) {
  if (!buf || buf.toString('ascii', 0, 4) !== 'MD20') return null;

  const nVertices   = buf.readUInt32LE(0x3C);
  const ofsVertices = buf.readUInt32LE(0x40);
  const nTextures   = buf.readUInt32LE(0x50);
  const ofsTextures = buf.readUInt32LE(0x54);

  const positions = [], normals = [], uvs = [];

  for (let i = 0; i < nVertices; i++) {
    const v = ofsVertices + i * 48;
    const px = buf.readFloatLE(v),      py = buf.readFloatLE(v + 4),  pz = buf.readFloatLE(v + 8);
    const nx = buf.readFloatLE(v + 20), ny = buf.readFloatLE(v + 24), nz = buf.readFloatLE(v + 28);
    const u  = buf.readFloatLE(v + 32), vv = buf.readFloatLE(v + 36);
    // M2 → Three.js: [-y, z, x]
    positions.push(-py, pz, px);
    normals.push(-ny, nz, nx);
    uvs.push(u, vv);
  }

  const textures = [];
  for (let i = 0; i < nTextures; i++) {
    const t    = ofsTextures + i * 16;
    const type = buf.readUInt32LE(t);
    const nFn  = buf.readUInt32LE(t + 8);
    const oFn  = buf.readUInt32LE(t + 12);
    let filename = '';
    if (nFn > 0 && oFn > 0 && oFn + nFn <= buf.length) {
      let end = oFn;
      while (end < buf.length && buf[end] !== 0) end++;
      filename = buf.toString('ascii', oFn, end).replace(/\//g, '\\');
    }
    textures.push({ type, filename });
  }

  return { positions, normals, uvs, textures };
}

function parseSkin(buf) {
  const skin = parseSkinFile(buf);
  if (!skin) return null;
  const indices = [];
  for (const sm of skin.submeshes) {
    for (let i = 0; i < sm.indexCount; i++) {
      const triIdx = skin.indexLookup[sm.indexStart + i];
      indices.push(skin.vertexLookup[triIdx] ?? 0);
    }
  }
  return indices;
}

async function loadSkinData(reader, dataPath, modelPath) {
  if (m2SkinCache.has(modelPath)) return m2SkinCache.get(modelPath);
  const stem = modelPath.replace(/\.m2$/i, '');
  for (const skinPath of [`${stem}00.skin`, `${stem}01.skin`, `${stem}00.SKIN`]) {
    const skinBuf = await reader.readFileFromMpqs(dataPath, skinPath);
    const skin = skinBuf ? parseSkinFile(skinBuf) : null;
    if (skin?.submeshes?.length) {
      m2SkinCache.set(modelPath, skin);
      return skin;
    }
  }
  return null;
}

function m2ModelStem(modelPath) {
  const base = modelPath.split('\\').pop() || modelPath.split('/').pop() || '';
  return base.replace(/\.(m2|mdx)$/i, '');
}

// CharSections.dbc: ID(0) RaceID(4) SexID(8) BaseSection(12) Tex1(16) Tex2(20) Tex3(24) Flags(28) VariationIndex(32) ColorIndex(36)
// recordSize = 40
function parseCharSections(dbc) {
  if (!dbc) return [];
  const rows = [];
  for (let i = 0; i < dbc.numRecords; i++) {
    const off = dbc.dataStart + i * dbc.recordSize;
    rows.push({
      race:      dbc.buf.readUInt32LE(off + 4),
      sex:       dbc.buf.readUInt32LE(off + 8),
      section:   dbc.buf.readUInt32LE(off + 12),
      tex1:      dbcStr(dbc, dbc.buf.readUInt32LE(off + 16), 0),
      tex2:      dbcStr(dbc, dbc.buf.readUInt32LE(off + 20), 0),
      variation: dbc.buf.readUInt32LE(off + 32),
      color:     dbc.buf.readUInt32LE(off + 36),
    });
  }
  return rows;
}

function charSectionTextureCandidates(charSections, race, sex, skin, face) {
  const out = [];
  if (!charSections?.length) return out;
  const match = (section, variation, color) =>
    charSections.find(r => r.race === race && r.sex === sex && r.section === section && r.variation === variation && r.color === color);

  const body = match(0, 0, skin);
  if (body?.tex1) out.push(body.tex1);

  const face1 = match(1, face, skin);
  if (face1?.tex1) out.push(face1.tex1);
  if (face1?.tex2) out.push(face1.tex2);

  return out;
}

function inferCharacterBakeCandidates(modelDir, modelPath, extra) {
  if (!extra) return [];
  const stem = m2ModelStem(modelPath);
  const skin = String(extra.skin ?? 0).padStart(2, '0');
  const hairColor = String(extra.hairColor ?? 0).padStart(2, '0');
  // Pattern: VariationIndex=00, ColorIndex=skin (confirmed from CharSections.dbc)
  const patterns = [
    `${stem}Skin00_${skin}`,
    `${stem}Skin${skin}_${hairColor}`,
    `${stem}Skin${skin}_00`,
    `${stem}Skin00_${hairColor}`,
    `${stem}Skin00_00`,
    `${stem}Skin`,
  ];
  return patterns.map(p => `${modelDir}${p}.blp`);
}

function creatureTextureCandidates(modelDir, modelPath, texVars, m2, discovered = []) {
  const stem = m2ModelStem(modelPath);
  const out = [];

  for (const tex of m2.textures) {
    if (tex.type >= 11 && tex.type <= 13) {
      const v = texVars[tex.type - 11];
      if (v) out.push(modelDir + v + '.blp');
    }
  }
  for (const v of texVars) {
    if (v) out.push(modelDir + v + '.blp');
  }
  if (!/skin$/i.test(stem)) out.push(modelDir + stem + 'Skin.blp');
  for (const p of discovered) out.push(p);
  for (const tex of m2.textures) {
    if (tex.type === 0 && tex.filename && !/PARTICLE|REFLECT|ENVIRON|GLOW|SPARKLE/i.test(tex.filename))
      out.push(tex.filename);
  }
  out.push(modelDir + stem + '.blp');
  return [...new Set(out)];
}

function blpCacheKey(p) {
  return p.replace(/\//g, '\\').toLowerCase();
}

function m2VariantKey(displayId) {
  return `display:${displayId}`;
}

async function getOrLoadM2Geometry(reader, dataPath, modelPath, log) {
  if (m2GeometryCache.has(modelPath)) {
    log('geometrie cache hit:', modelPath);
    return m2GeometryCache.get(modelPath);
  }

  const m2Buf = await reader.readFileFromMpqs(dataPath, modelPath);
  if (!m2Buf) return null;

  const m2 = parseM2(m2Buf);
  if (!m2) return null;

  const skin = await loadSkinData(reader, dataPath, modelPath);
  if (!skin) return null;

  const geo = {
    positions: new Float32Array(m2.positions),
    normals:   new Float32Array(m2.normals),
    uvs:       new Float32Array(m2.uvs),
    textures:  m2.textures,
    skin,
  };
  m2GeometryCache.set(modelPath, geo);
  log('geometrie gecached:', modelPath);
  return geo;
}

async function loadFirstCreatureBlp(reader, dataPath, candidates, log) {
  for (const p of candidates) {
    const key = blpCacheKey(p);
    if (blpTextureCache.has(key)) {
      log('textuur cache hit:', p);
      return blpTextureCache.get(key);
    }

    const buf = await reader.readFileFromMpqs(dataPath, p);
    if (!buf) continue;
    if (buf.length < 4) continue;
    const magic = buf.toString('ascii', 0, 4);
    if (magic !== 'BLP2') continue;

    try {
      const decoded = decodeBLP(buf);
      const entry = {
        textureRgba: new Uint8Array(decoded.rgba),
        textureW: decoded.w,
        textureH: decoded.h,
        blpPath: p,
      };
      blpTextureCache.set(key, entry);
      log(`textuur gecached: ${p} (${decoded.w}×${decoded.h})`);
      return entry;
    } catch (e) {
      log('BLP decode fout:', p, e.message);
    }
  }
  return null;
}

async function loadM2ModelForDisplay(displayId, dataPath, log) {
  const { displayInfo, modelData, cdieDbc, charHair, facialHair, charSections } = await getM2DbcData(dataPath);

  const cdi = displayInfo.get(displayId);
  if (!cdi) { log('displayId niet in DBC'); return null; }

  const cmd = modelData.get(cdi.modelId);
  if (!cmd?.modelPath) { log(`modelData ${cdi.modelId} niet gevonden`); return null; }

  const modelPath = cmd.modelPath.replace(/\//g, '\\').replace(/\.mdx$/i, '.m2');
  const texVars   = [cdi.texVar1, cdi.texVar2, cdi.texVar3];
  const variantKey = m2VariantKey(displayId);
  const extra = parseCreatureDisplayInfoExtra(cdieDbc, cdi.extendedDisplayInfoId);

  const userData = app.getPath('userData');

  if (m2VariantCache.has(variantKey)) {
    const cached = m2VariantCache.get(variantKey);
    const geo = m2GeometryCache.get(modelPath);
    if (isCompleteVariant(cached, geo)) {
      log('variant cache hit:', variantKey);
      return cached;
    }
    m2VariantCache.delete(variantKey);
    log('variant cache onvolledig, opnieuw laden:', variantKey);
  }

  const diskVariant = tryLoadM2VariantFromDisk(userData, variantKey, modelPath);
  if (diskVariant) {
    log('variant disk cache hit:', variantKey);
    m2VariantCache.set(variantKey, diskVariant);
    return diskVariant;
  }

  if (m2VariantInflight.has(variantKey)) {
    log('variant wacht op lopende load');
    return m2VariantInflight.get(variantKey);
  }

  const loadWork = (async () => {
  const reader = getMpqReader();
  const geo = await getOrLoadM2Geometry(reader, dataPath, modelPath, log);
  if (!geo?.skin) return null;

  const visible = resolveVisibleGeosets(geo.skin.submeshes, cdi, extra, charHair, facialHair);
  const geosetDebug = buildGeosetDebugInfo(geo.skin.submeshes, visible, cdi, extra, charHair, facialHair);
  const indexList = buildIndicesFromSkin(geo.skin, visible);
  if (!indexList.length) return null;

  const modelDir = modelPath.includes('\\') ? modelPath.substring(0, modelPath.lastIndexOf('\\') + 1) : '';
  const stem     = m2ModelStem(modelPath);
  let discovered = [];
  if (reader.discoverCreatureBlps) {
    discovered = await reader.discoverCreatureBlps(dataPath, modelDir, stem);
  }

  const candidates = [];
  if (extra?.bakeName) {
    const bake = extra.bakeName.replace(/\.blp$/i, '').replace(/\//g, '\\');
    candidates.push(bake.includes('\\') ? `${bake}.blp` : `${modelDir}${bake}.blp`);
  }
  if (extra) {
    candidates.push(...charSectionTextureCandidates(charSections, extra.race, extra.sex, extra.skin, extra.face));
    candidates.push(...inferCharacterBakeCandidates(modelDir, modelPath, extra));
  }
  const m2Stub = { textures: geo.textures };
  candidates.push(...creatureTextureCandidates(modelDir, modelPath, texVars, m2Stub, discovered));
  const tex = await loadFirstCreatureBlp(reader, dataPath, candidates, log);

  const debugInfo = {
    ...geosetDebug,
    modelPath,
    texVar: texVars.filter(Boolean),
    triangleCount: Math.floor(indexList.length / 3),
    textureLoaded: !!tex?.blpPath,
    texturePath: tex?.blpPath ?? null,
    textureSize: tex ? `${tex.textureW}x${tex.textureH}` : null,
    textureCandidates: candidates.slice(0, 20),
  };
  log('geoset:', JSON.stringify(debugInfo));
  if (!tex?.blpPath) log('texture MISS — first candidates:', candidates.slice(0, 8));

  const result = {
    positions: geo.positions,
    normals:   geo.normals,
    uvs:       geo.uvs,
    indices:   new Uint32Array(indexList),
    textureRgba: tex?.textureRgba ?? null,
    textureW:    tex?.textureW ?? 0,
    textureH:    tex?.textureH ?? 0,
    modelPath,
    texturePath: tex?.blpPath ?? null,
    debug: debugInfo,
  };

  if (isCompleteVariant(result, geo)) {
    m2VariantCache.set(variantKey, result);
    m2DiskCache.writeDiskVariant(userData, variantKey, modelPath, result);
  } else {
    log('variant zonder textuur niet gecached:', variantKey, 'candidates:', candidates.slice(0, 8));
  }
  return result;
  })();

  m2VariantInflight.set(variantKey, loadWork);
  try {
    return await loadWork;
  } finally {
    m2VariantInflight.delete(variantKey);
  }
}

ipcMain.handle('m2:loadModel', async (_, { displayId }) => {
  const log = (...a) => console.log(`[m2:${displayId}]`, ...a);
  try {
    if (!displayId) return { success: false, error: 'Geen displayId' };

    const dataPath = getM2DataPath();
    if (!dataPath) return { success: false, error: 'Geen MPQ pad' };

    if (m2ModelCache.has(displayId)) {
      const cached = m2ModelCache.get(displayId);
      if (cached === null) return { success: false, error: 'Model niet beschikbaar (cache)' };
      if (variantHasTexture(cached)) return { success: true, data: cached };
      m2ModelCache.delete(displayId);
      log('display cache zonder textuur gewist, opnieuw laden');
    }

    const result = await loadM2ForDisplay(displayId, dataPath, log);
    if (!result) {
      m2ModelCache.set(displayId, null);
      return { success: false, error: 'Model laden mislukt' };
    }
    if (variantHasTexture(result)) m2ModelCache.set(displayId, result);
    return { success: true, data: result };
  } catch (e) {
    console.error(`[m2:${displayId}] EXCEPTION:`, e);
    return { success: false, error: e.message };
  }
});

function loadM2ForDisplay(displayId, dataPath, log) {
  if (m2DisplayInflight.has(displayId)) return m2DisplayInflight.get(displayId);
  const work = runM2Load(() => loadM2ModelForDisplay(displayId, dataPath, log))
    .finally(() => m2DisplayInflight.delete(displayId));
  m2DisplayInflight.set(displayId, work);
  return work;
}

ipcMain.handle('m2:prefetch', async (_, { displayIds }) => {
  try {
    const dataPath = getM2DataPath();
    if (!dataPath || !Array.isArray(displayIds)) return { success: false };

    const log = () => {};
    const unique = [...new Set(displayIds.filter(Boolean))].slice(0, 48);

    for (const displayId of unique) {
      if (m2ModelCache.has(displayId) || m2DisplayInflight.has(displayId)) continue;
      loadM2ForDisplay(displayId, dataPath, log)
        .then(result => { m2ModelCache.set(displayId, result ?? null); })
        .catch(() => { m2ModelCache.set(displayId, null); });
    }

    return { success: true, queued: unique.length };
  } catch (e) {
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
