import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ConnectionProvider } from './lib/ConnectionContext';
import Layout from './components/layout/Layout';
import ConnectPage from './pages/ConnectPage';
import DashboardPage from './pages/DashboardPage';
import CreatureEditorPage from './pages/CreatureEditorPage';
import CreatureDisplaysPage from './pages/CreatureDisplaysPage';
import ItemEditorPage from './pages/ItemEditorPage';
import QuestEditorPage from './pages/QuestEditorPage';
import SpellEditorPage from './pages/SpellEditorPage';
import TalentEditorPage from './pages/TalentEditorPage';
import SpawnMapPage from './pages/SpawnMapPage';
import SettingsPage from './pages/SettingsPage';
import Editor3DPage from './pages/Editor3DPage';
import RaceClassPage from './pages/RaceClassPage';
import TrainerSpellPage from './pages/TrainerSpellPage';
import ProfessionEditorPage from './pages/ProfessionEditorPage';
import CharCustomizationPage from './pages/CharCustomizationPage';
import LootEditorPage from './pages/LootEditorPage';
import ItemSetEditorPage from './pages/ItemSetEditorPage';
import EnemiesPage from './pages/EnemiesPage';
import NPCWorkflowPage from './pages/NPCWorkflowPage';
import VendorEditorPage from './pages/VendorEditorPage';
import SqlEditorPage from './pages/SqlEditorPage';
import DbcSqlPage from './pages/DbcSqlPage';
import ExpansionLockPage from './pages/ExpansionLockPage';
import WorldMapPage from './pages/WorldMapPage';
import UIEditorPage from './pages/UIEditorPage';
import AchievementEditorPage from './pages/AchievementEditorPage';
import NpcMovementPage from './pages/NpcMovementPage';
import SpellLookup from './components/SpellLookup';
import EntityLookup from './components/EntityLookup';

const router = createHashRouter([
  { path: '/connect', element: <ConnectPage /> },
  { path: '/spell-lookup', element: <SpellLookup /> },
  { path: '/npc-lookup', element: <EntityLookup kind="npc" /> },
  { path: '/item-lookup', element: <EntityLookup kind="item" /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard',          element: <DashboardPage /> },
      { path: 'creatures',          element: <CreatureEditorPage /> },
      { path: 'creature-displays',  element: <CreatureDisplaysPage /> },
      { path: 'enemies',            element: <EnemiesPage /> },
      { path: 'items',              element: <ItemEditorPage /> },
      { path: 'quests',             element: <QuestEditorPage /> },
      { path: 'achievements',       element: <AchievementEditorPage /> },
      { path: 'spells',             element: <SpellEditorPage /> },
      { path: 'talents',            element: <TalentEditorPage /> },
      { path: 'map',                element: <SpawnMapPage /> },
      { path: 'editor3d',           element: <Editor3DPage /> },
      { path: 'races',              element: <RaceClassPage /> },
      { path: 'professions',        element: <ProfessionEditorPage /> },
      { path: 'trainer-spells',     element: <TrainerSpellPage /> },
      { path: 'npc-workflow',       element: <NPCWorkflowPage /> },
      { path: 'npc-movement',       element: <NpcMovementPage /> },
      { path: 'char-customization', element: <CharCustomizationPage /> },
      { path: 'loot',               element: <LootEditorPage /> },
      { path: 'item-sets',          element: <ItemSetEditorPage /> },
      { path: 'vendors',            element: <VendorEditorPage /> },
      { path: 'sql',                element: <SqlEditorPage /> },
      { path: 'dbc-sql',           element: <DbcSqlPage /> },
      { path: 'expansion-lock',    element: <ExpansionLockPage /> },
      { path: 'worldmap',          element: <WorldMapPage /> },
      { path: 'ui-editor',          element: <UIEditorPage /> },
      { path: 'settings',           element: <SettingsPage /> },
    ],
  },
]);

export default function App() {
  return (
    <ConnectionProvider>
      <RouterProvider router={router} />
    </ConnectionProvider>
  );
}
