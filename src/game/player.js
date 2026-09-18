import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { clamp, damp, TAU } from '../core/utils.js';
import { glowTexture } from '../world/geometry.js';

const hit = { nx: 0, nz: 0, depth: 0, collider: null };

/**
 * One-thumb control: drag anywhere on screen and the ship follows the offset.
 * There is no fire button and no aiming stick — the weapon runs itself, so the
 * only decision the player makes is where to be.
 */
export class Player {
  constructor(scene, game) {
    this.game = game;
    this.x = 0; this.y = 0; this.z = 6;
    this.vx = 0; this.vz = 0;
    this.radius = CONFIG.player.radius;
    this.shield = CONFIG.player.maxShield;
    this.maxShield = CONFIG.player.maxShield;
    this.invuln = 0;
    this.regenT = 0;
    this.dead = false;
    this.fireT = 0;
    this.bank = 0;
    this.thrust = 0;
    this.buffs = {};
    this.stats = {
      damage: CONFIG.bullets.damage,
      fireRateMult: 1,
      bulletCount: CONFIG.bullets.count,
      capacityMult: 1,
      wallRecharge: 1,
      critChance: CONFIG.bullets.critChance,
      damageMult: 1,
      speedMult: 1,
    };
    this.bulletColor = new THREE.Color(0x8ff2ff);

    this.group = new THREE.Group();
    this._buildMesh();
    scene.add(this.group);

    this.input = { active: false, dx: 0, dz: 0, mag: 0 };
    this._keys = new Set();
    this._drag = { id: null, sx: 0, sy: 0, cx: 0, cy: 0 };
  }

  _buildMesh() {
    const g = this.group;
    const accent = 0x6ff0ff;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x13203c, roughness: 0.28, metalness: 0.86,
      emissive: 0x0a2e57, emissiveIntensity: 0.5,
    });
    const glowMat = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });

    const hull = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.6, 6), bodyMat);
    hull.rotation.x = Math.PI / 2;
    hull.position.y = 0.1;
    g.add(hull);

    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.0), glowMat);
    spine.position.set(0, 0.55, -0.1);
    g.add(spine);

    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.75), bodyMat);
      wing.position.set(s * 1.05, 0.05, -0.55);
      wing.rotation.y = s * 0.32;
      wing.rotation.z = s * -0.22;
      g.add(wing);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.75), glowMat);
      tip.position.set(s * 1.72, 0.05, -0.62);
      tip.rotation.y = s * 0.32;
      g.add(tip);
    }

    // muzzle glow, pulses with every shot
    this.muzzle = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.muzzle.position.set(0, 0.18, 1.6);
    g.add(this.muzzle);

    // hover ring on the floor keeps the ship readable against busy geometry
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 2.05, 36),
      new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.material.depthTest = false;
    this.ring.renderOrder = 19;
    g.add(this.ring);

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(null), color: accent, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.halo.scale.setScalar(4.4);
    this.halo.position.y = 0.4;
    // drawn last and without depth testing, so the ship is never lost behind a wall
    this.halo.material.depthTest = false;
    this.halo.renderOrder = 20;
    g.add(this.halo);

    this.light = new THREE.PointLight(accent, 7, 22, 2);
    this.light.position.y = 1.5;
    g.add(this.light);

    // shield bubble, shown when hit
    this.bubble = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.4, 2),
      new THREE.MeshBasicMaterial({
        color: 0x7fd8ff, transparent: true, opacity: 0, wireframe: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    g.add(this.bubble);
  }

  // ------------------------------------------------------------------- input

  attachInput(el) {
    const onDown = (e) => {
      if (this._drag.id !== null) return;
      const p = pointer(e);
      this._drag.id = p.id;
      this._drag.sx = p.x; this._drag.sy = p.y;
      this._drag.cx = p.x; this._drag.cy = p.y;
      this.input.active = true;
    };
    const onMove = (e) => {
      if (this._drag.id === null) return;
      const p = pointer(e, this._drag.id);
      if (!p) return;
      this._drag.cx = p.x; this._drag.cy = p.y;
      const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.16;
      let dx = p.x - this._drag.sx;
      let dy = p.y - this._drag.sy;
      const d = Math.hypot(dx, dy);
      if (d > maxR) {
        // re-anchor so the stick never feels stuck at the edge
        this._drag.sx += (dx / d) * (d - maxR);
        this._drag.sy += (dy / d) * (d - maxR);
        dx = (dx / d) * maxR; dy = (dy / d) * maxR;
      }
      const mag = Math.min(1, Math.hypot(dx, dy) / maxR);
      if (mag > 0.001) {
        const inv = 1 / Math.hypot(dx, dy);
        this.input.dx = dx * inv;
        this.input.dz = -dy * inv;     // screen up is +Z into the maze
      }
      this.input.mag = mag;
    };
    const onUp = (e) => {
      const p = pointer(e, this._drag.id);
      if (this._drag.id !== null && p === null && e.type !== 'pointercancel') return;
      this._drag.id = null;
      this.input.active = false;
      this.input.mag = 0;
    };
    el.addEventListener('pointerdown', onDown, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerup', onUp, { passive: true });
    el.addEventListener('pointercancel', onUp, { passive: true });

    addEventListener('keydown', (e) => this._keys.add(e.key.toLowerCase()));
    addEventListener('keyup', (e) => this._keys.delete(e.key.toLowerCase()));
  }

  _keyVector() {
    const k = this._keys;
    let dx = 0, dz = 0;
    if (k.has('a') || k.has('arrowleft')) dx -= 1;
    if (k.has('d') || k.has('arrowright')) dx += 1;
    if (k.has('w') || k.has('arrowup')) dz += 1;
    if (k.has('s') || k.has('arrowdown')) dz -= 1;
    const d = Math.hypot(dx, dz);
    return d > 0 ? { dx: dx / d, dz: dz / d, mag: 1 } : null;
  }

  // ------------------------------------------------------------------ combat

  addTimedBuff(key, value, duration) {
    const b = this.buffs[key];
    if (b && b.t > 0) { b.t = Math.max(b.t, duration); b.value = Math.min(b.value, value); }
    else this.buffs[key] = { value, t: duration };
  }

  addShield(n) {
    if (this.shield >= this.maxShield) return false;
    this.shield = Math.min(this.maxShield, this.shield + n);
    this.game.onShieldChange();
    this.game.audio.pickup();
    return true;
  }

  takeHit(amount, fromX, fromZ) {
    if (this.invuln > 0 || this.dead) return;
    this.shield -= amount;
    this.invuln = CONFIG.player.invulnAfterHit;
    this.regenT = CONFIG.player.shieldRegenDelay;
    const dx = this.x - fromX, dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vx += (dx / d) * CONFIG.player.contactKnockback;
    this.vz += (dz / d) * CONFIG.player.contactKnockback;
    this.game.onPlayerHit();
    if (this.shield <= 0) { this.shield = 0; this.dead = true; this.game.onPlayerDead(); }
  }

  revive() {
    this.dead = false;
    this.shield = this.maxShield;
    this.invuln = 3.0;
    this.regenT = 0;
  }

  reset(x, z) {
    this.x = x; this.z = z;
    this.vx = 0; this.vz = 0;
    this.shield = this.maxShield;
    this.invuln = 1.2;
    this.dead = false;
    this.fireT = 0;
    this.buffs = {};
    this.input.mag = 0;
  }

  get fireInterval() {
    let m = this.stats.fireRateMult;
    const b = this.buffs.fireRate;
    if (b && b.t > 0) m *= b.value;
    if (this.game.combat.overdriveT > 0) m *= CONFIG.combo.overdriveFireRate;
    return CONFIG.bullets.fireInterval * m;
  }

  // ------------------------------------------------------------------ update

  update(dt, time) {
    const cfg = CONFIG.player;
    const g = this.game;

    for (const k in this.buffs) if (this.buffs[k].t > 0) this.buffs[k].t -= dt;
    if (this.invuln > 0) this.invuln -= dt;

    if (!this.dead) {
      // shield regen after a quiet spell
      if (this.shield < this.maxShield) {
        this.regenT -= dt;
        if (this.regenT <= 0) {
          this.regenT = cfg.shieldRegenTime;
          this.addShield(1);
        }
      }

      let dx = 0, dz = 0, mag = 0;
      const kv = g.attract ? null : this._keyVector();
      if (kv) { dx = kv.dx; dz = kv.dz; mag = 1; }
      else if (this.input.mag > 0.02) { dx = this.input.dx; dz = this.input.dz; mag = this.input.mag; }
      if (g.attract) { dx = this.input.dx; dz = this.input.dz; mag = this.input.mag; }

      const speed = cfg.speed * this.stats.speedMult;
      const tx = dx * speed * mag;
      const tz = dz * speed * mag + cfg.autoAdvance;
      this.vx = damp(this.vx, tx, cfg.accel, dt);
      this.vz = damp(this.vz, tz, cfg.accel, dt);
      this.thrust = damp(this.thrust, mag, 8, dt);
    } else {
      this.vx = damp(this.vx, 0, 6, dt);
      this.vz = damp(this.vz, 0, 6, dt);
      this.thrust = damp(this.thrust, 0, 6, dt);
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // wall resolution: slide rather than stop dead
    const arena = g.arena;
    for (let i = 0; i < 3; i++) {
      if (!arena.collide(this.x, this.z, this.radius, hit)) break;
      this.x += hit.nx * hit.depth;
      this.z += hit.nz * hit.depth;
      const dot = this.vx * hit.nx + this.vz * hit.nz;
      if (dot < 0) { this.vx -= dot * hit.nx; this.vz -= dot * hit.nz; }
    }
    this.x = clamp(this.x, arena.bounds.minX + this.radius, arena.bounds.maxX - this.radius);
    this.z = clamp(this.z, arena.bounds.minZ + this.radius, arena.bounds.maxZ - this.radius);

    const fy = arena.floorAt(this.z);
    this.y = damp(this.y, fy, 9, dt);

    // presentation
    const g3 = this.group;
    g3.position.set(this.x, this.y + cfg.hoverHeight + Math.sin(time * 2.4) * 0.1, this.z);
    this.bank = damp(this.bank, clamp(-this.vx * 0.045, -0.5, 0.5), 8, dt);
    g3.rotation.z = this.bank;
    g3.rotation.x = clamp(-this.vz * 0.006, -0.12, 0.12);
    this.ring.rotation.z += dt * 1.4;
    this.ring.position.y = -(cfg.hoverHeight) + 0.08 + Math.sin(time * 3.1) * 0.04;
    const blink = this.invuln > 0 ? (Math.sin(time * 26) * 0.5 + 0.5) : 1;
    g3.visible = this.invuln > 0 ? blink > 0.35 : true;
    this.muzzle.scale.setScalar(damp(this.muzzle.scale.x, 0.7 + this.thrust * 0.2, 12, dt));
    this.bubble.material.opacity = damp(this.bubble.material.opacity, this.invuln > 0 ? 0.35 : 0, 6, dt);
    this.bubble.rotation.y += dt * 0.8;
    this.bubble.rotation.x += dt * 0.5;

    if (this.thrust > 0.05 && Math.random() < dt * 40 * this.thrust) {
      g.fx.particles.spawn(
        this.x + (Math.random() - 0.5) * 1.2, this.y + 1.2, this.z - 1.4,
        -this.vx * 0.15 + (Math.random() - 0.5) * 2, 0.5, -this.vz * 0.18 - 4,
        0x6ff0ff, 0.4, 0.35, { gravity: -1, drag: 2.5, stretch: 1.4 }
      );
    }

    if (!this.dead) this._autoFire(dt, time);
  }

  _autoFire(dt, time) {
    const g = this.game;
    this.fireT -= dt;
    if (this.fireT > 0) return;
    this.fireT += this.fireInterval;
    if (this.fireT < 0) this.fireT = this.fireInterval;

    const spec = {
      color: this.bulletColor,
      capacityMult: this.stats.capacityMult,
      critChance: this.stats.critChance,
      speedMult: 1,
    };

    // gentle assist: the fantasy is constant action, not marksmanship
    let aim = 0;
    const target = this._nearestAhead(42);
    if (target) {
      const a = Math.atan2(target.x - this.x, target.z - this.z);
      if (Math.abs(a) < 0.95) aim = a * 0.5;
    }

    const n = Math.max(1, Math.round(this.stats.bulletCount));
    const spread = (CONFIG.bullets.spreadDeg * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? (Math.random() - 0.5) * spread * 1.6
        : (i - (n - 1) / 2) * spread + (Math.random() - 0.5) * spread * 0.4;
      g.bullets.fire(this.x, this.y + 1.5, this.z + 1.4, aim + off, spec);
    }

    this.muzzle.scale.setScalar(1.7);
    g.fx.particles.cone(this.x, this.y + 1.5, this.z + 1.8, Math.sin(aim), Math.cos(aim), 2, 0x8ff2ff, {
      speed: 16, size: 0.3, life: 0.16, spread: 0.4, stretch: 2.6, gravity: 0,
    });
    g.audio.fire(1 + Math.random() * 0.06);
  }

  _nearestAhead(range) {
    const g = this.game;
    let best = null, bestD = range * range;
    if (g.boss && g.boss.alive) {
      const dx = g.boss.x - this.x, dz = g.boss.z - this.z;
      if (dz > 0 && dx * dx + dz * dz < bestD * 2.2) return g.boss;
    }
    g.enemies.forEachNear(this.x, this.z + range * 0.45, range, (e) => {
      if (e.dying > 0) return;
      const dx = e.x - this.x, dz = e.z - this.z;
      if (dz < -4) return;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = e; }
    });
    return best;
  }
}

function pointer(e, wantId) {
  const id = e.pointerId ?? 0;
  if (wantId !== undefined && wantId !== null && id !== wantId) return null;
  return { id, x: e.clientX, y: e.clientY };
}
