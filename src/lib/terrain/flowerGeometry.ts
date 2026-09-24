import * as THREE from 'three';
import { Shape, TerrainModifier, WildflowerSettings } from '../../types';
import { sampleTerrainElevation } from '../archRoomAssembly';
import {
  extractExclusionFootprints,
  isPointExcluded,
  computeTerrainNormal
} from './grassGeometry';

/** Flower species with their own modelled geometry. */
export type FlowerKind = 'daisy' | 'poppy' | 'buttercup' | 'lavender' | 'alpine';
export const FLOWER_KINDS: FlowerKind[] = ['daisy', 'poppy', 'buttercup', 'lavender', 'alpine'];

/**
 * What each vertex is, for colouring in the shader (aPart):
 * stem, leaf, petal, flower centre, dark centre (poppy seed pod), lavender floret.
 */
export const FLOWER_PART = { stem: 0, leaf: 1, petal: 2, centre: 3, pod: 4, floret: 5 } as const;

type Vec3 = [number, number, number];

/**
 * Accumulates one flower model. Every vertex is attached to the stem at a fraction of its
 * height (aAttach): the attach point is stretched with the instance's height in the shader
 * while the vertex's offset from it keeps its real size in metres. So a taller flower has a
 * longer stem, not bigger petals. Position y is stored as attach + offset.
 */
class FlowerBuilder {
  positions: number[] = [];
  attach: number[] = [];
  part: number[] = [];
  shade: number[] = [];
  indices: number[] = [];

  vertex(p: Vec3, attach: number, part: number, shade: number): number {
    this.positions.push(p[0], p[1] + attach, p[2]);
    this.attach.push(attach);
    this.part.push(part);
    this.shade.push(shade);
    return this.attach.length - 1;
  }

  /**
   * A curved strip (petal or leaf): the spine starts at `origin`, heads outward at `yaw`
   * (radians around +y), starting at `tiltStart` above horizontal and bending to `tiltEnd` at
   * the tip. `width(s)` is the full width along the strip (s = 0 base .. 1 tip); `cup` raises
   * the edges into a spoon or bowl. `transform` places head parts (tilt/nod) around the stem top.
   */
  strip(opts: {
    origin: Vec3; yaw: number; length: number; tiltStart: number; tiltEnd: number;
    width: (s: number) => number; cup?: number; segments?: number; attach: number; part: number;
    transform?: THREE.Matrix4; crinkle?: number; twist?: number;
  }) {
    const { origin, yaw, length, tiltStart, tiltEnd, width, cup = 0, segments = 3, attach, part, transform, crinkle = 0, twist = 0 } = opts;
    const radial = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
    const spine = new THREE.Vector3(...origin);
    const step = length / segments;
    const rows: number[][] = [];
    for (let k = 0; k <= segments; k++) {
      const s = k / segments;
      if (k > 0) {
        const tilt = tiltStart + (tiltEnd - tiltStart) * (s - 0.5 / segments);
        spine.addScaledVector(radial, Math.cos(tilt) * step).add(new THREE.Vector3(0, Math.sin(tilt) * step, 0));
      }
      const w = width(s) / 2;
      const tilt = tiltStart + (tiltEnd - tiltStart) * s;
      // Up direction of the strip surface (perpendicular to the spine, in the radial plane).
      const up = new THREE.Vector3(0, Math.cos(tilt), 0).addScaledVector(radial, -Math.sin(tilt));
      const sideDir = side.clone().applyAxisAngle(radial, twist * s);
      const row: number[] = [];
      for (const t of [-1, 0, 1]) {
        const wobble = crinkle * Math.sin((s * 7 + t * 3.1 + yaw * 5) * 2.3) * w;
        const p = spine.clone().addScaledVector(sideDir, t * w).addScaledVector(up, Math.abs(t) * cup * w + wobble * Math.abs(t));
        if (transform) p.applyMatrix4(transform);
        row.push(this.vertex([p.x, p.y, p.z], attach, part, s));
      }
      rows.push(row);
    }
    for (let k = 0; k < segments; k++) {
      const a = rows[k], b = rows[k + 1];
      this.indices.push(a[0], a[1], b[1], a[0], b[1], b[0], a[1], a[2], b[2], a[1], b[2], b[1]);
    }
  }

  /** A thin three-sided stem from `from` (attach a0) to `to` (attach a1), in sections. */
  stem(from: Vec3, to: Vec3, a0: number, a1: number, radius: number, sections = 3, part: number = FLOWER_PART.stem) {
    const rings: number[][] = [];
    for (let k = 0; k <= sections; k++) {
      const s = k / sections;
      const x = from[0] + (to[0] - from[0]) * s, z = from[2] + (to[2] - from[2]) * s;
      const attach = a0 + (a1 - a0) * s;
      const r = radius * (1 - 0.35 * s);
      const ring: number[] = [];
      for (let j = 0; j < 3; j++) {
        const angle = (j / 3) * Math.PI * 2;
        ring.push(this.vertex([x + Math.cos(angle) * r, 0, z + Math.sin(angle) * r], attach, part, s));
      }
      rings.push(ring);
    }
    for (let k = 0; k < sections; k++) {
      for (let j = 0; j < 3; j++) {
        const j2 = (j + 1) % 3;
        const a = rings[k][j], b = rings[k][j2], c = rings[k + 1][j2], d = rings[k + 1][j];
        this.indices.push(a, b, c, a, c, d);
      }
    }
  }

  /** A low dome (flower centre / seed pod) of `radius` and `height` around the head origin. */
  dome(radius: number, height: number, attach: number, part: number, transform?: THREE.Matrix4, sides = 8, lift = 0) {
    const place = (x: number, y: number, z: number) => {
      const p = new THREE.Vector3(x, y + lift, z);
      if (transform) p.applyMatrix4(transform);
      return p;
    };
    const top = place(0, height, 0);
    const topIndex = this.vertex([top.x, top.y, top.z], attach, part, 1);
    const mid: number[] = [], rim: number[] = [];
    for (let j = 0; j < sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      const m = place(Math.cos(angle) * radius * 0.7, height * 0.75, Math.sin(angle) * radius * 0.7);
      const r = place(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      mid.push(this.vertex([m.x, m.y, m.z], attach, part, 0.7));
      rim.push(this.vertex([r.x, r.y, r.z], attach, part, 0.2));
    }
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      this.indices.push(topIndex, mid[j2], mid[j], mid[j], mid[j2], rim[j2], mid[j], rim[j2], rim[j]);
    }
  }

  /** A tiny closed bud (lavender floret): a four-sided spindle. */
  bud(centre: Vec3, size: number, attach: number, yaw: number, shade: number) {
    const up = this.vertex([centre[0], centre[1] + size * 1.2, centre[2]], attach, FLOWER_PART.floret, shade);
    const down = this.vertex([centre[0], centre[1] - size * 0.6, centre[2]], attach, FLOWER_PART.floret, shade * 0.8);
    const ring: number[] = [];
    for (let j = 0; j < 4; j++) {
      const angle = yaw + (j / 4) * Math.PI * 2;
      ring.push(this.vertex([centre[0] + Math.cos(angle) * size, centre[1], centre[2] + Math.sin(angle) * size], attach, FLOWER_PART.floret, shade));
    }
    for (let j = 0; j < 4; j++) {
      const j2 = (j + 1) % 4;
      this.indices.push(up, ring[j2], ring[j], down, ring[j], ring[j2]);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('aAttach', new THREE.Float32BufferAttribute(this.attach, 1));
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    geometry.setAttribute('aShade', new THREE.Float32BufferAttribute(this.shade, 1));
    geometry.setIndex(this.indices);
    // Normals from the curved, shared-vertex strips give petals soft, rounded shading. They are
    // computed on a model with a short (15%) stem, close to how flowers are actually shown, so
    // the stored unit-height stretch doesn't skew the stem's normals.
    const flat = new Float32Array(this.positions);
    for (let i = 0; i < this.attach.length; i++) flat[i * 3 + 1] -= this.attach[i] * 0.85;
    const normalSource = new THREE.BufferGeometry();
    normalSource.setAttribute('position', new THREE.BufferAttribute(flat, 3));
    normalSource.setIndex(this.indices);
    normalSource.computeVertexNormals();
    geometry.setAttribute('normal', normalSource.getAttribute('normal'));
    normalSource.dispose();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const deg = THREE.MathUtils.degToRad;
/** Rotation (nod) of a flower head about the horizontal axis, plus an offset. */
function headTransform(nodDeg: number, offset: Vec3 = [0, 0, 0], yawDeg = 0) {
  return new THREE.Matrix4().makeTranslation(...offset)
    .multiply(new THREE.Matrix4().makeRotationY(deg(yawDeg)))
    .multiply(new THREE.Matrix4().makeRotationX(deg(nodDeg)));
}

/** Basal rosette of leaves lying low around the stem foot. */
function rosette(b: FlowerBuilder, count: number, length: number, width: number, tiltStart: number, tiltEnd: number, cup = 0.3, yawOffset = 0) {
  for (let i = 0; i < count; i++) {
    const yaw = yawOffset + (i / count) * Math.PI * 2 + (i % 2) * 0.35;
    b.strip({
      origin: [0, 0.002, 0], yaw, length: length * (0.8 + 0.2 * ((i * 7) % 3) / 2), tiltStart: deg(tiltStart), tiltEnd: deg(tiltEnd),
      width: s => width * Math.sin(Math.PI * Math.min(1, 0.12 + s * 0.95)) ** 0.8, cup, segments: 3, attach: 0, part: FLOWER_PART.leaf,
    });
  }
}

function buildDaisy(): THREE.BufferGeometry {
  const b = new FlowerBuilder();
  b.stem([0, 0, 0], [0, 0, 0], 0, 1, 0.0011, 4);
  rosette(b, 5, 0.032, 0.011, 25, 8, 0.25);
  const head = headTransform(12);
  // Ray florets: many narrow white petals, gently cupped at the base, tips relaxing outward.
  const petals = 18;
  for (let i = 0; i < petals; i++) {
    const yaw = (i / petals) * Math.PI * 2 + (i % 2) * 0.08;
    b.strip({
      origin: [Math.cos(yaw) * 0.0045, 0.0012, Math.sin(yaw) * 0.0045], yaw, length: 0.016 + (i % 3) * 0.001,
      tiltStart: deg(16), tiltEnd: deg(-6), width: s => 0.0042 * Math.min(1, Math.sin(Math.PI * (0.08 + s * 0.9)) * 1.6),
      cup: 0.15, segments: 3, attach: 1, part: FLOWER_PART.petal, transform: head, twist: (i % 2 ? 0.25 : -0.25),
    });
  }
  // Golden disc florets: a low dome.
  b.dome(0.0058, 0.004, 1, FLOWER_PART.centre, head, 10);
  return b.build();
}

function buildPoppy(): THREE.BufferGeometry {
  const b = new FlowerBuilder();
  // Slightly curved hairy stem with a pair of lobed leaves low down.
  b.stem([0, 0, 0], [0.004, 0, 0.002], 0, 1, 0.0014, 4);
  rosette(b, 4, 0.05, 0.016, 35, 10, 0.2);
  for (const yaw of [0.4, 0.4 + Math.PI]) {
    b.strip({ origin: [0, 0, 0], yaw, length: 0.03, tiltStart: deg(40), tiltEnd: deg(15), width: s => 0.009 * Math.sin(Math.PI * Math.min(1, 0.1 + s)) ** 0.7,
      cup: 0.2, segments: 3, attach: 0.35, part: FLOWER_PART.leaf, crinkle: 0.25 });
  }
  const head = headTransform(8, [0.004, 0, 0.002]);
  // Four broad, crinkled petals forming an open bowl; the outer pair a little larger.
  for (let i = 0; i < 4; i++) {
    const yaw = (i / 4) * Math.PI * 2 + (i % 2) * 0.12;
    const size = i % 2 ? 1 : 1.12;
    b.strip({
      origin: [Math.cos(yaw) * 0.002, 0.001 + (i % 2) * 0.0015, Math.sin(yaw) * 0.002], yaw, length: 0.026 * size,
      tiltStart: deg(62), tiltEnd: deg(22), width: s => 0.036 * size * Math.sin(Math.PI * (0.06 + s * 0.62)) ** 0.55,
      cup: 0.28, segments: 4, attach: 1, part: FLOWER_PART.petal, transform: head, crinkle: 0.12,
    });
  }
  // Seed pod with its flat, rayed cap, ringed by dark stamens.
  b.dome(0.0055, 0.004, 1, FLOWER_PART.pod, head, 8, 0.003);
  b.dome(0.0045, 0.0012, 1, FLOWER_PART.centre, head, 8, 0.007);
  return b.build();
}

function buildButtercup(): THREE.BufferGeometry {
  const b = new FlowerBuilder();
  b.stem([0, 0, 0], [0, 0, 0], 0, 1, 0.0011, 4);
  // Deeply lobed basal leaves: three broad lobes per leaf.
  for (let i = 0; i < 3; i++) {
    const yaw = (i / 3) * Math.PI * 2;
    for (const lobe of [-0.45, 0, 0.45]) {
      b.strip({ origin: [0, 0.003, 0], yaw: yaw + lobe, length: 0.02 * (lobe ? 0.8 : 1), tiltStart: deg(40), tiltEnd: deg(5),
        width: s => 0.012 * Math.sin(Math.PI * Math.min(1, 0.15 + s * 0.85)) ** 0.6, cup: 0.35, segments: 2, attach: 0, part: FLOWER_PART.leaf });
    }
  }
  // A small stem leaf where the stem branches.
  b.strip({ origin: [0, 0, 0], yaw: 1.2, length: 0.014, tiltStart: deg(45), tiltEnd: deg(20), width: s => 0.004 * Math.sin(Math.PI * Math.min(1, 0.1 + s)),
    segments: 2, attach: 0.55, part: FLOWER_PART.leaf });
  const head = headTransform(15);
  // Five glossy, rounded petals forming a shallow cup.
  for (let i = 0; i < 5; i++) {
    const yaw = (i / 5) * Math.PI * 2;
    b.strip({
      origin: [Math.cos(yaw) * 0.0018, 0.0008, Math.sin(yaw) * 0.0018], yaw, length: 0.013,
      tiltStart: deg(52), tiltEnd: deg(24), width: s => 0.014 * Math.sin(Math.PI * (0.12 + s * 0.8)) ** 0.5,
      cup: 0.4, segments: 3, attach: 1, part: FLOWER_PART.petal, transform: head,
    });
  }
  b.dome(0.003, 0.0026, 1, FLOWER_PART.centre, head, 8, 0.0008);
  return b.build();
}

function buildLavender(): THREE.BufferGeometry {
  const b = new FlowerBuilder();
  // A small clump: narrow grey-green leaves and three flower spikes of different heights.
  for (let i = 0; i < 7; i++) {
    const yaw = (i / 7) * Math.PI * 2 + 0.3;
    b.strip({ origin: [0, 0.002, 0], yaw, length: 0.045 + (i % 3) * 0.006, tiltStart: deg(62), tiltEnd: deg(35),
      width: s => 0.0035 * Math.sin(Math.PI * Math.min(1, 0.1 + s * 0.9)) ** 0.5, cup: 0.1, segments: 3, attach: 0, part: FLOWER_PART.leaf });
  }
  const spikes: Array<{ top: Vec3; reach: number; yaw: number }> = [
    { top: [0, 0, 0], reach: 1, yaw: 0 },
    { top: [0.022, 0, 0.01], reach: 0.86, yaw: 1.1 },
    { top: [-0.016, 0, 0.02], reach: 0.78, yaw: 2.3 },
  ];
  for (const spike of spikes) {
    b.stem([0, 0, 0], spike.top, 0, spike.reach, 0.001, 4);
    // Whorls of tiny buds along the top third, tapering to the tip.
    const whorls = 9;
    for (let w = 0; w < whorls; w++) {
      const s = w / (whorls - 1);
      const attach = spike.reach * (0.66 + 0.34 * s);
      const x = spike.top[0] * (attach / spike.reach), z = spike.top[2] * (attach / spike.reach);
      const size = 0.0038 * (1 - 0.4 * s);
      // Opposite pairs, each whorl turned a quarter from the last.
      for (let j = 0; j < 2; j++) {
        const yaw = spike.yaw + w * Math.PI / 2 + j * Math.PI;
        b.bud([x + Math.cos(yaw) * size * 1.1, 0, z + Math.sin(yaw) * size * 1.1], size, attach, yaw, s);
      }
    }
  }
  return b.build();
}

function buildAlpine(): THREE.BufferGeometry {
  const b = new FlowerBuilder();
  rosette(b, 6, 0.016, 0.006, 20, 5, 0.3);
  // A little cushion of three short stems, each with a starry five-petalled flower.
  const heads: Array<{ top: Vec3; reach: number; nod: number; yaw: number }> = [
    { top: [0, 0, 0], reach: 1, nod: 10, yaw: 0 },
    { top: [0.012, 0, -0.006], reach: 0.8, nod: 25, yaw: 70 },
    { top: [-0.01, 0, 0.009], reach: 0.66, nod: 30, yaw: 200 },
  ];
  for (const h of heads) {
    b.stem([0, 0, 0], h.top, 0, h.reach, 0.0011, 3);
    const head = headTransform(h.nod, h.top, h.yaw);
    for (let i = 0; i < 5; i++) {
      const yaw = (i / 5) * Math.PI * 2;
      b.strip({
        origin: [Math.cos(yaw) * 0.0014, 0.0006, Math.sin(yaw) * 0.0014], yaw, length: 0.0095,
        tiltStart: deg(30), tiltEnd: deg(4), width: s => 0.007 * Math.sin(Math.PI * (0.1 + s * 0.9)) ** 0.9,
        cup: 0.2, segments: 2, attach: h.reach, part: FLOWER_PART.petal, transform: head,
      });
    }
    b.dome(0.0021, 0.0014, h.reach, FLOWER_PART.centre, head, 6);
  }
  return b.build();
}

const BUILDERS: Record<FlowerKind, () => THREE.BufferGeometry> = {
  daisy: buildDaisy, poppy: buildPoppy, buttercup: buildButtercup, lavender: buildLavender, alpine: buildAlpine,
};

/** Detailed geometry for one flower species (see FlowerBuilder for the attribute layout). */
export function createFlowerGeometry(kind: FlowerKind): THREE.BufferGeometry {
  return BUILDERS[kind]();
}

/** Stem height multiplier per species, relative to the meadow's height settings. */
export const FLOWER_HEIGHT_SCALE: Record<FlowerKind, number> = {
  daisy: 0.8, poppy: 1.35, buttercup: 1.05, lavender: 1.45, alpine: 0.55,
};

export interface WildflowerInstanceData {
  instanceCount: number;
  matrices: Float32Array;
  shapeOffsets: Float32Array; // vec4: (leanX, leanZ, scaleMultiplier, colorJitter)
  heightVariances: Float32Array; // 0.0 to 1.0
  /** Index into FLOWER_KINDS for each instance (all the same unless the meadow is mixed). */
  kinds: Uint8Array;
}

/** The species a meadow grows; a mixed meadow grows patches of each. */
export function meadowKinds(flowerType: WildflowerSettings['flowerType']): FlowerKind[] {
  return !flowerType || flowerType === 'mixed' ? FLOWER_KINDS : [flowerType];
}

function patchHash(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Distributes instanced low-lying wildflowers across terrain with floor slab and road exclusion.
 */
export function generateWildflowerInstances(
  terrainShape: Shape,
  shapes: Shape[],
  terrainModifiers: TerrainModifier[] = [],
  settings: WildflowerSettings
): WildflowerInstanceData {
  const td = terrainShape.terrainData;
  if (!td || !settings.enabled) {
    return {
      instanceCount: 0,
      matrices: new Float32Array(0),
      shapeOffsets: new Float32Array(0),
      heightVariances: new Float32Array(0),
      kinds: new Uint8Array(0)
    };
  }

  const terrainWidth = td.width || 30;
  const terrainDepth = td.depth || 30;
  const terrainArea = terrainWidth * terrainDepth;

  // Target instance count based on density (supports delicate low density < 1 up to 15 per m²)
  // Cap at 45,000 for smooth 60fps performance
  const targetCount = Math.min(
    Math.max(1, Math.round(terrainArea * Math.max(0.01, settings.density))),
    45000
  );

  // Extract slab and road exclusion footprints
  const exclusionFootprints = extractExclusionFootprints(shapes, terrainModifiers);

  const matrices: number[] = [];
  const shapeOffsets: number[] = [];
  const heightVariances: number[] = [];
  const kinds: number[] = [];
  const species = meadowKinds(settings.flowerType);

  const halfW = terrainWidth / 2;
  const halfD = terrainDepth / 2;
  const originX = (terrainShape.position ? terrainShape.position[0] : 0) - halfW;
  const originZ = (terrainShape.position ? terrainShape.position[2] : 0) - halfD;

  const maxSlopeCos = Math.cos((settings.maxSlopeAngle * Math.PI) / 180);

  // Clump distribution: wildflowers naturally grow in clusters and meadows
  // Use a pseudo-random jittered grid with clump clustering
  const numCellsX = Math.max(1, Math.floor(Math.sqrt(targetCount * (terrainWidth / terrainDepth))));
  const numCellsZ = Math.max(1, Math.floor(targetCount / numCellsX));
  const stepX = terrainWidth / numCellsX;
  const stepZ = terrainDepth / numCellsZ;

  let seed = 7183;
  function lcg() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  const dummy = new THREE.Object3D();
  const upVector = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < targetCount; i++) {
    const cellI = i % numCellsX;
    const cellJ = Math.floor(i / numCellsX);

    // Jitter within cell with organic clustering
    const r1 = lcg();
    const r2 = lcg();
    const r3 = lcg();

    // Natural clustering: 30% clump clusters, 70% scattered
    let offsetX = (r1 - 0.5) * stepX * 1.8;
    let offsetZ = (r2 - 0.5) * stepZ * 1.8;
    if (r3 < 0.35) {
      // Pull toward clump center
      offsetX *= 0.4;
      offsetZ *= 0.4;
    }

    const lx = (cellI + 0.5) * stepX + offsetX;
    const lz = (cellJ + 0.5) * stepZ + offsetZ;

    if (lx < 0.2 || lx > terrainWidth - 0.2 || lz < 0.2 || lz > terrainDepth - 0.2) {
      continue;
    }

    const wx = originX + lx;
    const wz = originZ + lz;
    const wy = sampleTerrainElevation(wx, wz, terrainShape);

    // 1. Slope culling
    const normal = computeTerrainNormal(wx, wz, terrainShape);
    if (normal.y < maxSlopeCos) {
      continue;
    }

    // 2. Floor Slab & Road Corridor Exclusion
    if (exclusionFootprints.length > 0) {
      if (isPointExcluded(wx, wy, wz, exclusionFootprints)) {
        continue;
      }
    }

    // 3. Instance transforms
    dummy.position.set(wx, wy, wz);

    // Surface normal alignment (slight tilt matching hillside)
    dummy.quaternion.setFromUnitVectors(upVector, normal);

    // Random rotation around local up axis
    const randYaw = lcg() * Math.PI * 2;
    dummy.rotateY(randYaw);

    // Scale: base height and subtle variance
    const hVar = lcg();
    const scaleFactor = 0.85 + lcg() * 0.35;
    dummy.scale.set(scaleFactor, scaleFactor, scaleFactor);
    dummy.updateMatrix();

    for (let m = 0; m < 16; m++) {
      matrices.push(dummy.matrix.elements[m]);
    }

    // Per-instance shape offsets: leanX, leanZ, widthScale, colorJitter
    const leanX = (lcg() - 0.5) * 0.15;
    const leanZ = (lcg() - 0.5) * 0.15;
    const widthScale = 0.8 + lcg() * 0.4;
    const colorJitter = lcg(); // used to mix primary & secondary colors and petal hues

    shapeOffsets.push(leanX, leanZ, widthScale, colorJitter);
    heightVariances.push(hVar);
    // Mixed meadows grow in drifts: each ~3 m patch favours one species.
    const patch = patchHash(Math.floor(wx / 3), Math.floor(wz / 3));
    const kind = species.length === 1 ? species[0]
      : species[Math.floor((lcg() < 0.7 ? patch : lcg()) * species.length) % species.length];
    kinds.push(FLOWER_KINDS.indexOf(kind));
  }

  const validCount = heightVariances.length;
  return {
    instanceCount: validCount,
    matrices: new Float32Array(matrices),
    shapeOffsets: new Float32Array(shapeOffsets),
    heightVariances: new Float32Array(heightVariances),
    kinds: new Uint8Array(kinds)
  };
}
