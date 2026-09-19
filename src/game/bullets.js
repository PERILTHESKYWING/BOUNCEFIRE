import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { MOD_KIND } from '../data/modifiers.js';
import { Pool, clamp } from '../core/utils.js';

const hit = { nx: 0, nz: 0, depth: 0, collider: null };
const MAX_SUBSTEP = 0.3;

/**
 * Rounds are the whole game, and there is exactly one rule about them:
 *
 *   THE FIRST BOUNCE PAYS THE ROUND BACK, AND EVERY BOUNCE ADDS A CHARGE.
 *
 * A round fired straight at something costs you a round and does base damage.
 * The same round banked off a wall first costs nothing and hits for 40% more;
 * three walls deep it hits for 120% more. Charge caps at three. Nothing in the
 * game multiplies on top of it.
 *
 * That is why the magazine is small and the reload is slow. The player is not
 * being asked to conserve ammo, they are being asked to aim at walls — and
 * unlike the old hidden "damage life" pool, they can see every part of it: the
 * ammo pips on the HUD, the chevrons on the round itself, the aim line showing
 * where the bank goes.
 */
export class Bullets {
  constructor(scene, game) {
    this.game = game;
    const cfg = CONFIG.bullets;
    this.cap = cfg.maxActive;
    this.ghosts = cfg.trailGhosts ?? 4;
    this.maxGhosts = 4;

    this.pool = new Pool(this.cap, () => ({
      x: 0, y: 0, z: 0, vx: 0, vz: 0,
      age: 0, bounces: 0, charge: 0,
      pierceLeft: 0, burst: 0, splitUsed: false, refunded: false,
      cr: 1, cg: 1, cb: 1,
      lastHit: null, lastHitT: -99,
      trail: new Float32Array(4 * 3),
      trailT: 0, trailHead: 0, trailFill: 0,
    }));

    // Core: a short stretched wedge. Solid, unlit, one clear shape — a round
    // must be legible against a wall, a floor and an enemy without a halo.
    const coreGeo = new THREE.OctahedronGeometry(1, 0);
    coreGeo.scale(0.5, 0.5, 1.5);
    const coreMat = new THREE.MeshBasicMaterial({ toneMapped: true });
    this.core = new THREE.InstancedMesh(coreGeo, coreMat, this.cap);
    this.core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.core.frustumCulled = false;
    this.core.renderOrder = 6;
    this.core.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.core.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Trail: a few shrinking ghosts, not an additive smear. It exists to show
    // the direction a round came from, which is how a bank shot is read back.
    const ghostGeo = new THREE.OctahedronGeometry(1, 0);
    ghostGeo.scale(0.45, 0.45, 0.9);
    const gCount = this.cap * this.maxGhosts;
    this.trailMesh = new THREE.InstancedMesh(ghostGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.4, depthWrite: false, toneMapped: true,
    }), gCount);
    this.trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trailMesh.frustumCulled = false;
    this.trailMesh.renderOrder = 5;
    this.trailMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(gCount * 3), 3);
    this.trailMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    scene.add(this.trailMesh, this.core);

    this.stats = { fired: 0, bounces: 0, banked: 0, modHits: 0 };
  }

  setQuality(ghosts) { this.ghosts = clamp(ghosts, 1, this.maxGhosts); }

  get count() { return this.pool.count; }

  clear() {
    this.pool.releaseAll();
    this.core.count = 0; this.trailMesh.count = 0;
  }

  /** Fire one round. `spec` carries the player's colour and stats. */
  fire(x, y, z, angle, spec) {
    let b = this.pool.acquire();
    if (!b) {
      const old = this.pool.oldestBy('age');
      if (!old) return null;
      this._kill(old, false);
      b = this.pool.acquire();
      if (!b) return null;
    }
    const cfg = CONFIG.bullets;
    b.x = x; b.y = y; b.z = z;
    b.vx = Math.sin(angle) * cfg.speed;
    b.vz = Math.cos(angle) * cfg.speed;
    b.age = 0; b.bounces = 0; b.charge = 0;
    b.pierceLeft = 0; b.burst = 0; b.splitUsed = false; b.refunded = false;
    b.lastHit = null; b.lastHitT = -99;
    b.trailT = 0; b.trailHead = 0; b.trailFill = 0;
    const c = spec.color;
    b.cr = c.r; b.cg = c.g; b.cb = c.b;
    this.stats.fired++;
    return b;
  }

  /** Copy a round, used only by SPLIT — and SPLIT only fires once per round. */
  _clone(src, angleOffset) {
    const b = this.pool.acquire();
    if (!b) return null;
    const sp = Math.hypot(src.vx, src.vz);
    const a = Math.atan2(src.vx, src.vz) + angleOffset;
    b.x = src.x; b.y = src.y; b.z = src.z;
    b.vx = Math.sin(a) * sp; b.vz = Math.cos(a) * sp;
    b.age = src.age; b.bounces = src.bounces; b.charge = src.charge;
    b.pierceLeft = src.pierceLeft; b.burst = src.burst;
    b.splitUsed = true;                 // children can never split again
    b.refunded = true;                  // and can never refund a second round
    b.cr = src.cr; b.cg = src.cg; b.cb = src.cb;
    b.lastHit = null; b.lastHitT = -99;
    b.trailT = 0; b.trailHead = 0; b.trailFill = 0;
    return b;
  }

  _kill(b, fx = true) {
    if (fx) {
      this.game.fx.particles.burst(b.x, b.y, b.z, 3, colorHex(b), {
        speed: 5, size: 0.18, life: 0.2, spread: 0.2, gravity: 6,
      });
    }
    this.pool.release(b);
  }

  /** Damage multiplier from charge. The only multiplier in the game. */
  static chargeMult(charge) {
    const t = CONFIG.bullets.chargeDamage;
    return t[clamp(charge, 0, t.length - 1)];
  }

  // ------------------------------------------------------------------ update

  update(dt, time) {
    const g = this.game;
    const cfg = CONFIG.bullets;
    const arena = g.arena;
    const list = this.pool.active;

    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.age += dt;
      if (b.age > cfg.maxAge) { this._kill(b); continue; }
      const pdx = b.x - g.player.x, pdz = b.z - g.player.z;
      if (pdx * pdx + pdz * pdz > cfg.cullDistance * cfg.cullDistance) { this._kill(b, false); continue; }

      b.trailT += dt;
      if (b.trailT >= 0.022) {
        b.trailT = 0;
        const h = b.trailHead * 3;
        b.trail[h] = b.x; b.trail[h + 1] = b.y; b.trail[h + 2] = b.z;
        b.trailHead = (b.trailHead + 1) % this.maxGhosts;
        if (b.trailFill < this.maxGhosts) b.trailFill++;
      }

      const sp = Math.hypot(b.vx, b.vz);
      const remaining = sp * dt;
      const stepLen = Math.min(MAX_SUBSTEP, Math.max(0.05, remaining));
      const steps = Math.max(1, Math.ceil(remaining / stepLen));
      const sdt = dt / steps;
      let dead = false;

      for (let s = 0; s < steps && !dead; s++) {
        b.x += b.vx * sdt;
        b.z += b.vz * sdt;

        if (arena.collide(b.x, b.z, cfg.radius, hit)) {
          dead = this._bounce(b, hit, time);
          if (dead) break;
        }
        if (g.enemies) dead = g.enemies.hitTest(b, time) || dead;
        if (!dead && g.boss && g.boss.alive) dead = g.boss.hitTest(b, time) || dead;
      }
      if (dead) continue;

      const fy = arena.floorAt(b.z) + 1.3;
      b.y += (fy - b.y) * Math.min(1, dt * 8);
    }

    this._writeInstances(time);
  }

  /** @returns true if the round was spent by this bounce. */
  _bounce(b, h, time) {
    const cfg = CONFIG.bullets;
    const g = this.game;

    b.x += h.nx * (h.depth + 0.01);
    b.z += h.nz * (h.depth + 0.01);
    const dot = b.vx * h.nx + b.vz * h.nz;
    if (dot < 0) {
      b.vx -= 2 * dot * h.nx;
      b.vz -= 2 * dot * h.nz;
    }

    b.bounces++;
    this.stats.bounces++;

    const col = h.collider;
    col.bump = Math.min(1, col.bump + 0.6);

    if (b.bounces > cfg.maxBounces) {
      // Spent. A tiny puff, nothing more — this happens constantly.
      g.fx.particles.cone(b.x, b.y, b.z, h.nx, h.nz, 2, colorHex(b), {
        speed: 7, size: 0.2, life: 0.18, stretch: 1.4,
      });
      g.audio.bounceSpent();
      this._kill(b, false);
      return true;
    }

    // A bounce charges the round. The round is only paid back if that charged
    // shot goes on to connect — see Combat.bulletHitEnemy. Refunding on the
    // bounce itself made the magazine meaningless, because a miss into a wall
    // is the easiest thing in the game to do.
    if (b.charge < cfg.maxCharge) b.charge++;

    g.fx.particles.cone(b.x, b.y, b.z, h.nx, h.nz, 3, colorHex(b), {
      speed: 9, size: 0.22, life: 0.2, stretch: 1.6,
    });
    g.audio.bounce(b.charge);

    if (col.mod && col.cooldown <= 0) this._applyModifier(b, col, time);
    return false;
  }

  _applyModifier(b, col, time) {
    const g = this.game;
    const mod = col.mod;
    col.cooldown = mod.cooldown;
    col.bump = 1;
    this.stats.modHits++;

    if (mod.kind === MOD_KIND.CHARGE) {
      b.charge = Math.min(CONFIG.bullets.maxCharge, b.charge + mod.charge);
    } else if (mod.id === 'split') {
      if (!b.splitUsed) {
        b.splitUsed = true;
        const spread = (mod.spreadDeg * Math.PI) / 180;
        for (let i = 0; i < mod.split - 1; i++) {
          this._clone(b, (i === 0 ? -1 : 1) * spread);
        }
      }
    } else if (mod.id === 'pierce') {
      b.pierceLeft = Math.max(b.pierceLeft, mod.pierce);
    } else if (mod.id === 'burst') {
      b.burst = mod.burstRadius;
    }

    g.onModifier(mod, col, b);
  }

  // --------------------------------------------------------------- rendering

  _writeInstances() {
    const list = this.pool.active;
    const cfg = CONFIG.bullets;
    const cm = this.core.instanceMatrix.array;
    const tm = this.trailMesh.instanceMatrix.array;
    const cc = this.core.instanceColor.array;
    const tc = this.trailMesh.instanceColor.array;

    let gi = 0;
    const maxGhosts = this.ghosts;

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      // Charge is shown as size and heat, in three obvious steps.
      const ch = b.charge / cfg.maxCharge;
      const r = cfg.radius * (1 + ch * 0.55);
      const a = Math.atan2(b.vx, b.vz);
      const ca = Math.cos(a), sa = Math.sin(a);
      const sx = r, sy = r, sz = r * (1.35 + ch * 0.5);

      const o = i * 16;
      cm[o] = ca * sx;     cm[o + 1] = 0;   cm[o + 2] = -sa * sx; cm[o + 3] = 0;
      cm[o + 4] = 0;       cm[o + 5] = sy;  cm[o + 6] = 0;        cm[o + 7] = 0;
      cm[o + 8] = sa * sz; cm[o + 9] = 0;   cm[o + 10] = ca * sz; cm[o + 11] = 0;
      cm[o + 12] = b.x;    cm[o + 13] = b.y; cm[o + 14] = b.z;    cm[o + 15] = 1;

      // tint toward ember as it charges, never past white
      const c3 = i * 3;
      cc[c3] = Math.min(1.6, b.cr + ch * 0.5);
      cc[c3 + 1] = Math.min(1.6, b.cg * (1 - ch * 0.18) + ch * 0.2);
      cc[c3 + 2] = Math.max(0.1, b.cb * (1 - ch * 0.55));

      const have = Math.min(b.trailFill, maxGhosts);
      for (let k = 0; k < have; k++) {
        const idx = (b.trailHead - 1 - k + this.maxGhosts * 2) % this.maxGhosts;
        const p = idx * 3;
        const f = 1 - k / (have + 0.5);
        const ts = r * 0.8 * f;
        const to = gi * 16;
        tm[to] = ca * ts;     tm[to + 1] = 0;   tm[to + 2] = -sa * ts; tm[to + 3] = 0;
        tm[to + 4] = 0;       tm[to + 5] = ts;  tm[to + 6] = 0;        tm[to + 7] = 0;
        tm[to + 8] = sa * ts; tm[to + 9] = 0;   tm[to + 10] = ca * ts; tm[to + 11] = 0;
        tm[to + 12] = b.trail[p]; tm[to + 13] = b.trail[p + 1]; tm[to + 14] = b.trail[p + 2]; tm[to + 15] = 1;
        const t3 = gi * 3;
        tc[t3] = cc[c3] * f; tc[t3 + 1] = cc[c3 + 1] * f; tc[t3 + 2] = cc[c3 + 2] * f;
        gi++;
      }
    }

    this.core.count = list.length;
    this.trailMesh.count = gi;
    this.core.instanceMatrix.needsUpdate = true;
    this.trailMesh.instanceMatrix.needsUpdate = true;
    this.core.instanceColor.needsUpdate = true;
    this.trailMesh.instanceColor.needsUpdate = true;
  }
}

export function colorHex(b) {
  const r = Math.round(clamp(b.cr, 0, 1) * 255);
  const g = Math.round(clamp(b.cg, 0, 1) * 255);
  const bl = Math.round(clamp(b.cb, 0, 1) * 255);
  return (r << 16) | (g << 8) | bl;
}
