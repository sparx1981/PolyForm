import { describe, it, expect } from 'vitest';
import { createGraph, checkIntegrity, getVertex } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import {
  arcFromChordBulge, arcFromThreePoints, arcFromCentreStartSweep,
  arcPoints, arcPointAt, sagitta, shouldDemote, createArc, curveVertices,
  splitCurve, resolveSegments, DEFAULT_SEGMENTS,
} from './curve';
import { derive } from './derive';
import { vec3, distance, normalize } from './math';
import { DEFAULT_TOLERANCES as T } from './types';
import type { EdgeId } from './types';

const ctx = (): InsertContext => {
  const graph = createGraph();
  return { graph, tolerances: T, index: createEdgeIndex(graph, 1) };
};
const OPTS = { tolerances: T, cameraDirection: vec3(0, 0, -1) };

describe('arc construction', () => {
  it('chord and bulge produce an arc through the apex', () => {
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 1, vec3(0,1,0))!;
    expect(spec).not.toBeNull();
    // bulge == half chord => semicircle of radius 1
    expect(spec.radius).toBeCloseTo(1, 9);
    expect(Math.abs(spec.sweep)).toBeCloseTo(Math.PI, 6);
    const apex = arcPointAt(spec, 0.5);
    expect(apex.y).toBeCloseTo(1, 6);
  });

  it('a shallow bulge gives a large radius', () => {
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.1, vec3(0,1,0))!;
    expect(spec.radius).toBeCloseTo((0.01 + 1) / 0.2, 6);
  });

  it('endpoints lie on the arc', () => {
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(3,1,0), 0.6, vec3(0,0,1))!;
    expect(distance(arcPointAt(spec, 0), vec3(0,0,0))).toBeCloseTo(0, 6);
    expect(distance(arcPointAt(spec, 1), vec3(3,1,0))).toBeCloseTo(0, 6);
  });

  it('three points give an arc through all three', () => {
    const spec = arcFromThreePoints(vec3(1,0,0), vec3(0,1,0), vec3(-1,0,0))!;
    expect(spec.radius).toBeCloseTo(1, 9);
    expect(distance(arcPointAt(spec, 0), vec3(1,0,0))).toBeCloseTo(0, 6);
    expect(distance(arcPointAt(spec, 1), vec3(-1,0,0))).toBeCloseTo(0, 6);
    const mid = arcPointAt(spec, 0.5);
    expect(distance(mid, vec3(0,1,0))).toBeCloseTo(0, 6);
  });

  it('rejects three colinear points', () => {
    expect(arcFromThreePoints(vec3(0,0,0), vec3(1,0,0), vec3(2,0,0))).toBeNull();
  });

  it('centre-start-sweep sets the radius from the start point', () => {
    const spec = arcFromCentreStartSweep(vec3(0,0,0), vec3(2,0,0), Math.PI/2, vec3(0,0,1))!;
    expect(spec.radius).toBeCloseTo(2, 9);
    expect(distance(arcPointAt(spec, 1), vec3(0,2,0))).toBeCloseTo(0, 6);
  });

  it('rejects a zero-length bulge', () => {
    expect(arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0, vec3(0,1,0))).toBeNull();
  });
});

describe('endpoint binding (§5.5)', () => {
  it('bound ends are used exactly, not recomputed', () => {
    // A computed endpoint 1e-7 from its target either fails the merge test or
    // leaves a near-degenerate edge; either way the cycle can miss
    // COPLANARITY_TOLERANCE and a visibly-joined curve refuses to close.
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.5, vec3(0,1,0))!;
    const anchorA = vec3(0, 0, 0);
    const anchorB = vec3(2, 0, 0);
    const pts = arcPoints(spec, anchorA, anchorB);
    expect(pts[0]).toBe(anchorA);                       // identity, not a copy
    expect(pts[pts.length - 1]).toBe(anchorB);
  });

  it('interior points still come from the analytic parameters', () => {
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 1, vec3(0,1,0))!;
    const pts = arcPoints(spec);
    expect(pts).toHaveLength(spec.segments + 1);
    for (let i = 1; i < pts.length - 1; i++) {
      expect(distance(pts[i]!, spec.centre)).toBeCloseTo(spec.radius, 9);
    }
  });
});

describe('sagitta demotion (§5.7 Rule 4)', () => {
  it('a 5-degree sweep at 50m radius does NOT demote', () => {
    // A flat angular cutoff is radius-blind: this is a 4.4m run with obvious
    // curvature and demoting it would be plainly wrong to the user.
    const sweep = 5 * Math.PI / 180;
    const spec = { centre: vec3(0,0,0), normal: vec3(0,0,1), radius: 50, startAngle: 0, sweep, segments: 12 };
    expect(shouldDemote(spec, T, 12)).toBe(false);
    expect(sagitta(50, sweep)).toBeGreaterThan(T.VERTEX_MERGE_TOLERANCE);
  });

  it('a 5-degree sweep at 1mm radius DOES demote', () => {
    const sweep = 5 * Math.PI / 180;
    const spec = { centre: vec3(0,0,0), normal: vec3(0,0,1), radius: 0.001, startAngle: 0, sweep, segments: 12 };
    expect(shouldDemote(spec, T, 12)).toBe(true);
  });

  it('demotes below two segments', () => {
    const spec = { centre: vec3(0,0,0), normal: vec3(0,0,1), radius: 5, startAngle: 0, sweep: 1, segments: 1 };
    expect(shouldDemote(spec, T, 1)).toBe(true);
  });

  it('demotes below the sweep floor', () => {
    const spec = { centre: vec3(0,0,0), normal: vec3(0,0,1), radius: 50, startAngle: 0, sweep: 0.001, segments: 12 };
    expect(shouldDemote(spec, T, 12)).toBe(true);
  });
});

describe('createArc', () => {
  it('creates a curve of 12 segments by default', () => {
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.5, vec3(0,1,0))!;
    const r = createArc(c, spec);
    expect(r.demoted).toBe(false);
    expect(r.edges).toHaveLength(DEFAULT_SEGMENTS);
    expect(c.graph.curves.size).toBe(1);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });

  it('marks interior edges smooth and the ends hard', () => {
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.5, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const curve = c.graph.curves.get(r.curveId!)!;
    const flags = curve.edges.map(e => c.graph.edges.get(e)!.smooth);
    expect(flags[0]).toBe(false);
    expect(flags[flags.length - 1]).toBe(false);
    expect(flags.slice(1, -1).every(Boolean)).toBe(true);
  });

  it('emits plain edges when the arc degenerates', () => {
    const c = ctx();
    const spec = { centre: vec3(0,0,0), normal: vec3(0,0,1), radius: 0.002, startAngle: 0, sweep: 0.02, segments: 12 };
    const r = createArc(c, spec);
    expect(r.demoted).toBe(true);
    expect(c.graph.curves.size).toBe(0);
  });

  it('an arc closed by a chord derives a face', () => {
    // Arc segments are ordinary edges for face derivation. §5.6
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const arc = createArc(c, spec);
    const chord = insertEdge(c, vec3(0,0,0), vec3(2,0,0));
    const touched = new Set<EdgeId>([...arc.touched, ...chord.touched]);
    const d = derive(c.graph, touched, OPTS);
    expect(d.created).toHaveLength(1);
  });

  it('an arc across a face splits it', () => {
    const c = ctx();
    const touched = new Set<EdgeId>();
    for (const [a, b] of [
      [vec3(0,0,0), vec3(4,0,0)], [vec3(4,0,0), vec3(4,4,0)],
      [vec3(4,4,0), vec3(0,4,0)], [vec3(0,4,0), vec3(0,0,0)],
    ] as const) for (const t of insertEdge(c, a, b).touched) touched.add(t);
    derive(c.graph, touched, OPTS);
    expect(c.graph.faces.size).toBe(1);

    const spec = arcFromChordBulge(vec3(0,0,0), vec3(4,4,0), 1, vec3(1,-1,0))!;
    const arc = createArc(c, spec);
    const d = derive(c.graph, arc.touched, OPTS);
    expect(c.graph.faces.size).toBe(2);
    expect(d.diagnostics.filter(x => x.kind === 'sliver-rejected')).toHaveLength(0);
  });
});

describe('curve ordering', () => {
  it('walks vertices start to end', () => {
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.5, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const verts = curveVertices(c.graph, r.curveId!);
    expect(verts).toHaveLength(DEFAULT_SEGMENTS + 1);
    expect(distance(getVertex(c.graph, verts[0]!).position, vec3(0,0,0))).toBeCloseTo(0, 9);
    expect(distance(getVertex(c.graph, verts[verts.length-1]!).position, vec3(2,0,0))).toBeCloseTo(0, 9);
  });

  it('order survives a mid-curve split', () => {
    // insertEdge splices halves in place rather than appending, so every
    // downstream arc operation can still walk the run.
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const before = curveVertices(c.graph, r.curveId!).length;
    insertEdge(c, vec3(1, 0, 0), vec3(1, 2, 0));
    const after = curveVertices(c.graph, r.curveId!);
    expect(after.length).toBeGreaterThanOrEqual(before);
    expect(new Set(after).size).toBe(after.length); // no repeats: order intact
  });
});

describe('splitting (§5.7)', () => {
  it('splitting at a vertex gives two curves with parameters intact', () => {
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const verts = curveVertices(c.graph, r.curveId!);
    const mid = verts[6]!;

    const res = splitCurve(c.graph, r.curveId!, mid, T);
    expect(res.curves).toHaveLength(2);
    for (const id of res.curves) {
      const cv = c.graph.curves.get(id)!;
      expect(cv.radius).toBeCloseTo(spec.radius, 9);
      expect(cv.centre).toEqual(spec.centre);
    }
  });

  it('does NOT explode into loose edges', () => {
    // Exploding would destroy the analytic data offset and follow-me need,
    // unrecoverably. §5.7 Rule 2
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const verts = curveVertices(c.graph, r.curveId!);
    splitCurve(c.graph, r.curveId!, verts[6]!, T);
    const orphans = [...c.graph.edges.values()].filter(e => e.curve === null);
    expect(orphans).toHaveLength(0);
  });

  it('splitting near an endpoint demotes the stub without moving a vertex', () => {
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const verts = curveVertices(c.graph, r.curveId!);
    const positionsBefore = verts.map(v => ({ ...getVertex(c.graph, v).position }));

    const res = splitCurve(c.graph, r.curveId!, verts[1]!, T);
    expect(res.demoted.length).toBeGreaterThan(0);

    verts.forEach((v, i) => {
      const p = c.graph.vertices.get(v);
      if (p) expect(distance(p.position, positionsBefore[i]!)).toBeCloseTo(0, 12);
    });
  });

  it('splitting at an end is a no-op', () => {
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const verts = curveVertices(c.graph, r.curveId!);
    expect(splitCurve(c.graph, r.curveId!, verts[0]!, T).curves).toEqual([r.curveId]);
  });
});

describe('segment re-solve', () => {
  it('regenerates at a new count without moving the end vertices', () => {
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const before = curveVertices(c.graph, r.curveId!);
    const startPos = { ...getVertex(c.graph, before[0]!).position };
    const endPos = { ...getVertex(c.graph, before[before.length-1]!).position };

    const res = resolveSegments(c, r.curveId!, 24);
    expect(res.ok).toBe(true);

    const cv = c.graph.curves.get(res.curveId!)!;
    expect(cv.edges).toHaveLength(24);
    const after = curveVertices(c.graph, res.curveId!);
    expect(distance(getVertex(c.graph, after[0]!).position, startPos)).toBeCloseTo(0, 12);
    expect(distance(getVertex(c.graph, after[after.length-1]!).position, endPos)).toBeCloseTo(0, 12);
    expect(checkIntegrity(c.graph)).toEqual([]);
  });

  it('is refused on a truncated curve, with a reason', () => {
    // Regenerating would move the cut vertex and break the join. Grey the
    // control out and say why rather than failing silently. §5.7 Rule 3
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const cv = c.graph.curves.get(r.curveId!)!;
    cv.endTruncated = true;

    const res = resolveSegments(c, r.curveId!, 24);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/cut mid-segment|true circle/);
  });

  it('refuses when other geometry is attached partway along', () => {
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const r = createArc(c, spec);
    const verts = curveVertices(c.graph, r.curveId!);
    insertEdge(c, getVertex(c.graph, verts[5]!).position, vec3(5, 5, 0));

    const res = resolveSegments(c, r.curveId!, 24);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/attached/);
  });

  it('rejects an invalid count', () => {
    const c = ctx();
    const spec = arcFromChordBulge(vec3(0,0,0), vec3(2,0,0), 0.8, vec3(0,1,0))!;
    const r = createArc(c, spec);
    expect(resolveSegments(c, r.curveId!, 1).ok).toBe(false);
    expect(resolveSegments(c, r.curveId!, 2.5).ok).toBe(false);
  });
});
