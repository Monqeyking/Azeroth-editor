const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('azeroth', {
  // Database
  db: {
    connect: (config) => ipcRenderer.invoke('db:connect', config),
    query: (sql, params) => ipcRenderer.invoke('db:query', sql, params),
    disconnect: () => ipcRenderer.invoke('db:disconnect'),
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
    writeTalent: (dbcPath, talent) => ipcRenderer.invoke('dbc:writeTalent', dbcPath, talent),
  },
  // Icons
  icons: {
    get: (dbcPath, iconName) => ipcRenderer.invoke('icons:get', dbcPath, iconName),
  },
  // Config persistence
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config),
  }
});
