import { describe, expect, it } from 'vitest';
import type { Shape } from '../types';
import { buildRoofsForBuilding, ceilingSlabsFor, extensionsOf, rebuildExtensionRoof, roofWholeBuilding, storeysOf } from './buildingRoofs';
import { buildRoofAssemblyForRoom } from './archRoofGenerator';
import { upgradeRoofs } from './roofUpgrade';
import { frameSkeletonRoof } from './roofFraming';

type V2 = [number, number];
let wid = 0;
function wallsOf(poly: V2[], base: number, h = 2.8): Shape[] {
  return poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    return { id: `w${wid++}`, type: 'wall', name: 'Room Wall', position: [(p[0] + q[0]) / 2, base + h / 2, (p[1] + q[1]) / 2], rotation: [0, Math.atan2(-dz, dx), 0], args: [len + 0.25, h, 0.25], color: '#eee' } as Shape;
  });
}
const params = { roofType: 'gable' as const, pitchAngleDeg: 40, usePitchAngle: true, eaveOverhang: 0.4 };
const roofsIn = (shapes: Shape[]) => shapes.filter(s => s.tags?.includes('roof-assembly'));

describe('roofing a building storey by storey', () => {
  // A two-storey 10 × 8 house with a single-storey extension 4 m deep across the back.
  const ground = wallsOf([[0, 0], [10, 0], [10, 12], [0, 12]], 0);
  const inside = wallsOf([[0, 8], [10, 8]], 0).slice(0, 1); // the old back wall, now inside
  const upper = wallsOf([[0, 0], [10, 0], [10, 8], [0, 8]], 2.8);

  it('finds the storeys and their outlines, ignoring walls inside', () => {
    const st = storeysOf([...ground, ...inside, ...upper]);
    expect(st).toHaveLength(2);
    expect(st[0].top).toBeCloseTo(2.8);
    const xs = st[0].outline.map(p => p[0]), zs = st[0].outline.map(p => p[1]);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)].map(v => (+v.toFixed(3)) || 0)).toEqual([0, 10, 0, 12]);
    expect(st[1].outline).toHaveLength(4);
  });

  it('finds the extension and the stretch of house wall it meets', () => {
    const shapes = [...ground, ...upper];
    const { plans } = extensionsOf(storeysOf(shapes), shapes);
    expect(plans).toHaveLength(1);
    const { abut } = plans[0];
    expect([abut.a, abut.b].map(p => p.map(v => (+v.toFixed(3)) || 0)).sort()).toEqual([[0, 8], [10, 8]]);
  });

  it('puts the main roof on the top storey and a lean-to on the extension', () => {
    const shapes = [...ground, ...upper];
    const r = buildRoofsForBuilding(shapes, params)!;
    const roofs = roofsIn(r.shapes);
    expect(roofs).toHaveLength(2);
    const [main, ext] = roofs[0].roofData.extension ? [roofs[1], roofs[0]] : [roofs[0], roofs[1]];
    expect(main.position[1]).toBeCloseTo(5.6);
    expect(Math.max(...main.roofData.localWallPoly.map((p: V2) => p[1] + main.position[2]))).toBeCloseTo(8);
    expect(ext.position[1]).toBeCloseTo(2.8);
    expect(ext.roofData.extension.kind).toBe('lean-to');
    expect(ext.name).toMatch(/Lean-to/);
    // No windows above: the main roof's pitch would take it 3.6 m up, past the first floor's
    // eaves, so it stops 0.5 m below them (2.8 - 0.5).
    expect(ext.roofData.skeleton.ridgeHeight).toBeCloseTo(2.3, 2);
    expect(r.notes).toEqual([]);
    // Its timber: rafters up to a ledger on the house wall.
    const f = frameSkeletonRoof(ext.roofData.skeleton);
    expect(f.members.some(m => m.name.startsWith('Wall Plate (Ledger)'))).toBe(true);
  });

  it('keeps a lean-to under the windows above it, and says when that makes it shallow', () => {
    const shapes = [...ground, ...upper];
    const back = upper.find(w => Math.abs(w.position[2] - 8) < 1e-6)!;
    // A first-floor window over the extension with its sill 0.9 m above the floor (so 3.7 m up).
    const win = { id: 'win', type: 'window', name: 'Window', hostWallId: back.id, position: [5, 2.8 + 0.9 + 0.6, 8], rotation: [0, 0, 0], args: [1.2, 1.2, 0.1], color: '#fff' } as Shape;
    const r = buildRoofsForBuilding([...shapes, win], params)!;
    const ext = roofsIn(r.shapes).find(s => s.roofData.extension)!;
    expect(ext.roofData.skeleton.ridgeHeight).toBeCloseTo(0.9 - 0.15, 2);
    expect(ext.roofData.pitchAngleDeg).toBeLessThan(15);
    expect(r.notes.join(' ')).toMatch(/stay under the windows/);
  });

  it('can give extensions a pitched or flat roof instead', () => {
    const shapes = [...ground, ...upper];
    const pitched = roofsIn(buildRoofsForBuilding(shapes, params, 'pitched')!.shapes).find(s => s.roofData.extension)!;
    expect(pitched.roofData.extension.kind).toBe('pitched');
    const flat = roofsIn(buildRoofsForBuilding(shapes, params, 'flat')!.shapes).find(s => s.position[1] < 3)!;
    expect(flat.roofData.roofType).toBe('parapet');
  });

  it('roofs a single-storey building as before, and a house whose floors match with no extension roof', () => {
    expect(roofsIn(buildRoofsForBuilding(ground, params)!.shapes)).toHaveLength(1);
    const same = [...wallsOf([[0, 0], [10, 0], [10, 8], [0, 8]], 0), ...upper];
    expect(roofsIn(buildRoofsForBuilding(same, params)!.shapes)).toHaveLength(1);
  });

  it('switches an extension roof between lean-to, pitched and flat, keeping where it sits', () => {
    const shapes = [...ground, ...upper];
    const built = buildRoofsForBuilding(shapes, { ...params, tileShape: 'roman' })!.shapes;
    let all = [...shapes, ...built];
    const ext = () => roofsIn(all).find(s => s.roofData.extensionSite)!;
    for (const kind of ['pitched', 'flat', 'lean-to'] as const) {
      const r = rebuildExtensionRoof(all, ext().id, kind)!;
      all = r.shapes;
      expect(roofsIn(all)).toHaveLength(2);
      expect(ext().position[1]).toBeCloseTo(2.8);
      expect(kind === 'flat' ? ext().roofData.roofType : ext().roofData.extension.kind).toBe(kind === 'flat' ? 'parapet' : kind);
    }
    // The tiles came along.
    expect(all.some(s => s.parentShapeId === ext().id && s.tags?.includes('roof-tiles') && s.geometryData.positions.length > 0)).toBe(true);
  });

  it('redoes an older model\'s single roof over several storeys when it opens', () => {
    const shapes = [...ground, ...upper];
    // What the roof button used to make: one roof traced round every wall.
    const old = buildRoofAssemblyForRoom(shapes, { ...params } as any, shapes)!;
    const saved = [...shapes, ...old.allShapes.map(s => (s.id === old.roofShape.id ? { ...s, roofData: { ...s.roofData, buildVersion: undefined, skeleton: undefined } } : s))];
    const up = upgradeRoofs(saved);
    const roofs = roofsIn(up);
    expect(roofs).toHaveLength(2);
    expect(roofs.some(r => r.roofData.extension?.kind === 'lean-to')).toBe(true);
    expect(roofs.find(r => !r.roofData.extensionSite)!.position[1]).toBeCloseTo(5.6);
  });
});

describe('ceilings under a roof', () => {
  const house = wallsOf([[0, 0], [6, 0], [6, 4], [0, 4]], 0);
  const roofing = { roofType: 'gable' as const, pitchAngleDeg: 35, usePitchAngle: true };

  it('gives a roofed single storey a ceiling whose underside is the top of its walls', () => {
    const ceilings = ceilingSlabsFor(house);
    expect(ceilings).toHaveLength(1);
    const slab = ceilings[0];
    expect(slab.tags).toContain('ceiling-slab');
    const height = (slab.args as { height: number }).height;
    expect(slab.position[1] - height / 2).toBeCloseTo(2.8, 6);
    expect(height).toBeGreaterThanOrEqual(0.15);
  });

  it('is added with the roof and replaced, not doubled, when roofing again', () => {
    const first = roofWholeBuilding(house, roofing)!;
    expect(first.shapes.filter(s => s.tags?.includes('ceiling-slab'))).toHaveLength(1);
    const second = roofWholeBuilding(first.shapes, roofing)!;
    expect(second.shapes.filter(s => s.tags?.includes('ceiling-slab'))).toHaveLength(1);
  });

  it('only ceils the top of the building: a lower storey has the upper floor slab over it instead', () => {
    const two = [...house, ...wallsOf([[0, 0], [6, 0], [6, 4], [0, 4]], 2.8)];
    const ceilings = ceilingSlabsFor(two);
    expect(ceilings).toHaveLength(1);
    expect(ceilings[0].position[1]).toBeGreaterThan(5.6);
  });

  it('leaves a storey alone when a floor slab already sits on its walls', () => {
    const slab = { id: 'fs', type: 'poly', name: 'Floor Slab', position: [3, 2.9, 2], args: { vertices: [], height: 0.2, holes: [] }, tags: ['floor-slab'] } as unknown as Shape;
    expect(ceilingSlabsFor([...house, slab])).toHaveLength(0);
  });
});
