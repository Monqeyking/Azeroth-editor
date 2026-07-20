function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)); let h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hslToRgb(h, s, l) { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2; const [r,g,b] = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x]; return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)]; }
export function hexToHsl(hex) { const value = parseInt(hex.slice(1), 16); return rgbToHsl((value >> 16) & 255, (value >> 8) & 255, value & 255); }
export class TextureRecolorEngine {
  recolor(rgba, mask, targetHex, strength = 1) {
    const out = new Uint8ClampedArray(rgba), [h, s, targetLightness] = hexToHsl(targetHex);
    for (let i = 0; i < mask.length; i++) { const amount = (mask[i] / 255) * strength; if (!amount) continue; const o=i*4; if (targetLightness <= .02) { const black = 8; out[o] += (black - out[o]) * amount; out[o+1] += (black - out[o+1]) * amount; out[o+2] += (black - out[o+2]) * amount; continue; } const [, , lightness] = rgbToHsl(out[o],out[o+1],out[o+2]), [r,g,b] = hslToRgb(h,s,lightness); out[o]+= (r-out[o])*amount; out[o+1]+=(g-out[o+1])*amount; out[o+2]+=(b-out[o+2])*amount; }
    return out;
  }
}
