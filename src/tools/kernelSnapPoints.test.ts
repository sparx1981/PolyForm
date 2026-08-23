import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { collectKernelSnapPoints, closestPointsOnKernelEdges } from './kernelSnapPoints';
import { vec3, distance } from '../lib/geometry/math';

const host = () => new KernelArcHost({ cameraDirection: vec3(0,0,-1), upAxis: vec3(0,1,0) });

/** Ground square in a Y-up world. */
const square = (h: KernelArcHost, n = 4) => {
  const p = [vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n)];
  for (let i = 0; i < 4; i++) h.commitSegment(p[i]!, p[(i+1)%4]!);
};

const has = (pts: ReturnType<typeof collectKernelSnapPoints>, p: {x:number;y:number;z:number}) =>
  pts.some(s => distance(s.point, p) < 1e-9);

describe('kernel snap points', () => {
  it('offers every corner as an endpoint — this is what closes a loop', () => {
    const h = host(); square(h);
    const pts = collectKernelSnapPoints(h.graph);
    for (const c of [vec3(0,0,0), vec3(4,0,0), vec3(4,0,4), vec3(0,0,4)]) {
      expect(has(pts.filter(p => p.kind === 'endpoint'), c)).toBe(true);
    }
  });

  it('offers edge midpoints', () => {
    const h = host(); square(h);
    const mids = collectKernelSnapPoints(h.graph).filter(p => p.kind === 'midpoint');
    expect(mids).toHaveLength(4);
    expect(has(mids, vec3(2,0,0))).toBe(true);
  });

  it('offers a face centre once a surface exists', () => {
    const h = host(); square(h);
    const centres = collectKernelSnapPoints(h.graph).filter(p => p.kind === 'center');
    expect(centres).toHaveLength(1);
    expect(has(centres, vec3(2,0,2))).toBe(true);
  });

  it('can be narrowed to endpoints only', () => {
    const h = host(); square(h);
    const pts = collectKernelSnapPoints(h.graph, { midpoints: false, faceCentres: false });
    expect(pts.every(p => p.kind === 'endpoint')).toBe(true);
    expect(pts).toHaveLength(4);
  });

  it('is deterministically ordered', () => {
    const h = host(); square(h);
    const a = collectKernelSnapPoints(h.graph).map(p => p.id);
    const b = collectKernelSnapPoints(h.graph).map(p => p.id);
    expect(a).toEqual(b);
  });

  it('respects the per-kind cap', () => {
    const h = host();
    for (let i = 0; i < 30; i++) h.commitSegment(vec3(i,0,0), vec3(i,0,1));
    const pts = collectKernelSnapPoints(h.graph, { maxPerKind: 5 });
    expect(pts.filter(p => p.kind === 'endpoint')).toHaveLength(5);
  });

  it('returns nothing for an empty model', () => {
    expect(collectKernelSnapPoints(host().graph)).toHaveLength(0);
  });

  it('picks up new geometry immediately', () => {
    const h = host();
    expect(collectKernelSnapPoints(h.graph)).toHaveLength(0);
    h.commitSegment(vec3(0,0,0), vec3(4,0,0));
    expect(collectKernelSnapPoints(h.graph).length).toBeGreaterThan(0);
  });
});

describe('on-edge snapping', () => {
  it('finds the nearest point along an edge', () => {
    const h = host();
    h.commitSegment(vec3(0,0,0), vec3(4,0,0));
    const near = closestPointsOnKernelEdges(h.graph, vec3(1.5, 0, 0.05), 0.5);
    expect(near).toHaveLength(1);
    expect(near[0]!.point.x).toBeCloseTo(1.5, 9);
    expect(near[0]!.point.z).toBeCloseTo(0, 9);
  });

  it('clamps to the segment rather than running off its end', () => {
    const h = host();
    h.commitSegment(vec3(0,0,0), vec3(4,0,0));
    const near = closestPointsOnKernelEdges(h.graph, vec3(99, 0, 0), 200);
    expect(near[0]!.point.x).toBeCloseTo(4, 9);
  });

  it('excludes edges beyond the distance limit', () => {
    const h = host();
    h.commitSegment(vec3(0,0,0), vec3(4,0,0));
    expect(closestPointsOnKernelEdges(h.graph, vec3(2, 50, 0), 1)).toHaveLength(0);
  });
});
