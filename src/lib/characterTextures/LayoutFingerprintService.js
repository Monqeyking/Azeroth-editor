const GRID = 16;

function quantize(value) { return Math.max(0, Math.min(15, Math.round(value * 15))); }

export class LayoutFingerprintService {
  create(rgba, width, height) {
    if (!(rgba instanceof Uint8Array) || rgba.length !== width * height * 4 || !width || !height) return null;
    const alphaGrid = [], edgeGrid = [], rowEdges = Array(GRID).fill(0), colEdges = Array(GRID).fill(0);
    for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
      const x0 = Math.floor(gx * width / GRID), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * width / GRID));
      const y0 = Math.floor(gy * height / GRID), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * height / GRID));
      let alpha = 0, edges = 0, count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4, a = rgba[i + 3] / 255;
        alpha += a; count++;
        if (x + 1 < width) edges += Math.abs(rgba[i + 3] - rgba[i + 7]) / 255;
        if (y + 1 < height) edges += Math.abs(rgba[i + 3] - rgba[i + width * 4 + 3]) / 255;
      }
      const edge = edges / Math.max(1, count * 2);
      alphaGrid.push(quantize(alpha / count)); edgeGrid.push(quantize(edge));
      rowEdges[gy] += edge; colEdges[gx] += edge;
    }
    const normalize = values => values.map(value => quantize(value / Math.max(...values, 1)));
    return { version: 1, grid: GRID, width, height, aspect: quantize(width / Math.max(width, height)), alphaGrid, edgeGrid, rowEdges: normalize(rowEdges), colEdges: normalize(colEdges) };
  }

  similarity(a, b) {
    if (!a || !b || a.version !== b.version || a.grid !== b.grid) return 0;
    const compare = (left, right) => left.reduce((sum, value, index) => sum + 1 - Math.abs(value - right[index]) / 15, 0) / left.length;
    return Number(((compare(a.alphaGrid, b.alphaGrid) * .65) + (compare(a.edgeGrid, b.edgeGrid) * .25) + (compare(a.rowEdges, b.rowEdges) * .05) + (compare(a.colEdges, b.colEdges) * .05)).toFixed(4));
  }
}
