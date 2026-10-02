import { describe, expect, it } from 'vitest';
import { BoxCollider, PlaneCollider, XpbdCloth, gridTopology } from './xpbd';
import { createCurtainPanels, CurtainCloth } from '../interiors/curtainCloth';
import { createInteriorFurnitureShape } from '../interiors/parametricFurniture';
import { bakeSemanticSimulation } from '../interiors/bakeSimulation';

/**
 * Physics fingerprints: the solver is deterministic, so a canonical scenario gives the same numbers every
 * run. If one of these moves, cloth behaviour changed. That is sometimes the point of a change; when it is
 * not, this is the test that notices. Update the values only after looking at the result.
 */
const near = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 3);

describe('cloth fingerprints', () => {
  it('a sheet draped over a box and the floor', () => {
    const columns = 20, rows = 20, w = 1.2, positions: number[] = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) positions.push((c / columns - 0.5) * w, 0.6, (r / rows - 0.5) * w);
    const { triangles, extraEdges } = gridTopology(columns, rows);
    const cloth = new XpbdCloth({ positions, triangles, extraEdges });
    for (let i = 0; i < 240; i++) cloth.step(1 / 60, { substeps: 6, colliders: [new BoxCollider([0, 0.25, 0], [0.3, 0.25, 0.3]), new PlaneCollider([0, 0, 0], [0, 1, 0])] });
    near(cloth.positions[(10 * 21 + 10) * 3 + 1]!, 0.51);
    near(cloth.positions[1]!, 0.10679);
    near(cloth.positions[(10 * 21) * 3 + 1]!, 0.21288);
  });

  it('a curtain in a steady breeze into the room', () => {
    const curtains = createCurtainPanels({ width: 2, height: 2.2, openAmount: 0.4, fullness: 1.8, foldDepth: 0.065 }).map(p => new CurtainCloth(p));
    for (let i = 0; i < 240; i++) for (const c of curtains) c.update(1 / 60, { x: 1, z: 3, speed: 2 });
    let sum = 0, n = 0;
    for (const c of curtains) for (let i = 2; i < c.positions.length; i += 3) { sum += c.positions[i]!; n++; }
    near(sum / n, 0.26093);
  });

  it('a bed with its duvet draped at the Interior Studio strength', () => {
    const bed = createInteriorFurnitureShape('bed');
    const baked = bakeSemanticSimulation(bed, 0.42);
    const duvet = (bed.customData.furniturePartRanges as Array<{ role?: string; start: number; count: number }>).filter(p => p.role === 'duvet').reduce((a, b) => (b.count > a.count ? b : a));
    let sum = 0;
    for (let i = duvet.start; i < duvet.start + duvet.count; i++) sum += baked.geometryData.positions[i * 3 + 1]!;
    near(sum / duvet.count, 0.5993);
  });
});
