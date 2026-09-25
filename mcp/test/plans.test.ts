import { describe, expect, it } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import type { Shape } from '../../src/types';
import { openingInWall, withSdk } from '../src/ops';
import { buildingLevels, floorPlans, withStoryTags } from '../src/plans';
import { svgToPng } from '../src/raster';

type P = [number, number, number];

/** A 10 × 8 m two-storey house: two rooms downstairs (door between), three up, stairs. */
function house(): Shape[] {
  let shapes: Shape[] = [];
  const wall = (start: P, end: P) => {
    const run = withSdk(shapes, sdk => sdk.architecture.createWall({ start, end, height: 2.8 }));
    shapes = run.shapes;
    return run.created[0];
  };
  for (const y of [0, 3]) {
    const s = wall([0, y, 0], [10, y, 0]);
    wall([10, y, 0], [10, y, 8]);
    const front = wall([10, y, 8], [0, y, 8]);
    wall([0, y, 8], [0, y, 0]);
    const mid = wall([5, y, 0], [5, y, 8]);
    shapes.push(openingInWall(mid, 'door', { along: 6 }), openingInWall(s, 'window', { along: 2.5 }));
    if (y === 0) shapes.push(openingInWall(front, 'door', { along: 3 }));
    if (y === 3) wall([5, y, 4], [10, y, 4]);
    shapes.push({ id: `slab${y}`, type: 'box', name: y ? 'First Floor Slab' : 'Ground Floor Slab', position: [5, y - 0.1, 4], args: [10, 0.2, 8], color: '#999' } as Shape);
  }
  shapes.push({ id: 'st', type: 'staircase', name: 'Stairs', position: [1, 1.5, 3], rotation: [0, 0, 0], args: [1, 3, 3.6, 14] } as Shape);
  return shapes;
}

describe('floor plans', () => {
  it('groups walls into storeys and finds the rooms they enclose', () => {
    const shapes = house();
    const levels = buildingLevels(shapes);
    expect(levels.map(l => [l.level, l.elevation, l.walls.length])).toEqual([[1, 0, 5], [2, 3, 6]]);
    expect(levels[0].stairs.map(s => s.id)).toEqual(['st']);
    expect(levels[1].stairs).toEqual([]);

    const plans = floorPlans(shapes, [{ level: 1, at: [2, 4], name: 'Lounge' }, { level: 1, at: [8, 4], name: 'Kitchen' }]);
    expect(plans.map(p => p.rooms.length)).toEqual([2, 3]);
    const lounge = plans[0].rooms.find(r => r.name === 'Lounge')!;
    // 4.8 × 7.8 m inside the walls.
    expect(lounge.areaM2).toBeGreaterThan(35);
    expect(lounge.areaM2).toBeLessThan(39);
    expect(plans[0].rooms.find(r => r.name === 'Kitchen')).toBeTruthy();
    expect(plans[0].svg).toContain('Level 1');
  });

  it('draws nothing for a model without walls', () => {
    expect(floorPlans([{ id: 't', type: 'box', position: [0, 0.5, 0], args: [1, 1, 1] } as Shape])).toEqual([]);
  });

  it('renders the plans as PNG pictures', async () => {
    const plans = floorPlans(house(), [{ level: 1, at: [2, 4], name: 'Lounge' }]);
    const pngs = await Promise.all(plans.map(p => svgToPng(p.svg)));
    for (const png of pngs) expect(png.subarray(1, 4).toString()).toBe('PNG');
    if (process.env.PLAN_OUT) {
      await mkdir(process.env.PLAN_OUT, { recursive: true });
      await Promise.all(pngs.map((png, i) => writeFile(`${process.env.PLAN_OUT}/level-${i + 1}.png`, png)));
    }
  });

  it('tags walls and floor slabs with their storey', () => {
    const tagged = withStoryTags(house());
    const story = (s: Shape) => s.tags?.find(t => t.startsWith('story-'));
    expect(story(tagged.find(s => s.id === 'slab0')!)).toBe('story-1');
    expect(story(tagged.find(s => s.id === 'slab3')!)).toBe('story-2');
    expect(new Set(tagged.filter(s => s.type === 'wall' && s.position[1] > 3).map(story))).toEqual(new Set(['story-2']));
    expect(tagged.find(s => s.type === 'door')!.tags ?? []).not.toContain('story-1');
  });
});
