import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shape } from '../types';
import { buildRoofAssemblyForRoom } from './archRoofGenerator';
import { cutForDormers, dormerLayout, layoutsOf, pointInPolygon, type Dormer, type DormerType } from './dormers';
import { withRoofExtras } from './roofExtras';
import { generateTimberFrameForRoof } from './timberFrameGenerator';
import { edgeFrame, type RoofModel } from './roofSkeleton';

/**
 * Dormers on skeleton roofs of every kind: whatever the outline, roof type and dormer, the main
 * roof's rafters, noggins and purlins stop at each opening, trimmers and the dormer's own frame
 * are there, and the roof itself is opened up.
 */
type V2 = [number, number];
function wallsOf(poly: V2[], h = 2.8): Shape[] {
  return poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    return { id: `w${i}`, type: 'wall', name: 'Room Wall', position: [(p[0] + q[0]) / 2, h / 2, (p[1] + q[1]) / 2], rotation: [0, Math.atan2(-dz, dx), 0], args: [len + 0.25, h, 0.25], color: '#eee' } as Shape;
  });
}
const PLANS: Record<string, V2[]> = {
  box: [[0, 0], [11, 0], [11, 8], [0, 8]],
  L: [[0, 0], [12, 0], [12, 6], [6, 6], [6, 12], [0, 12]],
  T: [[0, 0], [14, 0], [14, 6], [10, 6], [10, 13], [4, 13], [4, 6], [0, 6]],
  U: [[0, 0], [14, 0], [14, 11], [9, 11], [9, 5], [5, 5], [5, 11], [0, 11]],
};

/** One dormer of each kind on each long enough slope (those that fit). */
function dormersFor(roof: Shape, type: DormerType, flush: boolean): Dormer[] {
  const m = roof.roofData.skeleton as RoofModel;
  const out: Dormer[] = [];
  m.faces.forEach((f, i) => {
    if (f.gable) return;
    const { a, u, inward, len } = edgeFrame(m.eave, f.edge);
    if (len < 4) return;
    const t = 1.3;
    // The usual size, or smaller where a narrow wing's slope is too short for it.
    for (const [width, height] of [[1.6, 1.2], [1.2, 1.0], [1.0, 0.9]]) {
      const d: Dormer = { id: `d${i}`, x: a[0] + u[0] * len / 2 + inward[0] * t, z: a[1] + u[1] * len / 2 + inward[1] * t, type, width, height, flush };
      if (dormerLayout(roof, d)) { out.push(d); break; }
    }
  });
  return out;
}

const trimmed = /timber-(common-rafter|hip-jack-rafter|valley-jack-rafter|roof-noggin|roof-purlin)/;

describe('dormers on skeleton roofs, timber and all', () => {
  for (const [plan, poly] of Object.entries(PLANS)) {
    for (const roofType of ['gable', 'hip'] as const) {
      for (const type of ['gable', 'flat', 'hipped'] as const) {
        for (const flush of [false, true]) {
          it(`${plan} ${roofType} roof with ${flush ? 'flush' : 'set-back'} ${type} dormers`, () => {
            const walls = wallsOf(poly);
            const a = buildRoofAssemblyForRoom(walls, { roofType, pitchAngleDeg: 42, usePitchAngle: true, eaveOverhang: 0.4, tileShape: 'none' } as any, walls)!;
            expect(a.roofShape.roofData.skeleton).toBeTruthy();
            const dormers = dormersFor(a.roofShape, type, flush);
            expect(dormers.length).toBeGreaterThan(0);
            const shapes = withRoofExtras([...walls, ...a.allShapes], a.roofShape.id, { dormerList: dormers });
            const roof = shapes.find(s => s.id === a.roofShape.id)!;
            const layouts = layoutsOf(roof);
            expect(layouts).toHaveLength(dormers.length);

            const frame = generateTimberFrameForRoof(roof, shapes);
            const tagged = (t: string) => frame.filter(s => s.tags?.includes(t));
            expect(tagged('timber-trimmer-rafter').length).toBe(4 * layouts.length);
            expect(tagged('timber-dormer-stud').length).toBeGreaterThanOrEqual(4 * layouts.length);
            expect(tagged(type === 'flat' ? 'timber-dormer-joist' : 'timber-dormer-rafter').length).toBeGreaterThan(0);

            // No main-roof rafter, noggin or purlin passes through an opening (sampled along each one).
            const origin = new THREE.Vector3(...roof.position);
            // More than 12 cm inside an outline: members bearing on its edge don't count (the timber
            // generator tucks each rafter under the roof surface, which shifts it a few cm in plan).
            const clear = (x: number, z: number, poly: V2[]) => Math.min(...poly.map((P, i) => {
              const Q = poly[(i + 1) % poly.length];
              const dx = Q[0] - P[0], dz = Q[1] - P[1];
              const t = Math.max(0, Math.min(1, ((x - P[0]) * dx + (z - P[1]) * dz) / (dx * dx + dz * dz || 1)));
              return Math.hypot(x - P[0] - dx * t, z - P[1] - dz * t);
            }));
            const inside = (x: number, z: number) => layouts.some(L => pointInPolygon([x, z], L.footprint) && clear(x, z, L.footprint) > 0.12);
            for (const m of frame.filter(s => trimmed.test((s.tags ?? []).join(' ')) && !s.tags?.some(t => /dormer|trimmer|header/.test(t)))) {
              const half = new THREE.Vector3(0, 0, (m.args as number[])[2] / 2).applyQuaternion(new THREE.Quaternion(...m.quaternion!));
              const c = new THREE.Vector3(...m.position).sub(origin);
              for (const k of [-0.95, -0.6, -0.3, 0, 0.3, 0.6, 0.95]) {
                const p = c.clone().addScaledVector(half, k);
                expect(inside(p.x, p.z), `${m.name} crosses an opening`).toBe(false);
              }
            }

            // The roof is opened over each dormer.
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(roof.geometryData.positions, 3));
            const cut = cutForDormers(mergeVertices(g), layouts, new THREE.Vector3(), 'solid', { Brush, Evaluator, SUBTRACTION });
            const mesh = new THREE.Mesh(cut, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
            for (const L of layouts) {
              const p = L.origin.clone().addScaledVector(L.Z, Math.min(0.5, L.depthCheek / 2));
              const hit = new THREE.Raycaster(new THREE.Vector3(p.x, 50, p.z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
              expect(hit.length, 'roof still covers a dormer').toBe(0);
            }
          });
        }
      }
    }
  }
});
