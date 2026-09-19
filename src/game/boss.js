import * as THREE from '../../vendor/three/three.module.js';
import { CONFIG, BOSS_DEF } from '../core/config.js';
import { clamp, TAU, damp } from '../core/utils.js';
import { modelGeometry, shadowTexture } from '../world/geometry.js';
import { Bullets, colorHex } from './bullets.js';

const S = { IDLE: 0, WIND: 1, ACT: 2, RECOVER: 3 };

/**
 * THE FOUNDRY.
 *
 * The old boss was forty-six thousand hit points and a bar that went down.
 * This one has twenty-six hundred and four armour plates, and the plates are
 * the fight: a plate only breaks to shots arriving from the quarter it faces,
 * so the player has to keep moving around the thing instead of standing still
 * and holding the trigger. With a plate up, the core barely feels a hit; with
 * a plate gone, that side is open.
 *
 * It runs the same ENGAGE/WIND/ACT/RECOVER grammar as every other enemy, so
 * nothing about it needs explaining once the player has fought an Anvil.
 */
export class Boss {
  constructor(scene, game) {
    this.game = game;
    this.alive = false;
    this.x = 0; this.z = 0; this.floorY = 0;
    this.radius = BOSS_DEF.radius;
    this.hp = BOSS_DEF.hp;
    this.maxHp = BOSS_DEF.hp;
    this.phase = 0;
    this.state = S.IDLE;
    this.stateT = 0;
    this.windFrac = 0;
    this.cooldown = 3;
    this.spawnT = 0;
    this.spin = 0;
    this.flash = 0;
    this.plates = [];

    this.group = new THREE.Group();
    this.group.visible = false;
    this._build();
    scene.add(this.group);
  }

  _build() {
    const shell = new THREE.MeshStandardMaterial({ color: 0x3a3833, roughness: 0.82, metalness: 0.2, flatShading: true });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x565149, roughness: 0.55, metalness: 0.35, flatShading: true });
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, toneMapped: true });

    const base = new THREE.Mesh(modelGeometry('boss:base', [
      { shape: 'cyl', args: [4.0, 4.8, 2.2, 8], pos: [0, 1.1, 0] },
      { shape: 'cyl', args: [3.2, 3.6, 3.4, 8], pos: [0, 3.6, 0] },
      { shape: 'cyl', args: [1.2, 1.2, 2.4, 6], pos: [-2.2, 6.4, 0] },
      { shape: 'cyl', args: [0.9, 0.9, 3.2, 6], pos: [2.0, 6.8, 0.6] },
      { shape: 'box', args: [8.6, 0.7, 8.6], pos: [0, 5.5, 0] },
    ]), shell);
    this.group.add(base);
    this.base = base;

    // The core: exposed at the waist, and visibly hotter as phases advance.
    this.core = new THREE.Mesh(modelGeometry('boss:core', [
      { shape: 'cyl', args: [2.5, 2.5, 1.5, 8], pos: [0, 3.0, 0] },
    ]), this.coreMat);
    this.group.add(this.core);

    // Four plates, one per quarter. Each is its own mesh so it can fall away.
    this.plateGroup = new THREE.Group();
    this.group.add(this.plateGroup);
    for (let i = 0; i < BOSS_DEF.plateCount; i++) {
      const a = (i / BOSS_DEF.plateCount) * TAU;
      const holder = new THREE.Group();
      holder.rotation.y = a;
      const mesh = new THREE.Mesh(modelGeometry('boss:plate', [
        { shape: 'box', args: [5.2, 3.4, 0.8], pos: [0, 3.1, 4.0] },
        { shape: 'box', args: [5.6, 0.5, 1.1], pos: [0, 4.7, 4.0] },
        { shape: 'box', args: [0.7, 3.6, 1.0], pos: [-2.3, 3.1, 4.0] },
        { shape: 'box', args: [0.7, 3.6, 1.0], pos: [2.3, 3.1, 4.0] },
      ]), plateMat.clone());
      holder.add(mesh);
      this.plateGroup.add(holder);
      this.plates.push({ angle: a, hp: BOSS_DEF.plateHp, maxHp: BOSS_DEF.plateHp, holder, mesh, broken: false, fall: 0 });
    }

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
  }

  get hpFrac() { return clamp(this.hp / this.maxHp, 0, 1); }
  get platesLeft() { return this.plates.filter((p) => !p.broken).length; }

  spawn(x, z, floorY, hpMult = 1) {
    this.x = x; this.z = z; this.floorY = floorY;
    this.maxHp = BOSS_DEF.hp * hpMult;
    this.hp = this.maxHp;
    this.phase = 0;
    this.state = S.IDLE;
    this.stateT = 0;
    this.cooldown = 3.5;
    this.spawnT = 4;
    this.alive = true;
    this.flash = 0;
    for (const p of this.plates) {
      p.hp = p.maxHp * hpMult;
      p.maxHp = p.hp;
      p.broken = false;
      p.fall = 0;
      p.mesh.visible = true;
      p.mesh.position.set(0, 0, 0);
      p.mesh.rotation.set(0, 0, 0);
      p.mesh.material.color.setHex(0x565149);
    }
    this.group.visible = true;
    this.group.position.set(x, floorY, z);
    this.shadow.position.y = 0.05;
  }

  despawn() {
    this.alive = false;
    this.group.visible = false;
  }

  get def() { return BOSS_DEF.phases[this.phase]; }

  /** Which plate covers the direction a hit arrived from. */
  _plateFor(fromX, fromZ) {
    const dx = fromX - this.x, dz = fromZ - this.z;
    const a = Math.atan2(dx, dz);
    let best = null, bestD = Infinity;
    for (const p of this.plates) {
      let d = Math.abs(((a - p.angle + Math.PI) % TAU + TAU) % TAU - Math.PI);
      if (d < bestD) { bestD = d; best = p; }
    }
    // a plate covers a 90-degree arc; outside that the shot gets past it
    return bestD < Math.PI / BOSS_DEF.plateCount ? best : null;
  }

  hitTest(b, time) {
    if (!this.alive) return false;
    const dx = b.x - this.x, dz = b.z - this.z;
    const rr = this.radius + CONFIG.bullets.radius;
    if (dx * dx + dz * dz > rr * rr) return false;
    const mult = Bullets.chargeMult(b.charge);
    this.damage(this.game.player.stats.damage * mult, b.x, b.z, colorHex(b));
    if (b.burst) this.game.combat._burst(b, b.x, b.y, b.z, this.game.player.stats.damage * mult);
    if (b.pierceLeft > 0) { b.pierceLeft--; return false; }
    this.game.bullets._kill(b, false);
    return true;
  }

  damage(amount, fromX, fromZ, color = 0xffe9b0) {
    if (!this.alive) return;
    const g = this.game;
    const plate = this._plateFor(fromX ?? this.x, fromZ ?? this.z - 1);

    if (plate && !plate.broken) {
      plate.hp -= amount;
      plate.mesh.material.color.setHex(0x565149).lerp(
        new THREE.Color(0x7a3a2a), 1 - clamp(plate.hp / plate.maxHp, 0, 1)
      );
      g.fx.particles.burst(fromX ?? this.x, this.floorY + 3.2, fromZ ?? this.z, 3, 0xcdbda0, {
        speed: 8, size: 0.25, life: 0.25, spread: 0.5,
      });
      g.audio.bossHit(0.5);
      if (plate.hp <= 0) this._breakPlate(plate);
      // a plated hit still counts, just barely: the lesson is "get around it"
      this.hp -= amount * BOSS_DEF.platedDamageScale;
    } else {
      this.hp -= amount;
      this.flash = 1;
      g.fx.particles.burst(fromX ?? this.x, this.floorY + 3.0, fromZ ?? this.z, 6, 0xff7a3c, {
        speed: 12, size: 0.3, life: 0.3, spread: 0.6, stretch: 1.4,
      });
      g.audio.bossHit(1);
    }

    const frac = this.hpFrac;
    const next = BOSS_DEF.phases.findIndex((p, i) => i > this.phase && frac <= p.at);
    if (next > 0) { this.phase = next; this.game.onBossPhase(BOSS_DEF.phases[next], next); }
    if (this.hp <= 0) { this.hp = 0; this._die(); }
  }

  _breakPlate(p) {
    p.broken = true;
    p.fall = 1;
    const g = this.game;
    const px = this.x + Math.sin(p.angle) * 4.2;
    const pz = this.z + Math.cos(p.angle) * 4.2;
    g.fx.particles.burst(px, this.floorY + 3.2, pz, 18, 0x4a4540, {
      speed: 16, size: 0.45, life: 0.7, spread: 1.6, gravity: 24,
    });
    g.fx.effects.ring(this.x, this.floorY + 0.1, this.z, 0xff7a3c, 5, 12, 0.35);
    g.cameraRig.addShake(0.3);
    g.audio.plateBreak();
    g.hud.bannerLine('PLATE DOWN', `${this.platesLeft} left`);
  }

  _die() {
    this.alive = false;
    this.game.onBossDead();
  }

  update(dt, time) {
    const g = this.game;
    const p = g.player;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.spin += dt * 0.25;

    // broken plates swing open and drop away
    for (const pl of this.plates) {
      if (!pl.broken || pl.fall <= 0) continue;
      pl.fall = Math.max(0, pl.fall - dt * 1.4);
      pl.mesh.rotation.x += dt * 2.2;
      pl.mesh.position.y -= dt * 5;
      pl.mesh.position.z += dt * 3;
      if (pl.fall <= 0) pl.mesh.visible = false;
    }

    if (!this.alive) return;
    const def = this.def;

    if (this.cooldown > 0) this.cooldown -= dt;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = def.spawnInterval;
      this._callAdds();
    }

    const dx = p.x - this.x, dz = p.z - this.z;
    const dist = Math.hypot(dx, dz) || 1;

    if (this.state === S.IDLE) {
      if (this.cooldown <= 0) { this.state = S.WIND; this.stateT = 1.0; this.windFrac = 0; }
    } else if (this.state === S.WIND) {
      this.stateT -= dt;
      this.windFrac = 1 - clamp(this.stateT, 0, 1);
      g.enemies.telegraphs.ring(this, this.x, this.floorY, this.z, BOSS_DEF.slamRadius, this.windFrac, 0xff5a2a);
      if (this.stateT <= 0) { this.state = S.ACT; this.stateT = 0.3; this._slam(); }
    } else if (this.state === S.ACT) {
      this.stateT -= dt;
      if (this.stateT <= 0) { this.state = S.RECOVER; this.stateT = 0.9; }
    } else {
      this.stateT -= dt;
      if (this.stateT <= 0) { this.state = S.IDLE; this.cooldown = def.slamInterval; this.windFrac = 0; }
    }

    // The whole machine turns to follow the player, which is what makes
    // circling to an open side a decision rather than a formality.
    this.group.rotation.y = damp(this.group.rotation.y, Math.atan2(dx, dz), 1.1, dt);
    this.group.position.y = this.floorY + (this.state === S.ACT ? -0.4 : 0);

    const heat = 0.8 + this.windFrac * 1.4 + this.flash * 1.2 + (1 - this.hpFrac) * 0.5;
    this.coreMat.color.setHex(0xff5a2a).multiplyScalar(heat);
  }

  _slam() {
    const g = this.game;
    const p = g.player;
    const R = BOSS_DEF.slamRadius;
    g.fx.effects.ring(this.x, this.floorY + 0.12, this.z, 0xff5a2a, 2, R * 2, 0.45);
    g.fx.particles.burst(this.x, this.floorY + 0.6, this.z, 26, 0xcdbda0, {
      speed: 24, size: 0.5, life: 0.6, spread: 3.5, gravity: 18,
    });
    g.cameraRig.addShake(0.45);
    g.audio.slam();
    const dx = p.x - this.x, dz = p.z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < R + p.radius) {
      p.takeHit(BOSS_DEF.slamDamage, this.x, this.z);
      p.vx += (dx / (d || 1)) * 24;
      p.vz += (dz / (d || 1)) * 24;
    }
  }

  _callAdds() {
    const g = this.game;
    const types = this.phase >= 2 ? ['skitter', 'hornet', 'hornet'] : ['skitter', 'skitter', 'hornet'];
    for (let i = 0; i < BOSS_DEF.spawnCount; i++) {
      const a = (i / BOSS_DEF.spawnCount) * TAU + this.spin;
      const x = this.x + Math.cos(a) * (this.radius + 7);
      const z = this.z + Math.sin(a) * (this.radius + 7);
      const spot = g.arena.freeSpotNear(x, z, 0.5, 8, 1.2);
      const t = types[i % types.length];
      const e = g.enemies.spawn(t, spot ? spot.x : x, spot ? spot.z : z, g.arena.floorAt(z));
      if (e) {
        e.activated = true;
        g.fx.effects.ring(e.x, e.baseY + 0.1, e.z, 0xff7a3c, 0.5, 4, 0.3);
      }
    }
    g.audio.bossCall();
  }

  playDeath() {
    const g = this.game;
    this.alive = false;
    g.audio.bossDeath();
    for (let i = 0; i < 7; i++) {
      setTimeout(() => {
        const a = Math.random() * TAU;
        const r = Math.random() * this.radius;
        const x = this.x + Math.cos(a) * r, z = this.z + Math.sin(a) * r;
        g.fx.particles.burst(x, this.floorY + 1 + Math.random() * 5, z, 16, 0x4a4540, {
          speed: 18, size: 0.5, life: 0.8, spread: 1.6, gravity: 24,
        });
        g.fx.effects.ring(x, this.floorY + 0.1, z, 0xff5a2a, 1, 10, 0.4);
        g.cameraRig.addShake(0.24);
      }, i * 190);
    }
    setTimeout(() => { this.group.visible = false; }, 1500);
  }
}
