import * as THREE from 'three';
import { Pool, formatNumber } from '../core/utils.js';

/**
 * Damage numbers are DOM elements projected from world space. Text stays crisp
 * at any device pixel ratio and CSS handles the pop/float animation on the
 * compositor rather than in JS.
 *
 * Hits on the same target inside a short window merge into one rising number,
 * which keeps a 200-bullet swarm readable instead of a blizzard of digits.
 */
export class DamageNumbers {
  constructor(camera, mergeWindow = 0.12) {
    this.camera = camera;
    this.mergeWindow = mergeWindow;
    this.root = document.getElementById('worldtext');
    this.v = new THREE.Vector3();
    this.byTarget = new Map();

    this.pool = new Pool(46, () => {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.style.display = 'none';
      this.root.appendChild(el);
      return { el, t: 0, life: 0.9, x: 0, y: 0, z: 0, vy: 0, amount: 0, crit: false, target: null, kind: '' };
    });
  }

  /** @param kind '' | 'crit' | 'burn' | 'boss' | 'huge' */
  add(target, x, y, z, amount, kind = '') {
    const now = performance.now() / 1000;
    const key = target ? (target.__dnKey ||= Math.random()) : null;
    if (key !== null) {
      const ex = this.byTarget.get(key);
      if (ex && ex._alive && now - ex.born < this.mergeWindow && ex.kind === kind) {
        ex.amount += amount;
        ex.t = Math.min(ex.t, 0.08);
        ex.el.textContent = formatNumber(ex.amount);
        ex.el.classList.remove('bump');
        void ex.el.offsetWidth;
        ex.el.classList.add('bump');
        ex.x = x; ex.y = y; ex.z = z;
        return ex;
      }
    }

    let d = this.pool.acquire();
    if (!d) { this._retire(this.pool.active[0]); d = this.pool.acquire(); }
    d.t = 0; d.born = now; d.amount = amount; d.kind = kind;
    d.life = kind === 'huge' ? 1.35 : kind === 'crit' ? 1.05 : 0.85;
    d.x = x; d.y = y; d.z = z;
    d.vy = kind === 'huge' ? 5.2 : 3.4;
    d.target = target;
    d.el.className = 'dmg' + (kind ? ' ' + kind : '');
    d.el.textContent = formatNumber(amount);
    d.el.style.display = 'block';
    d.el.style.opacity = '1';
    if (key !== null) this.byTarget.set(key, d);
    return d;
  }

  _retire(d) {
    d.el.style.display = 'none';
    this.pool.release(d);
  }

  update(dt, hidden = false) {
    const cam = this.camera;
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.pool.active.length - 1; i >= 0; i--) {
      const d = this.pool.active[i];
      d.t += dt;
      const t = d.t / d.life;
      if (t >= 1 || hidden) { this._retire(d); continue; }
      d.y += d.vy * dt;
      d.vy -= 5.5 * dt;

      this.v.set(d.x, d.y, d.z).project(cam);
      if (this.v.z > 1) { this._retire(d); continue; }
      const sx = (this.v.x * 0.5 + 0.5) * w;
      const sy = (-this.v.y * 0.5 + 0.5) * h;
      const pop = t < 0.14 ? 1 + (1 - t / 0.14) * 0.55 : 1;
      const scale = pop * (d.kind === 'huge' ? 1.75 : d.kind === 'crit' ? 1.25 : 1);
      d.el.style.transform = `translate3d(${sx}px,${sy}px,0) translate(-50%,-50%) scale(${scale.toFixed(3)})`;
      d.el.style.opacity = String(t > 0.65 ? (1 - t) / 0.35 : 1);
    }
  }

  reset() {
    for (const d of [...this.pool.active]) this._retire(d);
    this.byTarget.clear();
  }
}
