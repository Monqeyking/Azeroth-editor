const fs = require('fs');
const path = require('path');

function getConfigPath(app) {
  return path.join(app.getPath('userData'), 'azeroth-editor-config.json');
}

function readConfig(app) {
  const filePath = getConfigPath(app);
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
}

function registerConfigIpc(ipcMain, app, onConfig) {
  ipcMain.handle('config:load', () => {
    try {
      const data = readConfig(app);
      if (data) onConfig?.(data);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:save', (_, config) => {
    try {
      const current = readConfig(app) || {};
      const merged = { ...current, ...config };
      fs.writeFileSync(getConfigPath(app), JSON.stringify(merged, null, 2), 'utf8');
      onConfig?.(merged);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { getConfigPath, readConfig, registerConfigIpc };
