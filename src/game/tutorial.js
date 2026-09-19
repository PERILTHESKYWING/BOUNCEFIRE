import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../core/utils.js';

/**
 * Onboarding.
 *
 * It is a room you play through, not a screen you read. Six beats, one idea
 * each, in the order the game actually needs them, and no beat starts until
 * the last one has been done:
 *
 *   1  move            2  aim and fire        3  bank a shot
 *   4  a shield that only a bank gets past    5  the POWER panel
 *   6  a real fight, with telegraphs to read
 *
 * The prompt is one short line and a glyph. Everything else is taught by the
 * room: a marker to walk to, targets that stand still, a Warden whose shield
 * makes a straight shot impossible, and the aim line already drawing the
 * bounce for you.
 */

export const TUTORIAL_LEVEL = {
  id: 'tut', name: 'TRAINING', theme: 'dusk', width: 24, seed: 4242, rise: 0,
  tutorial: true,
  intro: '',
  chambers: [{ type: 'training', depth: 98, enemies: {}, mods: ['power'] }],
};

const STEPS = [
  {
    id: 'move',
    glyph: 'move',
    text: (touch) => (touch ? 'Drag on the left to move' : 'Move with W A S D'),
    enter(t) { t.marker.show(0, 25); },
    check(t, g) {
      const d = Math.hypot(g.player.x - 0, g.player.z - 25);
      return d < 4.5;
    },
    exit(t) { t.marker.hide(); },
  },
  {
    id: 'fire',
    glyph: 'fire',
    text: (touch) => (touch ? 'Drag on the right to aim and fire' : 'Aim with the mouse, hold to fire'),
    enter(t) {
      t.spawnTargets([[-5, 38], [5, 38]], 'skitter');
    },
    total: 2,
    progress(t) { return t.total - t.remaining(); },
    check(t) { return t.remaining() === 0; },
  },
  {
    id: 'bounce',
    glyph: 'bounce',
    text: () => 'Bank a shot off a wall — it hits harder and you get the round back',
    enter(t) {
      t.bankKills = 0;
      t.spawnTargets([[-6.4, 56], [6.4, 56]], 'skitter');
    },
    total: 2,
    progress(t) { return t.bankKills; },
    check(t) { return t.bankKills >= 2; },
  },
  {
    id: 'shield',
    glyph: 'shield',
    text: () => 'Its shield stops straight shots. Fire up the side, off the angled wall',
    enter(t) {
      t.spawnTargets([[0, 67]], 'warden');
      t.marker.show(-5, 57);
    },
    hint: () => 'Stand on the marker and shoot straight ahead',
    // If the lesson has gone on too long the Warden stops tracking, so walking
    // round to its flank becomes an answer too. A player who cannot find the
    // bank should still get out of this room.
    onHint(t, g) {
      for (const e of g.enemies.pool.active) if (e.type === 'warden') e.noTrack = true;
    },
    check(t) { return t.remaining() === 0; },
    exit(t) { t.marker.hide(); },
  },
  {
    id: 'power',
    glyph: 'power',
    text: () => 'Hit the POWER panel — it adds a charge, up to three',
    enter(t, g) {
      t.panelHits = g.bullets.stats.modHits;
      const panel = g.arena.modWalls[0];
      if (panel) t.marker.show(panel.x, panel.z - 8);
    },
    check(t, g) { return g.bullets.stats.modHits > t.panelHits; },
    exit(t) { t.marker.hide(); },
  },
  {
    id: 'fight',
    glyph: 'threat',
    text: () => 'Marks on the floor mean that spot is about to hurt',
    enter(t) {
      t.spawnLive([[-6, 83, 'skitter'], [6, 83, 'skitter'], [0, 90, 'skitter'], [0, 95, 'lancer']]);
    },
    check(t) { return t.remaining() === 0; },
  },
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.index = -1;
    this.step = null;
    this.active = false;
    this.bankKills = 0;
    this.panelHits = 0;
    this.total = 0;
    this.marker = new Marker(game.scene);
    this.holdT = 0;
    this._respawn = [];
  }

  start() {
    this.active = true;
    this.index = -1;
    this.bankKills = 0;
    this.holdT = 0;
    this.satisfied = false;
    this._respawn.length = 0;
    this._advance();
  }

  stop() {
    this.active = false;
    this.step = null;
    this.marker.hide();
    this._respawn.length = 0;
    this.game.hud.setObjective(null);
  }

  /**
   * Only what this lesson put in the room counts.
   *
   * The global alive count was wrong here: a target respawned by the bank rule
   * could outlive the step that spawned it and then hold the next step open
   * forever, with nothing on screen to tell the player what they were waiting
   * for.
   */
  remaining() {
    let n = 0;
    for (const e of this.game.enemies.pool.active) {
      if (e.tut === this.index && e.hp > 0 && e.dying <= 0) n++;
    }
    return n;
  }

  spawnTargets(spots, type) {
    const g = this.game;
    this.total = spots.length;
    for (const [x, z] of spots) {
      const e = g.enemies.spawn(type, x, z, g.arena.floorAt(z));
      if (e) { e.frozen = true; e.activated = true; e.tut = this.index; }
    }
  }

  spawnLive(spots) {
    const g = this.game;
    this.total = spots.length;
    for (const [x, z, type] of spots) {
      const e = g.enemies.spawn(type, x, z, g.arena.floorAt(z));
      if (e) { e.activated = true; e.homeX = x; e.homeZ = z; e.tut = this.index; }
    }
  }

  /**
   * The bank lesson enforces itself.
   *
   * A target killed with a straight shot comes back. No geometry can reliably
   * make a direct line impossible from everywhere in a room the player is free
   * to walk around, so the rule is stated by the room instead of implied by it:
   * only a round that has touched a wall counts.
   */
  onKill(e, opts) {
    if (this.step?.id !== 'bounce') return;
    if (opts && opts.bounced) { this.bankKills++; return; }
    this._respawn.push({ x: e.homeX, z: e.homeZ, t: 0.45, step: this.index });
    this.game.hud.toast('BANK IT', '#d98b3f');
  }

  _advance() {
    const prev = this.step;
    if (prev?.exit) prev.exit(this, this.game);
    this._respawn.length = 0;
    this.index++;
    if (this.index >= STEPS.length) {
      this.step = null;
      this.active = false;
      this.marker.hide();
      this.game.onTutorialComplete();
      return;
    }
    this.step = STEPS[this.index];
    this.total = this.step.total || 1;
    this.holdT = 0;
    this.stuckT = 0;
    this.hinted = false;
    this.satisfied = false;
    this.step.enter?.(this, this.game);
    this._showPrompt();
    this.game.audio.ui('confirm');
  }

  _showPrompt() {
    const s = this.step;
    if (!s) return;
    this.game.hud.setObjective({
      glyph: s.glyph,
      text: s.text(this.game.isTouch),
      index: this.index + 1,
      count: STEPS.length,
    });
  }

  update(dt) {
    if (!this.active || !this.step) return;
    const s = this.step;
    this.marker.update(dt);

    for (let i = this._respawn.length - 1; i >= 0; i--) {
      const r = this._respawn[i];
      r.t -= dt;
      if (r.t > 0) continue;
      this._respawn.splice(i, 1);
      const e = this.game.enemies.spawn('skitter', r.x, r.z, this.game.arena.floorAt(r.z));
      if (e) { e.frozen = true; e.activated = true; e.tut = r.step; }
    }

    if (s.progress) {
      this.game.hud.setObjectiveProgress(s.progress(this, this.game), s.total);
    } else {
      this.game.hud.setObjectiveProgress(0, 0);
    }

    // A lesson that has gone quiet for a while says the quiet part out loud.
    // Nothing here is meant to be a puzzle, and a player stuck on step four is
    // a player who closes the game.
    if (!this.satisfied && s.hint) {
      this.stuckT += dt;
      if (this.stuckT > 18 && !this.hinted) {
        this.hinted = true;
        this.game.hud.toast(s.hint(), '#e0a54a');
        s.onHint?.(this, this.game);
      }
    }

    // Once a beat has been satisfied it stays satisfied. Walking through the
    // marker counts; the player should not have to stand still on it.
    if (!this.satisfied && s.check(this, this.game)) {
      this.satisfied = true;
      this.game.hud.objectiveDone();
      this.game.audio.waveClear();
    }
    if (this.satisfied) {
      // A short beat before the next prompt, so a completion is felt.
      this.holdT += dt;
      if (this.holdT > 0.8) this._advance();
    }
  }
}

/** A painted ring on the floor with a bobbing chevron: "stand here". */
class Marker {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.0, 2.4, 36).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe0a54a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.y = 0.07;
    this.group.add(ring);
    this.ring = ring;

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 1.4, 4),
      new THREE.MeshBasicMaterial({ color: 0xe0a54a })
    );
    arrow.rotation.x = Math.PI;
    arrow.position.y = 4;
    this.group.add(arrow);
    this.arrow = arrow;

    scene.add(this.group);
    this.t = 0;
  }

  show(x, z) {
    this.group.position.set(x, 0, z);
    this.group.visible = true;
  }

  hide() { this.group.visible = false; }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    this.arrow.position.y = 3.6 + Math.sin(this.t * 3) * 0.5;
    const p = 0.55 + Math.sin(this.t * 3) * 0.25;
    this.ring.material.opacity = p;
    this.ring.scale.setScalar(1 + Math.sin(this.t * 3) * 0.04);
  }
}
