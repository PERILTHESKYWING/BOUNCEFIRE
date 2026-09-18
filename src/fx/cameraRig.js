import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { damp, clamp } from '../core/utils.js';

/**
 * Portrait-friendly chase camera. It sits high and behind, tilted down, so the
 * maze ahead is readable while the player stays in the lower third of a phone
 * screen. Shake is additive and decays exponentially.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.shakeSeed = Math.random() * 100;
    this.fovKick = 0;
    this.baseFov = CONFIG.render.fov;
    this.zoom = 0;         // extra pull-back, used for boss reveals
    this.t = 0;
    this._target = new THREE.Vector3();
  }

  snapTo(target) {
    const c = CONFIG.camera;
    this.pos.set(target.x + c.offset.x, target.y + c.offset.y, target.z + c.offset.z);
    this.look.set(target.x, target.y + c.lookHeight, target.z + c.lookAhead);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  addShake(amount) {
    this.shake = Math.min(CONFIG.camera.maxShake, this.shake + amount);
  }

  kickFov(amount) {
    this.fovKick = Math.min(9, this.fovKick + amount);
  }

  update(dt, target, vx = 0) {
    const c = CONFIG.camera;
    this.t += dt;

    const lead = clamp(vx * c.lateralLead, -6, 6);
    this._target.set(
      target.x * 0.82 + lead,
      target.y + c.offset.y + this.zoom * 0.55,
      target.z + c.offset.z - this.zoom
    );
    this.pos.x = damp(this.pos.x, this._target.x, c.follow, dt);
    this.pos.y = damp(this.pos.y, this._target.y, c.follow * 0.8, dt);
    this.pos.z = damp(this.pos.z, this._target.z, c.follow, dt);

    this.look.x = damp(this.look.x, target.x * 0.78, c.follow * 0.9, dt);
    this.look.y = damp(this.look.y, target.y + c.lookHeight, c.follow, dt);
    this.look.z = damp(this.look.z, target.z + c.lookAhead + this.zoom * 0.4, c.follow, dt);

    this.shake = Math.max(0, this.shake - this.shake * c.shakeDecay * dt - dt * 0.15);
    this.fovKick = Math.max(0, this.fovKick - this.fovKick * 7 * dt);

    const s = this.shake;
    let ox = 0, oy = 0;
    if (s > 0.001) {
      const t = this.t * 46 + this.shakeSeed;
      ox = (Math.sin(t * 1.7) + Math.sin(t * 2.9) * 0.6) * s * 0.55;
      oy = (Math.cos(t * 2.1) + Math.sin(t * 3.7) * 0.5) * s * 0.55;
    }

    this.camera.position.set(this.pos.x + ox, this.pos.y + oy, this.pos.z);
    this.camera.lookAt(this.look.x + ox * 0.3, this.look.y + oy * 0.3, this.look.z);
    this.camera.rotation.z += ox * 0.012;

    const fov = this.baseFov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
