import * as THREE from 'three';

/** Normalise any geometry so its bounding box is exactly a unit cube centred on
 *  the origin. Instance scale then maps 1:1 to world width/height/depth. */
function normalize(geo) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
  geo.translate(-(bb.min.x + sx / 2), -(bb.min.y + sy / 2), -(bb.min.z + sz / 2));
  geo.scale(1 / sx, 1 / sy, 1 / sz);
  return geo;
}

const cache = new Map();

/** Wall silhouettes per theme. Each level gets a different one so themes never
 *  read as recolours of the same box. */
export function wallGeometry(shape) {
  if (cache.has(shape)) return cache.get(shape);
  let geo;
  switch (shape) {
    case 'block': {          // chunky, bottom-heavy volcanic masonry
      geo = new THREE.CylinderGeometry(0.72, 1, 1, 4, 1);
      geo.rotateY(Math.PI / 4);
      break;
    }
    case 'crystal': {        // faceted hexagonal prism, tapered
      geo = new THREE.CylinderGeometry(0.62, 0.95, 1, 6, 1);
      geo.rotateY(Math.PI / 6);
      break;
    }
    case 'shard': {          // aggressive void spikes
      geo = new THREE.CylinderGeometry(0.34, 1, 1, 4, 1);
      geo.rotateY(Math.PI / 4);
      break;
    }
    case 'organic': {        // soft hive growth
      geo = new THREE.IcosahedronGeometry(0.7, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const n = 1 + Math.sin(x * 7.3) * 0.06 + Math.cos(z * 6.1) * 0.06 + Math.sin(y * 5.2) * 0.04;
        pos.setXYZ(i, x * n, y * n, z * n);
      }
      geo.computeVertexNormals();
      break;
    }
    case 'pillar': {         // carved temple stone
      geo = new THREE.CylinderGeometry(0.9, 1, 1, 8, 1);
      geo.rotateY(Math.PI / 8);
      break;
    }
    case 'slab':
    default:
      geo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
      break;
  }
  normalize(geo);
  cache.set(shape, geo);
  return geo;
}

/** Trim geometry that sits on the wall crown as an emissive strip. */
export function trimGeometry() {
  if (cache.has('__trim')) return cache.get('__trim');
  const g = normalize(new THREE.BoxGeometry(1, 1, 1));
  cache.set('__trim', g);
  return g;
}

export function enemyGeometry(shape, size) {
  const key = `e:${shape}:${size}`;
  if (cache.has(key)) return cache.get(key);
  let geo;
  switch (shape) {
    case 'tetra':  geo = new THREE.TetrahedronGeometry(size, 0); break;
    case 'dodeca': geo = new THREE.DodecahedronGeometry(size * 0.86, 0); break;
    case 'cone':   geo = new THREE.ConeGeometry(size * 0.8, size * 1.8, 6); break;
    case 'icosa':  geo = new THREE.IcosahedronGeometry(size * 0.85, 0); break;
    case 'octa':
    default:       geo = new THREE.OctahedronGeometry(size, 0); break;
  }
  cache.set(key, geo);
  return geo;
}

/** Soft radial sprite used for every additive glow in the game. */
export function glowTexture(renderer) {
  if (cache.has('__glow')) return cache.get('__glow');
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  cache.set('__glow', tex);
  return tex;
}

/** Sharper spark sprite for impact debris. */
export function sparkTexture() {
  if (cache.has('__spark')) return cache.get('__spark');
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set('__spark', tex);
  return tex;
}

/** Procedural floor texture: grid lines plus subtle noise, tinted per theme. */
export function floorTexture(theme) {
  const key = `floor:${theme.id}`;
  if (cache.has(key)) return cache.get(key);
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const base = '#' + theme.floor.toString(16).padStart(6, '0');
  const line = '#' + theme.floorLine.toString(16).padStart(6, '0');
  g.fillStyle = base; g.fillRect(0, 0, s, s);

  // speckle
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const a = Math.random() * 0.05;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.fillRect(x, y, 2, 2);
  }
  // major grid
  g.strokeStyle = line; g.globalAlpha = 0.55; g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * s;
    g.moveTo(p, 0); g.lineTo(p, s);
    g.moveTo(0, p); g.lineTo(s, p);
  }
  g.stroke();
  // minor grid
  g.globalAlpha = 0.22; g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i <= 16; i++) {
    const p = (i / 16) * s;
    g.moveTo(p, 0); g.lineTo(p, s);
    g.moveTo(0, p); g.lineTo(s, p);
  }
  g.stroke();
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Label plate for a modifier wall, drawn once per modifier id. */
export function modifierTexture(mod) {
  const key = `mod:${mod.id}`;
  if (cache.has(key)) return cache.get(key);
  const w = 512, h = 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const col = '#' + mod.color.toString(16).padStart(6, '0');

  g.clearRect(0, 0, w, h);
  // plate
  const r = 26;
  g.fillStyle = 'rgba(4,6,14,0.82)';
  roundRect(g, 12, 12, w - 24, h - 24, r); g.fill();
  g.strokeStyle = col; g.lineWidth = 7; g.globalAlpha = 0.95;
  roundRect(g, 12, 12, w - 24, h - 24, r); g.stroke();
  g.globalAlpha = 1;

  // corner ticks
  g.strokeStyle = col; g.lineWidth = 5;
  const tk = 40;
  g.beginPath();
  g.moveTo(30, 30 + tk); g.lineTo(30, 30); g.lineTo(30 + tk, 30);
  g.moveTo(w - 30 - tk, 30); g.lineTo(w - 30, 30); g.lineTo(w - 30, 30 + tk);
  g.moveTo(30, h - 30 - tk); g.lineTo(30, h - 30); g.lineTo(30 + tk, h - 30);
  g.moveTo(w - 30 - tk, h - 30); g.lineTo(w - 30, h - 30); g.lineTo(w - 30, h - 30 - tk);
  g.stroke();

  g.textAlign = 'center';
  g.shadowColor = col;
  g.shadowBlur = 34;
  g.fillStyle = '#ffffff';
  g.font = '900 108px Orbitron, Arial Black, sans-serif';
  g.fillText(mod.label, w / 2, h / 2 + 18);
  g.shadowBlur = 12;
  g.fillStyle = col;
  g.font = '700 40px Rajdhani, Arial, sans-serif';
  g.fillText(mod.sub, w / 2, h - 46);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function disposeGeometryCache() {
  // Geometry is shared across levels on purpose; only the per-theme floor
  // textures are rebuilt, and those are cheap. Kept for completeness.
}
