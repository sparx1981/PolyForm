import { describe, it, expect } from 'vitest';
import { KernelLineHost } from './kernelLineHost';
import { LineTool } from './lineTool';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity, removeFace } from '../lib/geometry/topology';

const cam = vec3(0, 0, -1);

describe('drawing a square through the tool produces a real face', () => {
  it('end to end: state machine -> kernel -> derived surface', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    const tool = new LineTool(host);
    tool.activate();
    for (const p of [vec3(0,0,0), vec3(2,0,0), vec3(2,2,0), vec3(0,2,0), vec3(0,0,0)]) {
      tool.click(p);
    }
    expect(host.graph.faces.size).toBe(1);
    expect(host.graph.edges.size).toBe(4);
    expect(checkIntegrity(host.graph)).toEqual([]);
    expect(tool.current.phase).toBe('ready');
  });

  it('a later line splits the face', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    const tool = new LineTool(host);
    tool.activate();
    for (const p of [vec3(0,0,0), vec3(2,0,0), vec3(2,2,0), vec3(0,2,0), vec3(0,0,0)]) tool.click(p);
    tool.click(vec3(0,0,0)); tool.click(vec3(2,2,0));
    tool.escape();
    expect(host.graph.faces.size).toBe(2);
  });

  it('typed lengths give exact geometry', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    const tool = new LineTool(host);
    tool.activate();
    tool.click(vec3(0, 0, 0));
    tool.move(vec3(1, 0, 0));
    for (const c of '2.4') tool.type(c);
    tool.enter();
    const positions = [...host.graph.vertices.values()].map(v => v.position.x).sort((a,b)=>a-b);
    expect(positions[1]).toBeCloseTo(2.4, 9);
  });
});

describe('undo semantics (§7.0)', () => {
  it('one undo entry per segment', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    const tool = new LineTool(host);
    tool.activate();
    tool.click(vec3(0,0,0)); tool.click(vec3(1,0,0)); tool.click(vec3(2,0,0));
    expect(host.undoDepth).toBe(2);
  });

  it('re-solve leaves ONE undo entry, not two', () => {
    // The user drew one segment and corrected it. Ctrl-Z should remove the
    // segment, not step backwards through their typing. §4.3
    const host = new KernelLineHost({ cameraDirection: cam });
    const tool = new LineTool(host);
    tool.activate();
    tool.click(vec3(0,0,0));
    tool.click(vec3(1,0,0));
    expect(host.undoDepth).toBe(1);

    for (const c of '5') tool.type(c);
    tool.enter();

    expect(host.undoDepth).toBe(1);
    const xs = [...host.graph.vertices.values()].map(v => v.position.x).sort((a,b)=>a-b);
    expect(xs[1]).toBeCloseTo(5, 9);

    host.undo();
    expect(host.graph.edges.size).toBe(0);
  });

  it('undo restores face ids identically', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    const tool = new LineTool(host);
    tool.activate();
    for (const p of [vec3(0,0,0), vec3(2,0,0), vec3(2,2,0), vec3(0,2,0), vec3(0,0,0)]) tool.click(p);
    const before = [...host.graph.faces.keys()];

    tool.click(vec3(0,0,0)); tool.click(vec3(2,2,0)); tool.escape();
    expect(host.graph.faces.size).toBe(2);

    host.undo();
    expect([...host.graph.faces.keys()]).toEqual(before);
  });

  it('rebuilds the spatial index after a rollback', () => {
    // The index is derived state; a stale one would offer candidates for
    // edges that no longer exist.
    const host = new KernelLineHost({ cameraDirection: cam });
    const tool = new LineTool(host);
    tool.activate();
    tool.click(vec3(0,0,0)); tool.click(vec3(2,0,0));
    host.undo();
    tool.deactivate();
    tool.activate();
    tool.click(vec3(0,0,0)); tool.click(vec3(2,0,0));
    expect(host.graph.edges.size).toBe(1);
    expect(checkIntegrity(host.graph)).toEqual([]);
  });
});

describe('retrace through the tool heals a deleted face', () => {
  it('a retrace adds no edge, is not rejected, and brings the face back', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    const tool = new LineTool(host);
    tool.activate();
    for (const p of [vec3(0,0,0), vec3(2,0,0), vec3(2,2,0), vec3(0,2,0), vec3(0,0,0)]) tool.click(p);
    expect(host.graph.faces.size).toBe(1);

    removeFace(host.graph, [...host.graph.faces.keys()][0]!);
    expect(host.graph.faces.size).toBe(0);

    tool.click(vec3(0,0,0));
    tool.click(vec3(2,0,0));
    tool.escape();

    expect(host.graph.edges.size).toBe(4);   // nothing new created
    expect(host.graph.faces.size).toBe(1);   // and the face is back
  });
});

describe('rejected commits', () => {
  it('a zero-length click is absorbed without touching the graph', () => {
    const host = new KernelLineHost({ cameraDirection: cam });
    const tool = new LineTool(host);
    tool.activate();
    tool.click(vec3(0,0,0));
    const s = tool.click(vec3(0,0,0));
    expect(host.graph.edges.size).toBe(0);
    expect(host.undoDepth).toBe(0);      // consumes no undo entry
    expect(s.phase).toBe('drawing');     // gesture continues
  });
});

describe('change notification', () => {
  it('fires once per successful commit', () => {
    let count = 0;
    const host = new KernelLineHost({ cameraDirection: cam, onChange: () => { count++; } });
    const tool = new LineTool(host);
    tool.activate();
    tool.click(vec3(0,0,0)); tool.click(vec3(1,0,0)); tool.click(vec3(2,0,0));
    expect(count).toBe(2);
  });

  it('does not fire for a rejected commit', () => {
    let count = 0;
    const host = new KernelLineHost({ cameraDirection: cam, onChange: () => { count++; } });
    const tool = new LineTool(host);
    tool.activate();
    tool.click(vec3(0,0,0));
    tool.click(vec3(0,0,0));
    expect(count).toBe(0);
  });
});
