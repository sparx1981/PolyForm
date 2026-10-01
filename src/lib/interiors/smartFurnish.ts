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
  clearanceFootprint,
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
  bedroom: ['bed', 'nightstand', 'nightstand', 'cabinet', 'console', 'armchair'],
  'living-room': ['sofa', 'coffee-table', 'armchair', 'armchair', 'console', 'nightstand'],
  'soft-furnishings': ['sofa', 'armchair', 'armchair', 'coffee-table'],
  storage: ['cabinet', 'cabinet', 'cabinet'],
  minimal: ['sofa'],
};

function rotationY(shape: Shape): number {
  if (shape.rotation) return shape.rotation[1] ?? 0;
  if (shape.quaternion) {
    const [x, y, z, w] = shape.quaternion;
    return Math.atan2(2 * (w*y + x*z), 1 - 2 * (y*y + z*z));
  }
  return 0;
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


/** Validate the complete footprint and access zone, including concave room boundaries. */
function fitsRoom(f: OrientedFootprint, room: SpatialRoom): boolean {
  if (room.boundary.length < 3) return false;
  const c = Math.cos(f.rotationY), s = Math.sin(f.rotationY);
  for (let ix = 0; ix <= 16; ix++) {
    const x = f.halfSize[0] * (ix / 8 - 1);
    for (let iz = 0; iz <= 16; iz++) {
      const z = f.halfSize[1] * (iz / 8 - 1);
      if (!pointInPolygonOrNear([f.center[0] + c*x + s*z, f.center[1] - s*x + c*z], room.boundary, 0.04)) return false;
    }
  }
  return true;
}

export function planRoomFurnishing(allShapes: readonly Shape[], room: SpatialRoom, preset: FurnishingPreset): FurnishingPlan {
  const walls = allShapes.filter(s => room.boundaryWallIds.includes(s.id) && s.type === 'wall' && !s.hidden)
    .sort((a,b) => Number(b.args?.[0]) - Number(a.args?.[0]));
  const obstacles = allShapes.filter(s => !s.hidden && Math.abs(s.position[1] - room.elevation) < 2.8)
    .flatMap(s => { const f = semanticFootprint(s) ?? openingFootprint(s); return f ? [clearanceFootprint(f, s.customData?.semanticComponent?.placement?.clearanceM)] : []; });
  const planned: Shape[] = [], unplaced: InteriorFurnitureType[] = [];
  const add = (shape: Shape, ignoreId?: string) => {
    const f = semanticFootprint(shape)!;
    const profile = interiorFurnitureDefinition(shape.customData.furnitureType).placement;
    if (!fitsRoom(clearanceFootprint(f, profile.clearanceM), room)
      || placementCollisions(f, obstacles.filter(o => o.id !== ignoreId), profile).length) return false;
    planned.push(shape);
    obstacles.push(clearanceFootprint(f, profile.clearanceM));
    return true;
  };

  // Each actual window receives its own treatment, on the room-facing side only.
  if (preset !== 'storage' && preset !== 'minimal') for (const window of allShapes.filter(s => s.type === 'window' && !s.hidden && room.openingIds.includes(s.id))) {
    if (allShapes.some(s => !s.hidden && s.customData?.windowId === window.id && s.customData?.semanticComponent?.roomId === room.id)) continue;
    const wall = walls.find(w => w.id === window.hostWallId);
    if (!wall || !Array.isArray(window.args)) continue;
    const angle = rotationY(wall), nx = Math.sin(angle), nz = Math.cos(angle);
    const width = Number(window.args[0]) + 0.32;
    const top = window.position[1] + Number(window.args[1]) / 2 + 0.15;
    const height = top - room.elevation - 0.025;
    if (!(height > 0.3 && height < 6)) continue;
    const offset = Number(wall.args?.[2] ?? 0.2) / 2 + 0.15;
    let dressed = false;
    for (const side of [1, -1]) {
      const curtain = createInteriorFurnitureShape('curtain', {
        position: [window.position[0] + nx*offset*side, room.elevation + 0.025, window.position[2] + nz*offset*side],
        rotationY: angle + (side < 0 ? Math.PI : 0), roomId: room.id,
        params: { width, height, openAmount: 0.65, depth: 0.18 },
      });
      curtain.customData.windowId = window.id;
      if (add(curtain, window.id)) { dressed = true; break; }
    }
    if (!dressed) unplaced.push('curtain');
  }

  for (const type of PRESETS[preset]) {
    const defaults = furnitureDefaults(type);
    const candidates: Array<{ position: [number, number, number]; yaw: number }> = [];
    const anchor = planned.find(s => s.customData.furnitureType === (type === 'nightstand' && preset === 'bedroom' ? 'bed' : 'sofa'));
    if (anchor && (type === 'nightstand' || type === 'coffee-table' || type === 'armchair')) {
      const yaw = rotationY(anchor), c = Math.cos(yaw), s = Math.sin(yaw);
      const local = type === 'coffee-table' ? [[0, 1.48]] : type === 'nightstand' ? [[-1.13, -0.7], [1.13, -0.7]] : [[-1.8, 1.4], [1.8, 1.4]];
      for (const [x,z] of local) candidates.push({ position: [anchor.position[0]+c*x+s*z, room.elevation, anchor.position[2]-s*x+c*z], yaw: yaw + (type === 'armchair' ? Math.PI : 0) });
    }
    if (type !== 'coffee-table') for (const wall of walls) {
      for (const t of [0, -0.25, 0.25, -0.38, 0.38, -0.12, 0.12]) {
        const candidate = wallPlacementCandidate(wall, t, defaults.depth + 0.06);
        if (!candidate) continue;
        const angle = candidate.rotationY ?? 0, nx = Math.sin(angle), nz = Math.cos(angle);
        const offset = (candidate.position[0]-wall.position[0])*nx + (candidate.position[2]-wall.position[2])*nz;
        for (const side of [1, -1]) candidates.push({
          position: [candidate.position[0] - (side === -1 ? 2*offset*nx : 0), room.elevation, candidate.position[2] - (side === -1 ? 2*offset*nz : 0)],
          yaw: angle + (side === -1 ? Math.PI : 0),
        });
      }
    }
    let placed = false;
    for (const candidate of candidates) {
      const footprint = candidateFootprint(type, candidate.position, candidate.yaw);
      const profile = interiorFurnitureDefinition(type).placement;
      if (!fitsRoom(clearanceFootprint(footprint, profile.clearanceM), room) || placementCollisions(footprint, obstacles, profile).length) continue;
      if (add(createInteriorFurnitureShape(type, { position: candidate.position, rotationY: candidate.yaw, roomId: room.id }))) { placed = true; break; }
    }
    if (!placed) unplaced.push(type);
  }
  return { roomId: room.id, preset, shapes: planned, unplaced };
}
