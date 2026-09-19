import * as THREE from '../../vendor/three/three.module.js';
import { CONFIG } from '../core/config.js';
import { clamp, damp, TAU } from '../core/utils.js';
import { shadowTexture, modelGeometry } from '../world/geometry.js';

const hit = { nx: 0, nz: 0, depth: 0, collider: null };
const UP = new THREE.Vector3(0, 1, 0);

// Which world X direction appears on the right of the screen. The camera looks
// along +Z, so it is -1. Everything that turns screen-space input into world
// movement goes through this, and nothing else needs to know.
const SCREEN_RIGHT_X = -1;

/**
 * The character, and everything that decides where they are and what they
 * shoot at.
 *
 * Movement is conventional and world-aligned: W is up the screen, D is right,
 * always, whatever the character is facing or aiming at. The camera never
 * rolls and never rotates, so "up" means one thing for the entire game. There
 * is no auto-advance — the player is only ever moved by their own input and by
 * things that hit them.
 *
 * Firing is manual. On a mouse the cursor aims and the button fires; on touch
 * the left thumb moves and the right thumb aims and fires. Both schemes put
 * the same decision in front of the player every second: this round, at that
 * wall, or straight at the thing in front of me?
 */
export class Player {
  constructor(scene, game) {
    this.game = game;
    this.x = 0; this.y = 0; this.z = 8;
    this.vx = 0; this.vz = 0;
    this.radius = CONFIG.player.radius;

    this.maxHp = CONFIG.player.maxHp;
    this.hp = this.maxHp;
    this.invuln = 0;
    this.dead = false;

    this.maxAmmo = CONFIG.bullets.magazine;
    this.ammo = this.maxAmmo;
    this.reloadT = 0;
    this.fireT = 0;

    this.aim = 0;            // world angle the weapon points at
    this.facing = 0;         // body yaw, damped toward aim
    this.stride = 0;         // leg yaw, damped toward movement
    this.wantFire = false;
    this.moveX = 0; this.moveZ = 0; this.moveMag = 0;
    this.recoil = 0;
    this.flash = 0;

    this.stats = {
      damage: CONFIG.bullets.damage,
      magazine: CONFIG.bullets.magazine,
      reloadPerShot: CONFIG.bullets.reloadPerShot,
      maxHp: CONFIG.player.maxHp,
    };
    this.bulletColor = new THREE.Color(0xffe9b0);

    this.group = new THREE.Group();
    this._buildMesh();
    scene.add(this.group);
    this.aimLine = new AimLine(scene);

    this._keys = new Set();
    this._movePointer = null;
    this._aimPointer = null;
    this._mouse = { x: 0, y: 0, down: false, active: false };
    this._ray = new THREE.Raycaster();
    this._plane = new THREE.Plane();
    this._ndc = new THREE.Vector2();
    this._pt = new THREE.Vector3();
    this.sticks = { move: null, aim: null };   // read by the HUD to draw them
  }

  // ------------------------------------------------------------------- build

  _buildMesh() {
    const g = this.group;
    this.mat = {
      suit: new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.7, metalness: 0.05, flatShading: true }),
      trim: new THREE.MeshStandardMaterial({ color: 0x3fae9a, roughness: 0.55, metalness: 0.15, flatShading: true }),
      visor: new THREE.MeshBasicMaterial({ color: 0x8ff0e0, toneMapped: true }),
      metal: new THREE.MeshStandardMaterial({ color: 0x53514c, roughness: 0.5, metalness: 0.4, flatShading: true }),
      accent: new THREE.MeshStandardMaterial({ color: 0x3fae9a, roughness: 0.5, metalness: 0.2, flatShading: true }),
    };

    // Legs turn with movement, the torso turns with aim. Two different jobs,
    // and separating them is what stops a strafing character looking like a
    // sliding statue.
    this.legs = new THREE.Group();
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(modelGeometry('p:leg', [
        { shape: 'box', args: [0.4, 0.95, 0.5], pos: [0, 0.48, 0] },
        { shape: 'box', args: [0.46, 0.22, 0.7], pos: [0, 0.11, 0.08] },
      ]), this.mat.trim);
      leg.position.set(s * 0.32, 0, 0);
      this.legs.add(leg);
      if (s < 0) this.legL = leg; else this.legR = leg;
    }
    g.add(this.legs);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.95;
    g.add(this.torso);

    const chest = new THREE.Mesh(modelGeometry('p:chest', [
      { shape: 'box', args: [1.15, 0.95, 0.85], pos: [0, 0.42, 0] },
      { shape: 'box', args: [1.35, 0.3, 0.7], pos: [0, 0.78, -0.02] },
    ]), this.mat.suit);
    this.torso.add(chest);
    this.chest = chest;

    const pack = new THREE.Mesh(modelGeometry('p:pack', [
      { shape: 'box', args: [0.85, 0.7, 0.42], pos: [0, 0.5, -0.6] },
    ]), this.mat.trim);
    this.torso.add(pack);
    this.pack = pack;

    const head = new THREE.Mesh(modelGeometry('p:head', [
      { shape: 'box', args: [0.62, 0.55, 0.62], pos: [0, 1.2, 0] },
      { shape: 'box', args: [0.7, 0.16, 0.66], pos: [0, 1.46, -0.02] },
    ]), this.mat.suit);
    this.torso.add(head);
    this.head = head;

    const visor = new THREE.Mesh(modelGeometry('p:visor', [
      { shape: 'box', args: [0.5, 0.2, 0.1], pos: [0, 1.2, 0.3] },
    ]), this.mat.visor);
    this.torso.add(visor);

    // The weapon is held out to the right, so the barrel line and the aim line
    // agree and a bank shot lands where the player drew it.
    this.arm = new THREE.Group();
    this.arm.position.set(0.42, 0.45, 0.1);
    this.torso.add(this.arm);

    const arms = new THREE.Mesh(modelGeometry('p:arms', [
      { shape: 'box', args: [0.3, 0.3, 0.95], pos: [0, 0, 0.42] },
      { shape: 'box', args: [0.3, 0.3, 0.8], pos: [-0.62, -0.02, 0.3], rot: [0, 0.5, 0] },
    ]), this.mat.suit);
    this.arm.add(arms);

    this.gunBody = new THREE.Mesh(modelGeometry('p:gun', [
      { shape: 'box', args: [0.26, 0.34, 1.5], pos: [0, 0.02, 1.15] },
      { shape: 'box', args: [0.22, 0.5, 0.3], pos: [0, -0.24, 0.62] },
      { shape: 'box', args: [0.18, 0.18, 0.9], pos: [0, 0.22, 1.3] },
    ]), this.mat.metal);
    this.arm.add(this.gunBody);

    this.gunAccent = new THREE.Mesh(modelGeometry('p:gunaccent', [
      { shape: 'box', args: [0.3, 0.16, 0.34], pos: [0, 0.02, 0.75] },
      { shape: 'box', args: [0.22, 0.22, 0.22], pos: [0, 0.03, 1.94] },
    ]), this.mat.accent);
    this.arm.add(this.gunAccent);

    this.muzzleOffset = new THREE.Vector3(0.42, 1.4, 2.1);

    // Contact shadow. This is how the character is kept legible on a busy
    // floor — a real grounded shape, not a halo pasted over the geometry.
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 2.8),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.6 })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    g.add(this.shadow);

    // A thin painted ring, in the character's own accent. It marks where the
    // player is standing without lighting up the floor around them.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.32, 1.5, 32),
      new THREE.MeshBasicMaterial({ color: 0x3fae9a, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.ring.renderOrder = 2;
    g.add(this.ring);
  }

  /** Apply the equipped cosmetics. Colours only — the silhouette never changes. */
  applySkins(character, weapon) {
    this.mat.suit.color.setHex(character.suit);
    this.mat.trim.color.setHex(character.trim);
    this.mat.visor.color.setHex(character.visor);
    this.mat.metal.color.setHex(weapon.metal);
    this.mat.accent.color.setHex(weapon.accent);
    this.ring.material.color.setHex(character.trim);
    this.bulletColor.setHex(weapon.tracer);
    this.aimLine.setColor(character.visor);
  }

  // ------------------------------------------------------------------- input

  attachInput(el) {
    this.el = el;
    const rightHalf = (x) => x > window.innerWidth * 0.42;

    const onDown = (e) => {
      if (this.game.state !== 'playing') return;
      if (e.pointerType === 'mouse') {
        this._mouse.down = true;
        this._mouse.active = true;
        this._mouse.x = e.clientX; this._mouse.y = e.clientY;
        return;
      }
      // Touch: the side of the screen you press decides which stick you get.
      if (rightHalf(e.clientX) && this._aimPointer === null) {
        this._aimPointer = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      } else if (!rightHalf(e.clientX) && this._movePointer === null) {
        this._movePointer = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      }
    };

    const onMove = (e) => {
      if (e.pointerType === 'mouse') {
        this._mouse.x = e.clientX; this._mouse.y = e.clientY;
        this._mouse.active = true;
        return;
      }
      for (const p of [this._movePointer, this._aimPointer]) {
        if (p && p.id === e.pointerId) { p.x = e.clientX; p.y = e.clientY; }
      }
    };

    const onUp = (e) => {
      if (e.pointerType === 'mouse') { this._mouse.down = false; return; }
      if (this._movePointer && this._movePointer.id === e.pointerId) this._movePointer = null;
      if (this._aimPointer && this._aimPointer.id === e.pointerId) this._aimPointer = null;
    };

    el.addEventListener('pointerdown', onDown, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerup', onUp, { passive: true });
    el.addEventListener('pointercancel', onUp, { passive: true });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('keydown', (e) => {
      this._keys.add(e.key.toLowerCase());
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this._keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => { this._keys.clear(); this._mouse.down = false; });
  }

  releaseInput() {
    this._movePointer = null;
    this._aimPointer = null;
    this._mouse.down = false;
    this._keys.clear();
    this.wantFire = false;
  }

  /**
   * Movement, in screen terms. W is up the screen, D is right. Always.
   *
   * The camera looks down +Z, and a camera looking down +Z has world +X on the
   * LEFT of the screen — that is just what the handedness gives you. So screen
   * right is world -X, and every input that means "right" is negated here, in
   * the one place that translates a player's intent into the world. Reading
   * `dx += 1` for D and trusting it is exactly how the old build ended up
   * feeling mirrored.
   */
  _readMove() {
    const k = this._keys;
    let dx = 0, dz = 0;
    if (k.has('a') || k.has('arrowleft')) dx -= SCREEN_RIGHT_X;
    if (k.has('d') || k.has('arrowright')) dx += SCREEN_RIGHT_X;
    if (k.has('w') || k.has('arrowup')) dz += 1;
    if (k.has('s') || k.has('arrowdown')) dz -= 1;
    if (dx || dz) {
      const d = Math.hypot(dx, dz);
      return { dx: dx / d, dz: dz / d, mag: 1 };
    }
    const p = this._movePointer;
    if (p) {
      const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.14;
      let ox = p.x - p.ox, oy = p.y - p.oy;
      const d = Math.hypot(ox, oy);
      if (d > maxR) {
        // re-anchor so the stick never feels stuck against its own edge
        p.ox += (ox / d) * (d - maxR);
        p.oy += (oy / d) * (d - maxR);
        ox = (ox / d) * maxR; oy = (oy / d) * maxR;
      }
      const mag = clamp(Math.hypot(ox, oy) / maxR, 0, 1);
      if (mag > 0.12) {
        const inv = 1 / Math.hypot(ox, oy);
        // screen up is +Z, screen right is -X: the same mapping as the keys
        return { dx: ox * inv * SCREEN_RIGHT_X, dz: -oy * inv, mag };
      }
      return { dx: 0, dz: 0, mag: 0 };
    }
    return { dx: 0, dz: 0, mag: 0 };
  }

  /** Aim and the fire decision, from whichever device is being used. */
  _readAim(camera) {
    const p = this._aimPointer;
    if (p) {
      const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.14;
      const ox = p.x - p.ox, oy = p.y - p.oy;
      const d = Math.hypot(ox, oy);
      if (d > maxR) { p.ox += (ox / d) * (d - maxR); p.oy += (oy / d) * (d - maxR); }
      const nx = p.x - p.ox, ny = p.y - p.oy;
      const nd = Math.hypot(nx, ny);
      if (nd > maxR * 0.25) this.aim = Math.atan2((nx / nd) * SCREEN_RIGHT_X, -ny / nd);
      // Holding the aim stick is the fire decision: let go and you stop.
      this.wantFire = true;
      this.sticks.aim = { ox: p.ox, oy: p.oy, x: p.x, y: p.y, r: maxR };
    } else {
      this.sticks.aim = null;
      if (this._mouse.active) {
        this._ndc.set(
          (this._mouse.x / window.innerWidth) * 2 - 1,
          -((this._mouse.y / window.innerHeight) * 2 - 1)
        );
        this._ray.setFromCamera(this._ndc, camera);
        this._plane.setFromNormalAndCoplanarPoint(UP, this._pt.set(this.x, this.y + 1.2, this.z));
        const p2 = this._ray.ray.intersectPlane(this._plane, this._pt);
        if (p2) {
          const dx = p2.x - this.x, dz = p2.z - this.z;
          if (dx * dx + dz * dz > 0.6) this.aim = Math.atan2(dx, dz);
        }
      }
      this.wantFire = this._mouse.down || this._keys.has(' ') || this._keys.has('spacebar');
    }
    this.sticks.move = this._movePointer
      ? { ox: this._movePointer.ox, oy: this._movePointer.oy, x: this._movePointer.x, y: this._movePointer.y, r: Math.min(window.innerWidth, window.innerHeight) * 0.14 }
      : null;
  }

  // ------------------------------------------------------------------ combat

  get canFire() { return this.ammo >= 1 && this.fireT <= 0 && !this.dead; }

  /** Called by a round on its first wall bounce. The core rule, paid out. */
  refundRound() {
    if (this.ammo >= this.maxAmmo) return;
    this.ammo = Math.min(this.maxAmmo, this.ammo + 1);
    this.game.onRefund();
  }

  heal(n) {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    return this.hp - before;
  }

  takeHit(amount, fromX, fromZ) {
    if (this.invuln > 0 || this.dead || this.godMode) return;
    this.hp -= amount;
    this.invuln = CONFIG.player.invulnAfterHit;
    this.flash = 1;
    const dx = this.x - fromX, dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vx += (dx / d) * CONFIG.player.contactKnockback;
    this.vz += (dz / d) * CONFIG.player.contactKnockback;
    this.game.combat.breakStreak();
    this.game.onPlayerHit(amount);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.game.onPlayerDead(); }
  }

  revive() {
    this.dead = false;
    this.hp = this.maxHp;
    this.ammo = this.maxAmmo;
    this.invuln = 2.5;
  }

  reset(x, z) {
    this.x = x; this.z = z;
    this.vx = 0; this.vz = 0;
    this.maxHp = this.stats.maxHp;
    this.hp = this.maxHp;
    this.maxAmmo = Math.round(this.stats.magazine);
    this.ammo = this.maxAmmo;
    this.reloadT = 0;
    this.fireT = 0;
    this.invuln = 1.0;
    this.dead = false;
    this.aim = 0;
    this.facing = 0;
    this.releaseInput();
  }

  // ------------------------------------------------------------------ update

  update(dt, time, camera) {
    const cfg = CONFIG.player;
    const g = this.game;

    if (this.invuln > 0) this.invuln -= dt;
    if (this.fireT > 0) this.fireT -= dt;
    this.flash = Math.max(0, this.flash - dt * 3);

    if (!this.dead) {
      const mv = this._readMove();
      this._readAim(camera);
      this.moveX = mv.dx; this.moveZ = mv.dz; this.moveMag = mv.mag;

      const speed = cfg.speed;
      this.vx = damp(this.vx, mv.dx * speed * mv.mag, cfg.accel / 4, dt);
      this.vz = damp(this.vz, mv.dz * speed * mv.mag, cfg.accel / 4, dt);

      // Passive reload. Slow enough that bouncing is the real supply line.
      if (this.ammo < this.maxAmmo) {
        this.reloadT += dt;
        const per = Math.max(0.2, this.stats.reloadPerShot);
        if (this.reloadT >= per) { this.reloadT -= per; this.ammo++; g.onReload(); }
      } else {
        this.reloadT = 0;
      }

      if (this.wantFire && this.canFire) this._fire();
      else if (this.wantFire && this.ammo < 1 && this.fireT <= 0) {
        this.fireT = 0.28;
        g.audio.dryFire();
        g.hud?.flashAmmo();
      }
    } else {
      this.vx = damp(this.vx, 0, 7, dt);
      this.vz = damp(this.vz, 0, 7, dt);
      this.moveMag = 0;
      this.wantFire = false;
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Walls: slide along them rather than stopping dead.
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
    this.y = damp(this.y, fy, 10, dt);

    this._present(dt, time);
    this.aimLine.update(this, arena, !this.dead && g.state === 'playing');
  }

  _present(dt, time) {
    const g3 = this.group;
    g3.position.set(this.x, this.y, this.z);

    this.facing = angleDamp(this.facing, this.aim, CONFIG.player.turnRate, dt);
    this.torso.rotation.y = this.facing;

    if (this.moveMag > 0.05) {
      this.stride = angleDamp(this.stride, Math.atan2(this.moveX, this.moveZ), 12, dt);
    }
    this.legs.rotation.y = this.stride;

    // A simple two-beat walk. The legs only move when the player does, which
    // is the cheapest possible way to make movement feel like movement.
    const gait = time * 9;
    const amp = this.moveMag * 0.42;
    this.legL.rotation.x = Math.sin(gait) * amp;
    this.legR.rotation.x = -Math.sin(gait) * amp;
    this.legs.position.y = Math.abs(Math.sin(gait)) * amp * 0.22;

    this.recoil = damp(this.recoil, 0, 14, dt);
    this.arm.position.z = 0.1 - this.recoil * 0.34;
    this.torso.position.y = 0.95 - this.recoil * 0.05 + Math.sin(time * 1.8) * 0.02;

    // A hit is one short white flash on the suit. Invulnerability is shown on
    // the floor ring instead of on the body: tinting the character for most of
    // a second makes the one thing that must always be findable change colour,
    // and it also makes a clean hit and a spent i-frame look identical.
    const f = this.flash;
    this.mat.suit.emissive?.setRGB(f * 0.95, f * 0.92, f * 0.85);
    this.mat.suit.emissiveIntensity = 1;

    const inv = this.invuln > 0 ? (Math.sin(time * 26) * 0.5 + 0.5) : 0;
    this.ring.material.opacity = 0.5 + inv * 0.45;
    this.ring.scale.setScalar(1 + inv * 0.07);

    this.shadow.position.y = 0.04;
    this.ring.rotation.z += dt * 0.4;
  }

  _fire() {
    const g = this.game;
    this.ammo--;
    this.fireT = CONFIG.bullets.fireInterval;
    this.recoil = 1;

    const a = this.aim;
    const ca = Math.cos(a), sa = Math.sin(a);
    // muzzle in world space: the gun sits to the character's right
    const mx = this.x + sa * this.muzzleOffset.z + ca * this.muzzleOffset.x;
    const mz = this.z + ca * this.muzzleOffset.z - sa * this.muzzleOffset.x;
    const my = this.y + this.muzzleOffset.y;

    g.bullets.fire(mx, my, mz, a, { color: this.bulletColor });
    g.fx.particles.cone(mx, my, mz, sa, ca, 3, this.bulletColor.getHex(), {
      speed: 14, size: 0.2, life: 0.12, spread: 0.3, stretch: 2.0, gravity: 0,
    });
    g.audio.fire();
    g.onPlayerFired();
  }
}

/**
 * The aim line.
 *
 * It draws where the round will go and, crucially, where it will go after it
 * hits the wall. The bounce leg is the brighter of the two, because that is
 * the shot the game wants the player to take. This is the tutorial that never
 * stops running: no text, no tooltip, just the answer drawn on the floor.
 */
class AimLine {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 0.5);
    const mk = (opacity) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x8ff0e0, transparent: true, opacity, depthWrite: false, toneMapped: true,
      }));
      m.renderOrder = 3;
      m.visible = false;
      scene.add(m);
      return m;
    };
    this.direct = mk(0.13);
    this.bounce = mk(0.3);
    this.dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.34, 18).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x8ff0e0, transparent: true, opacity: 0.4, depthWrite: false })
    );
    this.dot.renderOrder = 3;
    this.dot.visible = false;
    scene.add(this.dot);
  }

  setColor(hex) {
    this.direct.material.color.setHex(hex);
    this.bounce.material.color.setHex(hex);
    this.dot.material.color.setHex(hex);
  }

  update(p, arena, on) {
    this.direct.visible = this.bounce.visible = this.dot.visible = on;
    if (!on) return;
    const a = p.aim;
    const dx = Math.sin(a), dz = Math.cos(a);
    const y = p.y + 0.09;
    const first = arena.raycast(p.x, p.z, dx, dz, 30);

    place(this.direct, p.x, y, p.z, a, 0.18, first.dist);

    if (first.hit) {
      const dot = dx * first.nx + dz * first.nz;
      const rx = dx - 2 * dot * first.nx;
      const rz = dz - 2 * dot * first.nz;
      const second = arena.raycast(first.x, first.z, rx, rz, 20);
      place(this.bounce, first.x, y, first.z, Math.atan2(rx, rz), 0.26, second.dist);
      this.dot.position.set(first.x, y + 0.01, first.z);
      this.dot.visible = true;
    } else {
      this.bounce.visible = false;
      this.dot.visible = false;
    }
  }
}

function place(mesh, x, y, z, angle, width, length) {
  mesh.position.set(x, y, z);
  mesh.rotation.y = angle;
  mesh.scale.set(width, 1, Math.max(0.1, length));
}

function angleDamp(a, b, rate, dt) {
  const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * (1 - Math.exp(-rate * dt));
}
