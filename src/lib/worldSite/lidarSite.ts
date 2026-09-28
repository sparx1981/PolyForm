/**
 * PolyForm — World View: turning LiDAR into ground, building heights and roofs.
 *
 * 1. Ground: the site's terrain grid from the bare-ground model (DTM), relative to its centre.
 * 2. Alignment: the map outlines and the LiDAR can be a few metres apart (datum shifts, older
 *    surveys). Where the surface model (DSM) stands 2.5 m or more above the ground there's
 *    something tall; the whole LiDAR is slid (up to 6 m) to where that best matches the outlines.
 * 3. Buildings: inside each outline (a little in from the walls) the roof is sampled every 0.5 m
 *    and the best of a few basic roofs fitted: flat, lean-to, gable (either way) or hipped
 *    (pyramid when square). A building the LiDAR doesn't show (built since the survey, or the
 *    outline is wrong) keeps its map height and is flagged "check height".
 *
 * Pure: the samplers are passed in, so it's tested with made-up surfaces.
 */

import type { Shape, SiteBuildingData, SiteRoof } from '../../types';
import { type LatLng, localToLatLng } from './geo';
import { roofTop } from './roofGeometry';

/** A height lookup in site metres (x east, z south), NaN where unknown. */
export type LocalSampler = (x: number, z: number) => number;

/**
 * A lat/lng sampler read once onto a grid in site metres (every `step` m over a square `extent`
 * m across), then sampled from that. The alignment search reads the surface millions of times;
 * projecting to the national grid for each read would take seconds.
 */
export function localGrid(origin: LatLng, extent: number, step: number, sample: (p: LatLng) => number): LocalSampler {
  const n = Math.round(extent / step) + 1;
  const x0 = -extent / 2;
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = sample(localToLatLng(origin, x0 + i * step, x0 + j * step));
  return (x, z) => {
    const fi = (x - x0) / step, fj = (z - x0) / step;
    if (fi < 0 || fj < 0 || fi > n - 1 || fj > n - 1) return NaN;
    const i0 = Math.min(n - 2, Math.floor(fi)), j0 = Math.min(n - 2, Math.floor(fj));
    const ti = fi - i0, tj = fj - j0;
    const a = data[j0 * n + i0]!, b = data[j0 * n + i0 + 1]!, c = data[(j0 + 1) * n + i0]!, d = data[(j0 + 1) * n + i0 + 1]!;
    // Cells with no data (NaN, the only value not equal to itself) are left out of the blend.
    let sum = 0, weight = 0, w: number;
    if (a === a) { w = (1 - ti) * (1 - tj); sum += a * w; weight += w; }
    if (b === b) { w = ti * (1 - tj); sum += b * w; weight += w; }
    if (c === c) { w = (1 - ti) * tj; sum += c * w; weight += w; }
    if (d === d) { w = ti * tj; sum += d * w; weight += w; }
    return weight > 0.05 ? sum / weight : NaN;
  };
}

/** Median of numbers (NaN for none). */
export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ── 1. Ground ──────────────────────────────────────────────────────────────────────────────

/**
 * The site's height grid (row 0 north, 1 m apart) from the DTM, relative to its centre, with
 * gaps (water, missing tiles) filled from `fallback` (already relative to the centre).
 */
export function lidarGround(size: number, n: number, dtm: LocalSampler, fallback: (x: number, z: number) => number): { heights: number[]; elevation: number } | null {
  const raw: number[] = new Array(n * n);
  let found = 0;
  for (let j = 0; j < n; j++) {
    const z = -size / 2 + (j * size) / (n - 1);
    for (let i = 0; i < n; i++) {
      const v = dtm(-size / 2 + (i * size) / (n - 1), z);
      raw[j * n + i] = v;
      if (Number.isFinite(v)) found++;
    }
  }
  if (found < n * n * 0.3) return null;
  let elevation = dtm(0, 0);
  if (!Number.isFinite(elevation)) {
    // The centre has no data: match the LiDAR to the fallback where both exist.
    const diffs: number[] = [];
    raw.forEach((v, k) => { if (Number.isFinite(v)) diffs.push(v - fallback(-size / 2 + ((k % n) * size) / (n - 1), -size / 2 + (Math.floor(k / n) * size) / (n - 1))); });
    elevation = median(diffs);
  }
  const heights = raw.map((v, k) => {
    const x = -size / 2 + ((k % n) * size) / (n - 1), z = -size / 2 + (Math.floor(k / n) * size) / (n - 1);
    return Math.round((Number.isFinite(v) ? v - elevation : fallback(x, z)) * 1000) / 1000;
  });
  return { heights, elevation };
}

// ── Geometry helpers ───────────────────────────────────────────────────────────────────────

type P = [number, number];

export function pointInPolygon(x: number, z: number, ring: P[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToEdges(x: number, z: number, ring: P[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/** Points every `step` metres inside a ring, at least `inset` from its edges. */
export function interiorPoints(ring: P[], step: number, inset: number): P[] {
  const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
  const out: P[] = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      if (pointInPolygon(x, z, ring) && distanceToEdges(x, z, ring) >= inset) out.push([x, z]);
    }
  }
  return out;
}

/** The smallest rectangle round a ring: its centre, direction (unit vector along its length) and half sizes. */
export function minimumRectangle(ring: P[]): { cx: number; cz: number; ux: number; uz: number; halfLength: number; halfWidth: number } {
  let best = { area: Infinity, cx: 0, cz: 0, ux: 1, uz: 0, halfLength: 0, halfWidth: 0 };
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area - 1e-9) {
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      const along = maxU - minU >= maxV - minV;
      best = {
        area,
        cx: cu * ux - cv * uz,
        cz: cu * uz + cv * ux,
        ux: along ? ux : -uz,
        uz: along ? uz : ux,
        halfLength: Math.max(maxU - minU, maxV - minV) / 2,
        halfWidth: Math.min(maxU - minU, maxV - minV) / 2,
      };
    }
  }
  const { area: _area, ...rect } = best;
  return rect;
}

// ── 2. Alignment ───────────────────────────────────────────────────────────────────────────

/**
 * The shift (metres, applied to where the LiDAR is read) that best lines up "something tall" in
 * the LiDAR with the building outlines: [0, 0] unless moving clearly helps. Outlines are in site
 * coordinates.
 */
export function alignmentShift(outlines: P[][], tall: (x: number, z: number) => boolean, maxShift = 6): P {
  const inside: P[] = [];
  const ring: P[] = [];
  for (const o of outlines) {
    for (const p of interiorPoints(o, 1, 0.5)) inside.push(p);
    // A band just outside the walls, where there should be nothing tall.
    for (const p of interiorPoints(bufferBox(o, 2.5), 1, 0)) if (!pointInPolygon(p[0], p[1], o) && distanceToEdges(p[0], p[1], o) > 0.8) ring.push(p);
  }
  if (inside.length < 20) return [0, 0];
  const score = (sx: number, sz: number) => {
    let s = 0;
    for (const [x, z] of inside) if (tall(x + sx, z + sz)) s++;
    for (const [x, z] of ring) if (tall(x + sx, z + sz)) s -= 0.5;
    return s;
  };
  const zero = score(0, 0);
  let best: P = [0, 0], bestScore = zero;
  for (let sx = -maxShift; sx <= maxShift; sx += 1) for (let sz = -maxShift; sz <= maxShift; sz += 1) {
    const s = score(sx, sz);
    if (s > bestScore) { bestScore = s; best = [sx, sz]; }
  }
  const [bx, bz] = best;
  for (let sx = bx - 0.5; sx <= bx + 0.5; sx += 0.5) for (let sz = bz - 0.5; sz <= bz + 0.5; sz += 0.5) {
    const s = score(sx, sz);
    if (s > bestScore) { bestScore = s; best = [sx, sz]; }
  }
  // Only move for a clear gain, so noise never drags good data about.
  return bestScore > zero + Math.max(5, inside.length * 0.04) ? best : [0, 0];
}

/** An outline's bounding box grown by `d`, as a ring. */
function bufferBox(ring: P[], d: number): P[] {
  const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
  const x0 = Math.min(...xs) - d, x1 = Math.max(...xs) + d, z0 = Math.min(...zs) - d, z1 = Math.max(...zs) + d;
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

// ── 3. Roofs ───────────────────────────────────────────────────────────────────────────────

/** Roof surface points (x, z in the building's own plan frame; h above its base). */
export interface RoofSample { x: number; z: number; h: number }

type Plane = [number, number, number];

/** Least squares for z = a*x + b*z + c. */
function fitPlane(pts: RoofSample[]): Plane | null {
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sh = 0, sxh = 0, szh = 0;
  const n = pts.length;
  for (const p of pts) {
    sxx += p.x * p.x; sxz += p.x * p.z; szz += p.z * p.z; sx += p.x; sz += p.z; sh += p.h; sxh += p.x * p.h; szh += p.z * p.h;
  }
  // Solve [sxx sxz sx; sxz szz sz; sx sz n] [a b c] = [sxh szh sh].
  const m = [[sxx, sxz, sx, sxh], [sxz, szz, sz, szh], [sx, sz, n, sh]];
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    if (Math.abs(m[pivot]![c]!) < 1e-9) return null;
    [m[c], m[pivot]] = [m[pivot]!, m[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k < 4; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

/** Least squares for h = eave + slope * g. */
function fitShape(pts: RoofSample[], g: (x: number, z: number) => number): { eave: number; slope: number } | null {
  let sg = 0, sgg = 0, sh = 0, sgh = 0;
  const n = pts.length;
  for (const p of pts) { const v = g(p.x, p.z); sg += v; sgg += v * v; sh += p.h; sgh += v * p.h; }
  const det = n * sgg - sg * sg;
  if (Math.abs(det) < 1e-9) return null;
  const slope = (n * sgh - sg * sh) / det;
  return { eave: (sh - slope * sg) / n, slope };
}

interface Candidate {
  roof: Omit<SiteRoof, 'eave' | 'ridge'>;
  predict: (x: number, z: number) => number;
  params: number;
}

/**
 * Fits the basic roofs to trimmed samples and picks the best (fewer parameters win ties). `ring`
 * is the outline in the same frame as the samples. Null when nothing fits well.
 */
export function fitRoof(samples: RoofSample[], ring: P[]): SiteRoof | null {
  if (samples.length < 8) return null;
  const rect = minimumRectangle(ring);
  const { cx, cz, ux, uz, halfLength: L, halfWidth: W } = rect;
  const u = (x: number, z: number) => (x - cx) * ux + (z - cz) * uz;
  const v = (x: number, z: number) => -(x - cx) * uz + (z - cz) * ux;

  // Planes of each roof in the building's frame: h = a*x + b*z + c, the roof being their minimum.
  // An expression c0 + s*(k - u) is written in x/z through u's own coefficients.
  const uPlane = (eave: number, s: number, k: number, sign: number): Plane => {
    // eave + s*(k - sign*u)
    const a = -s * sign * ux, b = -s * sign * uz;
    return [a, b, eave + s * k + s * sign * (cx * ux + cz * uz)];
  };
  const vPlane = (eave: number, s: number, k: number, sign: number): Plane => {
    // eave + s*(k - sign*v), v = -(x-cx)*uz + (z-cz)*ux
    const a = s * sign * uz, b = -s * sign * ux;
    return [a, b, eave + s * k - s * sign * (cx * uz - cz * ux)];
  };

  const shapes: { kind: SiteRoof['shape']; g: (x: number, z: number) => number; planes: (e: number, s: number) => Plane[] }[] = [
    { kind: 'gable', g: (x, z) => W - Math.abs(v(x, z)), planes: (e, s) => [vPlane(e, s, W, 1), vPlane(e, s, W, -1)] },
    { kind: 'gable', g: (x, z) => L - Math.abs(u(x, z)), planes: (e, s) => [uPlane(e, s, L, 1), uPlane(e, s, L, -1)] },
    {
      kind: Math.abs(L - W) < 0.15 * L ? 'pyramid' : 'hip',
      g: (x, z) => Math.min(W - Math.abs(v(x, z)), L - Math.abs(u(x, z))),
      planes: (e, s) => [vPlane(e, s, W, 1), vPlane(e, s, W, -1), uPlane(e, s, L, 1), uPlane(e, s, L, -1)],
    },
  ];

  // Fit, then refit without the outliers (chimneys, dormers, trees over the roof). Every model is
  // then scored the same way on all the samples: the root mean square of its best 85% of errors.
  const robust = <T>(fit: (pts: RoofSample[]) => T | null, predict: (t: T, x: number, z: number) => number) => {
    let result = fit(samples);
    for (let round = 0; round < 2 && result; round++) {
      const r = result;
      const errors = samples.map(p => Math.abs(p.h - predict(r, p.x, p.z)));
      const limit = Math.max(0.25, 3 * median(errors));
      const kept = samples.filter((_, i) => errors[i]! <= limit);
      if (kept.length < 8) break;
      result = fit(kept);
    }
    if (!result) return null;
    const r = result;
    const errors = samples.map(p => (p.h - predict(r, p.x, p.z)) ** 2).sort((a, b) => a - b);
    const best = errors.slice(0, Math.max(1, Math.ceil(errors.length * 0.85)));
    return { result: r, rmse: Math.sqrt(best.reduce((a, e) => a + e, 0) / best.length) };
  };

  const candidates: (Candidate & { rmse: number })[] = [];
  const flat = robust(pts => ({ h: median(pts.map(p => p.h)) }), r => r.h);
  if (flat) candidates.push({ roof: { shape: 'flat', planes: [[0, 0, flat.result.h]], pitch: 0 }, predict: () => flat.result.h, params: 1, rmse: flat.rmse });
  const lean = robust(fitPlane, (p, x, z) => p[0] * x + p[1] * z + p[2]);
  if (lean) {
    const [a, b] = lean.result;
    const pitch = Math.atan(Math.hypot(a, b)) * (180 / Math.PI);
    candidates.push({ roof: { shape: 'skillion', planes: [lean.result], pitch }, predict: (x, z) => a * x + b * z + lean.result[2], params: 3, rmse: lean.rmse });
  }
  for (const s of shapes) {
    const fit = robust(pts => fitShape(pts, s.g), (r, x, z) => r.eave + r.slope * s.g(x, z));
    if (!fit || fit.result.slope <= 0.05) continue;
    const { eave, slope } = fit.result;
    candidates.push({
      roof: { shape: s.kind, planes: s.planes(eave, slope), pitch: Math.atan(slope) * (180 / Math.PI) },
      predict: (x, z) => eave + slope * s.g(x, z),
      params: 2,
      rmse: fit.rmse,
    });
  }
  if (!candidates.length) return null;

  // Nearly flat, or fitting flat nearly as well: it's flat.
  const flatOne = candidates.find(c => c.roof.shape === 'flat');
  const sloped = candidates.filter(c => c.roof.shape !== 'flat' && c.roof.pitch >= 7 && c.roof.pitch <= 65);
  const best = sloped.sort((a, b) => a.rmse * (1 + 0.04 * a.params) - b.rmse * (1 + 0.04 * b.params))[0];
  const chosen = !best || (flatOne && flatOne.rmse < Math.max(0.25, best.rmse * 1.2)) ? flatOne! : best;
  if (!chosen) return null;

  // Eaves and ridge over the outline itself.
  const eave = Math.min(...ring.map(([x, z]) => chosen.predict(x, z)));
  const ridge = roofTop(chosen.roof.planes, ring);
  return { ...chosen.roof, eave: round2(eave), ridge: round2(ridge), planes: chosen.roof.planes.map(p => p.map(round4) as Plane) };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round4 = (v: number) => Math.round(v * 10000) / 10000;

// ── Putting it together ────────────────────────────────────────────────────────────────────

/** Shortest wall height a fitted roof may have, and the tallest roof believed. */
const MIN_EAVE = 1.8;
const MAX_ROOF_RISE = 15;

/**
 * Buildings with LiDAR heights and roofs. `ground` is the site's ground (model y), `dsm` the
 * surface model relative to the site's centre elevation (model y), both in site metres before
 * `shift` is applied.
 */
export function lidarBuildings(buildings: Shape[], dsm: LocalSampler, ground: LocalSampler, shift: P): Shape[] {
  return buildings.map(b => {
    const data = b.siteBuildingData;
    if (!data) return b;
    const [px, py, pz] = b.position;
    const ring = data.footprint;
    const pts = interiorPoints(ring, 0.5, Math.min(0.6, Math.sqrt(ringArea(ring)) / 8));
    const samples: RoofSample[] = [];
    const above: number[] = [];
    for (const [x, z] of pts) {
      const s = dsm(px + x + shift[0], pz + z + shift[1]);
      if (!Number.isFinite(s)) continue;
      samples.push({ x, z, h: s - py });
      above.push(s - ground(px + x, pz + z));
    }
    // No survey here: nothing to go on, and nothing to flag.
    if (samples.length < Math.max(4, pts.length * 0.3)) return b;

    // The survey shows open ground where the map has a building.
    if (median(above) < 2) {
      return { ...b, siteBuildingData: { ...data, heightCheck: true } };
    }

    const roof = data.holes?.length ? null : fitRoof(samples, ring);
    const { heightCheck: _check, roof: _oldRoof, ...rest } = data;
    let next: SiteBuildingData;
    if (roof && roof.eave >= MIN_EAVE && roof.ridge - roof.eave <= MAX_ROOF_RISE) {
      next = { ...rest, height: roof.ridge, heightSource: 'lidar', ...(roof.shape === 'flat' ? {} : { roof }) };
    } else {
      // A roof we can't read: a flat top at the height most of it reaches.
      const hs = samples.map(s => s.h).sort((a, c) => a - c);
      next = { ...rest, height: round2(hs[Math.floor(hs.length * 0.75)]!), heightSource: 'lidar' };
    }
    if (next.minHeight !== undefined && next.minHeight >= Math.min(next.height, next.roof?.eave ?? next.height)) delete next.minHeight;
    return { ...b, siteBuildingData: next };
  });
}

function ringArea(ring: P[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i]!, [x1, z1] = ring[(i + 1) % ring.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a / 2);
}
