const KEY = 'azeroth-editor:atlas-component-mappings:v1';

export class AtlasComponentMappingStore {
  list(layoutId) {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}')[layoutId] || {}; } catch { return {}; }
  }
  save(layoutId, mappings) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* empty */ }
    localStorage.setItem(KEY, JSON.stringify({ ...all, [layoutId]: mappings }));
  }
}

// WotLK's standard character atlas grid. Coordinates are normalized so the same
// mapping works at any compatible resolution (for example 256² and 512² atlases).
export const DEFAULT_COMPONENT_RECTANGLES = {
  'face-upper': { x: 0, y: .625, width: .5, height: .125 },
  'face-lower': { x: 0, y: .75, width: .5, height: .25 },
  'torso-upper': { x: .5, y: 0, width: .5, height: .25 },
  'torso-lower': { x: .5, y: .25, width: .5, height: .125 },
  'underwear-pelvis': { x: .5, y: .375, width: .5, height: .25 },
  'underwear-torso': { x: .5, y: 0, width: .5, height: .375 },
};
