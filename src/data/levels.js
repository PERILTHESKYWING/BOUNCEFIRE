// Levels are authored as a vertical sequence of hand-tuned chambers. The arena
// builder turns each chamber spec into geometry, colliders, spawn points and
// modifier-wall slots, so pacing stays readable while the data stays small.
//
// chamber.type:
//   gate     narrow entry with two side openings
//   split    central island, left/right branch routes
//   chevron  angled V walls, built for long ricochets
//   pillars  loose pillar field, many short bounces
//   ring     ring of angled segments around a centre pocket
//   open     wide arena breather
//   weave    offset staggered walls forming an S route
//   boss     wide open boss arena
//
// mods: modifier-wall ids placed into that chamber's slots, in order.

export const LEVELS = [
  {
    id: 'l1', name: 'NEON GRID', theme: 'neon', width: 38, seed: 91021,
    rise: 2.2, intro: 'Bullets bounce. Bouncing keeps them alive.',
    chambers: [
      { type: 'gate',    depth: 24, enemies: { grunt: 3 },               mods: [] },
      { type: 'chevron', depth: 32, enemies: { grunt: 4, swarmer: 4 },   mods: ['dmg50'] },
      { type: 'split',   depth: 34, enemies: { grunt: 5, spitter: 1 },   mods: ['x2', 'crit'] },
      { type: 'pillars', depth: 32, enemies: { swarmer: 8, grunt: 3 },   mods: ['dmg50', 'x2'] },
      { type: 'weave',   depth: 34, enemies: { grunt: 6, sentinel: 1 },  mods: ['rapid'] },
      { type: 'ring',    depth: 36, enemies: { grunt: 5, brute: 1, spitter: 2 }, mods: ['x3', 'dmg100'] },
      { type: 'open',    depth: 30, enemies: { swarmer: 10, grunt: 4, brute: 1 }, mods: ['heal', 'x2'] },
    ],
  },
  {
    id: 'l2', name: 'MAGMA CORE', theme: 'volcanic', width: 40, seed: 55512,
    rise: 2.6, intro: 'Fire walls set the swarm alight.',
    chambers: [
      { type: 'gate',    depth: 24, enemies: { grunt: 4, swarmer: 4 },   mods: ['fire'] },
      { type: 'pillars', depth: 34, enemies: { grunt: 6, swarmer: 6 },   mods: ['dmg50', 'fire'] },
      { type: 'chevron', depth: 34, enemies: { spitter: 3, grunt: 5 },   mods: ['x2', 'explosive'] },
      { type: 'split',   depth: 36, enemies: { brute: 2, swarmer: 8 },   mods: ['dmg100', 'x2'] },
      { type: 'weave',   depth: 34, enemies: { grunt: 8, sentinel: 2 },  mods: ['rapid', 'fire'] },
      { type: 'ring',    depth: 38, enemies: { brute: 2, grunt: 6, spitter: 2 }, mods: ['x3', 'explosive'] },
      { type: 'open',    depth: 34, enemies: { swarmer: 14, brute: 2, sentinel: 2 }, mods: ['heal', 'big'] },
    ],
  },
  {
    id: 'l3', name: 'PRISM HOLLOW', theme: 'crystal', width: 42, seed: 77431,
    rise: 2.4, intro: 'Angled facets turn one bullet into a storm.',
    chambers: [
      { type: 'chevron', depth: 28, enemies: { sentinel: 2, grunt: 4 },  mods: ['x2'] },
      { type: 'ring',    depth: 34, enemies: { grunt: 6, swarmer: 6 },   mods: ['lightning', 'dmg50'] },
      { type: 'weave',   depth: 36, enemies: { spitter: 3, sentinel: 3 },mods: ['x3', 'pierce'] },
      { type: 'pillars', depth: 34, enemies: { swarmer: 12, grunt: 5 },  mods: ['split', 'dmg100'] },
      { type: 'split',   depth: 36, enemies: { brute: 2, sentinel: 3 },  mods: ['ice', 'x2'] },
      { type: 'chevron', depth: 36, enemies: { grunt: 8, spitter: 3 },   mods: ['lightning', 'rapid'] },
      { type: 'open',    depth: 36, enemies: { brute: 3, swarmer: 12, sentinel: 3 }, mods: ['heal', 'x3', 'big'] },
    ],
  },
  {
    id: 'l4', name: 'VOID THRONE', theme: 'void', width: 46, seed: 13337,
    rise: 2.0, boss: true, intro: 'Something enormous is awake up there.',
    chambers: [
      { type: 'gate',    depth: 26, enemies: { sentinel: 3, grunt: 4 },  mods: ['dmg100'] },
      { type: 'weave',   depth: 34, enemies: { brute: 2, swarmer: 10 },  mods: ['x3', 'crit'] },
      { type: 'ring',    depth: 34, enemies: { spitter: 4, sentinel: 4 },mods: ['lightning', 'explosive'] },
      { type: 'boss',    depth: 84, enemies: {},                         mods: ['x3', 'dmg100', 'heal', 'big', 'rapid', 'crit'] },
    ],
  },
  {
    id: 'l5', name: 'GLACIER VAULT', theme: 'frozen', width: 42, seed: 24680,
    rise: 2.5, intro: 'Chilled targets take more punishment.',
    chambers: [
      { type: 'gate',    depth: 26, enemies: { grunt: 6, swarmer: 6 },   mods: ['ice'] },
      { type: 'pillars', depth: 36, enemies: { sentinel: 4, grunt: 6 },  mods: ['ice', 'dmg100'] },
      { type: 'chevron', depth: 36, enemies: { brute: 2, spitter: 4 },   mods: ['x3', 'pierce'] },
      { type: 'weave',   depth: 36, enemies: { swarmer: 16, grunt: 8 },  mods: ['rapid', 'split'] },
      { type: 'ring',    depth: 38, enemies: { brute: 3, sentinel: 4 },  mods: ['dmg100', 'big'] },
      { type: 'open',    depth: 38, enemies: { grunt: 12, brute: 3, spitter: 4 }, mods: ['heal', 'x3', 'crit'] },
    ],
  },
  {
    id: 'l6', name: 'HIVE SPIRE', theme: 'bio', width: 40, seed: 31415,
    rise: 2.8, intro: 'It keeps growing. Clear it anyway.',
    chambers: [
      { type: 'weave',   depth: 30, enemies: { swarmer: 14, grunt: 5 },  mods: ['split'] },
      { type: 'ring',    depth: 36, enemies: { spitter: 4, sentinel: 4 },mods: ['x3', 'fire'] },
      { type: 'pillars', depth: 36, enemies: { swarmer: 20, grunt: 8 },  mods: ['explosive', 'rapid'] },
      { type: 'split',   depth: 38, enemies: { brute: 4, sentinel: 4 },  mods: ['dmg100', 'lightning'] },
      { type: 'chevron', depth: 38, enemies: { grunt: 12, spitter: 5 },  mods: ['x3', 'big'] },
      { type: 'open',    depth: 40, enemies: { brute: 4, swarmer: 18, sentinel: 5 }, mods: ['heal', 'x3', 'crit', 'explosive'] },
    ],
  },
  {
    id: 'l7', name: 'SUNKEN TEMPLE', theme: 'stone', width: 44, seed: 86420,
    rise: 3.0, intro: 'Old stone. New holes in it.',
    chambers: [
      { type: 'gate',    depth: 28, enemies: { grunt: 8, brute: 1 },     mods: ['dmg100'] },
      { type: 'chevron', depth: 36, enemies: { sentinel: 5, spitter: 4 },mods: ['x3', 'crit'] },
      { type: 'pillars', depth: 38, enemies: { swarmer: 20, grunt: 10 }, mods: ['rapid', 'split'] },
      { type: 'ring',    depth: 38, enemies: { brute: 4, sentinel: 5 },  mods: ['lightning', 'big'] },
      { type: 'weave',   depth: 38, enemies: { grunt: 14, spitter: 5 },  mods: ['explosive', 'pierce'] },
      { type: 'open',    depth: 42, enemies: { brute: 5, swarmer: 20, sentinel: 6 }, mods: ['heal', 'x3', 'dmg100'] },
    ],
  },
  {
    id: 'l8', name: 'VOID THRONE II', theme: 'void', width: 48, seed: 99119,
    rise: 2.0, boss: true, bossHpMult: 2.6, intro: 'It remembers you.',
    chambers: [
      { type: 'ring',    depth: 32, enemies: { brute: 3, sentinel: 5 },  mods: ['x3', 'dmg100'] },
      { type: 'weave',   depth: 36, enemies: { swarmer: 20, spitter: 5 },mods: ['lightning', 'rapid'] },
      { type: 'boss',    depth: 90, enemies: {},                         mods: ['x3', 'dmg100', 'heal', 'big', 'rapid', 'crit', 'explosive', 'split'] },
    ],
  },
];

export function levelByIndex(i) {
  return LEVELS[i % LEVELS.length];
}
