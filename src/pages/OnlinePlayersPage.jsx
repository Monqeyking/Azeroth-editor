import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Coins, RefreshCw, Search, Users } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import './DashboardPage.css';
import './OnlinePlayersPage.css';

const CLASS_NAMES = {
  1: 'Warrior',
  2: 'Paladin',
  3: 'Hunter',
  4: 'Rogue',
  5: 'Priest',
  6: 'Death Knight',
  7: 'Shaman',
  8: 'Mage',
  9: 'Warlock',
  11: 'Druid',
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  const copper = Math.max(0, Math.floor(toNumber(value)));
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const remainingCopper = copper % 100;
  return `${gold.toLocaleString()}g ${silver}s ${remainingCopper}c`;
}

function formatGoldCompact(value) {
  return `${(toNumber(value) / 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })}g`;
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ '--icon-color': color }}><Icon size={18} /></div>
      <div className="stat-info">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  );
}

export default function OnlinePlayersPage() {
  const { query, dbConfig } = useConnection();
  const [players, setPlayers] = useState([]);
  const [summary, setSummary] = useState({ online: 0, totalMoney: 0, averageMoney: 0 });
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadPlayers = useCallback(async () => {
    const characterDatabase = String(dbConfig.database || '').replace(/_world$/i, '_characters');
    if (!/^[A-Za-z0-9_]+$/.test(characterDatabase)) {
      setError('Could not resolve the characters database from the active connection.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const table = `\`${characterDatabase}\`.characters`;
    const [summaryResult, playersResult] = await Promise.all([
      query(`SELECT COUNT(*) AS online_count, COALESCE(SUM(money), 0) AS total_money, COALESCE(AVG(money), 0) AS average_money FROM ${table} WHERE online = 1`),
      query(`SELECT guid, name, account, level, class, \`map\`, zone, money FROM ${table} WHERE online = 1 ORDER BY name LIMIT 500`),
    ]);

    if (!summaryResult.success || !playersResult.success) {
      setError(summaryResult.error || playersResult.error || 'Could not load online players.');
      setPlayers([]);
      setLoading(false);
      return;
    }

    const summaryRow = summaryResult.data?.[0] || {};
    setSummary({
      online: toNumber(summaryRow.online_count),
      totalMoney: toNumber(summaryRow.total_money),
      averageMoney: toNumber(summaryRow.average_money),
    });
    setPlayers(playersResult.data || []);
    setLastUpdated(new Date());
    setLoading(false);
  }, [dbConfig.database, query]);

  useEffect(() => {
    loadPlayers();
    const timer = setInterval(loadPlayers, 10000);
    return () => clearInterval(timer);
  }, [loadPlayers]);

  const visiblePlayers = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return players;
    return players.filter(player =>
      [player.name, player.account, player.guid, player.map, player.zone, CLASS_NAMES[player.class]]
        .some(value => String(value ?? '').toLowerCase().includes(term))
    );
  }, [filter, players]);

  return (
    <div className="dashboard online-players-page fade-in">
      <header className="dashboard-header">
        <div>
          <h1>Online Players</h1>
          <p>Read-only view of characters currently marked online in the characters database.</p>
        </div>
        <div className="dashboard-header-actions">
          <span className="dashboard-header-status"><Activity size={12} className="pulse" />Auto-refresh 10s</span>
          <button className="btn-ghost" onClick={loadPlayers} disabled={loading}><RefreshCw size={13} />Refresh</button>
        </div>
      </header>

      <div className="dashboard-toolbar">
        <span><Users size={14} />{dbConfig.database?.replace(/_world$/i, '_characters')} / characters</span>
        <span className="dashboard-toolbar-divider" />
        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}</span>
      </div>

      <div className="stat-grid">
        <StatCard icon={Users} label="Online Players" value={summary.online.toLocaleString()} color="var(--accent-blue)" />
        <StatCard icon={Coins} label="Gold in Online Characters" value={formatGoldCompact(summary.totalMoney)} color="var(--vanilla-gold)" />
        <StatCard icon={Coins} label="Average Gold" value={formatGoldCompact(summary.averageMoney)} color="var(--accent-green)" />
        <StatCard icon={Activity} label="Loaded Rows" value={players.length.toLocaleString()} color="var(--accent-purple)" />
      </div>

      <div className="online-players-toolbar">
        <div className="online-players-search"><Search size={14} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search name, account, map or class..." /></div>
        <span className="online-players-count">Showing {visiblePlayers.length.toLocaleString()} of {players.length.toLocaleString()}</span>
      </div>

      <div className="panel online-players-panel">
        <div className="panel-header"><Users size={14} /><span>Online Characters</span></div>
        {error ? <div className="online-players-message error">{error}</div> : loading && !players.length ? <div className="online-players-message">Loading online players...</div> : (
          <div className="online-players-table-wrap">
            <table className="data-table online-players-table">
              <thead><tr><th>Name</th><th>Account</th><th>Level</th><th>Class</th><th>Map</th><th>Zone</th><th>Gold</th></tr></thead>
              <tbody>
                {visiblePlayers.map(player => (
                  <tr key={player.guid}>
                    <td><strong>{player.name}</strong><small className="online-player-guid">#{player.guid}</small></td>
                    <td className="mono">{player.account}</td>
                    <td>{player.level}</td>
                    <td>{CLASS_NAMES[player.class] || `Class ${player.class}`}</td>
                    <td className="mono">{player.map}</td>
                    <td className="mono">{player.zone}</td>
                    <td className="money-cell">{formatMoney(player.money)}</td>
                  </tr>
                ))}
                {!visiblePlayers.length && <tr><td colSpan="7" className="online-players-empty">No online characters match the current filter.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
