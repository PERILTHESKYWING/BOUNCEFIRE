import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { MODIFIERS, MOD_KIND } from '../data/modifiers.js';
import { Pool, clamp } from '../core/utils.js';

const hit = { nx: 0, nz: 0, depth: 0, collider: null };
const MAX_SUBSTEP = 0.32;

/**
 * Bullets are the game. Each one carries a hidden "damage life" pool: enemy
 * hits drain it, wall bounces refill it. Nothing about that number is ever
 * printed — it is communicated entirely through glow, trail length and colour,
 * so the player learns "bouncing keeps my bullets alive" by watching.
 *
 * Rendering is three InstancedMeshes (core, glow, trail ghosts) with matrices
 * written directly into the instance buffers, so a 300-bullet swarm is three
 * draw calls and no per-bullet Object3D overhead.
 */
export class Bullets {
  constructor(scene, game) {
    this.game = game;
    const cfg = CONFIG.bullets;
    this.cap = cfg.maxActive;
    this.ghosts = cfg.trailGhosts;

    this.pool = new Pool(this.cap, () => ({
      x: 0, y: 0, z: 0, vx: 0, vz: 0,
      life: 0, capacity: 0, age: 0, bounces: 0,
      damageMult: 1, sizeMult: 1, critChance: 0, hitCostMult: 1,
      pierce: false, explode: false, explodeRadius: 0, explodeMult: 0,
      splitOnKill: 0, splitsLeft: 0,
      element: null, burnDps: 0, burnTime: 0, slow: 0, slowTime: 0, chilledBonus: 1,
      chainCount: 0, chainRange: 0, chainMult: 0,
      cr: 1, cg: 1, cb: 1,
      lastHit: null, lastHitT: -99,
      trail: new Float32Array(cfg.trailGhosts * 3),
      trailT: 0, trailHead: 0, trailFill: 0,
      dying: 0,
    }));

    // --- core: a stretched octahedron that reads as a tracer round
    const coreGeo = new THREE.OctahedronGeometry(1, 0);
    coreGeo.scale(0.55, 0.55, 1.35);
    const coreMat = new THREE.MeshBasicMaterial({ vertexColors: false, toneMapped: false });
    this.core = new THREE.InstancedMesh(coreGeo, coreMat, this.cap);
    this.core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.core.frustumCulled = false;
    this.core.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.core.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // --- glow: soft additive blob, no billboarding needed
    const glowGeo = new THREE.IcosahedronGeometry(1, 0);
    const glowMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });
    this.glow = new THREE.InstancedMesh(glowGeo, glowMat, this.cap);
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 5;
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.glow.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // --- trail ghosts
    const gCount = this.cap * this.ghosts;
    this.trailMesh = new THREE.InstancedMesh(glowGeo, glowMat.clone(), gCount);
    this.trailMesh.material.opacity = 0.17;
    this.trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trailMesh.frustumCulled = false;
    this.trailMesh.renderOrder = 4;
    this.trailMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(gCount * 3), 3);
    this.trailMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    scene.add(this.trailMesh, this.glow, this.core);

    this.stats = { fired: 0, bounces: 0, modHits: 0 };
  }

  setQuality(ghosts) {
    this.ghosts = Math.min(ghosts, CONFIG.bullets.trailGhosts);
  }

  get count() { return this.pool.count; }

  clear() {
    this.pool.releaseAll();
    this.core.count = 0; this.glow.count = 0; this.trailMesh.count = 0;
  }

  /** Fire one round. `spec` comes from the player's live stats. */
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
    const sp = cfg.speed * (spec.speedMult || 1);
    b.vx = Math.sin(angle) * sp;
    b.vz = Math.cos(angle) * sp;
    b.capacity = cfg.lifeCapacity * (spec.capacityMult || 1);
    b.life = b.capacity;
    b.age = 0; b.bounces = 0; b.dying = 0;
    b.damageMult = 1; b.sizeMult = 1; b.hitCostMult = 1;
    b.critChance = spec.critChance ?? cfg.critChance;
    b.pierce = false; b.explode = false; b.explodeRadius = 0; b.explodeMult = 0;
    b.splitOnKill = 0; b.splitsLeft = cfg.maxSplitPerBullet;
    b.element = null; b.burnDps = 0; b.burnTime = 0; b.slow = 0; b.slowTime = 0; b.chilledBonus = 1;
    b.chainCount = 0; b.chainRange = 0; b.chainMult = 0;
    b.lastHit = null; b.lastHitT = -99;
    b.trailT = 0; b.trailHead = 0; b.trailFill = 0;
    const c = spec.color;
    b.cr = c.r; b.cg = c.g; b.cb = c.b;
    this.stats.fired++;
    return b;
  }

  /** Clone an existing bullet, used by ×2/×3 walls and SPLIT. */
  _clone(src, angleOffset) {
    let b = this.pool.acquire();
    if (!b) {
      const old = this.pool.oldestBy('age');
      if (!old || old === src) return null;
      this._kill(old, false);
      b = this.pool.acquire();
      if (!b) return null;
    }
    const sp = Math.hypot(src.vx, src.vz);
    const a = Math.atan2(src.vx, src.vz) + angleOffset;
    b.x = src.x; b.y = src.y; b.z = src.z;
    b.vx = Math.sin(a) * sp; b.vz = Math.cos(a) * sp;
    b.capacity = src.capacity;
    b.life = Math.max(src.capacity * 0.6, src.life);
    b.age = src.age * 0.5; b.bounces = src.bounces; b.dying = 0;
    b.damageMult = src.damageMult; b.sizeMult = src.sizeMult; b.hitCostMult = src.hitCostMult;
    b.critChance = src.critChance;
    b.pierce = src.pierce; b.explode = src.explode;
    b.explodeRadius = src.explodeRadius; b.explodeMult = src.explodeMult;
    b.splitOnKill = src.splitOnKill; b.splitsLeft = Math.max(0, src.splitsLeft - 1);
    b.element = src.element; b.burnDps = src.burnDps; b.burnTime = src.burnTime;
    b.slow = src.slow; b.slowTime = src.slowTime; b.chilledBonus = src.chilledBonus;
    b.chainCount = src.chainCount; b.chainRange = src.chainRange; b.chainMult = src.chainMult;
    b.cr = src.cr; b.cg = src.cg; b.cb = src.cb;
    b.lastHit = null; b.lastHitT = -99;
    b.trailT = 0; b.trailHead = 0; b.trailFill = 0;
    return b;
  }

  _kill(b, fx = true) {
    if (fx) {
      const g = this.game;
      g.fx.particles.burst(b.x, b.y, b.z, 5, colorHex(b), {
        speed: 6, size: 0.3, life: 0.28, spread: 0.3, gravity: 5, stretch: 0.6,
      });
    }
    this.pool.release(b);
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
      if (b.age > cfg.maxAge || b.life <= 0) { this._kill(b); continue; }
      // off-screen strays keep the visible swarm thin; recycle them
      const pdx = b.x - g.player.x, pdz = b.z - g.player.z;
      if (pdx * pdx + pdz * pdz > cfg.cullDistance * cfg.cullDistance) { this._kill(b, false); continue; }

      // trail sampling
      b.trailT += dt;
      if (b.trailT >= cfg.trailStep) {
        b.trailT = 0;
        const h = b.trailHead * 3;
        b.trail[h] = b.x; b.trail[h + 1] = b.y; b.trail[h + 2] = b.z;
        b.trailHead = (b.trailHead + 1) % CONFIG.bullets.trailGhosts;
        if (b.trailFill < CONFIG.bullets.trailGhosts) b.trailFill++;
      }

      const sp = Math.hypot(b.vx, b.vz);
      let remaining = sp * dt;
      const stepLen = Math.min(MAX_SUBSTEP, Math.max(0.05, remaining));
      const steps = Math.max(1, Math.ceil(remaining / stepLen));
      const sdt = dt / steps;
      let dead = false;

      for (let s = 0; s < steps && !dead; s++) {
        b.x += b.vx * sdt;
        b.z += b.vz * sdt;

        // --- walls
        const r = cfg.radius * b.sizeMult;
        if (arena.collide(b.x, b.z, r, hit)) {
          this._bounce(b, hit, time);
          if (b.life <= 0) { this._kill(b); dead = true; break; }
        }

        // --- enemies
        if (g.enemies) dead = g.enemies.hitTest(b, time, sdt) || dead;
        if (!dead && g.boss && g.boss.alive) dead = g.boss.hitTest(b, time) || dead;
      }
      if (dead) continue;

      // follow the floor as the maze climbs
      const fy = arena.floorAt(b.z) + 1.5;
      b.y += (fy - b.y) * Math.min(1, dt * 8);
    }

    this._writeInstances(time);
  }

  _bounce(b, h, time) {
    const cfg = CONFIG.bullets;
    const g = this.game;
    // resolve penetration, then reflect
    b.x += h.nx * (h.depth + 0.01);
    b.z += h.nz * (h.depth + 0.01);
    const dot = b.vx * h.nx + b.vz * h.nz;
    if (dot < 0) {
      b.vx -= 2 * dot * h.nx;
      b.vz -= 2 * dot * h.nz;
    }
    // tiny scatter stops bullets locking into a perfect parallel corridor
    const jitter = (Math.random() - 0.5) * 0.07;
    const c = Math.cos(jitter), s = Math.sin(jitter);
    const nvx = b.vx * c - b.vz * s;
    const nvz = b.vx * s + b.vz * c;
    b.vx = nvx; b.vz = nvz;

    b.bounces++;
    this.stats.bounces++;

    // THE core rule: walls recharge the hidden damage life
    const before = b.life;
    b.life = Math.min(b.capacity, b.life + cfg.wallRecharge * (g.player.stats.wallRecharge || 1));
    const gained = b.life - before;

    const col = h.collider;
    col.bump = Math.min(1, col.bump + 0.5);

    const hx = b.x - h.nx * 0.3, hz = b.z - h.nz * 0.3;
    const quality = g.quality;
    g.fx.particles.cone(hx, b.y, hz, h.nx, h.nz, quality.low ? 2 : 4, colorHex(b), {
      speed: 11, size: 0.34, life: 0.26, stretch: 2.2,
    });
    if (gained > 0.5) g.fx.effects.flash(hx, b.y, hz, colorHex(b), 1.9, 0.12);
    g.audio.bounce(clamp(0.4 + b.damageMult * 0.18, 0.3, 1.1));

    if (col.mod && col.cooldown <= 0) this._applyModifier(b, col, time);
  }

  _applyModifier(b, col, time) {
    const g = this.game;
    const mod = col.mod;
    col.cooldown = mod.cooldown;
    col.bump = 1;
    this.stats.modHits++;
    const cfg = CONFIG.bullets;

    switch (mod.kind) {
      case MOD_KIND.MULTIPLY: {
        const n = mod.split - 1;
        const spread = (mod.spreadDeg * Math.PI) / 180;
        for (let i = 0; i < n; i++) {
          if (b.splitsLeft <= 0) break;
          const off = (i - (n - 1) / 2) * spread + spread * 0.5;
          const nb = this._clone(b, off === 0 ? spread : off);
          if (nb) tint(nb, mod.color, 0.5);
          b.splitsLeft--;
        }
        break;
      }
      case MOD_KIND.BUFF: {
        if (mod.damageMult) b.damageMult = Math.min(cfg.maxDamageMult, b.damageMult * mod.damageMult);
        if (mod.critAdd) b.critChance = Math.min(1, b.critChance + mod.critAdd);
        if (mod.sizeMult) b.sizeMult = Math.min(2.6, b.sizeMult * mod.sizeMult);
        if (mod.capacityMult) { b.capacity *= mod.capacityMult; b.life = b.capacity; }
        if (mod.hitCostMult) b.hitCostMult = Math.min(b.hitCostMult, mod.hitCostMult);
        if (mod.pierce) b.pierce = true;
        if (mod.splitOnKill) b.splitOnKill = Math.max(b.splitOnKill, mod.splitOnKill);
        if (mod.explode) { b.explode = true; b.explodeRadius = mod.explodeRadius; b.explodeMult = mod.explodeMult; }
        if (mod.element) {
          b.element = mod.element;
          if (mod.burnDps) { b.burnDps = mod.burnDps; b.burnTime = mod.burnTime; }
          if (mod.slow) { b.slow = mod.slow; b.slowTime = mod.slowTime; b.chilledBonus = mod.chilledBonus; }
          if (mod.chainCount) { b.chainCount = mod.chainCount; b.chainRange = mod.chainRange; b.chainMult = mod.chainMult; }
        }
        tint(b, mod.color, 0.72);
        break;
      }
      case MOD_KIND.GLOBAL: {
        g.player.addTimedBuff('fireRate', mod.fireRateMult, mod.duration);
        tint(b, mod.color, 0.5);
        break;
      }
      case MOD_KIND.RESTORE: {
        b.life = b.capacity;
        g.player.addShield(mod.shield);
        tint(b, mod.color, 0.6);
        break;
      }
    }

    g.onModifier(mod, col);
  }

  // --------------------------------------------------------------- rendering

  _writeInstances(time) {
    const list = this.pool.active;
    const cfg = CONFIG.bullets;
    const cm = this.core.instanceMatrix.array;
    const gm = this.glow.instanceMatrix.array;
    const tm = this.trailMesh.instanceMatrix.array;
    const cc = this.core.instanceColor.array;
    const gc = this.glow.instanceColor.array;
    const tc = this.trailMesh.instanceColor.array;

    let gi = 0;
    const maxGhosts = this.ghosts;

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const lifeFrac = clamp(b.life / b.capacity, 0, 1);
      const power = clamp(b.damageMult / 4, 0, 1);
      const r = cfg.radius * b.sizeMult;

      const a = Math.atan2(b.vx, b.vz);
      const ca = Math.cos(a), sa = Math.sin(a);
      const stretch = 1 + power * 0.5;
      const sx = r * (0.85 + lifeFrac * 0.4);
      const sy = sx;
      const sz = r * (1.1 + lifeFrac * 0.5) * stretch;

      // core (rotation about Y + scale, written straight into the buffer)
      let o = i * 16;
      cm[o] = ca * sx;  cm[o + 1] = 0;   cm[o + 2] = -sa * sx; cm[o + 3] = 0;
      cm[o + 4] = 0;    cm[o + 5] = sy;  cm[o + 6] = 0;        cm[o + 7] = 0;
      cm[o + 8] = sa * sz; cm[o + 9] = 0; cm[o + 10] = ca * sz; cm[o + 11] = 0;
      cm[o + 12] = b.x; cm[o + 13] = b.y; cm[o + 14] = b.z;    cm[o + 15] = 1;

      const boost = 1 + power * 0.9;
      const c3 = i * 3;
      cc[c3] = Math.min(4, b.cr * boost + lifeFrac * 0.35);
      cc[c3 + 1] = Math.min(4, b.cg * boost + lifeFrac * 0.35);
      cc[c3 + 2] = Math.min(4, b.cb * boost + lifeFrac * 0.35);

      // glow halo scales with remaining damage life — the only readout there is
      const gs = r * (1.5 + lifeFrac * 1.5 + power * 0.9);
      gm[o] = gs; gm[o + 1] = 0; gm[o + 2] = 0; gm[o + 3] = 0;
      gm[o + 4] = 0; gm[o + 5] = gs; gm[o + 6] = 0; gm[o + 7] = 0;
      gm[o + 8] = 0; gm[o + 9] = 0; gm[o + 10] = gs; gm[o + 11] = 0;
      gm[o + 12] = b.x; gm[o + 13] = b.y; gm[o + 14] = b.z; gm[o + 15] = 1;
      const ga = 0.35 + lifeFrac * 0.65;
      gc[c3] = b.cr * ga; gc[c3 + 1] = b.cg * ga; gc[c3 + 2] = b.cb * ga;

      // trail: length itself encodes remaining life
      const shown = Math.max(1, Math.round(maxGhosts * (0.35 + lifeFrac * 0.65)));
      const have = Math.min(b.trailFill, shown);
      for (let k = 0; k < have; k++) {
        const idx = (b.trailHead - 1 - k + CONFIG.bullets.trailGhosts * 2) % CONFIG.bullets.trailGhosts;
        const p = idx * 3;
        const f = 1 - k / (have + 0.6);
        const ts = r * (1.1 + lifeFrac * 1.0) * f;
        const to = gi * 16;
        tm[to] = ts; tm[to + 1] = 0; tm[to + 2] = 0; tm[to + 3] = 0;
        tm[to + 4] = 0; tm[to + 5] = ts; tm[to + 6] = 0; tm[to + 7] = 0;
        tm[to + 8] = 0; tm[to + 9] = 0; tm[to + 10] = ts; tm[to + 11] = 0;
        tm[to + 12] = b.trail[p]; tm[to + 13] = b.trail[p + 1]; tm[to + 14] = b.trail[p + 2]; tm[to + 15] = 1;
        const t3 = gi * 3;
        const f2 = f * f * (0.5 + lifeFrac * 0.5);
        tc[t3] = b.cr * f2; tc[t3 + 1] = b.cg * f2; tc[t3 + 2] = b.cb * f2;
        gi++;
      }
    }

    this.core.count = list.length;
    this.glow.count = list.length;
    this.trailMesh.count = gi;
    this.core.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    this.trailMesh.instanceMatrix.needsUpdate = true;
    this.core.instanceColor.needsUpdate = true;
    this.glow.instanceColor.needsUpdate = true;
    this.trailMesh.instanceColor.needsUpdate = true;
  }
}

export function colorHex(b) {
  const r = Math.round(clamp(b.cr, 0, 1) * 255);
  const g = Math.round(clamp(b.cg, 0, 1) * 255);
  const bl = Math.round(clamp(b.cb, 0, 1) * 255);
  return (r << 16) | (g << 8) | bl;
}

const _c = new THREE.Color();
function tint(b, hex, amount) {
  _c.setHex(hex);
  b.cr += (_c.r - b.cr) * amount;
  b.cg += (_c.g - b.cg) * amount;
  b.cb += (_c.b - b.cb) * amount;
}
