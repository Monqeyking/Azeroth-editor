import { createContext, useContext, useState, useCallback } from 'react';

const ConnectionContext = createContext(null);

export function ConnectionProvider({ children }) {
  const [dbConfig, setDbConfig] = useState({
    host: 'localhost',
    port: 3306,
    user: 'acore',
    password: '',
    database: 'acore_wotlk_world'
  });

  const [soapConfig, setSoapConfig] = useState({
    host: '127.0.0.1',
    port: 7878,
    user: '',
    password: ''
  });

  const [dbcPath, setDbcPath] = useState('D:\\CaioCore\\CaioServer\\data\\dbc');

  const [dbStatus, setDbStatus] = useState('disconnected'); // disconnected | connecting | connected | error
  const [soapStatus, setSoapStatus] = useState('disconnected');
  const [dbError, setDbError] = useState(null);

  const connectDb = useCallback(async (config) => {
    setDbStatus('connecting');
    setDbError(null);
    const cfg = config || dbConfig;
    const result = await window.azeroth.db.connect(cfg);
    if (result.success) {
      setDbStatus('connected');
      setDbConfig(cfg);
    } else {
      setDbStatus('error');
      setDbError(result.error);
    }
    return result;
  }, [dbConfig]);

  const disconnectDb = useCallback(async () => {
    await window.azeroth.db.disconnect();
    setDbStatus('disconnected');
  }, []);

  const query = useCallback(async (sql, params = []) => {
    return window.azeroth.db.query(sql, params);
  }, []);

  const soapCommand = useCallback(async (command) => {
    return window.azeroth.soap.command({ ...soapConfig, command });
  }, [soapConfig]);

  // DBC-only (no database)
  const readTalentTabs = useCallback(async () => {
    return window.azeroth.dbc.readTalentTabs(dbcPath);
  }, [dbcPath]);

  const readTalents = useCallback(async (tabId) => {
    return window.azeroth.dbc.readTalents(dbcPath, tabId);
  }, [dbcPath]);

  const readSpells = useCallback(async (spellIds) => {
    return window.azeroth.dbc.readSpells(dbcPath, spellIds);
  }, [dbcPath]);

  const readSpellIcons = useCallback(async (iconIds) => {
    return window.azeroth.dbc.readSpellIcons(dbcPath, iconIds);
  }, [dbcPath]);

  const saveTalent = useCallback(async (talent) => {
    return window.azeroth.dbc.writeTalent(dbcPath, talent);
  }, [dbcPath]);

  const getIcon = useCallback(async (iconName) => {
    return window.azeroth.icons.get(dbcPath, iconName);
  }, [dbcPath]);

  const writeTalent = useCallback(async (talent) => {
    return window.azeroth.dbc.writeTalent(dbcPath, talent);
  }, [dbcPath]);

  return (
    <ConnectionContext.Provider value={{
      dbConfig, setDbConfig,
      soapConfig, setSoapConfig,
      dbcPath, setDbcPath,
      dbStatus, dbError,
      soapStatus, setSoapStatus,
      connectDb, disconnectDb,
      query, soapCommand,
      readTalentTabs, readTalents, readSpells, readSpellIcons, saveTalent,
      getIcon, writeTalent
    }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export const useConnection = () => useContext(ConnectionContext);
