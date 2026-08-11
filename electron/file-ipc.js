const fs = require('fs');
const path = require('path');

function registerFileIpc(ipcMain) {
  ipcMain.handle('fs:listFolder', async (_, { folder }) => {
    try {
      if (!fs.existsSync(folder)) return { success: true, files: [] };
      const files = fs.readdirSync(folder)
        .filter(file => fs.statSync(path.join(folder, file)).isFile());
      return { success: true, files };
    } catch (error) {
      return { success: false, error: error.message, files: [] };
    }
  });

  ipcMain.handle('fs:copyFiles', async (_, { files, srcDir, destDir }) => {
    try {
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const copied = [];
      const missing = [];
      for (const file of files) {
        const source = path.join(srcDir, file);
        if (fs.existsSync(source)) {
          fs.copyFileSync(source, path.join(destDir, file));
          copied.push(file);
        } else {
          missing.push(file);
        }
      }
      return { success: true, copied, missing };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerFileIpc };
