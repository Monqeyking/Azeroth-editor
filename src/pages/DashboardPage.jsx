import { useState, useEffect } from 'react';
import { useConnection } from '../lib/ConnectionContext';
import { Swords, Package, ScrollText, Sparkles, Database, Activity } from 'lucide-react';
import './DashboardPage.css';

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
  const { query, dbConfig } = useConnection();
  const [stats, setStats] = useState({});
  const [recentCreatures, setRecentCreatures] = useState([]);
  const [loading, setLoading] = useState(true);

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
