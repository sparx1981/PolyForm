import { describe, it, expect } from 'vitest';
import { KernelSession } from '../lib/geometry';
import { createGraph } from '../lib/geometry/topology';
import { createEdgeIndex, insertEdge, type InsertContext } from '../lib/geometry/insert';
import {
  collectKernelCandidates, collectLinearInferences, fromPointInference,
  toActiveContext, type KernelCandidate,
} from './inferenceCandidates';
import { vec3, normalize, distance } from '../lib/geometry/math';
import { DEFAULT_TOLERANCES as T } from '../lib/geometry/types';

const cam = vec3(0, 0, -1);

/** Orthographic top-down projection: world XY straight to screen. */
const project = (p: { x: number; y: number; z: number }) => ({ x: p.x * 100, y: p.y * 100 });
const at = (x: number, y: number) => ({ x: x * 100, y: y * 100 });

function square(n = 2) {
  const s = new KernelSession({ cameraDirection: cam });
  s.drawChain([vec3(0,0,0), vec3(n,0,0), vec3(n,n,0), vec3(0,n,0), vec3(0,0,0)]);
  return s;
}

const kinds = (c: KernelCandidate[]) => new Set(c.map(x => x.kind));

describe('kernel candidates', () => {
  it('offers an endpoint at a corner', () => {
    const s = square();
    const c = collectKernelCandidates(s.graph, {
      project, cursor: at(0, 0), snapRadiusPx: 12,
    });
    expect(kinds(c)).toContain('ENDPOINT');
    const ep = c.find(x => x.kind === 'ENDPOINT')!;
    expect(distance(ep.point, vec3(0,0,0))).toBeCloseTo(0, 9);
  });

  it('offers a midpoint halfway along an edge', () => {
    const s = square(2);
    const c = collectKernelCandidates(s.graph, {
      project, cursor: at(1, 0), snapRadiusPx: 12,
    });
    const mid = c.find(x => x.kind === 'MIDPOINT');
    expect(mid).toBeDefined();
    expect(distance(mid!.point, vec3(1,0,0))).toBeCloseTo(0, 9);
  });

  it('carries the edge direction for parallel and extension locks', () => {
    const s = square(2);
    const c = collectKernelCandidates(s.graph, {
      project, cursor: at(1, 0), snapRadiusPx: 12,
    });
    const mid = c.find(x => x.kind === 'MIDPOINT')!;
    expect(mid.edgeVector).toBeDefined();
    expect(Math.abs(mid.edgeVector!.x)).toBeCloseTo(1, 9);
  });

  it('offers a face centroid and its normal', () => {
    const s = square(2);
    const c = collectKernelCandidates(s.graph, {
      project, cursor: at(1, 1), snapRadiusPx: 12,
    });
    const fc = c.find(x => x.kind === 'FACE_CENTROID');
    expect(fc).toBeDefined();
    expect(fc!.planeNormal).toBeDefined();
  });

  it('excludes candidates outside the snap radius', () => {
    const s = square(2);
    const c = collectKernelCandidates(s.graph, {
      project, cursor: at(50, 50), snapRadiusPx: 12,
    });
    expect(c).toHaveLength(0);
  });

  it('respects a larger radius for touch', () => {
    const s = square(2);
    const near = collectKernelCandidates(s.graph, { project, cursor: at(0.1, 0), snapRadiusPx: 12 });
    const touch = collectKernelCandidates(s.graph, { project, cursor: at(0.1, 0), snapRadiusPx: 24 });
    expect(touch.length).toBeGreaterThanOrEqual(near.length);
  });

  it('offers On Edge along the cursor ray', () => {
    const s = square(2);
    const c = collectKernelCandidates(s.graph, {
      project, cursor: at(0.7, 0), snapRadiusPx: 12,
      ray: { origin: vec3(0.7, 0, 5), direction: vec3(0, 0, -1) },
    });
    expect(kinds(c)).toContain('ON_EDGE');
  });

  it('offers On Face where the ray meets the plane', () => {
    const s = square(2);
    const c = collectKernelCandidates(s.graph, {
      project, cursor: at(1, 1), snapRadiusPx: 12,
      ray: { origin: vec3(1, 1, 5), direction: vec3(0, 0, -1) },
    });
    const onFace = c.find(x => x.kind === 'ON_FACE');
    expect(onFace).toBeDefined();
    expect(onFace!.point.z).toBeCloseTo(0, 9);
  });

  it('offers a curve centre', () => {
    const graph = createGraph();
    const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
    // Fabricate a curve record directly; construction is Phase 14's concern.
    graph.curves.set(1 as never, {
      id: 1 as never, kind: 'arc', edges: [], centre: vec3(1, 1, 0),
      normal: vec3(0, 0, 1), radius: 1, startAngle: 0, sweep: Math.PI,
      segments: 12, startTruncated: false, endTruncated: false,
    });
    void ctx;
    const c = collectKernelCandidates(graph, { project, cursor: at(1, 1), snapRadiusPx: 12 });
    expect(kinds(c)).toContain('CURVE_CENTER');
  });

  it('does not offer an intersection where R2 already made a vertex', () => {
    // Within one graph, crossing edges are split into a shared vertex, so the
    // crossing IS an endpoint. An INTERSECTION candidate there would be a
    // duplicate competing with a higher-priority one.
    const graph = createGraph();
    const ctx: InsertContext = { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
    insertEdge(ctx, vec3(-1, 0, 0), vec3(1, 0, 0));
    insertEdge(ctx, vec3(0, -1, 0), vec3(0, 1, 0));

    const c = collectKernelCandidates(graph, { project, cursor: at(0, 0), snapRadiusPx: 12 });
    expect(kinds(c)).toContain('ENDPOINT');
    expect(kinds(c)).not.toContain('INTERSECTION');
  });

  it('is deterministically ordered', () => {
    const s = square(2);
    const opts = { project, cursor: at(0, 0), snapRadiusPx: 30 };
    const a = collectKernelCandidates(s.graph, opts).map(x => x.sourceEntityId);
    const b = collectKernelCandidates(s.graph, opts).map(x => x.sourceEntityId);
    expect(a).toEqual(b);
  });
});

describe('linear inferences (§4.2)', () => {
  it('offers an axis when pointing along one', () => {
    const s = square(2);
    const r = collectLinearInferences(s.graph, vec3(0,0,0), vec3(5, 0.01, 0));
    const axis = r.find(x => x.kind === 'axis');
    expect(axis).toBeDefined();
    expect(axis!.tooltip).toBe('On Red Axis');
  });

  it('does not offer an axis when pointing well off it', () => {
    const s = square(2);
    const r = collectLinearInferences(s.graph, vec3(0,0,0), vec3(5, 5, 0));
    expect(r.filter(x => x.kind === 'axis' && x.tooltip === 'On Red Axis')).toHaveLength(0);
  });

  it('offers parallel to a hovered edge', () => {
    const s = square(2);
    const edgeId = [...s.graph.edges.keys()][0]!;
    const r = collectLinearInferences(s.graph, vec3(0, 5, 0), vec3(5, 5.01, 0), { hoveredEdge: edgeId });
    expect(r.some(x => x.kind === 'parallel')).toBe(true);
  });

  it('chooses the perpendicular closest to where the user is pointing', () => {
    // Any direction perpendicular to the edge is valid; picking an arbitrary
    // axis would put the cue somewhere unrelated to the cursor.
    const s = square(2);
    const edgeId = [...s.graph.edges.keys()][0]!;   // along +x
    const r = collectLinearInferences(s.graph, vec3(0,0,0), vec3(0.01, 5, 0), { hoveredEdge: edgeId });
    const perp = r.find(x => x.kind === 'perpendicular');
    expect(perp).toBeDefined();
    expect(Math.abs(perp!.direction.y)).toBeCloseTo(1, 3);
  });

  it('offers an edge extension beyond an endpoint', () => {
    const s = square(2);
    const r = collectLinearInferences(s.graph, vec3(2, 0, 0), vec3(5, 0.01, 0));
    expect(r.some(x => x.kind === 'extension')).toBe(true);
  });

  it('projects the cursor onto the constraint line', () => {
    const s = square(2);
    const r = collectLinearInferences(s.graph, vec3(0,0,0), vec3(5, 0.01, 0));
    const axis = r.find(x => x.tooltip === 'On Red Axis')!;
    expect(axis.point.y).toBeCloseTo(0, 9);
    expect(axis.point.x).toBeCloseTo(5, 9);
  });

  it('ranks by deviation', () => {
    const s = square(2);
    const r = collectLinearInferences(s.graph, vec3(0,0,0), vec3(5, 0.01, 0));
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.deviation).toBeGreaterThanOrEqual(r[i-1]!.deviation);
    }
  });
});

describe('from-point inference', () => {
  it('fires within tolerance and projects onto the line', () => {
    const r = fromPointInference(vec3(0,0,0), vec3(1,0,0), vec3(5, 0.001, 0), 0.01)!;
    expect(r).not.toBeNull();
    expect(r.point.y).toBeCloseTo(0, 9);
  });

  it('does not fire beyond tolerance', () => {
    expect(fromPointInference(vec3(0,0,0), vec3(1,0,0), vec3(5, 1, 0), 0.01)).toBeNull();
  });
});

describe('cross-context conversion (§2.5.2)', () => {
  it('converts a candidate into the active local frame', () => {
    // Hit-testing runs across contexts; insertion targets only the active one.
    const candidate: KernelCandidate = {
      kind: 'ENDPOINT', point: vec3(1, 0, 0), screenDistance: 0,
      sourceEntityId: 'v1', tooltip: 'Endpoint',
      edgeVector: vec3(1, 0, 0), planeNormal: vec3(0, 0, 1),
    };
    const converted = toActiveContext(candidate, {
      toWorld: (p) => ({ x: p.x + 10, y: p.y, z: p.z }),   // source container offset
      toActiveLocal: (p) => ({ x: p.x - 4, y: p.y, z: p.z }), // active container offset
      normalToActiveLocal: (n) => normalize(n),
    });
    // 1 -> world 11 -> active local 7
    expect(converted.point.x).toBeCloseTo(7, 9);
    expect(converted.kind).toBe('ENDPOINT');
  });

  it('routes normals through the inverse-transpose hook, not the point hook', () => {
    let normalCalls = 0;
    toActiveContext(
      {
        kind: 'ON_FACE', point: vec3(0,0,0), screenDistance: 0,
        sourceEntityId: 'f1', tooltip: 'On Face', planeNormal: vec3(0, 0, 1),
      },
      {
        toWorld: (p) => p,
        toActiveLocal: (p) => p,
        normalToActiveLocal: (n) => { normalCalls++; return n; },
      },
    );
    expect(normalCalls).toBe(1);
  });
});
