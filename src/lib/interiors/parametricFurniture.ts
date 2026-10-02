import * as THREE from 'three';
import { createCurtainPanels } from './curtainCloth';
import { box, merge, padded, sheetAlongProfile, type FurnitureParams, type FurniturePartRange, type FurnitureProfile, type FurnitureSize } from './furnitureParts';
import { createRoomFurnitureGeometry, roomProfiles, ROOM_FURNITURE_TYPES, type RoomFurnitureType } from './roomFurniture';
import type { Shape } from '../../types';
import type { PlacementProfile, PlumbingProfile, SimulationProfile } from '../semantics/componentTypes';

export type { FurnitureParams } from './furnitureParts';

export type InteriorFurnitureType =
  | 'bed' | 'sofa' | 'cabinet' | 'curtain' | 'nightstand' | 'coffee-table' | 'armchair' | 'console'
  | RoomFurnitureType;

export interface InteriorFurnitureOptions {
  id?: string;
  position?: [number, number, number];
  rotationY?: number;
  color?: string;
  params?: FurnitureParams;
  roomId?: string;
}

const profiles: Record<string, FurnitureProfile> = {
  bed: {
    definition: {
      id: 'polyform:interior/bed',
      name: 'Bed',
      kind: 'furniture',
      defaultParams: {},
      placement: { hosts: ['floor', 'wall'], preferredHost: 'wall', clearanceM: { front: 0.65 } },
      simulation: { type: 'softbody', bakeable: true },
      bom: { group: 'Fixtures & furniture', item: 'Bed', unit: 'no.' },
    },
    defaults: { width: 1.8, height: 0.55, depth: 2.0, seatHeight: 0.45, mattressHeight: 0.22, headboardHeight: 1.05, doorCount: 0, openAmount: 0, fullness: 1, foldDepth: 0 },
    color: '#d8d1c7',
  },
  sofa: {
    definition: {
      id: 'polyform:interior/sofa',
      name: 'Sofa',
      kind: 'furniture',
      defaultParams: {},
      placement: { hosts: ['floor', 'wall'], preferredHost: 'wall', clearanceM: { front: 0.7 } },
      simulation: { type: 'softbody', bakeable: true },
      bom: { group: 'Fixtures & furniture', item: 'Sofa', unit: 'no.' },
    },
    defaults: { width: 2.1, height: 0.86, depth: 0.9, seatHeight: 0.44, mattressHeight: 0.16, headboardHeight: 0.8, doorCount: 0, openAmount: 0, fullness: 1, foldDepth: 0 },
    color: '#8b98a7',
  },
  cabinet: {
    definition: {
      id: 'polyform:interior/cabinet',
      name: 'Cabinet',
      kind: 'furniture',
      defaultParams: {},
      placement: { hosts: ['floor', 'wall'], preferredHost: 'wall', clearanceM: { front: 0.75 } },
      bom: { group: 'Fixtures & furniture', item: 'Cabinet', unit: 'no.' },
    },
    defaults: { width: 1.2, height: 2.0, depth: 0.6, seatHeight: 0, mattressHeight: 0, headboardHeight: 0, doorCount: 2, openAmount: 0, fullness: 1, foldDepth: 0 },
    color: '#b59a7b',
  },
  curtain: {
    definition: {
      id: 'polyform:interior/curtain',
      name: 'Curtain',
      kind: 'soft-furnishing',
      defaultParams: {},
      placement: { hosts: ['wall'], preferredHost: 'wall', wallOffsetM: 0.06 },
      simulation: { type: 'cloth', enabledInPresentation: true, bakeable: true },
      bom: { group: 'Fixtures & furniture', item: 'Curtains', unit: 'no.' },
    },
    defaults: { width: 2.0, height: 2.2, depth: 0.08, seatHeight: 0, mattressHeight: 0, headboardHeight: 0, doorCount: 0, openAmount: 0.15, fullness: 1.8, foldDepth: 0.065 },
    color: '#c6b2a2',
  },
};

// Supporting pieces complete a room without filling every wall with wardrobes.
for (const [type, name, width, height, depth] of [
  ['nightstand', 'Bedside table', 0.48, 0.52, 0.42],
  ['coffee-table', 'Coffee table', 1.05, 0.38, 0.55],
  ['armchair', 'Lounge chair', 0.86, 0.86, 0.84],
  ['console', 'Low console', 1.5, 0.65, 0.4],
] as const) {
  profiles[type] = {
    definition: { ...profiles[type === 'armchair' ? 'sofa' : 'cabinet'].definition,
      id: `polyform:interior/${type}`, name,
      placement: { hosts: ['floor', 'wall'], preferredHost: type === 'coffee-table' ? 'floor' : 'wall',
        clearanceM: { front: type === 'armchair' ? 0.55 : 0.25 } },
      bom: { group: 'Fixtures & furniture', item: name, unit: 'no.' } },
    defaults: { ...profiles[type === 'armchair' ? 'sofa' : 'cabinet'].defaults, width, height, depth },
    color: type === 'armchair' ? '#b8a18b' : '#a98968',
  };
}
Object.assign(profiles, roomProfiles);

/**
 * A cushion or pillow propped at `angle` radians from flat, leaning back (its top edge toward -z): its lowest
 * edge rests on `baseY` and its rearmost edge touches `backZ`. Placing from the contacts, rather than a
 * guessed centre, keeps cushions sitting on the seat and against the back instead of hovering.
 */
function propped(width: number, thickness: number, length: number, x: number, baseY: number, backZ: number, angle: number, yaw: number, options: { role: 'pillow' | 'scatter'; accent?: boolean; radius: number }): THREE.BufferGeometry {
  const t = thickness * 1.12; // padded() lofts the faces a little
  const y = baseY + (length / 2) * Math.sin(angle) + (t / 2) * Math.cos(angle);
  const z = backZ + (length / 2) * Math.cos(angle) + (t / 2) * Math.sin(angle);
  return padded(width, thickness, length, x, y, z, { ...options, rotation: [angle, yaw, 0] });
}

function bedGeometry(p: FurnitureSize): THREE.BufferGeometry {
  const dressed = (p.dressing ?? 1) > 0;
  // Width is the whole bed with the duvet hanging over each side; the mattress sits inside it.
  const mattW = Math.max(0.6, p.width - 0.34);
  const frameH = Math.max(0.12, p.height - p.mattressHeight);
  const leg = 0.08;
  const top = p.height;
  const duvetLen = p.depth * 0.74, duvetZ = p.depth / 2 - duvetLen / 2 + 0.04;
  const edge = mattW / p.width;
  const parts: THREE.BufferGeometry[] = [
    box(mattW + 0.04, frameH, p.depth, 0, frameH / 2, 0),
    padded(mattW, p.mattressHeight, p.depth * 0.97, 0, frameH + p.mattressHeight / 2, 0, { role: 'mattress' }),
    padded(mattW + 0.24, p.headboardHeight, 0.12, 0, p.headboardHeight / 2, -p.depth / 2 + 0.06, { role: 'headboard' }),
    // The duvet is wider than the mattress and hangs over its sides; settling drapes it.
    padded(p.width, 0.15, duvetLen, 0, top + 0.075, duvetZ, { role: 'duvet', edge, radius: 0.07, fineBeyond: edge - 0.02, sheet: true }),
  ];
  const lx = mattW / 2 + 0.02 - leg / 2, lz = p.depth / 2 - leg / 2;
  for (const x of [-lx, lx]) for (const z of [-lz, lz]) parts.push(box(leg, 0.12, leg, x, 0.06, z));
  if (dressed) {
    // Two sleeping pillows propped against the headboard, with scatter cushions leaning on them.
    const pw = Math.min(0.72, mattW / 2 - 0.03), headFace = -p.depth / 2 + 0.125;
    for (const x of [-1, 1]) parts.push(propped(pw, 0.14, 0.5, x * (pw / 2 + 0.02), top, headFace, 1.12, -x * 0.05, { role: 'pillow', radius: 0.07 }));
    parts.push(propped(0.44, 0.11, 0.44, -0.27, top + 0.14, headFace + 0.37, 0.95, 0.14, { role: 'scatter', accent: true, radius: 0.05 }));
    parts.push(propped(0.4, 0.11, 0.4, 0.3, top + 0.14, headFace + 0.38, 1.0, -0.18, { role: 'scatter', accent: true, radius: 0.05 }));
    // A folded throw across the foot of the bed.
    parts.push(padded(p.width * 0.94, 0.05, 0.5, 0, top + 0.2, p.depth / 2 - 0.3, { role: 'throw', accent: true, radius: 0.024, sheet: true, edge: Math.min(0.95, mattW / (p.width * 0.94)), fineBeyond: Math.min(0.95, mattW / (p.width * 0.94)) - 0.02 }));
  }
  return merge(parts);
}

/** Sofas and armchairs: framed base, rolled arms, a back that leans, loose seat and back cushions. */
function sofaGeometry(p: FurnitureSize): THREE.BufferGeometry {
  const dressed = (p.dressing ?? 1) > 0;
  const arm = Math.min(0.2, p.width * 0.11);
  const cushionH = Math.max(0.12, p.mattressHeight || 0.16);
  const legH = 0.1;
  const armTop = p.seatHeight + 0.2;
  const baseH = Math.max(0.1, p.seatHeight - cushionH - legH);
  const inner = p.width - 2 * arm;
  const count = Math.max(1, Math.round(inner / 0.68));
  const cw = inner / count;
  const backH = Math.max(0.3, p.height - p.seatHeight - 0.02);
  const parts: THREE.BufferGeometry[] = [
    padded(inner + 0.04, baseH, p.depth * 0.96, 0, legH + baseH / 2, 0.01, { role: 'base' }),
    padded(p.width - 0.04, p.height - legH - 0.14, 0.2, 0, legH + (p.height - legH - 0.14) / 2, -p.depth / 2 + 0.1, { role: 'base' }),
  ];
  for (const side of [-1, 1]) parts.push(padded(arm, armTop - legH, p.depth, side * (p.width / 2 - arm / 2), legH + (armTop - legH) / 2, 0, { role: 'arm' }));
  for (let i = 0; i < count; i++) {
    const x = -inner / 2 + cw * (i + 0.5);
    parts.push(padded(cw * 0.985, cushionH, p.depth * 0.66, x, p.seatHeight - cushionH / 2, 0.1, { role: 'seat' }));
    parts.push(padded(cw * 0.97, backH * 0.9, 0.17, x, p.seatHeight + backH * 0.45, -p.depth / 2 + 0.3, { role: 'back', rotation: [-0.16, 0, 0] }));
  }
  const lx = p.width / 2 - 0.09, lz = p.depth / 2 - 0.09;
  for (const x of [-lx, lx]) for (const z of [-lz, lz]) parts.push(box(0.05, legH, 0.05, x, legH / 2, z));
  if (dressed) {
    // Scatter cushions stand on the seat against the back cushions, turned slightly in toward the middle.
    const sc = Math.min(0.44, inner / 2.4 + 0.1);
    const backFace = -p.depth / 2 + 0.415;
    const spots = p.width >= 1.7 ? [-1, 1] : [1];
    for (const side of spots) {
      const size = side < 0 ? sc : sc * 0.92;
      parts.push(propped(size, 0.12, size, p.width >= 1.7 ? side * (inner / 2 - size / 2 - 0.02) : 0.06, p.seatHeight + 0.012, backFace, side < 0 ? 1.2 : 1.12, -side * 0.28, { role: 'scatter', accent: true, radius: 0.058 }));
    }
    if (p.width >= 1.9) {
      // A throw laid over one seat and arm, hanging down the outside.
      const x0 = p.width / 2 - arm;
      parts.push(sheetAlongProfile([
        [x0 - 0.55, p.seatHeight + 0.05], [x0 - 0.1, p.seatHeight + 0.05], [x0 - 0.014, p.seatHeight + 0.09],
        [x0 - 0.012, armTop - 0.05], [x0 + 0.02, armTop + 0.03], [p.width / 2 - 0.03, armTop + 0.034],
        [p.width / 2 + 0.02, armTop - 0.03], [p.width / 2 + 0.03, armTop - 0.24],
      ], -p.depth * 0.02, p.depth * 0.46));
    }
  }
  return merge(parts);
}

function cabinetGeometry(p: FurnitureSize): THREE.BufferGeometry {
  const t = 0.035;
  const parts: THREE.BufferGeometry[] = [
    box(t, p.height, p.depth, -p.width / 2 + t / 2, p.height / 2, 0),
    box(t, p.height, p.depth, p.width / 2 - t / 2, p.height / 2, 0),
    box(p.width - t * 2, t, p.depth, 0, t / 2, 0),
    box(p.width - t * 2, t, p.depth, 0, p.height - t / 2, 0),
    box(p.width - t * 2, p.height - t * 2, t, 0, p.height / 2, -p.depth / 2 + t / 2),
    box(p.width - t * 2, t, p.depth * 0.92, 0, p.height * 0.52, 0),
  ];
  const doors = Math.max(1, Math.min(6, Math.round(p.doorCount)));
  const doorW = (p.width - t * 2) / doors;
  for (let i = 0; i < doors; i++) {
    const x = -p.width / 2 + t + doorW * (i + 0.5);
    parts.push(box(doorW * 0.96, p.height - t * 3, 0.025, x, p.height / 2, p.depth / 2 + 0.0125));
    parts.push(box(0.018, 0.16, 0.018, x + (i < doors / 2 ? doorW * 0.3 : -doorW * 0.3), p.height / 2, p.depth / 2 + 0.035));
  }
  return merge(parts);
}

function curtainGeometry(p: FurnitureSize): THREE.BufferGeometry {
  const rod = box(p.width + 0.12, 0.035, 0.035, 0, p.height + 0.055, -0.01);
  return merge([...createCurtainPanels(p), rod]);
}

export function interiorFurnitureDefinition(type: InteriorFurnitureType) {
  return profiles[type].definition;
}

export function interiorFurnitureCatalog() {
  return (Object.keys(profiles) as InteriorFurnitureType[]).map(type => ({
    type,
    name: profiles[type].definition.name,
    definitionId: profiles[type].definition.id,
    defaults: { ...profiles[type].defaults },
    placement: profiles[type].definition.placement,
    simulation: profiles[type].definition.simulation,
  }));
}

export function createInteriorFurnitureGeometry(type: InteriorFurnitureType, params: FurnitureParams = {}): THREE.BufferGeometry {
  const p = { ...profiles[type].defaults, ...params };
  switch (type) {
    case 'bed': return bedGeometry(p);
    case 'sofa':
    case 'armchair': return sofaGeometry(p);
    case 'cabinet':
    case 'nightstand':
    case 'console': return cabinetGeometry(p);
    case 'coffee-table': return merge([padded(p.width, 0.065, p.depth, 0, p.height - 0.0325, 0), ...[-1, 1].flatMap(x => [-1, 1].map(z => box(0.045, p.height - 0.065, 0.045, x * (p.width / 2 - 0.1), (p.height - 0.065) / 2, z * (p.depth / 2 - 0.1))))]);
    case 'curtain': return curtainGeometry(p);
    default:
      if (ROOM_FURNITURE_TYPES.includes(type as RoomFurnitureType)) return createRoomFurnitureGeometry(type as RoomFurnitureType, p);
      throw new Error(`Unknown interior furniture type: ${type}`);
  }
}

function geometryData(geometry: THREE.BufferGeometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const data = {
    // Rounded to 0.1 mm and 0.001 so saved models stay small; neither is visible.
    positions: Array.from(g.getAttribute('position').array as ArrayLike<number>, v => Math.round(v * 1e4) / 1e4),
    normals: g.getAttribute('normal') ? Array.from(g.getAttribute('normal').array as ArrayLike<number>, v => Math.round(v * 1e3) / 1e3) : [],
    uvs: g.getAttribute('uv') ? Array.from(g.getAttribute('uv').array as ArrayLike<number>, v => Math.round(v * 1e3) / 1e3) : undefined,
  };
  if (g !== geometry) g.dispose();
  return data;
}

export function createInteriorFurnitureShape(
  type: InteriorFurnitureType,
  options: InteriorFurnitureOptions = {},
): Shape {
  const profile = profiles[type];
  const params = { ...profile.defaults, ...(options.params ?? {}) };
  const geometry = createInteriorFurnitureGeometry(type, params);
  const data = geometryData(geometry);
  const furnitureMaterialGroups = geometry.groups.map(group => ({ ...group }));
  const furniturePartRanges = geometry.userData.parts as FurniturePartRange[] | undefined;
  geometry.dispose();
  const placement: PlacementProfile = profile.definition.placement;
  const simulation: SimulationProfile | undefined = profile.definition.simulation;
  const plumbing: PlumbingProfile | undefined = profile.definition.plumbing;
  return {
    id: options.id ?? Math.random().toString(36).slice(2, 11),
    name: profile.definition.name,
    type: 'custom',
    position: options.position ?? [0, 0, 0],
    rotation: [0, options.rotationY ?? 0, 0],
    args: [params.width, params.height, params.depth],
    color: options.color ?? profile.color,
    roughness: profile.surface?.roughness ?? (type === 'cabinet' ? 0.58 : 0.82),
    metalness: profile.surface?.metalness ?? 0.02,
    tags: ['interior', 'furniture', `interior-${type}`],
    geometryData: data,
    customData: {
      furnitureType: type,
      furnitureMaterialGroups,
      ...(furniturePartRanges ? { furniturePartRanges } : {}),
      semanticComponent: {
        definitionId: profile.definition.id,
        kind: profile.definition.kind,
        params,
        roomId: options.roomId,
        placement,
        simulation,
        ...(plumbing ? { plumbing } : {}),
      },
    },
  };
}
