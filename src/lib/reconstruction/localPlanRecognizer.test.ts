import { describe, expect, it } from 'vitest';
import { imageObservationToDraft } from './imageAdapter';
import { recogniseOrthogonalFloorPlan } from './localPlanRecognizer';

function image(width = 100, height = 80) {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  const setDark = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = 255;
  };
  return { width, height, data, setDark };
}

describe('local orthogonal plan recognition', () => {
  it('recognises thick horizontal and vertical wall bands', () => {
    const raster = image();
    for (let y = 9; y <= 11; y++) for (let x = 10; x <= 90; x++) raster.setDark(x, y);
    for (let x = 19; x <= 21; x++) for (let y = 10; y <= 70; y++) raster.setDark(x, y);

    const observation = recogniseOrthogonalFloorPlan(raster, {
      metresPerPixel: 0.05,
      minRunPx: 20,
      minCoverage: 0.1,
    });
    expect(observation.walls.length).toBeGreaterThanOrEqual(2);
    expect(observation.walls.some(w => w.start[1] === w.end[1])).toBe(true);
    expect(observation.walls.some(w => w.start[0] === w.end[0])).toBe(true);

    const draft = imageObservationToDraft(observation);
    expect(draft.coordinateSpace).toBe('metres');
    expect(draft.walls.every(w => Number.isFinite(w.start[0]) && Number.isFinite(w.end[1]))).toBe(true);
  });

  it('requires calibration before recognition', () => {
    const raster = image();
    expect(() => recogniseOrthogonalFloorPlan(raster, { metresPerPixel: 0 })).toThrow(/calibration scale/);
  });

  it('returns an uncertainty instead of inventing walls in a blank plan', () => {
    const raster = image();
    const observation = recogniseOrthogonalFloorPlan(raster, { metresPerPixel: 0.01 });
    expect(observation.walls).toHaveLength(0);
    expect(observation.uncertainties?.[0]).toMatch(/No strong/);
  });
});
