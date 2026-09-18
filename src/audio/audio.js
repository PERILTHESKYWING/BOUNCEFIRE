import { clamp } from '../core/utils.js';

/**
 * Everything is synthesised at runtime: no sample loading, no placeholder
 * beeps, and a single cohesive electronic identity across SFX and music.
 *
 * Signal path:  voices -> [sfx|music] bus -> saturation -> master comp -> out
 * A short feedback delay on a send bus gives the whole mix a common space.
 */
export class AudioEngine {
  constructor() {
    this.ready = false;
    this.ctx = null;
    this.muted = false;
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
    this.master.gain.value = 0.85;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 7;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.16;

    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9;
    this.music = ctx.createGain(); this.music.gain.value = 0.0;

    // shared space
    this.send = ctx.createGain(); this.send.gain.value = 0.32;
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.19;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2600;
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

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }
  setMusicEnabled(on) {
    this.musicOn = on;
    if (this.music) this.music.gain.setTargetAtTime(on ? this._musicTarget ?? 0.34 : 0, this.ctx.currentTime, 0.2);
  }
  setSfxEnabled(on) {
    this.sfxOn = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;   // gentle brown tint, less harsh
      d[i] = white * 0.7 + last * 3.2;
    }
    return buf;
  }

  /** Throttle so a 200-bullet swarm cannot machine-gun the same voice. */
  _gate(key, minGap) {
    const t = this.ctx.currentTime;
    const last = this._lastPlay.get(key) || -1;
    if (t - last < minGap) return false;
    this._lastPlay.set(key, t);
    return true;
  }

  tone(o) {
    if (!this.ready || !this.sfxOn) return;
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
    g.connect(o.bus || this.sfx);
    if (o.send) g.connect(this.send);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(o) {
    if (!this.ready || !this.sfxOn) return;
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
    src.connect(f); f.connect(g); g.connect(o.bus || this.sfx);
    if (o.send) g.connect(this.send);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------ game sounds

  fire(pitch = 1) {
    if (!this.ready || !this._gate('fire', 0.035)) return;
    const f = 520 * pitch;
    this.tone({ freq: f, to: f * 0.35, type: 'square', dur: 0.075, gain: 0.055, filter: 'lowpass', cutoff: 3200, cutoffTo: 900 });
    this.noise({ dur: 0.05, gain: 0.035, filter: 'highpass', cutoff: 2400, rate: 1.4 });
  }

  bounce(strength = 1) {
    if (!this.ready || !this._gate('bounce' + ((Math.random() * 3) | 0), 0.028)) return;
    const f = 380 + Math.random() * 520;
    this.tone({ freq: f, to: f * 1.9, type: 'triangle', dur: 0.09, gain: 0.05 * strength, send: true });
    this.noise({ dur: 0.045, gain: 0.03 * strength, filter: 'bandpass', cutoff: 2600, q: 2.2, rate: 1.7 });
  }

  hit() {
    if (!this.ready || !this._gate('hit' + ((Math.random() * 4) | 0), 0.02)) return;
    this.noise({ dur: 0.07, gain: 0.075, filter: 'bandpass', cutoff: 1500 + Math.random() * 900, q: 1.1, rate: 1.2 });
    this.tone({ freq: 160 + Math.random() * 60, to: 60, type: 'sine', dur: 0.09, gain: 0.09 });
  }

  crit() {
    if (!this.ready || !this._gate('crit', 0.07)) return;
    const base = 880;
    [1, 1.5, 2].forEach((m, i) => this.tone({
      freq: base * m, to: base * m * 1.4, type: 'square', dur: 0.14 - i * 0.02,
      gain: 0.07, filter: 'bandpass', cutoff: 2400 * m, q: 3, send: true,
    }));
    this.noise({ dur: 0.1, gain: 0.07, filter: 'highpass', cutoff: 3800, rate: 1.9 });
  }

  modifier(punch = 1, seedFreq = 300) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // riser
    this.tone({ freq: seedFreq, to: seedFreq * 4.5, type: 'sawtooth', dur: 0.22 * punch, gain: 0.07 * punch, filter: 'lowpass', cutoff: 800, cutoffTo: 6000, send: true });
    // chord stab
    [1, 1.26, 1.5, 2].forEach((m, i) => this.tone({
      at: t + 0.12, freq: seedFreq * 1.6 * m, type: 'sawtooth', dur: 0.4,
      gain: 0.05 * punch, filter: 'lowpass', cutoff: 5200, q: 0.8, send: true, detune: (i - 1.5) * 6,
    }));
    this.noise({ at: t + 0.1, dur: 0.3, gain: 0.05 * punch, filter: 'highpass', cutoff: 5200, rate: 0.8 });
    this.tone({ at: t + 0.11, freq: 90, to: 40, type: 'sine', dur: 0.3, gain: 0.16 * punch });
  }

  enemyDeath(big = false) {
    if (!this.ready || !this._gate('death' + ((Math.random() * 3) | 0), 0.03)) return;
    const g = big ? 0.16 : 0.09;
    this.noise({ dur: big ? 0.36 : 0.19, gain: g, filter: 'lowpass', cutoff: big ? 2400 : 3200, cutoffTo: 220, rate: big ? 0.7 : 1.1, send: true });
    this.tone({ freq: big ? 180 : 320, to: big ? 38 : 70, type: 'square', dur: big ? 0.3 : 0.16, gain: g * 0.8, filter: 'lowpass', cutoff: 1600, cutoffTo: 300 });
  }

  combo(step) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const scale = [0, 3, 5, 7, 10, 12, 15, 19];
    const root = 440 * Math.pow(2, Math.min(step, 5) / 12);
    for (let i = 0; i < 5; i++) {
      const semis = scale[i % scale.length] + 12 * Math.floor(i / scale.length);
      this.tone({
        at: t + i * 0.045, freq: root * Math.pow(2, semis / 12), type: 'square',
        dur: 0.2, gain: 0.06, filter: 'bandpass', cutoff: 3000, q: 2.5, send: true,
      });
    }
  }

  overdrive() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone({ freq: 60, to: 420, type: 'sawtooth', dur: 0.7, gain: 0.12, filter: 'lowpass', cutoff: 400, cutoffTo: 7000, send: true });
    [1, 1.5, 2, 3].forEach((m) => this.tone({ at: t + 0.45, freq: 220 * m, type: 'sawtooth', dur: 0.9, gain: 0.05, filter: 'lowpass', cutoff: 6000, send: true }));
    this.noise({ at: t + 0.4, dur: 0.8, gain: 0.08, filter: 'highpass', cutoff: 2000, rate: 0.6 });
  }

  bossHit(scale = 1) {
    if (!this.ready || !this._gate('bosshit', 0.045)) return;
    this.tone({ freq: 110, to: 34, type: 'sine', dur: 0.16, gain: 0.18 * scale });
    this.noise({ dur: 0.12, gain: 0.09 * scale, filter: 'bandpass', cutoff: 900, q: 0.9, rate: 0.8 });
  }

  bossPhase() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone({ freq: 70, to: 260, type: 'sawtooth', dur: 1.0, gain: 0.14, filter: 'lowpass', cutoff: 300, cutoffTo: 4200, send: true });
    [1, 1.19, 1.5].forEach((m) => this.tone({ at: t + 0.5, freq: 130 * m, type: 'sawtooth', dur: 1.4, gain: 0.06, filter: 'lowpass', cutoff: 2800, send: true }));
  }

  bossDeath() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.noise({ dur: 2.4, gain: 0.26, filter: 'lowpass', cutoff: 4200, cutoffTo: 90, rate: 0.55, send: true });
    this.tone({ freq: 220, to: 24, type: 'sawtooth', dur: 2.0, gain: 0.2, filter: 'lowpass', cutoff: 2200, cutoffTo: 120 });
    for (let i = 0; i < 6; i++) {
      this.noise({ at: t + 0.1 + i * 0.13, dur: 0.4, gain: 0.12, filter: 'bandpass', cutoff: 400 + i * 260, q: 0.8, rate: 0.9 });
    }
  }

  playerHit() {
    if (!this.ready) return;
    this.tone({ freq: 240, to: 70, type: 'sawtooth', dur: 0.25, gain: 0.13, filter: 'lowpass', cutoff: 1400, cutoffTo: 220 });
    this.noise({ dur: 0.2, gain: 0.09, filter: 'lowpass', cutoff: 1100, rate: 0.8 });
  }

  pickup() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    [0, 4, 7].forEach((s, i) => this.tone({ at: t + i * 0.05, freq: 660 * Math.pow(2, s / 12), type: 'triangle', dur: 0.2, gain: 0.07, send: true }));
  }

  ui(kind = 'click') {
    if (!this.ready) return;
    if (kind === 'click') {
      this.tone({ freq: 900, to: 1500, type: 'triangle', dur: 0.05, gain: 0.05 });
    } else if (kind === 'confirm') {
      const t = this.ctx.currentTime;
      [0, 7, 12].forEach((s, i) => this.tone({ at: t + i * 0.04, freq: 520 * Math.pow(2, s / 12), type: 'square', dur: 0.14, gain: 0.05, filter: 'lowpass', cutoff: 4000, send: true }));
    } else if (kind === 'open') {
      this.tone({ freq: 180, to: 900, type: 'sawtooth', dur: 0.4, gain: 0.07, filter: 'lowpass', cutoff: 600, cutoffTo: 5200, send: true });
    } else if (kind === 'back') {
      this.tone({ freq: 700, to: 380, type: 'triangle', dur: 0.08, gain: 0.05 });
    } else if (kind === 'reward') {
      const t = this.ctx.currentTime;
      [0, 4, 7, 12, 16].forEach((s, i) => this.tone({ at: t + i * 0.07, freq: 440 * Math.pow(2, s / 12), type: 'square', dur: 0.35, gain: 0.06, filter: 'bandpass', cutoff: 2600, q: 2, send: true }));
    }
  }

  /** Rises with the size of the bullet swarm; music layers follow it. */
  setIntensity(v) { this.intensity = clamp(v, 0, 1); }
}
