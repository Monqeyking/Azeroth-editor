const RACE_ALIASES = {
  human: 'human', orc: 'orc', dwarf: 'dwarf', nightelf: 'night-elf', undead: 'undead',
  tauren: 'tauren', gnome: 'gnome', troll: 'troll', bloodelf: 'blood-elf',
  draenei: 'draenei', worgen: 'worgen', goblin: 'goblin', felorc: 'fel-orc',
};

const GENDER_ALIASES = { male: 'male', female: 'female' };
const TOKEN_RULES = [
  ['face-lower', /face[ _-]?lower/], ['face-upper', /face[ _-]?upper/],
  ['arm-upper', /arm[ _-]?upper/], ['arm-lower', /arm[ _-]?lower/],
  ['torso-upper', /torso[ _-]?upper/], ['torso-lower', /torso[ _-]?lower/],
  ['leg-upper', /leg[ _-]?upper/], ['leg-lower', /leg[ _-]?lower/],
  ['pelvis', /pelvis/], ['scalp', /scalp/], ['skin', /skin/], ['hair', /hair/],
  ['teeth', /teeth/], ['hands', /hands?/], ['feet', /feet/],
];

function normalizedPath(value = '') {
  return String(value).replace(/\//g, '\\').replace(/\\+/g, '\\').trim().toLowerCase();
}

function words(value) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[^a-z0-9]+/gi, ' ').toLowerCase().split(/\s+/).filter(Boolean);
}

export function parseTextureName(texturePath) {
  const path = normalizedPath(texturePath);
  const file = path.split('\\').pop() || '';
  const stem = file.replace(/\.blp$/i, '');
  const allWords = words(`${path} ${stem}`);
  const joined = allWords.join('');
  const segments = path.split('\\').filter(Boolean);
  const race = Object.entries(RACE_ALIASES).find(([alias]) => joined.includes(alias.replace(/\s/g, '')))?.[1] || null;
  const gender = Object.entries(GENDER_ALIASES).find(([alias]) => allWords.includes(alias))?.[1] || null;
  const regions = TOKEN_RULES.filter(([, rule]) => rule.test(stem)).map(([region]) => region);
  const variationNumbers = (stem.match(/\d{1,3}/g) || []).map(Number);
  const isCharacterPath = segments.includes('character') || !!race;
  const textureType = regions.includes('skin') ? 'skin-atlas'
    : regions.some(region => ['face-upper', 'face-lower'].includes(region)) ? 'face-component'
    : regions.includes('hair') || regions.includes('scalp') ? 'hair-component'
    : regions.length ? 'body-component' : 'unknown';

  return {
    sourcePath: texturePath || '', normalizedPath: path, fileName: file, stem,
    isCharacterPath, race, gender, textureType, component: regions.find(region => region.startsWith('face-')) || null, regions, variationNumbers,
    evidence: { path: isCharacterPath ? 1 : 0, race: race ? 1 : 0, gender: gender ? 1 : 0, region: regions.length ? 1 : 0 },
  };
}
