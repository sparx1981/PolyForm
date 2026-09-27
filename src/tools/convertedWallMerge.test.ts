import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createFaceOffsetBinding } from './kernelFaceOffset';
import { analyzeWallConversion, buildWallShapes, type WallConversionPlan } from './kernelConvertToWall';
import { planCurvedMerge, isCurvedPiece, type MergeResult, type MergeRejection } from './convertedWallMerge';
import { groupContaining } from './kernelSelection';
import { vec3 } from '../lib/geometry/math';
import type { Shape } from '../types';

let n = 0;
const makeId = () => `m${n++}`;

/** A converted round wall: radius r, `segments` pieces, 0.3 m thick, 2.6 m high. */
const roundWalls = (r: number, segments: number): Shape[] => {
  const h = new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });
  const pts = Array.from({ length: segments }, (_, i) =>
    vec3(r * Math.cos((2 * Math.PI * i) / segments), 0, r * Math.sin((2 * Math.PI * i) / segments)));
  for (let i = 0; i < segments; i++) h.commitSegment(pts[i]!, pts[(i + 1) % segments]!);
  const face = [...h.graph.faces.keys()][0]!;
  const b = createFaceOffsetBinding(h, () => {});
  b.begin(face);
  const m = vec3((pts[0]!.x + pts[1]!.x) / 2, 0, (pts[0]!.z + pts[1]!.z) / 2);
  const l = Math.hypot(m.x, m.z);
  b.update(b.projectToSessionPlane(vec3(m.x - (m.x / l) * 0.3, 0, m.z - (m.z / l) * 0.3))!);
  b.commit();
  const ring = [...h.graph.faces.entries()].find(([, f]) => f.innerLoops.length === 1)![0];
  const plan = analyzeWallConversion(h.graph, ring, groupContaining(h.graph, ring)) as WallConversionPlan;
  expect(plan.ok).toBe(true);
  return buildWallShapes(plan, { height: 2.6, color: '#fff', story: 1, makeId, existingWallCount: 0 });
};

/** World X/Z of a wall's footprint corners. */
const corners = (w: Shape) => {
  const theta = 2 * Math.atan2(w.quaternion![1], w.quaternion![3]);
  const ax = { x: Math.cos(theta), z: -Math.sin(theta) };
  const az = { x: Math.sin(theta), z: Math.cos(theta) };
  return w.wallMiterFootprint!.map(([lx, lz]) => ({
    x: w.position[0] + lx * ax.x + lz * az.x,
    z: w.position[2] + lx * ax.z + lz * az.z,
  }));
};

describe('merging curved pieces', () => {
  it('merges just enough neighbours for a door, centred on the clicked piece', () => {
    const walls = roundWalls(4, 32); // pieces about 0.75 m wide
    expect(walls.every(isCurvedPiece)).toBe(true);
    const r = planCurvedMerge(walls, walls[5]!.id, 1.1, makeId) as MergeResult;
    expect(r.ok).toBe(true);
    expect(r.removeIds).toHaveLength(2);
    expect(r.removeIds).toContain(walls[5]!.id);
    expect(r.width).toBeGreaterThanOrEqual(1.1);
    expect((r.merged.args as number[])[0]).toBeCloseTo(r.width, 6);
    // Nearly the full 300 mm: the chords of two pieces are ~1% closer.
    expect((r.merged.args as number[])[2]).toBeGreaterThan(0.29);
    expect(isCurvedPiece(r.merged)).toBe(false);
  });

  it('the merged wall still meets the pieces either side exactly', () => {
    const walls = roundWalls(4, 32);
    const r = planCurvedMerge(walls, walls[5]!.id, 1.1, makeId) as MergeResult;
    const rest = walls.filter(w => !r.removeIds.includes(w.id));
    const mergedCorners = corners(r.merged);
    const touching = rest.filter(w => corners(w).some(c =>
      mergedCorners.some(m => Math.hypot(c.x - m.x, c.z - m.z) < 1e-6)));
    expect(touching).toHaveLength(2);
    // Each neighbour shares two corners (outer and inner) with the merged wall.
    for (const w of touching) {
      const shared = corners(w).filter(c => mergedCorners.some(m => Math.hypot(c.x - m.x, c.z - m.z) < 1e-6));
      expect(shared).toHaveLength(2);
    }
  });

  it('moves a window on a merged piece onto the new flat wall', () => {
    const walls = roundWalls(4, 32);
    const host = walls[5]!;
    const win: Shape = {
      id: 'win', type: 'window', position: [host.position[0], 1.5, host.position[2]],
      quaternion: host.quaternion!, args: [0.6, 1.0, 0.12], color: '#fff', hostWallId: host.id,
    };
    const r = planCurvedMerge([...walls, win], host.id, 1.1, makeId) as MergeResult;
    expect(r.rehosted).toHaveLength(1);
    expect(r.rehosted[0]!.hostWallId).toBe(r.merged.id);
    expect(r.rehosted[0]!.quaternion).toEqual(r.merged.quaternion);
  });

  it('refuses when the curve is too small for the opening', () => {
    const walls = roundWalls(0.4, 24);
    const r = planCurvedMerge(walls, walls[0]!.id, 1.1, makeId) as MergeRejection;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too small|Not enough/);
  });

  it('refuses when the piece is already wide enough', () => {
    const walls = roundWalls(8, 24); // pieces about 2 m wide
    const r = planCurvedMerge(walls, walls[0]!.id, 1.1, makeId) as MergeRejection;
    expect(r.ok).toBe(false);
  });
});
