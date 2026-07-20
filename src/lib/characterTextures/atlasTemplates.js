export const ATLAS_TEMPLATE_SCHEMA_VERSION = 1;

const fullCharacterAtlas = [
  ['arm-upper', [0, 0, 0.5, 0.25]], ['arm-lower', [0, 0.25, 0.5, 0.25]],
  ['hands', [0, 0.5, 0.5, 0.125]], ['face-upper', [0, 0.625, 0.5, 0.125]],
  ['face-lower', [0, 0.75, 0.5, 0.25]], ['torso-upper', [0.5, 0, 0.5, 0.25]],
  ['torso-lower', [0.5, 0.25, 0.5, 0.125]], ['leg-upper', [0.5, 0.375, 0.5, 0.25]],
  ['leg-lower', [0.5, 0.625, 0.5, 0.25]], ['feet', [0.5, 0.875, 0.5, 0.125]],
].map(([semantic, rect]) => ({ semantic, rect, role: 'component', editorVisible: false }));

export const DEFAULT_ATLAS_TEMPLATES = [
  ...['male', 'female'].flatMap(gender => [
    {
      id: `wotlk-worgen-${gender}-face-lower-v1`, version: 1, schemaVersion: ATLAS_TEMPLATE_SCHEMA_VERSION,
      match: { race: 'worgen', gender, textureType: 'face-component', component: 'face-lower' }, aspectRatio: 2,
      regions: [{ semantic: 'face-surface', rect: [0, 0, 1, 1], role: 'refine', editorVisible: true }, { semantic: 'uv-padding', rect: [0, 0, 1, 1], role: 'protected-background' }],
    },
    {
      id: `wotlk-worgen-${gender}-face-upper-v1`, version: 1, schemaVersion: ATLAS_TEMPLATE_SCHEMA_VERSION,
      match: { race: 'worgen', gender, textureType: 'face-component', component: 'face-upper' }, aspectRatio: 4,
      regions: [{ semantic: 'face-surface', rect: [0, 0, 1, 1], role: 'refine', editorVisible: true }, { semantic: 'uv-padding', rect: [0, 0, 1, 1], role: 'protected-background' }],
    },
  ]),
  ...['male', 'female'].map(gender => ({
    id: `wotlk-worgen-${gender}-skin-atlas-v1`, version: 1, schemaVersion: ATLAS_TEMPLATE_SCHEMA_VERSION,
    match: { race: 'worgen', gender, textureType: 'skin-atlas' }, aspectRatio: 1,
    regions: [
      ...fullCharacterAtlas,
      { semantic: 'skin', rect: [0, 0, 1, 1], role: 'refine', editorVisible: true, label: 'Skin / vacht (hele atlas)' },
      { semantic: 'face-upper', rect: [0, .625, .5, .125], role: 'refine', editorVisible: true, label: 'Face upper' },
      { semantic: 'face-lower', rect: [0, .75, .5, .25], role: 'refine', editorVisible: true, label: 'Face lower' },
      { semantic: 'torso', rect: [.5, 0, .5, .375], role: 'refine', editorVisible: true, label: 'Torso / borst' },
      { semantic: 'lower-body', rect: [.5, .375, .5, .625], role: 'refine', editorVisible: true, label: 'Onderlichaam / poten (Skin-atlas)' },
      { semantic: 'nose-candidate', polygon: [[.04,.63],[.18,.63],[.23,.67],[.20,.72],[.06,.72],[.01,.68]], role: 'protected-detail' },
      { semantic: 'eyes-candidate', polygon: [[.22,.745],[.28,.74],[.30,.755],[.28,.785],[.23,.782],[.21,.765]], role: 'protected-detail' },
      { semantic: 'teeth-candidate', polygon: [[0,.835],[.13,.83],[.19,.86],[.21,.90],[.18,.96],[.14,.99],[0,.99]], role: 'protected-detail' },
      { semantic: 'underwear-guide', label: 'Underwear', color: '#1ebeff', polygon: [[.52,.39],[.98,.39],[.98,.55],[.91,.59],[.59,.59],[.52,.54]], role: 'protected-detail' },
      { semantic: 'uv-padding', rect: [0, 0, 1, 1], role: 'protected-background' },
    ],
  })),
  {
    id: 'wotlk-character-atlas-v1', version: 1, schemaVersion: ATLAS_TEMPLATE_SCHEMA_VERSION,
    match: { race: '*', gender: '*', textureType: 'skin-atlas' }, aspectRatio: 1,
    regions: [
      ...fullCharacterAtlas,
      { semantic: 'skin', rect: [0, 0, 1, 1], role: 'refine', editorVisible: true, label: 'Skin / vacht (hele atlas)' },
      { semantic: 'face-upper', rect: [0, .625, .5, .125], role: 'refine', editorVisible: true, label: 'Face upper' },
      { semantic: 'face-lower', rect: [0, .75, .5, .25], role: 'refine', editorVisible: true, label: 'Face lower' },
      { semantic: 'torso', rect: [.5, 0, .5, .375], role: 'refine', editorVisible: true, label: 'Torso / borst' },
      { semantic: 'lower-body', rect: [.5, .375, .5, .625], role: 'refine', editorVisible: true, label: 'Onderlichaam / poten (Skin-atlas)' },
      { semantic: 'uv-padding', rect: [0, 0, 1, 1], role: 'protected-background' },
    ],
  },
  {
    id: 'wotlk-character-face-component-v1', version: 1, schemaVersion: ATLAS_TEMPLATE_SCHEMA_VERSION,
    match: { race: '*', gender: '*', textureType: 'face-component' }, aspectRatio: 1,
    regions: [{ semantic: 'face', rect: [0, 0, 1, 1], role: 'refine', editorVisible: true }, { semantic: 'uv-padding', rect: [0, 0, 1, 1], role: 'protected-background' }],
  },
  {
    id: 'wotlk-character-hair-component-v1', version: 1, schemaVersion: ATLAS_TEMPLATE_SCHEMA_VERSION,
    match: { race: '*', gender: '*', textureType: 'hair-component' }, aspectRatio: 1,
    regions: [{ semantic: 'hair', rect: [0, 0, 1, 1], role: 'refine', editorVisible: true }, { semantic: 'uv-padding', rect: [0, 0, 1, 1], role: 'protected-background' }],
  },
];
