import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import { ConnectionProvider } from './lib/ConnectionContext';
import Layout from './components/layout/Layout';
import ConnectPage from './pages/ConnectPage';
import DashboardPage from './pages/DashboardPage';
import CreatureEditorPage from './pages/CreatureEditorPage';
import ItemEditorPage from './pages/ItemEditorPage';
import QuestEditorPage from './pages/QuestEditorPage';
import SpellEditorPage from './pages/SpellEditorPage';
import TalentEditorPage from './pages/TalentEditorPage';
import SpawnMapPage from './pages/SpawnMapPage';
import SettingsPage from './pages/SettingsPage';
import Editor3DPage from './pages/Editor3DPage';
import RaceClassPage from './pages/RaceClassPage';
import TrainerSpellPage from './pages/TrainerSpellPage';
import CharCustomizationPage from './pages/CharCustomizationPage';
import LootEditorPage from './pages/LootEditorPage';
import ItemSetEditorPage from './pages/ItemSetEditorPage';
import VendorEditorPage from './pages/VendorEditorPage';
import SqlEditorPage from './pages/SqlEditorPage';

const router = createHashRouter([
  { path: '/connect', element: <ConnectPage /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard',          element: <DashboardPage /> },
      { path: 'creatures',          element: <CreatureEditorPage /> },
      { path: 'items',              element: <ItemEditorPage /> },
      { path: 'quests',             element: <QuestEditorPage /> },
      { path: 'spells',             element: <SpellEditorPage /> },
      { path: 'talents',            element: <TalentEditorPage /> },
      { path: 'map',                element: <SpawnMapPage /> },
      { path: 'editor3d',           element: <Editor3DPage /> },
      { path: 'races',              element: <RaceClassPage /> },
      { path: 'trainer-spells',     element: <TrainerSpellPage /> },
      { path: 'char-customization', element: <CharCustomizationPage /> },
      { path: 'loot',               element: <LootEditorPage /> },
      { path: 'item-sets',          element: <ItemSetEditorPage /> },
      { path: 'vendors',            element: <VendorEditorPage /> },
      { path: 'sql',                element: <SqlEditorPage /> },
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