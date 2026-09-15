import { describe, it, expect } from 'vitest';
import { cleanFirestoreDataForSave, restoreFirestoreArraysAfterLoad } from './firestoreArrayCodec';

describe('firestoreArrayCodec', () => {
  it('strips undefined values, matching the previous cleanFirestoreData/cleanData behavior', () => {
    const cleaned = cleanFirestoreDataForSave({ a: 1, b: undefined, c: { d: undefined, e: 2 } });
    expect(cleaned).toEqual({ a: 1, c: { e: 2 } });
  });

  it('leaves a plain array of primitives untouched', () => {
    const cleaned = cleanFirestoreDataForSave([1, 2, 3]);
    expect(cleaned).toEqual([1, 2, 3]);
    expect(Array.isArray(cleaned)).toBe(true);
  });

  it('round-trips a roofData-shaped object with [number, number][] point-list fields', () => {
    // The exact shape that triggers Firestore's "Nested arrays are not
    // supported" error: an array of shapes, one of which has a roofData
    // object carrying [number, number][] fields (localWallPoly,
    // localEavePoly) - a real array-of-arrays.
    const shapes = [
      { id: 'w1', type: 'wall', position: [0, 1, 0], args: [4, 2.8, 0.2] },
      {
        id: 'roof1',
        type: 'custom',
        position: [0, 2.4, 0],
        roofData: {
          ridgeHeight: 2.4,
          eaveOverhang: 0.35,
          isLShape: true,
          reflexIndex: 0,
          localWallPoly: [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]] as [number, number][],
          localEavePoly: [[-0.35, -0.35], [4.35, -0.35], [4.35, 2], [2, 2], [2, 4.35], [-0.35, 4.35]] as [number, number][],
          bounds: { width: 4, depth: 4 },
        },
      },
    ];

    const saved = cleanFirestoreDataForSave(shapes);

    // The nested-array field must no longer contain a raw array directly
    // inside another array - that's exactly what Firestore rejects.
    const stack = [saved];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        for (const v of node) {
          expect(Array.isArray(v)).toBe(false);
          stack.push(v);
        }
      } else if (node !== null && typeof node === 'object') {
        stack.push(...Object.values(node));
      }
    }

    const restored = restoreFirestoreArraysAfterLoad(saved);
    expect(restored).toEqual(shapes);
  });

  it('round-trips arbitrarily deep nested arrays', () => {
    const original = { grid: [[[1, 2], [3, 4]], [[5, 6], [7, 8]]] };
    const saved = cleanFirestoreDataForSave(original);
    const restored = restoreFirestoreArraysAfterLoad(saved);
    expect(restored).toEqual(original);
  });

  it('does not wrap an array of objects (already Firestore-safe)', () => {
    const original = { items: [{ x: 1 }, { x: 2 }] };
    const saved = cleanFirestoreDataForSave(original);
    expect(saved).toEqual(original);
    expect(Array.isArray(saved.items)).toBe(true);
  });
});
