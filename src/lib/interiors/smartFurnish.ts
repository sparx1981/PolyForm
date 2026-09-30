import type { Shape } from '../../types';
import {
  createInteriorFurnitureShape,
  interiorFurnitureCatalog,
  interiorFurnitureDefinition,
  type InteriorFurnitureType,
} from './parametricFurniture';
import type { SpatialRoom } from '../spatial/rooms';
import {
  placementCollisions,
  wallPlacementCandidate,
  type OrientedFootprint,
} from '../spatial/placement';

export type FurnishingPreset = 'bedroom' | 'living-room' | 'soft-furnishings' | 'storage' | 'minimal';

export interface FurnishingPlan {
  roomId: string;
  preset: FurnishingPreset;
  shapes: Shape[];
  unplaced: InteriorFurnitureType[];
}

const PRESETS: Record<FurnishingPreset, InteriorFurnitureType[]> = {
  bedroom: ['bed', 'cabinet', 'cabinet'],
  'living-room': ['sofa', 'cabinet'],
  'soft-furnishings': ['sofa', 'curtain'],
  storage: ['cabinet', 'cabinet', 'cabinet'],
  minimal: ['sofa'],
};

function rotationY(shape: Shape): number {
  return shape.rotation?.[1] ?? 0;
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  let inside = false;
  const [x, z] = point;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    const intersects = ((zi > z) !== (zj > z))
      && x < ((xj - xi) * (z - zi)) / ((zj - zi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygonOrNear(point: [number, number], polygon: Array<[number, number]>, tolerance = 0.08): boolean {
  if (pointInPolygon(point, polygon)) return true;
  if (polygon.length < 2) return false;
  const [px, pz] = point;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const t = len2 <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2));
    const x = a[0] + dx * t, z = a[1] + dz * t;
    if (Math.hypot(px - x, pz - z) <= tolerance) return true;
  }
  return false;
}

function semanticFootprint(shape: Shape): OrientedFootprint | null {
  const semantic = shape.customData?.semanticComponent;
  if (!semantic) return null;
  const params = semantic.params ?? {};
  const width = Number(params.width ?? (Array.isArray(shape.args) ? shape.args[0] : 0));
  const depth = Number(params.depth ?? (Array.isArray(shape.args) ? shape.args[2] : 0));
  if (!(width > 0) || !(depth > 0)) return null;
  return {
    id: shape.id,
    kind: semantic.kind,
    center: [shape.position[0], shape.position[2]],
    halfSize: [width / 2, depth / 2],
    rotationY: rotationY(shape),
  };
}

function openingFootprint(shape: Shape): OrientedFootprint | null {
  if ((shape.type !== 'door' && shape.type !== 'window') || !Array.isArray(shape.args)) return null;
  const width = Number(shape.args[0]) || 0;
  if (!(width > 0)) return null;
  // Reserve useful access space around openings rather than only their thin wall depth.
  const depth = shape.type === 'door' ? 1.1 : 0.45;
  return {
    id: shape.id,
    center: [shape.position[0], shape.position[2]],
    halfSize: [width / 2, depth / 2],
    rotationY: rotationY(shape),
  };
}

function furnitureDefaults(type: InteriorFurnitureType) {
  const item = interiorFurnitureCatalog().find(entry => entry.type === type);
  if (!item) throw new Error(`Unknown interior furniture type: ${type}`);
  return item.defaults;
}

function candidateFootprint(
  type: InteriorFurnitureType,
  position: [number, number, number],
  yaw: number,
): OrientedFootprint {
  const defaults = furnitureDefaults(type);
  return {
    kind: interiorFurnitureDefinition(type).kind,
    center: [position[0], position[2]],
    halfSize: [defaults.width / 2, defaults.depth / 2],
    rotationY: yaw,
  };
}

function candidateTs(count: number): number[] {
  if (count <= 1) return [0];
  return [-0.3, 0.3, 0, -0.15, 0.15];
}

export function planRoomFurnishing(
  allShapes: readonly Shape[],
  room: SpatialRoom,
  preset: FurnishingPreset,
): FurnishingPlan {
  const walls = room.boundaryWallIds
    .map(id => allShapes.find(shape => shape.id === id))
    .filter((shape): shape is Shape => Boolean(shape && shape.type === 'wall'))
    .sort((a, b) => (Array.isArray(b.args) ? Number(b.args[0]) : 0) - (Array.isArray(a.args) ? Number(a.args[0]) : 0));

  const obstacles: OrientedFootprint[] = allShapes
    .filter(shape => !shape.hidden)
    .flatMap(shape => {
      const semantic = semanticFootprint(shape);
      if (semantic) return [semantic];
      const opening = openingFootprint(shape);
      return opening ? [opening] : [];
    });

  const planned: Shape[] = [];
  const unplaced: InteriorFurnitureType[] = [];
  const types = PRESETS[preset];

  for (const type of types) {
    const defaults = furnitureDefaults(type);
    const profile = interiorFurnitureDefinition(type).placement;
    let placed: Shape | null = null;

    for (const wall of walls) {
      for (const t of candidateTs(types.length)) {
        const candidate = wallPlacementCandidate(wall, t, defaults.depth);
        if (!candidate) continue;

        // A wall's local +Z is not guaranteed to face the room. Imported walls, rooms drawn in
        // the opposite winding direction and older models may legitimately point the other way.
        // The placement helper gives one face; try its mirror across the wall centreline too and
        // let the room-boundary/collision checks choose the valid side. This keeps furnishing
        // independent of wall orientation instead of silently losing wall-hosted items.
        const dx = candidate.position[0] - wall.position[0];
        const dz = candidate.position[2] - wall.position[2];
        const angle = candidate.rotationY ?? 0;
        const nx = Math.sin(angle), nz = Math.cos(angle);
        const normalOffset = dx * nx + dz * nz;
        const candidatePositions: [number, number, number][] = [
          [candidate.position[0], room.elevation, candidate.position[2]],
          [
            candidate.position[0] - 2 * normalOffset * nx,
            room.elevation,
            candidate.position[2] - 2 * normalOffset * nz,
          ],
        ];

        for (const position of candidatePositions) {
          const yaw = candidate.rotationY ?? 0;
          const footprint = candidateFootprint(type, position, yaw);
          // Room detection is raster-derived, so its hull can sit a few centimetres inside the
          // actual wall face. Treat a centre very close to that hull as inside; this matters for
          // shallow wall-hosted objects such as curtains while still rejecting the mirrored
          // candidate on the outside face.
          if (room.boundary.length >= 3 && !pointInPolygonOrNear(footprint.center, room.boundary)) continue;
          if (placementCollisions(footprint, obstacles, profile).length > 0) continue;

          placed = createInteriorFurnitureShape(type, {
            position,
            rotationY: yaw,
            roomId: room.id,
          });
          const placedFootprint = semanticFootprint(placed);
          if (placedFootprint) obstacles.push(placedFootprint);
          planned.push(placed);
          break;
        }
        if (placed) break;
      }
      if (placed) break;
    }

    if (!placed) {
      // Centre fallback is only used for floor-hostable furniture and still
      // respects collision/clearance rules.
      if (profile.hosts.includes('floor') || profile.hosts.includes('room')) {
        const position: [number, number, number] = [room.at[0], room.elevation, room.at[1]];
        const footprint = candidateFootprint(type, position, 0);
        if (placementCollisions(footprint, obstacles, profile).length === 0) {
          placed = createInteriorFurnitureShape(type, { position, roomId: room.id });
          const placedFootprint = semanticFootprint(placed);
          if (placedFootprint) obstacles.push(placedFootprint);
          planned.push(placed);
        }
      }
    }

    if (!placed) unplaced.push(type);
  }

  return { roomId: room.id, preset, shapes: planned, unplaced };
}
