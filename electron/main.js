const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard } = require('electron');
// Keeps hardware acceleration enabled; only works around a Windows GPU-process sandbox crash.
app.commandLine.appendSwitch('disable-gpu-sandbox');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { performance } = require('perf_hooks');
const { parseDbc, getString } = require('./dbc-sql');
const mysql = require('mysql2/promise');
const { getConfigPath: getEditorConfigPath, registerConfigIpc } = require('./config-ipc');
const { registerDbcSqlIpc } = require('./dbc-sql-ipc');
const { registerDialogIpc } = require('./dialog-ipc');
const { registerFileIpc } = require('./file-ipc');
const { registerGlueIpc } = require('./glue-ipc');
const { registerIconIpc } = require('./icon-ipc');
const { registerM2Ipc } = require('./m2-ipc');
let m2Services = null;
const { registerServerIpc } = require('./server-ipc');
const { registerSoapIpc } = require('./soap-ipc');
const { getRuntimeResourceProfile, registerSystemIpc } = require('./system-ipc');
const { decodeBLP, reencodeBlpDxtSelective, rgbaToPNG } = require('./blp-codec');
const { registerTalentAssetIpc } = require('./talent-assets-ipc');
const { registerCharSectionsIpc } = require('./char-sections-ipc');
const { resolveHeroicPortalTransform } = require('./dungeon-portal-resolver');
const { extractAdtMapTile } = require('./adt-map-extractor');
const { mapIdForName, mapFileName, vmapTileFileName, mmapTileFileName, resolveServerTools, inspectVmapDependencies, runTargetVmap, runTargetMmap } = require('./adt-server-extractors');
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

function getUiOutputRoot() {
  return path.join(app.getAppPath(), 'output');
}

function decodeTextBuffer(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buf.length - 2);
    for (let i = 2; i < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }
  return buf.toString('utf8').replace(/^ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¯ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¿/, '');
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Force custom taskbar icon in dev mode (Windows)
app.setAppUserModelId('com.azeroth.editor');

let mainWindow;
let spellLookupWindow;
let spellLookupQuery = '';
const lookupWindows = new Map();
let dbConnection = null;
let activeAtomicWrite = null;
let nextAtomicWriteId = 1;
let spellDbcCache = null;

registerDbcSqlIpc(ipcMain);
registerFileIpc(ipcMain);
registerServerIpc(ipcMain, () => mainWindow);

registerSystemIpc(ipcMain, {
  getBlpTextureCacheStats,
  getMpqMemoryCacheStats: () => getMpqReader().getMemoryCacheStats?.() || {},
});

registerDialogIpc(ipcMain, dialog, () => mainWindow);
registerGlueIpc(ipcMain, { getMpqReader, getOutputRoot: getUiOutputRoot });
registerCharSectionsIpc(ipcMain, { getMpqReader });

// DBC field offsets for Spell.dbc (WotLK 3.3.5a)
// Offset = MySQL column index 4 (each DBC field is 4 bytes)
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
  Totem_1:                  { offset: 228, type: 'uint32' },
  Totem_2:                  { offset: 232, type: 'uint32' },
  Reagent_1:                { offset: 236, type: 'uint32' },
  Reagent_2:                { offset: 240, type: 'uint32' },
  Reagent_3:                { offset: 244, type: 'uint32' },
  Reagent_4:                { offset: 248, type: 'uint32' },
  Reagent_5:                { offset: 252, type: 'uint32' },
  Reagent_6:                { offset: 256, type: 'uint32' },
  ReagentCount_1:           { offset: 260, type: 'uint32' },
  ReagentCount_2:           { offset: 264, type: 'uint32' },
  ReagentCount_3:           { offset: 268, type: 'uint32' },
  ReagentCount_4:           { offset: 272, type: 'uint32' },
  ReagentCount_5:           { offset: 276, type: 'uint32' },
  ReagentCount_6:           { offset: 280, type: 'uint32' },
  Effect_1:                 { offset: 284, type: 'uint32' },
  Effect_2:                 { offset: 288, type: 'uint32' },
  Effect_3:                 { offset: 292, type: 'uint32' },
  EffectDieSides_1:         { offset: 296, type: 'int32'  },
  EffectDieSides_2:         { offset: 300, type: 'int32'  },
  EffectDieSides_3:         { offset: 304, type: 'int32'  },
  EffectRealPointsPerLevel_1: { offset: 308, type: 'float' },
  EffectRealPointsPerLevel_2: { offset: 312, type: 'float' },
  EffectRealPointsPerLevel_3: { offset: 316, type: 'float' },
  EffectBasePoints_1:       { offset: 320, type: 'int32'  },
  EffectBasePoints_2:       { offset: 324, type: 'int32'  },
  EffectBasePoints_3:       { offset: 328, type: 'int32'  },
  EffectAura_1:             { offset: 380, type: 'uint32' },
  EffectAura_2:             { offset: 384, type: 'uint32' },
  EffectAura_3:             { offset: 388, type: 'uint32' },
  EffectMiscValue_1:        { offset: 428, type: 'uint32' },
  EffectMiscValue_2:        { offset: 432, type: 'uint32' },
  EffectMiscValue_3:        { offset: 436, type: 'uint32' },
  EffectTriggerSpell_1:     { offset: 464, type: 'uint32' },
  EffectTriggerSpell_2:     { offset: 468, type: 'uint32' },
  EffectTriggerSpell_3:     { offset: 472, type: 'uint32' },
  SpellVisualID_1:          { offset: 524, type: 'uint32' },
  SpellVisualID_2:          { offset: 528, type: 'uint32' },
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

const SPELL_ALL_STRING_OFFSETS = [
  544, 548, 552, 556, 560, 564, 568, 572,
  612, 616, 620, 624, 628, 632, 636, 640,
  680, 684, 688, 692, 696, 700, 704, 708,
  748, 752, 756, 760, 764, 768, 772, 776,
];

// Config persistence
function getConfigPath() {
  return getEditorConfigPath(app);
}

const blpTextureCache = new Map();

function blpCacheKey(value) {
  return String(value || '').replace(/\//g, '\\').toLowerCase();
}

function getBlpTextureCacheStats() {
  let rgbaBytes = 0;
  let pngBase64Chars = 0;
  for (const entry of blpTextureCache.values()) {
    rgbaBytes += entry?.textureRgba?.byteLength || 0;
    pngBase64Chars += entry?.pngBase64?.length || 0;
  }
  return {
    entries: blpTextureCache.size,
    rgbaBytes,
    pngBase64Chars,
    estimatedBytes: rgbaBytes + pngBase64Chars,
  };
}

function getM2DataPath() {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) return null;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const dataPath = cfg.worldmapMpqPath;
  if (!dataPath || !getMpqReader().isDataPath(dataPath)) return null;
  return dataPath;
}

function parseDBC(buf) {
  if (!buf || buf.toString('ascii', 0, 4) !== 'WDBC') return null;
  const numRecords = buf.readUInt32LE(4);
  const recordSize = buf.readUInt32LE(12);
  const strBlockSize = buf.readUInt32LE(16);
  const dataStart = 20;
  const strStart = dataStart + numRecords * recordSize;
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

function dbcBuildIndex(dbc) {
  const map = new Map();
  for (let i = 0; i < dbc.numRecords; i++) {
    const off = dbc.dataStart + i * dbc.recordSize;
    map.set(dbc.buf.readUInt32LE(off), off);
  }
  return map;
}

function warmupM2Dbc(cfg) {
  if (!cfg?.worldmapMpqPath) return;
  const dp = cfg.worldmapMpqPath;
  setImmediate(() => {
    try {
      if (getMpqReader().isDataPath(dp)) {
        const warmup = m2Services?.getM2DbcData?.(dp);
        warmup?.catch(() => {});
      }
    } catch (_) {}
  });
}

registerConfigIpc(ipcMain, app, warmupM2Dbc);

// Window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    icon: path.join(__dirname, '../src/assets/icon.ico'),
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval';" +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://wowgaming.altervista.org https://code.jquery.com http://wow.zamimg.com https://wow.zamimg.com;" +
          "connect-src 'self' https://wowgaming.altervista.org http://wow.zamimg.com https://wow.zamimg.com https://cdn.jsdelivr.net ws://localhost:*;" +
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

function openLookupWindow(kind, title) {
  const existing = lookupWindows.get(kind);
  if (existing && !existing.isDestroyed()) return existing.focus();
  const win = new BrowserWindow({ width: 520, height: 680, minWidth: 380, minHeight: 420, parent: mainWindow, title, icon: path.join(__dirname, '../src/assets/icon.ico'), backgroundColor: '#0a0c10', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  lookupWindows.set(kind, win); win.setMenu(null); win.on('closed', () => lookupWindows.delete(kind));
  if (isDev) win.loadURL(`http://localhost:5173/#/${kind}-lookup`); else win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: `/${kind}-lookup` });
}

function openSpellLookupWindow(query = '') {
  spellLookupQuery = (typeof query === 'string' || typeof query === 'number') ? String(query) : '';
  if (spellLookupWindow && !spellLookupWindow.isDestroyed()) {
    spellLookupWindow.webContents.send('spell-lookup:query', spellLookupQuery);
    return spellLookupWindow.focus();
  }
  spellLookupWindow = new BrowserWindow({ width: 520, height: 680, minWidth: 380, minHeight: 420, parent: mainWindow, title: 'Spell Lookup', icon: path.join(__dirname, '../src/assets/icon.ico'), backgroundColor: '#0a0c10', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  spellLookupWindow.setMenu(null);
  spellLookupWindow.on('closed', () => { spellLookupWindow = null; });
  if (isDev) spellLookupWindow.loadURL('http://localhost:5173/#/spell-lookup'); else spellLookupWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/spell-lookup' });
}
ipcMain.handle('window:openSpellLookup', (_, query) => openSpellLookupWindow(query));
ipcMain.handle('window:openSpellEditor', (_, spellId) => {
  const id = Number(spellId);
  if (!Number.isInteger(id) || id <= 0) return { success: false, error: 'Invalid spell ID' };
  mainWindow?.webContents.send('app:openSpellEditor', id);
  mainWindow?.focus();
  return { success: true };
});

ipcMain.handle('window:getSpellLookupQuery', () => spellLookupQuery);
ipcMain.handle('clipboard:writeText', (_, value) => clipboard.writeText(String(value || '')));
app.whenReady().then(() => {
  createWindow();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'close' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, { type: 'separator' }, { label: 'Spell Lookup...', click: () => openSpellLookupWindow() }, { label: 'NPC Lookup...', click: () => openLookupWindow('npc', 'NPC Lookup') }, { label: 'Item Lookup...', click: () => openLookupWindow('item', 'Item Lookup') }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
    { role: 'help' },
  ]));
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// Database
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
    const [rows] = params.length ? await dbConnection.execute(sql, params) : await dbConnection.query(sql);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('atomic:begin', async (_, { dbcPath, files = [] } = {}) => {
  if (!dbConnection) return { success: false, error: 'Not connected' };
  if (activeAtomicWrite) return { success: false, error: 'Another atomic write is already in progress' };
  try {
    const safeFiles = [...new Set(files)].filter(name => typeof name === 'string' && name && path.basename(name) === name);
    if (safeFiles.length !== files.length) throw new Error('Invalid DBC backup filename');
    const snapshots = safeFiles.map(name => {
      const filePath = path.join(dbcPath, name);
      return { filePath, existed: fs.existsSync(filePath), data: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null };
    });
    await dbConnection.beginTransaction();
    const id = nextAtomicWriteId++;
    activeAtomicWrite = { id, snapshots };
    return { success: true, id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('atomic:commit', async (_, id) => {
  if (!activeAtomicWrite || activeAtomicWrite.id !== id) return { success: false, error: 'Atomic write session not found' };
  try {
    await dbConnection.commit();
    activeAtomicWrite = null;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('atomic:rollback', async (_, id) => {
  if (!activeAtomicWrite || activeAtomicWrite.id !== id) return { success: false, error: 'Atomic write session not found' };
  const session = activeAtomicWrite;
  activeAtomicWrite = null;
  const errors = [];
  try { await dbConnection.rollback(); } catch (err) { errors.push(`Database rollback failed: ${err.message}`); }
  for (const snapshot of session.snapshots) {
    try {
      if (snapshot.existed) fs.writeFileSync(snapshot.filePath, snapshot.data);
      else if (fs.existsSync(snapshot.filePath)) fs.unlinkSync(snapshot.filePath);
    } catch (err) { errors.push(`Could not restore ${path.basename(snapshot.filePath)}: ${err.message}`); }
  }
  return errors.length ? { success: false, error: errors.join(' | ') } : { success: true };
});
ipcMain.handle('db:disconnect', async () => {
  if (dbConnection) {
    await dbConnection.end();
    dbConnection = null;
  }
  return { success: true };
});

registerSoapIpc(ipcMain);

registerIconIpc(ipcMain, async (dataPath, iconPath) => {
  const result = await readBlpTextureFromSource(dataPath, iconPath);
  return result?.success ? `data:image/png;base64,${result.png}` : null;
});
registerTalentAssetIpc(ipcMain, async (dataPath, texturePath) => {
  const result = await readBlpTextureFromSource(dataPath, texturePath);
  return result?.success ? `data:image/png;base64,${result.png}` : null;
});

// Worldmap Tiles Loader
ipcMain.handle('worldmap:listZones', async (_, dataPath) => {
  try {
    if (dataPath && getMpqReader().isDataPath(dataPath)) {
      return await getMpqReader().listWorldmapZones(dataPath);
    }
 // Fallback: WORLDMAP-map
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
 // map: check op zone-submappen
    const items = fs.readdirSync(dataPath);
    const zoneCount = items.filter(item => {
      try { return fs.statSync(path.join(dataPath, item)).isDirectory(); } catch { return false; }
    }).length;
    if (zoneCount > 0) {
      return { success: true, type: 'directory', message: `${zoneCount} zone(s) gevonden (geÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â«xtraheerde map)`, count: zoneCount };
    }
    return { success: false, error: 'Geen MPQ bestanden of zone-mappen gevonden' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// DBC Reader
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

// Map.dbc and MapDifficulty.dbc are intentionally read/written as a small, fixed
// surface: existing difficulty records only; no map or difficulty mode creation.
ipcMain.handle('dbc:readDungeonMaps', async (_, dbcPath) => {
  try {
    const [maps, difficulties] = await Promise.all([
      readDbcFile(path.join(dbcPath, 'Map.dbc')),
      readDbcFile(path.join(dbcPath, 'MapDifficulty.dbc')),
    ]);
    if (!maps || !difficulties) throw new Error('Map.dbc or MapDifficulty.dbc could not be read');
    const rows = [];
    for (let i = 0; i < maps.recordCount; i++) {
      const off = i * maps.recordSize;
      const id = maps.dataBuffer.readUInt32LE(off);
      const type = maps.dataBuffer.readUInt32LE(off + 8);
      if (type !== 1 && type !== 2) continue; // party dungeon / raid
      rows.push({ id, directory: readStringFromBlock(maps.dataBuffer, maps.dataBuffer.readUInt32LE(off + 4), maps.stringBlock), type,
        name: readStringFromBlock(maps.dataBuffer, maps.dataBuffer.readUInt32LE(off + 20), maps.stringBlock), areaTableId: maps.dataBuffer.readUInt32LE(off + 88),
        expansion: maps.dataBuffer.readUInt32LE(off + 252), maxPlayers: maps.dataBuffer.readUInt32LE(off + 260) });
    }
    const diffRows = [];
    for (let i = 0; i < difficulties.recordCount; i++) {
      const off = i * difficulties.recordSize;
      diffRows.push({ id: difficulties.dataBuffer.readUInt32LE(off), mapId: difficulties.dataBuffer.readUInt32LE(off + 4),
        difficulty: difficulties.dataBuffer.readUInt32LE(off + 8), raidDuration: difficulties.dataBuffer.readUInt32LE(off + 80),
        maxPlayers: difficulties.dataBuffer.readUInt32LE(off + 84) });
    }
    return { success: true, data: { maps: rows, difficulties: diffRows } };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('dbc:writeMapDifficultyCap', async (_, dbcPath, payload = {}) => {
  try {
    const id = Number(payload.id), maxPlayers = Number(payload.maxPlayers);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 100) throw new Error('Player cap must be an integer from 1 to 100');
    const filePath = path.join(dbcPath, 'MapDifficulty.dbc'), raw = fs.readFileSync(filePath);
    if (raw.toString('ascii', 0, 4) !== 'WDBC') throw new Error('Invalid MapDifficulty.dbc');
    const count = raw.readUInt32LE(4), size = raw.readUInt32LE(12), header = 20;
    let index = -1;
    for (let i = 0; i < count; i++) if (raw.readUInt32LE(header + i * size) === id) { index = i; break; }
    if (index < 0) throw new Error('Existing MapDifficulty record not found');
    const next = Buffer.from(raw); next.writeUInt32LE(maxPlayers, header + index * size + 84);
    fs.writeFileSync(filePath, next);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

const MAP_DIFFICULTY_CUSTOM_ID_START = 10000;
const CUSTOM_HEROIC_PORTAL_ENTRY_START = 4000000;
const CUSTOM_HEROIC_PORTAL_COMMENT_PREFIX = 'Azeroth Editor custom heroic portal';
const RFC_PORTAL_POSITION = { x: 1815.207, y: -4429.847, z: -10.246, o: 5.184496 };
const RFC_PORTAL_DISPLAY_IDS = { normal: 8243, heroic: 8196, skull: 8197 };

ipcMain.handle('dbc:addMapDifficulty', async (_, dbcPath, payload = {}) => {
  try {
    const mapId = Number(payload.mapId), difficulty = Number(payload.difficulty), maxPlayers = Number(payload.maxPlayers);
    if (!Number.isInteger(mapId) || mapId < 0 || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 5 || !Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 100) throw new Error('Invalid map, difficulty or player cap');
    const filePath = path.join(dbcPath, 'MapDifficulty.dbc'), raw = fs.readFileSync(filePath);
    if (raw.toString('ascii', 0, 4) !== 'WDBC') throw new Error('Invalid MapDifficulty.dbc');
    const count = raw.readUInt32LE(4), size = raw.readUInt32LE(12), header = 20;
    if (size !== 92) throw new Error(`Unexpected MapDifficulty record size (${size})`);
    let maxId = MAP_DIFFICULTY_CUSTOM_ID_START - 1, source = null;
    for (let i = 0; i < count; i++) {
      const off = header + i * size, id = raw.readUInt32LE(off);
      maxId = Math.max(maxId, id);
      if (raw.readUInt32LE(off + 4) === mapId && raw.readUInt32LE(off + 8) === difficulty) throw new Error('This map already has that difficulty record');
      if (raw.readUInt32LE(off + 4) === mapId && raw.readUInt32LE(off + 8) === 0) source = off;
    }
    if (dbConnection) {
      const [tables] = await dbConnection.execute(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
        ['mapdifficulty_dbc']
      );
      if (tables.length) {
        const [[row]] = await dbConnection.execute('SELECT MAX(ID) AS maxId FROM mapdifficulty_dbc');
        maxId = Math.max(maxId, Number(row.maxId) || 0);
      }
    }
    const record = Buffer.alloc(size, 0);
    record.writeUInt32LE(maxId + 1, 0); record.writeUInt32LE(mapId, 4); record.writeUInt32LE(difficulty, 8);
    record.writeUInt32LE(source ? raw.readUInt32LE(source + 80) : 86400, 80); // copy normal reset time when present
    record.writeUInt32LE(maxPlayers, 84);
    const recordsEnd = header + count * size, next = Buffer.alloc(raw.length + size);
    raw.copy(next, 0, 0, recordsEnd); record.copy(next, recordsEnd); raw.copy(next, recordsEnd + size, recordsEnd);
    next.writeUInt32LE(count + 1, 4); fs.writeFileSync(filePath, next);
    return { success: true, id: maxId + 1 };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('dbc:deleteMapDifficulty', async (_, dbcPath, payload = {}) => {
  try {
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id < MAP_DIFFICULTY_CUSTOM_ID_START) throw new Error(`Only custom MapDifficulty records (${MAP_DIFFICULTY_CUSTOM_ID_START}+) can be deleted`);
    const filePath = path.join(dbcPath, 'MapDifficulty.dbc'), raw = fs.readFileSync(filePath);
    if (raw.toString('ascii', 0, 4) !== 'WDBC') throw new Error('Invalid MapDifficulty.dbc');
    const count = raw.readUInt32LE(4), size = raw.readUInt32LE(12), header = 20;
    let index = -1;
    for (let i = 0; i < count; i++) if (raw.readUInt32LE(header + i * size) === id) { index = i; break; }
    if (index < 0) throw new Error('Custom MapDifficulty record not found');
    const start = header + index * size, end = start + size, next = Buffer.alloc(raw.length - size);
    raw.copy(next, 0, 0, start); raw.copy(next, start, end);
    next.writeUInt32LE(count - 1, 4); fs.writeFileSync(filePath, next);
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

async function dungeonTableExists(name) {
  const [rows] = await dbConnection.execute(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
    [name]
  );
  return rows.length > 0;
}

ipcMain.handle('dungeons:readWorkspace', async (_, mapId) => {
  if (!dbConnection) return { success: false, error: 'Not connected' };
  try {
    const id = Number(mapId);
    const [[instanceRows], [teleports], [creatures], [objects], [questPois]] = await Promise.all([
      dbConnection.execute('SELECT map, parent, script, allowMount FROM instance_template WHERE map = ?', [id]),
      dbConnection.execute('SELECT * FROM areatrigger_teleport WHERE target_map = ? ORDER BY id', [id]),
      dbConnection.execute('SELECT c.guid, c.id1 AS entry, ct.name, ct.difficulty_entry_1, ct.difficulty_entry_2, ct.difficulty_entry_3, c.position_x, c.position_y, c.position_z, c.areaId FROM creature c LEFT JOIN creature_template ct ON ct.entry = c.id1 WHERE c.map = ? ORDER BY c.areaId, ct.name LIMIT 1000', [id]),
      dbConnection.execute('SELECT g.guid, g.id AS entry, gt.name, g.position_x, g.position_y, g.position_z, g.areaId FROM gameobject g LEFT JOIN gameobject_template gt ON gt.entry = g.id WHERE g.map = ? ORDER BY g.areaId, gt.name LIMIT 1000', [id]),
      dbConnection.execute('SELECT DISTINCT q.ID, q.LogTitle FROM quest_poi p JOIN quest_template q ON q.ID = p.QuestID WHERE p.MapID = ? ORDER BY q.ID LIMIT 500', [id]),
    ]);
    let access = { available: false, templates: [], requirements: [], error: 'Access tables are not installed.' };
    if (await dungeonTableExists('dungeon_access_template') && await dungeonTableExists('dungeon_access_requirements')) {
      const [templates] = await dbConnection.execute('SELECT * FROM dungeon_access_template WHERE map_id = ? ORDER BY difficulty, id', [id]);
      const ids = templates.map(row => row.id);
      const [requirements] = ids.length ? await dbConnection.query(`SELECT * FROM dungeon_access_requirements WHERE dungeon_access_id IN (${ids.map(() => '?').join(',')}) ORDER BY dungeon_access_id, priority, requirement_type, requirement_id`, ids) : [[]];
      access = { available: true, templates, requirements };
    }
    return { success: true, data: { instance: instanceRows[0] || null, teleports, creatures, objects, questPois, access } };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('dungeons:saveAccess', async (_, payload = {}) => {
  if (!dbConnection) return { success: false, error: 'Not connected' };
  try {
    if (!await dungeonTableExists('dungeon_access_template') || !await dungeonTableExists('dungeon_access_requirements')) throw new Error('Access tables are missing. Expected dungeon_access_template and dungeon_access_requirements.');
    const t = payload.template || {}, mapId = Number(payload.mapId), difficulty = Number(t.difficulty);
    if (!Number.isInteger(mapId) || !Number.isInteger(difficulty)) throw new Error('Map and difficulty are required');
    const templateValues = [mapId, difficulty, Number(t.min_level) || 0, Number(t.max_level) || 0, Number(t.min_avg_item_level) || 0, String(t.comment || '')];
    let accessId = Number(t.id) || 0;
    if (accessId) await dbConnection.execute('UPDATE dungeon_access_template SET difficulty=?, min_level=?, max_level=?, min_avg_item_level=?, comment=? WHERE id=? AND map_id=?', [...templateValues.slice(1), accessId, mapId]);
    else { const [result] = await dbConnection.execute('INSERT INTO dungeon_access_template (map_id, difficulty, min_level, max_level, min_avg_item_level, comment) VALUES (?, ?, ?, ?, ?, ?)', templateValues); accessId = result.insertId; }
    await dbConnection.execute('DELETE FROM dungeon_access_requirements WHERE dungeon_access_id = ?', [accessId]);
    for (const r of (payload.requirements || [])) {
      const type = Number(r.requirement_type), faction = Number(r.faction);
      if (!Number.isInteger(type) || type < 0 || type > 2 || !Number(r.requirement_id) || !Number.isInteger(faction) || faction < 0 || faction > 2) throw new Error('Each requirement needs a valid type, ID and faction');
      await dbConnection.execute('INSERT INTO dungeon_access_requirements (dungeon_access_id, requirement_type, requirement_id, requirement_note, faction, priority, leader_only, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [accessId, type, Number(r.requirement_id), String(r.requirement_note || ''), faction, Number(r.priority) || 0, r.leader_only ? 1 : 0, String(r.comment || '')]);
    }
    return { success: true, id: accessId };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('dungeons:deleteAccess', async (_, id) => {
  if (!dbConnection) return { success: false, error: 'Not connected' };
  try { await dbConnection.execute('DELETE FROM dungeon_access_requirements WHERE dungeon_access_id = ?', [Number(id)]); await dbConnection.execute('DELETE FROM dungeon_access_template WHERE id = ?', [Number(id)]); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('dungeons:setCustomHeroicCreatureSpawns', async (_, payload = {}) => {
  if (!dbConnection) return { success: false, error: 'Not connected' };
  try {
    const mapId = Number(payload.mapId), enabled = Boolean(payload.enabled);
    if (!Number.isInteger(mapId) || mapId <= 0) throw new Error('A valid map ID is required');
    await dbConnection.beginTransaction();
    const [creatures] = await dbConnection.execute('UPDATE creature SET spawnMask = ? WHERE map = ? AND spawnMask = ?', [enabled ? 3 : 1, mapId, enabled ? 1 : 3]);
    const [objects] = await dbConnection.execute('UPDATE gameobject SET spawnMask = ? WHERE map = ? AND spawnMask = ?', [enabled ? 3 : 1, mapId, enabled ? 1 : 3]);
    await dbConnection.commit();
    return { success: true, creatures: creatures.affectedRows, gameobjects: objects.affectedRows };
  } catch (err) { try { await dbConnection.rollback(); } catch {} return { success: false, error: err.message }; }
});

ipcMain.handle('dungeons:resolveHeroicPortal', async (_, payload = {}) => {
  if (!dbConnection) return { success: false, error: 'Not connected' };
  try {
    const result = await resolveHeroicPortalTransform({
      dbConnection,
      mpqReader: getMpqReader(),
      dataPath: payload.dataPath,
      mapId: Number(payload.mapId),
      mapDirectory: payload.mapDirectory,
      expansion: Number(payload.expansion) || 0,
    });
    return { success: true, ...result };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('dungeons:setCustomHeroicPortal', async (_, payload = {}) => {
  if (!dbConnection) return { success: false, error: 'Not connected' };
  try {
    const mapId = Number(payload.mapId), enabled = Boolean(payload.enabled);
    const comment = `${CUSTOM_HEROIC_PORTAL_COMMENT_PREFIX} for map ${mapId}`;
    const nameLike = `Azeroth Editor: Heroic Portal ${mapId}%`;
    const portalTransform = payload.portalTransform || (mapId === 389 ? RFC_PORTAL_POSITION : null);
    if (enabled && !portalTransform) return { success: true, created: false, removed: false, reason: 'No portal transform was found.' };
    await dbConnection.beginTransaction();
    if (!enabled) {
      const [spawns] = await dbConnection.execute('SELECT g.guid, g.id FROM gameobject g JOIN gameobject_template gt ON gt.entry = g.id WHERE g.Comment = ? OR gt.name LIKE ?', [comment, nameLike]);
      const entries = [...new Set(spawns.map(row => Number(row.id)))];
      const guids = spawns.map(row => Number(row.guid)).filter(Number.isInteger);
      const [deleted] = guids.length
        ? await dbConnection.execute(`DELETE FROM gameobject WHERE guid IN (${guids.map(() => '?').join(',')})`, guids)
        : [{ affectedRows: 0 }];
      for (const entry of entries) {
        const [[usage]] = await dbConnection.execute('SELECT COUNT(*) AS count FROM gameobject WHERE id = ?', [entry]);
        if (!Number(usage.count)) await dbConnection.execute('DELETE FROM gameobject_template WHERE entry = ? AND name LIKE ?', [entry, 'Azeroth Editor: Heroic Portal%']);
      }
      await dbConnection.commit();
      return { success: true, removed: deleted.affectedRows };
    }
    const [existing] = await dbConnection.execute(
      'SELECT g.guid, g.id, g.position_x, g.position_y, g.position_z, g.orientation, g.phaseMask, gt.Data1, gt.size FROM gameobject g JOIN gameobject_template gt ON gt.entry = g.id WHERE g.Comment = ? OR gt.name LIKE ? ORDER BY gt.Data1, g.guid',
      [comment, nameLike]
    );
    const nextEntry = async () => {
      const entryStart = Math.max(1, Number(payload.entryStart) || CUSTOM_HEROIC_PORTAL_ENTRY_START);
      const [rows] = await dbConnection.execute('SELECT entry FROM gameobject_template WHERE entry >= ? ORDER BY entry', [entryStart]);
      const used = new Set(rows.map(row => Number(row.entry)));
      let entry = entryStart;
      while (used.has(entry)) entry++;
      return entry;
    };
    const base = existing[0] || portalTransform;
    const p = { x: Number(base.position_x ?? base.x), y: Number(base.position_y ?? base.y), z: Number(base.position_z ?? base.z), o: Number(base.orientation ?? base.o) };
    const sourceMapId = Number(portalTransform.mapId ?? payload.sourceMapId ?? 1);
    const sourceZoneId = Number(portalTransform.zoneId ?? payload.sourceZoneId ?? 0);
    const sourceAreaId = Number(portalTransform.areaId ?? payload.sourceAreaId ?? 0);
    const rotation2 = Math.sin(p.o / 2), rotation3 = Math.cos(p.o / 2);
    let normal = existing.find(row => Number(row.Data1) === 0) || existing[0] || null;
    let heroic = existing.find(row => Number(row.Data1) === 1 && row.guid !== normal?.guid) || existing.find(row => row.guid !== normal?.guid) || null;
    let skull = existing.find(row => Number(row.Data1) === 2) || null;
    let normalEntry = Number(normal?.id) || 0;
    let heroicEntry = Number(heroic?.id) || 0;
    let skullEntry = Number(skull?.id) || 0;
    const size = Math.max(0.01, Number(normal?.size || heroic?.size || portalTransform.scale || 1.23));

    if (!normal) {
      normalEntry = await nextEntry();
      await dbConnection.execute('INSERT INTO gameobject_template (entry, type, displayId, name, size, Data0, Data1, VerifiedBuild) VALUES (?, 31, ?, ?, ?, ?, 0, NULL)', [normalEntry, RFC_PORTAL_DISPLAY_IDS.normal, `Azeroth Editor: Heroic Portal ${mapId} Normal`, size, mapId]);
    } else {
      await dbConnection.execute('UPDATE gameobject_template SET displayId=?, name=?, size=? WHERE entry=?', [RFC_PORTAL_DISPLAY_IDS.normal, `Azeroth Editor: Heroic Portal ${mapId} Normal`, size, normalEntry]);
    }
    if (!heroic) {
      heroicEntry = await nextEntry();
      await dbConnection.execute('INSERT INTO gameobject_template (entry, type, displayId, name, size, Data0, Data1, VerifiedBuild) VALUES (?, 31, ?, ?, ?, ?, 1, NULL)', [heroicEntry, RFC_PORTAL_DISPLAY_IDS.heroic, `Azeroth Editor: Heroic Portal ${mapId}`, size, mapId]);
    } else {
      await dbConnection.execute('UPDATE gameobject_template SET displayId=?, name=?, size=? WHERE entry=?', [RFC_PORTAL_DISPLAY_IDS.heroic, `Azeroth Editor: Heroic Portal ${mapId}`, size, heroicEntry]);
    }
    if (!skull) {
      skullEntry = await nextEntry();
      await dbConnection.execute('INSERT INTO gameobject_template (entry, type, displayId, name, size, Data0, Data1, VerifiedBuild) VALUES (?, 31, ?, ?, ?, ?, 2, NULL)', [skullEntry, RFC_PORTAL_DISPLAY_IDS.skull, `Azeroth Editor: Heroic Portal ${mapId} Skull`, size, mapId]);
    } else {
      await dbConnection.execute('UPDATE gameobject_template SET displayId=?, name=?, size=? WHERE entry=?', [RFC_PORTAL_DISPLAY_IDS.skull, `Azeroth Editor: Heroic Portal ${mapId} Skull`, size, skullEntry]);
    }
    const spawnValues = [p.x, p.y, p.z, p.o, rotation2, rotation3, comment];
    if (normal) await dbConnection.execute('UPDATE gameobject SET spawnMask=1, position_x=?, position_y=?, position_z=?, orientation=?, rotation0=0, rotation1=0, rotation2=?, rotation3=?, Comment=? WHERE guid=?', [...spawnValues.slice(0, 6), comment, normal.guid]);
    else await dbConnection.execute('INSERT INTO gameobject (id, map, zoneId, areaId, spawnMask, phaseMask, position_x, position_y, position_z, orientation, rotation0, rotation1, rotation2, rotation3, spawntimesecs, animprogress, state, ScriptName, VerifiedBuild, Comment) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, 0, 0, ?, ?, 120, 100, 1, \'\', NULL, ?)', [normalEntry, sourceMapId, sourceZoneId, sourceAreaId, ...spawnValues]);
    if (heroic) await dbConnection.execute('UPDATE gameobject SET spawnMask=2, position_x=?, position_y=?, position_z=?, orientation=?, rotation0=0, rotation1=0, rotation2=?, rotation3=?, Comment=? WHERE guid=?', [...spawnValues.slice(0, 6), comment, heroic.guid]);
    else await dbConnection.execute('INSERT INTO gameobject (id, map, zoneId, areaId, spawnMask, phaseMask, position_x, position_y, position_z, orientation, rotation0, rotation1, rotation2, rotation3, spawntimesecs, animprogress, state, ScriptName, VerifiedBuild, Comment) VALUES (?, ?, ?, ?, 2, 1, ?, ?, ?, ?, 0, 0, ?, ?, 120, 100, 1, \'\', NULL, ?)', [heroicEntry, sourceMapId, sourceZoneId, sourceAreaId, ...spawnValues]);
    if (skull) await dbConnection.execute('UPDATE gameobject SET spawnMask=2, position_x=?, position_y=?, position_z=?, orientation=?, rotation0=0, rotation1=0, rotation2=?, rotation3=?, Comment=? WHERE guid=?', [...spawnValues.slice(0, 6), comment, skull.guid]);
    else await dbConnection.execute('INSERT INTO gameobject (id, map, zoneId, areaId, spawnMask, phaseMask, position_x, position_y, position_z, orientation, rotation0, rotation1, rotation2, rotation3, spawntimesecs, animprogress, state, ScriptName, VerifiedBuild, Comment) VALUES (?, ?, ?, ?, 2, 1, ?, ?, ?, ?, 0, 0, ?, ?, 120, 100, 1, \'\', NULL, ?)', [skullEntry, sourceMapId, sourceZoneId, sourceAreaId, ...spawnValues]);
    await dbConnection.commit();
    return { success: true, created: !existing.length, existing: !!existing.length, repaired: !!existing.length, source: portalTransform.source || 'fallback', entries: [normalEntry, heroicEntry, skullEntry] };
  } catch (err) { try { await dbConnection.rollback(); } catch {} return { success: false, error: err.message }; }
});

ipcMain.handle('dbc:readQuestSorts', async (_, dbcPath) => {
  try {
    const dbc = await readDbcFile(path.join(dbcPath, 'QuestSort.dbc'));
    if (!dbc) throw new Error('QuestSort.dbc unavailable');
    const sorts = [];
    for (let i = 0; i < dbc.recordCount; i++) {
      const offset = i * dbc.recordSize;
      const id = readUInt32LE(dbc.dataBuffer, offset);
      const name = getString(dbc.stringBlock, readUInt32LE(dbc.dataBuffer, offset + 4));
      if (id && name) sorts.push({ id, name });
    }
    return { success: true, sorts };
  } catch (e) { return { success: false, error: e.message }; }
});

async function loadSpellDbc(dbcPath) {
  const filePath = path.join(dbcPath, 'Spell.dbc');
  if (spellDbcCache?.filePath === filePath) return spellDbcCache.dbc;
  const dbc = await readDbcFile(filePath);
  if (dbc) spellDbcCache = { filePath, dbc };
  return dbc;
}

function dbcStringAt(dbc, row, fieldIndex) {
  return getString(dbc.stringBlock, Math.max(0, Number(row[fieldIndex]) || 0));
}

function summarizeAchievementCriterion(criterion) {
  const bits = [];
  if (criterion.quantity) bits.push('x' + criterion.quantity);
  if (criterion.asset1) bits.push('A1 ' + criterion.asset1);
  if (criterion.asset2) bits.push('A2 ' + criterion.asset2);
  if (criterion.asset3) bits.push('A3 ' + criterion.asset3);
  if (criterion.asset4) bits.push('A4 ' + criterion.asset4);

  switch (criterion.type) {
    case 5:
      return 'Reach level ' + (criterion.asset2 || criterion.asset1 || criterion.quantity || 0);
    default:
      return bits.length ? ('Type ' + criterion.type + ' - ' + bits.join(' - ')) : ('Type ' + criterion.type);
  }
}

ipcMain.handle('dbc:readAchievementsOverview', async (_, dbcPath) => {
  try {
    const achievementBuffer = fs.readFileSync(path.join(dbcPath, 'Achievement.dbc'));
    const criteriaBuffer = fs.readFileSync(path.join(dbcPath, 'Achievement_Criteria.dbc'));
    const categoryBuffer = fs.readFileSync(path.join(dbcPath, 'Achievement_Category.dbc'));

    const achievementsDbc = parseDbc(achievementBuffer);
    const criteriaDbc = parseDbc(criteriaBuffer);
    const categoriesDbc = parseDbc(categoryBuffer);

    const categories = categoriesDbc.records.map((row) => ({
      id: Number(row[0]) || 0,
      parentId: Number(row[1]) || -1,
      name: dbcStringAt(categoriesDbc, row, 2),
      sortOrder: Number(row[19]) || 0,
    }));

    const criteriaByAchievement = new Map();
    for (const row of criteriaDbc.records) {
      const criterion = {
        id: Number(row[0]) || 0,
        achievementId: Number(row[1]) || 0,
        type: Number(row[2]) || 0,
        asset1: Number(row[3]) || 0,
        asset2: Number(row[4]) || 0,
        asset3: Number(row[5]) || 0,
        asset4: Number(row[6]) || 0,
        quantity: Number(row[7]) || 0,
        startEvent: Number(row[8]) || 0,
        startAsset: Number(row[9]) || 0,
        failEvent: Number(row[10]) || 0,
        failAsset: Number(row[11]) || 0,
        description: dbcStringAt(criteriaDbc, row, 12),
        flags: Number(row[29]) || 0,
        orderIndex: Number(row[30]) || 0,
      };
      criterion.summary = summarizeAchievementCriterion(criterion);
      if (!criteriaByAchievement.has(criterion.achievementId)) criteriaByAchievement.set(criterion.achievementId, []);
      criteriaByAchievement.get(criterion.achievementId).push(criterion);
    }

    const achievements = achievementsDbc.records.map((row) => {
      const id = Number(row[0]) || 0;
      const criteria = (criteriaByAchievement.get(id) || []).sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id);
      return {
        id,
        faction: Number(row[1]) || 0,
        mapId: Number(row[2]) || 0,
        previousAchievementId: Number(row[3]) || 0,
        name: dbcStringAt(achievementsDbc, row, 4),
        description: dbcStringAt(achievementsDbc, row, 21),
        categoryId: Number(row[38]) || 0,
        points: Number(row[39]) || 0,
        orderInCategory: Number(row[40]) || 0,
        flags: Number(row[41]) || 0,
        iconId: Number(row[42]) || 0,
        reward: dbcStringAt(achievementsDbc, row, 43),
        minimumCriteria: Number(row[60]) || 0,
        sharesCriteria: Number(row[61]) || 0,
        criteriaCount: criteria.length,
        criteria,
      };
    });

    return {
      success: true,
      data: {
        achievements,
        categories,
        stats: {
          achievementCount: achievements.length,
          criteriaCount: criteriaDbc.records.length,
          categoryCount: categories.length,
        },
      },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});


function createDbcStringAppender(existingStringBlock) {
  const parts = [Buffer.from(existingStringBlock || Buffer.alloc(0))];
  let offset = existingStringBlock?.length || 0;
  return {
    append(value) {
      const normalized = String(value || '');
      if (!normalized) return 0;
      const buf = Buffer.from(normalized + '\0', 'utf8');
      const at = offset;
      parts.push(buf);
      offset += buf.length;
      return at;
    },
    build() {
      return Buffer.concat(parts);
    },
  };
}

function rebuildDbcBuffer(raw, records, stringBlock) {
  const fieldCount = raw.readUInt32LE(8);
  const recordSize = raw.readUInt32LE(12);
  const headerSize = 20;
  const block = Buffer.isBuffer(stringBlock) ? stringBlock : Buffer.from(stringBlock || Buffer.alloc(0));
  const out = Buffer.alloc(headerSize + records.length * recordSize + block.length);
  raw.copy(out, 0, 0, headerSize);
  out.writeUInt32LE(records.length, 4);
  out.writeUInt32LE(fieldCount, 8);
  out.writeUInt32LE(recordSize, 12);
  out.writeUInt32LE(block.length, 16);
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    for (let j = 0; j < fieldCount; j++) {
      out.writeInt32LE(Number(row[j] || 0), headerSize + i * recordSize + j * 4);
    }
  }
  block.copy(out, headerSize + records.length * recordSize);
  return out;
}

function sanitizeAchievementInput(achievement) {
  return {
    id: Number(achievement?.id) || 0,
    faction: Number(achievement?.faction) || 0,
    mapId: Number(achievement?.mapId) || 0,
    previousAchievementId: Number(achievement?.previousAchievementId) || 0,
    name: String(achievement?.name || ''),
    description: String(achievement?.description || ''),
    categoryId: Number(achievement?.categoryId) || 0,
    points: Number(achievement?.points) || 0,
    orderInCategory: Number(achievement?.orderInCategory) || 0,
    flags: Number(achievement?.flags) || 0,
    iconId: Number(achievement?.iconId) || 0,
    reward: String(achievement?.reward || ''),
    minimumCriteria: Number(achievement?.minimumCriteria) || 0,
    sharesCriteria: Number(achievement?.sharesCriteria) || 0,
  };
}

function sanitizeCriterionInput(criterion, achievementId) {
  return {
    id: Number(criterion?.id) || 0,
    achievementId: Number(achievementId) || 0,
    type: Number(criterion?.type) || 0,
    asset1: Number(criterion?.asset1) || 0,
    asset2: Number(criterion?.asset2) || 0,
    asset3: Number(criterion?.asset3) || 0,
    asset4: Number(criterion?.asset4) || 0,
    quantity: Number(criterion?.quantity) || 0,
    startEvent: Number(criterion?.startEvent) || 0,
    startAsset: Number(criterion?.startAsset) || 0,
    failEvent: Number(criterion?.failEvent) || 0,
    failAsset: Number(criterion?.failAsset) || 0,
    description: String(criterion?.description || ''),
    flags: Number(criterion?.flags) || 0,
    orderIndex: Number(criterion?.orderIndex) || 0,
  };
}

ipcMain.handle('dbc:writeAchievement', async (_, dbcPath, achievementInput) => {
  try {
    const filePath = path.join(dbcPath, 'Achievement.dbc');
    const raw = fs.readFileSync(filePath);
    const dbc = parseDbc(raw);
    const achievement = sanitizeAchievementInput(achievementInput);
    const rowIndex = dbc.records.findIndex((row) => Number(row[0]) === achievement.id);
    if (rowIndex === -1) return { success: false, error: 'Achievement ' + achievement.id + ' niet gevonden' };

    const rows = dbc.records.map((row) => row.slice());
    const row = rows[rowIndex];
    const strings = createDbcStringAppender(dbc.stringBlock);

    row[1] = achievement.faction;
    row[2] = achievement.mapId;
    row[3] = achievement.previousAchievementId;
    row[4] = strings.append(achievement.name);
    row[21] = strings.append(achievement.description);
    row[38] = achievement.categoryId;
    row[39] = achievement.points;
    row[40] = achievement.orderInCategory;
    row[41] = achievement.flags;
    row[42] = achievement.iconId;
    row[43] = strings.append(achievement.reward);
    row[60] = achievement.minimumCriteria;
    row[61] = achievement.sharesCriteria;

    fs.writeFileSync(filePath, rebuildDbcBuffer(raw, rows, strings.build()));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:writeAchievementCriteria', async (_, dbcPath, achievementIdInput, criteriaInput) => {
  try {
    const filePath = path.join(dbcPath, 'Achievement_Criteria.dbc');
    const raw = fs.readFileSync(filePath);
    const dbc = parseDbc(raw);
    const achievementId = Number(achievementIdInput) || 0;
    const criteria = Array.isArray(criteriaInput) ? criteriaInput.map((entry) => sanitizeCriterionInput(entry, achievementId)) : [];
    const remaining = dbc.records.filter((row) => Number(row[1]) !== achievementId).map((row) => row.slice());
    const strings = createDbcStringAppender(dbc.stringBlock);
    const fieldCount = dbc.fieldCount;
    let nextId = dbc.records.reduce((max, row) => Math.max(max, Number(row[0]) || 0), 0) + 1;

    const existingById = new Map(dbc.records.map((row) => [Number(row[0]) || 0, row]));
    const newRows = criteria
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex || a.id - b.id)
      .map((criterion) => {
        const row = (existingById.get(criterion.id) || Array(fieldCount).fill(0)).slice();
        row[0] = criterion.id > 0 ? criterion.id : nextId++;
        row[1] = achievementId;
        row[2] = criterion.type;
        row[3] = criterion.asset1;
        row[4] = criterion.asset2;
        row[5] = criterion.asset3;
        row[6] = criterion.asset4;
        row[7] = criterion.quantity;
        row[8] = criterion.startEvent;
        row[9] = criterion.startAsset;
        row[10] = criterion.failEvent;
        row[11] = criterion.failAsset;
        row[12] = strings.append(criterion.description);
        row[29] = criterion.flags;
        row[30] = criterion.orderIndex;
        return row;
      });

    const finalRows = remaining.concat(newRows).sort((a, b) => (Number(a[1]) - Number(b[1])) || (Number(a[30]) - Number(b[30])) || (Number(a[0]) - Number(b[0])));
    fs.writeFileSync(filePath, rebuildDbcBuffer(raw, finalRows, strings.build()));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:createAchievement', async (_, dbcPath, payload = {}) => {
  try {
    const achievementPath = path.join(dbcPath, 'Achievement.dbc');
    const raw = fs.readFileSync(achievementPath);
    const dbc = parseDbc(raw);
    const rows = dbc.records.map((row) => row.slice());
    const strings = createDbcStringAppender(dbc.stringBlock);
    const startId = Number(payload.startId) || 4000000;
    const usedIds = new Set(rows.map((row) => Number(row[0]) || 0));
    let newId = startId;
    while (usedIds.has(newId)) newId += 1;
    const template = Array(dbc.fieldCount).fill(0);
    const categoryId = Number(payload.categoryId) || 0;
    const baseName = String(payload.name || ('New Achievement ' + newId));
    template[0] = newId;
    template[1] = Number(payload.faction) || -1;
    template[2] = Number(payload.mapId) || 0;
    template[3] = Number(payload.previousAchievementId) || 0;
    template[4] = strings.append(baseName);
    template[21] = strings.append(String(payload.description || ''));
    template[38] = categoryId;
    template[39] = Number(payload.points) || 0;
    template[40] = Number(payload.orderInCategory) || 0;
    template[41] = Number(payload.flags) || 0;
    template[42] = Number(payload.iconId) || 0;
    template[43] = strings.append(String(payload.reward || ''));
    template[60] = Number(payload.minimumCriteria) || 0;
    template[61] = Number(payload.sharesCriteria) || 0;
    rows.push(template);
    fs.writeFileSync(achievementPath, rebuildDbcBuffer(raw, rows, strings.build()));
    return { success: true, id: newId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:deleteAchievement', async (_, dbcPath, achievementIdInput) => {
  try {
    const achievementId = Number(achievementIdInput) || 0;
    const achievementPath = path.join(dbcPath, 'Achievement.dbc');
    const criteriaPath = path.join(dbcPath, 'Achievement_Criteria.dbc');

    const achievementRaw = fs.readFileSync(achievementPath);
    const achievementDbc = parseDbc(achievementRaw);
    const achievementRows = achievementDbc.records.filter((row) => Number(row[0]) !== achievementId).map((row) => row.slice());
    if (achievementRows.length === achievementDbc.records.length) return { success: false, error: 'Achievement niet gevonden' };

    const criteriaRaw = fs.readFileSync(criteriaPath);
    const criteriaDbc = parseDbc(criteriaRaw);
    const deletedCriteria = criteriaDbc.records.filter((row) => Number(row[1]) === achievementId).length;
    const criteriaRows = criteriaDbc.records.filter((row) => Number(row[1]) !== achievementId).map((row) => row.slice());

    fs.writeFileSync(achievementPath, rebuildDbcBuffer(achievementRaw, achievementRows, achievementDbc.stringBlock));
    fs.writeFileSync(criteriaPath, rebuildDbcBuffer(criteriaRaw, criteriaRows, criteriaDbc.stringBlock));
    return { success: true, deletedCriteria };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// SkillLineAbility.dbc: fields per record (recordSize read from header)
// Offsets: ID(0), SkillLine(4), Spell(8), RaceMask(12), ClassMask(16),
// ExcludeRace(20), ExcludeClass(24), MinSkillLineRank(28),
// SupercededBySpell(32), AcquireMethod(36), TrivialSkillLineRankLow(40),
// TrivialSkillLineRankHigh(44), ...
ipcMain.handle('dbc:readSkillLineAbility', async (_, dbcPath, spellId) => {
  try {
    const filePath = path.join(dbcPath, 'SkillLineAbility.dbc');
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: false, error: 'Kon SkillLineAbility.dbc niet lezen' };
    const results = [];
    for (let i = 0; i < dbc.recordCount; i++) {
      const off = i * dbc.recordSize;
      if (dbc.dataBuffer.readUInt32LE(off + 8) === spellId) {
        results.push({
          ID: dbc.dataBuffer.readUInt32LE(off),
          SkillLine: dbc.dataBuffer.readUInt32LE(off + 4),
          Spell: dbc.dataBuffer.readUInt32LE(off + 8),
          RaceMask: dbc.dataBuffer.readUInt32LE(off + 12),
          ClassMask: dbc.dataBuffer.readUInt32LE(off + 16),
          SupercededBySpell: dbc.dataBuffer.readUInt32LE(off + 32),
          AcquireMethod: dbc.dataBuffer.readUInt32LE(off + 36),
          TrivialSkillLineRankLow: dbc.dataBuffer.readUInt32LE(off + 40),
        });
      }
    }
    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:readSkillLineTree', async (_, dbcPath, opts = {}) => {
  try {
    const abilityDbc = await readDbcFile(path.join(dbcPath, 'SkillLineAbility.dbc'));
    const skillLineDbc = await readDbcFile(path.join(dbcPath, 'SkillLine.dbc'));
    const categoryDbc = await readDbcFile(path.join(dbcPath, 'SkillLineCategory.dbc'));
    if (!abilityDbc || !skillLineDbc || !categoryDbc) {
      return { success: false, error: 'Kon SkillLine DBC bestanden niet lezen' };
    }

    const spellIds = new Set((opts.spellIds || []).map(Number).filter(Boolean));
    const raceMask = Number(opts.raceMask) || 0;
    const classMask = Number(opts.classMask) || 0;

    const categoriesById = new Map();
    for (let i = 0; i < categoryDbc.recordCount; i++) {
      const off = i * categoryDbc.recordSize;
      const id = categoryDbc.dataBuffer.readUInt32LE(off);
      const name = getString(categoryDbc.stringBlock, categoryDbc.dataBuffer.readUInt32LE(off + 4)) || `Category ${id}`;
      categoriesById.set(id, { id, name });
    }

    const skillLinesById = new Map();
    for (let i = 0; i < skillLineDbc.recordCount; i++) {
      const off = i * skillLineDbc.recordSize;
      const id = skillLineDbc.dataBuffer.readUInt32LE(off);
      skillLinesById.set(id, {
        id,
        categoryId: skillLineDbc.dataBuffer.readUInt32LE(off + 4),
        name: getString(skillLineDbc.stringBlock, skillLineDbc.dataBuffer.readUInt32LE(off + 12)) || `SkillLine ${id}`,
        description: getString(skillLineDbc.stringBlock, skillLineDbc.dataBuffer.readUInt32LE(off + 80)) || '',
        spellIconId: skillLineDbc.dataBuffer.readUInt32LE(off + 152),
      });
    }

    const matchesBySpell = new Map();
    const allRowsBySpell = new Map();
    for (let i = 0; i < abilityDbc.recordCount; i++) {
      const off = i * abilityDbc.recordSize;
      const spellId = abilityDbc.dataBuffer.readUInt32LE(off + 8);
      if (!spellIds.has(spellId)) continue;

      const rowRaceMask = abilityDbc.dataBuffer.readUInt32LE(off + 12);
      const rowClassMask = abilityDbc.dataBuffer.readUInt32LE(off + 16);
      const excludeRace = abilityDbc.dataBuffer.readUInt32LE(off + 20);
      const excludeClass = abilityDbc.dataBuffer.readUInt32LE(off + 24);
      const skillLineId = abilityDbc.dataBuffer.readUInt32LE(off + 4);
      const skillLine = skillLinesById.get(skillLineId);
      const category = categoriesById.get(skillLine?.categoryId) || null;
      const row = {
        id: abilityDbc.dataBuffer.readUInt32LE(off),
        spellId,
        skillLineId,
        skillLineName: skillLine?.name || `SkillLine ${skillLineId}`,
        skillLineDescription: skillLine?.description || '',
        skillLineIconId: skillLine?.spellIconId || 0,
        categoryId: category?.id || 0,
        categoryName: category?.name || 'Uncategorized',
        minSkillLineRank: abilityDbc.dataBuffer.readUInt32LE(off + 28),
        supercededBySpell: abilityDbc.dataBuffer.readUInt32LE(off + 32),
        acquireMethod: abilityDbc.dataBuffer.readUInt32LE(off + 36),
        trivialLow: abilityDbc.dataBuffer.readUInt32LE(off + 40),
        trivialHigh: abilityDbc.dataBuffer.readUInt32LE(off + 44),
        raceMask: rowRaceMask,
        classMask: rowClassMask,
        excludeRace,
        excludeClass,
      };
      if (!allRowsBySpell.has(spellId)) allRowsBySpell.set(spellId, []);
      allRowsBySpell.get(spellId).push(row);

      if (raceMask && rowRaceMask && !(rowRaceMask & raceMask)) continue;
      if (classMask && rowClassMask && !(rowClassMask & classMask)) continue;
      if (raceMask && excludeRace && (excludeRace & raceMask)) continue;
      if (classMask && excludeClass && (excludeClass & classMask)) continue;

      if (!matchesBySpell.has(spellId)) matchesBySpell.set(spellId, []);
      matchesBySpell.get(spellId).push(row);
    }

    for (const rows of allRowsBySpell.values()) {
      rows.sort((a, b) =>
        Number(Boolean(b.classMask)) - Number(Boolean(a.classMask)) ||
        Number(Boolean(b.raceMask)) - Number(Boolean(a.raceMask)) ||
        a.skillLineName.localeCompare(b.skillLineName) ||
        a.id - b.id
      );
    }

    const payload = {};
    for (const spellId of spellIds) {
      payload[spellId] = {
        matches: matchesBySpell.get(spellId) || [],
        allMatches: allRowsBySpell.get(spellId) || [],
      };
    }

    return { success: true, data: payload };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Insert or update a SkillLineAbility record. Record IDs are independent from Spell IDs.
ipcMain.handle('dbc:addSkillLineAbility', async (_, dbcPath, entry) => {
  try {
    if (!Number(entry?.Spell) || !Number(entry?.SkillLine)) {
      return { success: false, error: 'SkillLineAbility requires both a Spell ID and a SkillLine ID' };
    }
    const filePath = path.join(dbcPath, 'SkillLineAbility.dbc');
    const raw = fs.readFileSync(filePath);
    const recordCount = raw.readUInt32LE(4);
    const recordSize = raw.readUInt32LE(12);
    const stringBlockSize = raw.readUInt32LE(16);
    const headerSize = 20;
    const recordsEnd = headerSize + recordCount * recordSize;

    const requestedId = Number(entry.ID) || 0;
    const matchingIndexes = [];
    let maxId = 0;
    for (let i = 0; i < recordCount; i++) {
      const id = raw.readUInt32LE(headerSize + i * recordSize);
      maxId = Math.max(maxId, id);
      if (requestedId && id === requestedId) matchingIndexes.push(i);
    }
    const existingIndex = matchingIndexes.length ? matchingIndexes[matchingIndexes.length - 1] : -1;
    const recordId = existingIndex >= 0 ? requestedId : maxId + 1;
    const newRecord = existingIndex >= 0
      ? Buffer.from(raw.subarray(headerSize + existingIndex * recordSize, headerSize + (existingIndex + 1) * recordSize))
      : Buffer.alloc(recordSize, 0);
    newRecord.writeUInt32LE(recordId >>> 0, 0);
    newRecord.writeUInt32LE(entry.SkillLine >>> 0, 4);
    newRecord.writeUInt32LE(entry.Spell >>> 0, 8);
    newRecord.writeUInt32LE((entry.RaceMask || 0) >>> 0, 12);
    newRecord.writeUInt32LE((entry.ClassMask || 0) >>> 0, 16);
    newRecord.writeUInt32LE((entry.SupercededBySpell || 0) >>> 0, 32);
    newRecord.writeUInt32LE((entry.AcquireMethod || 0) >>> 0, 36);
    newRecord.writeUInt32LE((entry.TrivialSkillLineRankLow || 0) >>> 0, 40);

    const records = [];
    for (let i = 0; i < recordCount; i++) {
      if (matchingIndexes.includes(i) && i !== existingIndex) continue;
      records.push(i === existingIndex ? newRecord : raw.subarray(headerSize + i * recordSize, headerSize + (i + 1) * recordSize));
    }
    if (existingIndex < 0) records.push(newRecord);
    const newFile = Buffer.alloc(headerSize + records.length * recordSize + stringBlockSize);
    raw.copy(newFile, 0, 0, headerSize);
    records.forEach((record, i) => record.copy(newFile, headerSize + i * recordSize));
    raw.copy(newFile, headerSize + records.length * recordSize, recordsEnd);
    newFile.writeUInt32LE(records.length, 4);

    fs.writeFileSync(filePath, newFile);
    return { success: true, id: recordId, created: existingIndex < 0, removedDuplicates: Math.max(0, matchingIndexes.length - 1) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:searchSpells', async (_, dbcPath, term, options = {}) => {
  try {
    const dbc = await loadSpellDbc(dbcPath);
    if (!dbc) return { success: false, error: 'Kon Spell.dbc niet lezen' };

    const results = [];
    const isNum = /^\d+$/.test(term);
    const termNum = isNum ? parseInt(term) : 0;
    const termLower = term ? term.toLowerCase() : '';
    const normalizedTerm = termLower.replace(/[^a-z0-9]+/g, ' ').trim();
    const termTokens = normalizedTerm ? normalizedTerm.split(/\s+/).filter(Boolean) : [];
    const limit = options.limit || 50;
    const trainerFilter = options.trainerSpells === true;
    const classFilter = options.classFilter !== undefined && options.classFilter !== null && options.classFilter !== ''
      ? parseInt(options.classFilter) : null;
    const schoolFilter = options.schoolFilter !== undefined && options.schoolFilter !== null && options.schoolFilter !== ''
      ? parseInt(options.schoolFilter) : null;
    const idMin = options.idMin !== undefined && options.idMin !== null && options.idMin !== ''
      ? parseInt(options.idMin) : (options.customOnly === true ? (parseInt(options.customMin) || 4000000) : null);
    const idMax = options.idMax !== undefined && options.idMax !== null && options.idMax !== ''
      ? parseInt(options.idMax) : null;
    const duplicatesOnly = options.duplicatesOnly === true;
    const excludeProcSpells = options.excludeProcSpells !== false;
    const spellTypeFilter = String(options.spellTypeFilter || '');
    const talentOnly = options.talentOnly === true;
    const triggeredSpellIds = new Set();
    const talentSpellIds = new Set();
    const skillLineTrainerSpellIds = new Set();

    if (trainerFilter) {
      const skillLineAbilityDbc = await readDbcFile(path.join(dbcPath, 'SkillLineAbility.dbc'));
      if (skillLineAbilityDbc) {
        for (let i = 0; i < skillLineAbilityDbc.recordCount; i++) {
          const off = i * skillLineAbilityDbc.recordSize;
          const spellId = skillLineAbilityDbc.dataBuffer.readUInt32LE(off + 8);
          const acquireMethod = skillLineAbilityDbc.dataBuffer.readUInt32LE(off + 36);
          const trainerVisibility = skillLineAbilityDbc.dataBuffer.readUInt32LE(off + 40);
          if (spellId && acquireMethod === 0 && trainerVisibility === 0) skillLineTrainerSpellIds.add(spellId);
        }
      }
    }

    if (spellTypeFilter === 'active' || spellTypeFilter === 'proc' || talentOnly) {
      for (let i = 0; i < dbc.recordCount; i++) {
        const off = i * dbc.recordSize;
        for (const triggerOffset of [464, 468, 472]) {
          const triggerId = dbc.dataBuffer.readUInt32LE(off + triggerOffset);
          if (triggerId) triggeredSpellIds.add(triggerId);
        }
      }
      const talentDbc = await readDbcFile(path.join(dbcPath, 'Talent.dbc'));
      if (talentDbc) {
        for (let i = 0; i < talentDbc.recordCount; i++) {
          const off = i * talentDbc.recordSize;
          for (let rankOffset = 16; rankOffset <= 48; rankOffset += 4) {
            const spellId = talentDbc.dataBuffer.readUInt32LE(off + rankOffset);
            if (spellId) talentSpellIds.add(spellId);
          }
        }
      }
    }

    let nameCounts = null;
    if (duplicatesOnly) {
      nameCounts = new Map();
      for (let i = 0; i < dbc.recordCount; i++) {
        const off = i * dbc.recordSize;
        const nameRef = dbc.dataBuffer.readUInt32LE(off + 544);
        const name = readStringFromBlock(null, nameRef, dbc.stringBlock);
        if (!name) continue;
        nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
      }
    }

    for (let i = 0; i < dbc.recordCount && results.length < limit; i++) {
      const off = i * dbc.recordSize;
      const id = dbc.dataBuffer.readUInt32LE(off);
      const attrs = dbc.dataBuffer.readUInt32LE(off + 16);
      const procTypeMask = dbc.dataBuffer.readUInt32LE(off + 136);
      const procChance = dbc.dataBuffer.readUInt32LE(off + 140);
      const procCharges = dbc.dataBuffer.readUInt32LE(off + 144);
      const trigger1 = dbc.dataBuffer.readUInt32LE(off + 464);
      const trigger2 = dbc.dataBuffer.readUInt32LE(off + 468);
      const trigger3 = dbc.dataBuffer.readUInt32LE(off + 472);
      const effect1 = dbc.dataBuffer.readUInt32LE(off + 284);
      const effect2 = dbc.dataBuffer.readUInt32LE(off + 288);
      const effect3 = dbc.dataBuffer.readUInt32LE(off + 292);
      const castingTimeIndex = dbc.dataBuffer.readUInt32LE(off + 112);
      const recoveryTime = dbc.dataBuffer.readUInt32LE(off + 116);
      const categoryRecoveryTime = dbc.dataBuffer.readUInt32LE(off + 120);
      const manaCost = dbc.dataBuffer.readUInt32LE(off + 168);
      const manaCostPct = dbc.dataBuffer.readUInt32LE(off + 816);
      const rangeIndex = dbc.dataBuffer.readUInt32LE(off + 184);
      const spellFamily = dbc.dataBuffer.readUInt32LE(off + 832);
      const hasProcLikeBehavior = procTypeMask !== 0 || procChance !== 0 || procCharges !== 0 || trigger1 !== 0 || trigger2 !== 0 || trigger3 !== 0;
      const isPassive = (attrs & 0x40) !== 0;
      const isHidden = (attrs & 0x80) !== 0 || (attrs & 0x100) !== 0;
      const isAura = [effect1, effect2, effect3].some(effect => [6, 27, 35, 65, 119, 128, 129].includes(effect));
      const isProfession = (attrs & 0x20) !== 0 || [24, 53, 118, 127, 158].includes(effect1) || [24, 53, 118, 127, 158].includes(effect2) || [24, 53, 118, 127, 158].includes(effect3);
      const hasNonActionbarEffect = [effect1, effect2, effect3].some(effect => [24, 36, 47, 53, 54, 57, 66, 74, 95, 99, 101, 102, 109, 118, 127].includes(effect));
      const hasDirectCastEvidence = (
        (attrs & 0x10) !== 0 || recoveryTime !== 0 || categoryRecoveryTime !== 0 ||
        (castingTimeIndex !== 0 && (manaCost !== 0 || manaCostPct !== 0 || rangeIndex !== 0))
      );
      const isActiveAbility = !isPassive && !isHidden && !triggeredSpellIds.has(id) && !hasNonActionbarEffect && hasDirectCastEvidence &&
        (spellFamily !== 0 || talentSpellIds.has(id));
      const isProcTriggered = !isActiveAbility && (triggeredSpellIds.has(id) || hasProcLikeBehavior);

      const hasTrainerSpellAttribute = (attrs & 0x10000) !== 0 && (attrs & 0x80000) === 0;
      if (trainerFilter && !hasTrainerSpellAttribute && !skillLineTrainerSpellIds.has(id)) continue;
      if (trainerFilter && excludeProcSpells && hasProcLikeBehavior) continue;
      if (talentOnly && !talentSpellIds.has(id)) continue;
      if (spellTypeFilter === 'active' && !isActiveAbility) continue;
      if (spellTypeFilter === 'passive' && !isPassive) continue;
      if (spellTypeFilter === 'proc' && !isProcTriggered) continue;
      if (spellTypeFilter === 'aura' && !isAura) continue;
      if (spellTypeFilter === 'hidden' && !isHidden) continue;
      if (spellTypeFilter === 'profession' && !isProfession) continue;
      if (idMin !== null && id < idMin) continue;
      if (idMax !== null && id > idMax) continue;
      if (classFilter !== null && dbc.dataBuffer.readUInt32LE(off + 832) !== classFilter) continue;
      const schoolMask = dbc.dataBuffer.readUInt32LE(off + 900);
      if (schoolFilter !== null && !(schoolMask & schoolFilter)) continue;

      const nameRef = dbc.dataBuffer.readUInt32LE(off + 544);
      const name = readStringFromBlock(null, nameRef, dbc.stringBlock);
      if (!name) continue;
      const subtextRef = dbc.dataBuffer.readUInt32LE(off + 612);
      const subtext = readStringFromBlock(null, subtextRef, dbc.stringBlock);
      const haystack = (name + ' ' + (subtext || '')).toLowerCase();
      const matches = isNum
        ? id === termNum
        : (!term || haystack.includes(termLower) || (termTokens.length > 0 && termTokens.every(tok => haystack.includes(tok))));
      if (!matches) continue;
      if (duplicatesOnly && (nameCounts.get(name) || 0) <= 1) continue;

      results.push({
        ID: id,
        Name_Lang_enUS: name,
        NameSubtext_Lang_enUS: subtext,
        Attributes: attrs,
        SpellLevel: dbc.dataBuffer.readUInt32LE(off + 156),
        SchoolMask: schoolMask,
        DefenseType: dbc.dataBuffer.readUInt32LE(off + 852),
        SpellClassSet: dbc.dataBuffer.readUInt32LE(off + 832),
        HasProcLikeBehavior: hasProcLikeBehavior,
        IsPassive: isPassive,
        IsHidden: isHidden,
        IsAura: isAura,
        IsProfession: isProfession,
        IsActiveAbility: isActiveAbility,
        IsProcTriggered: isProcTriggered,
        ProcTypeMask: procTypeMask,
        ProcChance: procChance,
        ProcCharges: procCharges,
        EffectTriggerSpell_1: trigger1,
        EffectTriggerSpell_2: trigger2,
        EffectTriggerSpell_3: trigger3,
      });
    }
    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:getSpellDbcInfo', async (_, dbcPath) => {
  try {
    const dbc = await loadSpellDbc(dbcPath);
    if (!dbc) return { success: false, error: 'Kon Spell.dbc niet lezen' };
    return { success: true, recordCount: dbc.recordCount, fieldCount: dbc.fieldCount, recordSize: dbc.recordSize };
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
 // Talent IDs are client-facing DBC IDs, unlike server custom IDs. Allocate
 // directly after the highest existing talent so sparse high custom ranges
 // cannot destabilize the 3.3.5 talent UI.
    let nextId = Number(startId);
    if (!Number.isInteger(nextId) || nextId <= 0) {
      nextId = Math.max(...usedIds) + 1;
    }
    while (usedIds.has(nextId)) nextId++;
    return { success: true, nextId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ScalingStatDistribution.dbc: ID(0), StatID_1..10 (4..40, int32), Bonus_1..10 (44..80, int32), Maxlevel(84)
ipcMain.handle('dbc:readScalingStatDistribution', async (_, dbcPath, id) => {
  try {
    const filePath = path.join(dbcPath, 'ScalingStatDistribution.dbc');
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: false, error: 'Kon ScalingStatDistribution.dbc niet lezen' };
    const results = [];
    for (let i = 0; i < dbc.recordCount; i++) {
      const off = i * dbc.recordSize;
      const recId = dbc.dataBuffer.readUInt32LE(off);
      if (id !== undefined && id !== null && recId !== id) continue;
      const rec = { ID: recId };
      for (let s = 1; s <= 10; s++) rec[`StatID_${s}`] = dbc.dataBuffer.readInt32LE(off + 4 + (s - 1) * 4);
      for (let s = 1; s <= 10; s++) rec[`Bonus_${s}`] = dbc.dataBuffer.readInt32LE(off + 44 + (s - 1) * 4);
      rec.Maxlevel = dbc.dataBuffer.readUInt32LE(off + 84);
      results.push(rec);
      if (id !== undefined && id !== null) break;
    }
    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:writeScalingStatDistribution', async (_, dbcPath, dist) => {
  try {
    const filePath = path.join(dbcPath, 'ScalingStatDistribution.dbc');
    const raw = fs.readFileSync(filePath);
    const recordCount = raw.readUInt32LE(4);
    const recordSize = raw.readUInt32LE(12);
    const headerSize = 20;

    let recordIndex = -1;
    for (let i = 0; i < recordCount; i++) {
      if (raw.readUInt32LE(headerSize + i * recordSize) === dist.ID) { recordIndex = i; break; }
    }
    if (recordIndex === -1) return { success: false, error: 'Distributie niet gevonden' };

    const recordBase = headerSize + recordIndex * recordSize;
    const newBuffer = Buffer.from(raw);

    for (let s = 1; s <= 10; s++) {
      const key = `StatID_${s}`;
      if (dist[key] !== undefined) newBuffer.writeInt32LE(Number(dist[key]) | 0, recordBase + 4 + (s - 1) * 4);
    }
    for (let s = 1; s <= 10; s++) {
      const key = `Bonus_${s}`;
      if (dist[key] !== undefined) newBuffer.writeInt32LE(Number(dist[key]) | 0, recordBase + 44 + (s - 1) * 4);
    }
    if (dist.Maxlevel !== undefined) newBuffer.writeUInt32LE(Number(dist.Maxlevel) >>> 0, recordBase + 84);

    fs.writeFileSync(filePath, newBuffer);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:addScalingStatDistribution', async (_, dbcPath, dist) => {
  try {
    const filePath = path.join(dbcPath, 'ScalingStatDistribution.dbc');
    const raw = fs.readFileSync(filePath);
    const recordCount = raw.readUInt32LE(4);
    const recordSize = raw.readUInt32LE(12);
    const headerSize = 20;
    const recordsEnd = headerSize + recordCount * recordSize;

    const newRecord = Buffer.alloc(recordSize, 0);
    newRecord.writeUInt32LE(dist.ID >>> 0, 0);
    for (let s = 1; s <= 10; s++) newRecord.writeInt32LE(Number(dist[`StatID_${s}`] ?? -1) | 0, 4 + (s - 1) * 4);
    for (let s = 1; s <= 10; s++) newRecord.writeInt32LE(Number(dist[`Bonus_${s}`] ?? 0) | 0, 44 + (s - 1) * 4);
    newRecord.writeUInt32LE(Number(dist.Maxlevel ?? 80) >>> 0, 84);

    const newFile = Buffer.alloc(raw.length + recordSize);
    raw.copy(newFile, 0, 0, recordsEnd);
    newRecord.copy(newFile, recordsEnd);
    raw.copy(newFile, recordsEnd + recordSize, recordsEnd);
    newFile.writeUInt32LE(recordCount + 1, 4);

    fs.writeFileSync(filePath, newFile);
    return { success: true, id: dist.ID };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:findNextScalingStatDistributionId', async (_, dbcPath, startId) => {
  try {
    const filePath = path.join(dbcPath, 'ScalingStatDistribution.dbc');
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: false, error: 'Kon ScalingStatDistribution.dbc niet lezen' };
    const usedIds = new Set();
    for (let i = 0; i < dbc.recordCount; i++) usedIds.add(dbc.dataBuffer.readUInt32LE(i * dbc.recordSize));
    let nextId = Number(startId) || 1;
    while (usedIds.has(nextId)) nextId++;
    return { success: true, nextId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ScalingStatValues.dbc: ID(0), Charlevel(4), 22 budget/armor fields (8..92), all uint32, recordSize 96
ipcMain.handle('dbc:readScalingStatValues', async (_, dbcPath) => {
  try {
    const filePath = path.join(dbcPath, 'ScalingStatValues.dbc');
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: false, error: 'Kon ScalingStatValues.dbc niet lezen' };
    const fields = ['ID', 'Charlevel', 'ShoulderBudget', 'TrinketBudget', 'WeaponBudget1H', 'RangedBudget',
      'ClothShoulderArmor', 'LeatherShoulderArmor', 'MailShoulderArmor', 'PlateShoulderArmor',
      'WeaponDPS1H', 'WeaponDPS2H', 'SpellcasterDPS1H', 'SpellcasterDPS2H', 'RangedDPS', 'WandDPS',
      'SpellPower', 'PrimaryBudget', 'TertiaryBudget', 'ClothCloakArmor', 'ClothChestArmor',
      'LeatherChestArmor', 'MailChestArmor', 'PlateChestArmor'];
    const results = [];
    for (let i = 0; i < dbc.recordCount; i++) {
      const off = i * dbc.recordSize;
      const rec = {};
      fields.forEach((key, idx) => { rec[key] = dbc.dataBuffer.readUInt32LE(off + idx * 4); });
      results.push(rec);
    }
    results.sort((a, b) => a.Charlevel - b.Charlevel);
    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:getSpellAnimation', async (_, dbcPath, spellId) => {
  try {
    const [spell, visual, kit, animations] = await Promise.all([
      readDbcFile(path.join(dbcPath, 'Spell.dbc')),
      readDbcFile(path.join(dbcPath, 'SpellVisual.dbc')),
      readDbcFile(path.join(dbcPath, 'SpellVisualKit.dbc')),
      readDbcFile(path.join(dbcPath, 'AnimationData.dbc')),
    ]);
    if (!spell || !visual || !kit || !animations) throw new Error('Required animation DBC files are unavailable');
    const find = (dbc, id) => { for (let i = 0; i < dbc.recordCount; i++) { const off = i * dbc.recordSize; if (dbc.dataBuffer.readUInt32LE(off) === id) return off; } return -1; };
    const spellOff = find(spell, Number(spellId));
    if (spellOff < 0) throw new Error(`Spell ${spellId} not found`);
    const visualId = spell.dataBuffer.readUInt32LE(spellOff + 524);
    const visualOff = find(visual, visualId);
    if (visualOff < 0) return { success: true, data: { visualId, castKitId: 0, animationId: -1, animations: [] } };
    const castKitId = visual.dataBuffer.readUInt32LE(visualOff + 8);
    const kitOff = find(kit, castKitId);
    const animationId = kitOff < 0 ? -1 : kit.dataBuffer.readInt32LE(kitOff + 8);
    const readName = (ref) => readStringFromBlock(null, ref, animations.stringBlock);
    const animationList = [];
    for (let i = 0; i < animations.recordCount; i++) {
      const off = i * animations.recordSize;
      animationList.push({ id: animations.dataBuffer.readUInt32LE(off), name: readName(animations.dataBuffer.readUInt32LE(off + 4)), fallback: animations.dataBuffer.readUInt32LE(off + 20) });
    }
    const readVisual = (field) => visual.dataBuffer.readUInt32LE(visualOff + field * 4);
    const readKit = (field) => kitOff < 0 ? 0 : kit.dataBuffer.readUInt32LE(kitOff + field * 4);
    return { success: true, data: {
      visualId, castKitId, animationId, animations: animationList,
      visual: { precastKit: readVisual(1), castKit: readVisual(2), impactKit: readVisual(3), stateKit: readVisual(4), stateDoneKit: readVisual(5), channelKit: readVisual(6), missileModel: readVisual(8), missilePathType: readVisual(9), missileDestinationAttachment: readVisual(10), missileSound: readVisual(11), flags: readVisual(13), casterImpactKit: readVisual(14), targetImpactKit: readVisual(15), missileAttachment: readVisual(16), missileCastOffsetX: visual.dataBuffer.readFloatLE(visualOff + 104), missileCastOffsetY: visual.dataBuffer.readFloatLE(visualOff + 108), missileCastOffsetZ: visual.dataBuffer.readFloatLE(visualOff + 112), missileImpactOffsetX: visual.dataBuffer.readFloatLE(visualOff + 116), missileImpactOffsetY: visual.dataBuffer.readFloatLE(visualOff + 120), missileImpactOffsetZ: visual.dataBuffer.readFloatLE(visualOff + 124) },
      castKit: { startAnimId: readKit(1), animId: readKit(2), headEffect: readKit(3), chestEffect: readKit(4), baseEffect: readKit(5), leftHandEffect: readKit(6), rightHandEffect: readKit(7), leftWeaponEffect: readKit(9), rightWeaponEffect: readKit(10), soundId: readKit(15), shakeId: readKit(16), flags: readKit(37) },
    } };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('dbc:cloneSpellCastAnimation', async (_, dbcPath, spellId, animationId, settings = {}) => {
  try {
    const files = ['Spell.dbc', 'SpellVisual.dbc', 'SpellVisualKit.dbc'];
    const paths = Object.fromEntries(files.map(name => [name, path.join(dbcPath, name)]));
    const raw = Object.fromEntries(files.map(name => [name, fs.readFileSync(paths[name])]));
    const find = (buffer, id) => { const count = buffer.readUInt32LE(4), size = buffer.readUInt32LE(12); for (let i = 0; i < count; i++) { const off = 20 + i * size; if (buffer.readUInt32LE(off) === id) return off; } return -1; };
    const nextId = (buffer, startId = 1) => { const count = buffer.readUInt32LE(4), size = buffer.readUInt32LE(12), used = new Set(); for (let i = 0; i < count; i++) used.add(buffer.readUInt32LE(20 + i * size)); let id = Math.max(1, Number(startId) || 1); while (used.has(id)) id++; return id; };
    const appendClone = (buffer, sourceOff, newId) => { const count = buffer.readUInt32LE(4), size = buffer.readUInt32LE(12), strings = buffer.readUInt32LE(16), end = 20 + count * size; const out = Buffer.alloc(buffer.length + size); buffer.copy(out, 0, 0, end); buffer.copy(out, end, sourceOff, sourceOff + size); out.writeUInt32LE(newId, end); buffer.copy(out, end + size, end); out.writeUInt32LE(count + 1, 4); return out; };
    const spellOff = find(raw['Spell.dbc'], Number(spellId));
    if (spellOff < 0) throw new Error(`Spell ${spellId} not found`);
    const oldVisualId = raw['Spell.dbc'].readUInt32LE(spellOff + 524);
    const visualOff = find(raw['SpellVisual.dbc'], oldVisualId);
    if (visualOff < 0) throw new Error(`SpellVisual ${oldVisualId} not found`);
    const oldKitId = raw['SpellVisual.dbc'].readUInt32LE(visualOff + 8);
    const kitOff = find(raw['SpellVisualKit.dbc'], oldKitId);
    if (kitOff < 0) throw new Error(`SpellVisualKit ${oldKitId} not found`);
    const customStart = Number(settings.idStart) || 1;
    const newKitId = nextId(raw['SpellVisualKit.dbc'], customStart);
    const newVisualId = nextId(raw['SpellVisual.dbc'], customStart);
    const newKit = appendClone(raw['SpellVisualKit.dbc'], kitOff, newKitId);
    const newKitOff = 20 + raw['SpellVisualKit.dbc'].readUInt32LE(4) * raw['SpellVisualKit.dbc'].readUInt32LE(12);
    newKit.writeInt32LE(Number(animationId), newKitOff + 8);
    for (const [field, offset] of Object.entries({ startAnimId: 4, headEffect: 12, chestEffect: 16, baseEffect: 20, leftHandEffect: 24, rightHandEffect: 28, leftWeaponEffect: 36, rightWeaponEffect: 40, soundId: 60, shakeId: 64 })) {
      if (settings.castKit?.[field] !== undefined) newKit.writeUInt32LE(Number(settings.castKit[field]) >>> 0, newKitOff + offset);
    }
    const newVisual = appendClone(raw['SpellVisual.dbc'], visualOff, newVisualId);
    const newVisualOff = 20 + raw['SpellVisual.dbc'].readUInt32LE(4) * raw['SpellVisual.dbc'].readUInt32LE(12);
    newVisual.writeUInt32LE(newKitId, newVisualOff + 8);
    const visualFields = { precastKit: 4, impactKit: 12, stateKit: 16, stateDoneKit: 20, channelKit: 24, missileModel: 32, missilePathType: 36, missileDestinationAttachment: 40, missileSound: 44, flags: 52, casterImpactKit: 56, targetImpactKit: 60, missileAttachment: 64, missileCastOffsetX: 104, missileCastOffsetY: 108, missileCastOffsetZ: 112, missileImpactOffsetX: 116, missileImpactOffsetY: 120, missileImpactOffsetZ: 124 };
    const visualFloatFields = new Set(['missileCastOffsetX', 'missileCastOffsetY', 'missileCastOffsetZ', 'missileImpactOffsetX', 'missileImpactOffsetY', 'missileImpactOffsetZ']);
    for (const [field, offset] of Object.entries(visualFields)) {
      if (settings.visual?.[field] !== undefined) {
        if (visualFloatFields.has(field)) newVisual.writeFloatLE(Number(settings.visual[field]) || 0, newVisualOff + offset);
        else newVisual.writeUInt32LE(Number(settings.visual[field]) >>> 0, newVisualOff + offset);
      }
    }
    const newSpell = Buffer.from(raw['Spell.dbc']);
    newSpell.writeUInt32LE(newVisualId, spellOff + 524);
    fs.writeFileSync(paths['SpellVisualKit.dbc'], newKit);
    fs.writeFileSync(paths['SpellVisual.dbc'], newVisual);
    fs.writeFileSync(paths['Spell.dbc'], newSpell);
    spellDbcCache = null;
    return { success: true, data: { visualId: newVisualId, castKitId: newKitId, animationId: Number(animationId) } };
  } catch (e) { return { success: false, error: e.message }; }
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

// Compare tab: copy one full spell record from an external Spell.dbc (different folder,
// possibly colliding IDs e.g. Project Epoch) into the local Spell.dbc at a free ID.
// Resolves the source's string fields by value (not by raw offset) since the two files
// have independent string blocks.
ipcMain.handle('dbc:copySpellCrossFile', async (_, sourceDbcPath, sourceId, destDbcPath, newId) => {
  try {
    const headerSize = 20;
    const srcFilePath = path.join(sourceDbcPath, 'Spell.dbc');
    const srcBuffer = fs.readFileSync(srcFilePath);
    const srcRecordCount = srcBuffer.readUInt32LE(4);
    const srcRecordSize = srcBuffer.readUInt32LE(12);
    const srcStringBlockSize = srcBuffer.readUInt32LE(16);
    const srcDataSize = srcRecordCount * srcRecordSize;
    const srcStrBlockStart = headerSize + srcDataSize;
    const srcStrBlock = srcBuffer.slice(srcStrBlockStart, srcStrBlockStart + srcStringBlockSize);

    let srcIndex = -1;
    for (let i = 0; i < srcRecordCount; i++) {
      if (srcBuffer.readUInt32LE(headerSize + i * srcRecordSize) === sourceId) { srcIndex = i; break; }
    }
    if (srcIndex === -1) return { success: false, error: `Spell ${sourceId} niet gevonden in bronbestand` };

    const srcRecordOff = headerSize + srcIndex * srcRecordSize;
    const srcRecordBytes = srcBuffer.slice(srcRecordOff, srcRecordOff + srcRecordSize);

    const stringValues = {};
    for (const [key, f] of Object.entries(SPELL_OFFSETS)) {
      if (f.type !== 'string') continue;
      const ref = srcRecordBytes.readUInt32LE(f.offset);
      stringValues[key] = readStringFromBlock(null, ref, srcStrBlock);
    }

    const destFilePath = path.join(destDbcPath, 'Spell.dbc');
    const destBuffer = fs.readFileSync(destFilePath);
    const destRecordCount = destBuffer.readUInt32LE(4);
    const destRecordSize = destBuffer.readUInt32LE(12);
    const destStringBlockSize = destBuffer.readUInt32LE(16);

    if (destRecordSize !== srcRecordSize) {
      return { success: false, error: `Spell.dbc formaten komen niet overeen (recordSize ${srcRecordSize} vs ${destRecordSize})` };
    }

    const destDataSize = destRecordCount * destRecordSize;
    for (let i = 0; i < destRecordCount; i++) {
      if (destBuffer.readUInt32LE(headerSize + i * destRecordSize) === newId) {
        return { success: false, error: `ID ${newId} bestaat al` };
      }
    }

    const newRecord = Buffer.from(srcRecordBytes);
    newRecord.writeUInt32LE(newId, 0);

 // Clear all locale string refs before remapping the strings this app manages.
 // Source and destination Spell.dbc files have independent string tables.
    for (const offset of SPELL_ALL_STRING_OFFSETS) {
      if (offset + 4 <= newRecord.length) newRecord.writeUInt32LE(0, offset);
    }

    let extraOffset = destStringBlockSize;
    const extraParts = [];
    for (const [key, f] of Object.entries(SPELL_OFFSETS)) {
      if (f.type !== 'string') continue;
      const str = stringValues[key] || '';
      if (str === '') {
        newRecord.writeUInt32LE(0, f.offset);
        continue;
      }
      newRecord.writeUInt32LE(extraOffset, f.offset);
      const strBuf = Buffer.from(str + '\0', 'utf8');
      extraParts.push(strBuf);
      extraOffset += strBuf.length;
    }

    const destStrBlockStart = headerSize + destDataSize;
    const destStrBlock = destBuffer.slice(destStrBlockStart, destStrBlockStart + destStringBlockSize);

    const newBuffer = Buffer.concat([
      destBuffer.slice(0, headerSize),
      destBuffer.slice(headerSize, destStrBlockStart),
      newRecord,
      destStrBlock,
      ...extraParts,
    ]);

    newBuffer.writeUInt32LE(destRecordCount + 1, 4);
    newBuffer.writeUInt32LE(extraOffset, 16);

    fs.writeFileSync(destFilePath, newBuffer);
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

// SpellCastTimes.dbc: ID(0), CastTime(4), CastTimePerLevel(8), MinCastTime(12) 4 fields 4 bytes
ipcMain.handle('dbc:readCastTimes', async (_, dbcPath) => {
  try {
    const dbc = await readDbcFile(path.join(dbcPath, 'SpellCastTimes.dbc'));
    if (!dbc) return { success: true, data: {} };
    const result = {};
    for (let i = 0; i < dbc.recordCount; i++) {
      const base = i * dbc.recordSize;
      const id = readUInt32LE(dbc.dataBuffer, base);
      const castTime = readUInt32LE(dbc.dataBuffer, base + 4);
      result[id] = castTime;
    }
    return { success: true, data: result };
  } catch (e) { return { success: false, error: e.message }; }
});

// SpellDuration.dbc: ID(0), Duration(4), DurationPerLevel(8), MaxDuration(12) 4 fields 4 bytes
ipcMain.handle('dbc:readDurations', async (_, dbcPath) => {
  try {
    const dbc = await readDbcFile(path.join(dbcPath, 'SpellDuration.dbc'));
    if (!dbc) return { success: true, data: {} };
    const result = {};
    for (let i = 0; i < dbc.recordCount; i++) {
      const base = i * dbc.recordSize;
      const id = readUInt32LE(dbc.dataBuffer, base);
      const duration = readUInt32LE(dbc.dataBuffer, base + 4);
      const maxDuration = readUInt32LE(dbc.dataBuffer, base + 12);
      result[id] = { duration, maxDuration };
    }
    return { success: true, data: result };
  } catch (e) { return { success: false, error: e.message }; }
});

// SpellRange.dbc: ID(0), RangeMin(4), RangeMinHostile(8), RangeMax(12), RangeMaxHostile(16), then 2 localized name strings (offset 20+)
ipcMain.handle('dbc:readRanges', async (_, dbcPath) => {
  try {
    const dbc = await readDbcFile(path.join(dbcPath, 'SpellRange.dbc'));
    if (!dbc) return { success: true, data: {} };
    const result = {};
    for (let i = 0; i < dbc.recordCount; i++) {
      const base = i * dbc.recordSize;
      const id = readUInt32LE(dbc.dataBuffer, base);
      const rangeMin = dbc.dataBuffer.readFloatLE(base + 4);
      const rangeMax = dbc.dataBuffer.readFloatLE(base + 12);
 // Name string: offset 20 = first localized string block (enUS pointer)
      const nameOffset = readUInt32LE(dbc.dataBuffer, base + 20);
      let name = '';
      if (nameOffset < dbc.stringBlock.length) {
        const end = dbc.stringBlock.indexOf(0, nameOffset);
        name = dbc.stringBlock.toString('utf8', nameOffset, end >= 0 ? end : undefined);
      }
      result[id] = { rangeMin: Math.round(rangeMin * 10) / 10, rangeMax: Math.round(rangeMax * 10) / 10, name };
    }
    return { success: true, data: result };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('dbc:readSpellIcons', async (_, dbcPath, iconIds) => {
  try {
    const filePath = path.join(dbcPath, 'SpellIcon.dbc');
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: true, data: {} };

    console.log(`
=== readSpellIcons: Looking for ${iconIds.length} icon IDs ===`);
    console.log(`First 10 icon IDs:`, iconIds.slice(0, 10).join(','));
    const icons = {};
    for (let i = 0; i < dbc.recordCount; i++) {
      const offset = i * dbc.recordSize;
      const id = readUInt32LE(dbc.dataBuffer, offset + 0);
      if (iconIds.includes(id)) {
        const filenameRef = readUInt32LE(dbc.dataBuffer, offset + 4);
        const filename = readStringFromBlock(dbc.dataBuffer, filenameRef, dbc.stringBlock);
        icons[id] = filename;
        console.log(`  SpellIcon ${id}: "${filename}"`);
      }
    }
    console.log(`readSpellIcons: Found ${Object.keys(icons).length} icon filenames
`);
    return { success: true, data: icons };
  } catch (e) {
    console.error('readSpellIcons error:', e);
    return { success: true, data: {} };
  }
});

ipcMain.handle('dbc:readItemIcons', async (_, dbcPath, itemIds) => {
  try {
    const itemDbc = await readDbcFile(path.join(dbcPath, 'Item.dbc'));
    const displayDbc = await readDbcFile(path.join(dbcPath, 'ItemDisplayInfo.dbc'));
    if (!itemDbc || !displayDbc) return { success: true, data: {} };

    const itemIndex = dbcBuildIndex(itemDbc);
    const displayIndex = dbcBuildIndex(displayDbc);
    const displayIds = new Map();
    for (const itemId of itemIds || []) {
      const itemOff = itemIndex.get(Number(itemId));
      if (itemOff === undefined) continue;
      const displayId = readUInt32LE(itemDbc.dataBuffer, itemOff + 20);
      if (displayId > 0) displayIds.set(Number(itemId), displayId);
    }

    const displayIcons = new Map();
    for (const displayId of [...new Set(displayIds.values())]) {
      const displayOff = displayIndex.get(displayId);
      if (displayOff === undefined) continue;
      const icon0Ref = readUInt32LE(displayDbc.dataBuffer, displayOff + 20);
      const icon1Ref = readUInt32LE(displayDbc.dataBuffer, displayOff + 24);
      const iconNameRef = icon0Ref || icon1Ref;
      const iconName = iconNameRef ? readStringFromBlock(displayDbc.dataBuffer, iconNameRef, displayDbc.stringBlock) : '';
      if (iconName) displayIcons.set(displayId, iconName);
    }

    const icons = {};
    for (const [itemId, displayId] of displayIds.entries()) {
      const iconName = displayIcons.get(displayId);
      if (iconName) icons[itemId] = iconName;
    }
    return { success: true, data: icons };
  } catch (e) {
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
          console.log('  Offset 524: ' + iconId524 + ' (expected 122: ' + (iconId524 === 122 ? 'OK' : 'NO') + ')');

 // Scan all offsets to find string reference to "Convection"
          console.log(`  Scanning for "Convection"...`);
          for (let fieldOffset = 520; fieldOffset <= 600; fieldOffset += 4) {
            const val = readUInt32LE(dbc.dataBuffer, offset + fieldOffset);
            if (val > 0 && val < dbc.stringBlock.length) {
              const str = readStringFromBlock(dbc.dataBuffer, val, dbc.stringBlock);
              if (str === 'Convection') {
                console.log(`  ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ FOUND: Offset ${fieldOffset} contains string ref to "Convection"`);
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

// Find next free ID
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

function sortTalentDbcRecords(buffer) {
  const headerSize = 20;
  const recordCount = buffer.readUInt32LE(4);
  const recordSize = buffer.readUInt32LE(12);
  const stringBlockSize = buffer.readUInt32LE(16);
  const dataEnd = headerSize + recordCount * recordSize;
  if (recordSize < 16 || buffer.length < dataEnd + stringBlockSize) throw new Error('Invalid Talent.dbc record layout');

  const records = Array.from({ length: recordCount }, (_, index) => Buffer.from(buffer.subarray(headerSize + index * recordSize, headerSize + (index + 1) * recordSize)));
  records.sort((a, b) =>
    (a.readUInt32LE(4) - b.readUInt32LE(4)) ||
    (a.readUInt32LE(8) - b.readUInt32LE(8)) ||
    (a.readUInt32LE(12) - b.readUInt32LE(12)) ||
    (a.readUInt32LE(0) - b.readUInt32LE(0))
  );

  const sorted = Buffer.alloc(buffer.length);
  buffer.copy(sorted, 0, 0, headerSize);
  records.forEach((record, index) => record.copy(sorted, headerSize + index * recordSize));
  buffer.copy(sorted, dataEnd, dataEnd, dataEnd + stringBlockSize);
  return sorted;
}

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

    fs.writeFileSync(filePath, sortTalentDbcRecords(newBuffer));
    return { success: true, newId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:insertTalent', async (_, dbcPath, talent) => {
  try {
    const filePath = path.join(dbcPath, 'Talent.dbc');
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'Ongeldig DBC bestand' };

    const recordCount = buffer.readUInt32LE(4);
    const recordSize = buffer.readUInt32LE(12);
    const stringBlockSize = buffer.readUInt32LE(16);
    const headerSize = 20;
    if (recordSize < 76) return { success: false, error: `Onverwachte Talent.dbc record size: ${recordSize}` };

    const talentId = Number(talent.ID);
    if (!Number.isInteger(talentId) || talentId <= 0) return { success: false, error: 'Talent-ID moet een positief geheel getal zijn.' };
    for (let i = 0; i < recordCount; i++) {
      if (buffer.readUInt32LE(headerSize + i * recordSize) === talentId) return { success: false, error: `ID ${talentId} bestaat al` };
    }

    const record = Buffer.alloc(recordSize);
    record.writeUInt32LE(talentId, 0);
    record.writeUInt32LE(Number(talent.TabID) || 0, 4);
    record.writeUInt32LE(Number(talent.TierID) || 0, 8);
    record.writeUInt32LE(Number(talent.ColumnIndex) || 0, 12);
    for (let i = 1; i <= 9; i++) record.writeUInt32LE(Number(talent[`SpellRank_${i}`]) || 0, 16 + (i - 1) * 4);
    for (let i = 1; i <= 3; i++) record.writeUInt32LE(Number(talent[`PrereqTalent_${i}`]) || 0, 48 + i * 4);
    for (let i = 1; i <= 3; i++) record.writeUInt32LE(Number(talent[`PrereqRank_${i}`]) || 0, 60 + i * 4);

    const dataEnd = headerSize + recordCount * recordSize;
    const newBuffer = Buffer.alloc(headerSize + (recordCount + 1) * recordSize + stringBlockSize);
    buffer.copy(newBuffer, 0, 0, dataEnd);
    record.copy(newBuffer, dataEnd);
    buffer.copy(newBuffer, dataEnd + recordSize, dataEnd, dataEnd + stringBlockSize);
    newBuffer.writeUInt32LE(recordCount + 1, 4);
    fs.writeFileSync(filePath, sortTalentDbcRecords(newBuffer));
    return { success: true, newId: talentId };
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

    fs.writeFileSync(filePath, sortTalentDbcRecords(tempBuffer));
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
    fs.writeFileSync(filePath, sortTalentDbcRecords(newBuf));
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

let assetWorkerRequestId = 0;
const assetWorkerPool = [];
const assetWorkerQueue = [];
const assetWorkerPending = new Map();
let m2AssetWorker = null;
const m2AssetWorkerPending = new Map();

function createAssetWorker() {
  const entry = { thread: null, busy: false, current: null, removing: false };
  entry.thread = new Worker(path.join(__dirname, 'asset-worker.js'), {
    workerData: { assetIoConcurrency: getRuntimeResourceProfile().assetIoConcurrency },
  });
  entry.thread.on('message', ({ id, result, error }) => {
    const pending = assetWorkerPending.get(id);
    if (!pending) return;
    assetWorkerPending.delete(id);
    entry.busy = false;
    entry.current = null;
    if (error) pending.reject(new Error(error)); else pending.resolve(result);
    pumpAssetWorkerQueue();
  });
  const fail = (error) => {
    const index = assetWorkerPool.indexOf(entry);
    if (index >= 0) assetWorkerPool.splice(index, 1);
    if (entry.current) {
      const pending = assetWorkerPending.get(entry.current.id);
      if (pending) {
        assetWorkerPending.delete(entry.current.id);
        pending.reject(error);
      }
    }
    entry.busy = false;
    entry.current = null;
    if (!entry.removing) ensureAssetWorkerPool();
    pumpAssetWorkerQueue();
  };
  entry.thread.on('error', fail);
  entry.thread.on('exit', code => {
    if (code && !entry.removing) fail(new Error(`Asset worker stopped (${code})`));
  });
  assetWorkerPool.push(entry);
  return entry;
}

let assetWorkerTargetCount = 1;

function ensureAssetWorkerPool(target = assetWorkerTargetCount) {
  assetWorkerTargetCount = Math.max(1, Math.min(2, Number(target) || 1));
  while (assetWorkerPool.length < assetWorkerTargetCount) createAssetWorker();
  for (const entry of [...assetWorkerPool]) {
    if (assetWorkerPool.length <= assetWorkerTargetCount || entry.busy) continue;
    entry.removing = true;
    assetWorkerPool.splice(assetWorkerPool.indexOf(entry), 1);
    void entry.thread.terminate();
  }
}

function pumpAssetWorkerQueue() {
  ensureAssetWorkerPool();
  for (const entry of assetWorkerPool) {
    if (entry.busy || !assetWorkerQueue.length) continue;
    const task = assetWorkerQueue.shift();
    entry.busy = true;
    entry.current = task;
    assetWorkerPending.set(task.id, { resolve: task.resolve, reject: task.reject });
    try {
      entry.thread.postMessage({ id: task.id, type: task.type, payload: task.payload });
    } catch (error) {
      assetWorkerPending.delete(task.id);
      entry.busy = false;
      entry.current = null;
      task.reject(error);
      pumpAssetWorkerQueue();
    }
  }
}

function runAssetWorker(type, payload) {
  if (type === 'decodeBlps') ensureAssetWorkerPool(getRuntimeResourceProfile().textureWorkers);
  const id = ++assetWorkerRequestId;
  return new Promise((resolve, reject) => {
    assetWorkerQueue.push({ id, type, payload, resolve, reject });
    pumpAssetWorkerQueue();
  });
}

function getM2AssetWorker() {
  if (m2AssetWorker) return m2AssetWorker;
  m2AssetWorker = new Worker(path.join(__dirname, 'asset-worker.js'), {
    workerData: { assetIoConcurrency: getRuntimeResourceProfile().assetIoConcurrency },
  });
  const fail = (error) => {
    for (const { reject } of m2AssetWorkerPending.values()) reject(error);
    m2AssetWorkerPending.clear();
    m2AssetWorker = null;
  };
  m2AssetWorker.on('message', ({ id, result, error }) => {
    const pending = m2AssetWorkerPending.get(id);
    if (!pending) return;
    m2AssetWorkerPending.delete(id);
    if (error) pending.reject(new Error(error)); else pending.resolve(result);
  });
  m2AssetWorker.on('error', fail);
  m2AssetWorker.on('exit', code => { if (code) fail(new Error(`M2 asset worker stopped (${code})`)); });
  return m2AssetWorker;
}

function runM2AssetWorker(type, payload) {
  const id = ++assetWorkerRequestId;
  return new Promise((resolve, reject) => {
    m2AssetWorkerPending.set(id, { resolve, reject });
    getM2AssetWorker().postMessage({ id, type, payload });
  });
}

const wmoAssetWorkerPool = [];
const wmoAssetWorkerQueue = [];
const wmoAssetWorkerPending = new Map();
let wmoAssetWorkerTargetCount = 1;

function createWmoAssetWorker() {
  const entry = { thread: null, busy: false, current: null, removing: false };
  entry.thread = new Worker(path.join(__dirname, 'asset-worker.js'), {
    workerData: {
      assetIoConcurrency: getRuntimeResourceProfile().assetIoConcurrency,
    },
  });
  const fail = (error) => {
    const index = wmoAssetWorkerPool.indexOf(entry);
    if (index >= 0) wmoAssetWorkerPool.splice(index, 1);
    if (entry.current) {
      const pending = wmoAssetWorkerPending.get(entry.current.id);
      if (pending) {
        wmoAssetWorkerPending.delete(entry.current.id);
        pending.reject(error);
      }
    }
    entry.busy = false;
    entry.current = null;
    if (!entry.removing) ensureWmoAssetWorkerPool();
    pumpWmoAssetWorkerQueue();
  };
  entry.thread.on('message', ({ id, result, error }) => {
    const pending = wmoAssetWorkerPending.get(id);
    if (!pending) return;
    wmoAssetWorkerPending.delete(id);
    entry.busy = false;
    entry.current = null;
    if (error) pending.reject(new Error(error)); else pending.resolve(result);
    pumpWmoAssetWorkerQueue();
  });
  entry.thread.on('error', fail);
  entry.thread.on('exit', code => {
    if (code && !entry.removing) fail(new Error(`WMO asset worker stopped (${code})`));
  });
  wmoAssetWorkerPool.push(entry);
  return entry;
}

function ensureWmoAssetWorkerPool(target = wmoAssetWorkerTargetCount) {
  wmoAssetWorkerTargetCount = Math.max(1, Math.min(2, Number(target) || 1));
  while (wmoAssetWorkerPool.length < wmoAssetWorkerTargetCount) createWmoAssetWorker();
  for (const entry of [...wmoAssetWorkerPool]) {
    if (wmoAssetWorkerPool.length <= wmoAssetWorkerTargetCount || entry.busy) continue;
    entry.removing = true;
    wmoAssetWorkerPool.splice(wmoAssetWorkerPool.indexOf(entry), 1);
    void entry.thread.terminate();
  }
}

function pumpWmoAssetWorkerQueue() {
  ensureWmoAssetWorkerPool();
  for (const entry of wmoAssetWorkerPool) {
    if (entry.busy || !wmoAssetWorkerQueue.length) continue;
    const task = wmoAssetWorkerQueue.shift();
    entry.busy = true;
    entry.current = task;
    wmoAssetWorkerPending.set(task.id, { resolve: task.resolve, reject: task.reject });
    try {
      entry.thread.postMessage({ id: task.id, type: task.type, payload: task.payload });
    } catch (error) {
      wmoAssetWorkerPending.delete(task.id);
      entry.busy = false;
      entry.current = null;
      task.reject(error);
      pumpWmoAssetWorkerQueue();
    }
  }
}

function runWmoAssetWorker(type, payload) {
  if (type === 'readWmoAsset') ensureWmoAssetWorkerPool(getRuntimeResourceProfile().wmoWorkers);
  const id = ++assetWorkerRequestId;
  return new Promise((resolve, reject) => {
    wmoAssetWorkerQueue.push({ id, type, payload, resolve, reject });
    pumpWmoAssetWorkerQueue();
  });
}

// Compositeer 12 BLP-tiles (4 kolommen 3 rijen) naar PNG
// Hulpfunctie: zoek WORLDMAP-map
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

// ADT terrain parser
const UNIT_SIZE = 33.33333 / 8; // = 4.16666 yards per outer vertex step

// Read-only ADT inspector parser. It deliberately keeps uncertain fields raw or unresolved.
const ADT_INSPECTOR_CHUNKS = new Set([
  'MVER', 'MHDR', 'MCIN', 'MTEX', 'MMDX', 'MMID', 'MWMO', 'MWID',
  'MDDF', 'MODF', 'MCNK', 'MCVT', 'MCNR', 'MCLY', 'MCAL', 'MCSH', 'MCRF', 'MH2O',
]);

function adtChunkId(raw) {
  const direct = String(raw || '').slice(0, 4);
  const reversed = direct.split('').reverse().join('');
  return ADT_INSPECTOR_CHUNKS.has(direct) ? direct : ADT_INSPECTOR_CHUNKS.has(reversed) ? reversed : direct;
}

function adtSafeUInt(buf, offset) {
  return offset >= 0 && offset + 4 <= buf.length ? buf.readUInt32LE(offset) : null;
}

function adtSafeFloat(buf, offset) {
  return offset >= 0 && offset + 4 <= buf.length ? buf.readFloatLE(offset) : null;
}

function adtReadString(block, offset) {
  if (!block || offset == null || offset < 0 || offset >= block.length) return null;
  const end = block.indexOf(0, offset);
  return block.slice(offset, end < 0 ? block.length : end).toString('utf8').replace(/\//g, '\\');
}

function adtParseTopChunks(buf) {
  const chunks = [];
  const warnings = [];
  for (let offset = 0; offset + 8 <= buf.length;) {
    const rawId = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const type = adtChunkId(rawId);
    const end = offset + 8 + size;
    const valid = end <= buf.length;
    const item = { type, rawType: rawId, offset, size, valid, parsed: false, error: null };
    if (!valid) {
      item.error = `Chunk extends beyond file (${end} > ${buf.length})`;
      warnings.push(`parser bounds error: ${type} at 0x${offset.toString(16)}`);
      chunks.push(item);
      break;
    }
    chunks.push(item);
    offset = end;
  }
  if (chunks.length && chunks[chunks.length - 1].offset + 8 < buf.length && chunks[chunks.length - 1].valid) {
    warnings.push('Trailing bytes after top-level chunks');
  }
  return { chunks, warnings };
}

function adtFirstChunk(chunks, type) {
  return chunks.find(chunk => chunk.type === type && chunk.valid) || null;
}

function adtChunkData(buf, chunk) {
  return chunk && chunk.valid ? buf.subarray(chunk.offset + 8, chunk.offset + 8 + chunk.size) : null;
}

function adtStringList(data) {
  const result = [];
  if (!data) return result;
  let offset = 0;
  while (offset < data.length) {
    const end = data.indexOf(0, offset);
    if (end < 0) {
      if (offset < data.length) result.push(data.slice(offset).toString('utf8').replace(/\//g, '\\'));
      break;
    }
    if (end > offset) result.push(data.slice(offset, end).toString('utf8').replace(/\//g, '\\'));
    offset = end + 1;
  }
  return result;
}

function adtNestedChunk(buf, mcnkOffset, relativeOffset, expectedType) {
  if (!relativeOffset) return null;
  const offset = mcnkOffset + relativeOffset;
  if (offset < 0 || offset + 8 > buf.length) return { valid: false, offset, type: expectedType, error: 'Subchunk offset outside file' };
  const rawId = buf.toString('ascii', offset, offset + 4);
  const size = buf.readUInt32LE(offset + 4);
  const type = adtChunkId(rawId);
  const valid = offset + 8 + size <= buf.length;
  return { offset, size, type, rawType: rawId, valid, error: valid ? null : 'Subchunk extends beyond file' };
}

function adtParseDbcMap(buffer) {
  if (!buffer || buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'WDBC') return new Map();
  const count = buffer.readUInt32LE(4), recordSize = buffer.readUInt32LE(12);
  const recordsEnd = 20 + count * recordSize;
  if (!recordSize || recordsEnd > buffer.length) return new Map();
  const strings = buffer.subarray(recordsEnd);
  const result = new Map();
  for (let i = 0; i < count; i++) {
    const off = 20 + i * recordSize;
    const id = adtSafeUInt(buffer, off);
    if (id == null) continue;
    const mapId = adtSafeUInt(buffer, off + 4);
    const internal = adtReadString(strings, adtSafeUInt(buffer, off + 4));
    const display = adtReadString(strings, adtSafeUInt(buffer, off + 20));
    result.set(id, { id, internalName: internal || display || null, displayName: display || internal || null });
  }
  return result;
}

function adtParseAreaDbc(buffer) {
  if (!buffer || buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'WDBC') return new Map();
  const count = buffer.readUInt32LE(4), recordSize = buffer.readUInt32LE(12);
  const recordsEnd = 20 + count * recordSize;
  if (!recordSize || recordsEnd > buffer.length) return new Map();
  const strings = buffer.subarray(recordsEnd);
  const result = new Map();
  for (let i = 0; i < count; i++) {
    const off = 20 + i * recordSize;
    const id = adtSafeUInt(buffer, off);
    if (id == null) continue;
    result.set(id, {
      id,
      mapId: adtSafeUInt(buffer, off + 4),
      parentAreaId: adtSafeUInt(buffer, off + 8),
      flags: adtSafeUInt(buffer, off + 16),
      ambienceId: adtSafeUInt(buffer, off + 28),
      zoneMusicId: adtSafeUInt(buffer, off + 32),
      introSound: adtSafeUInt(buffer, off + 36),
      explorationLevel: adtSafeUInt(buffer, off + 40),
      factionGroupMask: adtSafeUInt(buffer, off + 112),
      name: adtReadString(strings, adtSafeUInt(buffer, off + 44)),
    });
  }
  return result;
}

async function adtReadSourceFile(reader, dataPath, overlayDataPath, internalPath, kind) {
  const read = async (sourcePath) => {
    if (!sourcePath) return null;
    if (kind === 'texture' && reader.readBlpFromMpqs) return reader.readBlpFromMpqs(sourcePath, internalPath);
    if (kind === 'm2' && reader.readM2FromMpqs) return reader.readM2FromMpqs(sourcePath, internalPath);
    return reader.readFileFromMpqs ? reader.readFileFromMpqs(sourcePath, internalPath) : null;
  };
  return (overlayDataPath ? await read(overlayDataPath) : null) || (dataPath ? await read(dataPath) : null);
}

function adtAssetPath(value) {
  return String(value || '').replace(/\//g, '\\').replace(/^\\+/, '');
}

async function adtResolveSource(config, sourceType, standalonePath, mapName, tileX, tileY, sourceDataPath = '', sourceAreaTablePath = '') {
  const reader = getMpqReader();
  const configuredCurrent = String(config?.worldmapMpqPath || '').trim();
  const currentPath = configuredCurrent && reader.resolveDataPath ? reader.resolveDataPath(configuredCurrent) : null;
  const label = sourceType === 'compare' ? 'Configured Compare Source' : sourceType === 'standalone' ? 'Standalone ADT File' : 'Configured Current Client';

  if (sourceType === 'standalone') {
    if (!standalonePath) return { success: false, error: 'No standalone ADT file selected.' };
    if (!fs.existsSync(standalonePath) || !fs.statSync(standalonePath).isFile()) return { success: false, error: 'Selected ADT file does not exist.' };
    if (!/\.adt$/i.test(standalonePath)) return { success: false, error: 'Select a file with the .adt extension.' };
    const dependency = currentPath && reader.isDataPath(currentPath) ? currentPath : null;
    const sourceInput = String(sourceDataPath || '').trim();
    const standaloneSource = sourceInput && reader.resolveDataPath ? reader.resolveDataPath(sourceInput) : null;
    if (sourceInput && (!standaloneSource || !reader.isDataPath(standaloneSource))) return { success: false, error: 'The standalone source Data folder is not a valid WoW client Data path.' };
    const areaTablePath = String(sourceAreaTablePath || '').trim();
    if (areaTablePath && (!fs.existsSync(areaTablePath) || !fs.statSync(areaTablePath).isFile())) return { success: false, error: 'The comparison AreaTable.dbc file does not exist.' };
    return { success: true, sourceType: 'standalone', label, standalonePath, dataPath: standaloneSource || null, overlayDataPath: null, sourceAreaTablePath: areaTablePath || null, dependencyPath: dependency, dependencyStatus: dependency ? 'Configured Current Client' : 'None', sourceDataStatus: standaloneSource ? 'Standalone source Data folder' : 'Not selected' };
  }

  if (!currentPath || !reader.isDataPath(currentPath)) {
    return { success: false, error: 'Current Client is Not configured in Settings.' };
  }
  if (sourceType === 'compare') {
    const compareInput = String(config?.worldCheckComparePath || '').trim();
    if (!compareInput) return { success: false, error: 'Compare Source is Not configured in Settings.' };
    const compare = reader.resolveLayeredSource ? reader.resolveLayeredSource(currentPath, compareInput) : null;
    if (!compare?.valid) return { success: false, error: 'Configured Compare Source is not a valid client or patch source.' };
    return { success: true, sourceType: 'compare', label, dataPath: compare.baseDataPath, overlayDataPath: compare.overlayDataPath, resolvedPath: compare.path, kind: compare.kind, dependencyPath: currentPath, dependencyStatus: 'Configured Current Client' };
  }
  return { success: true, sourceType: 'current', label, dataPath: currentPath, overlayDataPath: null, resolvedPath: currentPath, kind: 'client', dependencyPath: currentPath, dependencyStatus: 'Configured Current Client' };
}

async function adtListMapsForSource(source) {
  const reader = getMpqReader();
  const paths = new Set();
  for (const dataPath of [source.dataPath, source.overlayDataPath].filter(Boolean)) {
    const list = reader.collectListfilePaths ? await reader.collectListfilePaths(dataPath) : [];
    for (const value of list) paths.add(value.replace(/\//g, '\\'));
  }
  const maps = new Map();
  for (const value of paths) {
    const match = value.match(/^World\\Maps\\([^\\]+)\\([^\\]+)_(\d+)_(\d+)\.adt$/i);
    if (!match || match[1].toLowerCase() !== match[2].toLowerCase()) continue;
    const key = match[1].toLowerCase();
    if (!maps.has(key)) maps.set(key, { name: match[1], tiles: [], tileKeys: new Set() });
    const tile = { x: Number(match[3]), y: Number(match[4]) };
    const tileKey = `${tile.x}_${tile.y}`;
    if (!maps.get(key).tileKeys.has(tileKey)) {
      maps.get(key).tileKeys.add(tileKey);
      maps.get(key).tiles.push(tile);
    }
  }
  return [...maps.values()].sort((a, b) => a.name.localeCompare(b.name)).map(item => ({ name: item.name, tiles: item.tiles.sort((a, b) => a.y - b.y || a.x - b.x) }));
}

function adtFilenameCoordinates(filePath) {
  const name = path.basename(filePath || '');
  const match = name.match(/^([^_]+)_(\d+)_(\d+)\.adt$/i);
  return match ? { mapName: match[1], tileX: Number(match[2]), tileY: Number(match[3]) } : { mapName: null, tileX: null, tileY: null };
}

async function parseAdtInspector(buf, source, mapName, tileX, tileY) {
  const reader = getMpqReader();
  const warnings = [];
  const top = adtParseTopChunks(buf);
  warnings.push(...top.warnings);
  const byType = new Map();
  for (const chunk of top.chunks) if (!byType.has(chunk.type)) byType.set(chunk.type, chunk);
  const mver = adtChunkData(buf, byType.get('MVER'));
  const version = mver && mver.length >= 4 ? mver.readUInt32LE(0) : null;
  if (!byType.has('MVER')) warnings.push('Missing required chunk: MVER');
  if (!byType.has('MCIN')) warnings.push('Missing required chunk: MCIN');
  if (!byType.has('MCNK')) warnings.push('Missing required chunk: MCNK');

  const mtex = adtStringList(adtChunkData(buf, byType.get('MTEX')));
  const mmdx = adtStringList(adtChunkData(buf, byType.get('MMDX')));
  const mwmo = adtStringList(adtChunkData(buf, byType.get('MWMO')));
  const mmid = adtChunkData(buf, byType.get('MMID'));
  const mwid = adtChunkData(buf, byType.get('MWID'));
  const mddfData = adtChunkData(buf, byType.get('MDDF'));
  const modfData = adtChunkData(buf, byType.get('MODF'));
  const m2Placements = [];
  const wmoPlacements = [];
  if (mddfData && mddfData.length % 36) warnings.push('parser bounds error: MDDF has a partial record');
  if (modfData && modfData.length % 64) warnings.push('parser bounds error: MODF has a partial record');
  if (mddfData) for (let off = 0; off + 36 <= mddfData.length; off += 36) {
    const nameId = adtSafeUInt(mddfData, off);
    m2Placements.push({ index: m2Placements.length, nameId, path: null });
  }
  // Resolve placement strings from the original null-terminated list rather than reconstructing it.
  const mmdxBlock = adtChunkData(buf, byType.get('MMDX'));
  const mwmoBlock = adtChunkData(buf, byType.get('MWMO'));
  const m2PathsByOffset = new Map();
  const wmoPathsByOffset = new Map();
  for (let off = 0; off < (mmdxBlock?.length || 0);) { const value = adtReadString(mmdxBlock, off); if (value == null) break; m2PathsByOffset.set(off, adtAssetPath(value)); off += Buffer.byteLength(value, 'utf8') + 1; }
  for (let off = 0; off < (mwmoBlock?.length || 0);) { const value = adtReadString(mwmoBlock, off); if (value == null) break; wmoPathsByOffset.set(off, adtAssetPath(value)); off += Buffer.byteLength(value, 'utf8') + 1; }
  for (const item of m2Placements) item.path = m2PathsByOffset.get(mmid ? adtSafeUInt(mmid, item.nameId * 4) : -1) || null;
  if (modfData) for (let off = 0; off + 64 <= modfData.length; off += 64) {
    const nameId = adtSafeUInt(modfData, off);
    const pathOffset = mwid ? adtSafeUInt(mwid, nameId * 4) : null;
    wmoPlacements.push({ index: wmoPlacements.length, nameId, path: wmoPathsByOffset.get(pathOffset) || null });
  }

  const mcinChunk = byType.get('MCIN');
  const mcinData = adtChunkData(buf, mcinChunk);
  const mcinDataOffset = mcinChunk ? mcinChunk.offset + 8 : null;
  const readDependencyDbc = (internalPath) => source.dependencyPath
    ? Promise.race([
      adtReadSourceFile(reader, source.dependencyPath, null, internalPath, 'dbc'),
      new Promise(resolve => setTimeout(() => resolve(null), 3500)),
    ])
    : Promise.resolve(null);
  const readSourceDbc = (internalPath) => source.dataPath
    ? Promise.race([
      adtReadSourceFile(reader, source.dataPath, source.overlayDataPath, internalPath, 'dbc'),
      new Promise(resolve => setTimeout(() => resolve(null), 3500)),
    ])
    : Promise.resolve(null);
  const readSourceAreaTable = source.sourceAreaTablePath
    ? Promise.race([
      fs.promises.readFile(source.sourceAreaTablePath),
      new Promise(resolve => setTimeout(() => resolve(null), 3500)),
    ])
    : null;
  const [sourceAreaBuffer, sourceMapBuffer, targetAreaBuffer, targetMapBuffer] = await Promise.all([
    readSourceAreaTable || readSourceDbc('DBFilesClient\\AreaTable.dbc'),
    readSourceDbc('DBFilesClient\\Map.dbc'),
    readDependencyDbc('DBFilesClient\\AreaTable.dbc'),
    readDependencyDbc('DBFilesClient\\Map.dbc'),
  ]);
  const sourceAreas = adtParseAreaDbc(sourceAreaBuffer);
  const sourceMaps = adtParseDbcMap(sourceMapBuffer);
  const targetAreas = adtParseAreaDbc(targetAreaBuffer);
  const targetMaps = adtParseDbcMap(targetMapBuffer);
  let expectedMap = null;
  if (mapName) expectedMap = [...targetMaps.values()].find(row => row.internalName && row.internalName.toLowerCase() === mapName.toLowerCase()) || null;
  if (source.dataPath && !sourceAreaBuffer) warnings.push('Source AreaTable.dbc unresolved');
  if (source.dependencyPath && !targetAreaBuffer) warnings.push('Target AreaTable.dbc unresolved from current client');
  if (source.dependencyPath && !targetMapBuffer) warnings.push('Target Map.dbc unresolved from current client');
  if (!source.dependencyPath) warnings.push('Dependency source unavailable; names and assets are unresolved');

  const mh2oChunk = byType.get('MH2O');
  const mh2oData = adtChunkData(buf, mh2oChunk);
  const waterByIndex = new Map();
  let waterLayers = 0;
  if (mh2oData) {
    if (mh2oData.length < 256 * 32) warnings.push('parser bounds error: MH2O header table is truncated');
    for (let i = 0; i < Math.min(256, Math.floor(mh2oData.length / 32)); i++) {
      const layerCount = adtSafeUInt(mh2oData, i * 32 + 4) || 0;
      if (layerCount) { waterLayers += layerCount; waterByIndex.set(i, layerCount); }
    }
  }

  const textureExists = new Map(), m2Exists = new Map(), wmoExists = new Map();
  const resolveAssets = async (values, kind, output) => {
    if (!source.dependencyPath) return;
    const pending = [...new Set(values.filter(Boolean))].slice(0, 96);
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const value = pending[cursor++], key = value.toLowerCase();
        if (output.has(key)) continue;
        try {
          const raw = await Promise.race([
            adtReadSourceFile(reader, source.dataPath, source.overlayDataPath, value, kind),
            new Promise(resolve => setTimeout(() => resolve(null), 2500)),
          ]);
          output.set(key, raw == null ? null : !!raw);
        } catch (_) { output.set(key, false); }
      }
    };
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(8, pending.length) }, () => worker())),
      new Promise(resolve => setTimeout(resolve, 3500)),
    ]);
  };
  await resolveAssets(mtex, 'texture', textureExists);
  await resolveAssets(m2Placements.map(item => item.path), 'm2', m2Exists);
  await resolveAssets(wmoPlacements.map(item => item.path), 'wmo', wmoExists);

  const grid = [];
  const areaSummary = new Map();
  const parseMcnk = (index, entry) => {
    const ixExpected = index % 16, iyExpected = Math.floor(index / 16);
    const item = { index, ix: ixExpected, iy: iyExpected, offset: entry?.offset ?? null, size: entry?.size ?? null, valid: false, warnings: ['MCNK missing'], areaId: null, areaName: null, sourceAreaName: null, sourceMapId: null, targetAreaName: null, targetMapId: null, mapId: null, continentId: null, flags: null, position: { x: null, y: null, z: null }, heights: { count: 0, min: null, max: null, average: null, invalid: 0 }, textureLayers: [], doodadRefs: [], wmoRefs: [], water: { present: false, layers: 0 }, subchunks: {}, parsed: false };
    if (!entry?.offset) return item;
    if (entry.offset + 8 > buf.length) { item.warnings = ['MCNK offset outside file']; return item; }
    if (entry.magic !== 'MCNK') { item.warnings = ['MCIN offset invalid']; return item; }
    const rawChunk = top.chunks.find(chunk => chunk.offset === entry.offset);
    const chunkSize = rawChunk?.size ?? adtSafeUInt(buf, entry.offset + 4) ?? 0;
    if (entry.offset + 8 + chunkSize > buf.length) { item.warnings = ['MCNK offset outside file']; return item; }
    item.valid = true; item.parsed = true; item.size = chunkSize; item.warnings = [];
    const ds = entry.offset + 8;
    const flags = adtSafeUInt(buf, ds);
    const ix = adtSafeUInt(buf, ds + 4), iy = adtSafeUInt(buf, ds + 8);
    const nLayers = adtSafeUInt(buf, ds + 12) || 0;
    const nDoodad = adtSafeUInt(buf, ds + 16) || 0;
    const offsets = { MCVT: adtSafeUInt(buf, ds + 20), MCNR: adtSafeUInt(buf, ds + 24), MCLY: adtSafeUInt(buf, ds + 28), MCRF: adtSafeUInt(buf, ds + 32), MCAL: adtSafeUInt(buf, ds + 36), MCSH: adtSafeUInt(buf, ds + 44) };
    const sizeAlpha = adtSafeUInt(buf, ds + 40);
    const areaId = adtSafeUInt(buf, ds + 52), nWmo = adtSafeUInt(buf, ds + 56) || 0;
    const pos = { x: adtSafeFloat(buf, ds + 104), y: adtSafeFloat(buf, ds + 108), z: adtSafeFloat(buf, ds + 112) };
    Object.assign(item, { ix: ix ?? ixExpected, iy: iy ?? iyExpected, flags, areaId, position: pos });
    for (const [name, relative] of Object.entries(offsets)) {
      if (!relative) continue;
      const sub = adtNestedChunk(buf, entry.offset, relative, name);
      item.subchunks[name] = sub ? { offset: sub.offset, relativeOffset: relative, size: sub.size ?? null, valid: sub.valid, type: sub.type, error: sub.error } : null;
      if (!sub?.valid) item.warnings.push('parser bounds error');
    }
    const sourceArea = sourceAreas.get(areaId);
    const targetArea = targetAreas.get(areaId);
    if (sourceArea) { item.sourceAreaName = sourceArea.name || null; item.sourceMapId = sourceArea.mapId; }
    if (targetArea) { item.targetAreaName = targetArea.name || null; item.targetMapId = targetArea.mapId; item.mapId = targetArea.mapId; item.continentId = targetArea.mapId; if (expectedMap?.id != null && targetArea.mapId !== expectedMap.id) item.warnings.push('target area belongs to another map'); }
    if (!sourceArea && !targetArea && areaId != null) item.warnings.push('area ID does not exist in source or target AreaTable');
    const mcvt = adtNestedChunk(buf, entry.offset, offsets.MCVT, 'MCVT');
    if (mcvt?.valid && mcvt.size >= 580) {
      const values = []; let invalid = 0;
      for (let h = 0; h < 145; h++) { const value = adtSafeFloat(buf, mcvt.offset + 8 + h * 4); if (Number.isFinite(value)) values.push(value + (pos.z || 0)); else invalid++; }
      const min = values.length ? Math.min(...values) : null, max = values.length ? Math.max(...values) : null;
      item.heights = { count: 145, min, max, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, invalid };
    } else if (offsets.MCVT) item.warnings.push('parser bounds error: MCVT');
    const mcly = adtNestedChunk(buf, entry.offset, offsets.MCLY, 'MCLY');
    if (mcly?.valid) {
      const dataStart = mcly.offset + 8, available = Math.floor(mcly.size / 16);
      for (let layer = 0; layer < Math.min(nLayers, available, 4); layer++) {
        const lp = dataStart + layer * 16, textureIdx = adtSafeUInt(buf, lp), layerFlags = adtSafeUInt(buf, lp + 4);
        const row = { index: layer, textureIdx, path: textureIdx != null ? (mtex[textureIdx] || null) : null, exists: textureIdx != null && textureExists.has((mtex[textureIdx] || '').toLowerCase()) ? textureExists.get(mtex[textureIdx].toLowerCase()) : null, alphaAvailable: layer > 0 && !!(layerFlags & 0x100), flags: layerFlags };
        item.textureLayers.push(row);
        if (textureIdx == null || !mtex[textureIdx]) item.warnings.push('missing texture reference');
        else if (source.dependencyPath && textureExists.get(mtex[textureIdx].toLowerCase()) === false) item.warnings.push('missing texture reference');
      }
      if (nLayers > available) item.warnings.push('parser bounds error: MCLY');
    } else if (nLayers) item.warnings.push('parser bounds error: MCLY');
    const mcrf = adtNestedChunk(buf, entry.offset, offsets.MCRF, 'MCRF');
    if (mcrf?.valid) {
      const refs = []; for (let r = 0; r + 4 <= mcrf.size; r += 4) refs.push(adtSafeUInt(buf, mcrf.offset + 8 + r));
      item.doodadRefs = refs.slice(0, nDoodad).map(ref => ({ index: ref, ...(m2Placements[ref] || { path: null, exists: null }), exists: m2Placements[ref]?.path ? m2Exists.get(m2Placements[ref].path.toLowerCase()) : null }));
      item.wmoRefs = refs.slice(nDoodad, nDoodad + nWmo).map(ref => ({ index: ref, ...(wmoPlacements[ref] || { path: null, exists: null }), exists: wmoPlacements[ref]?.path ? wmoExists.get(wmoPlacements[ref].path.toLowerCase()) : null }));
      if (item.doodadRefs.some(ref => !ref.path || (source.dependencyPath && ref.exists === false))) item.warnings.push('missing M2 reference');
      if (item.wmoRefs.some(ref => !ref.path || (source.dependencyPath && ref.exists === false))) item.warnings.push('missing WMO reference');
    } else if (nDoodad || nWmo) item.warnings.push('parser bounds error: MCRF');
    item.water = { present: !!waterByIndex.get(index), layers: waterByIndex.get(index) || 0 };
    item.warnings = [...new Set(item.warnings)];
    if (item.areaId != null) { const summary = areaSummary.get(item.areaId) || { areaId: item.areaId, areaName: item.sourceAreaName, sourceAreaName: item.sourceAreaName, sourceMapId: item.sourceMapId, targetAreaName: item.targetAreaName, targetMapId: item.targetMapId, count: 0, warnings: new Set() }; summary.count++; item.warnings.forEach(warning => summary.warnings.add(warning)); areaSummary.set(item.areaId, summary); }
    return item;
  };

  for (let index = 0; index < 256; index++) {
    const entryOffset = mcinDataOffset != null && index * 16 + 16 <= (mcinData?.length || 0) ? mcinDataOffset + index * 16 : null;
    const entry = entryOffset == null ? null : { offset: adtSafeUInt(buf, entryOffset), size: adtSafeUInt(buf, entryOffset + 4), flags: adtSafeUInt(buf, entryOffset + 8), magic: null };
    if (entry?.offset && entry.offset + 4 <= buf.length) entry.magic = adtChunkId(buf.toString('ascii', entry.offset, entry.offset + 4));
    const chunk = parseMcnk(index, entry);
    if (entry?.offset && entry.size && entry.offset + 8 <= buf.length && entry.size !== adtSafeUInt(buf, entry.offset + 4)) chunk.warnings.push('MCIN offset invalid');
    grid.push(chunk);
  }
  if (!mcinData || mcinData.length < 256 * 16) warnings.push('MCIN is missing or truncated; MCNK grid is incomplete');
  const topKnown = new Set(top.chunks.map(chunk => chunk.type));
  for (const chunk of top.chunks) { if (!ADT_INSPECTOR_CHUNKS.has(chunk.type)) { chunk.error = chunk.error || 'Unsupported or unknown chunk'; warnings.push(`unsupported or unknown chunk: ${chunk.type}`); } else if (chunk.type !== 'MCNK') chunk.parsed = ['MVER', 'MHDR', 'MCIN', 'MTEX', 'MMDX', 'MMID', 'MWMO', 'MWID', 'MDDF', 'MODF', 'MH2O'].includes(chunk.type); }
  const required = ['MVER', 'MCIN', 'MCNK'];
  const missingRequired = required.filter(type => !topKnown.has(type));
  const detectedType = topKnown.has('MCNK') ? (topKnown.has('MH2O') ? 'ADT terrain + water' : 'ADT terrain') : topKnown.has('MODF') ? 'ADT object/root variant' : 'Unknown or malformed ADT';
  const allWarnings = [...new Set([...warnings, ...grid.flatMap(item => item.warnings)])];
  const sourceAreaChoicesById = new Map();
  for (const area of sourceAreas.values()) sourceAreaChoicesById.set(area.id, { id: area.id, name: area.name || null, mapId: area.mapId ?? null, parentAreaId: area.parentAreaId ?? null });
  const targetAreaChoicesById = new Map();
  for (const area of targetAreas.values()) {
    if (expectedMap?.id != null && area.mapId !== expectedMap.id) continue;
    targetAreaChoicesById.set(area.id, { id: area.id, name: area.name || null, mapId: area.mapId ?? null, parentAreaId: area.parentAreaId ?? null, flags: area.flags ?? 0, ambienceId: area.ambienceId ?? 0, zoneMusicId: area.zoneMusicId ?? 0, introSound: area.introSound ?? 0, explorationLevel: area.explorationLevel ?? 0, factionGroupMask: area.factionGroupMask ?? 0 });
  }
  for (const chunk of grid) {
    if (chunk.areaId == null) continue;
    if (!sourceAreaChoicesById.has(chunk.areaId)) sourceAreaChoicesById.set(chunk.areaId, { id: chunk.areaId, name: chunk.sourceAreaName || null, mapId: chunk.sourceMapId ?? null, parentAreaId: null });
  }
  return {
    success: true,
    source: { type: source.sourceType, label: source.label, path: source.resolvedPath || source.standalonePath || null, dependency: source.dependencyStatus, kind: source.kind || null },
    file: { name: source.standalonePath ? path.basename(source.standalonePath) : `${mapName}_${tileX}_${tileY}.adt`, relativePath: source.standalonePath ? path.basename(source.standalonePath) : `World\\Maps\\${mapName}\\${mapName}_${tileX}_${tileY}.adt`, bytes: buf.length, sha256: hashBuffer(buf) },
    coordinates: { mapName: mapName || null, tileX: tileX ?? null, tileY: tileY ?? null },
    overview: { version, detectedType, topChunks: top.chunks, missingRequired, warnings: allWarnings, readStatus: allWarnings.length ? 'Read with warnings' : 'Read successfully' },
    textures: mtex.map((texturePath, index) => ({ index, path: texturePath, exists: textureExists.has(texturePath.toLowerCase()) ? textureExists.get(texturePath.toLowerCase()) : null })),
    objects: { m2: m2Placements.map(item => ({ ...item, exists: item.path ? m2Exists.get(item.path.toLowerCase()) : null })), wmo: wmoPlacements.map(item => ({ ...item, exists: item.path ? wmoExists.get(item.path.toLowerCase()) : null })) },
    chunks: grid,
    areaSummary: [...areaSummary.values()].map(item => ({ areaId: item.areaId, areaName: item.sourceAreaName || item.areaName || null, sourceAreaName: item.sourceAreaName || null, sourceMapId: item.sourceMapId ?? null, targetAreaName: item.targetAreaName || null, targetMapId: item.targetMapId ?? null, mapId: item.targetMapId ?? item.mapId ?? null, chunkCount: item.count, status: item.warnings.size ? 'Warnings' : 'OK', warnings: [...item.warnings] })).sort((a, b) => a.areaId - b.areaId),
    sourceAreaChoices: [...sourceAreaChoicesById.values()].sort((a, b) => a.id - b.id),
    targetAreaChoices: [...targetAreaChoicesById.values()].sort((a, b) => a.id - b.id),
    water: { present: !!mh2oChunk, layers: waterLayers, liquidTypes: [], warnings: mh2oChunk ? ['Liquid type decoding is not included until the MH2O instance layout is verified.'] : [] },
  };
}

ipcMain.handle('adt:listMaps', async (_, { sourceType = 'current' } = {}) => {
  try {
    const cfgPath = getConfigPath();
    const config = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    const source = await adtResolveSource(config, sourceType);
    if (!source.success) return source;
    if (sourceType === 'standalone') return { success: true, data: [] };
    return { success: true, data: await adtListMapsForSource(source) };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('adt:inspect', async (_, { sourceType = 'current', standalonePath = '', sourceDataPath = '', sourceAreaTablePath = '', mapName = '', tileX = null, tileY = null } = {}) => {
  try {
    const cfgPath = getConfigPath();
    const config = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    const source = await adtResolveSource(config, sourceType, standalonePath, mapName, tileX, tileY, sourceDataPath, sourceAreaTablePath);
    if (!source.success) return source;
    let resolvedMap = mapName || null, resolvedX = Number.isInteger(Number(tileX)) ? Number(tileX) : null, resolvedY = Number.isInteger(Number(tileY)) ? Number(tileY) : null, buf = null;
    if (sourceType === 'standalone') {
      const coords = adtFilenameCoordinates(standalonePath);
      resolvedMap = coords.mapName; resolvedX = coords.tileX; resolvedY = coords.tileY;
      buf = fs.readFileSync(standalonePath);
    } else {
      if (!resolvedMap || resolvedX == null || resolvedY == null) return { success: false, error: 'Select a map and numeric tile X/Y.' };
      buf = await (source.overlayDataPath ? getMpqReader().readAdtBufferLayered(source.dataPath, source.overlayDataPath, resolvedMap, resolvedX, resolvedY) : getMpqReader().readAdtBuffer(source.dataPath, resolvedMap, resolvedX, resolvedY));
    }
    if (!buf) return { success: false, error: `ADT not found: ${resolvedMap || 'Unknown'}_${resolvedX ?? 'Unknown'}_${resolvedY ?? 'Unknown'}.adt` };
    const inspected = await parseAdtInspector(buf, source, resolvedMap, resolvedX, resolvedY);
    // Electron's structured clone rejects accidental Buffer/typed-array values. The inspector
    // response is intentionally JSON-shaped so malformed/variant ADTs cannot break the IPC call.
    return adtIpcSafe(inspected);
  } catch (e) { console.error('adt:inspect error:', e); return { success: false, error: e.message }; }
});

ipcMain.handle('adt:savePlacements', async (_, { mapName, placements = [] } = {}) => {
  try {
    const safeMapName = String(mapName || '').trim();
    if (!safeMapName || !/^[a-z0-9_ -]+$/i.test(safeMapName)) return { success: false, error: 'Invalid map name.' };
    if (!Array.isArray(placements) || !placements.length) return { success: false, error: 'No world placement changes to save.' };
    const dataPath = await currentClientDataPath();
    if (!dataPath) return { success: false, error: 'Current client Data path is not configured.' };
    const byTile = new Map();
    for (const placement of placements) {
      const tileKey = String(placement?.tileKey || '');
      const match = tileKey.match(/^(\d+)_(\d+)/);
      const tileX = Number(placement?.tileX ?? match?.[1]);
      const tileY = Number(placement?.tileY ?? match?.[2]);
      const uniqueId = Number(placement?.uniqueId);
      if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || !Number.isInteger(uniqueId) || uniqueId < 0) continue;
      const key = `${tileX}_${tileY}`;
      if (!byTile.has(key)) byTile.set(key, { tileX, tileY, placements: [] });
      byTile.get(key).placements.push({ ...placement, tileX, tileY, uniqueId });
    }
    if (!byTile.size) return { success: false, error: 'No valid ADT placement identities were supplied.' };

    const files = [];
    for (const { tileX, tileY, placements: tilePlacements } of byTile.values()) {
      const source = await getMpqReader().readAdtBuffer(dataPath, safeMapName, tileY, tileX);
      if (!source) return { success: false, error: `Could not read ${safeMapName}_${tileX}_${tileY}.adt from the client.` };
      const next = Buffer.from(source);
      let changed = 0;
      for (const placement of tilePlacements) {
        const chunk = placement.type === 'wmo'
          ? adtFirstChunk(adtParseTopChunks(next).chunks, 'MODF')
          : adtFirstChunk(adtParseTopChunks(next).chunks, 'MDDF');
        if (!chunk) continue;
        const data = adtChunkData(next, chunk);
        const stride = placement.type === 'wmo' ? 64 : 36;
        const recordOffset = placement.type === 'wmo' ? 4 : 4;
        let record = -1;
        for (let offset = 0; offset + stride <= data.length; offset += stride) {
          if (data.readUInt32LE(offset + recordOffset) === placement.uniqueId) { record = offset; break; }
        }
        if (record < 0) continue;
        const base = chunk.offset + 8 + record;
        const rawPosition = placement.position;
        const rawRotation = placement.rotation;
        if (!writePlacementVector(next, base + 8, rawPosition) || !writePlacementVector(next, base + 20, rawRotation)) continue;
        const scale = Number(placement.scale);
        if (Number.isFinite(scale) && scale > 0) {
          const scaleOffset = placement.type === 'wmo' ? base + 62 : base + 32;
          next.writeUInt16LE(Math.max(1, Math.min(65535, Math.round(scale * 1024))), scaleOffset);
        }
        changed += 1;
      }
      if (!changed) continue;
      const outputPath = adtTileOutputPath(safeMapName, tileX, tileY);
      stageWorldBinary(outputPath, next);
      files.push({ tileX, tileY, changed, outputPath, backupPath: `${outputPath}.bak` });
    }
    if (!files.length) return { success: false, error: 'No matching MDDF/MODF records were found.' };
    return { success: true, files, outputRoot: getUiOutputRoot(), message: `Staged ${files.reduce((sum, file) => sum + file.changed, 0)} placement change(s).` };
  } catch (e) {
    console.error('adt:savePlacements error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('wmo:saveDoodads', async (_, { placements = [] } = {}) => {
  try {
    if (!Array.isArray(placements) || !placements.length) return { success: false, error: 'No WMO doodad changes to save.' };
    const dataPath = await currentClientDataPath();
    if (!dataPath) return { success: false, error: 'Current client Data path is not configured.' };
    const byWmo = new Map();
    for (const placement of placements) {
      const modelPath = String(placement?.parentWmoPath || '').trim();
      const uniqueId = Number(placement?.uniqueId);
      if (!modelPath || !Number.isInteger(uniqueId) || uniqueId < 0) continue;
      if (!byWmo.has(modelPath.toLowerCase())) byWmo.set(modelPath.toLowerCase(), { modelPath, placements: [] });
      byWmo.get(modelPath.toLowerCase()).placements.push({ ...placement, uniqueId });
    }
    const files = [];
    for (const { modelPath, placements: rows } of byWmo.values()) {
      const source = await getMpqReader().readFileFromMpqs(dataPath, modelPath);
      if (!source) return { success: false, error: `Could not read WMO ${modelPath} from the client.` };
      const next = Buffer.from(source);
      const chunk = findBinaryChunk(next, ['MODD', 'DDOM']);
      if (!chunk) continue;
      let changed = 0;
      for (const placement of rows) {
        const base = chunk.dataOffset + placement.uniqueId * 40;
        if (base + 36 > chunk.dataOffset + chunk.size) continue;
        if (!writePlacementVector(next, base + 4, placement.position)) continue;
        const rotation = placement.rotation;
        if (!Array.isArray(rotation) || rotation.length !== 4 || !rotation.every(Number.isFinite)) continue;
        rotation.forEach((value, index) => next.writeFloatLE(Number(value), base + 16 + index * 4));
        const scale = Number(placement.scale);
        if (Number.isFinite(scale) && scale > 0) next.writeFloatLE(scale, base + 32);
        changed += 1;
      }
      if (!changed) continue;
      const outputPath = wmoOutputPath(modelPath);
      stageWorldBinary(outputPath, next);
      files.push({ modelPath, changed, outputPath, backupPath: `${outputPath}.bak` });
    }
    if (!files.length) return { success: false, error: 'No matching MODD records were found.' };
    return { success: true, files, outputRoot: getUiOutputRoot(), message: `Staged ${files.reduce((sum, file) => sum + file.changed, 0)} WMO doodad change(s).` };
  } catch (e) {
    console.error('wmo:saveDoodads error:', e);
    return { success: false, error: e.message };
  }
});

function adtSafeOutputSegment(value, fallback = 'unknown') {
  const normalized = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.\./g, '_').trim();
  return normalized || fallback;
}

function binaryTopChunks(buf) {
  const chunks = [];
  for (let offset = 0; offset + 8 <= buf.length;) {
    const rawType = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > buf.length) break;
    chunks.push({ rawType, offset, dataOffset, size });
    offset = dataOffset + size;
  }
  return chunks;
}

function findBinaryChunk(buf, ids) {
  const wanted = new Set(ids.map(id => String(id)));
  return binaryTopChunks(buf).find(chunk => wanted.has(chunk.rawType)) || null;
}

function writePlacementVector(buf, offset, values) {
  if (!Array.isArray(values) || values.length !== 3 || !values.every(Number.isFinite)) return false;
  values.forEach((value, index) => buf.writeFloatLE(Number(value), offset + index * 4));
  return true;
}

function stageWorldBinary(outputPath, buffer) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath)) fs.copyFileSync(outputPath, `${outputPath}.bak`);
  const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, outputPath);
}

async function currentClientDataPath() {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) return null;
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const configured = String(config?.worldmapMpqPath || '').trim();
  const reader = getMpqReader();
  const resolved = configured && reader.resolveDataPath ? reader.resolveDataPath(configured) : null;
  return resolved && reader.isDataPath(resolved) ? resolved : null;
}

function adtTileOutputPath(mapName, tileX, tileY) {
  const safeMap = adtSafeOutputSegment(mapName);
  return path.join(getUiOutputRoot(), 'World', 'Maps', safeMap, `${safeMap}_${tileX}_${tileY}.adt`);
}

function wmoOutputPath(modelPath) {
  const normalized = String(modelPath || '').replace(/\//g, '\\').replace(/^\\+/, '');
  const parts = normalized.split('\\').filter(Boolean).map(part => adtSafeOutputSegment(part));
  return path.join(getUiOutputRoot(), ...parts);
}

function adtIpcSafe(value, seen = new WeakSet()) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (Buffer.isBuffer(value)) return Array.from(value);
  if (Array.isArray(value)) return value.map(item => adtIpcSafe(item, seen));
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const plain = {};
  for (const [key, item] of Object.entries(value)) {
    try { plain[key] = adtIpcSafe(item, seen); } catch { plain[key] = null; }
  }
  seen.delete(value);
  return plain;
}

ipcMain.handle('adt:stageAreaIds', async (_, { sourceType = 'current', standalonePath = '', mapName = '', tileX = null, tileY = null, fromAreaId, toAreaId } = {}) => {
  try {
    const from = Number(fromAreaId), to = Number(toAreaId);
    if (!Number.isInteger(from) || from < 0 || !Number.isInteger(to) || to < 0) return { success: false, error: 'Area IDs must be non-negative integers.' };
    const cfgPath = getConfigPath();
    const config = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    const source = await adtResolveSource(config, sourceType, standalonePath, mapName, tileX, tileY);
    if (!source.success) return source;
    let resolvedMap = mapName || null, resolvedX = Number.isInteger(Number(tileX)) ? Number(tileX) : null, resolvedY = Number.isInteger(Number(tileY)) ? Number(tileY) : null, buf = null;
    if (sourceType === 'standalone') {
      const coords = adtFilenameCoordinates(standalonePath);
      resolvedMap = coords.mapName; resolvedX = coords.tileX; resolvedY = coords.tileY;
      buf = fs.readFileSync(standalonePath);
    } else {
      if (!resolvedMap || resolvedX == null || resolvedY == null) return { success: false, error: 'Select a map and tile before staging an AreaID change.' };
      buf = await (source.overlayDataPath ? getMpqReader().readAdtBufferLayered(source.dataPath, source.overlayDataPath, resolvedMap, resolvedX, resolvedY) : getMpqReader().readAdtBuffer(source.dataPath, resolvedMap, resolvedX, resolvedY));
    }
    if (!buf) return { success: false, error: 'The selected ADT could not be read.' };
    const staged = Buffer.from(buf);
    const top = adtParseTopChunks(staged);
    const mcin = adtFirstChunk(top.chunks, 'MCIN');
    const mcinData = adtChunkData(staged, mcin);
    const changed = [];
    for (let index = 0; index < 256; index++) {
      const entryOffset = mcin && index * 16 + 16 <= mcinData.length ? mcin.offset + 8 + index * 16 : null;
      const mcnkOffset = entryOffset == null ? null : adtSafeUInt(staged, entryOffset);
      const areaOffset = mcnkOffset != null ? mcnkOffset + 8 + 52 : null;
      if (areaOffset == null || areaOffset + 4 > staged.length || adtChunkId(staged.toString('ascii', mcnkOffset, mcnkOffset + 4)) !== 'MCNK') continue;
      if (adtSafeUInt(staged, areaOffset) !== from) continue;
      staged.writeUInt32LE(to, areaOffset);
      changed.push(index);
    }
    if (!changed.length) return { success: true, changed: 0, fromAreaId: from, toAreaId: to, message: `No MCNK chunks with AreaID ${from} were found.` };
    const fileName = source.standalonePath ? path.basename(source.standalonePath) : `${resolvedMap}_${resolvedX}_${resolvedY}.adt`;
    const outputRoot = path.join(getUiOutputRoot(), 'adt-staging');
    const outputDir = resolvedMap ? path.join(outputRoot, 'World', 'Maps', adtSafeOutputSegment(resolvedMap)) : path.join(outputRoot, 'Standalone');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, adtSafeOutputSegment(fileName, 'staged.adt'));
    fs.writeFileSync(outputPath, staged);
    return { success: true, changed: changed.length, indices: changed, fromAreaId: from, toAreaId: to, outputPath, sourcePath: source.standalonePath || source.resolvedPath || null, message: `Staged ${changed.length} MCNK AreaID change(s). Source was not modified.` };
  } catch (e) { console.error('adt:stageAreaIds error:', e); return { success: false, error: e.message }; }
});

ipcMain.handle('adt:stageAreaTableArea', async (_, { newAreaId = null, name = '', templateAreaId = 14, mapId = null, parentAreaId = null, flags = null, ambienceId = null, zoneMusicId = null, introSound = null, explorationLevel = null, factionGroupMask = null } = {}) => {
  try {
    const areaName = String(name || '').trim();
    if (!areaName) return { success: false, error: 'Enter a name for the new area.' };
    const templateId = Number(templateAreaId);
    if (!Number.isInteger(templateId) || templateId < 0) return { success: false, error: 'Select a valid target area template.' };
    const cfgPath = getConfigPath();
    const config = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    const reader = getMpqReader();
    const configuredCurrent = String(config?.worldmapMpqPath || '').trim();
    const currentPath = configuredCurrent && reader.resolveDataPath ? reader.resolveDataPath(configuredCurrent) : null;
    if (!currentPath || !reader.isDataPath(currentPath)) return { success: false, error: 'Current client is not configured.' };
    const raw = await reader.readFileFromMpqs(currentPath, 'DBFilesClient\\AreaTable.dbc');
    if (!raw || raw.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'AreaTable.dbc could not be read from the current client.' };
    const dbc = parseDbc(raw);
    const template = dbc.records.find(row => Number(row[0]) === templateId);
    if (!template) return { success: false, error: `Target AreaTable template ${templateId} was not found.` };
    const usedIds = new Set(dbc.records.map(row => Number(row[0])));
    let id = newAreaId === '' || newAreaId == null ? Math.max(...usedIds, 0) + 1 : Number(newAreaId);
    if (!Number.isInteger(id) || id < 1) return { success: false, error: 'New AreaID must be a positive integer.' };
    if (usedIds.has(id)) return { success: false, error: `AreaID ${id} already exists in the current client.` };
    const usedAreaBits = new Set(dbc.records.map(row => Number(row[3])));
    let areaBit = Math.max(...usedAreaBits, 0) + 1;
    while (usedAreaBits.has(areaBit)) areaBit++;
    const strings = createDbcStringAppender(dbc.stringBlock);
    const row = template.slice();
    row[0] = id;
    row[1] = mapId == null || mapId === '' ? row[1] : Number(mapId);
    row[2] = parentAreaId == null || parentAreaId === '' ? row[2] : Number(parentAreaId);
    row[3] = areaBit;
    const overrides = [[4, flags], [7, ambienceId], [8, zoneMusicId], [9, introSound], [10, explorationLevel], [28, factionGroupMask]];
    for (const [index, value] of overrides) if (value !== null && value !== '') {
      const nextValue = Number(value);
      if (!Number.isInteger(nextValue) || nextValue < 0) return { success: false, error: `AreaTable field ${index} must be a non-negative integer.` };
      row[index] = nextValue;
    }
    row[11] = strings.append(areaName);
    const rows = [...dbc.records, row].sort((a, b) => Number(a[0]) - Number(b[0]));
    const next = rebuildDbcBuffer(raw, rows, strings.build());
    const outputPath = path.join(getUiOutputRoot(), 'adt-staging', 'DBFilesClient', 'AreaTable.dbc');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, next);
    return { success: true, areaId: id, areaBit, name: areaName, templateAreaId: templateId, outputPath, message: `Staged AreaTable entry ${id} · ${areaName}. Source client was not modified.` };
  } catch (e) { console.error('adt:stageAreaTableArea error:', e); return { success: false, error: e.message }; }
});

function adtPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

ipcMain.handle('adt:prepareServerTile', async (_, { sourceType = 'current', standalonePath = '', mapName = '', tileX = null, tileY = null, tiles = [], stagedAdtPath = '', areaTablePath = '', selectedArtifacts = {}, buildPlan = {} } = {}) => {
  try {
    const artifacts = {
      adt: selectedArtifacts.adt !== false,
      areaTable: selectedArtifacts.areaTable === true,
    };
    const outputs = {
      map: buildPlan.map === true,
      vmap: buildPlan.vmap === true,
      mmap: buildPlan.mmap === true,
    };
    if (!artifacts.adt) return { success: false, error: 'The ADT tile is required for a server tile staging job.' };
    if (artifacts.areaTable && !areaTablePath) return { success: false, error: 'AreaTable.dbc is selected, but no staged AreaTable.dbc exists yet.' };
    const cfgPath = getConfigPath();
    const config = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    const source = await adtResolveSource(config, sourceType, standalonePath, mapName, tileX, tileY);
    if (!source.success) return source;

    let resolvedMap = mapName || null;
    let resolvedX = Number.isInteger(Number(tileX)) ? Number(tileX) : null;
    let resolvedY = Number.isInteger(Number(tileY)) ? Number(tileY) : null;
    if (sourceType === 'standalone') {
      const coords = adtFilenameCoordinates(standalonePath);
      resolvedMap = coords.mapName;
      resolvedX = coords.tileX;
      resolvedY = coords.tileY;
    }
    if (!resolvedMap || !Number.isInteger(resolvedX) || !Number.isInteger(resolvedY)) return { success: false, error: 'A map and numeric tile coordinates are required.' };

    const uiOutputRoot = path.resolve(getUiOutputRoot());
    const primaryTile = { x: resolvedX, y: resolvedY };
    const requestedTiles = (tiles.length ? tiles : [primaryTile]).map(tile => ({ x: Number(tile.x), y: Number(tile.y) }))
      .filter(tile => Number.isInteger(tile.x) && Number.isInteger(tile.y));
    const uniqueTiles = [...new Map(requestedTiles.map(tile => [`${tile.x}_${tile.y}`, tile])).values()];
    if (sourceType === 'standalone' && uniqueTiles.length > 1) return { success: false, error: 'A standalone ADT file can only prepare one tile at a time.' };
    if (!uniqueTiles.some(tile => tile.x === resolvedX && tile.y === resolvedY)) uniqueTiles.unshift(primaryTile);
    let adtBuffer;
    let inputPath = source.standalonePath || source.resolvedPath || null;
    if (stagedAdtPath) {
      const candidate = path.resolve(stagedAdtPath);
      if (!adtPathInside(uiOutputRoot, candidate) || !fs.existsSync(candidate)) return { success: false, error: 'The staged ADT path is invalid or outside the editor output.' };
      adtBuffer = fs.readFileSync(candidate);
      inputPath = candidate;
    } else if (sourceType === 'standalone') {
      adtBuffer = fs.readFileSync(standalonePath);
    } else {
      if (source.overlayDataPath) adtBuffer = await getMpqReader().readAdtBufferLayered(source.dataPath, source.overlayDataPath, resolvedMap, resolvedX, resolvedY);
      else adtBuffer = await getMpqReader().readAdtBuffer(source.dataPath, resolvedMap, resolvedX, resolvedY);
    }
    if (!adtBuffer || adtBuffer.length < 8) return { success: false, error: 'The selected ADT could not be read.' };

    const adtInputs = [{ tile: primaryTile, buffer: adtBuffer }];
    for (const tile of uniqueTiles) {
      if (tile.x === resolvedX && tile.y === resolvedY) continue;
      if (sourceType === 'standalone') continue;
      const buffer = source.overlayDataPath
        ? await getMpqReader().readAdtBufferLayered(source.dataPath, source.overlayDataPath, resolvedMap, tile.x, tile.y)
        : await getMpqReader().readAdtBuffer(source.dataPath, resolvedMap, tile.x, tile.y);
      if (!buffer || buffer.length < 8) return { success: false, error: `The selected client ADT ${resolvedMap} ${tile.x},${tile.y} could not be read.` };
      adtInputs.push({ tile, buffer });
    }

    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const jobId = `${stamp}-${adtSafeOutputSegment(resolvedMap)}-${resolvedX}-${resolvedY}${adtInputs.length > 1 ? `-batch-${adtInputs.length}` : ''}`;
    const jobRoot = path.join(uiOutputRoot, 'server-build', jobId);
    const mapFolder = adtSafeOutputSegment(resolvedMap);
    const overlayRoot = path.join(jobRoot, 'client-overlay');
    const overlayAdtPaths = adtInputs.map(({ tile, buffer }) => path.join(overlayRoot, 'World', 'Maps', mapFolder, `${mapFolder}_${tile.x}_${tile.y}.adt`));
    for (let index = 0; index < adtInputs.length; index += 1) {
      fs.mkdirSync(path.dirname(overlayAdtPaths[index]), { recursive: true });
      fs.writeFileSync(overlayAdtPaths[index], adtInputs[index].buffer);
    }
    const overlayAdtPath = overlayAdtPaths[0];

    let overlayAreaTablePath = null;
    let areaTableBuffer = null;
    let areaTableSource = null;
    if (artifacts.areaTable) {
      if (areaTablePath) {
        const candidate = path.resolve(areaTablePath);
        if (!adtPathInside(uiOutputRoot, candidate) || !fs.existsSync(candidate)) return { success: false, error: 'The staged AreaTable path is invalid or outside the editor output.' };
        areaTableBuffer = fs.readFileSync(candidate);
        areaTableSource = candidate;
      } else {
        const areaTableDataPath = source.dataPath || source.dependencyPath || null;
        if (!areaTableDataPath) return { success: false, error: 'AreaTable.dbc is selected, but no Current Client source is available.' };
        const reader = getMpqReader();
        for (const internalPath of ['DBFilesClient\\AreaTable.dbc', 'AreaTable.dbc']) {
          areaTableBuffer = await reader.readFileFromMpqs(areaTableDataPath, internalPath);
          if (areaTableBuffer) { areaTableSource = `${areaTableDataPath}:${internalPath}`; break; }
        }
        if (!areaTableBuffer) return { success: false, error: 'AreaTable.dbc could not be read from the Current Client.' };
      }
      overlayAreaTablePath = path.join(overlayRoot, 'DBFilesClient', 'AreaTable.dbc');
      fs.mkdirSync(path.dirname(overlayAreaTablePath), { recursive: true });
      fs.writeFileSync(overlayAreaTablePath, areaTableBuffer);
    }

    const manifest = {
      schemaVersion: 2,
      status: 'staged',
      warnings: [],
      errors: [],
      createdAt: new Date().toISOString(),
      map: { name: resolvedMap, id: mapIdForName(resolvedMap) ?? null },
      tile: { x: resolvedX, y: resolvedY },
      tiles: adtInputs.map(({ tile, buffer }, index) => ({ x: tile.x, y: tile.y, adt: path.relative(jobRoot, overlayAdtPaths[index]).replace(/\\/g, '\\'), bytes: buffer.length, sha256: hashBuffer(buffer) })),
      source: { type: sourceType, inputPath },
      overlay: {
        adt: path.relative(jobRoot, overlayAdtPath).replace(/\\/g, '\\'),
        adts: overlayAdtPaths.map(value => path.relative(jobRoot, value).replace(/\\/g, '\\')),
        areaTable: overlayAreaTablePath ? path.relative(jobRoot, overlayAreaTablePath).replace(/\\/g, '\\') : null,
      },
      selectedArtifacts: artifacts,
      buildPlan: outputs,
      files: { adtBytes: adtBuffer.length, adtSha256: hashBuffer(adtBuffer), adtCount: adtInputs.length, areaTableBytes: areaTableBuffer?.length || null, areaTableSha256: areaTableBuffer ? hashBuffer(areaTableBuffer) : null, areaTableSource },
      extractors: { map: outputs.map ? 'planned' : 'not selected', vmap: outputs.vmap ? 'planned' : 'not selected', mmap: outputs.mmap ? 'planned' : 'not selected' },
      note: 'Safe staging only. No client or server source files were modified.'
    };
    const manifestPath = path.join(jobRoot, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { success: true, jobId, jobRoot, overlayAdtPath, overlayAdtPaths, tileCount: adtInputs.length, overlayAreaTablePath, manifestPath, selectedArtifacts: artifacts, buildPlan: outputs, message: `Prepared server-data staging for ${resolvedMap} ${resolvedX},${resolvedY} and ${adtInputs.length - 1} neighboring tile(s). ${Object.values(artifacts).filter(Boolean).length} client item(s) selected; no extractor was run.` };
  } catch (e) { console.error('adt:prepareServerTile error:', e); return { success: false, error: e.message }; }
});

ipcMain.handle('adt:runMapExtractor', async (_, { jobRoot = '' } = {}) => {
  try {
    const uiOutputRoot = path.resolve(getUiOutputRoot());
    const resolvedJobRoot = path.resolve(jobRoot);
    const serverBuildRoot = path.join(uiOutputRoot, 'server-build');
    if (!adtPathInside(serverBuildRoot, resolvedJobRoot) || resolvedJobRoot === serverBuildRoot) return { success: false, error: 'The server-build job path is invalid.' };
    const manifestPath = path.join(resolvedJobRoot, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { success: false, error: 'The staging manifest was not found. Prepare the server tile first.' };
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.buildPlan?.map === false) return { success: false, error: 'The .map output is not selected in this staging job.' };
    const manifestTiles = Array.isArray(manifest.tiles) && manifest.tiles.length ? manifest.tiles : [{ x: manifest.tile?.x, y: manifest.tile?.y, adt: manifest.overlay?.adt }];
    const results = [];
    for (const tile of manifestTiles) {
      const relativeAdt = String(tile.adt || '').replace(/[\\/]+/g, path.sep);
      const adtPath = path.resolve(resolvedJobRoot, relativeAdt);
      if (!adtPathInside(resolvedJobRoot, adtPath) || !fs.existsSync(adtPath)) return { success: false, error: `The staged ADT is missing for tile ${tile.x},${tile.y}.` };
      results.push(extractAdtMapTile({ adtPath, outputRoot: path.join(resolvedJobRoot, 'server-output'), mapName: manifest.map?.name, mapId: manifest.map?.id, tileX: Number(tile.x), tileY: Number(tile.y) }));
    }
    const result = results[0];
    manifest.status = 'map-generated';
    manifest.extractors = { ...(manifest.extractors || {}), map: 'generated' };
    const mapWarnings = results.flatMap(item => item.warnings || []);
    manifest.warnings = [...(manifest.warnings || []).filter(item => item.phase !== 'map'), ...mapWarnings.map(message => ({ phase: 'map', message }))];
    manifest.outputs = { ...(manifest.outputs || {}), map: { path: path.relative(resolvedJobRoot, result.outputPath).replace(/\\/g, '\\'), files: results.map(item => ({ path: path.relative(resolvedJobRoot, item.outputPath).replace(/\\/g, '\\'), bytes: item.bytes, sha256: item.sha256, warnings: item.warnings })), count: results.length, bytes: result.bytes, sha256: result.sha256, warnings: mapWarnings } };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { success: true, ...result, results, manifestPath, message: `Generated .map for ${manifest.map?.name} ${manifestTiles.length} tile(s). Output: ${results.map(item => item.outputPath).join(', ')}` };
  } catch (e) { recordAdtManifestDiagnostic(jobRoot, 'error', 'map', e.message); console.error('adt:runMapExtractor error:', e); return { success: false, error: e.message }; }
});

function adtServerDataPaths(config) {
  const configuredMapsPath = String(config?.mapsPath || '').trim();
  if (!configuredMapsPath) return { error: 'Configure the AzerothCore maps path in Settings first.' };
  const mapsPath = path.resolve(configuredMapsPath);
  if (path.basename(mapsPath).toLowerCase() !== 'maps') return { error: 'The configured maps path must point to the server data\\maps folder.' };
  const dataRoot = path.dirname(mapsPath);
  const preferredRoot = config?.serverPaths?.worldExe && fs.existsSync(config.serverPaths.worldExe)
    ? path.dirname(config.serverPaths.worldExe)
    : path.dirname(dataRoot);
  const serverRoot = path.dirname(dataRoot);
  const toolPaths = resolveServerTools({ serverRoot, preferredRoot });
  return { mapsPath, vmapsPath: path.join(dataRoot, 'vmaps'), mmapsPath: path.join(dataRoot, 'mmaps'), dataRoot, serverRoot, toolRoot: preferredRoot, toolPaths };
}

function adtManifestPath(jobRoot) {
  return path.join(jobRoot, 'manifest.json');
}

function loadAdtBuildManifest(jobRoot, uiOutputRoot) {
  const serverBuildRoot = path.join(uiOutputRoot, 'server-build');
  const resolvedJobRoot = path.resolve(jobRoot);
  if (!adtPathInside(serverBuildRoot, resolvedJobRoot) || resolvedJobRoot === serverBuildRoot) throw new Error('The server-build job path is invalid.');
  const manifestPath = adtManifestPath(resolvedJobRoot);
  if (!fs.existsSync(manifestPath)) throw new Error('The staging manifest was not found. Prepare the server tile first.');
  return { resolvedJobRoot, manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
}

function recordAdtManifestDiagnostic(jobRoot, type, phase, message) {
  try {
    const uiOutputRoot = path.resolve(getUiOutputRoot());
    const { manifestPath, manifest } = loadAdtBuildManifest(jobRoot, uiOutputRoot);
    const key = type === 'error' ? 'errors' : 'warnings';
    manifest[key] = Array.isArray(manifest[key]) ? manifest[key] : [];
    manifest[key].push({ phase, message, at: new Date().toISOString() });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch { /* diagnostic persistence must not hide the original extractor error */ }
}

function stagedAdtFromManifest(resolvedJobRoot, manifest) {
  const relativeAdt = String(manifest.overlay?.adt || '').replace(/[\\/]+/g, path.sep);
  const adtPath = path.resolve(resolvedJobRoot, relativeAdt);
  if (!adtPathInside(resolvedJobRoot, adtPath) || !fs.existsSync(adtPath)) throw new Error('The staged ADT is missing from the job overlay.');
  return adtPath;
}

function stagedAdtsFromManifest(resolvedJobRoot, manifest) {
  const entries = Array.isArray(manifest.tiles) && manifest.tiles.length
    ? manifest.tiles
    : [{ x: manifest.tile?.x, y: manifest.tile?.y, adt: manifest.overlay?.adt }];
  return entries.map(tile => {
    const relativeAdt = String(tile.adt || '').replace(/[\\/]+/g, path.sep);
    const adtPath = path.resolve(resolvedJobRoot, relativeAdt);
    if (!adtPathInside(resolvedJobRoot, adtPath) || !fs.existsSync(adtPath)) throw new Error(`The staged ADT is missing for tile ${tile.x},${tile.y}.`);
    return { tileX: Number(tile.x), tileY: Number(tile.y), path: adtPath };
  });
}

ipcMain.handle('adt:inspectVmapDependencies', async (_, { jobRoot = '' } = {}) => {
  try {
    const uiOutputRoot = path.resolve(getUiOutputRoot());
    const { resolvedJobRoot, manifestPath, manifest } = loadAdtBuildManifest(jobRoot, uiOutputRoot);
    const configPath = getConfigPath();
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const server = adtServerDataPaths(config);
    if (server.error) return { success: false, error: server.error };
    if (!fs.existsSync(server.vmapsPath)) return { success: false, error: `Server vmaps directory not found: ${server.vmapsPath}` };
    const mapId = Number.isInteger(Number(manifest.map?.id)) ? Number(manifest.map.id) : mapIdForName(manifest.map?.name);
    const stagedAdts = stagedAdtsFromManifest(resolvedJobRoot, manifest);
    const stagedBuffers = stagedAdts.map(item => fs.readFileSync(item.path));
    const result = inspectVmapDependencies({
      adtPath: stagedAdts[0].path,
      adtBuffers: stagedBuffers.slice(1),
      adtEntries: stagedAdts.map((item, index) => ({ tileX: item.tileX, tileY: item.tileY, buffer: stagedBuffers[index] })),
      serverVmapsPath: server.vmapsPath,
      mapId,
      tileX: stagedAdts[0].tileX,
      tileY: stagedAdts[0].tileY,
    });
    manifest.extractors = { ...(manifest.extractors || {}), vmap: 'dependencies-inspected' };
    manifest.vmapDependencies = result;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return { success: true, ...result, manifestPath, message: result.message };
  } catch (e) { recordAdtManifestDiagnostic(jobRoot, 'error', 'vmap-dependencies', e.message); console.error('adt:inspectVmapDependencies error:', e); return { success: false, error: e.message }; }
});

ipcMain.handle('adt:runVmapExtractor', async (_, { jobRoot = '' } = {}) => {
  try {
    const uiOutputRoot = path.resolve(getUiOutputRoot());
    const { resolvedJobRoot, manifestPath, manifest } = loadAdtBuildManifest(jobRoot, uiOutputRoot);
    if (manifest.buildPlan?.vmap === false) return { success: false, error: 'The VMap output is not selected in this staging job.' };
    const configPath = getConfigPath();
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const server = adtServerDataPaths(config);
    if (server.error) return { success: false, error: server.error };
    const clientDataPath = String(config.worldmapMpqPath || '').trim();
    if (!clientDataPath || !getMpqReader().isDataPath(clientDataPath)) return { success: false, error: 'Configure a valid Current Client Data path in Settings first.' };
    const mapId = Number.isInteger(Number(manifest.map?.id)) ? Number(manifest.map.id) : mapIdForName(manifest.map?.name);
    const tileX = Number(manifest.tile?.x), tileY = Number(manifest.tile?.y);
    if (!Number.isInteger(mapId)) return { success: false, error: `No numeric map ID is known for ${manifest.map?.name || 'this map'}.` };
    const stagedAdts = stagedAdtsFromManifest(resolvedJobRoot, manifest);
    const reader = getMpqReader();
    const readClientFile = async names => {
      for (const name of names) {
        const buffer = await reader.readFileFromMpqs(clientDataPath, name);
        if (buffer) return buffer;
      }
      return null;
    };
    const mapDbcBuffer = await readClientFile(['DBFilesClient\\Map.dbc', 'Map.dbc']);
    const gameObjectDbcBuffer = await readClientFile(['DBFilesClient\\GameObjectDisplayInfo.dbc', 'GameObjectDisplayInfo.dbc']);
    const result = await runTargetVmap({
      jobRoot: resolvedJobRoot,
      clientDataPath,
      serverVmapsPath: server.vmapsPath,
      mpqEditorPath: config?.serverPaths?.mpqEditorExe || '',
      stagedAdtPath: stagedAdts[0].path,
      stagedAdts,
      mapDbcBuffer,
      gameObjectDbcBuffer,
      mapId,
      mapName: manifest.map?.name,
      tileX,
      tileY,
      toolPaths: server.toolPaths,
      onProgress: progress => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('adt:progress', progress);
      },
    });
    manifest.status = 'vmap-generated';
    manifest.extractors = { ...(manifest.extractors || {}), vmap: 'generated' };
    manifest.outputs = {
      ...(manifest.outputs || {}),
      vmap: { path: result.outputTile ? path.relative(resolvedJobRoot, result.outputTile).replace(/\\/g, '\\') : null, files: (result.outputTiles || []).map(item => ({ tileX: item.tileX, tileY: item.tileY, path: item.outputTile ? path.relative(resolvedJobRoot, item.outputTile).replace(/\\/g, '\\') : null, generated: item.generated !== false, included: item.included !== false, changed: item.changed === true, status: item.status || (item.generated === false ? 'no-collision' : item.changed ? 'changed' : 'unchanged'), referenceCount: item.referenceCount || 0, bytes: item.bytes })), count: result.outputTiles?.length || 1, bytes: result.tileBytes },
      vmapTree: { path: result.outputTree ? path.relative(resolvedJobRoot, result.outputTree).replace(/\\/g, '\\') : null, changed: result.treeChanged === true, bytes: result.treeBytes },
      vmapDelta: { changedFileCount: result.changedFileCount, changedBytes: result.changedBytes, generatedFileCount: result.generatedFileCount, files: result.changedFiles },
    };
    manifest.vmapDependencies = result.modelDependencies;
    const unresolved = result.modelDependencies?.unresolvedModels || [];
    const unresolvedByTile = (result.modelDependencies?.perTile || [])
      .filter(item => item.counts?.unresolved)
      .map(item => `${item.tileX},${item.tileY}: ${item.counts.unresolved}`)
      .join('; ');
    const unresolvedMessage = unresolvedByTile
      ? `${unresolved.length} referenced model asset(s) remain unresolved after VMap generation (${unresolvedByTile}).`
      : `${unresolved.length} referenced model asset(s) remain unresolved after VMap generation.`;
    manifest.warnings = [...(manifest.warnings || []).filter(item => item.phase !== 'vmap'), ...(unresolved.length ? [{ phase: 'vmap', code: 'unresolved-model-assets', message: unresolvedMessage }] : [])];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('adt:progress', { jobRoot: resolvedJobRoot, phase: 'complete', message: 'VMap generation complete', percent: 100 });
    const modelMessage = result.modelDependencies?.generatedModelAssets?.length
      ? ` ${result.modelDependencies.generatedModelAssets.length} collision model asset(s) generated.`
      : ' No new collision model assets were generated.';
    const tileMessage = result.outputTiles?.some(item => item.outputTile)
      ? `Output: ${result.outputTiles.filter(item => item.outputTile).map(item => item.outputTile).join(', ')}`
      : 'No changed collision tile was needed; the live VMap already matches.';
    return { success: true, ...result, manifestPath, message: `Generated VMap for ${manifest.map?.name} ${result.outputTiles?.length || 1} tile(s). ${tileMessage}.${modelMessage}` };
  } catch (e) { recordAdtManifestDiagnostic(jobRoot, 'error', 'vmap', e.message); console.error('adt:runVmapExtractor error:', e); return { success: false, error: e.message }; }
});

ipcMain.handle('adt:runMmapExtractor', async (_, { jobRoot = '' } = {}) => {
  try {
    const uiOutputRoot = path.resolve(getUiOutputRoot());
    const { resolvedJobRoot, manifestPath, manifest } = loadAdtBuildManifest(jobRoot, uiOutputRoot);
    if (manifest.buildPlan?.mmap === false) return { success: false, error: 'The MMAP output is not selected in this staging job.' };
    const configPath = getConfigPath();
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const server = adtServerDataPaths(config);
    if (server.error) return { success: false, error: server.error };
    const mapId = Number.isInteger(Number(manifest.map?.id)) ? Number(manifest.map.id) : mapIdForName(manifest.map?.name);
    const tiles = Array.isArray(manifest.tiles) && manifest.tiles.length ? manifest.tiles : [{ x: manifest.tile?.x, y: manifest.tile?.y }];
    const mapFiles = Array.isArray(manifest.outputs?.map?.files) ? manifest.outputs.map.files : [];
    const mmapTiles = tiles.map(tile => {
      const listed = mapFiles.find(item => Number(item.tileX ?? item.x) === Number(tile.x) && Number(item.tileY ?? item.y) === Number(tile.y));
      const mapRelative = String(listed?.path || (Number(tile.x) === Number(manifest.tile?.x) && Number(tile.y) === Number(manifest.tile?.y) ? manifest.outputs?.map?.path : '') || '').replace(/[\\/]+/g, path.sep);
      return { tileX: Number(tile.x), tileY: Number(tile.y), mapOutputPath: path.resolve(resolvedJobRoot, mapRelative || path.join('server-output', 'maps', mapFileName(mapId, Number(tile.x), Number(tile.y)))) };
    });
    if (mmapTiles.some(tile => !adtPathInside(resolvedJobRoot, tile.mapOutputPath) || !fs.existsSync(tile.mapOutputPath))) return { success: false, error: 'Generate all staged .map tiles before generating MMAP.' };
    const { tileX, tileY } = mmapTiles[0];
    const result = await runTargetMmap({ jobRoot: resolvedJobRoot, serverMapsPath: server.mapsPath, serverMmapsPath: server.mmapsPath, serverVmapsPath: server.vmapsPath, toolRoot: server.toolRoot, executablePath: server.toolPaths?.mmapGenerator, mapId, tileX, tileY, mapOutputPath: mmapTiles[0].mapOutputPath, tiles: mmapTiles, configPath: server.toolPaths?.mmapsConfig || path.join(server.toolRoot, 'mmaps-config.yaml'), onProgress: progress => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('adt:progress', progress);
    } });
    const outputs = { ...(manifest.outputs || {}), mmap: { path: path.relative(resolvedJobRoot, result.outputTile).replace(/\\/g, '\\'), files: (result.outputTiles || []).map(item => ({ tileX: item.tileX, tileY: item.tileY, path: path.relative(resolvedJobRoot, item.outputTile).replace(/\\/g, '\\'), bytes: item.bytes })), count: result.outputTiles?.length || 1, bytes: result.bytes, inputMapCount: result.inputMapCount, rootMatchesLive: result.rootMatchesLive, vmapInput: result.vmapInput } };
    if (result.outputMmap) outputs.mmapRoot = { path: path.relative(resolvedJobRoot, result.outputMmap).replace(/\\/g, '\\'), bytes: fs.statSync(result.outputMmap).size };
    manifest.status = 'mmap-generated';
    manifest.extractors = { ...(manifest.extractors || {}), mmap: 'generated' };
    manifest.warnings = [...(manifest.warnings || []).filter(item => item.phase !== 'mmap'), ...(result.rootMatchesLive === false ? [{ phase: 'mmap', code: 'root-mismatch', message: 'Generated 001.mmap differs from the live navmesh root.' }] : [])];
    manifest.outputs = outputs;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    const rootNote = result.rootMatchesLive === false ? ' WARNING: generated 001.mmap differs from the live navmesh root; do not deploy this output yet.' : result.rootMatchesLive === true ? ' Navmesh root matches the live server.' : '';
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('adt:progress', { jobRoot: resolvedJobRoot, phase: 'complete', message: 'MMAP generation complete', percent: 100 });
    const vmapNote = result.vmapInput?.source === 'staged-vmap-overlay'
      ? ` Used ${result.vmapInput.stagedFileCount} staged VMap file(s) over the live VMap base.`
      : ' Used the live server VMaps because this job has no generated VMap overlay.';
    return { success: true, ...result, manifestPath, message: `Generated MMAP for ${manifest.map?.name} ${result.outputTiles?.length || 1} tile(s) using ${result.inputMapCount} map input(s). Output: ${result.outputTiles?.map(item => item.outputTile).join(', ')}.${rootNote}${vmapNote}` };
  } catch (e) { recordAdtManifestDiagnostic(jobRoot, 'error', 'mmap', e.message); console.error('adt:runMmapExtractor error:', e); return { success: false, error: e.message }; }
});

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
    const holes    = buf.readUInt16LE(ds + 60);
    const offsMCVT = buf.readUInt32LE(ds + 20);
    const posX     = buf.readFloatLE(ds + 104);
    const posY     = buf.readFloatLE(ds + 108);
    const posZ     = buf.readFloatLE(ds + 112);

    if (!offsMCVT || mcnkOff + offsMCVT + 8 + 580 > buf.length) { chunks.push(null); continue; }

 // Valideer MCVT magic ('TVCM' = reversed 'MCVT')
 // ofsHeight is relatief aan mcnkOff (chunk start incl. 8-byte header), niet ds zelfde conventie als ofsLayer/ofsAlpha.
    const mcvtMagic = buf.slice(mcnkOff + offsMCVT, mcnkOff + offsMCVT + 4).toString('ascii');
    if (mcvtMagic !== 'TVCM') { chunks.push(null); continue; }

    const hStart = mcnkOff + offsMCVT + 8;
 // MCVT: 17 floats per rij: 9 outer + 8 inner (staggered centers)
 // outer[r][c] = hStart + (r*17 + c) * 4 (r=0..8, c=0..8)
 // inner[r][c] = hStart + (r*17 + 9 + c) * 4 (r=0..7, c=0..7)
    const outer = new Float32Array(9 * 9);
    const inner = new Float32Array(8 * 8);
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) {
        const v = buf.readFloatLE(hStart + (r * 17 + c) * 4);
        outer[r * 9 + c] = isFinite(v) ? v : 0;
      }
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const v = buf.readFloatLE(hStart + (r * 17 + 9 + c) * 4);
        inner[r * 8 + c] = isFinite(v) ? v : 0;
      }
    chunks.push({ ix, iy, posX, posY, posZ, holes, outer, inner });
  }
  return chunks;
}

function parseAdtHoles(buf) {
  let offset = 0;
  let mcinData = -1;
  while (offset + 8 <= buf.length) {
    const magic = buf.slice(offset, offset + 4).toString('ascii');
    const size = buf.readUInt32LE(offset + 4);
    if (magic === 'NICM') { mcinData = offset + 8; break; }
    if (!size) break;
    offset += 8 + size;
  }
  if (mcinData < 0 || mcinData + 256 * 16 > buf.length) return null;

  const holes = new Uint16Array(256);
  for (let index = 0; index < 256; index++) {
    const mcnkOff = buf.readUInt32LE(mcinData + index * 16);
    if (!mcnkOff || mcnkOff + 8 + 62 > buf.length) continue;
    if (buf.toString('ascii', mcnkOff, mcnkOff + 4) !== 'KNCM') continue;
    const dataStart = mcnkOff + 8;
    const ix = buf.readUInt32LE(dataStart + 4);
    const iy = buf.readUInt32LE(dataStart + 8);
    if (ix < 16 && iy < 16) holes[iy * 16 + ix] = buf.readUInt16LE(dataStart + 60);
  }
  return holes;
}

function findAdtTopChunk(buf, expectedType) {
  for (let offset = 0; offset + 8 <= buf.length;) {
    const rawType = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (adtChunkId(rawType) === expectedType) return { data: offset + 8, size };
    if (!Number.isFinite(size) || offset + 8 + size > buf.length) break;
    offset += 8 + size;
  }
  return null;
}

function parseAdtWater(buf, tileX, tileY) {
  const chunk = findAdtTopChunk(buf, 'MH2O');
  if (!chunk || chunk.size < 16 * 16 * 12) return [];

  const dataStart = chunk.data;
  const dataEnd = chunk.data + chunk.size;
  const tileSize = 533.33333;
  const unitSize = 33.33333 / 8;
  const baseWowY = (32 - tileY) * tileSize;
  const baseWowX = (32 - tileX) * tileSize;
  const layers = [];

  for (let chunkIndex = 0; chunkIndex < 256; chunkIndex++) {
    const header = dataStart + chunkIndex * 12;
    const offsetInstances = buf.readUInt32LE(header);
    const layerCount = buf.readUInt32LE(header + 4);
    if (!offsetInstances || !layerCount || offsetInstances + layerCount * 24 > chunk.size) continue;
    const chunkX = chunkIndex % 16;
    const chunkY = Math.floor(chunkIndex / 16);

    for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
      const info = dataStart + offsetInstances + layerIndex * 24;
      const liquidType = buf.readUInt16LE(info);
      const liquidObjectOrLvf = buf.readUInt16LE(info + 2);
      const heightLevel1 = buf.readFloatLE(info + 4);
      const heightLevel2 = buf.readFloatLE(info + 8);
      const xOffset = buf[info + 12];
      const yOffset = buf[info + 13];
      const width = Math.min(8 - Math.min(8, xOffset), buf[info + 14]);
      const height = Math.min(8 - Math.min(8, yOffset), buf[info + 15]);
      const offsetExistsBitmap = buf.readUInt32LE(info + 16);
      const offsetVertexData = buf.readUInt32LE(info + 20);
      if (!width || !height || xOffset > 8 || yOffset > 8) continue;

      const bitmapSize = Math.ceil((width * height) / 8);
      const bitmapStart = offsetExistsBitmap ? dataStart + offsetExistsBitmap : -1;
      const hasBitmap = bitmapStart >= dataStart
        && bitmapStart + bitmapSize <= dataEnd;

      const lvf = liquidObjectOrLvf < 42 ? liquidObjectOrLvf & 3 : 0;
      const vertexCount = (width + 1) * (height + 1);
      const vertexDataSize = [vertexCount * 5, vertexCount * 8, vertexCount, vertexCount * 9][lvf] || vertexCount * 4;
      const vertexStart = offsetVertexData ? dataStart + offsetVertexData : -1;
      const vertexEnd = vertexStart >= 0 ? Math.min(dataEnd, vertexStart + vertexDataSize) : -1;
      const positions = [];
      const indices = [];
      const vertexHeight = (x, y) => {
        const index = y * (width + 1) + x;
        const offset = vertexStart + index * 4;
        if (vertexStart >= 0 && [0, 1, 3].includes(lvf) && offset + 4 <= vertexEnd) {
          const value = buf.readFloatLE(offset);
          if (Number.isFinite(value)) return value;
        }
        return Number.isFinite(heightLevel1)
          ? heightLevel1
          : (Number.isFinite(heightLevel2) ? heightLevel2 : 0);
      };
      const addVertex = (x, y) => {
        const gridX = chunkX * 8 + xOffset + x;
        const gridY = chunkY * 8 + yOffset + y;
        positions.push(
          -(baseWowY - gridX * unitSize),
          vertexHeight(x, y),
          -(baseWowX - gridY * unitSize),
        );
        return positions.length / 3 - 1;
      };

      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const bit = y * width + x;
        const visible = !hasBitmap || (buf[bitmapStart + Math.floor(bit / 8)] & (1 << (bit % 8))) !== 0;
        if (!visible) continue;
        const tl = addVertex(x, y);
        const tr = addVertex(x + 1, y);
        const bl = addVertex(x, y + 1);
        const br = addVertex(x + 1, y + 1);
        indices.push(tl, bl, tr, tr, bl, br);
      }
      if (indices.length) layers.push({
        chunkX, chunkY, layerIndex, liquidType, flags: liquidObjectOrLvf, lvf,
        minHeight: heightLevel1, maxHeight: heightLevel2,
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
      });
    }
  }
  return layers;
}

const MAP_NAME_TO_ID = { Azeroth: 0, Kalimdor: 1, Expansion01: 530, Northrend: 571 };

function parseMapFile(buf) {
  if (buf.length < 44) return null;
  const heightMapOffset = buf.readUInt32LE(20);
  if (buf.length < heightMapOffset + 16) return null;
  const flags      = buf.readUInt32LE(heightMapOffset + 4);
  const gridHeight = buf.readFloatLE(heightMapOffset + 8);
  const gridMaxH   = buf.readFloatLE(heightMapOffset + 12);
  const dataStart  = heightMapOffset + 16;
  const V9C = 129 * 129, V8C = 128 * 128;
  const v9 = new Float32Array(V9C), v8 = new Float32Array(V8C);
  if (flags & 0x0001) { v9.fill(gridHeight); v8.fill(gridHeight); return { v9, v8 }; }
  if (flags & 0x0002) {
    if (buf.length < dataStart + V9C * 2 + V8C * 2) return null;
    const mult = (gridMaxH - gridHeight) / 65535;
    for (let i = 0; i < V9C; i++) v9[i] = gridHeight + buf.readUInt16LE(dataStart + i * 2) * mult;
    const s = dataStart + V9C * 2;
    for (let i = 0; i < V8C; i++) v8[i] = gridHeight + buf.readUInt16LE(s + i * 2) * mult;
  } else if (flags & 0x0004) {
    if (buf.length < dataStart + V9C + V8C) return null;
    const mult = (gridMaxH - gridHeight) / 255;
    for (let i = 0; i < V9C; i++) v9[i] = gridHeight + buf[dataStart + i] * mult;
    const s = dataStart + V9C;
    for (let i = 0; i < V8C; i++) v8[i] = gridHeight + buf[s + i] * mult;
  } else {
    if (buf.length < dataStart + V9C * 4 + V8C * 4) return null;
    for (let i = 0; i < V9C; i++) v9[i] = buf.readFloatLE(dataStart + i * 4);
    const s = dataStart + V9C * 4;
    for (let i = 0; i < V8C; i++) v8[i] = buf.readFloatLE(s + i * 4);
  }
  return { v9, v8 };
}

function chunksToV9V8(chunks) {
  const v9 = new Float32Array(129 * 129);
  const v8 = new Float32Array(128 * 128);
  const holes = new Uint16Array(256);
  for (const chunk of chunks) {
    if (!chunk) continue;
    const { ix, iy, posZ, outer, inner } = chunk;
    if (ix >= 0 && ix < 16 && iy >= 0 && iy < 16) holes[iy * 16 + ix] = chunk.holes || 0;
    const baseZ = isFinite(posZ) ? posZ : 0;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        v9[(iy * 8 + r) * 129 + (ix * 8 + c)] = baseZ + outer[r * 9 + c];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        v8[(iy * 8 + r) * 128 + (ix * 8 + c)] = baseZ + inner[r * 8 + c];
  }
  return { v9, v8, holes };
}

ipcMain.handle('adt:getTerrain', async (_, { mapName, tiles }) => {
  try {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) return { success: true, data: [] };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

    const mapsPath = cfg.mapsPath;
    const dataPath = cfg.worldmapMpqPath;
    if (mapsPath && fs.existsSync(mapsPath)) {
      const mapId = MAP_NAME_TO_ID[mapName] ?? 0;
      const result = [];
      for (const { tileX, tileY } of tiles) {
 // AzerothCore writes ADT <x>_<y> as MMM<y><x>.map. Renderer tileX/tileY
 // are already WoW grid X/Y, so no additional swap belongs here.
        const fname = `${String(mapId).padStart(3,'0')}${String(tileX).padStart(2,'0')}${String(tileY).padStart(2,'0')}.map`;
        const fpath = path.join(mapsPath, fname);
        if (!fs.existsSync(fpath)) continue;
        const rawBuf = fs.readFileSync(fpath);
        const parsed = parseMapFile(rawBuf);
        if (parsed) {
          let holes = null;
          if (dataPath && getMpqReader().isDataPath(dataPath)) {
            const adtBuf = await getMpqReader().readAdtBuffer(dataPath, mapName, tileY, tileX);
            holes = adtBuf ? parseAdtHoles(adtBuf) : null;
          }
          result.push({ tileX, tileY, ...parsed, ...(holes ? { holes } : {}) });
        }
      }
      return { success: true, data: result };
    }

    if (!dataPath || !getMpqReader().isDataPath(dataPath)) return { success: true, data: [] };

    const result = [];
    for (const { tileX, tileY } of tiles) {
      const buf = await getMpqReader().readAdtBuffer(dataPath, mapName, tileY, tileX);
      if (!buf) continue;
      const chunks = parseAdt(buf);
      if (chunks) {
        const v9v8 = chunksToV9V8(chunks);
        result.push({ tileX, tileY, ...v9v8 });
      }
    }
    return { success: true, data: result };
  } catch (e) {
    console.error('adt:getTerrain error:', e);
    return { success: false, error: e.message };
  }
});

// WDL: low-res heightmap van de hele map. MAOF = offsets, MARE = outer heights.
function parseWdl(buf) {
  let offset = 0;
  let maofData = -1;
  while (offset + 8 <= buf.length) {
    const magic = buf.toString('ascii', offset, offset + 4);
    const size  = buf.readUInt32LE(offset + 4);
    if (magic === 'FOAM') { maofData = offset + 8; break; }
    offset += 8 + size;
  }
  if (maofData === -1 || maofData + 64 * 64 * 4 > buf.length) return null;

  const tiles = [];
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const off = buf.readUInt32LE(maofData + (y * 64 + x) * 4);
      if (!off || off + 8 + 17 * 17 * 2 > buf.length) continue;
      if (buf.toString('ascii', off, off + 4) !== 'ERAM') continue;
      const ds = off + 8;
      const heights = new Int16Array(17 * 17);
      let minH = Infinity, maxH = -Infinity;
      for (let i = 0; i < 17 * 17; i++) {
        const v = buf.readInt16LE(ds + i * 2);
        heights[i] = v;
        if (v < minH) minH = v;
        if (v > maxH) maxH = v;
      }
      if (minH < -2000 || maxH > 3000 || (maxH - minH) > 1500) continue;
 // Zelfde index-swap als ADT bestandsnamen: file (x,y) renderer (tileX=y, tileY=x)
      tiles.push({ tileX: y, tileY: x, heights });
    }
  }
  return tiles;
}

ipcMain.handle('adt:getWdl', async (_, { mapName }) => {
  try {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) return { success: true, data: [] };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const dataPath = cfg.worldmapMpqPath;
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) return { success: true, data: [] };

    const buf = await getMpqReader().readWdlBuffer(dataPath, mapName);
    if (!buf) return { success: true, data: [] };
    return { success: true, data: parseWdl(buf) ?? [] };
  } catch (e) {
    console.error('adt:getWdl error:', e);
    return { success: false, error: e.message };
  }
});

const minimapTexCache = new Map(); // `${dataPath}|${mapName}|${tileX}|${tileY}` ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ dataURL

function parseWorldCheckAreas(buf) {
  if (!buf) return { counts: {}, totalChunks: 0 };
  let mcinData = -1;
  for (let offset = 0; offset + 8 <= buf.length;) {
    const magic = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (magic === 'NICM') { mcinData = offset + 8; break; }
    if (!size) break;
    offset += 8 + size;
  }
  if (mcinData < 0) return { counts: {}, totalChunks: 0 };

  const counts = {};
  let totalChunks = 0;
  for (let i = 0; i < 256; i++) {
    const mcnkOffset = buf.readUInt32LE(mcinData + i * 16);
    if (!mcnkOffset || mcnkOffset + 8 > buf.length || buf.toString('ascii', mcnkOffset, mcnkOffset + 4) !== 'KNCM') continue;
    const areaIdOffset = mcnkOffset + 8 + 52;
    if (areaIdOffset + 4 > buf.length) continue;
    const areaId = buf.readUInt32LE(areaIdOffset);
    counts[areaId] = (counts[areaId] || 0) + 1;
    totalChunks++;
  }
  return { counts, totalChunks };
}

function hashBuffer(buf) {
  return buf ? crypto.createHash('sha256').update(buf).digest('hex') : null;
}

function worldCheckTile(tileX, tileY) {
  return { tileX, tileY, fileName: `Kalimdor_${tileY}_${tileX}.adt` };
}

function worldCheckChunkMap(buf) {
  const chunks = new Map();
  if (!buf) return chunks;
  for (let offset = 0; offset + 8 <= buf.length;) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (offset + 8 + size > buf.length) break;
    chunks.set(id, { data: offset + 8, size });
    if (!size) break;
    offset += 8 + size;
  }
  return chunks;
}

function worldCheckStringAt(buf, chunk, offset) {
  if (!chunk || offset < 0 || offset >= chunk.size) return null;
  const start = chunk.data + offset;
  const end = buf.indexOf(0, start);
  return buf.toString('utf8', start, end < 0 ? chunk.data + chunk.size : end).replace(/\//g, '\\');
}

function worldCheckPlacementPaths(buf, listId, idsId) {
  const chunks = worldCheckChunkMap(buf);
  const list = chunks.get(listId);
  const ids = chunks.get(idsId);
  if (!list || !ids) return [];
  const paths = [];
  for (let offset = 0; offset + 4 <= ids.size; offset += 4) {
    const pathValue = worldCheckStringAt(buf, list, buf.readUInt32LE(ids.data + offset));
    if (pathValue) paths.push(pathValue);
  }
  return [...new Set(paths)];
}

function worldCheckTexturePaths(buf) {
  const chunks = worldCheckChunkMap(buf);
  const chunk = chunks.get('XETM');
  if (!chunk) return [];
  const paths = [];
  let offset = 0;
  while (offset < chunk.size) {
    const end = buf.indexOf(0, chunk.data + offset);
    if (end < 0 || end >= chunk.data + chunk.size) break;
    if (end > chunk.data + offset) paths.push(buf.toString('ascii', chunk.data + offset, end));
    offset = end - chunk.data + 1;
  }
  return [...new Set(paths)];
}

function parseWorldCheckReferences(buf) {
  const texturePaths = worldCheckTexturePaths(buf);
  const parsedLayers = parseAdtTextureLayers(buf);
  const m2Paths = worldCheckPlacementPaths(buf, 'XDMM', 'DIMM');
  const wmoPaths = worldCheckPlacementPaths(buf, 'OMWM', 'DIWM');
  return {
    textures: [...new Set((parsedLayers?.texturePaths?.length ? parsedLayers.texturePaths : texturePaths).map(value => value.replace(/\//g, '\\')))],
    m2: m2Paths,
    wmo: wmoPaths,
  };
}

const worldCheckAssetCache = new Map();

async function inspectWorldCheckAsset(reader, dataPath, type, assetPath) {
  const key = `${dataPath}|${type}|${assetPath.toLowerCase()}`;
  if (worldCheckAssetCache.has(key)) return worldCheckAssetCache.get(key);

  let buffer = null;
  try {
    if (type === 'texture' && reader.readBlpFromMpqs) buffer = await reader.readBlpFromMpqs(dataPath, assetPath);
    else if (type === 'm2' && reader.readM2FromMpqs) buffer = await reader.readM2FromMpqs(dataPath, assetPath);
    else if (reader.readFileFromMpqs) buffer = await reader.readFileFromMpqs(dataPath, assetPath);
  } catch (_) {
    buffer = null;
  }

  const result = buffer
    ? { path: assetPath, exists: true, bytes: buffer.length, sha256: hashBuffer(buffer) }
    : { path: assetPath, exists: false };
  worldCheckAssetCache.set(key, result);
  return result;
}

const worldCheckServerMapsCache = new Map();
const WORLD_CHECK_SERVER_MAP_PROBE = '0012835.map';

function resolveWorldCheckServerMapsPath(inputPath) {
  const root = String(inputPath || '').trim();
  if (!root) return null;
  if (worldCheckServerMapsCache.has(root)) return worldCheckServerMapsCache.get(root);
  if (!fs.existsSync(root)) {
    worldCheckServerMapsCache.set(root, null);
    return null;
  }

  const directProbe = path.join(root, WORLD_CHECK_SERVER_MAP_PROBE);
  if (fs.existsSync(directProbe)) {
    worldCheckServerMapsCache.set(root, root);
    return root;
  }

  const queue = [{ dir: root, depth: 0 }];
  const visited = new Set();
  while (queue.length) {
    const { dir, depth } = queue.shift();
    const key = path.resolve(dir).toLowerCase();
    if (visited.has(key) || depth > 8) continue;
    visited.add(key);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    if (entries.some(entry => entry.isFile() && entry.name.toLowerCase() === WORLD_CHECK_SERVER_MAP_PROBE)) {
      worldCheckServerMapsCache.set(root, dir);
      return dir;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  worldCheckServerMapsCache.set(root, null);
  return null;
}

const worldCheckServerDataCache = new Map();

function locateWorldCheckServerDir(inputPath, targetName) {
  const root = String(inputPath || '').trim();
  if (!root || !fs.existsSync(root)) return null;
  const stat = fs.statSync(root);
  const start = stat.isDirectory() ? root : path.dirname(root);
  const seeds = [start, path.dirname(start)].filter((value, index, values) => values.indexOf(value) === index);
  const queue = seeds.map(dir => ({ dir, depth: 0 }));
  const visited = new Set();
  while (queue.length) {
    const { dir, depth } = queue.shift();
    const key = path.resolve(dir).toLowerCase();
    if (visited.has(key) || depth > 8) continue;
    visited.add(key);
    if (path.basename(dir).toLowerCase() === targetName) return dir;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
}

function resolveWorldCheckServerDataPaths(inputPath) {
  const root = String(inputPath || '').trim();
  if (!root) return { maps: null, vmaps: null, mmaps: null };
  if (worldCheckServerDataCache.has(root)) return worldCheckServerDataCache.get(root);
  const result = {
    maps: locateWorldCheckServerDir(root, 'maps'),
    vmaps: locateWorldCheckServerDir(root, 'vmaps'),
    mmaps: locateWorldCheckServerDir(root, 'mmaps'),
  };
  worldCheckServerDataCache.set(root, result);
  return result;
}

function inspectWorldCheckServerMap(serverMapsPath, tileX, tileY) {
  if (!serverMapsPath) return { configured: false, exists: false, valid: null };
  const resolvedMapsPath = resolveWorldCheckServerMapsPath(serverMapsPath);
  const fileName = `001${String(tileX).padStart(2, '0')}${String(tileY).padStart(2, '0')}.map`;
  if (!resolvedMapsPath) return { configured: true, exists: false, valid: false, fileName, resolvedPath: null };
  const filePath = path.join(resolvedMapsPath, fileName);
  if (!fs.existsSync(filePath)) return { configured: true, exists: false, valid: false, fileName, resolvedPath: resolvedMapsPath };
  try {
    const buffer = fs.readFileSync(filePath);
    return { configured: true, exists: true, valid: !!parseMapFile(buffer), bytes: buffer.length, fileName, resolvedPath: resolvedMapsPath };
  } catch (e) {
    return { configured: true, exists: true, valid: false, fileName, resolvedPath: resolvedMapsPath, error: e.message };
  }
}

function inspectWorldCheckServerArtifact(directory, fileName) {
  if (!directory) return { exists: false, fileName };
  const filePath = path.join(directory, fileName);
  if (!fs.existsSync(filePath)) return { exists: false, fileName };
  try {
    const buffer = fs.readFileSync(filePath);
    return { exists: true, fileName, bytes: buffer.length, sha256: hashBuffer(buffer) };
  } catch (e) {
    return { exists: true, fileName, error: e.message };
  }
}

function inspectWorldCheckServerData(inputPath, tileX, tileY) {
  const configured = !!String(inputPath || '').trim();
  if (!configured) return { configured: false, paths: { maps: null, vmaps: null, mmaps: null }, map: null, vmap: null, mmap: null };
  const paths = resolveWorldCheckServerDataPaths(inputPath);
  const mapName = `001${String(tileX).padStart(2, '0')}${String(tileY).padStart(2, '0')}.map`;
  const vmapName = `001_${String(tileX).padStart(2, '0')}_${String(tileY).padStart(2, '0')}.vmtile`;
  const mmapName = `001${String(tileX).padStart(2, '0')}${String(tileY).padStart(2, '0')}.mmtile`;
  return {
    configured: true,
    paths,
    map: inspectWorldCheckServerArtifact(paths.maps, mapName),
    vmap: inspectWorldCheckServerArtifact(paths.vmaps, vmapName),
    mmap: inspectWorldCheckServerArtifact(paths.mmaps, mmapName),
    vmapRoot: inspectWorldCheckServerArtifact(paths.vmaps, '001.vmtree'),
    mmapRoot: inspectWorldCheckServerArtifact(paths.mmaps, '001.mmap'),
  };
}

function compareWorldCheckServerArtifact(current, compare) {
  const details = {
    current: current ? { exists: !!current.exists, fileName: current.fileName, bytes: current.bytes, sha256: current.sha256 } : { exists: false },
    compare: compare ? { exists: !!compare.exists, fileName: compare.fileName, bytes: compare.bytes, sha256: compare.sha256 } : { exists: false },
  };
  if (!compare?.configured) return { ...details, status: 'not-compared' };
  const currentExists = !!current?.exists;
  const compareExists = !!compare?.exists;
  if (currentExists && compareExists) return { ...details, status: current.sha256 === compare.sha256 ? 'identical' : 'modified' };
  if (currentExists) return { ...details, status: 'only-current' };
  if (compareExists) return { ...details, status: 'only-compare' };
  return { ...details, status: 'missing-both' };
}

function compareWorldCheckServerData(current, compare) {
  const compareConfigured = !!compare?.configured;
  return {
    configured: compareConfigured,
    map: { ...(current?.map || {}), ...(compareWorldCheckServerArtifact(current?.map, compare?.map)) },
    vmap: { ...(current?.vmap || {}), ...(compareWorldCheckServerArtifact(current?.vmap, compare?.vmap)) },
    mmap: { ...(current?.mmap || {}), ...(compareWorldCheckServerArtifact(current?.mmap, compare?.mmap)) },
  };
}

async function buildWorldCheckTile(reader, dataPath, serverMapsPath, serverComparePath, tileX, tileY, { withPreview = false, withReferences = false } = {}) {
  const tile = worldCheckTile(tileX, tileY);
  const adt = await reader.readAdtBuffer(dataPath, 'Kalimdor', tileY, tileX);
  tile.adt = adt ? { exists: true, bytes: adt.length, sha256: hashBuffer(adt) } : { exists: false };
  const areaInfo = parseWorldCheckAreas(adt);
  const durotarChunks = areaInfo.counts[14] || 0;
  const otherChunks = areaInfo.totalChunks - durotarChunks;
  tile.area = { counts: areaInfo.counts, totalChunks: areaInfo.totalChunks, durotarChunks };
  tile.zoneStatus = !adt ? 'missing' : durotarChunks === 0 ? 'adjacent' : otherChunks ? 'mixed' : 'durotar';
  tile.preview = { exists: false };

  if (withPreview && reader.readMinimapBlp) {
    const minimap = await reader.readMinimapBlp(dataPath, 'Kalimdor', tileY, tileX);
    if (minimap) {
      try {
        const decoded = decodeBLP(minimap);
        tile.preview = {
          exists: true,
          bytes: minimap.length,
          sha256: hashBuffer(minimap),
          png: `data:image/png;base64,${rgbaToPNG(decoded.rgba, decoded.w, decoded.h).toString('base64')}`,
        };
      } catch (e) {
        tile.preview.error = `Minimap decode failed: ${e.message}`;
      }
    }
  }

  tile.references = { textures: [], m2: [], wmo: [] };
  if (withReferences && adt) {
    const referencePaths = parseWorldCheckReferences(adt);
    for (const type of ['textures', 'm2', 'wmo']) {
      const assetType = type === 'textures' ? 'texture' : type;
      for (const referencePath of referencePaths[type]) {
        tile.references[type].push(await inspectWorldCheckAsset(reader, dataPath, assetType, referencePath));
      }
    }
  }
  const allReferences = Object.values(tile.references).flat();
  tile.referenceSummary = {
    total: allReferences.length,
    found: allReferences.filter(reference => reference.exists).length,
    missing: allReferences.filter(reference => !reference.exists).length,
  };
  tile.serverData = inspectWorldCheckServerData(serverMapsPath, tileX, tileY);
  tile.serverCompareData = inspectWorldCheckServerData(serverComparePath, tileX, tileY);
  tile.serverCompare = compareWorldCheckServerData(tile.serverData, tile.serverCompareData);
  tile.serverMap = {
    ...(tile.serverData.map || {}),
    configured: !!serverMapsPath,
    valid: !!tile.serverData.map?.exists,
    resolvedPath: tile.serverData.paths.maps,
  };
  tile.status = !tile.adt.exists ? 'missing' : withReferences ? (tile.referenceSummary.missing ? 'missing-assets' : 'complete') : 'pending';
  return tile;
}

function compareWorldCheckAdt(currentTile, compareAdt) {
  const currentExists = !!currentTile?.adt?.exists;
  const compareExists = !!compareAdt;
  const compare = compareExists ? { exists: true, bytes: compareAdt.length, sha256: hashBuffer(compareAdt) } : { exists: false };
  let status = 'not-configured';
  if (currentExists && compareExists) status = currentTile.adt.sha256 === compare.sha256 ? 'identical' : 'modified';
  else if (currentExists) status = 'only-current';
  else if (compareExists) status = 'only-compare';
  else status = 'missing-both';
  return { compare, status };
}

ipcMain.handle('worldcheck:scanDurotar', async (_, { dataPath, serverMapsPath, serverComparePath = '', lightweight = false, compareDataPath = '' }) => {
  try {
    const reader = getMpqReader();
    const resolvedPath = reader.resolveDataPath ? reader.resolveDataPath(dataPath) : dataPath;
    if (!resolvedPath || !reader.isDataPath(resolvedPath)) {
      return { success: false, error: 'No WoW Data folder with MPQ files was found at the selected path.' };
    }
    const compareSourceInfo = compareDataPath && reader.resolveLayeredSource
      ? reader.resolveLayeredSource(resolvedPath, compareDataPath)
      : compareDataPath ? { valid: !!compareDataPath, path: compareDataPath, kind: 'client', baseDataPath: compareDataPath, overlayDataPath: null } : null;

    const wdt = reader.readWdtBuffer ? await reader.readWdtBuffer(resolvedPath, 'Kalimdor') : null;
    const wdl = reader.readWdlBuffer ? await reader.readWdlBuffer(resolvedPath, 'Kalimdor') : null;
    const result = [];

    for (let tileY = 35; tileY <= 45; tileY++) {
      for (let tileX = 28; tileX <= 35; tileX++) {
        const tile = await buildWorldCheckTile(reader, resolvedPath, serverMapsPath, serverComparePath, tileX, tileY, { withPreview: !lightweight, withReferences: !lightweight });
        if (compareSourceInfo?.valid) {
          const compareAdt = reader.readAdtBufferLayered
            ? await reader.readAdtBufferLayered(compareSourceInfo.baseDataPath, compareSourceInfo.overlayDataPath, 'Kalimdor', tileY, tileX)
            : await reader.readAdtBuffer(compareSourceInfo.path, 'Kalimdor', tileY, tileX);
          const comparison = compareWorldCheckAdt(tile, compareAdt);
          tile.compare = comparison.compare;
          tile.compareStatus = comparison.status;
        } else {
          tile.compare = { exists: false };
          tile.compareStatus = compareDataPath ? 'compare-invalid' : 'not-configured';
        }
        result.push(tile);
      }
    }

    return {
      success: true,
      sourcePath: resolvedPath,
      compareSource: compareDataPath ? {
        configured: true,
        path: compareSourceInfo?.path || compareDataPath,
        valid: !!compareSourceInfo?.valid,
        kind: compareSourceInfo?.kind || null,
        basePath: compareSourceInfo?.baseDataPath || null,
        overlayPath: compareSourceInfo?.overlayDataPath || null,
      } : { configured: false, path: '', valid: null, kind: null, basePath: null, overlayPath: null },
      zone: { mapId: 1, mapName: 'Kalimdor', zoneName: 'Durotar', tileX: [28, 35], tileY: [35, 45] },
      mapFiles: {
        wdt: wdt ? { exists: true, bytes: wdt.length, sha256: hashBuffer(wdt) } : { exists: false },
        wdl: wdl ? { exists: true, bytes: wdl.length, sha256: hashBuffer(wdl) } : { exists: false },
      },
      serverValidation: {
        configured: !!serverMapsPath,
        found: result.filter(tile => tile.serverMap.exists).length,
        valid: result.filter(tile => tile.serverMap.valid).length,
        missing: result.filter(tile => serverMapsPath && !tile.serverMap.exists).length,
        resolvedPath: result.find(tile => tile.serverMap.resolvedPath)?.serverMap.resolvedPath || null,
      },
      serverDataValidation: {
        configured: !!serverMapsPath,
        compareConfigured: !!serverComparePath,
        maps: result.filter(tile => tile.serverData?.map?.exists).length,
        vmaps: result.filter(tile => tile.serverData?.vmap?.exists).length,
        mmaps: result.filter(tile => tile.serverData?.mmap?.exists).length,
        compareMaps: result.filter(tile => tile.serverCompareData?.map?.exists).length,
        compareVmaps: result.filter(tile => tile.serverCompareData?.vmap?.exists).length,
        compareMmaps: result.filter(tile => tile.serverCompareData?.mmap?.exists).length,
      },
      tiles: result,
    };
  } catch (e) {
    console.error('worldcheck:scanDurotar error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('adt:getWater', async (_, { mapName, tiles }) => {
  try {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) return { success: true, data: [] };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const dataPath = cfg.worldmapMpqPath;
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) return { success: true, data: [] };
    const reader = getMpqReader();
    const rows = await Promise.all((tiles || []).map(async ({ tileX, tileY }) => {
      const buf = await reader.readAdtBuffer(dataPath, mapName, tileY, tileX);
      if (!buf) return null;
      const layers = parseAdtWater(buf, tileX, tileY);
      return layers.length ? { tileX, tileY, layers } : null;
    }));
    return { success: true, data: rows.filter(Boolean) };
  } catch (e) {
    console.error('adt:getWater error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('worldcheck:getPreviews', async (_, { dataPath, overlayDataPath = '', tiles }) => {
  try {
    const reader = getMpqReader();
    const legacySource = dataPath && typeof dataPath === 'object' ? dataPath : null;
    const baseInputPath = legacySource?.baseDataPath || dataPath;
    const overlayInputPath = legacySource?.overlayDataPath || overlayDataPath;
    const resolvedPath = reader.resolveDataPath ? reader.resolveDataPath(baseInputPath) : baseInputPath;
    if (!resolvedPath || !reader.isDataPath(resolvedPath)) return { success: false, error: 'No WoW Data folder with MPQ files was found at the selected path.' };
    const resolvedOverlayPath = overlayInputPath && reader.resolveDataPath ? reader.resolveDataPath(overlayInputPath) : overlayInputPath;
    if (overlayInputPath && (!resolvedOverlayPath || !reader.isDataPath(resolvedOverlayPath))) return { success: false, error: 'The compare overlay is not a valid WoW Data or patch folder.' };
    const requestedTiles = tiles || [];
    const requests = requestedTiles.map(tile => ({ tileX: tile.tileY, tileY: tile.tileX }));
    const buffers = resolvedOverlayPath && reader.readMinimapBlpBatchLayered
      ? await reader.readMinimapBlpBatchLayered(resolvedPath, resolvedOverlayPath, 'Kalimdor', requests)
      : reader.readMinimapBlpBatch ? await reader.readMinimapBlpBatch(resolvedPath, 'Kalimdor', requests) : [];
    const previews = [];
    const failures = [];
    for (const row of buffers) {
      try {
        const decoded = decodeBLP(row.buffer);
        previews.push({ tileX: row.tileY, tileY: row.tileX, bytes: row.buffer.length, sha256: hashBuffer(row.buffer), png: `data:image/png;base64,${rgbaToPNG(decoded.rgba, decoded.w, decoded.h).toString('base64')}` });
      } catch (e) {
        failures.push({ tileX: row.tileY, tileY: row.tileX, error: e.message });
      }
    }
    if (requestedTiles.length && !previews.length) return { success: false, error: `No minimap previews could be decoded (${buffers.length} BLP files were found).`, requested: requestedTiles.length, found: buffers.length, failures };
    return { success: true, previews, requested: requestedTiles.length, found: previews.length, missing: Math.max(0, requestedTiles.length - buffers.length), failures };
  } catch (e) {
    console.error('worldcheck:getPreviews error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('worldcheck:inspectTile', async (_, { dataPath, serverMapsPath, serverComparePath = '', tileX, tileY, withPreview = false }) => {
  try {
    const reader = getMpqReader();
    const resolvedPath = reader.resolveDataPath ? reader.resolveDataPath(dataPath) : dataPath;
    if (!resolvedPath || !reader.isDataPath(resolvedPath)) return { success: false, error: 'No WoW Data folder with MPQ files was found at the selected path.' };
    const tile = await buildWorldCheckTile(reader, resolvedPath, serverMapsPath, serverComparePath, Number(tileX), Number(tileY), { withPreview, withReferences: true });
    return { success: true, tile };
  } catch (e) {
    console.error('worldcheck:inspectTile error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('worldcheck:exportServerData', async (_, { serverMapsPath, tiles = [] }) => {
  try {
    const resolvedMapsPath = resolveWorldCheckServerMapsPath(serverMapsPath);
    if (!resolvedMapsPath) return { success: false, error: 'No Durotar server maps folder was found below the selected path.' };
    const safeTiles = [...new Map((tiles || []).map(tile => [
      `${Number(tile.tileX)}_${Number(tile.tileY)}`,
      { tileX: Number(tile.tileX), tileY: Number(tile.tileY) },
    ]).values())].filter(tile => Number.isInteger(tile.tileX) && Number.isInteger(tile.tileY) && tile.tileX >= 28 && tile.tileX <= 35 && tile.tileY >= 35 && tile.tileY <= 45);
    if (!safeTiles.length) return { success: false, error: 'Select at least one Durotar tile before exporting.' };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportRoot = path.join(__dirname, '..', 'output', 'WorldCompare', 'Durotar', timestamp);
    const mapsRoot = path.join(exportRoot, 'server-data', 'maps');
    fs.mkdirSync(mapsRoot, { recursive: true });
    const exported = [];
    const missing = [];
    for (const tile of safeTiles) {
      const fileName = `001${String(tile.tileX).padStart(2, '0')}${String(tile.tileY).padStart(2, '0')}.map`;
      const sourceFile = path.join(resolvedMapsPath, fileName);
      if (!fs.existsSync(sourceFile)) {
        missing.push({ ...tile, fileName });
        continue;
      }
      const destinationFile = path.join(mapsRoot, fileName);
      fs.copyFileSync(sourceFile, destinationFile);
      exported.push({ ...tile, fileName, bytes: fs.statSync(destinationFile).size });
    }
    if (!exported.length) return { success: false, error: 'None of the selected tiles had a server .map file.', missing };

    const manifest = {
      format: 'azeroth-editor-world-compare-server-data-v1',
      createdAt: new Date().toISOString(),
      zone: { mapId: 1, mapName: 'Kalimdor', zoneName: 'Durotar', tileX: [28, 35], tileY: [35, 45] },
      source: { selectedRoot: serverMapsPath, resolvedMapsPath },
      export: { type: 'maps-only-staging', directServerWrite: false, selectedTiles: safeTiles, exported, missing },
      nextStep: 'Review this staging package before any manual deployment. VMAP/MMAP regeneration is a separate extractor step.',
    };
    fs.writeFileSync(path.join(exportRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    fs.writeFileSync(path.join(exportRoot, 'README.md'), [
      '# Azeroth Editor World Compare export',
      '',
      'This is a read-only staging package for selected Durotar server map tiles.',
      'Nothing was written to the live server data.',
      '',
      `Selected tiles: ${safeTiles.length}`,
      `Exported .map files: ${exported.length}`,
      `Missing .map files: ${missing.length}`,
      '',
      'The server-data/maps folder contains only the selected .map files.',
      'Regenerate and review vmaps/mmaps separately when geometry changes require it.',
      'See manifest.json for source paths and tile details.',
      '',
    ].join('\r\n'), 'utf8');
    return { success: true, outputPath: exportRoot, mapsPath: mapsRoot, exported, missing, manifestPath: path.join(exportRoot, 'manifest.json') };
  } catch (e) {
    console.error('worldcheck:exportServerData error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('adt:getTileTextures', async (_, { mapName, tiles }) => {
  try {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) return { success: true, data: [] };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const dataPath = cfg.worldmapMpqPath;
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) return { success: true, data: [] };

    const result = [];
    for (const { tileX, tileY } of tiles) {
      const key = `${dataPath}|${mapName}|${tileX}|${tileY}`;
      let png = minimapTexCache.get(key);
      if (png === undefined) {
 // Zelfde index-swap als readAdtBuffer: bestandsnaam is map<Y>_<X>.blp
        const buf = await getMpqReader().readMinimapBlp(dataPath, mapName, tileY, tileX);
        if (buf) {
          try {
            const { rgba, w, h } = decodeBLP(buf);
            png = `data:image/png;base64,${rgbaToPNG(rgba, w, h).toString('base64')}`;
          } catch (_) { png = null; }
        } else {
          png = null;
        }
        minimapTexCache.set(key, png);
      }
      if (png) result.push({ tileX, tileY, png });
    }
    return { success: true, data: result };
  } catch (e) {
    console.error('adt:getTileTextures error:', e);
    return { success: false, error: e.message };
  }
});

// ADT composite texture builder
// Terrain compositing (in main process, geen IPC round-trip voor ruwe BLPs)
// Zelfde logica als de oude terrainCompositor.worker.js, maar draait hier zodat
// alleen de finale RGBA via IPC gaat in plaats van meerdere ruwe BLPs.

// Bilineaire resize van een RGBA buffer naar vaste afmetingen terrain-textures in WoW zijn
// meestal 256x256, maar sommige sets wijken af. We normaliseren naar gemeenschappelijke
// afmeting zodat alle textures van een tile in dezelfde DataArrayTexture-laag passen.
function resizeRgbaTo(data, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return data;
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) / dh) * sh - 0.5;
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) / dw) * sw - 0.5;
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const di = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = data[i00 + c] * (1 - tx) + data[i10 + c] * tx;
        const bot = data[i01 + c] * (1 - tx) + data[i11 + c] * tx;
        out[di + c] = top * (1 - ty) + bot * ty;
      }
    }
  }
  return out;
}

// GPU shader-based terrain blending (vervangt CPU pre-compositing zie Editor3DScene.jsx
// TerrainTile voor de shader die dit consumeert). In plaats van geflatte lage-resolutie
// texture per tile te bakken (resolutie-gelimiteerd bij 8x tiling, zie git-history), sturen we
// per-tile een gededuped texture-palette + per-chunk layer-indices + per-chunk alpha-maps. De
// shader doet de blend (Noggit's formule: t0*(1-(a0+a1+a2)) + t1*a0 + t2*a1 + t3*a2) live, op
// volle native textuur-resolutie per fragment.
const PALETTE_TEX_SIZE = 256;

function buildTilePalette(blpRgba, chunks) {
 // Palette: gededuped lijst van alle gebruikte texture-indices in deze tile.
  const usedIdx = [...new Set(chunks.filter(Boolean).flatMap(c => c.layers.map(l => l.textureIdx)))]
    .filter(idx => blpRgba[idx]);
  const idxToSlot = new Map(usedIdx.map((idx, slot) => [idx, slot]));
  const n = Math.max(1, usedIdx.length);

  const paletteRgba = new Uint8Array(n * PALETTE_TEX_SIZE * PALETTE_TEX_SIZE * 4);
  usedIdx.forEach((idx, slot) => {
    const blp = blpRgba[idx];
    const resized = resizeRgbaTo(blp.data, blp.w, blp.h, PALETTE_TEX_SIZE, PALETTE_TEX_SIZE);
    paletteRgba.set(resized, slot * PALETTE_TEX_SIZE * PALETTE_TEX_SIZE * 4);
  });

 // Per chunk: tot 4 palette-slots (layer0..3), -1 = ongebruikt. Float32 zodat de renderer dit
 // direct als DataTexture (RGBAFormat/FloatType) kan gebruiken en met texelFetch kan opzoeken.
  const chunkTexIndices = new Float32Array(256 * 4).fill(-1);
 // Per chunk: 64x64 alpha-laag, R=layer1, G=layer2, B=layer3 (layer0 = impliciete basis, geen alpha nodig).
  const chunkAlpha = new Uint8Array(256 * 64 * 64 * 4);

  for (let i = 0; i < 256; i++) {
    const chunk = chunks[i];
    if (!chunk || !chunk.layers.length) continue;
 // Doel-index = chunk.iy*16+chunk.ix (expliciet, niet de MCIN-loopvolgorde i) zelfde
 // conventie als parseAdt's v9/v8-vulling. MCIN-volgorde == iy*16+ix klopt meestal, maar
 // niet aannemen: zelfde axis-bug-klasse die dit project al eerder had bij tile-indexing.
    const ci = chunk.iy * 16 + chunk.ix;
    if (ci < 0 || ci > 255) continue;
    const { layers } = chunk;
    for (let li = 0; li < Math.min(4, layers.length); li++) {
      const slot = idxToSlot.get(layers[li].textureIdx);
      chunkTexIndices[ci * 4 + li] = slot === undefined ? -1 : slot;
    }
    const base = ci * 64 * 64 * 4;
    for (let li = 1; li < Math.min(4, layers.length); li++) {
      const alphaMap = layers[li].alphaMap;
      if (!alphaMap) continue;
      const channel = li - 1; // 0=R(layer1), 1=G(layer2), 2=B(layer3)
      for (let p = 0; p < 4096; p++) {
        chunkAlpha[base + p * 4 + channel] = alphaMap[p];
      }
    }
  }

  return { paletteRgba, paletteW: PALETTE_TEX_SIZE, paletteH: PALETTE_TEX_SIZE, paletteCount: n, chunkTexIndices, chunkAlpha };
}

function decompressAlpha(buf, offset, maxOffset) {
  const out = new Uint8Array(4096);
  let outPos = 0, pos = offset;
  while (outPos < 4096 && pos < maxOffset) {
    const ctrl = buf[pos++];
    const count = ctrl & 0x7f;  // geen +1: zelfde als TrinityCore / MangosSuperUI
    if (count === 0) break;
    if (ctrl & 0x80) {
      const val = buf[pos++];
      for (let i = 0; i < count && outPos < 4096; i++) out[outPos++] = val;
    } else {
      for (let i = 0; i < count && outPos < 4096; i++) out[outPos++] = buf[pos++];
    }
  }
  return out;
}

function unpackAlpha4bit(buf, offset, doNotFixAlpha = false) {
 // 2048 bytes: per byte twee nibbles (laag = eerste texel, hoog = tweede texel)
 // Output: = 4096 bytes, 8 bit per texel
  const out = new Uint8Array(4096);
  let inIdx = 0;
  for (let x = 0; x < 64; x++) {
    for (let y = 0; y < 64; y += 2) {
      const packed = buf[offset + inIdx++];
      const lo = packed & 0x0f, hi = (packed >> 4) & 0x0f;
      out[x * 64 + y]     = lo | (lo << 4);
      out[x * 64 + y + 1] = hi | (hi << 4);
    }
  }
 // Garbage in laatste rij/kolom (4-bit formaat quirk) alleen fixen als de chunk niet al
 // gefixt is opgeslagen (do_not_fix_alpha_map), anders overschrijf je geldige data.
  if (!doNotFixAlpha) {
    for (let e = 0; e < 64; e++) {
      out[e * 64 + 63] = out[e * 64 + 62];
      out[63 * 64 + e] = out[62 * 64 + e];
    }
    out[63 * 64 + 63] = out[62 * 64 + 62];
  }
  return out;
}

// WDT MPHD.flags is de autoritatieve bron voor bigAlpha (niet ADT's eigen MHDR.flags zie wowdev.wiki).
// 0x4 = adt_has_big_alpha, 0x80 = adt_has_height_texturing (beide impliceren 4096-byte flat alphamaps).
const wdtFlagsCache = new Map(); // mapName ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ bool | null (null = onbekend, gebruik heuristiek)

function parseWdtBigAlpha(buf) {
  if (!buf) return null;
  let off = 12; // na MVER chunk (8 header + 4 data)
  while (off + 8 <= buf.length) {
    const magic = buf.slice(off, off + 4).toString('ascii');
    const size  = buf.readUInt32LE(off + 4);
    if (magic === 'DHPM') { // 'MPHD' reversed
      const flags = buf.readUInt32LE(off + 8);
      return (flags & 0x4) !== 0 || (flags & 0x80) !== 0;
    }
    if (size === 0) break;
    off += 8 + size;
  }
  return null;
}

async function getWdtBigAlpha(dataPath, mapName) {
  if (wdtFlagsCache.has(mapName)) return wdtFlagsCache.get(mapName);
  let result = null;
  try {
    const buf = await getMpqReader().readWdtBuffer(dataPath, mapName);
    result = parseWdtBigAlpha(buf);
  } catch (e) {
  }
  wdtFlagsCache.set(mapName, result);
  return result;
}

function parseAdtTextureLayers(buf, wdtBigAlpha = null) {
  let off = 0, mtexData = -1, mtexSize = 0, mcinData = -1;

 // bigAlpha: true/false als WDT MPHD.flags bekend is (autoritatief), anders null gap-heuristiek per layer.
 // ADT's eigen MHDR.flags is GEEN geldige bron voor dit veld (zie wowdev.wiki) alleen voor logging.
  const bigAlpha = wdtBigAlpha;
  let mhdrFlagsLog = null;
  if (buf.length > 24 && buf.slice(12, 16).toString('ascii') === 'RDHM') {
    mhdrFlagsLog = buf.readUInt32LE(20);
  }

  while (off + 8 <= buf.length) {
    const magic = buf.slice(off, off + 4).toString('ascii');
    const size  = buf.readUInt32LE(off + 4);
    if (magic === 'XETM') { mtexData = off + 8; mtexSize = size; }
    if (magic === 'NICM') { mcinData = off + 8; }
    if (mtexData !== -1 && mcinData !== -1) break;
    if (size === 0) break;
    off += 8 + size;
  }
  if (mcinData === -1) return null;

 // MTEX: null-terminated texture paths
  const texturePaths = [];
  if (mtexData !== -1) {
    let tp = mtexData;
    while (tp < mtexData + mtexSize) {
      const end = buf.indexOf(0, tp);
      if (end === -1 || end >= mtexData + mtexSize) break;
      if (end > tp) texturePaths.push(buf.slice(tp, end).toString('ascii'));
      tp = end + 1;
    }
  }

  const chunks = [];
  for (let i = 0; i < 256; i++) {
    const mcnkOff = buf.readUInt32LE(mcinData + i * 16);
    if (!mcnkOff || mcnkOff + 8 > buf.length) { chunks.push(null); continue; }
    if (buf.slice(mcnkOff, mcnkOff + 4).toString('ascii') !== 'KNCM') { chunks.push(null); continue; }

    const ds       = mcnkOff + 8;
    const mcnkFlags = buf.readUInt32LE(ds);
 // do_not_fix_alpha_map (bit16, 0x10000): Noggit zet dit bij het opslaan van een chunk om aan
 // te geven dat de rand-duplicatie-fix (rij/kolom 63 = 62) AL is toegepast bij het schrijven,
 // en dus niet nogmaals moet gebeuren bij het lezen (anders overschrijf je geldige data met
 // gedupliceerde buren). Zie Noggit alphamap.cpp/MapChunk.cpp:1376.
    const doNotFixAlpha = (mcnkFlags & 0x10000) !== 0;
    const ix       = buf.readUInt32LE(ds + 4);
    const iy       = buf.readUInt32LE(ds + 8);
    const nLayers  = buf.readUInt32LE(ds + 12);
    const ofsLayer = buf.readUInt32LE(ds + 28); // 0x1C
    const ofsAlpha = buf.readUInt32LE(ds + 36); // 0x24
    const sizeAlpha = buf.readUInt32LE(ds + 40); // 0x28

    if (!nLayers || !ofsLayer) { chunks.push({ ix, iy, layers: [] }); continue; }

 // MCLY: max 4 records van 16 bytes
 // ofsLayer/ofsAlpha zijn relatief aan mcnkOff (chunk-start incl. 8-byte FourCC+size header),
 // NIET aan ds (=mcnkOff+8, chunk-data start) zie Noggit MapChunk.cpp: ofsLayer = lCurrentPosition - lMCNK_Position.
    const mclyPos = mcnkOff + ofsLayer;
    if (mclyPos + 8 > buf.length) { chunks.push({ ix, iy, layers: [] }); continue; }
    let mclyDataOff, mclyDataSize;
    const mclyMagic = buf.slice(mclyPos, mclyPos + 4).toString('ascii');
    if (mclyMagic === 'YLCM') {
      mclyDataSize = buf.readUInt32LE(mclyPos + 4);
      mclyDataOff  = mclyPos + 8;
    } else {
      mclyDataOff  = mclyPos;
      mclyDataSize = nLayers * 16;
    }

    const layerCount = Math.min(nLayers, 4, Math.floor(mclyDataSize / 16));
    const layers = [];
    for (let l = 0; l < layerCount; l++) {
      const lp = mclyDataOff + l * 16;
      if (lp + 16 > buf.length) break;
      layers.push({
        textureIdx:   buf.readUInt32LE(lp),
        flags:        buf.readUInt32LE(lp + 4),
        offsetInMcal: buf.readUInt32LE(lp + 8),
      });
    }

 // MCAL: alpha maps voor layer 1-3
    if (ofsAlpha > 0 && sizeAlpha > 0 && layers.length > 1) {
      const mcalPos = mcnkOff + ofsAlpha;
      if (mcalPos + 4 <= buf.length) {
        let mcalDataOff, mcalDataSize;
        if (buf.slice(mcalPos, mcalPos + 4).toString('ascii') === 'LACM') {
          mcalDataSize = buf.readUInt32LE(mcalPos + 4);
          mcalDataOff  = mcalPos + 8;
        } else {
          mcalDataOff  = mcalPos;
          mcalDataSize = sizeAlpha;
        }
        for (let l = 1; l < layers.length; l++) {
          const layer = layers[l];
 // use_alpha (0x100) niet gezet geen geldige MCAL-data voor deze layer, offsetInMcal
 // kan garbage zijn. Niet lezen, anders krijg je willekeurige ruis-blotches (precies het
 // "sand random door durotar" symptoom).
          if (!(layer.flags & 0x100)) continue;
          const alphaOff = mcalDataOff + layer.offsetInMcal;
          if (alphaOff >= buf.length) continue;
 // Noggit (Alphamap::Alphamap, alphamap.cpp): 0x200 (compressed) wordt ALLEEN
 // gehonoreerd als use_big_alphamaps true is. Bij bigAlpha=false leest Noggit altijd
 // het legacy 4-bit packed formaat, ook als een MCLY-entry toevallig 0x200 heeft staan
 // (stale/irrelevant bit in dat formaat). Dit ongeconditioneerd checken gaf precies het
 // "sand random door durotar" symptoom een toevallige 0x200-bit op een paar chunks
 // werd dan fout als RLE gedecodeerd i.p.v. als 4-bit packed.
          if (bigAlpha === true && (layer.flags & 0x200)) {
 // Compressed RLE alpha
            layer.alphaMap = decompressAlpha(buf, alphaOff, mcalDataOff + mcalDataSize);
          } else {
 // bigAlpha (WDT MPHD.flags, autoritatief) bepaalt het formaat als bekend.
 // Anders: gap naar volgende layer als heuristiek-fallback.
            let readSize;
            if (bigAlpha === true) {
              readSize = 4096;
            } else if (bigAlpha === false) {
              readSize = 2048;
            } else {
              let actualSize;
              const nextLayer = layers[l + 1];
              if (nextLayer && !(nextLayer.flags & 0x200)) {
                actualSize = nextLayer.offsetInMcal - layer.offsetInMcal;
              } else {
                actualSize = mcalDataSize - layer.offsetInMcal;
              }
              readSize = (actualSize >= 4096) ? 4096 : 2048;
            }
            if (readSize === 4096) {
              layer.alphaMap = Uint8Array.from(buf.slice(alphaOff, alphaOff + 4096));
            } else {
              layer.alphaMap = unpackAlpha4bit(buf, alphaOff, doNotFixAlpha);
            }
          }
        }
      }
    }

    chunks.push({ ix, iy, layers });
  }

  return { texturePaths, chunks, bigAlpha, mhdrFlagsLog };
}

// WoW 3.3.5a: terrain BLPs staan primair in deze MPQs (volgorde = prioriteit)
// common.MPQ Azeroth + Kalimdor (TILESET\Terrain\Ashenvale, Barrens, ...)
// expansion.MPQ Outland (TILESET\Terrain\Outland, ...)
// lichking.MPQ Northrend (TILESET\Terrain\Northrend, ...)
// patch*.MPQ kunnen base-textures overschrijven
// ADT-bestanden (World\Maps\<map>\...) staan in dezelfde base-MPQs.
// De BLP-index in mpq-reader.js scant alle MPQs eenmalig en cached het resultaat.

// terrainBlpCache: path.toLowerCase() { data: Uint8Array, w, h } | null
// Alleen I/O + BLP decode hier de pixel-blending draait in de renderer Web Worker.
const terrainBlpCache = new Map();
const TERRAIN_BLP_CACHE_MAX = 512;

function getTerrainBlpCache(key) {
  if (!terrainBlpCache.has(key)) return undefined;
  const value = terrainBlpCache.get(key);
  terrainBlpCache.delete(key);
  terrainBlpCache.set(key, value);
  return value;
}

function setTerrainBlpCache(key, value) {
  if (!terrainBlpCache.has(key) && terrainBlpCache.size >= TERRAIN_BLP_CACHE_MAX) {
    terrainBlpCache.delete(terrainBlpCache.keys().next().value);
  }
  terrainBlpCache.set(key, value);
}

ipcMain.handle('adt:getTextureLayers', async (_, { mapName, tiles }) => {
  try {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) return { success: true, data: [] };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const dataPath = cfg.worldmapMpqPath;
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) return { success: true, data: [] };

    const wdtBigAlpha = await getWdtBigAlpha(dataPath, mapName);

    const reader = getMpqReader();
    const parsedTiles = (await Promise.all((tiles ?? []).map(async ({ tileX, tileY }) => {
      const buf = await reader.readAdtBuffer(dataPath, mapName, tileY, tileX);
      if (!buf) return null;
      const parsed = parseAdtTextureLayers(buf, wdtBigAlpha);
      if (!parsed?.texturePaths.length) return null;
      const usedIdx = new Set();
      for (const chunk of parsed.chunks) {
        if (chunk) for (const layer of chunk.layers) usedIdx.add(layer.textureIdx);
      }
      return { tileX, tileY, parsed, usedIdx };
    }))).filter(Boolean);

    // Decode every unique BLP once for the complete request. Neighboring ADTs share
    // many base textures, so decoding per tile duplicated a substantial amount of work.
    const pendingDecode = [];
    const pendingByPath = new Map();
    for (const tile of parsedTiles) {
      for (const idx of tile.usedIdx) {
        if (idx >= tile.parsed.texturePaths.length) continue;
        const rawPath = tile.parsed.texturePaths[idx];
        const cacheKey = rawPath.replace(/\//g, '\\').toLowerCase();
        const cached = getTerrainBlpCache(cacheKey);
        if (cached?.data || pendingByPath.has(cacheKey)) continue;
        const entry = { textureIdx: pendingDecode.length, path: rawPath, cacheKey };
        pendingDecode.push(entry);
        pendingByPath.set(cacheKey, entry);
      }
    }
    if (pendingDecode.length) {
      const decoded = await runAssetWorker('decodeBlps', {
        dataPath,
        entries: pendingDecode,
        ioConcurrency: getRuntimeResourceProfile().assetIoConcurrency,
      });
      for (const row of decoded) {
        const source = pendingDecode[row.textureIdx];
        if (!source) continue;
        setTerrainBlpCache(source.cacheKey, row.data
          ? { data: new Uint8Array(row.data), w: row.w, h: row.h }
          : null);
      }
    }

    // Build per-tile texture palettes; the renderer performs the layer blending on the GPU.
    const result = parsedTiles.map(({ tileX, tileY, parsed, usedIdx }) => {
      const blpRgba = {};
      for (const idx of usedIdx) {
        if (idx >= parsed.texturePaths.length) continue;
        const cacheKey = parsed.texturePaths[idx].replace(/\//g, '\\').toLowerCase();
        const entry = getTerrainBlpCache(cacheKey);
        if (entry) blpRgba[idx] = entry;
      }
      for (const idx of usedIdx) if (!blpRgba[idx]?.data) return null;
      if (!Object.keys(blpRgba).length) return null;
      const chunks = parsed.chunks.map(chunk => {
        if (!chunk) return null;
        return {
          ix: chunk.ix, iy: chunk.iy,
          layers: chunk.layers.map(layer => ({ textureIdx: layer.textureIdx, alphaMap: layer.alphaMap ?? null })),
        };
      });
      const { paletteRgba, paletteW, paletteH, paletteCount, chunkTexIndices, chunkAlpha } = buildTilePalette(blpRgba, chunks);
      return { tileX, tileY, paletteRgba, paletteW, paletteH, paletteCount, chunkTexIndices, chunkAlpha };
    }).filter(Boolean);
    return { success: true, data: result };
  } catch (e) {
    console.error('adt:getTextureLayers error:', e);
    return { success: false, error: e.message };
  }
});

// Diagnostiek: test een BLP-pad en log welke MPQs gevonden worden
ipcMain.handle('adt:diagBLP', async (_, { blpPath }) => {
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) return { error: 'geen config' };
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const dataPath = cfg.worldmapMpqPath;
  if (!dataPath) return { error: 'geen dataPath in config' };

  const reader = getMpqReader();
  const mpqs = reader.findMpqFiles(dataPath);
  console.log(`[diagBLP] dataPath=${dataPath}, MPQs: ${mpqs.map(p => path.basename(p)).join(', ')}`);
  console.log(`[diagBLP] zoeken naar: ${blpPath}`);

 // BLP-index bouwen en kijken of het pad erin zit
  const index = await reader.buildBlpIndex(dataPath);
  const key = blpPath.replace(/\//g, '\\').toLowerCase();
  const inIndex = index.has(key);
  console.log('[diagBLP] in BLP-index (' + index.size + ' entries): ' + inIndex + ' ' + (inIndex ? '-> ' + path.basename(index.get(key)) : ''));

 // Volledige lookup
  const buf = await reader.readBlpFromMpqs(dataPath, blpPath);
  console.log(`[diagBLP] readBlpFromMpqs resultaat: ${buf ? buf.length + ' bytes' : 'null (niet gevonden)'}`);

  return {
    dataPath,
    mpqs: mpqs.map(p => path.basename(p)),
    indexSize: index.size,
    inIndex,
    found: !!buf,
    size: buf ? buf.length : 0,
  };
});

ipcMain.handle('worldmap:getZoneImage', async (_, folderName, baseName, dataPath, preferOldest = false) => {
  try {
    const COLS = 4, ROWS = 3;
    const tileW = 256, tileH = 256;
    const fullW = COLS * tileW;
    const fullH = ROWS * tileH;
    const composite = Buffer.alloc(fullW * fullH * 4, 0);
    const missingTiles = [];
    let foundTiles = 0;

    const useMpq = dataPath && getMpqReader().isDataPath(dataPath);

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const idx = row * COLS + col + 1;
        let blpBuf = null;

        if (useMpq) {
          blpBuf = await getMpqReader().readTileBuffer(dataPath, folderName, idx, preferOldest);
        } else {
          const dir = resolveWorldmapDir(dataPath);
          if (dir) {
            const p = path.join(dir, folderName, `${baseName}${idx}.blp`);
            if (fs.existsSync(p)) blpBuf = fs.readFileSync(p);
          }
        }

        if (!blpBuf) {
          missingTiles.push(idx);
          continue;
        }

        foundTiles++;

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

    if (foundTiles === 0) return { success: false, error: `No world-map tiles found for ${folderName}.`, foundTiles, missingTiles };
    const png = rgbaToPNG(composite, fullW, fullH);
    return { success: true, data: `data:image/png;base64,${png.toString('base64')}`, foundTiles, missingTiles };
  } catch (e) {
    console.error('worldmap:getZoneImage error:', e);
    return { success: false, error: e.message };
  }
});

/* Legacy M2 implementation retained temporarily for reference; electron/m2-ipc.js is the active route.
// M2 model loader
const m2DiskCache = require('./m2-disk-cache');
const { runM2Load } = require('./m2-load-queue');
const {
  parseSkinFile, resolveVisibleGeosets, buildGeosetDebugInfo, buildIndicesFromSkin,
  parseCharHairGeosets, parseFacialHairGeosets, parseCreatureDisplayInfoExtra,
} = require('./m2-geoset');

function buildSubmeshIndexRanges(skin, visibleIndices) {
  const ranges = new Map();
  let start = 0;
  for (let i = 0; i < skin.submeshes.length; i++) {
    if (!visibleIndices.has(i)) continue;
    const count = skin.submeshes[i].indexCount;
    ranges.set(i, { start, count });
    start += count;
  }
  return ranges;
}

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
const m2ModelCache     = new Map(); // displayId ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ result|null
const m2VariantCache   = new Map(); // modelPath|texVars ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ result
const m2GeometryCache  = new Map(); // modelPath ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ { positions, normals, uvs, textures, skin }
const m2SkinCache      = new Map(); // modelPath ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ parsed .skin
const blpTextureCache  = new Map(); // blpPath (lower) ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ { textureRgba, textureW, textureH }
const m2VariantInflight  = new Map(); // variantKey ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ Promise<result|null>
const m2DisplayInflight  = new Map(); // displayId ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ Promise<result|null>

function getBlpTextureCacheStats() {
  let rgbaBytes = 0;
  let pngBase64Chars = 0;
async function loadFirstCreatureBlp(reader, dataPath, candidates, log) {
  for (const p of candidates) {
    const cached = blpTextureCache.get(blpCacheKey(p));
    if (cached) return cached;
  }
  const decoded = await runM2AssetWorker('decodeFirstBlp', { dataPath, paths: candidates });
  if (decoded?.data && decoded.blpPath) {
    const entry = {
      textureRgba: new Uint8Array(decoded.data),
      textureW: decoded.w,
      textureH: decoded.h,
      blpPath: decoded.blpPath,
    };
    blpTextureCache.set(blpCacheKey(decoded.blpPath), entry);
    return entry;
  }
  return null;

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
      log(`textuur gecached: ${p} (${decoded.w}ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â${decoded.h})`);
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

  if (!tex?.blpPath) log('texture MISS ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â first candidates:', candidates.slice(0, 8));
*/
ipcMain.handle('wmo:loadAsset', async (_, { modelPath, includeTextures = true } = {}) => {
  try {
    if (!modelPath) return { success: false, error: 'Geen WMO modelPath' };
    const dataPath = getM2DataPath();
    if (!dataPath) return { success: false, error: 'Geen MPQ pad ingesteld' };
    const normalizedPath = String(modelPath).replace(/\//g, '\\').replace(/\.mdx$/i, '.wmo');
    const data = await runWmoAssetWorker('readWmoAsset', { dataPath, modelPath: normalizedPath, includeTextures });
    if (!data?.meshes?.length) return { success: false, error: `Geen WMO geometry gevonden: ${normalizedPath}` };
    return { success: true, data };
  } catch (e) {
    console.error('[wmo:loadAsset]', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:readItemDisplayInfos', async (_, dataPath, displayIds = [], opts = {}) => {
  try {
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) throw new Error('A valid client Data path is required');
    const ids = [...new Set((displayIds || []).map(Number).filter(Boolean))];
    if (!ids.length) return { success: true, data: {} };
    const reader = getMpqReader();
    const buf = await reader.readFileFromMpqs(dataPath, 'DBFilesClient\\ItemDisplayInfo.dbc');
    const dbc = parseDBC(buf);
    if (!dbc || dbc.recordSize < 100) throw new Error('ItemDisplayInfo.dbc is missing or has an unsupported layout');
    const paths = await reader.collectListfilePaths(dataPath);
    const lowerPaths = paths.map(value => ({ value, lower: value.toLowerCase() }));
    const raceCodes = { 1: 'Hu', 2: 'Or', 3: 'Dw', 4: 'Ni', 5: 'Sc', 6: 'Ta', 7: 'Gn', 8: 'Tr', 10: 'Be', 11: 'Dr', 12: 'Wo' };
    const suffix = `${raceCodes[Number(opts.race)] || ''}${Number(opts.gender) === 1 ? 'F' : 'M'}`;
    const resolveModel = (name) => {
      if (!name) return '';
      const stem = name.replace(/\.(m2|mdx)$/i, '').toLowerCase();
      const withIdentity = suffix && lowerPaths.find(row => row.lower.endsWith(`\\${stem}_${suffix.toLowerCase()}.m2`));
      const generic = lowerPaths.find(row => row.lower.endsWith(`\\${stem}.m2`));
      return (withIdentity || generic)?.value || '';
    };
    const resolveTexture = (name) => {
      if (!name) return '';
      const stem = name.replace(/\.blp$/i, '').toLowerCase();
      return lowerPaths.find(row => row.lower.endsWith(`\\${stem}.blp`))?.value || '';
    };
    const resolveComponentTexture = (name) => {
      if (!name) return '';
      const stem = name.replace(/\.blp$/i, '').toLowerCase();
      return lowerPaths.find(row => row.lower.includes(`\\${stem}_`) && row.lower.endsWith('.blp'))?.value || resolveTexture(name);
    };    const wanted = new Set(ids), data = {};
    for (let i = 0; i < dbc.numRecords; i++) {
      const offset = dbc.dataStart + i * dbc.recordSize;
      const id = dbc.buf.readUInt32LE(offset);
      if (!wanted.has(id)) continue;
      const str = (field) => dbcStrCdi(dbc, dbc.buf.readUInt32LE(offset + field * 4));
      const model1 = str(1), model2 = str(2), texture1 = str(3), texture2 = str(4);
      data[id] = {
        id, model1, model2, texture1, texture2, icon1: str(5), icon2: str(6),
        model1Path: resolveModel(model1), model2Path: resolveModel(model2), texture1Path: resolveTexture(texture1), texture2Path: resolveTexture(texture2),
        geosets: Array.from({ length: 3 }, (_, index) => dbc.buf.readUInt32LE(offset + (7 + index) * 4)),
        componentTextures: { armUpper: str(15), armLower: str(16), hands: str(17), torsoUpper: str(18), torsoLower: str(19), legUpper: str(20), legLower: str(21), feet: str(22) },
        componentTexturePaths: {},
      };
      data[id].componentTexturePaths = Object.fromEntries(Object.entries(data[id].componentTextures).filter(([, value]) => value).map(([name, value]) => [name, resolveComponentTexture(value)]));
      if (Object.keys(data).length === wanted.size) break;
    }
    return { success: true, data };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('dbc:readGameObjectDisplayInfos', async (_, dataPath, displayIds = []) => {
  try {
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) throw new Error('A valid client Data path is required');
    const ids = [...new Set((displayIds || []).map(Number).filter(Boolean))];
    if (!ids.length) return { success: true, data: {} };
    const reader = getMpqReader();
    const buf = await reader.readFileFromMpqs(dataPath, 'DBFilesClient\\GameObjectDisplayInfo.dbc');
    const dbc = parseDBC(buf);
    if (!dbc || dbc.recordSize < 28) throw new Error('GameObjectDisplayInfo.dbc is missing or has an unsupported layout');
    const wanted = new Set(ids), data = {};
    for (let i = 0; i < dbc.numRecords; i++) {
      const offset = dbc.dataStart + i * dbc.recordSize;
      const id = dbc.buf.readUInt32LE(offset);
      if (!wanted.has(id)) continue;
      const modelOffset = dbc.buf.readUInt32LE(offset + 4);
      const modelName = dbcStr(dbc, modelOffset, 0).trim().replace(/\.mdx$/i, '.m2');
      data[id] = { id, modelName, modelPath: modelName };
      if (Object.keys(data).length === wanted.size) break;
    }
    return { success: true, data };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('dbc:readMapNames', async (_, dbcPath) => {
  try {
    const dbc = await readDbcFile(path.join(dbcPath, 'Map.dbc'));
    if (!dbc) throw new Error('Map.dbc unavailable');
    const names = {};
    for (let i = 0; i < dbc.recordCount; i++) {
      const off = i * dbc.recordSize;
      const id = dbc.dataBuffer.readUInt32LE(off);
      const name = readStringFromBlock(dbc.dataBuffer, dbc.dataBuffer.readUInt32LE(off + 20), dbc.stringBlock);
      if (name) names[id] = name;
    }
    return { success: true, names };
  } catch (e) { return { success: false, error: e.message }; }
});function creatureDisplayRow(dbc, offset) {
  const str = (field) => readStringFromBlock(dbc.stringBlock, dbc.dataBuffer.readUInt32LE(offset + field * 4), dbc.stringBlock);
  return { id: dbc.dataBuffer.readUInt32LE(offset), modelId: dbc.dataBuffer.readUInt32LE(offset + 4), soundId: dbc.dataBuffer.readUInt32LE(offset + 8), extraId: dbc.dataBuffer.readUInt32LE(offset + 12), scale: dbc.dataBuffer.readFloatLE(offset + 16), alpha: dbc.dataBuffer.readUInt32LE(offset + 20), tex1: str(6), tex2: str(7), tex3: str(8), geosetData: dbc.dataBuffer.readUInt32LE(offset + 56) };
}
function nextDbcId(dbc, startId) { const used = new Set(); for (let i=0;i<dbc.recordCount;i++) used.add(dbc.dataBuffer.readUInt32LE(i*dbc.recordSize)); let id=Math.max(1, Number(startId)||4000000); while(used.has(id)) id++; return id; }
function invalidateM2DbcCache() {
  m2DbcCachePromise = null;
  m2DbcCachePath = null;
  m2ModelCache.clear();
  m2VariantCache.clear();
  m2DisplayInflight.clear();
  m2Services?.invalidateM2DbcCache?.();
}

ipcMain.handle('dbc:readCreatureDisplayCreator', async (_, dbcPath) => {
  try {
    const [display, models, extra] = await Promise.all(['CreatureDisplayInfo.dbc','CreatureModelData.dbc','CreatureDisplayInfoExtra.dbc'].map(n => readDbcFile(path.join(dbcPath, n))));
    const clientDataPath = getM2DataPath();
    const clientDbc = clientDataPath ? await m2Services?.getM2DbcData?.(clientDataPath) : null;
    if (!display || !models || !extra) return { success:false, error:'Required Creature Display DBC file is missing or invalid' };
    const readStr = (dbc, off) => readStringFromBlock(dbc.stringBlock, off, dbc.stringBlock);
    const modelRows=[]; for(let i=0;i<models.recordCount;i++){const o=i*models.recordSize; modelRows.push({id:models.dataBuffer.readUInt32LE(o), path:readStr(models,models.dataBuffer.readUInt32LE(o+8))});}
    const extras=new Map(); for(let i=0;i<extra.recordCount;i++){const o=i*extra.recordSize; extras.set(extra.dataBuffer.readUInt32LE(o), {id:extra.dataBuffer.readUInt32LE(o),race:extra.dataBuffer.readUInt32LE(o+4),gender:extra.dataBuffer.readUInt32LE(o+8),skin:extra.dataBuffer.readUInt32LE(o+12),face:extra.dataBuffer.readUInt32LE(o+16),hairStyle:extra.dataBuffer.readUInt32LE(o+20),hairColor:extra.dataBuffer.readUInt32LE(o+24),facialHair:extra.dataBuffer.readUInt32LE(o+28),npcItemDisplays:Array.from({length:11},(_,j)=>o+32+j*4+4<=extra.dataBuffer.length?extra.dataBuffer.readUInt32LE(o+32+j*4):0)});}
    const displays=[]; for(let i=0;i<display.recordCount;i++){const row=creatureDisplayRow(display,i*display.recordSize); row.modelPath=modelRows.find(m=>m.id===row.modelId)?.path||''; row.extra=extras.get(row.extraId)||null; displays.push(row);}
    const charSections = (clientDbc?.charSections || []).map(row => ({ race: row.race, gender: row.sex, baseSection: row.section, texture: row.tex1, texture2: row.tex2, texture3: row.tex3, variation: row.variation, color: row.color, flags: row.flags }));
    const chrRaces = await readDbcFile(path.join(dbcPath, 'ChrRaces.dbc'));
    const raceBaseDisplays = {};
    if (chrRaces) for (let i = 0; i < chrRaces.recordCount; i++) { const offset = i * chrRaces.recordSize; const race = chrRaces.dataBuffer.readUInt32LE(offset); raceBaseDisplays[`${race}:0`] = chrRaces.dataBuffer.readUInt32LE(offset + 16); raceBaseDisplays[`${race}:1`] = chrRaces.dataBuffer.readUInt32LE(offset + 20); }
    return {success:true, displays, models:modelRows, charSections, raceBaseDisplays};
  } catch(e) { return {success:false,error:e.message}; }
});
ipcMain.handle('dbc:findNextCreatureDisplayId', async (_, dbcPath, startId) => { try { const d=await readDbcFile(path.join(dbcPath,'CreatureDisplayInfo.dbc')); const e=await readDbcFile(path.join(dbcPath,'CreatureDisplayInfoExtra.dbc')); if(!d||!e) throw new Error('Creature display DBC files unavailable'); return {success:true,displayId:nextDbcId(d,startId),extraId:nextDbcId(e,startId)}; } catch(e){return {success:false,error:e.message};} });
ipcMain.handle('dbc:createCreatureDisplay', async (_, dbcPath, payload={}) => {
  try {
    const displayPath=path.join(dbcPath,'CreatureDisplayInfo.dbc'), extraPath=path.join(dbcPath,'CreatureDisplayInfoExtra.dbc');
    const rawDisplay=fs.readFileSync(displayPath), rawExtra=fs.readFileSync(extraPath); const display=await readDbcFile(displayPath), extra=await readDbcFile(extraPath);
    if(!display||!extra||display.recordSize<64||extra.recordSize<76) throw new Error('Unsupported CreatureDisplayInfo DBC layout');
    const modelId=Number(payload.modelId)||0; const modelDbc=await readDbcFile(path.join(dbcPath,'CreatureModelData.dbc')); const validModel=!!modelDbc && [...Array(modelDbc.recordCount).keys()].some(i => modelDbc.dataBuffer.readUInt32LE(i*modelDbc.recordSize) === modelId); if(!validModel) throw new Error('A valid CreatureModelData ID is required');
    const displayId=Number(payload.id)||nextDbcId(display,payload.startId), extraId=Number(payload.extraId)||nextDbcId(extra,payload.startId);
    const patch=(raw,dbc,id,isExtra)=>{ const records=[]; let found=false; for(let i=0;i<dbc.recordCount;i++){const r=Buffer.from(dbc.dataBuffer.subarray(i*dbc.recordSize,(i+1)*dbc.recordSize)); if(r.readUInt32LE(0)===id){found=true; if(isExtra){r.writeUInt32LE(Number(payload.race)||12,4);r.writeUInt32LE(Number(payload.gender)||0,8);r.writeUInt32LE(Number(payload.skin)||0,12);r.writeUInt32LE(Number(payload.face)||0,16);r.writeUInt32LE(Number(payload.hairStyle)||0,20);r.writeUInt32LE(Number(payload.hairColor)||0,24);r.writeUInt32LE(Number(payload.facialHair)||0,28);for(let j=0;j<11&&32+j*4+4<=r.length;j++)r.writeUInt32LE(Number(payload.npcItemDisplays?.[j])||0,32+j*4);}else{r.writeUInt32LE(modelId,4);r.writeUInt32LE(extraId,12);r.writeFloatLE(Number(payload.scale)||1,16);r.writeUInt32LE(Number(payload.alpha)||255,20);r.writeUInt32LE(Number(payload.geosetData)||0,56);r.writeUInt32LE(0,60);}} records.push(r);} if(!found){const r=Buffer.alloc(dbc.recordSize);r.writeUInt32LE(id,0);if(isExtra){r.writeUInt32LE(Number(payload.race)||12,4);r.writeUInt32LE(Number(payload.gender)||0,8);r.writeUInt32LE(Number(payload.skin)||0,12);r.writeUInt32LE(Number(payload.face)||0,16);r.writeUInt32LE(Number(payload.hairStyle)||0,20);r.writeUInt32LE(Number(payload.hairColor)||0,24);r.writeUInt32LE(Number(payload.facialHair)||0,28);for(let j=0;j<11&&32+j*4+4<=r.length;j++)r.writeUInt32LE(Number(payload.npcItemDisplays?.[j])||0,32+j*4);}else{r.writeUInt32LE(modelId,4);r.writeUInt32LE(extraId,12);r.writeFloatLE(Number(payload.scale)||1,16);r.writeUInt32LE(Number(payload.alpha)||255,20);r.writeUInt32LE(Number(payload.geosetData)||0,56);r.writeUInt32LE(0,60);}records.push(r);} const out=Buffer.alloc(20+records.length*dbc.recordSize+dbc.stringBlock.length);raw.copy(out,0,0,20);out.writeUInt32LE(records.length,4);Buffer.concat(records).copy(out,20);dbc.stringBlock.copy(out,20+records.length*dbc.recordSize);return out; };
    const nextExtra=patch(rawExtra,extra,extraId,true), nextDisplay=patch(rawDisplay,display,displayId,false); fs.writeFileSync(extraPath+'.tmp',nextExtra);fs.writeFileSync(displayPath+'.tmp',nextDisplay);fs.renameSync(extraPath+'.tmp',extraPath);fs.renameSync(displayPath+'.tmp',displayPath);invalidateM2DbcCache(); return {success:true,displayId,extraId};
  } catch(e){return {success:false,error:e.message};}
});
ipcMain.handle('dbc:setCreatureDisplayBakeName', async (_, dbcPath, extraId) => {
  try {
    const id = Number(extraId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Extra ID must be a positive integer');
    const filePath = path.join(dbcPath, 'CreatureDisplayInfoExtra.dbc');
    const raw = fs.readFileSync(filePath);
    const dbc = await readDbcFile(filePath);
    if (!dbc || dbc.recordSize < 84) throw new Error('CreatureDisplayInfoExtra.dbc must have 21 fields (84 bytes)');
    let recordOffset = -1;
    for (let i = 0; i < dbc.recordCount; i++) if (dbc.dataBuffer.readUInt32LE(i * dbc.recordSize) === id) { recordOffset = i * dbc.recordSize; break; }
    if (recordOffset < 0) throw new Error('CreatureDisplayInfoExtra record ' + id + ' was not found');
    const bakeName = 'CreatureDisplayExtra-' + id + '.blp';
    const value = Buffer.from(bakeName + '\0', 'utf8');
    let stringOffset = dbc.stringBlock.indexOf(value);
    let stringBlock = dbc.stringBlock;
    if (stringOffset < 0) { stringOffset = stringBlock.length; stringBlock = Buffer.concat([stringBlock, value]); }
    const records = Buffer.from(dbc.dataBuffer);
    records.writeInt32LE(0, recordOffset + 76); // ObjectEffectivePackageID
    records.writeUInt32LE(stringOffset, recordOffset + 80);
    const output = Buffer.alloc(20 + records.length + stringBlock.length);
    raw.copy(output, 0, 0, 20);
    records.copy(output, 20);
    stringBlock.copy(output, 20 + records.length);
    fs.writeFileSync(filePath + '.tmp', output);
    fs.renameSync(filePath + '.tmp', filePath);
    invalidateM2DbcCache();
    return { success: true, bakeName };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

 m2Services = registerM2Ipc(ipcMain, {
  getM2DataPath,
  getMpqReader,
  runM2AssetWorker,
  getMainWindow: () => mainWindow,
  blpTextureCache,
});

ipcMain.handle('adt:getPlacements', async (_, { mapName, tiles }) => {
  try {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) return { success: true, data: [] };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const dataPath = cfg.worldmapMpqPath;
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) return { success: true, data: [] };
    const data = await runM2AssetWorker('readPlacements', { dataPath, mapName, tiles: tiles ?? [] });
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('worldmap:getOverlayImage', async (_, folderName, textureName, width, height, dataPath) => {
  try {
    const tileW = 256, tileH = 256;
    const cols = Math.ceil(width / tileW), rows = Math.ceil(height / tileH);
    const composite = Buffer.alloc(width * height * 4, 0);
    const useMpq = dataPath && getMpqReader().isDataPath(dataPath);
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const idx = row * cols + col + 1;
      const internalPath = `Interface\\WorldMap\\${folderName}\\${textureName}${idx}.blp`;
      let blpBuf = useMpq ? await getMpqReader().readBlpFromMpqs(dataPath, internalPath) : null;
      if (!blpBuf) continue;
      const { rgba, w, h } = decodeBLP(blpBuf);
      for (let y = 0; y < Math.min(h, height - row * tileH); y++) for (let x = 0; x < Math.min(w, width - col * tileW); x++) {
        const src = (y * w + x) * 4, dst = (((row * tileH + y) * width) + col * tileW + x) * 4;
        composite[dst] = rgba[src]; composite[dst + 1] = rgba[src + 1]; composite[dst + 2] = rgba[src + 2]; composite[dst + 3] = rgba[src + 3];
      }
    }
    return { success: true, data: `data:image/png;base64,${rgbaToPNG(composite, width, height).toString('base64')}` };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('dbc:addSpellIcon', async (_, dbcPath, iconPath, customStart = 1) => {
  try {
    const filePath = path.join(dbcPath, 'SpellIcon.dbc');
    const raw = fs.readFileSync(filePath);
    const recordCount = raw.readUInt32LE(4), recordSize = raw.readUInt32LE(12), stringSize = raw.readUInt32LE(16);
    const recordsEnd = 20 + recordCount * recordSize;
    const normalized = String(iconPath || '').replace(/\//g, '\\').replace(/\.blp$/i, '').trim();
    if (!normalized) throw new Error('An icon path is required');
    for (let i = 0; i < recordCount; i++) {
      const off = 20 + i * recordSize;
      const ref = raw.readUInt32LE(off + 4);
      const existing = readStringFromBlock(null, ref, raw.subarray(recordsEnd, recordsEnd + stringSize));
      if (existing.toLowerCase() === normalized.toLowerCase()) return { success: true, data: { id: raw.readUInt32LE(off), existing: true } };
    }
    const usedIds = new Set();
    for (let i = 0; i < recordCount; i++) usedIds.add(raw.readUInt32LE(20 + i * recordSize));
    let id = Math.max(1, Number(customStart) || 1);
    while (usedIds.has(id)) id++;
    const text = Buffer.from(`${normalized}\0`, 'utf8');
    const record = Buffer.alloc(recordSize); record.writeUInt32LE(id, 0); record.writeUInt32LE(stringSize, 4);
    const out = Buffer.alloc(raw.length + recordSize + text.length);
    raw.copy(out, 0, 0, recordsEnd); record.copy(out, recordsEnd); raw.copy(out, recordsEnd + recordSize, recordsEnd, recordsEnd + stringSize); text.copy(out, recordsEnd + recordSize + stringSize);
    out.writeUInt32LE(recordCount + 1, 4); out.writeUInt32LE(stringSize + text.length, 16);
    fs.writeFileSync(filePath, out);
    return { success: true, data: { id, existing: false } };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('dbc:setCreatureDisplayObjectPackage', async (_, dbcPath, displayId) => {
  try {
    const id = Number(displayId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Display ID must be a positive integer');
    const filePath = path.join(dbcPath, 'CreatureDisplayInfo.dbc');
    const raw = fs.readFileSync(filePath);
    const dbc = await readDbcFile(filePath);
    if (!dbc || dbc.recordSize < 64) throw new Error('CreatureDisplayInfo.dbc must have 16 fields (64 bytes)');
    const records = Buffer.from(dbc.dataBuffer);
    let found = false;
    for (let i = 0; i < dbc.recordCount; i++) {
      const offset = i * dbc.recordSize;
      if (records.readUInt32LE(offset) !== id) continue;
      records.writeInt32LE(0, offset + 60); // ObjectEffectivePackageID
      found = true;
      break;
    }
    if (!found) throw new Error('CreatureDisplayInfo record ' + id + ' was not found');
    const output = Buffer.alloc(20 + records.length + dbc.stringBlock.length);
    raw.copy(output, 0, 0, 20);
    records.copy(output, 20);
    dbc.stringBlock.copy(output, 20 + records.length);
    fs.writeFileSync(filePath + '.tmp', output);
    fs.renameSync(filePath + '.tmp', filePath);
    invalidateM2DbcCache();
    return { success: true };
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

// CharBaseInfo.dbc
// Structure: WDBC header (20 bytes) + N records of 2 bytes (uint8 race, uint8 class) + 1 byte string block

ipcMain.handle('dbc:readCharStartOutfit', async (_, dbcPath, opts = {}) => {
  try {
    const dbc = await readDbcFile(path.join(dbcPath, 'CharStartOutfit.dbc'));
    if (!dbc) return { success: false, error: 'Kon CharStartOutfit.dbc niet lezen' };

    const wantRace = Number(opts.race) || 0;
    const wantClass = Number(opts.classId) || 0;
    const rows = [];

    for (let i = 0; i < dbc.recordCount; i++) {
      const off = i * dbc.recordSize;
      const id = dbc.dataBuffer.readUInt32LE(off);
      const packed = dbc.dataBuffer.readUInt32LE(off + 4);
      const race = packed & 0xFF;
      const classId = (packed >>> 8) & 0xFF;
      const gender = (packed >>> 16) & 0xFF;
      const outfitId = (packed >>> 24) & 0xFF;
      if (wantRace && race !== wantRace) continue;
      if (wantClass && classId !== wantClass) continue;

      const items = [];
      for (let slot = 0; slot < 24; slot++) {
        const itemId = dbc.dataBuffer.readUInt32LE(off + 8 + slot * 4);
        const displayId = dbc.dataBuffer.readUInt32LE(off + 104 + slot * 4);
        const inventorySlot = dbc.dataBuffer.readUInt32LE(off + 200 + slot * 4);
        if (!itemId && !displayId && !inventorySlot) continue;
        items.push({ slotIndex: slot, itemId, displayId, inventorySlot });
      }

      rows.push({ id, race, classId, gender, outfitId, items });
    }

    return { success: true, data: rows };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:readCharBaseInfo', async (_, dbcPath) => {
  try {
    const filePath = path.join(dbcPath, 'CharBaseInfo.dbc');
    const buffer = fs.readFileSync(filePath);
    if (buffer.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'Invalid DBC header' };
    const recordCount = buffer.readUInt32LE(4);
    const combos = [];
    for (let i = 0; i < recordCount; i++) {
      combos.push({ race: buffer[20 + i * 2], class: buffer[20 + i * 2 + 1] });
    }
    return { success: true, combos };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:appendCharStartOutfit', async (_, dbcPath, rows) => {
  try {
    const filePath = path.join(dbcPath, 'CharStartOutfit.dbc');
    const buf = fs.readFileSync(filePath);
    if (buf.toString('ascii', 0, 4) !== 'WDBC') throw new Error('Invalid CharStartOutfit.dbc');
    const count = buf.readUInt32LE(4);
    const recordSize = buf.readUInt32LE(12);
    if (recordSize < 296) throw new Error(`Unexpected CharStartOutfit record size: ${recordSize}`);
    const recordsEnd = 20 + count * recordSize;
    const records = Buffer.alloc(rows.length * recordSize);
    let maxId = 0;
    for (let i = 0; i < count; i++) maxId = Math.max(maxId, buf.readUInt32LE(20 + i * recordSize));
    rows.forEach((row, index) => {
      const off = index * recordSize;
      records.writeUInt32LE(++maxId, off);
      records.writeUInt32LE((row.race & 0xFF) | ((row.classId & 0xFF) << 8) | ((row.gender & 0xFF) << 16) | ((row.outfitId & 0xFF) << 24), off + 4);
      for (const item of row.items || []) {
        const slot = Number(item.slotIndex);
        if (slot < 0 || slot >= 24) continue;
        records.writeUInt32LE(Number(item.itemId) || 0, off + 8 + slot * 4);
        records.writeUInt32LE(Number(item.displayId) || 0, off + 104 + slot * 4);
        records.writeUInt32LE(Number(item.inventorySlot) || 0, off + 200 + slot * 4);
      }
    });
    const out = Buffer.concat([buf.subarray(0, recordsEnd), records, buf.subarray(recordsEnd)]);
    out.writeUInt32LE(count + rows.length, 4);
    fs.writeFileSync(filePath, out);
    return { success: true, count: rows.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:writeCharBaseInfo', async (_, dbcPath, combos) => {
  try {
    const filePath = path.join(dbcPath, 'CharBaseInfo.dbc');
    const buf = Buffer.alloc(20 + combos.length * 2 + 1);
    buf.write('WDBC', 0, 'ascii');
    buf.writeUInt32LE(combos.length, 4);
    buf.writeUInt32LE(2, 8);
    buf.writeUInt32LE(2, 12);
    buf.writeUInt32LE(1, 16);
    for (let i = 0; i < combos.length; i++) {
      buf[20 + i * 2]     = combos[i].race;
      buf[20 + i * 2 + 1] = combos[i].class;
    }
    buf[20 + combos.length * 2] = 0;
    fs.writeFileSync(filePath, buf);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ItemSet.dbc
const ITEMSET_LAYOUTS = {
  180: {
    nameFields: 9,
    itemsOffset: 40,
    spellsOffset: 108,
    thresholdsOffset: 140,
    requiredSkillOffset: 172,
    requiredSkillRankOffset: 176,
  },
  212: {
    nameFields: 17,
    itemsOffset: 72,
    spellsOffset: 140,
    thresholdsOffset: 172,
    requiredSkillOffset: 204,
    requiredSkillRankOffset: 208,
  },
};

function getItemSetLayout(recordSize) {
  return ITEMSET_LAYOUTS[recordSize] || null;
}

ipcMain.handle('dbc:searchItemSets', async (_, dbcPath, term = '') => {
  try {
    const filePath = path.join(dbcPath, 'ItemSet.dbc');
    const buf = fs.readFileSync(filePath);
    if (buf.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'Invalid DBC' };
    const recordCount = buf.readUInt32LE(4);
    const recordSize = buf.readUInt32LE(12);
    const layout = getItemSetLayout(recordSize);
    if (!layout) return { success: false, error: `Unsupported ItemSet.dbc record size ${recordSize}` };
    const strBlockStart = 20 + recordCount * recordSize;
    const strBlock = buf.slice(strBlockStart);
    const needle = String(term || '').trim().toLowerCase();
    const isId = /^\d+$/.test(needle);
    const matches = [];

    for (let i = 0; i < recordCount; i++) {
      const off = 20 + i * recordSize;
      const id = buf.readUInt32LE(off);
      const nameRef = buf.readUInt32LE(off + 4);
      const name = readStringFromBlock(null, nameRef, strBlock);

      if (!needle || (isId && String(id).includes(needle)) || (!isId && name.toLowerCase().includes(needle))) {
        matches.push({ entry: id, name, patch: 0, source: 'DBC' });
      }

      if (matches.length >= 200) break;
    }

    return { success: true, data: matches };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:readItemSet', async (_, dbcPath, id) => {
  try {
    const filePath = path.join(dbcPath, 'ItemSet.dbc');
    const buf = fs.readFileSync(filePath);
    if (buf.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'Invalid DBC' };
    const recordCount = buf.readUInt32LE(4);
    const recordSize = buf.readUInt32LE(12);
    const layout = getItemSetLayout(recordSize);
    if (!layout) return { success: false, error: `Unsupported ItemSet.dbc record size ${recordSize}` };
    const strBlockStart = 20 + recordCount * recordSize;
    const strBlock = buf.slice(strBlockStart);
    for (let i = 0; i < recordCount; i++) {
      const off = 20 + i * recordSize;
      if (buf.readUInt32LE(off) !== id) continue;
      const nameRef = buf.readUInt32LE(off + 4);
      const name = readStringFromBlock(null, nameRef, strBlock);
      const items = [], spells = [], thresholds = [];
      for (let j = 0; j < 17; j++) items.push(buf.readUInt32LE(off + layout.itemsOffset + j * 4));
      for (let j = 0; j < 8; j++) {
        spells.push(buf.readUInt32LE(off + layout.spellsOffset + j * 4));
        thresholds.push(buf.readUInt32LE(off + layout.thresholdsOffset + j * 4));
      }
      return { success: true, data: {
        id, name, items, spells, thresholds,
        requiredSkill: buf.readUInt32LE(off + layout.requiredSkillOffset),
        requiredSkillRank: buf.readUInt32LE(off + layout.requiredSkillRankOffset),
      }};
    }
    return { success: false, error: `ItemSet ${id} niet gevonden` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:writeItemSet', async (_, dbcPath, set) => {
  try {
    const filePath = path.join(dbcPath, 'ItemSet.dbc');
    let buf = fs.readFileSync(filePath);
    if (buf.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'Invalid DBC' };
    let recordCount = buf.readUInt32LE(4);
    const recordSize = buf.readUInt32LE(12);
    const layout = getItemSetLayout(recordSize);
    if (!layout) return { success: false, error: `Unsupported ItemSet.dbc record size ${recordSize}` };
    const strBlockStart = 20 + recordCount * recordSize;

    let recordIndex = -1;
    for (let i = 0; i < recordCount; i++) {
      if (buf.readUInt32LE(20 + i * recordSize) === set.id) { recordIndex = i; break; }
    }

    let newBuf;
    if (recordIndex === -1) {
 // Insert new record before string block
      const newRecord = Buffer.alloc(recordSize, 0);
      newBuf = Buffer.concat([buf.slice(0, strBlockStart), newRecord, buf.slice(strBlockStart)]);
      recordIndex = recordCount;
      recordCount++;
      newBuf.writeUInt32LE(recordCount, 4);
    } else {
      newBuf = Buffer.from(buf);
    }


 // Append new name string
    const nameStr = Buffer.from((set.name || '') + '\0', 'utf8');
    const nameRef = newBuf.readUInt32LE(16); // current string block size = offset of new string
    newBuf = Buffer.concat([newBuf, nameStr]);
    newBuf.writeUInt32LE(nameRef + nameStr.length, 16);

    const off = 20 + recordIndex * recordSize;
    newBuf.writeUInt32LE(set.id, off);
    newBuf.writeUInt32LE(nameRef, off + 4);
    for (let field = 2; field <= layout.nameFields; field++) newBuf.writeUInt32LE(0, off + field * 4);
    for (let j = 0; j < 17; j++) newBuf.writeUInt32LE(set.items[j] || 0, off + layout.itemsOffset + j * 4);
    for (let j = 0; j < 8; j++) {
      newBuf.writeUInt32LE(set.spells[j] || 0, off + layout.spellsOffset + j * 4);
      newBuf.writeUInt32LE(set.thresholds[j] || 0, off + layout.thresholdsOffset + j * 4);
    }
    newBuf.writeUInt32LE(set.requiredSkill || 0, off + layout.requiredSkillOffset);
    newBuf.writeUInt32LE(set.requiredSkillRank || 0, off + layout.requiredSkillRankOffset);

    fs.writeFileSync(filePath, newBuf);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:findNextItemSetId', async (_, dbcPath) => {
  try {
    const filePath = path.join(dbcPath, 'ItemSet.dbc');
    const buf = fs.readFileSync(filePath);
    const recordCount = buf.readUInt32LE(4);
    const recordSize = buf.readUInt32LE(12);
    const layout = getItemSetLayout(recordSize);
    if (!layout) return { success: false, error: `Unsupported ItemSet.dbc record size ${recordSize}` };
    let max = 0;
    for (let i = 0; i < recordCount; i++) {
      const id = buf.readUInt32LE(20 + i * recordSize);
      if (id > max) max = id;
    }
    return { success: true, id: max + 1 };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// CharSections.dbc: 10 fields 4 bytes = 40 bytes/record
// ID(0) Race(4) Sex(8) BaseSection(12) Tex1(16) Tex2(20) Tex3(24) Flags(28) VariationIndex(32) ColorIndex(36)
ipcMain.handle('dbc:readCharSections', async (_, dbcPath) => {
  try {
    const filePath = path.join(dbcPath, 'CharSections.dbc');
    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: false, error: 'Kon CharSections.dbc niet lezen' };
    const { recordCount, recordSize, dataBuffer, stringBlock } = dbc;
    const readStr = (offset) => {
      if (!offset) return '';
      let end = offset;
      while (end < stringBlock.length && stringBlock[end] !== 0) end++;
      return stringBlock.toString('utf8', offset, end);
    };
    const records = [];
    for (let i = 0; i < recordCount; i++) {
      const b = i * recordSize;
      records.push({
        id:             dataBuffer.readUInt32LE(b + 0),
        race:           dataBuffer.readUInt32LE(b + 4),
        sex:            dataBuffer.readUInt32LE(b + 8),
        baseSection:    dataBuffer.readUInt32LE(b + 12),
        tex1:           readStr(dataBuffer.readUInt32LE(b + 16)),
        tex2:           readStr(dataBuffer.readUInt32LE(b + 20)),
        tex3:           readStr(dataBuffer.readUInt32LE(b + 24)),
        flags:          dataBuffer.readUInt32LE(b + 28),
        variationIndex: dataBuffer.readUInt32LE(b + 32),
        colorIndex:     dataBuffer.readUInt32LE(b + 36),
      });
    }
    return { success: true, records };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('worldmap:readContinents', async (_, dbcPath) => {
  try {
    const buffer = fs.readFileSync(path.join(dbcPath, 'WorldMapContinent.dbc'));
    if (buffer.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'Geen DBC' };
    const count = buffer.readUInt32LE(4), size = buffer.readUInt32LE(12);
    const continents = [];
    for (let i = 0; i < count; i++) {
      const b = 20 + i * size;
      continents.push({
        id: buffer.readUInt32LE(b), mapId: buffer.readUInt32LE(b + 4),
        leftBoundary: buffer.readInt32LE(b + 8), rightBoundary: buffer.readInt32LE(b + 12),
        topBoundary: buffer.readInt32LE(b + 16), bottomBoundary: buffer.readInt32LE(b + 20),
        offsetX: buffer.readFloatLE(b + 24), offsetY: buffer.readFloatLE(b + 28),
        scale: buffer.readFloatLE(b + 32), worldMapId: buffer.readUInt32LE(b + 52),
      });
    }
    return { success: true, continents };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('worldmap:readOverlays', async (_, dbcPath) => {
  try {
    const buffer = fs.readFileSync(path.join(dbcPath, 'WorldMapOverlay.dbc'));
    if (buffer.toString('ascii', 0, 4) !== 'WDBC') return { success: false, error: 'Geen DBC' };
    const count = buffer.readUInt32LE(4), size = buffer.readUInt32LE(12), strings = 20 + count * size;
    const readStr = offset => { let end = offset; while (strings + end < buffer.length && buffer[strings + end]) end++; return offset ? buffer.slice(strings + offset, strings + end).toString('utf8') : ''; };
    const overlays = [];
    for (let i = 0; i < count; i++) { const b = 20 + i * size; overlays.push({ id: buffer.readUInt32LE(b), mapAreaId: buffer.readUInt32LE(b + 4), textureName: readStr(buffer.readUInt32LE(b + 32)), width: buffer.readUInt32LE(b + 36), height: buffer.readUInt32LE(b + 40), offsetX: buffer.readUInt32LE(b + 44), offsetY: buffer.readUInt32LE(b + 48) }); }
    return { success: true, overlays };
  } catch (e) { return { success: false, error: e.message }; }
});

// Read the Character Customization test build only. Keeping this as a separate
// IPC makes the staging folder explicit: it is never confused with the server
// DBC path and is never used unless the editor asks for it.
ipcMain.handle('dbc:readCharSectionsTestOutput', async () => {
  try {
    const outputRoot = path.join(__dirname, '..', 'output');
    const filePath = path.join(outputRoot, 'DBFilesClient', 'CharSections.dbc');
    const textureRoot = path.join(outputRoot, 'PlayerTextures');
    const blpFiles = [];
    const collectBlps = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) collectBlps(absolute);
        else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.blp') {
          blpFiles.push(path.relative(textureRoot, absolute).replace(/\\/g, '\\'));
        }
      }
    };
    collectBlps(textureRoot);
    if (!fs.existsSync(filePath)) return { success: false, missing: true, blpFiles };

    const dbc = await readDbcFile(filePath);
    if (!dbc) return { success: false, error: 'Kon test CharSections.dbc niet lezen', blpFiles };
    const { recordCount, recordSize, dataBuffer, stringBlock } = dbc;
    const readStr = (offset) => {
      if (!offset) return '';
      let end = offset;
      while (end < stringBlock.length && stringBlock[end] !== 0) end++;
      return stringBlock.toString('utf8', offset, end);
    };
    const records = [];
    for (let i = 0; i < recordCount; i++) {
      const b = i * recordSize;
      records.push({
        id: dataBuffer.readUInt32LE(b), race: dataBuffer.readUInt32LE(b + 4), sex: dataBuffer.readUInt32LE(b + 8), baseSection: dataBuffer.readUInt32LE(b + 12),
        tex1: readStr(dataBuffer.readUInt32LE(b + 16)), tex2: readStr(dataBuffer.readUInt32LE(b + 20)), tex3: readStr(dataBuffer.readUInt32LE(b + 24)),
        flags: dataBuffer.readUInt32LE(b + 28), variationIndex: dataBuffer.readUInt32LE(b + 32), colorIndex: dataBuffer.readUInt32LE(b + 36),
      });
    }
    return { success: true, records, blpFiles, stagedPath: filePath };
  } catch (e) {
    return { success: false, error: e.message, blpFiles: [] };
  }
});

ipcMain.handle('dbc:exportCharSectionsCsv', async (_, rows) => {
  try {
    const columns = ['ID', 'RaceID', 'SexID', 'BaseSection', 'TextureName_1', 'TextureName_2', 'TextureName_3', 'Flags', 'VariationIndex', 'ColorIndex'];
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [columns.join(',')]
      .concat((rows || []).map(row => [
        row.id, row.race, row.sex, row.baseSection,
        row.tex1, row.tex2, row.tex3,
        row.flags, row.variationIndex, row.colorIndex,
      ].map(escape).join(',')))
      .join('\r\n');
    const outputPath = path.join(__dirname, '..', 'output', 'DBFilesClient', 'CharSections.pending-insert.csv');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${csv}\r\n`, 'utf8');
    return { success: true, outputPath, count: rows?.length || 0 };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dbc:writeCharSections', async (_, dbcPath, records, stageOnly = false) => {
  try {
    const filePath = path.join(dbcPath, 'CharSections.dbc');
    const RECORD_SIZE = 40;
    const FIELD_COUNT = 10;

 // Build string block: collect unique strings in insertion order
    const strMap = new Map([['', 0]]);
    let strOffset = 1; // offset 0 = empty string (null byte)
    const strParts = [Buffer.from('\0')];
    const internStr = (s) => {
      if (!s) return 0;
      if (strMap.has(s)) return strMap.get(s);
      const off = strOffset;
      strMap.set(s, off);
      const buf = Buffer.from(s + '\0', 'utf8');
      strParts.push(buf);
      strOffset += buf.length;
      return off;
    };

 // Pre-intern all strings
    for (const r of records) {
      internStr(r.tex1 || '');
      internStr(r.tex2 || '');
      internStr(r.tex3 || '');
    }

    const stringBlock = Buffer.concat(strParts);
    const dataBuffer = Buffer.alloc(records.length * RECORD_SIZE);

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const b = i * RECORD_SIZE;
      dataBuffer.writeUInt32LE(r.id            >>> 0, b + 0);
      dataBuffer.writeUInt32LE(r.race          >>> 0, b + 4);
      dataBuffer.writeUInt32LE(r.sex           >>> 0, b + 8);
      dataBuffer.writeUInt32LE(r.baseSection   >>> 0, b + 12);
      dataBuffer.writeUInt32LE(internStr(r.tex1 || ''), b + 16);
      dataBuffer.writeUInt32LE(internStr(r.tex2 || ''), b + 20);
      dataBuffer.writeUInt32LE(internStr(r.tex3 || ''), b + 24);
      dataBuffer.writeUInt32LE(r.flags         >>> 0, b + 28);
      dataBuffer.writeUInt32LE(r.variationIndex >>> 0, b + 32);
      dataBuffer.writeUInt32LE(r.colorIndex    >>> 0, b + 36);
    }

    const header = Buffer.alloc(20);
    header.write('WDBC', 0, 'ascii');
    header.writeUInt32LE(records.length,       4);
    header.writeUInt32LE(FIELD_COUNT,          8);
    header.writeUInt32LE(RECORD_SIZE,         12);
    header.writeUInt32LE(stringBlock.length,  16);

    const output = Buffer.concat([header, dataBuffer, stringBlock]);
    const stagedPath = path.join(__dirname, '..', 'output', 'DBFilesClient', 'CharSections.dbc');
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
    fs.writeFileSync(stagedPath, output);
    if (!stageOnly) fs.writeFileSync(filePath, output);
    return { success: true, stagedPath, wroteServer: !stageOnly };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Decode een BLP-texture uit de WoW Data folder (MPQ) of losse file en geef terug als PNG buffer.
// dataPath mag een WoW Data root zijn (met MPQs) of een gewone map met uitgepakte BLPs.
// Cached zowel RGBA als PNG base64 herhaalde lookups hoeven niet opnieuw te encoden.
async function readBlpTextureFromSource(dataPath, blpPath, archivePath = '') {
  try {
    if (!dataPath || !blpPath) return { success: false, error: 'dataPath of blpPath ontbreekt' };
    const key = `${archivePath || 'auto'}|${blpCacheKey(blpPath)}`;
    const hit = blpTextureCache.get(key);
    if (hit) {
      if (hit.pngBase64) return { success: true, w: hit.textureW, h: hit.textureH, png: hit.pngBase64, path: blpPath };
      hit.pngBase64 = rgbaToPNG(Buffer.from(hit.textureRgba), hit.textureW, hit.textureH).toString('base64');
      return { success: true, w: hit.textureW, h: hit.textureH, png: hit.pngBase64, path: blpPath };
    }

    let buf = null;
    const mpqReader = getMpqReader();
    if (archivePath && mpqReader.readFileFromMpqEntry) {
      buf = await mpqReader.readFileFromMpqEntry(dataPath, archivePath, blpPath);
    }
    if (!buf && mpqReader.isDataPath(dataPath) && mpqReader.readBlpFromMpqs) {
      buf = await mpqReader.readBlpFromMpqs(dataPath, blpPath);
    }
    if (!buf) {
      const direct = path.join(dataPath, blpPath.replace(/\\/g, path.sep));
      if (fs.existsSync(direct)) buf = fs.readFileSync(direct);
    }
    if (!buf || buf.length < 4 || buf.toString('ascii', 0, 4) !== 'BLP2') {
      return { success: false, error: 'BLP niet gevonden of geen BLP2', path: blpPath };
    }

    const decoded = decodeBLP(buf);
    const pngBase64 = rgbaToPNG(Buffer.from(decoded.rgba), decoded.w, decoded.h).toString('base64');
    blpTextureCache.set(key, {
      textureRgba: new Uint8Array(decoded.rgba),
      textureW: decoded.w,
      textureH: decoded.h,
      blpPath,
      pngBase64,
    });
    return { success: true, w: decoded.w, h: decoded.h, png: pngBase64, path: blpPath };
  } catch (e) {
    return { success: false, error: e.message, path: blpPath };
  }
}

ipcMain.handle('dbc:readBlpTexture', async (_, dataPath, blpPath, archivePath = '') => {
  return readBlpTextureFromSource(dataPath, blpPath, archivePath);
});

// Explicit user-selected recovery files (for example an export that was
// created before a later DBC step failed). This never writes to the file.
ipcMain.handle('dbc:readBlpFile', async (_, filePath) => {
  try {
    if (!filePath || path.extname(filePath).toLowerCase() !== '.blp') return { success: false, error: 'Selecteer een .blp bestand' };
    const buf = fs.readFileSync(filePath);
    if (buf.length < 4 || buf.toString('ascii', 0, 4) !== 'BLP2') return { success: false, error: 'Bestand is geen BLP2 texture', path: filePath };
    const decoded = decodeBLP(buf);
    return { success: true, w: decoded.w, h: decoded.h, png: rgbaToPNG(Buffer.from(decoded.rgba), decoded.w, decoded.h).toString('base64'), path: filePath };
  } catch (e) {
    return { success: false, error: e.message, path: filePath };
  }
});

// Explicit staged texture read for Character Customization test previews.
// Normal client previews never consult output\PlayerTextures implicitly.
ipcMain.handle('dbc:readOutputBlpTexture', async (_, blpPath) => {
  try {
    const safeRelPath = String(blpPath || '').replace(/\\/g, path.sep);
    if (!safeRelPath || path.isAbsolute(safeRelPath) || safeRelPath.split(path.sep).includes('..')) return { success: false, error: 'Ongeldig output-BLP pad' };
    const filePath = path.join(__dirname, '..', 'output', 'PlayerTextures', safeRelPath);
    if (!fs.existsSync(filePath)) return { success: false, missing: true, path: blpPath };
    const buf = fs.readFileSync(filePath);
    if (buf.length < 4 || buf.toString('ascii', 0, 4) !== 'BLP2') return { success: false, error: 'Outputbestand is geen BLP2', path: blpPath };
    const decoded = decodeBLP(buf);
    return { success: true, w: decoded.w, h: decoded.h, png: rgbaToPNG(Buffer.from(decoded.rgba), decoded.w, decoded.h).toString('base64'), path: blpPath };
  } catch (e) {
    return { success: false, error: e.message, path: blpPath };
  }
});

// Schrijft een bewerkt deel van een BLP terug als nieuwe loose-file BLP.
// editedRgbaBase64: volledige RGBA buffer (w*h*4) van de texture NA recolor.
// maskBase64: grayscale buffer (w*h, 1 byte/pixel) >0 = bewerkt (zachte brush-randen tellen ook mee).
// outRelPath: relatief pad (t.o.v. dataPath) waar de nieuwe BLP komt, bv.
// "Character\\Human\\Female\\HumanFemaleSkin00_00_custom1.blp".
ipcMain.handle('dbc:writeBlpTextureEdit', async (_, dataPath, blpPath, editedRgbaBase64, maskBase64, outRelPath, stageOutput = false, noOverwrite = false, archivePath = '') => {
  try {
    if (!dataPath || !blpPath || !outRelPath) {
      return { success: false, error: 'dataPath, blpPath of outRelPath ontbreekt' };
    }
    let buf = null;
    const mpqReader = getMpqReader();
    if (archivePath && mpqReader.readFileFromMpqEntry) {
      buf = await mpqReader.readFileFromMpqEntry(dataPath, archivePath, blpPath);
    }
    if (!buf && mpqReader.isDataPath(dataPath) && mpqReader.readBlpFromMpqs) {
      buf = await mpqReader.readBlpFromMpqs(dataPath, blpPath);
    }
    if (!buf) {
      const direct = path.join(dataPath, blpPath.replace(/\\/g, path.sep));
      if (fs.existsSync(direct)) buf = fs.readFileSync(direct);
    }
    if (!buf || buf.length < 4 || buf.toString('ascii', 0, 4) !== 'BLP2') {
      return { success: false, error: 'Bron-BLP niet gevonden of geen BLP2' };
    }

    const w = buf.readUInt32LE(12);
    const h = buf.readUInt32LE(16);
    const editedRgba = Buffer.from(editedRgbaBase64, 'base64');
    const maskBytes  = Buffer.from(maskBase64, 'base64');
    if (editedRgba.length !== w * h * 4) {
      return { success: false, error: `RGBA grootte klopt niet (verwacht ${w*h*4}, kreeg ${editedRgba.length})` };
    }
    if (maskBytes.length !== w * h) {
      return { success: false, error: `Masker grootte klopt niet (verwacht ${w*h}, kreeg ${maskBytes.length})` };
    }

    const maskBool = new Array(w * h);
    for (let i = 0; i < w * h; i++) maskBool[i] = maskBytes[i] > 0; // elke aanraking, ook zachte brush-randen, telt mee

    const newBlp = reencodeBlpDxtSelective(buf, editedRgba, maskBool, w, h);

    const safeRelPath = outRelPath.replace(/\\/g, path.sep);
    if (path.isAbsolute(safeRelPath) || safeRelPath.split(path.sep).includes('..')) return { success: false, error: 'Ongeldig uitvoerpad' };
    const outAbs = stageOutput
      ? path.join(__dirname, '..', 'output', stageOutput === 'mpq-output' ? '' : 'PlayerTextures', safeRelPath)
      : path.join(dataPath, safeRelPath);
    if (noOverwrite && fs.existsSync(outAbs)) return { success: false, error: 'Output file already exists. Choose another BLP filename.' };
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, newBlp);

    blpTextureCache.delete(blpCacheKey(outRelPath)); // forceer herladen van het nieuwe pad

    return { success: true, path: outRelPath, stagedPath: stageOutput ? outAbs : null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Batch-variant: laad meerdere BLP-textures in IPC. Opent elke MPQ maximaal
// ongeacht hoeveel BLPs erin zitten groot verschil met de single-call handler.
// Geeft een array terug in dezelfde volgorde als de input; ontbrekende BLPs krijgen
// { success: false } zodat de caller per item kan beslissen.
// Character-display bake export has a fixed DXT template and a fixed loose-file
// destination. The renderer never controls a client or MPQ output path.
ipcMain.handle('dbc:bakeNpcTexture', async (_, dataPath, extraId, rgbaBase64, maskBase64) => {
  try {
    if (!dataPath) return { success: false, error: 'Client Data path is required.' };
    const id = Number(extraId);
    if (!Number.isInteger(id) || id <= 0) return { success: false, error: 'Extra ID must be a positive integer.' };
    const rgba = Buffer.from(rgbaBase64 || '', 'base64');
    const mask = Buffer.from(maskBase64 || '', 'base64');
    const pixels = 256 * 256;
    if (rgba.length !== pixels * 4) return { success: false, error: 'Bake RGBA must be ' + (pixels * 4) + ' bytes (256x256).' };
    if (mask.length !== pixels) return { success: false, error: 'Bake mask must be ' + pixels + ' bytes (256x256).' };

    const templatePath = 'Textures\\BakedNPCTextures\\CreatureDisplayExtra-24081.blp';
    let template = null;
    const mpqReader = getMpqReader();
    if (mpqReader.isDataPath(dataPath) && mpqReader.readBlpFromMpqs) template = await mpqReader.readBlpFromMpqs(dataPath, templatePath);
    if (!template) {
      const looseTemplate = path.join(dataPath, templatePath.replace(/\\/g, path.sep));
      if (fs.existsSync(looseTemplate)) template = fs.readFileSync(looseTemplate);
    }
    if (!template || template.length < 148 || template.toString('ascii', 0, 4) !== 'BLP2') {
      return { success: false, error: 'Bake template is missing or not BLP2: ' + templatePath };
    }
    if (template.readUInt32LE(12) !== 256 || template.readUInt32LE(16) !== 256) {
      return { success: false, error: 'Bake template must be exactly 256x256.' };
    }

    const baked = reencodeBlpDxtSelective(template, rgba, Uint8Array.from(mask, value => value > 0), 256, 256);
    const filename = 'CreatureDisplayExtra-' + id + '.blp';
    const outputRoot = path.join(app.getAppPath(), 'output', 'BakedNPCTextures');
    const outputPath = path.join(outputRoot, filename);
    fs.mkdirSync(outputRoot, { recursive: true });
    fs.writeFileSync(outputPath, baked);
    return { success: true, filename, path: outputPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('textureWorkshop:writeSql', async (_, name, sql) => {
  try {
    const safeName = String(name || '').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'texture_workshop_variant';
    const outPath = path.join(__dirname, '..', 'output', 'TextureWorkshop', `${safeName}.sql`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, String(sql || ''), 'utf8');
    return { success: true, path: outPath };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('textureWorkshop:stageDbc', async (_, dbcPath, payload = {}) => {
  try {
    const sourceDisplayPath = path.join(dbcPath, 'ItemDisplayInfo.dbc');
    const sourceSetPath = path.join(dbcPath, 'ItemSet.dbc');
    if (!fs.existsSync(sourceDisplayPath) || !fs.existsSync(sourceSetPath)) throw new Error('ItemDisplayInfo.dbc and ItemSet.dbc are required in the configured DBC folder.');
    const outputDir = path.join(__dirname, '..', 'output', 'DBFilesClient');
    fs.mkdirSync(outputDir, { recursive: true });
    const appendString = (strings, value) => {
      const text = Buffer.from(`${value}\0`, 'utf8');
      const offset = strings.length;
      return { offset, strings: Buffer.concat([strings, text]) };
    };
    const displayRaw = fs.readFileSync(sourceDisplayPath);
    if (displayRaw.toString('ascii', 0, 4) !== 'WDBC') throw new Error('Invalid ItemDisplayInfo.dbc');
    const displayCount = displayRaw.readUInt32LE(4), displaySize = displayRaw.readUInt32LE(12), displayRecordsEnd = 20 + displayCount * displaySize;
    if (displaySize < 100) throw new Error('Unsupported ItemDisplayInfo.dbc layout.');
    const displayStrings = displayRaw.slice(displayRecordsEnd);
    const displayById = new Map();
    for (let i = 0; i < displayCount; i++) displayById.set(displayRaw.readUInt32LE(20 + i * displaySize), 20 + i * displaySize);
    const textureMap = new Map(Object.entries(payload.textureMap || {}).map(([from, to]) => [path.basename(from).toLowerCase(), path.basename(to)]));
    let newStrings = Buffer.from(displayStrings), appendedDisplays = [];
    const displayMap = new Map();
    for (const item of payload.items || []) if (!displayMap.has(Number(item.sourceDisplayId))) displayMap.set(Number(item.sourceDisplayId), Number(item.newDisplayId));
    for (const [sourceId, newId] of displayMap) {
      const sourceOffset = displayById.get(sourceId);
      if (sourceOffset === undefined) throw new Error(`Source ItemDisplayInfo #${sourceId} was not found.`);
      const record = Buffer.from(displayRaw.slice(sourceOffset, sourceOffset + displaySize));
      record.writeUInt32LE(newId, 0);
      for (const field of [3, 4, 15, 16, 17, 18, 19, 20, 21, 22]) {
        const stringOffset = record.readUInt32LE(field * 4);
        const end = displayStrings.indexOf(0, stringOffset);
        const sourceName = end >= 0 ? displayStrings.toString('utf8', stringOffset, end) : '';
        const replacement = textureMap.get(path.basename(sourceName).toLowerCase());
        if (!replacement) continue;
        const appended = appendString(newStrings, replacement); newStrings = appended.strings; record.writeUInt32LE(appended.offset, field * 4);
      }
      appendedDisplays.push(record);
    }
    const stagedDisplay = Buffer.concat([Buffer.from(displayRaw.slice(0, 20)), Buffer.concat([displayRaw.slice(20, displayRecordsEnd), ...appendedDisplays]), newStrings]);
    stagedDisplay.writeUInt32LE(displayCount + appendedDisplays.length, 4);
    fs.writeFileSync(path.join(outputDir, 'ItemDisplayInfo.dbc'), stagedDisplay);

    const setRaw = fs.readFileSync(sourceSetPath);
    if (setRaw.toString('ascii', 0, 4) !== 'WDBC') throw new Error('Invalid ItemSet.dbc');
    const setCount = setRaw.readUInt32LE(4), setSize = setRaw.readUInt32LE(12), setLayout = getItemSetLayout(setSize), setRecordsEnd = 20 + setCount * setSize;
    if (!setLayout) throw new Error(`Unsupported ItemSet.dbc record size ${setSize}.`);
    let sourceSetOffset = -1;
    for (let i = 0; i < setCount; i++) { const offset = 20 + i * setSize; if (setRaw.readUInt32LE(offset) === Number(payload.sourceSetId)) { sourceSetOffset = offset; break; } }
    if (sourceSetOffset < 0) throw new Error(`Source ItemSet #${payload.sourceSetId} was not found.`);
    let setStrings = Buffer.from(setRaw.slice(setRecordsEnd));
    const setRecord = Buffer.from(setRaw.slice(sourceSetOffset, sourceSetOffset + setSize));
    setRecord.writeUInt32LE(Number(payload.newSetId), 0);
    const setName = appendString(setStrings, String(payload.newSetName || 'Custom Item Set')); setStrings = setName.strings; setRecord.writeUInt32LE(setName.offset, 4);
    const itemIds = new Map((payload.items || []).map(item => [Number(item.sourceItemId), Number(item.newItemId)]));
    for (let index = 0; index < 17; index++) { const offset = setLayout.itemsOffset + index * 4, sourceItemId = setRecord.readUInt32LE(offset); if (itemIds.has(sourceItemId)) setRecord.writeUInt32LE(itemIds.get(sourceItemId), offset); }
    const stagedSet = Buffer.concat([Buffer.from(setRaw.slice(0, 20)), setRaw.slice(20, setRecordsEnd), setRecord, setStrings]);
    stagedSet.writeUInt32LE(setCount + 1, 4);
    fs.writeFileSync(path.join(outputDir, 'ItemSet.dbc'), stagedSet);
    return { success: true, outputDir, displayCount: appendedDisplays.length, setId: Number(payload.newSetId) };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('dbc:readBlpTextures', async (_, dataPath, blpPaths) => {
  try {
    if (!dataPath || !Array.isArray(blpPaths)) return [];
    const mpqReader = getMpqReader();
    const useMpq = mpqReader.isDataPath(dataPath) && mpqReader.readBlpFromMpqs;

 // Groepeer BLPs per MPQ archive (om elke MPQ maar te openen).
    const directFiles = [];
    const byMpq = new Map();   // mpqAbsPath ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ [blpPath, ...]
    const results = new Array(blpPaths.length);

    if (useMpq) {
      const index = await mpqReader.buildBlpIndex(dataPath);
      for (let i = 0; i < blpPaths.length; i++) {
        const blpPath = blpPaths[i];
        if (!blpPath) { results[i] = { success: false, error: 'leeg', path: blpPath }; continue; }
        const cacheKey = blpCacheKey(blpPath);
        if (blpTextureCache.has(cacheKey)) {
          const hit = blpTextureCache.get(cacheKey);
          if (!hit.pngBase64) hit.pngBase64 = rgbaToPNG(Buffer.from(hit.textureRgba), hit.textureW, hit.textureH).toString('base64');
          results[i] = { success: true, w: hit.textureW, h: hit.textureH, png: hit.pngBase64, path: blpPath };
          continue;
        }
        const k = blpPath.replace(/\//g, '\\').toLowerCase();
        const mpqAbsPath = index.get(k);
        if (!mpqAbsPath) { directFiles.push({ i, blpPath }); continue; }
        if (!byMpq.has(mpqAbsPath)) byMpq.set(mpqAbsPath, []);
        byMpq.get(mpqAbsPath).push({ i, blpPath, cacheKey });
      }
    } else {
      for (let i = 0; i < blpPaths.length; i++) {
        directFiles.push({ i, blpPath: blpPaths[i] });
      }
    }

 // Open elke MPQ en lees alle BLPs eruit.
    if (byMpq.size) {
      await Promise.all([...byMpq.entries()].map(async ([mpqAbsPath, items]) => {
        let archive = null;
        try { archive = await mpqReader.openArchive(dataPath, mpqAbsPath); }
        catch (e) {
          for (const it of items) results[it.i] = { success: false, error: 'MPQ open fout: ' + e.message, path: it.blpPath };
          return;
        }
        try {
          for (const it of items) {
            try {
              const buf = archive.readFile(it.blpPath);
              if (!buf || buf.length < 4 || buf.toString('ascii', 0, 4) !== 'BLP2') {
                results[it.i] = { success: false, error: 'BLP niet gevonden of geen BLP2', path: it.blpPath };
                continue;
              }
              const decoded = decodeBLP(buf);
              const pngBase64 = rgbaToPNG(Buffer.from(decoded.rgba), decoded.w, decoded.h).toString('base64');
              blpTextureCache.set(it.cacheKey, {
                textureRgba: new Uint8Array(decoded.rgba),
                textureW: decoded.w, textureH: decoded.h,
                blpPath: it.blpPath, pngBase64,
              });
              results[it.i] = { success: true, w: decoded.w, h: decoded.h, png: pngBase64, path: it.blpPath };
            } catch (e) {
              results[it.i] = { success: false, error: e.message, path: it.blpPath };
            }
          }
        } finally {
          try { archive.close(); } catch (_) {}
        }
      }));
    }

 // Direct-file fallback (niet-MPQ dataPath of paths niet in listfile).
 // Bij MPQ-dataPath: eerst losse file proberen, dan full MPQ scan (zelfde pad als dbc:readBlpTexture).
    for (const { i, blpPath } of directFiles) {
      if (!blpPath) { results[i] = { success: false, error: 'leeg', path: blpPath }; continue; }
      const cacheKey = blpCacheKey(blpPath);
      if (blpTextureCache.has(cacheKey)) {
        const hit = blpTextureCache.get(cacheKey);
        if (!hit.pngBase64) hit.pngBase64 = rgbaToPNG(Buffer.from(hit.textureRgba), hit.textureW, hit.textureH).toString('base64');
        results[i] = { success: true, w: hit.textureW, h: hit.textureH, png: hit.pngBase64, path: blpPath };
        continue;
      }
      try {
        let buf = null;
        const direct = path.join(dataPath, blpPath.replace(/\\/g, path.sep));
        if (fs.existsSync(direct)) {
          buf = fs.readFileSync(direct);
        } else if (useMpq) {
 // Niet in listfile-index en niet als losse file full MPQ scan als fallback
          buf = await mpqReader.readBlpFromMpqs(dataPath, blpPath);
        }
        if (!buf || buf.length < 4 || buf.toString('ascii', 0, 4) !== 'BLP2') {
          results[i] = { success: false, error: 'Niet gevonden', path: blpPath }; continue;
        }
        const decoded = decodeBLP(buf);
        const pngBase64 = rgbaToPNG(Buffer.from(decoded.rgba), decoded.w, decoded.h).toString('base64');
        blpTextureCache.set(cacheKey, {
          textureRgba: new Uint8Array(decoded.rgba),
          textureW: decoded.w, textureH: decoded.h,
          blpPath, pngBase64,
        });
        results[i] = { success: true, w: decoded.w, h: decoded.h, png: pngBase64, path: blpPath };
      } catch (e) {
        results[i] = { success: false, error: e.message, path: blpPath };
      }
    }
    return results;
  } catch (e) {
    return blpPaths.map(p => ({ success: false, error: e.message, path: p }));
  }
});


