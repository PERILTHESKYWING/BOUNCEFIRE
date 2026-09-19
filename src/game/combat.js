import { CONFIG } from '../core/config.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { Bullets, colorHex } from './bullets.js';

/**
 * Damage resolution and the response to it.
 *
 * The whole of it is: base damage, times charge. There is no combo multiplier,
 * no crit roll, no overdrive window, no element rider and no chain. Those were
 * six separate things happening to one number, which is why the old build
 * could not answer "why did that die?".
 *
 * Feedback is budgeted rather than layered. A normal hit is a flash and a
 * click. A kill is a burst and a thump. Only a kill by a fully charged round
 * gets hit stop, so the moment the player is being taught to chase is the only
 * moment the game stops for.
 */
export class Combat {
  constructor(game) {
    this.game = game;
    this.hitStop = 0;
    this.totalDamage = 0;
    this.kills = 0;
    this.streak = 0;          // kills without being hit; pays scrap, not damage
    this.bestStreak = 0;
  }

  reset() {
    this.hitStop = 0;
    this.totalDamage = 0;
    this.kills = 0;
    this.streak = 0;
    this.bestStreak = 0;
  }

  breakStreak() {
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.streak = 0;
  }

  update(dt) { /* nothing accumulates between frames any more */ }

  // ------------------------------------------------------------------ damage

  bulletHitEnemy(b, e) {
    const g = this.game;
    const p = g.player;
    const mult = Bullets.chargeMult(b.charge);
    const dmg = p.stats.damage * mult;

    this.damageEnemy(e, dmg, { charge: b.charge, bounced: b.bounces > 0, color: colorHex(b), bullet: b });
    if (b.burst) this._burst(b, e.x, e.y, e.z, dmg);

    // The bank pays for itself: a round that bounced before it connected is
    // returned to the magazine. A straight shot, and a miss, both cost one.
    if (b.bounces >= CONFIG.bullets.refundBounce && !b.refunded) {
      b.refunded = true;
      g.bullets.stats.banked++;
      p.refundRound();
    }

    e.flash = 1;
    const fx = g.fx;
    const heavy = b.charge >= CONFIG.bullets.maxCharge;
    fx.particles.burst(e.x, e.y + 0.8, e.z, heavy ? 7 : 3, colorHex(b), {
      speed: heavy ? 13 : 8, size: heavy ? 0.34 : 0.24, life: 0.26, spread: 0.5, stretch: 1.5,
    });
    g.audio.hit(b.charge);
  }

  /** Single entry point for all enemy damage, so death is uniform. */
  damageEnemy(e, amount, opts = {}) {
    if (e.hp <= 0 || e.dying > 0) return 0;
    const dealt = Math.min(e.hp, amount);
    e.hp -= amount;
    this.totalDamage += dealt;
    if (e.hp <= 0) this._killEnemy(e, opts);
    return dealt;
  }

  _killEnemy(e, opts) {
    const g = this.game;
    const def = ENEMY_TYPES[e.type];
    const big = def.threat >= 4;
    this.kills++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    g.enemies.killed(e);

    // Death is the shell coming apart: charcoal chunks plus one flash of its
    // own core colour, so you can tell what died without reading a label.
    g.fx.particles.burst(e.x, e.y + def.radius * 0.6, e.z, big ? 16 : 9, 0x3a3733, {
      speed: big ? 15 : 11, size: big ? 0.44 : 0.3, life: 0.55,
      spread: def.radius * 0.8, stretch: 1.2, gravity: 22,
    });
    g.fx.particles.burst(e.x, e.y + def.radius * 0.6, e.z, big ? 8 : 4, def.signal, {
      speed: big ? 17 : 12, size: 0.3, life: 0.3, spread: 0.4, stretch: 1.8,
    });
    g.fx.effects.ring(e.x, e.baseY + 0.1, e.z, def.signal, 0.5, big ? 7 : 4, 0.3);

    if (big) {
      g.cameraRig.addShake(0.18);
      this.hitStop = Math.max(this.hitStop, CONFIG.feel.hitStopHeavy);
    } else if (opts.charge >= CONFIG.bullets.maxCharge) {
      // the one reward loop the game stops for
      this.hitStop = Math.max(this.hitStop, CONFIG.feel.hitStopKill);
      g.cameraRig.addShake(0.08);
    }

    g.audio.enemyDeath(def.threat);
    g.addScrap(def.coins);
    g.onEnemyKilled(e);
  }

  /** BURST: one bounded explosion, once per round. */
  _burst(b, x, y, z, baseDmg) {
    const g = this.game;
    const r = b.burst;
    b.burst = 0;
    g.fx.effects.ring(x, g.arena.floorAt(z) + 0.1, z, 0xe2603c, 1, r * 2, 0.32);
    g.fx.particles.burst(x, y, z, 12, 0xe2603c, {
      speed: r * 2.6, size: 0.4, life: 0.35, spread: 1.0, gravity: 12,
    });
    g.cameraRig.addShake(0.12);
    g.audio.burst();
    const rr = r * r;
    g.enemies.forEachNear(x, z, r, (o) => {
      if (o.dying > 0 || o.hp <= 0) return;
      const dx = o.x - x, dz = o.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr) return;
      o.flash = 1;
      this.damageEnemy(o, baseDmg * 0.6, { color: 0xe2603c });
    });
    if (g.boss && g.boss.alive) {
      const dx = g.boss.x - x, dz = g.boss.z - z;
      if (dx * dx + dz * dz < (r + g.boss.radius) * (r + g.boss.radius)) {
        g.boss.damage(baseDmg * 0.6, x, z);
      }
    }
  }
}
