import { describe, it, expect } from 'vitest';
import { KernelSession } from './index';
import { tessellateGraph, tessellateFace, triangulate, mergeBuffers, edgeBuffer, tessellatedArea } from './tessellate';
import { vec3, vec2 } from './math';
import { pointInPolygon } from './polygon';

const cam = vec3(0, 0, -1);

const rect = (n: number) => [
  vec3(0,0,0), vec3(n,0,0), vec3(n,n,0), vec3(0,n,0), vec3(0,0,0),
];

/** Centroid of every triangle, for hole checks. */
function triangleCentroids(m: { positions: number[]; indices: number[] }) {
  const out: { x: number; y: number }[] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const p = [m.indices[t]!, m.indices[t+1]!, m.indices[t+2]!].map(i => ({
      x: m.positions[i*3]!, y: m.positions[i*3+1]!,
    }));
    out.push({
      x: (p[0]!.x + p[1]!.x + p[2]!.x) / 3,
      y: (p[0]!.y + p[1]!.y + p[2]!.y) / 3,
    });
  }
  return out;
}

describe('triangulate', () => {
  it('triangulates a square into 2 triangles', () => {
    const r = triangulate([vec2(0,0), vec2(1,0), vec2(1,1), vec2(0,1)]);
    expect(r.indices).toHaveLength(6);
  });

  it('triangulates a concave L-shape correctly', () => {
    const L = [vec2(0,0), vec2(3,0), vec2(3,1), vec2(1,1), vec2(1,3), vec2(0,3)];
    const r = triangulate(L);
    expect(r.indices.length / 3).toBe(4); // n-2 triangles
    for (const c of triangleCentroids({
      positions: r.points.flatMap(p => [p.x, p.y, 0]), indices: r.indices,
    })) {
      expect(pointInPolygon(c, L)).toBe(true);
    }
  });

  it('accepts either input winding', () => {
    const cw = [vec2(0,1), vec2(1,1), vec2(1,0), vec2(0,0)];
    expect(triangulate(cw).indices).toHaveLength(6);
  });
});

describe('holes tessellate as holes', () => {
  it('no triangle centroid falls inside the hole', () => {
    // The acceptance criterion from §10.2 Phase 6, applied at the render
    // boundary. Get the relative winding wrong and the hole fills in.
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(6));
    s.drawChain([vec3(2,2,0), vec3(4,2,0), vec3(4,4,0), vec3(2,4,0), vec3(2,2,0)]);

    const outer = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const mesh = tessellateFace(s.graph, outer.id)!;
    expect(mesh.indices.length).toBeGreaterThan(0);

    const hole = [vec2(2,2), vec2(4,2), vec2(4,4), vec2(2,4)];
    for (const c of triangleCentroids(mesh)) {
      expect(pointInPolygon(c, hole), `triangle at ${c.x},${c.y} is inside the hole`).toBe(false);
    }
  });

  it('the tessellated area matches the face area with the hole subtracted', () => {
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(6));
    s.drawChain([vec3(2,2,0), vec3(4,2,0), vec3(4,4,0), vec3(2,4,0), vec3(2,2,0)]);

    const outer = [...s.graph.faces.values()].find(f => f.innerLoops.length === 1)!;
    const mesh = tessellateFace(s.graph, outer.id)!;
    expect(tessellatedArea([mesh])).toBeCloseTo(32, 6); // 36 - 4
  });

  it('handles two holes in one face', () => {
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(10));
    s.drawChain([vec3(1,1,0), vec3(3,1,0), vec3(3,3,0), vec3(1,3,0), vec3(1,1,0)]);
    s.drawChain([vec3(6,6,0), vec3(8,6,0), vec3(8,8,0), vec3(6,8,0), vec3(6,6,0)]);

    const outer = [...s.graph.faces.values()].find(f => f.innerLoops.length === 2)!;
    const mesh = tessellateFace(s.graph, outer.id)!;
    expect(tessellatedArea([mesh])).toBeCloseTo(100 - 4 - 4, 6);
  });
});

describe('tessellateGraph', () => {
  it('produces meshes and edges for a split square', () => {
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(2));
    s.drawLine(vec3(0,0,0), vec3(2,2,0));

    const data = tessellateGraph(s.graph);
    expect(data.faces).toHaveLength(2);
    expect(data.edges).toHaveLength(5);
    expect(tessellatedArea(data.faces)).toBeCloseTo(4, 6);
  });

  it('classifies edges for render weight', () => {
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(2));
    s.drawLine(vec3(0,0,0), vec3(2,2,0));
    const data = tessellateGraph(s.graph);
    const diag = data.edges.find(e => e.classification === 'manifold');
    expect(diag).toBeDefined(); // the shared diagonal
    expect(data.edges.filter(e => e.classification === 'boundary').length).toBe(4);
  });

  it('carries the material through to the mesh', () => {
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(2));
    [...s.graph.faces.values()][0]!.attributes.materialFront = 'brick';
    const data = tessellateGraph(s.graph);
    expect(data.faces[0]!.materialFront).toBe('brick');
  });

  it('emits UVs from the world-anchored basis', () => {
    // Two squares of different size must give the same UV at the same world
    // point — the continuity guarantee, visible at the render boundary. §6.3
    const a = new KernelSession({ cameraDirection: cam });
    a.drawChain(rect(2));
    const b = new KernelSession({ cameraDirection: cam });
    b.drawChain(rect(6));

    const ma = tessellateGraph(a.graph).faces[0]!;
    const mb = tessellateGraph(b.graph).faces[0]!;
    const uvAt = (m: typeof ma, x: number, y: number) => {
      for (let i = 0; i < m.positions.length / 3; i++) {
        if (Math.abs(m.positions[i*3]! - x) < 1e-9 && Math.abs(m.positions[i*3+1]! - y) < 1e-9) {
          return { u: m.uvs[i*2]!, v: m.uvs[i*2+1]! };
        }
      }
      return null;
    };
    const ua = uvAt(ma, 0, 0);
    const ub = uvAt(mb, 0, 0);
    expect(ua).not.toBeNull();
    expect(ub).not.toBeNull();
    expect(ua!.u).toBeCloseTo(ub!.u, 9);
    expect(ua!.v).toBeCloseTo(ub!.v, 9);
  });
});

describe('GPU buffers', () => {
  it('merges faces into single typed arrays with correct offsets', () => {
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(2));
    s.drawLine(vec3(0,0,0), vec3(2,2,0));
    const data = tessellateGraph(s.graph);
    const buf = mergeBuffers(data.faces);

    expect(buf.position).toBeInstanceOf(Float32Array);
    expect(buf.index.length).toBe(data.triangleCount * 3);
    expect(buf.faceOfTriangle).toHaveLength(data.triangleCount);
    // Every index must be in range after offsetting.
    const vertexCount = buf.position.length / 3;
    for (const i of buf.index) expect(i).toBeLessThan(vertexCount);
  });

  it('maps a triangle back to its kernel face', () => {
    // What makes a raycast hit selectable as a face rather than a triangle.
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(2));
    s.drawLine(vec3(0,0,0), vec3(2,2,0));
    const data = tessellateGraph(s.graph);
    const buf = mergeBuffers(data.faces);
    expect(new Set(buf.faceOfTriangle).size).toBe(2);
    for (const id of buf.faceOfTriangle) expect(s.graph.faces.has(id)).toBe(true);
  });

  it('excludes hidden edges from the line buffer', () => {
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(2));
    s.drawLine(vec3(0,0,0), vec3(2,2,0));
    const data = tessellateGraph(s.graph);
    const before = edgeBuffer(data.edges).position.length;

    for (const e of s.graph.edges.values()) { e.smooth = true; }
    const after = edgeBuffer(tessellateGraph(s.graph).edges).position.length;
    expect(after).toBeLessThan(before);
  });

  it('f32 conversion happens only here', () => {
    // Kernel coordinates stay f64; the boundary is the buffer. §10.3
    const s = new KernelSession({ cameraDirection: cam });
    s.drawChain(rect(2));
    const data = tessellateGraph(s.graph);
    expect(Array.isArray(data.faces[0]!.positions)).toBe(true);
    expect(mergeBuffers(data.faces).position).toBeInstanceOf(Float32Array);
  });
});

describe('determinism', () => {
  it('tessellates identically across runs', () => {
    const build = () => {
      const s = new KernelSession({ cameraDirection: cam });
      s.drawChain(rect(6));
      s.drawChain([vec3(2,2,0), vec3(4,2,0), vec3(4,4,0), vec3(2,4,0), vec3(2,2,0)]);
      const d = tessellateGraph(s.graph);
      return JSON.stringify(d.faces.map(f => f.indices));
    };
    expect(build()).toBe(build());
  });
});
