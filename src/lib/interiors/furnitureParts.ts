import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothPatchNormals } from './upholsteryNormals';
import type { ComponentDefinition } from '../semantics/componentTypes';

export interface FurnitureParams {
  width?: number;
  height?: number;
  depth?: number;
  seatHeight?: number;
  mattressHeight?: number;
  headboardHeight?: number;
  doorCount?: number;
  openAmount?: number;
  fullness?: number;
  foldDepth?: number;
  /** 0 leaves sofas and beds bare; anything above adds scatter cushions, throws and pillows (default 1). */
  dressing?: number;
}

/** Every size parameter filled in; `dressing` stays optional so older saved pieces still match. */
export type FurnitureSize = Required<Omit<FurnitureParams, 'dressing'>> & { dressing?: number };

export type FurnitureProfile = {
  definition: ComponentDefinition<Record<string, unknown>>;
  defaults: FurnitureSize;
  color: string;
  /** Glossy ceramics read differently from timber; defaults are roughness 0.82, metalness 0.02. */
  surface?: { roughness: number; metalness?: number };
};

/** Neutral defaults for the parameters a piece does not use. */
export const BASE_PARAMS: FurnitureSize = {
  width: 1, height: 1, depth: 1, seatHeight: 0, mattressHeight: 0, headboardHeight: 0,
  doorCount: 0, openAmount: 0, fullness: 1, foldDepth: 0,
};

/** What a soft part is, so settling can shape a seat differently from a duvet or a pillow. */
export type SoftRole = 'seat' | 'back' | 'arm' | 'base' | 'mattress' | 'duvet' | 'pillow' | 'scatter' | 'throw' | 'headboard';

/** One part of a merged piece, recorded so a later settle can find its own vertices and frame. */
export interface FurniturePartRange {
  start: number; count: number;
  role?: SoftRole;
  /** 0 hard frame, 1 main fabric, 2 accent fabric (cushions, throws). */
  material: 0 | 1 | 2;
  /** Centre, nominal size and rotation of the part before it was moved into place. */
  centre?: [number, number, number];
  size?: [number, number, number];
  rotation?: [number, number, number];
  /** Duvets and throws hang over the side beyond this fraction of their half-width. */
  edge?: number;
  /** A flat sheet of cloth (duvet, throw) that settling drapes by simulation rather than by formula. */
  sheet?: boolean;
}

export interface PaddedOptions {
  role?: SoftRole;
  /** Target size of a surface cell in metres: smaller lets a settle shape the surface more smoothly. */
  cell?: number;
  /** Rotation about the part's own centre (radians, applied X then Y then Z). */
  rotation?: [number, number, number];
  /** Accent fabric rather than the main upholstery colour. */
  accent?: boolean;
  edge?: number;
  /** Corner radius; pillows and cushions use a large one so they read as stuffed, not boxed. */
  radius?: number;
  /** Flat bedding that settling should drape over what is beneath it. */
  sheet?: boolean;
  /** Finer cells where |x| exceeds this fraction of the half-width (where bedding hangs over the sides). */
  fineBeyond?: number;
}

/** Cell size by role: parts that deform need a finer surface than ones that stay rigid. */
const CELL: Partial<Record<SoftRole, number>> = { seat: 0.075, back: 0.075, mattress: 0.1, duvet: 0.1, pillow: 0.06, scatter: 0.06, throw: 0.09 };

/**
 * Grid lines along one axis, as fractions 0..1: two cells inside each rounded edge so corners come out
 * round, then evenly sized cells across the middle, and optionally finer cells in outer bands.
 */
function axisBreaks(length: number, cell: number, radius: number, fineBeyond?: number): number[] {
  const rim = Math.min(radius * 1.3, length / 4) / length;
  const marks = new Set<number>([0, rim / 2, rim, 1 - rim, 1 - rim / 2, 1]);
  const run = (from: number, to: number, size: number) => {
    const n = Math.max(1, Math.round(((to - from) * length) / size));
    for (let i = 1; i < n; i++) marks.add(from + ((to - from) * i) / n);
  };
  // fineBeyond is the |u| fraction of the half-width beyond which cells are finer (bedding that hangs over).
  const lo = fineBeyond === undefined ? 0 : (1 - fineBeyond) / 2, hi = 1 - lo;
  if (fineBeyond !== undefined && lo > rim) {
    const fineCell = cell * 0.5;
    run(rim, lo, fineCell); run(lo, hi, cell); run(hi, 1 - rim, fineCell);
    marks.add(lo); marks.add(hi);
  } else run(rim, 1 - rim, cell);
  return [...marks].sort((a, b) => a - b);
}

/**
 * A box with rounded edges whose grid is only as fine as it needs to be. A uniform rounded box
 * subdivides every face equally, which made upholstery meshes tens of megabytes once saved.
 */
function softBlock(width: number, height: number, depth: number, cell: number, radius: number, fineBeyond?: number): THREE.BufferGeometry {
  const bx = axisBreaks(width, cell, radius, fineBeyond), by = axisBreaks(height, Math.max(cell, height / 3), radius), bz = axisBreaks(depth, cell, radius);
  const g = new THREE.BoxGeometry(width, height, depth, bx.length - 1, by.length - 1, bz.length - 1);
  const position = g.getAttribute('position');
  const snap = (value: number, length: number, breaks: number[]) => {
    const n = breaks.length - 1;
    const index = Math.max(0, Math.min(n, Math.round((value / length + 0.5) * n)));
    return (breaks[index]! - 0.5) * length;
  };
  const inner = [Math.max(0, width / 2 - radius), Math.max(0, height / 2 - radius), Math.max(0, depth / 2 - radius)];
  for (let i = 0; i < position.count; i++) {
    const px = snap(position.getX(i), width, bx), py = snap(position.getY(i), height, by), pz = snap(position.getZ(i), depth, bz);
    const cx = Math.max(-inner[0]!, Math.min(inner[0]!, px)), cy = Math.max(-inner[1]!, Math.min(inner[1]!, py)), cz = Math.max(-inner[2]!, Math.min(inner[2]!, pz));
    const dx = px - cx, dy = py - cy, dz = pz - cz, len = Math.hypot(dx, dy, dz);
    if (len > 1e-9) position.setXYZ(i, cx + (dx / len) * radius, cy + (dy / len) * radius, cz + (dz / len) * radius);
    else position.setXYZ(i, px, py, pz);
  }
  return g;
}

export function padded(width: number, height: number, depth: number, x: number, y: number, z: number, options: PaddedOptions = {}): THREE.BufferGeometry {
  const radius = options.radius ?? Math.min(0.065, height / 4, depth / 4);
  const cell = options.cell ?? (options.role ? CELL[options.role] : undefined) ?? 0.14;
  // Un-index first: the smoothing below reads positions as a plain triangle list.
  const indexed = softBlock(width, height, depth, cell, radius, options.fineBeyond);
  const g = indexed.toNonIndexed();
  indexed.dispose();
  const position = g.getAttribute('position');
  for (let i=0;i<position.count;i++) {
    const px=position.getX(i), py=position.getY(i), pz=position.getZ(i);
    const envelope=Math.max(0,1-(2*px/width)**2)*Math.max(0,1-(2*pz/depth)**2);
    // Rigid padded panels (bases, arms, headboards) get only a slight crown, not cushion wrinkles.
    const rigid = options.role === 'headboard' || options.role === 'base' || options.role === 'arm';
    const loft=height*(rigid ? 0.03 : 0.12)*envelope;
    const wrinkle=rigid ? 0 : Math.sin(px*28 + pz*11)*height*0.018*envelope;
    position.setY(i, py + Math.sign(py)*(loft+wrinkle));
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(smoothPatchNormals(position.array), 3));
  const rotation = options.rotation ?? [0, 0, 0];
  if (rotation[0]) g.rotateX(rotation[0]);
  if (rotation[1]) g.rotateY(rotation[1]);
  if (rotation[2]) g.rotateZ(rotation[2]);
  g.translate(x, y, z);
  g.userData.fabric = true;
  g.userData.material = options.accent ? 2 : 1;
  g.userData.part = { role: options.role, centre: [x, y, z], size: [width, height, depth], rotation, edge: options.edge, ...(options.sheet ? { sheet: true } : {}) };
  return g;
}

export function box(width: number, height: number, depth: number, x: number, y: number, z: number, yaw = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(0.01, width), Math.max(0.01, height), Math.max(0.01, depth));
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

/** Hard-edged piece with softly rounded corners (ceramics, seats, table tops). */
export function rbox(width: number, height: number, depth: number, x: number, y: number, z: number, radius = 0.025): THREE.BufferGeometry {
  const w = Math.max(0.01, width), h = Math.max(0.01, height), d = Math.max(0.01, depth);
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2.2, h / 2.2, d / 2.2));
  g.translate(x, y, z);
  return g;
}

/** Upright cylinder; scaleZ stretches it into an oval for bowls and seats. */
export function cyl(radius: number, height: number, x: number, y: number, z: number, scaleZ = 1, radiusBottom = radius): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radiusBottom, Math.max(0.005, height), 24);
  if (scaleZ !== 1) g.scale(1, 1, scaleZ);
  g.translate(x, y, z);
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map(part => part.index ? part.toNonIndexed() : part);
  const result = mergeGeometries(flat, false);
  const ranges: FurniturePartRange[] = [];
  if (result) {
    let start=0;
    for (let i=0;i<flat.length;i++) {
      const count=flat[i].getAttribute('position').count;
      const material = (parts[i].userData.material ?? (parts[i].userData.fabric ? 1 : 0)) as 0 | 1 | 2;
      result.addGroup(start,count,material);
      ranges.push({ start, count, material, ...(parts[i].userData.part ?? {}) });
      start+=count;
    }
    result.userData.parts = ranges;
  }
  for (const part of flat) if (!parts.includes(part)) part.dispose();
  for (const part of parts) part.dispose();
  if (!result) throw new Error('Could not merge furniture geometry');
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

/**
 * A thin sheet of cloth lying along a profile (x, y pairs) and running from z0 to z1, such as a
 * throw laid over a seat and an arm. It has real thickness and a gentle ripple so it reads as fabric.
 */
export function sheetAlongProfile(profile: Array<[number, number]>, z0: number, z1: number, thickness = 0.014, ripple = 0.012, accent = true): THREE.BufferGeometry {
  const rows = 14, n = profile.length;
  const top: THREE.Vector3[][] = [], bottom: THREE.Vector3[][] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, z = z0 + (z1 - z0) * t;
    const rowTop: THREE.Vector3[] = [], rowBottom: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = profile[i]!;
      const prev = profile[Math.max(0, i - 1)]!, next = profile[Math.min(n - 1, i + 1)]!;
      // Normal of the profile at this point, pointing up/outward.
      let nx = -(next[1] - prev[1]), ny = next[0] - prev[0];
      const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
      if (ny < 0 && Math.abs(nx) < 0.2) { nx = -nx; ny = -ny; }
      const wave = Math.sin(t * Math.PI * 3 + i * 0.9) * ripple * (i / (n - 1) + 0.25);
      rowTop.push(new THREE.Vector3(x + nx * wave, y + ny * wave + thickness / 2, z));
      rowBottom.push(new THREE.Vector3(x + nx * wave - nx * thickness, y + ny * wave - ny * thickness + thickness / 2 - thickness, z));
    }
    top.push(rowTop); bottom.push(rowBottom);
  }
  const positions: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let j = 0; j < rows; j++) for (let i = 0; i < n - 1; i++) {
    tri(top[j]![i]!, top[j + 1]![i]!, top[j]![i + 1]!); tri(top[j]![i + 1]!, top[j + 1]![i]!, top[j + 1]![i + 1]!);
    tri(bottom[j]![i]!, bottom[j]![i + 1]!, bottom[j + 1]![i]!); tri(bottom[j]![i + 1]!, bottom[j + 1]![i + 1]!, bottom[j + 1]![i]!);
  }
  for (let j = 0; j < rows; j++) for (const i of [0, n - 1]) {
    const flip = i === 0;
    const a = top[j]![i]!, b = top[j + 1]![i]!, c = bottom[j]![i]!, d = bottom[j + 1]![i]!;
    if (flip) { tri(a, c, b); tri(b, c, d); } else { tri(a, b, c); tri(b, d, c); }
  }
  for (const j of [0, rows]) for (let i = 0; i < n - 1; i++) {
    const a = top[j]![i]!, b = top[j]![i + 1]!, c = bottom[j]![i]!, d = bottom[j]![i + 1]!;
    if (j === 0) { tri(a, c, b); tri(b, c, d); } else { tri(a, b, c); tri(b, d, c); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(smoothPatchNormals(positions), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
  g.userData.fabric = true;
  g.userData.material = accent ? 2 : 1;
  g.userData.part = { role: 'throw' as SoftRole, centre: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0] };
  return g;
}
