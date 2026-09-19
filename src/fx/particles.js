import * as THREE from '../../vendor/three/three.module.js';
import { glowTexture } from '../world/geometry.js';

/**
 * One instanced, GPU-animated particle system for the whole game. The CPU only
 * writes attributes when a particle is spawned; motion, fade and billboarding
 * happen in the vertex shader.
 *
 * Particles are alpha-blended rather than additive. Additive blending was what
 * turned every impact in the old build into a bloom of light — here a particle
 * is a chip of debris or a puff of dust, so it can be dark, and combat stops
 * washing the arena out.
 */
export class Particles {
  constructor(scene, renderer, capacity) {
    this.capacity = capacity;
    this.limit = capacity;
    this.cursor = 0;
    this.time = 0;
    this.dirtyLo = Infinity;
    this.dirtyHi = -Infinity;
    this.fullDirty = false;

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = capacity;

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    for (const a of [this.aPos, this.aVel, this.aColor, this.aParams, this.aMisc]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    // park everything off-screen with an expired lifetime
    for (let i = 0; i < capacity; i++) this.aParams.array[i * 4 + 1] = -1;

    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aParams', this.aParams);
    geo.setAttribute('aMisc', this.aMisc);

    this.uniforms = {
      uTime: { value: 0 },
      uMap: { value: glowTexture(renderer) },
      uIntensity: { value: 1.0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute vec3 aPos;
        attribute vec3 aVel;
        attribute vec3 aColor;
        attribute vec4 aParams;  // birth, life, size, stretch
        attribute vec2 aMisc;    // gravity, drag
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        varying vec2 vUv;

        void main() {
          float age = uTime - aParams.x;
          float life = aParams.y;
          if (age < 0.0 || age > life) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vAlpha = 0.0;
            return;
          }
          float t = age / life;
          float k = aMisc.y;
          // analytic drag integral keeps motion smooth without CPU work
          float f = (1.0 - exp(-k * age)) / max(k, 0.0001);
          vec3 wp = aPos + aVel * f + vec3(0.0, -aMisc.x * age * age * 0.5, 0.0);

          float fade = 1.0 - t;
          float grow = smoothstep(0.0, 0.14, t);
          float size = aParams.z * mix(0.35, 1.0, grow) * (0.25 + 0.75 * fade);

          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          vec2 corner = position.xy;
          // stretch along screen-space velocity for streaky sparks
          float sp = length(aVel);
          if (aParams.w > 0.001 && sp > 0.001) {
            vec3 vdir = normalize(aVel);
            vec2 sv = normalize((modelViewMatrix * vec4(vdir, 0.0)).xy + vec2(1e-5));
            vec2 perp = vec2(-sv.y, sv.x);
            float stretch = 1.0 + aParams.w * min(sp * 0.09, 5.0) * fade;
            corner = sv * corner.y * stretch + perp * corner.x;
          }
          mv.xy += corner * size;
          gl_Position = projectionMatrix * mv;

          vColor = aColor;
          vAlpha = fade * fade;
          vUv = uv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        uniform float uIntensity;
        varying vec3 vColor;
        varying float vAlpha;
        varying vec2 vUv;
        void main() {
          float a = texture2D(uMap, vUv).a;
          if (a < 0.01 || vAlpha <= 0.0) discard;
          gl_FragColor = vec4(vColor * uIntensity, a * vAlpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
    this._c = new THREE.Color();
  }

  setIntensity(v) { this.uniforms.uIntensity.value = v; }

  /** Vary how many particles are live without reallocating the buffers. */
  setLimit(n) {
    this.limit = Math.max(64, Math.min(this.capacity, n | 0));
    this.mesh.geometry.instanceCount = this.limit;
    if (this.cursor >= this.limit) this.cursor = 0;
  }

  /** Spawn a single particle. All burst helpers funnel through here. */
  spawn(x, y, z, vx, vy, vz, color, size, life, opts) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.limit;
    if (this.cursor === 0) this.fullDirty = true;

    const p3 = i * 3, p4 = i * 4, p2 = i * 2;
    this.aPos.array[p3] = x; this.aPos.array[p3 + 1] = y; this.aPos.array[p3 + 2] = z;
    this.aVel.array[p3] = vx; this.aVel.array[p3 + 1] = vy; this.aVel.array[p3 + 2] = vz;

    const c = this._c;
    if (typeof color === 'number') c.setHex(color); else c.copy(color);
    this.aColor.array[p3] = c.r; this.aColor.array[p3 + 1] = c.g; this.aColor.array[p3 + 2] = c.b;

    this.aParams.array[p4] = this.time;
    this.aParams.array[p4 + 1] = life;
    this.aParams.array[p4 + 2] = size;
    this.aParams.array[p4 + 3] = opts?.stretch ?? 0;
    this.aMisc.array[p2] = opts?.gravity ?? 0;
    this.aMisc.array[p2 + 1] = opts?.drag ?? 2.2;

    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
  }

  /** Radial burst in the XZ plane with a little vertical lift. */
  burst(x, y, z, count, color, opts = {}) {
    const speed = opts.speed ?? 12;
    const size = opts.size ?? 0.55;
    const life = opts.life ?? 0.5;
    const spread = opts.spread ?? 1;
    const lift = opts.lift ?? 0.5;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.9);
      const up = (Math.random() * 2 - 0.35) * lift * s * 0.5;
      this.spawn(
        x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread * 0.6, z + (Math.random() - 0.5) * spread,
        Math.cos(a) * s, up, Math.sin(a) * s,
        color, size * (0.6 + Math.random() * 0.8), life * (0.7 + Math.random() * 0.6),
        { stretch: opts.stretch ?? 1.2, gravity: opts.gravity ?? 9, drag: opts.drag ?? 2.6 }
      );
    }
  }

  /** Directional cone, used for wall impacts so debris kicks off the surface. */
  cone(x, y, z, nx, nz, count, color, opts = {}) {
    const speed = opts.speed ?? 14;
    const size = opts.size ?? 0.45;
    const life = opts.life ?? 0.38;
    const spread = opts.spread ?? 0.85;
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(nz, nx) + (Math.random() - 0.5) * spread * 2;
      const s = speed * (0.4 + Math.random());
      this.spawn(
        x, y + (Math.random() - 0.5) * 0.5, z,
        Math.cos(a) * s, Math.random() * s * 0.55, Math.sin(a) * s,
        color, size * (0.6 + Math.random() * 0.9), life * (0.6 + Math.random() * 0.8),
        { stretch: opts.stretch ?? 2.4, gravity: opts.gravity ?? 11, drag: 3.0 }
      );
    }
  }

  /** Slow drifting ambience that sells the scale of each theme. */
  mote(x, y, z, color, size, life) {
    this.spawn(x, y, z,
      (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.9, (Math.random() - 0.5) * 0.6,
      color, size, life, { stretch: 0, gravity: -0.4, drag: 0.35 });
  }

  update(dt) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (this.fullDirty) {
      for (const a of [this.aPos, this.aVel, this.aColor, this.aParams, this.aMisc]) {
        a.clearUpdateRanges?.();
        a.needsUpdate = true;
      }
      this.fullDirty = false;
    } else if (this.dirtyHi >= this.dirtyLo) {
      const lo = this.dirtyLo, n = this.dirtyHi - lo + 1;
      for (const a of [this.aPos, this.aVel, this.aColor, this.aParams, this.aMisc]) {
        a.clearUpdateRanges?.();
        a.addUpdateRange ? a.addUpdateRange(lo * a.itemSize, n * a.itemSize) : null;
        a.needsUpdate = true;
      }
    }
    this.dirtyLo = Infinity; this.dirtyHi = -Infinity;
  }

  reset() {
    for (let i = 0; i < this.capacity; i++) this.aParams.array[i * 4 + 1] = -1;
    this.fullDirty = true;
    this.cursor = 0;
  }
}
