/**
 * Patios (paving set level into the ground) and decks (timber boards on a raised frame), drawn
 * with the Landscapes toolbar's Patio / Decking tool and saved on a shape of type 'patio'.
 */
export type PatioKind = 'patio' | 'deck';

export type PavingStyle = 'slabs' | 'block' | 'natural' | 'porcelain' | 'gravel';
export type BlockPattern = 'herringbone' | 'stretcher' | 'basketweave';
export type DeckBoard = 'softwood' | 'hardwood' | 'composite' | 'weathered' | 'painted';
export type BoardDirection = 'length' | 'across' | 'diagonal';
export type RailingStyle = 'none' | 'timber' | 'glass' | 'cable';
export type DeckUnderside = 'frame' | 'skirting';

/** Steps down from one edge: centred `t` (0..1) of the way along drawn edge `edge`. */
export interface PatioStep {
  edge: number;
  t: number;
  width: number;
}

export interface DeckLights {
  enabled: boolean;
  /** Metres between lights around the edge of the deck. */
  spacing: number;
  color: string;
  /** Glow only when the sun is low. */
  nightOnly: boolean;
  /** Cast real light onto nearby surfaces (the nearest few lights only). */
  castLight: boolean;
}

/**
 * Everything about one patio or deck. Points are x/z relative to the shape's position; the
 * shape's y position is the level of the walking surface.
 */
export interface PatioData {
  kind: PatioKind;
  points: [number, number][];
  /**
   * How far each edge (from point i to point i+1) bows out from a straight line, in metres:
   * the offset of the edge's middle to the left of the direction of travel. 0 = straight.
   */
  bulges: number[];
  /** Edges drawn along a building wall: no railing or steps there. */
  wallEdges: boolean[];

  // Paving
  paving: PavingStyle;
  /** Slab length x width in metres; [0, 0] = mixed sizes (random course). */
  slabSize: [number, number];
  blockPattern: BlockPattern;
  /** Pattern rotation, degrees. */
  rotation: number;
  /** Gap between slabs, metres. */
  jointWidth: number;
  groutColor: string;
  color: string;
  kerb: boolean;
  kerbColor: string;
  retainingWall: boolean;

  // Decking
  board: DeckBoard;
  boardWidth: number;
  boardGap: number;
  direction: BoardDirection;
  pictureFrame: boolean;
  grooved: boolean;
  underside: DeckUnderside;
  fascia: boolean;
  railing: RailingStyle;
  lights: DeckLights;

  steps: PatioStep[];
  /** A material library entry for the paving slabs or deck boards (overrides the preset look). */
  surfaceMaterialId?: string;
}

export interface PatioToolSettings {
  kind: PatioKind;
  /** Deck surface height above the ground when not drawn against a building. */
  deckHeight: number;
  /** Next patio/deck's look; copied onto each new one. */
  template: Omit<PatioData, 'kind' | 'points' | 'bulges' | 'wallEdges' | 'steps'>;
  /** While true, clicking an edge of the selected patio/deck adds steps there. */
  placingSteps: boolean;
  stepWidth: number;
}

export interface SurfacePreset { id: string; label: string; color: string }

export const PAVING_STYLES: { id: PavingStyle; label: string; description: string; presets: SurfacePreset[]; slabSize: [number, number]; joint: number }[] = [
  { id: 'slabs', label: 'Slabs', description: 'Concrete or sandstone slabs', slabSize: [0.6, 0.6], joint: 0.008, presets: [
    { id: 'silver', label: 'Silver grey', color: '#a3a7aa' }, { id: 'buff', label: 'Buff sandstone', color: '#c8b28a' }, { id: 'charcoal', label: 'Charcoal', color: '#55595e' }] },
  { id: 'block', label: 'Block paving', description: 'Bricks in a pattern', slabSize: [0.2, 0.1], joint: 0.004, presets: [
    { id: 'brindle', label: 'Brindle', color: '#8a5a44' }, { id: 'red', label: 'Red brick', color: '#9b3d2e' }, { id: 'charcoal', label: 'Charcoal', color: '#4a4c50' }] },
  { id: 'natural', label: 'Natural stone', description: 'Irregular flagstones (crazy paving)', slabSize: [0.55, 0.55], joint: 0.014, presets: [
    { id: 'sandstone', label: 'Indian sandstone', color: '#b89a78' }, { id: 'slate', label: 'Slate', color: '#4d535b' }, { id: 'limestone', label: 'Limestone', color: '#cdc4ae' }] },
  { id: 'porcelain', label: 'Porcelain', description: 'Large smooth modern tiles', slabSize: [0.9, 0.6], joint: 0.003, presets: [
    { id: 'light', label: 'Light grey', color: '#c9cbcc' }, { id: 'anthracite', label: 'Anthracite', color: '#404346' }, { id: 'travertine', label: 'Travertine', color: '#d6c7ab' }] },
  { id: 'gravel', label: 'Gravel', description: 'Loose decorative gravel', slabSize: [0, 0], joint: 0, presets: [
    { id: 'cotswold', label: 'Cotswold', color: '#c9b182' }, { id: 'granite', label: 'Grey granite', color: '#8f9296' }, { id: 'shingle', label: 'Pea shingle', color: '#b19a78' }] },
];

export const DECK_BOARDS: { id: DeckBoard; label: string; description: string; color: string }[] = [
  { id: 'softwood', label: 'Softwood', description: 'Pressure-treated pine', color: '#b8915c' },
  { id: 'hardwood', label: 'Hardwood', description: 'Ipe / oak, rich brown', color: '#7a4a2c' },
  { id: 'composite', label: 'Composite', description: 'Modern boards, subtle grain', color: '#6d6a64' },
  { id: 'weathered', label: 'Weathered', description: 'Silvery aged timber', color: '#a39c92' },
  { id: 'painted', label: 'Painted', description: 'Painted boards, any colour', color: '#7d8f78' },
];

export const SLAB_SIZES: { label: string; size: [number, number] }[] = [
  { label: '300 × 300', size: [0.3, 0.3] },
  { label: '450 × 450', size: [0.45, 0.45] },
  { label: '600 × 600', size: [0.6, 0.6] },
  { label: '900 × 600', size: [0.9, 0.6] },
  { label: '900 × 900', size: [0.9, 0.9] },
  { label: 'Mixed', size: [0, 0] },
];

export const DEFAULT_PATIO_TEMPLATE: PatioToolSettings['template'] = {
  paving: 'slabs',
  slabSize: [0.6, 0.6],
  blockPattern: 'herringbone',
  rotation: 0,
  jointWidth: 0.008,
  groutColor: '#8a8680',
  color: '#a3a7aa',
  kerb: true,
  kerbColor: '#6f6d69',
  retainingWall: true,
  board: 'softwood',
  boardWidth: 0.144,
  boardGap: 0.005,
  direction: 'length',
  pictureFrame: true,
  grooved: false,
  underside: 'frame',
  fascia: true,
  railing: 'none',
  lights: { enabled: false, spacing: 1.5, color: '#ffd9a0', nightOnly: true, castLight: true },
};

export const DEFAULT_PATIO_TOOL_SETTINGS: PatioToolSettings = {
  kind: 'patio',
  deckHeight: 0.45,
  template: DEFAULT_PATIO_TEMPLATE,
  placingSteps: false,
  stepWidth: 1.2,
};
