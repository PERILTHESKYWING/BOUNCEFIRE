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
      t.spawnTargets([[-6.6, 54], [6.6, 54]], 'skitter');
    },
    total: 2,
    progress(t) { return t.bankKills; },
    check(t) { return t.bankKills >= 2; },
  },
  {
    id: 'shield',
    glyph: 'shield',
    text: () => 'That shield stops straight shots. Come at it off a wall',
    enter(t) { t.spawnTargets([[0, 66]], 'warden'); },
    check(t) { return t.remaining() === 0; },
  },
  {
    id: 'power',
    glyph: 'power',
    text: () => 'Hit the POWER panel — it adds a charge, up to three',
    enter(t, g) {
      t.panelHits = g.bullets.stats.modHits;
      const panel = g.arena.modWalls[0];
      if (panel) t.marker.show(panel.x, panel.z - 7);
    },
    check(t, g) { return g.bullets.stats.modHits > t.panelHits; },
    exit(t) { t.marker.hide(); },
  },
  {
    id: 'fight',
    glyph: 'threat',
    text: () => 'Marks on the floor mean that spot is about to hurt',
    enter(t) {
      t.spawnLive([[-6, 82, 'skitter'], [6, 82, 'skitter'], [0, 88, 'skitter'], [0, 93, 'lancer']]);
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

  remaining() { return this.game.enemies.aliveCount; }

  spawnTargets(spots, type) {
    const g = this.game;
    this.total = spots.length;
    for (const [x, z] of spots) {
      const e = g.enemies.spawn(type, x, z, g.arena.floorAt(z));
      if (e) { e.frozen = true; e.activated = true; }
    }
  }

  spawnLive(spots) {
    const g = this.game;
    this.total = spots.length;
    for (const [x, z, type] of spots) {
      const e = g.enemies.spawn(type, x, z, g.arena.floorAt(z));
      if (e) { e.activated = true; e.homeX = x; e.homeZ = z; }
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
    this._respawn.push({ x: e.homeX, z: e.homeZ, t: 0.45 });
    this.game.hud.toast('BANK IT', '#d98b3f');
  }

  _advance() {
    const prev = this.step;
    if (prev?.exit) prev.exit(this, this.game);
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
      if (e) { e.frozen = true; e.activated = true; }
    }

    if (s.progress) {
      this.game.hud.setObjectiveProgress(s.progress(this, this.game), s.total);
    } else {
      this.game.hud.setObjectiveProgress(0, 0);
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
      new THREE.MeshBasicMaterial({ color: 0x8ff0e0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.y = 0.07;
    this.group.add(ring);
    this.ring = ring;

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 1.4, 4),
      new THREE.MeshBasicMaterial({ color: 0x8ff0e0 })
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
