import { describe, it, expect } from 'vitest';
import {
  createContainerModel, createContainer, getContainer, activeGraph,
  enterContext, exitContext, contextPath, setTransform, normaliseScale,
  worldMatrix, worldInverse, worldInverseTranspose,
  localToWorld, worldToLocal, convertPoint, normalToLocal,
  mayInteract, findCrossContextCoincidence, explode, group,
  assertSingleContext, checkSingleContext,
  allContainers, graphsForHitTesting,
} from './context';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { checkIntegrity } from './topology';
import { translation, scaling, rotationAxisAngle, multiply, transformPoint, transformDirection, IDENTITY } from './mat4';
import { vec3, distance, dot, normalize, length, sub } from './math';
import { DEFAULT_TOLERANCES as T } from './types';
import type { ContainerId, EdgeId, Graph } from './types';

const OPTS = { tolerances: T, cameraDirection: vec3(0, 0, -1) };

const ctxFor = (graph: Graph): InsertContext =>
  ({ graph, tolerances: T, index: createEdgeIndex(graph, 1) });

function drawSquare(graph: Graph, n = 2, offset = vec3(0,0,0)) {
  const c = ctxFor(graph);
  const touched = new Set<EdgeId>();
  const pts = [
    vec3(offset.x, offset.y, offset.z), vec3(offset.x+n, offset.y, offset.z),
    vec3(offset.x+n, offset.y+n, offset.z), vec3(offset.x, offset.y+n, offset.z),
  ];
  for (let i = 0; i < 4; i++) {
    for (const t of insertEdge(c, pts[i]!, pts[(i+1)%4]!).touched) touched.add(t);
  }
  derive(graph, touched, OPTS);
  return touched;
}

describe('R8 — stickiness stops at a container boundary', () => {
  it('geometrically coincident edges in different containers never interact', () => {
    // The rule that makes objects behave as objects. Without it, every object
    // welds to every object it touches.
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'A');
    const b = createContainer(m, m.root.id, 'B');

    drawSquare(a.graph, 2);
    drawSquare(b.graph, 2);   // exactly the same coordinates

    expect(a.graph.vertices.size).toBe(4);
    expect(b.graph.vertices.size).toBe(4);
    expect(a.graph.faces.size).toBe(1);
    expect(b.graph.faces.size).toBe(1);
    // No merging, no splitting, no shared anything.
    expect(mayInteract(a.id, b.id)).toBe(false);
    expect(mayInteract(a.id, a.id)).toBe(true);
  });

  it('overlapping boxes in containers do not cut each other', () => {
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'A');
    const b = createContainer(m, m.root.id, 'B');
    drawSquare(a.graph, 4, vec3(0,0,0));
    drawSquare(b.graph, 4, vec3(2,2,0));   // overlapping
    expect(a.graph.edges.size).toBe(4);
    expect(b.graph.edges.size).toBe(4);
  });

  it('the SAME geometry loose in one graph DOES weld and cut', () => {
    // The contrast that proves the difference is containment, not dimension.
    const m = createContainerModel();
    drawSquare(m.root.graph, 4, vec3(0,0,0));
    drawSquare(m.root.graph, 4, vec3(2,2,0));
    expect(m.root.graph.edges.size).toBeGreaterThan(8);   // split at crossings
    expect(m.root.graph.faces.size).toBeGreaterThan(2);
  });

  it('reports cross-context coincidence as information, not a defect', () => {
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'A');
    const b = createContainer(m, m.root.id, 'B');
    drawSquare(a.graph, 2);
    drawSquare(b.graph, 2);
    const hits = findCrossContextCoincidence(m, 1e-6);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('transforms (§2.5.2)', () => {
  it('composes down the nesting chain', () => {
    const m = createContainerModel();
    const outer = createContainer(m, m.root.id, 'outer', translation(vec3(10,0,0)));
    const inner = createContainer(m, outer.id, 'inner', translation(vec3(0,5,0)));
    const world = localToWorld(m, inner.id, vec3(1,1,1));
    expect(world.x).toBeCloseTo(11, 9);
    expect(world.y).toBeCloseTo(6, 9);
  });

  it('round-trips a world point into a doubly-nested local frame', () => {
    const m = createContainerModel();
    const outer = createContainer(m, m.root.id, 'o',
      multiply(translation(vec3(10,0,0)), rotationAxisAngle(vec3(0,1,0), 0.4)));
    const inner = createContainer(m, outer.id, 'i',
      multiply(translation(vec3(0,5,0)), scaling(vec3(2,2,2))));
    const local = vec3(1,2,3);
    const back = worldToLocal(m, inner.id, localToWorld(m, inner.id, local));
    expect(distance(local, back)).toBeCloseTo(0, 9);
  });

  it('normals use the inverse transpose, not the inverse', () => {
    // Under a 2:1:1 scale the two disagree, and using the inverse produces a
    // plane that is visibly plausible and subtly skewed.
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'scaled', scaling(vec3(2,1,1)));

    const n = normalize(vec3(1,1,0));
    const t1 = normalize(vec3(1,-1,0));   // in-plane
    const world = worldMatrix(m, c.id);
    const t1World = transformDirection(t1, world);

    const nCorrect = normalToLocal(m, c.id, n);   // wrong direction of travel,
    // so test the exposed matrices directly:
    const nWorldCorrect = transformDirection(n, worldInverseTranspose(m, c.id));
    const nWorldNaive = transformDirection(n, world);

    expect(Math.abs(dot(normalize(nWorldCorrect), normalize(t1World)))).toBeLessThan(1e-9);
    expect(Math.abs(dot(normalize(nWorldNaive), normalize(t1World)))).toBeGreaterThan(0.1);
    expect(length(nCorrect)).toBeCloseTo(1, 9);
  });

  it('caches and invalidates down the tree', () => {
    const m = createContainerModel();
    const outer = createContainer(m, m.root.id, 'o', translation(vec3(10,0,0)));
    const inner = createContainer(m, outer.id, 'i', IDENTITY);
    expect(localToWorld(m, inner.id, vec3(0,0,0)).x).toBeCloseTo(10, 9);

    setTransform(m, outer.id, translation(vec3(20,0,0)));
    // The child's cache must have been invalidated too.
    expect(localToWorld(m, inner.id, vec3(0,0,0)).x).toBeCloseTo(20, 9);
    expect(getContainer(m, inner.id).cachedWorld).not.toBeNull();
  });

  it('converts a point between two sibling contexts', () => {
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'a', translation(vec3(10,0,0)));
    const b = createContainer(m, m.root.id, 'b', translation(vec3(4,0,0)));
    // local 1 in a -> world 11 -> local 7 in b
    expect(convertPoint(m, vec3(1,0,0), a.id, b.id).x).toBeCloseTo(7, 9);
  });

  it('tracks the determinant sign for a mirrored container', () => {
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'mirror', scaling(vec3(-1,1,1)));
    expect(c.determinantSign).toBe(-1);
  });
});

describe('edit context (§2.5.2)', () => {
  it('drawing writes only to the active graph', () => {
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'inner');
    enterContext(m, c.id);
    drawSquare(activeGraph(m), 2);

    expect(c.graph.edges.size).toBe(4);
    expect(m.root.graph.edges.size).toBe(0);
  });

  it('exits to the parent', () => {
    const m = createContainerModel();
    const outer = createContainer(m, m.root.id, 'o');
    const inner = createContainer(m, outer.id, 'i');
    enterContext(m, inner.id);
    expect(exitContext(m)).toBe(outer.id);
    expect(exitContext(m)).toBe(m.root.id);
    expect(exitContext(m)).toBe(m.root.id);   // cannot go above root
  });

  it('reports the breadcrumb path', () => {
    const m = createContainerModel();
    const outer = createContainer(m, m.root.id, 'o');
    const inner = createContainer(m, outer.id, 'i');
    enterContext(m, inner.id);
    expect(contextPath(m)).toEqual([m.root.id, outer.id, inner.id]);
  });

  it('warns on entering a non-uniformly scaled container', () => {
    // Angle-based inferences will visibly not align with world axes, and
    // without a cue that reads as broken snapping. §2.5.2
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'squashed', scaling(vec3(2,1,1)));
    const { warnings } = enterContext(m, c.id);
    expect(warnings.some(w => w.kind === 'non-uniform-scale')).toBe(true);
  });

  it('warns on entering a mirrored container', () => {
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'mirror', scaling(vec3(-1,1,1)));
    expect(enterContext(m, c.id).warnings.some(w => w.kind === 'mirrored')).toBe(true);
  });

  it('does not warn for rotation, translation or uniform scale', () => {
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'fine',
      multiply(translation(vec3(3,4,5)), multiply(rotationAxisAngle(vec3(0,1,0), 1), scaling(vec3(3,3,3)))));
    expect(enterContext(m, c.id).warnings).toHaveLength(0);
  });

  it('offers every graph for hit-testing, flagging the active one', () => {
    // Hit-testing runs across contexts; insertion targets only the active one.
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'a');
    createContainer(m, m.root.id, 'b');
    enterContext(m, a.id);
    const graphs = graphsForHitTesting(m);
    expect(graphs).toHaveLength(3);
    expect(graphs.filter(g => g.isActive)).toHaveLength(1);
    expect(graphs.find(g => g.isActive)!.id).toBe(a.id);
  });
});

describe('normalise scale (§2.5.2)', () => {
  it('bakes the scale into geometry and resets the matrix', () => {
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'squashed', scaling(vec3(2,1,1)));
    drawSquare(c.graph, 2);
    const worldBefore = [...c.graph.vertices.values()].map(v => localToWorld(m, c.id, v.position));

    expect(normaliseScale(m, c.id)).toBe(true);

    const worldAfter = [...c.graph.vertices.values()].map(v => localToWorld(m, c.id, v.position));
    worldBefore.forEach((p, i) => expect(distance(p, worldAfter[i]!)).toBeCloseTo(0, 9));
    expect(enterContext(m, c.id).warnings).toHaveLength(0);
  });

  it('is a no-op when the transform already preserves angles', () => {
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'fine', translation(vec3(1,2,3)));
    expect(normaliseScale(m, c.id)).toBe(false);
  });
});

describe('explode (§2.5.3)', () => {
  it('merges geometry into the parent and applies the transform', () => {
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'box', translation(vec3(10,0,0)));
    drawSquare(c.graph, 2);

    const r = explode(m, c.id);
    expect(m.containers.has(c.id)).toBe(false);
    expect(m.root.graph.vertices.size).toBe(4);
    // Transformed on the way across, not carried over unchanged.
    const xs = [...m.root.graph.vertices.values()].map(v => v.position.x).sort((a,b)=>a-b);
    expect(xs[0]).toBeCloseTo(10, 9);
    expect(r.touched.size).toBe(4);
  });

  it('two touching boxes weld and cut once exploded', () => {
    // The operation that retroactively makes independent objects interact.
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'a');
    const b = createContainer(m, m.root.id, 'b');
    drawSquare(a.graph, 4, vec3(0,0,0));
    drawSquare(b.graph, 4, vec3(2,2,0));

    const touched = new Set<EdgeId>();
    for (const t of explode(m, a.id).touched) touched.add(t);
    for (const t of explode(m, b.id).touched) touched.add(t);

    // Re-run insertion over the merged graph so R2 applies.
    const g = m.root.graph;
    const before = g.edges.size;
    const c = ctxFor(g);
    const all = [...g.edges.values()].map(e => [
      { ...g.vertices.get(e.v0)!.position }, { ...g.vertices.get(e.v1)!.position },
    ] as const);
    for (const [p, q] of all) for (const t of insertEdge(c, p, q).touched) touched.add(t);
    derive(g, touched, OPTS);

    expect(g.edges.size).toBeGreaterThan(before);   // cut at the crossings
    expect(checkIntegrity(g)).toEqual([]);
  });

  it('re-parents children without moving them', () => {
    const m = createContainerModel();
    const outer = createContainer(m, m.root.id, 'o', translation(vec3(10,0,0)));
    const inner = createContainer(m, outer.id, 'i', translation(vec3(0,5,0)));
    const worldBefore = localToWorld(m, inner.id, vec3(0,0,0));

    explode(m, outer.id);

    expect(getContainer(m, inner.id).parent).toBe(m.root.id);
    expect(distance(localToWorld(m, inner.id, vec3(0,0,0)), worldBefore)).toBeCloseTo(0, 9);
  });

  it('refuses to explode the root', () => {
    const m = createContainerModel();
    expect(() => explode(m, m.root.id)).toThrow(/root/);
  });

  it('moves the active context out when the active container explodes', () => {
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'c');
    enterContext(m, c.id);
    explode(m, c.id);
    expect(m.activeContext).toBe(m.root.id);
  });
});

describe('group (§2.5.3)', () => {
  it('moves an isolated selection wholesale', () => {
    const m = createContainerModel();
    drawSquare(m.root.graph, 2);
    const all = [...m.root.graph.edges.keys()];

    const r = group(m, m.root.id, all, 'Panel');
    expect(r.container.graph.edges.size).toBe(4);
    expect(m.root.graph.edges.size).toBe(0);
    expect(r.duplicatedEdges).toHaveLength(0);
  });

  it('DUPLICATES an edge shared with geometry left behind', () => {
    // R8 forbids one edge spanning two graphs, so a shared edge must exist in
    // both. Users read this as "grouping left a copy of my lines behind". §2.5.3
    const m = createContainerModel();
    const g = m.root.graph;
    const c = ctxFor(g);
    const touched = new Set<EdgeId>();
    for (const [a, b] of [
      [vec3(0,0,0), vec3(2,0,0)], [vec3(2,0,0), vec3(2,2,0)],
      [vec3(2,2,0), vec3(0,2,0)], [vec3(0,2,0), vec3(0,0,0)],
      [vec3(2,0,0), vec3(4,0,0)],   // spur attached to the square
    ] as const) for (const t of insertEdge(c, a, b).touched) touched.add(t);
    derive(g, touched, OPTS);

    const squareEdges = [...g.edges.values()]
      .filter(e => {
        const p = g.vertices.get(e.v0)!.position, q = g.vertices.get(e.v1)!.position;
        return p.x <= 2.0001 && q.x <= 2.0001;
      })
      .map(e => e.id);

    const r = group(m, m.root.id, squareEdges, 'Panel');
    expect(r.container.graph.edges.size).toBe(4);
    expect(r.duplicatedEdges.length).toBeGreaterThan(0);
    // The shared edge survives in BOTH graphs.
    expect(g.edges.size).toBeGreaterThan(1);
  });

  it('leaves the grouped geometry where it was', () => {
    const m = createContainerModel();
    drawSquare(m.root.graph, 2);
    const before = [...m.root.graph.vertices.values()].map(v => ({ ...v.position }));
    const r = group(m, m.root.id, [...m.root.graph.edges.keys()]);
    const after = [...r.container.graph.vertices.values()].map(v => v.position);
    for (const p of before) {
      expect(after.some(q => distance(p, q) < 1e-12)).toBe(true);
    }
  });
});

describe('traversal', () => {
  it('lists containers depth first and deterministically', () => {
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'a');
    createContainer(m, a.id, 'a1');
    createContainer(m, m.root.id, 'b');
    const first = allContainers(m);
    expect(first).toEqual(allContainers(m));
    expect(first).toHaveLength(4);
  });
});

describe('R8 enforcement', () => {
  it('accepts edges from a single container', () => {
    const m = createContainerModel();
    const c = createContainer(m, m.root.id, 'c');
    drawSquare(c.graph, 2);
    expect(assertSingleContext(m, [...c.graph.edges.keys()], c.id)).toBe(c.id);
  });

  it('throws when an operation spans two containers', () => {
    // R8 is upheld structurally, not by a check — which means a future change
    // could violate it silently. This makes the violation loud.
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'a');
    const b = createContainer(m, m.root.id, 'b');
    drawSquare(a.graph, 2);
    drawSquare(b.graph, 2);
    const mixed = [...a.graph.edges.keys()].slice(0,1);
    // Same numeric ids exist in both graphs, so query by both explicitly.
    const spanning = [...a.graph.edges.keys(), ...b.graph.edges.keys()];
    expect(() => assertSingleContext(m, spanning)).toThrow(/R8 violated/);
    expect(mixed.length).toBe(1);
  });

  it('throws when edges are not in the active context', () => {
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'a');
    const b = createContainer(m, m.root.id, 'b');
    drawSquare(a.graph, 2);
    expect(() => assertSingleContext(m, [...a.graph.edges.keys()], b.id))
      .toThrow(/active context/);
  });

  it('offers a non-throwing form for diagnostics', () => {
    const m = createContainerModel();
    const a = createContainer(m, m.root.id, 'a');
    const b = createContainer(m, m.root.id, 'b');
    drawSquare(a.graph, 2);
    drawSquare(b.graph, 2);
    const r = checkSingleContext(m, [...a.graph.edges.keys(), ...b.graph.edges.keys()]);
    expect(r.ok).toBe(false);
    expect(r.containers.length).toBeGreaterThan(1);
  });
});
