import type { Shape } from '../../types';
import type { SpatialRoom } from '../spatial/rooms';
import { findLampStyle } from '../lampStyles';
import { pointInPolygonOrNear, type FurnishingPreset } from './smartFurnish';

/** The kinds of room the lighting rules know about. */
export type LightingRoomType = 'living' | 'bedroom' | 'office' | 'home-office' | 'kitchen' | 'bathroom' | 'toilet' | 'workshop' | 'storage';

export const INTERIOR_LIGHT_PREFIX = 'interior-light-';
/** Lights per room are capped so a large room does not flood the scene with real-time lights. */
const ROOM_LIGHT_LIMIT = 14;

export function lightingTypeForPreset(preset: FurnishingPreset): LightingRoomType {
  switch (preset) {
    case 'bedroom': return 'bedroom';
    case 'office': return 'office';
    case 'home-office': return 'home-office';
    case 'kitchen': return 'kitchen';
    case 'bathroom': return 'bathroom';
    case 'toilet': return 'toilet';
    case 'workshop': return 'workshop';
    case 'storage': return 'storage';
    default: return 'living';
  }
}

/** Work out what a room is used for from the furniture in it, for rooms that were furnished by hand. */
export function inferLightingType(shapes: readonly Shape[], room: SpatialRoom): LightingRoomType | null {
  const count = new Map<string, number>();
  for (const shape of shapes) {
    const type = shape.customData?.furnitureType as string | undefined;
    if (!type || shape.hidden) continue;
    const inRoom = shape.customData?.semanticComponent?.roomId === room.id
      || (Math.abs(shape.position[1] - room.elevation) < 0.3 && pointInPolygonOrNear([shape.position[0], shape.position[2]], room.boundary));
    if (inRoom) count.set(type, (count.get(type) ?? 0) + 1);
  }
  const has = (...types: string[]) => types.some(type => (count.get(type) ?? 0) > 0);
  if (has('toilet')) return has('bath', 'shower') || room.areaM2 > 4.5 ? 'bathroom' : 'toilet';
  if (has('bath', 'shower')) return 'bathroom';
  if (has('workbench', 'tool-cabinet')) return 'workshop';
  if (has('kitchen-run')) return 'kitchen';
  if (has('bed')) return 'bedroom';
  if (has('desk')) return (count.get('desk') ?? 0) > 1 || room.areaM2 > 18 ? 'office' : 'home-office';
  if (has('sofa', 'armchair', 'tv-unit')) return 'living';
  return has('cabinet') ? 'storage' : null;
}

function ceilingHeight(shapes: readonly Shape[], room: SpatialRoom): number {
  const walls = shapes.filter(s => s.type === 'wall' && !s.hidden && room.boundaryWallIds.includes(s.id));
  const tops = walls.map(w => w.position[1] + (Array.isArray(w.args) ? (Number(w.args[1]) || 2.8) / 2 : 1.4));
  return tops.length ? Math.min(...tops) : room.elevation + 2.8;
}

function distanceToBoundary(point: [number, number], polygon: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz;
    const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / len2));
    best = Math.min(best, Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dz * t)));
  }
  return best;
}

/** An even grid of ceiling points across the room, kept clear of the walls; falls back to the room's centre. */
function ceilingGrid(room: SpatialRoom, spacing: number, limit: number, inset = 0.5): Array<[number, number]> {
  const xs = room.boundary.map(p => p[0]), zs = room.boundary.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const nx = Math.max(1, Math.round((maxX - minX) / spacing)), nz = Math.max(1, Math.round((maxZ - minZ) / spacing));
  const points: Array<[number, number]> = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const point: [number, number] = [minX + ((i + 0.5) * (maxX - minX)) / nx, minZ + ((j + 0.5) * (maxZ - minZ)) / nz];
    if (pointInPolygonOrNear(point, room.boundary, 0) && distanceToBoundary(point, room.boundary) >= inset) points.push(point);
  }
  if (!points.length) return [[room.at[0], room.at[1]]];
  // Keep the points nearest the centre if there are more than the limit.
  return points.sort((a, b) => Math.hypot(a[0] - room.at[0], a[1] - room.at[1]) - Math.hypot(b[0] - room.at[0], b[1] - room.at[1])).slice(0, limit);
}

function yawOf(shape: Shape): number {
  if (shape.rotation) return shape.rotation[1] ?? 0;
  if (shape.quaternion) {
    const [x, y, z, w] = shape.quaternion;
    return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
  }
  return 0;
}

/** A point in a piece's own frame (x across, z out of its front) as a world X/Z position. */
function localPoint(shape: Shape, x: number, z: number): [number, number] {
  const yaw = yawOf(shape), c = Math.cos(yaw), s = Math.sin(yaw);
  return [shape.position[0] + c * x + s * z, shape.position[2] - s * x + c * z];
}

const param = (shape: Shape, key: string, fallback: number) => Number(shape.customData?.semanticComponent?.params?.[key] ?? fallback);

export interface RoomLightingOptions {
  /** Room name used in the fixtures' names. */
  label?: string;
}

/**
 * Lighting suited to what a room is for, as ordinary editable lamp fixtures (each brings its own light):
 * soft warm ceiling light and lamps beside seating and beds in living spaces, pendants over the dining
 * table, bright even downlights in kitchens, panels and desk lamps in offices, vanity lights over basins in
 * bathrooms, and strip lights or high-bays in workshops. `shapes` should include the room's furniture so
 * lamps can sit on desks and bedside tables and pendants hang over the table.
 */
export function planRoomLighting(shapes: readonly Shape[], room: SpatialRoom, type: LightingRoomType, options: RoomLightingOptions = {}): Shape[] {
  const ceiling = ceilingHeight(shapes, room);
  const label = options.label ?? room.name ?? 'Room';
  const furniture = shapes.filter(s => !s.hidden && s.customData?.furnitureType
    && (s.customData?.semanticComponent?.roomId === room.id
      || (Math.abs(s.position[1] - room.elevation) < 0.3 && pointInPolygonOrNear([s.position[0], s.position[2]], room.boundary))));
  const of = (...types: string[]) => furniture.filter(s => types.includes(s.customData.furnitureType));
  const [width, depth] = room.size;
  const alongX = width >= depth;
  const out: Shape[] = [];
  let n = 0;

  const add = (style: string, position: [number, number, number], extra: { yaw?: number; height?: number; note?: string } = {}) => {
    if (out.length >= ROOM_LIGHT_LIMIT) return;
    const def = findLampStyle(style);
    const yaw = extra.yaw ?? 0;
    out.push({
      id: `${INTERIOR_LIGHT_PREFIX}${room.id}-${n++}`, name: `${label} ${extra.note ?? def.name.toLowerCase()}`, type: 'lamp',
      position, quaternion: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], scale: [1, 1, 1], args: [1, extra.height ?? 3.2, 1],
      archStyle: style, color: '#1e293b', roughness: 0.7, metalness: 0.1,
      customData: { interiorLightRoom: room.id, interiorLight: true },
    } as Shape);
  };
  const ceilingLights = (style: string, spacing: number, limit = 9, yaw = 0) => {
    for (const [x, z] of ceilingGrid(room, spacing, limit)) add(style, [x, ceiling, z], { yaw });
  };
  /** Aligns long fixtures (panels, battens) with the room's long axis. */
  const longYaw = alongX ? 0 : Math.PI / 2;
  const deskLamps = (types: string[], style: string, limit: number) => {
    for (const piece of of(...types).slice(0, limit)) {
      const w = param(piece, 'width', 1.6), d = param(piece, 'depth', 0.8), top = param(piece, 'height', 0.75);
      const [x, z] = localPoint(piece, -w / 2 + 0.22, -d / 2 + 0.22);
      add(style, [x, room.elevation + top, z], { height: 0.4, note: 'task lamp' });
    }
  };
  const floorLampBeside = (piece: Shape | undefined, side: 1 | -1) => {
    if (!piece) return;
    const w = param(piece, 'width', 2.1);
    const [x, z] = localPoint(piece, side * (w / 2 + 0.28), -0.15);
    add('floor-lamp', [x, room.elevation, z], { height: 1.6 });
  };

  switch (type) {
    case 'living': {
      if (room.areaM2 < 14) ceilingLights('flush-ceiling', 4);
      else ceilingLights('recessed', room.areaM2 > 30 ? 2.4 : 2.1);
      // A floor lamp at the end of the sofa away from any side table, and a table lamp on each side table.
      const sofa = of('sofa')[0];
      const sideTables = of('side-table');
      const crowded = sofa ? sideTables.filter(t => Math.hypot(t.position[0] - sofa.position[0], t.position[2] - sofa.position[2]) < param(sofa, 'width', 2.1) / 2 + 0.7) : [];
      if (sofa) {
        const sofaX = (t: Shape) => (t.position[0] - sofa.position[0]) * Math.cos(yawOf(sofa)) - (t.position[2] - sofa.position[2]) * Math.sin(yawOf(sofa));
        const taken = crowded.map(sofaX);
        floorLampBeside(sofa, taken.some(x => x > 0) && !taken.some(x => x < 0) ? -1 : 1);
      }
      for (const table of sideTables.slice(0, 2)) add('nightstand', [table.position[0], room.elevation + param(table, 'height', 0.5), table.position[2]], { height: 0.4, note: 'table lamp' });
      break;
    }
    case 'bedroom': {
      if (room.areaM2 < 16) ceilingLights('flush-ceiling', 4, 1);
      else ceilingLights('flush-ceiling', 3.2, 2);
      for (const table of of('nightstand').slice(0, 2)) add('nightstand', [table.position[0], room.elevation + param(table, 'height', 0.52), table.position[2]], { height: 0.4, note: 'bedside lamp' });
      const chair = of('armchair')[0];
      if (chair) floorLampBeside(chair, 1);
      break;
    }
    case 'office':
      ceilingLights('troffer', 2.6, 12, longYaw);
      deskLamps(['desk'], 'desk-lamp', 4);
      break;
    case 'home-office':
      if (room.areaM2 < 10) ceilingLights('flush-ceiling', 4, 1); else ceilingLights('recessed', 2.2, 4);
      deskLamps(['desk'], 'desk-lamp', 1);
      floorLampBeside(of('armchair')[0], 1);
      break;
    case 'kitchen': {
      ceilingLights('recessed', 1.9, 9);
      // Pendants hang low enough over the table to light it, whatever the ceiling height.
      const table = of('dining-table')[0];
      if (table) {
        const w = param(table, 'width', 1.4), top = param(table, 'height', 0.75);
        const drop = Math.max(0.35, Math.min(1.1, ceiling - (room.elevation + top + 0.85)));
        for (const x of w >= 1.3 ? [-w / 4, w / 4] : [0]) {
          const [px, pz] = localPoint(table, x, 0);
          add('pendant', [px, ceiling, pz], { height: drop * 2, note: 'table pendant' });
        }
      }
      break;
    }
    case 'bathroom': {
      if (room.areaM2 < 6) ceilingLights('flush-ceiling', 4, 1); else ceilingLights('recessed', 1.9, 4);
      const shower = of('shower')[0];
      if (shower) add('recessed', [shower.position[0], ceiling, shower.position[2]], { note: 'shower downlight' });
      break;
    }
    case 'toilet':
      ceilingLights('flush-ceiling', 4, 1);
      break;
    case 'workshop': {
      if (room.areaM2 >= 30) ceilingLights('high-bay', 3.4, 9);
      else {
        // Two rows of battens along the long axis, over the benches and the middle of the floor.
        const long = Math.max(width, depth), short = Math.min(width, depth);
        const count = Math.max(1, Math.round(long / 1.9));
        for (const row of short > 3.4 ? [-1, 1] : [0]) for (let i = 0; i < count; i++) {
          const along = room.at[alongX ? 0 : 1] + (i - (count - 1) / 2) * (long / count);
          const across = room.at[alongX ? 1 : 0] + row * short * 0.24;
          add('linear-led', alongX ? [along, ceiling, across] : [across, ceiling, along], { yaw: longYaw });
        }
      }
      deskLamps(['workbench'], 'desk-lamp', 1);
      break;
    }
    default:
      ceilingLights(room.areaM2 > 12 ? 'linear-led' : 'flush-ceiling', 2.6, 4, longYaw);
  }

  // Vanity lights over every basin, standing off the wall it is against (the fixture's front is its +X).
  if (type === 'bathroom' || type === 'toilet') for (const basin of of('basin').slice(0, 2)) {
    const d = param(basin, 'depth', 0.45);
    const [x, z] = localPoint(basin, 0, -d / 2 + 0.03);
    add('vanity-light', [x, room.elevation + 1.75, z], { yaw: yawOf(basin) - Math.PI / 2 });
  }
  return out;
}
