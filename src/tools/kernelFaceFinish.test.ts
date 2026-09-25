import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { vec3 } from '../lib/geometry/math';
import { serializeGraph, deserializeGraph } from '../lib/geometry/serialize';
import { facesByRenderGroup, getFaceFinish, paintFace } from './kernelSelection';

const host = () => new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });

describe('kernel face finishes (library materials and plain PBR)', () => {
  it('stores, renders separately, and saves a face finish', () => {
    const h = host();
    const square = (x: number) => {
      const p = [vec3(x, 0, 0), vec3(x + 2, 0, 0), vec3(x + 2, 0, 2), vec3(x, 0, 2)];
      for (let i = 0; i < 4; i++) h.commitSegment(p[i]!, p[(i + 1) % 4]!);
    };
    square(0); square(5);
    const [a, b] = [...h.graph.faces.keys()];
    paintFace(h.graph, a!, '#b4b7ba', { roughness: 0.38, metalness: 1, opacity: 1 });
    paintFace(h.graph, b!, '#b4b7ba', { bindingId: 'ph:material:brick_wall', opacity: 1 });
    // Same colour, different finish: two render groups.
    expect(facesByRenderGroup(h.graph).length).toBe(2);
    const loaded = deserializeGraph(JSON.parse(JSON.stringify(serializeGraph(h.graph))));
    expect(getFaceFinish(loaded, a!)).toEqual({ roughness: 0.38, metalness: 1, opacity: 1 });
    expect(getFaceFinish(loaded, b!)?.bindingId).toBe('ph:material:brick_wall');
    // Painting a plain colour clears the finish.
    paintFace(h.graph, a!, '#ff0000', null);
    expect(getFaceFinish(h.graph, a!)).toBeUndefined();
  });
});
