// Upgrades and cosmetics.
//
// Four upgrades, down from seven, and none of them multiplies another. Each
// one answers a question the player can actually ask themselves mid-run
// ("I keep running dry", "I keep dying", "that took too many shots"), and the
// effect is stated in the units the HUD already shows.
//
// Everything else that used to be permanent power — crit, fire rate, bullet
// count, bullet life, wall recharge, the global damage multiplier, and the
// amplifier collection stacked on top of all of it — is gone. The gacha pays
// out cosmetics now, so a build changes how you look, not how loud combat is.

export const UPGRADES = {
  damage: {
    id: 'damage', name: 'Calibre', glyph: 'chevrons',
    desc: 'Every shot hits harder',
    base: 110, growth: 1.34, step: 0.08, max: 10,
    format: (lv) => `+${Math.round(lv * 8)}% damage`,
  },
  magazine: {
    id: 'magazine', name: 'Magazine', glyph: 'rounds',
    desc: 'Carry more rounds before reloading',
    base: 260, growth: 1.75, step: 1, max: 4,
    format: (lv) => `${6 + lv} rounds`,
  },
  reload: {
    id: 'reload', name: 'Reload', glyph: 'cycle',
    desc: 'Rounds come back faster on their own',
    base: 180, growth: 1.42, step: 0.09, max: 6,
    format: (lv) => `-${Math.round(lv * 9)}% reload time`,
  },
  vitality: {
    id: 'vitality', name: 'Plating', glyph: 'heart',
    desc: 'More health to work with',
    base: 150, growth: 1.44, step: 15, max: 6,
    format: (lv) => `${100 + lv * 15} HP`,
  },
};

export const UPGRADE_ORDER = ['damage', 'magazine', 'reload', 'vitality'];

export function upgradeCost(id, level) {
  const u = UPGRADES[id];
  return Math.round(u.base * Math.pow(u.growth, level));
}

/**
 * Character skins. A skin is three colours on the same silhouette, which keeps
 * the player readable at every distance no matter what they have equipped:
 * `suit` is the large surface, `trim` the panels, `visor` the single bright
 * accent that says "this one is me".
 */
export const CHARACTER_SKINS = {
  field:    { id: 'field',    name: 'Field',     rarity: 'common',    suit: 0xe9e2d0, trim: 0x3fae9a, visor: 0x8ff0e0, owned: true },
  ranger:   { id: 'ranger',   name: 'Ranger',    rarity: 'common',    suit: 0xcfd6c4, trim: 0x5d7a52, visor: 0xd8f08a },
  ember:    { id: 'ember',    name: 'Ember',     rarity: 'common',    suit: 0xf0dccb, trim: 0xc4643a, visor: 0xffb178 },
  cobalt:   { id: 'cobalt',   name: 'Cobalt',    rarity: 'rare',      suit: 0xdfe6f0, trim: 0x3a63c4, visor: 0x8fb8ff },
  rose:     { id: 'rose',     name: 'Rosewood',  rarity: 'rare',      suit: 0xf2dee2, trim: 0xa8465f, visor: 0xffa6bc },
  graphite: { id: 'graphite', name: 'Graphite',  rarity: 'epic',      suit: 0x4a4a4c, trim: 0xd8d2c2, visor: 0xffd27a },
  ivory:    { id: 'ivory',    name: 'Ivory',     rarity: 'epic',      suit: 0xfaf4e6, trim: 0xb59a5e, visor: 0xffe6a8 },
  aurora:   { id: 'aurora',   name: 'Aurora',    rarity: 'legendary', suit: 0xeef0ff, trim: 0x7a5bd6, visor: 0x9df0c8, shimmer: true },
};

/**
 * Weapon skins. Same three-colour idea; `tracer` is also the colour of the
 * rounds, so picking a weapon skin visibly changes the thing you look at most.
 */
export const WEAPON_SKINS = {
  standard: { id: 'standard', name: 'Standard', rarity: 'common',    metal: 0x53514c, accent: 0x3fae9a, tracer: 0xffe9b0, owned: true },
  brass:    { id: 'brass',    name: 'Brass',    rarity: 'common',    metal: 0x7a6238, accent: 0xd6a44a, tracer: 0xffd48a },
  slate:    { id: 'slate',    name: 'Slate',    rarity: 'common',    metal: 0x3e454a, accent: 0x8fa4ad, tracer: 0xdff0ff },
  crimson:  { id: 'crimson',  name: 'Crimson',  rarity: 'rare',      metal: 0x5e2a2a, accent: 0xc94b4b, tracer: 0xff9a7a },
  verdant:  { id: 'verdant',  name: 'Verdant',  rarity: 'rare',      metal: 0x2f4a38, accent: 0x67b07a, tracer: 0xc4f0a8 },
  gilded:   { id: 'gilded',   name: 'Gilded',   rarity: 'epic',      metal: 0x6b5420, accent: 0xe0b44a, tracer: 0xffdf8a },
  obsidian: { id: 'obsidian', name: 'Obsidian', rarity: 'epic',      metal: 0x232227, accent: 0x8f6bd6, tracer: 0xd0a8ff },
  prism:    { id: 'prism',    name: 'Prism',    rarity: 'legendary', metal: 0xdad6e6, accent: 0x7ad6c4, tracer: 0xffffff, shimmer: true },
};

export const CRATE = {
  cost: 600,
  name: 'SUPPLY CRATE',
};
