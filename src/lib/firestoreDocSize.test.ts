import { describe, expect, it } from 'vitest';
import { assertModelFits, firestoreSize, ModelTooLargeError } from './firestoreDocSize';

describe('firestoreDocSize', () => {
  it('counts like Firestore: 8 per number, string bytes + 1, field names', () => {
    expect(firestoreSize([1, 2, 3])).toBe(24);
    expect(firestoreSize('abc')).toBe(4);
    expect(firestoreSize({ ab: 1 })).toBe(32 + 3 + 8);
  });

  it('lets a normal model through and names the largest parts of one that is too big', () => {
    expect(() => assertModelFits({ name: 'House', shapes: [{ name: 'Wall', position: [0, 0, 0] }] })).not.toThrow();
    const huge = { name: 'House', shapes: [{ name: 'Wall' }, { name: 'Roof Tiles', geometryData: { positions: new Array(200000).fill(0.5) } }] };
    let error: unknown;
    try { assertModelFits(huge); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ModelTooLargeError);
    expect((error as Error).message).toMatch(/too large to save.*Roof Tiles \(1\.5\d MB\)/);
  });
});
