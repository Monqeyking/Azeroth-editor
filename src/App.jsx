import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
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

export default function App() {
  return (
    <ConnectionProvider>
      <HashRouter>
        <Routes>
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="creatures" element={<CreatureEditorPage />} />
            <Route path="items" element={<ItemEditorPage />} />
            <Route path="quests" element={<QuestEditorPage />} />
            <Route path="spells" element={<SpellEditorPage />} />
            <Route path="talents" element={<TalentEditorPage />} />
            <Route path="map" element={<SpawnMapPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </ConnectionProvider>
  );
}
