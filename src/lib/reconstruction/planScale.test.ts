import { describe, expect, it } from 'vitest';
import { checkPlanScale, estimateScaleFromOverall, estimateScaleFromRooms, parsePrintedLength, parsePrintedSize } from './planScale';

const FT = 0.3048;

describe('parsePrintedSize', () => {
  it('reads feet, feet and inches, metric and shared units', () => {
    expect(parsePrintedSize("16' x 20'")).toEqual([16 * FT, 20 * FT]);
    const [a, b] = parsePrintedSize(`13'-6" x 12'-0"`)!;
    expect(a).toBeCloseTo(13.5 * FT, 6);
    expect(b).toBeCloseTo(12 * FT, 6);
    expect(parsePrintedSize('4.5 x 3.2 m')).toEqual([4.5, 3.2]);
    expect(parsePrintedSize('3600mm x 4200mm')).toEqual([3.6, 4.2]);
    expect(parsePrintedSize("16 x 20'")).toEqual([16 * FT, 20 * FT]);
    expect(parsePrintedSize("5'x11'")).toEqual([5 * FT, 11 * FT]);
  });
  it('rejects text it cannot be sure about', () => {
    expect(parsePrintedSize('16 x 20')).toBeNull();
    expect(parsePrintedSize('KITCHEN')).toBeNull();
    expect(parsePrintedSize("4'x4' SHWR")).toBeNull();
    expect(parsePrintedSize("3' x 12' ISLAND")).toBeNull();
    expect(parsePrintedSize("1' x 1'")).toBeNull();
  });
  it('reads overall dimensions', () => {
    expect(parsePrintedLength("WIDTH - 82'")).toBeCloseTo(82 * FT, 6);
    expect(parsePrintedLength('25 m')).toBe(25);
    expect(parsePrintedLength('hello')).toBeNull();
  });
});

describe('estimateScaleFromRooms', () => {
  const room = (w: number, d: number, mpp: number, noise = 1) => ({ printed: [w * FT, d * FT] as [number, number], measuredPx: [w * FT / mpp * noise, d * FT / mpp] as [number, number] });
  it('recovers the scale from several labelled rooms and ignores a bad outline', () => {
    const est = estimateScaleFromRooms([room(16, 20, 0.0143), room(13, 13, 0.0143), room(23, 23, 0.0143), room(14, 16, 0.0143), room(15, 18, 0.0143), room(12, 15, 0.0143, 2.4)])!;
    expect(est.metresPerPixel).toBeCloseTo(0.0143, 4);
    expect(est.samples).toBe(5);
    expect(est.confidence).toBe('high');
  });
  it('needs at least three usable rooms', () => {
    expect(estimateScaleFromRooms([room(16, 20, 0.0143), room(13, 13, 0.0143)])).toBeNull();
  });
});

describe('estimateScaleFromOverall', () => {
  it('uses both axes when they agree and none when they do not', () => {
    expect(estimateScaleFromOverall({ width: 25, depth: 30 }, [1000, 1200])!.metresPerPixel).toBeCloseTo(0.025, 3);
    expect(estimateScaleFromOverall({ width: 25, depth: 60 }, [1000, 1200])).toBeNull();
  });
});

describe('checkPlanScale', () => {
  const estimate = { metresPerPixel: 0.0143, samples: 6, spread: 0.03, basis: 'room sizes' as const, confidence: 'high' as const };
  it('offers the detected scale when the calibration is far off', () => {
    const check = checkPlanScale({ metresPerPixel: 0.0273, wallsPx: [1500, 1700], doorWidthsPx: [], estimate });
    expect(check.suggestion?.ratio).toBeCloseTo(0.0143 / 0.0273, 4);
    expect(check.suggestion?.buildingM[0]).toBeCloseTo(21.45, 1);
    expect(check.warnings[0]).toMatch(/room sizes/);
  });
  it('stays quiet when the calibration agrees', () => {
    expect(checkPlanScale({ metresPerPixel: 0.0145, wallsPx: [1500, 1700], doorWidthsPx: [60, 62, 61], estimate })).toEqual({ warnings: [], suggestion: undefined });
  });
  it('falls back to door and building size when the plan prints no sizes', () => {
    const big = checkPlanScale({ metresPerPixel: 0.0273, wallsPx: [1800, 2100], doorWidthsPx: [55, 56, 57], estimate: null });
    expect(big.warnings.join(' ')).toMatch(/Doors/);
    expect(big.warnings.join(' ')).toMatch(/unusually large/);
    expect(big.suggestion).toBeUndefined();
  });
});
