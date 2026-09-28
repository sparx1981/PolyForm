import { describe, expect, it } from 'vitest';
import { osgb36ToGrid, toBritishGrid, toDutchGrid } from './projections';

// Reference values from PROJ (pyproj) with the same Helmert shift (EPSG:27700) and EPSG:28992.
describe('national grids', () => {
  it('matches the Ordnance Survey worked example for the Transverse Mercator step', () => {
    // OS "A guide to coordinate systems in Great Britain", annex C: 52°39'27.2531"N 1°43'4.5177"E.
    const g = osgb36ToGrid({ lat: 52 + 39 / 60 + 27.2531 / 3600, lng: 1 + 43 / 60 + 4.5177 / 3600 });
    expect(g.e).toBeCloseTo(651409.903, 2);
    expect(g.n).toBeCloseTo(313177.270, 2);
  });

  it.each([
    [51.500729, -0.124625, 530268.08, 179643.90],
    [55.9486, -3.1999, 325163.84, 673490.65],
    [50.0, -5.5, 149280.98, 16965.08],
    [57.5, -4.2, 268261.00, 847667.88],
  ])('British grid at %f, %f', (lat, lng, e, n) => {
    const g = toBritishGrid({ lat, lng });
    expect(Math.abs(g.e - e)).toBeLessThan(0.5);
    expect(Math.abs(g.n - n)).toBeLessThan(0.5);
  });

  it.each([
    [52.3731, 4.8922, 121290.51, 487362.28],
    [51.4416, 5.4697, 160735.81, 383614.76],
    [53.2194, 6.5665, 233769.70, 582065.42],
  ])('Dutch grid at %f, %f (within about a metre)', (lat, lng, e, n) => {
    const g = toDutchGrid({ lat, lng });
    expect(Math.abs(g.e - e)).toBeLessThan(2);
    expect(Math.abs(g.n - n)).toBeLessThan(2);
  });
});
