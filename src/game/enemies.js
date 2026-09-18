import * as THREE from 'three';
import { CONFIG, ENEMY_TYPES } from '../core/config.js';
import { Pool, clamp, TAU } from '../core/utils.js';
import { enemyGeometry, glowTexture } from '../world/geometry.js';
import { colorHex } from './bullets.js';

const ECELL = 5;
const hit = { nx: 0, nz: 0, depth: 0, collider: null };

/**
 * Enemies are quantity-first: readable silhouettes, strong colours, and death
 * effects worth watching. Each type is one InstancedMesh plus an additive glow
 * shell, so a hundred of them cost a handful of draw calls.
 */
export class Enemies {
  constructor(scene, game) {
    this.game = game;
    this.scene = scene;
    this.types = {};
    this.grid = new Map();
    this.aliveCount = 0;
    this.totalCount = 0;

    const cap = 180;
    this.pool = new Pool(cap, () => ({
      type: null, x: 0, y: 0, z: 0, homeX: 0, homeZ: 0, hp: 0, maxHp: 0,
      vx: 0, vz: 0, phase: 0, spin: 0, flash: 0, scale: 1,
      burnT: 0, burnDps: 0, slowT: 0, slow: 0, chilled: 0,
      fireT: 0, activated: false, dying: 0, spawnT: 0, hitAccum: 0, rallyT: 0,
      __dnKey: undefined,
    }));

    for (const [id, def] of Object.entries(ENEMY_TYPES)) {
      const geo = enemyGeometry(def.shape, def.size);
      const mat = new THREE.MeshStandardMaterial({
        color: def.color, emissive: def.emissive, emissiveIntensity: 0.65,
        roughness: 0.34, metalness: 0.45, flatShading: true,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;

      const glowMat = new THREE.MeshBasicMaterial({
        color: def.emissive, transparent: true, opacity: 0.13,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const glow = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(def.size * 1.5, 0), glowMat, cap);
      glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      glow.frustumCulled = false;
      glow.renderOrder = 3;
      glow.count = 0;

      scene.add(glow, mesh);
      this.types[id] = { def, mesh, glow, list: [], baseColor: new THREE.Color(def.color) };
    }

    this.projectiles = new EnemyProjectiles(scene, game);
    this._o = new THREE.Object3D();
    this._c = new THREE.Color();
  }

  clear() {
    this.pool.releaseAll();
    for (const t of Object.values(this.types)) { t.list.length = 0; t.mesh.count = 0; t.glow.count = 0; }
    this.projectiles.clear();
    this.aliveCount = 0; this.totalCount = 0;
  }

  spawnFromArena(arena) {
    this.clear();
    for (const s of arena.spawns) this.spawn(s.type, s.x, s.z, arena.floorAt(s.z));
    this.totalCount = this.aliveCount;
  }

  spawn(typeId, x, z, floorY) {
    const def = ENEMY_TYPES[typeId];
    if (!def) return null;
    const e = this.pool.acquire();
    if (!e) return null;
    e.type = typeId;
    e.x = x; e.z = z;
    e.homeX = x; e.homeZ = z;
    e.y = (floorY ?? this.game.arena.floorAt(z)) + def.size * 0.95;
    e.baseY = e.y;
    e.hp = def.hp * (this.game.difficulty || 1);
    e.maxHp = e.hp;
    e.vx = 0; e.vz = 0;
    e.phase = Math.random() * TAU;
    e.spin = (Math.random() - 0.5) * 1.6;
    e.flash = 0; e.scale = 0.01; e.spawnT = 0;
    e.burnT = 0; e.slowT = 0; e.chilled = 0; e.dying = 0;
    e.fireT = Math.random() * (def.fireInterval || 2);
    e.activated = false;
    e.rallyT = 0;
    e.__dnKey = undefined;
    this.types[typeId].list.push(e);
    this.aliveCount++;
    return e;
  }

  // ------------------------------------------------------------- broad phase

  _rebuildGrid() {
    this.grid.clear();
    for (const e of this.pool.active) {
      if (e.dying > 0) continue;
      const gx = Math.floor(e.x / ECELL), gz = Math.floor(e.z / ECELL);
      const k = gx * 73856093 ^ gz * 19349663;
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(e);
    }
  }

  forEachNear(x, z, radius, fn) {
    const c = Math.ceil(radius / ECELL);
    const gx = Math.floor(x / ECELL), gz = Math.floor(z / ECELL);
    for (let ix = gx - c; ix <= gx + c; ix++) {
      for (let iz = gz - c; iz <= gz + c; iz++) {
        const arr = this.grid.get(ix * 73856093 ^ iz * 19349663);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) fn(arr[i]);
      }
    }
  }

  /** Bullet vs enemies. Returns true if the bullet was consumed. */
  hitTest(b, time) {
    const g = this.game;
    const br = CONFIG.bullets.radius * b.sizeMult;
    let consumed = false;
    const gx = Math.floor(b.x / ECELL), gz = Math.floor(b.z / ECELL);
    for (let ix = gx - 1; ix <= gx + 1 && !consumed; ix++) {
      for (let iz = gz - 1; iz <= gz + 1 && !consumed; iz++) {
        const arr = this.grid.get(ix * 73856093 ^ iz * 19349663);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const e = arr[i];
          if (e.dying > 0 || e.hp <= 0) continue;
          if (e === b.lastHit && time - b.lastHitT < 0.22) continue;
          const dx = e.x - b.x, dz = e.z - b.z;
          const rr = ENEMY_TYPES[e.type].radius + br;
          if (dx * dx + dz * dz > rr * rr) continue;

          b.lastHit = e; b.lastHitT = time;
          g.combat.bulletHitEnemy(b, e);

          // enemy hits drain the hidden life; walls are what give it back
          b.life -= CONFIG.bullets.hitCost * b.hitCostMult;
          if (b.life <= 0) { consumed = true; break; }
          if (!b.pierce) {
            // non-piercing rounds lose a little speed punching through
            b.vx *= 0.97; b.vz *= 0.97;
          }
        }
      }
    }
    return consumed;
  }

  // ------------------------------------------------------------------ update

  update(dt, time) {
    this._rebuildGrid();
    const g = this.game;
    const p = g.player;
    const cfg = CONFIG.enemies;
    const arena = g.arena;

    for (const t of Object.values(this.types)) t.list.length = 0;

    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const def = ENEMY_TYPES[e.type];

      if (e.dying > 0) {
        e.dying -= dt;
        e.scale = Math.max(0, e.dying / 0.16);
        if (e.dying <= 0) { this.pool.release(e); continue; }
        this.types[e.type].list.push(e);
        continue;
      }

      e.spawnT += dt;
      e.scale = Math.min(1, e.spawnT * 3.2);
      e.flash = Math.max(0, e.flash - dt * 6);

      // status effects
      if (e.burnT > 0) {
        e.burnT -= dt;
        e.hitAccum += e.burnDps * e.maxHp * dt * 0.06;
        if (e.hitAccum > e.maxHp * 0.012 || e.burnT <= 0) {
          g.combat.damageEnemy(e, e.hitAccum, { kind: 'burn', silent: true, color: 0xff6b2c });
          e.hitAccum = 0;
        }
        if (Math.random() < dt * 14) {
          g.fx.particles.spawn(e.x + (Math.random() - 0.5), e.y, e.z + (Math.random() - 0.5),
            0, 2 + Math.random() * 2, 0, 0xff6b2c, 0.42, 0.42, { gravity: -1.5, drag: 1.2 });
        }
        if (e.hp <= 0) continue;
      }
      let speedMul = 1;
      if (e.slowT > 0) { e.slowT -= dt; speedMul = 1 - e.slow; e.chilled = 1; }
      else e.chilled = 0;

      const dxp = p.x - e.x, dzp = p.z - e.z;
      const distp = Math.hypot(dxp, dzp);
      if (!e.activated && distp < cfg.activationRange) e.activated = true;

      // Enemies defend the stretch of maze they were placed in. That keeps each
      // chamber a real encounter and stops cleared areas from refilling behind
      // the player, which would turn the clear objective into backtracking.
      const closeout = this.aliveCount <= cfg.closeoutAt;
      if (closeout) e.activated = true;

      // Rally: once only stragglers remain, any that cannot reach the player
      // within a few seconds warp to them. Hunting one enemy wedged behind a
      // wall is the worst way for a level to end.
      if (closeout && distp > 34) {
        e.rallyT += dt;
        if (e.rallyT > 3.5) {
          e.rallyT = 0;
          const spot = g.arena.freeSpotNear(p.x, p.z, 16, 26, def.radius);
          if (spot) {
            g.fx.effects.ring(e.x, e.y - 0.6, e.z, def.emissive, 0.5, 7, 0.4);
            g.fx.particles.burst(e.x, e.y, e.z, 12, def.emissive, { speed: 12, size: 0.5, life: 0.4 });
            e.x = spot.x; e.z = spot.z;
            e.homeX = spot.x; e.homeZ = spot.z;
            e.vx = 0; e.vz = 0;
            e.spawnT = 0; e.scale = 0.2;
            g.fx.effects.ring(e.x, g.arena.floorAt(e.z) + 0.2, e.z, def.emissive, 0.5, 9, 0.5);
            g.fx.particles.burst(e.x, e.y, e.z, 16, def.emissive, { speed: 14, size: 0.55, life: 0.45 });
            g.audio.tone({ freq: 520, to: 180, type: 'square', dur: 0.22, gain: 0.06, filter: 'bandpass', cutoff: 1500, q: 2 });
          }
        }
      } else if (e.rallyT !== 0) e.rallyT = 0;
      const homeDx = e.homeX - e.x, homeDz = e.homeZ - e.z;
      const homeDist = Math.hypot(homeDx, homeDz);
      const engaged = closeout || (e.activated && homeDist < cfg.leash && distp < cfg.leash * 1.5);
      const approach = closeout ? cfg.approachBoost : 1;

      e.phase += dt * (1.6 + e.spin);

      if (!engaged && homeDist > 3.5) {
        // drift back to post
        const inv = 1 / homeDist;
        const sp = def.speed * speedMul * 0.8;
        e.vx += homeDx * inv * sp * dt * 3.0;
        e.vz += homeDz * inv * sp * dt * 3.0;
      } else if (engaged) {
        const sp = def.speed * speedMul * approach;
        if (def.behaviour === 'chase') {
          const inv = distp > 0.001 ? 1 / distp : 0;
          e.vx += dxp * inv * sp * dt * 3.4;
          e.vz += dzp * inv * sp * dt * 3.4;
        } else if (def.behaviour === 'orbit') {
          const inv = distp > 0.001 ? 1 / distp : 0;
          const tx = dxp * inv, tz = dzp * inv;
          const want = 14;
          const radial = (distp - want) * 0.12;
          e.vx += (tx * radial + -tz * 0.9) * sp * dt * 3.0;
          e.vz += (tz * radial + tx * 0.9) * sp * dt * 3.0;
        } else if (def.behaviour === 'shoot') {
          const inv = distp > 0.001 ? 1 / distp : 0;
          const want = 20;
          const radial = clamp((distp - want) * 0.1, -1, 1);
          e.vx += tSign(dxp * inv) * Math.abs(dxp * inv) * radial * sp * dt * 3;
          e.vz += tSign(dzp * inv) * Math.abs(dzp * inv) * radial * sp * dt * 3;
          e.fireT -= dt * speedMul;
          if (e.fireT <= 0 && distp < 48) {
            e.fireT = def.fireInterval;
            this.projectiles.fire(e.x, e.y, e.z, dxp * inv, dzp * inv, def);
            g.audio.tone({ freq: 300, to: 180, type: 'sawtooth', dur: 0.14, gain: 0.05, filter: 'lowpass', cutoff: 1600 });
          }
        }

      }

      if (engaged || homeDist > 3.5) {
        // light separation keeps a crowd legible instead of a single blob
        this.forEachNear(e.x, e.z, 3.2, (o) => {
          if (o === e) return;
          const ox = e.x - o.x, oz = e.z - o.z;
          const d2 = ox * ox + oz * oz;
          if (d2 > 9 || d2 < 1e-5) return;
          const d = Math.sqrt(d2);
          const f = (3 - d) / 3 * cfg.separation * 9;
          e.vx += (ox / d) * f * dt;
          e.vz += (oz / d) * f * dt;
        });
      }

      // damping + integrate
      const dragF = Math.exp(-4.5 * dt);
      e.vx *= dragF; e.vz *= dragF;
      e.x += e.vx * dt; e.z += e.vz * dt;

      // Walls: slide along the surface and steer around the corner toward the
      // player. Without this, chasers jam flat against maze geometry and the
      // level turns into hunting stragglers instead of fighting a swarm.
      const r = def.radius * 0.85;
      if (arena.collide(e.x, e.z, r, hit)) {
        e.x += hit.nx * hit.depth;
        e.z += hit.nz * hit.depth;
        const dot = e.vx * hit.nx + e.vz * hit.nz;
        if (dot < 0) { e.vx -= dot * hit.nx; e.vz -= dot * hit.nz; }
        if (engaged) {
          const tx = -hit.nz, tz = hit.nx;
          const s = ((p.x - e.x) * tx + (p.z - e.z) * tz) >= 0 ? 1 : -1;
          e.vx += tx * s * def.speed * 2.4 * dt;
          e.vz += tz * s * def.speed * 2.4 * dt;
        }
      }

      const fy = arena.floorAt(e.z) + def.size * 0.95;
      e.baseY = fy;
      e.y = fy + Math.sin(e.phase * 0.9) * 0.28;

      // contact damage
      if (distp < def.radius + p.radius && p.invuln <= 0) {
        p.takeHit(def.contact, e.x, e.z);
      }

      this.types[e.type].list.push(e);
    }

    this.projectiles.update(dt);
    this._writeInstances(time);
  }

  killed(e) {
    this.aliveCount = Math.max(0, this.aliveCount - 1);
    e.dying = 0.16;
  }

  _writeInstances(time) {
    const o = this._o;
    for (const t of Object.values(this.types)) {
      const { mesh, glow, list, def, baseColor } = t;
      const cm = mesh.instanceMatrix.array;
      const gm = glow.instanceMatrix.array;
      const cc = mesh.instanceColor.array;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const s = e.scale * (1 + e.flash * 0.28);
        o.position.set(e.x, e.y, e.z);
        o.rotation.set(Math.sin(e.phase * 0.5) * 0.35, e.phase * 0.55, Math.cos(e.phase * 0.42) * 0.3);
        o.scale.setScalar(s);
        o.updateMatrix();
        o.matrix.toArray(cm, i * 16);

        const gs = s * (1 + e.flash * 0.9);
        const go = i * 16;
        gm[go] = gs; gm[go + 1] = 0; gm[go + 2] = 0; gm[go + 3] = 0;
        gm[go + 4] = 0; gm[go + 5] = gs; gm[go + 6] = 0; gm[go + 7] = 0;
        gm[go + 8] = 0; gm[go + 9] = 0; gm[go + 10] = gs; gm[go + 11] = 0;
        gm[go + 12] = e.x; gm[go + 13] = e.y; gm[go + 14] = e.z; gm[go + 15] = 1;

        const c3 = i * 3;
        const f = e.flash;
        const chill = e.chilled;
        cc[c3] = baseColor.r * (1 - chill * 0.5) + f * 3.0;
        cc[c3 + 1] = baseColor.g * (1 - chill * 0.2) + f * 3.0;
        cc[c3 + 2] = baseColor.b * (1 + chill * 0.9) + f * 3.0;
      }
      mesh.count = list.length;
      glow.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }
}

function tSign(v) { return v; }

/** Slow, readable enemy shots. They exist to give the player something to dodge
 *  around, not to punish precision. */
class EnemyProjectiles {
  constructor(scene, game) {
    this.game = game;
    const cap = 80;
    this.pool = new Pool(cap, () => ({ x: 0, y: 0, z: 0, vx: 0, vz: 0, life: 0, dmg: 1 }));
    const geo = new THREE.IcosahedronGeometry(0.52, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4ef2a1, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x4ef2a1, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.glow = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.5, 0), glowMat, cap);
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 4;
    this.glow.count = 0;
    scene.add(this.glow, this.mesh);
  }

  clear() { this.pool.releaseAll(); this.mesh.count = 0; this.glow.count = 0; }

  fire(x, y, z, dx, dz, def) {
    const p = this.pool.acquire();
    if (!p) return;
    p.x = x; p.y = y; p.z = z;
    p.vx = dx * def.projectileSpeed; p.vz = dz * def.projectileSpeed;
    p.life = 4.5; p.dmg = def.projectileDamage;
  }

  update(dt) {
    const g = this.game;
    const pl = g.player;
    const list = this.pool.active;
    const m = this.mesh.instanceMatrix.array;
    const gm = this.glow.instanceMatrix.array;
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.y = g.arena.floorAt(p.z) + 1.5;
      if (p.life <= 0) { this.pool.release(p); continue; }
      if (g.arena.collide(p.x, p.z, 0.5, hit)) {
        g.fx.particles.cone(p.x, p.y, p.z, hit.nx, hit.nz, 4, 0x4ef2a1, { speed: 8, size: 0.3, life: 0.25 });
        this.pool.release(p); continue;
      }
      const dx = pl.x - p.x, dz = pl.z - p.z;
      if (dx * dx + dz * dz < (pl.radius + 0.6) * (pl.radius + 0.6)) {
        pl.takeHit(p.dmg, p.x, p.z);
        g.fx.particles.burst(p.x, p.y, p.z, 8, 0x4ef2a1, { speed: 9, size: 0.34, life: 0.3 });
        this.pool.release(p); continue;
      }
      const o = n * 16;
      for (let k = 0; k < 16; k++) m[o + k] = k % 5 === 0 ? 1 : 0;
      m[o + 12] = p.x; m[o + 13] = p.y; m[o + 14] = p.z; m[o + 15] = 1;
      for (let k = 0; k < 16; k++) gm[o + k] = k % 5 === 0 ? 1 : 0;
      gm[o + 12] = p.x; gm[o + 13] = p.y; gm[o + 14] = p.z; gm[o + 15] = 1;
      n++;
    }
    this.mesh.count = n; this.glow.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
  }
}
