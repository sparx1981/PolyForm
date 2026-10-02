import * as THREE from 'three';
import { BASE_PARAMS, box, cyl, merge, rbox, type FurnitureProfile } from './furnitureParts';

/**
 * Work, kitchen and bathroom pieces for the Interior Studio. Like the rest of the interior
 * catalogue they are generated in code: dimensions are parameters, nothing is downloaded, and the
 * saved mesh is ordinary geometry. Local +Z is the front of each piece and its back sits on -Z.
 */
export type RoomFurnitureType =
  | 'desk' | 'office-chair' | 'bookcase' | 'filing-cabinet'
  | 'kitchen-run' | 'fridge' | 'dining-table' | 'dining-chair'
  | 'bath' | 'shower' | 'toilet' | 'basin';

export const ROOM_FURNITURE_TYPES: readonly RoomFurnitureType[] = [
  'desk', 'office-chair', 'bookcase', 'filing-cabinet',
  'kitchen-run', 'fridge', 'dining-table', 'dining-chair',
  'bath', 'shower', 'toilet', 'basin',
];

const bom = (item: string) => ({ group: 'Fixtures & furniture', item, unit: 'no.' });
const WET_COLD_HOT = { supply: ['cold', 'hot'] as Array<'cold' | 'hot'>, waste: true };
const WET_COLD = { supply: ['cold'] as Array<'cold' | 'hot'>, waste: true };
const CERAMIC = { roughness: 0.2, metalness: 0.02 };

export const roomProfiles: Record<RoomFurnitureType, FurnitureProfile> = {
  desk: {
    definition: { id: 'polyform:interior/desk', name: 'Desk', kind: 'furniture', defaultParams: {},
      placement: { hosts: ['floor', 'wall'], preferredHost: 'wall', clearanceM: { front: 0.05 } }, bom: bom('Desk') },
    defaults: { ...BASE_PARAMS, width: 1.6, height: 0.75, depth: 0.8 },
    color: '#b08a5e',
  },
  'office-chair': {
    definition: { id: 'polyform:interior/office-chair', name: 'Office chair', kind: 'furniture', defaultParams: {},
      // Its back faces away from the desk, so the pull-out space is behind it.
      placement: { hosts: ['floor'], preferredHost: 'floor', clearanceM: { back: 0.4 } }, bom: bom('Office chair') },
    defaults: { ...BASE_PARAMS, width: 0.6, height: 0.95, depth: 0.6, seatHeight: 0.47 },
    color: '#3b3f46',
  },
  bookcase: {
    definition: { id: 'polyform:interior/bookcase', name: 'Bookcase', kind: 'furniture', defaultParams: {},
      placement: { hosts: ['wall'], preferredHost: 'wall', clearanceM: { front: 0.5 } }, bom: bom('Bookcase') },
    defaults: { ...BASE_PARAMS, width: 0.9, height: 2.0, depth: 0.32, doorCount: 5 },
    color: '#8b6b4a',
  },
  'filing-cabinet': {
    definition: { id: 'polyform:interior/filing-cabinet', name: 'Filing cabinet', kind: 'furniture', defaultParams: {},
      placement: { hosts: ['wall'], preferredHost: 'wall', clearanceM: { front: 0.6 } }, bom: bom('Filing cabinet') },
    defaults: { ...BASE_PARAMS, width: 0.46, height: 1.32, depth: 0.62, doorCount: 4 },
    color: '#9aa1a8',
  },
  'kitchen-run': {
    definition: { id: 'polyform:interior/kitchen-run', name: 'Kitchen units', kind: 'fixture', defaultParams: {},
      placement: { hosts: ['wall'], preferredHost: 'wall', clearanceM: { front: 0.9 } },
      plumbing: WET_COLD_HOT, bom: bom('Kitchen units') },
    defaults: { ...BASE_PARAMS, width: 2.4, height: 2.15, depth: 0.6 },
    color: '#ddd7ca',
  },
  fridge: {
    definition: { id: 'polyform:interior/fridge', name: 'Fridge freezer', kind: 'furniture', defaultParams: {},
      placement: { hosts: ['wall'], preferredHost: 'wall', clearanceM: { front: 0.8 } }, bom: bom('Fridge freezer') },
    defaults: { ...BASE_PARAMS, width: 0.6, height: 1.8, depth: 0.65 },
    color: '#cfd4d8',
    surface: { roughness: 0.35, metalness: 0.25 },
  },
  'dining-table': {
    definition: { id: 'polyform:interior/dining-table', name: 'Dining table', kind: 'furniture', defaultParams: {},
      placement: { hosts: ['floor'], preferredHost: 'floor' }, bom: bom('Dining table') },
    defaults: { ...BASE_PARAMS, width: 1.4, height: 0.75, depth: 0.85 },
    color: '#a9835a',
  },
  'dining-chair': {
    definition: { id: 'polyform:interior/dining-chair', name: 'Dining chair', kind: 'furniture', defaultParams: {},
      placement: { hosts: ['floor'], preferredHost: 'floor', clearanceM: { back: 0.35 } }, bom: bom('Dining chair') },
    defaults: { ...BASE_PARAMS, width: 0.45, height: 0.9, depth: 0.48, seatHeight: 0.46 },
    color: '#8a6a49',
  },
  bath: {
    definition: { id: 'polyform:interior/bath', name: 'Bath', kind: 'fixture', defaultParams: {},
      placement: { hosts: ['wall'], preferredHost: 'wall', clearanceM: { front: 0.55 } },
      plumbing: WET_COLD_HOT, bom: bom('Bath') },
    defaults: { ...BASE_PARAMS, width: 1.7, height: 0.58, depth: 0.75 },
    color: '#f4f4f1',
    surface: CERAMIC,
  },
  shower: {
    definition: { id: 'polyform:interior/shower', name: 'Shower', kind: 'fixture', defaultParams: {},
      placement: { hosts: ['wall'], preferredHost: 'wall', clearanceM: { front: 0.6 } },
      plumbing: WET_COLD_HOT, bom: bom('Shower') },
    defaults: { ...BASE_PARAMS, width: 0.9, height: 2.0, depth: 0.9 },
    color: '#e6eef0',
    surface: { roughness: 0.3, metalness: 0.15 },
  },
  toilet: {
    definition: { id: 'polyform:interior/toilet', name: 'Toilet', kind: 'fixture', defaultParams: {},
      placement: { hosts: ['wall'], preferredHost: 'wall', clearanceM: { front: 0.6, left: 0.2, right: 0.2 } },
      plumbing: WET_COLD, bom: bom('Toilet') },
    defaults: { ...BASE_PARAMS, width: 0.38, height: 0.78, depth: 0.68 },
    color: '#f6f6f3',
    surface: CERAMIC,
  },
  basin: {
    definition: { id: 'polyform:interior/basin', name: 'Basin', kind: 'fixture', defaultParams: {},
      placement: { hosts: ['wall'], preferredHost: 'wall', clearanceM: { front: 0.55, left: 0.1, right: 0.1 } },
      plumbing: WET_COLD_HOT, bom: bom('Basin') },
    defaults: { ...BASE_PARAMS, width: 0.6, height: 0.86, depth: 0.45, doorCount: 1 },
    color: '#f2f2ef',
    surface: CERAMIC,
  },
};

type P = Required<import('./furnitureParts').FurnitureParams>;
type G = THREE.BufferGeometry;

function deskGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const pedestal = Math.min(0.42, w * 0.3);
  const legH = h - 0.04;
  const parts: G[] = [
    box(w, 0.04, d, 0, h - 0.02, 0),
    box(0.04, legH, d * 0.92, -w / 2 + 0.03, legH / 2, 0),
    box(pedestal, legH, d * 0.92, w / 2 - pedestal / 2 - 0.01, legH / 2, 0),
    box(Math.max(0.1, w - pedestal - 0.1), 0.3, 0.02, -pedestal / 2, h - 0.19, -d / 2 + 0.1),
  ];
  const fronts = 3, gap = legH / fronts;
  for (let i = 0; i < fronts; i++) {
    const y = gap * (i + 0.5);
    parts.push(box(pedestal - 0.03, gap - 0.025, 0.014, w / 2 - pedestal / 2 - 0.01, y, d * 0.46 + 0.007));
    parts.push(box(0.12, 0.014, 0.02, w / 2 - pedestal / 2 - 0.01, y + gap * 0.25, d * 0.46 + 0.024));
  }
  return merge(parts);
}

function officeChairGeometry(p: P): G {
  const { width: w, height: h, depth: d, seatHeight: sh } = p;
  const reach = Math.min(w, d) * 0.46;
  const parts: G[] = [
    cyl(0.03, sh - 0.1, 0, 0.1 + (sh - 0.1) / 2, 0),
    cyl(0.055, 0.04, 0, 0.12, 0),
    rbox(w * 0.82, 0.08, d * 0.82, 0, sh - 0.04, 0.02 * d, 0.035),
    rbox(w * 0.76, Math.max(0.3, h - sh - 0.1), 0.07, 0, sh + (h - sh) * 0.5, -d * 0.4, 0.035),
    box(0.04, 0.2, 0.04, 0, sh + 0.02, -d * 0.34),
  ];
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * Math.PI) / 5;
    const x = Math.sin(a) * reach / 2, z = Math.cos(a) * reach / 2;
    parts.push(box(reach, 0.03, 0.05, x, 0.07, z, a - Math.PI / 2));
    parts.push(cyl(0.025, 0.05, Math.sin(a) * reach, 0.025, Math.cos(a) * reach));
  }
  for (const side of [-1, 1]) {
    parts.push(box(0.03, 0.2, 0.03, side * w * 0.42, sh + 0.12, -d * 0.02));
    parts.push(rbox(0.06, 0.03, d * 0.5, side * w * 0.42, sh + 0.23, d * 0.02, 0.012));
  }
  return merge(parts);
}

function bookcaseGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const t = 0.03, shelves = Math.max(1, Math.min(10, Math.round(p.doorCount)));
  const parts: G[] = [
    box(t, h, d, -w / 2 + t / 2, h / 2, 0),
    box(t, h, d, w / 2 - t / 2, h / 2, 0),
    box(w - 2 * t, t, d, 0, h - t / 2, 0),
    box(w - 2 * t, 0.08, d * 0.94, 0, 0.04, -d * 0.03),
    box(w - 2 * t, h - 0.04, 0.012, 0, h / 2, -d / 2 + 0.006),
  ];
  const usable = h - 0.08 - t;
  for (let i = 1; i <= shelves - 1; i++) parts.push(box(w - 2 * t, t * 0.8, d * 0.96, 0, 0.08 + (usable * i) / shelves, -d * 0.02));
  return merge(parts);
}

function filingCabinetGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const drawers = Math.max(2, Math.min(5, Math.round(p.doorCount)));
  const parts: G[] = [box(w, h, d * 0.97, 0, h / 2, -d * 0.015)];
  const gap = (h - 0.06) / drawers;
  for (let i = 0; i < drawers; i++) {
    const y = 0.03 + gap * (i + 0.5);
    parts.push(box(w - 0.03, gap - 0.025, 0.02, 0, y, d / 2 - 0.0));
    parts.push(box(w * 0.4, 0.018, 0.025, 0, y + gap * 0.28, d / 2 + 0.015));
  }
  return merge(parts);
}

function kitchenRunGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const baseTop = 0.9, plinth = 0.1;
  const parts: G[] = [
    box(w - 0.02, plinth, d - 0.08, 0, plinth / 2, -0.03),
    box(w, baseTop - 0.04 - plinth, d - 0.02, 0, plinth + (baseTop - 0.04 - plinth) / 2, -0.01),
    box(w, 0.04, d + 0.02, 0, baseTop - 0.02, 0.0),
  ];
  const doors = Math.max(1, Math.round(w / 0.6)), doorW = w / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + doorW * (i + 0.5);
    parts.push(box(doorW - 0.012, baseTop - 0.04 - plinth - 0.02, 0.02, x, plinth + (baseTop - 0.04 - plinth) / 2, d / 2 - 0.01));
    parts.push(box(0.014, 0.14, 0.022, x + (i % 2 ? -1 : 1) * doorW * 0.36, baseTop - 0.2, d / 2 + 0.012));
  }
  const hobX = w >= 1.8 ? w / 2 - Math.min(0.6, w * 0.25) : null;
  if (w >= 1.2) {
    const sinkX = hobX === null ? 0 : -w / 2 + Math.min(0.8, w * 0.3);
    const rim = (sx: number, sy: number, sz: number, x: number, z: number) => parts.push(box(sx, sy, sz, sinkX + x, baseTop + 0.01, z));
    rim(0.56, 0.02, 0.025, 0, 0.1); rim(0.56, 0.02, 0.025, 0, 0.42);
    rim(0.025, 0.02, 0.35, -0.2775, 0.26); rim(0.025, 0.02, 0.35, 0.2775, 0.26);
    parts.push(cyl(0.016, 0.26, sinkX, baseTop + 0.13, -d / 2 + 0.06));
    parts.push(box(0.016, 0.016, 0.17, sinkX, baseTop + 0.25, -d / 2 + 0.13));
  }
  if (hobX !== null) {
    parts.push(box(0.58, 0.012, 0.5, hobX, baseTop + 0.006, 0.0));
    for (const bx of [-0.14, 0.14]) for (const bz of [-0.12, 0.12]) parts.push(cyl(0.08, 0.012, hobX + bx, baseTop + 0.018, bz));
  }
  // Wall units sit above the worktop; the cooker hood and chimney replace the ones over the hob.
  const upperD = 0.34, upperH = 0.7, upperY = 1.45 + upperH / 2;
  const segments: Array<[number, number]> = hobX === null ? [[-w / 2, w / 2]] : [[-w / 2, hobX - 0.3], [hobX + 0.3, w / 2]];
  for (const [a, b] of segments) {
    const len = b - a;
    if (len < 0.25) continue;
    const n = Math.max(1, Math.round(len / 0.6)), dw = len / n;
    parts.push(box(len, upperH, upperD - 0.02, (a + b) / 2, upperY, -d / 2 + (upperD - 0.02) / 2));
    for (let i = 0; i < n; i++) parts.push(box(dw - 0.012, upperH - 0.03, 0.02, a + dw * (i + 0.5), upperY, -d / 2 + upperD - 0.01));
  }
  if (hobX !== null) {
    parts.push(box(0.6, 0.14, 0.46, hobX, 1.56, -d / 2 + 0.23));
    parts.push(box(0.22, Math.max(0.2, h - 1.63), 0.22, hobX, 1.63 + Math.max(0.2, h - 1.63) / 2, -d / 2 + 0.11));
  }
  return merge(parts);
}

function fridgeGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const freezerH = h * 0.34, fridgeH = h - freezerH - 0.03;
  return merge([
    box(w, h, d - 0.03, 0, h / 2, -0.015),
    box(w - 0.012, freezerH - 0.02, 0.03, 0, freezerH / 2 + 0.01, d / 2 - 0.015),
    box(w - 0.012, fridgeH - 0.02, 0.03, 0, freezerH + 0.03 + fridgeH / 2, d / 2 - 0.015),
    box(0.018, 0.38, 0.03, -w / 2 + 0.07, freezerH + 0.2, d / 2 + 0.03),
    box(0.018, 0.2, 0.03, -w / 2 + 0.07, freezerH * 0.62, d / 2 + 0.03),
  ]);
}

function diningTableGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const leg = 0.07, inset = 0.08;
  const parts: G[] = [rbox(w, 0.04, d, 0, h - 0.02, 0, 0.012)];
  for (const x of [-1, 1]) for (const z of [-1, 1])
    parts.push(box(leg, h - 0.04, leg, x * (w / 2 - inset - leg / 2), (h - 0.04) / 2, z * (d / 2 - inset - leg / 2)));
  parts.push(box(w - 2 * inset - leg, 0.07, 0.03, 0, h - 0.075, d / 2 - inset - leg / 2));
  parts.push(box(w - 2 * inset - leg, 0.07, 0.03, 0, h - 0.075, -(d / 2 - inset - leg / 2)));
  return merge(parts);
}

function diningChairGeometry(p: P): G {
  const { width: w, height: h, depth: d, seatHeight: sh } = p;
  const leg = 0.04, lx = w / 2 - leg / 2, lz = d / 2 - leg / 2;
  const parts: G[] = [rbox(w, 0.04, d * 0.92, 0, sh - 0.02, d * 0.04, 0.012)];
  for (const x of [-1, 1]) for (const z of [-1, 1])
    parts.push(box(leg, z < 0 ? h - 0.02 : sh - 0.04, leg, x * lx, (z < 0 ? h - 0.02 : sh - 0.04) / 2, z * lz));
  for (const y of [sh + 0.17, sh + 0.34]) parts.push(box(w - 2 * leg, 0.09, 0.025, 0, y, -lz));
  return merge(parts);
}

function bathGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const t = 0.07, floor = 0.2;
  const taps = [
    cyl(0.016, 0.1, w / 2 - 0.22, h + 0.05, -d / 2 + 0.04),
    box(0.016, 0.016, 0.1, w / 2 - 0.22, h + 0.095, -d / 2 + 0.09),
  ];
  return merge([
    box(w, floor, d, 0, floor / 2, 0),
    rbox(w, h - floor, t, 0, floor + (h - floor) / 2, -d / 2 + t / 2, 0.025),
    rbox(w, h - floor, t, 0, floor + (h - floor) / 2, d / 2 - t / 2, 0.025),
    rbox(t, h - floor, d - 2 * t + 0.02, -w / 2 + t / 2, floor + (h - floor) / 2, 0, 0.025),
    rbox(t, h - floor, d - 2 * t + 0.02, w / 2 - t / 2, floor + (h - floor) / 2, 0, 0.025),
    ...taps,
  ]);
}

function showerGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const post = 0.035, hx = w / 2 - post / 2, hz = d / 2 - post / 2;
  const parts: G[] = [rbox(w, 0.07, d, 0, 0.035, 0, 0.02)];
  for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(post, h - 0.07, post, x * hx, 0.07 + (h - 0.07) / 2, z * hz));
  for (const z of [-1, 1]) parts.push(box(w, post, post, 0, h - post / 2, z * hz));
  for (const x of [-1, 1]) parts.push(box(post, post, d, x * hx, h - post / 2, 0));
  // Panel rails at hand height make the enclosure read as a cubicle rather than a bare frame.
  for (const y of [0.9, 1.45]) parts.push(box(w, 0.02, 0.02, 0, y, hz));
  parts.push(cyl(0.012, 1.15, 0, 1.25, -d / 2 + 0.04));
  parts.push(box(0.02, 0.02, 0.22, 0, h - 0.12, -d / 2 + 0.14));
  parts.push(cyl(0.1, 0.02, 0, h - 0.12, -d / 2 + 0.26));
  return merge(parts);
}

function toiletGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const bowlLen = d - 0.1, bowlZ = 0.05;
  const radius = w / 2, scaleZ = bowlLen / (2 * radius);
  const cisternH = 0.4, cisternD = 0.18;
  return merge([
    cyl(radius * 0.8, 0.3, 0, 0.15, bowlZ + 0.02, scaleZ * 0.92, radius * 0.55),
    cyl(radius, 0.12, 0, 0.36, bowlZ, scaleZ),
    cyl(radius * 1.02, 0.03, 0, 0.435, bowlZ, scaleZ),
    rbox(w, cisternH, cisternD, 0, h - cisternH / 2, -d / 2 + cisternD / 2, 0.03),
    cyl(0.025, 0.015, 0, h + 0.005, -d / 2 + cisternD / 2),
  ]);
}

function basinGeometry(p: P): G {
  const { width: w, height: h, depth: d } = p;
  const top = h - 0.05;
  const vanity = p.doorCount > 0 && w >= 0.5;
  const parts: G[] = [];
  if (vanity) {
    parts.push(box(w, top - 0.1, d - 0.02, 0, 0.1 + (top - 0.1) / 2, -0.01));
    parts.push(box(w - 0.02, top - 0.14, 0.02, 0, 0.1 + (top - 0.1) / 2, d / 2 - 0.01));
    parts.push(box(w - 0.04, 0.1, d - 0.08, 0, 0.05, -0.03));
  } else {
    parts.push(cyl(0.05, top - 0.12, 0, (top - 0.12) / 2, -d * 0.18));
    parts.push(rbox(w * 0.5, 0.1, d * 0.45, 0, 0.05, -d * 0.12, 0.02));
  }
  parts.push(rbox(w + 0.02, 0.03, d + 0.01, 0, top - 0.015, 0, 0.012));
  // Raised ceramic bowl rim and a mixer tap on the back edge.
  const bw = w * 0.74, bd = d * 0.7, rim = 0.025;
  parts.push(box(bw, 0.05, rim, 0, top + 0.025, bd / 2 - 0.02));
  parts.push(box(bw, 0.05, rim, 0, top + 0.025, -bd / 2 + 0.03));
  parts.push(box(rim, 0.05, bd - 0.05, -bw / 2 + rim / 2, top + 0.025, 0.005));
  parts.push(box(rim, 0.05, bd - 0.05, bw / 2 - rim / 2, top + 0.025, 0.005));
  parts.push(cyl(0.014, 0.12, 0, top + 0.06, -d / 2 + 0.03));
  parts.push(box(0.014, 0.014, 0.09, 0, top + 0.115, -d / 2 + 0.07));
  return merge(parts);
}

export function createRoomFurnitureGeometry(type: RoomFurnitureType, p: P): G {
  switch (type) {
    case 'desk': return deskGeometry(p);
    case 'office-chair': return officeChairGeometry(p);
    case 'bookcase': return bookcaseGeometry(p);
    case 'filing-cabinet': return filingCabinetGeometry(p);
    case 'kitchen-run': return kitchenRunGeometry(p);
    case 'fridge': return fridgeGeometry(p);
    case 'dining-table': return diningTableGeometry(p);
    case 'dining-chair': return diningChairGeometry(p);
    case 'bath': return bathGeometry(p);
    case 'shower': return showerGeometry(p);
    case 'toilet': return toiletGeometry(p);
    case 'basin': return basinGeometry(p);
  }
}
