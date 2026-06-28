const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
let nodePty = null;
try { nodePty = require('node-pty'); } catch (e) { console.warn('node-pty not available, falling back to pipe spawn'); }

let BetterSqlite3 = null;
try { BetterSqlite3 = require('better-sqlite3'); } catch (e) { console.warn('better-sqlite3 not available'); }

const { parseDbc, serializeDbc, getString } = require('./dbc-sql');
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

// ─── Server process management ──────────────────────────────────────────────
let authProc = null;
let worldProc = null;

function checkTcpPort(host, port) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

ipcMain.handle('server:status', async (_, { authHost, authPort, worldHost, worldPort }) => {
  const [auth, world] = await Promise.all([
    checkTcpPort(authHost || '127.0.0.1', authPort || 3724),
    checkTcpPort(worldHost || '127.0.0.1', worldPort || 8085),
  ]);
  return {
    auth: auth ? 'online' : (authProc ? 'starting' : 'offline'),
    world: world ? 'online' : (worldProc ? 'starting' : 'offline'),
  };
});

ipcMain.handle('server:start', async (_, { type, exePath }) => {
  if (!exePath || !fs.existsSync(exePath)) return { success: false, error: 'Executable not found: ' + exePath };
  try {
    const emit = (line) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('server:output', { type, line });
    };

    if (nodePty) {
      // PTY mode: process thinks it's writing to a real console — no buffering, full output
      const spawnPty = () => nodePty.spawn(exePath, [], {
        name: 'xterm',
        cols: 220,
        rows: 50,
        cwd: path.dirname(exePath),
        env: { ...process.env, TERM: 'xterm' },
      });

      if (type === 'auth') {
        if (authProc) return { success: false, error: 'Already running' };
        authProc = spawnPty();
        authProc.onData(data => data.split(/\r?\n/).forEach(l => l.trim() && emit(l)));
        authProc.onExit(({ exitCode }) => { authProc = null; emit(`[Process exited: ${exitCode}]`); });
      } else {
        if (worldProc) return { success: false, error: 'Already running' };
        worldProc = spawnPty();
        worldProc.onData(data => data.split(/\r?\n/).forEach(l => l.trim() && emit(l)));
        worldProc.onExit(({ exitCode }) => { worldProc = null; emit(`[Process exited: ${exitCode}]`); });
      }
    } else {
      // Fallback: regular pipe spawn (buffered, but better than nothing)
      const pipe = (proc) => {
        const onData = (d) => d.toString().split(/\r?\n/).forEach(l => l.trim() && emit(l));
        proc.stdout?.on('data', onData);
        proc.stderr?.on('data', onData);
      };
      if (type === 'auth') {
        if (authProc) return { success: false, error: 'Already running' };
        authProc = spawn(exePath, [], { cwd: path.dirname(exePath), detached: false });
        pipe(authProc);
        authProc.on('exit', (code) => { authProc = null; emit(`[Process exited: ${code}]`); });
      } else {
        if (worldProc) return { success: false, error: 'Already running' };
        worldProc = spawn(exePath, [], { cwd: path.dirname(exePath), detached: false });
        pipe(worldProc);
        worldProc.on('exit', (code) => { worldProc = null; emit(`[Process exited: ${code}]`); });
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('server:sendCommand', async (_, { type, command }) => {
  const proc = type === 'auth' ? authProc : worldProc;
  if (!proc) return { success: false, error: 'Process not running' };
  try {
    // PTY uses .write(), pipe uses .stdin.write()
    if (nodePty && proc.write) {
      proc.write(command + '\r');
    } else if (proc.stdin) {
      proc.stdin.write(command + '\n');
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('server:stop', async (_, { type, exePath }) => {
  const proc = type === 'auth' ? authProc : worldProc;
  const { exec } = require('child_process');
  const kill = (cmd) => new Promise(resolve => exec(cmd, () => resolve()));

  try {
    if (proc) {
      try { proc.kill ? proc.kill() : proc.pid && (await kill(`taskkill /pid ${proc.pid} /f /t`)); } catch {}
      if (type === 'auth') authProc = null; else worldProc = null;
    }
    if (exePath) {
      const exeName = path.basename(exePath);
      await kill(`taskkill /im "${exeName}" /f`);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dialog:openFile', async (_, { title, filters }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select file',
    properties: ['openFile'],
    filters: filters || [{ name: 'Executables', extensions: ['exe'] }, { name: 'All Files', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openFolder', async (_, { title }) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select folder',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ─── DBC SQL ────────────────────────────────────────────────────────────────
ipcMain.handle('dbcSql:listFiles', async (_, { folder }) => {
  try {
    if (!fs.existsSync(folder)) return { success: true, files: [] };
    const files = fs.readdirSync(folder)
      .filter(f => f.toLowerCase().endsWith('.dbc'))
      .sort()
      .map(name => {
        try {
          const buf = fs.readFileSync(path.join(folder, name));
          if (buf.length >= 20 && buf.toString('ascii', 0, 4) === 'WDBC') {
            return { name, records: buf.readUInt32LE(4), fields: buf.readUInt32LE(8) };
          }
        } catch {}
        return { name, records: null, fields: null };
      });
    return { success: true, files };
  } catch (e) {
    return { success: false, error: e.message, files: [] };
  }
});

ipcMain.handle('dbcSql:query', async (_, { filePath, sql, writeBack, stringCols = [] }) => {
  if (!BetterSqlite3) return { success: false, error: 'better-sqlite3 not installed.\nRun: npm install better-sqlite3 --legacy-peer-deps && npm run rebuild' };
  try {
    const buffer = fs.readFileSync(filePath);
    const { records, fieldCount, recordCount, stringBlock } = parseDbc(buffer);

    const strSet  = new Set(stringCols);
    const db      = new BetterSqlite3(':memory:');
    const colDefs = Array.from({ length: fieldCount }, (_, i) =>
      `field_${i} ${strSet.has(i) ? 'TEXT' : 'INTEGER'}`
    ).join(', ');
    db.exec(`CREATE TABLE dbc (${colDefs})`);

    if (records.length) {
      const insert = db.prepare(`INSERT INTO dbc VALUES (${Array(fieldCount).fill('?').join(',')})`);
      db.transaction(rs => {
        for (const r of rs) {
          const row = strSet.size
            ? r.map((v, i) => strSet.has(i) ? getString(stringBlock, v) : v)
            : r;
          insert.run(...row);
        }
      })(records);
    }

    const trimmed = sql.trim().toUpperCase();
    let result;

    if (trimmed.startsWith('SELECT')) {
      const stmt = db.prepare(sql);
      const rows = stmt.all();
      const columns = rows.length > 0 ? Object.keys(rows[0]) : stmt.columns().map(c => c.name);
      result = { success: true, rows, columns, changes: 0 };
    } else {
      const info = db.prepare(sql).run();
      result = { success: true, rows: [], columns: [], changes: info.changes };
      if (writeBack && info.changes > 0) {
        const newBuf = serializeDbc(buffer, db, fieldCount, recordCount);
        fs.writeFileSync(filePath, newBuf);
        result.written = true;
      }
    }

    db.close();
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:listFolder', async (_, { folder }) => {
  try {
    if (!fs.existsSync(folder)) return { success: true, files: [] };
    const files = fs.readdirSync(folder).filter(f => fs.statSync(path.join(folder, f)).isFile());
    return { success: true, files };
  } catch (e) {
    return { success: false, error: e.message, files: [] };
  }
});

ipcMain.handle('fs:copyFiles', async (_, { files, srcDir, destDir }) => {
  try {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const copied = [];
    const missing = [];
    for (const file of files) {
      const src = path.join(srcDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, file));
        copied.push(file);
      } else {
        missing.push(file);
      }
    }
    return { success: true, copied, missing };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

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

// SkillLineAbility.dbc: fields per record (recordSize read from header)
// Offsets: ID(0), SkillLine(4), Spell(8), RaceMask(12), ClassMask(16),
//          ExcludeRace(20), ExcludeClass(24), MinSkillLineRank(28),
//          SupercededBySpell(32), AcquireMethod(36), TrivialSkillLineRankLow(40),
//          TrivialSkillLineRankHigh(44), ...
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

// Voeg een nieuw record toe aan SkillLineAbility.dbc
ipcMain.handle('dbc:addSkillLineAbility', async (_, dbcPath, entry) => {
  try {
    const filePath = path.join(dbcPath, 'SkillLineAbility.dbc');
    const raw = fs.readFileSync(filePath);
    const recordCount = raw.readUInt32LE(4);
    const recordSize = raw.readUInt32LE(12);
    const stringBlockSize = raw.readUInt32LE(16);
    const headerSize = 20;
    const recordsEnd = headerSize + recordCount * recordSize;

    const newRecord = Buffer.alloc(recordSize, 0);
    newRecord.writeUInt32LE(entry.ID >>> 0, 0);
    newRecord.writeUInt32LE(entry.SkillLine >>> 0, 4);
    newRecord.writeUInt32LE(entry.Spell >>> 0, 8);
    newRecord.writeUInt32LE((entry.RaceMask || 0) >>> 0, 12);
    newRecord.writeUInt32LE((entry.ClassMask || 0) >>> 0, 16);
    newRecord.writeUInt32LE((entry.AcquireMethod || 0) >>> 0, 28);
    newRecord.writeUInt32LE((entry.SupercededBySpell || 0) >>> 0, 32);
    newRecord.writeUInt32LE((entry.TrivialSkillLineRankLow || 0) >>> 0, 36);

    const newFile = Buffer.alloc(raw.length + recordSize);
    raw.copy(newFile, 0, 0, recordsEnd);          // header + bestaande records
    newRecord.copy(newFile, recordsEnd);           // nieuw record
    raw.copy(newFile, recordsEnd + recordSize, recordsEnd); // string block
    newFile.writeUInt32LE(recordCount + 1, 4);    // recordCount + 1

    fs.writeFileSync(filePath, newFile);
    return { success: true, id: entry.ID };
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
      ? parseInt(options.idMin) : (options.customOnly === true ? 4000000 : null);
    const idMax = options.idMax !== undefined && options.idMax !== null && options.idMax !== ''
      ? parseInt(options.idMax) : null;
    const duplicatesOnly = options.duplicatesOnly === true;
    const excludeProcSpells = options.excludeProcSpells !== false;

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
      const hasProcLikeBehavior = procTypeMask !== 0 || procChance !== 0 || procCharges !== 0 || trigger1 !== 0 || trigger2 !== 0 || trigger3 !== 0;

      if (trainerFilter && (!(attrs & 0x10000) || (attrs & 0x80000))) continue;
      if (trainerFilter && excludeProcSpells && hasProcLikeBehavior) continue;
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
    let nextId = Number(startId);
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

// SpellCastTimes.dbc: ID(0), CastTime(4), CastTimePerLevel(8), MinCastTime(12) — 4 fields × 4 bytes
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

// SpellDuration.dbc: ID(0), Duration(4), DurationPerLevel(8), MaxDuration(12) — 4 fields × 4 bytes
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
      const lut = src.readUInt32LE(bi + 4);
      const transparent = src.readUInt16LE(bi) <= src.readUInt16LE(bi + 2);
      const alphas = transparent
        ? Array.from({ length: 16 }, (_, i) => ((lut >>> (i * 2)) & 3) === 3 ? 0 : 255)
        : null;
      writeDXTPixels(src, bi, lut, rgba, bx, by, w, h, alphas);
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

function decodeBLP1(buffer) {
  // BLP1 header layout:
  // 0x00 magic "BLP1", 0x04 compression (1=palette,0=JPEG), 0x08 alphaBits,
  // 0x0C width, 0x10 height, 0x14 pictureType, 0x18 pictureSubType,
  // 0x1C mipOffsets[16], 0x5C mipSizes[16], 0x9C palette[256×BGRA]
  const compression = buffer.readUInt32LE(4);
  const alphaBits   = buffer.readUInt32LE(8);
  const w           = buffer.readUInt32LE(12);
  const h           = buffer.readUInt32LE(16);
  const mipOffset   = buffer.readUInt32LE(0x1C);
  const mipSize     = buffer.readUInt32LE(0x5C);

  if (compression !== 1) {
    // JPEG: jpegHeaderSize @ 0x9C, jpegHeader @ 0xA0, mipData @ mipOffset
    const { nativeImage } = require('electron');
    const jpegHeaderSize = buffer.readUInt32LE(0x9C);
    const jpegHeader = buffer.slice(0xA0, 0xA0 + jpegHeaderSize);
    const mipData    = buffer.slice(mipOffset, mipOffset + mipSize);
    const jpeg       = Buffer.concat([jpegHeader, mipData]);
    const img        = nativeImage.createFromBuffer(jpeg);
    if (img.isEmpty()) throw new Error('BLP1 JPEG: nativeImage leeg');
    const size   = img.getSize();
    const bitmap = img.getBitmap(); // BGRA, 32-bit
    const rgba   = Buffer.alloc(size.width * size.height * 4, 255);
    for (let i = 0; i < size.width * size.height; i++) {
      rgba[i*4]   = bitmap[i*4 + 2]; // R (BGRA→RGBA)
      rgba[i*4+1] = bitmap[i*4 + 1]; // G
      rgba[i*4+2] = bitmap[i*4];     // B
      rgba[i*4+3] = 255;
    }
    return { rgba, w: size.width, h: size.height };
  }

  const rgba = Buffer.alloc(w * h * 4, 255);
  const pixels = Math.min(w * h, mipSize);
  for (let i = 0; i < pixels; i++) {
    const idx = buffer[mipOffset + i];
    const p   = 0x9C + idx * 4; // palette: BGRA
    rgba[i*4]   = buffer[p + 2]; // R
    rgba[i*4+1] = buffer[p + 1]; // G
    rgba[i*4+2] = buffer[p];     // B
    if (alphaBits === 8) {
      rgba[i*4+3] = buffer[mipOffset + mipSize + i] ?? 255;
    } else if (alphaBits === 1) {
      rgba[i*4+3] = (buffer[mipOffset + mipSize + (i >> 3)] >> (i & 7)) & 1 ? 255 : 0;
    } else if (alphaBits === 4) {
      const byte = buffer[mipOffset + mipSize + (i >> 1)];
      rgba[i*4+3] = (i & 1) ? ((byte >> 4) * 17) : ((byte & 0xF) * 17);
    }
    // alphaBits === 0: alpha al 255 door Buffer.alloc(..., 255)
  }
  return { rgba, w, h };
}

function decodeBLP(buffer) {
  const magic = buffer.toString('ascii', 0, 4);
  if (magic === 'BLP1') return decodeBLP1(buffer);
  if (magic !== 'BLP2') throw new Error(`Onbekend BLP magic: ${magic}`);

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

// ── BLP2 selective-block encoder (DXT1 / DXT3 / DXT5) ──────────────────────
// Doel: een bewerkt gebied (masker) terugschrijven zonder de rest van de
// texture opnieuw te comprimeren. DXT1 werkt in onafhankelijke 4×4 blokken,
// dus blokken die het masker niet overlappen worden 1-op-1 gekopieerd uit de
// bron-BLP — geen kwaliteitsverlies buiten het bewerkte gebied.
function rgbToRgb565(r, g, b) {
  const r5 = Math.round(Math.max(0, Math.min(255, r)) * 31 / 255);
  const g6 = Math.round(Math.max(0, Math.min(255, g)) * 63 / 255);
  const b5 = Math.round(Math.max(0, Math.min(255, b)) * 31 / 255);
  return (r5 << 11) | (g6 << 5) | b5;
}

function compressDXTColorBlock(block, validMask, allowTransparency = false) {
  let minL = Infinity, maxL = -Infinity, minC = [0, 0, 0], maxC = [0, 0, 0];
  let hasTransparent = false;
  for (let i = 0; i < 16; i++) {
    if (!validMask[i]) continue;
    if (allowTransparency && block[i*4+3] < 128) { hasTransparent = true; continue; }
    const r = block[i*4], g = block[i*4+1], b = block[i*4+2];
    const l = r*0.299 + g*0.587 + b*0.114;
    if (l < minL) { minL = l; minC = [r, g, b]; }
    if (l > maxL) { maxL = l; maxC = [r, g, b]; }
  }
  if (minL === Infinity) minC = maxC = [0, 0, 0];
  let c0v = rgbToRgb565(maxC[0], maxC[1], maxC[2]);
  let c1v = rgbToRgb565(minC[0], minC[1], minC[2]);
  if (hasTransparent) {
    if (c0v > c1v) [c0v, c1v] = [c1v, c0v];
  } else {
    if (c0v < c1v) [c0v, c1v] = [c1v, c0v];
    if (c0v === c1v) {
      if (c0v < 0xffff) c0v++;
      else c1v--;
    }
  }
  const c0 = rgb565(c0v), c1 = rgb565(c1v);
  const palette = c0v > c1v ? [
    c0, c1,
    [((c0[0]*2+c1[0])/3)|0, ((c0[1]*2+c1[1])/3)|0, ((c0[2]*2+c1[2])/3)|0],
    [((c0[0]+c1[0]*2)/3)|0, ((c0[1]+c1[1]*2)/3)|0, ((c0[2]+c1[2]*2)/3)|0],
  ] : [
    c0, c1,
    [((c0[0]+c1[0])/2)|0, ((c0[1]+c1[1])/2)|0, ((c0[2]+c1[2])/2)|0],
    [0, 0, 0],
  ];
  let lut = 0;
  for (let i = 0; i < 16; i++) {
    if (hasTransparent && block[i*4+3] < 128) { lut |= 3 << (i * 2); continue; }
    const r = block[i*4], g = block[i*4+1], b = block[i*4+2];
    let best = 0, bestD = Infinity;
    for (let p = 0; p < 4; p++) {
      const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
      const d = dr*dr + dg*dg + db*db;
      if (d < bestD) { bestD = d; best = p; }
    }
    lut |= (best << (i * 2));
  }
  const out = Buffer.alloc(8);
  out.writeUInt16LE(c0v, 0);
  out.writeUInt16LE(c1v, 2);
  out.writeUInt32LE(lut >>> 0, 4);
  return out;
}

function compressDXT3Block(block, validMask) {
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    const alpha = validMask[i] ? Math.round(block[i*4+3] / 17) : 0;
    out[i >> 1] |= (alpha & 0xf) << ((i & 1) * 4);
  }
  compressDXTColorBlock(block, validMask).copy(out, 8);
  return out;
}

function compressDXT5Block(block, validMask) {
  const out = Buffer.alloc(16);
  let minA = 255, maxA = 0;
  for (let i = 0; i < 16; i++) if (validMask[i]) {
    minA = Math.min(minA, block[i*4+3]);
    maxA = Math.max(maxA, block[i*4+3]);
  }
  if (maxA === minA) {
    if (maxA < 255) maxA++;
    else minA--;
  }
  out[0] = maxA;
  out[1] = minA;
  const palette = [maxA, minA,
    Math.round((6*maxA+minA)/7), Math.round((5*maxA+2*minA)/7),
    Math.round((4*maxA+3*minA)/7), Math.round((3*maxA+4*minA)/7),
    Math.round((2*maxA+5*minA)/7), Math.round((maxA+6*minA)/7)];
  let bits = 0n;
  for (let i = 0; i < 16; i++) {
    const alpha = validMask[i] ? block[i*4+3] : 0;
    let best = 0, bestD = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const d = Math.abs(alpha - palette[p]);
      if (d < bestD) { bestD = d; best = p; }
    }
    bits |= BigInt(best) << BigInt(i * 3);
  }
  for (let i = 0; i < 6; i++) out[i+2] = Number((bits >> BigInt(i*8)) & 0xffn);
  compressDXTColorBlock(block, validMask).copy(out, 8);
  return out;
}

function downsampleRgba(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const rgba = Buffer.alloc(nw * nh * 4);
  const sxCount = w > 1 ? 2 : 1, syCount = h > 1 ? 2 : 1;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let dy = 0; dy < syCount; dy++) for (let dx = 0; dx < sxCount; dx++) {
        const sx = Math.min(w-1, x*2+dx), sy = Math.min(h-1, y*2+dy);
        sum += src[(sy*w+sx)*4+c];
      }
      rgba[(y*nw+x)*4+c] = Math.round(sum / (sxCount * syCount));
    }
  }
  return { rgba, w: nw, h: nh };
}

function downsampleMask(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const mask = new Uint8Array(nw * nh);
  const sxCount = w > 1 ? 2 : 1, syCount = h > 1 ? 2 : 1;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    for (let dy = 0; dy < syCount; dy++) for (let dx = 0; dx < sxCount; dx++) {
      const sx = Math.min(w-1, x*2+dx), sy = Math.min(h-1, y*2+dy);
      if (src[sy*w+sx]) mask[y*nw+x] = 1;
    }
  }
  return mask;
}

// editedRgba: volledige RGBA buffer (w*h*4) na recolor. maskBool: bool[w*h],
// true = pixel zit binnen het bewerkte masker. Alleen blokken die minstens 1
// gemaskeerde pixel bevatten worden herschreven.
function reencodeBlpDxtSelective(originalBuf, editedRgba, maskBool, w, h) {
  const encoding = originalBuf.readUInt8(8);
  const alphaEncoding = originalBuf.readUInt8(10);
  if (encoding !== 2 || ![0, 1, 7].includes(alphaEncoding)) {
    throw new Error('Recolor ondersteunt alleen BLP2 DXT1, DXT3 en DXT5');
  }

  const out = Buffer.from(originalBuf);
  let mipRgba = Buffer.from(editedRgba);
  let mipMask = Uint8Array.from(maskBool, v => v ? 1 : 0);
  let mw = w, mh = h;
  const blockBytes = alphaEncoding === 0 ? 8 : 16;

  for (let mip = 0; mip < 16; mip++) {
    const offset = originalBuf.readUInt32LE(20 + mip * 4);
    const size = originalBuf.readUInt32LE(84 + mip * 4);
    if (!offset || !size) break;

    const mipData = Buffer.from(originalBuf.slice(offset, offset + size));
    const bw = Math.ceil(mw / 4), bh = Math.ceil(mh / 4);
    const block = new Uint8Array(16 * 4);
    const validMask = new Array(16);

    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let touched = false;
        for (let py = 0; py < 4 && !touched; py++) {
          for (let px = 0; px < 4; px++) {
            const ix = bx*4+px, iy = by*4+py;
            if (ix < mw && iy < mh && mipMask[iy*mw+ix]) { touched = true; break; }
          }
        }
        if (!touched) continue;

        for (let py = 0; py < 4; py++) {
          for (let px = 0; px < 4; px++) {
            const ix = Math.min(bx*4+px, mw-1), iy = Math.min(by*4+py, mh-1);
            const idx = py*4+px;
            const srcOff = (iy*mw+ix)*4;
            block[idx*4] = mipRgba[srcOff];
            block[idx*4+1] = mipRgba[srcOff+1];
            block[idx*4+2] = mipRgba[srcOff+2];
            block[idx*4+3] = mipRgba[srcOff+3];
            validMask[idx] = bx*4+px < mw && by*4+py < mh;
          }
        }

        const compressed = alphaEncoding === 7
          ? compressDXT5Block(block, validMask)
          : alphaEncoding === 1
            ? compressDXT3Block(block, validMask)
            : compressDXTColorBlock(block, validMask, originalBuf.readUInt8(9) > 0);
        compressed.copy(mipData, (by*bw+bx) * blockBytes);
      }
    }

    mipData.copy(out, offset);
    if (mw === 1 && mh === 1) break;
    const next = downsampleRgba(mipRgba, mw, mh);
    mipMask = downsampleMask(mipMask, mw, mh);
    mipRgba = next.rgba;
    mw = next.w;
    mh = next.h;
  }
  return out;
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
    const allSpawns = [...creatures, ...gameobjects];
    return { success: true, data: allSpawns };
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

    if (!offsMCVT || mcnkOff + offsMCVT + 8 + 580 > buf.length) { chunks.push(null); continue; }

    // Valideer MCVT magic ('TVCM' = reversed 'MCVT')
    // ofsHeight is relatief aan mcnkOff (chunk start incl. 8-byte header), niet ds — zelfde conventie als ofsLayer/ofsAlpha.
    const mcvtMagic = buf.slice(mcnkOff + offsMCVT, mcnkOff + offsMCVT + 4).toString('ascii');
    if (mcvtMagic !== 'TVCM') { chunks.push(null); continue; }

    const hStart = mcnkOff + offsMCVT + 8;
    // MCVT: 17 floats per rij: 9 outer + 8 inner (staggered centers)
    // outer[r][c] = hStart + (r*17 + c) * 4          (r=0..8, c=0..8)
    // inner[r][c] = hStart + (r*17 + 9 + c) * 4      (r=0..7, c=0..7)
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
    chunks.push({ ix, iy, posX, posY, posZ, outer, inner });
  }
  return chunks;
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
  for (const chunk of chunks) {
    if (!chunk) continue;
    const { ix, iy, posZ, outer, inner } = chunk;
    const baseZ = isFinite(posZ) ? posZ : 0;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        v9[(iy * 8 + r) * 129 + (ix * 8 + c)] = baseZ + outer[r * 9 + c];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        v8[(iy * 8 + r) * 128 + (ix * 8 + c)] = baseZ + inner[r * 8 + c];
  }
  return { v9, v8 };
}

ipcMain.handle('adt:getTerrain', async (_, { mapName, tiles }) => {
  try {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) return { success: true, data: [] };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

    const mapsPath = cfg.mapsPath;
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
          result.push({ tileX, tileY, ...parsed });
        }
      }
      return { success: true, data: result };
    }

    const dataPath = cfg.worldmapMpqPath;
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) return { success: true, data: [] };

    const result = [];
    for (const { tileX, tileY } of tiles) {
      const buf = await getMpqReader().readAdtBuffer(dataPath, mapName, tileY, tileX);
      if (!buf) continue;
      const chunks = parseAdt(buf);
      if (chunks) {
        const v9v8 = chunksToV9V8(chunks);
        const firstChunk = chunks.find(c => c);
        const minH = Math.min(...v9v8.v9.filter(isFinite));
        const maxH = Math.max(...v9v8.v9.filter(isFinite));
        console.log(`[terrain ADT] tile(${tileX},${tileY}) posZ=${firstChunk?.posZ?.toFixed(1)} heights min=${minH.toFixed(1)} max=${maxH.toFixed(1)} sample=[${Array.from(v9v8.v9.slice(0,5)).map(v=>v.toFixed(1)).join(',')}]`);
        result.push({ tileX, tileY, ...v9v8 });
      }
    }
    return { success: true, data: result };
  } catch (e) {
    console.error('adt:getTerrain error:', e);
    return { success: false, error: e.message };
  }
});

// WDL: low-res heightmap van de hele map. MAOF = 64×64 offsets, MARE = 17×17 outer heights.
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
      // Zelfde index-swap als ADT bestandsnamen: file (x,y) → renderer (tileX=y, tileY=x)
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

const minimapTexCache = new Map(); // `${dataPath}|${mapName}|${tileX}|${tileY}` → dataURL

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

// ─── ADT composite texture builder ───────────────────────────────────────────
// ── Terrain compositing (in main process, geen IPC round-trip voor ruwe BLPs) ──
// Zelfde logica als de oude terrainCompositor.worker.js, maar draait hier zodat
// alleen de finale RGBA (512×512) via IPC gaat in plaats van meerdere ruwe BLPs.

// Bilineaire resize van een RGBA buffer naar vaste afmetingen — terrain-textures in WoW zijn
// meestal 256x256, maar sommige sets wijken af. We normaliseren naar één gemeenschappelijke
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

// GPU shader-based terrain blending (vervangt CPU pre-compositing — zie Editor3DScene.jsx
// TerrainTile voor de shader die dit consumeert). In plaats van één geflatte lage-resolutie
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
    // Doel-index = chunk.iy*16+chunk.ix (expliciet, niet de MCIN-loopvolgorde i) — zelfde
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
  // Output: 64×64 = 4096 bytes, 8 bit per texel
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
  // Garbage in laatste rij/kolom (4-bit formaat quirk) — alleen fixen als de chunk niet al
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

// WDT MPHD.flags is de autoritatieve bron voor bigAlpha (niet ADT's eigen MHDR.flags — zie wowdev.wiki).
// 0x4 = adt_has_big_alpha, 0x80 = adt_has_height_texturing (beide impliceren 4096-byte flat alphamaps).
const wdtFlagsCache = new Map(); // mapName → bool | null (null = onbekend, gebruik heuristiek)

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
    console.log(`[terrain] WDT flags fout voor ${mapName}: ${e.message}`);
  }
  wdtFlagsCache.set(mapName, result);
  return result;
}

function parseAdtTextureLayers(buf, wdtBigAlpha = null) {
  let off = 0, mtexData = -1, mtexSize = 0, mcinData = -1;

  // bigAlpha: true/false als WDT MPHD.flags bekend is (autoritatief), anders null → gap-heuristiek per layer.
  // ADT's eigen MHDR.flags is GEEN geldige bron voor dit veld (zie wowdev.wiki) — alleen voor logging.
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
    // NIET aan ds (=mcnkOff+8, chunk-data start) — zie Noggit MapChunk.cpp: ofsLayer = lCurrentPosition - lMCNK_Position.
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
        if (global.__dbgChunkCount === undefined) global.__dbgChunkCount = 0;
        if (global.__dbgChunkCount < 6 && layers.length > 1) {
          global.__dbgChunkCount++;
          console.log(`[dbg] chunk ix=${ix} iy=${iy} nLayers=${nLayers} sizeAlpha=${sizeAlpha} mcalDataSize=${mcalDataSize} mcalDataOff=${mcalDataOff}`);
          layers.forEach((l, li) => console.log(`[dbg]   layer${li} tex=${l.textureIdx} flags=0x${l.flags.toString(16)} use_alpha=${!!(l.flags&0x100)} compressed=${!!(l.flags&0x200)} offsetInMcal=${l.offsetInMcal}`));
        }
        for (let l = 1; l < layers.length; l++) {
          const layer = layers[l];
          // use_alpha (0x100) niet gezet → geen geldige MCAL-data voor deze layer, offsetInMcal
          // kan garbage zijn. Niet lezen, anders krijg je willekeurige ruis-blotches (precies het
          // "sand random door durotar" symptoom).
          if (!(layer.flags & 0x100)) continue;
          const alphaOff = mcalDataOff + layer.offsetInMcal;
          if (alphaOff >= buf.length) continue;
          // Noggit (Alphamap::Alphamap, alphamap.cpp): 0x200 (compressed) wordt ALLEEN
          // gehonoreerd als use_big_alphamaps true is. Bij bigAlpha=false leest Noggit altijd
          // het legacy 4-bit packed formaat, ook als een MCLY-entry toevallig 0x200 heeft staan
          // (stale/irrelevant bit in dat formaat). Dit ongeconditioneerd checken gaf precies het
          // "sand random door durotar" symptoom — een toevallige 0x200-bit op een paar chunks
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
//   common.MPQ      → Azeroth + Kalimdor  (TILESET\Terrain\Ashenvale, Barrens, ...)
//   expansion.MPQ   → Outland             (TILESET\Terrain\Outland, ...)
//   lichking.MPQ    → Northrend           (TILESET\Terrain\Northrend, ...)
//   patch*.MPQ      → kunnen base-textures overschrijven
// ADT-bestanden (World\Maps\<map>\...) staan in dezelfde base-MPQs.
// De BLP-index in mpq-reader.js scant alle MPQs eenmalig en cached het resultaat.

// terrainBlpCache: path.toLowerCase() → { data: Uint8Array, w, h } | null
// Alleen I/O + BLP decode hier — de pixel-blending draait in de renderer Web Worker.
const terrainBlpCache = new Map();

ipcMain.handle('adt:getTextureLayers', async (_, { mapName, tiles }) => {
  const t0 = Date.now();
  try {
    const cfgPath = getConfigPath();
    if (!fs.existsSync(cfgPath)) return { success: true, data: [] };
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const dataPath = cfg.worldmapMpqPath;
    if (!dataPath || !getMpqReader().isDataPath(dataPath)) return { success: true, data: [] };

    const wdtBigAlpha = await getWdtBigAlpha(dataPath, mapName);
    console.log(`[terrain] ${mapName}: WDT bigAlpha=${wdtBigAlpha === null ? 'onbekend (fallback heuristiek)' : wdtBigAlpha}`);

    const result = [];
    for (const { tileX, tileY } of tiles) {
      const buf = await getMpqReader().readAdtBuffer(dataPath, mapName, tileY, tileX);
      if (!buf) continue;
      const parsed = parseAdtTextureLayers(buf, wdtBigAlpha);
      if (!parsed?.texturePaths.length) {
        console.log(`[terrain] ${tileX}_${tileY}: geen texturePaths (MTEX leeg of ontbreekt)`);
        continue;
      }
      console.log(`[terrain] ${tileX}_${tileY}: ${parsed.texturePaths.length} textures, bigAlpha=${parsed.bigAlpha ?? '?'} (adt mhdrFlags=${parsed.mhdrFlagsLog})`);

      // Verzamel unieke texture-indices
      const usedIdx = new Set();
      for (const chunk of parsed.chunks) {
        if (chunk) for (const l of chunk.layers) usedIdx.add(l.textureIdx);
      }

      // Laad BLPs parallel → ruwe RGBA (geen PNG encode, dat doet de worker)
      const blpRgba = {};
      await Promise.all([...usedIdx].map(async idx => {
        if (idx >= parsed.texturePaths.length) return;
        const rawPath = parsed.texturePaths[idx];
        const cacheKey = rawPath.replace(/\//g, '\\').toLowerCase();
        if (terrainBlpCache.has(cacheKey)) {
          const hit = terrainBlpCache.get(cacheKey);
          if (hit) blpRgba[idx] = hit;
          return;
        }
        try {
          const blpBuf = await getMpqReader().readBlpFromMpqs(dataPath, rawPath);
          if (blpBuf) {
            try {
              const { rgba, w, h } = decodeBLP(blpBuf);
              const entry = { data: new Uint8Array(rgba), w, h };
              terrainBlpCache.set(cacheKey, entry);
              blpRgba[idx] = entry;

              // TEMP DEBUG: dump rauwe gedecodeerde BLP als PNG, bypassed composite/3D pipeline volledig.
              if (!global.__dbgBlpDumped) global.__dbgBlpDumped = new Set();
              if (!global.__dbgBlpDumped.has(cacheKey)) {
                global.__dbgBlpDumped.add(cacheKey);
                try {
                  const dbgDir = path.join(__dirname, '..', 'debug-blp');
                  if (!fs.existsSync(dbgDir)) fs.mkdirSync(dbgDir, { recursive: true });
                  const safeName = rawPath.replace(/[\\/:]/g, '_') + `_${w}x${h}.png`;
                  const dumpPath = path.join(dbgDir, safeName);
                  fs.writeFileSync(dumpPath, rgbaToPNG(rgba, w, h));
                  console.log(`[dbg] BLP dump: ${rawPath} -> ${dumpPath}`);
                } catch (dumpErr) {
                  console.log(`[dbg] PNG dump fout voor ${rawPath}: ${dumpErr.message}`);
                }
              }
            } catch (decErr) {
              console.log(`[terrain] decodeBLP fout voor ${rawPath}: ${decErr.message}`);
              terrainBlpCache.set(cacheKey, null);
            }
          } else {
            console.log(`[terrain] BLP niet gevonden in MPQs: ${rawPath}`);
            terrainBlpCache.set(cacheKey, null);
          }
        } catch (readErr) {
          console.log(`[terrain] readBlpFromMpqs fout voor ${rawPath}: ${readErr.message}`);
          terrainBlpCache.set(cacheKey, null);
        }
      }));

      const missing = [...usedIdx].filter(i => !blpRgba[i]).map(i => parsed.texturePaths[i]);
      console.log(`[terrain] ${tileX}_${tileY}: ${Object.keys(blpRgba).length}/${usedIdx.size} BLPs geladen${missing.length ? ` | ontbreekt: ${missing.slice(0,3).join(', ')}` : ''}`);
      if (!Object.keys(blpRgba).length) continue;

      // Bouw per-tile texture-palette + per-chunk layer/alpha-data — geen CPU-compositing meer,
      // de renderer blend dit real-time in een shader (zie Editor3DScene.jsx TerrainTile).
      const chunks = parsed.chunks.map(c => {
        if (!c) return null;
        return {
          ix: c.ix, iy: c.iy,
          layers: c.layers.map(l => ({ textureIdx: l.textureIdx, alphaMap: l.alphaMap ?? null })),
        };
      });
      const tComp = Date.now();
      const { paletteRgba, paletteW, paletteH, paletteCount, chunkTexIndices, chunkAlpha } = buildTilePalette(blpRgba, chunks);
      console.log(`[palette] ${tileX}_${tileY}: ${Date.now()-tComp}ms, ${paletteCount} textures, ${Object.keys(blpRgba).length} BLPs geladen`);

      result.push({ tileX, tileY, paletteRgba, paletteW, paletteH, paletteCount, chunkTexIndices, chunkAlpha });
    }
    console.log(`[getTextureLayers] ${tiles.length} tiles → ${result.length} klaar in ${Date.now()-t0}ms total`);
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
  console.log(`[diagBLP] in BLP-index (${index.size} entries): ${inIndex} ${inIndex ? '→ ' + path.basename(index.get(key)) : ''}`);

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

// Character model paths per race/gender in WotLK MPQ
const CHAR_M2_PATHS = {
  1:  ['Character\\Human\\Male\\HumanMale.m2',        'Character\\Human\\Female\\HumanFemale.m2'],
  2:  ['Character\\Orc\\Male\\OrcMale.m2',            'Character\\Orc\\Female\\OrcFemale.m2'],
  3:  ['Character\\Dwarf\\Male\\DwarfMale.m2',        'Character\\Dwarf\\Female\\DwarfFemale.m2'],
  4:  ['Character\\NightElf\\Male\\NightElfMale.m2',  'Character\\NightElf\\Female\\NightElfFemale.m2'],
  5:  ['Character\\Scourge\\Male\\ScourgeMale.m2',    'Character\\Scourge\\Female\\ScourgeFemale.m2'],
  6:  ['Character\\Tauren\\Male\\TaurenMale.m2',      'Character\\Tauren\\Female\\TaurenFemale.m2'],
  7:  ['Character\\Gnome\\Male\\GnomeMale.m2',        'Character\\Gnome\\Female\\GnomeFemale.m2'],
  8:  ['Character\\Troll\\Male\\TrollMale.m2',        'Character\\Troll\\Female\\TrollFemale.m2'],
  10: ['Character\\BloodElf\\Male\\BloodElfMale.m2',  'Character\\BloodElf\\Female\\BloodElfFemale.m2'],
  11: ['Character\\Draenei\\Male\\DraeneiMale.m2',    'Character\\Draenei\\Female\\DraeneiFemale.m2'],
};

ipcMain.handle('m2:loadCharModel', async (_, { race, gender, skinBlp }) => {
  const log = (...a) => console.log(`[m2:char:${race}/${gender}]`, ...a);
  try {
    const dataPath = getM2DataPath();
    if (!dataPath) return { success: false, error: 'Geen MPQ pad ingesteld' };

    const m2Path = CHAR_M2_PATHS[race]?.[gender];
    if (!m2Path) return { success: false, error: `Onbekende race/gender: ${race}/${gender}` };

    const reader = getMpqReader();
    const geo = await getOrLoadM2Geometry(reader, dataPath, m2Path, log);
    if (!geo?.skin) return { success: false, error: `Model niet gevonden: ${m2Path}` };

    // Character geoset filtering — toon standaard naakt body
    const dbcData = await getM2DbcData(dataPath);
    const extra = { race, sex: gender, skin: 0, face: 0, hairStyle: 0, hairColor: 0, facialHair: 0 };
    const visible = resolveVisibleGeosets(geo.skin.submeshes, null, extra, dbcData.charHair, dbcData.facialHair);
    const indexList = buildIndicesFromSkin(geo.skin, visible);
    if (!indexList.length) return { success: false, error: 'Geen zichtbare submeshes' };

    // Skin texture laden
    let textureRgba = null, textureW = 0, textureH = 0, texturePath = null;
    if (skinBlp) {
      const key = blpCacheKey(skinBlp);
      let entry = blpTextureCache.get(key);
      if (!entry) {
        const direct = path.join(dataPath, skinBlp.replace(/\\/g, path.sep));
        let buf = null;
        if (fs.existsSync(direct)) {
          buf = fs.readFileSync(direct);
        }
        if (!buf) buf = await reader.readFileFromMpqs(dataPath, skinBlp);
        if (buf?.length >= 4 && buf.toString('ascii', 0, 4) === 'BLP2') {
          try {
            const decoded = decodeBLP(buf);
            entry = { textureRgba: new Uint8Array(decoded.rgba), textureW: decoded.w, textureH: decoded.h, blpPath: skinBlp };
            blpTextureCache.set(key, entry);
          } catch (e) { log('BLP decode fout:', e.message); }
        } else if (buf) {
          log('BLP niet gevonden of geen BLP2 magic:', skinBlp);
        }
      }
      if (entry) { textureRgba = entry.textureRgba; textureW = entry.textureW; textureH = entry.textureH; texturePath = entry.blpPath; }
    }

    return {
      success: true,
      data: {
        positions:    geo.positions,
        normals:      geo.normals,
        uvs:          geo.uvs,
        indices:      new Uint32Array(indexList),
        textureRgba,
        textureW,
        textureH,
        modelPath:    m2Path,
        texturePath,
        debug: {
          race, gender, skinBlp,
          triangleCount: Math.floor(indexList.length / 3),
          textureLoaded: !!textureRgba,
          visibleGeosets: [...visible].sort((a, b) => a - b),
        },
      },
    };
  } catch (e) {
    console.error('[m2:loadCharModel]', e);
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

// ─── CharBaseInfo.dbc ──────────────────────────────────────────────────────────
// Structure: WDBC header (20 bytes) + N records of 2 bytes (uint8 race, uint8 class) + 1 byte string block

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

// ─── ItemSet.dbc ──────────────────────────────────────────────────────────────
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

// CharSections.dbc: 10 fields × 4 bytes = 40 bytes/record
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

ipcMain.handle('dbc:writeCharSections', async (_, dbcPath, records) => {
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

    fs.writeFileSync(filePath, Buffer.concat([header, dataBuffer, stringBlock]));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Decode een BLP-texture uit de WoW Data folder (MPQ) of losse file en geef terug als PNG buffer.
// dataPath mag een WoW Data root zijn (met MPQs) of een gewone map met uitgepakte BLPs.
// Cached zowel RGBA als PNG base64 — herhaalde lookups hoeven niet opnieuw te encoden.
ipcMain.handle('dbc:readBlpTexture', async (_, dataPath, blpPath) => {
  try {
    if (!dataPath || !blpPath) return { success: false, error: 'dataPath of blpPath ontbreekt' };
    const key = blpCacheKey(blpPath);
    const hit = blpTextureCache.get(key);
    if (hit) {
      if (hit.pngBase64) return { success: true, w: hit.textureW, h: hit.textureH, png: hit.pngBase64, path: blpPath };
      hit.pngBase64 = rgbaToPNG(Buffer.from(hit.textureRgba), hit.textureW, hit.textureH).toString('base64');
      return { success: true, w: hit.textureW, h: hit.textureH, png: hit.pngBase64, path: blpPath };
    }

    let buf = null;
    const mpqReader = getMpqReader();
    if (mpqReader.isDataPath(dataPath) && mpqReader.readBlpFromMpqs) {
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
});

// Schrijft een bewerkt deel van een BLP terug als nieuwe loose-file BLP.
// editedRgbaBase64: volledige RGBA buffer (w*h*4) van de texture NA recolor.
// maskBase64: grayscale buffer (w*h, 1 byte/pixel) — >0 = bewerkt (zachte brush-randen tellen ook mee).
// outRelPath: relatief pad (t.o.v. dataPath) waar de nieuwe BLP komt, bv.
// "Character\\Human\\Female\\HumanFemaleSkin00_00_custom1.blp".
ipcMain.handle('dbc:writeBlpTextureEdit', async (_, dataPath, blpPath, editedRgbaBase64, maskBase64, outRelPath) => {
  try {
    if (!dataPath || !blpPath || !outRelPath) {
      return { success: false, error: 'dataPath, blpPath of outRelPath ontbreekt' };
    }
    let buf = null;
    const mpqReader = getMpqReader();
    if (mpqReader.isDataPath(dataPath) && mpqReader.readBlpFromMpqs) {
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

    const outAbs = path.join(dataPath, outRelPath.replace(/\\/g, path.sep));
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, newBlp);

    blpTextureCache.delete(blpCacheKey(outRelPath)); // forceer herladen van het nieuwe pad

    return { success: true, path: outRelPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Batch-variant: laad meerdere BLP-textures in één IPC. Opent elke MPQ maximaal 1×
// ongeacht hoeveel BLPs erin zitten — groot verschil met de single-call handler.
// Geeft een array terug in dezelfde volgorde als de input; ontbrekende BLPs krijgen
// { success: false } zodat de caller per item kan beslissen.
ipcMain.handle('dbc:readBlpTextures', async (_, dataPath, blpPaths) => {
  try {
    if (!dataPath || !Array.isArray(blpPaths)) return [];
    const mpqReader = getMpqReader();
    const useMpq = mpqReader.isDataPath(dataPath) && mpqReader.readBlpFromMpqs;

    // Groepeer BLPs per MPQ archive (om elke MPQ maar 1× te openen).
    const directFiles = [];
    const byMpq = new Map();   // mpqAbsPath → [blpPath, ...]
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

    // Open elke MPQ 1× en lees alle BLPs eruit.
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
          // Niet in listfile-index en niet als losse file — full MPQ scan als fallback
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



