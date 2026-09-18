import * as THREE from 'three';
import { CONFIG, BOSS_DEF } from '../core/config.js';
import { clamp, TAU, damp } from '../core/utils.js';
import { glowTexture } from '../world/geometry.js';

/**
 * The boss is a huge HP wall, not a precision fight. Its job is to stand still
 * enough that the accumulated swarm can shred it, and to make every thousand
 * damage feel enormous. Mechanics stay to one telegraphed slam and occasional
 * adds, so the player keeps moving without having to read patterns.
 */
export class Boss {
  constructor(scene, game) {
    this.game = game;
    this.scene = scene;
    this.alive = false;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.x = 0; this.y = 0; this.z = 0;
    this.radius = BOSS_DEF.radius;
    this.hp = 0; this.maxHp = 0;
    this.phase = 0;
    this.flash = 0;
    this.slamT = 0;
    this.spawnT = 0;
    this.telegraph = 0;
    this.t = 0;
    this.intro = 0;
    this.dmgAccum = 0;
    this.dmgTimer = 0;
    this._build();
  }

  _build() {
    const g = this.group;
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x1a0f3a, emissive: 0x4b23ff, emissiveIntensity: 1.1,
      roughness: 0.22, metalness: 0.8, flatShading: true,
    });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(this.radius, 1), this.coreMat);
    g.add(this.core);

    this.shellMat = new THREE.MeshBasicMaterial({
      color: 0x7a5bff, transparent: true, opacity: 0.18, wireframe: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(this.radius * 1.3, 2), this.shellMat);
    g.add(this.shell);

    // orbiting rings speed up with each phase
    this.rings = [];
    this.ringPivots = [];
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Object3D();
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(this.radius * (1.22 + i * 0.26), 0.24, 8, 44),
        new THREE.MeshBasicMaterial({ color: 0x9a7bff, toneMapped: false })
      );
      r.rotation.x = Math.PI / 2;      // lies flat, so it always reads as a halo
      r.rotation.z = (i - 1) * 0.3;
      pivot.rotation.y = i * 0.8;
      pivot.add(r);
      g.add(pivot);
      this.rings.push(r);
      this.ringPivots.push(pivot);
    }

    // spikes
    this.spikes = new THREE.Group();
    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a55, emissive: 0x7b2bff, emissiveIntensity: 0.7,
      roughness: 0.3, metalness: 0.7, flatShading: true,
    });
    const spikeGeo = new THREE.ConeGeometry(0.85, 4.2, 4);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const s = new THREE.Mesh(spikeGeo, spikeMat);
      const el = (i % 2 ? 0.5 : -0.35);
      s.position.set(Math.cos(a) * this.radius * 0.95, el * this.radius, Math.sin(a) * this.radius * 0.95);
      s.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        s.position.clone().normalize()
      );
      this.spikes.add(s);
    }
    g.add(this.spikes);
    this.spikeMat = spikeMat;

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(null), color: 0x7a5bff, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.halo.scale.setScalar(this.radius * 3.2);
    g.add(this.halo);

    this.light = new THREE.PointLight(0x7a5bff, 26, 80, 2);
    g.add(this.light);

    // slam telegraph on the floor
    this.slamRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 64),
      new THREE.MeshBasicMaterial({
        color: 0xff4fd0, transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    this.slamRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.slamRing);
  }

  spawn(x, z, floorY, hpMult = 1) {
    this.alive = true;
    this.x = x; this.z = z;
    this.floorY = floorY;
    this.y = floorY + this.radius + 2.2;
    this.maxHp = BOSS_DEF.hp * hpMult * (this.game.difficulty || 1);
    this.hp = this.maxHp;
    this.phase = 0;
    this.flash = 0;
    this.t = 0;
    this.intro = 2.6;
    this.slamT = BOSS_DEF.slamInterval + 3;
    this.spawnT = BOSS_DEF.spawnInterval;
    this.telegraph = 0;
    this.dmgAccum = 0; this.dmgTimer = 0;
    this.group.visible = true;
    this.group.position.set(x, this.y, z);
    this.group.scale.setScalar(0.01);
    this._applyPhase(0);
    this.__dnKey = undefined;
  }

  despawn() {
    this.alive = false;
    this.group.visible = false;
    this.slamRing.material.opacity = 0;
  }

  get hpFrac() { return this.maxHp > 0 ? clamp(this.hp / this.maxHp, 0, 1) : 0; }

  _applyPhase(i) {
    const p = BOSS_DEF.phases[i];
    this.coreMat.emissive.setHex(p.emissive);
    this.spikeMat.emissive.setHex(p.emissive);
    this.shellMat.color.setHex(p.color);
    this.halo.material.color.setHex(p.color);
    this.light.color.setHex(p.color);
    for (const r of this.rings) r.material.color.setHex(p.color);
    this.ringSpeed = p.ringSpeed;
    this.phaseName = p.name;
  }

  /** Bullet vs boss. The boss is generous: bullets barely lose life on it, so
   *  the swarm survives long enough to visibly melt the bar. */
  hitTest(b, time) {
    if (!this.alive || this.intro > 0) return false;
    const dx = b.x - this.x, dz = b.z - this.z;
    const r = this.radius + CONFIG.bullets.radius * b.sizeMult;
    if (dx * dx + dz * dz > r * r) return false;
    if (this === b.lastHit && time - b.lastHitT < 0.1) return false;
    b.lastHit = this; b.lastHitT = time;

    const g = this.game;
    const p = g.player;
    let dmg = p.stats.damage * p.stats.damageMult * b.damageMult * g.combat.damageScale;
    const crit = Math.random() < b.critChance;
    if (crit) dmg *= CONFIG.bullets.critMult;
    g.combat.addHit();
    this.damage(dmg, { crit, color: 0xffffff, bullet: b });

    if (b.explode) g.combat._explode(b, b.x, b.y, b.z, dmg);

    // bounce off the shell so bullets keep working the boss
    const d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d;
    b.x = this.x + nx * (r + 0.05);
    b.z = this.z + nz * (r + 0.05);
    const dot = b.vx * nx + b.vz * nz;
    if (dot < 0) { b.vx -= 2 * dot * nx; b.vz -= 2 * dot * nz; }
    // scatter, or every bullet would run the same straight line back and forth
    const j = (Math.random() - 0.5) * 0.55;
    const jc = Math.cos(j), js = Math.sin(j);
    const bvx = b.vx * jc - b.vz * js;
    b.vz = b.vx * js + b.vz * jc; b.vx = bvx;
    b.life -= CONFIG.bullets.bossHitCost * b.hitCostMult;
    b.life = Math.min(b.capacity, b.life + CONFIG.bullets.wallRecharge * 0.5);
    return b.life <= 0;
  }

  damage(amount, opts = {}) {
    if (!this.alive || this.hp <= 0) return;
    const g = this.game;
    this.hp -= amount;
    this.flash = 1;
    g.combat.totalDamage += amount;

    // aggregate into one large, satisfying number instead of a blizzard
    this.dmgAccum += amount;
    this.dmgTimer -= 1;
    if (this.dmgTimer <= 0) {
      this.dmgTimer = 6;
      g.fx.damageNumbers.add(this, this.x + (Math.random() - 0.5) * 6, this.y + this.radius * 0.6, this.z,
        this.dmgAccum, opts.crit ? 'crit' : 'boss');
      this.dmgAccum = 0;
    }

    g.fx.particles.burst(
      this.x + (Math.random() - 0.5) * this.radius * 1.5,
      this.y + (Math.random() - 0.5) * this.radius,
      this.z + (Math.random() - 0.5) * this.radius * 1.5,
      opts.crit ? 10 : 4, opts.color ?? 0xffffff,
      { speed: 14, size: 0.5, life: 0.35, stretch: 1.8 }
    );
    g.audio.bossHit(1);

    const frac = this.hpFrac;
    const next = BOSS_DEF.phases.findIndex((p, i) => i > this.phase && frac <= p.at);
    if (next > 0) {
      this.phase = next;
      this._applyPhase(next);
      g.onBossPhase(BOSS_DEF.phases[next], next);
    }
    if (this.hp <= 0) this._die();
  }

  _die() {
    const g = this.game;
    this.hp = 0;
    this.alive = false;
    g.onBossDead(this);
  }

  update(dt, time) {
    if (!this.group.visible) return;
    this.t += dt;
    const g = this.game;

    if (this.intro > 0) {
      this.intro -= dt;
      const t = 1 - clamp(this.intro / 2.6, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      this.group.scale.setScalar(0.01 + e * 1.0);
      this.group.rotation.y = (1 - e) * 8;
      if (this.intro <= 0) {
        this.group.scale.setScalar(1);
        g.fx.effects.ring(this.x, this.floorY + 0.2, this.z, 0xff4fd0, 2, 46, 0.9);
        g.cameraRig.addShake(0.9);
        g.audio.bossPhase();
      }
    }

    this.flash = Math.max(0, this.flash - dt * 5);
    const p = BOSS_DEF.phases[this.phase];
    this.coreMat.emissiveIntensity = 1.0 + this.flash * 3.4 + Math.sin(time * 3) * 0.2;
    this.halo.material.opacity = 0.45 + this.flash * 0.5;
    this.light.intensity = 36 + this.flash * 80;

    const rs = this.ringSpeed;
    this.ringPivots[0].rotation.y += dt * rs * 1.5;
    this.ringPivots[1].rotation.y -= dt * rs * 1.1;
    this.ringPivots[2].rotation.y += dt * rs * 0.8;
    this.rings[0].rotation.z = -0.3 + Math.sin(time * rs * 0.8) * 0.14;
    this.rings[2].rotation.z = 0.3 + Math.sin(time * rs * 0.6 + 2) * 0.14;
    this.spikes.rotation.y += dt * rs * 0.35;
    this.core.rotation.y += dt * 0.25;
    this.shell.rotation.y -= dt * 0.4;
    this.shell.rotation.x += dt * 0.18;

    const bob = Math.sin(time * 0.9) * 0.55;
    this.group.position.set(this.x, this.y + bob, this.z);
    this.group.scale.setScalar(this.group.scale.x + (1 - this.group.scale.x) * Math.min(1, dt * 6) + this.flash * 0.02);

    if (!this.alive || this.intro > 0) return;

    // --- slam: one telegraphed area attack, easy to walk out of
    this.slamT -= dt;
    if (this.slamT <= 1.2 && this.telegraph <= 0) {
      this.telegraph = 1.2;
      g.audio.tone({ freq: 90, to: 220, type: 'sawtooth', dur: 1.1, gain: 0.1, filter: 'lowpass', cutoff: 600, cutoffTo: 2200 });
    }
    if (this.telegraph > 0) {
      this.telegraph -= dt;
      const t = 1 - clamp(this.telegraph / 1.2, 0, 1);
      this.slamRing.position.set(this.x, this.floorY + 0.12, this.z);
      this.slamRing.scale.setScalar(BOSS_DEF.slamRadius * (0.25 + t * 0.75));
      this.slamRing.material.opacity = 0.25 + t * 0.55;
      if (this.telegraph <= 0) this._slam();
    } else {
      this.slamRing.material.opacity = damp(this.slamRing.material.opacity, 0, 8, dt);
    }

    // --- adds keep the arena busy and feed the combo
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = BOSS_DEF.spawnInterval;
      for (let i = 0; i < BOSS_DEF.spawnCount; i++) {
        const a = Math.random() * TAU;
        const r = this.radius + 6 + Math.random() * 8;
        const ex = this.x + Math.cos(a) * r, ez = this.z + Math.sin(a) * r;
        const e = g.enemies.spawn(Math.random() < 0.6 ? 'swarmer' : 'grunt', ex, ez, this.floorY);
        if (e) {
          g.enemies.totalCount++;
          g.fx.effects.ring(ex, this.floorY + 0.2, ez, 0xff4fd0, 0.4, 4, 0.4);
          g.fx.particles.burst(ex, this.floorY + 1.5, ez, 8, 0xff4fd0, { speed: 10, size: 0.4, life: 0.4 });
        }
      }
      g.audio.tone({ freq: 160, to: 420, type: 'square', dur: 0.3, gain: 0.07, filter: 'bandpass', cutoff: 1400, q: 2 });
    }
  }

  _slam() {
    const g = this.game;
    this.slamT = BOSS_DEF.slamInterval;
    this.slamRing.material.opacity = 0;
    g.fx.effects.ring(this.x, this.floorY + 0.2, this.z, 0xff4fd0, 2, BOSS_DEF.slamRadius * 1.1, 0.5);
    g.fx.effects.blast(this.x, this.floorY + 2, this.z, 0xff4fd0, BOSS_DEF.slamRadius, 0.4);
    g.fx.particles.burst(this.x, this.floorY + 1.5, this.z, 40, 0xff4fd0, {
      speed: 34, size: 0.8, life: 0.6, spread: 3, gravity: 14, stretch: 2,
    });
    g.cameraRig.addShake(0.85);
    g.audio.bossHit(2.2);
    g.audio.enemyDeath(true);
    const p = g.player;
    const dx = p.x - this.x, dz = p.z - this.z;
    if (dx * dx + dz * dz < BOSS_DEF.slamRadius * BOSS_DEF.slamRadius) {
      p.takeHit(BOSS_DEF.slamDamage, this.x, this.z);
    }
  }

  playDeath() {
    const g = this.game;
    g.audio.bossDeath();
    g.fx.effects.screenFlash('#ffffff', 0.9, 0.8);
    g.cameraRig.addShake(1.4);
    for (let i = 0; i < 26; i++) {
      setTimeout(() => {
        if (!this.group.visible) return;
        const a = Math.random() * TAU;
        const r = Math.random() * this.radius * 2.2;
        const x = this.x + Math.cos(a) * r, z = this.z + Math.sin(a) * r;
        const y = this.y + (Math.random() - 0.5) * this.radius * 2;
        g.fx.particles.burst(x, y, z, 22, i % 3 === 0 ? 0xffffff : 0xff4fd0, {
          speed: 26, size: 0.9, life: 0.8, spread: 2, gravity: 10, stretch: 2,
        });
        g.fx.effects.blast(x, y, z, 0xff4fd0, 8 + Math.random() * 10, 0.4);
        g.cameraRig.addShake(0.3);
        g.audio.enemyDeath(true);
      }, i * 62);
    }
    setTimeout(() => {
      g.fx.effects.ring(this.x, this.floorY + 0.3, this.z, 0xffffff, 3, 70, 1.3);
      g.fx.effects.screenFlash('#ffffff', 1, 1.1);
      this.despawn();
    }, 1750);
  }
}
