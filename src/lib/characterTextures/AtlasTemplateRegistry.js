import { DEFAULT_ATLAS_TEMPLATES } from './atlasTemplates.js';
import { LayoutFingerprintService } from './LayoutFingerprintService.js';

const specificity = (template, parsed) => ['race', 'gender', 'textureType', 'component'].reduce((score, key) => {
  const expected = template.match[key];
  if (!expected || expected === '*') return score;
  return score + (expected === parsed[key] ? 1 : -10);
}, 0);

export class AtlasTemplateRegistry {
  constructor(templates = DEFAULT_ATLAS_TEMPLATES, fingerprintService = new LayoutFingerprintService()) {
    this.templates = [...templates];
    this.fingerprintService = fingerprintService;
  }

  candidates(parsed, dimensions = null, fingerprint = null) {
    return this.templates.map(template => {
      const ratio = dimensions?.width && dimensions?.height ? dimensions.width / dimensions.height : null;
      const ratioScore = ratio == null ? 0 : Math.max(0, 1 - Math.abs(ratio - template.aspectRatio));
      const fingerprintScore = template.layoutFingerprint && fingerprint
        ? this.fingerprintService.similarity(fingerprint, template.layoutFingerprint) : null;
      return { template, score: specificity(template, parsed) + ratioScore + (fingerprintScore ?? 0), ratioScore, fingerprintScore };
    }).filter(candidate => candidate.score >= 0).sort((a, b) => b.score - a.score || a.template.id.localeCompare(b.template.id));
  }
}
