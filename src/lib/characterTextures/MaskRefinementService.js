export class MaskRefinementService {
  expand(mask, width, height, pixels = 1) {
    let out = Uint8Array.from(mask);
    for (let step = 0; step < pixels; step++) { const next = Uint8Array.from(out); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (out[y * width + x]) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < width && ny < height) next[ny * width + nx] = 255; } out = next; }
    return out;
  }
  contract(mask, width, height, pixels = 1) { const inverted = Uint8Array.from(mask, value => value ? 0 : 255); return Uint8Array.from(this.expand(inverted, width, height, pixels), value => value ? 0 : 255); }
  feather(mask, width, height, radius = 1) { let out = Uint8Array.from(mask); for (let step = 0; step < radius; step++) { const next = new Uint8Array(mask.length); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let total = 0, count = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx=x+dx, ny=y+dy; if (nx>=0&&ny>=0&&nx<width&&ny<height) { total += out[ny*width+nx]; count++; } } next[y*width+x] = Math.round(total/count); } out = next; } return out; }
  protect(mask, protectedMask) { return Uint8Array.from(mask, (value, i) => protectedMask?.[i] ? 0 : value); }
}
