import { describe, it, expect } from 'vitest';
import { KernelArcHost } from './kernelArcHost';
import { createFilletBinding } from './kernelFillet';
import { pushPull } from '../lib/geometry/pushpull';
import { derive } from '../lib/geometry/derive';
import { vec3 } from '../lib/geometry/math';
import { checkIntegrity, getVertex, loopVertexIds } from '../lib/geometry/topology';
import type { Vec3 } from '../lib/geometry/types';

const host = () => new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });

/** Draws a closed outline on the ground and pushes it up into a solid. */
function extrude(h: KernelArcHost, outline: Vec3[], height: number) {
  for (let i = 0; i < outline.length; i++) h.commitSegment(outline[i]!, outline[(i + 1) % outline.length]!);
  const face = [...h.graph.faces.keys()][0]!;
  const r = pushPull({ graph: h.graph, tolerances: h.tolerances, index: h.spatialIndex }, face, height, { tolerances: h.tolerances });
  derive(h.graph, r.touched, h.deriveOptions);
}

function bounds(h: KernelArcHost) {
  let minY = Infinity, maxY = -Infinity, maxR = 0;
  for (const f of h.graph.faces.values()) {
    for (const vid of loopVertexIds(h.graph, f.outerLoop)) {
      const p = getVertex(h.graph, vid).position;
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); maxR = Math.max(maxR, Math.hypot(p.x, p.z));
    }
  }
  return { minY, maxY, maxR };
}

const shapes: Record<string, Vec3[]> = {
  'triangular prism': [vec3(0, 0, 0), vec3(4, 0, 0), vec3(2, 0, 3)],
  cylinder: Array.from({ length: 32 }, (_, i) => vec3(Math.cos(i / 32 * Math.PI * 2) * 2, 0, Math.sin(i / 32 * Math.PI * 2) * 2)),
  'L-shaped solid': [vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 1.5), vec3(1.5, 0, 1.5), vec3(1.5, 0, 4), vec3(0, 0, 4)],
  'hexagonal prism': Array.from({ length: 6 }, (_, i) => vec3(Math.cos(i / 6 * Math.PI * 2) * 2, 0, Math.sin(i / 6 * Math.PI * 2) * 2)),
};

describe('rounding straight extruded solids', () => {
  for (const [name, outline] of Object.entries(shapes)) {
    it(`rounds a ${name} into a valid closed solid`, () => {
      const h = host();
      extrude(h, outline, 2);
      const before = h.graph.faces.size;
      const b = createFilletBinding(h, () => {});
      const begun = b.begin([...h.graph.faces.keys()]);
      expect(begun.ok, begun.reason).toBe(true);
      b.update(0.3);
      const result = b.commit();
      expect(result.ok, result.reason).toBe(true);
      expect(h.graph.faces.size).toBeGreaterThan(before * 3);
      expect(checkIntegrity(h.graph)).toEqual([]);
      // Same overall size: nothing grows outside the original solid.
      const { minY, maxY } = bounds(h);
      expect(minY).toBeGreaterThan(-1e-6);
      expect(maxY).toBeLessThan(2 + 1e-6);
    });
  }

  it('can round again from the original shape, and back to sharp', () => {
    const h = host();
    extrude(h, shapes.cylinder!, 2);
    const sharpFaces = h.graph.faces.size;
    const b = createFilletBinding(h, () => {});
    b.begin([...h.graph.faces.keys()]); b.update(0.3); expect(b.commit().ok).toBe(true);
    const roundedFaces = h.graph.faces.size;
    // Re-apply with a bigger radius from the rounded solid.
    expect(b.begin([...h.graph.faces.keys()]).ok).toBe(true);
    b.update(0.6); expect(b.commit().ok).toBe(true);
    expect(h.graph.faces.size).toBe(roundedFaces);
    expect(checkIntegrity(h.graph)).toEqual([]);
    // Dragged back to zero: the sharp cylinder again.
    expect(b.begin([...h.graph.faces.keys()]).ok).toBe(true);
    b.update(0); expect(b.commit().ok).toBe(true);
    expect(h.graph.faces.size).toBe(sharpFaces);
  });

  it('still refuses shapes that are not straight extrusions', () => {
    const h = host();
    // A flat outline only: not a closed solid.
    for (const [a, c] of [[vec3(0, 0, 0), vec3(4, 0, 0)], [vec3(4, 0, 0), vec3(2, 0, 3)], [vec3(2, 0, 3), vec3(0, 0, 0)]] as [Vec3, Vec3][]) h.commitSegment(a, c);
    const b = createFilletBinding(h, () => {});
    expect(b.begin([...h.graph.faces.keys()]).ok).toBe(false);
  });
});
