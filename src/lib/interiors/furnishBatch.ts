import type { Shape } from '../../types';
import type { SpatialRoom } from '../spatial/rooms';
import { planRoomFurnishing, pointInPolygonOrNear, type FurnishingPreset, type PresetItem } from './smartFurnish';
import type { InteriorFurnitureType } from './parametricFurniture';
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

/**
 * Adds one piece from the gallery to a room, using the same placement rules as furnishing: against a wall for
 * wall-hosted pieces, clear of doors and other furniture, related to what is already there (a chair goes to a desk
 * or table in the room, a bedside table to the bed). Pieces that need no wall (or a chair with no desk or table to
 * go to) stand in open floor space instead. `placed` is false when nothing fits.
 */
export function addFurnitureToRoom(shapes: readonly Shape[], room: SpatialRoom, rooms: readonly SpatialRoom[], type: InteriorFurnitureType, relax: boolean) {
  const anchors = furnishingsInRoom(shapes, room, rooms);
  const attempts: PresetItem[] = [{ type }, { type, free: { clearance: 0.35 } }, { type, free: { clearance: 0.1 } }];
  for (const item of attempts) {
    const plan = planRoomFurnishing(shapes, room, 'storage', { items: [item], curtains: false, anchors });
    if (!plan.shapes.length) continue;
    const added = relax ? plan.shapes.map(shape => {
      const sim = shape.customData?.semanticComponent?.simulation;
      return sim?.bakeable ? bakeSemanticSimulation(shape, sim.type === 'cloth' ? 0.32 : 0.42) : shape;
    }) : plan.shapes;
    return { shapes: [...shapes, ...added], placed: true, added };
  }
  return { shapes: [...shapes], placed: false, added: [] as Shape[] };
}
