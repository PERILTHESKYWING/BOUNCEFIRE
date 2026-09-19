import * as THREE from 'three';
import { THEMES } from '../data/themes.js';
import { MODIFIERS } from '../data/modifiers.js';
import { makeRng, clamp, lerp, TAU } from '../core/utils.js';
import { wallGeometry, trimGeometry, floorTexture, modifierTexture, glowTexture } from './geometry.js';

const CELL = 8;

// Wall height is a readability budget, not a style choice. The camera looks
// down at ~58 degrees, so a wall of height h hides roughly 0.62h of floor
// behind it. At 3.0 that is under two metres — less than the gap the player
// collider already keeps — which is why the character can never be lost
// behind the level.
const WALL_H = 3.0;
const KERB_H = 2.0;

/**
 * A wall collider is an oriented box in the XZ plane. Gameplay stays planar so
 * bouncing is cheap and predictable; the floor still steps up room by room so
 * the player is travelling somewhere.
 */
class Collider {
  constructor(x, z, hw, hd, rot) {
    this.x = x; this.z = z; this.hw = hw; this.hd = hd;
    this.rot = rot;
    this.cos = Math.cos(rot); this.sin = Math.sin(rot);
    this.mod = null;
    this.modWall = null;
    this.cooldown = 0;
    this.bump = 0;
    this.instance = -1;
    this.height = WALL_H;
    this.baseY = 0;
    this.br = Math.hypot(hw, hd);
  }
}

export class Arena {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = [];
    this.grid = new Map();
    this.chambers = [];
    this.spawns = [];
    this.modWalls = [];
    this.theme = THEMES.dusk;
    this.bounds = { minX: -20, maxX: 20, minZ: 0, maxZ: 100 };
    this._tmp = new THREE.Object3D();
  }

  // ---------------------------------------------------------------- building

  build(def) {
    this.clear();
    const theme = THEMES[def.theme] || THEMES.dusk;
    this.theme = theme;
    this.def = def;
    const rng = makeRng(def.seed);
    this.rng = rng;

    const W = def.width;
    const halfW = W / 2;
    let z = 0;
    let floorY = 0;
    const raw = [];
    const spawnPts = [];
    const modSlots = [];

    for (let ci = 0; ci < def.chambers.length; ci++) {
      const ch = def.chambers[ci];
      const z0 = z, z1 = z + ch.depth;
      const chamber = {
        index: ci, z0, z1, floorY, spec: ch,
        cleared: false, boss: ch.type === 'boss', total: 0, alive: 0,
      };
      this.chambers.push(chamber);

      const out = { walls: [], spawns: [], slots: [] };
      const gen = GENERATORS[ch.type] || GENERATORS.court;
      gen(out, { z0, z1, halfW, depth: ch.depth, floorY, rng, theme, index: ci });

      for (const w of out.walls) { w.baseY = floorY; raw.push(w); }
      for (const s of out.spawns) spawnPts.push({ ...s, chamber: ci, floorY });
      for (const s of out.slots) modSlots.push({ ...s, chamber: ci, floorY });

      // Spread this room's roster over its spawn points. Enemies are placed in
      // loose pairs rather than one big squad so a room reads as several
      // threats to prioritise, not a single blob to shoot at.
      const list = [];
      for (const [type, n] of Object.entries(ch.enemies || {})) {
        for (let i = 0; i < n; i++) list.push(type);
      }
      shuffle(list, rng);
      const pts = spawnPts.filter((p) => p.chamber === ci);
      for (let i = 0; i < list.length; i++) {
        const p = pts[i % pts.length];
        const a = rng() * TAU;
        const r = 1.6 + rng() * 3.6;
        this.spawns.push({
          type: list[i],
          x: clamp(p.x + Math.cos(a) * r, -halfW + 3.5, halfW - 3.5),
          z: clamp(p.z + Math.sin(a) * r, z0 + 4, z1 - 4),
          chamber: ci,
          floorY,
        });
        chamber.total++;
      }

      z = z1;
      floorY += (ch.type === 'boss' ? 0 : def.rise);
    }

    // Modifier panels take the slots their room asked for.
    const byChamber = new Map();
    for (const s of modSlots) {
      if (!byChamber.has(s.chamber)) byChamber.set(s.chamber, []);
      byChamber.get(s.chamber).push(s);
    }
    for (const [ci, slots] of byChamber) {
      const mods = def.chambers[ci].mods || [];
      shuffle(slots, makeRng(def.seed + ci * 7919));
      for (let i = 0; i < mods.length && i < slots.length; i++) {
        raw.push({
          x: slots[i].x, z: slots[i].z, w: slots[i].w, d: slots[i].d,
          h: WALL_H, rot: slots[i].rot, baseY: slots[i].floorY,
          mod: mods[i],
        });
      }
    }

    // Outer kerb. Deliberately low: it closes the arena without ever standing
    // between the camera and the player. It is built per room, because the
    // rooms step upward and a kerb poured at y=0 would be buried by the third
    // one, leaving the arena visibly open at the sides.
    const totalZ = z;
    for (const ch of this.chambers) {
      const d = ch.z1 - ch.z0 + 0.6;
      const cz = (ch.z0 + ch.z1) / 2;
      raw.push({ x: -halfW - 1.2, z: cz, w: 2.4, d, h: KERB_H, rot: 0, baseY: ch.floorY, boundary: true });
      raw.push({ x: halfW + 1.2, z: cz, w: 2.4, d, h: KERB_H, rot: 0, baseY: ch.floorY, boundary: true });
    }
    const firstY = this.chambers[0].floorY;
    const lastY = this.chambers[this.chambers.length - 1].floorY;
    raw.push({ x: 0, z: -2.6, w: W + 6, d: 2.4, h: KERB_H, rot: 0, baseY: firstY, boundary: true });
    raw.push({ x: 0, z: totalZ + 2.6, w: W + 6, d: 2.4, h: KERB_H, rot: 0, baseY: lastY, boundary: true });

    this.bounds = { minX: -halfW, maxX: halfW, minZ: 0, maxZ: totalZ };
    this._buildMeshes(raw, theme, totalZ, W);
    this._buildGrid();

    // Nudge any spawn that landed inside geometry; a walled-in enemy would
    // otherwise be unkillable and the room could never be cleared.
    const probe = { nx: 0, nz: 0, depth: 0, collider: null };
    for (const s of this.spawns) {
      if (!this.collide(s.x, s.z, 2.0, probe)) continue;
      const spot = this.freeSpotNear(s.x, s.z, 2.5, 14, 2.0, rng);
      if (spot) { s.x = spot.x; s.z = spot.z; }
    }
    return this;
  }

  _buildMeshes(raw, theme, totalZ, W) {
    const plain = raw.filter((w) => !w.mod);
    const geo = wallGeometry(theme.wallShape);

    // Matte, lit, not emissive. Walls read by their form and their painted top
    // edge; nothing in the environment produces its own light.
    const wallMat = new THREE.MeshStandardMaterial({
      color: theme.wall, roughness: 0.94, metalness: 0.0,
    });
    const topMat = new THREE.MeshStandardMaterial({
      color: theme.wallTop, roughness: 0.85, metalness: 0.0,
    });

    const walls = new THREE.InstancedMesh(geo, wallMat, plain.length);
    walls.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    walls.frustumCulled = false;
    const tops = new THREE.InstancedMesh(trimGeometry(), topMat, plain.length);
    tops.frustumCulled = false;

    const o = this._tmp;
    for (let i = 0; i < plain.length; i++) {
      const w = plain[i];
      o.position.set(w.x, w.baseY + w.h / 2, w.z);
      o.rotation.set(0, w.rot, 0);
      o.scale.set(w.w, w.h, w.d);
      o.updateMatrix();
      walls.setMatrixAt(i, o.matrix);

      // painted cap: the one high-value line in the environment, and the thing
      // that tells you where a bounce surface actually is
      const th = 0.3;
      o.position.set(w.x, w.baseY + w.h - th * 0.4, w.z);
      o.scale.set(w.w * 1.04, th, w.d * 1.04);
      o.updateMatrix();
      tops.setMatrixAt(i, o.matrix);

      const c = new Collider(w.x, w.z, w.w / 2, w.d / 2, w.rot);
      c.height = w.h; c.baseY = w.baseY; c.instance = i; c.boundary = !!w.boundary;
      this.colliders.push(c);
    }
    walls.instanceMatrix.needsUpdate = true;
    tops.instanceMatrix.needsUpdate = true;
    this.group.add(walls, tops);
    this.wallMesh = walls; this.topMesh = tops;

    for (const w of raw) if (w.mod) this._buildModifierWall(w, theme);

    this._buildFloor(theme, totalZ, W);
  }

  _buildModifierWall(w, theme) {
    const mod = MODIFIERS[w.mod];
    const g = new THREE.Group();
    g.position.set(w.x, w.baseY, w.z);
    g.rotation.y = w.rot;

    // The panel is painted, not lit from within: a flat colour block with a
    // drawn mark. It reads as part of the level rather than as an effect.
    const body = new THREE.Mesh(
      wallGeometry(theme.wallShape),
      new THREE.MeshStandardMaterial({ color: mod.color, roughness: 0.78, metalness: 0.0 })
    );
    body.scale.set(w.w, w.h, w.d);
    body.position.y = w.h / 2;
    g.add(body);

    const cap = new THREE.Mesh(
      trimGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 })
    );
    cap.scale.set(w.w * 1.05, 0.28, w.d * 1.05);
    cap.position.y = w.h - 0.1;
    cap.material.color.setHex(mod.color).lerp(new THREE.Color(0xffffff), 0.55);
    g.add(cap);

    // Crown plate is what the player reads from this camera; the face plates
    // let them spot the panel from across the room.
    const tex = modifierTexture(mod);
    const plateMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, toneMapped: true, depthWrite: false,
    });
    const plateH = Math.min(w.d * 0.8, 3.4);
    const crown = new THREE.Mesh(new THREE.PlaneGeometry(plateH * 2, plateH), plateMat);
    crown.rotation.x = -Math.PI / 2;
    crown.rotation.z = Math.PI;
    crown.position.y = w.h + 0.16;
    g.add(crown);

    const faceH = Math.min(w.h * 0.62, 1.7);
    const faceGeo = new THREE.PlaneGeometry(faceH * 2, faceH);
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(faceGeo, plateMat);
      p.position.set(0, w.h * 0.5, s * (w.d / 2 + 0.05));
      if (s < 0) p.rotation.y = Math.PI;
      g.add(p);
    }

    // A flat painted stripe on the floor, so the panel's reach is obvious.
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(w.w * 1.15, w.d * 2.2),
      new THREE.MeshBasicMaterial({
        color: mod.color, transparent: true, opacity: 0.2, depthWrite: false,
      })
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = 0.05;
    g.add(decal);

    this.group.add(g);

    const c = new Collider(w.x, w.z, w.w / 2, w.d / 2, w.rot);
    c.height = w.h; c.baseY = w.baseY; c.mod = mod;
    c.modWall = { group: g, body, cap, decal, baseColor: new THREE.Color(mod.color) };
    this.colliders.push(c);
    this.modWalls.push(c);
  }

  _buildFloor(theme, totalZ, W) {
    const tex = floorTexture(theme);
    // The floor runs a long way past the kerb on every side. The camera sits
    // behind the player, so when the player backs up to the near wall it is
    // looking outside the arena — without this there is a black void filling
    // the bottom of the screen, which is the one thing a fixed camera must
    // never show.
    const OVER = 70;
    for (const ch of this.chambers) {
      const depth = ch.z1 - ch.z0;
      const first = ch.index === 0;
      const last = ch.index === this.chambers.length - 1;
      const padFront = first ? OVER : 0.2;
      const padBack = last ? OVER : 0.2;
      const planeW = W + 6 + OVER * 2;
      const planeD = depth + padFront + padBack;
      const t = tex.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(planeW / 12, planeD / 12);
      const mat = new THREE.MeshStandardMaterial({
        map: t, color: 0xffffff, roughness: 1.0, metalness: 0.0,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeD), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, ch.floorY, (ch.z0 - padFront + ch.z1 + padBack) / 2);
      m.renderOrder = -1;
      this.group.add(m);
    }

    // Step risers between rooms, in the wall colour so they read as built.
    // They run the full width of the extended floor, not just the arena: the
    // gap between two floor planes at different heights is a hole you can see
    // the sky through, and it shows up as a black band across the screen.
    const riser = new THREE.InstancedMesh(
      trimGeometry(),
      new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.95 }),
      Math.max(1, this.chambers.length)
    );
    riser.frustumCulled = false;
    const eo = this._tmp;
    let ei = 0;
    for (const ch of this.chambers) {
      if (ch.index === 0) continue;
      eo.position.set(0, ch.floorY - this.def.rise / 2, ch.z0 + 0.05);
      eo.rotation.set(0, 0, 0);
      eo.scale.set(W + 6 + 140, Math.max(0.3, this.def.rise) + 0.3, 0.9);
      eo.updateMatrix(); riser.setMatrixAt(ei++, eo.matrix);
    }
    riser.count = ei;
    riser.instanceMatrix.needsUpdate = true;
    if (ei) this.group.add(riser);
  }

  _buildGrid() {
    this.grid.clear();
    for (const c of this.colliders) {
      const r = c.br + 1;
      const x0 = Math.floor((c.x - r) / CELL), x1 = Math.floor((c.x + r) / CELL);
      const z0 = Math.floor((c.z - r) / CELL), z1 = Math.floor((c.z + r) / CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const k = gx * 73856093 ^ gz * 19349663;
          let arr = this.grid.get(k);
          if (!arr) { arr = []; this.grid.set(k, arr); }
          arr.push(c);
        }
      }
    }
  }

  clear() {
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const c = this.group.children[i];
      this.group.remove(c);
      c.traverse?.((o) => {
        if (o.geometry && !o.isInstancedMesh) o.geometry.dispose?.();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
        }
      });
      if (c.isInstancedMesh) c.dispose?.();
    }
    this.colliders.length = 0;
    this.modWalls.length = 0;
    this.chambers.length = 0;
    this.spawns.length = 0;
    this.grid.clear();
  }

  // ----------------------------------------------------------------- queries

  floorAt(z) {
    const chs = this.chambers;
    if (!chs.length) return 0;
    for (let i = 0; i < chs.length; i++) {
      const c = chs[i];
      if (z < c.z1 || i === chs.length - 1) {
        const next = chs[i + 1];
        if (next && z > c.z1 - 5) {
          const t = clamp((z - (c.z1 - 5)) / 5, 0, 1);
          return lerp(c.floorY, next.floorY, t * t * (3 - 2 * t));
        }
        return c.floorY;
      }
    }
    return chs[chs.length - 1].floorY;
  }

  freeSpotNear(x, z, minR, maxR, radius, rng = Math.random) {
    const probe = { nx: 0, nz: 0, depth: 0, collider: null };
    for (let i = 0; i < 40; i++) {
      const a = rng() * TAU;
      const r = minR + (maxR - minR) * (i / 40);
      const px = clamp(x + Math.cos(a) * r, this.bounds.minX + radius + 1, this.bounds.maxX - radius - 1);
      const pz = clamp(z + Math.sin(a) * r, this.bounds.minZ + radius + 1, this.bounds.maxZ - radius - 1);
      if (!this.collide(px, pz, radius + 0.4, probe)) return { x: px, z: pz };
    }
    return null;
  }

  chamberAt(z) {
    for (const c of this.chambers) if (z >= c.z0 && z < c.z1) return c;
    return this.chambers[this.chambers.length - 1];
  }

  /**
   * Circle vs. all nearby colliders. Returns the deepest overlap found, with a
   * surface normal, or null. Bullets bounce off this and the player slides
   * along it, so both agree about where a wall is.
   */
  collide(px, pz, r, out) {
    let best = null, bestDepth = -1;
    const gx = Math.floor(px / CELL), gz = Math.floor(pz / CELL);
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iz = gz - 1; iz <= gz + 1; iz++) {
        const arr = this.grid.get(ix * 73856093 ^ iz * 19349663);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          const dx = px - c.x, dz = pz - c.z;
          if (dx * dx + dz * dz > (c.br + r) * (c.br + r)) continue;
          const lx = dx * c.cos + dz * c.sin;
          const lz = -dx * c.sin + dz * c.cos;
          const cx = clamp(lx, -c.hw, c.hw);
          const cz = clamp(lz, -c.hd, c.hd);
          const ex = lx - cx, ez = lz - cz;
          const d2 = ex * ex + ez * ez;
          let nx, nz, depth;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            if (d >= r) continue;
            nx = ex / d; nz = ez / d; depth = r - d;
          } else {
            const px1 = c.hw - Math.abs(lx), pz1 = c.hd - Math.abs(lz);
            if (px1 < pz1) { nx = Math.sign(lx) || 1; nz = 0; depth = px1 + r; }
            else { nx = 0; nz = Math.sign(lz) || 1; depth = pz1 + r; }
          }
          if (depth > bestDepth) {
            bestDepth = depth;
            out.nx = nx * c.cos - nz * c.sin;
            out.nz = nx * c.sin + nz * c.cos;
            out.depth = depth;
            out.collider = c;
            best = c;
          }
        }
      }
    }
    return best ? out : null;
  }

  /**
   * First wall hit along a ray, used to draw the player's aim line so a bank
   * shot can be planned rather than guessed at.
   */
  raycast(x, z, dx, dz, maxDist) {
    const step = 0.55;
    const probe = { nx: 0, nz: 0, depth: 0, collider: null };
    let t = 0.8;
    while (t < maxDist) {
      const px = x + dx * t, pz = z + dz * t;
      if (px < this.bounds.minX || px > this.bounds.maxX || pz < this.bounds.minZ || pz > this.bounds.maxZ) {
        return { x: px, z: pz, dist: t, nx: 0, nz: 0, hit: false };
      }
      if (this.collide(px, pz, 0.3, probe)) {
        return { x: px + probe.nx * probe.depth, z: pz + probe.nz * probe.depth, dist: t, nx: probe.nx, nz: probe.nz, hit: true };
      }
      t += step;
    }
    return { x: x + dx * maxDist, z: z + dz * maxDist, dist: maxDist, nx: 0, nz: 0, hit: false };
  }

  update(dt, time) {
    for (const c of this.modWalls) {
      if (c.cooldown > 0) c.cooldown -= dt;
      const mw = c.modWall;
      const ready = c.cooldown <= 0;
      c.bump = Math.max(0, c.bump - dt * 3.2);
      // Spent panels desaturate instead of switching off, so the player sees a
      // cooldown rather than a wall that vanished.
      const t = (ready ? 1 : 0.45) + c.bump * 0.5;
      mw.body.material.color.copy(mw.baseColor).multiplyScalar(Math.min(1.35, t));
      mw.decal.material.opacity = (ready ? 0.2 : 0.07) + c.bump * 0.25;
    }
  }
}

// --------------------------------------------------------------- generators
//
// Every room is authored, not random. The shared rules:
//   * the middle third stays clear, so the player is never boxed in
//   * bounce surfaces live at the edges and on the diagonals
//   * spawn points sit away from walls, so nothing starts the fight stuck

function W(out, x, z, w, d, rot = 0) {
  out.walls.push({ x, z, w, d, h: WALL_H, rot });
}
function SLOT(out, x, z, w, d, rot = 0) {
  out.slots.push({ x, z, w, d, rot });
}
function SP(out, x, z) { out.spawns.push({ x, z }); }

const GENERATORS = {
  // Wide rectangle with a kicker across each corner. Everything you shoot at a
  // corner comes back across the room, which is the first thing to learn.
  court(out, p) {
    const { z0, z1, halfW, depth } = p;
    const mid = (z0 + z1) / 2;
    const kx = halfW * 0.7, kz = depth * 0.3;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        W(out, sx * kx, mid + sz * kz, 12, 2.2, sx * sz * 0.78);
      }
    }
    W(out, -halfW * 0.88, mid, 9, 2.2, Math.PI / 2);
    W(out, halfW * 0.88, mid, 9, 2.2, Math.PI / 2);
    SLOT(out, 0, z0 + depth * 0.22, 8, 2.4, 0);
    SLOT(out, 0, z1 - depth * 0.18, 8, 2.4, 0);
    SP(out, -halfW * 0.5, mid + 4);
    SP(out, halfW * 0.5, mid + 4);
    SP(out, 0, z1 - 8);
    SP(out, -halfW * 0.28, z1 - 12);
    SP(out, halfW * 0.28, z1 - 12);
    SP(out, 0, mid + 10);
  },

  // A broken centre wall. Two lanes, and every cross-shot is a bank shot.
  spine(out, p) {
    const { z0, z1, halfW, depth } = p;
    const mid = (z0 + z1) / 2;
    const seg = depth * 0.2;
    W(out, 0, z0 + depth * 0.26, 2.4, seg, 0);
    W(out, 0, z0 + depth * 0.74, 2.4, seg, 0);
    W(out, -halfW * 0.78, mid - depth * 0.2, 10, 2.2, 0.5);
    W(out, halfW * 0.78, mid - depth * 0.2, 10, 2.2, -0.5);
    W(out, -halfW * 0.78, mid + depth * 0.22, 10, 2.2, -0.5);
    W(out, halfW * 0.78, mid + depth * 0.22, 10, 2.2, 0.5);
    SLOT(out, -halfW * 0.42, mid, 7, 2.4, 0.25);
    SLOT(out, halfW * 0.42, mid, 7, 2.4, -0.25);
    SP(out, -halfW * 0.55, z0 + depth * 0.32);
    SP(out, halfW * 0.55, z0 + depth * 0.32);
    SP(out, -halfW * 0.55, z0 + depth * 0.7);
    SP(out, halfW * 0.55, z0 + depth * 0.7);
    SP(out, 0, z1 - 7);
    SP(out, 0, z0 + depth * 0.5);
  },

  // Four blocks set well back from each other. Lots of room, lots of corners.
  pockets(out, p) {
    const { z0, z1, halfW, depth, rng } = p;
    const xs = [-halfW * 0.56, halfW * 0.56];
    const zs = [z0 + depth * 0.3, z0 + depth * 0.7];
    for (const x of xs) {
      for (const z of zs) {
        const s = 5.5 + rng() * 1.6;
        W(out, x, z, s, s, rng() * 0.7);
      }
    }
    W(out, 0, z0 + depth * 0.5, 7, 2.4, 0.9);
    SLOT(out, -halfW * 0.9, z0 + depth * 0.5, 8, 2.4, Math.PI / 2);
    SLOT(out, halfW * 0.9, z0 + depth * 0.5, 8, 2.4, Math.PI / 2);
    SLOT(out, 0, z1 - depth * 0.14, 8, 2.4, 0);
    SP(out, 0, z0 + depth * 0.2);
    SP(out, -halfW * 0.82, z0 + depth * 0.5);
    SP(out, halfW * 0.82, z0 + depth * 0.5);
    SP(out, 0, z0 + depth * 0.78);
    SP(out, -halfW * 0.3, z1 - 8);
    SP(out, halfW * 0.3, z1 - 8);
  },

  // A funnel. Open in the middle, and the two long angles turn a miss down the
  // side into a hit on whatever is standing in the centre.
  vee(out, p) {
    const { z0, z1, halfW, depth } = p;
    const len = depth * 0.52;
    W(out, -halfW * 0.66, z0 + depth * 0.42, len, 2.2, 0.62);
    W(out, halfW * 0.66, z0 + depth * 0.42, len, 2.2, -0.62);
    W(out, -halfW * 0.5, z1 - depth * 0.14, 11, 2.2, -0.45);
    W(out, halfW * 0.5, z1 - depth * 0.14, 11, 2.2, 0.45);
    SLOT(out, 0, z0 + depth * 0.18, 9, 2.4, 0);
    SLOT(out, -halfW * 0.86, z0 + depth * 0.76, 7, 2.4, 0.3);
    SLOT(out, halfW * 0.86, z0 + depth * 0.76, 7, 2.4, -0.3);
    SP(out, 0, z0 + depth * 0.36);
    SP(out, -halfW * 0.4, z0 + depth * 0.6);
    SP(out, halfW * 0.4, z0 + depth * 0.6);
    SP(out, 0, z0 + depth * 0.72);
    SP(out, -halfW * 0.7, z1 - 9);
    SP(out, halfW * 0.7, z1 - 9);
  },

  // A broken ring with three ways in. The centre is the largest clear space in
  // the game and the ring behind you is one long curved bounce surface.
  ring(out, p) {
    const { z0, z1, halfW, depth } = p;
    const cz = (z0 + z1) / 2;
    const R = Math.min(halfW * 0.78, depth * 0.4);
    const segs = 10;
    for (let i = 0; i < segs; i++) {
      if (i === 0 || i === 3 || i === 7) continue;       // three gaps
      const a = (i / segs) * TAU;
      const x = Math.cos(a) * R, z = cz + Math.sin(a) * R;
      const rot = -a + Math.PI / 2;
      if (i === 2 || i === 8) { SLOT(out, x, z, R * 0.6, 2.4, rot); continue; }
      W(out, x, z, R * 0.58, 2.2, rot);
    }
    SLOT(out, 0, z0 + depth * 0.12, 8, 2.4, 0);
    SP(out, 0, cz);
    SP(out, -R * 0.55, cz + R * 0.4);
    SP(out, R * 0.55, cz + R * 0.4);
    SP(out, -R * 0.55, cz - R * 0.4);
    SP(out, R * 0.55, cz - R * 0.4);
    SP(out, 0, z1 - 8);
  },

  // The tutorial room. Hand-placed rather than generated, because each wall
  // here is a teaching aid: the two long side walls give an obvious bank line
  // from anywhere, and the short centre blocks give the player something to
  // shoot around before anything is shooting back.
  training(out, p) {
    // Hand-built, one feature per lesson, nothing in the way of anything else.
    // Every x here is written against halfW so the room survives a change to
    // the arena width; the first version of this was authored against a
    // 42-wide arena and put half its walls outside a 24-wide one.
    const { halfW, z0 } = p;
    const Z = (v) => z0 + v;
    const X = (f) => halfW * f;

    // Rails down both sides, set in from the kerb. They are the bank surface
    // for the whole room, and they are always within reach of the middle.
    W(out, -X(0.75), Z(54), 2.2, 58, 0);
    W(out,  X(0.75), Z(54), 2.2, 58, 0);

    // Lesson 3: a screen in front of each target, so the obvious shot is the
    // one that does not work.
    W(out, -X(0.55), Z(47), halfW * 0.66, 2.0, 0);
    W(out,  X(0.55), Z(47), halfW * 0.66, 2.0, 0);

    // Lesson 4: a pocket for the shielded one, open at both flanks.
    W(out, -X(0.46), Z(66), 2.0, 9, 0);
    W(out,  X(0.46), Z(66), 2.0, 9, 0);

    // Lesson 5: the panel, square on and unmissable.
    SLOT(out, 0, Z(75), halfW * 0.7, 2.2, 0);

    // Lesson 6: two posts to work around in the live fight.
    W(out, -X(0.42), Z(86), 3.2, 3.2, 0.6);
    W(out,  X(0.42), Z(86), 3.2, 3.2, -0.6);

    SP(out, 0, Z(50));
  },

  // Boss arena: one huge circle, pylons only at the rim. Nothing between the
  // player and the thing they are fighting.
  boss(out, p) {
    const { z0, z1, halfW, depth } = p;
    const cz = z0 + depth * 0.58;
    const segs = 12;
    const R = halfW * 0.88;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU;
      const x = Math.cos(a) * R;
      const z = cz + Math.sin(a) * (depth * 0.36);
      if (Math.abs(x) > halfW - 3) continue;
      if (z < z0 + 6) continue;
      const rot = -a + Math.PI / 2;
      if (i % 5 === 1) { SLOT(out, x, z, 8, 2.6, rot); continue; }
      W(out, x, z, 7, 2.4, rot);
    }
    W(out, -halfW * 0.6, z0 + 9, 12, 2.2, 0.55);
    W(out, halfW * 0.6, z0 + 9, 12, 2.2, -0.55);
    SLOT(out, -halfW * 0.34, z0 + 20, 8, 2.4, 0.2);
    SLOT(out, halfW * 0.34, z0 + 20, 8, 2.4, -0.2);
    SP(out, 0, cz);
  },
};

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
}
