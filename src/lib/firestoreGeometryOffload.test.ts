import { describe, it, expect, vi } from 'vitest';
import { offloadLargeGeometryForSave, hydrateOffloadedGeometry, type GeometryOffloadIO } from './firestoreGeometryOffload';
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
    const uploadedUrl = 'https://storage.example.com/geometry-overflow/uid1/roof-tiles-1.json';
    const upload = vi.fn(async () => uploadedUrl);
    const result = await offloadLargeGeometryForSave(shapes, 'uid1', { upload, fetch: vi.fn() });

    expect(upload).toHaveBeenCalledTimes(1);
    const [path, jsonText] = upload.mock.calls[0];
    expect(path).toContain('uid1');
    expect(path).toContain('roof-tiles-1');
    expect(JSON.parse(jsonText)).toEqual(shapes[0].geometryData);

    // The document-bound copy must be small regardless of how large the
    // original mesh was.
    expect(JSON.stringify(result[0].geometryData).length).toBeLessThan(500);
    expect((result[0].geometryData as any).__offloadedGeometryUrl).toBe(uploadedUrl);
  });

  it('round-trips an offloaded shape through hydrateOffloadedGeometry', async () => {
    const original = makeGeometryData(5000);
    const shapes: Shape[] = [
      { id: 'roof-tiles-1', type: 'custom', position: [0, 0, 0], args: [], color: '#fff', geometryData: original },
    ];
    let storedJson = '';
    const io: GeometryOffloadIO = {
      upload: async (_path, jsonText) => { storedJson = jsonText; return 'https://storage.example.com/blob.json'; },
      fetch: async (url) => { expect(url).toBe('https://storage.example.com/blob.json'); return storedJson; },
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
});
