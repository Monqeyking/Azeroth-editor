const iconCache = new Map();

function normalizeIconPath(iconPath) {
  let normalized = String(iconPath || '').trim().replace(/\//g, '\\');
  if (!normalized) return '';
  normalized = normalized.replace(/\.(?:blp|png|tga)$/i, '');
  if (!normalized.includes('\\')) normalized = `Interface\\Icons\\${normalized}`;
  else if (/^Icons\\/i.test(normalized)) normalized = `Interface\\${normalized}`;
  return `${normalized}.blp`;
}

function registerIconIpc(ipcMain, readIcon) {
  ipcMain.handle('icons:get', async (_, dataPath, iconPath) => {
    try {
      const normalized = normalizeIconPath(iconPath);
      if (!dataPath || !normalized || typeof readIcon !== 'function') return null;
      const cacheKey = `${dataPath}|${normalized}`.toLowerCase();
      if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);
      const dataUrl = await readIcon(dataPath, normalized);
      if (dataUrl) iconCache.set(cacheKey, dataUrl);
      return dataUrl || null;
    } catch (_) {
      return null;
    }
  });
}

module.exports = { normalizeIconPath, registerIconIpc };
