import { CONFIG, ENEMY_TYPES } from '../core/config.js';
import { clamp, formatNumber } from '../core/utils.js';
import { colorHex } from './bullets.js';

/**
 * Damage resolution, the combo economy and every "that felt good" response:
 * hit stop, camera shake, screen flash, chains and explosions.
 *
 * Combo is deliberately forgiving. It rewards constant action rather than
 * precision, which is the fantasy the game is selling.
 */
export class Combat {
  constructor(game) {
    this.game = game;
    this.combo = 0;
    this.peakCombo = 0;
    this.comboT = 0;
    this.nextMilestone = 0;
    this.overdriveT = 0;
    this.hitStop = 0;
    this.totalDamage = 0;
    this.kills = 0;
  }

  reset() {
    this.combo = 0; this.peakCombo = 0; this.comboT = 0;
    this.nextMilestone = 0; this.overdriveT = 0; this.hitStop = 0;
    this.totalDamage = 0; this.kills = 0;
  }

  get comboMult() {
    return 1 + Math.min(CONFIG.combo.maxDamageBonus, this.combo * CONFIG.combo.damagePerHit);
  }

  get damageScale() {
    return this.comboMult * (this.overdriveT > 0 ? CONFIG.combo.overdriveDamage : 1);
  }

  addHit() {
    const c = CONFIG.combo;
    this.combo++;
    this.comboT = c.window;
    if (this.combo > this.peakCombo) this.peakCombo = this.combo;
    while (this.nextMilestone < c.milestones.length && this.combo >= c.milestones[this.nextMilestone]) {
      const value = c.milestones[this.nextMilestone];
      this.nextMilestone++;
      this.game.onComboMilestone(value, this.nextMilestone - 1);
      if (value >= c.overdriveAt && this.overdriveT <= 0) this.startOverdrive();
    }
  }

  startOverdrive() {
    this.overdriveT = CONFIG.combo.overdriveTime;
    this.game.onOverdrive(true);
  }

  update(dt) {
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0 && this.combo > 0) {
        this.combo = 0;
        this.nextMilestone = 0;
        this.game.onComboReset();
      }
    }
    if (this.overdriveT > 0) {
      this.overdriveT -= dt;
      if (this.overdriveT <= 0) this.game.onOverdrive(false);
    }
  }

  // ------------------------------------------------------------------ damage

  bulletHitEnemy(b, e) {
    const g = this.game;
    const p = g.player;
    let dmg = p.stats.damage * p.stats.damageMult * b.damageMult * this.damageScale;
    if (e.chilled && b.chilledBonus > 1) dmg *= b.chilledBonus;

    const crit = Math.random() < b.critChance;
    if (crit) dmg *= CONFIG.bullets.critMult;

    this.addHit();
    this.damageEnemy(e, dmg, { crit, color: colorHex(b), bullet: b });

    // --- element riders
    if (b.element === 'fire' && b.burnTime > 0) {
      e.burnT = Math.max(e.burnT, b.burnTime);
      e.burnDps = Math.max(e.burnDps, b.burnDps);
    }
    if (b.element === 'ice' && b.slowTime > 0) {
      e.slowT = Math.max(e.slowT, b.slowTime);
      e.slow = Math.max(e.slow, b.slow);
    }
    if (b.element === 'lightning' && b.chainCount > 0) this._chain(b, e, dmg);
    if (b.explode) this._explode(b, e.x, e.y, e.z, dmg);

    // --- impact feedback
    e.flash = 1;
    const fx = g.fx;
    fx.particles.burst(e.x, e.y, e.z, crit ? 12 : 5, colorHex(b), {
      speed: crit ? 18 : 11, size: crit ? 0.6 : 0.4, life: crit ? 0.42 : 0.3, spread: 0.6, stretch: 1.8,
    });
    fx.effects.flash(e.x, e.y, e.z, crit ? 0xffffff : colorHex(b), crit ? 5.5 : 2.6, crit ? 0.2 : 0.12);
    if (crit) {
      fx.effects.ring(e.x, e.y - 0.6, e.z, 0xfff27a, 0.6, 5.5, 0.34);
      g.cameraRig.addShake(0.1);
      g.audio.crit();
    } else {
      g.audio.hit();
    }
  }

  /** Single entry point for all enemy damage, so numbers and death are uniform. */
  damageEnemy(e, amount, opts = {}) {
    if (e.hp <= 0 || e.dying > 0) return 0;
    const g = this.game;
    const dealt = Math.min(e.hp, amount);
    e.hp -= amount;
    this.totalDamage += dealt;

    if (!opts.silent || opts.kind === 'burn') {
      g.fx.damageNumbers.add(e, e.x, e.y + 1.4, e.z, dealt,
        opts.crit ? 'crit' : opts.kind === 'burn' ? 'burn' : '');
    }
    if (e.hp <= 0) this._killEnemy(e, opts);
    return dealt;
  }

  _killEnemy(e, opts) {
    const g = this.game;
    const def = ENEMY_TYPES[e.type];
    const big = def.hp >= 70;
    this.kills++;
    g.enemies.killed(e);

    const col = def.emissive;
    g.fx.particles.burst(e.x, e.y, e.z, big ? 34 : 16, col, {
      speed: big ? 22 : 15, size: big ? 0.8 : 0.5, life: big ? 0.7 : 0.45,
      spread: def.radius, stretch: 1.6, gravity: 12,
    });
    g.fx.particles.burst(e.x, e.y, e.z, big ? 14 : 7, 0xffffff, {
      speed: big ? 26 : 18, size: 0.42, life: 0.3, spread: 0.4, stretch: 2.6,
    });
    g.fx.effects.ring(e.x, e.y - 0.8, e.z, col, 0.5, big ? 10 : 6, big ? 0.5 : 0.36);
    g.fx.effects.flash(e.x, e.y, e.z, col, big ? 9 : 5, 0.22);
    if (big) {
      g.fx.effects.blast(e.x, e.y, e.z, col, def.radius * 3.2, 0.36);
      g.cameraRig.addShake(0.32);
      this.hitStop = Math.max(this.hitStop, CONFIG.feel.hitStopBig);
    } else {
      g.cameraRig.addShake(0.07);
    }
    g.audio.enemyDeath(big);
    g.addCoins(def.coins);

    // SPLIT rewards the kill with more bullets, feeding the swarm
    const b = opts.bullet;
    if (b && b.splitOnKill > 0 && b.splitsLeft > 0) {
      for (let i = 0; i < b.splitOnKill && b.splitsLeft > 0; i++) {
        const nb = g.bullets._clone(b, (i - (b.splitOnKill - 1) / 2) * 0.7 + Math.PI * 0.5 * (i % 2 ? 1 : -1));
        if (nb) { nb.x = e.x; nb.z = e.z; }
        b.splitsLeft--;
      }
    }

    g.onEnemyKilled(e);
  }

  _chain(b, source, baseDmg) {
    const g = this.game;
    let done = 0;
    const seen = new Set([source]);
    let from = source;
    for (let i = 0; i < b.chainCount; i++) {
      let best = null, bestD = b.chainRange * b.chainRange;
      g.enemies.forEachNear(from.x, from.z, b.chainRange, (o) => {
        if (o === from || seen.has(o) || o.dying > 0 || o.hp <= 0) return;
        const dx = o.x - from.x, dz = o.z - from.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = o; }
      });
      if (!best) break;
      seen.add(best);
      g.fx.effects.bolt(from.x, from.y, from.z, best.x, best.z, 0xc7a3ff, 0.5, 0.15);
      g.fx.particles.burst(best.x, best.y, best.z, 5, 0xc7a3ff, { speed: 10, size: 0.4, life: 0.26 });
      best.flash = 1;
      this.damageEnemy(best, baseDmg * b.chainMult, { color: 0xc7a3ff, bullet: b });
      from = best;
      done++;
    }
    if (done) g.audio.tone({ freq: 1200, to: 2400, type: 'square', dur: 0.09, gain: 0.05, filter: 'highpass', cutoff: 900 });
  }

  _explode(b, x, y, z, baseDmg) {
    const g = this.game;
    const r = b.explodeRadius;
    g.fx.effects.blast(x, y, z, 0xff9b3d, r * 1.5, 0.3);
    g.fx.effects.ring(x, y - 0.6, z, 0xffb85c, 1, r * 1.5, 0.4);
    g.fx.particles.burst(x, y, z, 18, 0xff9b3d, { speed: r * 3.2, size: 0.7, life: 0.45, spread: 1.2, gravity: 10 });
    g.cameraRig.addShake(0.16);
    g.audio.enemyDeath(true);
    const rr = r * r;
    g.enemies.forEachNear(x, z, r, (o) => {
      if (o.dying > 0 || o.hp <= 0) return;
      const dx = o.x - x, dz = o.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr) return;
      const fall = 1 - Math.sqrt(d2) / r;
      o.flash = 1;
      this.damageEnemy(o, baseDmg * b.explodeMult * (0.4 + fall * 0.6), { color: 0xff9b3d, bullet: b });
    });
    if (g.boss && g.boss.alive) {
      const dx = g.boss.x - x, dz = g.boss.z - z;
      if (dx * dx + dz * dz < (r + g.boss.radius) * (r + g.boss.radius)) {
        g.boss.damage(baseDmg * b.explodeMult, { color: 0xff9b3d });
      }
    }
  }
}
