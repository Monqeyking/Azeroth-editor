const TILE_SIZE = 533.33333;
const MAP_HALF = 32 * TILE_SIZE;
const UNIT_SIZE = TILE_SIZE / 128;

let terrainByKey = new Map();

export function setTerrainData(tiles) {
  terrainByKey = new Map((tiles ?? []).map(tile => [`${tile.tileX}_${tile.tileY}`, tile]));
}

export function getTerrainHeight(worldX, worldY) {
  const tileX = Math.floor((MAP_HALF - worldX) / TILE_SIZE);
  const tileY = Math.floor((MAP_HALF - worldY) / TILE_SIZE);
  const tile = terrainByKey.get(`${tileX}_${tileY}`);
  if (!tile?.v9) return null;

  const gridX = Math.max(0, Math.min(128, ((32 - tileY) * TILE_SIZE - worldY) / UNIT_SIZE));
  const gridY = Math.max(0, Math.min(128, ((32 - tileX) * TILE_SIZE - worldX) / UNIT_SIZE));
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const x1 = Math.min(128, x0 + 1);
  const y1 = Math.min(128, y0 + 1);
  const cellX = Math.min(127, Math.max(0, x0));
  const cellY = Math.min(127, Math.max(0, y0));
  const holeMask = tile.holes?.[(cellY >> 3) * 16 + (cellX >> 3)] ?? 0;
  const holeBit = (((cellY & 7) >> 1) * 4) + ((cellX & 7) >> 1);
  if (holeMask & (1 << holeBit)) return null;

  const tx = gridX - x0;
  const ty = gridY - y0;
  const h00 = tile.v9[y0 * 129 + x0];
  const h10 = tile.v9[y0 * 129 + x1];
  const h01 = tile.v9[y1 * 129 + x0];
  const h11 = tile.v9[y1 * 129 + x1];
  return (h00 + (h10 - h00) * tx) * (1 - ty) + (h01 + (h11 - h01) * tx) * ty;
}
