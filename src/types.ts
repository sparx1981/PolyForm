import type { FenceData, FenceStyle, WoodFinish } from './lib/fence/fenceTypes';
import type { WaterData, WaterClarity } from './lib/water/waterBody';
import type { PatioData, PatioToolSettings } from './lib/patio/patioTypes';
import type { KernelArcHost } from './tools/kernelArcHost';
import type { WallConversionUndoLink } from './tools/kernelConvertToWall';
import type * as THREE from 'three';
import type { FaceId } from './lib/geometry/types';
import type { GraphicsSettings } from './lib/graphics/graphicsSettings';
import type { EnvironmentState, MaterialInstance } from './lib/assets/types';

// Defined here (not in AppContext.tsx, which re-exports them for existing
// importers) because types.ts is imported by the entire geometry
// kernel/tools layer, and tsconfig.kernel.json type-checks whatever those
// files transitively import. types.ts importing FROM AppContext.tsx used
// to drag AppContext's own full dependency graph — the rest of the
// application, well outside the kernel — into that strict-mode kernel
// compilation, which is where most of tsconfig.kernel.json's several
// hundred errors were actually coming from.
export type ToolbarKey = 'left' | 'architecture' | 'landscapes' | 'camera' | 'ai';
export type DockZone = 'left' | 'top' | 'bottom';

export type CivilToolMode = 'terrain' | 'road' | 'pad-rect' | 'pad-circle' | 'striping';

export type ToolType = 
  | 'select' | 'lasso' | 'eraser' | 'paint' | 'component'
  | 'line' | 'poly' | 'bezier' | 'freehand' | 'rectangle' | 'circle' | 'polygon' | 'arc' | 'pie' | 'triangle'
  | 'move' | 'rotate' | 'scale' | 'pushpull' | 'followme' | 'offset' | 'combine' | 'flip'
  | 'tape' | 'protractor' | 'dimensions' | 'text' | 'text3d' | 'axes' | 'section'
  | 'orbit' | 'pan' | 'zoom' | 'zoomextents' | 'teleport' | 'walk' | 'look'
  | 'sphere' | 'cone' | 'pyramid' | 'donut' | 'dome'
  | 'bevel' | 'subtract' | 'note' | 'deform'
  | 'wall' | 'door' | 'window' | 'step' | 'staircase'
  | 'landscape_plot' | 'landscape_form' | 'landscape_embed' | 'landscape_sculpt' | 'landscape_mask' | 'landscape_road' | 'landscape_zone' | 'landscape_texture'
  | 'tree' | 'bush' | 'fence' | 'railing' | 'lamp' | 'bench' | 'rock' | 'water' | 'patio' | 'protractor'
  | 'roof' | 'timber-frame' | 'scale_figure' | 'clipping' | 'site_route'
  | 'block_picker' | 'worldview' | 'arealabel' | 'leader'
  | CivilToolMode;

export type ToolMode = ToolType | CivilToolMode;

export type SkyboxType = 'none' | 'golden-hour' | 'woodland' | 'sunrise' | 'twilight' | 'cyberspace-neon' | 'studio' | 'snowy';

export interface GrassSettings {
  enabled: boolean;
  rootColor: string;
  tipColor: string;
  density: number; // instances per m²
  baseHeight: number; // meters
  heightVariance: number; // 0.0 to 1.0
  maxSlopeAngle: number; // degrees
  animate?: boolean; // toggle for procedural grass wind animation
  animationStrength?: number; // 0.0 to 1.0 slider controlling animation strength
  windStrength?: number;
  windSpeed?: number;
}

export const DEFAULT_GRASS_SETTINGS: GrassSettings = {
  enabled: false,
  rootColor: '#4f7340',
  tipColor: '#91b364',
  density: 10,
  baseHeight: 0.05,
  heightVariance: 0.10,
  maxSlopeAngle: 35,
  animate: true,
  animationStrength: 0.01,
  windStrength: 0.01,
  windSpeed: 2.0
};

export interface WildflowerSettings {
  enabled: boolean;
  density: number; // instances per m² (0.1 to 15)
  baseHeight: number; // meters, low-lying (0.05 to 0.45m)
  heightVariance: number; // 0.0 to 1.0
  maxSlopeAngle: number; // degrees
  primaryColor: string; // main petal color
  secondaryColor: string; // accent petal color
  stemColor: string; // stem & leaf green
  flowerType?: 'mixed' | 'poppy' | 'alpine' | 'buttercup' | 'lavender' | 'daisy';
  animate?: boolean; // toggle wind animation
  animationStrength?: number; // 0.0 to 1.0 (default 0.08 for 8%)
  windSpeed?: number;
}

export const DEFAULT_WILDFLOWER_SETTINGS: WildflowerSettings = {
  enabled: false,
  density: 0.3, // 0.3 / m²
  baseHeight: 0.05, // 5cm (0.05m)
  heightVariance: 0.30,
  maxSlopeAngle: 35,
  primaryColor: '#ffffff', // Daisies pure white petals
  secondaryColor: '#f59e0b', // Daisies warm golden core
  stemColor: '#2e6128', // Rich meadow stem green
  flowerType: 'daisy',
  animate: true,
  animationStrength: 0.02, // 2%
  windSpeed: 2.0
};

export interface TerrainData {
  gridX: number;
  gridY: number;
  width: number;
  depth: number;
  heights: number[];
  baseHeights?: number[];
  masks?: number[];
  shadingMode?: 'default' | 'slope' | 'elevation' | 'aspect' | 'contours';
  contourInterval?: number;
  zones?: Array<{ id: string; name: string; color: string; polygon: [number, number][] }>;
  textureUrl?: string;
  materialBindingId?: string;
  textureScale?: number;
  roughness?: number;
  topography?: string;
  grass?: GrassSettings;
  flowers?: WildflowerSettings;
  /** Set on ground imported from a real place (World View): where it is and how it was made. */
  site?: WorldSiteInfo;
  /**
   * The buildings that stood on an imported site when it was brought in, so ones you delete can
   * be shown as see-through ghosts ("show existing") or put back. Saved with the height grids.
   */
  siteExisting?: SiteBuildingSnapshot[];
}

/** An imported real-world site: its place on Earth and the choices made when it came in. */
export interface WorldSiteInfo {
  lat: number;
  lng: number;
  /** Side of the square area, metres (at most 200). */
  size: number;
  address?: string;
  /** Height above sea level of the site's centre, metres. The model's y = 0 is this height. */
  elevation: number;
  /** Where the ground heights came from, e.g. "Terrain Tiles (AWS)". */
  terrainSource: string;
  /** Where the buildings came from, e.g. "OpenStreetMap". */
  buildingSource: string;
  importedAt: number;
  groundStyle: 'plain' | 'satellite';
  /** Draw deleted buildings as ghosts. */
  showRemoved: boolean;
  /** The LiDAR survey used, if there was one (ground and/or building heights). */
  lidarSource?: string;
  /** How far the LiDAR was slid (x, z metres) to line up with the map outlines. */
  lidarShift?: [number, number];
  /**
   * Where cars and people move: the map's roads and footpaths plus any the designer drew.
   * Missing on sites imported before street life existed (they're fetched when first needed).
   */
  routes?: SiteRoute[];
  /** How busy the street is when cars and people show (default 'normal'). */
  streetLife?: StreetLifeLevel;
  /** Also show moving cars and people in the editor, not only in presentations. */
  streetLifeInEditor?: boolean;
  /** Show Google's Photorealistic 3D Tiles around the site (a viewing layer, not editable). */
  googleContext?: boolean;
  /**
   * With the Google layer on: 'cutout' (default) cuts it away over the site so the editable
   * satellite ground shows there; 'google' hides the editable ground and stands the buildings on
   * Google's mesh, with Google's own buildings flattened under them.
   */
  googleGround?: 'cutout' | 'google';
  /** Metres to raise (+) or lower (-) the Google layer, on top of the automatic height match. */
  googleNudge?: number;
  /** Colour the editable buildings: satellite roofs, walls from the map's material or colour tags. */
  styledBuildings?: boolean;
}

export type StreetLifeLevel = 'off' | 'quiet' | 'normal' | 'busy';

/** A line that cars ('road') or only people ('path') move along; never drawn itself. */
export interface SiteRoute {
  id: string;
  kind: 'road' | 'path';
  /** Plan points [x, z], metres in the model. */
  points: [number, number][];
  /** 'map' = from OpenStreetMap; 'drawn' = drawn by the designer. */
  source: 'map' | 'drawn';
  /** Road width, metres (pavements are either side). */
  width?: number;
  /** Cars go one way only, first point to last. */
  oneway?: boolean;
  /** People only walk on it, e.g. a pedestrian street; no pavements beside it. */
  noPavement?: boolean;
}

/** An existing building on an imported site: its outline and how tall it is. */
export interface SiteBuildingData {
  /** Where it came from, e.g. "osm:way/123456". */
  sourceId: string;
  /** Outline in plan, [x, z] metres relative to the shape's position. */
  footprint: [number, number][];
  holes?: [number, number][][];
  /** Height of the top above the shape's position (its lowest ground point), metres. */
  height: number;
  /** Height of the underside above the shape's position, for canopies and overhangs. */
  minHeight?: number;
  /**
   * 'lidar' = measured from a LiDAR survey; 'tagged' = a height given on the map (or typed in);
   * 'levels' = floors x 3 m; 'estimated' = a guess from the building type.
   */
  heightSource: 'lidar' | 'tagged' | 'levels' | 'estimated';
  /** A pitched roof fitted to LiDAR (none: flat top). */
  roof?: SiteRoof;
  /** The LiDAR survey shows open ground here (built since, or a wrong outline): height is the map's guess. */
  heightCheck?: boolean;
  levels?: number;
  /** The map's building type, e.g. "house", "apartments". */
  kind?: string;
  /** What the map says the building is made of (OpenStreetMap tags), for styling. */
  style?: SiteBuildingStyleTags;
}

/** Appearance tags from the map: colours are CSS colours or names, materials are OSM values. */
export interface SiteBuildingStyleTags {
  colour?: string;
  material?: string;
  roofColour?: string;
  roofMaterial?: string;
}

/**
 * A basic roof on an existing building. Its surface is the lowest of its planes at each point:
 * height = a*x + b*z + c above the building's position, x/z in its own plan frame.
 */
export interface SiteRoof {
  shape: 'flat' | 'skillion' | 'gable' | 'hip' | 'pyramid';
  planes: [number, number, number][];
  /** Lowest and highest points of the roof over the outline, above the building's position. */
  eave: number;
  ridge: number;
  /** Roof pitch, degrees. */
  pitch: number;
}

/** A building as it was imported (world position), kept for ghosts and restoring. */
export interface SiteBuildingSnapshot {
  id: string;
  name: string;
  position: [number, number, number];
  data: SiteBuildingData;
}

const KNOWN_TEXTURE_IDS = new Set([
  'lush_grass', 'manicured_turf', 'alpine_rock', 'forest_mulch', 'desert_sand', 
  'cobblestone', 'crushed_gravel', 'fresh_snow', 'weathered_asphalt', 'terracotta_clay',
  'river_gravel', 'field_soil', 'flagstone_pavers', 'mossy_forest', 'cracked_earth'
]);

export function isTextureUrl(val?: any): boolean {
  if (!val || typeof val !== 'string') return false;
  return val.startsWith('data:image') || 
         val.startsWith('blob:') || 
         val.startsWith('http://') || 
         val.startsWith('https://') || 
         val.startsWith('/') ||
         val.startsWith('data:application') ||
         KNOWN_TEXTURE_IDS.has(val) ||
         /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(val);
}

/** A text object's words and settings. The letters are drawn from them when it renders. */
export interface TextData {
  text: string;
  /** Letter height, metres. */
  size: number;
  /** How far 3D letters stand out, metres (3D text only). */
  depth?: number;
  bold?: boolean;
  align: 'left' | 'center' | 'right';
}

export interface Shape {
  id: string;
  name?: string;
  type: 'box' | 'rect' | 'circle' | 'line' | 'triangle' | 'prism' | 'sphere' | 'cone' | 'pyramid' | 'donut' | 'dome' | 'cylinder' | 'custom' | 'poly' | 'bezier' | 'measurement' | 'arc' | 'wall' | 'door' | 'window' | 'step' | 'staircase' | 'terrain' | 'tree' | 'bush' | 'fence' | 'railing' | 'lamp' | 'bench' | 'rock' | 'roof' | 'scale_figure' | 'water' | 'patio' | 'text' | 'text3d' | 'site_building' | 'kernel_group';
  position: [number, number, number];
  rotation?: [number, number, number];
  quaternion?: [number, number, number, number];
  scale?: [number, number, number];
  /**
   * A group or component of drawn geometry (type 'kernel_group'): its faces, serialized, in the
   * group's own frame. See tools/kernelGroups.ts.
   */
  kernelGraph?: unknown;
  /** Copies of a component share this id (and their kernelGraph): editing one edits all. */
  componentId?: string;
  componentName?: string;
  args: any;
  terrainData?: TerrainData;
  /** An existing building on an imported real-world site (World View). */
  siteBuildingData?: SiteBuildingData;
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  tags?: string[];
  groupId?: string; hidden?: boolean;
  surfaceMaterials?: Record<number, string>; // face index -> material/color
  materialBindingId?: string;
  surfaceMaterialBindings?: Record<number, string>;
  modelMaterialBindings?: Record<string, string>;
  surfaceDivisions?: Record<number, number | [number, number]>; // face index -> gridSize or [gridX, gridY]
  bevelAmount?: number;
  bevelType?: 'radius' | 'chamfer';
  bevelSegments?: number;
  geometryData?: any; // For custom/CSG meshes
  hostWallId?: string; // For door/window shapes hosted on a wall
  archStyle?: string; // Style identifier for architectural doors, windows, and stairs
  wallStyle?: string;
  // True mitered footprint for a wall that closes a room corner at a non-90-degree angle: the
  // wall's 4 actual top-down corners (outer-start, inner-start, inner-end, outer-end, in that
  // winding order), in the wall's own LOCAL space (X = along length, Z = thickness, origin at
  // `position`) - a plain box's flat, perpendicular end caps can only close flush against a
  // neighbor at exactly 90 degrees; at any other angle each end needs its own angled cut,
  // computed from where this wall's outer/inner offset lines truly meet its neighbors'. Only
  // set for walls assembled by the room tool at a non-90-degree vertex; a wall without this
  // renders as the plain box described by `args`.
  wallMiterFootprint?: [[number, number], [number, number], [number, number], [number, number]];
  stairStyle?: 'straight' | 'l-shape' | 'u-shape' | 'c-shape' | 'winder' | 'spiral' | 'curved' | 'bifurcated' | string;
  stairStructure?: 'closed' | 'open' | 'floating' | 'mono-stringer';
  railingMode?: 'none' | 'left' | 'right' | 'both';
  parentShapeId?: string;
  parentDepth?: number;
  faceIndex?: number;
  customBounds?: { minU: number; maxU: number; minV: number; maxV: number };
  isRingSection?: boolean;
  plantSpeciesId?: string;
  /** Whole-run fence (path, style, height). Legacy fence sections have none. Points are relative to `position`. */
  fenceData?: FenceData;
  /** Lake or pond outline and depth; the shape's y position is the water level. */
  waterData?: WaterData;
  /** Patio or deck outline and finish; the shape's y position is the level of its walking surface. */
  patioData?: PatioData;
  /** Words and settings of a text label ('text') or 3D letters ('text3d'); see lib/textShapes.ts. */
  textData?: TextData;
  plantVariation?: string;
  roofData?: any;
  roofTileData?: any;
  textureUrl?: string;
  // Additional PBR texture map URLs, layered on top of `textureUrl` (the
  // albedo/diffuse map) and the scalar `roughness`/`metalness` above, which
  // remain the fallback whenever a given map is not supplied. Albedo is the
  // only map that should ever be sRGB-decoded - all of these must be loaded
  // as linear data or they will visibly distort (see getCachedPBRTexture).
  normalMapUrl?: string;
  normalScale?: number;
  roughnessMapUrl?: string;
  metalnessMapUrl?: string;
  aoMapUrl?: string;
  aoMapIntensity?: number;
  displacementMapUrl?: string;
  displacementScale?: number;
  displacementBias?: number;
  surfaceDepthEnabled?: boolean;
  surfaceDepthSegments?: number;
  // Set only when displacementMapUrl was generated by a Surface depth preset (rather than
  // an uploaded image or an auto-from-texture height derivation), so the controls panel can
  // re-open on the right preset/sliders and regenerate the map when they're adjusted.
  surfaceDepthPresetId?: string;
  surfaceDepthPatternScale?: number;
  surfaceDepthPatternStrength?: number;
  surfaceDepthSeed?: number;
  // False once the user uploads their own normal map for this object; true (default)
  // means normalMapUrl was/should be auto-derived from displacementMapUrl.
  surfaceDepthAutoNormal?: boolean;
  materialPreset?: string;
  isParametric?: boolean;
  parametricData?: any;
  customData?: any;
  parentWallOrRoofId?: string;
  timberFrame?: TimberFrameShapeData;
  timberMemberData?: TimberMemberData;
  layerStack?: LayerStackItem[];
}

/** The height-map-related fields, independent of whatever they're attached to - a Shape
 * directly (see the surfaceDepth-prefixed/displacementMapUrl/normalMapUrl fields above,
 * which this mirrors), or a reusable material definition (customMaterials) that carries a
 * height map to be painted onto any object later, the same way a color or texture is. */
export interface HeightMapValue {
  displacementMapUrl?: string;
  normalMapUrl?: string;
  surfaceDepthAutoNormal?: boolean;
  surfaceDepthPresetId?: string;
  surfaceDepthPatternScale?: number;
  surfaceDepthPatternStrength?: number;
  surfaceDepthSeed?: number;
  displacementScale?: number;
  displacementBias?: number;
  surfaceDepthSegments?: number;
}

export interface TimberFrameShapeData {
  params: TimberFrameParams;
  openingAssemblies?: OpeningFrameAssembly[];
  lastComputedAt?: string | number;
  report?: TimberGenerationReport;
  bom?: TimberBOM;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

export interface SceneState {
  id: string;
  name: string;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  previewUrl?: string;
  timestamp?: string; // For display/sorting
  environment?: EnvironmentState;
}

export interface CustomLight {
  id: string;
  name?: string;
  type: 'point' | 'directional' | 'spot' | 'projector' | 'rect';
  color: string;
  intensity: number;
  contrast?: number; // 0 to 1
  position: [number, number, number];
  target?: [number, number, number];
  // Set when this light is attached to a prop (e.g. a street lamp) rather than placed
  // freestanding: its position is kept in sync with that shape and it's removed along
  // with it, but it's still a full, independently editable CustomLight otherwise.
  parentShapeId?: string;
  // Projector/Spot specific
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
  map?: string; // Texture URL for projector
  rotateTexture?: boolean;
  textureRotationSpeed?: number;
  // Rect specific
  width?: number;
  height?: number;
  rectRotation?: number; // Rotation around Y axis in degrees
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  animateRotationY?: boolean;
  rotationYSpeed?: number;
  projectorMode?: 'rgb' | 'texture' | 'video';
  scale?: number;
}

export interface FogSettings {
  enabled: boolean;
  type: 'standard' | 'super-mega';
  colorCount: 1 | 2 | 3;
  colors: string[]; // [color1, color2, color3]
  density: number;
  height: number;
  heightEnd: number;
  animate: boolean;
  speed: number;
  superMegaDensity: number;
}

export interface SceneAnimation {
  id: string;
  type: 'none' | 'confetti' | 'fire' | 'smoke' | 'sparks' | 'magic_aura' | 'bird' | 'bee' | 'flock';
  position: [number, number, number];
  density: number;
  scale?: number;
  speed?: number;
  looping: boolean;
  playing: boolean;
  // Bird-only: customises the flock's plumage. Falls back to BirdSystem's built-in
  // defaults (dark blue body/wings, chestnut breast) when left unset.
  birdBodyColor?: string;
  birdBreastColor?: string;
  birdBeakColor?: string;
  // Flock-only: a flock of birds crossing the sky. `density` is the number of birds.
  flockBirdType?: 'starling' | 'geese' | 'seagull';
  /** Height above the placed position, metres. */
  flockAltitude?: number;
}

/** A label pinned to the model for the client page ("Oak flooring throughout"). */
export interface PresentationLabel {
  id: string;
  text: string;
  /** A second, smaller line. */
  detail?: string;
  position: [number, number, number];
}

/** A stop on the client page's guided tour: a camera view and a caption. */
export interface TourStop {
  id: string;
  title: string;
  caption?: string;
  position: [number, number, number];
  target: [number, number, number];
}

/** What the designer adds for the client presentation, saved with the model. */
export interface PresentationContent {
  labels: PresentationLabel[];
  tour: TourStop[];
}

export const EMPTY_PRESENTATION_CONTENT: PresentationContent = { labels: [], tour: [] };

export interface SceneNote {
  id: string;
  text: string;
  authorUid: string;
  authorName: string;
  createdAt: number;
  position: { x: number, y: number, z: number };
  completed: boolean;
  completedAt?: number;
  completedBy?: string;
  visible?: boolean;
}

export interface Collaborator {
  id?: string;
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  status: 'invited' | 'active' | 'offline';
  role: 'owner' | 'collaborator';
  cursorPosition?: { x: number, y: number, z: number };
  lastSeen?: number;
  activeTransform?: {
    id: string;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    scale: [number, number, number];
  };
}

export interface ChatMessage {
  id: string;
  uid: string;
  displayName: string;
  text: string;
  timestamp: number;
}

export interface AppState {
  graphicsSettings: GraphicsSettings;
  setGraphicsSettings: (settings: GraphicsSettings | ((previous: GraphicsSettings) => GraphicsSettings)) => void;
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  measurements: string;
  setMeasurements: (val: string) => void;
  activeMaterial: string;
  setActiveMaterial: (color: string) => void;
  activeMaterialBindingId: string | null;
  setActiveMaterialBindingId: (bindingId: string | null) => void;
  materialBindings: Record<string, MaterialInstance>;
  setMaterialBindings: (bindings: Record<string, MaterialInstance> | ((previous: Record<string, MaterialInstance>) => Record<string, MaterialInstance>)) => void;
  environment: EnvironmentState;
  setEnvironment: (environment: EnvironmentState | ((previous: EnvironmentState) => EnvironmentState)) => void;
  activePBR: { roughness: number, metalness: number, opacity: number };
  setActivePBR: (pbr: { roughness: number, metalness: number, opacity: number }) => void;
  activeSurfaceDepth: HeightMapValue | null;
  setActiveSurfaceDepth: (value: HeightMapValue | null) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  selectedSurface: { shapeId: string, faceIndex: number, subFaceIndex?: number } | null;
  setSelectedSurface: (surface: { shapeId: string, faceIndex: number, subFaceIndex?: number } | null) => void;
  selectedLightId: string | null;
  setSelectedLightId: (id: string | null) => void;
  placingLightId: string | null;
  setPlacingLightId: (id: string | null) => void;
  shapes: Shape[];
  setShapes: (shapes: Shape[] | ((prev: Shape[]) => Shape[])) => void;
  duplicateObject: (id: string) => void;
  duplicateMultiple: (ids: string[]) => void;
  setShapesSilent: (shapes: Shape[] | ((prev: Shape[]) => Shape[])) => void;
  setTagsSilent: (tags: Tag[] | ((prev: Tag[]) => Tag[])) => void;
  setScenesSilent: (scenes: SceneState[] | ((prev: SceneState[]) => SceneState[])) => void;
  setCustomMaterialsSilent: (materials: any[] | ((prev: any[]) => any[])) => void;
  setAnimationsSilent: (animations: SceneAnimation[] | ((prev: SceneAnimation[]) => SceneAnimation[])) => void;
  setCustomLightsSilent: (lights: CustomLight[] | ((prev: CustomLight[]) => CustomLight[])) => void;
  setNotesSilent: (notes: SceneNote[] | ((prev: SceneNote[]) => SceneNote[])) => void;
  commitHistory: () => void;
  /** Links a Convert To Wall step's kernel change to Shape undo/redo. */
  registerWallConversionUndo: (link: WallConversionUndoLink) => void;
  addShape: (shape: Shape) => void;
  removeShape: (id: string) => void;
  /** Removes every guide line (Tape Measure and Protractor) as one undo step; returns how many. */
  deleteAllGuides: () => number;
  /** The group or component open for editing (its inside is in the kernel), if any. */
  /** mainGraph: the model's own drawn geometry, set aside (shown faded) while the group is open. */
  groupEdit: { shapeId: string; name: string; mainGraph: unknown } | null;
  /** Opens a group or component to edit its inside. */
  enterGroupEdit: (shapeId: string) => void;
  /** Closes the open group, putting the edited faces back into it (and every copy of a component). */
  exitGroupEdit: () => void;
  updateShapeColor: (id: string | string[], color: string, pbr?: { roughness: number, metalness: number, opacity: number }, surfaceDepth?: HeightMapValue | null) => void;
  updateShapeDimensions: (id: string, position: [number, number, number], args: any) => void;
  isAIRendererOpen: boolean;
  setIsAIRendererOpen: (open: boolean) => void;
  isAIQueryOpen: boolean;
  setIsAIQueryOpen: (open: boolean) => void;
  activeBlockPart: { partId: string; color: string; rotationSteps: number; randomPalette?: string[] } | null;
  setActiveBlockPart: (part: { partId: string; color: string; rotationSteps: number; randomPalette?: string[] } | null | ((prev: { partId: string; color: string; rotationSteps: number; randomPalette?: string[] } | null) => { partId: string; color: string; rotationSteps: number; randomPalette?: string[] } | null)) => void;
  blockPlacementDraft: { position: [number, number, number]; rotationSteps: number; blocked?: boolean } | null;
  setBlockPlacementDraft: (draft: { position: [number, number, number]; rotationSteps: number; blocked?: boolean } | null | ((prev: { position: [number, number, number]; rotationSteps: number; blocked?: boolean } | null) => { position: [number, number, number]; rotationSteps: number; blocked?: boolean } | null)) => void;
  blockPreventOverlap: boolean;
  setBlockPreventOverlap: (enabled: boolean) => void;
  user: any | null;
  setUser: (user: any | null) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  openMaterialsSignal: number;
  setOpenMaterialsSignal: (value: number | ((prev: number) => number)) => void;
  bannerColor: string;
  setBannerColor: (color: string) => void;
  customMaterials: any[];
  setCustomMaterials: (materials: any[] | ((prev: any[]) => any[])) => void;
  clearShapes: () => void;
  currentModelId: string | null;
  setCurrentModelId: (id: string | null) => void;
  currentModelName: string | null;
  setCurrentModelName: (name: string | null) => void;
  /** Where the open model's content lives when it is kept in Google Drive or Trimble Connect. */
  externalStorage: import('./lib/storage/providers').ExternalFileRef | null;
  /** A plain-words problem opening or saving an external model (e.g. the account needs connecting). */
  externalStorageProblem: string | null;
  connectExternalStorage: () => Promise<void>;
  adoptExternalModel: (modelId: string, ref: import('./lib/storage/providers').ExternalFileRef) => void;
  saveExternalNow: () => Promise<void>;
  /** Everything the open model is made of, for saving as a project file. */
  getProjectState: () => import('./lib/storage/projectFile').ProjectState;
  /** Replaces the open model's contents with a project (drawn geometry included). */
  applyProjectState: (state: import('./lib/storage/projectFile').ProjectState) => void;
  tags: Tag[];
  setTags: (tags: Tag[] | ((prev: Tag[]) => Tag[])) => void;
  activeTagId: string | null;
  setActiveTagId: (id: string | null) => void;
  allTagsVisible: boolean;
  setAllTagsVisible: (visible: boolean) => void;
  scenes: SceneState[];
  setScenes: (scenes: SceneState[] | ((prev: SceneState[]) => SceneState[])) => void;
  shadowsEnabled: boolean;
  setShadowsEnabled: (enabled: boolean) => void;
  showLightsource: boolean;
  setShowLightsource: (show: boolean) => void;
  lightPosition: [number, number, number];
  setLightPosition: (pos: [number, number, number]) => void;
  animateSun: boolean;
  setAnimateSun: (animate: boolean) => void;
  sunSpeed: number;
  setSunSpeed: (speed: number) => void;
  sunIntensity: number;
  setSunIntensity: (intensity: number) => void;
  shadowOpacity: number;
  setShadowOpacity: (opacity: number) => void;
  ambientOcclusionEnabled: boolean;
  setAmbientOcclusionEnabled: (enabled: boolean) => void;
  godRaysEnabled: boolean;
  setGodRaysEnabled: (enabled: boolean) => void;
  godRaysIntensity: number;
  setGodRaysIntensity: (intensity: number) => void;
  activeBevelType: 'radius' | 'chamfer';
  setActiveBevelType: (type: 'radius' | 'chamfer') => void;
  skybox: SkyboxType;
  setSkybox: (skybox: SkyboxType) => void;
  customLights: CustomLight[];
  setCustomLights: (lights: CustomLight[] | ((prev: CustomLight[]) => CustomLight[])) => void;
  presentationContent: PresentationContent;
  setPresentationContent: (content: PresentationContent | ((prev: PresentationContent) => PresentationContent)) => void;
  fogSettings: FogSettings;
  setFogSettings: (settings: FogSettings | ((prev: FogSettings) => FogSettings)) => void;
  gridEnabled: boolean;
  setGridEnabled: (enabled: boolean) => void;
  axisIndicatorEnabled: boolean;
  setAxisIndicatorEnabled: (enabled: boolean) => void;
  miniAxisIndicatorEnabled: boolean;
  setMiniAxisIndicatorEnabled: (enabled: boolean) => void;
  floorEnabled: boolean;
  setFloorEnabled: (enabled: boolean) => void;
  fpsCounterEnabled: boolean;
  setFpsCounterEnabled: (enabled: boolean) => void;
  walkModePhase: WalkModePhase;
  /** Style and size the fence tool uses for the next fence. */
  fenceToolSettings: FenceToolSettings;
  setFenceToolSettings: (settings: FenceToolSettings) => void;
  waterToolSettings: WaterToolSettings;
  setWaterToolSettings: (settings: WaterToolSettings) => void;
  patioToolSettings: PatioToolSettings;
  setPatioToolSettings: (settings: PatioToolSettings | ((prev: PatioToolSettings) => PatioToolSettings)) => void;
  setWalkModePhase: (phase: WalkModePhase) => void;
  walkMovementSpeed: number;
  setWalkMovementSpeed: (speed: number) => void;
  walkMouseSensitivity: number;
  setWalkMouseSensitivity: (sensitivity: number) => void;
  /** Shared, non-reactive channel between WalkModeController (inside the R3F Canvas) and WalkModeOverlay (a plain DOM sibling) - see WalkBridge's own doc comment. */
  walkBridgeRef: { current: import('./lib/walkMode/inputState').WalkBridge };
  skyboxBlur: number;
  setSkyboxBlur: (blur: number) => void;
  environmentIntensity: number;
  setEnvironmentIntensity: (intensity: number) => void;
  skyboxRotation: number;
  setSkyboxRotation: (rotation: number) => void;
  rightPanelVisible: boolean;
  setRightPanelVisible: (visible: boolean) => void;
  floorColor: string;
  setFloorColor: (color: string) => void;
  toolbarVisibility: Record<string, boolean>;
  setToolbarVisibility: (visibility: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  panelVisibility: Record<string, boolean>;
  setPanelVisibility: (visibility: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  contextMenu: { x: number, y: number, type: 'surface' | 'multi' | 'light' | 'kernel', data?: any, faceId?: any } | null;
  setContextMenu: (menu: { x: number, y: number, type: 'surface' | 'multi' | 'light' | 'kernel', data?: any, faceId?: any } | null) => void;
  undo: () => void;
  redo: () => void;
  /** Adds a line to the action recording; `options.sdk` offers a readable command for the step (see macroVerify.ts). */
  recordAction: (code: string, options?: { sdk?: string; unchecked?: boolean }) => void;
  // Developer Suite
  isDeveloperConsoleOpen: boolean;
  setIsDeveloperConsoleOpen: (open: boolean) => void;
  activeDeveloperTab: 'console' | 'library' | 'docs' | 'fullDocs' | 'settings' | 'spec';
  setActiveDeveloperTab: (tab: 'console' | 'library' | 'docs' | 'fullDocs' | 'settings' | 'spec') => void;
  developerScripts: DeveloperScript[];
  setDeveloperScripts: (scripts: DeveloperScript[] | ((prev: DeveloperScript[]) => DeveloperScript[])) => void;
  consoleOutput: string[];
  setConsoleOutput: (output: string[] | ((prev: string[]) => string[])) => void;
  developerCode: string;
  setDeveloperCode: (code: string) => void;
  developerSuiteWidth: number;
  setDeveloperSuiteWidth: (width: number) => void;
  isDeveloperSuiteCollapsed: boolean;
  setIsDeveloperSuiteCollapsed: (collapsed: boolean) => void;
  pinnedScripts: string[];
  setPinnedScripts: (ids: string[] | ((prev: string[]) => string[])) => void;
  customToolbars: CustomToolbarDef[];
  setCustomToolbars: React.Dispatch<React.SetStateAction<CustomToolbarDef[]>>;
  basicToolbarExtensions: CustomToolbarItem[];
  setBasicToolbarExtensions: React.Dispatch<React.SetStateAction<CustomToolbarItem[]>>;
  refreshScripts: () => void;
  refreshMaterials: () => void;
  // Code Recorder
  codeRecorderEnabled: boolean;
  setCodeRecorderEnabled: (enabled: boolean) => void;
  isRecording: boolean;
  setIsRecording: (recording: boolean) => void;
  recordedCode: string;
  setRecordedCode: (code: string | ((prev: string) => string)) => void;
  isChangelogOpen: boolean;
  setIsChangelogOpen: (open: boolean) => void;
  // Units
  unit: 'mm' | 'cm' | 'm';
  setUnit: (unit: 'mm' | 'cm' | 'm') => void;
  showCollaboratorCursors: boolean;
  setShowCollaboratorCursors: (show: boolean) => void;
  // Messaging
  isMessagingOpen: boolean;
  setIsMessagingOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  isMessagingCollapsed: boolean;
  setIsMessagingCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  isMessagingDocked: boolean;
  setIsMessagingDocked: (docked: boolean | ((prev: boolean) => boolean)) => void;
  // Tool settings
  activeBevelAmount: number;
  setActiveBevelAmount: (amount: number | ((prev: number) => number)) => void;
  contactFrictionEnabled: boolean;
  setContactFrictionEnabled: (enabled: boolean) => void;
  contactFrictionStrength: number;
  setContactFrictionStrength: (strength: number) => void;
  isToolModifierDocked: boolean;
  setIsToolModifierDocked: (docked: boolean | ((prev: boolean) => boolean)) => void;
  // WorldView
  // AI Generate
  isAIGenerateOpen: boolean;
  setIsAIGenerateOpen: (open: boolean) => void;
  // Orbit
  autoOrbitEnabled: boolean;
  setAutoOrbitEnabled: (enabled: boolean) => void;
  orbitRotationSpeed: number;
  setOrbitRotationSpeed: (speed: number) => void;
  worldViewLocation: { lat: number, lng: number, address?: string };
  setWorldViewLocation: (loc: { lat: number, lng: number, address?: string }) => void;
  worldViewAltitude: number;
  setWorldViewAltitude: (alt: number) => void;
  worldViewRadius: number;
  worldViewGoogle: boolean;
  setWorldViewGoogle: (on: boolean) => void;
  worldViewGoogleNudge: number;
  setWorldViewGoogleNudge: (metres: number) => void;
  setWorldViewRadius: (radius: number) => void;
  worldViewMapType: 'satellite' | '3d';
  setWorldViewMapType: (type: 'satellite' | '3d') => void;
  googleMapsApiKey: string;
  setGoogleMapsApiKey: (key: string) => void;
  isWorldViewActive: boolean;
  setIsWorldViewActive: (active: boolean) => void;
  focusOnMapTrigger: number;
  triggerFocusOnMap: () => void;
  // Service Worker
  swReady: boolean;
  setSwReady: (ready: boolean) => void;
  animations: SceneAnimation[];
  setAnimations: (animations: SceneAnimation[] | ((prev: SceneAnimation[]) => SceneAnimation[])) => void;
  placingAnimationId: string | null;
  setPlacingAnimationId: (id: string | null) => void;
  // Notes
  notes: SceneNote[];
  setNotes: (notes: SceneNote[] | ((prev: SceneNote[]) => SceneNote[])) => void;
  placingNoteId: string | null;
  setPlacingNoteId: (id: string | null) => void;
  allNotesVisible: boolean;
  setAllNotesVisible: (visible: boolean) => void;
  /** Guide lines (Tape Measure and Protractor) shown and snapped to. */
  guidesVisible: boolean;
  setGuidesVisible: (visible: boolean) => void;
  // Camera Defaults
  defaultCameraPosition: [number, number, number];
  setDefaultCameraPosition: (pos: [number, number, number]) => void;
  defaultCameraTarget: [number, number, number];
  setDefaultCameraTarget: (target: [number, number, number]) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  // Collaboration
  isCollaborationOpen: boolean;
  setIsCollaborationOpen: (open: boolean) => void;
  collaborators: Collaborator[];
  setCollaborators: (collabs: Collaborator[] | ((prev: Collaborator[]) => Collaborator[])) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  // Deformation
  deformationSettings: {
    radius: number;
    density: number;
    direction: 'outward' | 'inward' | 'both';
    strength: number;
  };
  setDeformationSettings: (settings: any) => void;
  // Subtract
  subtractCutterId: string | null;
  setSubtractCutterId: (id: string | null) => void;
  subtractTargetId: string | null;
  setSubtractTargetId: (id: string | null) => void;
  // Rectangle Input Mode
  rectangleInputState: {
    active: boolean;
    startPoint: { x: number, y: number, z: number } | null;
    normal?: { x: number, y: number, z: number } | null;
    width: string;
    depth: string;
  };
  setRectangleInputState: (state: any | ((prev: any) => any)) => void;
  syncStatus: 'synced' | 'syncing' | 'error' | 'offline' | 'unsaved';
  syncErrorMessage: string | null;
  retrySync: () => void;
  isDiagnosticLogOpen: boolean;
  setIsDiagnosticLogOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  isLoginActivityOpen: boolean;
  setIsLoginActivityOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  lastInteractionData: any;
  setLastInteractionData: (data: any) => void;
  // Embedded Webpage
  embeddedWebpageUrl: string | null;
  setEmbeddedWebpageUrl: (url: string | null) => void;
  // Live Diagnostic Logs
  diagnosticLogs: DiagLogEntry[];
  diagLog: (category: string, message: string, values?: Record<string, unknown>) => void;
  clearDiagnosticLogs: () => void;
  totalReads: number;
  incrementReads: (count: number) => void;
  quotaLockdownTime: number;
  isQuotaLocked: () => boolean;
  // Architecture & Landscapes Toolbars & Edge Lines
  isBasicToolbarEnabled: boolean;
  setIsBasicToolbarEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
  isArchitectureToolbarEnabled: boolean;
  setIsArchitectureToolbarEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
  isLandscapesToolbarEnabled: boolean;
  setIsLandscapesToolbarEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
  isAIToolbarEnabled: boolean;
  setIsAIToolbarEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
  isCameraToolbarEnabled: boolean;
  setIsCameraToolbarEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
  layoutMode: 'classic' | 'unified';
  setLayoutMode: (mode: 'classic' | 'unified' | ((prev: 'classic' | 'unified') => 'classic' | 'unified')) => void;
  landscapeSculptSettings: {
    mode: 'push' | 'pull' | 'smooth' | 'flatten' | 'pinch';
    radius: number;
    intensity: number;
    masked: boolean;
  };
  setLandscapeSculptSettings: (settings: any | ((prev: any) => any)) => void;
  landscapeRoadSettings: {
    width: number;
    embankment: boolean;
    roadColor: string;
    curbHeight: number;
  };
  setLandscapeRoadSettings: (settings: any | ((prev: any) => any)) => void;
  edgeLinesEnabled: boolean;
  setEdgeLinesEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
  edgeLinesColor: string;
  setEdgeLinesColor: (color: string) => void;
  edgeLinesOpacity: number;
  setEdgeLinesOpacity: (opacity: number) => void;
  edgeLinesThickness: number;
  setEdgeLinesThickness: (thickness: number) => void;
  showAllDimensions: boolean;
  setShowAllDimensions: (show: boolean | ((prev: boolean) => boolean)) => void;
  // Plant Library & Species Selection
  activePlantSpecies: string;
  setActivePlantSpecies: (speciesId: string) => void;
  activePlantVariation: string;
  setActivePlantVariation: (variation: string) => void;
  activePlantScale: number;
  setActivePlantScale: (scale: number) => void;
  // Scale Figures & Human Benchmark
  activeScaleFigureCharacter: string;
  setActiveScaleFigureCharacter: (charId: string) => void;
  activeScaleFigureHeight: number;
  setActiveScaleFigureHeight: (height: number) => void;

  // Architecture & Wall Tool Engine
  wallToolSettings: import('./tools/inference/types').WallToolSettings;
  setWallToolSettings: (settings: import('./tools/inference/types').WallToolSettings | ((prev: import('./tools/inference/types').WallToolSettings) => import('./tools/inference/types').WallToolSettings)) => void;
  wallJustification: import('./tools/inference/types').WallJustification;
  setWallJustification: (j: import('./tools/inference/types').WallJustification | ((prev: import('./tools/inference/types').WallJustification) => import('./tools/inference/types').WallJustification)) => void;
  activeStory: number;
  setActiveStory: (story: number | ((prev: number) => number)) => void;
  roofModalTargetIds: string[] | null;
  setRoofModalTargetIds: (ids: string[] | null) => void;
  storyPromptTargetIds: string[] | null;
  setStoryPromptTargetIds: (ids: string[] | null) => void;

  // --- Geometry kernel (coexists with Shape[]; see docs/) ---
  // The kernel owns DRAWN geometry: lines, arcs, rectangles, polygons.
  // Shape[] keeps primitives, plants and terrain. A given object lives in
  // exactly one of the two.
  kernelHost: KernelArcHost;
  /**
   * Bumped on every kernel mutation. The kernel Graph is mutated IN PLACE,
   * so React's identity check on it never fires; without this the screen
   * silently stops matching the model.
   */
  kernelRevision: number;
  bumpKernel: () => void;
  /** Selected kernel faces. Separate from selectedIds, which holds Shape ids. */
  selectedFaceIds: number[];
  setSelectedFaceIds: (ids: number[] | ((prev: number[]) => number[])) => void;
  // Fields below were added to the actual context (AppContext.tsx) at
  // various points but never reflected here — a real type-drift gap,
  // not new functionality. Types match AppContext.tsx's own useState/
  // wrapper-function declarations exactly.
  viewportToast: string | null;
  setViewportToast: (msg: string | null | ((current: string | null) => string | null)) => void;
  placingNotePos: THREE.Vector3 | null;
  setPlacingNotePos: (pos: THREE.Vector3 | null) => void;
  sunOrbitCenter: [number, number, number];
  setSunOrbitCenter: (pos: [number, number, number]) => void;
  pickingSunCenter: boolean;
  setPickingSunCenter: (picking: boolean) => void;
  kernelSubtractTarget: FaceId[] | null;
  setKernelSubtractTarget: (target: FaceId[] | null) => void;
  selectionShapeMode: 'lasso' | 'marquee';
  setSelectionShapeMode: (mode: 'lasso' | 'marquee' | ((prev: 'lasso' | 'marquee') => 'lasso' | 'marquee')) => void;
  selectionFilter: 'all' | 'shapes' | 'surfaces';
  setSelectionFilter: (filter: 'all' | 'shapes' | 'surfaces' | ((prev: 'all' | 'shapes' | 'surfaces') => 'all' | 'shapes' | 'surfaces')) => void;
  selectionCriteria: 'crossing' | 'window';
  setSelectionCriteria: (criteria: 'crossing' | 'window' | ((prev: 'crossing' | 'window') => 'crossing' | 'window')) => void;
  toolbarOrder: ToolbarKey[];
  setToolbarOrder: (val: ToolbarKey[] | ((prev: ToolbarKey[]) => ToolbarKey[])) => void;
  toolbarDocks: Record<ToolbarKey, DockZone>;
  setToolbarDocks: (
    val: Record<ToolbarKey, DockZone> | ((prev: Record<ToolbarKey, DockZone>) => Record<ToolbarKey, DockZone>),
  ) => void;
  /** Which lane of its dock each classic toolbar sits in; toolbars sharing a lane stack. */
  toolbarLanes: Record<ToolbarKey, number>;
  /** Sets order, docks and lanes together (one saved layout). */
  setToolbarLayout: (layout: import('./lib/toolbarLayout').ToolbarLayout) => void;
  /** Classic toolbars show drag grips and can be moved only while this is on (default off). */
  isToolbarEditMode: boolean;
  setIsToolbarEditMode: (val: boolean | ((prev: boolean) => boolean)) => void;
  // Timber Frame Parametric State & Scoped Recompute
  timberFrameParams: TimberFrameParams;
  setTimberFrameParams: (params: TimberFrameParams | ((prev: TimberFrameParams) => TimberFrameParams)) => void;
  timberFrameRecomputeState: TimberFrameRecomputeState;
  setTimberFrameRecomputeState: (state: TimberFrameRecomputeState | ((prev: TimberFrameRecomputeState) => TimberFrameRecomputeState)) => void;
  scheduleScopedTimberRecompute: (affectedIds: string[]) => void;
  commitUpdatedFraming: (candidateShapes?: Shape[]) => void;
  // Camera Depth Clipping (Near and Far Clipping Planes)
  cameraDepthClippingEnabled: boolean;
  setCameraDepthClippingEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
  cameraNear: number;
  setCameraNear: (near: number | ((prev: number) => number)) => void;
  cameraFar: number;
  setCameraFar: (far: number | ((prev: number) => number)) => void;
  // Wall & Roof Transparency in Architecture Visualization
  wallTransparency: number;
  setWallTransparency: (val: number | ((prev: number) => number)) => void;
  exteriorWallTransparency: number;
  setExteriorWallTransparency: (val: number | ((prev: number) => number)) => void;
  interiorWallTransparency: number;
  setInteriorWallTransparency: (val: number | ((prev: number) => number)) => void;
  roofTransparency: number;
  setRoofTransparency: (val: number | ((prev: number) => number)) => void;
  floorTransparency: number;
  setFloorTransparency: (val: number | ((prev: number) => number)) => void;
  fixturesTransparency: number;
  setFixturesTransparency: (val: number | ((prev: number) => number)) => void;
  // Civil Toolset & Terrain Studio
  terrainModifiers: TerrainModifier[];
  setTerrainModifiers: React.Dispatch<React.SetStateAction<TerrainModifier[]>>;
  selectedModifierId: string | null;
  setSelectedModifierId: (id: string | null) => void;
  isBakeModalOpen: boolean;
  setIsBakeModalOpen: (open: boolean) => void;
  civilRoadSettings: {
    width: number;
    maxGradePercent: number;
    hasCurb: boolean;
    hasDitch: boolean;
    curbWidth: number;
    curbHeight: number;
    ditchWidth: number;
    ditchDepth: number;
    markings: RoadMarkingPreset;
    material?: string;
  };
  setCivilRoadSettings: React.Dispatch<React.SetStateAction<{
    width: number;
    maxGradePercent: number;
    hasCurb: boolean;
    hasDitch: boolean;
    curbWidth: number;
    curbHeight: number;
    ditchWidth: number;
    ditchDepth: number;
    markings: RoadMarkingPreset;
    material?: string;
  }>>;
  civilPadSettings: {
    primitive: PadPrimitiveType;
    batterDistance: number;
    batterProfile: BatterFalloffType;
    targetElevation: number;
    dimensions: [number, number];
  };
  setCivilPadSettings: React.Dispatch<React.SetStateAction<{
    primitive: PadPrimitiveType;
    batterDistance: number;
    batterProfile: BatterFalloffType;
    targetElevation: number;
    dimensions: [number, number];
  }>>;
  civilStripingSettings: {
    angle: ParkingAngle;
    stallWidth: number;
    stallDepth: number;
    stripeColor: string;
    doubleRow: boolean;
  };
  setCivilStripingSettings: React.Dispatch<React.SetStateAction<{
    angle: ParkingAngle;
    stallWidth: number;
    stallDepth: number;
    stripeColor: string;
    doubleRow: boolean;
  }>>;
  activeCivilGrade: number | null;
  setActiveCivilGrade: (grade: number | null) => void;
  cutFillMetrics: CutFillMetrics;
  setCutFillMetrics: (metrics: CutFillMetrics | ((prev: CutFillMetrics) => CutFillMetrics)) => void;
  showCutFillOverlay: boolean;
  setShowCutFillOverlay: React.Dispatch<React.SetStateAction<boolean>>;
  activeSplineDraft: [number, number, number][];
  setActiveSplineDraft: React.Dispatch<React.SetStateAction<[number, number, number][]>>;
  activePadDraft: { center: [number, number, number]; dimensions: [number, number]; primitive: 'rectangle' | 'circle' } | null;
  setActivePadDraft: React.Dispatch<React.SetStateAction<{ center: [number, number, number]; dimensions: [number, number]; primitive: 'rectangle' | 'circle' } | null>>;
  addTerrainModifier: (mod: TerrainModifier) => void;
  updateTerrainModifier: (id: string, updates: Partial<TerrainModifier>) => void;
  removeTerrainModifier: (id: string) => void;
  reorderTerrainModifiers: (sourceIndex: number, destIndex: number) => void;
  bakeTerrainModifiers: (mode: 'mesh' | 'glb' | 'obj') => Promise<void>;
}

export interface DiagLogEntry {
  time: string;        // HH:MM:SS.mmm
  category: string;    // e.g. "TEXTURE", "FRAME", "STATE", "EVENT"
  message: string;
  values?: Record<string, unknown>;
}

export interface DeveloperScript {
  id: string;
  userId: string;
  userName?: string;
  name: string;
  code: string;
  createdAt: string;
  pinned: boolean;
  isPublic?: boolean;
}

export interface SavedModel {
  graphicsSettings?: GraphicsSettings;
  assetSchemaVersion?: 1;
  assetCatalogRelease?: string;
  environment?: EnvironmentState;
  materialBindings?: Record<string, MaterialInstance>;
  id: string;
  userId: string;
  userName?: string;
  name: string;
  shapes: Shape[];
  tags: Tag[];
  scenes: SceneState[];
  customMaterials: any[];
  animations?: SceneAnimation[];
  notes?: SceneNote[];
  presentationContent?: PresentationContent;
  terrainModifiers?: TerrainModifier[];
  previewUrl?: string;
  createdAt: any;
  updatedAt: any;
  isPublic?: boolean;
  hasPassword?: boolean;
}

// =============================================================================
// Reactive Timber Frame Engine Types
// =============================================================================

export interface TimberFrameParams {
  studSpacing: number;
  memberWidth: number;
  memberDepth: number;
  species: string;
  grade: string;
  headerDepthRule: string;
  revealDistance: number;
  advancedModeEnabled: boolean;
  offsetJoists?: boolean;
  offsetFloorJoists?: boolean;
  offsetWallJoists?: boolean;
  offsetFloorNoggins?: boolean;
  offsetWallNoggins?: boolean;
}

export type TimberMemberKind =
  | 'stud'
  | 'plate'
  | 'header'
  | 'sill'
  | 'jackStud'
  | 'rafter'
  | 'kingStud'
  | 'king Stud'
  | 'joist'
  | 'blocking';

export interface TimberMemberInstance {
  id: string;
  kind: TimberMemberKind;
  transformMatrix?: number[];
  position?: [number, number, number];
  rotation?: [number, number, number];
  quaternion?: [number, number, number, number];
  scale?: [number, number, number];
  parentWallOrRoofId: string;
  lengthMm: number;
}

export interface OpeningFrameAssembly {
  openingId: string;
  headerMemberIds: string[];
  sillMemberIds: string[] | null;
  jackStudMemberIds: string[];
  kingStudMemberIds: string[];
  isValid: boolean;
  validationMessages: string[];
  hostWallId?: string;
  headerDepth?: number;
  spanMm?: number;
  headerDepthMm?: number;
}

export type TimberFrameRecomputeStatus = 'idle' | 'pending' | 'computing' | 'stale' | 'error';

export interface TimberFrameRecomputeState {
  status: TimberFrameRecomputeStatus;
  state?: TimberFrameRecomputeStatus;
  affectedWallIds: string[];
  lastComputedAt: number | null;
}

export interface HeaderDepthBracket {
  maxOpeningWidth: number;
  minHeaderDepth: number;
  maxOpeningWidthMm?: number;
  minHeaderDepthMm?: number;
  description?: string;
}

export interface StructuralValidationRules {
  maxStudSpacing: number;
  maxStudSpacingMm?: number;
  headerDepthBrackets: HeaderDepthBracket[];
}

// -----------------------------------------------------------------------------
// Timber Frame System Specification Contracts (§0 - §10)
// -----------------------------------------------------------------------------

export interface ProjectMetadata {
  project_id: string;
  wind_zone: string;
  snow_load_kn_m2: number;
  seismic_category: string;
  exposure_category: string;
  species_grade_defaults: { species: string; grade: string };
}

export type LayerStackSide = 'exterior' | 'structural' | 'interior';

export interface LayerStackItem {
  name: string;
  thickness_mm: number;
  material: string;
  side: LayerStackSide;
}

export interface WallOpeningContract {
  id: string;
  type: 'window' | 'door' | 'skylight';
  bounding_box?: [number, number, number, number]; // [minX, minY, maxX, maxY]
  head_height: number;
  sill_height: number;
  width: number;
  rough_opening_tolerance_mm?: number;
}

export interface WallToolOutput {
  wall_id: string;
  project_id: string;
  centerline: [number, number, number][] | { points: [number, number, number][] };
  total_depth: number; // mm
  height: number; // mm
  layer_stack: LayerStackItem[];
  openings: WallOpeningContract[];
  corner_conditions?: Array<{ position: [number, number, number]; adjoining_wall_id: string; angle: number }>;
  bearing_points?: Array<{ position: [number, number, number]; load_source: string }>;
  gravity_load_kn_m?: number;
}

export interface RoofSurfaceOutput {
  face_ref?: string;
  pitch_deg: number;
  orientation: number | string;
}

export interface RoofPurlinContract {
  id: string;
  line: [number, number, number][];
  start?: [number, number, number];
  end?: [number, number, number];
  span_mm: number;
  bearing_wall_ids: string[];
}

export interface RoofVoidClearanceZone {
  boundary: [number, number, number][] | { min: [number, number, number]; max: [number, number, number] };
  boundary_box?: { minX: number; maxX: number; minZ: number; maxZ: number };
  reason: 'ventilation' | 'access' | 'tank' | 'room-in-roof-headroom';
}

export interface RoofToolOutput {
  roof_id: string;
  project_id: string;
  surfaces: RoofSurfaceOutput[];
  ridge_lines: [number, number, number][][];
  hip_lines: [number, number, number][][];
  valley_lines: [number, number, number][][];
  eave_lines: [number, number, number][][];
  verge_lines: [number, number, number][][];
  bearing_wall_ids: string[];
  span_data: Array<{ plane_id: string; clear_span_mm: number }>;
  layer_stack: LayerStackItem[];
  total_depth?: number;
  purlins?: RoofPurlinContract[];
  roof_void_clearance_zones?: RoofVoidClearanceZone[];
}

export interface FloorLayerStackItem {
  name: string;
  thickness_mm: number;
  material: string;
  side: 'above' | 'structural' | 'below';
  structural_contribution?: boolean;
  structural_zone?: boolean;
}

export interface StairGeometry {
  pitch_angle_deg: number;
  going_mm?: number;
  rise_mm?: number;
  number_of_risers?: number;
  flight_width_mm?: number;
  travel_direction?: [number, number, number];
  headroom_min_mm: number;
  riser_height_mm?: number;
  tread_going_mm?: number;
}

export interface FloorOpeningContract {
  id: string;
  type: 'duct' | 'flue' | 'hearth' | 'stairwell';
  bounding_box?: [number, number, number, number]; // [minX, minZ, maxX, maxZ]
  rough_opening_tolerance_mm?: number;
  stairwell_id?: string;
  opening_boundary?: [number, number][]; // 2D plan boundary polygon
  boundary?: [number, number][];
  stair_geometry?: StairGeometry;
}

export interface FloorToolOutput {
  floor_id: string;
  project_id: string;
  boundary: [number, number, number][]; // plan polygon 3D
  span_direction: [number, number, number]; // primary joist direction - mandatory input, not inferred
  total_depth: number; // mm
  layer_stack: FloorLayerStackItem[];
  openings: FloorOpeningContract[];
  supporting_wall_ids_below: string[];
  supporting_wall_ids_above: string[];
  imposed_load_kn_m2: number;
  dead_load_kn_m2?: number;
  deflection_limit: string; // e.g. "L/360", "L/480"
  vibration_criteria?: string;
}

export type IfcTimberClass = 'IfcColumn' | 'IfcBeam' | 'IfcMember' | 'IfcPlate';

export interface GenerationParamsSnapshot {
  structural_zone_depth_mm: number;
  frame_depth_mm: number;
  spacing_mm: number;
  load_case: {
    gravity_load_kn_m: number;
    wind_zone: string;
    snow_load_kn_m2: number;
    seismic_category: string;
    exposure_category?: string;
  };
  species?: string;
  grade?: string;
  timestamp?: number;
}

export interface TimberMemberData {
  id: string;
  ifcClass: IfcTimberClass;
  is_user_modified: boolean;
  generation_params_snapshot: GenerationParamsSnapshot;
  hardwareSku?: string;
  cutLengthMm?: number;
}

export interface JointLibraryEntry {
  connection_type: 'hanger' | 'bracket' | 'toe-nail' | 'birdsmouth' | 'rafter-tie' | 'corner-bracket';
  hardware_geometry?: { type: string; dimensions: [number, number, number]; position: [number, number, number] };
  hardware_sku: string;
  clearance_mm: number;
  description: string;
}

export interface BOMLine {
  species: string;
  grade: string;
  cross_section: string; // e.g. "38x140"
  cut_list: Array<{ length_mm: number; angle_notes?: string; member_id: string }>;
  stock_length_mm: number;
  stock_quantity_required: number;
  total_waste_pct: number;
}

export interface BOMHardwareLine {
  sku: string;
  description: string;
  quantity: number;
}

export interface TimberBOM {
  lines: BOMLine[];
  hardware: BOMHardwareLine[];
  totalTimberLinearMeters: number;
  totalTimberVolumeM3: number;
}

export interface TimberValidationResult {
  coplanarity_valid: boolean;
  containment_valid: boolean;
  load_valid: boolean;
  load_path_valid: boolean;
  clash_valid: boolean;
  override_conflict_valid: boolean;
  service_zone_valid?: boolean;
  headroom_valid?: boolean;
  stairwell_alignment_valid?: boolean;
  diaphragm_valid?: boolean;
  ventilation_continuity_valid?: boolean;
  roof_void_clearance_valid?: boolean;
  errors: string[];
  warnings: string[];
}

export interface TimberGenerationReport {
  wall_id?: string;
  roof_id?: string;
  floor_id?: string;
  structural_zone_depth_mm: number;
  frame_depth_mm: number;
  clamped_depths: string[];
  flagged_spans: string[];
  deferred_clashes: string[];
  inserted_intermediate_posts: string[];
  bom: TimberBOM;
  validation: TimberValidationResult;
  summary: string;
  conflicts?: string[];
}

export type CustomToolbarWidgetType = 'button' | 'slider' | 'checkbox' | 'color-swatch' | 'tabs' | 'label' | 'section';

export interface CustomToolbarItem {
  id: string;
  label: string;
  type?: CustomToolbarWidgetType; // Defaults to 'button' when omitted, for backwards compatibility
  icon?: string; // Lucide icon name (e.g. 'Home', 'Hammer', 'TreePine', 'Sparkles'), emoji, or text
  tooltip?: string;
  color?: string;
  badge?: string;
  hotkey?: string;
  code?: string; // JavaScript code to execute. For non-button widgets, the new value is in scope as `value`.
  scriptId?: string; // Reference to existing saved script
  // Runs when the pointer hovers the button (before any click), so a
  // button can compute fresh info to show in a formatted popout rather
  // than requiring a click. Typically ends with a call to
  // sdk.toolbars.configureButton(toolbarId, itemId, { previewContent }).
  hoverCode?: string;
  // Multi-line formatted text (newlines preserved) shown in a popout
  // panel while hovering - set directly, or refreshed live via hoverCode.
  previewContent?: string;
  action?: (sdk: any) => void | Promise<void>; // In-memory callback function
  variant?: 'default' | 'tile'; // 'tile' renders a larger icon-over-label button, for grid-style pickers
  description?: string; // Small helper text rendered under the control
  previewGeometry?: { positions: number[]; normals: number[]; uvs?: number[] }; // 'tile' variant: renders a real 3D thumbnail of this geometry instead of a flat color swatch

  // type: 'slider'
  value?: number;
  min?: number;
  max?: number;
  step?: number;

  // type: 'checkbox'
  checked?: boolean;

  // type: 'color-swatch'
  colors?: string[];
  selectedColor?: string;
  allowCustomColor?: boolean;

  // type: 'tabs'
  options?: string[];
  selected?: string;

  // type: 'section' (collapsible group of nested items)
  items?: CustomToolbarItem[];
  collapsed?: boolean;
}

export interface CustomToolbarDef {
  id: string;
  title: string;
  position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'floating' | 'dock-left' | 'dock-top' | 'dock-bottom';
  orientation?: 'horizontal' | 'vertical';
  items: CustomToolbarItem[];
  closable?: boolean;
  collapsed?: boolean;
  floatPosition?: { x: number; y: number };
}

export type CustomToolbarButton = CustomToolbarItem;
export type CustomToolbarConfig = CustomToolbarDef & {
  buttons?: CustomToolbarItem[];
};

// =============================================================================
// PolyForm Terrain Studio - Civil Objects & Modifiers
// =============================================================================

export type TerrainModifierType = 'pad' | 'road' | 'surface';
export type PadPrimitiveType = 'rectangle' | 'circle';
export type BatterFalloffType = 'linear' | 'curved' | 'stepped';

export interface CurbDitchProfile {
  width: number;
  height: number;
  ditchWidth: number;
  ditchDepth: number;
  hasCurb: boolean;
  hasDitch: boolean;
}

export type RoadMarkingPreset = 'none' | 'center-dashed' | 'center-solid' | 'bike-lanes' | 'pedestrian-walkway';

export type ParkingAngle = 0 | 30 | 45 | 60 | 90;

export interface ParkingStallConfig {
  angle: ParkingAngle;
  stallWidth: number;
  stallDepth: number;
  stripeColor: string;
  doubleRow: boolean;
}

export interface CutFillMetrics {
  cutVolumeM3: number;
  fillVolumeM3: number;
  netVolumeM3: number;
  cutAreaM2: number;
  fillAreaM2: number;
}

export interface SurfaceModifier {
  id: string;
  name: string;
  type: 'surface';
  enabled: boolean;
  hostPadId: string;
  pattern: 'parking-striping' | 'hatch' | 'asphalt' | 'gravel';
  parkingConfig?: ParkingStallConfig;
}

export interface PadModifier {
  id: string;
  name: string;
  type: 'pad';
  enabled: boolean;
  primitive: PadPrimitiveType;
  center: [number, number, number];
  dimensions: [number, number];
  rotationY: number;
  targetElevation: number;
  batterDistance: number;
  batterProfile: BatterFalloffType;
  surfaceModifier?: SurfaceModifier;
}

export interface RoadModifier {
  id: string;
  name: string;
  type: 'road';
  enabled: boolean;
  points: Array<[number, number, number]>;
  width: number;
  maxGradePercent: number;
  bankingAngle: number;
  profile: CurbDitchProfile;
  markings: RoadMarkingPreset;
  material?: string;
  batterDistance?: number;
}

export type TerrainModifier = PadModifier | RoadModifier | SurfaceModifier;

/**
 * Walk Mode's session state machine (see the Walk Mode spec §5.1):
 * 'inactive' - the tool isn't active at all.
 * 'preparing' - the collision BVH is being built (only shown if it takes > 150ms).
 * 'placing' - waiting for a click/tap on a valid floor/stair/ground spot to start walking.
 * 'walking' - first-person, pointer locked (desktop) or touch-controlled.
 * 'paused' - pointer lock was lost by accident (alt-tab, etc.) - "click to resume".
 */
export type WalkModePhase = 'inactive' | 'preparing' | 'placing' | 'walking' | 'paused';





export interface WaterToolSettings {
  depth: number;
  clarity: WaterClarity;
}

export interface FenceToolSettings {
  style: FenceStyle;
  height: number;
  finish: WoodFinish;
  color: string;
}
