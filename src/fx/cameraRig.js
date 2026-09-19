import * as THREE from '../../vendor/three/three.module.js';
import { CONFIG } from '../core/config.js';
import { damp, clamp } from '../core/utils.js';

/**
 * The camera.
 *
 * Two rules, and between them they fix what the old rig got wrong:
 *
 *  1. IT IS CENTRED ON THE PLAYER, at a fixed offset. The previous rig
 *     followed a fraction of the player's absolute X, which meant the arena
 *     slid sideways underneath them — the "the platform is tilting to move me"
 *     feeling. Here the camera holds a constant relationship to the character,
 *     so moving right moves *you* right.
 *
 *  2. IT NEVER ROLLS. No roll on shake, no roll on movement. "Up" is one
 *     direction for the whole game, which is what lets WASD be conventional.
 *
 * Shake is small, decays fast, and is reserved for things that actually hit
 * the ground. Anything else is a flash or a ring.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.shakeSeed = Math.random() * 100;
    this.baseFov = CONFIG.render.fov;
    this.zoom = 0;             // extra pull-back for reveals
    // Set from the window shape. A landscape window is wide enough already, so
    // the rig comes in closer there rather than showing half an empty arena
    // and a character the size of a thumbnail.
    this.distScale = 1;
    this.t = 0;
    this._target = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
  }

  snapTo(target, aim = 0) {
    const c = CONFIG.camera;
    const k = this.distScale;
    this.pos.set(target.x + c.offset.x, target.y + c.offset.y * k, target.z + c.offset.z * k);
    this.look.set(target.x, target.y + c.lookHeight, target.z + c.lookAhead);
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
  }

  addShake(amount) {
    this.shake = Math.min(CONFIG.camera.maxShake, this.shake + amount);
  }

  kickFov() { /* retired: fov punches made the arena breathe and hurt aiming */ }

  update(dt, target, aim = 0) {
    const c = CONFIG.camera;
    this.t += dt;

    // A small push toward where the player is aiming. It shows a little more
    // of what they are about to shoot at without ever decentring them.
    const lx = Math.sin(aim) * c.aimLead;
    const lz = Math.cos(aim) * c.aimLead;

    const k = this.distScale;
    this._target.set(
      target.x + c.offset.x + lx * 0.5,
      target.y + c.offset.y * k + this.zoom * 0.5,
      target.z + c.offset.z * k + lz * 0.5 - this.zoom
    );
    this.pos.x = damp(this.pos.x, this._target.x, c.follow, dt);
    this.pos.y = damp(this.pos.y, this._target.y, c.follow * 0.85, dt);
    this.pos.z = damp(this.pos.z, this._target.z, c.follow, dt);

    this._lookTarget.set(
      target.x + lx,
      target.y + c.lookHeight,
      target.z + c.lookAhead + lz
    );
    this.look.x = damp(this.look.x, this._lookTarget.x, c.follow, dt);
    this.look.y = damp(this.look.y, this._lookTarget.y, c.follow, dt);
    this.look.z = damp(this.look.z, this._lookTarget.z, c.follow, dt);

    this.shake = Math.max(0, this.shake - this.shake * c.shakeDecay * dt - dt * 0.12);

    let ox = 0, oy = 0;
    if (this.shake > 0.001) {
      const t = this.t * 42 + this.shakeSeed;
      ox = (Math.sin(t * 1.7) + Math.sin(t * 2.9) * 0.6) * this.shake * 0.5;
      oy = (Math.cos(t * 2.1) + Math.sin(t * 3.7) * 0.5) * this.shake * 0.5;
    }

    this.camera.position.set(this.pos.x + ox, this.pos.y + oy, this.pos.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look.x, this.look.y, this.look.z);

    if (Math.abs(this.camera.fov - this.baseFov) > 0.01) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
