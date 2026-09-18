// Small shared helpers: math, deterministic RNG, pooling and a tiny event bus.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
export const TAU = Math.PI * 2;

export function randRange(rng, a, b) { return a + rng() * (b - a); }
export function pick(rng, arr) { return arr[(rng() * arr.length) | 0]; }

// Deterministic PRNG so levels and debugging stay reproducible.
export function makeRng(seed = 1337) {
  let s = seed >>> 0;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function formatNumber(n) {
  n = Math.round(n);
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
  return String(n);
}

export function formatCoins(n) {
  return formatNumber(n);
}

// Fixed-capacity object pool. Entries are plain objects reset by the caller.
export class Pool {
  constructor(capacity, factory) {
    this.capacity = capacity;
    this.items = new Array(capacity);
    this.active = [];
    this.free = [];
    for (let i = 0; i < capacity; i++) {
      const it = factory(i);
      it._poolIndex = i;
      it._alive = false;
      this.items[i] = it;
      this.free.push(it);
    }
  }
  get count() { return this.active.length; }
  acquire() {
    const it = this.free.pop();
    if (!it) return null;
    it._alive = true;
    it._activeIndex = this.active.length;
    this.active.push(it);
    return it;
  }
  release(it) {
    if (!it._alive) return;
    it._alive = false;
    const last = this.active.pop();
    if (last !== it) {
      last._activeIndex = it._activeIndex;
      this.active[it._activeIndex] = last;
    }
    this.free.push(it);
  }
  releaseAll() {
    for (let i = this.active.length - 1; i >= 0; i--) this.release(this.active[i]);
  }
  /** Oldest active entry by a numeric field, used to recycle under pressure. */
  oldestBy(field) {
    let best = null, bestV = -Infinity;
    for (const it of this.active) {
      if (it[field] > bestV) { bestV = it[field]; best = it; }
    }
    return best;
  }
}

export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) {
    const l = this.map.get(name);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  emit(name, payload) {
    const l = this.map.get(name);
    if (!l) return;
    for (let i = 0; i < l.length; i++) l[i](payload);
  }
}

export function detectQuality() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!mobile && cores >= 8) return 'high';
  if (mem <= 3 || cores <= 4) return 'low';
  return 'medium';
}

export function isTouch() {
  return matchMedia('(hover: none) and (pointer: coarse)').matches || 'ontouchstart' in window;
}
