import { describe, it, expect } from 'vitest';
import { KernelSession } from './index';
import { serializeGraph, deserializeGraph, emptySerializedGraph, isEmptyGraph, KERNEL_FORMAT_VERSION } from './serialize';
import { checkIntegrity, loopPoints } from './topology';
import { vec3, planeBasis, projectToBasis } from './math';
import { signedArea } from './polygon';
import { paintFace, faceSummaries } from '../../tools/kernelSelection';
import { derive } from './derive';
import type { EdgeId } from './types';

const cam = vec3(0, 0, -1);
const up = vec3(0, 1, 0);
const session = () => new KernelSession({ cameraDirection: cam, upAxis: up });

/** Ground square in a Y-up world. */
const square = (s: KernelSession, n = 4) =>
  s.drawChain([vec3(0,0,0), vec3(n,0,0), vec3(n,0,n), vec3(0,0,n), vec3(0,0,0)]);

const netArea = (g: ReturnType<typeof session>['graph']) => {
  let sum = 0;
  for (const f of g.faces.values()) {
    const b = planeBasis(f.plane);
    sum += Math.abs(signedArea(loopPoints(g, f.outerLoop).map(p => projectToBasis(p, b))));
    for (const l of f.innerLoops) {
      sum -= Math.abs(signedArea(loopPoints(g, l).map(p => projectToBasis(p, b))));
    }
  }
  return sum;
};

describe('round trip', () => {
  it('preserves counts, ids and area', () => {
    const s = session();
    square(s);
    s.drawLine(vec3(0,0,0), vec3(4,0,4));
    const before = {
      v: s.graph.vertices.size, e: s.graph.edges.size, f: s.graph.faces.size,
      ids: [...s.graph.faces.keys()].sort((a,b)=>a-b),
      area: netArea(s.graph),
    };

    const revived = deserializeGraph(serializeGraph(s.graph));

    expect(revived.vertices.size).toBe(before.v);
    expect(revived.edges.size).toBe(before.e);
    expect(revived.faces.size).toBe(before.f);
    expect([...revived.faces.keys()].sort((a,b)=>a-b)).toEqual(before.ids);
    expect(netArea(revived)).toBeCloseTo(before.area, 9);
    expect(checkIntegrity(revived)).toEqual([]);
  });

  it('survives JSON — the actual storage path', () => {
    const s = session();
    square(s);
    const json = JSON.parse(JSON.stringify(serializeGraph(s.graph)));
    const revived = deserializeGraph(json);
    expect(revived.faces.size).toBe(1);
    expect(checkIntegrity(revived)).toEqual([]);
  });

  it('preserves holes', () => {
    const s = session();
    square(s, 6);
    s.drawChain([vec3(2,0,2), vec3(4,0,2), vec3(4,0,4), vec3(2,0,4), vec3(2,0,2)]);
    const revived = deserializeGraph(serializeGraph(s.graph));
    const outer = [...revived.faces.values()].find(f => f.innerLoops.length === 1);
    expect(outer).toBeDefined();
    expect(netArea(revived)).toBeCloseTo(netArea(s.graph), 9);
  });

  it('preserves materials, names and hidden state', () => {
    const s = session();
    square(s);
    const id = [...s.graph.faces.keys()][0]!;
    paintFace(s.graph, id, '#ff0000');
    s.graph.faces.get(id)!.attributes.name = 'Floor';
    s.graph.faces.get(id)!.attributes.hidden = true;

    const revived = deserializeGraph(serializeGraph(s.graph));
    const row = faceSummaries(revived)[0]!;
    expect(row.color).toBe('#ff0000');
    expect(row.label).toBe('Floor');
    expect(row.hidden).toBe(true);
  });

  it('preserves the UV basis, so textures do not shift on reload', () => {
    const s = session();
    square(s);
    const uv = [...s.graph.faces.values()][0]!.attributes.uv!;
    const revived = deserializeGraph(serializeGraph(s.graph));
    const uv2 = [...revived.faces.values()][0]!.attributes.uv!;
    expect(uv2.origin).toEqual(uv.origin);
    expect(uv2.u).toEqual(uv.u);
  });

  it('keeps drawing correctly after a reload', () => {
    // Ids must not be reused, or a new edge collides with a loaded one.
    const s = session();
    square(s);
    const revived = deserializeGraph(serializeGraph(s.graph));

    const before = revived.edges.size;
    const nextEdgeId = revived.nextId.edge;
    expect(nextEdgeId).toBeGreaterThan(Math.max(...revived.edges.keys()));

    const touched = new Set<EdgeId>();
    derive(revived, touched, { tolerances: s.tolerances, upAxis: up });
    expect(revived.edges.size).toBe(before);
    expect(checkIntegrity(revived)).toEqual([]);
  });
});

describe('storage constraints', () => {
  it('contains no nested arrays — Firestore rejects them', () => {
    const s = session();
    square(s);
    s.drawChain([vec3(1,0,1), vec3(2,0,1), vec3(2,0,2), vec3(1,0,2), vec3(1,0,1)]);
    const data = serializeGraph(s.graph) as unknown as Record<string, unknown>;

    const check = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        for (const [i, item] of value.entries()) {
          expect(Array.isArray(item), `${path}[${i}] is a nested array`).toBe(false);
          check(item, `${path}[${i}]`);
        }
        return;
      }
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) check(v, `${path}.${k}`);
      }
    };
    check(data, 'root');
  });

  it('contains no undefined — Firestore rejects it', () => {
    const s = session();
    square(s);
    const json = JSON.stringify(serializeGraph(s.graph));
    expect(json.includes('undefined')).toBe(false);
  });

  it('stamps a format version', () => {
    expect(serializeGraph(session().graph).version).toBe(KERNEL_FORMAT_VERSION);
  });
});

describe('robustness', () => {
  it('returns an empty graph for null or junk', () => {
    expect(isEmptyGraph(deserializeGraph(null))).toBe(true);
    expect(isEmptyGraph(deserializeGraph(undefined))).toBe(true);
    expect(isEmptyGraph(deserializeGraph({} as never))).toBe(true);
  });

  it('an empty document round-trips', () => {
    expect(isEmptyGraph(deserializeGraph(emptySerializedGraph()))).toBe(true);
  });

  it('skips a face whose loop is missing rather than throwing', () => {
    // A partially recoverable model beats an unopenable one.
    const s = session();
    square(s);
    const data = serializeGraph(s.graph);
    data.loops = [];
    const revived = deserializeGraph(data);
    expect(revived.faces.size).toBe(0);
    expect(revived.edges.size).toBe(4);      // edges still load
    expect(checkIntegrity(revived)).toEqual([]);
  });

  it('skips an edge whose vertex is missing', () => {
    const s = session();
    square(s);
    const data = serializeGraph(s.graph);
    data.vertices = data.vertices.slice(0, 2);
    const revived = deserializeGraph(data);
    expect(revived.vertices.size).toBe(2);
    expect(checkIntegrity(revived)).toEqual([]);
  });

  it('repairs counters even when the stored ones are wrong', () => {
    const s = session();
    square(s);
    const data = serializeGraph(s.graph);
    data.nextId = { vertex: 1, edge: 1, loop: 1, face: 1, curve: 1, component: 1 };
    const revived = deserializeGraph(data);
    // Reusing an id would collide with loaded geometry.
    expect(revived.nextId.edge).toBeGreaterThan(Math.max(...revived.edges.keys()));
    expect(revived.nextId.vertex).toBeGreaterThan(Math.max(...revived.vertices.keys()));
  });
});
