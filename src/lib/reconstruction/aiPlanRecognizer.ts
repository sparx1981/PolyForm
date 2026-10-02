import type {
  ImageReconstructionObservation,
  RecognisedOpening,
  RecognisedRoom,
  RecognisedWall,
} from './imageAdapter';
import type { RasterImageData } from './localPlanRecognizer';

/**
 * AI-assisted floor-plan recognition.
 *
 * A vision model is good at *reading* a drawing (which lines are walls, where
 * the doors are, what the rooms are called) but poor at pixel-exact geometry.
 * So the model proposes walls/openings/rooms in a normalised 0–1000 space and
 * this module does the precise work locally: it nudges each wall onto the real
 * ink, snaps corners and T-junctions, merges duplicates and attaches doors and
 * windows to the nearest wall. Nothing here assumes right angles.
 */

export const AI_PLAN_SCALE = 1000;
const MAX_WALLS = 400;
const MAX_OPENINGS = 300;
const MAX_ROOMS = 80;

export interface AiPlanWall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Wall thickness as 0–1000 of the image width. Optional; often unreliable. */
  thickness?: number;
  exterior?: boolean;
  confidence?: number;
}

export interface AiPlanOpening {
  kind: 'door' | 'window';
  x: number;
  y: number;
  /** Opening width along the wall, as 0–1000 of the image width. */
  width: number;
  confidence?: number;
}

export interface AiPlanRoom {
  name: string;
  x: number;
  y: number;
  confidence?: number;
}

export interface AiPlanResponse {
  walls: AiPlanWall[];
  openings: AiPlanOpening[];
  rooms: AiPlanRoom[];
  notes: string[];
}

export interface AiPlanGenerateRequest {
  imageDataUrl: string;
  prompt: string;
}

/** Sends the image and prompt to a vision model and returns its JSON text. */
export type AiPlanGenerator = (request: AiPlanGenerateRequest) => Promise<string>;

export const AI_PLAN_PROMPT = `You are reading an architectural floor plan image. Return the building as JSON.

Coordinates: every x and y is an integer-or-decimal from 0 to 1000, where x=0 is the left edge of the image, x=1000 the right edge, y=0 the top edge and y=1000 the bottom edge (independent of the image's aspect ratio). Widths and thicknesses are measured on the same 0–1000 scale of the image WIDTH.

walls: one entry per wall segment, as its CENTRELINE from (x1,y1) to (x2,y2).
- Include exterior walls and interior partitions, at ANY angle. Do not force walls to be horizontal or vertical; plans may be skewed, triangular or irregular.
- A wall drawn as two parallel lines, or as a solid thick bar, is ONE wall: give its centreline.
- Start a new wall segment at each corner and where another wall joins it; make endpoints meet exactly at corners.
- Do not include dimension lines, extension lines, grid or section lines, text, furniture, fixtures, stair treads, door swing arcs, hatching or the title block / border.
- Set exterior=true for walls on the outside of the building. Give thickness if you can see it.

openings: doors and windows.
- x,y is the CENTRE of the opening in the wall; width is its width along the wall.
- Doors are shown by a gap with a swing arc or a leaf; windows by thin parallel lines or a break in the wall; include sliding/french doors as doors. Do not list unlabelled garage doors unless clearly drawn.

rooms: one entry per labelled room or space (e.g. "KITCHEN", "Bedroom 2", "Garage"). name is the label text in title case; x,y is a point well inside that room. Use a short descriptive name if a space is unlabelled but obviously a bathroom, stair, hall, etc.

notes: short strings for anything uncertain (illegible areas, partial drawings, several floors on one sheet). If the sheet shows several floors, reconstruct only the first/main one and say so.

confidence is 0–1 per item; use below 0.6 when guessing. Return ONLY the JSON.`;

// ---------------------------------------------------------------- parsing

const clampScale = (n: number) => Math.max(0, Math.min(AI_PLAN_SCALE, n));
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const conf = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.max(0, Math.min(1, n));
};

/** Parses and defensively validates the model's JSON; bad entries are dropped. */
export function parseAiPlanResponse(text: string): AiPlanResponse {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new Error('The AI response was not valid JSON. Try again.');
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.walls)) {
    throw new Error('The AI response did not contain a wall list.');
  }

  const walls: AiPlanWall[] = [];
  for (const w of raw.walls.slice(0, MAX_WALLS)) {
    const x1 = num(w?.x1), y1 = num(w?.y1), x2 = num(w?.x2), y2 = num(w?.y2);
    if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue;
    walls.push({
      x1: clampScale(x1), y1: clampScale(y1), x2: clampScale(x2), y2: clampScale(y2),
      thickness: num(w.thickness),
      exterior: w.exterior === true,
      confidence: conf(w.confidence),
    });
  }

  const openings: AiPlanOpening[] = [];
  for (const o of Array.isArray(raw.openings) ? raw.openings.slice(0, MAX_OPENINGS) : []) {
    const x = num(o?.x), y = num(o?.y), width = num(o?.width);
    if (x === undefined || y === undefined || width === undefined || !(width > 0)) continue;
    if (o.kind !== 'door' && o.kind !== 'window') continue;
    openings.push({ kind: o.kind, x: clampScale(x), y: clampScale(y), width, confidence: conf(o.confidence) });
  }

  const rooms: AiPlanRoom[] = [];
  for (const r of Array.isArray(raw.rooms) ? raw.rooms.slice(0, MAX_ROOMS) : []) {
    const x = num(r?.x), y = num(r?.y);
    const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 60) : '';
    if (x === undefined || y === undefined || !name) continue;
    rooms.push({ name, x: clampScale(x), y: clampScale(y), confidence: conf(r.confidence) });
  }

  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((n: unknown): n is string => typeof n === 'string' && !!n.trim()).slice(0, 8)
    : [];
  return { walls, openings, rooms, notes };
}

// ---------------------------------------------------------------- geometry

type P = [number, number];

export interface PxWall {
  a: P;
  b: P;
  /** Thickness in pixels, if the model gave one. */
  thickness?: number;
  exterior: boolean;
  confidence: number;
}

const len = (w: { a: P; b: P }) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);

function distToSegment(p: P, a: P, b: P): { dist: number; t: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return { dist: Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)), t };
}

/** Undirected angle in [0, π). */
function lineAngle(w: { a: P; b: P }): number {
  const a = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
  return ((a % Math.PI) + Math.PI) % Math.PI;
}

function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

function isDark(image: RasterImageData, x: number, y: number, threshold: number): boolean {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  const i = (y * image.width + x) * 4;
  const a = Number(image.data[i + 3] ?? 255) / 255;
  const lum = (0.2126 * Number(image.data[i]) + 0.7152 * Number(image.data[i + 1]) + 0.0722 * Number(image.data[i + 2])) * a + 255 * (1 - a);
  return lum <= threshold;
}

/**
 * Slides each wall sideways onto the ink it is meant to follow. The model's
 * lines are usually a few pixels off; the true wall is the dark band (or pair
 * of parallel lines) beside them. Walls with no ink nearby are left alone.
 */
export function refineWallsToInk(
  walls: PxWall[],
  image: RasterImageData,
  options: { reach: number; darkThreshold?: number },
): PxWall[] {
  const threshold = options.darkThreshold ?? 145;
  const reach = Math.max(2, Math.round(options.reach));
  return walls.map(wall => {
    const l = len(wall);
    if (l < 8) return wall;
    const ux = (wall.b[0] - wall.a[0]) / l, uy = (wall.b[1] - wall.a[1]) / l;
    const nx = -uy, ny = ux;
    const samples = Math.max(8, Math.min(200, Math.round(l / 4)));
    const offsets: number[] = [];
    for (let i = 0; i < samples; i++) {
      const t = (i + 0.5) / samples;
      const cx = wall.a[0] + ux * l * t, cy = wall.a[1] + uy * l * t;
      let sum = 0, weight = 0;
      for (let o = -reach; o <= reach; o++) {
        if (!isDark(image, Math.round(cx + nx * o), Math.round(cy + ny * o), threshold)) continue;
        const w = 1 - 0.5 * Math.abs(o) / reach;
        sum += o * w;
        weight += w;
      }
      if (weight > 0) offsets.push(sum / weight);
    }
    if (offsets.length < samples * 0.4) return wall;
    offsets.sort((p, q) => p - q);
    const shift = offsets[Math.floor(offsets.length / 2)];
    if (Math.abs(shift) > reach * 0.9) return wall;
    return {
      ...wall,
      a: [wall.a[0] + nx * shift, wall.a[1] + ny * shift],
      b: [wall.b[0] + nx * shift, wall.b[1] + ny * shift],
    };
  });
}

/**
 * Tidies raw wall lines into a connected plan: near-axis walls become exactly
 * axis-aligned, collinear overlaps merge, nearby endpoints join, endpoints
 * that touch another wall's side snap onto it, and slivers/duplicates go.
 */
export function cleanWalls(
  input: PxWall[],
  options: { tolerance: number; minLength: number; axisSnapDeg?: number },
): PxWall[] {
  const tol = options.tolerance;
  const axisSnap = (options.axisSnapDeg ?? 3) * Math.PI / 180;
  type Locked = PxWall & { lock?: 'h' | 'v' };
  let walls: Locked[] = input.filter(w => len(w) > 0).map(w => ({ ...w, a: [...w.a] as P, b: [...w.b] as P }));

  // 1. Exactly horizontal / vertical where the line is within a few degrees.
  //    The lock is remembered so later joins never tilt these walls again.
  for (const w of walls) {
    const ang = lineAngle(w);
    if (angleDiff(ang, 0) < axisSnap) {
      const y = (w.a[1] + w.b[1]) / 2;
      w.a[1] = w.b[1] = y;
      w.lock = 'h';
    } else if (angleDiff(ang, Math.PI / 2) < axisSnap) {
      const x = (w.a[0] + w.b[0]) / 2;
      w.a[0] = w.b[0] = x;
      w.lock = 'v';
    }
  }

  // 2. Merge collinear walls that overlap or nearly touch.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const A = walls[i], B = walls[j];
        if (angleDiff(lineAngle(A), lineAngle(B)) > 2 * Math.PI / 180) continue;
        const la = len(A);
        const ux = (A.b[0] - A.a[0]) / la, uy = (A.b[1] - A.a[1]) / la;
        const perp = (p: P) => Math.abs((p[0] - A.a[0]) * -uy + (p[1] - A.a[1]) * ux);
        if (perp(B.a) > tol * 0.6 || perp(B.b) > tol * 0.6) continue;
        const along = (p: P) => (p[0] - A.a[0]) * ux + (p[1] - A.a[1]) * uy;
        const aMin = Math.min(0, la), aMax = Math.max(0, la);
        const bMin = Math.min(along(B.a), along(B.b)), bMax = Math.max(along(B.a), along(B.b));
        if (bMin > aMax + tol || aMin > bMax + tol) continue;
        const lo = Math.min(aMin, bMin), hi = Math.max(aMax, bMax);
        walls[i] = {
          a: [A.a[0] + ux * lo, A.a[1] + uy * lo],
          b: [A.a[0] + ux * hi, A.a[1] + uy * hi],
          thickness: Math.max(A.thickness ?? 0, B.thickness ?? 0) || undefined,
          exterior: A.exterior || B.exterior,
          confidence: Math.min(A.confidence, B.confidence),
          lock: A.lock,
        };
        walls.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }

  // 3. Join endpoints that are within tolerance of one another.
  const pts: Array<{ w: number; end: 'a' | 'b'; p: P }> = [];
  walls.forEach((w, i) => { pts.push({ w: i, end: 'a', p: w.a }, { w: i, end: 'b', p: w.b }); });
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[i].w === pts[j].w) continue;
      if (Math.hypot(pts[i].p[0] - pts[j].p[0], pts[i].p[1] - pts[j].p[1]) <= tol) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  pts.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    let cx = members.reduce((s, k) => s + pts[k].p[0], 0) / members.length;
    let cy = members.reduce((s, k) => s + pts[k].p[1], 0) / members.length;
    // A locked wall keeps its own line: a horizontal wall fixes y, a vertical one fixes x.
    for (const k of members) {
      const w = walls[pts[k].w];
      if (w.lock === 'h') { cy = w[pts[k].end][1]; break; }
    }
    for (const k of members) {
      const w = walls[pts[k].w];
      if (w.lock === 'v') { cx = w[pts[k].end][0]; break; }
    }
    for (const k of members) {
      const w = walls[pts[k].w];
      // If two locked walls disagree, only the free coordinate of the later one moves.
      const x = w.lock === 'v' ? w[pts[k].end][0] : cx;
      const y = w.lock === 'h' ? w[pts[k].end][1] : cy;
      w[pts[k].end] = [x, y];
    }
  }

  // 4. Endpoints that land on the side of another wall (T-junctions).
  for (let i = 0; i < walls.length; i++) {
    for (const end of ['a', 'b'] as const) {
      const p = walls[i][end];
      let best: { j: number; dist: number } | null = null;
      for (let j = 0; j < walls.length; j++) {
        if (j === i) continue;
        const { dist, t } = distToSegment(p, walls[j].a, walls[j].b);
        const lj = len(walls[j]);
        if (dist > tol || dist < 1e-6) continue;
        if (t * lj < tol || (1 - t) * lj < tol) continue; // ends were handled by step 3
        if (!best || dist < best.dist) best = { j, dist };
      }
      if (best) {
        const target = walls[best.j];
        // Slide along the wall's own direction until it meets the target's line, so the wall
        // keeps its angle. Fall back to the nearest point when the two are nearly parallel.
        const other = end === 'a' ? walls[i].b : walls[i].a;
        const lw = len(walls[i]);
        const ux = (p[0] - other[0]) / lw, uy = (p[1] - other[1]) / lw;
        const vx = target.b[0] - target.a[0], vy = target.b[1] - target.a[1];
        const lt = Math.hypot(vx, vy);
        const cross = ux * (vy / lt) - uy * (vx / lt);
        let snapped: P | null = null;
        if (Math.abs(cross) > 0.2) {
          const s = ((target.a[0] - p[0]) * (vy / lt) - (target.a[1] - p[1]) * (vx / lt)) / cross;
          if (Math.abs(s) <= tol * 2) snapped = [p[0] + ux * s, p[1] + uy * s];
        }
        if (!snapped) {
          const { t } = distToSegment(p, target.a, target.b);
          snapped = [target.a[0] + vx * t, target.a[1] + vy * t];
        }
        walls[i][end] = snapped;
      }
    }
  }

  // 5. Drop slivers and exact duplicates.
  const out: PxWall[] = [];
  for (const { lock: _lock, ...w } of walls) {
    if (len(w) < options.minLength) continue;
    const dup = out.some(o =>
      (Math.hypot(o.a[0] - w.a[0], o.a[1] - w.a[1]) < tol * 0.5 && Math.hypot(o.b[0] - w.b[0], o.b[1] - w.b[1]) < tol * 0.5)
      || (Math.hypot(o.a[0] - w.b[0], o.a[1] - w.b[1]) < tol * 0.5 && Math.hypot(o.b[0] - w.a[0], o.b[1] - w.a[1]) < tol * 0.5));
    if (!dup) out.push(w);
  }
  return out;
}

const DOOR_WIDTH_M: [number, number] = [0.7, 2.4];
const WINDOW_WIDTH_M: [number, number] = [0.5, 3.5];

/**
 * Hosts each opening on its nearest wall and converts its pixel position and
 * width into the wall-relative form the reconstruction draft uses. Openings
 * with no wall nearby are discarded rather than floated in space.
 */
export function attachOpenings(
  openings: Array<{ kind: 'door' | 'window'; at: P; widthPx: number; confidence: number }>,
  walls: Array<{ id: string; a: P; b: P; thickness?: number }>,
  metresPerPixel: number,
  tolerance: number,
): { openings: RecognisedOpening[]; dropped: number } {
  const out: RecognisedOpening[] = [];
  let dropped = 0;
  for (const op of openings) {
    let best: { wall: typeof walls[number]; dist: number; t: number } | null = null;
    for (const wall of walls) {
      const { dist, t } = distToSegment(op.at, wall.a, wall.b);
      if (!best || dist < best.dist) best = { wall, dist, t };
    }
    if (!best || best.dist > Math.max(tolerance * 2.5, (best.wall.thickness ?? 0) * 1.5)) { dropped++; continue; }
    const wallLenM = len(best.wall) * metresPerPixel;
    const [lo, hi] = op.kind === 'door' ? DOOR_WIDTH_M : WINDOW_WIDTH_M;
    const width = Math.min(Math.max(op.widthPx * metresPerPixel, lo), hi, wallLenM - 0.2);
    if (!(width >= 0.4)) { dropped++; continue; }
    // Keep the opening fully inside the wall.
    const half = width / 2 / wallLenM;
    const t = Math.max(half, Math.min(1 - half, best.t));
    out.push({
      id: '',
      kind: op.kind,
      wallId: best.wall.id,
      centerT: t - 0.5,
      width,
      height: op.kind === 'door' ? 2.05 : 1.2,
      sill: op.kind === 'window' ? 0.9 : undefined,
      confidence: op.confidence,
    });
  }

  // Two openings on one wall that overlap are the same opening seen twice.
  const kept: RecognisedOpening[] = [];
  const wallById = new Map(walls.map(w => [w.id, w]));
  for (const op of out.sort((p, q) => (q.confidence ?? 0) - (p.confidence ?? 0))) {
    const wl = len(wallById.get(op.wallId)!) * metresPerPixel;
    const clash = kept.some(k => k.wallId === op.wallId
      && Math.abs(k.centerT - op.centerT) * wl < (k.width + op.width) / 2);
    if (clash) dropped++; else kept.push(op);
  }
  let d = 0, w = 0;
  for (const op of kept) op.id = op.kind === 'door' ? `ai-door-${++d}` : `ai-window-${++w}`;
  return { openings: kept, dropped };
}

// ---------------------------------------------------------------- orchestration

export interface AiPlanRecognitionOptions {
  imageDataUrl: string;
  imageSize: [number, number];
  metresPerPixel: number;
  generate: AiPlanGenerator;
  /** Full-resolution pixels; when given, walls are aligned to the drawn lines. */
  raster?: RasterImageData;
  fileName?: string;
  rotationY?: number;
}

export async function recogniseFloorPlanWithAi(
  options: AiPlanRecognitionOptions,
): Promise<ImageReconstructionObservation> {
  const { imageSize: [W, H], metresPerPixel: mpp } = options;
  if (!(mpp > 0) || !Number.isFinite(mpp)) {
    throw new Error('A positive calibration scale is required before recognising a plan.');
  }

  const text = await options.generate({ imageDataUrl: options.imageDataUrl, prompt: AI_PLAN_PROMPT });
  const response = parseAiPlanResponse(text);
  const toPx = (x: number, y: number): P => [x / AI_PLAN_SCALE * W, y / AI_PLAN_SCALE * H];

  const big = Math.max(W, H);
  const tolerance = Math.max(4, big * 0.007);
  const minLength = Math.max(6, big * 0.008);

  let walls: PxWall[] = response.walls.map(w => ({
    a: toPx(w.x1, w.y1),
    b: toPx(w.x2, w.y2),
    thickness: w.thickness !== undefined ? w.thickness / AI_PLAN_SCALE * W : undefined,
    exterior: w.exterior === true,
    confidence: w.confidence ?? 0.8,
  }));
  if (options.raster) walls = refineWallsToInk(walls, options.raster, { reach: tolerance * 1.6 });
  walls = cleanWalls(walls, { tolerance, minLength });

  const recognisedWalls: RecognisedWall[] = walls.map((w, i) => {
    const thicknessM = w.thickness !== undefined ? w.thickness * mpp : (w.exterior ? 0.25 : 0.12);
    return {
      id: `ai-wall-${i + 1}`,
      start: w.a,
      end: w.b,
      thickness: Math.max(0.08, Math.min(0.4, thicknessM)),
      confidence: w.confidence,
    };
  });

  // Openings need the cleaned wall geometry, in pixels, to find their host.
  const hosts = recognisedWalls.map(w => ({ id: w.id, a: w.start, b: w.end, thickness: (w.thickness ?? 0) / mpp }));
  const attached = attachOpenings(
    response.openings.map(o => ({
      kind: o.kind,
      at: toPx(o.x, o.y),
      widthPx: o.width / AI_PLAN_SCALE * W,
      confidence: o.confidence ?? 0.7,
    })),
    hosts,
    mpp,
    tolerance,
  );

  const rooms: RecognisedRoom[] = response.rooms.map(r => ({
    name: r.name,
    at: toPx(r.x, r.y),
    confidence: r.confidence ?? 0.75,
  }));

  const uncertainties = [
    'AI recognition is approximate: review every wall, door, window and room label before committing.',
    ...response.notes,
  ];
  if (attached.dropped) uncertainties.push(`${attached.dropped} door/window(s) could not be matched to a wall and were skipped.`);
  if (!recognisedWalls.length) uncertainties.push('No walls were found in the AI response.');

  return {
    source: { kind: 'image', fileName: options.fileName },
    imageSize: options.imageSize,
    transform: { coordinateSpace: 'pixels', metresPerPixel: mpp, rotationY: options.rotationY },
    walls: recognisedWalls,
    openings: attached.openings,
    rooms,
    uncertainties,
  };
}
