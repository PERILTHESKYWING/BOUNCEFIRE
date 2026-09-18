import { UPGRADES, upgradeCost, BULLET_SKINS, BULLET_AURAS } from '../data/progression.js';
import { AMPLIFIERS } from '../data/modifiers.js';
import { CONFIG } from './config.js';

const KEY = 'bouncefire.save.v1';

const DEFAULT = {
  coins: 0,
  levelIndex: 0,
  maxLevelReached: 0,
  upgrades: {},
  skins: ['tracer'],
  auras: ['none'],
  amplifiers: {},
  equipped: { skin: 'tracer', aura: 'none' },
  settings: { music: true, sfx: true, quality: null, haptics: true },
  stats: { runs: 0, kills: 0, bestCombo: 0, bounces: 0, damage: 0 },
};

/**
 * Progression store. Browser storage can be unavailable (private mode, blocked
 * site data), so every access is guarded and the game runs fine without it.
 */
export class Save {
  constructor() {
    this.data = structuredClone(DEFAULT);
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = { ...structuredClone(DEFAULT), ...parsed };
        this.data.settings = { ...DEFAULT.settings, ...(parsed.settings || {}) };
        this.data.stats = { ...DEFAULT.stats, ...(parsed.stats || {}) };
        this.data.equipped = { ...DEFAULT.equipped, ...(parsed.equipped || {}) };
      }
    } catch { /* storage unavailable: run with defaults */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  level(id) { return this.data.upgrades[id] || 0; }
  costOf(id) { return upgradeCost(id, this.level(id)); }
  canBuy(id) {
    const u = UPGRADES[id];
    return this.level(id) < u.max && this.data.coins >= this.costOf(id);
  }
  buy(id) {
    if (!this.canBuy(id)) return false;
    this.data.coins -= this.costOf(id);
    this.data.upgrades[id] = this.level(id) + 1;
    this.save();
    return true;
  }

  addCoins(n) { this.data.coins += n; }

  ownsSkin(id) { return this.data.skins.includes(id); }
  ownsAura(id) { return this.data.auras.includes(id); }
  grantSkin(id) { if (!this.ownsSkin(id)) { this.data.skins.push(id); return true; } return false; }
  grantAura(id) { if (!this.ownsAura(id)) { this.data.auras.push(id); return true; } return false; }
  grantAmplifier(id) {
    this.data.amplifiers[id] = (this.data.amplifiers[id] || 0) + 1;
  }

  /** Resolve upgrades + amplifiers into the live stat block the player uses. */
  computeStats() {
    const b = CONFIG.bullets;
    const lv = (id) => this.level(id);
    const amp = this.data.amplifiers;
    const ampVal = (stat) => {
      let v = 0;
      for (const [id, n] of Object.entries(amp)) {
        const a = AMPLIFIERS[id];
        if (a && a.stat === stat) v += a.value * n;
        if (a && a.stat === 'combo' && (stat === 'damageMult')) v += 0.35 * n;
        if (a && a.stat === 'combo' && (stat === 'capacity')) v += 0.15 * n;
      }
      return v;
    };

    const damage = b.damage * (1 + lv('damage') * UPGRADES.damage.step);
    const fireRateMult = 1 / (1 + lv('fireRate') * UPGRADES.fireRate.step + ampVal('fireRateMult'));
    const bulletCount = b.count + lv('bulletCount') * UPGRADES.bulletCount.step + ampVal('bulletCount');
    const capacityMult = 1 + lv('capacity') * UPGRADES.capacity.step + ampVal('capacity');
    const wallRecharge = 1 + lv('wallRecharge') * UPGRADES.wallRecharge.step + ampVal('wallRecharge');
    const critChance = b.critChance + lv('crit') * UPGRADES.crit.step + ampVal('critChance');
    const damageMult = (1 + lv('multiplier') * UPGRADES.multiplier.step) * (1 + ampVal('damageMult'));

    return {
      damage, fireRateMult, bulletCount, capacityMult, wallRecharge,
      critChance: Math.min(1, critChance), damageMult, speedMult: 1,
    };
  }

  skinColor() {
    const s = BULLET_SKINS[this.data.equipped.skin] || BULLET_SKINS.tracer;
    return s.color;
  }
  aura() {
    return BULLET_AURAS[this.data.equipped.aura] || BULLET_AURAS.none;
  }

  recordRun(stats) {
    const s = this.data.stats;
    s.runs++;
    s.kills += stats.kills || 0;
    s.bounces += stats.bounces || 0;
    s.damage += Math.round(stats.damage || 0);
    s.bestCombo = Math.max(s.bestCombo, stats.bestCombo || 0);
    this.save();
  }

  reset() {
    this.data = structuredClone(DEFAULT);
    this.save();
  }
}
