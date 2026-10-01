import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { detectRooms } from '../spatial/rooms';
import { furnishRooms } from './furnishBatch';
import { createInteriorFurnitureShape } from './parametricFurniture';
const walls = (prefix: string, elevation = 0): Shape[] => [[0,-4,0],[0,4,0],[-4,0,Math.PI/2],[4,0,Math.PI/2]].map(([x,z,yaw], i) => ({
  id: `${prefix}-${i}`, type: 'wall', position: [x,elevation+1.4,z], rotation: [0,yaw,0], args: [8,2.8,0.2], color: '#fff',
}));
describe('queued room furnishing', () => {
  it('applies different presets across floors without touching other floors when replacing', () => {
    const building = [...walls('ground'), ...walls('upper', 2.8)];
    const rooms = detectRooms(building, { cell: 0.1 });
    const old = createInteriorFurnitureShape('coffee-table', { id: 'old', position: [0,0,0], roomId: rooms[0].id });
    const upstairs = createInteriorFurnitureShape('coffee-table', { id: 'upstairs', position: [0,2.8,0], roomId: rooms[1].id });
    const result = furnishRooms([...building, old, upstairs], rooms, [
      { roomId: rooms[0].id, preset: 'bedroom', replaceExisting: true },
      { roomId: rooms[1].id, preset: 'storage', replaceExisting: false },
    ], true);
    expect(result.shapes.some(shape => shape.id === 'old')).toBe(false);
    expect(result.shapes.some(shape => shape.id === 'upstairs')).toBe(true);
    expect(result.shapes.filter(shape => shape.type === 'wall')).toHaveLength(8);
    expect(result.results.map(result => result.removed)).toEqual([1,0]);
    expect(result.shapes.some(shape => shape.customData?.furnitureType === 'bed')).toBe(true);
    expect(result.results.every(result => result.placed > 0)).toBe(true);
  });
  it('keeps existing furnishings by default, including manually assigned furniture in the room', () => {
    const building = walls('ground'), rooms = detectRooms(building, { cell: 0.1 });
    const old = createInteriorFurnitureShape('nightstand', { id: 'old', position: [0,0,0] });
    const result = furnishRooms([...building,old], rooms, [{roomId: rooms[0].id,preset:'minimal',replaceExisting:false}], false);
    expect(result.shapes.some(shape => shape.id === 'old')).toBe(true);
    expect(result.results[0].removed).toBe(0);
  });
  it('rejects stale or duplicate room requests before changing any furnishings', () => {
    const building = walls('ground'), rooms = detectRooms(building, { cell: 0.1 });
    const request = {roomId:rooms[0].id,preset:'minimal' as const,replaceExisting:true};
    expect(() => furnishRooms(building,rooms,[request,request],false)).toThrow('only once');
    expect(() => furnishRooms(building,rooms,[request,{...request,roomId:'missing'}],false)).toThrow('no longer exists');
    expect(building).toHaveLength(4);
  });
});
