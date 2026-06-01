import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useConnection } from '../../lib/ConnectionContext';
import { useEffect } from 'react';
import {
  LayoutDashboard, Swords, Package, ScrollText,
  Sparkles, GitBranch, Map, Settings, Unplug, Globe, Monitor, Users, BookOpen, Palette
} from 'lucide-react';
import './Layout.css';

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/creatures',  icon: Swords,         label: 'Creatures' },
  { to: '/items',      icon: Package,         label: 'Items' },
  { to: '/quests',     icon: ScrollText,      label: 'Quests' },
  { to: '/spells',     icon: Sparkles,        label: 'Spells' },
  { to: '/talents',    icon: GitBranch,       label: 'Talents' },
  { to: '/trainer-spells', icon: BookOpen,   label: 'Trainers' },
  { to: '/map',        icon: Map,             label: 'Spawn Map' },
  { to: '/editor3d',   icon: Monitor,         label: '3D Editor' },
  { to: '/races',           icon: Users,    label: 'Races & Classes' },
  { to: '/char-customization', icon: Palette, label: 'Char Looks' },
];

export default function Layout() {
  const { dbStatus, disconnectDb, dbConfig } = useConnection();
  const navigate = useNavigate();

  useEffect(() => {
    if (dbStatus === 'disconnected') navigate('/connect');
  }, [dbStatus]);

  const handleDisconnect = async () => {
    await disconnectDb();
    navigate('/connect');
  };

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-icon">
            <Globe size={18} />
          </div>
          <div className="logo-text">
            <span className="logo-title">Azeroth</span>
            <span className="logo-sub">Editor</span>
          </div>
        </div>

        <div className="db-badge">
          <span className="db-dot connected" />
          <span className="db-name">{dbConfig.database}</span>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) =>
              `nav-item ${isActive ? 'active' : ''}`
            }>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) =>
            `nav-item ${isActive ? 'active' : ''}`
          }>
            <Settings size={16} />
            <span>Settings</span>
          </NavLink>
          <button className="nav-item disconnect" onClick={handleDisconnect}>
            <Unplug size={16} />
            <span>Disconnect</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}