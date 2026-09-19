import { clamp } from '../core/utils.js';

/**
 * The soundtrack.
 *
 * The previous score was a 150bpm step sequencer whose "melody" was an
 * arpeggiator walking a scale, which is why it read as more combat noise
 * rather than as music. This one is written: three pieces, each with an actual
 * tune you could hum, over a four-chord progression, at a tempo that leaves
 * room for the game on top of it.
 *
 * Notes are written as scale degrees against the piece's key, so a track is a
 * short readable table rather than a pile of frequencies. Degree 0 is the
 * root; 7 is the octave; negatives go below.
 *
 * Arrangement is fixed, not reactive. Layers do not slam in and out with the
 * bullet count any more — intensity only moves the mix a little, so the music
 * stays music.
 */

const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** step is a 16th; a bar is 16 steps. Melodies are written over 64 steps. */
const TRACKS = {
  // Menu: unhurried, a little wistful, the tune stated plainly.
  menu: {
    bpm: 84, root: 220, scale: MINOR, swing: 0.1,
    chords: [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]],
    drums: false,
    melody: [
      { s: 0, n: 7, d: 6 }, { s: 6, n: 6, d: 2 }, { s: 8, n: 4, d: 6 }, { s: 14, n: 2, d: 2 },
      { s: 16, n: 4, d: 4 }, { s: 20, n: 2, d: 4 }, { s: 24, n: 0, d: 8 },
      { s: 32, n: 4, d: 4 }, { s: 36, n: 6, d: 4 }, { s: 40, n: 7, d: 6 }, { s: 46, n: 9, d: 2 },
      { s: 48, n: 7, d: 6 }, { s: 54, n: 6, d: 2 }, { s: 56, n: 4, d: 8 },
    ],
  },

  // Field: the same key, stepped up in pace, with a walking bass and a light
  // kit. This is what plays for most of the game, so it is written to sit
  // underneath rather than on top.
  field: {
    bpm: 104, root: 196, scale: MINOR, swing: 0.08,
    chords: [[0, 2, 4], [3, 5, 0], [5, 0, 2], [4, 6, 1]],
    drums: true,
    melody: [
      { s: 0, n: 4, d: 3 }, { s: 3, n: 5, d: 1 }, { s: 4, n: 7, d: 4 }, { s: 10, n: 6, d: 2 }, { s: 12, n: 4, d: 4 },
      { s: 16, n: 2, d: 3 }, { s: 19, n: 4, d: 1 }, { s: 20, n: 5, d: 4 }, { s: 26, n: 4, d: 2 }, { s: 28, n: 2, d: 4 },
      { s: 32, n: 7, d: 3 }, { s: 35, n: 9, d: 1 }, { s: 36, n: 11, d: 5 }, { s: 42, n: 9, d: 2 }, { s: 44, n: 7, d: 4 },
      { s: 48, n: 6, d: 3 }, { s: 51, n: 4, d: 1 }, { s: 52, n: 2, d: 6 }, { s: 58, n: 4, d: 2 }, { s: 60, n: 0, d: 4 },
    ],
    counter: [
      { s: 8, n: 0, d: 4 }, { s: 24, n: 2, d: 4 }, { s: 40, n: 4, d: 4 }, { s: 56, n: 2, d: 4 },
    ],
  },

  // Boss: same material, minor sixth below, slower and heavier. Using the same
  // tune keeps the game sounding like one place.
  boss: {
    bpm: 92, root: 165, scale: MINOR, swing: 0,
    chords: [[0, 2, 4], [1, 3, 5], [0, 2, 4], [6, 1, 3]],
    drums: true, heavy: true,
    melody: [
      { s: 0, n: 0, d: 8 }, { s: 8, n: 2, d: 4 }, { s: 12, n: 3, d: 4 },
      { s: 16, n: 4, d: 8 }, { s: 24, n: 3, d: 4 }, { s: 28, n: 2, d: 4 },
      { s: 32, n: 7, d: 8 }, { s: 40, n: 6, d: 4 }, { s: 44, n: 4, d: 4 },
      { s: 48, n: 3, d: 6 }, { s: 54, n: 2, d: 2 }, { s: 56, n: 0, d: 8 },
    ],
  },
};

const KICK  = [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0];
const RIM   = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
const SHAKE = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0];

export class Music {
  constructor(audio) {
    this.a = audio;
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.trackId = 'menu';
    this.track = TRACKS.menu;
    this.intensity = 0.5;
    this.targetIntensity = 0.5;
    this.timer = null;
    this.baseGain = 0.3;
  }

  start(trackId = 'field') {
    if (!this.a.ready) return;
    const next = TRACKS[trackId] || TRACKS.field;
    if (this.playing && next === this.track) return;
    this.track = next;
    this.trackId = trackId;
    this.step = 0;
    if (!this.playing) {
      this.playing = true;
      this.nextTime = this.a.ctx.currentTime + 0.1;
      this.timer = setInterval(() => this._schedule(), 30);
    }
    this.a._musicTarget = this.baseGain;
    this.a.music.gain.setTargetAtTime(this.a.musicOn ? this.baseGain : 0, this.a.ctx.currentTime, 0.7);
  }

  stop(fade = 0.6) {
    if (!this.a.ready) return;
    this.a.music.gain.setTargetAtTime(0, this.a.ctx.currentTime, fade / 3);
    clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
  }

  setIntensity(v) { this.targetIntensity = clamp(v, 0, 1); }

  /** Briefly step aside so a stinger lands in a clear space. */
  duckFor(seconds = 0.6) {
    if (!this.a.ready) return;
    const g = this.a.music.gain, t = this.a.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(this.a.musicOn ? this.baseGain * 0.35 : 0, t, 0.05);
    g.setTargetAtTime(this.a.musicOn ? this.baseGain : 0, t + seconds, 0.3);
  }

  _freq(degree, octave = 0) {
    const sc = this.track.scale;
    const oct = Math.floor(degree / sc.length) + octave;
    const deg = ((degree % sc.length) + sc.length) % sc.length;
    return this.track.root * Math.pow(2, oct + sc[deg] / 12);
  }

  /** A soft plucked lead: triangle with a slow attack and a filtered tail. */
  _lead(t, freq, dur, gain) {
    const a = this.a, bus = a.music;
    a.tone({
      at: t, freq, type: 'triangle', dur, gain,
      attack: 0.03, filter: 'lowpass', cutoff: 2600, bus, send: true,
    });
    a.tone({
      at: t, freq: freq * 2, type: 'sine', dur: dur * 0.6, gain: gain * 0.3,
      attack: 0.02, bus, send: true,
    });
  }

  _schedule() {
    const a = this.a;
    if (!a.ready || !this.playing) return;
    const ctx = a.ctx;
    const bus = a.music;
    const tr = this.track;
    const spb = 60 / tr.bpm / 4;
    const horizon = ctx.currentTime + 0.25;

    this.intensity += (this.targetIntensity - this.intensity) * 0.05;
    const I = this.intensity;

    while (this.nextTime < horizon) {
      const swing = (this.step % 2 === 1) ? spb * tr.swing : 0;
      const t = this.nextTime + swing;
      const s = this.step % 64;
      const bar = Math.floor(s / 16);
      const beat = s % 16;
      const chord = tr.chords[bar % tr.chords.length];

      // --- bass: the root of the bar, plus a lift into the next one
      if (beat === 0 || beat === 8 || (beat === 14 && bar % 2 === 1)) {
        const deg = beat === 14 ? chord[1] - 7 : chord[0] - 7;
        a.tone({
          at: t, freq: this._freq(deg, 0), type: 'triangle', dur: spb * 6,
          gain: 0.34, attack: 0.02, filter: 'lowpass', cutoff: 420, bus,
        });
      }

      // --- pad: the chord, held, quiet, with a little detune for width
      if (beat === 0) {
        chord.forEach((d, k) => a.tone({
          at: t, freq: this._freq(d, 0), type: 'sawtooth', dur: spb * 15,
          gain: 0.045 + I * 0.02, attack: 0.25,
          filter: 'lowpass', cutoff: 700 + I * 500, detune: (k - 1) * 7, bus, send: true,
        }));
      }

      // --- the tune
      for (const n of tr.melody) {
        if (n.s !== s) continue;
        this._lead(t, this._freq(n.n, 1), spb * n.d * 0.95, 0.15 + I * 0.05);
      }
      if (tr.counter) {
        for (const n of tr.counter) {
          if (n.s !== s) continue;
          a.tone({
            at: t, freq: this._freq(n.n, 1), type: 'sine', dur: spb * n.d,
            gain: 0.06, attack: 0.05, bus, send: true,
          });
        }
      }

      // --- kit: soft, and it never competes with the gun
      if (tr.drums) {
        if (KICK[beat]) {
          a.tone({ at: t, freq: 110, to: 45, type: 'sine', dur: 0.16, gain: 0.34, bus });
        }
        if (RIM[beat]) {
          a.noise({ at: t, dur: 0.05, gain: 0.1, filter: 'bandpass', cutoff: 1700, q: 2.2, rate: 1.2, bus });
        }
        if (SHAKE[beat]) {
          a.noise({ at: t, dur: 0.03, gain: 0.035 + I * 0.02, filter: 'highpass', cutoff: 6500, rate: 1.8, bus });
        }
        if (tr.heavy && beat === 0) {
          a.noise({ at: t, dur: 0.4, gain: 0.05, filter: 'lowpass', cutoff: 400, rate: 0.6, bus });
        }
      }

      this.nextTime += spb;
      this.step++;
    }
  }
}
