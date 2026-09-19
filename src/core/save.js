import { UPGRADES, upgradeCost, CHARACTER_SKINS, WEAPON_SKINS } from '../data/progression.js';
import { CONFIG } from './config.js';

const KEY = 'bouncefire.save.v2';
const LEGACY_KEY = 'bouncefire.save.v1';

const DEFAULT = {
  version: 2,
  scrap: 0,
  levelIndex: 0,
  maxLevelReached: 0,
  tutorialDone: false,
  upgrades: {},
  characters: ['field'],
  weapons: ['standard'],
  equipped: { character: 'field', weapon: 'standard' },
  settings: { music: true, sfx: true, quality: null, haptics: true },
  stats: { runs: 0, kills: 0, banked: 0, bounces: 0, bestLevel: 0 },
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
        this._adopt(JSON.parse(raw));
        return;
      }
    } catch { /* storage unavailable: run with defaults */ }
    this._migrateLegacy();
  }

  /**
   * A v1 save describes a game that no longer exists — its upgrades, bullet
   * skins and amplifiers have no counterparts here. Rather than silently
   * dropping the player's history we carry across what still means something
   * (their currency, how far they got, their lifetime stats and settings) and
   * refund the rest as scrap, so an existing player opens the new build with
   * something to spend instead of an empty locker.
   */
  _migrateLegacy() {
    let old = null;
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (raw) old = JSON.parse(raw);
    } catch { /* ignore */ }
    if (!old || typeof old !== 'object') return;

    const d = this.data;
    d.scrap = Math.max(0, Math.round(Number(old.coins) || 0));
    d.maxLevelReached = 0;          // the level list changed; start the tour again
    d.levelIndex = 0;
    d.settings = { ...DEFAULT.settings, ...(old.settings || {}) };
    if (old.stats) {
      d.stats.runs = Number(old.stats.runs) || 0;
      d.stats.kills = Number(old.stats.kills) || 0;
      d.stats.bounces = Number(old.stats.bounces) || 0;
    }
    // Refund retired purchases so old progress is not simply deleted.
    let refund = 0;
    for (const n of Object.values(old.upgrades || {})) refund += (Number(n) || 0) * 90;
    for (const n of Object.values(old.amplifiers || {})) refund += (Number(n) || 0) * 250;
    refund += (Array.isArray(old.skins) ? old.skins.length - 1 : 0) * 120;
    refund += (Array.isArray(old.auras) ? old.auras.length - 1 : 0) * 120;
    d.scrap += Math.max(0, Math.round(refund));
    d.migratedFromV1 = true;
    this.save();
  }

  _adopt(parsed) {
    if (!parsed || typeof parsed !== 'object') return;
    const d = structuredClone(DEFAULT);
    Object.assign(d, parsed);
    d.settings = { ...DEFAULT.settings, ...(parsed.settings || {}) };
    d.stats = { ...DEFAULT.stats, ...(parsed.stats || {}) };
    d.equipped = { ...DEFAULT.equipped, ...(parsed.equipped || {}) };
    d.upgrades = { ...(parsed.upgrades || {}) };
    d.characters = uniqueOwned(parsed.characters, CHARACTER_SKINS, 'field');
    d.weapons = uniqueOwned(parsed.weapons, WEAPON_SKINS, 'standard');
    if (!CHARACTER_SKINS[d.equipped.character]) d.equipped.character = 'field';
    if (!WEAPON_SKINS[d.equipped.weapon]) d.equipped.weapon = 'standard';
    if (!d.characters.includes(d.equipped.character)) d.equipped.character = 'field';
    if (!d.weapons.includes(d.equipped.weapon)) d.equipped.weapon = 'standard';
    // Upgrade ids that no longer exist would otherwise sit in the save forever.
    for (const id of Object.keys(d.upgrades)) if (!UPGRADES[id]) delete d.upgrades[id];
    this.data = d;
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- upgrades

  level(id) { return this.data.upgrades[id] || 0; }
  costOf(id) { return upgradeCost(id, this.level(id)); }
  canBuy(id) {
    const u = UPGRADES[id];
    return !!u && this.level(id) < u.max && this.data.scrap >= this.costOf(id);
  }
  buy(id) {
    if (!this.canBuy(id)) return false;
    this.data.scrap -= this.costOf(id);
    this.data.upgrades[id] = this.level(id) + 1;
    this.save();
    return true;
  }

  addScrap(n) { this.data.scrap = Math.max(0, this.data.scrap + Math.round(n)); }

  /** Resolve upgrades into the live stat block. Four terms, no products. */
  computeStats() {
    const b = CONFIG.bullets;
    return {
      damage: b.damage * (1 + this.level('damage') * UPGRADES.damage.step),
      magazine: b.magazine + this.level('magazine') * UPGRADES.magazine.step,
      reloadPerShot: b.reloadPerShot * (1 - this.level('reload') * UPGRADES.reload.step),
      maxHp: CONFIG.player.maxHp + this.level('vitality') * UPGRADES.vitality.step,
    };
  }

  // --------------------------------------------------------------- cosmetics

  ownsCharacter(id) { return this.data.characters.includes(id); }
  ownsWeapon(id) { return this.data.weapons.includes(id); }
  grantCharacter(id) {
    if (this.ownsCharacter(id)) return false;
    this.data.characters.push(id); return true;
  }
  grantWeapon(id) {
    if (this.ownsWeapon(id)) return false;
    this.data.weapons.push(id); return true;
  }
  character() { return CHARACTER_SKINS[this.data.equipped.character] || CHARACTER_SKINS.field; }
  weapon() { return WEAPON_SKINS[this.data.equipped.weapon] || WEAPON_SKINS.standard; }

  /** How much of the locker is filled: the one progression number worth showing. */
  collectionProgress() {
    const total = Object.keys(CHARACTER_SKINS).length + Object.keys(WEAPON_SKINS).length;
    const have = this.data.characters.length + this.data.weapons.length;
    return { have, total, frac: have / total };
  }

  recordRun(stats) {
    const s = this.data.stats;
    s.runs++;
    s.kills += stats.kills || 0;
    s.bounces += stats.bounces || 0;
    s.banked += stats.banked || 0;
    this.save();
  }

  reset() {
    this.data = structuredClone(DEFAULT);
    this.save();
  }
}

function uniqueOwned(list, table, fallback) {
  const out = [fallback];
  if (Array.isArray(list)) {
    for (const id of list) if (table[id] && !out.includes(id)) out.push(id);
  }
  return out;
}
