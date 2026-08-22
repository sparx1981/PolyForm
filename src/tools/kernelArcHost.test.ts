import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { ArcTool } from './arcTool';
import { LineTool } from './lineTool';
import { vec3, distance } from '../lib/geometry/math';
import { checkIntegrity } from '../lib/geometry/topology';
import { curveVertices } from '../lib/geometry/curve';

const cam = vec3(0, 0, -1);

describe('arcs against the real kernel', () => {
  it('an arc closed by a chord derives a face', () => {
    const host = new KernelArcHost({ cameraDirection: cam });
    const arc = new ArcTool(host);
    arc.activate('twoPoint');
    arc.click(vec3(0,0,0)); arc.click(vec3(2,0,0));
    arc.move(vec3(1,0.8,0)); arc.click(vec3(1,0.8,0));
    expect(host.graph.curves.size).toBe(1);

    const line = new LineTool(host);
    line.activate();
    line.click(vec3(0,0,0)); line.click(vec3(2,0,0)); line.escape();

    expect(host.graph.faces.size).toBe(1);
    expect(checkIntegrity(host.graph)).toEqual([]);
  });

  it('pie mode derives a filled wedge in one commit', () => {
    const host = new KernelArcHost({ cameraDirection: cam });
    const arc = new ArcTool(host);
    arc.activate('pie');
    arc.click(vec3(0,0,0)); arc.click(vec3(2,0,0));
    arc.move(vec3(0,2,0)); arc.click(vec3(0,2,0));
    expect(host.graph.faces.size).toBe(1);
    expect(checkIntegrity(host.graph)).toEqual([]);
  });

  it('an arc across a face splits it', () => {
    const host = new KernelArcHost({ cameraDirection: cam });
    const line = new LineTool(host);
    line.activate();
    for (const p of [vec3(0,0,0), vec3(4,0,0), vec3(4,4,0), vec3(0,4,0), vec3(0,0,0)]) line.click(p);
    expect(host.graph.faces.size).toBe(1);

    const arc = new ArcTool(host);
    arc.activate('twoPoint');
    arc.click(vec3(0,0,0)); arc.click(vec3(4,4,0));
    arc.move(vec3(3,1,0)); arc.click(vec3(3,1,0));

    expect(host.graph.faces.size).toBe(2);
    expect(checkIntegrity(host.graph)).toEqual([]);
  });

  it('one arc is one undo entry, not twelve', () => {
    // An arc's twelve edges enter together. The user drew one thing. §7.0
    const host = new KernelArcHost({ cameraDirection: cam });
    const arc = new ArcTool(host);
    arc.activate('twoPoint');
    arc.click(vec3(0,0,0)); arc.click(vec3(2,0,0));
    arc.move(vec3(1,0.8,0)); arc.click(vec3(1,0.8,0));
    expect(host.undoDepth).toBe(1);
    host.undo();
    expect(host.graph.edges.size).toBe(0);
    expect(host.graph.curves.size).toBe(0);
  });

  it('tangency picks up a real incoming edge', () => {
    const host = new KernelArcHost({ cameraDirection: cam });
    const line = new LineTool(host);
    line.activate();
    line.click(vec3(0,-2,0)); line.click(vec3(0,0,0)); line.escape();

    // The edge arrives at the origin travelling +y, so the tangent is +y.
    expect(host.incomingEdgeDirection(vec3(0,0,0))).not.toBeNull();
    expect(host.incomingEdgeDirection(vec3(9,9,9))).toBeNull();

    const arc = new ArcTool(host);
    arc.activate('twoPoint');
    arc.click(vec3(0,0,0));
    arc.click(vec3(2,0,0));
    const s = arc.move(vec3(1, 0.5, 0));
    expect(s.tangentActive).toBe(true);
  });

  it('the arc joins the existing edge without duplicating a vertex', () => {
    const host = new KernelArcHost({ cameraDirection: cam });
    const line = new LineTool(host);
    line.activate();
    line.click(vec3(0,-2,0)); line.click(vec3(0,0,0)); line.escape();
    const before = host.graph.vertices.size;

    const arc = new ArcTool(host);
    arc.activate('twoPoint');
    arc.click(vec3(0,0,0)); arc.click(vec3(2,0,0));
    arc.move(vec3(1,0.5,0)); arc.click(vec3(1,0.5,0));

    // Bound endpoint: the arc reuses the existing vertex rather than
    // creating one a fraction of a unit away. §5.5
    const atOrigin = [...host.graph.vertices.values()]
      .filter(v => distance(v.position, vec3(0,0,0)) < 1e-6);
    expect(atOrigin).toHaveLength(1);
    expect(host.graph.vertices.size).toBeGreaterThan(before);
  });

  it('curve order survives insertion into existing geometry', () => {
    const host = new KernelArcHost({ cameraDirection: cam });
    const arc = new ArcTool(host);
    arc.activate('twoPoint');
    arc.click(vec3(0,0,0)); arc.click(vec3(2,0,0));
    arc.move(vec3(1,0.8,0)); arc.click(vec3(1,0.8,0));

    const id = [...host.graph.curves.keys()][0]!;
    const verts = curveVertices(host.graph, id);
    expect(new Set(verts).size).toBe(verts.length);
    expect(verts.length).toBeGreaterThan(2);
  });
});

describe('degenerate tangency against the kernel', () => {
  it('dragging along the incoming edge produces a plain edge, not a curve', () => {
    const host = new KernelArcHost({ cameraDirection: cam });
    const line = new LineTool(host);
    line.activate();
    line.click(vec3(-2,0,0)); line.click(vec3(0,0,0)); line.escape();

    const arc = new ArcTool(host);
    arc.activate('twoPoint');
    arc.click(vec3(0,0,0));
    arc.click(vec3(2,0,0));   // straight on along the incoming edge
    arc.move(vec3(3,0,0));
    arc.click(vec3(3,0,0));

    expect(host.graph.curves.size).toBe(0);
    expect(host.graph.edges.size).toBe(2);
    expect(checkIntegrity(host.graph)).toEqual([]);
  });
});
