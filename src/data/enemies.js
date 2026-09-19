// The enemy cast.
//
// Five opponents, each one a different question the player has to answer.
// Every entry is pure data: a parts list that geometry.js merges into a small
// number of instanced meshes, a behaviour id that enemies.js dispatches on,
// and the numbers that decide how dangerous it is.
//
// Two rules hold the cast together and are worth not breaking:
//
//  1. SILHOUETTE CARRIES IDENTITY. Every enemy is built from several meshes
//     with a shape you can name — a crab, a dart, a tripod, a shield, a fist.
//     None of them is a tinted platonic solid.
//
//  2. HEAT IS THREAT. Bodies are all the same charcoal. The only colour on an
//     enemy is its core, and that colour runs one warm ramp from amber to deep
//     red as the thing gets more dangerous. A player who has never seen a new
//     enemy can still read how worried to be from across the arena.

const SHELL = 0x33322f;      // matte charcoal, shared by the whole cast
const SHELL_DARK = 0x232220;
const PLATE = 0x4a4843;      // lighter armour facets, catches the key light

/** parts: { shape, args, pos, rot, scale } -> merged by world/geometry.js */

export const ENEMY_TYPES = {
  // ---------------------------------------------------------------- skitter
  // Low-slung six-legged crab. Dies fast, arrives in numbers, and closes the
  // gap with a short telegraphed lunge. Teaches: keep moving, kill on approach.
  skitter: {
    id: 'skitter', name: 'Skitter', threat: 1,
    hp: 16, radius: 0.95, speed: 8.6, coins: 2,
    behaviour: 'rusher',
    contact: 8,
    signal: 0xffb04a,
    lunge: { range: 11, wind: 0.34, speed: 26, time: 0.28, cooldown: 2.1 },
    model: {
      shell: [
        // flat carapace
        { shape: 'cyl', args: [1.05, 0.78, 0.45, 6], pos: [0, 0.42, 0], rot: [0, 0.52, 0] },
        // raised spine ridge
        { shape: 'box', args: [0.42, 0.3, 1.5], pos: [0, 0.66, -0.1] },
        // forward mandible wedge
        { shape: 'cone', args: [0.42, 0.9, 4], pos: [0, 0.38, 0.95], rot: [1.57, 0, 0.78] },
      ],
      plate: [
        { shape: 'box', args: [1.5, 0.16, 0.5], pos: [0, 0.62, 0.28], rot: [0.18, 0, 0] },
      ],
      signal: [
        // read from above: a lit strip down the spine
        { shape: 'box', args: [0.34, 0.1, 1.45], pos: [0, 0.83, -0.08] },
        { shape: 'box', args: [0.62, 0.14, 0.12], pos: [0, 0.5, 0.78] },
      ],
      limbs: {
        count: 6,
        part: { shape: 'box', args: [0.13, 0.13, 1.15] },
        // six legs around a flat body, scissoring in two alternating triples
        layout: 'radial', radius: 0.72, y: 0.3, spread: 2.2, tilt: 0.55,
        anim: 'scissor', amp: 0.55, rate: 9.0,
      },
    },
  },

  // ----------------------------------------------------------------- hornet
  // A dart that never holds still. Circles at range, then commits to a
  // telegraphed dive straight through you. Teaches: read the line, step off it.
  hornet: {
    id: 'hornet', name: 'Hornet', threat: 2,
    hp: 26, radius: 0.9, speed: 11.5, coins: 3,
    behaviour: 'diver',
    contact: 14,
    signal: 0xff7a3c,
    dive: { range: 18, hold: 9.5, wind: 0.5, speed: 34, time: 0.45, cooldown: 2.8 },
    hover: 1.9,
    model: {
      shell: [
        { shape: 'cone', args: [0.5, 2.3, 5], pos: [0, 0, 0.25], rot: [1.57, 0, 0] },
        { shape: 'box', args: [0.3, 0.3, 0.9], pos: [0, 0.05, -1.05] },
      ],
      plate: [
        { shape: 'box', args: [0.7, 0.12, 0.7], pos: [0, 0.22, 0.05], rot: [0, 0.78, 0] },
        { shape: 'cone', args: [0.14, 0.7, 4], pos: [0, 0.05, -1.5], rot: [-1.57, 0, 0] },
      ],
      signal: [
        // read from above: a chevron across the back
        { shape: 'box', args: [1.15, 0.1, 0.3], pos: [0, 0.4, 0.1], rot: [0, 0, 0] },
        { shape: 'box', args: [0.3, 0.1, 0.8], pos: [0, 0.4, -0.5] },
        { shape: 'box', args: [0.26, 0.1, 0.34], pos: [0, 0.16, 0.85] },
        { shape: 'cyl', args: [0.16, 0.16, 0.1, 6], pos: [0, 0.05, -1.42], rot: [1.57, 0, 0] },
      ],
      limbs: {
        count: 2,
        part: { shape: 'box', args: [1.9, 0.09, 0.62] },
        layout: 'wings', radius: 1.0, y: 0.18, spread: 0, tilt: 0,
        anim: 'flap', amp: 0.42, rate: 15,
      },
    },
  },

  // ----------------------------------------------------------------- lancer
  // A tripod gun platform. Holds its distance, winds up visibly, and puts a
  // slow bolt exactly where you were. Teaches: close the gap or break the line.
  lancer: {
    id: 'lancer', name: 'Lancer', threat: 3,
    hp: 40, radius: 1.15, speed: 4.6, coins: 5,
    behaviour: 'gunner',
    contact: 6,
    signal: 0xff5a5a,
    gun: { standoff: 14, wind: 0.85, cooldown: 2.6, projectileSpeed: 19, projectileDamage: 12, range: 26 },
    model: {
      shell: [
        { shape: 'cyl', args: [0.86, 1.0, 1.0, 8], pos: [0, 1.5, 0] },
        { shape: 'cyl', args: [0.55, 0.7, 0.55, 8], pos: [0, 2.15, 0] },
        { shape: 'box', args: [0.34, 0.34, 2.3], pos: [0.38, 1.72, 0.9] },
      ],
      plate: [
        { shape: 'box', args: [1.5, 0.5, 0.9], pos: [0, 2.2, -0.25], rot: [-0.2, 0, 0] },
        { shape: 'box', args: [0.52, 0.52, 0.5], pos: [0.38, 1.72, 2.0] },
      ],
      signal: [
        { shape: 'cyl', args: [0.9, 0.9, 0.12, 8], pos: [0, 1.28, 0] },
        { shape: 'box', args: [0.2, 0.2, 0.14], pos: [0.38, 1.72, 2.28] },
      ],
      limbs: {
        count: 3,
        part: { shape: 'box', args: [0.17, 0.17, 1.9] },
        layout: 'radial', radius: 0.7, y: 0.95, spread: 2.1, tilt: 0.95,
        anim: 'plant', amp: 0.16, rate: 4.5,
      },
    },
  },

  // ----------------------------------------------------------------- warden
  // A walking shield. The front plate eats anything fired straight at it, so
  // the only way through is around — which is exactly what a ricochet does.
  // This is the enemy that makes the core mechanic necessary rather than nice.
  warden: {
    id: 'warden', name: 'Warden', threat: 4,
    hp: 70, radius: 1.55, speed: 3.4, coins: 8,
    behaviour: 'bulwark',
    contact: 10,
    signal: 0xe03a2f,
    // A hit is deflected when the bullet comes in within this cone of the
    // shield's facing. cos(50 degrees) ~= 0.64.
    frontArmor: 0.64,
    contactAlways: true,
    shove: 11,
    model: {
      shell: [
        { shape: 'box', args: [1.9, 1.5, 1.4], pos: [0, 1.25, -0.25] },
        { shape: 'box', args: [0.9, 0.55, 0.7], pos: [0, 2.1, 0.1] },
      ],
      plate: [
        // the shield: wide, unmistakable, and always pointed at you
        { shape: 'box', args: [3.3, 2.5, 0.42], pos: [0, 1.4, 1.1] },
        { shape: 'box', args: [0.5, 2.7, 0.55], pos: [0, 1.4, 1.22] },
        { shape: 'box', args: [3.5, 0.34, 0.6], pos: [0, 2.6, 1.14] },
      ],
      signal: [
        // read from above: a cap along the top edge of the shield, which is
        // also the line you must not shoot into
        { shape: 'box', args: [2.5, 0.12, 0.34], pos: [0, 2.28, 0.52] },
        // eye slit peeking over the shield
        { shape: 'box', args: [0.66, 0.12, 0.14], pos: [0, 2.16, 0.46] },
        // exposed vents on its back: the part you are meant to hit
        { shape: 'box', args: [1.4, 0.7, 0.12], pos: [0, 1.3, -0.98] },
      ],
      limbs: {
        count: 2,
        part: { shape: 'box', args: [0.34, 0.34, 1.2] },
        layout: 'pair', radius: 0.62, y: 0.55, spread: 0, tilt: 0,
        anim: 'stomp', amp: 0.4, rate: 4.0,
      },
    },
  },

  // ------------------------------------------------------------------ anvil
  // The encounter. Slow, heavy, and it owns the ground around it: raise, ring,
  // slam. Not a health sponge — it is dangerous because of where it forces you
  // to stand. Teaches: fight at the edge of its reach.
  anvil: {
    id: 'anvil', name: 'Anvil', threat: 5,
    hp: 150, radius: 2.0, speed: 3.0, coins: 16,
    behaviour: 'slammer',
    contact: 10,
    signal: 0xff2e1f,
    slam: { range: 7.0, wind: 0.8, radius: 6.2, damage: 22, cooldown: 3.6, knock: 20 },
    model: {
      shell: [
        { shape: 'box', args: [2.4, 2.0, 1.9], pos: [0, 2.0, 0] },
        { shape: 'box', args: [1.0, 0.8, 0.9], pos: [0, 3.15, 0.22], rot: [0.22, 0, 0] },
        { shape: 'box', args: [1.0, 1.1, 1.2], pos: [-0.75, 0.55, 0] },
        { shape: 'box', args: [1.0, 1.1, 1.2], pos: [0.75, 0.55, 0] },
      ],
      plate: [
        { shape: 'box', args: [2.8, 0.5, 2.1], pos: [0, 3.0, 0] },
        { shape: 'box', args: [1.4, 1.4, 1.4], pos: [-1.5, 1.5, 0], rot: [0, 0.4, 0] },
        { shape: 'box', args: [1.4, 1.4, 1.4], pos: [1.5, 1.5, 0], rot: [0, -0.4, 0] },
      ],
      signal: [
        // read from above: a hot collar across the shoulders
        { shape: 'cyl', args: [1.25, 1.25, 0.12, 8], pos: [0, 2.72, 0] },
        // chest furnace, brightens through the wind-up
        { shape: 'box', args: [1.0, 0.85, 0.12], pos: [0, 2.0, 0.98] },
        { shape: 'box', args: [0.5, 0.1, 0.14], pos: [0, 3.2, 0.66] },
      ],
      limbs: {
        count: 2,
        part: { shape: 'box', args: [0.55, 0.55, 1.5] },
        layout: 'pair', radius: 1.5, y: 2.2, spread: 0, tilt: 0,
        anim: 'raise', amp: 1.1, rate: 3.0,
      },
    },
  },
};

export const ENEMY_IDS = Object.keys(ENEMY_TYPES);
export const ENEMY_SHELL = SHELL;
export const ENEMY_SHELL_DARK = SHELL_DARK;
export const ENEMY_PLATE = PLATE;

/** Roster copy for the tutorial and the profile screen. One line each. */
export const ENEMY_BLURB = {
  skitter: 'Rushes you in packs. Crouches before it lunges.',
  hornet: 'Circles, then dives along a marked line.',
  lancer: 'Holds its distance and charges a slow bolt.',
  warden: 'Its shield blocks anything fired straight at it.',
  anvil: 'Slams the ground. Fight it from outside the ring.',
};
