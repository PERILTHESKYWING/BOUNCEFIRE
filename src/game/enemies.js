import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { ENEMY_TYPES, ENEMY_SHELL, ENEMY_PLATE } from '../data/enemies.js';
import { Pool, clamp, TAU, damp } from '../core/utils.js';
import { modelGeometry, shadowTexture } from '../world/geometry.js';

const ECELL = 5;
const hit = { nx: 0, nz: 0, depth: 0, collider: null };

// Every attack in the game runs the same four-beat loop, so a player who
// learns one enemy has already half-learned the rest:
//   ENGAGE -> WIND (a mark appears on the floor) -> ACT -> RECOVER
const S = { ENGAGE: 0, WIND: 1, ACT: 2, RECOVER: 3 };

/**
 * The cast.
 *
 * Each type is drawn as four instanced meshes — shell, armour plate, signal
 * and limbs — built by merging its parts table at boot. That is what buys the
 * silhouettes: a Skitter is a six-legged crab and a Lancer is a tripod, and
 * forty of them together still cost about twenty draw calls.
 *
 * Nothing here is emissive. An enemy's only colour is its core, and the warmth
 * of that core is the threat scale, so a new enemy is readable before it has
 * done anything.
 */
export class Enemies {
  constructor(scene, game) {
    this.game = game;
    this.scene = scene;
    this.types = {};
    this.grid = new Map();
    this.aliveCount = 0;
    this.totalCount = 0;

    const cap = CONFIG.enemies.maxAlive;
    this.cap = cap;
    this.pool = new Pool(cap, () => ({
      type: null, x: 0, y: 0, z: 0, baseY: 0, homeX: 0, homeZ: 0,
      hp: 0, maxHp: 0, vx: 0, vz: 0,
      face: 0, phase: 0, flash: 0, scale: 1,
      state: S.ENGAGE, stateT: 0, cooldown: 0, windFrac: 0,
      aimX: 0, aimZ: 1, chamber: 0,
      activated: false, dying: 0, spawnT: 0, rallyT: 0, frozen: false,
    }));

    const shellMat = new THREE.MeshStandardMaterial({ color: ENEMY_SHELL, roughness: 0.85, metalness: 0.08, flatShading: true });
    const plateMat = new THREE.MeshStandardMaterial({ color: ENEMY_PLATE, roughness: 0.6, metalness: 0.25, flatShading: true });

    for (const [id, def] of Object.entries(ENEMY_TYPES)) {
      const m = def.model;
      const entry = { def, list: [], signalColor: new THREE.Color(def.signal) };

      entry.shell = this._instanced(modelGeometry(`${id}:shell`, m.shell), shellMat.clone(), cap, true);
      entry.plate = this._instanced(modelGeometry(`${id}:plate`, m.plate), plateMat.clone(), cap, true);
      // Signal parts are unlit so a core reads the same in every room.
      entry.signal = this._instanced(
        modelGeometry(`${id}:signal`, m.signal),
        new THREE.MeshBasicMaterial({ toneMapped: true }), cap, true
      );

      if (m.limbs) {
        entry.limbSpec = m.limbs;
        entry.limb = this._instanced(
          modelGeometry(`${id}:limb`, [m.limbs.part]),
          shellMat.clone(), cap * m.limbs.count, false
        );
        entry.limb.material.color.setHex(ENEMY_SHELL).multiplyScalar(0.85);
      }

      scene.add(entry.shell, entry.plate, entry.signal);
      if (entry.limb) scene.add(entry.limb);
      this.types[id] = entry;
    }

    // Shared contact shadows. Grounding characters on the floor is what makes
    // a top-down scene read as solid — this replaces the old glow halos.
    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.55 }),
      cap + 8
    );
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.shadows.count = 0;
    scene.add(this.shadows);

    this.telegraphs = new Telegraphs(scene, cap);
    this.bars = new HealthBars(scene, cap);
    this.projectiles = new EnemyProjectiles(scene, game);

    this._o = new THREE.Object3D();
    this._l = new THREE.Object3D();
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }

  _instanced(geo, mat, count, colored) {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    if (colored) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    return mesh;
  }

  clear() {
    this.pool.releaseAll();
    for (const t of Object.values(this.types)) {
      t.list.length = 0;
      t.shell.count = 0; t.plate.count = 0; t.signal.count = 0;
      if (t.limb) t.limb.count = 0;
    }
    this.shadows.count = 0;
    this.telegraphs.clear();
    this.bars.clear();
    this.projectiles.clear();
    this.aliveCount = 0; this.totalCount = 0;
  }

  spawnFromArena(arena) {
    this.clear();
    for (const c of arena.chambers) { c.total = 0; c.cleared = false; }
    for (const s of arena.spawns) {
      const e = this.spawn(s.type, s.x, s.z, arena.floorAt(s.z), s.chamber);
      if (e && arena.chambers[s.chamber]) arena.chambers[s.chamber].total++;
    }
    this.totalCount = this.aliveCount;
  }

  spawn(typeId, x, z, floorY, chamber = 0) {
    const def = ENEMY_TYPES[typeId];
    if (!def) return null;
    const e = this.pool.acquire();
    if (!e) return null;
    e.type = typeId;
    e.x = x; e.z = z;
    e.homeX = x; e.homeZ = z;
    e.baseY = (floorY ?? this.game.arena.floorAt(z));
    e.y = e.baseY;
    e.hp = def.hp * (this.game.difficulty || 1);
    e.maxHp = e.hp;
    e.vx = 0; e.vz = 0;
    e.face = Math.PI;
    e.phase = Math.random() * TAU;
    e.flash = 0; e.scale = 0.01; e.spawnT = 0;
    e.state = S.ENGAGE; e.stateT = 0; e.windFrac = 0;
    e.cooldown = 0.4 + Math.random() * 1.2;
    e.activated = false; e.dying = 0; e.rallyT = 0;
    e.frozen = false;
    e.chamber = chamber;
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

  nearest(x, z, radius) {
    let best = null, bestD = radius * radius;
    this.forEachNear(x, z, radius, (e) => {
      if (e.dying > 0 || e.hp <= 0) return;
      const dx = e.x - x, dz = e.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = e; }
    });
    return best;
  }

  /** Bullet vs enemies. Returns true if the round was consumed. */
  hitTest(b, time) {
    const g = this.game;
    const br = CONFIG.bullets.radius;
    let consumed = false;
    const gx = Math.floor(b.x / ECELL), gz = Math.floor(b.z / ECELL);
    for (let ix = gx - 1; ix <= gx + 1 && !consumed; ix++) {
      for (let iz = gz - 1; iz <= gz + 1 && !consumed; iz++) {
        const arr = this.grid.get(ix * 73856093 ^ iz * 19349663);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const e = arr[i];
          if (e.dying > 0 || e.hp <= 0) continue;
          if (e === b.lastHit && time - b.lastHitT < 0.2) continue;
          const def = ENEMY_TYPES[e.type];
          const dx = e.x - b.x, dz = e.z - b.z;
          const rr = def.radius + br;
          if (dx * dx + dz * dz > rr * rr) continue;

          // The Warden's shield: anything arriving inside its front cone is
          // turned away. This is the one enemy that cannot be solved by
          // pointing at it, and it is why ricochet is a skill and not a garnish.
          if (def.frontArmor) {
            const sp = Math.hypot(b.vx, b.vz) || 1;
            const fx = Math.sin(e.face), fz = Math.cos(e.face);
            const incoming = (-b.vx / sp) * fx + (-b.vz / sp) * fz;
            if (incoming > def.frontArmor) {
              this._deflect(b, e, fx, fz, time);
              b.lastHit = e; b.lastHitT = time;
              return false;
            }
          }

          b.lastHit = e; b.lastHitT = time;
          g.combat.bulletHitEnemy(b, e);

          if (b.pierceLeft > 0) { b.pierceLeft--; continue; }
          consumed = true;
          break;
        }
      }
    }
    if (consumed) g.bullets._kill(b, false);
    return consumed;
  }

  _deflect(b, e, fx, fz, time) {
    const dot = b.vx * fx + b.vz * fz;
    if (dot < 0) { b.vx -= 2 * dot * fx; b.vz -= 2 * dot * fz; }
    e.flash = Math.max(e.flash, 0.5);
    const g = this.game;
    g.fx.particles.cone(b.x, b.y, b.z, fx, fz, 4, 0xffe2b0, { speed: 12, size: 0.22, life: 0.22, stretch: 1.6 });
    g.audio.deflect();
  }

  // ------------------------------------------------------------------ update

  update(dt, time) {
    this._rebuildGrid();
    const g = this.game;
    const p = g.player;
    const cfg = CONFIG.enemies;
    const arena = g.arena;

    for (const t of Object.values(this.types)) t.list.length = 0;
    this.telegraphs.begin();
    this.bars.begin();

    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const def = ENEMY_TYPES[e.type];

      if (e.dying > 0) {
        e.dying -= dt;
        e.scale = Math.max(0, e.dying / 0.2);
        if (e.dying <= 0) { this.pool.release(e); continue; }
        this.types[e.type].list.push(e);
        continue;
      }

      e.spawnT += dt;
      e.scale = Math.min(1, e.spawnT * 2.6);
      e.flash = Math.max(0, e.flash - dt * 5);
      e.phase += dt;
      if (e.cooldown > 0) e.cooldown -= dt;

      const dxp = p.x - e.x, dzp = p.z - e.z;
      const distp = Math.hypot(dxp, dzp) || 0.001;
      const nx = dxp / distp, nz = dzp / distp;

      if (!e.activated && distp < cfg.activationRange) e.activated = true;
      const closeout = this.aliveCount <= cfg.closeoutAt;
      if (closeout) e.activated = true;

      // Stragglers that cannot reach the player are re-posted nearby, so a
      // room can always be finished without hunting one thing behind a block.
      if (closeout && distp > 32) {
        e.rallyT += dt;
        if (e.rallyT > 3.0) {
          e.rallyT = 0;
          const spot = arena.freeSpotNear(p.x, p.z, 16, 26, def.radius);
          if (spot) {
            g.fx.particles.burst(e.x, e.y + 1, e.z, 8, def.signal, { speed: 9, size: 0.3, life: 0.3 });
            e.x = spot.x; e.z = spot.z;
            e.homeX = spot.x; e.homeZ = spot.z;
            e.vx = 0; e.vz = 0; e.spawnT = 0.2; e.scale = 0.3;
          }
        }
      } else if (e.rallyT !== 0) e.rallyT = 0;

      // Frozen targets exist for the tutorial: they stand there, keep facing
      // the player (so a Warden's shield stays up and the lesson holds), and
      // never move or hurt anyone.
      if (e.frozen) {
        e.face = angleDamp(e.face, Math.atan2(nx, nz), 6, dt);
        e.vx = 0; e.vz = 0;
        e.baseY = arena.floorAt(e.z);
        e.y = e.baseY + (def.hover || 0);
        if (def.hp >= 40 && e.hp < e.maxHp - 0.01) {
          this.bars.add(e.x, e.y + 3.2, e.z, clamp(e.hp / e.maxHp, 0, 1), def.signal, def.radius * 1.3);
        }
        this.types[e.type].list.push(e);
        continue;
      }

      const homeDx = e.homeX - e.x, homeDz = e.homeZ - e.z;
      const homeDist = Math.hypot(homeDx, homeDz);
      const engaged = closeout || (e.activated && homeDist < cfg.leash && distp < cfg.leash * 1.6);
      const boost = closeout ? cfg.approachBoost : 1;

      if (!engaged) {
        if (homeDist > 3) {
          const inv = 1 / homeDist;
          e.vx += homeDx * inv * def.speed * 0.8 * dt * 3;
          e.vz += homeDz * inv * def.speed * 0.8 * dt * 3;
        }
        e.state = S.ENGAGE; e.windFrac = 0;
      } else {
        BEHAVIOURS[def.behaviour](this, e, def, { dt, time, p, distp, nx, nz, boost });
      }

      // Everything faces what it is doing. For the Warden that is load-bearing.
      const want = e.state === S.ACT || e.state === S.WIND
        ? Math.atan2(e.aimX, e.aimZ)
        : Math.atan2(nx, nz);
      e.face = angleDamp(e.face, engaged ? want : e.face, 7 * (def.behaviour === 'bulwark' ? 0.55 : 1), dt);

      // separation keeps a group legible instead of a single mass
      if (engaged) {
        this.forEachNear(e.x, e.z, 4, (o) => {
          if (o === e || o.dying > 0) return;
          const ox = e.x - o.x, oz = e.z - o.z;
          const d2 = ox * ox + oz * oz;
          const want2 = (def.radius + ENEMY_TYPES[o.type].radius) * 1.75;
          if (d2 > want2 * want2 || d2 < 1e-5) return;
          const d = Math.sqrt(d2);
          const f = (want2 - d) / want2 * cfg.separation * 16;
          e.vx += (ox / d) * f * dt;
          e.vz += (oz / d) * f * dt;
        });
      }

      const dragF = Math.exp(-(e.state === S.ACT ? 1.2 : 6.0) * dt);
      e.vx *= dragF; e.vz *= dragF;
      e.x += e.vx * dt; e.z += e.vz * dt;

      // Walls: slide, and steer around the corner toward the player.
      const r = def.radius * 0.8;
      if (arena.collide(e.x, e.z, r, hit)) {
        e.x += hit.nx * hit.depth;
        e.z += hit.nz * hit.depth;
        const dot = e.vx * hit.nx + e.vz * hit.nz;
        if (dot < 0) { e.vx -= dot * hit.nx; e.vz -= dot * hit.nz; }
        if (e.state === S.ACT) { e.state = S.RECOVER; e.stateT = 0.3; }
        else if (engaged) {
          const tx = -hit.nz, tz = hit.nx;
          const s = ((p.x - e.x) * tx + (p.z - e.z) * tz) >= 0 ? 1 : -1;
          e.vx += tx * s * def.speed * 2.6 * dt;
          e.vz += tz * s * def.speed * 2.6 * dt;
        }
      }
      e.x = clamp(e.x, arena.bounds.minX + r, arena.bounds.maxX - r);
      e.z = clamp(e.z, arena.bounds.minZ + r, arena.bounds.maxZ - r);

      e.baseY = arena.floorAt(e.z);
      const hover = def.hover || 0;
      e.y = e.baseY + hover + (hover ? Math.sin(e.phase * 2.4) * 0.25 : 0);

      // Contact damage is an attack landing, not a thing that happens because
      // something is standing near you. A Skitter only hurts you on the lunge
      // and a Hornet only on the dive, so walking past one is a decision you
      // are allowed to make. The Warden is the exception: being in the way is
      // its whole job, and it is slow enough to walk around.
      if (def.contact && distp < def.radius + p.radius + 0.1) {
        if (def.contactAlways || e.state === S.ACT) {
          p.takeHit(def.contact, e.x, e.z);
          if (def.shove) { p.vx += nx * def.shove; p.vz += nz * def.shove; }
        }
      }

      // A bar only for the three enemies that take long enough to need one.
      if (def.hp >= 40 && e.hp < e.maxHp - 0.01) {
        this.bars.add(e.x, e.y + (def.behaviour === 'slammer' ? 4.4 : 3.2), e.z,
          clamp(e.hp / e.maxHp, 0, 1), def.signal, def.radius * 1.3);
      }

      this.types[e.type].list.push(e);
    }

    this.projectiles.update(dt);
    this.telegraphs.end(dt);
    this.bars.end();
    this._writeInstances(time);
  }

  /** Puts a round into the world from an enemy barrel. */
  fireProjectile(e, def) {
    const ox = Math.sin(e.face), oz = Math.cos(e.face);
    this.projectiles.fire(
      e.x + ox * 2.2 + oz * 0.4, e.baseY + 1.7, e.z + oz * 2.2 - ox * 0.4,
      e.aimX, e.aimZ, def
    );
    this.game.audio.enemyShot();
    this.game.fx.particles.cone(e.x + ox * 2.4, e.baseY + 1.7, e.z + oz * 2.4, e.aimX, e.aimZ, 4,
      def.signal, { speed: 12, size: 0.24, life: 0.18, stretch: 2 });
  }

  killed(e) {
    this.aliveCount = Math.max(0, this.aliveCount - 1);
    e.dying = 0.2;
    this.telegraphs.drop(e);
  }

  // --------------------------------------------------------------- rendering

  _writeInstances(time) {
    const o = this._o, l = this._l, m = this._m, c = this._c;
    let shadowIndex = 0;
    const sm = this.shadows.instanceMatrix.array;

    for (const t of Object.values(this.types)) {
      const { def, list, shell, plate, signal, limb, limbSpec, signalColor } = t;
      const sArr = shell.instanceMatrix.array;
      const pArr = plate.instanceMatrix.array;
      const gArr = signal.instanceMatrix.array;
      const sCol = shell.instanceColor.array;
      const pCol = plate.instanceColor.array;
      const gCol = signal.instanceColor.array;
      const lArr = limb ? limb.instanceMatrix.array : null;
      let li = 0;

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        // A wind-up is sold on the body too, not only by the floor mark: the
        // thing crouches, then throws itself forward.
        const wind = e.state === S.WIND ? e.windFrac : 0;
        const act = e.state === S.ACT ? 1 : 0;
        const squash = 1 - wind * 0.16 + act * 0.1;
        const stretch = 1 + wind * 0.1 + act * 0.18;

        o.position.set(e.x, e.y, e.z);
        o.rotation.set(0, e.face, 0);
        o.scale.set(e.scale * stretch, e.scale * squash, e.scale * stretch);
        o.updateMatrix();
        o.matrix.toArray(sArr, i * 16);
        o.matrix.toArray(pArr, i * 16);
        o.matrix.toArray(gArr, i * 16);

        // hit flash whitens the shell; the plate follows more softly
        const f = e.flash;
        const c3 = i * 3;
        sCol[c3] = 0.85 + f * 2.4; sCol[c3 + 1] = 0.85 + f * 2.4; sCol[c3 + 2] = 0.85 + f * 2.4;
        pCol[c3] = 0.9 + f * 1.8; pCol[c3 + 1] = 0.9 + f * 1.8; pCol[c3 + 2] = 0.9 + f * 1.8;

        // the core brightens through a wind-up: the tell that reads first
        const heat = 0.85 + wind * 1.5 + act * 0.6 + Math.sin(e.phase * 3) * 0.06;
        c.copy(signalColor).multiplyScalar(heat);
        gCol[c3] = c.r; gCol[c3 + 1] = c.g; gCol[c3 + 2] = c.b;

        if (limb) {
          this._writeLimbs(lArr, li, e, o, l, m, limbSpec, wind, act);
          li += limbSpec.count;
        }

        // contact shadow, always on the floor no matter how the thing hovers
        if (shadowIndex < this.shadows.count + this.cap) {
          const ss = def.radius * 2.6 * e.scale;
          const so = shadowIndex * 16;
          sm[so] = ss; sm[so + 1] = 0; sm[so + 2] = 0; sm[so + 3] = 0;
          sm[so + 4] = 0; sm[so + 5] = 0; sm[so + 6] = ss; sm[so + 7] = 0;
          sm[so + 8] = 0; sm[so + 9] = -ss; sm[so + 10] = 0; sm[so + 11] = 0;
          sm[so + 12] = e.x; sm[so + 13] = e.baseY + 0.04; sm[so + 14] = e.z; sm[so + 15] = 1;
          shadowIndex++;
        }
      }

      shell.count = list.length;
      plate.count = list.length;
      signal.count = list.length;
      shell.instanceMatrix.needsUpdate = true;
      plate.instanceMatrix.needsUpdate = true;
      signal.instanceMatrix.needsUpdate = true;
      shell.instanceColor.needsUpdate = true;
      plate.instanceColor.needsUpdate = true;
      signal.instanceColor.needsUpdate = true;
      if (limb) {
        limb.count = li;
        limb.instanceMatrix.needsUpdate = true;
      }
    }

    this.shadows.count = shadowIndex;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  /** Limbs are posed in the enemy's local space, then folded into its matrix. */
  _writeLimbs(arr, base, e, parent, l, m, spec, wind, act) {
    const n = spec.count;
    for (let k = 0; k < n; k++) {
      let lx = 0, ly = spec.y, lz = 0, rx = 0, ry = 0, rz = 0;
      const swing = Math.sin(e.phase * spec.rate + k * (TAU / n)) * spec.amp;
      const moving = clamp(Math.hypot(e.vx, e.vz) / 6, 0.12, 1);

      if (spec.layout === 'radial') {
        const a = ((k + 0.5) / n) * TAU;
        lx = Math.sin(a) * spec.radius;
        lz = Math.cos(a) * spec.radius;
        ry = a;
        rx = spec.tilt;
        if (spec.anim === 'scissor') ry += swing * moving;
        if (spec.anim === 'plant') ly += Math.abs(swing) * 0.3 * moving;
      } else if (spec.layout === 'pair') {
        const s = k === 0 ? -1 : 1;
        lx = s * spec.radius;
        if (spec.anim === 'stomp') rx = swing * moving;
        if (spec.anim === 'raise') {
          // arms come up through the wind-up and drive down on the act
          rx = -0.2 - wind * spec.amp + act * 1.2;
          ly += wind * 0.6 - act * 0.5;
        }
      } else if (spec.layout === 'wings') {
        const s = k === 0 ? -1 : 1;
        lx = s * spec.radius * 0.45;
        rz = s * (0.25 + Math.sin(e.phase * spec.rate) * spec.amp);
        ry = s * 0.3;
      }

      l.position.set(lx, ly, lz);
      l.rotation.set(rx, ry, rz);
      l.scale.set(1, 1, 1);
      l.updateMatrix();
      m.multiplyMatrices(parent.matrix, l.matrix);
      m.toArray(arr, (base + k) * 16);
    }
  }
}

// ------------------------------------------------------------------ behaviours
//
// One function per role. Each owns its own state machine but they all share
// the ENGAGE -> WIND -> ACT -> RECOVER shape, so the player is always being
// shown the same grammar with different words.

const BEHAVIOURS = {
  /** Skitter: closes fast, crouches, throws itself the last few metres. */
  rusher(sys, e, def, ctx) {
    const { dt, p, distp, nx, nz, boost, time } = ctx;
    const sp = def.speed * boost;
    if (e.state === S.ENGAGE) {
      // a slight weave so a pack does not arrive as one straight line
      const weave = Math.sin(e.phase * 3.2 + e.homeX) * 0.5;
      e.vx += (nx + -nz * weave) * sp * dt * 5;
      e.vz += (nz + nx * weave) * sp * dt * 5;
      if (distp < def.lunge.range && e.cooldown <= 0) {
        e.state = S.WIND; e.stateT = def.lunge.wind; e.windFrac = 0;
        e.aimX = nx; e.aimZ = nz;
      }
    } else if (e.state === S.WIND) {
      e.stateT -= dt;
      e.windFrac = 1 - clamp(e.stateT / def.lunge.wind, 0, 1);
      e.vx *= 0.82; e.vz *= 0.82;
      e.aimX = damp(e.aimX, nx, 4, dt); e.aimZ = damp(e.aimZ, nz, 4, dt);
      // A line, not a ring: what the player needs to know is where it is
      // about to be, and that is a lane through them, not a circle on it.
      const reach = def.lunge.speed * def.lunge.time;
      sys.telegraphs.line(e, e.x, e.baseY, e.z, e.aimX, e.aimZ, reach, def.radius * 1.6, e.windFrac, def.signal);
      if (e.stateT <= 0) {
        e.state = S.ACT; e.stateT = def.lunge.time;
        const d = Math.hypot(e.aimX, e.aimZ) || 1;
        e.vx = (e.aimX / d) * def.lunge.speed;
        e.vz = (e.aimZ / d) * def.lunge.speed;
        sys.game.audio.enemyLunge();
      }
    } else if (e.state === S.ACT) {
      e.stateT -= dt;
      if (e.stateT <= 0) { e.state = S.RECOVER; e.stateT = 0.35; }
    } else {
      e.stateT -= dt;
      e.vx *= 0.86; e.vz *= 0.86;
      if (e.stateT <= 0) { e.state = S.ENGAGE; e.cooldown = def.lunge.cooldown; e.windFrac = 0; }
    }
  },

  /** Hornet: circles out of reach, then commits to a marked dive line. */
  diver(sys, e, def, ctx) {
    const { dt, distp, nx, nz, boost } = ctx;
    const sp = def.speed * boost;
    if (e.state === S.ENGAGE) {
      const radial = clamp((distp - def.dive.hold) * 0.14, -1, 1);
      const spin = e.homeX > 0 ? 1 : -1;
      e.vx += (nx * radial + -nz * spin * 0.85) * sp * dt * 4;
      e.vz += (nz * radial + nx * spin * 0.85) * sp * dt * 4;
      if (distp < def.dive.range && e.cooldown <= 0) {
        e.state = S.WIND; e.stateT = def.dive.wind; e.windFrac = 0;
        e.aimX = nx; e.aimZ = nz;
      }
    } else if (e.state === S.WIND) {
      e.stateT -= dt;
      e.windFrac = 1 - clamp(e.stateT / def.dive.wind, 0, 1);
      e.vx *= 0.8; e.vz *= 0.8;
      e.aimX = damp(e.aimX, nx, 3, dt); e.aimZ = damp(e.aimZ, nz, 3, dt);
      sys.telegraphs.line(e, e.x, e.baseY, e.z, e.aimX, e.aimZ,
        def.dive.speed * def.dive.time + 6, 1.6, e.windFrac, def.signal);
      if (e.stateT <= 0) {
        e.state = S.ACT; e.stateT = def.dive.time;
        const d = Math.hypot(e.aimX, e.aimZ) || 1;
        e.vx = (e.aimX / d) * def.dive.speed;
        e.vz = (e.aimZ / d) * def.dive.speed;
        sys.game.audio.enemyLunge();
      }
    } else if (e.state === S.ACT) {
      e.stateT -= dt;
      if (e.stateT <= 0) { e.state = S.RECOVER; e.stateT = 0.5; }
    } else {
      e.stateT -= dt;
      e.vx *= 0.9; e.vz *= 0.9;
      if (e.stateT <= 0) { e.state = S.ENGAGE; e.cooldown = def.dive.cooldown; e.windFrac = 0; }
    }
  },

  /** Lancer: holds the standoff, strafes, marks the line, then fires. */
  gunner(sys, e, def, ctx) {
    const { dt, distp, nx, nz, boost } = ctx;
    const sp = def.speed * boost;
    if (e.state === S.ENGAGE) {
      const radial = clamp((distp - def.gun.standoff) * 0.13, -1, 1);
      const spin = Math.sin(e.phase * 0.5 + e.homeZ) > 0 ? 1 : -1;
      e.vx += (nx * radial + -nz * spin * 0.5) * sp * dt * 4;
      e.vz += (nz * radial + nx * spin * 0.5) * sp * dt * 4;
      if (distp < def.gun.range && e.cooldown <= 0) {
        e.state = S.WIND; e.stateT = def.gun.wind; e.windFrac = 0;
        e.aimX = nx; e.aimZ = nz;
      }
    } else if (e.state === S.WIND) {
      e.stateT -= dt;
      e.windFrac = 1 - clamp(e.stateT / def.gun.wind, 0, 1);
      e.vx *= 0.85; e.vz *= 0.85;
      e.aimX = damp(e.aimX, nx, 2.6, dt); e.aimZ = damp(e.aimZ, nz, 2.6, dt);
      sys.telegraphs.line(e, e.x, e.baseY, e.z, e.aimX, e.aimZ, def.gun.range, 1.0, e.windFrac, def.signal);
      if (e.stateT <= 0) {
        e.state = S.ACT; e.stateT = 0.12;
        sys.fireProjectile(e, def);
      }
    } else if (e.state === S.ACT) {
      e.stateT -= dt;
      if (e.stateT <= 0) { e.state = S.RECOVER; e.stateT = 0.4; }
    } else {
      e.stateT -= dt;
      if (e.stateT <= 0) { e.state = S.ENGAGE; e.cooldown = def.gun.cooldown; e.windFrac = 0; }
    }
  },

  /** Warden: walks straight at you behind its shield, and never turns away. */
  bulwark(sys, e, def, ctx) {
    const { dt, nx, nz, boost } = ctx;
    const sp = def.speed * boost;
    e.state = S.ENGAGE;
    e.vx += nx * sp * dt * 4;
    e.vz += nz * sp * dt * 4;
    e.aimX = nx; e.aimZ = nz;
  },

  /** Anvil: walks you down, then owns a circle of floor for a moment. */
  slammer(sys, e, def, ctx) {
    const { dt, p, distp, nx, nz, boost } = ctx;
    const sp = def.speed * boost;
    if (e.state === S.ENGAGE) {
      e.vx += nx * sp * dt * 4;
      e.vz += nz * sp * dt * 4;
      if (distp < def.slam.range && e.cooldown <= 0) {
        e.state = S.WIND; e.stateT = def.slam.wind; e.windFrac = 0;
        e.aimX = nx; e.aimZ = nz;
      }
    } else if (e.state === S.WIND) {
      e.stateT -= dt;
      e.windFrac = 1 - clamp(e.stateT / def.slam.wind, 0, 1);
      e.vx *= 0.7; e.vz *= 0.7;
      // The ring is drawn at its true radius from the first frame, so the safe
      // distance is information rather than a guess.
      sys.telegraphs.ring(e, e.x, e.baseY, e.z, def.slam.radius, e.windFrac, def.signal);
      if (e.stateT <= 0) {
        e.state = S.ACT; e.stateT = 0.2;
        sys._slam(e, def);
      }
    } else if (e.state === S.ACT) {
      e.stateT -= dt;
      if (e.stateT <= 0) { e.state = S.RECOVER; e.stateT = 0.8; }
    } else {
      e.stateT -= dt;
      if (e.stateT <= 0) { e.state = S.ENGAGE; e.cooldown = def.slam.cooldown; e.windFrac = 0; }
    }
  },
};

Enemies.prototype._slam = function (e, def) {
  const g = this.game;
  const p = g.player;
  const R = def.slam.radius;
  g.fx.effects.ring(e.x, e.baseY + 0.12, e.z, def.signal, 1.5, R * 2, 0.4);
  g.fx.particles.burst(e.x, e.baseY + 0.5, e.z, 16, 0xcdbda0, {
    speed: 18, size: 0.4, life: 0.45, spread: 2.0, gravity: 16,
  });
  g.cameraRig.addShake(0.34);
  g.audio.slam();
  const dx = p.x - e.x, dz = p.z - e.z;
  const d = Math.hypot(dx, dz);
  if (d < R + p.radius) {
    p.takeHit(def.slam.damage, e.x, e.z);
    const inv = 1 / (d || 1);
    p.vx += dx * inv * def.slam.knock;
    p.vz += dz * inv * def.slam.knock;
  }
};

function angleDamp(a, b, rate, dt) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * (1 - Math.exp(-rate * dt));
}

// ------------------------------------------------------------------ telegraphs

/**
 * Floor marks. A ring means "this circle is about to be dangerous"; a line
 * means "something is coming down this lane". Both fill up as the wind-up
 * runs, so the player reads how long they have, not just that something is
 * happening. There are only these two shapes in the entire game.
 */
class Telegraphs {
  constructor(scene, cap) {
    const ringGeo = new THREE.RingGeometry(0.86, 1.0, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
    }), cap);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);

    // a filling disc inside the ring shows the wind-up running out
    const fillGeo = new THREE.CircleGeometry(1, 36);
    fillGeo.rotateX(-Math.PI / 2);
    this.fills = new THREE.InstancedMesh(fillGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
    }), cap);
    this.fills.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);

    const lineGeo = new THREE.PlaneGeometry(1, 1);
    lineGeo.rotateX(-Math.PI / 2);
    lineGeo.translate(0, 0, 0.5);
    this.lines = new THREE.InstancedMesh(lineGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
    }), cap);
    this.lines.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);

    for (const m of [this.rings, this.fills, this.lines]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = 2;
      scene.add(m);
    }
    this._c = new THREE.Color();
    this.cap = cap;
    this.ri = 0; this.fi = 0; this.li = 0;
  }

  begin() { this.ri = 0; this.fi = 0; this.li = 0; }

  ring(e, x, y, z, radius, frac, color) {
    if (this.ri >= this.cap) return;
    const i = this.ri++;
    // pulse so the mark still reads on a busy floor
    const pulse = 1 + Math.sin(frac * 22) * 0.02;
    writeFlat(this.rings.instanceMatrix.array, i, x, y + 0.06, z, radius * pulse, 0);
    writeColor(this.rings.instanceColor.array, i, this._c.setHex(color), 0.55 + frac * 0.75);
    const f = this.fi++;
    if (f >= this.cap) return;
    writeFlat(this.fills.instanceMatrix.array, f, x, y + 0.05, z, radius * frac, 0);
    writeColor(this.fills.instanceColor.array, f, this._c.setHex(color), 0.42);
  }

  line(e, x, y, z, dx, dz, length, width, frac, color) {
    if (this.li >= this.cap) return;
    const i = this.li++;
    const a = Math.atan2(dx, dz);
    writeFlat(this.lines.instanceMatrix.array, i, x, y + 0.05, z, 1, a, width, length);
    writeColor(this.lines.instanceColor.array, i, this._c.setHex(color), 0.5 + frac * 1.1);
  }

  drop() { /* marks are rebuilt every frame; nothing to release */ }

  end() {
    this.rings.count = this.ri;
    this.fills.count = this.fi;
    this.lines.count = this.li;
    for (const m of [this.rings, this.fills, this.lines]) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }

  clear() { this.begin(); this.end(); }
}

/** Slim bars over the three enemies that take long enough to need one. */
class HealthBars {
  constructor(scene, cap) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0, 0);
    const mk = (opacity, color) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false, depthTest: false, toneMapped: true,
      }), cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.renderOrder = 22;
      scene.add(m);
      return m;
    };
    this.back = mk(0.55, 0x15140f);
    this.fill = mk(0.95, 0xffffff);
    this.fill.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.fill.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this._c = new THREE.Color();
    this.n = 0;
  }

  begin() { this.n = 0; }

  add(x, y, z, frac, color, width) {
    const i = this.n++;
    if (i >= this.back.instanceMatrix.count) { this.n--; return; }
    const w = Math.max(1.4, width);
    // Bars face the camera's fixed yaw and lean back to match its pitch.
    writeBar(this.back.instanceMatrix.array, i, x - w / 2, y, z, w, 0.3);
    writeBar(this.fill.instanceMatrix.array, i, x - w / 2, y, z, w * frac, 0.3);
    writeColor(this.fill.instanceColor.array, i, this._c.setHex(color), 1);
  }

  end() {
    this.back.count = this.n;
    this.fill.count = this.n;
    this.back.instanceMatrix.needsUpdate = true;
    this.fill.instanceMatrix.needsUpdate = true;
    this.fill.instanceColor.needsUpdate = true;
  }

  clear() { this.begin(); this.end(); }
}

function writeFlat(arr, i, x, y, z, s, rot, sx, sz) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const w = (sx ?? s), d = (sz ?? s);
  const o = i * 16;
  arr[o] = c * w;  arr[o + 1] = 0; arr[o + 2] = -sn * w; arr[o + 3] = 0;
  arr[o + 4] = 0;  arr[o + 5] = 1; arr[o + 6] = 0;       arr[o + 7] = 0;
  arr[o + 8] = sn * d; arr[o + 9] = 0; arr[o + 10] = c * d; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z;     arr[o + 15] = 1;
}

// Bars stand upright in world space and lean back 30 degrees, which lines them
// up with this camera without a per-instance billboard.
const BAR_TILT = -0.52;
function writeBar(arr, i, x, y, z, w, h) {
  const c = Math.cos(BAR_TILT), s = Math.sin(BAR_TILT);
  const o = i * 16;
  arr[o] = w;      arr[o + 1] = 0;     arr[o + 2] = 0;  arr[o + 3] = 0;
  arr[o + 4] = 0;  arr[o + 5] = h * c; arr[o + 6] = h * s; arr[o + 7] = 0;
  arr[o + 8] = 0;  arr[o + 9] = -s;    arr[o + 10] = c; arr[o + 11] = 0;
  arr[o + 12] = x; arr[o + 13] = y;    arr[o + 14] = z; arr[o + 15] = 1;
}

function writeColor(arr, i, c, mul) {
  const o = i * 3;
  arr[o] = c.r * mul; arr[o + 1] = c.g * mul; arr[o + 2] = c.b * mul;
}

/** Enemy rounds: slow, large, and impossible to mistake for one of yours. */
class EnemyProjectiles {
  constructor(scene, game) {
    this.game = game;
    const cap = 48;
    this.pool = new Pool(cap, () => ({ x: 0, y: 0, z: 0, vx: 0, vz: 0, life: 0, dmg: 1, spin: 0 }));
    const geo = modelGeometry('eproj', [
      { shape: 'octa', args: [0.46, 0] },
      { shape: 'box', args: [0.2, 0.2, 1.0], pos: [0, 0, -0.5] },
    ]);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xff7a5a, toneMapped: true }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this._o = new THREE.Object3D();
  }

  clear() { this.pool.releaseAll(); this.mesh.count = 0; }

  fire(x, y, z, dx, dz, def) {
    const p = this.pool.acquire();
    if (!p) return;
    const d = Math.hypot(dx, dz) || 1;
    p.x = x; p.y = y; p.z = z;
    p.vx = (dx / d) * def.gun.projectileSpeed;
    p.vz = (dz / d) * def.gun.projectileSpeed;
    p.life = 3.5; p.dmg = def.gun.projectileDamage; p.spin = 0;
  }

  update(dt) {
    const g = this.game;
    const pl = g.player;
    const list = this.pool.active;
    const arr = this.mesh.instanceMatrix.array;
    const o = this._o;
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.spin += dt * 6;
      p.y = g.arena.floorAt(p.z) + 1.5;
      if (p.life <= 0) { this.pool.release(p); continue; }
      if (g.arena.collide(p.x, p.z, 0.45, hit)) {
        g.fx.particles.cone(p.x, p.y, p.z, hit.nx, hit.nz, 4, 0xff7a5a, { speed: 8, size: 0.25, life: 0.22 });
        this.pool.release(p); continue;
      }
      const dx = pl.x - p.x, dz = pl.z - p.z;
      if (dx * dx + dz * dz < (pl.radius + 0.55) * (pl.radius + 0.55)) {
        pl.takeHit(p.dmg, p.x, p.z);
        g.fx.particles.burst(p.x, p.y, p.z, 7, 0xff7a5a, { speed: 9, size: 0.3, life: 0.28 });
        this.pool.release(p); continue;
      }
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, Math.atan2(p.vx, p.vz), p.spin);
      o.scale.setScalar(1);
      o.updateMatrix();
      o.matrix.toArray(arr, n * 16);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
