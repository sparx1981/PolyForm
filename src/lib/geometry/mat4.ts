/**
 * PolyForm geometry kernel — 4x4 affine transforms.
 *
 * Pulled forward from Phase 3b: this is pure, testable maths with no
 * dependency on topology, and Phase 3b is already oversized because PolyForm
 * has no container concept to build on.
 *
 * The distinction that matters: points transform by M, directions by M with
 * translation dropped, and normals by the INVERSE TRANSPOSE. Under a
 * non-uniform scale the three give different answers, and using M on a normal
 * yields a skewed plane that looks right and snaps wrong. §2.5.2
 *
 * Row-major, m[row * 4 + col].
 */

import type { Mat4, Vec3 } from './types';
import { normalize, tryNormalize } from './math';

export const IDENTITY: Mat4 = Object.freeze({
  m: Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
});

export const mat4 = (m: readonly number[]): Mat4 => {
  if (m.length !== 16) throw new Error(`Mat4 requires 16 elements, got ${m.length}`);
  return { m: [...m] };
};

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a.m[r * 4 + k]! * b.m[k * 4 + c]!;
      out[r * 4 + c] = sum;
    }
  }
  return { m: out };
}

export function transpose(a: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = a.m[r * 4 + c]!;
  return { m: out };
}

/** Determinant of the upper-left 3x3 — the part that carries scale and mirroring. */
export function determinant3(a: Mat4): number {
  const m = a.m;
  return (
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
    m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) +
    m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!)
  );
}

/**
 * Negative determinant means a mirrored container: a face whose local winding
 * is correct appears reversed in world space. Track the sign and account for
 * it when rendering front/back — do NOT "fix" it by reversing stored loops,
 * because the local geometry is correct and the transform is what describes
 * the mirror. §2.5.2
 */
export const determinantSign = (a: Mat4): 1 | -1 => (determinant3(a) < 0 ? -1 : 1);

export class SingularMatrixError extends Error {
  constructor() {
    super(
      'Matrix is not invertible. A container transform collapsed a dimension ' +
        '(a zero scale on some axis), so there is no way back to its local frame.',
    );
    this.name = 'SingularMatrixError';
  }
}

/** Full 4x4 inverse. Throws rather than returning a NaN-filled matrix. */
export function invert(a: Mat4): Mat4 {
  const m = a.m;
  const inv = new Array<number>(16).fill(0);

  inv[0] = m[5]! * m[10]! * m[15]! - m[5]! * m[11]! * m[14]! - m[9]! * m[6]! * m[15]! +
    m[9]! * m[7]! * m[14]! + m[13]! * m[6]! * m[11]! - m[13]! * m[7]! * m[10]!;
  inv[4] = -m[4]! * m[10]! * m[15]! + m[4]! * m[11]! * m[14]! + m[8]! * m[6]! * m[15]! -
    m[8]! * m[7]! * m[14]! - m[12]! * m[6]! * m[11]! + m[12]! * m[7]! * m[10]!;
  inv[8] = m[4]! * m[9]! * m[15]! - m[4]! * m[11]! * m[13]! - m[8]! * m[5]! * m[15]! +
    m[8]! * m[7]! * m[13]! + m[12]! * m[5]! * m[11]! - m[12]! * m[7]! * m[9]!;
  inv[12] = -m[4]! * m[9]! * m[14]! + m[4]! * m[10]! * m[13]! + m[8]! * m[5]! * m[14]! -
    m[8]! * m[6]! * m[13]! - m[12]! * m[5]! * m[10]! + m[12]! * m[6]! * m[9]!;
  inv[1] = -m[1]! * m[10]! * m[15]! + m[1]! * m[11]! * m[14]! + m[9]! * m[2]! * m[15]! -
    m[9]! * m[3]! * m[14]! - m[13]! * m[2]! * m[11]! + m[13]! * m[3]! * m[10]!;
  inv[5] = m[0]! * m[10]! * m[15]! - m[0]! * m[11]! * m[14]! - m[8]! * m[2]! * m[15]! +
    m[8]! * m[3]! * m[14]! + m[12]! * m[2]! * m[11]! - m[12]! * m[3]! * m[10]!;
  inv[9] = -m[0]! * m[9]! * m[15]! + m[0]! * m[11]! * m[13]! + m[8]! * m[1]! * m[15]! -
    m[8]! * m[3]! * m[13]! - m[12]! * m[1]! * m[11]! + m[12]! * m[3]! * m[9]!;
  inv[13] = m[0]! * m[9]! * m[14]! - m[0]! * m[10]! * m[13]! - m[8]! * m[1]! * m[14]! +
    m[8]! * m[2]! * m[13]! + m[12]! * m[1]! * m[10]! - m[12]! * m[2]! * m[9]!;
  inv[2] = m[1]! * m[6]! * m[15]! - m[1]! * m[7]! * m[14]! - m[5]! * m[2]! * m[15]! +
    m[5]! * m[3]! * m[14]! + m[13]! * m[2]! * m[7]! - m[13]! * m[3]! * m[6]!;
  inv[6] = -m[0]! * m[6]! * m[15]! + m[0]! * m[7]! * m[14]! + m[4]! * m[2]! * m[15]! -
    m[4]! * m[3]! * m[14]! - m[12]! * m[2]! * m[7]! + m[12]! * m[3]! * m[6]!;
  inv[10] = m[0]! * m[5]! * m[15]! - m[0]! * m[7]! * m[13]! - m[4]! * m[1]! * m[15]! +
    m[4]! * m[3]! * m[13]! + m[12]! * m[1]! * m[7]! - m[12]! * m[3]! * m[5]!;
  inv[14] = -m[0]! * m[5]! * m[14]! + m[0]! * m[6]! * m[13]! + m[4]! * m[1]! * m[14]! -
    m[4]! * m[2]! * m[13]! - m[12]! * m[1]! * m[6]! + m[12]! * m[2]! * m[5]!;
  inv[3] = -m[1]! * m[6]! * m[11]! + m[1]! * m[7]! * m[10]! + m[5]! * m[2]! * m[11]! -
    m[5]! * m[3]! * m[10]! - m[9]! * m[2]! * m[7]! + m[9]! * m[3]! * m[6]!;
  inv[7] = m[0]! * m[6]! * m[11]! - m[0]! * m[7]! * m[10]! - m[4]! * m[2]! * m[11]! +
    m[4]! * m[3]! * m[10]! + m[8]! * m[2]! * m[7]! - m[8]! * m[3]! * m[6]!;
  inv[11] = -m[0]! * m[5]! * m[11]! + m[0]! * m[7]! * m[9]! + m[4]! * m[1]! * m[11]! -
    m[4]! * m[3]! * m[9]! - m[8]! * m[1]! * m[7]! + m[8]! * m[3]! * m[5]!;
  inv[15] = m[0]! * m[5]! * m[10]! - m[0]! * m[6]! * m[9]! - m[4]! * m[1]! * m[10]! +
    m[4]! * m[2]! * m[9]! + m[8]! * m[1]! * m[6]! - m[8]! * m[2]! * m[5]!;

  const det = m[0]! * inv[0]! + m[1]! * inv[4]! + m[2]! * inv[8]! + m[3]! * inv[12]!;
  if (det === 0 || !Number.isFinite(det)) throw new SingularMatrixError();

  const invDet = 1 / det;
  return { m: inv.map((v) => v * invDet) };
}

/** The matrix normals transform by. Not the same as the inverse. §2.5.2 */
export const inverseTranspose = (a: Mat4): Mat4 => transpose(invert(a));

// ---------------------------------------------------------------------------
// Applying transforms
// ---------------------------------------------------------------------------

/** Point: full affine transform including translation. */
export function transformPoint(p: Vec3, a: Mat4): Vec3 {
  const m = a.m;
  const x = m[0]! * p.x + m[1]! * p.y + m[2]! * p.z + m[3]!;
  const y = m[4]! * p.x + m[5]! * p.y + m[6]! * p.z + m[7]!;
  const z = m[8]! * p.x + m[9]! * p.y + m[10]! * p.z + m[11]!;
  const w = m[12]! * p.x + m[13]! * p.y + m[14]! * p.z + m[15]!;
  return w !== 1 && w !== 0 ? { x: x / w, y: y / w, z: z / w } : { x, y, z };
}

/** Direction: rotation and scale, no translation. Not renormalised. */
export function transformDirection(d: Vec3, a: Mat4): Vec3 {
  const m = a.m;
  return {
    x: m[0]! * d.x + m[1]! * d.y + m[2]! * d.z,
    y: m[4]! * d.x + m[5]! * d.y + m[6]! * d.z,
    z: m[8]! * d.x + m[9]! * d.y + m[10]! * d.z,
  };
}

/**
 * Normal: transformed by the inverse transpose and renormalised.
 *
 * Pass the INVERSE TRANSPOSE here, not the forward matrix — the caller holds
 * the cached one (Container.cachedWorldInverseTranspose). Under a non-uniform
 * scale this is what keeps a normal perpendicular to its face; transforming it
 * as a direction produces a plane that is visibly plausible and subtly skewed,
 * which shows up as snapping that misses. §2.5.2
 */
export function transformNormal(n: Vec3, inverseTransposeMatrix: Mat4): Vec3 {
  return normalize(transformDirection(n, inverseTransposeMatrix), 'transformNormal');
}

/** Non-throwing variant for degenerate input. */
export function tryTransformNormal(n: Vec3, inverseTransposeMatrix: Mat4): Vec3 | null {
  return tryNormalize(transformDirection(n, inverseTransposeMatrix));
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

export const translation = (t: Vec3): Mat4 =>
  mat4([1, 0, 0, t.x, 0, 1, 0, t.y, 0, 0, 1, t.z, 0, 0, 0, 1]);

export const scaling = (s: Vec3): Mat4 =>
  mat4([s.x, 0, 0, 0, 0, s.y, 0, 0, 0, 0, s.z, 0, 0, 0, 0, 1]);

export function rotationAxisAngle(axis: Vec3, radians: number): Mat4 {
  const a = normalize(axis, 'rotationAxisAngle axis');
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const t = 1 - c;
  return mat4([
    t * a.x * a.x + c, t * a.x * a.y - s * a.z, t * a.x * a.z + s * a.y, 0,
    t * a.x * a.y + s * a.z, t * a.y * a.y + c, t * a.y * a.z - s * a.x, 0,
    t * a.x * a.z - s * a.y, t * a.y * a.z + s * a.x, t * a.z * a.z + c, 0,
    0, 0, 0, 1,
  ]);
}

/**
 * True when the transform preserves angles — no non-uniform scale, no shear.
 *
 * Callers use this to decide whether to warn on entering a container: under a
 * non-uniform scale, "perpendicular in world space" and "perpendicular in this
 * container" are genuinely different constraints, and axis locks will visibly
 * not align with the world axes. §2.5.2
 */
export function isAnglePreserving(a: Mat4, tolerance = 1e-9): boolean {
  const m = a.m;
  const cols: Vec3[] = [
    { x: m[0]!, y: m[4]!, z: m[8]! },
    { x: m[1]!, y: m[5]!, z: m[9]! },
    { x: m[2]!, y: m[6]!, z: m[10]! },
  ];
  const lens = cols.map((c) => Math.hypot(c.x, c.y, c.z));
  const [l0, l1, l2] = [lens[0]!, lens[1]!, lens[2]!];
  if (l0 === 0 || l1 === 0 || l2 === 0) return false;
  if (Math.abs(l0 - l1) > tolerance * l0 || Math.abs(l0 - l2) > tolerance * l0) return false;
  const d01 = (cols[0]!.x * cols[1]!.x + cols[0]!.y * cols[1]!.y + cols[0]!.z * cols[1]!.z) / (l0 * l1);
  const d02 = (cols[0]!.x * cols[2]!.x + cols[0]!.y * cols[2]!.y + cols[0]!.z * cols[2]!.z) / (l0 * l2);
  const d12 = (cols[1]!.x * cols[2]!.x + cols[1]!.y * cols[2]!.y + cols[1]!.z * cols[2]!.z) / (l1 * l2);
  return Math.abs(d01) < tolerance && Math.abs(d02) < tolerance && Math.abs(d12) < tolerance;
}
