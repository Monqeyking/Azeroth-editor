import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRightLeft, Coins, Database, RefreshCw, Search, Users } from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import './DashboardPage.css';
import './GoldFlowPage.css';

const TYPE_LABELS = { 1: 'COD', 2: 'Auction House', 3: 'Guild Bank Deposit', 4: 'Guild Bank Withdrawal', 5: 'Mail', 6: 'Trade' };
const TYPE_FILTERS = {
  all: null,
  trade: [6],
  mail: [5],
  auction: [2],
  guild: [3, 4],
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  const copper = Math.max(0, Math.floor(toNumber(value)));
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  return `${gold.toLocaleString()}g ${silver}s ${copper % 100}c`;
}

function formatGold(value) {
  return `${(toNumber(value) / 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })}g`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function riskInfo(score) {
  if (score >= 70) return { label: 'High', className: 'high' };
  if (score >= 40) return { label: 'Medium', className: 'medium' };
  return { label: 'Low', className: 'low' };
}

function scoreAccount(account) {
  let score = 0;
  if (account.incoming >= 10000000) score += 25;
  else if (account.incoming >= 1000000) score += 12;
  if (account.outgoing >= 10000000) score += 20;
  else if (account.outgoing >= 1000000) score += 10;
  if (account.sources.size >= 5) score += 15;
  else if (account.sources.size >= 3) score += 8;
  if (account.destinations.size >= 5) score += 15;
  else if (account.destinations.size >= 3) score += 8;
  if (account.incoming > 0 && account.outgoing / account.incoming >= 0.65) score += 20;
  if (account.eventCount >= 10) score += 5;
  return Math.min(100, score);
}

function buildAccounts(routes) {
  const accounts = new Map();
  const ensure = (id, name) => {
    const key = String(id);
    if (!accounts.has(key)) accounts.set(key, {
      id, name: name || `Account ${id}`, incoming: 0, outgoing: 0,
      eventCount: 0, sources: new Set(), destinations: new Set(), lastDate: null,
    });
    const account = accounts.get(key);
    if (name && account.name.startsWith('Account ')) account.name = name;
    return account;
  };

  routes.forEach(route => {
    const amount = toNumber(route.total_money);
    const sender = ensure(route.sender_acc, route.sender_name);
    const receiver = ensure(route.receiver_acc, route.receiver_name);
    sender.outgoing += amount;
    sender.destinations.add(String(route.receiver_acc));
    sender.eventCount += toNumber(route.event_count);
    receiver.incoming += amount;
    receiver.sources.add(String(route.sender_acc));
    receiver.eventCount += toNumber(route.event_count);
    [sender, receiver].forEach(account => {
      if (!account.lastDate || new Date(route.last_date) > new Date(account.lastDate)) account.lastDate = route.last_date;
    });
  });

  return [...accounts.values()]
    .map(account => ({ ...account, net: account.incoming - account.outgoing, score: scoreAccount(account) }))
    .sort((a, b) => b.score - a.score || b.incoming + b.outgoing - (a.incoming + a.outgoing));
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ '--icon-color': color }}><Icon size={18} /></div>
      <div className="stat-info"><span className="stat-value">{value}</span><span className="stat-label">{label}</span></div>
    </div>
  );
}

export default function GoldFlowPage() {
  const { query, dbConfig } = useConnection();
  const [data, setData] = useState({ summary: {}, routes: [], accounts: [], available: false });
  const [days, setDays] = useState(7);
  const [eventType, setEventType] = useState('all');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadFlow = useCallback(async () => {
    const characterDatabase = String(dbConfig.database || '').replace(/_world$/i, '_characters');
    if (!/^[A-Za-z0-9_]+$/.test(characterDatabase)) {
      setError('Could not resolve the characters database from the active connection.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const types = TYPE_FILTERS[eventType];
    const typeSql = types ? ` AND type IN (${types.join(',')})` : '';
    const windowSql = `date >= DATE_SUB(NOW(), INTERVAL ${Number(days) === 30 ? 30 : Number(days) === 1 ? 1 : 7} DAY)`;

    try {
      const schemaResult = await query(
        'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [characterDatabase, 'log_money']
      );
      const available = schemaResult.success && schemaResult.data?.some(row => String(row.TABLE_NAME).toLowerCase() === 'log_money');
      if (!available) {
        setData({ summary: {}, routes: [], accounts: [], available: false });
        setLoading(false);
        return;
      }

      const table = `\`${characterDatabase}\`.log_money`;
      const [summaryResult, routesResult] = await Promise.all([
        query(`
          SELECT
            COUNT(*) AS event_count,
            COALESCE(SUM(money), 0) AS total_money,
            COUNT(DISTINCT sender_acc) AS sender_count,
            COUNT(DISTINCT receiver_acc) AS receiver_count,
            COUNT(DISTINCT CONCAT(sender_acc, ':', receiver_acc)) AS route_count,
            COALESCE(SUM(CASE WHEN type = 6 THEN money ELSE 0 END), 0) AS trade_money
          FROM ${table}
          WHERE ${windowSql} ${typeSql}
            AND sender_acc > 0 AND receiver_acc > 0 AND sender_acc <> receiver_acc
        `),
        query(`
          SELECT sender_acc, sender_name, receiver_acc, receiver_name,
            COUNT(*) AS event_count, COALESCE(SUM(money), 0) AS total_money, MAX(date) AS last_date
          FROM ${table}
          WHERE ${windowSql} ${typeSql}
            AND sender_acc > 0 AND receiver_acc > 0 AND sender_acc <> receiver_acc
          GROUP BY sender_acc, sender_name, receiver_acc, receiver_name
          ORDER BY total_money DESC
          LIMIT 500
        `),
      ]);

      if (!summaryResult.success || !routesResult.success) {
        setError(summaryResult.error || routesResult.error || 'Could not load gold flow data.');
        setLoading(false);
        return;
      }

      const routes = routesResult.data || [];
      setData({ summary: summaryResult.data?.[0] || {}, routes, accounts: buildAccounts(routes), available: true });
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Could not load gold flow data.');
    } finally {
      setLoading(false);
    }
  }, [dbConfig.database, days, eventType, query]);

  useEffect(() => {
    loadFlow();
    const timer = setInterval(loadFlow, 30000);
    return () => clearInterval(timer);
  }, [loadFlow]);

  const visibleAccounts = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return data.accounts;
    return data.accounts.filter(account => [account.id, account.name].some(value => String(value ?? '').toLowerCase().includes(term)));
  }, [data.accounts, filter]);

  const visibleRoutes = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return data.routes;
    return data.routes.filter(route => [route.sender_acc, route.sender_name, route.receiver_acc, route.receiver_name]
      .some(value => String(value ?? '').toLowerCase().includes(term)));
  }, [data.routes, filter]);

  const summary = data.summary;

  return (
    <div className="dashboard gold-flow-page fade-in">
      <header className="dashboard-header">
        <div>
          <h1>Gold Flow</h1>
          <p>Transfer routes and mule-like flow patterns without assuming anything about usernames.</p>
        </div>
        <div className="dashboard-header-actions">
          <span className="dashboard-header-status"><Activity size={12} className="pulse" />Auto-refresh 30s</span>
          <button className="btn-ghost" onClick={loadFlow} disabled={loading}><RefreshCw size={13} />Refresh</button>
        </div>
      </header>

      <div className="dashboard-toolbar">
        <span><Database size={14} />{dbConfig.database?.replace(/_world$/i, '_characters')} / log_money</span>
        <span className="dashboard-toolbar-divider" />
        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}</span>
        <span className="dashboard-toolbar-spacer" />
        <span className="gold-flow-note">Pattern score, not an automatic bot verdict</span>
      </div>

      <div className="gold-flow-controls">
        <select value={days} onChange={event => setDays(Number(event.target.value))} aria-label="Time window">
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <select value={eventType} onChange={event => setEventType(event.target.value)} aria-label="Money event type">
          <option value="all">All money events</option>
          <option value="trade">Direct trades</option>
          <option value="mail">Mail</option>
          <option value="auction">Auction house</option>
          <option value="guild">Guild bank</option>
        </select>
        <div className="gold-flow-search"><Search size={14} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search account or character..." /></div>
        <span className="gold-flow-result-count">{visibleAccounts.length.toLocaleString()} accounts · {visibleRoutes.length.toLocaleString()} routes</span>
      </div>

      {error ? <div className="gold-flow-message error">{error}</div> : null}
      {!data.available && !loading && !error ? <div className="gold-flow-message">The <code>log_money</code> table is not available. Gold Flow needs persisted money events before it can analyze transfers.</div> : null}

      <div className="stat-grid">
        <StatCard icon={Coins} label="Gold Moved" value={formatGold(summary.total_money)} color="var(--vanilla-gold)" />
        <StatCard icon={ArrowRightLeft} label="Money Events" value={toNumber(summary.event_count).toLocaleString()} color="var(--accent-blue)" />
        <StatCard icon={Users} label="Accounts Involved" value={Math.max(toNumber(summary.sender_count), toNumber(summary.receiver_count)).toLocaleString()} color="var(--accent-green)" />
        <StatCard icon={ArrowRightLeft} label="Transfer Routes" value={toNumber(summary.route_count).toLocaleString()} color="var(--accent-purple)" />
      </div>

      <div className="gold-flow-grid">
        <div className="panel">
          <div className="panel-header"><Activity size={14} /><span>Mule Candidates</span></div>
          <div className="gold-flow-table-wrap">
            <table className="data-table gold-flow-table">
              <thead><tr><th>Account</th><th>Received</th><th>Sent</th><th>Net</th><th>Sources</th><th>Targets</th><th>Risk</th></tr></thead>
              <tbody>
                {visibleAccounts.map(account => {
                  const risk = riskInfo(account.score);
                  return <tr key={account.id}>
                    <td><strong>{account.name}</strong><small className="gold-flow-muted">ID {account.id} · {account.eventCount} events</small></td>
                    <td className="money-cell">{formatMoney(account.incoming)}</td>
                    <td className="money-cell">{formatMoney(account.outgoing)}</td>
                    <td className={account.net >= 0 ? 'money-cell' : 'money-cell negative'}>{formatMoney(Math.abs(account.net))}{account.net < 0 ? ' out' : ''}</td>
                    <td>{account.sources.size}</td>
                    <td>{account.destinations.size}</td>
                    <td><span className={`gold-flow-risk ${risk.className}`}>{risk.label} · {account.score}</span></td>
                  </tr>;
                })}
                {!loading && !visibleAccounts.length && <tr><td colSpan="7" className="gold-flow-empty">No account flow found for this filter.</td></tr>}
                {loading && !data.accounts.length && <tr><td colSpan="7" className="gold-flow-empty">Loading gold flow...</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="gold-flow-grid gold-flow-bottom-grid">
        <div className="panel">
          <div className="panel-header"><ArrowRightLeft size={14} /><span>Largest Transfer Routes</span></div>
          <div className="gold-flow-table-wrap">
            <table className="data-table gold-flow-table routes-table">
              <thead><tr><th>Sender</th><th>Receiver</th><th>Amount</th><th>Events</th><th>Last Seen</th></tr></thead>
              <tbody>
                {visibleRoutes.slice(0, 100).map(route => <tr key={`${route.sender_acc}-${route.receiver_acc}`}>
                  <td><strong>{route.sender_name || `Account ${route.sender_acc}`}</strong><small className="gold-flow-muted">ID {route.sender_acc}</small></td>
                  <td><strong>{route.receiver_name || `Account ${route.receiver_acc}`}</strong><small className="gold-flow-muted">ID {route.receiver_acc}</small></td>
                  <td className="money-cell">{formatMoney(route.total_money)}</td>
                  <td>{route.event_count}</td>
                  <td className="gold-flow-date">{formatDate(route.last_date)}</td>
                </tr>)}
                {!loading && !visibleRoutes.length && <tr><td colSpan="5" className="gold-flow-empty">No transfer routes found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel gold-flow-explainer">
          <div className="panel-header"><Users size={14} /><span>How the score works</span></div>
          <p>A candidate becomes more interesting when it receives large amounts from multiple accounts and forwards gold to multiple destinations.</p>
          <div className="gold-flow-rule"><strong>Received volume</strong><span>Large inflow increases the score.</span></div>
          <div className="gold-flow-rule"><strong>Source diversity</strong><span>Many unique senders can indicate aggregation.</span></div>
          <div className="gold-flow-rule"><strong>Destination diversity</strong><span>Many unique targets can indicate distribution.</span></div>
          <div className="gold-flow-rule"><strong>Pass-through ratio</strong><span>Forwarding most received gold increases the score.</span></div>
          <div className="gold-flow-footnote">This view does not identify bots by name. It only ranks transfer patterns for manual review.</div>
        </div>
      </div>
    </div>
  );
}
