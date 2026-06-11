self.onmessage = ({ data }) => {
  const { tileKey, blpRgba, chunks, pixPerChunk = 32 } = data;
  const W = 16 * pixPerChunk;
  const canvas = new OffscreenCanvas(W, W);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(W, W);
  const d = imgData.data;

  for (const chunk of chunks) {
    if (!chunk || !chunk.layers.length) continue;
    const { ix, iy, layers } = chunk;

    let baseBlp = blpRgba[layers[0].textureIdx];
    let baseLayerIdx = 0;
    if (!baseBlp) {
      for (let li = 1; li < layers.length; li++) {
        if (blpRgba[layers[li].textureIdx]) {
          baseBlp = blpRgba[layers[li].textureIdx];
          baseLayerIdx = li;
          break;
        }
      }
    }
    if (!baseBlp) continue;

    for (let py = 0; py < pixPerChunk; py++) {
      for (let px = 0; px < pixPerChunk; px++) {
        const base = sampleBlp(baseBlp, ix, iy, px, py, pixPerChunk);
        let cr = base[0], cg = base[1], cb = base[2];
        for (let li = 1; li < layers.length; li++) {
          if (li === baseLayerIdx) continue;
          const blp = blpRgba[layers[li].textureIdx];
          const alphaMap = layers[li].alphaMap;
          if (!blp || !alphaMap) continue;
          const ax = Math.floor(px * 64 / pixPerChunk);
          const ay = Math.floor(py * 64 / pixPerChunk);
          const alpha = alphaMap[ay * 64 + ax] / 255;
          if (alpha < 0.004) continue;
          const lyr = sampleBlp(blp, ix, iy, px, py, pixPerChunk);
          cr = cr + (lyr[0] - cr) * alpha;
          cg = cg + (lyr[1] - cg) * alpha;
          cb = cb + (lyr[2] - cb) * alpha;
        }
        const di = ((iy * pixPerChunk + py) * W + (ix * pixPerChunk + px)) * 4;
        d[di] = cr; d[di+1] = cg; d[di+2] = cb; d[di+3] = 255;
      }
    }
  }

  // Stuur raw RGBA als transferable — geen PNG encode/decode nodig
  const rgba = imgData.data.buffer.slice(0);
  self.postMessage({ tileKey, rgba, w: W, h: W }, [rgba]);
};

function sampleBlp(blp, ix, iy, px, py, pixPerChunk) {
  const data = blp.data, w = blp.w, h = blp.h;
  const tileSize = 16 * pixPerChunk;
  const ux = ((ix * pixPerChunk + px) * 8 % tileSize) / tileSize;
  const uy = ((iy * pixPerChunk + py) * 8 % tileSize) / tileSize;
  const sx = Math.floor(ux * w) % w;
  const sy = Math.floor(uy * h) % h;
  const si = (sy * w + sx) * 4;
  return [data[si], data[si+1], data[si+2]];
}
