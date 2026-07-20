const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('azeroth', {
  // Database
  db: {
    connect: (config) => ipcRenderer.invoke('db:connect', config),
    query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
    disconnect: () => ipcRenderer.invoke('db:disconnect'),
    findNextId: (opts) => ipcRenderer.invoke('db:findNextId', opts),
  },
  atomic: {
    begin: (dbcPath, files) => ipcRenderer.invoke('atomic:begin', { dbcPath, files }),
    commit: (id) => ipcRenderer.invoke('atomic:commit', id),
    rollback: (id) => ipcRenderer.invoke('atomic:rollback', id),
  },
  // SOAP / Live server
  soap: {
    command: (opts) => ipcRenderer.invoke('soap:command', opts),
  },
  // DBC files
  dbc: {
    readAchievementsOverview: (dbcPath) => ipcRenderer.invoke('dbc:readAchievementsOverview', dbcPath),
    writeAchievement: (dbcPath, achievement) => ipcRenderer.invoke('dbc:writeAchievement', dbcPath, achievement),
    createAchievement: (dbcPath, payload) => ipcRenderer.invoke('dbc:createAchievement', dbcPath, payload),
    deleteAchievement: (dbcPath, achievementId) => ipcRenderer.invoke('dbc:deleteAchievement', dbcPath, achievementId),
    writeAchievementCriteria: (dbcPath, achievementId, criteria) => ipcRenderer.invoke('dbc:writeAchievementCriteria', dbcPath, achievementId, criteria),
    readTalentTabs: (dbcPath) => ipcRenderer.invoke('dbc:readTalentTabs', dbcPath),
    readTalents: (dbcPath, tabId) => ipcRenderer.invoke('dbc:readTalents', dbcPath, tabId),
    readSpells: (dbcPath, spellIds) => ipcRenderer.invoke('dbc:readSpells', dbcPath, spellIds),
    readSpellIcons: (dbcPath, iconIds) => ipcRenderer.invoke('dbc:readSpellIcons', dbcPath, iconIds),
    readItemIcons: (dbcPath, itemIds) => ipcRenderer.invoke('dbc:readItemIcons', dbcPath, itemIds),
    searchSpells: (dbcPath, term, options) => ipcRenderer.invoke('dbc:searchSpells', dbcPath, term, options),
    readSpellFull: (dbcPath, id) => ipcRenderer.invoke('dbc:readSpellFull', dbcPath, id),
    getSpellDbcInfo: (dbcPath) => ipcRenderer.invoke('dbc:getSpellDbcInfo', dbcPath),
    writeSpellFull: (dbcPath, spell) => ipcRenderer.invoke('dbc:writeSpellFull', dbcPath, spell),
    findNextSpellId: (dbcPath, startId) => ipcRenderer.invoke('dbc:findNextSpellId', dbcPath, startId),
    copySpell: (dbcPath, sourceId, newId) => ipcRenderer.invoke('dbc:copySpell', dbcPath, sourceId, newId),
    copySpellCrossFile: (sourceDbcPath, sourceId, destDbcPath, newId) => ipcRenderer.invoke('dbc:copySpellCrossFile', sourceDbcPath, sourceId, destDbcPath, newId),
    writeTalent: (dbcPath, talent) => ipcRenderer.invoke('dbc:writeTalent', dbcPath, talent),
    deleteTalent: (dbcPath, talentId) => ipcRenderer.invoke('dbc:deleteTalent', dbcPath, talentId),
    insertTalent: (dbcPath, talent) => ipcRenderer.invoke('dbc:insertTalent', dbcPath, talent),
    findNextTalentId: (dbcPath, startId) => ipcRenderer.invoke('dbc:findNextTalentId', dbcPath, startId),
    copyTalent: (dbcPath, sourceId, newId) => ipcRenderer.invoke('dbc:copyTalent', dbcPath, sourceId, newId),
    readSkillLineAbility: (dbcPath, spellId) => ipcRenderer.invoke('dbc:readSkillLineAbility', dbcPath, spellId),
    readSkillLineTree: (dbcPath, opts) => ipcRenderer.invoke('dbc:readSkillLineTree', dbcPath, opts),
    addSkillLineAbility: (dbcPath, entry) => ipcRenderer.invoke('dbc:addSkillLineAbility', dbcPath, entry),
    readScalingStatDistribution: (dbcPath, id) => ipcRenderer.invoke('dbc:readScalingStatDistribution', dbcPath, id),
    writeScalingStatDistribution: (dbcPath, dist) => ipcRenderer.invoke('dbc:writeScalingStatDistribution', dbcPath, dist),
    addScalingStatDistribution: (dbcPath, dist) => ipcRenderer.invoke('dbc:addScalingStatDistribution', dbcPath, dist),
    findNextScalingStatDistributionId: (dbcPath, startId) => ipcRenderer.invoke('dbc:findNextScalingStatDistributionId', dbcPath, startId),
    readScalingStatValues: (dbcPath) => ipcRenderer.invoke('dbc:readScalingStatValues', dbcPath),
    readCharBaseInfo: (dbcPath) => ipcRenderer.invoke('dbc:readCharBaseInfo', dbcPath),
    readCharStartOutfit: (dbcPath, opts) => ipcRenderer.invoke('dbc:readCharStartOutfit', dbcPath, opts),
    writeCharBaseInfo: (dbcPath, combos) => ipcRenderer.invoke('dbc:writeCharBaseInfo', dbcPath, combos),
    appendCharStartOutfit: (dbcPath, rows) => ipcRenderer.invoke('dbc:appendCharStartOutfit', dbcPath, rows),
    readCharSections: (dbcPath) => ipcRenderer.invoke('dbc:readCharSections', dbcPath),
    readCreatureDisplayCreator: (dbcPath) => ipcRenderer.invoke('dbc:readCreatureDisplayCreator', dbcPath),
    findNextCreatureDisplayId: (dbcPath, startId) => ipcRenderer.invoke('dbc:findNextCreatureDisplayId', dbcPath, startId),
    createCreatureDisplay: (dbcPath, payload) => ipcRenderer.invoke('dbc:createCreatureDisplay', dbcPath, payload),
    setCreatureDisplayBakeName: (dbcPath, extraId) => ipcRenderer.invoke('dbc:setCreatureDisplayBakeName', dbcPath, extraId),
    setCreatureDisplayObjectPackage: (dbcPath, displayId) => ipcRenderer.invoke('dbc:setCreatureDisplayObjectPackage', dbcPath, displayId),
    readItemDisplayInfos: (dataPath, displayIds, opts) => ipcRenderer.invoke('dbc:readItemDisplayInfos', dataPath, displayIds, opts),
    writeCharSections: (dbcPath, records, stageOnly = false) => ipcRenderer.invoke('dbc:writeCharSections', dbcPath, records, stageOnly),
    readBlpTexture: (dataPath, blpPath) => ipcRenderer.invoke('dbc:readBlpTexture', dataPath, blpPath),
    readBlpFile: (filePath) => ipcRenderer.invoke('dbc:readBlpFile', filePath),
    readBlpTextures: (dataPath, blpPaths) => ipcRenderer.invoke('dbc:readBlpTextures', dataPath, blpPaths),
    writeBlpTextureEdit: (dataPath, blpPath, editedRgbaBase64, maskBase64, outRelPath, stageOutput = false) =>
      ipcRenderer.invoke('dbc:writeBlpTextureEdit', dataPath, blpPath, editedRgbaBase64, maskBase64, outRelPath, stageOutput),
    bakeNpcTexture: (dataPath, extraId, rgbaBase64, maskBase64) =>
      ipcRenderer.invoke('dbc:bakeNpcTexture', dataPath, extraId, rgbaBase64, maskBase64),
    readCastTimes: (dbcPath) => ipcRenderer.invoke('dbc:readCastTimes', dbcPath),
    readDurations: (dbcPath) => ipcRenderer.invoke('dbc:readDurations', dbcPath),
    readRanges: (dbcPath) => ipcRenderer.invoke('dbc:readRanges', dbcPath),
    readItemSet: (dbcPath, id) => ipcRenderer.invoke('dbc:readItemSet', dbcPath, id),
    searchItemSets: (dbcPath, term) => ipcRenderer.invoke('dbc:searchItemSets', dbcPath, term),
    writeItemSet: (dbcPath, set) => ipcRenderer.invoke('dbc:writeItemSet', dbcPath, set),
    findNextItemSetId: (dbcPath) => ipcRenderer.invoke('dbc:findNextItemSetId', dbcPath),
  },
  glue: {
    readTextFile: (dataPath, internalPath) => ipcRenderer.invoke('glue:readTextFile', dataPath, internalPath),
    writeTextFile: (relPath, text) => ipcRenderer.invoke('glue:writeTextFile', relPath, text),
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
    getZoneImage: (folderName, baseName, dataPath, preferOldest = false) => ipcRenderer.invoke('worldmap:getZoneImage', folderName, baseName, dataPath, preferOldest),
    readWorldMapAreas: (dbcPath) => ipcRenderer.invoke('worldmap:readWorldMapAreas', dbcPath),
    listZones: (dataPath) => ipcRenderer.invoke('worldmap:listZones', dataPath),
    validatePath: (dataPath) => ipcRenderer.invoke('worldmap:validatePath', dataPath),
  },
  // Config persistence
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config),
  },
  window: { openSpellLookup: () => ipcRenderer.invoke('window:openSpellLookup') },
  clipboard: { writeText: (value) => ipcRenderer.invoke('clipboard:writeText', value) },
  // Spawn loader (3D editor)
  spawns: {
    load: (opts) => ipcRenderer.invoke('spawns:load', opts),
    update: (opts) => ipcRenderer.invoke('spawns:update', opts),
    search: (opts) => ipcRenderer.invoke('spawns:search', opts),
  },
  // ADT terrain (3D editor)
  adt: {
    getTerrain:             (opts) => ipcRenderer.invoke('adt:getTerrain', opts),
    getTileTextures:        (opts) => ipcRenderer.invoke('adt:getTileTextures', opts),
    getTextureLayers:         (opts) => ipcRenderer.invoke('adt:getTextureLayers', opts),
    diagBLP:                  (opts) => ipcRenderer.invoke('adt:diagBLP', opts),
    getWdl:                 (opts) => ipcRenderer.invoke('adt:getWdl', opts),
  },
  // M2 model loader (3D editor)
  m2: {
    loadModel:     (opts) => ipcRenderer.invoke('m2:loadModel', opts),
    loadModelByPath: (opts) => ipcRenderer.invoke('m2:loadModelByPath', opts),
    prefetch:      (opts) => ipcRenderer.invoke('m2:prefetch', opts),
    loadCharModel: (opts) => ipcRenderer.invoke('m2:loadCharModel', opts),
  },
  // Server process control
  server: {
    status:      (opts) => ipcRenderer.invoke('server:status', opts),
    start:       (opts) => ipcRenderer.invoke('server:start', opts),
    stop:        (opts) => ipcRenderer.invoke('server:stop', opts),
    sendCommand: (opts) => ipcRenderer.invoke('server:sendCommand', opts),
    onOutput:  (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('server:output', h); return h; },
    offOutput: (h)  => ipcRenderer.removeListener('server:output', h),
  },
  // DBC SQL editor
  dbcSql: {
    listFiles: (opts) => ipcRenderer.invoke('dbcSql:listFiles', opts),
    query:     (opts) => ipcRenderer.invoke('dbcSql:query', opts),
  },
  // Filesystem helpers
  fs: {
    listFolder: (opts) => ipcRenderer.invoke('fs:listFolder', opts),
    copyFiles:  (opts) => ipcRenderer.invoke('fs:copyFiles', opts),
  },
  // Native file/folder picker
  dialog: {
    openFile:   (opts) => ipcRenderer.invoke('dialog:openFile', opts),
    openFolder: (opts) => ipcRenderer.invoke('dialog:openFolder', opts),
  },
});
