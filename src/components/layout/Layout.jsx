import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useConnection } from '../../lib/ConnectionContext';
import { useEffect, useState, useRef, useCallback } from 'react';
import {
  LayoutDashboard, Swords, Package, ScrollText, Shield, Monitor,
  Settings, Unplug, Terminal, ChevronDown, ChevronRight,
  BookOpen, Sparkles, GitBranch, Users, Palette, PackageOpen,
  Layers, ShoppingBag, Database, Globe, Hammer, Skull, LayoutGrid,
  Trophy, Footprints, ScanFace, Box, Castle, FileSearch
} from 'lucide-react';
import ollieLogo from '../../assets/Ollie.png';
import './Layout.css';

const NAV_SECTIONS = [
  {
    id: 'content', label: 'Content', icon: Swords, defaultPath: '/creatures',
    groups: [
      {
        id: 'npcs', label: 'NPCs & Creatures', icon: Swords,
        items: [
          { to: '/creatures', icon: Swords, label: 'Creatures' },
          { to: '/enemies', icon: Skull, label: 'Enemies' },
          { to: '/npc-workflow', icon: GitBranch, label: 'NPC Workflow' },
          { to: '/npc-movement', icon: Footprints, label: 'NPC Movement' },
        ],
      },
      {
        id: 'services', label: 'Services & Economy', icon: Hammer,
        items: [
          { to: '/professions', icon: Hammer, label: 'Professions' },
          { to: '/trainer-spells', icon: BookOpen, label: 'Trainers' },
          { to: '/vendors', icon: ShoppingBag, label: 'Vendors' },
        ],
      },
      {
        id: 'items', label: 'Items & Loot', icon: Package,
        items: [
          { to: '/items', icon: Package, label: 'Items' },
          { to: '/item-sets', icon: Layers, label: 'Item Sets' },
          { to: '/loot', icon: PackageOpen, label: 'Loot' },
        ],
      },
      {
        id: 'quests', label: 'Quests & Story', icon: ScrollText,
        items: [
          { to: '/quests', icon: ScrollText, label: 'Quests' },
          { to: '/achievements', icon: Trophy, label: 'Achievements' },
        ],
      },
    ],
  },
  {
    id: 'characters', label: 'Characters', icon: Shield, defaultPath: '/spells',
    groups: [
      {
        id: 'character', label: 'Character Systems', icon: Shield,
        items: [
          { to: '/spells', icon: Sparkles, label: 'Spells' },
          { to: '/talents', icon: GitBranch, label: 'Talents' },
          { to: '/races', icon: Users, label: 'Races & Classes' },
        ],
      },
      {
        id: 'appearance', label: 'Appearance', icon: Palette,
        items: [
          { to: '/char-customization', icon: Palette, label: 'Character Looks' },
        ],
      },
    ],
  },
  {
    id: 'world', label: 'World', icon: Monitor, defaultPath: '/worldmap',
    groups: [
      {
        id: 'world-building', label: 'World Building', icon: Globe,
        items: [
          { to: '/worldmap', icon: Globe, label: 'World Map' },
          { to: '/world-check', icon: Globe, label: 'World Check' },
          { to: '/editor3d', icon: Monitor, label: '3D World Editor' },
          { to: '/adt-editor', icon: FileSearch, label: 'ADT Editor' },
        ],
      },
      {
        id: 'world-editing', label: 'World Editing', icon: Hammer,
        items: [
          { to: '/game-objects', icon: Box, label: 'Game Objects' },
          { to: '/dungeons', icon: Castle, label: 'Dungeons' },
        ],
      },
    ],
  },
  {
    id: 'assets', label: 'Assets', icon: Box, defaultPath: '/creature-displays',
    groups: [
      {
        id: 'asset-tools', label: 'Asset Tools', icon: Box,
        items: [
          { to: '/creature-displays', icon: ScanFace, label: 'Creature Displays' },
          { to: '/asset-editor', icon: Box, label: '3D Asset Editor' },
          { to: '/texture-workshop', icon: Palette, label: 'Texture Workshop' },
          { to: '/ui-editor', icon: LayoutGrid, label: 'UI Editor' },
        ],
      },
    ],
  },
  {
    id: 'tools', label: 'Tools', icon: Database, defaultPath: '/server-config',
    groups: [
      {
        id: 'admin', label: 'Administration', icon: Settings,
        items: [
          { to: '/server-config', icon: Settings, label: 'Server Config' },
          { to: '/expansion-lock', icon: Shield, label: 'Expansion Lock' },
        ],
      },
      {
        id: 'sql', label: 'SQL', icon: Database,
        items: [
          { to: '/dbc-sql', icon: Database, label: 'DBC SQL Editor' },
          { to: '/sql', icon: Terminal, label: 'Database SQL' },
        ],
      },
    ],
  },
];

const MIN_WIDTH = 180;
const MAX_WIDTH = 280;
const DEFAULT_WIDTH = 220;
const SIDEBAR_WIDTH_VERSION = '2';

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem('sidebar-collapsed') || '{}'); }
  catch { return {}; }
}

function loadSidebarWidth() {
  if (localStorage.getItem('sidebar-width-version') !== SIDEBAR_WIDTH_VERSION) {
    localStorage.setItem('sidebar-width-version', SIDEBAR_WIDTH_VERSION);
    localStorage.setItem('sidebar-width', String(DEFAULT_WIDTH));
    return DEFAULT_WIDTH;
  }
  const saved = parseInt(localStorage.getItem('sidebar-width') || String(DEFAULT_WIDTH), 10);
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number.isFinite(saved) ? saved : DEFAULT_WIDTH));
}

function NavGroup({ group, collapsed, onToggle }) {
  const location = useLocation();
  const isAnyActive = group.items.some(i => location.pathname.startsWith(i.to));
  const isOpen = !collapsed[group.id];
  const Icon = group.icon;

  return (
    <div className="nav-group">
      <button
        className={`nav-group-header${isAnyActive ? ' has-active' : ''}`}
        onClick={() => onToggle(group.id)}
      >
        <Icon size={13} />
        <span>{group.label}</span>
        {isOpen ? <ChevronDown size={11} className="chevron" /> : <ChevronRight size={11} className="chevron" />}
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
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    if (dbStatus === 'disconnected') navigate('/connect');
  }, [dbStatus, navigate]);

  useEffect(() => {
    setSidebarWidth(loadSidebarWidth());
  }, []);

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

  const isDashboardRoute = location.pathname === '/dashboard' || location.pathname === '/settings';
  const activeSection = isDashboardRoute
    ? null
    : NAV_SECTIONS.find(section =>
        section.groups.some(group => group.items.some(item => location.pathname.startsWith(item.to)))
      ) || NAV_SECTIONS[0];

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
      <header className="topbar">
        <div className="topbar-brand">
          <img src={ollieLogo} className="logo-img" alt="Ollie" />
          <div className="logo-text">
            <span className="logo-title">Azeroth</span>
            <span className="logo-sub">Editor</span>
          </div>
        </div>
        <nav className="topbar-tabs" aria-label="Main navigation">
          <NavLink to="/dashboard" className={`topbar-tab${isDashboardRoute ? ' active' : ''}`}>
            <LayoutDashboard size={14} />
            <span>Dashboard</span>
          </NavLink>
          {NAV_SECTIONS.map(section => {
            const Icon = section.icon;
            const isActive = activeSection?.id === section.id;
            return (
              <button
                key={section.id}
                className={`topbar-tab${isActive ? ' active' : ''}`}
                onClick={() => navigate(section.defaultPath)}
              >
                <Icon size={14} />
                <span>{section.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="topbar-status">
          <div className="db-badge">
            <span className="db-dot connected" />
            <span className="db-name">{dbConfig.database}</span>
          </div>
        </div>
      </header>

      <div className="workspace-shell">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          {activeSection && (
            <>
              <div className="sidebar-context">
                <span className="sidebar-context-label">Workspace</span>
                <strong>{activeSection.label}</strong>
              </div>

              <nav className="sidebar-nav">
                {activeSection.groups.map(group => (
                  <NavGroup key={group.id} group={group} collapsed={collapsed} onToggle={toggleGroup} />
                ))}
              </nav>
            </>
          )}

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
    </div>
  );
}
