import { createContext, useContext, useState, useCallback, useEffect } from 'react';

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
    password: '',
    characterName: ''
  });

  const [dbcPath, setDbcPath] = useState('D:\\CaioCore\\CaioServer\\data\\dbc');
  const [minimapPath, setMinimapPath] = useState('');
  const [worldmapMpqPath, setWorldmapMpqPath] = useState('');
  const [mapsPath, setMapsPath] = useState('');
  const [serverPaths, setServerPaths] = useState({ authExe: '', worldExe: '' });
  const [expansionsFolder, setExpansionsFolder] = useState('D:\\CaioCore\\CaioServer\\data\\Expansions');

  const [idRanges, setIdRanges] = useState({
    creature: 4000000,
    item: 4000000,
    spell: 4000000,
    quest: 4000000,
    talent: 4000000,
  });

  useEffect(() => {
    window.azeroth.config.load().then(result => {
      if (result.success && result.data) {
        if (result.data.soap) setSoapConfig(prev => ({ ...prev, ...result.data.soap }));
        if (result.data.dbcPath) setDbcPath(result.data.dbcPath);
        if (result.data.minimapPath) setMinimapPath(result.data.minimapPath);
        if (result.data.worldmapMpqPath) setWorldmapMpqPath(result.data.worldmapMpqPath);
        if (result.data.mapsPath) setMapsPath(result.data.mapsPath);
        if (result.data.idRanges) setIdRanges(prev => ({ ...prev, ...result.data.idRanges }));
        if (result.data.serverPaths) setServerPaths(prev => ({ ...prev, ...result.data.serverPaths }));
        if (result.data.expansionsFolder) setExpansionsFolder(result.data.expansionsFolder);
      }
    });
  }, []);

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

  const deleteTalent = useCallback(async (talentId) => {
    return window.azeroth.dbc.deleteTalent(dbcPath, talentId);
  }, [dbcPath]);

  const insertTalent = useCallback(async (talent) => {
    return window.azeroth.dbc.insertTalent(dbcPath, talent);
  }, [dbcPath]);

  const findNextId = useCallback(async ({ table, idColumn, startId }) => {
    return window.azeroth.db.findNextId({ table, idColumn, startId });
  }, []);

  const findNextTalentId = useCallback(async (startId) => {
    return window.azeroth.dbc.findNextTalentId(dbcPath, startId);
  }, [dbcPath]);

  const copyTalentDbc = useCallback(async (sourceId, newId) => {
    return window.azeroth.dbc.copyTalent(dbcPath, sourceId, newId);
  }, [dbcPath]);

  const searchSpellsDbc = useCallback(async (term, options) => {
    return window.azeroth.dbc.searchSpells(dbcPath, term, options);
  }, [dbcPath]);

  const readSkillLineAbility = useCallback(async (spellId) => {
    return window.azeroth.dbc.readSkillLineAbility(dbcPath, spellId);
  }, [dbcPath]);

  const addSkillLineAbility = useCallback(async (entry) => {
    return window.azeroth.dbc.addSkillLineAbility(dbcPath, entry);
  }, [dbcPath]);

  const readSpellFull = useCallback(async (id) => {
    return window.azeroth.dbc.readSpellFull(dbcPath, id);
  }, [dbcPath]);

  const writeSpellFull = useCallback(async (spell) => {
    return window.azeroth.dbc.writeSpellFull(dbcPath, spell);
  }, [dbcPath]);

  const findNextSpellId = useCallback(async (startId) => {
    return window.azeroth.dbc.findNextSpellId(dbcPath, startId);
  }, [dbcPath]);

  const copySpellDbc = useCallback(async (sourceId, newId) => {
    return window.azeroth.dbc.copySpell(dbcPath, sourceId, newId);
  }, [dbcPath]);

  const readCastTimes = useCallback(async () => {
    return window.azeroth.dbc.readCastTimes(dbcPath);
  }, [dbcPath]);

  const readDurations = useCallback(async () => {
    return window.azeroth.dbc.readDurations(dbcPath);
  }, [dbcPath]);

  const readRanges = useCallback(async () => {
    return window.azeroth.dbc.readRanges(dbcPath);
  }, [dbcPath]);

  const readCharSections = useCallback(async () => {
    return window.azeroth.dbc.readCharSections(dbcPath);
  }, [dbcPath]);

  const writeCharSections = useCallback(async (records) => {
    return window.azeroth.dbc.writeCharSections(dbcPath, records);
  }, [dbcPath]);

  const readBlpTexture = useCallback(async (dataPath, blpPath) => {
    return window.azeroth.dbc.readBlpTexture(dataPath, blpPath);
  }, []);

  const readBlpTextures = useCallback(async (dataPath, blpPaths) => {
    return window.azeroth.dbc.readBlpTextures(dataPath, blpPaths);
  }, []);

  const readItemSet = useCallback(async (id) => {
    return window.azeroth.dbc.readItemSet(dbcPath, id);
  }, [dbcPath]);

  const searchItemSets = useCallback(async (term) => {
    return window.azeroth.dbc.searchItemSets(dbcPath, term);
  }, [dbcPath]);

  const writeItemSet = useCallback(async (set) => {
    return window.azeroth.dbc.writeItemSet(dbcPath, set);
  }, [dbcPath]);

  const findNextItemSetId = useCallback(async () => {
    return window.azeroth.dbc.findNextItemSetId(dbcPath);
  }, [dbcPath]);

  const readScalingStatDistribution = useCallback(async (id) => {
    return window.azeroth.dbc.readScalingStatDistribution(dbcPath, id);
  }, [dbcPath]);

  const writeScalingStatDistribution = useCallback(async (dist) => {
    return window.azeroth.dbc.writeScalingStatDistribution(dbcPath, dist);
  }, [dbcPath]);

  const addScalingStatDistribution = useCallback(async (dist) => {
    return window.azeroth.dbc.addScalingStatDistribution(dbcPath, dist);
  }, [dbcPath]);

  const findNextScalingStatDistributionId = useCallback(async (startId) => {
    return window.azeroth.dbc.findNextScalingStatDistributionId(dbcPath, startId);
  }, [dbcPath]);

  const readScalingStatValues = useCallback(async () => {
    return window.azeroth.dbc.readScalingStatValues(dbcPath);
  }, [dbcPath]);

  return (
    <ConnectionContext.Provider value={{
      dbConfig, setDbConfig,
      soapConfig, setSoapConfig,
      dbcPath, setDbcPath,
      minimapPath, setMinimapPath,
      worldmapMpqPath, setWorldmapMpqPath,
      mapsPath, setMapsPath,
      dbStatus, dbError,
      soapStatus, setSoapStatus,
      connectDb, disconnectDb,
      query, soapCommand,
      readTalentTabs, readTalents, readSpells, readSpellIcons, saveTalent,
      getIcon, writeTalent, deleteTalent, insertTalent,
      findNextId, findNextTalentId, copyTalentDbc,
      searchSpellsDbc, readSpellFull, writeSpellFull, findNextSpellId, copySpellDbc,
      readSkillLineAbility, addSkillLineAbility,
      readCastTimes, readDurations, readRanges,
      readCharSections, writeCharSections,
      readBlpTexture, readBlpTextures,
      readItemSet, searchItemSets, writeItemSet, findNextItemSetId,
      readScalingStatDistribution, writeScalingStatDistribution, addScalingStatDistribution,
      findNextScalingStatDistributionId, readScalingStatValues,
      idRanges, setIdRanges,
      serverPaths, setServerPaths,
      expansionsFolder, setExpansionsFolder,
    }}>
      {children}
    </ConnectionContext.Provider>
  );
}

export const useConnection = () => useContext(ConnectionContext);
