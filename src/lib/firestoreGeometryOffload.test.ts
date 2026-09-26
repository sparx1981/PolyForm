import { describe, it, expect, vi } from 'vitest';
import { offloadLargeGeometryForSave, hydrateOffloadedGeometry, withGeometryCache, type GeometryOffloadIO } from './firestoreGeometryOffload';
import type { Shape } from '../types';

function makeGeometryData(vertexCount: number) {
  const positions: number[] = [];
  for (let i = 0; i < vertexCount * 3; i++) positions.push(Math.random());
  return { positions, normals: positions.slice() };
}

describe('firestoreGeometryOffload', () => {
  it('leaves small shapes untouched', async () => {
    const shapes: Shape[] = [
      { id: 's1', type: 'box', position: [0, 0, 0], args: [1, 1, 1], color: '#fff', geometryData: makeGeometryData(3) },
    ];
    const upload = vi.fn();
    const result = await offloadLargeGeometryForSave(shapes, 'uid1', { upload, fetch: vi.fn() });
    expect(upload).not.toHaveBeenCalled();
    expect(result[0].geometryData).toEqual(shapes[0].geometryData);
  });

  it('offloads a shape whose geometryData exceeds the size threshold', async () => {
    // A dense standing-seam roof-tile mesh (thousands of vertices) is
    // exactly the case that previously pushed a Firestore document over
    // its 1 MiB limit with no way to trim it after the fact.
    const shapes: Shape[] = [
      { id: 'roof-tiles-1', type: 'custom', position: [0, 0, 0], args: [], color: '#fff', geometryData: makeGeometryData(5000) },
    ];
    const upload = vi.fn(async (_docId: string, _jsonText: string) => {});
    const result = await offloadLargeGeometryForSave(shapes, 'uid1', { upload, fetch: vi.fn() });

    expect(upload).toHaveBeenCalledTimes(1);
    const [docId, jsonText] = upload.mock.calls[0];
    expect(docId).toContain('uid1');
    expect(docId).toContain('roof-tiles-1');
    expect(JSON.parse(jsonText)).toEqual(shapes[0].geometryData);

    // The document-bound copy must be small regardless of how large the
    // original mesh was.
    expect(JSON.stringify(result[0].geometryData).length).toBeLessThan(500);
    expect((result[0].geometryData as any).__offloadedGeometryDocId).toBe(docId);
  });

  it('round-trips an offloaded shape through hydrateOffloadedGeometry', async () => {
    const original = makeGeometryData(5000);
    const shapes: Shape[] = [
      { id: 'roof-tiles-1', type: 'custom', position: [0, 0, 0], args: [], color: '#fff', geometryData: original },
    ];
    const store = new Map<string, string>();
    const io: GeometryOffloadIO = {
      upload: async (docId, jsonText) => { store.set(docId, jsonText); },
      fetch: async (docId) => {
        const text = store.get(docId);
        if (text === undefined) throw new Error('not found');
        return text;
      },
    };

    const saved = await offloadLargeGeometryForSave(shapes, 'uid1', io);
    const restored = await hydrateOffloadedGeometry(saved, io);
    expect(restored[0].geometryData).toEqual(original);
  });

  it('falls back to inline geometry if the upload itself fails', async () => {
    const shapes: Shape[] = [
      { id: 'roof-tiles-1', type: 'custom', position: [0, 0, 0], args: [], color: '#fff', geometryData: makeGeometryData(5000) },
    ];
    const io: GeometryOffloadIO = {
      upload: async () => { throw new Error('network error'); },
      fetch: vi.fn(),
    };
    const result = await offloadLargeGeometryForSave(shapes, 'uid1', io);
    expect(result[0].geometryData).toEqual(shapes[0].geometryData);
  });

  it('leaves a shape untouched when it has no offload marker', async () => {
    const shapes: Shape[] = [
      { id: 's1', type: 'box', position: [0, 0, 0], args: [1, 1, 1], color: '#fff', geometryData: makeGeometryData(3) },
    ];
    const fetch = vi.fn();
    const result = await hydrateOffloadedGeometry(shapes, { fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(result[0].geometryData).toEqual(shapes[0].geometryData);
  });

  it('saves unchanged geometry to the same document, and a cached IO neither rewrites nor rereads it', async () => {
    const shapes: Shape[] = [
      { id: 'roof-tiles-1', type: 'custom', position: [0, 0, 0], args: [], color: '#fff', geometryData: makeGeometryData(5000) },
    ];
    const store = new Map<string, string>();
    const upload = vi.fn(async (docId: string, text: string) => { store.set(docId, text); });
    const fetch = vi.fn(async (docId: string) => store.get(docId)!);
    const io = withGeometryCache({ upload, fetch });

    const first = await offloadLargeGeometryForSave(shapes, 'uid1', io);
    const second = await offloadLargeGeometryForSave(shapes, 'uid1', io);
    expect(second[0].geometryData).toEqual(first[0].geometryData);
    expect(upload).toHaveBeenCalledTimes(1);

    await hydrateOffloadedGeometry(second, io);
    await hydrateOffloadedGeometry(second, io);
    expect(fetch).not.toHaveBeenCalled();

    const changed = [{ ...shapes[0], geometryData: makeGeometryData(5000) }];
    const third = await offloadLargeGeometryForSave(changed, 'uid1', io);
    expect(third[0].geometryData).not.toEqual(first[0].geometryData);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('a cached IO reads a document it has not seen only once', async () => {
    const fetch = vi.fn(async () => '{"positions":[1,2,3]}');
    const io = withGeometryCache({ upload: vi.fn(), fetch });
    const shapes = [{ id: 'a', type: 'custom', geometryData: { __offloadedGeometryDocId: 'old_1' } }] as any as Shape[];
    await hydrateOffloadedGeometry(shapes, io);
    const [again] = await hydrateOffloadedGeometry(shapes, io);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(again.geometryData).toEqual({ positions: [1, 2, 3] });
  });
});
