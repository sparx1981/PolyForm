import { describe, it, expect } from 'vitest';
import { daylightFactor, scaleForDaylight, NIGHT_LIGHT_FLOOR, sliderToSun, sunToSlider, DEFAULT_SUN, MAX_SUN } from './daylight';

describe('daylight', () => {
  it("is full at ordinary daylight and above, so day scenes do not change", () => {
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
    for (let s = 0; s <= 1.2; s += 0.05) {
      const d = daylightFactor(s);
      expect(d).toBeGreaterThanOrEqual(last);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
      last = d;
    }
    expect(daylightFactor(-3)).toBe(0);
  });

  it('maps the 0-100 slider: night, ordinary daylight at 50, a natural maximum, 40 by default', () => {
    expect(sliderToSun(0)).toBe(0);
    expect(sliderToSun(50)).toBe(1);
    expect(sliderToSun(100)).toBe(MAX_SUN);
    expect(DEFAULT_SUN).toBeCloseTo(0.8);
    for (const v of [0, 13, 40, 50, 77, 100]) expect(sunToSlider(sliderToSun(v))).toBeCloseTo(v);
    expect(sunToSlider(0.9)).toBeCloseTo(45);
    expect(daylightFactor(sliderToSun(50))).toBe(1);
    expect(daylightFactor(sliderToSun(40))).toBeLessThan(1);
  });
});
