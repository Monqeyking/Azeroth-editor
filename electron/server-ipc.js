const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFile, spawn } = require('child_process');

const CONSOLE_HOST_PORT = 47321;
const MAX_SERVER_LOG_LINES = 500;

function registerServerIpc(ipcMain, getMainWindow) {
  const startingServers = new Set();
  const consoleRequests = new Map();
  let consoleHostSocket = null;
  let consoleHostBuffer = '';
  let consoleRequestId = 0;
  let consoleHostSubscribed = false;
  let consoleSubscribePromise = null;

  function connectConsoleHost() {
    if (consoleHostSocket && !consoleHostSocket.destroyed) return Promise.resolve(consoleHostSocket);
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: CONSOLE_HOST_PORT });
      const fail = error => { socket.destroy(); reject(error); };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.removeListener('error', fail);
        consoleHostSocket = socket;
        consoleHostBuffer = '';
        consoleHostSubscribed = false;
        socket.on('data', data => {
          consoleHostBuffer += data.toString();
          let newline;
          while ((newline = consoleHostBuffer.indexOf('\n')) >= 0) {
            const raw = consoleHostBuffer.slice(0, newline);
            consoleHostBuffer = consoleHostBuffer.slice(newline + 1);
            let message;
            try { message = JSON.parse(raw); } catch { continue; }
            const mainWindow = getMainWindow();
            if (message.event === 'output' && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('server:output', message);
            }
            if (message.id && consoleRequests.has(message.id)) {
              const done = consoleRequests.get(message.id);
              consoleRequests.delete(message.id);
              done(message);
            }
          }
        });
        socket.on('close', () => {
          if (consoleHostSocket === socket) {
            consoleHostSocket = null;
            consoleHostSubscribed = false;
          }
        });
        socket.on('error', () => {
          if (consoleHostSocket === socket) {
            consoleHostSocket = null;
            consoleHostSubscribed = false;
          }
        });
        resolve(socket);
      });
    });
  }

  async function ensureConsoleHost() {
    try { return await connectConsoleHost(); } catch {}
    const helper = spawn(process.execPath, [path.join(__dirname, 'server-console-host.js')], {
      cwd: __dirname,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    helper.unref();
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 150));
      try { return await connectConsoleHost(); } catch {}
    }
    throw new Error('Console host did not start');
  }

  async function consoleRequest(action, payload = {}, startHost = false) {
    const socket = startHost ? await ensureConsoleHost() : await connectConsoleHost();
    const id = ++consoleRequestId;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        consoleRequests.delete(id);
        resolve({ success: false, error: 'Console host did not respond' });
      }, 5000);
      consoleRequests.set(id, message => {
        clearTimeout(timer);
        resolve(message);
      });
      socket.write(`${JSON.stringify({ id, action, ...payload })}\n`);
    });
  }

  function subscribeConsoleHost() {
    if (consoleHostSubscribed) return Promise.resolve({ success: true });
    if (consoleSubscribePromise) return consoleSubscribePromise;
    consoleSubscribePromise = consoleRequest('subscribe')
      .then(result => {
        if (result.success) consoleHostSubscribed = true;
        return result;
      })
      .finally(() => { consoleSubscribePromise = null; });
    return consoleSubscribePromise;
  }

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

  function getServerProcessInfo(exePath) {
    const name = path.basename(exePath || '', path.extname(exePath || '')).replace(/[^a-z0-9_-]/gi, '');
    if (!name) return Promise.resolve(null);
    const command = `$p=Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1; if ($p) { [Console]::Out.Write($p.Id.ToString()+','+$p.StartTime.ToUniversalTime().ToString('o')) }`;
    return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }, (error, stdout) => {
      if (error || !stdout?.trim()) return resolve(null);
      const [pid, startedAt] = stdout.trim().split(',');
      const time = Date.parse(startedAt);
      resolve(Number.isFinite(time) ? { pid: Number(pid), uptimeMs: Math.max(0, Date.now() - time) } : null);
    }));
  }

  function parseServerConfig(text) {
    const settings = [];
    let comments = [];
    text.split(/\r?\n/).forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (/^[#;]/.test(trimmed)) {
        comments.push(trimmed.replace(/^[#;]\s?/, ''));
        return;
      }
      const match = line.match(/^(\s*)([A-Za-z][\w.-]*)(\s*=\s*)(.*?)(\s*(?:[#;].*)?)$/);
      if (!match) { comments = []; return; }
      const descriptionLine = [...comments].reverse().find(comment => /^Description:\s*/i.test(comment));
      const fallback = [...comments].reverse().find(comment => comment && !/^[-#=_]+$/.test(comment));
      settings.push({
        line: index + 1,
        key: match[2],
        value: match[4].trim(),
        description: (descriptionLine || fallback || '').replace(/^Description:\s*/i, ''),
      });
      comments = [];
    });
    return settings;
  }

  function serverConfigFiles(exePath) {
    if (!exePath || !fs.existsSync(exePath)) return [];
    const serverRoot = path.dirname(exePath);
    const folders = [serverRoot, 'configs', 'config', 'etc']
      .map(name => name === serverRoot ? name : path.join(serverRoot, name))
      .filter(fs.existsSync);
    const files = [];
    const scan = (folder, recursive) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const filePath = path.join(folder, entry.name);
        if (recursive && entry.isDirectory()) scan(filePath, true);
        else if (/\.conf$/i.test(entry.name) && !/\.conf\.dist$/i.test(entry.name)) {
          files.push({ name: path.relative(serverRoot, filePath), path: filePath });
        }
      }
    };
    folders.forEach(folder => scan(folder, folder !== serverRoot));
    return [...new Map(files.map(file => [file.path.toLowerCase(), file])).values()]
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  ipcMain.handle('server:status', async (_, {
    authHost, authPort, worldHost, worldPort, soapHost, soapPort, authExe, worldExe,
  }) => {
    const [auth, world, soap, hostStatus, authProcess, worldProcess] = await Promise.all([
      checkTcpPort(authHost || '127.0.0.1', authPort || 3724),
      checkTcpPort(worldHost || '127.0.0.1', worldPort || 8085),
      checkTcpPort(soapHost || '127.0.0.1', soapPort || 7878),
      consoleRequest('status').catch(() => ({ success: false })),
      getServerProcessInfo(authExe),
      getServerProcessInfo(worldExe),
    ]);
    const sessions = hostStatus.success ? hostStatus.servers || {} : {};
    const authStarting = sessions.auth?.running || !!authProcess || startingServers.has('auth');
    const worldStarting = sessions.world?.running || !!worldProcess || startingServers.has('world');
    if (auth) startingServers.delete('auth');
    if (world) startingServers.delete('world');
    return {
      auth: auth ? 'online' : (authStarting ? 'starting' : 'offline'),
      world: world ? 'online' : (worldStarting ? 'starting' : 'offline'),
      soap: soap ? 'online' : 'offline',
      authUptimeMs: sessions.auth?.uptimeMs || authProcess?.uptimeMs || 0,
      worldUptimeMs: sessions.world?.uptimeMs || worldProcess?.uptimeMs || 0,
      authPid: sessions.auth?.pid || authProcess?.pid || null,
      worldPid: sessions.world?.pid || worldProcess?.pid || null,
    };
  });

  ipcMain.handle('server:attachConsole', async () => {
    try { return await subscribeConsoleHost(); }
    catch { return { success: false, error: 'No console host session is running' }; }
  });

  ipcMain.handle('server:start', async (_, { type, exePath }) => {
    if (!exePath || !fs.existsSync(exePath)) return { success: false, error: `Executable not found: ${exePath}` };
    if (type !== 'auth' && type !== 'world') return { success: false, error: 'Unknown server type' };
    try {
      const result = await consoleRequest('start', { type, exePath }, true);
      if (result.success) {
        startingServers.add(type);
        setTimeout(() => startingServers.delete(type), 60000);
      }
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server:sendCommand', async (_, { type, command }) => {
    try {
      return await consoleRequest('command', { type, command });
    } catch (error) {
      return { success: false, error: `Console host unavailable: ${error.message}` };
    }
  });

  ipcMain.handle('server:stop', async (_, { type, exePath }) => {
    try {
      startingServers.delete(type);
      if (exePath) {
        const exeName = path.basename(exePath);
        await new Promise(resolve => execFile('taskkill.exe', ['/im', exeName, '/f'], { windowsHide: true }, () => resolve()));
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('server:readLog', async (_, { type, exePath }) => {
    try {
      const fileName = type === 'auth' ? 'Auth.log' : 'Server.log';
      const logPath = path.join(path.dirname(exePath || ''), 'logs', fileName);
      if (!fs.existsSync(logPath)) return { success: true, lines: [] };
      const stat = fs.statSync(logPath);
      const bytes = Math.min(stat.size, 128 * 1024);
      const fd = fs.openSync(logPath, 'r');
      const data = Buffer.alloc(bytes);
      try { fs.readSync(fd, data, 0, bytes, stat.size - bytes); }
      finally { fs.closeSync(fd); }
      return {
        success: true,
        lines: data.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-MAX_SERVER_LOG_LINES),
      };
    } catch (error) {
      return { success: false, error: error.message, lines: [] };
    }
  });

  ipcMain.handle('serverConfig:list', async (_, { authExe, worldExe } = {}) => {
    try {
      const files = [...serverConfigFiles(worldExe), ...serverConfigFiles(authExe)];
      const unique = [...new Map(files.map(file => [file.path.toLowerCase(), file])).values()];
      return { success: true, files: unique.map(({ name, path: filePath }) => ({ name, filePath })) };
    } catch (error) {
      return { success: false, error: error.message, files: [] };
    }
  });

  ipcMain.handle('serverConfig:read', async (_, { filePath } = {}) => {
    try {
      if (!filePath || !fs.existsSync(filePath) || !/\.conf$/i.test(filePath)) throw new Error('Config file not found');
      const text = fs.readFileSync(filePath, 'utf8');
      return { success: true, settings: parseServerConfig(text) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('serverConfig:save', async (_, { filePath, updates = [] } = {}) => {
    try {
      if (!filePath || !fs.existsSync(filePath) || !/\.conf$/i.test(filePath)) throw new Error('Config file not found');
      const source = fs.readFileSync(filePath, 'utf8');
      const lines = source.split(/\r?\n/);
      for (const update of updates) {
        const index = Number(update.line) - 1;
        const match = lines[index]?.match(/^(\s*)([A-Za-z][\w.-]*)(\s*=\s*)(.*?)(\s*(?:[#;].*)?)$/);
        if (!match || match[2] !== update.key) throw new Error(`Setting changed externally: ${update.key}`);
        lines[index] = `${match[1]}${match[2]}${match[3]}${String(update.value ?? '')}${match[5]}`;
      }
      const backupPath = `${filePath}.azeroth-editor.bak`;
      fs.copyFileSync(filePath, backupPath);
      fs.writeFileSync(filePath, lines.join(source.includes('\r\n') ? '\r\n' : '\n'), 'utf8');
      return { success: true, backupPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerServerIpc };
