import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowRightLeft, BarChart3, Coins, Database, Landmark, Mail,
  RefreshCw, Search, ShoppingCart, Users
} from 'lucide-react';
import { useConnection } from '../lib/ConnectionContext';
import './DashboardPage.css';
import './EconomyOverviewPage.css';

const MONEY_LOG_TYPES = {
  1: 'COD',
  2: 'Auction House',
  3: 'Guild Bank Deposit',
  4: 'Guild Bank Withdrawal',
  5: 'Mail',
  6: 'Trade',
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

function SignalCard({ icon: Icon, label, value, detail, available, color }) {
  return (
    <div className="economy-signal">
      <div className="economy-signal-icon" style={{ color }}><Icon size={16} /></div>
      <div>
        <strong>{available ? value : '—'}</strong>
        <span>{label}</span>
        <small>{available ? detail : 'Table not available'}</small>
      </div>
    </div>
  );
}

export default function EconomyOverviewPage() {
  const { query, dbConfig } = useConnection();
  const [data, setData] = useState({
    summary: {}, holders: [], accounts: [], mail: null, auctions: null,
    guildBank: null, moneyLogs: [], moneyLogSummary: [], available: {},
  });
  const [filter, setFilter] = useState('');
  const [botFilter, setBotFilter] = useState('all');
  const [botPrefix, setBotPrefix] = useState(() => {
    try { return localStorage.getItem('economy-bot-prefix') || 'RNDBOT'; } catch { return 'RNDBOT'; }
  });
  const [appliedBotPrefix, setAppliedBotPrefix] = useState(() => {
    try { return localStorage.getItem('economy-bot-prefix') || 'RNDBOT'; } catch { return 'RNDBOT'; }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadEconomy = useCallback(async () => {
    const characterDatabase = String(dbConfig.database || '').replace(/_world$/i, '_characters');
    const authDatabase = String(dbConfig.database || '').replace(/_world$/i, '_auth');
    if (!/^[A-Za-z0-9_]+$/.test(characterDatabase) || !/^[A-Za-z0-9_]+$/.test(authDatabase)) {
      setError('Could not resolve the characters database from the active connection.');
      setLoading(false);
      return;
    }

    const prefix = appliedBotPrefix.trim();
    if (botFilter === 'bots' && !prefix) {
      setError('Enter the bot account prefix before selecting a bot filter.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const characters = `\`${characterDatabase}\`.characters`;
    const authAccount = `\`${authDatabase}\`.account`;

    try {
      const [schemaResult, authSchemaResult] = await Promise.all([
        query(
          'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?, ?, ?)',
          [characterDatabase, 'mail', 'auctionhouse', 'guild_bank_eventlog', 'log_money']
        ),
        query(
          'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
          [authDatabase, 'account']
        ),
      ]);

      const available = new Set((schemaResult.success ? schemaResult.data : []).map(row => String(row.TABLE_NAME).toLowerCase()));
      const hasAuthAccount = (authSchemaResult.success ? authSchemaResult.data : []).some(row => String(row.TABLE_NAME).toLowerCase() === 'account');
      const prefixFilterActive = Boolean(prefix) && botFilter !== 'all';
      if (prefixFilterActive && !hasAuthAccount) {
        setError(`The account table could not be found in ${authDatabase}.`);
        setLoading(false);
        return;
      }

      const accountJoin = hasAuthAccount
        ? `${prefixFilterActive ? 'INNER' : 'LEFT'} JOIN ${authAccount} a ON a.id = c.account`
        : '';
      const accountName = hasAuthAccount ? 'a.username' : 'NULL';
      const filterSql = prefixFilterActive && botFilter === 'bots'
        ? 'WHERE LOWER(a.username) LIKE CONCAT("%", LOWER(?), "%")'
        : prefixFilterActive && botFilter === 'players'
          ? 'WHERE LOWER(a.username) NOT LIKE CONCAT("%", LOWER(?), "%")'
          : '';
      const filterParams = prefixFilterActive ? [prefix] : [];
      const moneyFilterSql = filterSql ? `${filterSql} AND c.money > 0` : 'WHERE c.money > 0';
      const logParticipantFilter = prefixFilterActive && botFilter === 'bots'
        ? `WHERE EXISTS (SELECT 1 FROM ${authAccount} sender_account WHERE sender_account.id = l.sender_acc AND LOWER(sender_account.username) LIKE CONCAT("%", LOWER(?), "%")) OR EXISTS (SELECT 1 FROM ${authAccount} receiver_account WHERE receiver_account.id = l.receiver_acc AND LOWER(receiver_account.username) LIKE CONCAT("%", LOWER(?), "%"))`
        : prefixFilterActive && botFilter === 'players'
          ? `WHERE NOT EXISTS (SELECT 1 FROM ${authAccount} sender_account WHERE sender_account.id = l.sender_acc AND LOWER(sender_account.username) LIKE CONCAT("%", LOWER(?), "%")) AND NOT EXISTS (SELECT 1 FROM ${authAccount} receiver_account WHERE receiver_account.id = l.receiver_acc AND LOWER(receiver_account.username) LIKE CONCAT("%", LOWER(?), "%"))`
          : '';
      const logFilterParams = prefixFilterActive ? [prefix, prefix] : [];

      const [summaryResult, holdersResult, accountsResult] = await Promise.all([
        query(`
          SELECT
            COUNT(*) AS character_count,
            COALESCE(SUM(c.money), 0) AS total_money,
            COALESCE(SUM(CASE WHEN c.money > 0 THEN 1 ELSE 0 END), 0) AS funded_characters,
            COALESCE(SUM(CASE WHEN c.online = 1 THEN 1 ELSE 0 END), 0) AS online_characters,
            COALESCE(COUNT(DISTINCT CASE WHEN c.money > 0 THEN c.account END), 0) AS funded_accounts,
            COALESCE(MAX(c.money), 0) AS richest_money
          FROM ${characters} c
          ${accountJoin}
          ${filterSql}
        `, filterParams),
        query(`
          SELECT c.guid, c.name, c.account, ${accountName} AS username, c.level, c.money, c.online
          FROM ${characters} c
          ${accountJoin}
          ${moneyFilterSql}
          ORDER BY c.money DESC, c.name
          LIMIT 100
        `, filterParams),
        query(`
          SELECT c.account, ${accountName} AS username, COUNT(*) AS character_count, COALESCE(SUM(c.money), 0) AS total_money, MAX(c.money) AS richest_money
          FROM ${characters} c
          ${accountJoin}
          ${moneyFilterSql}
          GROUP BY c.account, ${accountName}
          ORDER BY total_money DESC
          LIMIT 100
        `, filterParams),
      ]);

      if (!summaryResult.success || !holdersResult.success || !accountsResult.success) {
        setError(summaryResult.error || holdersResult.error || accountsResult.error || 'Could not load economy data.');
        setLoading(false);
        return;
      }

      const optional = async (table, sql, params = []) => {
        if (!available.has(table.toLowerCase())) return { available: false, data: [] };
        const result = await query(sql, params);
        return { available: result.success, data: result.success ? (result.data || []) : [], error: result.error };
      };

      const [mail, auctions, guildBank, moneyLogs, moneyLogSummary] = await Promise.all([
        optional('mail', `
          SELECT COUNT(*) AS pending_mail, COALESCE(SUM(money), 0) AS mail_money
          FROM \`${characterDatabase}\`.mail
          WHERE expire_time > UNIX_TIMESTAMP()
        `),
        optional('auctionhouse', `
          SELECT COUNT(*) AS active_auctions, COALESCE(SUM(buyoutprice), 0) AS buyout_money, COALESCE(SUM(bid), 0) AS bid_money
          FROM \`${characterDatabase}\`.auctionhouse
        `),
        optional('guild_bank_eventlog', `
          SELECT
            COUNT(*) AS event_count,
            COALESCE(SUM(CASE WHEN EventType = 4 THEN ItemOrMoney ELSE 0 END), 0) AS deposits,
            COALESCE(SUM(CASE WHEN EventType IN (5, 6) THEN ItemOrMoney ELSE 0 END), 0) AS withdrawals
          FROM \`${characterDatabase}\`.guild_bank_eventlog
          WHERE EventType IN (4, 5, 6)
        `),
        optional('log_money', `
          SELECT type, sender_name, receiver_name, money, topic, date
          FROM \`${characterDatabase}\`.log_money l
          ${logParticipantFilter}
          ORDER BY date DESC
          LIMIT 100
        `, logFilterParams),
        optional('log_money', `
          SELECT type, COUNT(*) AS event_count, COALESCE(SUM(money), 0) AS total_money
          FROM \`${characterDatabase}\`.log_money l
          ${logParticipantFilter ? `${logParticipantFilter} AND` : 'WHERE'} date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          GROUP BY type
          ORDER BY total_money DESC
        `, logFilterParams),
      ]);

      setData({
        summary: summaryResult.data?.[0] || {},
        holders: holdersResult.data || [],
        accounts: accountsResult.data || [],
        mail: mail.data?.[0] || {},
        auctions: auctions.data?.[0] || {},
        guildBank: guildBank.data?.[0] || {},
        moneyLogs: moneyLogs.data || [],
        moneyLogSummary: moneyLogSummary.data || [],
        available: {
          mail: mail.available,
          auctions: auctions.available,
          guildBank: guildBank.available,
          moneyLog: moneyLogs.available && moneyLogSummary.available,
        },
      });
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(loadError.message || 'Could not load economy data.');
    } finally {
      setLoading(false);
    }
  }, [appliedBotPrefix, botFilter, dbConfig.database, query]);

  useEffect(() => {
    loadEconomy();
    const timer = setInterval(loadEconomy, 30000);
    return () => clearInterval(timer);
  }, [loadEconomy]);

  const visibleHolders = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return data.holders;
    return data.holders.filter(row => [row.name, row.username, row.account, row.guid].some(value => String(value ?? '').toLowerCase().includes(term)));
  }, [data.holders, filter]);

  const summary = data.summary;
  const totalMoney = toNumber(summary.total_money);
  const topShare = totalMoney > 0 ? `${((toNumber(summary.richest_money) / totalMoney) * 100).toFixed(1)}%` : '0%';
  const tradeSummary = data.moneyLogSummary.find(row => Number(row.type) === 6);
  const scopeLabel = botFilter === 'bots'
    ? 'Bot accounts'
    : botFilter === 'players' && !appliedBotPrefix.trim()
      ? 'All accounts (bot prefix not set)'
      : botFilter === 'players'
        ? 'Player accounts'
        : 'All accounts';
  const applyBotFilter = () => {
    const value = botPrefix.trim();
    try { localStorage.setItem('economy-bot-prefix', value); } catch { /* localStorage is optional */ }
    setAppliedBotPrefix(value);
    if (value === appliedBotPrefix) loadEconomy();
  };

  return (
    <div className="dashboard economy-page fade-in">
      <header className="dashboard-header">
        <div>
          <h1>Economy Overview</h1>
          <p>Current gold concentration and available money-flow signals from the characters database.</p>
        </div>
        <div className="dashboard-header-actions">
          <span className="dashboard-header-status"><Activity size={12} className="pulse" />Auto-refresh 30s</span>
          <button className="btn-ghost" onClick={loadEconomy} disabled={loading}><RefreshCw size={13} />Refresh</button>
        </div>
      </header>

      <div className="dashboard-toolbar">
        <span><Database size={14} />{dbConfig.database?.replace(/_world$/i, '_characters')} / characters</span>
        <span className="dashboard-toolbar-divider" />
        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}</span>
        <span className="dashboard-toolbar-spacer" />
        <span className="economy-toolbar-note">Scope: {scopeLabel} · Top holder represents {topShare} of tracked gold</span>
      </div>

      {error ? <div className="economy-message error">{error}</div> : null}

      <div className="stat-grid">
        <StatCard icon={Coins} label="Tracked Gold" value={formatGold(totalMoney)} color="var(--vanilla-gold)" />
        <StatCard icon={Users} label="Funded Characters" value={toNumber(summary.funded_characters).toLocaleString()} color="var(--accent-blue)" />
        <StatCard icon={BarChart3} label="Funded Accounts" value={toNumber(summary.funded_accounts).toLocaleString()} color="var(--accent-green)" />
        <StatCard icon={Coins} label="Richest Character" value={formatGold(summary.richest_money)} color="var(--accent-purple)" />
      </div>

      <div className="economy-signals">
        <SignalCard icon={Mail} label="Pending Mail" value={toNumber(data.mail?.pending_mail).toLocaleString()} detail={`${formatGold(data.mail?.mail_money)} attached`} available={data.available.mail} color="var(--accent-blue)" />
        <SignalCard icon={ShoppingCart} label="Active Auctions" value={toNumber(data.auctions?.active_auctions).toLocaleString()} detail={`${formatGold(data.auctions?.buyout_money)} buyout value`} available={data.available.auctions} color="var(--accent-green)" />
        <SignalCard icon={Landmark} label="Guild Bank Events" value={toNumber(data.guildBank?.event_count).toLocaleString()} detail={`${formatGold(data.guildBank?.deposits)} deposits`} available={data.available.guildBank} color="var(--vanilla-gold)" />
        <SignalCard icon={ArrowRightLeft} label="Trades, last 30 days" value={toNumber(tradeSummary?.event_count).toLocaleString()} detail={`${formatGold(tradeSummary?.total_money)} moved`} available={data.available.moneyLog} color="var(--accent-purple)" />
      </div>

      <div className="economy-toolbar economy-filter-toolbar">
        <div className="economy-filter-controls">
          <select value={botFilter} onChange={event => setBotFilter(event.target.value)} aria-label="Account scope">
            <option value="all">All accounts</option>
            <option value="bots">Bot accounts</option>
            <option value="players">Player accounts</option>
          </select>
          <input value={botPrefix} onChange={event => setBotPrefix(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') applyBotFilter(); }} placeholder="Bot marker, e.g. RNDBOT" aria-label="Bot account marker" />
          <button className="btn-ghost" onClick={applyBotFilter} disabled={loading}><RefreshCw size={13} />Apply</button>
        </div>
        <span className="economy-filter-help">{botFilter === 'players' && !botPrefix.trim() ? 'Add a prefix to exclude bot accounts.' : 'Prefix filtering uses the auth account username.'}</span>
      </div>

      <div className="economy-toolbar">
        <div className="economy-search"><Search size={14} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search character, account or GUID..." /></div>
        <span>{visibleHolders.length.toLocaleString()} of {data.holders.length.toLocaleString()} holders</span>
      </div>

      <div className="economy-grid">
        <div className="panel">
          <div className="panel-header"><Coins size={14} /><span>Top Gold Holders</span></div>
          {loading && !data.holders.length ? <div className="economy-empty">Loading economy data...</div> : (
            <div className="economy-table-wrap">
              <table className="data-table economy-table">
                <thead><tr><th>Character</th><th>Account</th><th>Level</th><th>Status</th><th>Gold</th></tr></thead>
                <tbody>
                  {visibleHolders.map(row => (
                    <tr key={row.guid}>
                      <td><strong>{row.name}</strong><small className="economy-muted">#{row.guid}</small></td>
                      <td><strong className="economy-account-name">{row.username || '—'}</strong><small className="economy-muted">ID {row.account}</small></td>
                      <td>{row.level}</td>
                      <td><span className={`economy-status${Number(row.online) ? ' online' : ''}`}>{Number(row.online) ? 'Online' : 'Offline'}</span></td>
                      <td className="money-cell">{formatMoney(row.money)}</td>
                    </tr>
                  ))}
                  {!visibleHolders.length && <tr><td colSpan="5" className="economy-empty">No holders match the current filter.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header"><Users size={14} /><span>Gold by Account</span></div>
          <div className="economy-table-wrap">
            <table className="data-table economy-table">
              <thead><tr><th>Account</th><th>Characters</th><th>Richest</th><th>Total Gold</th></tr></thead>
              <tbody>
                {data.accounts.map(row => (
                  <tr key={row.account}>
                    <td><strong className="economy-account-name">{row.username || '—'}</strong><small className="economy-muted">ID {row.account}</small></td>
                    <td>{row.character_count}</td>
                    <td className="money-cell">{formatMoney(row.richest_money)}</td>
                    <td className="money-cell"><strong>{formatMoney(row.total_money)}</strong></td>
                  </tr>
                ))}
                {!data.accounts.length && <tr><td colSpan="4" className="economy-empty">No account balances found.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="economy-grid economy-bottom-grid">
        <div className="panel">
          <div className="panel-header"><ArrowRightLeft size={14} /><span>Recent Money Events</span></div>
          {!data.available.moneyLog ? <div className="economy-empty">The <code>log_money</code> table is not available. Enable the AzerothCore money logger or add a persistence module for historical trades.</div> : (
            <div className="economy-table-wrap">
              <table className="data-table economy-table economy-events-table">
                <thead><tr><th>Type</th><th>Sender</th><th>Receiver</th><th>Amount</th><th>Date</th></tr></thead>
                <tbody>
                  {data.moneyLogs.map((row, index) => (
                    <tr key={`${row.date}-${row.sender_name}-${index}`}>
                      <td><span className="economy-event-type">{MONEY_LOG_TYPES[row.type] || `Type ${row.type}`}</span></td>
                      <td>{row.sender_name || '—'}</td>
                      <td>{row.receiver_name || '—'}</td>
                      <td className="money-cell">{formatMoney(row.money)}</td>
                      <td className="economy-date">{formatDate(row.date)}</td>
                    </tr>
                  ))}
                  {!data.moneyLogs.length && <tr><td colSpan="5" className="economy-empty">No money events found.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel economy-activity-panel">
          <div className="panel-header"><Activity size={14} /><span>30-Day Money Activity</span></div>
          {!data.available.moneyLog ? <div className="economy-empty">Historical money activity becomes available when <code>log_money</code> exists.</div> : (
            <div className="economy-activity-list">
              {data.moneyLogSummary.map(row => (
                <div className="economy-activity-row" key={row.type}>
                  <span>{MONEY_LOG_TYPES[row.type] || `Type ${row.type}`}</span>
                  <strong>{toNumber(row.event_count).toLocaleString()} events</strong>
                  <em>{formatGold(row.total_money)}</em>
                </div>
              ))}
              {!data.moneyLogSummary.length && <div className="economy-empty">No events in the last 30 days.</div>}
            </div>
          )}
          <div className="economy-footnote">Direct trades are identified as money log type 6. This is a monitoring signal, not an automatic gold-seller verdict.</div>
        </div>
      </div>
    </div>
  );
}
