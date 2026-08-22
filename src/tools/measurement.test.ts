import { describe, it, expect } from 'vitest';
import { parseMeasurement, formatLength, convert, isMeasurementKey } from './measurement';

const val = (s: string, u: Parameters<typeof parseMeasurement>[1] = 'm') => {
  const r = parseMeasurement(s, u);
  if (!r.ok) throw new Error(`expected success for "${s}": ${r.reason}`);
  return r.value;
};

describe('lengths', () => {
  it('parses a bare number in document units', () => {
    expect(val('2400')).toEqual({ kind: 'length', value: 2400 });
  });

  it('converts explicit units into document units', () => {
    expect(val('2400mm', 'm')).toEqual({ kind: 'length', value: 2.4 });
    expect(val('2.4m', 'mm')).toEqual({ kind: 'length', value: 2400 });
    expect(val('50cm', 'm')).toEqual({ kind: 'length', value: 0.5 });
  });

  it('accepts decimals and signs', () => {
    expect(val('.5')).toEqual({ kind: 'length', value: 0.5 });
    expect(val('-3.25')).toEqual({ kind: 'length', value: -3.25 });
  });

  it('accepts long-form unit names', () => {
    expect((val('3 metres') as { value: number }).value).toBeCloseTo(3, 9);
    expect((val('12 inches', 'in') as { value: number }).value).toBeCloseTo(12, 9);
  });
});

describe('imperial', () => {
  it("parses feet and inches", () => {
    // 8'6" = 102 inches = 2.5908 m
    const r = val(`8'6"`, 'm') as { value: number };
    expect(r.value).toBeCloseTo(2.5908, 6);
  });

  it('parses feet alone', () => {
    expect((val(`8'`, 'ft') as { value: number }).value).toBeCloseTo(8, 9);
  });

  it('parses inches alone', () => {
    expect((val(`6"`, 'in') as { value: number }).value).toBeCloseTo(6, 9);
  });

  it('handles a space between feet and inches', () => {
    expect((val(`8' 6"`, 'in') as { value: number }).value).toBeCloseTo(102, 9);
  });

  it('does not read 8\'6" as plain 8', () => {
    // Order matters: imperial is checked before the bare scalar.
    expect((val(`8'6"`, 'ft') as { value: number }).value).toBeCloseTo(8.5, 9);
  });

  it('applies the sign to the whole measurement', () => {
    expect((val(`-2'6"`, 'in') as { value: number }).value).toBeCloseTo(-30, 9);
  });
});

describe('coordinates', () => {
  it('parses absolute [x, y, z]', () => {
    expect(val('[1, 2, 3]')).toEqual({ kind: 'absolute', point: { x: 1, y: 2, z: 3 } });
  });

  it('parses relative <x, y, z>', () => {
    expect(val('<0, 0, 5>')).toEqual({ kind: 'relative', offset: { x: 0, y: 0, z: 5 } });
  });

  it('converts units inside a triple', () => {
    const r = val('[1000mm, 0, 0]', 'm') as { point: { x: number } };
    expect(r.point.x).toBeCloseTo(1, 9);
  });

  it('rejects the wrong number of components', () => {
    expect(parseMeasurement('[1, 2]').ok).toBe(false);
    expect(parseMeasurement('[1, 2, 3, 4]').ok).toBe(false);
  });
});

describe('arc suffixes', () => {
  it('parses a radius', () => {
    expect(val('24r')).toEqual({ kind: 'radius', value: 24 });
  });

  it('parses a radius with units', () => {
    expect((val('2400mmr', 'm') as { value: number }).value).toBeCloseTo(2.4, 9);
  });

  it('rejects a non-positive radius', () => {
    expect(parseMeasurement('0r').ok).toBe(false);
    expect(parseMeasurement('-5r').ok).toBe(false);
  });

  it('parses a segment count', () => {
    expect(val('12s')).toEqual({ kind: 'segments', count: 12 });
  });

  it('rejects a fractional or too-small segment count', () => {
    // A curve cannot have 2.5 segments, and rounding hides a typo.
    expect(parseMeasurement('2.5s').ok).toBe(false);
    expect(parseMeasurement('1s').ok).toBe(false);
    expect(parseMeasurement('5000s').ok).toBe(false);
  });

  it('does not read 24r as 24 with an unknown unit', () => {
    expect(val('24r').kind).toBe('radius');
    expect(val('24').kind).toBe('length');
  });
});

describe('angles', () => {
  it('parses degrees', () => {
    expect(val('45deg')).toEqual({ kind: 'angle', degrees: 45 });
    expect(val('90°')).toEqual({ kind: 'angle', degrees: 90 });
  });
});

describe('rejections', () => {
  it.each(['', '   ', 'abc', '1,2,3', '[]', '<>', '12 furlongs', '++5'])(
    'rejects %j', (input) => {
      expect(parseMeasurement(input).ok).toBe(false);
    });

  it('gives a reason', () => {
    const r = parseMeasurement('nonsense');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('nonsense');
  });
});

describe('formatting', () => {
  it('trims trailing zeros', () => {
    expect(formatLength(2.4, 'm')).toBe('2.4m');
    expect(formatLength(2.0, 'm')).toBe('2m');
  });

  it('formats feet and inches', () => {
    expect(formatLength(8.5, 'ft')).toBe(`8' 6"`);
    expect(formatLength(0.5, 'ft')).toBe(`6"`);
  });

  it('round-trips through the parser', () => {
    for (const v of [2.4, 0.001, 1234.5]) {
      const text = formatLength(v, 'm');
      const parsed = parseMeasurement(text, 'm');
      expect(parsed.ok).toBe(true);
      if (parsed.ok && parsed.value.kind === 'length') {
        expect(parsed.value.value).toBeCloseTo(v, 4);
      }
    }
  });
});

describe('unit conversion', () => {
  it('is symmetric', () => {
    expect(convert(convert(5, 'm', 'ft'), 'ft', 'm')).toBeCloseTo(5, 12);
  });
});

describe('keystroke routing', () => {
  it('claims characters the field needs', () => {
    for (const k of ['1', '.', "'", '"', '[', '<', 'r', 's', '-']) {
      expect(isMeasurementKey(k), k).toBe(true);
    }
    expect(isMeasurementKey('Backspace')).toBe(true);
  });

  it('passes through keys the tool needs', () => {
    for (const k of ['Escape', 'Enter', 'ArrowUp', 'Shift']) {
      expect(isMeasurementKey(k), k).toBe(false);
    }
  });
});
