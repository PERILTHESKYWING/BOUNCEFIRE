import * as THREE from 'three';

const cache = new Map();

// ---------------------------------------------------------------- primitives

/** One primitive from a data spec. Keeps the enemy/prop tables free of THREE. */
export function primitive(shape, args = []) {
  switch (shape) {
    case 'box':    return new THREE.BoxGeometry(...args);
    case 'cyl':    return new THREE.CylinderGeometry(...args);
    case 'cone':   return new THREE.ConeGeometry(...args);
    case 'sphere': return new THREE.SphereGeometry(...args);
    case 'icosa':  return new THREE.IcosahedronGeometry(...args);
    case 'octa':   return new THREE.OctahedronGeometry(...args);
    case 'tetra':  return new THREE.TetrahedronGeometry(...args);
    case 'torus':  return new THREE.TorusGeometry(...args);
    case 'plane':  return new THREE.PlaneGeometry(...args);
    default:       return new THREE.BoxGeometry(1, 1, 1);
  }
}

/**
 * Merge a list of positioned primitives into one non-indexed geometry.
 *
 * This is what lets an enemy be a crab or a tripod instead of a tinted solid:
 * a model is authored as six or eight little shapes, merged once at boot, and
 * then drawn as a single InstancedMesh. Forty enemies on screen still cost
 * three draw calls per type.
 */
export function mergeParts(parts) {
  if (!parts || !parts.length) return null;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const geos = [];
  let total = 0;

  for (const p of parts) {
    let g = primitive(p.shape, p.args);
    if (g.index) g = g.toNonIndexed();
    e.set(...(p.rot || [0, 0, 0]));
    q.setFromEuler(e);
    v.set(...(p.pos || [0, 0, 0]));
    s.set(...(p.scale || [1, 1, 1]));
    m.compose(v, q, s);
    g.applyMatrix4(m);
    geos.push(g);
    total += g.attributes.position.count;
  }

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}

/** Cached merge, keyed by model id + group name. */
export function modelGeometry(key, parts) {
  if (cache.has(key)) return cache.get(key);
  const g = mergeParts(parts);
  cache.set(key, g);
  return g;
}

// --------------------------------------------------------------------- walls

/** Normalise so the bounding box is a unit cube; instance scale is then 1:1. */
function normalize(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
  geo.translate(-(bb.min.x + sx / 2), -(bb.min.y + sy / 2), -(bb.min.z + sz / 2));
  geo.scale(1 / sx, 1 / sy, 1 / sz);
  return geo;
}

/**
 * Wall silhouettes. Every one is a hard, flat-faced block: walls are the
 * bounce surface, so the player has to be able to predict the normal at a
 * glance. Themes vary the profile, never the readability.
 */
export function wallGeometry(shape) {
  const key = 'w:' + shape;
  if (cache.has(key)) return cache.get(key);
  let geo;
  switch (shape) {
    case 'bevel': {          // chamfered slab, a lip of light along the top
      geo = new THREE.CylinderGeometry(0.86, 1, 1, 4, 1);
      geo.rotateY(Math.PI / 4);
      break;
    }
    case 'stack': {          // stepped masonry
      geo = mergeParts([
        { shape: 'box', args: [1, 0.62, 1], pos: [0, -0.19, 0] },
        { shape: 'box', args: [0.88, 0.42, 0.88], pos: [0, 0.29, 0] },
      ]);
      break;
    }
    case 'rib': {            // ribbed panel, reads as manufactured
      geo = mergeParts([
        { shape: 'box', args: [1, 1, 0.86], pos: [0, 0, 0] },
        { shape: 'box', args: [1.02, 0.5, 1], pos: [0, 0.1, 0] },
      ]);
      break;
    }
    case 'slab':
    default:
      geo = new THREE.BoxGeometry(1, 1, 1);
      break;
  }
  normalize(geo);
  cache.set(key, geo);
  return geo;
}

/** Flat box reused for wall caps, floor lips and edge strips. */
export function trimGeometry() {
  if (cache.has('__trim')) return cache.get('__trim');
  const g = normalize(new THREE.BoxGeometry(1, 1, 1));
  cache.set('__trim', g);
  return g;
}

// ------------------------------------------------------------------ textures

/** Soft radial sprite: contact shadows, muzzle puffs, ground markers. */
export function glowTexture(renderer) {
  if (cache.has('__glow')) return cache.get('__glow');
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  cache.set('__glow', tex);
  return tex;
}

/** Hard-edged blob for the contact shadow under every character. */
export function shadowTexture() {
  if (cache.has('__shadow')) return cache.get('__shadow');
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.0, 'rgba(0,0,0,0.62)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.34)');
  grd.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  cache.set('__shadow', tex);
  return tex;
}

export function sparkTexture() {
  if (cache.has('__spark')) return cache.get('__spark');
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('__spark', tex);
  return tex;
}

/**
 * Floor: large painted tiles with a hand-drawn edge, no glowing grid. Kept
 * low-contrast on purpose — the floor is the quietest thing on screen so that
 * characters, bullets and telegraphs sit on top of it cleanly.
 */
export function floorTexture(theme) {
  const key = `floor:${theme.id}`;
  if (cache.has(key)) return cache.get(key);
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const base = hex(theme.floor);
  const alt = hex(theme.floorAlt);
  const line = hex(theme.floorLine);

  g.fillStyle = base;
  g.fillRect(0, 0, s, s);

  // alternating tiles, a very slight checker so motion reads without stripes
  const n = 4, cell = s / n;
  g.fillStyle = alt;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if ((x + y) % 2) continue;
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // paper grain
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.045})`;
    g.fillRect(x, y, 2, 2);
  }

  // tile seams, drawn slightly wobbly so nothing looks machine-ruled
  g.strokeStyle = line;
  g.globalAlpha = 0.3;
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    const p = i * cell;
    g.beginPath();
    for (let t = 0; t <= s; t += 32) g.lineTo(p + Math.sin(t * 0.06 + i) * 1.4, t);
    g.stroke();
    g.beginPath();
    for (let t = 0; t <= s; t += 32) g.lineTo(t, p + Math.cos(t * 0.05 + i) * 1.4);
    g.stroke();
  }
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/**
 * Modifier panel. A painted plate with a drawn glyph and one short word — no
 * holographic frame, no second line of small print. Four modifiers exist in
 * the whole game, so each one gets a mark the player learns once.
 */
export function modifierTexture(mod) {
  const key = `mod:${mod.id}`;
  if (cache.has(key)) return cache.get(key);
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const col = hex(mod.color);

  g.clearRect(0, 0, w, h);
  g.fillStyle = col;
  roundRect(g, 8, 8, w - 16, h - 16, 18);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.2)';
  roundRect(g, 8, h - 46, w - 16, 38, 18);
  g.fill();

  g.save();
  g.translate(w * 0.27, h * 0.44);
  drawGlyph(g, mod.glyph, 62, 'rgba(20,16,12,0.92)');
  g.restore();

  g.textAlign = 'left';
  g.fillStyle = 'rgba(20,16,12,0.92)';
  g.font = '800 82px Barlow Condensed, Arial Narrow, Arial, sans-serif';
  g.fillText(mod.label, w * 0.44, h * 0.56);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** The four modifier marks, drawn rather than typed so they read at any size. */
export function drawGlyph(g, glyph, r, color) {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = r * 0.17;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  if (glyph === 'chevrons') {
    for (let i = -1; i <= 1; i++) {
      g.moveTo(-r * 0.5, i * r * 0.46 + r * 0.26);
      g.lineTo(0, i * r * 0.46 - r * 0.16);
      g.lineTo(r * 0.5, i * r * 0.46 + r * 0.26);
    }
    g.stroke();
  } else if (glyph === 'fork') {
    g.moveTo(0, r * 0.7); g.lineTo(0, 0);
    g.moveTo(0, 0); g.lineTo(-r * 0.62, -r * 0.7);
    g.moveTo(0, 0); g.lineTo(r * 0.62, -r * 0.7);
    g.stroke();
  } else if (glyph === 'arrow') {
    g.moveTo(-r * 0.75, 0); g.lineTo(r * 0.55, 0);
    g.moveTo(r * 0.12, -r * 0.42); g.lineTo(r * 0.62, 0); g.lineTo(r * 0.12, r * 0.42);
    g.stroke();
    g.beginPath();
    g.arc(-r * 0.55, 0, r * 0.16, 0, Math.PI * 2);
    g.fill();
  } else if (glyph === 'burst') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
      g.lineTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
    }
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.2, 0, Math.PI * 2);
    g.fill();
  }
}

export function hex(n) { return '#' + (n >>> 0).toString(16).padStart(6, '0'); }

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
