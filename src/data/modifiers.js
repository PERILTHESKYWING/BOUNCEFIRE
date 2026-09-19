// Modifier walls.
//
// There are four. That is the whole list, and it is short on purpose: the old
// build had thirteen, which meant a bullet could arrive at an enemy carrying a
// combination the player had no hope of reading back.
//
// Every modifier obeys the same stacking rule as a bounce:
//
//   CHARGE CAPS AT 3. Nothing multiplies anything else.
//
// POWER adds charge, exactly as a wall bounce does, so there is one number in
// the game and the player already knows it. The other three change the shape
// of a shot rather than its size, and each can only apply once per bullet.

export const MOD_KIND = {
  CHARGE: 'charge',
  SHAPE: 'shape',
};

export const MODIFIERS = {
  power: {
    id: 'power', label: 'POWER', kind: MOD_KIND.CHARGE,
    glyph: 'chevrons', color: 0xf2a03d,
    charge: 1,
    tip: 'Adds a charge, same as a bounce.',
    cooldown: 0.5,
  },
  split: {
    id: 'split', label: 'SPLIT', kind: MOD_KIND.SHAPE,
    glyph: 'fork', color: 0x74b86b,
    split: 3, spreadDeg: 19,
    tip: 'One shot becomes three. Once per shot.',
    cooldown: 0.7,
  },
  pierce: {
    id: 'pierce', label: 'PIERCE', kind: MOD_KIND.SHAPE,
    glyph: 'arrow', color: 0x5f9fd6,
    pierce: 2,
    tip: 'Passes through two enemies.',
    cooldown: 0.6,
  },
  burst: {
    id: 'burst', label: 'BURST', kind: MOD_KIND.SHAPE,
    glyph: 'burst', color: 0xe2603c,
    burstRadius: 5.4, burstScale: 0.6,
    tip: 'Explodes on the next enemy it hits.',
    cooldown: 0.8,
  },
};

export const MOD_IDS = Object.keys(MODIFIERS);

/**
 * Which modifier is introduced at which level. The first level teaches the
 * bounce and nothing else; each later level adds exactly one new wall, so a
 * modifier is always learned on its own before it is seen in company.
 */
export const MOD_UNLOCK_ORDER = ['power', 'split', 'pierce', 'burst'];

export const RARITY = {
  common:    { name: 'COMMON',    color: '#9a9488', weight: 58, scrap: 60 },
  rare:      { name: 'RARE',      color: '#5f9fd6', weight: 27, scrap: 180 },
  epic:      { name: 'EPIC',      color: '#a97bd6', weight: 11, scrap: 500 },
  legendary: { name: 'LEGENDARY', color: '#e0a13c', weight: 4,  scrap: 1400 },
};
