/**
 * Pixel-space detection of walls, doors and windows in a raster floor plan (orthogonal plans).
 *
 * The plan is treated the way a person reads it:
 *  - walls are the *thick* dark strokes (thin lines are furniture, dimensions, text and glazing);
 *  - a gap in a wall is an opening: a door when a swing arc sits at the gap, a window when glazing
 *    lines cross it, otherwise an open passage;
 *  - where walls meet, the thicker wall keeps the shared square so nothing overlaps.
 * Nothing here depends on the scale; `planGeometryToObservation` applies it.
 */

export interface PlanRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray | number[];
}

export type Axis = 'h' | 'v';

/** A straight wall stripe. `a` runs along the wall, `c` across it (both in pixels, end exclusive). */
export interface PlanBand {
  o: Axis;
  a0: number;
  a1: number;
  c0: number;
  c1: number;
  /** Fraction of the stripe that is solid wall ink (1 = perfectly solid). */
  solidity: number;
}

export type PlanOpeningKind = 'door' | 'window' | 'passage';

export interface PlanOpening {
  id: string;
  kind: PlanOpeningKind;
  o: Axis;
  /** Centre of the wall across its thickness. */
  c: number;
  a0: number;
  a1: number;
  /** Door only: which jamb the leaf is hinged on and which side it swings to. */
  hinge?: 'start' | 'end';
  swing?: 1 | -1;
  confidence: number;
  evidence: string;
  /** Thickness of the wall it sits in, pixels. */
  t: number;
}

export interface PlanWall extends PlanBand {
  id: string;
  openingIds: string[];
}

export interface PlanGeometry {
  width: number;
  height: number;
  walls: PlanWall[];
  openings: PlanOpening[];
  /** Bounding box of all wall ink. */
  bounds: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Typical wall thickness in pixels (thick, thin). */
  thickness: { exterior: number; interior: number } | null;
  notes: string[];
  /** Every stretch of free wall line that was examined, with what was found in it (for diagnostics). */
  examined: Array<{ o: Axis; c: number; a0: number; a1: number; arc: number; arcRun: number; leaf: number; glazing: number; verdict: PlanOpeningKind }>;
  /** The clean wall mask (for debugging and for later stages). */
  wallMask: Uint8Array;
  luminance: Uint8Array;
}

export interface PlanGeometryOptions {
  darkThreshold?: number;
  /** Strokes thinner than 2r+1 pixels are ignored. Defaults from the image size. */
  strokeRadius?: number;
  minRunPx?: number;
  maxOpeningPx?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function luminanceOf(image: PlanRaster): Uint8Array {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = Number(data[p + 3] ?? 255) / 255;
    const l = 0.2126 * Number(data[p] ?? 255) + 0.7152 * Number(data[p + 1] ?? 255) + 0.0722 * Number(data[p + 2] ?? 255);
    out[i] = Math.round(l * a + 255 * (1 - a));
  }
  return out;
}

export function otsu(lum: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < lum.length; i++) hist[lum[i]!]++;
  const total = lum.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t]!;
  let wB = 0, sumB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

/** Keeps only strokes at least 2r+1 pixels thick (separable min then max filter). */
export function openMask(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  const pass = (src: Uint8Array, dst: Uint8Array, horizontal: boolean, keepAll: boolean) => {
    const n = horizontal ? width : height, lines = horizontal ? height : width;
    for (let l = 0; l < lines; l++) {
      for (let i = 0; i < n; i++) {
        let hit = keepAll ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const j = clamp(i + k, 0, n - 1);
          const v = horizontal ? src[l * width + j]! : src[j * width + l]!;
          if (keepAll) { if (v) { hit = 1; break; } } else if (!v) { hit = 0; break; }
        }
        if (horizontal) dst[l * width + i] = hit; else dst[i * width + l] = hit;
      }
    }
  };
  const eroded = new Uint8Array(mask.length);
  pass(mask, tmp, true, false);
  pass(tmp, eroded, false, false);
  pass(eroded, tmp, true, true);
  pass(tmp, out, false, true);
  return out;
}

interface Run { a0: number; a1: number }

/** Stripes of ink in `mask`, found line by line (rows for 'h', columns for 'v'). */
export function findBands(mask: Uint8Array, width: number, height: number, o: Axis, minRun: number): PlanBand[] {
  const lines = o === 'h' ? height : width;
  const length = o === 'h' ? width : height;
  const at = (line: number, i: number) => (o === 'h' ? mask[line * width + i] : mask[i * width + line]);
  interface Open { rows: number[]; runs: Run[]; last: number }
  let open: Open[] = [];
  const done: Open[] = [];
  const iou = (a: Run, b: Run) => {
    const inter = Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0);
    if (inter <= 0) return 0;
    return inter / (Math.max(a.a1, b.a1) - Math.min(a.a0, b.a0));
  };
  for (let line = 0; line <= lines; line++) {
    const runs: Run[] = [];
    if (line < lines) {
      let start = -1;
      for (let i = 0; i <= length; i++) {
        const ink = i < length && at(line, i);
        if (ink && start < 0) start = i;
        if (!ink && start >= 0) { if (i - start >= minRun) runs.push({ a0: start, a1: i }); start = -1; }
      }
    }
    const next: Open[] = [];
    const taken = new Set<Open>();
    for (const run of runs) {
      let best: Open | null = null, bestScore = 0.6;
      for (const band of open) {
        if (taken.has(band)) continue;
        const s = iou(run, band.runs[band.runs.length - 1]!);
        if (s > bestScore) { best = band; bestScore = s; }
      }
      if (best) { best.rows.push(line); best.runs.push(run); best.last = line; taken.add(best); next.push(best); }
      else next.push({ rows: [line], runs: [run], last: line });
    }
    for (const band of open) if (!taken.has(band)) done.push(band);
    open = next;
  }
  for (const band of open) done.push(band);
  const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
  const bands: PlanBand[] = [];
  for (const b of done) {
    const a0 = median(b.runs.map(r => r.a0)), a1 = median(b.runs.map(r => r.a1));
    bands.push({ o, a0, a1, c0: b.rows[0]!, c1: b.rows[b.rows.length - 1]! + 1, solidity: 1 });
  }
  return bands;
}

function solidityOf(mask: Uint8Array, width: number, band: PlanBand): number {
  let ink = 0, total = 0;
  for (let c = band.c0; c < band.c1; c++) {
    for (let a = band.a0; a < band.a1; a++) {
      total++;
      if (band.o === 'h' ? mask[c * width + a] : mask[a * width + c]) ink++;
    }
  }
  return total ? ink / total : 0;
}

const thick = (b: PlanBand) => b.c1 - b.c0;
const centre = (b: PlanBand) => (b.c0 + b.c1) / 2;
const length = (b: PlanBand) => b.a1 - b.a0;


const rectOf = (b: PlanBand) => (b.o === 'h' ? { x0: b.a0, x1: b.a1, y0: b.c0, y1: b.c1 } : { x0: b.c0, x1: b.c1, y0: b.a0, y1: b.a1 });
function touches(a: PlanBand, b: PlanBand, tol = 3): boolean {
  const p = rectOf(a), q = rectOf(b);
  return p.x0 - tol <= q.x1 && q.x0 - tol <= p.x1 && p.y0 - tol <= q.y1 && q.y0 - tol <= p.y1;
}
/**
 * Short stripes that touch nothing are plants, symbols and stray ink, not walls. Stripes are judged as
 * clusters (a plant is several tiny stripes touching each other), and a short stripe in line with a
 * longer one (a post between two windows) is kept.
 */
function dropUnsupported(bands: PlanBand[], minLone: number, reach: number): PlanBand[] {
  const parent = bands.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const inLine = (a: PlanBand, b: PlanBand) => a.o === b.o && Math.abs(centre(a) - centre(b)) <= Math.max(2.5, 0.4 * Math.max(thick(a), thick(b)))
    && Math.max(a.a0, b.a0) - Math.min(a.a1, b.a1) <= reach;
  for (let i = 0; i < bands.length; i++) for (let j = i + 1; j < bands.length; j++) {
    if (touches(bands[i]!, bands[j]!) || inLine(bands[i]!, bands[j]!)) parent[find(i)] = find(j);
  }
  const extent = new Map<number, number>();
  bands.forEach((b, i) => extent.set(find(i), Math.max(extent.get(find(i)) ?? 0, length(b))));
  // A run of short posts and windows in one line adds up to a wall.
  const spans = new Map<number, [number, number]>();
  bands.forEach((b, i) => { const r0 = find(i), sp = spans.get(r0); spans.set(r0, [Math.min(sp?.[0] ?? b.a0, b.a0), Math.max(sp?.[1] ?? b.a1, b.a1)]); });
  return bands.filter((_, i) => {
    const r0 = find(i), sp = spans.get(r0)!;
    const members = bands.filter((__, j) => find(j) === r0);
    const oneLine = members.every(m => m.o === members[0]!.o);
    return (extent.get(r0) ?? 0) >= minLone || (oneLine && sp[1] - sp[0] >= minLone * 1.5);
  });
}

/** Merge stripes of one wall that were cut by a stray pixel row. */
function mergeSplitBands(bands: PlanBand[]): PlanBand[] {
  const out = [...bands].sort((a, b) => a.c0 - b.c0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = i + 1; j < out.length && !changed; j++) {
        const a = out[i]!, b = out[j]!;
        const inter = Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0);
        const union = Math.max(a.a1, b.a1) - Math.min(a.a0, b.a0);
        const touching = b.c0 <= a.c1 + 1 && a.c0 <= b.c1 + 1;
        const crossOverlap = Math.min(a.c1, b.c1) - Math.max(a.c0, b.c0);
        const nested = inter > 0.6 * Math.min(a.a1 - a.a0, b.a1 - b.a0) && crossOverlap >= 0.5 * Math.min(a.c1 - a.c0, b.c1 - b.c0);
        // A thin line running right beside a wall is the drawing's edge or trim, not a second wall.
        const [thin, wide] = a.c1 - a.c0 <= b.c1 - b.c0 ? [a, b] : [b, a];
        const trim = touching && (thin.c1 - thin.c0) < 0.4 * (wide.c1 - wide.c0) && inter > 0.8 * (thin.a1 - thin.a0);
        if (trim) {
          out.splice(thin === a ? i : j, 1);
          changed = true;
          continue;
        }
        if (touching && (inter / union > 0.85 || nested)) {
          out[i] = { ...a, a0: Math.min(a.a0, b.a0), a1: Math.max(a.a1, b.a1), c0: Math.min(a.c0, b.c0), c1: Math.max(a.c1, b.c1), solidity: Math.min(a.solidity, b.solidity) };
          out.splice(j, 1);
          changed = true;
        }
      }
    }
  }
  return out;
}

interface Gap { first: number; second: number; a0: number; a1: number; c: number; o: Axis }

/** Sample lum around (x,y): is there ink of any strength within one pixel? */
function inkNear(lum: Uint8Array, w: number, h: number, x: number, y: number, limit: number, reach = 1): boolean {
  const cx = Math.round(x), cy = Math.round(y);
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const px = cx + dx, py = cy + dy;
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    if (lum[py * w + px]! < limit) return true;
  }
  return false;
}

interface ArcEvidence { score: number; run: number; leaf: number; hinge: 'start' | 'end'; swing: 1 | -1 }

/**
 * Looks for a door: a swing arc (a quarter circle of radius = gap width, centred on a jamb) and the
 * leaf (a straight line from that jamb). Real plans draw these a pixel or two off the wall centre line
 * and often open past 90 degrees, so the search allows for both.
 */
function doorArc(lum: Uint8Array, wallMask: Uint8Array, w: number, h: number, gap: Gap, u: number): ArcEvidence {
  const g = gap.a1 - gap.a0;
  let best: ArcEvidence = { score: 0, run: 0, leaf: 0, hinge: 'start', swing: 1 };
  const bestValue = (e: ArcEvidence) => e.score * 0.4 + e.run * 0.4 + e.leaf * 0.2;
  const ink = (x: number, y: number) => {
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= w || py >= h || wallMask[py * w + px]) return false;
    return inkNear(lum, w, h, x, y, 232, reach);
  };
  const reach = Math.max(1, Math.round(u));
  // Quick look first: with no trace of an arc on the plain geometry, do not search the variations.
  const quick = (hinge: 'start' | 'end', swing: 1 | -1) => {
    const dir = hinge === 'start' ? 1 : -1, hingeA = hinge === 'start' ? gap.a0 : gap.a1;
    let hits = 0, samples = 0;
    for (let phi = 6; phi <= 100; phi += 6) {
      const rad = (phi * Math.PI) / 180;
      const a = hingeA + dir * Math.cos(rad) * g, c = gap.c + swing * Math.sin(rad) * g;
      samples++;
      const x = gap.o === 'h' ? a : c, y = gap.o === 'h' ? c : a;
      if (ink(x, y)) hits++;
    }
    return hits / samples;
  };
  let worth = false;
  for (const hinge of ['start', 'end'] as const) for (const swing of [1, -1] as const) if (quick(hinge, swing) >= 0.2) worth = true;
  if (!worth) return best;
  for (const hinge of ['start', 'end'] as const) {
    const dir = hinge === 'start' ? 1 : -1;
    const hingeA = hinge === 'start' ? gap.a0 : gap.a1;
    for (const swing of [1, -1] as const) {
      for (const dc0 of [-3, -2, -1, 0, 1, 2, 3]) {
        const dc = Math.round(dc0 * u);
        const point = (along: number, across: number): [number, number] => {
          const a = hingeA + dir * along, c = gap.c + dc + swing * across;
          return gap.o === 'h' ? [a, c] : [c, a];
        };
        for (const dr0 of [-2, -1, 0, 1, 2]) {
          const radius = g + Math.round(dr0 * u);
          if (radius < 8) continue;
          let hits = 0, run = 0, bestRun = 0, samples = 0;
          for (let phi = 6; phi <= 100; phi += 3) {
            const rad = (phi * Math.PI) / 180;
            const [x, y] = point(Math.cos(rad) * radius, Math.sin(rad) * radius);
            samples++;
            if (ink(x, y)) { hits++; run++; bestRun = Math.max(bestRun, run); } else run = 0;
          }
          // The leaf: the straightest, longest line out of the hinge.
          let leaf = 0;
          for (let phi = 20; phi <= 100; phi += 4) {
            const rad = (phi * Math.PI) / 180;
            let on = 0, n = 0;
            for (let d = 3; d <= radius - 2; d += 1) {
              const [x, y] = point(Math.cos(rad) * d, Math.sin(rad) * d);
              n++;
              if (ink(x, y)) on++;
            }
            leaf = Math.max(leaf, n ? on / n : 0);
          }
          const candidate: ArcEvidence = { score: hits / samples, run: bestRun / samples, leaf, hinge, swing };
          if (bestValue(candidate) > bestValue(best)) best = candidate;
        }
      }
    }
  }
  return best;
}

/** Glazing lines: rows across the wall thickness that are ink along (nearly) the whole gap. */
function glazingLines(lum: Uint8Array, w: number, gap: Gap, thickness: number): number {
  let lines = 0, inLine = false;
  const c0 = Math.round(gap.c - thickness / 2 - 1), c1 = Math.round(gap.c + thickness / 2 + 1);
  const a0 = Math.round(gap.a0 + 2), a1 = Math.round(gap.a1 - 2);
  for (let c = c0; c <= c1; c++) {
    let ink = 0, total = 0;
    for (let a = a0; a < a1; a++) {
      total++;
      const v = gap.o === 'h' ? lum[c * w + a]! : lum[a * w + c]!;
      if (v < 225) ink++;
    }
    const isLine = total > 0 && ink / total >= 0.7;
    if (isLine && !inLine) lines++;
    inLine = isLine;
  }
  return lines;
}

export function detectPlanGeometry(image: PlanRaster, options: PlanGeometryOptions = {}): PlanGeometry {
  const { width, height } = image;
  if (!(width > 1) || !(height > 1) || image.data.length < width * height * 4) throw new Error('Raster image data is invalid.');
  const lum = luminanceOf(image);
  const threshold = clamp(options.darkThreshold ?? otsu(lum), 60, 150);
  const dark = new Uint8Array(width * height);
  for (let i = 0; i < dark.length; i++) dark[i] = lum[i]! <= threshold ? 1 : 0;
  const r = options.strokeRadius ?? clamp(Math.round(Math.min(width, height) / 450), 1, 3);
  const wallMask = openMask(dark, width, height, r);
  const minRun = Math.max(8, Math.round(options.minRunPx ?? Math.min(width, height) * 0.03));
  const shortRun = Math.max(6, Math.round(Math.min(width, height) * 0.012));
  const notes: string[] = [];

  let bands = [
    ...findBands(wallMask, width, height, 'h', minRun),
    ...findBands(wallMask, width, height, 'v', minRun),
  ];
  for (const b of bands) b.solidity = solidityOf(wallMask, width, b);
  bands = bands.filter(b => thick(b) >= 2 * r + 1 && length(b) >= Math.max(6, thick(b) * 0.9) && b.solidity >= 0.9);
  bands = [...mergeSplitBands(bands.filter(b => b.o === 'h')), ...mergeSplitBands(bands.filter(b => b.o === 'v'))];
  const planExtent = Math.max(
    Math.max(...bands.map(b => (b.o === 'h' ? b.a1 : b.c1))) - Math.min(...bands.map(b => (b.o === 'h' ? b.a0 : b.c0))),
    Math.max(...bands.map(b => (b.o === 'h' ? b.c1 : b.a1))) - Math.min(...bands.map(b => (b.o === 'h' ? b.c0 : b.a0))),
  );
  if (bands.length) bands = dropUnsupported(bands, Math.round(Math.min(width, height) * 0.08), planExtent * 0.2);

  // Window mullions and door jambs are only a wall thickness long, too short to trust on their own.
  // They count when they sit in line with a wall we already have.
  const overlaps = (a: PlanBand, b: PlanBand) => touches(a, b, -1);
  const rescued = [
    ...findBands(wallMask, width, height, 'h', shortRun),
    ...findBands(wallMask, width, height, 'v', shortRun),
  ].filter(b => {
    b.solidity = solidityOf(wallMask, width, b);
    return thick(b) >= 2 * r + 1 && length(b) >= Math.max(6, thick(b) * 0.9) && b.solidity >= 0.9 && !bands.some(o => overlaps(b, o))
      && bands.some(o => o.o === b.o && Math.abs(centre(o) - centre(b)) <= Math.max(2.5, 0.4 * Math.max(thick(o), thick(b))) && Math.abs(thick(o) - thick(b)) <= 0.4 * Math.max(thick(o), thick(b))
        && Math.max(o.a0, b.a0) - Math.min(o.a1, b.a1) <= 0.2 * planExtent && length(o) >= shortRun * 2);
  });
  bands = [...bands, ...rescued];

  if (!bands.length) {
    return { width, height, walls: [], openings: [], bounds: null, thickness: null, notes: ['No strong wall lines were found.'], examined: [], wallMask, luminance: lum };
  }

  // Plan extent (for limits) and typical thicknesses.
  const x0 = Math.min(...bands.map(b => (b.o === 'h' ? b.a0 : b.c0)));
  const x1 = Math.max(...bands.map(b => (b.o === 'h' ? b.a1 : b.c1)));
  const y0 = Math.min(...bands.map(b => (b.o === 'h' ? b.c0 : b.a0)));
  const y1 = Math.max(...bands.map(b => (b.o === 'h' ? b.c1 : b.a1)));
  const maxOpening = options.maxOpeningPx ?? Math.max(x1 - x0, y1 - y0) * 0.2;
  const minOpening = Math.max(8, Math.max(x1 - x0, y1 - y0) * 0.03);

  // March along the line of every wall end: a stretch of free space that ends at more wall ink is an
  // opening (door, window) or just an open passage. The evidence inside the gap tells them apart.
  const inkAt = (o: Axis, c: number, a: number, span: number): number => {
    let ink = 0, total = 0;
    for (let cc = Math.round(c - span); cc <= Math.round(c + span); cc++) {
      const x = o === 'h' ? Math.round(a) : cc, y = o === 'h' ? cc : Math.round(a);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      total++;
      if (wallMask[y * width + x]) ink++;
    }
    return total ? ink / total : 0;
  };
  const candidates: Gap[] = [];
  bands.forEach((band, index) => {
    for (const end of ['a0', 'a1'] as const) {
      const dir = end === 'a1' ? 1 : -1;
      const start = band[end];
      const c = centre(band), span = Math.max(1, thick(band) * 0.3);
      let far = -1;
      for (let d = 1; d <= maxOpening + 2; d++) {
        const a = start + dir * d;
        if (inkAt(band.o, c, a, span) >= 0.6) { far = d; break; }
        if (a < 0 || a >= (band.o === 'h' ? width : height)) break;
      }
      if (far < minOpening || far > maxOpening) continue;
      const g0 = dir > 0 ? start : start - far, g1 = dir > 0 ? start + far : start;
      candidates.push({ first: index, second: -1, a0: g0, a1: g1, c, o: band.o });
    }
  });
  // The same gap is found from both ends: keep one.
  const gaps: Gap[] = [];
  for (const cand of candidates) {
    const tol = Math.max(4, thick(bands[cand.first]!));
    const dup = gaps.find(g => g.o === cand.o && Math.abs(g.c - cand.c) <= tol && Math.abs(g.a0 - cand.a0) <= 3 + tol / 2 && Math.abs(g.a1 - cand.a1) <= 3 + tol / 2);
    if (!dup) gaps.push(cand);
  }

  const parent = bands.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const bridge = new Map<number, { a0: number; a1: number }>();
  const openings: PlanOpening[] = [];
  const examined: PlanGeometry['examined'] = [];
  let openingCount = 0;
  for (const gap of gaps) {
    const host = bands[gap.first]!;
    const t = thick(host);
    const glass = glazingLines(lum, width, gap, t);
    // A door leaf is roughly 0.6 to 1.3 m: about 4% to 8.5% of a house's width.
    const doorWidth = gap.a1 - gap.a0, extent = Math.max(x1 - x0, y1 - y0);
    const doorSized = doorWidth >= extent * 0.038 && doorWidth <= extent * 0.085;
    const arc: ArcEvidence = glass < 2 && doorSized
      ? doorArc(lum, wallMask, width, height, gap, Math.max(0.5, (x1 - x0) / 706))
      : { score: 0, run: 0, leaf: 0, hinge: 'start', swing: 1 };
    let kind: PlanOpeningKind;
    let confidence: number;
    let evidence: string;
    if (glass < 2 && doorSized && ((arc.score >= 0.45 && arc.run >= 0.35) || (arc.leaf >= 0.85 && arc.score >= 0.35 && arc.run >= 0.25))) {
      kind = 'door'; confidence = clamp(0.6 + arc.score * 0.38, 0.6, 0.98); evidence = `door swing (arc ${Math.round(arc.score * 100)}%, leaf ${Math.round(arc.leaf * 100)}%)`;
    } else if (glass >= 2) {
      kind = 'window'; confidence = clamp(0.7 + glass * 0.08, 0.7, 0.95); evidence = `${glass} glazing lines`;
    } else {
      examined.push({ o: gap.o, c: gap.c, a0: gap.a0, a1: gap.a1, arc: arc.score, arcRun: arc.run, leaf: arc.leaf, glazing: glass, verdict: 'passage' });
      continue; // an open passage: walls simply stop either side of it
    }
    examined.push({ o: gap.o, c: gap.c, a0: gap.a0, a1: gap.a1, arc: arc.score, arcRun: arc.run, leaf: arc.leaf, glazing: glass, verdict: kind });
    const id = `opening-${++openingCount}`;
    openings.push({ id, kind, o: gap.o, c: gap.c, a0: gap.a0, a1: gap.a1, confidence, evidence, t, ...(kind === 'door' ? { hinge: arc.hinge, swing: arc.swing } : {}) });
    // The host wall runs through the opening: join the stripes on either side of it, or stretch across.
    const tolC = (b: PlanBand) => Math.max(2.5, 0.45 * Math.max(thick(b), t));
    const neighbours = bands.map((b, i) => ({ b, i })).filter(({ b, i }) => i !== gap.first && b.o === gap.o && Math.abs(centre(b) - gap.c) <= tolC(b)
      && (Math.abs(b.a0 - gap.a1) <= 3 || Math.abs(b.a1 - gap.a0) <= 3));
    for (const n of neighbours) parent[find(n.i)] = find(gap.first);
    if (!neighbours.length || !(Math.abs(host.a1 - gap.a0) <= 3 || Math.abs(host.a0 - gap.a1) <= 3)) {
      const prev = bridge.get(gap.first);
      bridge.set(gap.first, { a0: Math.min(prev?.a0 ?? gap.a0, gap.a0), a1: Math.max(prev?.a1 ?? gap.a1, gap.a1) });
    }
  }

  let walls: PlanWall[] = [];
  let wallCount = 0;
  const groups = new Map<number, number[]>();
  bands.forEach((_, i) => { const r0 = find(i); groups.set(r0, [...(groups.get(r0) ?? []), i]); });
  for (const members of groups.values()) {
    const parts = members.map(i => bands[i]!);
    let a0 = Math.min(...parts.map(p => p.a0)), a1 = Math.max(...parts.map(p => p.a1));
    for (const i of members) { const br = bridge.get(i); if (br) { a0 = Math.min(a0, br.a0); a1 = Math.max(a1, br.a1); } }
    const cc = parts.reduce((sum, p) => sum + centre(p), 0) / parts.length;
    const tt = Math.max(...parts.map(thick));
    walls.push({
      id: `wall-${++wallCount}`, o: parts[0]!.o, a0, a1, c0: cc - tt / 2, c1: cc + tt / 2,
      solidity: Math.min(...parts.map(p => p.solidity)), openingIds: [],
    });
  }

  // Where walls cross or meet, the thicker one keeps the shared square (horizontal on a tie).
  const trimmed: PlanWall[] = [];
  for (const w of walls) {
    let pieces: Array<[number, number]> = [[w.a0, w.a1]];
    for (const other of walls) {
      if (other === w || other.o === w.o) continue;
      const otherOwns = thick(other) > thick(w) * 1.25 || (Math.abs(thick(other) - thick(w)) <= thick(w) * 0.25 && other.o === 'h');
      if (!otherOwns) continue;
      // `other` spans across `w`'s thickness and covers part of w's length.
      const crossesW = other.a0 <= w.c0 + 1 && other.a1 >= w.c1 - 1;
      const wReaches = w.a0 <= other.c1 + 1 && w.a1 >= other.c0 - 1;
      if (!crossesW || !wReaches) continue;
      const cut0 = other.c0, cut1 = other.c1;
      pieces = pieces.flatMap(([p0, p1]) => {
        if (cut1 <= p0 || cut0 >= p1) return [[p0, p1] as [number, number]];
        const out: Array<[number, number]> = [];
        if (cut0 > p0) out.push([p0, cut0]);
        if (cut1 < p1) out.push([cut1, p1]);
        return out;
      });
    }
    const minPiece = Math.max(thick(w) * 1.2, 6);
    for (const [p0, p1] of pieces) {
      if (p1 - p0 < minPiece) continue;
      trimmed.push({ ...w, id: '', a0: p0, a1: p1, openingIds: [] });
    }
  }
  walls = trimmed.map((w, i) => ({ ...w, id: `wall-${i + 1}` }));

  // The same opening can be found from two bands lying on slightly different centre lines.
  openings.sort((p, q) => q.confidence - p.confidence);
  const unique: PlanOpening[] = [];
  for (const op of openings) {
    const dup = unique.some(u => u.o === op.o && Math.abs(u.c - op.c) <= Math.max(6, Math.max(u.t, op.t))
      && Math.min(u.a1, op.a1) - Math.max(u.a0, op.a0) > 0.5 * Math.min(u.a1 - u.a0, op.a1 - op.a0));
    if (!dup) unique.push(op);
  }
  openings.length = 0; openings.push(...unique);

  // Hang each opening on the wall piece that holds it.
  const keptOpenings: PlanOpening[] = [];
  for (const op of openings) {
    if (op.kind === 'passage') continue;
    const host = walls.find(w => w.o === op.o && Math.abs(centre(w) - op.c) <= Math.max(3, thick(w) * 0.6) && w.a0 <= op.a0 + 1 && w.a1 >= op.a1 - 1);
    if (!host) continue;
    host.openingIds.push(op.id);
    keptOpenings.push(op);
  }

  const thicknesses = walls.map(thick).sort((a, b) => a - b);
  const exterior = thicknesses[thicknesses.length - 1]!;
  const interior = thicknesses[Math.floor(thicknesses.length / 2)]!;
  notes.push(`${walls.length} wall stripes, ${keptOpenings.filter(o => o.kind === 'door').length} doors, ${keptOpenings.filter(o => o.kind === 'window').length} windows.`);
  return { width, height, walls, openings: keptOpenings, bounds: { x0, y0, x1, y1 }, thickness: { exterior, interior }, notes, examined, wallMask, luminance: lum };
}
