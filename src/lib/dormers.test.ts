import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Shape } from '../types';
import { buildRoofAssemblyForRoom } from './archRoofGenerator';
import {
  cutForDormers, dormerCeilingAt, dormerFrame, dormerLayout, dormerMeshes, evenlySpaced, layoutsOf, pointInPolygon, type Dormer,
} from './dormers';
import { withRoofExtras, gutterRuns } from './roofExtras';
import { generateTimberFrameForRoof } from './timberFrameGenerator';
import { RoofSurface, eavePolygon, roofEdges } from './roofSurface';

const wall = (id: string, x: number, z: number, len: number, rotY: number, h = 2.8): Shape => ({
  id, type: 'wall', name: 'Room Wall', position: [x, h / 2, z], rotation: [0, rotY, 0], args: [len, h, 0.25], color: '#eee',
});
/** A 10 × 8 m box of walls under a 40° gable roof: the ridge runs along x, eaves face north and south. */
function gableHouse(wallHeight = 2.8) {
  const w = [
    wall('n', 0, -4, 10.25, 0, wallHeight), wall('s', 0, 4, 10.25, 0, wallHeight),
    wall('e', 5, 0, 8.25, Math.PI / 2, wallHeight), wall('w', -5, 0, 8.25, Math.PI / 2, wallHeight),
  ];
  const a = buildRoofAssemblyForRoom(w, { roofType: 'gable', pitchAngleDeg: 40, usePitchAngle: true, eaveOverhang: 0.4, color: '#7c2d12', tileShape: 'none' } as any, w)!;
  return { shapes: [...w, ...a.allShapes], roof: a.roofShape };
}
const dormer = (over: Partial<Dormer> = {}): Dormer => ({ id: 'd1', x: 0, z: 3.2, type: 'gable', width: 1.6, height: 1.3, flush: false, ...over });

describe('dormer layout', () => {
  it('stands a dormer on the south slope, facing south, with a hole outline behind its front wall', () => {
    const { roof } = gableHouse();
    const L = dormerLayout(roof, dormer())!;
    expect(L).toBeTruthy();
    expect(L.Z.z).toBeCloseTo(-1); // into the roof = up the south slope = towards -z
    expect(L.slope).toBeCloseTo(THREE.MathUtils.degToRad(40), 1);
    expect(L.origin.y).toBeGreaterThan(0.5); // standing on the roof, above the wall tops
    expect(L.depthCheek).toBeGreaterThan(1);
    expect(L.depthRoof).toBeGreaterThan(L.depthCheek);
    expect(L.footprint).toHaveLength(5);
    // The front middle is on the outline's front edge; a point a little behind it is inside.
    expect(pointInPolygon([0, 3.2 - 0.3], L.footprint)).toBe(true);
    expect(pointInPolygon([0, 3.2 + 0.3], L.footprint)).toBe(false);
  });

  it('builds a flush dormer on the wall line, cutting through the eave', () => {
    const { roof } = gableHouse();
    const L = dormerLayout(roof, dormer({ flush: true, height: 1.5 }))!;
    expect(L.origin.y).toBeCloseTo(0, 5); // on top of the wall below
    expect(Math.abs(L.origin.z - 4)).toBeLessThan(0.15); // the south wall's line
    // The outline reaches out past the wall line to take the eave with it.
    expect(Math.max(...L.footprint.map(p => p[1]))).toBeGreaterThan(4.4);
  });

  it('rejects dormers off the roof, over the ridge, or too wide for the slope', () => {
    const { roof } = gableHouse();
    expect(dormerLayout(roof, dormer({ z: 9 }))).toBeNull();
    expect(dormerLayout(roof, dormer({ z: 0.1 }))).toBeNull();
    expect(dormerLayout(roof, dormer({ width: 12 }))).toBeNull();
  });

  it('makes gable, flat and hipped dormers with walls, roof, glass and linings', () => {
    const { roof } = gableHouse();
    for (const type of ['gable', 'flat', 'hipped'] as const) {
      const m = dormerMeshes(dormerLayout(roof, dormer({ type }))!);
      expect(m.walls.length).toBeGreaterThan(5);
      expect(m.roofs.length).toBeGreaterThan(0);
      expect(m.glass).toHaveLength(1);
      expect(m.lining.length).toBe(3); // two cheek linings and a ceiling
    }
  });

  it('spaces dormers round the middle of a slope', () => {
    const { roof } = gableHouse();
    const ds = evenlySpaced(roof, 2, 'south');
    expect(ds).toHaveLength(2);
    expect(Math.abs(ds[0].x + ds[1].x)).toBeLessThan(0.25);
    expect(ds.every(d => dormerLayout(roof, d))).toBe(true);
  });
});

describe('the hole in the roof', () => {
  it('removes the roof over the dormer and nowhere else', () => {
    const { roof } = gableHouse();
    const L = dormerLayout(roof, dormer())!;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(roof.geometryData.positions, 3));
    const cut = cutForDormers(mergeVertices(g), [L], new THREE.Vector3(), 'solid', { Brush, Evaluator, SUBTRACTION });
    const hit = (geo: THREE.BufferGeometry, x: number, z: number) => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      return new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh).length > 0;
    };
    const inside = L.origin.clone().addScaledVector(L.Z, L.depthCheek / 2);
    expect(hit(g, inside.x, inside.z)).toBe(true);
    expect(hit(cut, inside.x, inside.z)).toBe(false);
    expect(hit(cut, 3.5, 2)).toBe(true);
    expect(hit(cut, 0, -2)).toBe(true);
  });

  it('drops the tiles inside the opening', () => {
    const { roof } = gableHouse();
    const L = dormerLayout(roof, dormer())!;
    const tiles = new THREE.BufferGeometry();
    const inside = L.origin.clone().addScaledVector(L.Z, 0.5);
    tiles.setAttribute('position', new THREE.Float32BufferAttribute([
      inside.x, 1, inside.z, inside.x + 0.1, 1, inside.z, inside.x, 1, inside.z + 0.1,
      4, 1, 2, 4.1, 1, 2, 4, 1, 2.1,
    ], 3));
    const out = cutForDormers(tiles, [L], new THREE.Vector3(), 'tiles', { Brush, Evaluator, SUBTRACTION });
    expect(out.attributes.position.count).toBe(3);
  });

  it('breaks the gutter round a flush dormer', () => {
    const { roof } = gableHouse();
    const L = dormerLayout(roof, dormer({ flush: true }))!;
    const surface = new RoofSurface(roof);
    const south = roofEdges(eavePolygon(roof), surface).find(e => e.out[1] > 0.9)!;
    surface.dispose();
    const runs = gutterRuns(south, [L]);
    expect(runs).toHaveLength(2);
    const covered = runs.reduce((a, [t0, t1]) => a + t1 - t0, 0);
    expect(covered).toBeCloseTo(south.length - 1.7, 1);
  });
});

describe('dormer timber and headroom', () => {
  it('frames the dormer: studs, lintel, plates, ridge and rafters', () => {
    const { roof } = gableHouse();
    const frame = dormerFrame(dormerLayout(roof, dormer())!);
    const kinds = new Set(frame.map(m => m.subTag));
    for (const k of ['timber-dormer-stud', 'timber-dormer-lintel', 'timber-dormer-plate', 'timber-dormer-ridge', 'timber-dormer-rafter']) expect(kinds.has(k)).toBe(true);
    const flat = dormerFrame(dormerLayout(roof, dormer({ type: 'flat' }))!);
    expect(flat.some(m => m.subTag === 'timber-dormer-joist')).toBe(true);
  });

  it('gives the ceiling height inside a dormer and nothing outside it', () => {
    const { shapes, roof } = gableHouse();
    const withD = withRoofExtras(shapes, roof.id, { dormerList: [dormer()] });
    const r = withD.find(s => s.id === roof.id)!;
    const layouts = layoutsOf(r);
    expect(layouts).toHaveLength(1);
    const L = layouts[0];
    const p = L.origin.clone().addScaledVector(L.Z, 0.6);
    expect(dormerCeilingAt(layouts, p.x, p.z)).toBeCloseTo(L.origin.y + L.height - 0.03);
    expect(dormerCeilingAt(layouts, 4, 2)).toBeNull();
    // And the dormer's shapes are on the model, linings included.
    expect(withD.some(s => s.tags?.includes('roof-extra-dormer-lining'))).toBe(true);
  });

  it('frames the main roof round the opening: no rafter through the hole, trimmers and headers beside it', () => {
    const { shapes, roof } = gableHouse();
    const withD = withRoofExtras(shapes, roof.id, { dormerList: [dormer()] });
    const r = withD.find(s => s.id === roof.id)!;
    const L = layoutsOf(r)[0];
    const frame = generateTimberFrameForRoof(r, withD);
    const tagged = (t: string) => frame.filter(s => s.tags?.includes(t));
    expect(tagged('timber-trimmer-rafter')).toHaveLength(4);
    expect(tagged('timber-header-rafter')).toHaveLength(2);
    expect(tagged('timber-dormer-stud').length).toBeGreaterThan(4);
    // Every common rafter or noggin, sampled along its length in plan, stays out of the hole.
    const inv = new THREE.Vector3(...r.position);
    const mains = frame.filter(s => /timber-(common-)?rafter|timber-roof-noggin/.test((s.tags ?? []).join(' ')) && !s.tags?.some(t => /dormer|trimmer|header/.test(t)));
    expect(mains.length).toBeGreaterThan(40);
    for (const m of mains) {
      const q = new THREE.Quaternion(...m.quaternion!);
      const half = new THREE.Vector3(0, 0, (m.args as number[])[2] / 2).applyQuaternion(q);
      const c = new THREE.Vector3(...m.position).sub(inv);
      for (const t of [-0.9, -0.5, 0, 0.5, 0.9]) {
        const p = c.clone().addScaledVector(half, t);
        expect(pointInPolygon([p.x, p.z], L.footprint)).toBe(false);
      }
    }
    // Without the dormer the same roof has no trimmers, and dormer shapes aren't framed as roofs.
    const plain = generateTimberFrameForRoof(roof, shapes);
    expect(plain.some(s => s.tags?.includes('timber-trimmer-rafter'))).toBe(false);
    const extra = withD.find(s => s.tags?.includes('roof-extra-dormer-roofs'))!;
    expect(generateTimberFrameForRoof(extra, withD).filter(s => s.id.includes(extra.id))).toHaveLength(0);
  });
});
