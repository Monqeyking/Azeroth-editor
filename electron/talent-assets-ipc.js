const TILES = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'];
const backgroundCache = new Map();

function talentBackgroundPath(backgroundFile, tile) {
  return `Interface\\TalentFrame\\${backgroundFile}-${tile}.blp`;
}

function registerTalentAssetIpc(ipcMain, readTexture) {
  ipcMain.handle('talents:getBackground', async (_, dataPath, backgroundFile) => {
    try {
      const name = String(backgroundFile || '').trim();
      if (!dataPath || !name || typeof readTexture !== 'function') return null;
      const cacheKey = `${dataPath}|${name}`.toLowerCase();
      if (backgroundCache.has(cacheKey)) return backgroundCache.get(cacheKey);

      const textures = await Promise.all(
        TILES.map(tile => readTexture(dataPath, talentBackgroundPath(name, tile))),
      );
      if (textures.some(texture => !texture)) return null;

      const result = Object.fromEntries(TILES.map((tile, index) => [tile, textures[index]]));
      backgroundCache.set(cacheKey, result);
      return result;
    } catch (_) {
      return null;
    }
  });
}

module.exports = { registerTalentAssetIpc, talentBackgroundPath };
