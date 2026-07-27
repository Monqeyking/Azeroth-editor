const net = require('net');
const path = require('path');

let pty;
try { pty = require('node-pty'); }
catch (error) { console.error('node-pty is required for the server console host:', error.message); process.exit(1); }

const PORT = 47321;
const MAX_LINES = 500;
const sessions = { auth: null, world: null };
const history = { auth: [], world: [] };
const clients = new Set();

function send(client, message) {
  if (!client.destroyed) client.write(`${JSON.stringify(message)}\n`);
}

function broadcast(message) {
  for (const client of clients) send(client, message);
}

function addLine(type, text) {
  const clean = String(text)
    .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\r/g, '');
  for (const line of clean.split('\n')) {
    if (!line) continue;
    history[type].push(line);
    if (history[type].length > MAX_LINES) history[type].splice(0, history[type].length - MAX_LINES);
    broadcast({ event: 'output', type, line });
  }
}

function start(type, exePath) {
  if (!['auth', 'world'].includes(type)) throw new Error('Unknown server type');
  if (sessions[type]) return { success: false, error: 'Already running' };
  const proc = pty.spawn(exePath, [], {
    name: 'xterm-256color', cols: 220, rows: 50,
    cwd: path.dirname(exePath), env: { ...process.env, TERM: 'xterm-256color' },
  });
  sessions[type] = { proc, startedAt: Date.now() };
  proc.onData(data => addLine(type, data));
  proc.onExit(({ exitCode }) => {
    if (sessions[type]?.proc === proc) sessions[type] = null;
    addLine(type, `[Process exited: ${exitCode}]`);
  });
  return { success: true };
}

function command(type, text) {
  const proc = sessions[type]?.proc;
  if (!proc) return { success: false, error: 'Process not running in console host' };
  proc.write(`${text}\r`);
  return { success: true };
}

function status() {
  const now = Date.now();
  return {
    success: true,
    servers: Object.fromEntries(Object.entries(sessions).map(([type, session]) => [type, session ? {
      running: true, uptimeMs: now - session.startedAt, pid: session.proc.pid,
    } : { running: false, uptimeMs: 0, pid: null }])),
  };
}

const server = net.createServer(client => {
  clients.add(client);
  let buffer = '';
  client.on('data', data => {
    buffer += data.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let request;
      try { request = JSON.parse(raw); } catch { continue; }
      let result;
      try {
        if (request.action === 'subscribe') {
          for (const type of ['auth', 'world']) for (const line of history[type]) send(client, { event: 'output', type, line });
          result = { success: true };
        } else if (request.action === 'start') result = start(request.type, request.exePath);
        else if (request.action === 'command') result = command(request.type, request.command || '');
        else if (request.action === 'status') result = status();
        else result = { success: false, error: 'Unknown action' };
      } catch (error) { result = { success: false, error: error.message }; }
      if (request.id) send(client, { id: request.id, ...result });
    }
  });
  client.on('close', () => clients.delete(client));
  client.on('error', () => clients.delete(client));
});

server.on('error', error => { console.error(error.message); process.exit(1); });
server.listen(PORT, '127.0.0.1');
