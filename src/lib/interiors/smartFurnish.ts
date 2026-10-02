import type { Shape } from '../../types';
import {
  createInteriorFurnitureShape,
  interiorFurnitureCatalog,
  interiorFurnitureDefinition,
  type FurnitureParams,
  type InteriorFurnitureType,
} from './parametricFurniture';
import type { SpatialRoom } from '../spatial/rooms';
import {
  placementCollisions,
  clearanceFootprint,
  wallPlacementCandidate,
  type OrientedFootprint,
} from '../spatial/placement';

export type FurnishingPreset =
  | 'bedroom' | 'living-room' | 'soft-furnishings' | 'storage' | 'minimal'
  | 'office' | 'home-office' | 'kitchen' | 'bathroom' | 'toilet';

type PlacementProfileClearance = { front?: number; back?: number; left?: number; right?: number };

export interface FurnishingPlan {
  roomId: string;
  preset: FurnishingPreset;
  shapes: Shape[];
  unplaced: InteriorFurnitureType[];
}

interface PresetItem {
  type: InteriorFurnitureType;
  params?: FurnitureParams;
  /** Widths to try, widest first, so a run of units fills as much of the wall as fits. */
  widths?: number[];
  /** Left out silently when it does not fit, rather than reported as unplaced. */
  optional?: boolean;
}
const items = (...entries: Array<InteriorFurnitureType | PresetItem>): PresetItem[] =>
  entries.map(entry => typeof entry === 'string' ? { type: entry } : entry);

const PRESETS: Record<FurnishingPreset, PresetItem[]> = {
  bedroom: items('bed', 'nightstand', 'nightstand', 'cabinet', 'console', 'armchair'),
  'living-room': items('sofa', 'coffee-table', 'armchair', 'armchair', 'console', 'nightstand'),
  'soft-furnishings': items('sofa', 'armchair', 'armchair', 'coffee-table'),
  storage: items('cabinet', 'cabinet', 'cabinet'),
  minimal: items('sofa'),
  // Each chair goes to the next desk that has none, pulled out slightly; a chair for a desk that did not fit is skipped.
  office: items('desk', 'office-chair', { type: 'desk', optional: true }, { type: 'office-chair', optional: true },
    { type: 'desk', optional: true }, { type: 'office-chair', optional: true }, 'bookcase', { type: 'filing-cabinet', optional: true }, { type: 'filing-cabinet', optional: true }, { type: 'cabinet', optional: true }),
  'home-office': items('desk', 'office-chair', 'bookcase', { type: 'armchair', optional: true }, { type: 'filing-cabinet', optional: true }),
  kitchen: items(
    { type: 'kitchen-run', widths: [3.6, 3.0, 2.4, 1.8, 1.2] },
    { type: 'kitchen-run', widths: [2.4, 1.8, 1.2], optional: true },
    'fridge',
    { type: 'dining-table', optional: true },
    ...Array.from({ length: 4 }, (): PresetItem => ({ type: 'dining-chair', optional: true })),
  ),
  bathroom: items('bath', 'toilet', 'basin', { type: 'shower', optional: true }),
  toilet: items('toilet', { type: 'basin', params: { width: 0.45, depth: 0.36, doorCount: 0 }, optional: true }),
};

/** Rooms where windows get curtains; offices, kitchens and bathrooms are left for blinds. */
const CURTAIN_PRESETS: ReadonlySet<FurnishingPreset> = new Set(['bedroom', 'living-room', 'soft-furnishings', 'home-office']);
const COARSE_T = [0, -0.25, 0.25, -0.38, 0.38, -0.12, 0.12];
/** Fine steps along a wall, so fixtures can sit snugly beside each other or in a corner. */
const FINE_T = Array.from({ length: 19 }, (_, i) => Math.round((-0.45 + i * 0.05) * 100) / 100)
  .sort((a, b) => Math.abs(a) - Math.abs(b));
const LEGACY_TYPES: ReadonlySet<InteriorFurnitureType> = new Set(['bed', 'sofa', 'cabinet', 'curtain', 'nightstand', 'coffee-table', 'armchair', 'console']);

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

export function pointInPolygonOrNear(point: [number, number], polygon: Array<[number, number]>, tolerance = 0.08): boolean {
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
  params: FurnitureParams = {},
): OrientedFootprint {
  const defaults = { ...furnitureDefaults(type), ...params };
  return {
    kind: interiorFurnitureDefinition(type).kind,
    center: [position[0], position[2]],
    halfSize: [defaults.width / 2, defaults.depth / 2],
    rotationY: yaw,
  };
}

type Candidate = { position: [number, number, number]; yaw: number; wallId?: string };

function boundaryCentroid(room: SpatialRoom): [number, number] {
  const n = room.boundary.length || 1;
  return [room.boundary.reduce((sum, p) => sum + p[0], 0) / n, room.boundary.reduce((sum, p) => sum + p[1], 0) / n];
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
  const placedBefore = allShapes.filter(s => !s.hidden && Math.abs(s.position[1] - room.elevation) < 2.8);
  const obstacles = placedBefore
    .flatMap(s => { const f = semanticFootprint(s) ?? openingFootprint(s); return f ? [clearanceFootprint(f, s.customData?.semanticComponent?.placement?.clearanceM)] : []; });
  // The room-type pieces (desks, kitchens, bathrooms) may share standing space with one another; only solid
  // objects and door/window zones block them. The original pieces keep their stricter clearance-on-clearance rule.
  const solids = placedBefore.flatMap(s => { const f = semanticFootprint(s) ?? openingFootprint(s); return f ? [f] : []; });
  const planned: Shape[] = [], unplaced: InteriorFurnitureType[] = [];
  const add = (shape: Shape, ignoreId?: string) => {
    const f = semanticFootprint(shape)!;
    const type = shape.customData.furnitureType as InteriorFurnitureType;
    const profile = interiorFurnitureDefinition(type).placement;
    const against = LEGACY_TYPES.has(type) ? obstacles : solids;
    if (!fitsRoom(clearanceFootprint(f, profile.clearanceM), room)
      || placementCollisions(f, against.filter(o => o.id !== ignoreId), profile).length) return false;
    planned.push(shape);
    obstacles.push(clearanceFootprint(f, profile.clearanceM));
    solids.push(f);
    return true;
  };

  // Each actual window receives its own treatment, on the room-facing side only.
  if (CURTAIN_PRESETS.has(preset)) for (const window of allShapes.filter(s => s.type === 'window' && !s.hidden && room.openingIds.includes(s.id))) {
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

  const chaired = new Set<string>();
  const wetCentres = () => planned.filter(shape => shape.customData.semanticComponent?.plumbing).map(shape => [shape.position[0], shape.position[2]] as const);

  for (const entry of PRESETS[preset]) {
    const { type } = entry;
    const definition = interiorFurnitureDefinition(type);
    const wet = !!definition.plumbing;
    const widths = entry.widths ?? [entry.params?.width ?? furnitureDefaults(type).width];
    let placed = false, skip = false;

    for (const width of widths) {
      const params: FurnitureParams = { ...entry.params, width };
      const size = { ...furnitureDefaults(type), ...params };
      let candidates: Candidate[] = [];
      let areaClearance: PlacementProfileClearance | undefined;

      if (type === 'office-chair') {
        const desk = planned.find(s => s.customData.furnitureType === 'desk' && !chaired.has(s.id));
        if (!desk) { skip = true; break; }
        const yaw = rotationY(desk), c = Math.cos(yaw), s = Math.sin(yaw);
        const deskDepth = Number(desk.customData.semanticComponent.params.depth ?? 0.8);
        for (const [x, z] of [[0, deskDepth / 2 + size.depth / 2 + 0.07], [0.25, deskDepth / 2 + size.depth / 2 + 0.07], [-0.25, deskDepth / 2 + size.depth / 2 + 0.07]] as const)
          candidates.push({ position: [desk.position[0] + c * x + s * z, room.elevation, desk.position[2] - s * x + c * z], yaw: yaw + Math.PI, wallId: desk.id });
      } else if (type === 'dining-chair') {
        const table = planned.find(s => s.customData.furnitureType === 'dining-table');
        if (!table) { skip = true; break; }
        const yaw = rotationY(table), c = Math.cos(yaw), s = Math.sin(yaw);
        const tw = Number(table.customData.semanticComponent.params.width ?? 1.4), td = Number(table.customData.semanticComponent.params.depth ?? 0.85);
        const side = td / 2 + size.depth / 2 + 0.02, end = tw / 2 + size.depth / 2 + 0.02;
        const slots: Array<[number, number, number]> = [
          [-tw * 0.22, side, Math.PI], [tw * 0.22, side, Math.PI], [-tw * 0.22, -side, 0], [tw * 0.22, -side, 0],
          [end, 0, -Math.PI / 2], [-end, 0, Math.PI / 2],
        ];
        for (const [x, z, turn] of slots) candidates.push({ position: [table.position[0] + c * x + s * z, room.elevation, table.position[2] - s * x + c * z], yaw: yaw + turn });
      } else if (type === 'dining-table') {
        // Free-standing: reserve a chair's width all round, then favour the middle of the room.
        areaClearance = { front: 0.6, back: 0.6, left: 0.6, right: 0.6 };
        const [cx, cz] = boundaryCentroid(room);
        const xs = room.boundary.map(p => p[0]), zs = room.boundary.map(p => p[1]);
        const spots: Array<[number, number]> = [];
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.4) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.4) spots.push([x, z]);
        spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
        for (const [x, z] of spots.slice(0, 80)) for (const yaw of [0, Math.PI / 2]) candidates.push({ position: [x, room.elevation, z], yaw });
      } else {
        const anchor = planned.find(s => s.customData.furnitureType === (type === 'nightstand' && preset === 'bedroom' ? 'bed' : 'sofa'));
        if (anchor && (type === 'nightstand' || type === 'coffee-table' || type === 'armchair')) {
          const yaw = rotationY(anchor), c = Math.cos(yaw), s = Math.sin(yaw);
          const local = type === 'coffee-table' ? [[0, 1.48]] : type === 'nightstand' ? [[-1.13, -0.7], [1.13, -0.7]] : [[-1.8, 1.4], [1.8, 1.4]];
          for (const [x,z] of local) candidates.push({ position: [anchor.position[0]+c*x+s*z, room.elevation, anchor.position[2]-s*x+c*z], yaw: yaw + (type === 'armchair' ? Math.PI : 0) });
        }
        if (type !== 'coffee-table' && definition.placement.hosts.some(host => host === 'wall')) for (const wall of walls) {
          for (const t of LEGACY_TYPES.has(type) ? COARSE_T : [...COARSE_T, ...FINE_T]) {
            const candidate = wallPlacementCandidate(wall, t, size.depth + 0.06);
            if (!candidate) continue;
            const angle = candidate.rotationY ?? 0, nx = Math.sin(angle), nz = Math.cos(angle);
            const offset = (candidate.position[0]-wall.position[0])*nx + (candidate.position[2]-wall.position[2])*nz;
            for (const side of [1, -1]) candidates.push({
              position: [candidate.position[0] - (side === -1 ? 2*offset*nx : 0), room.elevation, candidate.position[2] - (side === -1 ? 2*offset*nz : 0)],
              yaw: angle + (side === -1 ? Math.PI : 0),
              wallId: wall.id,
            });
          }
        }
        // Wet fixtures share walls so supply and waste pipework stays short: nearest the ones already placed first.
        const wetAt = wet ? wetCentres() : [];
        if (wetAt.length) {
          const spread = (c: Candidate) => Math.min(...wetAt.map(([x, z]) => Math.hypot(c.position[0] - x, c.position[2] - z)));
          candidates = candidates.map(c => [spread(c), c] as const).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
        }
      }

      for (const candidate of candidates) {
        const footprint = candidateFootprint(type, candidate.position, candidate.yaw, params);
        const profile = definition.placement;
        const checked = areaClearance ? clearanceFootprint(footprint, areaClearance) : footprint;
        if (!fitsRoom(clearanceFootprint(checked, profile.clearanceM), room) || placementCollisions(checked, LEGACY_TYPES.has(type) ? obstacles : solids, profile).length) continue;
        const shape = createInteriorFurnitureShape(type, { position: candidate.position, rotationY: candidate.yaw, roomId: room.id, params });
        if (candidate.wallId && type === 'office-chair') chaired.add(candidate.wallId);
        else if (candidate.wallId && wet) shape.customData.hostWallId = candidate.wallId;
        if (add(shape)) { placed = true; break; }
        if (candidate.wallId && type === 'office-chair') chaired.delete(candidate.wallId);
      }
      if (placed) break;
    }
    if (!placed && !skip && !entry.optional) unplaced.push(type);
  }
  return { roomId: room.id, preset, shapes: planned, unplaced };
}
