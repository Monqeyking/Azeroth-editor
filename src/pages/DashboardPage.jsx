import { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Swords, Package, ScrollText, Sparkles, Database, Activity, Server, Play, Square, Terminal, Send, Users, HeartPulse, RefreshCw, Save } from 'lucide-react';
import './DashboardPage.css';

const MAX_LINES = 500;
const QUICK_ACTIONS = [
  { id: 'save-all', label: 'Save all', command: '.saveall', icon: Save, description: 'Save active characters to the database.' },
  { id: 'reload-config', label: 'Reload config', command: '.reload config', icon: RefreshCw, description: 'Reload Worldserver configuration files.' },
  { id: 'reload-scripts', label: 'Reload scripts', command: '.reload scripts', icon: RefreshCw, description: 'Reload server scripts.' },
  { id: 'reload-creatures', label: 'Reload creatures', command: '.reload creature_template', icon: RefreshCw, description: 'Reload creature templates.' },
  { id: 'reload-items', label: 'Reload items', command: '.reload item_template', icon: RefreshCw, description: 'Reload item templates.' },
  { id: 'reload-quests', label: 'Reload quests', command: '.reload quest_template', icon: RefreshCw, description: 'Reload quest templates.' },
];

function formatUptime(ms) {
  if (!ms) return null;
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function ServerConsole({ type, label, serverStatus, exePath, onCommand, liveConsole }) {
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const sawLiveOutput = useRef(false);

  useEffect(() => {
    if (liveConsole) return undefined;
    if (!exePath) return undefined;
    let active = true;
    const load = async () => {
      const result = await window.azeroth.server.readLog({ type, exePath });
      if (active && result.success && !sawLiveOutput.current) setLines(result.lines || []);
    };
    load();
    const timer = setInterval(load, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [type, exePath, liveConsole]);

  useEffect(() => {
    const listener = window.azeroth.server.onOutput(message => {
      if (message.type !== type) return;
      sawLiveOutput.current = true;
      const line = String(message.line).replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '');
      if (!line) return;
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

export default function DashboardPage() {
  const { query, dbConfig, serverPaths, soapConfig, idRanges } = useConnection();
  const [stats, setStats] = useState({});
  const [customStats, setCustomStats] = useState({});
  const [onlinePlayers, setOnlinePlayers] = useState(null);
  const [recentCreatures, setRecentCreatures] = useState([]);
  const [loading, setLoading] = useState(true);

  const [serverStatus, setServerStatus] = useState({ auth: 'offline', world: 'offline', soap: 'offline', authUptimeMs: 0, worldUptimeMs: 0 });
  const [serverBusy, setServerBusy] = useState({ auth: false, world: false });
  const [liveConsole, setLiveConsole] = useState(false);
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
      const result = await window.azeroth.server.attachConsole();
      setLiveConsole(!!result?.success);
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
            const isOnline = status === 'online';
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
                  ) : isOnline ? (
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
        <ServerConsole type="auth"  label="Authserver"  serverStatus={serverStatus.auth} exePath={serverPaths.authExe} onCommand={command => sendServerCommand('auth', command)} liveConsole={liveConsole} />
        <ServerConsole type="world" label="Worldserver" serverStatus={serverStatus.world} exePath={serverPaths.worldExe} onCommand={command => sendServerCommand('world', command)} liveConsole={liveConsole} />
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
