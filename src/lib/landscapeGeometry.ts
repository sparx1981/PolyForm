import * as THREE from 'three';
// @ts-ignore
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';

/**
 * Normalizes a BufferGeometry so it is non-indexed and possesses standard attributes:
 * position, normal, uv, color. Strips conflicting custom attributes.
 * This guarantees BufferGeometryUtils.mergeGeometries never fails or returns null.
 */
export function normalizeGeometryAttributes(geom: THREE.BufferGeometry, defaultColorHex: string = '#2d6a4f'): THREE.BufferGeometry {
  const g = geom.index ? geom.toNonIndexed() : geom.clone();
  if (!g.attributes.normal) {
    g.computeVertexNormals();
  }
  const count = g.attributes.position.count;
  if (!g.attributes.uv) {
    const pos = g.attributes.position;
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      uvs[i * 2] = 0.5 + Math.atan2(z, x) / (2 * Math.PI);
      uvs[i * 2 + 1] = y;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  if (!g.attributes.color) {
    const col = new Float32Array(count * 3);
    const c = new THREE.Color(defaultColorHex);
    for (let i = 0; i < count; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  // Strip non-standard attributes so all geometries share exactly the same signature
  for (const name in g.attributes) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') {
      g.deleteAttribute(name);
    }
  }
  return g;
}

/**
 * Safely merges an array of BufferGeometries with uniform attributes.
 * Always returns a valid BufferGeometry with position, normal, uv, and color.
 */
export function safeMergeGeometries(geometries: THREE.BufferGeometry[], defaultColorHex: string = '#2d6a4f'): THREE.BufferGeometry {
  if (!geometries || geometries.length === 0) {
    const fallback = new THREE.CylinderGeometry(0.3, 0.4, 0.8, 8);
    applyGeometryVertexColors(fallback, defaultColorHex, defaultColorHex);
    return fallback;
  }

  const prepared = geometries.map(g => normalizeGeometryAttributes(g, defaultColorHex));
  const merged = mergeGeometries(prepared);
  prepared.forEach(p => p.dispose());

  if (merged) {
    return merged;
  }

  // Fallback with colors so it never appears as a black box
  const fallback = new THREE.CylinderGeometry(0.3, 0.4, 0.8, 8);
  applyGeometryVertexColors(fallback, defaultColorHex, defaultColorHex);
  return fallback;
}

function applyGeometryVertexColors(
  geom: THREE.BufferGeometry,
  baseColorHex: string,
  topColorHex?: string,
  jitter: number = 0.04
) {
  const count = geom.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const cBase = new THREE.Color(baseColorHex);
  const cTop = topColorHex ? new THREE.Color(topColorHex) : cBase;

  let minY = Infinity;
  let maxY = -Infinity;
  const pos = geom.attributes.position;
  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rangeY = Math.max(0.001, maxY - minY);

  for (let i = 0; i < count; i++) {
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, (y - minY) / rangeY));
    const r = cBase.r + (cTop.r - cBase.r) * t;
    const g = cBase.g + (cTop.g - cBase.g) * t;
    const b = cBase.b + (cTop.b - cBase.b) * t;
    const j = (Math.random() - 0.5) * jitter;
    colors[i * 3] = Math.max(0, Math.min(1, r + j));
    colors[i * 3 + 1] = Math.max(0, Math.min(1, g + j));
    colors[i * 3 + 2] = Math.max(0, Math.min(1, b + j));
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function createOrganicFoliageLobe(
  radius: [number, number, number],
  center: [number, number, number],
  baseColor: string,
  tipColor: string,
  turbulence: number = 0.16,
  seed: number = 0
): THREE.BufferGeometry {
  const geom = new THREE.IcosahedronGeometry(1.0, 2);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n1 = Math.sin(v.x * 4.2 + seed) * Math.cos(v.y * 3.8 + seed * 1.5) * Math.sin(v.z * 4.1 + seed * 0.7);
    const n2 = Math.sin(v.x * 7.5 + v.y * 6.2) * 0.35;
    const factor = 1.0 + (n1 + n2) * turbulence;

    v.x = (v.x * radius[0]) * factor + center[0];
    v.y = (v.y * radius[1]) * factor + center[1];
    v.z = (v.z * radius[2]) * factor + center[2];
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geom.computeVertexNormals();

  // Generate spherical UVs
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    uvs[i * 2] = 0.5 + Math.atan2(v.z - center[2], v.x - center[0]) / (2 * Math.PI);
    uvs[i * 2 + 1] = (v.y - center[1]) / (radius[1] * 2) + 0.5;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  applyGeometryVertexColors(geom, baseColor, tipColor, 0.05);
  return geom;
}

function createStemSegment(
  rTop: number,
  rBottom: number,
  height: number,
  pos: [number, number, number],
  rot: [number, number, number],
  barkHex: string = '#3d2817'
): THREE.BufferGeometry {
  const cyl = new THREE.CylinderGeometry(rTop, rBottom, height, 6);
  cyl.rotateX(rot[0]);
  cyl.rotateY(rot[1]);
  cyl.rotateZ(rot[2]);
  cyl.translate(pos[0], pos[1], pos[2]);
  applyGeometryVertexColors(cyl, barkHex, barkHex, 0.03);
  return cyl;
}

export function createTreeGeometry(speciesId: string = 'english_oak'): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  switch (speciesId) {
    case 'mediterranean_cypress': {
      // Columnar pencil cypress: slender tapered vertical trunk with dense ascending flame foliage
      geometries.push(createStemSegment(0.12, 0.22, 1.8, [0, 0.9, 0], [0, 0, 0], '#3a2717'));
      geometries.push(createStemSegment(0.08, 0.12, 3.5, [0, 3.2, 0], [0, 0, 0], '#3a2717'));

      // Inner ascending branchlets
      geometries.push(createStemSegment(0.04, 0.07, 1.8, [0.08, 2.5, 0.06], [0.1, 0, -0.08], '#3a2717'));
      geometries.push(createStemSegment(0.04, 0.07, 1.8, [-0.08, 3.2, -0.05], [-0.08, 0, 0.1], '#3a2717'));

      // Multi-tiered dense flame-like foliage lobes
      const cypressTiers = [
        { r: [0.65, 0.9, 0.65] as [number, number, number], c: [0, 2.0, 0] as [number, number, number] },
        { r: [0.75, 1.1, 0.75] as [number, number, number], c: [0.02, 3.1, -0.02] as [number, number, number] },
        { r: [0.70, 1.2, 0.70] as [number, number, number], c: [-0.02, 4.4, 0.02] as [number, number, number] },
        { r: [0.55, 1.1, 0.55] as [number, number, number], c: [0.01, 5.6, 0.01] as [number, number, number] },
        { r: [0.38, 0.9, 0.38] as [number, number, number], c: [0, 6.7, 0] as [number, number, number] },
        { r: [0.18, 0.6, 0.18] as [number, number, number], c: [0, 7.5, 0] as [number, number, number] },
      ];
      cypressTiers.forEach((t, i) => {
        geometries.push(createOrganicFoliageLobe(t.r, t.c, '#064e3b', '#10b981', 0.15, i * 1.8));
      });
      break;
    }

    case 'scots_pine': {
      // Scots Pine: Gnarled red-orange bark trunk, crooked horizontal architectural limbs, flat layered needle pads
      geometries.push(createStemSegment(0.24, 0.38, 1.2, [0, 0.6, 0], [0, 0, 0], '#7c2d12'));
      geometries.push(createStemSegment(0.20, 0.24, 2.4, [-0.1, 2.2, 0.05], [0.08, 0, -0.08], '#9a3412'));
      geometries.push(createStemSegment(0.16, 0.20, 2.0, [-0.22, 4.1, 0.12], [0.12, 0, -0.12], '#9a3412'));

      // Primary crooked boughs extending outward horizontally
      geometries.push(createStemSegment(0.10, 0.15, 1.9, [0.6, 4.2, 0.3], [0.3, 0.4, 1.1], '#853616'));
      geometries.push(createStemSegment(0.09, 0.13, 2.1, [-0.9, 4.5, -0.4], [-0.3, -0.4, -1.0], '#853616'));
      geometries.push(createStemSegment(0.08, 0.12, 1.7, [-0.1, 5.2, 0.8], [0.9, 0, -0.2], '#853616'));
      geometries.push(createStemSegment(0.07, 0.11, 1.6, [-0.3, 5.6, -0.6], [-0.8, 0, 0.2], '#853616'));

      // Layered flat needle pads/tufts
      const pinePads = [
        { r: [1.3, 0.45, 1.2] as [number, number, number], c: [1.4, 4.4, 0.6] as [number, number, number] },
        { r: [1.4, 0.50, 1.3] as [number, number, number], c: [-1.7, 4.8, -0.7] as [number, number, number] },
        { r: [1.2, 0.45, 1.2] as [number, number, number], c: [-0.2, 5.5, 1.3] as [number, number, number] },
        { r: [1.1, 0.42, 1.1] as [number, number, number], c: [-0.5, 5.9, -1.0] as [number, number, number] },
        { r: [1.3, 0.50, 1.3] as [number, number, number], c: [-0.3, 6.4, 0.2] as [number, number, number] },
        { r: [0.9, 0.40, 0.9] as [number, number, number], c: [0.3, 6.7, -0.2] as [number, number, number] },
      ];
      pinePads.forEach((p, i) => {
        geometries.push(createOrganicFoliageLobe(p.r, p.c, '#0f381e', '#2d6a4f', 0.20, i * 2.3));
      });
      break;
    }

    case 'silver_birch': {
      // Silver Birch: Distinctive white bark trunk with dark charcoal markings, graceful ascending limbs, weeping foliage
      geometries.push(createStemSegment(0.14, 0.22, 1.6, [0, 0.8, 0], [0, 0, 0], '#e2e8f0'));
      geometries.push(createStemSegment(0.10, 0.14, 2.2, [0.08, 2.5, -0.04], [-0.05, 0, 0.06], '#f1f5f9'));
      geometries.push(createStemSegment(0.07, 0.10, 2.0, [0.15, 4.4, -0.08], [-0.06, 0, 0.08], '#f8fafc'));

      // Ascending slender branches
      geometries.push(createStemSegment(0.04, 0.07, 1.8, [-0.5, 3.4, 0.4], [0.3, 0.2, -0.7], '#334155'));
      geometries.push(createStemSegment(0.04, 0.07, 1.9, [0.7, 3.8, -0.3], [-0.2, -0.2, 0.65], '#334155'));
      geometries.push(createStemSegment(0.03, 0.06, 1.6, [-0.4, 4.8, -0.5], [-0.5, -0.2, -0.5], '#334155'));
      geometries.push(createStemSegment(0.03, 0.05, 1.5, [0.5, 5.2, 0.4], [0.4, 0.2, 0.5], '#334155'));

      // Translucent shimmering foliage clouds
      const birchClouds = [
        { r: [0.95, 1.2, 0.90] as [number, number, number], c: [-0.7, 3.8, 0.5] as [number, number, number] },
        { r: [1.05, 1.3, 0.95] as [number, number, number], c: [0.9, 4.3, -0.4] as [number, number, number] },
        { r: [0.90, 1.2, 0.90] as [number, number, number], c: [-0.6, 5.2, -0.6] as [number, number, number] },
        { r: [0.85, 1.1, 0.85] as [number, number, number], c: [0.7, 5.6, 0.5] as [number, number, number] },
        { r: [0.80, 1.2, 0.80] as [number, number, number], c: [0.2, 6.2, 0.0] as [number, number, number] },
        { r: [0.55, 0.9, 0.55] as [number, number, number], c: [0.1, 6.9, 0.0] as [number, number, number] },
      ];
      birchClouds.forEach((b, i) => {
        geometries.push(createOrganicFoliageLobe(b.r, b.c, '#2d6a4f', '#86efac', 0.22, i * 2.1));
      });
      break;
    }

    case 'japanese_maple': {
      // Japanese Maple: Multi-stem low spreading gnarled trunk with layered planar crimson/scarlet canopy
      geometries.push(createStemSegment(0.11, 0.17, 1.3, [-0.15, 0.6, 0.05], [0.15, 0, -0.25], '#2d1f18'));
      geometries.push(createStemSegment(0.09, 0.15, 1.4, [0.18, 0.65, -0.06], [-0.2, 0, 0.3], '#2d1f18'));
      geometries.push(createStemSegment(0.07, 0.11, 1.5, [-0.4, 1.6, 0.2], [0.3, 0, -0.5], '#3b2419'));
      geometries.push(createStemSegment(0.07, 0.11, 1.6, [0.45, 1.7, -0.2], [-0.35, 0, 0.55], '#3b2419'));
      geometries.push(createStemSegment(0.06, 0.09, 1.4, [0.05, 1.9, 0.4], [0.5, 0, 0.1], '#3b2419'));

      // Cantilevered horizontal boughs
      geometries.push(createStemSegment(0.04, 0.07, 1.3, [-1.0, 2.0, 0.4], [0.1, 0.3, -1.2], '#3b2419'));
      geometries.push(createStemSegment(0.04, 0.07, 1.4, [1.1, 2.1, -0.4], [-0.1, -0.3, 1.15], '#3b2419'));

      // Tiered planar foliage clouds in rich Japanese Maple crimson/scarlet
      const maplePads = [
        { r: [1.4, 0.45, 1.2] as [number, number, number], c: [-1.4, 2.2, 0.5] as [number, number, number] },
        { r: [1.5, 0.48, 1.3] as [number, number, number], c: [1.5, 2.3, -0.5] as [number, number, number] },
        { r: [1.2, 0.42, 1.2] as [number, number, number], c: [0.1, 2.5, 1.2] as [number, number, number] },
        { r: [1.3, 0.45, 1.3] as [number, number, number], c: [-0.2, 2.7, -1.1] as [number, number, number] },
        { r: [1.6, 0.55, 1.5] as [number, number, number], c: [0.0, 3.1, 0.0] as [number, number, number] },
        { r: [1.1, 0.40, 1.1] as [number, number, number], c: [0.1, 3.7, 0.1] as [number, number, number] },
      ];
      maplePads.forEach((m, i) => {
        geometries.push(createOrganicFoliageLobe(m.r, m.c, '#7f1d1d', '#dc2626', 0.22, i * 2.7));
      });
      break;
    }

    case 'olive_tree': {
      // Olive Tree: Sculptural hollow/gnarled split trunk with thick angled elbow boughs and silvery-sage billowing foliage
      geometries.push(createStemSegment(0.36, 0.55, 1.2, [0, 0.6, 0], [0, 0, 0], '#3e2c1e'));
      geometries.push(createStemSegment(0.22, 0.32, 1.3, [-0.18, 1.5, 0.1], [0.15, 0, -0.3], '#473323'));
      geometries.push(createStemSegment(0.20, 0.30, 1.4, [0.22, 1.6, -0.1], [-0.2, 0, 0.35], '#473323'));

      // Crooked elbow boughs
      geometries.push(createStemSegment(0.12, 0.18, 1.5, [-0.8, 2.2, 0.3], [0.2, 0.3, -0.9], '#473323'));
      geometries.push(createStemSegment(0.12, 0.18, 1.6, [0.9, 2.3, -0.3], [-0.2, -0.3, 0.85], '#473323'));
      geometries.push(createStemSegment(0.10, 0.15, 1.3, [-0.1, 2.5, 0.8], [0.8, 0, -0.1], '#473323'));

      // Billowing silvery sage-green foliage canopy
      const olivePads = [
        { r: [1.3, 0.70, 1.2] as [number, number, number], c: [-1.2, 2.7, 0.4] as [number, number, number] },
        { r: [1.4, 0.75, 1.3] as [number, number, number], c: [1.3, 2.8, -0.4] as [number, number, number] },
        { r: [1.2, 0.65, 1.2] as [number, number, number], c: [-0.1, 3.0, 1.1] as [number, number, number] },
        { r: [1.2, 0.65, 1.2] as [number, number, number], c: [0.0, 3.1, -1.0] as [number, number, number] },
        { r: [1.5, 0.85, 1.5] as [number, number, number], c: [0.0, 3.5, 0.0] as [number, number, number] },
        { r: [1.0, 0.60, 1.0] as [number, number, number], c: [0.1, 4.1, 0.1] as [number, number, number] },
      ];
      olivePads.forEach((o, i) => {
        geometries.push(createOrganicFoliageLobe(o.r, o.c, '#365314', '#a3e635', 0.24, i * 2.0));
      });
      break;
    }

    case 'weeping_willow': {
      // Weeping Willow: Thick central trunk branching into sweeping arches, with cascading weeping branch curtains
      geometries.push(createStemSegment(0.30, 0.48, 1.8, [0, 0.9, 0], [0, 0, 0], '#332317'));
      geometries.push(createStemSegment(0.22, 0.30, 1.5, [0, 2.2, 0], [0, 0, 0], '#3a291b'));

      // Arching boughs
      geometries.push(createStemSegment(0.12, 0.18, 1.8, [-0.8, 3.0, 0.5], [0.3, 0.3, -0.8], '#3a291b'));
      geometries.push(createStemSegment(0.12, 0.18, 1.8, [0.8, 3.0, -0.5], [-0.3, -0.3, 0.8], '#3a291b'));
      geometries.push(createStemSegment(0.11, 0.17, 1.8, [0.5, 3.1, 0.8], [0.7, 0, 0.3], '#3a291b'));
      geometries.push(createStemSegment(0.11, 0.17, 1.8, [-0.5, 3.1, -0.8], [-0.7, 0, -0.3], '#3a291b'));

      // Upper canopy dome
      geometries.push(createOrganicFoliageLobe([2.2, 1.2, 2.2], [0, 3.8, 0], '#1b4332', '#4ade80', 0.20, 1.5));

      // Cascading weeping curtains (16 vertical droops)
      for (let i = 0; i < 16; i++) {
        const phi = (i / 16) * Math.PI * 2;
        const r = 1.4 + (i % 3) * 0.35;
        const droopH = 2.4 + (i % 4) * 0.4;
        const cx = Math.cos(phi) * r;
        const cz = Math.sin(phi) * r;
        const cy = 2.2;

        const curtain = new THREE.CylinderGeometry(0.28, 0.15, droopH, 5);
        curtain.translate(cx, cy, cz);
        applyGeometryVertexColors(curtain, '#1e3a2b', '#68d391', 0.05);
        geometries.push(curtain);
      }
      break;
    }

    default: {
      // English Oak / Standard Broadleaf: Massive flared trunk with spreading limb bifurcations and layered foliage pads
      geometries.push(createStemSegment(0.26, 0.42, 1.2, [0, 0.6, 0], [0, 0, 0], '#2c1e13'));
      geometries.push(createStemSegment(0.22, 0.26, 1.6, [0.04, 1.9, -0.02], [-0.04, 0, 0.03], '#352417'));

      // Primary bough bifurcations
      geometries.push(createStemSegment(0.14, 0.20, 1.8, [-0.7, 2.9, 0.4], [0.3, 0.2, -0.7], '#3d2b1c'));
      geometries.push(createStemSegment(0.14, 0.20, 1.9, [0.7, 3.0, -0.4], [-0.25, -0.2, 0.65], '#3d2b1c'));
      geometries.push(createStemSegment(0.12, 0.17, 1.7, [0.3, 3.2, 0.7], [0.65, 0, 0.2], '#3d2b1c'));
      geometries.push(createStemSegment(0.12, 0.17, 1.7, [-0.3, 3.3, -0.7], [-0.65, 0, -0.2], '#3d2b1c'));

      // Organic layered foliage pads
      const oakPads = [
        { r: [1.6, 0.9, 1.5] as [number, number, number], c: [-1.1, 3.4, 0.6] as [number, number, number] },
        { r: [1.7, 0.95, 1.6] as [number, number, number], c: [1.2, 3.5, -0.6] as [number, number, number] },
        { r: [1.5, 0.85, 1.5] as [number, number, number], c: [0.5, 3.8, 1.1] as [number, number, number] },
        { r: [1.5, 0.85, 1.5] as [number, number, number], c: [-0.5, 3.9, -1.0] as [number, number, number] },
        { r: [1.9, 1.1, 1.8] as [number, number, number], c: [0.0, 4.4, 0.0] as [number, number, number] },
        { r: [1.4, 0.85, 1.3] as [number, number, number], c: [0.1, 5.2, 0.1] as [number, number, number] },
      ];
      oakPads.forEach((o, i) => {
        geometries.push(createOrganicFoliageLobe(o.r, o.c, '#143823', '#3a7d44', 0.20, i * 2.1));
      });
      break;
    }
  }

  return safeMergeGeometries(geometries, '#2d6a4f');
}

export function createBushGeometry(speciesId: string = 'boxwood_hedge_bush'): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  switch (speciesId) {
    case 'ribbon_grass': {
      // Ribbon Grass (Phalaris arundinacea 'Picta'): Arching fountain of variegated cream-and-green ribbon blades
      geometries.push(createStemSegment(0.04, 0.07, 0.12, [0, 0.06, 0], [0, 0, 0], '#27361a'));

      const tiers = [
        { count: 18, length: 0.65, width: 0.050, droop: 0.70, baseY: 0.08, rSpread: 0.12 },
        { count: 14, length: 0.80, width: 0.042, droop: 0.50, baseY: 0.12, rSpread: 0.08 },
        { count: 10, length: 0.90, width: 0.038, droop: 0.32, baseY: 0.16, rSpread: 0.04 },
      ];

      tiers.forEach((tier, tierIdx) => {
        for (let i = 0; i < tier.count; i++) {
          const phi = (i / tier.count) * Math.PI * 2 + tierIdx * 0.45;
          const bladeSegments = 6;
          for (let s = 0; s < bladeSegments; s++) {
            const t1 = s / bladeSegments;
            const t2 = (s + 1) / bladeSegments;

            const r1 = tier.rSpread + t1 * tier.length;
            const r2 = tier.rSpread + t2 * tier.length;

            const y1 = tier.baseY + Math.sin(t1 * Math.PI * 0.85) * (tier.length * 0.42) - Math.pow(t1, 2.2) * (tier.length * tier.droop);
            const y2 = tier.baseY + Math.sin(t2 * Math.PI * 0.85) * (tier.length * 0.42) - Math.pow(t2, 2.2) * (tier.length * tier.droop);

            const x1 = Math.cos(phi) * r1;
            const z1 = Math.sin(phi) * r1;
            const x2 = Math.cos(phi) * r2;
            const z2 = Math.sin(phi) * r2;

            const segLen = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
            const w = tier.width * (1.0 - t1 * 0.7);

            const bladeSeg = new THREE.BoxGeometry(w, 0.008, segLen);
            bladeSeg.lookAt(new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1));
            bladeSeg.translate((x1 + x2) / 2, Math.max(0.01, (y1 + y2) / 2), (z1 + z2) / 2);

            const isCream = (i % 2 === 0);
            const baseCol = isCream ? '#fefce8' : '#3f6212';
            const tipCol = isCream ? '#fef9c3' : '#65a30d';
            applyGeometryVertexColors(bladeSeg, baseCol, tipCol, 0.03);
            geometries.push(bladeSeg);
          }
        }
      });
      break;
    }

    case 'hydrangea_bush': {
      // 1. Woody base structure
      geometries.push(createStemSegment(0.03, 0.05, 0.35, [0, 0.17, 0], [0, 0, 0], '#452d1a'));
      geometries.push(createStemSegment(0.02, 0.035, 0.32, [-0.12, 0.25, 0.08], [0.2, 0, -0.3], '#452d1a'));
      geometries.push(createStemSegment(0.02, 0.035, 0.34, [0.14, 0.26, -0.06], [-0.15, 0, 0.35], '#452d1a'));

      // 2. Lush broadleaf under-canopy lobes
      const leafLobes: [number, number, number, [number, number, number]][] = [
        [0.45, 0.38, 0.45, [0, 0.42, 0]],
        [0.38, 0.32, 0.38, [-0.28, 0.35, 0.15]],
        [0.40, 0.34, 0.38, [0.26, 0.36, -0.12]],
        [0.36, 0.30, 0.36, [0.10, 0.32, 0.26]],
        [0.37, 0.31, 0.37, [-0.18, 0.34, -0.24]],
        [0.42, 0.35, 0.42, [0.02, 0.58, 0.04]],
      ];
      leafLobes.forEach(([rx, ry, rz, center], i) => {
        geometries.push(createOrganicFoliageLobe([rx, ry, rz], center, '#19381f', '#2d6a4f', 0.18, i * 1.7));
      });

      // 3. Hydrangea Flower Mopheads
      const flowerHeads: [[number, number, number], number][] = [
        [[0.0, 0.82, 0.05], 0.18],
        [[-0.26, 0.68, 0.22], 0.16],
        [[0.28, 0.70, 0.18], 0.17],
        [[-0.32, 0.58, -0.18], 0.15],
        [[0.24, 0.62, -0.22], 0.16],
        [[0.06, 0.65, 0.34], 0.16],
        [[-0.12, 0.72, -0.15], 0.15],
        [[0.32, 0.50, 0.02], 0.14],
        [[-0.34, 0.48, 0.02], 0.14],
      ];

      flowerHeads.forEach(([pos, rad]) => {
        const bloom = new THREE.IcosahedronGeometry(rad, 2);
        const bPos = bloom.attributes.position;
        const bv = new THREE.Vector3();
        for (let k = 0; k < bPos.count; k++) {
          bv.fromBufferAttribute(bPos, k);
          const petalPerturb = 1.0 + Math.sin(bv.x * 12.0) * Math.cos(bv.y * 12.0) * 0.12;
          bv.multiplyScalar(petalPerturb);
          bv.x += pos[0];
          bv.y += pos[1];
          bv.z += pos[2];
          bPos.setXYZ(k, bv.x, bv.y, bv.z);
        }
        bloom.computeVertexNormals();
        applyGeometryVertexColors(bloom, '#38bdf8', '#e0f2fe', 0.06);
        geometries.push(bloom);
      });
      break;
    }

    case 'lavender_shrub': {
      // 1. Woody understory
      geometries.push(createStemSegment(0.035, 0.05, 0.25, [0, 0.12, 0], [0, 0, 0], '#453526'));

      // 2. Dense silver-green aromatic foliage mound
      const foliageCenters: [[number, number, number], [number, number, number]][] = [
        [[0, 0.28, 0], [0.38, 0.24, 0.38]],
        [[-0.18, 0.22, 0.12], [0.28, 0.18, 0.28]],
        [[0.18, 0.23, -0.10], [0.26, 0.18, 0.26]],
        [[0.08, 0.20, 0.18], [0.24, 0.16, 0.24]],
        [[-0.10, 0.22, -0.16], [0.25, 0.17, 0.25]],
      ];
      foliageCenters.forEach(([center, rad], i) => {
        geometries.push(createOrganicFoliageLobe(rad, center, '#334155', '#64748b', 0.15, i * 2.1));
      });

      // 3. Violet flowering spikes radiating outward
      const numSpikes = 26;
      for (let i = 0; i < numSpikes; i++) {
        const phi = (i / numSpikes) * Math.PI * 2 + (i % 3) * 0.2;
        const spreadR = 0.12 + (i % 5) * 0.04;
        const tilt = 0.15 + (i % 4) * 0.08;
        const spikeHeight = 0.36 + (i % 3) * 0.06;

        const baseX = Math.cos(phi) * spreadR;
        const baseZ = Math.sin(phi) * spreadR;
        const baseY = 0.32 + (i % 4) * 0.03;

        const stem = new THREE.CylinderGeometry(0.007, 0.012, spikeHeight, 4);
        stem.rotateX(Math.sin(phi) * tilt);
        stem.rotateZ(-Math.cos(phi) * tilt);
        stem.translate(baseX, baseY + spikeHeight * 0.45, baseZ);
        applyGeometryVertexColors(stem, '#2d5a27', '#4d7c0f', 0.02);
        geometries.push(stem);

        const flowerSpikeLen = 0.14 + (i % 3) * 0.03;
        const flowerSpike = new THREE.CylinderGeometry(0.022, 0.032, flowerSpikeLen, 6);
        flowerSpike.rotateX(Math.sin(phi) * tilt);
        flowerSpike.rotateZ(-Math.cos(phi) * tilt);
        flowerSpike.translate(
          baseX + Math.cos(phi) * tilt * 0.18,
          baseY + spikeHeight + flowerSpikeLen * 0.35,
          baseZ + Math.sin(phi) * tilt * 0.18
        );
        applyGeometryVertexColors(flowerSpike, '#6d28d9', '#c084fc', 0.06);
        geometries.push(flowerSpike);
      }
      break;
    }

    case 'fern_cluster': {
      geometries.push(createStemSegment(0.04, 0.06, 0.15, [0, 0.08, 0], [0, 0, 0], '#271e16'));

      const numFronds = 18;
      for (let i = 0; i < numFronds; i++) {
        const angle = (i / numFronds) * Math.PI * 2;
        const isInnerTier = i % 2 === 1;
        const frondLen = isInnerTier ? 0.55 : 0.75;
        const droop = isInnerTier ? 0.35 : 0.65;
        const frondWidth = isInnerTier ? 0.18 : 0.24;

        const segments = 6;
        for (let s = 0; s < segments; s++) {
          const t1 = s / segments;
          const t2 = (s + 1) / segments;
          const r1 = t1 * frondLen;
          const r2 = t2 * frondLen;
          const y1 = 0.15 + (1.0 - t1 * droop) * t1 * 0.4;
          const y2 = 0.15 + (1.0 - t2 * droop) * t2 * 0.4;

          const x1 = Math.cos(angle) * r1;
          const z1 = Math.sin(angle) * r1;
          const x2 = Math.cos(angle) * r2;
          const z2 = Math.sin(angle) * r2;

          const segLen = Math.hypot(x2 - x1, y2 - y1, z2 - z1);
          const leafW = frondWidth * (1.0 - Math.abs(t1 - 0.5) * 1.4);

          const pinna = new THREE.BoxGeometry(leafW, 0.012, segLen);
          pinna.lookAt(new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1));
          pinna.translate((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
          applyGeometryVertexColors(pinna, '#14532d', '#22c55e', 0.05);
          geometries.push(pinna);
        }
      }
      break;
    }

    case 'wild_rose_bush': {
      geometries.push(createStemSegment(0.04, 0.06, 0.38, [0, 0.19, 0], [0, 0, 0], '#382516'));
      geometries.push(createStemSegment(0.025, 0.04, 0.42, [-0.15, 0.28, 0.1], [0.3, 0, -0.4], '#382516'));
      geometries.push(createStemSegment(0.025, 0.04, 0.40, [0.18, 0.26, -0.08], [-0.2, 0, 0.4], '#382516'));

      const roseLobes: [number, number, number, [number, number, number]][] = [
        [0.45, 0.35, 0.45, [0, 0.48, 0]],
        [0.38, 0.30, 0.38, [-0.26, 0.42, 0.18]],
        [0.36, 0.28, 0.36, [0.24, 0.40, -0.15]],
        [0.34, 0.26, 0.34, [0.12, 0.38, 0.24]],
        [0.35, 0.28, 0.35, [-0.18, 0.40, -0.22]],
        [0.38, 0.30, 0.38, [0.02, 0.65, 0.02]],
      ];
      roseLobes.forEach(([rx, ry, rz, center], i) => {
        geometries.push(createOrganicFoliageLobe([rx, ry, rz], center, '#1b4332', '#2d6a4f', 0.20, i * 2.3));
      });

      const blossomPositions: [number, number, number][] = [
        [0.05, 0.85, 0.08],
        [-0.28, 0.72, 0.18],
        [0.30, 0.68, 0.12],
        [-0.22, 0.58, -0.24],
        [0.24, 0.62, -0.18],
        [0.10, 0.66, 0.32],
        [-0.34, 0.48, 0.05],
        [0.32, 0.52, -0.05],
      ];
      blossomPositions.forEach(([bx, by, bz]) => {
        for (let p = 0; p < 5; p++) {
          const petalAngle = (p / 5) * Math.PI * 2;
          const petal = new THREE.CylinderGeometry(0.035, 0.01, 0.06, 5);
          petal.rotateZ(Math.PI / 2);
          petal.rotateY(petalAngle);
          petal.translate(bx + Math.cos(petalAngle) * 0.04, by, bz + Math.sin(petalAngle) * 0.04);
          applyGeometryVertexColors(petal, '#f43f5e', '#fecdd3', 0.03);
          geometries.push(petal);
        }
        const center = new THREE.SphereGeometry(0.022, 6, 6);
        center.translate(bx, by + 0.01, bz);
        applyGeometryVertexColors(center, '#eab308', '#fef08a', 0.02);
        geometries.push(center);
      });
      break;
    }

    case 'ornamental_grass': {
      geometries.push(createStemSegment(0.04, 0.06, 0.12, [0, 0.06, 0], [0, 0, 0], '#3f3120'));

      const numBlades = 32;
      for (let i = 0; i < numBlades; i++) {
        const phi = (i / numBlades) * Math.PI * 2;
        const bladeH = 0.55 + (i % 5) * 0.06;
        const droop = 0.25 + (i % 4) * 0.08;

        const blade = new THREE.CylinderGeometry(0.004, 0.02, bladeH, 4);
        blade.rotateX(Math.sin(phi) * droop);
        blade.rotateZ(-Math.cos(phi) * droop);
        blade.translate(Math.cos(phi) * 0.12, bladeH * 0.45, Math.sin(phi) * 0.12);
        applyGeometryVertexColors(blade, '#365314', '#a3e635', 0.04);
        geometries.push(blade);
      }

      for (let p = 0; p < 12; p++) {
        const phi = (p / 12) * Math.PI * 2 + 0.3;
        const plumeH = 0.70 + (p % 3) * 0.08;
        const plume = new THREE.CylinderGeometry(0.015, 0.028, 0.25, 5);
        plume.rotateX(Math.sin(phi) * 0.15);
        plume.rotateZ(-Math.cos(phi) * 0.15);
        plume.translate(Math.cos(phi) * 0.08, plumeH, Math.sin(phi) * 0.08);
        applyGeometryVertexColors(plume, '#ca8a04', '#fde68a', 0.04);
        geometries.push(plume);
      }
      break;
    }

    default: {
      // Boxwood Shrub (Buxus sempervirens)
      geometries.push(createStemSegment(0.045, 0.07, 0.30, [0, 0.15, 0], [0, 0, 0], '#3a2717'));
      geometries.push(createStemSegment(0.03, 0.045, 0.28, [-0.14, 0.22, 0.08], [0.25, 0, -0.35], '#3a2717'));
      geometries.push(createStemSegment(0.03, 0.045, 0.26, [0.15, 0.20, -0.06], [-0.2, 0, 0.3], '#3a2717'));

      const boxwoodLobes: [number, number, number, [number, number, number]][] = [
        [0.48, 0.40, 0.46, [0, 0.45, 0]],
        [0.38, 0.32, 0.38, [0.04, 0.68, -0.02]],
        [0.32, 0.28, 0.34, [-0.16, 0.62, 0.12]],
        [0.34, 0.28, 0.32, [0.18, 0.60, -0.10]],
        [0.38, 0.32, 0.36, [-0.32, 0.42, 0.18]],
        [0.40, 0.34, 0.38, [0.34, 0.44, -0.12]],
        [0.36, 0.30, 0.36, [0.12, 0.40, 0.32]],
        [0.38, 0.32, 0.38, [-0.18, 0.42, -0.28]],
        [0.32, 0.24, 0.32, [-0.30, 0.26, -0.15]],
        [0.34, 0.25, 0.34, [0.28, 0.28, 0.22]],
        [0.30, 0.24, 0.30, [0.02, 0.25, -0.32]],
        [0.32, 0.25, 0.32, [-0.08, 0.26, 0.30]],
      ];

      boxwoodLobes.forEach(([rx, ry, rz, center], i) => {
        geometries.push(createOrganicFoliageLobe(
          [rx, ry, rz],
          center,
          '#143823',
          '#388349',
          0.19,
          i * 1.9 + 0.4
        ));
      });
      break;
    }
  }

  return safeMergeGeometries(geometries, '#2d6a4f');
}

export function createFenceGeometry(length: number = 2.4, height: number = 1.1): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  const postWidth = 0.12;
  const postSpacing = Math.min(2.0, Math.max(0.8, length / Math.max(1, Math.round(length / 2.0))));
  const numPosts = Math.max(2, Math.round(length / postSpacing) + 1);
  const actualSpacing = length / (numPosts - 1);

  for (let i = 0; i < numPosts; i++) {
    const px = -length / 2 + i * actualSpacing;
    const post = new THREE.BoxGeometry(postWidth, height, postWidth);
    post.translate(px, height / 2, 0);
    geometries.push(post);

    const cap = new THREE.ConeGeometry(postWidth * 0.75, 0.08, 4);
    cap.rotateY(Math.PI / 4);
    cap.translate(px, height + 0.04, 0);
    geometries.push(cap);
  }

  const bottomRail = new THREE.BoxGeometry(length, 0.08, 0.05);
  bottomRail.translate(0, height * 0.35, 0);
  geometries.push(bottomRail);

  const topRail = new THREE.BoxGeometry(length, 0.08, 0.05);
  topRail.translate(0, height * 0.85, 0);
  geometries.push(topRail);

  const numPalings = Math.max(3, Math.round(length / 0.18));
  const palingSpacing = length / (numPalings - 1);
  for (let i = 0; i < numPalings; i++) {
    const px = -length / 2 + i * palingSpacing;
    const paling = new THREE.BoxGeometry(0.09, height * 0.78, 0.02);
    paling.translate(px, height * 0.55, 0.035);
    geometries.push(paling);

    const pCap = new THREE.ConeGeometry(0.055, 0.06, 4);
    pCap.rotateY(Math.PI / 4);
    pCap.translate(px, height * 0.94 + 0.03, 0.035);
    geometries.push(pCap);
  }

  return safeMergeGeometries(geometries, '#8b5a2b');
}

export function createRailingGeometry(length: number = 2.4, height: number = 1.0): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  const postRadius = 0.03;
  const numPosts = Math.max(2, Math.round(length / 1.5) + 1);
  const actualSpacing = length / (numPosts - 1);

  for (let i = 0; i < numPosts; i++) {
    const px = -length / 2 + i * actualSpacing;
    const post = new THREE.CylinderGeometry(postRadius, postRadius, height, 10);
    post.translate(px, height / 2, 0);
    geometries.push(post);
  }

  const topHandrail = new THREE.CylinderGeometry(0.04, 0.04, length, 12);
  topHandrail.rotateZ(Math.PI / 2);
  topHandrail.translate(0, height, 0);
  geometries.push(topHandrail);

  const midRailLevels = [0.25, 0.5, 0.75];
  for (const rL of midRailLevels) {
    const rod = new THREE.CylinderGeometry(0.01, 0.01, length, 8);
    rod.rotateZ(Math.PI / 2);
    rod.translate(0, height * rL, 0);
    geometries.push(rod);
  }

  return safeMergeGeometries(geometries, '#475569');
}

export function createLampGeometry(height: number = 3.2): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  const base = new THREE.CylinderGeometry(0.2, 0.25, 0.3, 14);
  base.translate(0, 0.15, 0);
  geometries.push(base);

  const pole = new THREE.CylinderGeometry(0.05, 0.07, height - 0.7, 14);
  pole.translate(0, 0.3 + (height - 0.7) / 2, 0);
  geometries.push(pole);

  const lantern = new THREE.CylinderGeometry(0.22, 0.14, 0.45, 8);
  lantern.translate(0, height - 0.25, 0);
  geometries.push(lantern);

  const cap = new THREE.ConeGeometry(0.28, 0.2, 8);
  cap.translate(0, height + 0.05, 0);
  geometries.push(cap);

  return safeMergeGeometries(geometries, '#334155');
}

export function createBenchGeometry(length: number = 1.8): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  const seat = new THREE.BoxGeometry(length, 0.04, 0.45);
  seat.translate(0, 0.46, 0);
  geometries.push(seat);

  const backrest = new THREE.BoxGeometry(length, 0.38, 0.04);
  backrest.translate(0, 0.76, -0.2);
  geometries.push(backrest);

  const legPositions = [-length / 2 + 0.15, length / 2 - 0.15];
  for (const lx of legPositions) {
    const leg = new THREE.BoxGeometry(0.06, 0.46, 0.48);
    leg.translate(lx, 0.23, 0);
    geometries.push(leg);

    const backStrut = new THREE.BoxGeometry(0.06, 0.45, 0.06);
    backStrut.translate(lx, 0.68, -0.2);
    geometries.push(backStrut);
  }

  return safeMergeGeometries(geometries, '#78350f');
}

export function createRockGeometry(size: number = 1.2): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(size * 0.7, 1);
  const pos = geo.attributes.position;
  
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const noise = Math.sin(x * 3.5 + y * 2.1) * Math.cos(z * 4.2) * 0.12;
    pos.setXYZ(i, x * (1 + noise), y * (1 + noise), z * (1 + noise));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  geo.scale(1.15, 0.85, 1.05);
  geo.translate(0, size * 0.45, 0);
  applyGeometryVertexColors(geo, '#475569', '#94a3b8', 0.05);
  return geo;
}
