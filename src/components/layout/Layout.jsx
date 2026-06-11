import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useConnection } from '../../lib/ConnectionContext';
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  LayoutDashboard, Swords, Package, ScrollText, Shield, Monitor,
  Settings, Unplug, Terminal, ChevronDown, ChevronRight,
  BookOpen, Sparkles, GitBranch, Users, Palette, PackageOpen,
  Layers, ShoppingBag, Map, Lock, Database
} from 'lucide-react';
import ollieLogo from '../../assets/Ollie.png';
import './Layout.css';

const NAV_GROUPS = [
  {
    id: 'npcs',
    label: 'NPCs & Creatures',
    icon: Swords,
    items: [
      { to: '/creatures',      icon: Swords,      label: 'Creatures' },
      { to: '/trainer-spells', icon: BookOpen,     label: 'Trainers' },
      { to: '/vendors',        icon: ShoppingBag,  label: 'Vendors' },
    ],
  },
  {
    id: 'items',
    label: 'Items & Economy',
    icon: Package,
    items: [
      { to: '/items',     icon: Package,     label: 'Items' },
      { to: '/item-sets', icon: Layers,      label: 'Item Sets' },
      { to: '/loot',      icon: PackageOpen, label: 'Loot' },
    ],
  },
  {
    id: 'quests',
    label: 'Quests & Story',
    icon: ScrollText,
    items: [
      { to: '/quests', icon: ScrollText, label: 'Quests' },
    ],
  },
  {
    id: 'character',
    label: 'Character',
    icon: Shield,
    items: [
      { to: '/spells',             icon: Sparkles,  label: 'Spells' },
      { to: '/talents',            icon: GitBranch, label: 'Talents' },
      { to: '/races',              icon: Users,     label: 'Races & Classes' },
      { to: '/char-customization', icon: Palette,   label: 'Char Looks' },
    ],
  },
  {
    id: 'world',
    label: 'World & Tools',
    icon: Monitor,
    wip: true,
    items: [
      { to: '/editor3d',        icon: Monitor, label: '3D Editor' },
      { to: '/map',             icon: Map,     label: 'Spawn Map' },
      { to: '/expansion-lock',  icon: Lock,    label: 'Expansion Lock' },
    ],
  },
  {
    id: 'sql',
    label: 'SQL',
    icon: Database,
    items: [
      { to: '/dbc-sql', icon: Database, label: 'DBC SQL Editor' },
      { to: '/sql',     icon: Terminal, label: 'Database SQL' },
    ],
  },
];

const MIN_WIDTH = 160;
const MAX_WIDTH = 340;
const DEFAULT_WIDTH = 200;

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem('sidebar-collapsed') || '{}'); }
  catch { return {}; }
}

function NavGroup({ group, collapsed, onToggle }) {
  const location = useLocation();
  const isAnyActive = group.items.some(i => location.pathname.startsWith(i.to));
  const isOpen = !collapsed[group.id];
  const Icon = group.icon;

  return (
    <div className={`nav-group${group.wip ? ' nav-group-wip' : ''}`}>
      <button
        className={`nav-group-header${isAnyActive ? ' has-active' : ''}`}
        onClick={() => onToggle(group.id)}
      >
        <Icon size={13} />
        <span>{group.label}</span>
        {isOpen
          ? <ChevronDown size={11} className="chevron" />
          : <ChevronRight size={11} className="chevron" />
        }
      </button>
      {isOpen && (
        <div className="nav-group-items">
          {group.items.map(({ to, icon: IIcon, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) =>
              `nav-item nav-item-child${isActive ? ' active' : ''}`
            }>
              <IIcon size={13} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { dbStatus, disconnectDb, dbConfig } = useConnection();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(
    () => parseInt(localStorage.getItem('sidebar-width') || String(DEFAULT_WIDTH), 10)
  );
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    if (dbStatus === 'disconnected') navigate('/connect');
  }, [dbStatus]);

  const handleDisconnect = async () => {
    await disconnectDb();
    navigate('/connect');
  };

  const toggleGroup = (id) => {
    setCollapsed(prev => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem('sidebar-collapsed', JSON.stringify(next));
      return next;
    });
  };

  const onResizerMouseDown = useCallback((e) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + e.clientX - startX.current));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth(prev => { localStorage.setItem('sidebar-width', prev); return prev; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div className="layout">
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="sidebar-header">
          <img src={ollieLogo} className="logo-img" alt="Ollie" />
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
          <NavLink to="/dashboard" className={({ isActive }) =>
            `nav-item${isActive ? ' active' : ''}`
          }>
            <LayoutDashboard size={14} />
            <span>Dashboard</span>
          </NavLink>

          <div className="nav-section-gap" />

          {NAV_GROUPS.map(group => (
            <NavGroup key={group.id} group={group} collapsed={collapsed} onToggle={toggleGroup} />
          ))}

        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) =>
            `nav-item${isActive ? ' active' : ''}`
          }>
            <Settings size={15} />
            <span>Settings</span>
          </NavLink>
          <button className="nav-item disconnect" onClick={handleDisconnect}>
            <Unplug size={15} />
            <span>Disconnect</span>
          </button>
        </div>
      </aside>

      <div className="sidebar-resizer" onMouseDown={onResizerMouseDown} />

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}