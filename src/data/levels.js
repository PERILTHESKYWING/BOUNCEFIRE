// Levels are a sequence of rooms. You walk in, the room wakes up, you clear
// it, you walk on. There is no auto-advance and no timer: the player decides
// when the next fight starts.
//
// Rooms are authored wide and mostly empty, with the bounce surfaces pushed
// out to the edges and the angles. The old maze filled the middle of every
// chamber with cover, which hid the player from their own camera and turned
// fights into corridor work. A room here has one job: give you room to move
// and good walls to bank shots off.
//
// chamber.type:
//   court    wide rectangle, angled kickers in all four corners
//   spine    a broken centre wall making two lanes with cross-shots
//   pockets  four set-back blocks, wide lanes between them
//   vee      a funnel of two long angles, completely open in the middle
//   ring     broken ring set far out, big clear circle in the centre
//   boss     open arena with pylons at the rim
//
// The enemy roster and modifier list per level are the whole difficulty curve:
// one new enemy and one new modifier per level, never both in the same room.

export const LEVELS = [
  {
    id: 'l1', name: 'THE YARDS', theme: 'dusk', width: 24, seed: 91021, rise: 1.4,
    intro: 'Bank your shots. A bounce pays the round back.',
    chambers: [
      { type: 'court',   depth: 40, enemies: { skitter: 4 },               mods: [] },
      { type: 'vee',     depth: 42, enemies: { skitter: 4, hornet: 2 },    mods: ['power'] },
      { type: 'pockets', depth: 44, enemies: { skitter: 5, hornet: 2 },    mods: ['power'] },
      { type: 'ring',    depth: 46, enemies: { skitter: 5, hornet: 3 },    mods: ['power', 'power'] },
    ],
  },
  {
    id: 'l2', name: 'THE KILN', theme: 'kiln', width: 25, seed: 55512, rise: 1.4,
    intro: 'Lancers hold the back. Close on them or break the line.',
    chambers: [
      { type: 'court',   depth: 40, enemies: { skitter: 4, lancer: 1 },              mods: ['power'] },
      { type: 'spine',   depth: 44, enemies: { skitter: 4, lancer: 2 },              mods: ['split'] },
      { type: 'vee',     depth: 44, enemies: { hornet: 4, lancer: 2 },               mods: ['power', 'split'] },
      { type: 'pockets', depth: 46, enemies: { skitter: 5, hornet: 3, lancer: 2 },   mods: ['split'] },
      { type: 'ring',    depth: 48, enemies: { skitter: 5, hornet: 3, lancer: 3 },   mods: ['power', 'split'] },
    ],
  },
  {
    id: 'l3', name: 'COLD STORAGE', theme: 'frost', width: 26, seed: 77431, rise: 1.2,
    intro: 'A Warden\'s shield stops anything aimed straight at it.',
    chambers: [
      { type: 'court',   depth: 42, enemies: { skitter: 4, warden: 1 },              mods: ['power'] },
      { type: 'vee',     depth: 44, enemies: { warden: 2, lancer: 2 },               mods: ['pierce'] },
      { type: 'spine',   depth: 46, enemies: { skitter: 5, hornet: 3, warden: 1 },   mods: ['split', 'pierce'] },
      { type: 'pockets', depth: 46, enemies: { lancer: 3, warden: 2 },               mods: ['power', 'pierce'] },
      { type: 'ring',    depth: 50, enemies: { skitter: 6, hornet: 3, warden: 2 },  mods: ['power', 'split', 'pierce'] },
    ],
  },
  {
    id: 'l4', name: 'DEEP WORKS', theme: 'deep', width: 26, seed: 13337, rise: 1.2,
    intro: 'Anvils own the ground they stand on. Fight from outside it.',
    chambers: [
      { type: 'court',   depth: 44, enemies: { skitter: 4, anvil: 1 },               mods: ['power'] },
      { type: 'ring',    depth: 46, enemies: { hornet: 4, anvil: 1 },                mods: ['burst'] },
      { type: 'spine',   depth: 46, enemies: { warden: 2, lancer: 3 },               mods: ['pierce', 'burst'] },
      { type: 'vee',     depth: 48, enemies: { skitter: 7, anvil: 2 },               mods: ['power', 'burst'] },
      { type: 'pockets', depth: 50, enemies: { hornet: 4, lancer: 3, warden: 2, anvil: 1 }, mods: ['split', 'pierce', 'burst'] },
    ],
  },
  {
    id: 'l5', name: 'THE FOUNDRY', theme: 'deep', width: 28, seed: 99119, rise: 1.0,
    boss: true,
    intro: 'Break its plates before the core will take a hit.',
    chambers: [
      { type: 'court',   depth: 42, enemies: { skitter: 6, lancer: 2 },              mods: ['power', 'split'] },
      { type: 'vee',     depth: 46, enemies: { warden: 2, hornet: 4, anvil: 1 },     mods: ['pierce', 'burst'] },
      { type: 'boss',    depth: 76, enemies: {},                                     mods: ['power', 'split', 'pierce', 'burst'] },
    ],
  },
];

export function levelByIndex(i) {
  return LEVELS[i % LEVELS.length];
}
