function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (!delta) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [((hue * 60) + 360) % 360, saturation, lightness];
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const hueDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

export function buildColourMap(source, edited, protectedMask = null) {
  const bins = new Map();
  for (let i = 0; i < source.width * source.height; i++) {
    const offset = i * 4;
    if (source.data[offset + 3] <= 12 || edited.data[offset + 3] <= 12 || protectedMask?.[i]) continue;
    const key = `${source.data[offset] >> 5}:${source.data[offset + 1] >> 5}:${source.data[offset + 2] >> 5}`;
    const row = bins.get(key) || { count: 0, source: [0, 0, 0], target: [0, 0, 0] };
    row.count++;
    for (let channel = 0; channel < 3; channel++) {
      row.source[channel] += source.data[offset + channel];
      row.target[channel] += edited.data[offset + channel];
    }
    bins.set(key, row);
  }
  return [...bins.values()].filter(row => row.count >= 8).map(row => ({
    source: row.source.map(value => value / row.count),
    target: row.target.map(value => value / row.count),
    count: row.count,
  }));
}

export function buildChangedProtection(original, edited, protectedMask = null, threshold = 12) {
  if (!original || !edited || original.width !== edited.width || original.height !== edited.height) return null;
  const out = new Uint8Array(original.width * original.height);
  for (let i = 0; i < out.length; i++) {
    if (!protectedMask?.[i]) continue;
    const offset = i * 4;
    const difference = Math.abs(original.data[offset] - edited.data[offset])
      + Math.abs(original.data[offset + 1] - edited.data[offset + 1])
      + Math.abs(original.data[offset + 2] - edited.data[offset + 2]);
    if (difference < threshold) out[i] = 255;
  }
  return out;
}

export function applyColourMap(image, colourMap, protectedMask = null, brightnessMatch = .38, paletteSmoothness = .7) {
  const out = new Uint8ClampedArray(image.data);
  const entries = colourMap.map(entry => ({
    ...entry,
    sourceHsl: rgbToHsl(entry.source[0], entry.source[1], entry.source[2]),
    targetHsl: rgbToHsl(entry.target[0], entry.target[1], entry.target[2]),
  }));
  const spread = .012 + Math.max(0, Math.min(1, paletteSmoothness)) * .105;
  for (let i = 0; i < image.width * image.height; i++) {
    const offset = i * 4;
    if (image.data[offset + 3] <= 12 || protectedMask?.[i]) continue;
    const sourceHsl = rgbToHsl(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
    const nearest = entries.map(entry => {
      const hue = hueDistance(sourceHsl[0], entry.sourceHsl[0]) / 180;
      const distance = hue * .45 + Math.abs(sourceHsl[1] - entry.sourceHsl[1]) * .35 + Math.abs(sourceHsl[2] - entry.sourceHsl[2]) * .8;
      return { entry, distance };
    }).sort((a, b) => a.distance - b.distance).slice(0, 4);
    if (!nearest.length) continue;
    let weightTotal = 0, hueX = 0, hueY = 0, targetSaturation = 0, targetLightness = 0, sourceLightness = 0;
    for (const { entry, distance } of nearest) {
      const weight = Math.exp(-(distance * distance) / (2 * spread * spread));
      weightTotal += weight;
      hueX += Math.cos(entry.targetHsl[0] * Math.PI / 180) * weight;
      hueY += Math.sin(entry.targetHsl[0] * Math.PI / 180) * weight;
      targetSaturation += entry.targetHsl[1] * weight;
      targetLightness += entry.targetHsl[2] * weight;
      sourceLightness += entry.sourceHsl[2] * weight;
    }
    if (!weightTotal) continue;
    const targetHue = (Math.atan2(hueY, hueX) * 180 / Math.PI + 360) % 360;
    targetSaturation /= weightTotal;
    targetLightness /= weightTotal;
    sourceLightness /= weightTotal;
    const lightnessDelta = (targetLightness - sourceLightness) * Math.max(0, Math.min(1, brightnessMatch));
    const [r, g, b] = hslToRgb(targetHue, targetSaturation, Math.max(.012, Math.min(.95, sourceHsl[2] + lightnessDelta)));
    out[offset] = r; out[offset + 1] = g; out[offset + 2] = b;
  }
  return new ImageData(out, image.width, image.height);
}

export function applyDiscretePalette(image, paletteColors, protectedMask = null, detailStrength = .68) {
  const palette = [...new Set((paletteColors || []).map(value => String(value || '').toLowerCase()).filter(value => /^#[0-9a-f]{6}$/.test(value)))]
    .map(hex => ({ hex, hsl: rgbToHsl(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)) }))
    .sort((a, b) => a.hsl[2] - b.hsl[2]);
  if (!palette.length) return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  const out = new Uint8ClampedArray(image.data);
  const strength = Math.max(0, Math.min(1, detailStrength));
  for (let i = 0; i < image.width * image.height; i++) {
    const offset = i * 4;
    if (image.data[offset + 3] <= 12 || protectedMask?.[i]) continue;
    const [, , sourceLightness] = rgbToHsl(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
    const slot = palette.length === 1
      ? 0
      : Math.max(0, Math.min(palette.length - 1, Math.round(((sourceLightness - .12) / .76) * (palette.length - 1))));
    const [, , targetLightness] = palette[slot].hsl;
    const outputLightness = Math.max(.015, Math.min(.95, targetLightness + (sourceLightness - .5) * strength));
    const [r, g, b] = hslToRgb(palette[slot].hsl[0], palette[slot].hsl[1], outputLightness);
    out[offset] = r;
    out[offset + 1] = g;
    out[offset + 2] = b;
  }
  return new ImageData(out, image.width, image.height);
}
