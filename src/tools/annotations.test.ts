import { describe, expect, it } from 'vitest';
import { KernelSession, vec3 } from '../lib/geometry';
import {
  areaLabelText, dimensionGeometry, isAnnotationShape, makeDimensionArgs, measureFace, resolveAreaFace,
} from './annotations';

describe('annotation shapes', () => {
  it('recognises the three kinds and nothing else', () => {
    expect(isAnnotationShape({ type: 'measurement', args: { kind: 'dimension' } })).toBe(true);
    expect(isAnnotationShape({ type: 'measurement', args: { kind: 'area' } })).toBe(true);
    expect(isAnnotationShape({ type: 'measurement', args: { kind: 'leader' } })).toBe(true);
    expect(isAnnotationShape({ type: 'measurement', args: { kind: 'guide' } })).toBe(false);
    expect(isAnnotationShape({ type: 'measurement', args: { start: [0, 0, 0] } })).toBe(false);
    expect(isAnnotationShape({ type: 'box', args: { kind: 'dimension' } })).toBe(false);
  });
});

describe('dimensionGeometry', () => {
  it('pushes the line out by the offset and draws extension lines back to the points', () => {
    const args = makeDimensionArgs([0, 0, 0], [4, 0, 0], [0, 0, 2]);
    expect(args.distance).toBe(4);
    const g = dimensionGeometry(args);
    expect(g.a).toEqual([0, 0, 2]);
    expect(g.b).toEqual([4, 0, 2]);
    expect(g.mid).toEqual([2, 0, 2]);
    expect(g.length).toBe(4);
    expect(g.extensions).toHaveLength(2);
    expect(g.extensions[0]![0]).toEqual([0, 0, 0]);
    expect(g.extensions[0]![1]![2]).toBeGreaterThan(2); // runs a little past the line
    expect(g.ticks).toHaveLength(2);
  });

  it('with no offset sits on the measured line and draws no extension lines', () => {
    const g = dimensionGeometry(makeDimensionArgs([0, 0, 0], [0, 3, 0], [0, 0, 0]));
    expect(g.extensions).toEqual([]);
    expect(g.length).toBe(3);
  });
});

describe('area labels', () => {
  const square = () => {
    const s = new KernelSession();
    s.drawChain([vec3(0, 0, 0), vec3(4, 0, 0), vec3(4, 0, 3), vec3(0, 0, 3), vec3(0, 0, 0)]);
    return s;
  };

  it('reads area and perimeter of a drawn face', () => {
    const s = square();
    const id = [...s.graph.faces.keys()][0]!;
    const m = measureFace(s.graph, id)!;
    expect(m.area).toBeCloseTo(12, 6);
    expect(m.perimeter).toBeCloseTo(14, 6);
  });

  it('takes a hole out of the area', () => {
    const s = square();
    s.drawChain([vec3(1, 0, 1), vec3(2, 0, 1), vec3(2, 0, 2), vec3(1, 0, 2), vec3(1, 0, 1)]);
    const ring = [...s.graph.faces.keys()].map(id => measureFace(s.graph, id)!).sort((a, b) => b.area - a.area)[0]!;
    expect(ring.area).toBeCloseTo(11, 6);
  });

  it('finds the face at its anchor when the face id is gone', () => {
    const s = square();
    const id = [...s.graph.faces.keys()][0]!;
    expect(resolveAreaFace(s.graph, { faceId: id, anchor: [1, 0, 1] })).toBe(id);
    expect(resolveAreaFace(s.graph, { faceId: -1, anchor: [1, 0, 1] })).toBe(id);
    expect(resolveAreaFace(s.graph, { faceId: -1, anchor: [10, 0, 10] })).toBeNull();
    expect(resolveAreaFace(s.graph, { faceId: -1, anchor: [1, 2, 1] })).toBeNull();
  });

  it('formats in the model unit', () => {
    const f = (m: number) => `${m.toFixed(1)} m`;
    expect(areaLabelText(12, 14, 'm', f)).toBe('12.00 m²  ·  14.0 m');
    expect(areaLabelText(12, 14, 'cm', f)).toBe('120,000 cm²  ·  14.0 m');
  });
});
