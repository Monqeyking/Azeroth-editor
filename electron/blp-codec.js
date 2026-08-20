'use strict';

// BLP2 decoder (DXT1 / DXT3 / DXT5 / paletted)
function rgb565(c) {
  return [(c >> 11 & 31) * 255 / 31 | 0, (c >> 5 & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
}

function dxt1Colors(src, bi) {
  const c0v = src.readUInt16LE(bi);
  const c1v = src.readUInt16LE(bi + 2);
  const c0  = rgb565(c0v);
  const c1  = rgb565(c1v);
  if (c0v > c1v) {
    return [c0, c1,
      [((c0[0]*2+c1[0])/3)|0, ((c0[1]*2+c1[1])/3)|0, ((c0[2]*2+c1[2])/3)|0],
      [((c0[0]+c1[0]*2)/3)|0, ((c0[1]+c1[1]*2)/3)|0, ((c0[2]+c1[2]*2)/3)|0],
    ];
  }
  return [c0, c1, [((c0[0]+c1[0])/2)|0, ((c0[1]+c1[1])/2)|0, ((c0[2]+c1[2])/2)|0], [0,0,0]];
}

function writeDXTPixels(src, colorBase, lut, rgba, bx, by, w, h, alphas) {
  const colors = dxt1Colors(src, colorBase);
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const ix = bx * 4 + px; const iy = by * 4 + py;
      if (ix >= w || iy >= h) continue;
      const pidx = py * 4 + px;
      const [r,g,b] = colors[(lut >> (pidx * 2)) & 3];
      const off = (iy * w + ix) * 4;
      rgba[off] = r; rgba[off+1] = g; rgba[off+2] = b;
      rgba[off+3] = alphas ? alphas[pidx] : 255;
    }
  }
}

function decodeDXT1(src, rgba, w, h) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const bi = (by * bw + bx) * 8;
      const lut = src.readUInt32LE(bi + 4);
      const transparent = src.readUInt16LE(bi) <= src.readUInt16LE(bi + 2);
      const alphas = transparent
        ? Array.from({ length: 16 }, (_, i) => ((lut >>> (i * 2)) & 3) === 3 ? 0 : 255)
        : null;
      writeDXTPixels(src, bi, lut, rgba, bx, by, w, h, alphas);
    }
}

function decodeDXT3(src, rgba, w, h) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const bi = (by * bw + bx) * 16;
      const alphas = [];
      for (let i = 0; i < 8; i++) {
        const b = src[bi + i];
        alphas.push((b & 0xF) * 17, ((b >> 4) & 0xF) * 17);
      }
      writeDXTPixels(src, bi + 8, src.readUInt32LE(bi + 12), rgba, bx, by, w, h, alphas);
    }
}

function decodeDXT5(src, rgba, w, h) {
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const bi = (by * bw + bx) * 16;
      const a0 = src[bi], a1 = src[bi + 1];
      const at = a0 > a1
        ? [a0, a1,
            ((6*a0+1*a1)/7+.5)|0, ((5*a0+2*a1)/7+.5)|0,
            ((4*a0+3*a1)/7+.5)|0, ((3*a0+4*a1)/7+.5)|0,
            ((2*a0+5*a1)/7+.5)|0, ((1*a0+6*a1)/7+.5)|0]
        : [a0, a1,
            ((4*a0+1*a1)/5+.5)|0, ((3*a0+2*a1)/5+.5)|0,
            ((2*a0+3*a1)/5+.5)|0, ((1*a0+4*a1)/5+.5)|0,
            0, 255];
      let aibig = BigInt(0);
      for (let b = 0; b < 6; b++) aibig |= BigInt(src[bi + 2 + b]) << BigInt(b * 8);
      const alphas = [];
      for (let i = 0; i < 16; i++) { alphas.push(at[Number(aibig & 7n)]); aibig >>= 3n; }
      writeDXTPixels(src, bi + 8, src.readUInt32LE(bi + 12), rgba, bx, by, w, h, alphas);
    }
}

function decodeBLP1(buffer) {
 // BLP1 header layout:
 // 0x00 magic "BLP1", 0x04 compression (1=palette,0=JPEG), 0x08 alphaBits,
 // 0x0C width, 0x10 height, 0x14 pictureType, 0x18 pictureSubType,
 // 0x1C mipOffsets[16], 0x5C mipSizes[16], 0x9C
  const compression = buffer.readUInt32LE(4);
  const alphaBits   = buffer.readUInt32LE(8);
  const w           = buffer.readUInt32LE(12);
  const h           = buffer.readUInt32LE(16);
  const mipOffset   = buffer.readUInt32LE(0x1C);
  const mipSize     = buffer.readUInt32LE(0x5C);

  if (compression !== 1) {
 // JPEG: jpegHeaderSize @ 0x9C, jpegHeader @ 0xA0, mipData @ mipOffset
    const { nativeImage } = require('electron');
    const jpegHeaderSize = buffer.readUInt32LE(0x9C);
    const jpegHeader = buffer.slice(0xA0, 0xA0 + jpegHeaderSize);
    const mipData    = buffer.slice(mipOffset, mipOffset + mipSize);
    const jpeg       = Buffer.concat([jpegHeader, mipData]);
    const img        = nativeImage.createFromBuffer(jpeg);
    if (img.isEmpty()) throw new Error('BLP1 JPEG: nativeImage leeg');
    const size   = img.getSize();
    const bitmap = img.getBitmap(); // BGRA, 32-bit
    const rgba   = Buffer.alloc(size.width * size.height * 4, 255);
    for (let i = 0; i < size.width * size.height; i++) {
      rgba[i*4]   = bitmap[i*4 + 2]; // R (BGRAÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢RGBA)
      rgba[i*4+1] = bitmap[i*4 + 1]; // G
      rgba[i*4+2] = bitmap[i*4];     // B
      rgba[i*4+3] = 255;
    }
    return { rgba, w: size.width, h: size.height };
  }

  const rgba = Buffer.alloc(w * h * 4, 255);
  const pixels = Math.min(w * h, mipSize);
  for (let i = 0; i < pixels; i++) {
    const idx = buffer[mipOffset + i];
    const p   = 0x9C + idx * 4; // palette: BGRA
    rgba[i*4]   = buffer[p + 2]; // R
    rgba[i*4+1] = buffer[p + 1]; // G
    rgba[i*4+2] = buffer[p];     // B
    if (alphaBits === 8) {
      rgba[i*4+3] = buffer[mipOffset + mipSize + i] ?? 255;
    } else if (alphaBits === 1) {
      rgba[i*4+3] = ((buffer[mipOffset + mipSize + (i >> 3)] >> (i & 7)) & 1) ? 255 : 0;
    } else if (alphaBits === 4) {
      const byte = buffer[mipOffset + mipSize + (i >> 1)];
      rgba[i*4+3] = (i & 1) ? ((byte >> 4) * 17) : ((byte & 0xF) * 17);
    }
 // alphaBits === 0: alpha al 255 door Buffer.alloc(..., 255)
  }
  return { rgba, w, h };
}

function decodeBLP(buffer) {
  const magic = buffer.toString('ascii', 0, 4);
  if (magic === 'BLP1') return decodeBLP1(buffer);
  if (magic !== 'BLP2') throw new Error(`Onbekend BLP magic: ${magic}`);

  const encoding      = buffer.readUInt8(8);
  const alphaDepth    = buffer.readUInt8(9);
  const alphaEncoding = buffer.readUInt8(10);
  const w             = buffer.readUInt32LE(12);
  const h             = buffer.readUInt32LE(16);
  const offset        = buffer.readUInt32LE(20);
  const size          = buffer.readUInt32LE(84);
  const src           = buffer.slice(offset, offset + size);
  const rgba          = Buffer.alloc(w * h * 4, 255);

  if (encoding === 2) {
    if (alphaEncoding === 7) decodeDXT5(src, rgba, w, h);
    else if (alphaEncoding === 1) decodeDXT3(src, rgba, w, h);
    else decodeDXT1(src, rgba, w, h);
  } else {
 // Paletted (encoding === 1): palette at offset 148 (256 uint32 BGRA)
    for (let i = 0; i < Math.min(w * h, src.length); i++) {
      const p = 148 + src[i] * 4;
      rgba[i*4]   = buffer[p+2];
      rgba[i*4+1] = buffer[p+1];
      rgba[i*4+2] = buffer[p];
      const alphaOffset = w * h;
      if (alphaDepth === 8) rgba[i*4+3] = src[alphaOffset + i] ?? 255;
      else if (alphaDepth === 4) {
        const byte = src[alphaOffset + (i >> 1)] ?? 0;
        rgba[i*4+3] = (i & 1) ? ((byte >> 4) * 17) : ((byte & 0xF) * 17);
      } else if (alphaDepth === 1) {
        rgba[i*4+3] = ((src[alphaOffset + (i >> 3)] ?? 0) >> (i & 7)) & 1 ? 255 : 0;
      } else rgba[i*4+3] = 255;
    }
  }
  return { rgba, w, h };
}

// BLP2 selective-block encoder (DXT1 / DXT3 / DXT5)
// Doel: een bewerkt gebied (masker) terugschrijven zonder de rest van de
// texture opnieuw te comprimeren. DXT1 werkt in onafhankelijke blokken,
// dus blokken die het masker niet overlappen worden 1-op-1 gekopieerd uit de
// bron-BLP geen kwaliteitsverlies buiten het bewerkte gebied.
function rgbToRgb565(r, g, b) {
  const r5 = Math.round(Math.max(0, Math.min(255, r)) * 31 / 255);
  const g6 = Math.round(Math.max(0, Math.min(255, g)) * 63 / 255);
  const b5 = Math.round(Math.max(0, Math.min(255, b)) * 31 / 255);
  return (r5 << 11) | (g6 << 5) | b5;
}

function compressDXTColorBlock(block, validMask, allowTransparency = false) {
  let minL = Infinity, maxL = -Infinity, minC = [0, 0, 0], maxC = [0, 0, 0];
  let hasTransparent = false;
  for (let i = 0; i < 16; i++) {
    if (!validMask[i]) continue;
    if (allowTransparency && block[i*4+3] < 128) { hasTransparent = true; continue; }
    const r = block[i*4], g = block[i*4+1], b = block[i*4+2];
    const l = r*0.299 + g*0.587 + b*0.114;
    if (l < minL) { minL = l; minC = [r, g, b]; }
    if (l > maxL) { maxL = l; maxC = [r, g, b]; }
  }
  if (minL === Infinity) minC = maxC = [0, 0, 0];
  let c0v = rgbToRgb565(maxC[0], maxC[1], maxC[2]);
  let c1v = rgbToRgb565(minC[0], minC[1], minC[2]);
  if (hasTransparent) {
    if (c0v > c1v) [c0v, c1v] = [c1v, c0v];
  } else {
    if (c0v < c1v) [c0v, c1v] = [c1v, c0v];
    if (c0v === c1v) {
      if (c0v < 0xffff) c0v++;
      else c1v--;
    }
  }
  const c0 = rgb565(c0v), c1 = rgb565(c1v);
  const palette = c0v > c1v ? [
    c0, c1,
    [((c0[0]*2+c1[0])/3)|0, ((c0[1]*2+c1[1])/3)|0, ((c0[2]*2+c1[2])/3)|0],
    [((c0[0]+c1[0]*2)/3)|0, ((c0[1]+c1[1]*2)/3)|0, ((c0[2]+c1[2]*2)/3)|0],
  ] : [
    c0, c1,
    [((c0[0]+c1[0])/2)|0, ((c0[1]+c1[1])/2)|0, ((c0[2]+c1[2])/2)|0],
    [0, 0, 0],
  ];
  let lut = 0;
  for (let i = 0; i < 16; i++) {
    if (hasTransparent && block[i*4+3] < 128) { lut |= 3 << (i * 2); continue; }
    const r = block[i*4], g = block[i*4+1], b = block[i*4+2];
    let best = 0, bestD = Infinity;
    for (let p = 0; p < 4; p++) {
      const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
      const d = dr*dr + dg*dg + db*db;
      if (d < bestD) { bestD = d; best = p; }
    }
    lut |= (best << (i * 2));
  }
  const out = Buffer.alloc(8);
  out.writeUInt16LE(c0v, 0);
  out.writeUInt16LE(c1v, 2);
  out.writeUInt32LE(lut >>> 0, 4);
  return out;
}

function compressDXT3Block(block, validMask) {
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    const alpha = validMask[i] ? Math.round(block[i*4+3] / 17) : 0;
    out[i >> 1] |= (alpha & 0xf) << ((i & 1) * 4);
  }
  compressDXTColorBlock(block, validMask).copy(out, 8);
  return out;
}

function compressDXT5Block(block, validMask) {
  const out = Buffer.alloc(16);
  let minA = 255, maxA = 0;
  for (let i = 0; i < 16; i++) if (validMask[i]) {
    minA = Math.min(minA, block[i*4+3]);
    maxA = Math.max(maxA, block[i*4+3]);
  }
  if (maxA === minA) {
    if (maxA < 255) maxA++;
    else minA--;
  }
  out[0] = maxA;
  out[1] = minA;
  const palette = [maxA, minA,
    Math.round((6*maxA+minA)/7), Math.round((5*maxA+2*minA)/7),
    Math.round((4*maxA+3*minA)/7), Math.round((3*maxA+4*minA)/7),
    Math.round((2*maxA+5*minA)/7), Math.round((maxA+6*minA)/7)];
  let bits = 0n;
  for (let i = 0; i < 16; i++) {
    const alpha = validMask[i] ? block[i*4+3] : 0;
    let best = 0, bestD = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const d = Math.abs(alpha - palette[p]);
      if (d < bestD) { bestD = d; best = p; }
    }
    bits |= BigInt(best) << BigInt(i * 3);
  }
  for (let i = 0; i < 6; i++) out[i+2] = Number((bits >> BigInt(i*8)) & 0xffn);
  compressDXTColorBlock(block, validMask).copy(out, 8);
  return out;
}

function downsampleRgba(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const rgba = Buffer.alloc(nw * nh * 4);
  const sxCount = w > 1 ? 2 : 1, syCount = h > 1 ? 2 : 1;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let dy = 0; dy < syCount; dy++) for (let dx = 0; dx < sxCount; dx++) {
        const sx = Math.min(w-1, x*2+dx), sy = Math.min(h-1, y*2+dy);
        sum += src[(sy*w+sx)*4+c];
      }
      rgba[(y*nw+x)*4+c] = Math.round(sum / (sxCount * syCount));
    }
  }
  return { rgba, w: nw, h: nh };
}

function downsampleMask(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const mask = new Uint8Array(nw * nh);
  const sxCount = w > 1 ? 2 : 1, syCount = h > 1 ? 2 : 1;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    for (let dy = 0; dy < syCount; dy++) for (let dx = 0; dx < sxCount; dx++) {
      const sx = Math.min(w-1, x*2+dx), sy = Math.min(h-1, y*2+dy);
      if (src[sy*w+sx]) mask[y*nw+x] = 1;
    }
  }
  return mask;
}

// A number of Blizzard character textures are BLP2 paletted images. Their
// palette cannot represent an arbitrary new fur/skin colour without changing
// unrelated pixels that share the same palette entry. For a non-destructive
// export, convert only the new output to standard BLP2 DXT5 instead. WotLK
// reads DXT5 natively and the source BLP/MPQ stays untouched.
function encodeBlp2Dxt5(rgba, width, height) {
  const mipChunks = [];
  let mipRgba = Buffer.from(rgba), w = width, h = height;
  for (let mip = 0; mip < 16; mip++) {
    const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
    const chunk = Buffer.alloc(bw * bh * 16);
    const block = new Uint8Array(16 * 4), validMask = new Array(16);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
        const ix = bx * 4 + px, iy = by * 4 + py, index = py * 4 + px;
        const sx = Math.min(ix, w - 1), sy = Math.min(iy, h - 1), source = (sy * w + sx) * 4;
        block[index * 4] = mipRgba[source]; block[index * 4 + 1] = mipRgba[source + 1];
        block[index * 4 + 2] = mipRgba[source + 2]; block[index * 4 + 3] = mipRgba[source + 3];
        validMask[index] = ix < w && iy < h;
      }
      compressDXT5Block(block, validMask).copy(chunk, (by * bw + bx) * 16);
    }
    mipChunks.push(chunk);
    if (w === 1 && h === 1) break;
    const next = downsampleRgba(mipRgba, w, h);
    mipRgba = next.rgba; w = next.w; h = next.h;
  }

  const header = Buffer.alloc(148);
  header.write('BLP2', 0, 'ascii');
  header.writeUInt32LE(1, 4);
  header.writeUInt8(2, 8); // DXT
  header.writeUInt8(8, 9); // alpha depth
  header.writeUInt8(7, 10); // DXT5 alpha encoding
  header.writeUInt8(1, 11); // mipmaps present
  header.writeUInt32LE(width, 12); header.writeUInt32LE(height, 16);
  let offset = header.length;
  mipChunks.forEach((chunk, mip) => {
    header.writeUInt32LE(offset, 20 + mip * 4);
    header.writeUInt32LE(chunk.length, 84 + mip * 4);
    offset += chunk.length;
  });
  return Buffer.concat([header, ...mipChunks]);
}

function buildAdaptiveBlpPalette(source) {
 // Quantise the source into a compact histogram first, then split the
 // occupied buckets by their actual colour range. Unlike a fixed 3-3-2 cube,
 // this spends palette entries on the many close fur shades in this texture.
  const bins = new Map();
  for (let i = 0; i < source.length; i += 4) {
    if (source[i + 3] === 0) continue;
    const key = (source[i] >> 3) | ((source[i + 1] >> 3) << 5) | ((source[i + 2] >> 3) << 10);
    let bin = bins.get(key);
    if (!bin) { bin = { r: 0, g: 0, b: 0, count: 0 }; bins.set(key, bin); }
    bin.r += source[i]; bin.g += source[i + 1]; bin.b += source[i + 2]; bin.count++;
  }
  const colours = [...bins.values()].map(bin => ({
    r: Math.round(bin.r / bin.count), g: Math.round(bin.g / bin.count), b: Math.round(bin.b / bin.count), count: bin.count,
  }));
  if (!colours.length) return [[0, 0, 0]];
  const boxes = [colours];
  while (boxes.length < 256) {
    let selected = -1, selectedScore = -1, selectedChannel = 0;
    for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
      const box = boxes[boxIndex];
      if (box.length < 2) continue;
      let minR = 255, minG = 255, minB = 255, maxR = 0, maxG = 0, maxB = 0, count = 0;
      for (const color of box) {
        minR = Math.min(minR, color.r); maxR = Math.max(maxR, color.r);
        minG = Math.min(minG, color.g); maxG = Math.max(maxG, color.g);
        minB = Math.min(minB, color.b); maxB = Math.max(maxB, color.b); count += color.count;
      }
      const ranges = [maxR - minR, maxG - minG, maxB - minB];
      const channel = ranges[1] > ranges[0] && ranges[1] >= ranges[2] ? 1 : ranges[2] > ranges[0] ? 2 : 0;
      const score = ranges[channel] * count;
      if (score > selectedScore) { selected = boxIndex; selectedScore = score; selectedChannel = channel; }
    }
    if (selected < 0) break;
    const box = boxes[selected].slice().sort((a, b) => [a.r, a.g, a.b][selectedChannel] - [b.r, b.g, b.b][selectedChannel]);
    const total = box.reduce((sum, color) => sum + color.count, 0);
    let accumulated = 0, split = 1;
    for (; split < box.length; split++) { accumulated += box[split - 1].count; if (accumulated >= total / 2) break; }
    boxes.splice(selected, 1, box.slice(0, split), box.slice(split));
  }
  return boxes.map(box => {
    let r = 0, g = 0, b = 0, count = 0;
    for (const color of box) { r += color.r * color.count; g += color.g * color.count; b += color.b * color.count; count += color.count; }
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
  });
}

function nearestPaletteIndex(palette, r, g, b, cache) {
  const key = (r << 16) | (g << 8) | b;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let bestIndex = 0, bestDistance = Infinity;
  for (let index = 0; index < palette.length; index++) {
    const color = palette[index], dr = r - color[0], dg = g - color[1], db = b - color[2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  }
  cache.set(key, bestIndex);
  return bestIndex;
}

// Character skin BLPs in this client are usually paletted BLP2 files. Keep
// their native layout, but derive a deterministic palette from the completed
// texture so skin and fur gradients retain their local shading after export.
function sourcePaletteFromBlp(originalBuf, width, height) {
  if (!originalBuf || originalBuf.length < 1172 || originalBuf.toString('ascii', 0, 4) !== 'BLP2' || originalBuf.readUInt8(8) !== 1
    || originalBuf.readUInt32LE(12) !== width || originalBuf.readUInt32LE(16) !== height) return null;
  const offset = originalBuf.readUInt32LE(20);
  const size = originalBuf.readUInt32LE(84);
  if (!offset || size < width * height || offset + width * height > originalBuf.length) return null;
  const palette = Array.from({ length: 256 }, (_, index) => [
    originalBuf[148 + index * 4 + 2],
    originalBuf[148 + index * 4 + 1],
    originalBuf[148 + index * 4],
  ]);
  return { palette, offset, size };
}

function paletteColourDistance(r, g, b, colour) {
  const dr = r - colour[0], dg = g - colour[1], db = b - colour[2];
  return dr * dr + dg * dg + db * db;
}

function buildSourceIndexedPalette(source, originalBuf, width, height) {
  const indexed = sourcePaletteFromBlp(originalBuf, width, height);
  if (!indexed) return null;
  const bins = Array.from({ length: 256 }, () => new Map());
  for (let i = 0; i < width * height; i++) {
    const sourceIndex = originalBuf[indexed.offset + i];
    const offset = i * 4;
    const key = (source[offset] >> 3) | ((source[offset + 1] >> 3) << 5) | ((source[offset + 2] >> 3) << 10);
    const bin = bins[sourceIndex].get(key) || [0, 0, 0, 0];
    bin[0] += source[offset]; bin[1] += source[offset + 1]; bin[2] += source[offset + 2]; bin[3]++;
    bins[sourceIndex].set(key, bin);
  }
  const palette = indexed.palette.map((colour, index) => {
    let selected = null;
    for (const bin of bins[index].values()) if (!selected || bin[3] > selected[3]) selected = bin;
    return selected
      ? [Math.round(selected[0] / selected[3]), Math.round(selected[1] / selected[3]), Math.round(selected[2] / selected[3])]
      : colour;
  });
  const paletteAlpha = Array.from({ length: 256 }, (_, index) => originalBuf[148 + index * 4 + 3]);
  const accentSamples = Buffer.alloc(width * height * 4);
  let accentCount = 0;
  for (let i = 0; i < width * height; i++) {
    const sourceIndex = originalBuf[indexed.offset + i], sourceOffset = i * 4;
    if (paletteColourDistance(source[sourceOffset], source[sourceOffset + 1], source[sourceOffset + 2], palette[sourceIndex]) <= 2500) continue;
    accentSamples[sourceOffset] = source[sourceOffset];
    accentSamples[sourceOffset + 1] = source[sourceOffset + 1];
    accentSamples[sourceOffset + 2] = source[sourceOffset + 2];
    accentSamples[sourceOffset + 3] = 255;
    accentCount++;
  }
  return { ...indexed, palette, paletteAlpha, accentSamples, accentCount };
}

function encodeBlp2Paletted(rgba, width, height, alphaDepth = 0, originalBuf = null) {
  const source = Buffer.from(rgba);
  const indexedPalette = buildSourceIndexedPalette(source, originalBuf, width, height);
  const colours = indexedPalette?.palette || buildAdaptiveBlpPalette(source);
  if (indexedPalette?.accentCount) {
    const used = new Set(originalBuf.subarray(indexedPalette.offset, indexedPalette.offset + width * height));
    const freeIndices = [];
    for (let index = 0; index < 256; index++) if (!used.has(index)) freeIndices.push(index);
    const accentColours = buildAdaptiveBlpPalette(indexedPalette.accentSamples);
    for (let index = 0; index < Math.min(freeIndices.length, accentColours.length); index++) colours[freeIndices[index]] = accentColours[index];
  }
  const palette = Buffer.alloc(1024);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = colours[Math.min(i, colours.length - 1)];
    palette[i * 4] = b;
    palette[i * 4 + 1] = g;
    palette[i * 4 + 2] = r;
    palette[i * 4 + 3] = indexedPalette?.paletteAlpha?.[i] ?? 255;
  }
  const mipChunks = [];
  let mipRgba = source, w = width, h = height;
  for (let mip = 0; mip < 16; mip++) {
    const pixels = w * h, indices = Buffer.alloc(pixels);
    const indexCache = new Map();
    const sourceMipOffset = indexedPalette && originalBuf.readUInt32LE(20 + mip * 4);
    const sourceMipSize = indexedPalette && originalBuf.readUInt32LE(84 + mip * 4);
    const sourceIndices = sourceMipOffset && sourceMipSize >= pixels
      ? originalBuf.subarray(sourceMipOffset, sourceMipOffset + pixels)
      : null;
    for (let i = 0; i < pixels; i++) {
      const off = i * 4;
      const baseIndex = sourceIndices?.[i];
      const baseColour = baseIndex == null ? null : colours[baseIndex];
      const baseDistance = baseColour == null ? Infinity : paletteColourDistance(mipRgba[off], mipRgba[off + 1], mipRgba[off + 2], baseColour);
      // Keep the original palette index whenever it still represents the
      // edited pixel. This preserves Blizzard's fur/detail index layout;
      // only painted accents that no longer fit are remapped by colour.
      indices[i] = baseDistance <= 2500
        ? baseIndex
        : nearestPaletteIndex(colours, mipRgba[off], mipRgba[off + 1], mipRgba[off + 2], indexCache);
    }
    let alpha = Buffer.alloc(0);
    if (alphaDepth === 8) { alpha = Buffer.alloc(pixels); for (let i = 0; i < pixels; i++) alpha[i] = mipRgba[i * 4 + 3]; }
    else if (alphaDepth === 4) { alpha = Buffer.alloc(Math.ceil(pixels / 2)); for (let i = 0; i < pixels; i++) alpha[i >> 1] |= (Math.round(mipRgba[i * 4 + 3] / 17) & 15) << ((i & 1) * 4); }
    else if (alphaDepth === 1) { alpha = Buffer.alloc(Math.ceil(pixels / 8)); for (let i = 0; i < pixels; i++) if (mipRgba[i * 4 + 3] >= 128) alpha[i >> 3] |= 1 << (i & 7); }
    mipChunks.push(Buffer.concat([indices, alpha]));
    if (w === 1 && h === 1) break;
    const next = downsampleRgba(mipRgba, w, h); mipRgba = next.rgba; w = next.w; h = next.h;
  }
  const header = Buffer.alloc(1172);
  header.write('BLP2', 0, 'ascii'); header.writeUInt32LE(1, 4);
  header.writeUInt8(1, 8); header.writeUInt8(alphaDepth, 9); header.writeUInt8(8, 10); header.writeUInt8(1, 11);
  header.writeUInt32LE(width, 12); header.writeUInt32LE(height, 16);
  palette.copy(header, 148);
  let offset = header.length;
  mipChunks.forEach((chunk, mip) => { header.writeUInt32LE(offset, 20 + mip * 4); header.writeUInt32LE(chunk.length, 84 + mip * 4); offset += chunk.length; });
  return Buffer.concat([header, ...mipChunks]);
}

// editedRgba: volledige RGBA buffer (w*h*4) na recolor. maskBool: bool[w*h],
// true = pixel zit binnen het bewerkte masker. Alleen blokken die minstens 1
// gemaskeerde pixel bevatten worden herschreven.
function reencodeBlpDxtSelective(originalBuf, editedRgba, maskBool, w, h) {
  const encoding = originalBuf.readUInt8(8);
  const alphaEncoding = originalBuf.readUInt8(10);
  if (encoding === 1) return encodeBlp2Paletted(editedRgba, w, h, originalBuf.readUInt8(9), originalBuf);
  if (encoding !== 2 || ![0, 1, 7].includes(alphaEncoding)) {
    throw new Error(`Recolor ondersteunt deze BLP2 encoding nog niet (encoding ${encoding}, alpha ${alphaEncoding})`);
  }

  const out = Buffer.from(originalBuf);
  let mipRgba = Buffer.from(editedRgba);
  let mipMask = Uint8Array.from(maskBool, v => v ? 1 : 0);
  let mw = w, mh = h;
  const blockBytes = alphaEncoding === 0 ? 8 : 16;

  for (let mip = 0; mip < 16; mip++) {
    const offset = originalBuf.readUInt32LE(20 + mip * 4);
    const size = originalBuf.readUInt32LE(84 + mip * 4);
    if (!offset || !size) break;

    const mipData = Buffer.from(originalBuf.slice(offset, offset + size));
    const bw = Math.ceil(mw / 4), bh = Math.ceil(mh / 4);
    const block = new Uint8Array(16 * 4);
    const validMask = new Array(16);

    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let touched = false;
        for (let py = 0; py < 4 && !touched; py++) {
          for (let px = 0; px < 4; px++) {
            const ix = bx*4+px, iy = by*4+py;
            if (ix < mw && iy < mh && mipMask[iy*mw+ix]) { touched = true; break; }
          }
        }
        if (!touched) continue;

        for (let py = 0; py < 4; py++) {
          for (let px = 0; px < 4; px++) {
            const ix = Math.min(bx*4+px, mw-1), iy = Math.min(by*4+py, mh-1);
            const idx = py*4+px;
            const srcOff = (iy*mw+ix)*4;
            block[idx*4] = mipRgba[srcOff];
            block[idx*4+1] = mipRgba[srcOff+1];
            block[idx*4+2] = mipRgba[srcOff+2];
            block[idx*4+3] = mipRgba[srcOff+3];
            validMask[idx] = bx*4+px < mw && by*4+py < mh;
          }
        }

        const compressed = alphaEncoding === 7
          ? compressDXT5Block(block, validMask)
          : alphaEncoding === 1
            ? compressDXT3Block(block, validMask)
            : compressDXTColorBlock(block, validMask, originalBuf.readUInt8(9) > 0);
        compressed.copy(mipData, (by*bw+bx) * blockBytes);
      }
    }

    mipData.copy(out, offset);
    if (mw === 1 && mh === 1) break;
    const next = downsampleRgba(mipRgba, mw, mh);
    mipMask = downsampleMask(mipMask, mw, mh);
    mipRgba = next.rgba;
    mw = next.w;
    mh = next.h;
  }
  return out;
}

function getBlp2Format(buf) {
  if (!buf || buf.length < 20 || buf.toString('ascii', 0, 4) !== 'BLP2') return null;
  return {
    encoding: buf.readUInt8(8),
    alphaDepth: buf.readUInt8(9),
    alphaEncoding: buf.readUInt8(10),
    hasMips: buf.readUInt8(11),
    width: buf.readUInt32LE(12),
    height: buf.readUInt32LE(16),
  };
}

function canonicalWorgenTextureTemplatePath(texturePath) {
  const normalized = String(texturePath || '').replace(/\//g, '\\');
  if (!/^character\\worgen\\/i.test(normalized)) return null;
  const fileName = normalized.split('\\').pop() || '';
  if (!/^(?:worgen(?:male|female)(?:skin|facelower|faceupper)\d*|hair\d+)_\d+(?:_extra)?\.blp$/i.test(fileName)) return null;
  return normalized.replace(/_(\d+)(?=(?:_extra)?\.blp$)/i, match => '_'.padEnd(match.length, '0'));
}

function assertWorgenTextureTemplate(buf, texturePath, width, height) {
  const format = getBlp2Format(buf);
  if (!format) throw new Error(`Worgen BLP-template is ongeldig: ${texturePath}`);
  if (format.width !== width || format.height !== height) {
    throw new Error(`Worgen BLP-template heeft ${format.width}x${format.height}; verwacht ${width}x${height}: ${texturePath}`);
  }
  const expectedAlphaDepth = /(?:^|\\)hair\d+_\d+(?:_extra)?\.blp$/i.test(String(texturePath || '').replace(/\//g, '\\')) ? 8 : 0;
  if (format.encoding !== 1 || format.alphaDepth !== expectedAlphaDepth || format.alphaEncoding !== 8) {
    throw new Error(`Worgen BLP-template heeft verkeerd formaat (${format.encoding}/${format.alphaDepth}/${format.alphaEncoding}); verwacht paletted 1/${expectedAlphaDepth}/8: ${texturePath}`);
  }
  return format;
}
// PNG schrijven zonder externe library (DEFLATE via zlib)
const zlib = require('zlib');

function rgbaToPNG(rgba, w, h) {
  const png_sig = Buffer.from([137,80,78,71,13,10,26,10]);

  function chunk(type, data) {
    const buf = Buffer.alloc(12 + data.length);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4, 'ascii');
    data.copy(buf, 8);
    let crc = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) {
      crc ^= buf[i];
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    buf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
    return buf;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, RGBA

 // Bouw raw scanlines op (RGBA, filter byte 0)
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = y * (1 + w * 4) + 1 + x * 4;
      raw[d] = rgba[s]; raw[d+1] = rgba[s+1]; raw[d+2] = rgba[s+2]; raw[d+3] = rgba[s+3];
    }
  }

  const idat = zlib.deflateSync(raw, { level: 1 });
  return Buffer.concat([
    png_sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = {
  decodeBLP,
  reencodeBlpDxtSelective,
  getBlp2Format,
  canonicalWorgenTextureTemplatePath,
  assertWorgenTextureTemplate,
  rgbaToPNG,
};
