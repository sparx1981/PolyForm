import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  arcPoint, bulgeThrough, buildPatio, clipToConvex, clipToConvexPieces, denseOutline, distanceToPolygon, gradePatioGround, offsetPolygon, polygonArea,
  pointInPolygon, stepAnchor, type Vec2,
} from './patioGeometry';
import { DEFAULT_PATIO_TEMPLATE, type PatioData } from './patioTypes';

const square = (w: number, d: number): Vec2[] => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

function patio(overrides: Partial<PatioData> = {}): PatioData {
  const points = overrides.points ?? square(4, 3);
  return {
    ...DEFAULT_PATIO_TEMPLATE, kind: 'patio', points,
    bulges: points.map(() => 0), wallEdges: points.map(() => false), steps: [], ...overrides,
  };
}

function area(geometry: THREE.BufferGeometry | undefined, upOnly = true): number {
  if (!geometry) return 0;
  const pos = geometry.getAttribute('position');
  let total = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (upOnly && n.y <= 1e-6) continue;
    total += n.length() / 2;
  }
  return total;
}

function maxY(geometry: THREE.BufferGeometry | undefined): number {
  if (!geometry) return -Infinity;
  geometry.computeBoundingBox();
  return geometry.boundingBox!.max.y;
}

const flat = () => -0.02;

describe('outline helpers', () => {
  it('bulgeThrough recovers the arc through a point, and arcPoint passes through it', () => {
    const a: Vec2 = [0, 0], b: Vec2 = [4, 0];
    for (const through of [[2, 1], [1, -0.8], [3.2, 0.5]] as Vec2[]) {
      const bulge = bulgeThrough(a, b, through);
      // Sample the arc densely: some sample must be very close to the through point.
      let best = Infinity;
      for (let i = 0; i <= 400; i++) {
        const p = arcPoint(a, b, bulge, i / 400);
        best = Math.min(best, Math.hypot(p[0] - through[0], p[1] - through[1]));
      }
      expect(best).toBeLessThan(0.02);
    }
    expect(bulgeThrough(a, b, [2, 0.005])).toBe(0);
  });

  it('dense outline is counter-clockwise and remembers the drawn edge of each segment', () => {
    const clockwise = square(4, 3).slice().reverse();
    const dense = denseOutline(clockwise, [0, 1, 0, 0]);
    expect(polygonArea(dense.points)).toBeGreaterThan(0);
    expect(dense.reversed).toBe(true);
    // The curved edge (drawn edge 1) is broken into several segments.
    expect(dense.edgeOf.filter(e => e === 1).length).toBeGreaterThan(3);
    // Every segment's midpoint lies on its own drawn edge's arc.
    for (let k = 0; k < dense.points.length; k++) {
      const edge = dense.edgeOf[k];
      const a = dense.points[k], b = dense.points[(k + 1) % dense.points.length];
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      let best = Infinity;
      for (let i = 0; i <= 200; i++) {
        const p = arcPoint(clockwise[edge], clockwise[(edge + 1) % 4], edge === 1 ? 1 : 0, i / 200);
        best = Math.min(best, Math.hypot(p[0] - mid[0], p[1] - mid[1]));
      }
      expect(best).toBeLessThan(0.05);
    }
  });

  it('splits a concave polygon into separate pieces instead of bridging the gap', () => {
    // A U shape cut by a horizontal strip across both arms: two separate pieces.
    const u: Vec2[] = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]];
    const pieces = clipToConvexPieces(u, [[-1, 1.5], [4, 1.5], [4, 2], [-1, 2]]);
    expect(pieces.length).toBe(2);
    expect(pieces.reduce((sum, p) => sum + Math.abs(polygonArea(p)), 0)).toBeCloseTo(1, 6);
  });

  it('clips a concave polygon to a convex window', () => {
    const l: Vec2[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
    const piece = clipToConvex(l, [[0.5, 0.5], [2, 0.5], [2, 2], [0.5, 2]]);
    // Window area 2.25, of which the L covers 1.5*0.5 + 0.5*1.0 = 1.25.
    expect(Math.abs(polygonArea(piece))).toBeCloseTo(1.25, 5);
    expect(offsetPolygon(square(2, 2), -0.1).every(p => Math.abs(p[0]) < 0.91 && Math.abs(p[1]) < 0.91)).toBe(true);
  });
});

describe('patio paving', () => {
  it.each(['slabs', 'block', 'natural', 'porcelain', 'gravel'] as const)('%s covers the patio without spilling over it', paving => {
    const data = patio({ paving, kerb: false, slabSize: paving === 'block' ? [0.2, 0.1] : paving === 'porcelain' ? [0.9, 0.6] : [0.6, 0.6] });
    const build = buildPatio(data, flat);
    const top = area(build.parts.surface);
    // Top faces of the pieces: nearly the whole 12 m² less joints and bevels, never more.
    // (Small bricks lose proportionally more to their joints and bevelled edges.)
    expect(top).toBeGreaterThan(12 * (paving === 'block' ? 0.7 : paving === 'natural' ? 0.8 : 0.85));
    expect(top).toBeLessThan(12.01);
    // All geometry inside the outline (plus its thickness of edge faces).
    const pos = build.parts.surface!.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getX(i))).toBeLessThanOrEqual(2.0001);
      expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(1.5001);
    }
    if (paving !== 'gravel') expect(build.stats.pieces).toBeGreaterThan(paving === 'block' ? 400 : 20);
  });

  it('600 × 600 slabs: about one slab per 0.36 m², and a kerb when asked', () => {
    const build = buildPatio(patio({ points: square(3.6, 2.4), kerb: false }), flat);
    expect(build.stats.pieces).toBeGreaterThanOrEqual(24);
    expect(build.stats.pieces).toBeLessThanOrEqual(35);
    expect(buildPatio(patio(), flat).parts.kerb).toBeDefined();
  });

  it('holds back higher ground with a retaining wall, and steps down to lower ground', () => {
    // Ground rises to the north (+z) and falls to the south.
    const slope = (_x: number, z: number) => z * 0.4;
    const data = patio({ steps: [{ edge: 0, t: 0.5, width: 1.2 }] });
    const build = buildPatio(data, slope);
    expect(build.parts.wall).toBeDefined();
    expect(maxY(build.parts.wall)).toBeGreaterThan(0.3);
    // Edge 0 runs along z = -1.5, where the ground is 0.6 m (+ slope beyond) below the surface.
    expect(build.stats.steps).toBeGreaterThanOrEqual(3);
    const anchor = stepAnchor(data, data.steps[0]);
    expect(anchor.normal[1]).toBeLessThan(-0.9);
  });

  it('levels the terrain under a patio, only ever lowering it', () => {
    const size = 11;
    const heights = Array.from({ length: size * size }, (_, i) => (Math.floor(i / size) - 5) * 0.2);
    const terrain = { position: [0, 0, 0] as [number, number, number], terrainData: { gridX: size, gridY: size, width: 10, depth: 10, heights } };
    const shape = { type: 'patio', position: [0, 0.1, 0] as [number, number, number], patioData: patio() };
    const graded = gradePatioGround(terrain, [shape])!;
    expect(graded).not.toBe(heights);
    for (let i = 0; i < heights.length; i++) expect(graded[i]).toBeLessThanOrEqual(heights[i] + 1e-9);
    // Centre vertex (0, 0): below the paving.
    expect(graded[5 * size + 5]).toBeLessThan(0.1);
    // Decks leave the ground alone.
    expect(gradePatioGround(terrain, [{ ...shape, patioData: { ...shape.patioData, kind: 'deck' } }])).toBe(heights);
  });
});

describe('decks', () => {
  const deck = (overrides: Partial<PatioData> = {}) => patio({ kind: 'deck', color: '#b8915c', ...overrides });
  const raised = () => -0.6;

  it('covers the deck with boards of the chosen width, on a frame of joists, beams and posts', () => {
    const build = buildPatio(deck({ pictureFrame: false }), raised);
    const expected = 12 / (0.144 + 0.005);
    expect(build.stats.boardLength).toBeGreaterThan(expected * 0.9);
    expect(build.stats.boardLength).toBeLessThan(expected * 1.1);
    expect(build.parts.frame).toBeDefined();
    expect(build.parts.frame!.boundingBox ?? (build.parts.frame!.computeBoundingBox(), build.parts.frame!.boundingBox)).toBeTruthy();
    expect(build.parts.frame!.boundingBox!.min.y).toBeLessThan(-0.6);
    expect(build.parts.fascia).toBeDefined();
  });

  it('skirting closes the sides down to the ground instead of showing the frame', () => {
    const build = buildPatio(deck({ underside: 'skirting', fascia: false }), raised);
    build.parts.fascia!.computeBoundingBox();
    expect(build.parts.fascia!.boundingBox!.min.y).toBeLessThan(-0.6);
  });

  it.each(['timber', 'glass', 'cable'] as const)('%s railing runs round the open edges but not along the house', railing => {
    const walls = [false, false, true, false];
    const build = buildPatio(deck({ railing, wallEdges: walls }), raised);
    const rails = build.parts.railTimber ?? build.parts.railMetal;
    expect(rails).toBeDefined();
    expect(maxY(rails)).toBeGreaterThan(0.95);
    if (railing === 'glass') expect(build.parts.glass).toBeDefined();
    // Nothing along the wall edge (edge 2 runs along z = +1.5).
    const all = [build.parts.railTimber, build.parts.railMetal, build.parts.glass].filter(Boolean) as THREE.BufferGeometry[];
    for (const g of all) {
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0.5) expect(pos.getZ(i) > 1.35 && Math.abs(pos.getX(i)) < 1.7).toBe(false);
      }
    }
  });

  it('adds step flights and lights (in the deck and the risers)', () => {
    const build = buildPatio(deck({ steps: [{ edge: 0, t: 0.5, width: 1 }], lights: { ...DEFAULT_PATIO_TEMPLATE.lights, enabled: true } }), raised);
    expect(build.stats.steps).toBeGreaterThanOrEqual(3);
    expect(build.lights.length).toBeGreaterThan(6);
    expect(build.lights.some(l => l.y < -0.1)).toBe(true);
    expect(build.parts.lights).toBeDefined();
  });

  it('curved edges stay inside their arc', () => {
    const points = square(4, 3);
    const build = buildPatio(deck({ points, bulges: [0.8, 0, 0, 0], pictureFrame: true }), raised);
    const dense = denseOutline(points, [0.8, 0, 0, 0]).points;
    const pos = build.parts.surface!.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // Inside, or on the boundary within a centimetre (mitred frame corners).
      if (!pointInPolygon(x, z, dense)) expect(distanceToPolygon(x, z, dense)).toBeLessThan(0.015);
    }
  });
});
