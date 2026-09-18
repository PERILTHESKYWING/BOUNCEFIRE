// Modifier walls. Each entry is pure data: how it looks on the wall, what it
// does to a bullet, and how loud the activation reads.

export const MOD_KIND = {
  MULTIPLY: 'multiply',   // spawns extra bullets
  BUFF: 'buff',           // changes the bullet that touched it
  GLOBAL: 'global',       // timed player-wide effect
  RESTORE: 'restore',
};

export const MODIFIERS = {
  x2: {
    id: 'x2', label: '×2', sub: 'BULLETS', kind: MOD_KIND.MULTIPLY,
    color: 0x53e6ff, glow: 0x00d0ff, split: 2, spreadDeg: 16,
    rarity: 'common', cooldown: 0.28, punch: 1.0,
  },
  x3: {
    id: 'x3', label: '×3', sub: 'BULLETS', kind: MOD_KIND.MULTIPLY,
    color: 0x8affd8, glow: 0x00ffbb, split: 3, spreadDeg: 22,
    rarity: 'rare', cooldown: 0.42, punch: 1.35,
  },
  dmg50: {
    id: 'dmg50', label: '+50%', sub: 'DAMAGE', kind: MOD_KIND.BUFF,
    color: 0xffd257, glow: 0xffae00, damageMult: 1.5,
    rarity: 'common', cooldown: 0.22, punch: 0.85,
  },
  dmg100: {
    id: 'dmg100', label: '+100%', sub: 'DAMAGE', kind: MOD_KIND.BUFF,
    color: 0xffa23a, glow: 0xff6a00, damageMult: 2.0,
    rarity: 'rare', cooldown: 0.34, punch: 1.15,
  },
  rapid: {
    id: 'rapid', label: 'RAPID', sub: 'FIRE', kind: MOD_KIND.GLOBAL,
    color: 0xff7ad9, glow: 0xff2bbd, fireRateMult: 0.42, duration: 6,
    rarity: 'rare', cooldown: 1.6, punch: 1.3,
  },
  crit: {
    id: 'crit', label: 'CRIT', sub: 'CHANCE', kind: MOD_KIND.BUFF,
    color: 0xfff27a, glow: 0xffd400, critAdd: 0.4,
    rarity: 'common', cooldown: 0.3, punch: 1.0,
  },
  fire: {
    id: 'fire', label: 'FIRE', sub: 'BURN', kind: MOD_KIND.BUFF,
    color: 0xff6b2c, glow: 0xff2e00, element: 'fire', damageMult: 1.15,
    burnDps: 0.55, burnTime: 3.0,
    rarity: 'common', cooldown: 0.3, punch: 1.1,
  },
  ice: {
    id: 'ice', label: 'ICE', sub: 'FREEZE', kind: MOD_KIND.BUFF,
    color: 0x9ae8ff, glow: 0x35c8ff, element: 'ice', damageMult: 1.1,
    slow: 0.5, slowTime: 2.8, chilledBonus: 1.25,
    rarity: 'common', cooldown: 0.3, punch: 1.05,
  },
  lightning: {
    id: 'lightning', label: 'BOLT', sub: 'CHAIN', kind: MOD_KIND.BUFF,
    color: 0xc7a3ff, glow: 0x8b5bff, element: 'lightning', damageMult: 1.1,
    chainCount: 2, chainRange: 9, chainMult: 0.55,
    rarity: 'rare', cooldown: 0.34, punch: 1.2,
  },
  pierce: {
    id: 'pierce', label: 'PIERCE', sub: 'THROUGH', kind: MOD_KIND.BUFF,
    color: 0xe6f0ff, glow: 0xffffff, pierce: true, hitCostMult: 0.45,
    rarity: 'rare', cooldown: 0.36, punch: 1.05,
  },
  split: {
    id: 'split', label: 'SPLIT', sub: 'ON KILL', kind: MOD_KIND.BUFF,
    color: 0x7dffb0, glow: 0x00ff88, splitOnKill: 2,
    rarity: 'rare', cooldown: 0.4, punch: 1.1,
  },
  heal: {
    id: 'heal', label: 'CHARGE', sub: 'RESTORE', kind: MOD_KIND.RESTORE,
    color: 0x63ffce, glow: 0x00ffc3, restore: 1.0, shield: 1,
    rarity: 'rare', cooldown: 1.2, punch: 1.2,
  },
  explosive: {
    id: 'explosive', label: 'BOOM', sub: 'EXPLOSIVE', kind: MOD_KIND.BUFF,
    color: 0xff9b3d, glow: 0xff4d00, explode: true, explodeRadius: 6.2, explodeMult: 0.7,
    rarity: 'epic', cooldown: 0.5, punch: 1.4,
  },
  big: {
    id: 'big', label: 'BIG', sub: 'BULLET', kind: MOD_KIND.BUFF,
    color: 0xffe07a, glow: 0xffb300, sizeMult: 1.8, damageMult: 1.7, capacityMult: 1.6,
    rarity: 'epic', cooldown: 0.55, punch: 1.35,
  },
};

export const MOD_IDS = Object.keys(MODIFIERS);

// Amplifiers are the collectible meta-version of modifier walls.
export const AMPLIFIERS = {
  overcharge:  { id: 'overcharge',  name: 'Overcharge',  rarity: 'rare',      desc: '+12% bullet damage',        stat: 'damageMult', value: 0.12 },
  hairtrigger: { id: 'hairtrigger', name: 'Hair Trigger',rarity: 'rare',      desc: '+10% fire rate',            stat: 'fireRateMult', value: 0.10 },
  ricochet:    { id: 'ricochet',    name: 'Ricochet Core',rarity: 'epic',     desc: '+25% wall recharge',        stat: 'wallRecharge', value: 0.25 },
  splitcell:   { id: 'splitcell',   name: 'Split Cell',  rarity: 'epic',      desc: '+1 starting bullet',        stat: 'bulletCount', value: 1 },
  deadeye:     { id: 'deadeye',     name: 'Deadeye',     rarity: 'epic',      desc: '+8% crit chance',           stat: 'critChance', value: 0.08 },
  singularity: { id: 'singularity', name: 'Singularity', rarity: 'legendary', desc: '+35% damage, +15% capacity', stat: 'combo', value: 0 },
};

export const RARITY = {
  common:    { name: 'COMMON',    color: '#8fa3bf', weight: 62 },
  rare:      { name: 'RARE',      color: '#4fc8ff', weight: 26 },
  epic:      { name: 'EPIC',      color: '#c07bff', weight: 9.5 },
  legendary: { name: 'LEGENDARY', color: '#ffc13d', weight: 2.5 },
};
