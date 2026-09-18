// Central data-driven tuning. Everything a designer would want to touch lives
// here rather than being scattered through gameplay code.

export const CONFIG = {
  render: {
    fov: 52,
    near: 0.5,
    far: 420,
    maxPixelRatio: 2,
    fogNear: 60,
    fogFar: 230,
  },

  camera: {
    // Offset from the player, in world units. Tuned for a portrait phone so the
    // maze ahead reads clearly while the player stays in the lower third.
    offset: { x: 0, y: 38, z: -13 },
    lookAhead: 17,
    lookHeight: 1.5,
    follow: 6.2,
    lateralLead: 0.55,
    shakeDecay: 7.5,
    maxShake: 1.5,
  },

  player: {
    radius: 1.15,
    speed: 23,
    accel: 15,
    drag: 11,
    autoAdvance: 3.4,      // gentle constant push up the maze
    hoverHeight: 2.0,
    maxShield: 5,
    shieldRegenDelay: 5.0,
    shieldRegenTime: 3.2,
    invulnAfterHit: 1.1,
    contactKnockback: 9,
  },

  bullets: {
    speed: 34,
    damage: 13,
    fireInterval: 0.14,
    count: 1,
    spreadDeg: 9,
    radius: 0.42,
    lifeCapacity: 14,      // hidden "damage life"
    hitCost: 2.2,          // consumed per enemy hit
    wallRecharge: 4.6,     // restored per wall bounce
    bossHitCost: 1.15,
    maxAge: 15,            // hard ceiling, seconds
    cullDistance: 58,      // retire bullets that drift out of the fight
    maxActive: 300,
    critChance: 0.05,
    critMult: 2.75,
    trailGhosts: 6,
    trailStep: 0.028,
    // stacking caps so modifier chains stay readable
    maxDamageMult: 9,
    maxSplitPerBullet: 6,
  },

  combo: {
    window: 3.2,           // seconds before combo decays
    milestones: [15, 30, 50, 100, 180, 300],
    damagePerHit: 0.008,   // +0.8% damage per combo point
    maxDamageBonus: 2.2,
    overdriveAt: 50,
    overdriveTime: 8,
    overdriveDamage: 1.5,
    overdriveFireRate: 0.7,
  },

  enemies: {
    activationRange: 40,    // how close the player must get to wake a group
    leash: 30,              // enemies defend their chamber rather than trailing you
    closeoutAt: 8,          // when this few remain, everything comes to you
    approachBoost: 1.9,     // stragglers close the gap instead of trailing
    contactDamage: 1,
    separation: 1.6,
  },

  feel: {
    hitStopSmall: 0.0,
    hitStopBig: 0.055,
    hitStopHuge: 0.13,
    slowMoScale: 0.18,
    damageNumberMerge: 0.12,
  },

  economy: {
    coinsPerEnemy: 2,
    coinsPerBoss: 220,
    levelClearBonus: 60,
    comboCoinBonus: 0.35,   // coins per peak-combo point
  },

  quality: {
    // Chosen automatically then user-overridable from settings.
    high:   { bloom: true,  bloomStrength: 0.52, particles: 4200, shadow: false, pixelRatio: 2,    trailGhosts: 6 },
    medium: { bloom: true,  bloomStrength: 0.44,  particles: 2600, shadow: false, pixelRatio: 1.5,  trailGhosts: 5 },
    low:    { bloom: false, bloomStrength: 0,    particles: 1400, shadow: false, pixelRatio: 1.15, trailGhosts: 3 },
  },
};

export const ENEMY_TYPES = {
  grunt: {
    id: 'grunt', name: 'Drone',
    hp: 26, radius: 1.15, speed: 5.2, score: 1,
    shape: 'octa', size: 1.25, color: 0xff5470, emissive: 0xff2a55,
    behaviour: 'chase', contact: 1, coins: 2,
  },
  swarmer: {
    id: 'swarmer', name: 'Swarmer',
    hp: 11, radius: 0.78, speed: 9.4, score: 1,
    shape: 'tetra', size: 0.9, color: 0xffc24a, emissive: 0xff8a12,
    behaviour: 'chase', contact: 1, coins: 1,
  },
  brute: {
    id: 'brute', name: 'Brute',
    hp: 130, radius: 2.0, speed: 3.0, score: 4,
    shape: 'dodeca', size: 2.1, color: 0xa96bff, emissive: 0x6b2fff,
    behaviour: 'chase', contact: 2, coins: 7,
  },
  spitter: {
    id: 'spitter', name: 'Spitter',
    hp: 44, radius: 1.25, speed: 2.2, score: 2,
    shape: 'cone', size: 1.5, color: 0x4ef2a1, emissive: 0x10c46e,
    behaviour: 'shoot', contact: 1, coins: 4,
    fireInterval: 2.3, projectileSpeed: 15, projectileDamage: 1,
  },
  sentinel: {
    id: 'sentinel', name: 'Sentinel',
    hp: 78, radius: 1.45, speed: 6.6, score: 3,
    shape: 'icosa', size: 1.6, color: 0x53d9ff, emissive: 0x0aa6ff,
    behaviour: 'orbit', contact: 1, coins: 5,
  },
};

export const BOSS_DEF = {
  id: 'monolith',
  name: 'THE MONOLITH',
  hp: 46000,
  radius: 5.4,
  phases: [
    { at: 1.00, color: 0x7a5bff, emissive: 0x4b23ff, ringSpeed: 0.5, name: 'DORMANT' },
    { at: 0.66, color: 0xff5ea8, emissive: 0xff1f7a, ringSpeed: 1.1, name: 'AWAKENED' },
    { at: 0.33, color: 0xff8a3d, emissive: 0xff4a00, ringSpeed: 2.0, name: 'CRITICAL' },
  ],
  slamInterval: 6.5,
  slamRadius: 17,
  slamDamage: 1,
  spawnInterval: 9.0,
  spawnCount: 4,
};
