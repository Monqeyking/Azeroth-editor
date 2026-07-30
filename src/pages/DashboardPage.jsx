import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useConnection } from '../lib/ConnectionContext';
import { Swords, Package, ScrollText, Sparkles, Database, Activity, Server, Play, Square, Terminal, Send, Users, HeartPulse, RefreshCw, Save, Search, SlidersHorizontal } from 'lucide-react';
import './DashboardPage.css';

const MAX_LINES = 500;
const QUICK_ACTIONS = [
  { id: 'save-all', label: 'Save all', command: '.saveall', icon: Save, description: 'Save active characters to the database.' },
  { id: 'reload-config', label: 'Reload config', command: '.reload config', icon: RefreshCw, description: 'Reload Worldserver configuration files.' },
  { id: 'reload-scripts', label: 'Reload scripts', command: '.reload scripts', icon: RefreshCw, description: 'Reload server scripts.' },
  { id: 'reload-creatures', label: 'Reload creatures', command: '.reload creature_template', icon: RefreshCw, description: 'Reload creature templates.' },
  { id: 'reload-items', label: 'Reload items', command: '.reload item_template', icon: RefreshCw, description: 'Reload item templates.' },
  { id: 'reload-quests', label: 'Reload all quests', command: '.reload all quest', icon: RefreshCw, description: 'Reload all safely reloadable quest data, including quest givers and relations.' },
];

function formatUptime(ms) {
  if (!ms) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function ServerConsole({ type, label, serverStatus, exePath, onCommand }) {
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const lastLiveLine = useRef({ text: '', at: 0 });

  useEffect(() => {
    if (serverStatus !== 'offline' || !exePath) return undefined;
    let active = true;
    const load = async () => {
      const result = await window.azeroth.server.readLog({ type, exePath });
      if (active && result.success) setLines(result.lines || []);
    };
    load();
    const timer = setInterval(load, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [type, exePath, serverStatus]);

  useEffect(() => {
    if (serverStatus !== 'offline') setLines([]);
  }, [serverStatus]);

  useEffect(() => {
    const listener = window.azeroth.server.onOutput(message => {
      if (message.type !== type) return;
      const line = String(message.line).replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '');
      if (!line) return;
      const now = Date.now();
      if (lastLiveLine.current.text === line && now - lastLiveLine.current.at < 1000) return;
      lastLiveLine.current = { text: line, at: now };
      setLines(current => [...current, line].slice(-MAX_LINES));
    });
    return () => window.azeroth.server.offOutput(listener);
  }, [type]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const sendCommand = async () => {
    const command = input.trim();
    if (!command || !onCommand) return;
    setInput('');
    await onCommand(command);
  };

  const isActive = serverStatus !== 'offline';

  return (
    <div className={`server-console${isActive ? ' active' : ''}`}>
      <div className="console-header">
        <Terminal size={13} />
        <span>{label}</span>
        <span className={`status-dot ${serverStatus}`} style={{ marginLeft: 'auto' }} />
      </div>
      <div className="console-output" aria-live="polite">
        {lines.length === 0
          ? <span className="console-empty">{isActive ? 'Waiting for log output...' : 'Server offline'}</span>
          : lines.map((l, i) => <div key={i} className="console-line">{l}</div>)
        }
        <div ref={bottomRef} />
      </div>
      {onCommand && <div className="console-input-row">
        <input className="console-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendCommand()} placeholder={isActive ? `Enter ${label.toLowerCase()} command...` : 'Server offline'} disabled={!isActive} spellCheck={false} />
        <button className="console-send" onClick={sendCommand} disabled={!isActive || !input.trim()} title="Send console command"><Send size={13} /></button>
      </div>}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ '--icon-color': color }}>
        <Icon size={18} />
      </div>
      <div className="stat-info">
        <span className="stat-value">{value ?? '...'}</span>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  );
}

function HealthItem({ label, status, detail }) {
  return (
    <div className="health-item">
      <span className={`status-dot ${status}`} />
      <div><strong>{label}</strong><small>{status === 'online' ? detail : status}</small></div>
    </div>
  );
}

function CustomTotal({ label, value }) {
  return <div className="custom-total"><strong>{value?.toLocaleString() ?? '—'}</strong><small>{label}</small></div>;
}

function ServerConfigPanel({ serverPaths }) {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState('');
  const [settings, setSettings] = useState([]);
  const [original, setOriginal] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const changes = settings.filter((item, index) => item.value !== original[index]?.value);

  const loadFiles = useCallback(async () => {
    setLoading(true); setNotice('');
    const result = await window.azeroth.serverConfig.list(serverPaths);
    if (!result.success) { setNotice(result.error); setLoading(false); return; }
    setFiles(result.files || []);
    setSelected(current => result.files?.some(file => file.filePath === current) ? current : (result.files?.[0]?.filePath || ''));
    setLoading(false);
  }, [serverPaths]);

  const loadSettings = useCallback(async () => {
    if (!selected) { setSettings([]); setOriginal([]); return; }
    setLoading(true); setNotice('');
    const result = await window.azeroth.serverConfig.read(selected);
    if (result.success) {
      const ordered = [...(result.settings || [])].sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' }));
      setSettings(ordered); setOriginal(ordered);
    }
    else setNotice(result.error);
    setLoading(false);
  }, [selected]);

  useEffect(() => { loadFiles(); }, [loadFiles]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const save = async () => {
    if (!changes.length) return;
    setNotice('Saving...');
    const result = await window.azeroth.serverConfig.save(selected, changes);
    if (result.success) { setOriginal(settings); setNotice(`Saved ${changes.length} setting${changes.length === 1 ? '' : 's'}. Backup created beside the config file.`); }
    else setNotice(result.error || 'Could not save config.');
  };
  const visible = settings.filter(item => `${item.key} ${item.value} ${item.description}`.toLowerCase().includes(filter.toLowerCase()));

  const fileName = files.find(file => file.filePath === selected)?.name;
  return <div className="dashboard fade-in">
    <header className="dashboard-header">
      <div><h1>Server Config</h1><p>Tune active AzerothCore settings with the same workflow as the server dashboard.</p></div>
      <div className="dashboard-header-status"><SlidersHorizontal size={12} /><span>{changes.length ? `${changes.length} unsaved change${changes.length === 1 ? '' : 's'}` : 'All changes saved'}</span></div>
    </header>
    <div className="dashboard-toolbar config-toolbar">
      <span><Server size={14} />{fileName || 'No config selected'}</span>
      <span className="dashboard-toolbar-divider" />
      <span><Database size={14} />{settings.length.toLocaleString()} settings</span>
      <span className="dashboard-toolbar-spacer" />
      <button className="btn-ghost" onClick={loadSettings} disabled={!selected || loading}><RefreshCw size={13} /> Reload</button>
      <button className="btn-primary" onClick={save} disabled={!changes.length}><Save size={13} /> Save {changes.length ? `(${changes.length})` : ''}</button>
    </div>
    <div className="dashboard-control config-controls">
      <div className="panel config-file-panel">
        <div className="panel-header"><Server size={14} /><span>Configuration File</span></div>
        <div className="panel-content">
          <label className="config-label">Active file</label>
          <select value={selected} onChange={e => setSelected(e.target.value)} disabled={!files.length}>
            {!files.length && <option>No server config found</option>}
            {files.map(file => <option key={file.filePath} value={file.filePath}>{file.name}</option>)}
          </select>
          <small>Files are read from the folders of the configured server executables.</small>
        </div>
      </div>
      <div className="panel config-search-panel">
        <div className="panel-header"><Search size={14} /><span>Find a Setting</span></div>
        <div className="panel-content"><div className="config-search"><Search size={14} /><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search settings, values or comments..." /></div><small>{visible.length.toLocaleString()} matching settings</small></div>
      </div>
    </div>
    {notice && <div className={`config-notice${notice.startsWith('Saved') ? ' success' : ''}`}>{notice}</div>}
    {!serverPaths.worldExe && !serverPaths.authExe && <div className="panel"><div className="config-empty"><SlidersHorizontal size={24} /><strong>Server paths are not set</strong><span>Set the Worldserver or Authserver executable path in Settings first.</span></div></div>}
    {loading && selected ? <div className="panel"><div className="loading-text">Loading config...</div></div> : !!selected && <div className="panel config-settings-panel">
      <div className="panel-header"><SlidersHorizontal size={14} /><span>Settings</span><span className="config-count">{visible.length.toLocaleString()}</span></div>
      <div className="panel-content config-list">
        <div className="config-list-header"><span>Setting</span><span>Value</span><span>Description</span></div>
        {visible.map(item => <div className={`config-row${item.value !== original[settings.indexOf(item)]?.value ? ' changed' : ''}`} key={item.line}>
          <code>{item.key}</code>
          { /^(true|false|0|1)$/i.test(item.value) ? <select value={item.value} onChange={e => setSettings(current => current.map(row => row.line === item.line ? { ...row, value: e.target.value } : row))}>{/^(0|1)$/.test(item.value) ? <><option value="1">1 — True</option><option value="0">0 — False</option></> : <><option value="true">true — Enabled</option><option value="false">false — Disabled</option></>}</select> : <input value={item.value} onChange={e => setSettings(current => current.map(row => row.line === item.line ? { ...row, value: e.target.value } : row))} spellCheck={false} />}
          <span>{item.description || '—'}</span>
        </div>)}
        {!visible.length && <div className="config-empty">No settings match this search.</div>}
      </div>
    </div>}
  </div>;
}

export default function DashboardPage() {
  const { query, dbConfig, serverPaths, soapConfig, idRanges } = useConnection();
  const location = useLocation();
  const [stats, setStats] = useState({});
  const [customStats, setCustomStats] = useState({});
  const [onlinePlayers, setOnlinePlayers] = useState(null);
  const [recentCreatures, setRecentCreatures] = useState([]);
  const [loading, setLoading] = useState(true);

  const [serverStatus, setServerStatus] = useState({ auth: 'offline', world: 'offline', soap: 'offline', authUptimeMs: 0, worldUptimeMs: 0 });
  const [serverBusy, setServerBusy] = useState({ auth: false, world: false });
  const [actionBusy, setActionBusy] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const pollRef = useRef(null);

  const pollStatus = useCallback(async () => {
    const result = await window.azeroth.server.status({
      authHost: '127.0.0.1', authPort: 3724,
      worldHost: soapConfig.host || '127.0.0.1', worldPort: 8085,
      soapHost: soapConfig.host || '127.0.0.1', soapPort: soapConfig.port || 7878,
      authExe: serverPaths.authExe,
      worldExe: serverPaths.worldExe,
    });
    setServerStatus(result);
  }, [soapConfig.host, soapConfig.port, serverPaths.authExe, serverPaths.worldExe]);

  useEffect(() => {
    pollStatus();
    pollRef.current = setInterval(pollStatus, 5000);
    return () => clearInterval(pollRef.current);
  }, [pollStatus]);

  async function handleServer(type, action) {
    setServerBusy(b => ({ ...b, [type]: true }));
    const exePath = type === 'auth' ? serverPaths.authExe : serverPaths.worldExe;
    if (action === 'start') {
      await window.azeroth.server.start({ type, exePath });
      setServerStatus(s => ({ ...s, [type]: 'starting' }));
    } else {
      await window.azeroth.server.stop({ type, exePath });
      setServerStatus(s => ({ ...s, [type]: 'offline' }));
    }
    setServerBusy(b => ({ ...b, [type]: false }));
    setTimeout(pollStatus, 2000);
  }

  async function sendServerCommand(type, command) {
    return window.azeroth.server.sendCommand({ type, command });
  }

  async function runQuickAction(action) {
    setActionBusy(action.id);
    setActionNotice('');
    const result = await sendServerCommand('world', action.command);
    setActionNotice(result?.success ? `${action.label} sent to Worldserver.` : (result?.error || 'Worldserver command failed.'));
    setActionBusy('');
  }

  useEffect(() => {
    const timer = setTimeout(async () => {
      await window.azeroth.server.attachConsole();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    loadStats();
    const timer = setInterval(loadStats, 10000);
    return () => clearInterval(timer);
  }, [idRanges.creature, idRanges.item, idRanges.quest, idRanges.spell, dbConfig.database]);

  async function loadStats() {
    setLoading(true);
    const customStart = idRanges.creature || 4000000;
    const characterDatabase = String(dbConfig.database || '').replace(/_world$/i, '_characters');
    const characterTable = /^[A-Za-z0-9_]+$/.test(characterDatabase) ? `\`${characterDatabase}\`.characters` : 'characters';
    const [creatures, items, quests, spells, customCreatures, customItems, customQuests, customSpells, players] = await Promise.all([
      query('SELECT COUNT(*) as c FROM creature_template'),
      query('SELECT COUNT(*) as c FROM item_template'),
      query('SELECT COUNT(*) as c FROM quest_template'),
      query('SELECT COUNT(*) as c FROM spell_dbc'),
      query('SELECT COUNT(*) as c FROM creature_template WHERE entry >= ?', [customStart]),
      query('SELECT COUNT(*) as c FROM item_template WHERE entry >= ?', [idRanges.item || 4000000]),
      query('SELECT COUNT(*) as c FROM quest_template WHERE ID >= ?', [idRanges.quest || 4000000]),
      query('SELECT COUNT(*) as c FROM spell_dbc WHERE ID >= ?', [idRanges.spell || 4000000]),
      query(`SELECT COUNT(*) as c FROM ${characterTable} WHERE online = 1`).catch(() => ({ data: [{ c: null }] })),
    ]);

    setStats({
      creatures: creatures.data?.[0]?.c,
      items: items.data?.[0]?.c,
      quests: quests.data?.[0]?.c,
      spells: spells.data?.[0]?.c,
    });
    setCustomStats({
      creatures: customCreatures.data?.[0]?.c,
      items: customItems.data?.[0]?.c,
      quests: customQuests.data?.[0]?.c,
      spells: customSpells.data?.[0]?.c,
    });
    setOnlinePlayers(players.data?.[0]?.c ?? null);

    const recent = await query(
      'SELECT entry, name, minlevel, maxlevel, rank FROM creature_template WHERE entry >= ? ORDER BY entry DESC LIMIT 8',
      [idRanges.creature || 4000000]
    );
    setRecentCreatures(recent.data || []);
    setLoading(false);
  }

  if (location.pathname === '/server-config') return <ServerConfigPanel serverPaths={serverPaths} />;

  return (
    <div className="dashboard fade-in">
      <header className="dashboard-header">
        <div>
          <h1>Server Dashboard</h1>
          <p>Live server controls, custom content and database health.</p>
        </div>
        <div className="dashboard-header-status">
          <Activity size={12} className="pulse" />
          <span>{serverStatus.world === 'online' ? 'World online' : 'World offline'}</span>
        </div>
      </header>

      <div className="dashboard-toolbar">
        <span><Database size={14} />{dbConfig.host}:{dbConfig.port} / {dbConfig.database}</span>
        <span className="dashboard-toolbar-divider" />
        <span><Swords size={14} />Custom creature IDs {Number(idRanges.creature || 4000000).toLocaleString()}+</span>
        <span className="dashboard-toolbar-spacer" />
        <span className={`dashboard-toolbar-status ${serverStatus.soap}`}><i />SOAP {serverStatus.soap}</span>
      </div>

      <div className="stat-grid">
        <StatCard icon={Swords}    label="Creatures" value={stats.creatures?.toLocaleString()} color="var(--accent-red)" />
        <StatCard icon={Package}   label="Items"     value={stats.items?.toLocaleString()}     color="var(--accent-blue)" />
        <StatCard icon={ScrollText}label="Quests"    value={stats.quests?.toLocaleString()}    color="var(--accent-green)" />
        <StatCard icon={Sparkles}  label="Spells"    value={stats.spells?.toLocaleString()}    color="var(--accent-purple)" />
      </div>

      <div className="dashboard-overview">
        <div className="panel">
          <div className="panel-header"><HeartPulse size={14} /><span>Server Health</span></div>
          <div className="health-grid">
            <HealthItem label="Database" status="online" detail={dbConfig.database || 'Connected'} />
            <HealthItem label="Authserver" status={serverStatus.auth} detail={formatUptime(serverStatus.authUptimeMs) ? `Up ${formatUptime(serverStatus.authUptimeMs)}` : 'Port 3724'} />
            <HealthItem label="Worldserver" status={serverStatus.world} detail={formatUptime(serverStatus.worldUptimeMs) ? `Up ${formatUptime(serverStatus.worldUptimeMs)}` : 'Port 8085'} />
            <HealthItem label="SOAP" status={serverStatus.soap} detail={`Port ${soapConfig.port || 7878}`} />
            <div className="health-item players"><Users size={17} /><div><strong>{onlinePlayers ?? '—'}</strong><small>Online players</small></div></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><Sparkles size={14} /><span>Custom Content</span></div>
          <div className="custom-summary">
            <CustomTotal label="Creatures" value={customStats.creatures} />
            <CustomTotal label="Items" value={customStats.items} />
            <CustomTotal label="Quests" value={customStats.quests} />
            <CustomTotal label="Spells" value={customStats.spells} />
          </div>
        </div>
      </div>

      <div className="dashboard-control">
        <div className="panel">
          <div className="panel-header">
            <Server size={14} />
            <span>Server Control</span>
          </div>
          {[
            { type: 'auth',  label: 'Authserver',  hasPath: !!serverPaths.authExe },
            { type: 'world', label: 'Worldserver', hasPath: !!serverPaths.worldExe },
          ].map(({ type, label, hasPath }) => {
            const status = serverStatus[type];
            const busy = serverBusy[type];
            const isRunning = status === 'online' || status === 'starting';
            return (
              <div key={type} className="server-row">
                <div className="server-row-left">
                  <span className={`status-dot ${status}`} />
                  <div>
                    <div className="server-label">{label}</div>
                    <div className="server-status-text">{status}</div>
                  </div>
                </div>
                <div className="server-actions">
                  {!hasPath ? (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pad instellen in Settings</span>
                  ) : isRunning ? (
                    <button className="btn-ghost" style={{ fontSize: 12 }} disabled={busy} onClick={() => handleServer(type, 'stop')}>
                      <Square size={11} /> Stop
                    </button>
                  ) : (
                    <button className="btn-primary" style={{ fontSize: 12 }} disabled={busy || status === 'starting'} onClick={() => handleServer(type, 'start')}>
                      <Play size={11} /> Start
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="panel dashboard-quick-actions">
          <div className="panel-header"><RefreshCw size={14} /><span>Quick Actions</span></div>
          <div className="quick-action-grid">
            {QUICK_ACTIONS.map(action => {
              const Icon = action.icon;
              return <button key={action.id} className="quick-action" disabled={serverStatus.world !== 'online' || !!actionBusy} onClick={() => runQuickAction(action)} title={action.description}>
                <Icon size={14} className={actionBusy === action.id ? 'spin' : ''} />
                <span>{actionBusy === action.id ? 'Sending...' : action.label}</span>
              </button>;
            })}
          </div>
          {actionNotice && <div className="quick-action-notice">{actionNotice}</div>}
        </div>
      </div>

      <div className="server-consoles">
        <ServerConsole type="auth"  label="Authserver"  serverStatus={serverStatus.auth} exePath={serverPaths.authExe} onCommand={command => sendServerCommand('auth', command)} />
        <ServerConsole type="world" label="Worldserver" serverStatus={serverStatus.world} exePath={serverPaths.worldExe} onCommand={command => sendServerCommand('world', command)} />
      </div>

      <div className="dashboard-panels">
        <div className="panel">
          <div className="panel-header">
            <Swords size={14} />
            <span>Custom Creatures ({(idRanges.creature || 4000000).toLocaleString()}+)</span>
          </div>
          <div className="panel-content">
            {loading ? (
              <div className="loading-text">Loading...</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Entry</th>
                    <th>Name</th>
                    <th>Level</th>
                    <th>Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCreatures.map(c => (
                    <tr key={c.entry}>
                      <td className="mono">{c.entry}</td>
                      <td>{c.name}</td>
                      <td>{c.minlevel === c.maxlevel ? c.minlevel : `${c.minlevel}-${c.maxlevel}`}</td>
                      <td><RankBadge rank={c.rank} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <Database size={14} />
            <span>Database Info</span>
          </div>
          <div className="panel-content info-list">
            <div className="info-row">
              <span>Host</span>
              <span className="mono">{dbConfig.host}:{dbConfig.port}</span>
            </div>
            <div className="info-row">
              <span>Database</span>
              <span className="mono">{dbConfig.database}</span>
            </div>
            <div className="info-row">
              <span>User</span>
              <span className="mono">{dbConfig.user}</span>
            </div>
            <div className="info-row">
              <span>Status</span>
              <span className="tag tag-green">Connected</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const RANKS = ['Normal', 'Elite', 'Rare Elite', 'Boss', 'Rare'];
function RankBadge({ rank }) {
  const label = RANKS[rank] || 'Normal';
  const cls = rank === 3 ? 'tag-gold' : rank >= 1 ? 'tag-blue' : 'tag-green';
  return <span className={`tag ${cls}`}>{label}</span>;
}
