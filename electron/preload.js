const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('azeroth', {
  // Database
  db: {
    connect: (config) => ipcRenderer.invoke('db:connect', config),
    query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
    disconnect: () => ipcRenderer.invoke('db:disconnect'),
    findNextId: (opts) => ipcRenderer.invoke('db:findNextId', opts),
  },
  // SOAP / Live server
  soap: {
    command: (opts) => ipcRenderer.invoke('soap:command', opts),
  },
  // DBC files
  dbc: {
    readTalentTabs: (dbcPath) => ipcRenderer.invoke('dbc:readTalentTabs', dbcPath),
    readTalents: (dbcPath, tabId) => ipcRenderer.invoke('dbc:readTalents', dbcPath, tabId),
    readSpells: (dbcPath, spellIds) => ipcRenderer.invoke('dbc:readSpells', dbcPath, spellIds),
    readSpellIcons: (dbcPath, iconIds) => ipcRenderer.invoke('dbc:readSpellIcons', dbcPath, iconIds),
    searchSpells: (dbcPath, term, options) => ipcRenderer.invoke('dbc:searchSpells', dbcPath, term, options),
    readSpellFull: (dbcPath, id) => ipcRenderer.invoke('dbc:readSpellFull', dbcPath, id),
    writeSpellFull: (dbcPath, spell) => ipcRenderer.invoke('dbc:writeSpellFull', dbcPath, spell),
    findNextSpellId: (dbcPath, startId) => ipcRenderer.invoke('dbc:findNextSpellId', dbcPath, startId),
    copySpell: (dbcPath, sourceId, newId) => ipcRenderer.invoke('dbc:copySpell', dbcPath, sourceId, newId),
    writeTalent: (dbcPath, talent) => ipcRenderer.invoke('dbc:writeTalent', dbcPath, talent),
    deleteTalent: (dbcPath, talentId) => ipcRenderer.invoke('dbc:deleteTalent', dbcPath, talentId),
    insertTalent: (dbcPath, talent) => ipcRenderer.invoke('dbc:insertTalent', dbcPath, talent),
    findNextTalentId: (dbcPath, startId) => ipcRenderer.invoke('dbc:findNextTalentId', dbcPath, startId),
    copyTalent: (dbcPath, sourceId, newId) => ipcRenderer.invoke('dbc:copyTalent', dbcPath, sourceId, newId),
    readSkillLineAbility: (dbcPath, spellId) => ipcRenderer.invoke('dbc:readSkillLineAbility', dbcPath, spellId),
    addSkillLineAbility: (dbcPath, entry) => ipcRenderer.invoke('dbc:addSkillLineAbility', dbcPath, entry),
    readCharBaseInfo: (dbcPath) => ipcRenderer.invoke('dbc:readCharBaseInfo', dbcPath),
    writeCharBaseInfo: (dbcPath, combos) => ipcRenderer.invoke('dbc:writeCharBaseInfo', dbcPath, combos),
    readCastTimes: (dbcPath) => ipcRenderer.invoke('dbc:readCastTimes', dbcPath),
    readDurations: (dbcPath) => ipcRenderer.invoke('dbc:readDurations', dbcPath),
    readRanges: (dbcPath) => ipcRenderer.invoke('dbc:readRanges', dbcPath),
  },
  // Icons
  icons: {
    get: (dbcPath, iconName) => ipcRenderer.invoke('icons:get', dbcPath, iconName),
  },
  // Talents
  talents: {
    getBackground: (backgroundFile) => ipcRenderer.invoke('talents:getBackground', backgroundFile),
  },
  // Minimap tiles
  minimap: {
    getTile: (minimapPath, mapId, col, row) => ipcRenderer.invoke('minimap:getTile', minimapPath, mapId, col, row),
  },
  // World map BLP tiles
  worldmap: {
    getZoneImage: (folderName, baseName, dataPath) => ipcRenderer.invoke('worldmap:getZoneImage', folderName, baseName, dataPath),
    readWorldMapAreas: (dbcPath) => ipcRenderer.invoke('worldmap:readWorldMapAreas', dbcPath),
    listZones: (dataPath) => ipcRenderer.invoke('worldmap:listZones', dataPath),
    validatePath: (dataPath) => ipcRenderer.invoke('worldmap:validatePath', dataPath),
  },
  // Config persistence
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config),
  },
  // Spawn loader (3D editor)
  spawns: {
    load: (opts) => ipcRenderer.invoke('spawns:load', opts),
    update: (opts) => ipcRenderer.invoke('spawns:update', opts),
    search: (opts) => ipcRenderer.invoke('spawns:search', opts),
  },
  // ADT terrain (3D editor)
  adt: {
    getTerrain: (opts) => ipcRenderer.invoke('adt:getTerrain', opts),
  },
  // M2 model loader (3D editor)
  m2: {
    loadModel: (opts) => ipcRenderer.invoke('m2:loadModel', opts),
    prefetch:  (opts) => ipcRenderer.invoke('m2:prefetch', opts),
  },
});
