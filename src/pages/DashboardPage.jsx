import { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Swords, Package, ScrollText, Sparkles, Database, Activity, Server, Play, Square, Terminal, Send } from 'lucide-react';
import './DashboardPage.css';

const MAX_LINES = 500;

function ServerConsole({ type, label, serverStatus }) {
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    const h = window.azeroth.server.onOutput(({ type: t, line }) => {
      if (t !== type) return;
      setLines(prev => {
        const next = [...prev, line];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });
    return () => window.azeroth.server.offOutput(h);
  }, [type]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const sendCmd = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setInput('');
    await window.azeroth.server.sendCommand({ type, command: cmd });
  };

  const isActive = serverStatus !== 'offline';

  return (
    <div className={`server-console${isActive ? ' active' : ''}`}>
      <div className="console-header">
        <Terminal size={13} />
        <span>{label}</span>
        <span className={`status-dot ${serverStatus}`} style={{ marginLeft: 'auto' }} />
      </div>
      <div className="console-output">
        {lines.length === 0
          ? <span className="console-empty">{isActive ? 'Waiting for output...' : 'Server offline'}</span>
          : lines.map((l, i) => <div key={i} className="console-line">{l}</div>)
        }
        <div ref={bottomRef} />
      </div>
      <div className="console-input-row">
        <input
          className="console-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendCmd()}
          placeholder={isActive ? 'Enter command...' : 'Server offline'}
          disabled={!isActive}
          spellCheck={false}
        />
        <button className="console-send" onClick={sendCmd} disabled={!isActive || !input.trim()}>
          <Send size={13} />
        </button>
      </div>
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

export default function DashboardPage() {
  const { query, dbConfig, serverPaths, soapConfig } = useConnection();
  const [stats, setStats] = useState({});
  const [recentCreatures, setRecentCreatures] = useState([]);
  const [loading, setLoading] = useState(true);

  const [serverStatus, setServerStatus] = useState({ auth: 'offline', world: 'offline' });
  const [serverBusy, setServerBusy] = useState({ auth: false, world: false });
  const pollRef = useRef(null);

  const pollStatus = useCallback(async () => {
    const result = await window.azeroth.server.status({
      authHost: '127.0.0.1', authPort: 3724,
      worldHost: soapConfig.host || '127.0.0.1', worldPort: 8085,
    });
    setServerStatus(result);
  }, [soapConfig.host]);

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

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    setLoading(true);
    const [creatures, items, quests, spells] = await Promise.all([
      query('SELECT COUNT(*) as c FROM creature_template'),
      query('SELECT COUNT(*) as c FROM item_template'),
      query('SELECT COUNT(*) as c FROM quest_template'),
      query('SELECT COUNT(*) as c FROM spell_dbc'),
    ]);

    setStats({
      creatures: creatures.data?.[0]?.c,
      items: items.data?.[0]?.c,
      quests: quests.data?.[0]?.c,
      spells: spells.data?.[0]?.c,
    });

    const recent = await query(
      'SELECT entry, name, minlevel, maxlevel, rank FROM creature_template ORDER BY entry DESC LIMIT 8'
    );
    setRecentCreatures(recent.data || []);
    setLoading(false);
  }

  return (
    <div className="dashboard fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Connected to <strong>{dbConfig.database}</strong></p>
        </div>
        <div className="header-badge">
          <Activity size={12} className="pulse" />
          <span>Live</span>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard icon={Swords}    label="Creatures" value={stats.creatures?.toLocaleString()} color="var(--accent-red)" />
        <StatCard icon={Package}   label="Items"     value={stats.items?.toLocaleString()}     color="var(--accent-blue)" />
        <StatCard icon={ScrollText}label="Quests"    value={stats.quests?.toLocaleString()}    color="var(--accent-green)" />
        <StatCard icon={Sparkles}  label="Spells"    value={stats.spells?.toLocaleString()}    color="var(--accent-purple)" />
      </div>

      <div style={{ padding: '16px 28px 0' }}>
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
      </div>

      <div className="server-consoles">
        <ServerConsole type="auth"  label="Authserver"  serverStatus={serverStatus.auth} />
        <ServerConsole type="world" label="Worldserver" serverStatus={serverStatus.world} />
      </div>

      <div className="dashboard-panels">
        <div className="panel">
          <div className="panel-header">
            <Swords size={14} />
            <span>Recently Added Creatures</span>
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
