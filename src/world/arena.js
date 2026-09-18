import * as THREE from 'three';
import { THEMES } from '../data/themes.js';
import { MODIFIERS } from '../data/modifiers.js';
import { makeRng, clamp, lerp, TAU } from '../core/utils.js';
import { wallGeometry, trimGeometry, floorTexture, modifierTexture, glowTexture } from './geometry.js';

const CELL = 8;
// Walls are authored at a readable 'board' height; the camera looks down at
// roughly 50 degrees, so anything taller hides the maze behind it.
const WALL_HEIGHT = 0.46;

/**
 * A wall collider is an oriented box in the XZ plane. Gameplay stays planar so
 * bouncing is cheap and predictable; the floor still climbs chamber by chamber
 * so the player is genuinely travelling upward through the structure.
 */
class Collider {
  constructor(x, z, hw, hd, rot) {
    this.x = x; this.z = z; this.hw = hw; this.hd = hd;
    this.rot = rot;
    this.cos = Math.cos(rot); this.sin = Math.sin(rot);
    this.mod = null;          // modifier definition, if this is a modifier wall
    this.modWall = null;      // visual for the modifier wall
    this.cooldown = 0;
    this.bump = 0;            // visual hit response
    this.instance = -1;
    this.height = 6;
    this.baseY = 0;
    // conservative circumscribed radius for broad-phase
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
    this.theme = THEMES.neon;
    this.bounds = { minX: -20, maxX: 20, minZ: 0, maxZ: 100 };
    this._tmp = new THREE.Object3D();
  }

  // ---------------------------------------------------------------- building

  build(def) {
    this.clear();
    const theme = THEMES[def.theme] || THEMES.neon;
    this.theme = theme;
    this.def = def;
    const rng = makeRng(def.seed);
    this.rng = rng;

    const W = def.width;
    const halfW = W / 2;
    let z = 0;
    let floorY = 0;
    const raw = [];          // {x,z,w,d,h,rot,mod}
    const spawnPts = [];
    const modSlots = [];

    for (let ci = 0; ci < def.chambers.length; ci++) {
      const ch = def.chambers[ci];
      const z0 = z, z1 = z + ch.depth;
      const chamber = { index: ci, z0, z1, floorY, spec: ch, cleared: false, boss: ch.type === 'boss' };
      this.chambers.push(chamber);

      const out = { walls: [], spawns: [], slots: [] };
      const gen = GENERATORS[ch.type] || GENERATORS.open;
      gen(out, { z0, z1, halfW, depth: ch.depth, floorY, rng, theme, index: ci });

      for (const w of out.walls) { w.baseY = floorY; w.h *= WALL_HEIGHT; raw.push(w); }
      for (const s of out.spawns) spawnPts.push({ ...s, chamber: ci, floorY });
      for (const s of out.slots) modSlots.push({ ...s, chamber: ci, floorY, mods: ch.mods });

      // assign enemy types to this chamber's spawn points
      const list = [];
      for (const [type, n] of Object.entries(ch.enemies || {})) {
        for (let i = 0; i < n; i++) list.push(type);
      }
      shuffle(list, rng);
      const pts = spawnPts.filter((p) => p.chamber === ci);
      const squad = 7;                       // enemies per cluster
      const groups = Math.max(1, Math.ceil(list.length / squad));
      for (let i = 0; i < list.length; i++) {
        const gi = Math.floor(i / squad) % groups;
        const p = pts[(gi * 2 + 1) % pts.length];
        const a = rng() * Math.PI * 2;
        const r = 1.4 + rng() * 3.4;
        this.spawns.push({
          type: list[i],
          x: clamp(p.x + Math.cos(a) * r, -halfW + 3, halfW - 3),
          z: p.z + Math.sin(a) * r,
          chamber: ci,
          floorY,
        });
      }

      z = z1;
      floorY += (ch.type === 'boss' ? 0 : def.rise);
    }

    // assign modifier walls from each chamber's list into its slots
    const byChamber = new Map();
    for (const s of modSlots) {
      if (!byChamber.has(s.chamber)) byChamber.set(s.chamber, []);
      byChamber.get(s.chamber).push(s);
    }
    for (const [ci, slots] of byChamber) {
      const mods = def.chambers[ci].mods || [];
      shuffleStable(slots, makeRng(def.seed + ci * 7919));
      for (let i = 0; i < mods.length && i < slots.length; i++) {
        slots[i].modId = mods[i];
        raw.push({
          x: slots[i].x, z: slots[i].z, w: slots[i].w, d: slots[i].d,
          h: slots[i].h * WALL_HEIGHT, rot: slots[i].rot, baseY: slots[i].floorY,
          mod: mods[i],
        });
      }
    }

    // outer boundary — tall, so the arena reads as enclosed from the camera
    const totalZ = z;
    const bh = 5.2;
    raw.push({ x: -halfW - 1.5, z: totalZ / 2, w: 3, d: totalZ + 8, h: bh, rot: 0, baseY: 0, boundary: true });
    raw.push({ x: halfW + 1.5, z: totalZ / 2, w: 3, d: totalZ + 8, h: bh, rot: 0, baseY: 0, boundary: true });
    raw.push({ x: 0, z: -3.5, w: W + 8, d: 3, h: bh, rot: 0, baseY: 0, boundary: true });
    raw.push({ x: 0, z: totalZ + 3.5, w: W + 8, d: 3, h: bh, rot: 0, baseY: 0, boundary: true });

    this.bounds = { minX: -halfW, maxX: halfW, minZ: 0, maxZ: totalZ };
    this._buildMeshes(raw, theme, totalZ, W);
    this._buildGrid();

    // Nudge any spawn that landed inside geometry; a walled-in enemy would
    // otherwise be unkillable and the level could never be cleared.
    const probe = { nx: 0, nz: 0, depth: 0, collider: null };
    for (const s of this.spawns) {
      if (!this.collide(s.x, s.z, 1.8, probe)) continue;
      const spot = this.freeSpotNear(s.x, s.z, 2.5, 12, 1.8, rng);
      if (spot) { s.x = spot.x; s.z = spot.z; }
    }
    return this;
  }

  _buildMeshes(raw, theme, totalZ, W) {
    const plain = raw.filter((w) => !w.mod);
    const geo = wallGeometry(theme.wallShape);

    const wallMat = new THREE.MeshStandardMaterial({
      color: theme.wall,
      roughness: theme.wallRough,
      metalness: theme.wallMetal,
      emissive: theme.wallEmissive,
      emissiveIntensity: 0.18,
    });
    const trimMat = new THREE.MeshBasicMaterial({ color: theme.wallTrim });

    const walls = new THREE.InstancedMesh(geo, wallMat, plain.length);
    walls.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    walls.frustumCulled = false;
    const trims = new THREE.InstancedMesh(trimGeometry(), trimMat, plain.length);
    trims.frustumCulled = false;
    const caps = new THREE.InstancedMesh(trimGeometry(), wallMat, plain.length);
    caps.frustumCulled = false;

    const o = this._tmp;
    for (let i = 0; i < plain.length; i++) {
      const w = plain[i];
      o.position.set(w.x, w.baseY + w.h / 2, w.z);
      o.rotation.set(0, w.rot, 0);
      o.scale.set(w.w, w.h, w.d);
      o.updateMatrix();
      walls.setMatrixAt(i, o.matrix);

      const th = 0.24;
      o.position.set(w.x, w.baseY + w.h - th * 0.3, w.z);
      o.scale.set(w.w * 1.0, th, w.d * 1.0);
      o.updateMatrix();
      trims.setMatrixAt(i, o.matrix);

      // inset dark cap leaves the trim reading as a lit border
      const inset = 0.62;
      o.position.set(w.x, w.baseY + w.h - th * 0.1, w.z);
      o.scale.set(Math.max(0.2, w.w - 1.1) * (w.w > 3 ? 1 : inset), th, Math.max(0.2, w.d - 1.1) * (w.d > 3 ? 1 : inset));
      o.updateMatrix();
      caps.setMatrixAt(i, o.matrix);

      const c = new Collider(w.x, w.z, w.w / 2, w.d / 2, w.rot);
      c.height = w.h; c.baseY = w.baseY; c.instance = i; c.boundary = !!w.boundary;
      this.colliders.push(c);
    }
    walls.instanceMatrix.needsUpdate = true;
    trims.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    this.group.add(walls, trims, caps);
    this.wallMesh = walls; this.trimMesh = trims; this.capMesh = caps;

    for (const w of raw) if (w.mod) this._buildModifierWall(w, theme);

    this._buildFloor(theme, totalZ, W);
  }

  _buildModifierWall(w, theme) {
    const mod = MODIFIERS[w.mod];
    const g = new THREE.Group();
    g.position.set(w.x, w.baseY, w.z);
    g.rotation.y = w.rot;

    const body = new THREE.Mesh(
      wallGeometry(theme.wallShape),
      new THREE.MeshStandardMaterial({
        color: theme.wall, roughness: 0.25, metalness: 0.65,
        emissive: mod.glow, emissiveIntensity: 0.55,
      })
    );
    body.scale.set(w.w, w.h, w.d);
    body.position.y = w.h / 2;
    g.add(body);

    // emissive frame on the crown
    const frame = new THREE.Mesh(
      trimGeometry(),
      new THREE.MeshBasicMaterial({ color: mod.color })
    );
    frame.scale.set(w.w * 1.0, 0.3, w.d * 1.0);
    frame.position.y = w.h - 0.1;
    g.add(frame);

    const inner = new THREE.Mesh(trimGeometry(), body.material);
    inner.scale.set(Math.max(0.2, w.w - 1.0), 0.32, Math.max(0.2, w.d - 1.0));
    inner.position.y = w.h - 0.04;
    g.add(inner);

    // Label plates. The crown plate is the one the player actually reads from
    // the chase camera; the face plates sell it in the distance.
    const tex = modifierTexture(mod);
    let plateW = Math.min(w.w * 0.9, 8.5);
    let plateH = Math.min(w.d * 0.85, plateW * 0.5);
    plateW = plateH * 2;   // keep the 2:1 label aspect, never overhang the wall
    const plateMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, toneMapped: false, depthWrite: false,
    });
    const crown = new THREE.Mesh(new THREE.PlaneGeometry(plateW, plateH), plateMat);
    crown.rotation.x = -Math.PI / 2;
    crown.rotation.z = Math.PI;   // label top points up-screen for the chase camera
    crown.position.y = w.h + 0.26;
    g.add(crown);

    const faceW = Math.min(w.w * 0.9, 8.5);
    const faceH = Math.min(w.h * 0.72, faceW * 0.5);
    const faceGeo = new THREE.PlaneGeometry(faceH * 2, faceH);
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(faceGeo, plateMat);
      p.position.set(0, w.h * 0.52, s * (w.d / 2 + 0.06));
      if (s < 0) p.rotation.y = Math.PI;
      g.add(p);
    }

    // floor decal: visible from directly above, and it never fills the screen
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(w.w * 1.08, w.d * 2.6),
      new THREE.MeshBasicMaterial({
        map: glowTexture(this.renderer), color: mod.color,
        transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.07;
    g.add(halo);

    this.group.add(g);

    const c = new Collider(w.x, w.z, w.w / 2, w.d / 2, w.rot);
    c.height = w.h; c.baseY = w.baseY; c.mod = mod;
    c.modWall = { group: g, body, frame, inner, halo, baseEmissive: 0.55, plateMat };
    this.colliders.push(c);
    this.modWalls.push(c);
  }

  _buildFloor(theme, totalZ, W) {
    const tex = floorTexture(theme);
    // one floor slab per chamber so the elevation steps read clearly
    for (const ch of this.chambers) {
      const depth = ch.z1 - ch.z0;
      const t = tex.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(W / 16, depth / 16);
      const mat = new THREE.MeshStandardMaterial({
        map: t, color: 0xffffff, roughness: 0.92, metalness: 0.1,
        emissive: theme.floorGlow, emissiveIntensity: 0.018,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(W + 6, depth + 0.4), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, ch.floorY, (ch.z0 + ch.z1) / 2);
      this.group.add(m);

    }

    // Step lips and edge strips are all boxes sharing one emissive colour, so
    // they collapse into a single instanced draw instead of ~20.
    const edges = new THREE.InstancedMesh(
      trimGeometry(),
      new THREE.MeshBasicMaterial({ color: theme.floorGlow }),
      this.chambers.length * 3
    );
    edges.frustumCulled = false;
    const eo = this._tmp;
    let ei = 0;
    for (const ch of this.chambers) {
      if (ch.index > 0) {
        eo.position.set(0, ch.floorY - this.def.rise / 2, ch.z0 + 0.1);
        eo.rotation.set(0, 0, 0);
        eo.scale.set(W + 6, Math.max(0.3, this.def.rise), 0.5);
        eo.updateMatrix(); edges.setMatrixAt(ei++, eo.matrix);
      }
      for (const s of [-1, 1]) {
        eo.position.set(s * (W / 2 - 0.2), ch.floorY + 0.06, (ch.z0 + ch.z1) / 2);
        eo.rotation.set(0, 0, 0);
        eo.scale.set(0.28, 0.1, ch.z1 - ch.z0);
        eo.updateMatrix(); edges.setMatrixAt(ei++, eo.matrix);
      }
    }
    edges.count = ei;
    edges.instanceMatrix.needsUpdate = true;
    this.group.add(edges);
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

  cellAt(x, z) {
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    return this.grid.get(gx * 73856093 ^ gz * 19349663);
  }

  clear() {
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const c = this.group.children[i];
      this.group.remove(c);
      c.traverse?.((o) => {
        if (o.geometry && o.geometry.__shared !== true) {
          // shared cached geometries must survive; instanced/plane ones are per-level
          if (!(o.isInstancedMesh)) o.geometry.dispose?.();
        }
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

  /** Floor height at a given z, smoothed across the chamber boundary. */
  floorAt(z) {
    const chs = this.chambers;
    if (!chs.length) return 0;
    for (let i = 0; i < chs.length; i++) {
      const c = chs[i];
      if (z < c.z1 || i === chs.length - 1) {
        const next = chs[i + 1];
        if (next && z > c.z1 - 6) {
          const t = clamp((z - (c.z1 - 6)) / 6, 0, 1);
          return lerp(c.floorY, next.floorY, t * t * (3 - 2 * t));
        }
        return c.floorY;
      }
    }
    return chs[chs.length - 1].floorY;
  }

  /**
   * Find an open spot in a ring around (x, z). Used to keep spawns out of walls
   * and to rally stragglers, so a clear-the-level objective can always finish.
   */
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
   * surface normal, or null. Used by both bullets (bounce) and the player
   * (slide), which keeps behaviour consistent.
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
          // into wall local space
          const lx = dx * c.cos + dz * c.sin;
          const lz = -dx * c.sin + dz * c.cos;
          const cx = clamp(lx, -c.hw, c.hw);
          const cz = clamp(lz, -c.hd, c.hd);
          let ex = lx - cx, ez = lz - cz;
          let d2 = ex * ex + ez * ez;
          let nx, nz, depth;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            if (d >= r) continue;
            nx = ex / d; nz = ez / d; depth = r - d;
          } else {
            // centre inside the box: push out along the shallowest axis
            const px1 = c.hw - Math.abs(lx), pz1 = c.hd - Math.abs(lz);
            if (px1 < pz1) { nx = Math.sign(lx) || 1; nz = 0; depth = px1 + r; }
            else { nx = 0; nz = Math.sign(lz) || 1; depth = pz1 + r; }
          }
          if (depth > bestDepth) {
            bestDepth = depth;
            // back to world space
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

  update(dt, time) {
    for (const c of this.modWalls) {
      if (c.cooldown > 0) c.cooldown -= dt;
      const mw = c.modWall;
      const ready = c.cooldown <= 0;
      c.bump = Math.max(0, c.bump - dt * 4.5);
      const pulse = 0.5 + Math.sin(time * 3.1 + c.x * 0.3 + c.z * 0.17) * 0.18;
      const target = (ready ? 0.55 + pulse * 0.55 : 0.12) + c.bump * 2.4;
      mw.body.material.emissiveIntensity += (target - mw.body.material.emissiveIntensity) * Math.min(1, dt * 12);
      const a = (ready ? 0.4 + pulse * 0.25 : 0.1) + c.bump * 0.8;
      mw.halo.material.opacity = a * 0.9;
        const s = 1 + c.bump * 0.12;
      mw.frame.scale.y = 0.5 * (1 + c.bump * 3);
      mw.body.scale.x = c.hw * 2 * s;
    }
  }
}

// ------------------------------------------------------------- generators
// Each generator fills `out` with walls, enemy spawn points and modifier slots
// for one chamber. Shapes are deliberately hand-tuned rather than random so
// every level has a legible route and good ricochet lines.

function W(out, x, z, w, d, h, rot = 0) {
  out.walls.push({ x, z, w, d, h, rot });
  return out.walls[out.walls.length - 1];
}
function SLOT(out, x, z, w, d, h, rot = 0) {
  out.slots.push({ x, z, w, d, h, rot });
}
function SP(out, x, z) { out.spawns.push({ x, z }); }

const GENERATORS = {
  gate(out, p) {
    const { z0, z1, halfW, rng } = p;
    const mid = (z0 + z1) / 2;
    const h = 6;
    W(out, -halfW * 0.62, mid, halfW * 0.5, 2.4, h);
    W(out, halfW * 0.62, mid, halfW * 0.5, 2.4, h);
    W(out, 0, z0 + 6, 9, 2.2, h * 0.8, 0);
    SLOT(out, 0, mid + 8, 12, 2.6, h + 1);
    SP(out, -halfW * 0.5, mid + 6);
    SP(out, halfW * 0.5, mid + 6);
    SP(out, 0, z1 - 5);
    SP(out, -halfW * 0.25, z1 - 8);
    SP(out, halfW * 0.25, z1 - 8);
  },

  split(out, p) {
    const { z0, z1, halfW, depth } = p;
    const mid = (z0 + z1) / 2;
    const h = 7;
    // central island
    W(out, 0, mid, halfW * 0.7, depth * 0.36, h);
    // angled deflectors at the mouth
    W(out, -halfW * 0.55, z0 + 6, 11, 2.2, h, -0.5);
    W(out, halfW * 0.55, z0 + 6, 11, 2.2, h, 0.5);
    // shoulders at the exit
    W(out, -halfW * 0.72, z1 - 7, 9, 2.2, h, 0.42);
    W(out, halfW * 0.72, z1 - 7, 9, 2.2, h, -0.42);
    SLOT(out, -halfW * 0.34, mid, 2.6, depth * 0.3, h + 1);
    SLOT(out, halfW * 0.34, mid, 2.6, depth * 0.3, h + 1);
    SP(out, -halfW * 0.68, mid);
    SP(out, halfW * 0.68, mid);
    SP(out, -halfW * 0.68, mid + 9);
    SP(out, halfW * 0.68, mid + 9);
    SP(out, 0, z1 - 4);
    SP(out, -halfW * 0.4, z0 + 10);
    SP(out, halfW * 0.4, z0 + 10);
  },

  chevron(out, p) {
    const { z0, z1, halfW, depth } = p;
    const h = 6.5;
    const rows = depth > 34 ? 3 : 2;
    for (let i = 0; i < rows; i++) {
      const z = z0 + depth * ((i + 0.65) / (rows + 0.3));
      const flip = i % 2 === 0 ? 1 : -1;
      const len = halfW * 0.86;
      W(out, -halfW * 0.42, z, len, 2.2, h, flip * 0.62);
      W(out, halfW * 0.42, z, len, 2.2, h, -flip * 0.62);
      if (i === rows - 1) {
        SLOT(out, -halfW * 0.42, z - flip * 6, len * 0.62, 2.5, h + 1, flip * 0.62);
        SLOT(out, halfW * 0.42, z - flip * 6, len * 0.62, 2.5, h + 1, -flip * 0.62);
      }
      SP(out, 0, z + 2);
      SP(out, -halfW * 0.62, z + 6);
      SP(out, halfW * 0.62, z + 6);
    }
    SP(out, 0, z1 - 5);
  },

  pillars(out, p) {
    const { z0, z1, halfW, depth, rng } = p;
    const cols = 4, rows = Math.max(3, Math.round(depth / 9));
    const h = 7.5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const off = r % 2 ? 0.5 : 0;
        const x = (-halfW * 0.78) + ((c + off) / (cols - 1 + 0.5)) * halfW * 1.56;
        const z = z0 + 5 + (r / rows) * (depth - 8);
        if (Math.abs(x) > halfW - 3) continue;
        const s = 3 + rng() * 1.8;
        if (r === 1 && c === 1) { SLOT(out, x, z, 5.2, 5.2, h + 1, rng() * 0.7); continue; }
        if (r === rows - 2 && c === 2) { SLOT(out, x, z, 5.2, 5.2, h + 1, rng() * 0.7); continue; }
        W(out, x, z, s, s, h * (0.7 + rng() * 0.5), rng() * 0.8);
        if ((r + c) % 2 === 0) SP(out, x + 3.5, z + 3.5);
      }
    }
    SP(out, 0, z1 - 5);
    SP(out, -halfW * 0.6, z0 + 5);
    SP(out, halfW * 0.6, z0 + 5);
  },

  ring(out, p) {
    const { z0, z1, halfW, depth, rng } = p;
    const cz = (z0 + z1) / 2;
    const R = Math.min(halfW * 0.66, depth * 0.36);
    const h = 7;
    const segs = 9;
    for (let i = 0; i < segs; i++) {
      if (i === 0 || i === Math.floor(segs / 2)) continue;  // entrance + exit gaps
      const a = (i / segs) * TAU;
      const x = Math.cos(a) * R, z = cz + Math.sin(a) * R;
      const rot = -a + Math.PI / 2;
      if (i === 2 || i === segs - 2) { SLOT(out, x, z, R * 0.66, 2.4, h + 1, rot); continue; }
      W(out, x, z, R * 0.62, 2.2, h, rot);
      SP(out, x * 0.55, cz + (z - cz) * 0.55);
    }
    // centre pocket
    W(out, 0, cz, 5, 5, h * 1.2, rng() * 0.8);
    SP(out, 0, cz - R * 0.75);
    SP(out, 0, cz + R * 0.75);
    SP(out, -halfW * 0.85, cz);
    SP(out, halfW * 0.85, cz);
    SP(out, -halfW * 0.8, z1 - 5);
    SP(out, halfW * 0.8, z1 - 5);
  },

  weave(out, p) {
    const { z0, z1, halfW, depth } = p;
    const h = 7;
    const rows = Math.max(3, Math.round(depth / 11));
    for (let i = 0; i < rows; i++) {
      const z = z0 + 6 + (i / rows) * (depth - 10);
      const side = i % 2 ? 1 : -1;
      const len = halfW * 1.15;
      W(out, side * (halfW - len / 2 + 1), z, len, 2.4, h, side * 0.14);
      if (i === 1) SLOT(out, -side * halfW * 0.55, z + 5.5, 8, 2.6, h + 1, -side * 0.35);
      if (i === rows - 1) SLOT(out, -side * halfW * 0.55, z - 5.5, 8, 2.6, h + 1, side * 0.35);
      SP(out, -side * halfW * 0.6, z + 3);
      SP(out, -side * halfW * 0.25, z - 3);
    }
    SP(out, 0, z1 - 4);
  },

  open(out, p) {
    const { z0, z1, halfW, depth, rng } = p;
    const h = 6.5;
    // sparse cover so the space breathes but bullets still find surfaces
    W(out, -halfW * 0.7, z0 + depth * 0.3, 7, 3, h, 0.35);
    W(out, halfW * 0.7, z0 + depth * 0.3, 7, 3, h, -0.35);
    W(out, -halfW * 0.55, z0 + depth * 0.72, 6, 3, h, -0.5);
    W(out, halfW * 0.55, z0 + depth * 0.72, 6, 3, h, 0.5);
    W(out, 0, z0 + depth * 0.52, 8, 3.4, h * 1.25, rng() * 0.6);
    SLOT(out, -halfW * 0.86, z0 + depth * 0.5, 10, 2.6, h + 1.5, 0.12);
    SLOT(out, halfW * 0.86, z0 + depth * 0.5, 10, 2.6, h + 1.5, -0.12);
    SLOT(out, 0, z1 - 6, 13, 2.8, h + 1.5);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      SP(out, Math.cos(a) * halfW * 0.6, z0 + depth * 0.5 + Math.sin(a) * depth * 0.3);
    }
  },

  boss(out, p) {
    const { z0, z1, halfW, depth } = p;
    const cz = z0 + depth * 0.56;
    const h = 9;
    // perimeter of angled pylons: spectacular, and every one is a bounce surface
    const segs = 16;
    const R = halfW * 0.92;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU;
      const x = Math.cos(a) * R;
      const z = cz + Math.sin(a) * (depth * 0.42);
      if (Math.abs(x) > halfW - 2.5) continue;
      if (z < z0 + 4) continue;
      const rot = -a + Math.PI / 2;
      if (i % 4 === 1) { SLOT(out, x, z, 9, 2.6, h + 2, rot); continue; }
      W(out, x, z, 7.5, 2.6, h, rot);
    }
    // approach funnel
    W(out, -halfW * 0.62, z0 + 8, 12, 2.4, h, 0.5);
    W(out, halfW * 0.62, z0 + 8, 12, 2.4, h, -0.5);
    SLOT(out, -halfW * 0.34, z0 + 20, 9, 2.6, h + 1, 0.2);
    SLOT(out, halfW * 0.34, z0 + 20, 9, 2.6, h + 1, -0.2);
    // inner bounce pillars flanking the boss
    W(out, -halfW * 0.42, cz - 4, 4, 4, h * 1.1, 0.4);
    W(out, halfW * 0.42, cz - 4, 4, 4, h * 1.1, -0.4);
    SP(out, 0, cz);
  },
};

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
}
function shuffleStable(a, rng) { shuffle(a, rng); }
