import * as THREE from 'three';
import { prepareFencePath } from './splitRail/zaun-pfad.js';
import { compileFence } from './splitRail/zaun-gesamt.js';
import { holzFarbe } from './splitRail/wurmzaun-compiler.js';
import { translate } from './splitRail/i18n.js';
import { buildGardenFence, pathLength, type FencePart } from './gardenFence';
import {
  isGardenStyle, fenceStyleInfo,
  type FenceBatch, type FenceBuildResult, type FenceData, type SplitRailStyle, type TerrainSnapshot, type WoodFinish,
} from './fenceTypes';

/**
 * Turns a saved fence (path, style, height) plus a terrain snapshot into render batches.
 * Pure and synchronous so it can run in a worker; the split-rail generator takes up to about
 * a second for a long fence because it audits every joint and ground contact.
 */

const GENERATOR_TYPE: Record<SplitRailStyle, string> = {
  worm: 'wurm', 'stake-rider': 'stake', 'post-rail': 'pfosten', skigard: 'skigard', hybrid: 'hybrid',
};
const FINISH: Record<WoodFinish, string> = {
  weathered: 'vergraut', oak: 'eiche', chestnut: 'kastanie-frisch', robinia: 'robinie', lichen: 'flechte',
};
/** The generator accepts 2.3–65 m per run; longer fences are built as consecutive runs. */
const MAX_RUN = 60;

type Vec = { x: number; z: number };
interface GeneratorPart { id: string; kind: string; buried?: boolean; role?: string; surface: { points: { x: number; y: number; z: number }[]; uv: number[][]; endGrain?: boolean }[] }

/** Bilinear height from the snapshot; clamps at its edge. */
export function snapshotSampler(snapshot: TerrainSnapshot | null, fallback = 0) {
  if (!snapshot) return () => fallback;
  const { x, z, step, columns, rows, heights } = snapshot;
  return (px: number, pz: number) => {
    const u = Math.min(columns - 1.000001, Math.max(0, (px - x) / step));
    const v = Math.min(rows - 1.000001, Math.max(0, (pz - z) / step));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const h = (a: number, b: number) => heights[b * columns + a];
    return (h(i, j) * (1 - fu) + h(i + 1, j) * fu) * (1 - fv) + (h(i, j + 1) * (1 - fu) + h(i + 1, j + 1) * fu) * fv;
  };
}

/** Splits a path into runs of at most `max` metres that share their end points. */
export function splitPath(points: Vec[], max: number): Vec[][] {
  const runs: Vec[][] = [];
  let run: Vec[] = [points[0]], length = 0;
  for (let i = 1; i < points.length; i++) {
    let a = run[run.length - 1];
    const b = points[i];
    let segment = Math.hypot(b.x - a.x, b.z - a.z);
    while (length + segment > max) {
      const t = (max - length) / segment;
      const cut = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      run.push(cut); runs.push(run);
      run = [cut]; length = 0; a = cut; segment = Math.hypot(b.x - a.x, b.z - a.z);
    }
    run.push(b); length += segment;
  }
  // A short tail can't be built on its own: fold it into the previous run when possible.
  if (runs.length && length < 2.5) {
    const previous = runs.pop()!;
    previous.pop();
    run = [...previous, ...run];
    // Rebalance so neither run exceeds the generator limit.
    const total = pathLength(run, false);
    if (total > max) return [...runs, ...splitPath(run, total / 2 + 0.01)];
  }
  runs.push(run);
  return runs;
}

/** Local snapshot: the generator only accepts coordinates within 100 m of its origin. */
function localSnapshot(snapshot: TerrainSnapshot, ox: number, oz: number) {
  return { x: snapshot.x - ox, z: snapshot.z - oz, step: snapshot.step, columns: snapshot.columns, rows: snapshot.rows, heights: snapshot.heights };
}

function flatSnapshot(points: Vec[], y: number): TerrainSnapshot {
  const xs = points.map(p => p.x), zs = points.map(p => p.z), step = 0.5;
  const x = Math.min(...xs) - 4, z = Math.min(...zs) - 4;
  const columns = Math.ceil((Math.max(...xs) + 4 - x) / step) + 1, rows = Math.ceil((Math.max(...zs) + 4 - z) / step) + 1;
  return { x, z, step, columns, rows, heights: new Float32Array(columns * rows).fill(y) };
}

function describeInvalid(diagnostics: { constructionErrors?: string[]; collisions?: unknown[]; groundViolations?: unknown[] }) {
  const reasons = [...(diagnostics.constructionErrors ?? []).map(error => translate(error, 'en'))];
  if (diagnostics.collisions?.length) reasons.push(`${diagnostics.collisions.length} timber collisions`);
  if (diagnostics.groundViolations?.length) reasons.push(`${diagnostics.groundViolations.length} parts cut into the ground`);
  return reasons.join(' · ') || 'The fence could not be built on this path.';
}

function compileSplitRail(data: FenceData, snapshot: TerrainSnapshot): GeneratorPart[] {
  const style = data.style as SplitRailStyle;
  const points = data.points.map(([x, z]) => ({ x, z }));
  const closed = Boolean(data.closed) && points.length > 2;
  const total = pathLength(points, closed);
  if (total < 2.3) throw new Error('Draw at least 2.3 m of fence.');
  const layout = style === 'worm' || style === 'stake-rider' ? 'worm' : 'plain';
  const settings = {
    type: GENERATOR_TYPE[style], seed: data.seed, height: data.height, spacing: 0.85, density: 2, direction: 1,
    layers: 6, form: 'spaltkeil', binding: 'weide', wood: FINISH[data.finish ?? 'weathered'],
    hybridAuto: style === 'hybrid',
  };
  // Closed rings within the limit are built as rings; everything else as open runs.
  const runs = closed && total <= 65 && style !== 'hybrid'
    ? [[...points, points[0]]]
    : splitPath(closed ? [...points, points[0]] : points, MAX_RUN);
  const parts: GeneratorPart[] = [];
  runs.forEach((run, index) => {
    const ox = run.reduce((sum, p) => sum + p.x, 0) / run.length, oz = run.reduce((sum, p) => sum + p.z, 0) / run.length;
    const local = run.map(p => ({ x: p.x - ox, z: p.z - oz }));
    const prepared = prepareFencePath(local, { layout, authored: true });
    const plan = compileFence(prepared, { ...settings, seed: data.seed + index, terrain: localSnapshot(snapshot, ox, oz) });
    if (!plan.diagnostics.valid) throw new Error(describeInvalid(plan.diagnostics));
    for (const part of plan.parts as GeneratorPart[]) {
      parts.push({
        ...part, id: `${index}-${part.id}`,
        surface: part.surface.map(t => ({ ...t, points: t.points.map(p => ({ x: p.x + ox, y: p.y, z: p.z + oz })) })),
      });
    }
  });
  return parts;
}

/** Batches parts by material, with per-member colour variation as vertex colours. */
function batchParts(parts: GeneratorPart[], data: FenceData): FenceBatch[] {
  const garden = isGardenStyle(data.style);
  const base = new THREE.Color(data.color ?? fenceStyleInfo(data.style).color ?? '#8a6644');
  const stone = new THREE.Color('#9a9a92');
  const out: FenceBatch[] = [];
  for (const kind of ['wood', 'woodEnd', 'stone', 'binding', 'metal'] as const) {
    const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
    let index = 0;
    for (const part of parts) {
      const category = ['stone', 'binding', 'metal'].includes(part.kind) ? part.kind : 'wood';
      if (category !== kind && !(category === 'wood' && kind === 'woodEnd')) continue;
      const member = index++;
      const color = category === 'stone' ? stone
        : garden ? base.clone().offsetHSL(0, 0, (Math.sin(member * 12.9898 + data.seed) * 0.5) * 0.06)
        : holzFarbe(THREE, FINISH[data.finish ?? 'weathered'], member, data.seed, part.kind === 'stake' || part.buried ? 'pfosten' : 'riegel');
      const vertical = part.buried || part.role === 'board' || part.id.includes('gate-stile');
      for (const tri of part.surface) {
        if (category === 'wood' && ((kind === 'woodEnd') !== Boolean(tri.endGrain))) continue;
        const [a, b, c] = tri.points;
        const n = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).cross(new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z));
        const axis = Math.abs(n.x) > Math.abs(n.z) ? 'x' : 'z';
        for (let j = 0; j < 3; j++) {
          const p = tri.points[j];
          positions.push(p.x, p.y, p.z);
          const tint = 0.95 + 0.05 * Math.sin(member * 31 + (tri.uv[0]?.[0] ?? 0) * 91);
          colors.push(color.r * tint, color.g * tint, color.b * tint);
          if (kind === 'woodEnd') uvs.push((axis === 'x' ? p.z : p.x) * 5, p.y * 5);
          else if (vertical) uvs.push(axis === 'x' ? p.z : p.x, p.y);
          else uvs.push((tri.uv[j]?.[0] ?? 0) + member * 0.173, (tri.uv[j]?.[1] ?? 0) + member * 0.317);
        }
      }
    }
    if (positions.length) out.push({ kind, positions: new Float32Array(positions), uvs: new Float32Array(uvs), colors: new Float32Array(colors) });
  }
  return out;
}

export function buildFence(data: FenceData, snapshot: TerrainSnapshot | null, baseY = 0): FenceBuildResult {
  const started = performance.now();
  try {
    const points = data.points.map(([x, z]) => ({ x, z }));
    if (points.length < 2) throw new Error('A fence needs at least two points.');
    const terrain = snapshot ?? flatSnapshot(points, baseY);
    const closed = Boolean(data.closed) && points.length > 2;
    const parts = isGardenStyle(data.style)
      ? buildGardenFence({ style: data.style, points, closed, height: data.height, ground: snapshotSampler(terrain, baseY) }) as FencePart[] as GeneratorPart[]
      : compileSplitRail(data, terrain);
    return { ok: true, batches: batchParts(parts, data), length: pathLength(points, closed), ms: performance.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: translate(message, 'en') };
  }
}
