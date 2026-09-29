import { describe, it, expect } from 'vitest';
import { daylightFactor, scaleForDaylight, NIGHT_LIGHT_FLOOR, sliderToSunIntensity, sunIntensityToSlider, MAX_SUN_INTENSITY } from './daylight';

describe('daylight', () => {
  it('is full at the default sun and above, so day scenes do not change', () => {
    expect(daylightFactor(1)).toBe(1);
    expect(daylightFactor(50)).toBe(1);
    expect(scaleForDaylight(daylightFactor(1))).toBe(1);
  });

  it('is night with the sun off: ambient falls to the floor', () => {
    expect(daylightFactor(0)).toBe(0);
    expect(scaleForDaylight(daylightFactor(0))).toBeCloseTo(NIGHT_LIGHT_FLOOR);
  });

  it('dims smoothly between, never below night or above day', () => {
    let last = -1;
    for (let s = 0; s <= 1.5; s += 0.05) {
      const d = daylightFactor(s);
      expect(d).toBeGreaterThanOrEqual(last);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      last = d;
    }
    expect(daylightFactor(-3)).toBe(0);
  });
});

describe('sun intensity slider', () => {
  it('puts the standard sun in the middle, night at the left and the brightest sun at the right', () => {
    expect(sliderToSunIntensity(0)).toBe(0);
    expect(sliderToSunIntensity(0.5)).toBe(1);
    expect(sliderToSunIntensity(1)).toBe(MAX_SUN_INTENSITY);
  });

  it('fades daylight down gradually across the whole lower half, not in the last few percent', () => {
    const at = (p: number) => daylightFactor(sliderToSunIntensity(p));
    expect(at(0.5)).toBe(1);
    expect(at(0.4)).toBeGreaterThan(0.85);
    expect(at(0.25)).toBeGreaterThan(0.3);
    expect(at(0.25)).toBeLessThan(0.7);
    expect(at(0.1)).toBeLessThan(0.15);
    expect(at(0)).toBe(0);
  });

  it('goes brighter above the middle, and round-trips', () => {
    expect(sliderToSunIntensity(0.75)).toBeGreaterThan(1);
    for (const p of [0, 0.1, 0.25, 0.5, 0.6, 0.75, 1]) expect(sunIntensityToSlider(sliderToSunIntensity(p))).toBeCloseTo(p, 6);
  });
});
