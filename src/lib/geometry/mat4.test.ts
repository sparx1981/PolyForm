import { describe, it, expect } from 'vitest';
import {
  IDENTITY, mat4, multiply, transpose, invert, inverseTranspose,
  determinant3, determinantSign, SingularMatrixError,
  transformPoint, transformDirection, transformNormal,
  translation, scaling, rotationAxisAngle, isAnglePreserving,
} from './mat4';
import { vec3, dot, normalize, length, distance, cross, sub } from './math';

const near = (a: number, b: number, p = 10) => expect(a).toBeCloseTo(b, p);

describe('basic matrix algebra', () => {
  it('multiplying by identity changes nothing', () => {
    const m = translation(vec3(1, 2, 3));
    expect(multiply(m, IDENTITY).m).toEqual(m.m);
    expect(multiply(IDENTITY, m).m).toEqual(m.m);
  });

  it('inverts and round-trips a point', () => {
    const m = multiply(translation(vec3(5, -2, 3)), rotationAxisAngle(vec3(0, 1, 0), 0.7));
    const p = vec3(1, 2, 3);
    const back = transformPoint(transformPoint(p, m), invert(m));
    near(distance(p, back), 0, 9);
  });

  it('throws on a singular matrix rather than producing NaN', () => {
    // A container scaled to zero on one axis has no way back to its local
    // frame. Fail loudly, as with normalize().
    expect(() => invert(scaling(vec3(1, 0, 1)))).toThrow(SingularMatrixError);
  });

  it('transposes correctly', () => {
    const m = mat4([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(transpose(m).m[1]).toBe(5);
    expect(transpose(transpose(m)).m).toEqual(m.m);
  });
});

describe('mirrored containers', () => {
  it('reports a negative determinant for a mirror', () => {
    expect(determinant3(scaling(vec3(-1, 1, 1)))).toBeLessThan(0);
    expect(determinantSign(scaling(vec3(-1, 1, 1)))).toBe(-1);
  });

  it('reports positive for an ordinary transform', () => {
    expect(determinantSign(rotationAxisAngle(vec3(0, 0, 1), 1.2))).toBe(1);
    expect(determinantSign(scaling(vec3(2, 3, 4)))).toBe(1);
  });

  it('treats a double mirror as unmirrored', () => {
    expect(determinantSign(scaling(vec3(-1, -1, 1)))).toBe(1);
  });
});

describe('points, directions and normals transform differently', () => {
  it('translation moves points but not directions', () => {
    const m = translation(vec3(10, 0, 0));
    expect(transformPoint(vec3(0, 0, 0), m).x).toBe(10);
    expect(transformDirection(vec3(1, 0, 0), m).x).toBe(1);
  });

  it('THE case: a normal under non-uniform scale needs the inverse transpose', () => {
    // A 2:1:1 scale. Take a face whose normal is the 45-degree direction
    // (1,1,0). Transforming that normal as a DIRECTION gives a vector that is
    // no longer perpendicular to the transformed face; the inverse transpose
    // keeps it perpendicular. This is the bug that makes On-Face snapping miss
    // inside a scaled container. §2.5.2
    const m = scaling(vec3(2, 1, 1));
    const it = inverseTranspose(m);

    // Two in-plane directions of the original face.
    const n = normalize(vec3(1, 1, 0));
    const t1 = normalize(vec3(1, -1, 0)); // perpendicular to n, in plane
    const t2 = vec3(0, 0, 1);             // also in plane

    const t1t = transformDirection(t1, m);
    const t2t = transformDirection(t2, m);

    const wrong = normalize(transformDirection(n, m));
    const right = transformNormal(n, it);

    // The correct normal stays perpendicular to both transformed tangents.
    near(dot(right, t1t) / (length(right) * length(t1t)), 0, 9);
    near(dot(right, t2t) / (length(right) * length(t2t)), 0, 9);

    // The naive one does not.
    expect(Math.abs(dot(wrong, t1t) / (length(wrong) * length(t1t)))).toBeGreaterThan(0.1);

    // And they are genuinely different vectors, not a rounding difference.
    expect(distance(wrong, right)).toBeGreaterThan(0.1);
  });

  it('inverse transpose agrees with the plain inverse under uniform scale', () => {
    // No non-uniform scale means no disagreement — which is why this bug
    // hides until someone scales a group on one axis.
    const m = multiply(translation(vec3(3, 1, 4)), scaling(vec3(2, 2, 2)));
    const n = normalize(vec3(1, 2, 3));
    const viaIT = transformNormal(n, inverseTranspose(m));
    const viaDir = normalize(transformDirection(n, m));
    near(distance(viaIT, viaDir), 0, 9);
  });

  it('keeps a normal perpendicular through a rotation', () => {
    const m = rotationAxisAngle(vec3(1, 1, 1), 0.9);
    const a = vec3(1, 0, 0);
    const b = vec3(0, 1, 0);
    const n = normalize(cross(a, b));
    const nt = transformNormal(n, inverseTranspose(m));
    const at = transformDirection(a, m);
    near(dot(nt, at), 0, 9);
  });

  it('renormalises the result', () => {
    near(length(transformNormal(vec3(0, 0, 1), inverseTranspose(scaling(vec3(5, 2, 9))))), 1);
  });
});

describe('nested container transforms', () => {
  it('round-trips a world point into a doubly-nested local frame', () => {
    // Phase 3b will do exactly this on every cross-context snap. §2.5.2
    const outer = multiply(translation(vec3(10, 0, 0)), rotationAxisAngle(vec3(0, 1, 0), 0.4));
    const inner = multiply(translation(vec3(0, 5, 0)), scaling(vec3(2, 2, 2)));
    const world = multiply(outer, inner);
    const worldInv = invert(world);

    const localPoint = vec3(1, 2, 3);
    const worldPoint = transformPoint(localPoint, world);
    const back = transformPoint(worldPoint, worldInv);
    near(distance(localPoint, back), 0, 9);
  });

  it('composes in the right order', () => {
    const t = translation(vec3(1, 0, 0));
    const s = scaling(vec3(2, 2, 2));
    // translate-then-scale differs from scale-then-translate
    expect(transformPoint(vec3(0, 0, 0), multiply(s, t)).x).toBe(2);
    expect(transformPoint(vec3(0, 0, 0), multiply(t, s)).x).toBe(1);
  });
});

describe('isAnglePreserving', () => {
  it('accepts rotation, translation and uniform scale', () => {
    expect(isAnglePreserving(IDENTITY)).toBe(true);
    expect(isAnglePreserving(rotationAxisAngle(vec3(0, 1, 0), 1.1))).toBe(true);
    expect(isAnglePreserving(translation(vec3(4, 5, 6)))).toBe(true);
    expect(isAnglePreserving(scaling(vec3(3, 3, 3)))).toBe(true);
  });

  it('rejects non-uniform scale', () => {
    // The trigger for the entry warning: axis locks will visibly not align
    // with world axes inside such a container. §2.5.2
    expect(isAnglePreserving(scaling(vec3(2, 1, 1)))).toBe(false);
  });

  it('rejects a collapsed axis', () => {
    expect(isAnglePreserving(scaling(vec3(1, 0, 1)))).toBe(false);
  });

  it('accepts a uniform mirror', () => {
    // Mirroring flips winding but preserves angles — a different problem,
    // handled by determinantSign.
    expect(isAnglePreserving(scaling(vec3(-1, -1, -1)))).toBe(true);
  });
});
