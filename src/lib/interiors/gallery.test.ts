import { describe, expect, it } from 'vitest';
import { galleryItems } from './gallery';
import { interiorFurnitureCatalog } from './parametricFurniture';
import { addFurnitureToRoom } from './furnishBatch';
import { detectRooms } from '../spatial/rooms';
import type { Shape } from '../../types';

const wall = (id: string, x: number, z: number, length: number, rotationY = 0): Shape => ({ id, type: 'wall', position: [x, 1.4, z], rotation: [0, rotationY, 0], args: [length, 2.8, 0.2], color: '#fff' });
const shell = (): Shape[] => [wall('n', 0, -3, 6.2), wall('s', 0, 3, 6.2), wall('w', -3, 0, 6.2, Math.PI / 2), wall('e', 3, 0, 6.2, Math.PI / 2)];

describe('Interior Studio gallery', () => {
  it('offers every furniture type except curtains, once', () => {
    const offered = galleryItems().flatMap(g => g.items.map(i => i.type));
    expect(new Set(offered).size).toBe(offered.length);
    const all = interiorFurnitureCatalog().map(e => e.type).filter(t => t !== 'curtain');
    expect(offered.sort()).toEqual(all.sort());
  });

  it('adds a piece inside the room, clear of the others, and reports when nothing fits', () => {
    let shapes = shell();
    const room = detectRooms(shapes, { cell: 0.1 })[0]!;
    const sofa = addFurnitureToRoom(shapes, room, [room], 'sofa', false);
    expect(sofa.placed).toBe(true);
    shapes = sofa.shapes;
    const chair = addFurnitureToRoom(shapes, room, [room], 'armchair', false);
    expect(chair.placed).toBe(true);
    expect(chair.added[0]!.position).not.toEqual(sofa.added[0]!.position);
    const tiny = [wall('n', 0, -0.5, 1.2), wall('s', 0, 0.5, 1.2), wall('w', -0.5, 0, 1.2, Math.PI / 2), wall('e', 0.5, 0, 1.2, Math.PI / 2)];
    const tinyRoom = detectRooms(tiny, { cell: 0.05, minAreaM2: 0.1 })[0];
    if (tinyRoom) expect(addFurnitureToRoom(tiny, tinyRoom, [tinyRoom], 'bed', false).placed).toBe(false);
  });

  it('puts a chair at a desk that is already in the room', () => {
    let shapes = shell();
    const room = detectRooms(shapes, { cell: 0.1 })[0]!;
    const desk = addFurnitureToRoom(shapes, room, [room], 'desk', false);
    shapes = desk.shapes;
    const chair = addFurnitureToRoom(shapes, room, [room], 'office-chair', false);
    expect(chair.placed).toBe(true);
    const d = desk.added[0]!.position, c = chair.added[0]!.position;
    expect(Math.hypot(d[0] - c[0], d[2] - c[2])).toBeLessThan(1.2);
  });
});
