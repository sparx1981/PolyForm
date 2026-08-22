import { describe, it, expect } from 'vitest';
import {
  createGraph, addVertex, addEdge, removeEdge, removeVertex, removeOrphanVertices,
  classifyEdge, adjacentEdges, findEdgeBetween, otherVertex, vertexDegree,
  addLoop, addFace, removeFace, removeLoop, facesUsingEdge, loopVertexIds,
  checkIntegrity, defaultAttributes, getEdge,
} from './topology';
import { vec3 } from './math';
import type { FaceId, Graph, VertexId } from './types';

/** Unit cube wireframe: 8 vertices, 12 edges, no faces. */
function cubeWireframe() {
  const g = createGraph();
  const v: VertexId[] = [];
  for (const [x, y, z] of [
    [0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1],
  ] as const) v.push(addVertex(g, vec3(x, y, z)).id);
  const pairs: [number, number][] = [
    [0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4], [0,4],[1,5],[2,6],[3,7],
  ];
  for (const [a, b] of pairs) addEdge(g, v[a]!, v[b]!);
  return { g, v };
}

/** A square face in the XY plane. Returns the graph and the face id. */
function squareFace(): { g: Graph; face: FaceId } {
  const g = createGraph();
  const a = addVertex(g, vec3(0, 0, 0)).id;
  const b = addVertex(g, vec3(1, 0, 0)).id;
  const c = addVertex(g, vec3(1, 1, 0)).id;
  const d = addVertex(g, vec3(0, 1, 0)).id;
  const e0 = addEdge(g, a, b).id, e1 = addEdge(g, b, c).id;
  const e2 = addEdge(g, c, d).id, e3 = addEdge(g, d, a).id;
  const plane = { point: vec3(0, 0, 0), normal: vec3(0, 0, 1) };
  const basis = { origin: vec3(0,0,0), u: vec3(1,0,0), v: vec3(0,1,0), normal: vec3(0,0,1) };
  const face = addFace(g, {
    outerLoop: 0 as never, innerLoops: [], plane, basis,
    hash: 'x' as never, attributes: defaultAttributes(),
  });
  const loop = addLoop(g, face.id, [e0, e1, e2, e3], 'outer', a);
  face.outerLoop = loop.id;
  return { g, face: face.id };
}

describe('vertices and edges', () => {
  it('builds a cube wireframe with correct counts', () => {
    const { g } = cubeWireframe();
    expect(g.vertices.size).toBe(8);
    expect(g.edges.size).toBe(12);
    expect(checkIntegrity(g)).toEqual([]);
  });

  it('reports every wireframe edge as boundary (zero uses)', () => {
    const { g } = cubeWireframe();
    for (const e of g.edges.values()) expect(classifyEdge(e)).toBe('boundary');
  });

  it('gives every cube vertex degree 3', () => {
    const { g, v } = cubeWireframe();
    for (const id of v) expect(vertexDegree(g, id)).toBe(3);
  });

  it('refuses a degenerate self-edge', () => {
    const g = createGraph();
    const a = addVertex(g, vec3(0, 0, 0)).id;
    expect(() => addEdge(g, a, a)).toThrow(/degenerate/);
  });

  it('refuses to orphan edges by removing a vertex', () => {
    const { g, v } = cubeWireframe();
    expect(() => removeVertex(g, v[0]!)).toThrow(/still attached/);
  });

  it('removes an edge cleanly with no dangling references', () => {
    const { g } = cubeWireframe();
    const id = [...g.edges.keys()][0]!;
    expect(removeEdge(g, id)).toBe(true);
    expect(g.edges.size).toBe(11);
    expect(checkIntegrity(g)).toEqual([]);
  });

  it('finds adjacency deterministically', () => {
    const { g } = cubeWireframe();
    const id = [...g.edges.keys()][0]!;
    const a = adjacentEdges(g, id);
    expect(a).toEqual([...a].sort((p, q) => p - q));
    expect(a.length).toBe(4);
  });

  it('finds an edge between two vertices in either direction', () => {
    const { g, v } = cubeWireframe();
    expect(findEdgeBetween(g, v[0]!, v[1]!)).not.toBeNull();
    expect(findEdgeBetween(g, v[1]!, v[0]!)).not.toBeNull();
    expect(findEdgeBetween(g, v[0]!, v[6]!)).toBeNull();
  });

  it('walks to the other endpoint', () => {
    const { g, v } = cubeWireframe();
    const e = findEdgeBetween(g, v[0]!, v[1]!)!;
    expect(otherVertex(e, v[0]!)).toBe(v[1]!);
    expect(() => otherVertex(e, v[6]!)).toThrow();
  });

  it('cleans up degree-0 vertices only', () => {
    const { g } = cubeWireframe();
    addVertex(g, vec3(9, 9, 9));
    expect(g.vertices.size).toBe(9);
    expect(removeOrphanVertices(g)).toHaveLength(1);
    expect(g.vertices.size).toBe(8);
  });
});

describe('edge classification', () => {
  it('does not cap the number of uses', () => {
    // Three walls meeting at a corner, or a fin on a panel. A naive
    // Edge { faceA, faceB } model would reject this. §2.4
    const { g, face } = squareFace();
    const edges = [...g.loops.values()][0]!.uses.map(u => u.edge);
    const shared = getEdge(g, edges[0]!);
    expect(classifyEdge(shared)).toBe('boundary');

    // Attach two more loops to the same edge via extra faces.
    for (let i = 0; i < 3; i++) {
      shared.uses.push({ edge: shared.id, loop: [...g.loops.keys()][0]!, reversed: i % 2 === 0 });
    }
    expect(shared.uses.length).toBe(4);
    expect(classifyEdge(shared)).toBe('non-manifold');
    expect(face).toBeDefined();
  });

  it('classifies by use count', () => {
    const { g } = squareFace();
    const e = [...g.edges.values()][0]!;
    expect(e.uses.length).toBe(1);
    expect(classifyEdge(e)).toBe('boundary');
    e.uses.push({ edge: e.id, loop: [...g.loops.keys()][0]!, reversed: true });
    expect(classifyEdge(e)).toBe('manifold');
  });
});

describe('loops and faces', () => {
  it('builds a closed loop and registers uses on every edge', () => {
    const { g } = squareFace();
    expect(g.loops.size).toBe(1);
    for (const e of g.edges.values()) expect(e.uses.length).toBe(1);
    expect(checkIntegrity(g)).toEqual([]);
  });

  it('walks loop vertices in order', () => {
    const { g } = squareFace();
    const loopId = [...g.loops.keys()][0]!;
    expect(loopVertexIds(g, loopId)).toHaveLength(4);
  });

  it('rejects a disconnected loop', () => {
    const g = createGraph();
    const a = addVertex(g, vec3(0, 0, 0)).id;
    const b = addVertex(g, vec3(1, 0, 0)).id;
    const c = addVertex(g, vec3(5, 5, 0)).id;
    const d = addVertex(g, vec3(6, 5, 0)).id;
    const e0 = addEdge(g, a, b).id;
    const e1 = addEdge(g, c, d).id;
    const f = addFace(g, {
      outerLoop: 0 as never, innerLoops: [],
      plane: { point: vec3(0,0,0), normal: vec3(0,0,1) },
      basis: { origin: vec3(0,0,0), u: vec3(1,0,0), v: vec3(0,1,0), normal: vec3(0,0,1) },
      hash: 'x' as never, attributes: defaultAttributes(),
    });
    expect(() => addLoop(g, f.id, [e0, e1], 'outer', a)).toThrow(/not connected/);
  });

  it('deleting a face leaves its edges alive', () => {
    // The inverse of R3 and the basis of retrace-to-heal. §2.3, §7.4
    const { g, face } = squareFace();
    expect(removeFace(g, face)).toBe(true);
    expect(g.faces.size).toBe(0);
    expect(g.loops.size).toBe(0);
    expect(g.edges.size).toBe(4);
    for (const e of g.edges.values()) expect(e.uses.length).toBe(0);
    expect(checkIntegrity(g)).toEqual([]);
  });

  it('reports which faces use an edge', () => {
    const { g, face } = squareFace();
    const id = [...g.edges.keys()][0]!;
    expect(facesUsingEdge(g, id)).toEqual([face]);
  });

  it('removing a loop unregisters its uses', () => {
    const { g } = squareFace();
    const loopId = [...g.loops.keys()][0]!;
    removeLoop(g, loopId);
    for (const e of g.edges.values()) expect(e.uses.length).toBe(0);
  });
});

describe('integrity checking', () => {
  it('detects a dangling edge reference on a vertex', () => {
    const { g, v } = cubeWireframe();
    g.vertices.get(v[0]!)!.edges.push(999 as never);
    expect(checkIntegrity(g).join(' ')).toMatch(/missing edge/);
  });

  it('detects an unregistered loop use', () => {
    const { g } = squareFace();
    const e = [...g.edges.values()][0]!;
    e.uses = [];
    expect(checkIntegrity(g).join(' ')).toMatch(/not registered/);
  });
});
