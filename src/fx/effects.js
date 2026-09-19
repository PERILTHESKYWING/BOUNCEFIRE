import * as THREE from '../../vendor/three/three.module.js';
import { glowTexture } from '../world/geometry.js';
import { Pool, clamp } from '../core/utils.js';

/**
 * Pooled non-particle effects: ground rings, impact flashes and the screen
 * wash used when the player is hurt. Everything is preallocated so combat
 * never allocates mid-frame.
 *
 * Rings are the workhorse and they are painted, not additive: a ring is a mark
 * on the floor that says where something happened, and it has to stay readable
 * on top of a bright floor as well as a dark one.
 */
export class Effects {
  constructor(scene, renderer, particles) {
    this.scene = scene;
    this.particles = particles;
    this.time = 0;

    // --- shockwave rings -------------------------------------------------
    const ringGeo = new THREE.RingGeometry(0.72, 1.0, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 1,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
    });
    this.rings = new Pool(28, () => {
      const m = new THREE.Mesh(ringGeo, ringMat.clone());
      m.visible = false; m.renderOrder = 6;
      scene.add(m);
      return { mesh: m, t: 0, life: 0.5, from: 1, to: 8, tilt: 0 };
    });

    // --- flash sprites ---------------------------------------------------
    const glow = glowTexture(renderer);
    const flashMat = new THREE.SpriteMaterial({
      map: glow, color: 0xffffff, transparent: true,
      depthWrite: false, toneMapped: true,
    });
    this.flashes = new Pool(64, () => {
      const s = new THREE.Sprite(flashMat.clone());
      s.visible = false; s.renderOrder = 7;
      scene.add(s);
      return { sprite: s, t: 0, life: 0.2, size: 3 };
    });

    // --- expanding explosion spheres -------------------------------------
    const sphGeo = new THREE.IcosahedronGeometry(1, 1);
    const sphMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.6,
      depthWrite: false, toneMapped: true, wireframe: false,
    });
    this.blasts = new Pool(16, () => {
      const m = new THREE.Mesh(sphGeo, sphMat.clone());
      m.visible = false; m.renderOrder = 6;
      scene.add(m);
      return { mesh: m, t: 0, life: 0.34, size: 5 };
    });

    this.flashLayer = document.getElementById('flashlayer');
    this._flashT = 0; this._flashD = 0; this._flashColor = '#ffffff';
  }

  ring(x, y, z, color, from, to, life = 0.45, tilt = 0) {
    const r = this.rings.acquire() || (this.rings.release(this.rings.active[0]), this.rings.acquire());
    if (!r) return;
    r.t = 0; r.life = life; r.from = from; r.to = to;
    r.mesh.position.set(x, y, z);
    r.mesh.rotation.z = tilt;
    r.mesh.material.color.setHex(color);
    r.mesh.material.opacity = 1;
    r.mesh.scale.setScalar(from);
    r.mesh.visible = true;
  }

  flash(x, y, z, color, size, life = 0.18) {
    let f = this.flashes.acquire();
    if (!f) { this.flashes.release(this.flashes.active[0]); f = this.flashes.acquire(); }
    f.t = 0; f.life = life; f.size = size;
    f.sprite.position.set(x, y, z);
    f.sprite.material.color.setHex(color);
    f.sprite.material.opacity = 1;
    f.sprite.scale.setScalar(size);
    f.sprite.visible = true;
  }

  blast(x, y, z, color, size, life = 0.34) {
    let b = this.blasts.acquire();
    if (!b) { this.blasts.release(this.blasts.active[0]); b = this.blasts.acquire(); }
    b.t = 0; b.life = life; b.size = size;
    b.mesh.position.set(x, y, z);
    b.mesh.material.color.setHex(color);
    b.mesh.material.opacity = 0.75;
    b.mesh.scale.setScalar(size * 0.2);
    b.mesh.visible = true;
  }

  screenFlash(color = '#ffffff', strength = 0.35, dur = 0.22) {
    this._flashColor = color;
    this._flashD = dur;
    this._flashT = dur;
    this._flashS = strength;
  }

  update(dt) {
    this.time += dt;

    for (let i = this.rings.active.length - 1; i >= 0; i--) {
      const r = this.rings.active[i];
      r.t += dt;
      const t = r.t / r.life;
      if (t >= 1) { r.mesh.visible = false; this.rings.release(r); continue; }
      const e = 1 - Math.pow(1 - t, 3);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * e);
      r.mesh.material.opacity = (1 - t) * (1 - t);
    }

    for (let i = this.flashes.active.length - 1; i >= 0; i--) {
      const f = this.flashes.active[i];
      f.t += dt;
      const t = f.t / f.life;
      if (t >= 1) { f.sprite.visible = false; this.flashes.release(f); continue; }
      f.sprite.scale.setScalar(f.size * (0.6 + t * 1.1));
      f.sprite.material.opacity = (1 - t) * (1 - t);
    }

    for (let i = this.blasts.active.length - 1; i >= 0; i--) {
      const b = this.blasts.active[i];
      b.t += dt;
      const t = b.t / b.life;
      if (t >= 1) { b.mesh.visible = false; this.blasts.release(b); continue; }
      const e = 1 - Math.pow(1 - t, 2.4);
      b.mesh.scale.setScalar(b.size * (0.2 + e * 1.0));
      b.mesh.material.opacity = 0.75 * (1 - t) * (1 - t);
    }

    if (this._flashT > 0) {
      this._flashT -= dt;
      const a = clamp(this._flashT / this._flashD, 0, 1);
      this.flashLayer.style.background = this._flashColor;
      this.flashLayer.style.opacity = String(a * a * this._flashS);
    } else if (this.flashLayer.style.opacity !== '0') {
      this.flashLayer.style.opacity = '0';
    }
  }

  reset() {
    for (const p of [this.rings, this.flashes, this.blasts]) {
      for (const it of [...p.active]) {
        (it.mesh || it.sprite).visible = false;
        p.release(it);
      }
    }
    this._flashT = 0;
    this.flashLayer.style.opacity = '0';
  }
}
