import type { Shape } from '../../types';

/**
 * How presentation effects treat each part of a model. Pure data rules, kept apart from three.js
 * so they can be tested: which pieces are building fabric (x-rayed, cut, exploded), which are
 * landscape (left alone), and the order the build-up animation assembles them in.
 */
export type PresentCategory =
  | 'terrain'
  | 'slab'
  | 'wall'
  | 'opening'
  | 'stair'
  | 'roof'
  | 'floorFrame'
  | 'frame'
  | 'roofFrame'
  | 'landscape'
  | 'kernel'
  | 'other';

const LANDSCAPE = new Set<Shape['type']>([
  'tree', 'bush', 'rock', 'lamp', 'bench', 'scale_figure', 'water', 'patio', 'fence', 'railing',
]);

export function isSlab(s: Pick<Shape, 'tags' | 'name' | 'type'>): boolean {
  return Boolean(
    s.tags?.includes('floor-slab') ||
    s.tags?.includes('slab') ||
    s.tags?.includes('foundation-skirt') ||
    /floor slab|foundation/i.test(s.name ?? '') ||
    (s.type === 'poly' && s.tags?.includes('architecture')),
  );
}

/** Roofs, including the separate parts of a roof assembly (slopes, ridge cap, fascias, soffits, tiles). */
export function isRoof(s: Pick<Shape, 'tags' | 'type' | 'roofData' | 'roofTileData'>): boolean {
  if (s.tags?.some(t => t.startsWith('timber'))) return false;
  return s.type === 'roof' || s.roofData !== undefined || s.roofTileData !== undefined
    || Boolean(s.tags?.some(t => t === 'roof' || t.startsWith('roof-')));
}

/** A roof assembly's secondary parts, which the BOM leaves out (the covering is what's counted). */
export function isRoofTrim(s: Pick<Shape, 'tags'>): boolean {
  return Boolean(s.tags?.includes('roof-part'));
}

/** A timber frame member (generated framing), by its tags or its tf- id. */
export function isTimber(s: Pick<Shape, 'tags' | 'id'>): boolean {
  return Boolean(s.tags?.some(t => t.startsWith('timber')) || s.id?.startsWith('tf-'));
}

/** Which part of the frame a timber member belongs to: floor, walls, or roof. */
export function timberPart(s: Pick<Shape, 'tags' | 'id'>): 'floorFrame' | 'frame' | 'roofFrame' {
  const tags = s.tags ?? [];
  if (s.id?.startsWith('tf-roof-') || tags.some(t => /rafter|ridge|collar|truss|roof|ceiling-joist/.test(t))) return 'roofFrame';
  if (tags.some(t => /floor|trimmer-joist|header-joist|rim/.test(t))) return 'floorFrame';
  return 'frame';
}

export function categoryOf(s: Shape | undefined): PresentCategory {
  if (!s) return 'kernel';
  if (isTimber(s)) return timberPart(s);
  // An imported site's existing buildings are context, like the ground: there from the start of a
  // build-up, never exploded, cut or counted.
  if (s.type === 'terrain' || s.type === 'site_building') return 'terrain';
  if (isRoof(s)) return 'roof';
  if (s.type === 'wall') return 'wall';
  if (s.type === 'door' || s.type === 'window') return 'opening';
  if (s.type === 'staircase' || s.type === 'step') return 'stair';
  if (isSlab(s)) return 'slab';
  if (LANDSCAPE.has(s.type)) return 'landscape';
  return 'other';
}

/** Building fabric: see-through in x-ray. Furniture, stairs and props stay solid so the inside reads. */
export function isShell(c: PresentCategory): boolean {
  return c === 'wall' || c === 'opening' || c === 'roof' || c === 'slab' || c === 'kernel';
}

/** What a section cut slices: the building and anything in it, never the ground or garden. */
export function isCuttable(c: PresentCategory): boolean {
  return c !== 'terrain' && c !== 'landscape';
}

/** Storey index (0 = ground) of something whose lowest point is at `minY`. */
export function levelFor(minY: number, elevations: number[], tolerance = 0.45): number {
  let level = 0;
  elevations.forEach((e, i) => { if (minY >= e - tolerance) level = i; });
  return level;
}

/** Floor heights of the storeys, from the walls: walls standing within half a metre of each other share one. */
export function storeyElevations(shapes: Shape[]): number[] {
  const bases = shapes
    .filter(s => s.type === 'wall' && !s.hidden && Array.isArray(s.args))
    .map(s => Math.round((s.position[1] - ((s.args as number[])[1] ?? 2.8) / 2) * 100) / 100)
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const b of bases) if (!out.length || b - out[out.length - 1] >= 0.5) out.push(b);
  return out;
}

/** Height a storey's walls lift by in the exploded view, per unit of explode. */
export const EXPLODE_STOREY_GAP = 3.2;
/** Extra lift for walls above their own floor slab, so each floor plate shows. */
export const EXPLODE_SLAB_GAP = 0.9;
/** Extra lift for the roof above the top storey. */
export const EXPLODE_ROOF_GAP = 2.4;

/** Vertical offset (metres) of a part in the fully exploded view. */
export function explodeLift(category: PresentCategory, level: number, storeys: number): number {
  switch (category) {
    case 'terrain':
    case 'landscape':
      return 0;
    case 'roof':
    case 'roofFrame':
      return Math.max(0, storeys - 1) * EXPLODE_STOREY_GAP + EXPLODE_SLAB_GAP + EXPLODE_ROOF_GAP;
    case 'slab':
    case 'floorFrame':
      return level * EXPLODE_STOREY_GAP;
    default:
      return level * EXPLODE_STOREY_GAP + EXPLODE_SLAB_GAP;
  }
}

const PHASE_ORDER: Record<PresentCategory, number> = {
  terrain: -1, floorFrame: 0, slab: 1, frame: 2, wall: 3, kernel: 3, stair: 4, opening: 5, other: 6,
  roofFrame: 0, roof: 0, landscape: 0,
};

/**
 * Build-up sort key, in the order a building goes up: storey by storey (floor joists, slab, wall
 * frame, walls closing over it, stairs, openings, fittings), then the roof timbers, the roof
 * covering, and the garden. Terrain is there from the start.
 */
export function buildRank(category: PresentCategory, level: number): number {
  if (category === 'terrain') return -1;
  if (category === 'roofFrame') return 9_000;
  if (category === 'roof') return 10_000;
  if (category === 'landscape') return 20_000;
  return level * 10 + PHASE_ORDER[category];
}

export interface BuildItem {
  key: string;
  category: PresentCategory;
  level: number;
  /** Plan position of the item's centre, for sweeping round the building within a phase. */
  x: number;
  z: number;
}

export interface BuildSlot {
  /** Fraction of the whole build (0-1) at which this item starts to appear. */
  start: number;
  /** Fraction of the whole build the item takes to land. */
  span: number;
}

/**
 * When each item appears in a build-up lasting 1 unit: sorted by `buildRank`, then swept round
 * the building's centre so walls go up in order rather than at random.
 */
export function buildSchedule(items: BuildItem[]): Map<string, BuildSlot> {
  const out = new Map<string, BuildSlot>();
  const animated = items.filter(i => i.category !== 'terrain');
  for (const i of items) if (i.category === 'terrain') out.set(i.key, { start: 0, span: 0 });
  if (!animated.length) return out;
  const cx = animated.reduce((a, i) => a + i.x, 0) / animated.length;
  const cz = animated.reduce((a, i) => a + i.z, 0) / animated.length;
  const angle = (i: BuildItem) => Math.atan2(i.z - cz, i.x - cx);
  const sorted = [...animated].sort((a, b) =>
    buildRank(a.category, a.level) - buildRank(b.category, b.level) || angle(a) - angle(b));
  // Each item lands over a fixed share of the build; starts are spread over the rest.
  const span = Math.min(0.25, Math.max(0.06, 4 / sorted.length));
  const step = sorted.length > 1 ? (1 - span) / (sorted.length - 1) : 0;
  sorted.forEach((item, n) => out.set(item.key, { start: n * step, span }));
  return out;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number) => {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Where an item is during the build: hidden before its slot, dropping or growing into place during it. */
export function buildPose(slot: BuildSlot | undefined, progress: number, category: PresentCategory) {
  if (!slot || slot.span === 0 || progress >= 1) return { visible: true, drop: 0, scale: 1 };
  const t = (progress - slot.start) / slot.span;
  if (t <= 0) return { visible: false, drop: 0, scale: 1 };
  if (t >= 1) return { visible: true, drop: 0, scale: 1 };
  if (category === 'landscape') return { visible: true, drop: 0, scale: Math.max(0.001, easeOutBack(t)) };
  const height = category === 'roof' ? 4 : 2.5;
  return { visible: true, drop: (1 - easeOutCubic(t)) * height, scale: 1 };
}

export interface Look {
  /** Solid surfaces emerge from the open line drawing during Sketch → Massing. */
  surfaceOpacity: number;
  /** 'clay': everything wears the model material; 'fade': real materials under a fading clay layer; 'built': as modelled. */
  mode: 'clay' | 'fade' | 'built';
  /** 0 = sketch paper, 1 = white card, for the model material's colour. */
  whiteness: number;
  /** Pencil outline opacity (0 = no outlines). */
  pencil: number;
  /** Fixed freehand wobble settles into cleaner massing contours. */
  pencilRoughness: number;
  /** Opacity of the clay layer over the real materials in 'fade'. */
  clayOver: number;
  /** Glass shows as glass (from Detailed on); before that windows are open holes. */
  glass: boolean;
  /** Furniture and props (from Detailed on). */
  furniture: boolean;
  /** Real trees and plants (Built); before that they're drawn as pencil outlines. */
  plants: boolean;
  /** How far glass has come in, 0-1: it fades in rather than switching on. */
  glassIn: number;
  /** How far furniture and fittings have come in, 0-1: they grow in rather than popping into view. */
  furnitureIn: number;
  /** How far the real trees and plants have come in, 0-1. */
  plantsIn: number;
  /** Opacity of the pencil tree outlines. */
  treeSketch: number;
  /** How much of the paper backdrop shows instead of the real sky, 0-1. */
  paper: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t);
/** 0 below `from`, 1 above `to`, eased between, so things arrive gradually. */
const smooth = (x: number, from: number, to: number) => { const t = clamp01((x - from) / (to - from)); return t * t * (3 - 2 * t); };

/** How the model looks at a (fractional) stage between 0 (Sketch) and 3 (Built). */
export function lookAt(stage: number): Look {
  const s = Math.min(3, Math.max(0, stage));
  const glassIn = smooth(s, 1.3, 1.9), furnitureIn = smooth(s, 1.3, 1.9), plantsIn = smooth(s, 2.3, 2.9);
  return {
    surfaceOpacity: easeInOutCubic(clamp01(s)),
    mode: s >= 2.98 ? 'built' : s > 2 ? 'fade' : 'clay',
    whiteness: clamp01(s),
    pencil: s < 1 ? lerp(0.85, 0.5, s) : s < 2 ? lerp(0.5, 0.1, s - 1) : 0,
    pencilRoughness: s < 1 ? lerp(1, 0.22, s) : lerp(0.22, 0, s - 1),
    clayOver: s > 2 ? clamp01(3 - s) : 1,
    glass: glassIn > 0,
    furniture: furnitureIn > 0,
    plants: plantsIn > 0,
    glassIn, furnitureIn, plantsIn,
    treeSketch: s < 2.5 ? (s < 2 ? 1 : lerp(1, 0, (s - 2) / 0.5)) : 0,
    paper: s < 2 ? 1 : clamp01((2.98 - s) / 0.98),
  };
}
