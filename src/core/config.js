// Central tuning. Gameplay code reads these tables and holds no magic numbers
// of its own, so the game can be rebalanced without touching systems.
//
// The whole design rests on one rule, and every number below serves it:
//
//   A shot that bounces off a wall is refunded and hits harder.
//
// Charge is the only multiplier in the game. It goes 0 -> 3 and nothing else
// stacks on top of it, which is why combat stays readable.

export const CONFIG = {
  render: {
    fov: 46,
    near: 0.5,
    far: 380,
    maxPixelRatio: 2,
  },

  camera: {
    // Centred on the player, angled at ~57 degrees.
    //
    // This distance is not a look: it is the one number that decides how much
    // of the arena a portrait phone can see. At this offset and this fov the
    // visible window is about 19 world units wide, which is why the arenas
    // below are ~24 wide rather than the 46 they used to be. A wider arena
    // with the same camera means enemies stand beside you off-screen, which
    // is unfair however good the telegraphs are.
    offset: { x: 0, y: 31, z: -20 },
    lookAhead: 2.2,      // a hair ahead of the player, not half the level
    lookHeight: 1.0,
    aimLead: 2.6,        // slight push toward where the player is aiming
    follow: 9.5,
    shakeDecay: 9,
    maxShake: 0.55,      // deliberately small: shake is punctuation, not texture
  },

  player: {
    radius: 1.0,
    speed: 13.5,
    accel: 40,           // high accel + high drag = responsive, never slippery
    drag: 20,
    hoverHeight: 0.0,
    maxHp: 100,
    invulnAfterHit: 0.85,
    contactKnockback: 6,
    waveClearHeal: 20,
    turnRate: 16,        // how fast the character body swings to the aim angle
  },

  bullets: {
    speed: 38,
    damage: 12,
    fireInterval: 0.2,   // minimum gap between manual shots
    radius: 0.34,
    magazine: 6,
    reloadPerShot: 0.85, // seconds to passively regain one round
    maxBounces: 3,       // after this many wall hits the round is spent
    // A round is paid back when a shot that has bounced at least this many
    // times connects with an enemy. Banking is the only way to shoot for free.
    refundBounce: 1,
    maxAge: 5,
    cullDistance: 70,
    maxActive: 90,       // manual fire never needs a 300-round swarm
    // Charge: the one and only damage multiplier in the game.
    maxCharge: 3,
    chargeDamage: [1.0, 1.4, 1.8, 2.2],
  },

  enemies: {
    activationRange: 24,
    leash: 19,
    closeoutAt: 4,
    approachBoost: 1.6,
    separation: 2.2,
    maxAlive: 40,
  },

  feel: {
    hitStopKill: 0.03,
    hitStopHeavy: 0.07,
    slowMoScale: 0.3,
  },

  economy: {
    levelClearBonus: 80,
    waveClearBonus: 15,
  },

  quality: {
    // Bloom is off everywhere. The art direction is matte on purpose, and the
    // old build proved that a bloom budget just becomes a glow budget.
    high:   { particles: 1600, pixelRatio: 2,    trailGhosts: 4, shadow: true },
    medium: { particles: 1000, pixelRatio: 1.5,  trailGhosts: 3, shadow: true },
    low:    { particles: 500,  pixelRatio: 1.15, trailGhosts: 2, shadow: false },
  },
};

export const BOSS_DEF = {
  id: 'foundry',
  name: 'THE FOUNDRY',
  hp: 2100,
  radius: 3.9,
  phases: [
    { at: 1.00, name: 'SEALED',  signal: 0xffb35c, slamInterval: 6.0, spawnInterval: 11 },
    { at: 0.60, name: 'VENTING', signal: 0xff7a3c, slamInterval: 4.6, spawnInterval: 9 },
    { at: 0.28, name: 'MELTING', signal: 0xe8453c, slamInterval: 3.4, spawnInterval: 7 },
  ],
  // Sized against a 28-wide arena: big enough that standing still is fatal,
  // small enough that stepping out of it is always possible.
  slamRadius: 10.5,
  slamDamage: 20,
  spawnCount: 3,
  // The armour plates must be broken before the core takes full damage, so the
  // boss is a positioning problem rather than a health bar.
  plateCount: 4,
  plateHp: 220,
  platedDamageScale: 0.25,
};
