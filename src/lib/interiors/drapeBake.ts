import * as THREE from 'three';
import { BoxCollider, PlaneCollider, XpbdCloth, gridTopology, type ClothCollider } from '../cloth/xpbd';
import type { FurniturePartRange } from './furnitureParts';

/**
 * Drapes bedding (duvets and throws) over the furniture beneath it by running the shared cloth solver
 * offline: a flat sheet is dropped onto the settled mattress, pillows and frame until it comes to rest,
 * then the bedding's thick mesh is carried along on that surface. The result is deterministic, so saved
 * models always reopen with the same folds, and no solver runs when the model is viewed.
 */

const rowMajor = (rotation: [number, number, number]): number[] => {
  const m = new THREE.Matrix4().makeRotationZ(rotation[2])
    .multiply(new THREE.Matrix4().makeRotationY(rotation[1]))
    .multiply(new THREE.Matrix4().makeRotationX(rotation[0]));
  const e = m.elements;
  return [e[0]!, e[4]!, e[8]!, e[1]!, e[5]!, e[9]!, e[2]!, e[6]!, e[10]!];
};

/** A height raster of a settled sheet's top surface: later bedding (a throw) rests on it. */
class SurfaceCollider implements ClothCollider {
  private readonly heights: Float32Array;
  private readonly nx: number;
  private readonly nz: number;
  constructor(private readonly minX: number, private readonly minZ: number, maxX: number, maxZ: number, private readonly cell: number,
    grid: Float64Array, columns: number, rows: number, lift: number) {
    this.nx = Math.ceil((maxX - minX) / cell) + 1; this.nz = Math.ceil((maxZ - minZ) / cell) + 1;
    this.heights = new Float32Array(this.nx * this.nz).fill(-Infinity);
    const at = (c: number, r: number) => (r * (columns + 1) + c) * 3;
    const tri = (a: number, b: number, c: number) => {
      const ax = grid[a]!, ay = grid[a + 1]!, az = grid[a + 2]!, bx = grid[b]!, by = grid[b + 1]!, bz = grid[b + 2]!, cx = grid[c]!, cy = grid[c + 1]!, cz = grid[c + 2]!;
      const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell)), x1 = Math.min(this.nx - 1, Math.ceil((Math.max(ax, bx, cx) - minX) / cell));
      const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cell)), z1 = Math.min(this.nz - 1, Math.ceil((Math.max(az, bz, cz) - minZ) / cell));
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-12) return;
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const px = minX + ix * cell, pz = minZ + iz * cell;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det, l3 = 1 - l1 - l2;
        if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
        const y = l1 * ay + l2 * by + l3 * cy + lift;
        if (y > this.heights[iz * this.nx + ix]!) this.heights[iz * this.nx + ix] = y;
      }
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      tri(at(c, r), at(c, r + 1), at(c + 1, r)); tri(at(c + 1, r), at(c, r + 1), at(c + 1, r + 1));
    }
  }
  resolve(p: Float64Array, radius: number): boolean {
    const ix = Math.round((p[0]! - this.minX) / this.cell), iz = Math.round((p[2]! - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return false;
    const h = this.heights[iz * this.nx + ix]!;
    if (h === -Infinity || p[1]! >= h + radius) return false;
    p[1] = h + radius;
    return true;
  }
}

/** How far above its resting height a sheet starts, in metres. */
const DROP = 0.18;
/** Strength (1/s²) of the pull toward the laid-out position: firm along the bed, light across it so the sides can hang. */
const HOLD_ALONG = 14;
const HOLD_ACROSS = 1.5;

interface SettledSheet { part: FurniturePartRange; columns: number; rows: number; grid: Float64Array }

/** Drops a flat sheet matching `part` onto the colliders and returns its settled surface. */
function settleSheet(part: FurniturePartRange, colliders: ClothCollider[], k: number): SettledSheet | null {
  const [w, h, d] = part.size!, [cx, cy, cz] = part.centre!;
  const columns = Math.max(8, Math.min(30, Math.round(w / 0.08))), rows = Math.max(8, Math.min(30, Math.round(d / 0.08)));
  const positions: number[] = [];
  // Start a little above the bedding's resting height and let it fall, rather than starting inside what it lies on.
  const rest: number[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) { positions.push(cx + (c / columns - 0.5) * w, cy + DROP, cz + (r / rows - 0.5) * d); rest.push(cx + (c / columns - 0.5) * w, cy, cz + (r / rows - 0.5) * d); }
  const { triangles, extraEdges } = gridTopology(columns, rows);
  const duvet = part.role === 'duvet';
  const cloth = new XpbdCloth({
    positions, triangles, extraEdges, tethers: false,
    // Heavier, softer bedding for a duvet; a lighter, slightly stiffer throw. Strength makes it softer still.
    settings: { density: duvet ? 0.7 : 0.45, stretchCompliance: 1e-6, bendCompliance: (duvet ? 1.6e-3 : 1.2e-3) * (0.6 + k), damping: 2.5, friction: 0.5, thickness: Math.min(0.08, h / 2 + 0.004) },
  });
  let calm = 0;
  for (let frame = 0; frame < 360; frame++) {
    cloth.step(1 / 60, {
      substeps: 5, colliders,
      // A made bed is held in place by friction and tucking: a gentle pull toward where the bedding was laid
      // lets it drape and fold without sliding off the sloping pillows.
      extraAcceleration: (i, out) => { out[0]! += (rest[i * 3]! - cloth.positions[i * 3]!) * HOLD_ACROSS; out[2]! += (rest[i * 3 + 2]! - cloth.positions[i * 3 + 2]!) * HOLD_ALONG; },
    });
    if (frame > 60 && cloth.kineticEnergy() < 2e-4) { if (++calm > 8) break; } else calm = 0;
  }
  const grid = new Float64Array(cloth.positions.length);
  const blend = Math.min(1, k);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rest[i]! + (cloth.positions[i]! - rest[i]!) * blend;
    if (!Number.isFinite(grid[i]!)) return null;
  }
  return { part, columns, rows, grid };
}

/** Surface point and unit normal of a settled sheet at (u, t), each in -1..1, by bilinear interpolation. */
function sampleSheet(sheet: SettledSheet, u: number, t: number, point: THREE.Vector3, normal: THREE.Vector3): void {
  const { columns, rows, grid } = sheet;
  const fu = Math.min(columns - 1e-9, Math.max(0, ((u + 1) / 2) * columns)), ft = Math.min(rows - 1e-9, Math.max(0, ((t + 1) / 2) * rows));
  const c = Math.floor(fu), r = Math.floor(ft), a = fu - c, b = ft - r;
  const node = (cc: number, rr: number, out: THREE.Vector3) => out.set(grid[(rr * (columns + 1) + cc) * 3]!, grid[(rr * (columns + 1) + cc) * 3 + 1]!, grid[(rr * (columns + 1) + cc) * 3 + 2]!);
  const p00 = node(c, r, new THREE.Vector3()), p10 = node(c + 1, r, new THREE.Vector3()), p01 = node(c, r + 1, new THREE.Vector3()), p11 = node(c + 1, r + 1, new THREE.Vector3());
  point.copy(p00).multiplyScalar((1 - a) * (1 - b)).addScaledVector(p10, a * (1 - b)).addScaledVector(p01, (1 - a) * b).addScaledVector(p11, a * b);
  // Local normal from the cell's own tangents (z along rows, x along columns): up for a flat sheet.
  const tx = p10.clone().sub(p00).lerp(p11.clone().sub(p01), b), tz = p01.clone().sub(p00).lerp(p11.clone().sub(p10), a);
  normal.copy(tz).cross(tx);
  if (normal.lengthSq() < 1e-14) normal.set(0, 1, 0); else normal.normalize();
}

/**
 * Drapes every flagged sheet in `parts` over the rest of the piece, writing the new positions in place.
 * Returns the parts it handled; the caller shapes any others by the older formula. `strength` is the
 * Interior Studio relax strength (0 leaves the bedding exactly as built).
 */
export function drapeSheetParts(positions: number[], parts: FurniturePartRange[], strength: number): Set<FurniturePartRange> {
  const handled = new Set<FurniturePartRange>();
  const k = Math.min(2.5, Math.max(0, strength) / 0.4);
  const sheets = parts.filter(part => part.sheet && part.size && part.centre);
  if (!k || !sheets.length) return handled;

  // What the bedding rests on: hard parts as boxes, soft parts as oriented boxes, and the floor.
  const base: ClothCollider[] = [new PlaneCollider([0, 0, 0], [0, 1, 0])];
  for (const part of parts) {
    if (part.sheet || !part.count) continue;
    if (part.material === 0) {
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = part.start; i < part.start + part.count; i++) {
        const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      if (maxX - minX > 0.15 && maxY - minY > 0.05 && maxZ - minZ > 0.15) base.push(new BoxCollider([(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2], [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2]));
    } else if (part.size && part.centre && part.role && part.role !== 'throw' && part.role !== 'scatter') {
      const [w, h, d] = part.size;
      base.push(new BoxCollider(part.centre, [w / 2 * 0.97, h / 2 * 1.08, d / 2 * 0.97], rowMajor(part.rotation ?? [0, 0, 0])));
    }
  }

  const apply = (sheet: SettledSheet, members: FurniturePartRange[]) => {
    const [w, , d] = sheet.part.size!, [cx, cy, cz] = sheet.part.centre!;
    const point = new THREE.Vector3(), normal = new THREE.Vector3();
    const next = new Map<number, [number, number, number]>();
    for (const member of members) for (let i = member.start; i < member.start + member.count; i++) {
      const rx = positions[i * 3]! - cx, ry = positions[i * 3 + 1]! - cy, rz = positions[i * 3 + 2]! - cz;
      sampleSheet(sheet, Math.max(-1, Math.min(1, rx / (w / 2))), Math.max(-1, Math.min(1, rz / (d / 2))), point, normal);
      next.set(i, [point.x + normal.x * ry, point.y + normal.y * ry, point.z + normal.z * ry]);
    }
    // Only commit when every vertex came out finite.
    for (const value of next.values()) if (!value.every(Number.isFinite)) return false;
    for (const [i, value] of next) { positions[i * 3] = value[0]; positions[i * 3 + 1] = value[1]; positions[i * 3 + 2] = value[2]; }
    for (const member of members) handled.add(member);
    return true;
  };

  // The duvet (and the folded-back top edge, which rides on it) settles first.
  const duvets = sheets.filter(part => part.role === 'duvet');
  let duvetSheet: SettledSheet | null = null;
  if (duvets.length) {
    const main = duvets.reduce((best, part) => (part.count > best.count ? part : best));
    duvetSheet = settleSheet(main, base, k);
    if (duvetSheet && !apply(duvetSheet, duvets)) duvetSheet = null;
  }

  // Throws then lie across whatever the duvet now looks like.
  for (const throwPart of sheets.filter(part => part.role === 'throw')) {
    const colliders = [...base];
    if (duvetSheet) {
      const [w, h, d] = duvetSheet.part.size!, [cx, , cz] = duvetSheet.part.centre!;
      // The duvet's settled top surface, including its own half-thickness.
      colliders.push(new SurfaceCollider(cx - w / 2 - 0.3, cz - d / 2 - 0.3, cx + w / 2 + 0.3, cz + d / 2 + 0.3, 0.03, duvetSheet.grid, duvetSheet.columns, duvetSheet.rows, h / 2 * 0.9));
    }
    const settled = settleSheet(throwPart, colliders, k);
    if (settled) apply(settled, [throwPart]);
  }
  return handled;
}
