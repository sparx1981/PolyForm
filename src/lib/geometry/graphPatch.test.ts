import { describe, it, expect } from 'vitest';
import { KernelArcHost } from '../../tools/kernelArcHost';
import { captureKernelState, diffKernelStates, applyKernelPatch } from './graphPatch';
import { commitKernelPushPull } from '../../tools/kernelPushPull';

const square = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }, { x: 0, y: 0, z: 2 }];

describe('kernel change sets', () => {
  it('reports no change for the same drawing', () => {
    const host = new KernelArcHost();
    host.commitIsolatedRing(square);
    expect(diffKernelStates(captureKernelState(host.graph), captureKernelState(host.graph))).toBeNull();
  });

  it('replays additions, changes and removals exactly', () => {
    const source = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } });
    const target = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } });
    const steps: Array<() => void> = [
      () => { source.commitIsolatedRing(square); },
      () => { commitKernelPushPull(source, [...source.graph.faces.keys()][0]!, 1.5); },
      () => { source.commitSegment({ x: 5, y: 0, z: 0 }, { x: 6, y: 0, z: 1 }); },
    ];
    for (const step of steps) {
      const before = captureKernelState(source.graph);
      step();
      const patch = diffKernelStates(before, captureKernelState(source.graph))!;
      expect(patch).not.toBeNull();
      // Through JSON, as a recorded script carries it.
      applyKernelPatch(target.graph, JSON.parse(JSON.stringify(patch)));
      target.refreshIndex();
      const a = captureKernelState(source.graph);
      const b = captureKernelState(target.graph);
      for (const kind of ['vertices', 'edges', 'loops', 'faces', 'curves'] as const) {
        expect(JSON.stringify([...b.records[kind].values()])).toBe(JSON.stringify([...a.records[kind].values()]));
      }
      expect(b.nextId).toEqual(a.nextId);
    }
    expect(target.graph.faces.size).toBeGreaterThan(1);
  });
});
