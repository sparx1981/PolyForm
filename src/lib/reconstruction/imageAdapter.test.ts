import { describe, expect, it } from 'vitest';
import { ImageReconstructionProviderRegistry, imageObservationToDraft } from './imageAdapter';

describe('image reconstruction adapter', () => {
  it('maps calibrated floor-plan pixels into PolyForm metres', () => {
    const draft = imageObservationToDraft({
      source: { kind: 'image', fileName: 'plan.png' },
      imageSize: [1000, 800],
      transform: { coordinateSpace: 'pixels', metresPerPixel: 0.01 },
      walls: [
        { id: 'north', start: [100, 100], end: [900, 100], confidence: 0.98 },
      ],
      rooms: [{ name: 'Kitchen', at: [500, 400], confidence: 0.9 }],
    });
    expect(draft.walls[0].start).toEqual([-4, -3]);
    expect(draft.walls[0].end).toEqual([4, -3]);
    expect(draft.rooms?.[0].at).toEqual([0, 0]);
    expect(draft.coordinateSpace).toBe('metres');
  });

  it('rotates recognised geometry into model coordinates', () => {
    const draft = imageObservationToDraft({
      source: { kind: 'photo', fileName: 'room.jpg' },
      transform: { coordinateSpace: 'metres', rotationY: Math.PI / 2 },
      walls: [{ id: 'w', start: [0, 0], end: [2, 0] }],
      furniture: [{ id: 'bed', type: 'bed', position: [1, 0], rotationY: 0 }],
    });
    expect(draft.walls[0].end[0]).toBeCloseTo(0);\n    expect(draft.walls[0].end[1]).toBeCloseTo(-2);
    expect(draft.furniture?.[0].rotationY).toBeCloseTo(Math.PI / 2);
  });

  it('supports swappable recognition providers', async () => {
    const registry = new ImageReconstructionProviderRegistry();
    registry.register({
      id: 'mock',
      recognise: async () => ({
        source: { kind: 'photo', fileName: 'room.jpg' },
        transform: { coordinateSpace: 'metres' },
        walls: [{ id: 'wall', start: [0, 0], end: [3, 0] }],
      }),
    });
    expect(registry.list()).toEqual(['mock']);
    const draft = await registry.reconstruct('mock', { imageDataUrl: 'data:image/jpeg;base64,x' });
    expect(draft.walls[0].id).toBe('wall');
  });

  it('rejects pixel observations without calibration', () => {
    expect(() => imageObservationToDraft({
      source: { kind: 'image' },
      imageSize: [100, 100],
      transform: { coordinateSpace: 'pixels' },
      walls: [{ id: 'wall', start: [0, 0], end: [10, 0] }],
    })).toThrow(/metresPerPixel/);
  });
});
