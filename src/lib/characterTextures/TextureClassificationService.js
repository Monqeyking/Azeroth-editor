import { parseTextureName } from './TextureNameParser.js';
import { LayoutFingerprintService } from './LayoutFingerprintService.js';

export class TextureClassificationService {
  constructor(registry, fingerprintService = new LayoutFingerprintService()) { this.registry = registry; this.fingerprintService = fingerprintService; }

  classify({ path, width = 0, height = 0, rgba = null, textureType = null }) {
    const parsed = parseTextureName(path);
    if (textureType) parsed.textureType = textureType;
    const fingerprint = rgba ? this.fingerprintService.create(rgba, width, height) : null;
    const candidates = this.registry.candidates(parsed, { width, height }, fingerprint);
    const best = candidates[0] || null;
    const factors = {
      filename: Math.min(1, (parsed.evidence.race + parsed.evidence.gender + parsed.evidence.region) / 3),
      dimensions: width > 0 && height > 0 ? 1 : 0,
      template: best ? Math.min(1, best.ratioScore + (best.template.match.textureType === parsed.textureType ? .7 : 0)) : 0,
      fingerprint: best?.fingerprintScore,
    };
    const known = [factors.filename, factors.dimensions, factors.template];
    const confidence = known.reduce((sum, value) => sum + value, 0) / known.length;
    return { parsed, dimensions: { width, height }, fingerprint, template: best?.template || null, candidates, confidence: { total: Number(confidence.toFixed(3)), factors }, status: confidence >= .85 ? 'ready' : confidence >= .60 ? 'review' : 'manual' };
  }
}
