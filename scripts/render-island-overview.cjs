const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function color565(c) {
  return [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
}

function decodeDxt1(src, width, height) {
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let by = 0, off = 0; by < height; by += 4) for (let bx = 0; bx < width; bx += 4, off += 8) {
    const c0 = src.readUInt16LE(off), c1 = src.readUInt16LE(off + 2);
    const a = color565(c0), b = color565(c1);
    const colors = [a, b, a.map((v, i) => (2 * v + b[i]) / 3), a.map((v, i) => (v + 2 * b[i]) / 3)];
    const indices = src.readUInt32LE(off + 4);
    for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
      const x = bx + px, y = by + py;
      if (x >= width || y >= height) continue;
      const c = colors[(indices >>> (2 * (py * 4 + px))) & 3];
      const p = (y * width + x) * 4;
      rgba[p] = c[0]; rgba[p + 1] = c[1]; rgba[p + 2] = c[2];
    }
  }
  return rgba;
}

function readBlp(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'BLP2' || b[8] !== 2) throw new Error(`Unsupported BLP: ${file}`);
  const width = b.readUInt32LE(12), height = b.readUInt32LE(16);
  return { width, height, rgba: decodeDxt1(b.subarray(b.readUInt32LE(20), b.readUInt32LE(20) + b.readUInt32LE(84)), width, height) };
}

async function main() {
  const root = path.resolve(process.argv[2] || 'island-project-source');
  const dir = path.join(root, 'textures', 'minimap');
  const tiles = fs.readdirSync(dir).flatMap(name => {
    const match = /^expisland_(\d+)_(\d+)\.blp$/i.exec(name);
    return match ? [{ x: +match[1], y: +match[2], image: readBlp(path.join(dir, name)) }] : [];
  });
  const xs = [...new Set(tiles.map(t => t.x))].sort((a,b) => a-b);
  const ys = [...new Set(tiles.map(t => t.y))].sort((a,b) => a-b);
  const w = tiles[0].image.width, h = tiles[0].image.height;
  const canvas = Buffer.alloc(xs.length * w * ys.length * h * 4, 0);
  for (const tile of tiles) {
    const ox = xs.indexOf(tile.x) * w, oy = ys.indexOf(tile.y) * h;
    for (let row = 0; row < h; row++) tile.image.rgba.copy(canvas, ((oy + row) * xs.length * w + ox) * 4, row * w * 4, (row + 1) * w * 4);
  }
  const out = path.resolve('output', 'previews', 'island-project-overview.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(canvas, { raw: { width: xs.length * w, height: ys.length * h, channels: 4 } }).png().toFile(out);
  console.log(`${out} (${xs.length}x${ys.length} tiles, ${xs.length*w}x${ys.length*h})`);
}
main().catch(error => { console.error(error); process.exit(1); });
