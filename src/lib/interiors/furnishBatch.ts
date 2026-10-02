import type { Shape } from '../../types';
import type { SpatialRoom } from '../spatial/rooms';
import { planRoomFurnishing, pointInPolygonOrNear, type FurnishingPreset } from './smartFurnish';
import { bakeSemanticSimulation } from './bakeSimulation';
import { planRoomLighting, lightingTypeForPreset } from './roomLighting';

export interface RoomFurnishingRequest { roomId: string; preset: FurnishingPreset; replaceExisting: boolean; /** Also add lighting suited to the room type. */ lighting?: boolean }

export function furnishingsInRoom(shapes: readonly Shape[], room: SpatialRoom, rooms: readonly SpatialRoom[]): Shape[] {
  const ceiling = rooms.filter(other => other.elevation > room.elevation + 0.5).reduce((top, other) => Math.min(top, other.elevation), room.elevation + 2.8);
  return shapes.filter(shape => (shape.customData?.furnitureType || shape.tags?.includes('furniture') || shape.customData?.semanticComponent?.kind === 'furniture')
    && shape.position[1] >= room.elevation - 0.1 && shape.position[1] < ceiling - 0.1
    && pointInPolygonOrNear([shape.position[0], shape.position[2]], room.boundary));
}

/** Validate the whole queue first, then plan sequentially against the resulting scene.
 * Only identifiable furniture inside the selected room is replaced; architectural objects survive. */
export function furnishRooms(shapes: readonly Shape[], rooms: readonly SpatialRoom[], requests: readonly RoomFurnishingRequest[], relax: boolean) {
  if (new Set(requests.map(request => request.roomId)).size !== requests.length) throw new Error('Each room can appear in the queue only once.');
  const selected = requests.map(request => {
    const room = rooms.find(room => room.id === request.roomId);
    if (!room) throw new Error('A queued room no longer exists. Review the floor plan and queue again.');
    return { request, room };
  });
  let next = [...shapes];
  const results: { roomId: string; placed: number; removed: number; skipped: number; lights: number }[] = [];
  for (const { request, room } of selected) {
    const removed = request.replaceExisting ? furnishingsInRoom(next, room, rooms).map(shape => shape.id) : [];
    const removeIds = new Set(removed);
    next = next.filter(shape => !removeIds.has(shape.id));
    const plan = planRoomFurnishing(next, room, request.preset);
    const inserted = relax ? plan.shapes.map(shape => {
      const sim = shape.customData?.semanticComponent?.simulation;
      return sim?.bakeable ? bakeSemanticSimulation(shape, sim.type === 'cloth' ? 0.32 : 0.42) : shape;
    }) : plan.shapes;
    // A completely unplaceable replacement must not leave a furnished room empty.
    if (removed.length && !inserted.length) throw new Error(`No items fit in ${room.name ?? `Room ${room.level}`}. Existing furnishings were kept; the queue was not applied.`);
    next.push(...inserted);
    let lights = 0;
    if (request.lighting) {
      // Replace this room's earlier lighting so furnishing again never stacks fixtures.
      next = next.filter(shape => shape.customData?.interiorLightRoom !== room.id);
      const lamps = planRoomLighting(next, room, lightingTypeForPreset(request.preset));
      next.push(...lamps);
      lights = lamps.length;
    }
    results.push({ roomId: room.id, placed: inserted.length, removed: removed.length, skipped: plan.unplaced.length, lights });
  }
  return { shapes: next, results };
}
