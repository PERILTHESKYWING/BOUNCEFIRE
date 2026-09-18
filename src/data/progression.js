// Upgrades, cosmetics and chest tables. All values are data so the economy can
// be retuned without touching gameplay code.

export const UPGRADES = {
  damage:      { id: 'damage',      name: 'Bullet Damage',  icon: '◆', desc: 'Raw damage per hit',            base: 60,  growth: 1.30, step: 0.14, max: 40, stat: 'damage' },
  fireRate:    { id: 'fireRate',    name: 'Fire Rate',      icon: '≫', desc: 'Shots per second',              base: 80,  growth: 1.34, step: 0.05, max: 26, stat: 'fireRate' },
  bulletCount: { id: 'bulletCount', name: 'Bullet Count',   icon: '⁙', desc: 'Extra bullets per volley',      base: 400, growth: 2.05, step: 1,    max: 5,  stat: 'bulletCount' },
  capacity:    { id: 'capacity',    name: 'Bullet Life',    icon: '◈', desc: 'Damage a bullet carries',       base: 90,  growth: 1.32, step: 0.10, max: 30, stat: 'capacity' },
  wallRecharge:{ id: 'wallRecharge',name: 'Wall Recharge',  icon: '⇄', desc: 'Life restored per bounce',      base: 110, growth: 1.33, step: 0.10, max: 30, stat: 'wallRecharge' },
  crit:        { id: 'crit',        name: 'Critical Chance',icon: '✷', desc: 'Chance to deal 2.75× damage',   base: 130, growth: 1.36, step: 0.02, max: 24, stat: 'crit' },
  multiplier:  { id: 'multiplier',  name: 'Damage Multiplier', icon: '×', desc: 'Multiplies everything',      base: 300, growth: 1.55, step: 0.08, max: 20, stat: 'multiplier' },
};

export const UPGRADE_ORDER = ['damage', 'fireRate', 'bulletCount', 'capacity', 'wallRecharge', 'crit', 'multiplier'];

export function upgradeCost(id, level) {
  const u = UPGRADES[id];
  return Math.round(u.base * Math.pow(u.growth, level));
}

export const BULLET_SKINS = {
  tracer:  { id: 'tracer',  name: 'Tracer',   rarity: 'common',    color: 0x8ff2ff, owned: true },
  ember:   { id: 'ember',   name: 'Ember',    rarity: 'common',    color: 0xff8a3a },
  acid:    { id: 'acid',    name: 'Acid',     rarity: 'common',    color: 0x9dff4a },
  cobalt:  { id: 'cobalt',  name: 'Cobalt',   rarity: 'rare',      color: 0x4a7bff },
  rose:    { id: 'rose',    name: 'Rose',     rarity: 'rare',      color: 0xff5ea8 },
  solar:   { id: 'solar',   name: 'Solar',    rarity: 'epic',      color: 0xffd257 },
  voidlt:  { id: 'voidlt',  name: 'Voidlight',rarity: 'epic',      color: 0xb98cff },
  prism:   { id: 'prism',   name: 'Prism',    rarity: 'legendary', color: 0xffffff, shift: true },
};

export const BULLET_AURAS = {
  none:      { id: 'none',      name: 'None',      rarity: 'common',    owned: true, particles: 0, color: 0x2b3550 },
  fireA:     { id: 'fireA',     name: 'Fire',      rarity: 'common',    color: 0xff6b2c, particles: 1.0 },
  lightningA:{ id: 'lightningA',name: 'Lightning', rarity: 'rare',      color: 0xc7a3ff, particles: 1.1 },
  crystalA:  { id: 'crystalA',  name: 'Crystal',   rarity: 'rare',      color: 0x9ae8ff, particles: 0.9 },
  plasmaA:   { id: 'plasmaA',   name: 'Plasma',    rarity: 'epic',      color: 0x63ffce, particles: 1.3 },
  voidA:     { id: 'voidA',     name: 'Void',      rarity: 'epic',      color: 0x8a3dff, particles: 1.2 },
  galaxyA:   { id: 'galaxyA',   name: 'Galaxy',    rarity: 'legendary', color: 0xff9bf0, particles: 1.6, shift: true },
  rainbowA:  { id: 'rainbowA',  name: 'Rainbow',   rarity: 'legendary', color: 0xffffff, particles: 1.5, rainbow: true },
};

export const CHEST = {
  cost: 750,
  name: 'AMPLIFIER CHEST',
  // weights are resolved against RARITY in modifiers.js
  slots: 3,
};
