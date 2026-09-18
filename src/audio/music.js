import { clamp } from '../core/utils.js';

/**
 * A step-sequenced arcade/electronic score, generated live. Layers unmute as
 * the swarm grows, so the soundtrack escalates with the action instead of
 * looping flat. Each level picks a key and pattern set from its theme.
 */
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

const TRACKS = {
  neon:     { bpm: 148, root: 55.00, scale: 'minor',    arp: [0, 4, 2, 6, 0, 5, 2, 7], bassPat: [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,1,0,0] },
  volcanic: { bpm: 152, root: 49.00, scale: 'phrygian', arp: [0, 3, 5, 3, 0, 6, 4, 2], bassPat: [1,0,1,0, 1,0,0,1, 1,0,1,0, 0,1,0,1] },
  crystal:  { bpm: 144, root: 61.74, scale: 'dorian',   arp: [0, 4, 7, 4, 2, 6, 4, 9], bassPat: [1,0,0,1, 0,1,0,0, 1,0,0,1, 0,0,1,0] },
  void:     { bpm: 158, root: 46.25, scale: 'phrygian', arp: [0, 2, 5, 7, 4, 2, 6, 3], bassPat: [1,1,0,1, 0,1,1,0, 1,1,0,1, 0,1,0,1] },
  frozen:   { bpm: 142, root: 58.27, scale: 'minor',    arp: [0, 5, 3, 7, 2, 5, 4, 8], bassPat: [1,0,0,0, 1,0,0,1, 1,0,0,0, 1,0,1,0] },
  bio:      { bpm: 150, root: 51.91, scale: 'dorian',   arp: [0, 3, 6, 4, 2, 7, 5, 3], bassPat: [1,0,1,1, 0,1,0,0, 1,0,1,1, 0,0,1,0] },
  stone:    { bpm: 138, root: 53.00, scale: 'minor',    arp: [0, 4, 2, 7, 0, 5, 3, 6], bassPat: [1,0,0,1, 1,0,0,0, 1,0,0,1, 0,1,0,0] },
};

const KICK  = [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0];
const SNARE = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1];
const HAT   = [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,1,1];

export class Music {
  constructor(audio) {
    this.a = audio;
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.track = TRACKS.neon;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.timer = null;
    this.bar = 0;
    this.duck = 1;
  }

  _bus() { return this.a.music; }

  start(themeId) {
    if (!this.a.ready) return;
    this.track = TRACKS[themeId] || TRACKS.neon;
    if (this.playing) { this.bar = 0; return; }
    this.playing = true;
    this.step = 0;
    this.bar = 0;
    this.nextTime = this.a.ctx.currentTime + 0.08;
    this.a._musicTarget = 0.34;
    this.a.music.gain.setTargetAtTime(this.a.musicOn ? 0.34 : 0, this.a.ctx.currentTime, 0.6);
    this.timer = setInterval(() => this._schedule(), 25);
  }

  stop(fade = 0.5) {
    if (!this.a.ready) return;
    this.a.music.gain.setTargetAtTime(0, this.a.ctx.currentTime, fade / 3);
    clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
  }

  setIntensity(v) { this.targetIntensity = clamp(v, 0, 1); }

  /** Momentarily pull the music down so a stinger can land. */
  duckFor(seconds = 0.6) {
    if (!this.a.ready) return;
    const g = this.a.music.gain, t = this.a.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.a.musicOn ? 0.1 : 0, t, 0.04);
    g.setTargetAtTime(this.a.musicOn ? 0.34 : 0, t + seconds, 0.25);
  }

  _note(semi, octave = 0) {
    const sc = SCALES[this.track.scale];
    const oct = Math.floor(semi / sc.length) + octave;
    const deg = ((semi % sc.length) + sc.length) % sc.length;
    return this.track.root * Math.pow(2, oct + sc[deg] / 12);
  }

  _schedule() {
    const a = this.a;
    if (!a.ready || !this.playing) return;
    const ctx = a.ctx;
    const spb = 60 / this.track.bpm / 4;   // 16th note
    const horizon = ctx.currentTime + 0.18;

    this.intensity += (this.targetIntensity - this.intensity) * 0.08;
    const I = this.intensity;
    const bus = this._bus();

    while (this.nextTime < horizon) {
      const t = this.nextTime;
      const s = this.step % 16;
      if (s === 0) this.bar++;

      // --- drums
      if (KICK[s]) {
        a.tone({ at: t, freq: 130, to: 42, type: 'sine', dur: 0.2, gain: 0.5, bus });
        a.noise({ at: t, dur: 0.03, gain: 0.12, filter: 'lowpass', cutoff: 800, bus });
      }
      if (SNARE[s] && I > 0.08) {
        a.noise({ at: t, dur: 0.14, gain: 0.16 + I * 0.1, filter: 'bandpass', cutoff: 1900, q: 0.8, rate: 1.1, bus, send: true });
        a.tone({ at: t, freq: 220, to: 150, type: 'triangle', dur: 0.09, gain: 0.1, bus });
      }
      if (HAT[s]) {
        a.noise({ at: t, dur: 0.035, gain: 0.05 + I * 0.05, filter: 'highpass', cutoff: 7200, rate: 2.0, bus });
      }

      // --- bass: always present, it is the spine of the loop
      if (this.track.bassPat[s]) {
        const deg = (this.bar % 4 === 3 && s > 11) ? 3 : 0;
        a.tone({
          at: t, freq: this._note(deg, 0), type: 'sawtooth', dur: spb * 2.1,
          gain: 0.20 + I * 0.08, filter: 'lowpass', cutoff: 320 + I * 900, q: 6, bus,
        });
      }

      // --- arp: fades in with the swarm
      if (I > 0.18 && s % 2 === 0) {
        const idx = (this.step / 2) % this.track.arp.length;
        const oct = I > 0.62 ? 2 : 1;
        a.tone({
          at: t, freq: this._note(this.track.arp[idx], oct), type: 'square',
          dur: spb * 1.5, gain: 0.05 + I * 0.05,
          filter: 'bandpass', cutoff: 1400 + I * 3200, q: 3, bus, send: true,
        });
      }

      // --- lead stabs at high intensity
      if (I > 0.55 && s % 8 === 4) {
        const idx = (this.bar + this.step) % this.track.arp.length;
        [0, 7].forEach((o, k) => a.tone({
          at: t + k * 0.012, freq: this._note(this.track.arp[idx] + o, 2), type: 'sawtooth',
          dur: spb * 3, gain: 0.035 + I * 0.03, filter: 'lowpass', cutoff: 2600 + I * 3000, bus, send: true,
        }));
      }

      // --- pad on bar boundaries for width
      if (s === 0 && I > 0.3) {
        [0, 2, 4].forEach((d, k) => a.tone({
          at: t, freq: this._note(d, 1), type: 'sawtooth', dur: spb * 15,
          gain: 0.018 + I * 0.018, filter: 'lowpass', cutoff: 900 + I * 1400,
          detune: (k - 1) * 8, bus, send: true,
        }));
      }

      this.nextTime += spb;
      this.step++;
    }
  }
}
