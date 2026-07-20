import { PixelFeatureExtractor } from './PixelFeatureExtractor.js';
import { MaskRefinementService } from './MaskRefinementService.js';

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function regionBounds(region) {
  if (region.rect) return region.rect;
  const xs = region.polygon.map(([x]) => x), ys = region.polygon.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

export class SemanticMaskResolver {
  constructor(features = new PixelFeatureExtractor(), refinement = new MaskRefinementService()) { this.features = features; this.refinement = refinement; }
  resolve({ template, rgba, width, height }) {
    const pixels = this.features.extract(rgba, width, height), masks = {};
    const protectedMask = new Uint8Array(width * height);
    for (const region of template?.regions || []) {
      // A newly created editor polygon has no area until its third vertex is placed.
      if (region.polygon && region.polygon.length < 3) continue;
      const [rx, ry, rw, rh] = regionBounds(region); const x0=Math.floor(rx*width), y0=Math.floor(ry*height), x1=Math.ceil((rx+rw)*width), y1=Math.ceil((ry+rh)*height);
      const protectedRegion = region.role?.startsWith('protected');
      const target = protectedRegion ? protectedMask : (masks[region.semantic] ||= new Uint8Array(width * height));
      for (let y=y0; y<y1; y++) for (let x=x0; x<x1; x++) { if (region.polygon && !pointInPolygon((x + .5) / width, (y + .5) / height, region.polygon)) continue; const i=y*width+x, feature=pixels[i]; if (feature.alpha < .05) protectedMask[i]=255; else if (!protectedRegion || region.role === 'protected-detail') target[i]=255; }
    }
    for (const key of Object.keys(masks)) masks[key] = this.refinement.protect(masks[key], protectedMask);
    return { templateId: template?.id || null, templateVersion: template?.version || null, masks, protectedMask };
  }
}
