function srgb(v) { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }
function lab(r, g, b) {
  let x = (srgb(r) * .4124 + srgb(g) * .3576 + srgb(b) * .1805) / .95047;
  let y = (srgb(r) * .2126 + srgb(g) * .7152 + srgb(b) * .0722);
  let z = (srgb(r) * .0193 + srgb(g) * .1192 + srgb(b) * .9505) / 1.08883;
  const f = value => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  x = f(x); y = f(y); z = f(z); return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export class PixelFeatureExtractor {
  extract(rgba, width, height) {
    const result = new Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), luminance = (.2126 * r + .7152 * g + .0722 * b) / 255;
      const right = x + 1 < width ? (y * width + x + 1) * 4 : i, down = y + 1 < height ? ((y + 1) * width + x) * 4 : i;
      const edge = (Math.abs(rgba[i + 3] - rgba[right + 3]) + Math.abs(rgba[i + 3] - rgba[down + 3])) / 510;
      result[y * width + x] = { lab: lab(r, g, b), luminance, saturation: max ? (max - min) / max : 0, alpha: rgba[i + 3] / 255, edge, x: x / width, y: y / height };
    }
    return result;
  }
}
