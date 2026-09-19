import { clamp } from '../core/utils.js';

/**
 * Everything is synthesised at runtime, but the point of this file is the
 * mix, not the synthesis.
 *
 * The old build played a sound for every event at roughly the same level, so a
 * busy second was two hundred voices of equal importance and the player could
 * not hear the one that mattered. Here every sound is assigned to one of four
 * buses, and the buses are mixed at fixed, very different levels:
 *
 *   ALERT   1.00  things that can kill you, and things you just won
 *   ACTION  0.60  enemy attacks, enemy deaths
 *   SELF    0.34  your own gun
 *   TEXTURE 0.16  bounces, impact ticks — felt more than heard
 *
 * An ALERT sound also ducks TEXTURE for a third of a second, so a wind-up or a
 * hit cuts through a firefight without anything being made louder.
 */
export class AudioEngine {
  constructor() {
    this.ready = false;
    this.ctx = null;
    this.musicOn = true;
    this.sfxOn = true;
    this.intensity = 0;
    this._lastPlay = new Map();
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 26;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;

    this.sfx = ctx.createGain(); this.sfx.gain.value = 1.0;
    this.music = ctx.createGain(); this.music.gain.value = 0.0;

    const bus = (level) => {
      const g = ctx.createGain();
      g.gain.value = level;
      g.connect(this.sfx);
      return g;
    };
    this.alert = bus(1.0);
    this.action = bus(0.6);
    this.self = bus(0.34);
    this.texture = bus(0.16);
    this._textureLevel = 0.16;

    // A short, dark room shared by everything, so the mix sits together.
    this.send = ctx.createGain(); this.send.gain.value = 0.18;
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.13;
    const fb = ctx.createGain(); fb.gain.value = 0.24;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2000;
    this.send.connect(delay); delay.connect(damp); damp.connect(fb); fb.connect(delay);
    damp.connect(this.master);

    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.noiseBuf = this._makeNoise(2.0);
    this.ready = true;
  }

  resume() {
    if (!this.ready) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMusicEnabled(on) {
    this.musicOn = on;
    if (this.music) this.music.gain.setTargetAtTime(on ? this._musicTarget ?? 0.3 : 0, this.ctx.currentTime, 0.2);
  }
  setSfxEnabled(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 1.0 : 0, this.ctx.currentTime, 0.05);
  }

  /** Pull the quiet layer down so an important sound lands in a clear space. */
  _duckTexture(amount = 0.35, seconds = 0.3) {
    if (!this.ready) return;
    const g = this.texture.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this._textureLevel * amount, t, 0.02);
    g.setTargetAtTime(this._textureLevel, t + seconds, 0.12);
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = white * 0.6 + last * 3.0;
    }
    return buf;
  }

  /** Throttle so repeated events cannot machine-gun one voice. */
  _gate(key, minGap) {
    const t = this.ctx.currentTime;
    const last = this._lastPlay.get(key) || -1;
    if (t - last < minGap) return false;
    this._lastPlay.set(key, t);
    return true;
  }

  tone(o) {
    if (!this.ready) return;
    if (!this.sfxOn && o.bus !== this.music) return;
    const ctx = this.ctx, t = o.at ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    const g = ctx.createGain();
    const dur = o.dur ?? 0.18;
    const peak = o.gain ?? 0.2;

    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    if (o.detune) osc.detune.value = o.detune;

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.cutoff ?? 1800, t);
      if (o.cutoffTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.cutoffTo), t + dur);
      f.Q.value = o.q ?? 1;
      node.connect(f); node = f;
    }
    node.connect(g);
    g.connect(o.bus || this.action);
    if (o.send) g.connect(this.send);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(o) {
    if (!this.ready) return;
    if (!this.sfxOn && o.bus !== this.music) return;
    const ctx = this.ctx, t = o.at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = o.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.cutoff ?? 1200, t);
    if (o.cutoffTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.cutoffTo), t + (o.dur ?? 0.15));
    f.Q.value = o.q ?? 1.2;
    const g = ctx.createGain();
    const dur = o.dur ?? 0.15;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || this.action);
    if (o.send) g.connect(this.send);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------- SELF

  fire() {
    if (!this.ready || !this._gate('fire', 0.05)) return;
    this.tone({ freq: 430, to: 190, type: 'triangle', dur: 0.07, gain: 0.5, filter: 'lowpass', cutoff: 2600, cutoffTo: 900, bus: this.self });
    this.noise({ dur: 0.04, gain: 0.3, filter: 'highpass', cutoff: 2200, rate: 1.3, bus: this.self });
  }

  dryFire() {
    if (!this.ready || !this._gate('dry', 0.25)) return;
    this.noise({ dur: 0.045, gain: 0.5, filter: 'bandpass', cutoff: 2600, q: 3, rate: 1.6, bus: this.self });
  }

  // ---------------------------------------------------------------- TEXTURE

  /** A bounce is a tick that rises a little with each charge step. */
  bounce(charge = 0) {
    if (!this.ready || !this._gate('bounce' + ((Math.random() * 3) | 0), 0.03)) return;
    const f = 520 + charge * 190;
    this.tone({ freq: f, to: f * 1.4, type: 'triangle', dur: 0.06, gain: 0.55, bus: this.texture, send: true });
  }

  bounceSpent() {
    if (!this.ready || !this._gate('spent', 0.05)) return;
    this.tone({ freq: 260, to: 150, type: 'sine', dur: 0.07, gain: 0.4, bus: this.texture });
  }

  hit(charge = 0) {
    if (!this.ready || !this._gate('hit' + ((Math.random() * 3) | 0), 0.025)) return;
    const bus = charge >= 3 ? this.action : this.texture;
    this.noise({ dur: 0.05, gain: 0.55, filter: 'bandpass', cutoff: 1100 + charge * 400, q: 1.2, rate: 1.1, bus });
    if (charge >= 2) this.tone({ freq: 150 + charge * 30, to: 62, type: 'sine', dur: 0.08, gain: 0.35, bus });
  }

  deflect() {
    if (!this.ready || !this._gate('deflect', 0.06)) return;
    this.tone({ freq: 1500, to: 900, type: 'square', dur: 0.09, gain: 0.3, filter: 'bandpass', cutoff: 2800, q: 5, bus: this.action, send: true });
  }

  // ----------------------------------------------------------------- ACTION

  enemyShot() {
    if (!this.ready || !this._gate('eshot', 0.06)) return;
    this.tone({ freq: 290, to: 160, type: 'sawtooth', dur: 0.14, gain: 0.35, filter: 'lowpass', cutoff: 1300 });
  }

  /** The wind-up sound. Deliberately the clearest thing in a firefight. */
  enemyLunge() {
    if (!this.ready || !this._gate('lunge', 0.08)) return;
    this._duckTexture(0.5, 0.2);
    this.tone({ freq: 220, to: 560, type: 'sawtooth', dur: 0.16, gain: 0.4, filter: 'bandpass', cutoff: 1400, q: 2.5, bus: this.alert });
  }

  enemyDeath(threat = 1) {
    if (!this.ready || !this._gate('death' + ((Math.random() * 3) | 0), 0.035)) return;
    const big = threat >= 4;
    this.noise({ dur: big ? 0.3 : 0.14, gain: big ? 0.7 : 0.45, filter: 'lowpass', cutoff: big ? 1800 : 2600, cutoffTo: 220, rate: big ? 0.7 : 1.1 });
    this.tone({ freq: big ? 150 : 250, to: big ? 40 : 80, type: 'triangle', dur: big ? 0.26 : 0.13, gain: big ? 0.5 : 0.3 });
  }

  slam() {
    if (!this.ready) return;
    this._duckTexture(0.3, 0.4);
    this.tone({ freq: 90, to: 32, type: 'sine', dur: 0.4, gain: 0.9, bus: this.alert });
    this.noise({ dur: 0.3, gain: 0.5, filter: 'lowpass', cutoff: 900, cutoffTo: 140, rate: 0.7, bus: this.alert });
  }

  burst() {
    if (!this.ready || !this._gate('burst', 0.08)) return;
    this.noise({ dur: 0.22, gain: 0.5, filter: 'lowpass', cutoff: 2400, cutoffTo: 200, rate: 0.9, send: true });
    this.tone({ freq: 180, to: 48, type: 'triangle', dur: 0.2, gain: 0.45 });
  }

  // ------------------------------------------------------------------ ALERT

  playerHit() {
    if (!this.ready) return;
    this._duckTexture(0.25, 0.45);
    this.tone({ freq: 200, to: 70, type: 'sawtooth', dur: 0.26, gain: 0.55, filter: 'lowpass', cutoff: 1100, cutoffTo: 200, bus: this.alert });
    this.noise({ dur: 0.2, gain: 0.35, filter: 'lowpass', cutoff: 800, rate: 0.8, bus: this.alert });
  }

  /** A round paid back by a bounce. Small, bright, and impossible to miss. */
  refund() {
    if (!this.ready || !this._gate('refund', 0.05)) return;
    this.tone({ freq: 880, to: 1320, type: 'triangle', dur: 0.1, gain: 0.3, bus: this.alert, send: true });
  }

  reload() {
    if (!this.ready || !this._gate('reload', 0.08)) return;
    this.tone({ freq: 620, type: 'triangle', dur: 0.05, gain: 0.14, bus: this.self });
  }

  modifier() {
    if (!this.ready) return;
    this._duckTexture(0.4, 0.3);
    const t = this.ctx.currentTime;
    [0, 4, 7].forEach((s, i) => this.tone({
      at: t + i * 0.05, freq: 523.25 * Math.pow(2, s / 12), type: 'triangle',
      dur: 0.3, gain: 0.3, bus: this.alert, send: true,
    }));
  }

  waveClear() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12].forEach((s, i) => this.tone({
      at: t + i * 0.08, freq: 392 * Math.pow(2, s / 12), type: 'triangle',
      dur: 0.42, gain: 0.26, bus: this.alert, send: true,
    }));
  }

  bossHit(scale = 1) {
    if (!this.ready || !this._gate('bosshit', 0.05)) return;
    this.tone({ freq: 120, to: 44, type: 'sine', dur: 0.13, gain: 0.5 * scale });
    this.noise({ dur: 0.1, gain: 0.3 * scale, filter: 'bandpass', cutoff: 800, q: 1.0, rate: 0.85 });
  }

  plateBreak() {
    if (!this.ready) return;
    this._duckTexture(0.3, 0.4);
    this.noise({ dur: 0.5, gain: 0.7, filter: 'bandpass', cutoff: 1600, cutoffTo: 300, q: 0.7, rate: 0.9, bus: this.alert, send: true });
    this.tone({ freq: 320, to: 70, type: 'square', dur: 0.3, gain: 0.35, filter: 'lowpass', cutoff: 1400, bus: this.alert });
  }

  bossCall() {
    if (!this.ready) return;
    this.tone({ freq: 110, to: 180, type: 'sawtooth', dur: 0.6, gain: 0.4, filter: 'lowpass', cutoff: 700, bus: this.alert, send: true });
  }

  bossPhase() {
    if (!this.ready) return;
    this._duckTexture(0.25, 0.7);
    const t = this.ctx.currentTime;
    this.tone({ freq: 70, to: 210, type: 'sawtooth', dur: 0.8, gain: 0.5, filter: 'lowpass', cutoff: 400, cutoffTo: 2200, bus: this.alert, send: true });
    [1, 1.2, 1.5].forEach((m) => this.tone({ at: t + 0.4, freq: 130 * m, type: 'triangle', dur: 1.1, gain: 0.22, bus: this.alert, send: true }));
  }

  bossDeath() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.noise({ dur: 2.0, gain: 0.7, filter: 'lowpass', cutoff: 3200, cutoffTo: 90, rate: 0.55, bus: this.alert, send: true });
    this.tone({ freq: 200, to: 26, type: 'sawtooth', dur: 1.8, gain: 0.5, filter: 'lowpass', cutoff: 1800, cutoffTo: 120, bus: this.alert });
    for (let i = 0; i < 5; i++) {
      this.noise({ at: t + 0.15 + i * 0.16, dur: 0.35, gain: 0.4, filter: 'bandpass', cutoff: 380 + i * 240, q: 0.8, rate: 0.9, bus: this.alert });
    }
  }

  // --------------------------------------------------------------------- UI

  ui(kind = 'click') {
    if (!this.ready) return;
    const bus = this.alert;
    if (kind === 'click') {
      this.tone({ freq: 760, to: 1020, type: 'triangle', dur: 0.045, gain: 0.16, bus });
    } else if (kind === 'confirm') {
      const t = this.ctx.currentTime;
      [0, 7].forEach((s, i) => this.tone({ at: t + i * 0.055, freq: 523.25 * Math.pow(2, s / 12), type: 'triangle', dur: 0.16, gain: 0.18, bus, send: true }));
    } else if (kind === 'open') {
      this.tone({ freq: 200, to: 700, type: 'triangle', dur: 0.4, gain: 0.2, filter: 'lowpass', cutoff: 900, cutoffTo: 3200, bus, send: true });
    } else if (kind === 'back') {
      this.tone({ freq: 620, to: 400, type: 'triangle', dur: 0.07, gain: 0.14, bus });
    } else if (kind === 'reward') {
      const t = this.ctx.currentTime;
      [0, 4, 7, 12].forEach((s, i) => this.tone({ at: t + i * 0.1, freq: 523.25 * Math.pow(2, s / 12), type: 'triangle', dur: 0.5, gain: 0.2, bus, send: true }));
    }
  }

  setIntensity(v) { this.intensity = clamp(v, 0, 1); }
}
