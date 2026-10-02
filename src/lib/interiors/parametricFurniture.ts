import * as THREE from 'three';
import { createCurtainPanels } from './curtainCloth';
import { box, merge, padded, type FurnitureParams, type FurnitureProfile } from './furnitureParts';
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
    defaults: { width: 1.6, height: 0.55, depth: 2.0, seatHeight: 0.45, mattressHeight: 0.22, headboardHeight: 1.05, doorCount: 0, openAmount: 0, fullness: 1, foldDepth: 0 },
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

function bedGeometry(p: Required<FurnitureParams>): THREE.BufferGeometry {
  const frameH = Math.max(0.12, p.height - p.mattressHeight);
  const leg = 0.08;
  const parts: THREE.BufferGeometry[] = [
    box(p.width, frameH, p.depth, 0, frameH / 2, 0),
    padded(p.width * 0.96, p.mattressHeight, p.depth * 0.94, 0, frameH + p.mattressHeight / 2, 0),
    box(p.width, p.headboardHeight, 0.1, 0, p.headboardHeight / 2, -p.depth / 2 + 0.05),
  ];
  parts.push(padded(p.width * 0.97, 0.12, p.depth * 0.65, 0, p.height + 0.025, p.depth * 0.14));
  for (const x of [-p.width * 0.24, p.width * 0.24])
    parts.push(padded(p.width * 0.42, 0.16, 0.42, x, p.height + 0.08, -p.depth * 0.3));
  const lx = p.width / 2 - leg / 2, lz = p.depth / 2 - leg / 2;
  for (const x of [-lx, lx]) for (const z of [-lz, lz]) parts.push(box(leg, 0.12, leg, x, 0.06, z));
  return merge(parts);
}

function sofaGeometry(p: Required<FurnitureParams>): THREE.BufferGeometry {
  const arm = Math.min(0.18, p.width * 0.1);
  const seatDepth = p.depth * 0.68;
  const cushionH = 0.16;
  const backH = Math.max(0.3, p.height - p.seatHeight);
  const parts: THREE.BufferGeometry[] = [
    padded(p.width, 0.18, p.depth * 0.78, 0, p.seatHeight - 0.09, 0.06),
    padded(p.width, backH, 0.18, 0, p.seatHeight + backH / 2, -p.depth / 2 + 0.09),
    padded(arm, p.height * 0.62, p.depth, -p.width / 2 + arm / 2, p.height * 0.31, 0),
    padded(arm, p.height * 0.62, p.depth, p.width / 2 - arm / 2, p.height * 0.31, 0),
  ];
  const cushionCount = Math.max(1, Math.round(p.width / 0.72));
  const cushionW = (p.width - arm * 2.5) / cushionCount;
  for (let i = 0; i < cushionCount; i++) {
    const x = -p.width / 2 + arm * 1.25 + cushionW * (i + 0.5);
    parts.push(padded(cushionW * 0.96, cushionH, seatDepth, x, p.seatHeight + cushionH / 2, 0.08));
    parts.push(padded(cushionW * 0.94, backH * 0.58, 0.14, x, p.seatHeight + cushionH + backH * 0.29, -p.depth / 2 + 0.2));
  }
  return merge(parts);
}

function cabinetGeometry(p: Required<FurnitureParams>): THREE.BufferGeometry {
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

function curtainGeometry(p: Required<FurnitureParams>): THREE.BufferGeometry {
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
    positions: Array.from(g.getAttribute('position').array as ArrayLike<number>),
    normals: g.getAttribute('normal') ? Array.from(g.getAttribute('normal').array as ArrayLike<number>) : [],
    uvs: g.getAttribute('uv') ? Array.from(g.getAttribute('uv').array as ArrayLike<number>) : undefined,
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
