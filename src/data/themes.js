// Per-level palette.
//
// One art direction, four moods. The rules are the same everywhere and they
// exist to keep the fight readable rather than to look impressive:
//
//   * The environment is desaturated and mid-value. Floors never go black and
//     never go bright — they are the quiet layer everything else sits on.
//   * Nothing in the environment is emissive. Walls are lit, not glowing.
//   * Warm saturated colour is reserved for enemies and their telegraphs.
//   * Cool mint is reserved for the player.
//
// If a new theme needs a hot orange wall to look good, the theme is wrong.

export const THEMES = {
  dusk: {
    id: 'dusk', name: 'THE YARDS',
    bg: 0x2b3641, skyTop: 0x1d2630, skyBottom: 0x4b5a63,
    fog: 0x46545e, fogNear: 42, fogFar: 132,
    floor: 0x55646d, floorAlt: 0x5c6c75, floorLine: 0x3b474e,
    wall: 0x818891, wallTop: 0xa9aea6, wallShadow: 0x4a4d52,
    hemiSky: 0x9fb4c4, hemiGround: 0x3a3630, hemiInt: 0.85,
    keyColor: 0xfff0d8, keyInt: 1.5,
    fillColor: 0x7d9ec4, fillInt: 0.5,
    accent: '#d8a05a', accent2: '#5fb3a1',
    wallShape: 'bevel',
    dust: 0xc9c2ae, dustRate: 0.35,
  },

  kiln: {
    id: 'kiln', name: 'THE KILN',
    bg: 0x3a2e28, skyTop: 0x2a201c, skyBottom: 0x5d4536,
    fog: 0x55412f, fogNear: 40, fogFar: 124,
    floor: 0x6b5446, floorAlt: 0x72594a, floorLine: 0x4a382e,
    wall: 0x937d69, wallTop: 0xbda081, wallShadow: 0x584739,
    hemiSky: 0xd6b08a, hemiGround: 0x3a2a20, hemiInt: 0.8,
    keyColor: 0xffe2b8, keyInt: 1.6,
    fillColor: 0xc48a5a, fillInt: 0.45,
    accent: '#d98f4a', accent2: '#8ab5a0',
    wallShape: 'stack',
    dust: 0xe0c49a, dustRate: 0.6,
  },

  frost: {
    id: 'frost', name: 'COLD STORAGE',
    bg: 0x3d4a52, skyTop: 0x2c383f, skyBottom: 0x66787f,
    fog: 0x5c6a72, fogNear: 44, fogFar: 140,
    floor: 0x6a777d, floorAlt: 0x707d82, floorLine: 0x4d585e,
    wall: 0x949d9f, wallTop: 0xc3c9c5, wallShadow: 0x5a6268,
    hemiSky: 0xcfe0e6, hemiGround: 0x3e4448, hemiInt: 0.95,
    keyColor: 0xf0f6ff, keyInt: 1.45,
    fillColor: 0x8fb0c4, fillInt: 0.55,
    accent: '#7fb8c9', accent2: '#c4d6a8',
    wallShape: 'rib',
    dust: 0xe4eef2, dustRate: 0.8,
  },

  deep: {
    id: 'deep', name: 'THE FOUNDRY',
    bg: 0x241f2b, skyTop: 0x17141c, skyBottom: 0x3e3448,
    fog: 0x38313f, fogNear: 40, fogFar: 126,
    floor: 0x4c4554, floorAlt: 0x534b5c, floorLine: 0x36303e,
    wall: 0x746d7e, wallTop: 0x9a93a3, wallShadow: 0x3e3944,
    hemiSky: 0xa08fc4, hemiGround: 0x2a2430, hemiInt: 0.75,
    keyColor: 0xffe8d0, keyInt: 1.4,
    fillColor: 0x8a6fc4, fillInt: 0.5,
    accent: '#b08ad6', accent2: '#d98f4a',
    wallShape: 'slab',
    dust: 0xb9aec9, dustRate: 0.45,
  },
};

export const DEFAULT_THEME = 'dusk';
