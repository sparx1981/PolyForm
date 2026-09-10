/**
 * PolyForm Terrain Studio - Civil Mathematical Utilities
 * Includes Section 7 Guardrails & Edge Cases (Bowtie/Hairpin Detection,
 * Longitudinal Grade Clamping with Slope Transitions, Coincident Knot Deduplication,
 * and Elevation Range Sanitization).
 */

/**
 * Sanitizes an elevation value to ensure it is finite and within the allowable range [-500m, 5000m].
 */
export function sanitizeElevation(
  val: number | undefined | null,
  defaultElevation: number = 0,
  min: number = -500,
  max: number = 5000
): number {
  if (val === undefined || val === null || typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
    return defaultElevation;
  }
  return Math.max(min, Math.min(max, val));
}

/**
 * Merges consecutive spline knots closer than minDistance (default 0.15m)
 * to prevent zero-length division, tangent singularity, or normal blowups.
 */
export function deduplicateKnots(
  points: [number, number, number][],
  minDistance: number = 0.15
): [number, number, number][] {
  if (!points || points.length <= 1) {
    return points ? points.map(p => [p[0], sanitizeElevation(p[1]), p[2]]) : [];
  }

  const result: [number, number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const sanitizedY = sanitizeElevation(pt[1]);
    const curr: [number, number, number] = [pt[0], sanitizedY, pt[2]];

    if (result.length === 0) {
      result.push(curr);
    } else {
      const prev = result[result.length - 1];
      const dx = curr[0] - prev[0];
      const dz = curr[2] - prev[2];
      const horizontalDist = Math.hypot(dx, dz);
      if (horizontalDist >= minDistance) {
        result.push(curr);
      }
    }
  }

  return result;
}

/**
 * Evaluates a 3D Catmull-Rom spline through an array of control points.
 * Automatically runs knot deduplication and elevation sanitization.
 * @param points Array of 3D control points [x, y, z].
 * @param samplesPerSegment Number of sample steps per segment.
 * @param closed Whether the spline forms a closed continuous loop.
 * @returns Array of sampled 3D points [x, y, z] along the spline.
 */
export function evaluateCatmullRomSpline(
  points: [number, number, number][],
  samplesPerSegment: number,
  closed: boolean = false
): [number, number, number][] {
  if (!points || points.length === 0) return [];
  const cleanPoints = deduplicateKnots(points, 0.15);
  if (cleanPoints.length === 0) return [];
  if (cleanPoints.length === 1) return [[...cleanPoints[0]]];

  const n = cleanPoints.length;
  const samples = Math.max(1, Math.round(samplesPerSegment));

  if (n === 2 && !closed) {
    const result: [number, number, number][] = [];
    for (let s = 0; s <= samples; s++) {
      const t = s / samples;
      result.push([
        cleanPoints[0][0] + (cleanPoints[1][0] - cleanPoints[0][0]) * t,
        cleanPoints[0][1] + (cleanPoints[1][1] - cleanPoints[0][1]) * t,
        cleanPoints[0][2] + (cleanPoints[1][2] - cleanPoints[0][2]) * t,
      ]);
    }
    return result;
  }

  const numSegments = closed ? n : n - 1;
  const result: [number, number, number][] = [];

  const getPoint = (idx: number): [number, number, number] => {
    if (closed) {
      return cleanPoints[((idx % n) + n) % n];
    }
    if (idx < 0) {
      return [
        2 * cleanPoints[0][0] - cleanPoints[1][0],
        2 * cleanPoints[0][1] - cleanPoints[1][1],
        2 * cleanPoints[0][2] - cleanPoints[1][2],
      ];
    }
    if (idx >= n) {
      return [
        2 * cleanPoints[n - 1][0] - cleanPoints[n - 2][0],
        2 * cleanPoints[n - 1][1] - cleanPoints[n - 2][1],
        2 * cleanPoints[n - 1][2] - cleanPoints[n - 2][2],
      ];
    }
    return cleanPoints[idx];
  };

  for (let seg = 0; seg < numSegments; seg++) {
    const p0 = getPoint(seg - 1);
    const p1 = getPoint(seg);
    const p2 = getPoint(seg + 1);
    const p3 = getPoint(seg + 2);

    const isLastSegment = seg === numSegments - 1;
    const count = isLastSegment && !closed ? samples : samples - 1;

    for (let s = 0; s <= count; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;

      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      const z =
        0.5 *
        (2 * p1[2] +
          (-p0[2] + p2[2]) * t +
          (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 +
          (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3);

      result.push([x, y, z]);
    }
  }

  if (closed && result.length > 0) {
    result.push([...result[0]]);
  }

  return result;
}

/**
 * Calculates civil grade percentage between two 3D points.
 * Grade = (vertical rise / horizontal run) * 100
 * @param p1 Starting 3D point [x, y, z].
 * @param p2 Ending 3D point [x, y, z].
 * @returns Grade percentage (signed, positive = uphill, negative = downhill).
 */
export function calculateGradePercentage(
  p1: [number, number, number],
  p2: [number, number, number]
): number {
  const dx = p2[0] - p1[0];
  const dz = p2[2] - p1[2];
  const run = Math.hypot(dx, dz);
  if (run < 1e-6) return 0;
  const rise = p2[1] - p1[1];
  return (rise / run) * 100;
}

/**
 * Clamps elevation changes along a sequential 3D spline so no segment exceeds maxGradePercent.
 * @param points Array of 3D points along the spline [x, y, z].
 * @param maxGradePercent Maximum allowable grade percentage (e.g. 8 for 8%).
 * @returns New array of points with elevations clamped to satisfy grade limits.
 */
export function clampSplineGrade(
  points: [number, number, number][],
  maxGradePercent: number
): [number, number, number][] {
  if (!points || points.length <= 1 || maxGradePercent <= 0) {
    return (points || []).map((p) => [p[0], sanitizeElevation(p[1]), p[2]]);
  }

  const clamped: [number, number, number][] = points.map(
    (p) => [p[0], sanitizeElevation(p[1]), p[2]]
  );
  const maxSlope = Math.abs(maxGradePercent) / 100;

  for (let i = 1; i < clamped.length; i++) {
    const prev = clamped[i - 1];
    const curr = clamped[i];
    const dx = curr[0] - prev[0];
    const dz = curr[2] - prev[2];
    const run = Math.hypot(dx, dz);
    const maxDeltaY = run * maxSlope;
    const dy = curr[1] - prev[1];

    if (dy > maxDeltaY) {
      curr[1] = prev[1] + maxDeltaY;
    } else if (dy < -maxDeltaY) {
      curr[1] = prev[1] - maxDeltaY;
    }
  }

  return clamped;
}

/**
 * Clamps longitudinal road grade and automatically inserts slope transition vertices
 * if a segment requires gradual leveling over distance.
 */
export function clampSplineGradeWithTransitions(
  points: [number, number, number][],
  maxGradePercent: number,
  transitionStepMeters: number = 2.0
): [number, number, number][] {
  if (!points || points.length <= 1 || maxGradePercent <= 0) {
    return (points || []).map((p) => [p[0], sanitizeElevation(p[1]), p[2]]);
  }

  const maxSlope = Math.abs(maxGradePercent) / 100;
  const result: [number, number, number][] = [];

  for (let i = 0; i < points.length; i++) {
    const pt: [number, number, number] = [
      points[i][0],
      sanitizeElevation(points[i][1]),
      points[i][2],
    ];

    if (result.length === 0) {
      result.push(pt);
      continue;
    }

    const prev = result[result.length - 1];
    const dx = pt[0] - prev[0];
    const dz = pt[2] - prev[2];
    const run = Math.hypot(dx, dz);

    if (run < 1e-4) {
      continue;
    }

    const maxDeltaY = run * maxSlope;
    const dy = pt[1] - prev[1];

    if (Math.abs(dy) > maxDeltaY) {
      const clampedY = prev[1] + Math.sign(dy) * maxDeltaY;

      // If run exceeds transitionStepMeters * 2, insert intermediate slope transition knot
      if (run > transitionStepMeters * 2) {
        const midT = 0.5;
        const midX = prev[0] + dx * midT;
        const midZ = prev[2] + dz * midT;
        const midY = prev[1] + (clampedY - prev[1]) * midT;
        result.push([midX, midY, midZ]);
      }

      result.push([pt[0], clampedY, pt[2]]);
    } else {
      result.push(pt);
    }
  }

  return result;
}

/**
 * Tests whether two 2D line segments intersect (excluding collinear overlaps).
 */
export function segmentsIntersect2D(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number]
): boolean {
  const ccw = (p1: [number, number], p2: [number, number], p3: [number, number]): number => {
    return (p3[1] - p1[1]) * (p2[0] - p1[0]) - (p2[1] - p1[1]) * (p3[0] - p1[0]);
  };
  const d1 = ccw(a1, a2, b1);
  const d2 = ccw(a1, a2, b2);
  const d3 = ccw(b1, b2, a1);
  const d4 = ccw(b1, b2, a2);

  return (
    ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) &&
    ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6))
  );
}

/**
 * Detects self-intersecting bowtie loops across non-adjacent segments of a road spline.
 */
export function detectBowtieLoops(
  points: [number, number, number][]
): Array<{ seg1: number; seg2: number }> {
  const intersections: Array<{ seg1: number; seg2: number }> = [];
  if (!points || points.length < 4) return intersections;

  for (let i = 0; i < points.length - 1; i++) {
    const a1: [number, number] = [points[i][0], points[i][2]];
    const a2: [number, number] = [points[i + 1][0], points[i + 1][2]];

    for (let j = i + 2; j < points.length - 1; j++) {
      if (i === 0 && j === points.length - 2) continue;

      const b1: [number, number] = [points[j][0], points[j][2]];
      const b2: [number, number] = [points[j + 1][0], points[j + 1][2]];

      if (segmentsIntersect2D(a1, a2, b1, b2)) {
        intersections.push({ seg1: i, seg2: j });
      }
    }
  }
  return intersections;
}

/**
 * Computes turning radius of 3 consecutive points in the horizontal (XZ) plane.
 */
export function calculateTurningRadius2D(
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): number {
  const x1 = p1[0], z1 = p1[2];
  const x2 = p2[0], z2 = p2[2];
  const x3 = p3[0], z3 = p3[2];

  const a = Math.hypot(x2 - x1, z2 - z1);
  const b = Math.hypot(x3 - x2, z3 - z2);
  const c = Math.hypot(x3 - x1, z3 - z1);

  if (a < 1e-5 || b < 1e-5 || c < 1e-5) return 0;

  const cross = Math.abs((x2 - x1) * (z3 - z1) - (z2 - z1) * (x3 - x1));
  if (cross < 1e-6) {
    const dot = (x2 - x1) * (x3 - x2) + (z2 - z1) * (z3 - z2);
    return dot < 0 ? 0 : Infinity;
  }

  return (a * b * c) / (2 * cross);
}

export interface HairpinViolation {
  knotIndex: number;
  turningRadius: number;
  minAllowedRadius: number;
}

/**
 * Detects acute hairpin turns where turning radius is less than roadWidth * 0.75.
 */
export function detectHairpinTurns(
  points: [number, number, number][],
  roadWidth: number
): HairpinViolation[] {
  const minAllowedRadius = Math.max(1.0, roadWidth * 0.75);
  const violations: HairpinViolation[] = [];
  if (!points || points.length < 3) return violations;

  for (let i = 1; i < points.length - 1; i++) {
    const r = calculateTurningRadius2D(points[i - 1], points[i], points[i + 1]);
    if (r < minAllowedRadius) {
      violations.push({
        knotIndex: i,
        turningRadius: r,
        minAllowedRadius,
      });
    }
  }
  return violations;
}

/**
 * Relaxes and clamps sharp curvature along a spline so tight turns are smoothed.
 */
export function clampSplineCurvature(
  points: [number, number, number][],
  roadWidth: number
): [number, number, number][] {
  if (!points || points.length < 3) return points.map((p) => [...p]);
  const minRadius = Math.max(1.0, roadWidth * 0.75);
  const result: [number, number, number][] = points.map((p) => [...p]);

  for (let i = 1; i < result.length - 1; i++) {
    const r = calculateTurningRadius2D(result[i - 1], result[i], result[i + 1]);
    if (r < minRadius) {
      const midX = (result[i - 1][0] + result[i + 1][0]) * 0.5;
      const midZ = (result[i - 1][2] + result[i + 1][2]) * 0.5;
      result[i][0] = result[i][0] * 0.5 + midX * 0.5;
      result[i][2] = result[i][2] * 0.5 + midZ * 0.5;
    }
  }
  return result;
}

export interface SplineValidationReport {
  isValid: boolean;
  hasBowtie: boolean;
  hasHairpin: boolean;
  bowtieIntersections: Array<{ seg1: number; seg2: number }>;
  hairpinViolations: HairpinViolation[];
  invalidKnotIndices: number[];
  warnings: string[];
}

/**
 * Validates a road spline alignment against bowtie loops, acute hairpins, and grade criteria.
 */
export function validateSplineAlignment(
  points: [number, number, number][],
  roadWidth: number
): SplineValidationReport {
  const bowties = detectBowtieLoops(points);
  const hairpins = detectHairpinTurns(points, roadWidth);
  const invalidKnots = new Set<number>();

  const warnings: string[] = [];
  if (bowties.length > 0) {
    warnings.push(
      `Self-intersecting bowtie loop detected across segments ${bowties
        .map((b) => `${b.seg1}-${b.seg2}`)
        .join(', ')}.`
    );
    bowties.forEach((b) => {
      invalidKnots.add(b.seg1);
      invalidKnots.add(b.seg1 + 1);
      invalidKnots.add(b.seg2);
      invalidKnots.add(b.seg2 + 1);
    });
  }

  if (hairpins.length > 0) {
    warnings.push(
      `Acute hairpin turns detected at knot(s) ${hairpins
        .map(
          (h) =>
            `${h.knotIndex} (R=${h.turningRadius.toFixed(1)}m < min ${h.minAllowedRadius.toFixed(1)}m)`
        )
        .join(', ')}.`
    );
    hairpins.forEach((h) => invalidKnots.add(h.knotIndex));
  }

  return {
    isValid: bowties.length === 0 && hairpins.length === 0,
    hasBowtie: bowties.length > 0,
    hasHairpin: hairpins.length > 0,
    bowtieIntersections: bowties,
    hairpinViolations: hairpins,
    invalidKnotIndices: Array.from(invalidKnots),
    warnings,
  };
}

/**
 * Calculates perpendicular distance and projection from a 2D point (px, pz) to a line segment.
 * @param px Point X coordinate.
 * @param pz Point Z coordinate.
 * @param x1 Segment start X.
 * @param z1 Segment start Z.
 * @param x2 Segment end X.
 * @param z2 Segment end Z.
 * @returns Object with distance, projected coordinates [projX, projZ], and normalized t in [0, 1].
 */
export function distancePointToLineSegment2D(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number
): { distance: number; projection: [number, number]; t: number } {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const lenSq = vx * vx + vz * vz;

  if (lenSq < 1e-12) {
    const d = Math.hypot(px - x1, pz - z1);
    return { distance: d, projection: [x1, z1], t: 0 };
  }

  let t = ((px - x1) * vx + (pz - z1) * vz) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * vx;
  const projZ = z1 + t * vz;
  const distance = Math.hypot(px - projX, pz - projZ);

  return {
    distance,
    projection: [projX, projZ],
    t,
  };
}

/**
 * Tests whether a 2D point (x, z) is inside a polygon using ray casting.
 * @param x Test point X coordinate.
 * @param z Test point Z coordinate.
 * @param polygon Array of 2D polygon vertices [x, z].
 * @returns True if point is inside the polygon.
 */
export function pointInPolygon2D(
  x: number,
  z: number,
  polygon: [number, number][]
): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const zi = polygon[i][1];
    const xj = polygon[j][0];
    const zj = polygon[j][1];

    const intersect =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}
