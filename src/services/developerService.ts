import * as THREE from 'three';
import { Shape, TextData, WorldSiteInfo, SiteBuildingData, SiteRoute, StreetLifeLevel, CustomToolbarDef, CustomToolbarItem, CustomToolbarButton, CustomToolbarConfig, type TerrainModifier, type RoadModifier, type PadModifier, type SurfaceModifier, type CurbDitchProfile, type RoadMarkingPreset, type BatterFalloffType, type PadPrimitiveType, type ParkingStallConfig, type TimberFrameParams } from '../types';
import { getBlockPart, buildBlockGeometry, BLOCK_CATALOG } from '../lib/blockKitGeometry';
import { normalizeGraphicsSettings, type GraphicsSettings } from '../lib/graphics/graphicsSettings';
import type { KernelArcHost } from '../tools/kernelArcHost';
import { roofBuilding, type RoofTileLook } from '../lib/buildingRoofs';
import { buildRoomAssembly } from '../lib/archRoomAssembly';
import { createScaleFigureGeometry, SCALE_FIGURE_CHARACTERS } from '../lib/scaleFigureGeometry';
import { checkStairPlacement, type StairPlacement } from '../lib/stairPlacement';
import { makeGuideArgs, isGuideShape } from '../tools/tapeGuides';
import type { ProtractorArgs } from '../components/ProtractorTool';
import { withShapeIds } from '../lib/shapeIds';
import { buildTextShape, editTextShape, type TextOptions } from '../lib/textShapes';
import { buildFence, buildPatio, buildWaterBody, type FenceOptions, type PatioOptions, type PondOptions } from '../lib/siteBuilders';
import { commitKernelPushPull } from '../tools/kernelPushPull';
import { commitKernelFaceOffset } from '../tools/kernelFaceOffset';
import { commitKernelFollowMe, pathFromEdge, pathFromFace, type FollowMePath } from '../tools/kernelFollowMe';
import { createChamferBinding } from '../tools/kernelChamfer';
import { createFilletBinding } from '../tools/kernelFillet';
import { applyBoolean, orderedShapeGroups, planBoolean, type BooleanOp } from '../tools/kernelBoolean';
import { makeDimensionArgs, measureFace, type AreaLabelArgs, type LeaderArgs } from '../tools/annotations';
import { flipSection, moveSection, isSectionShape, withLayerCut, type SectionArgs } from '../tools/sectionPlanes';
import { commitBezierSurface, type BezierKnotInput } from '../tools/bezier/bezierSurface';
import { deleteGroupFacesAndEdges, paintFaces, faceSummaries } from '../tools/kernelSelection';
import { applyKernelPatch, type KernelPatch } from '../lib/geometry/graphPatch';
import { DEFAULT_SEGMENTS } from '../lib/geometry/curve';
import type { EdgeId, FaceId, Vec3 } from '../lib/geometry/types';
import { buildSite, findSiteGround, replaceSite, type SiteIO } from '../lib/worldSite/site';
import { browserSiteIO, findPlace } from '../lib/worldSite/fetchSite';
import { removedBuildings, shapeFromSnapshot, withBuildingHeight } from '../lib/worldSite/buildings';
import { clampSiteSize } from '../lib/worldSite/geo';
import { STREET_LIFE_LEVELS, withDrawnRoute, withoutRoutes } from '../lib/worldSite/streets';
import { applyAutoStreetLights } from '../lib/worldSite/streetLights';
import { perfStore, runToMarkdown, type PerfRun, type PerfState } from '../lib/perf/profilerStore';

export interface RoofConfigDefaults {
  roofType?: RoofType;
  pitchAngleDeg?: number;
  ridgeHeight?: number;
  eaveOverhang?: number;
  fasciaHeight?: number;
  soffitDepth?: number;
  roofThickness?: number;
  parapetHeight?: number;
  parapetThickness?: number;
  tileShape?: RoofTileShape;
  tileSize?: number;
  tileColor?: string;
  color?: string;
  fasciaColor?: string;
  ridgeCapColor?: string;
  soffitColor?: string;
  pedimentColor?: string;
  copingColor?: string;
  randomizeColor?: boolean;
  colorPalette?: string[];
  gableWalls?: boolean;
}

export interface StairsConfigDefaults {
  style?: StairStyleType;
  structure?: StairStructureType;
  railing?: RailingModeType;
  width?: number;
  height?: number;
  length?: number;
  numSteps?: number;
  idealStepHeight?: number;
  strideConstant?: number;
  isParametric?: boolean;
  handrailHeight?: number;
  stringerWidth?: number;
  treadThickness?: number;
  nosing?: number;
  color?: string;
  railingColor?: string;
}

export interface TimberFramingConfigDefaults {
  studSpacing?: number;
  studWidth?: number;
  studDepth?: number;
  joistSpacing?: number;
  joistDepth?: number;
  rafterSpacing?: number;
  rafterDepth?: number;
  species?: string;
  timberColor?: string;
  includeWalls?: boolean;
  includeFloors?: boolean;
  includeRoof?: boolean;
  blocking?: boolean;
}

export interface WallConfigDefaults {
  thickness?: number;
  height?: number;
  justification?: 'center' | 'left' | 'right' | 'exterior' | 'interior';
  color?: string;
  miterWalls?: boolean;
  snapToGrid?: boolean;
  transparency?: { overall?: number; exterior?: number; interior?: number };
}

export interface DoorConfigDefaults {
  width?: number;
  height?: number;
  depth?: number;
  frameThickness?: number;
  color?: string;
  panelColor?: string;
}

export interface WindowConfigDefaults {
  width?: number;
  height?: number;
  depth?: number;
  sillHeight?: number;
  panes?: number;
  frameColor?: string;
  glassColor?: string;
  glassOpacity?: number;
}

export interface LandscapeConfigDefaults {
  defaultSpecies?: string;
  defaultScale?: number;
  scaleVariance?: number;
  defaultTerrainTexture?: string;
  furnitureColor?: string;
}

export interface MeasurementConfigDefaults {
  unit?: 'm' | 'cm' | 'mm';
  precision?: number;
  lineColor?: string;
  textColor?: string;
  fontSize?: number;
  showUnits?: boolean;
  arrowheads?: 'arrows' | 'ticks' | 'dots' | 'slash';
}

export interface MaterialConfigDefaults {
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  wireframe?: boolean;
}
import {
  createDetailedGableRoofGeometry,
  createDetailedHipRoofGeometry,
  createParapetWallsGeometry,
  create3DRoofTilesGeometry,
  RoofType,
  updateRoofAssembly,
  RoofAssemblyUpdateParams,
  type RoofParams,
} from '../lib/archRoofGenerator';
import { RoofTileShape } from '../lib/roofTileGenerator';
import {
  createArchitecturalStaircaseGeometry,
  StairStyleType,
  StairStructureType,
  RailingModeType,
  } from '../lib/archStairGenerator';
import {
  createTreeGeometry,
  createBushGeometry,
  createFenceGeometry,
  createRailingGeometry,
  createLampGeometry,
  createBenchGeometry,
  createRockGeometry,
} from '../lib/landscapeGeometry';
import {
  createInteriorFurnitureShape,
  interiorFurnitureCatalog,
  type InteriorFurnitureType,
  type FurnitureParams,
} from '../lib/interiors/parametricFurniture';
import {
  planRoomFurnishing,
  type FurnishingPreset,
} from '../lib/interiors/smartFurnish';
import { bakeSemanticSimulation } from '../lib/interiors/bakeSimulation';
import { detectRooms } from '../lib/spatial/rooms';
import {
  commitReconstructionDraft,
  validateReconstructionDraft,
  type ReconstructionDraft,
} from '../lib/reconstruction/draft';
import {
  imageObservationToDraft,
  ImageReconstructionProviderRegistry,
  type ImageReconstructionObservation,
  type ImageReconstructionProvider,
  type ImageReconstructionProviderRequest,
} from '../lib/reconstruction/imageAdapter';
import {
  applyReconstructionReview,
  buildReconstructionReview,
} from '../lib/reconstruction/review';
import {
  recogniseOrthogonalFloorPlan,
  type RasterImageData,
  type LocalPlanRecognitionOptions,
} from '../lib/reconstruction/localPlanRecognizer';
import { checkModelHealth } from '../lib/reconstruction/modelHealth';
import { parseIfcMetadata, ifcSpatialPath } from '../lib/bim/ifcMetadata';
import {
  IfcGeometryProviderRegistry,
  type IfcGeometryProvider,
} from '../lib/bim/ifcGeometry';
import {
  createExternalAssetShape,
  validateGeneratedAsset,
  type GeneratedAssetInput,
} from '../lib/assets/externalAsset';
import {
  calibrateReferencePlan,
  createReferencePlanShape,
  type ReferencePlanCalibration,
  type ReferencePlanSettings,
  type ReferencePlanSource,
} from '../lib/reconstruction/referencePlan';
import { PLANT_SPECIES_CATALOG, PlantSpecies } from '../lib/plantLibrary';
import { LANDSCAPE_TEXTURES, LandscapeTexturePreset } from '../lib/landscapeTextures';
import { MATERIAL_PRESETS, getMaterialPreset } from '../lib/materialPresets';
import { createTerrainShape } from '../lib/terrain/terrainFactory';
import { generateTimberFraming, generateTimberFrameForRoof, TimberFrameOptions } from '../lib/timberFrameGenerator';
import { DEFAULT_TIMBER_FRAME_PARAMS } from '../constants/timberFrameDefaults';
import {
  createWallGeometry,
  createDoorGeometry,
  createWindowGeometry,
} from '../lib/archGeometry';

/**
 * Safely extracts geometry data arrays from a Three.js BufferGeometry
 */
function geometryToData(geom: THREE.BufferGeometry | null | undefined): {
  positions: number[];
  normals: number[];
  uvs?: number[];
  colors?: number[];
} {
  if (!geom || !geom.attributes || !geom.attributes.position || !geom.attributes.position.array) {
    return { positions: [], normals: [] };
  }
  return {
    positions: Array.from(geom.attributes.position.array),
    normals: geom.attributes.normal?.array ? Array.from(geom.attributes.normal.array) : [],
    uvs: geom.attributes.uv?.array ? Array.from(geom.attributes.uv.array) : undefined,
    colors: geom.attributes.color?.array ? Array.from(geom.attributes.color.array) : undefined,
  };
}

/** A point for sdk.drawing: [x, y, z] or { x, y, z }, in metres (y is up). */
export interface SiteImportOptions {
  /** Side of the square area in metres, 20 to 200 (default 100). */
  size?: number;
  groundStyle?: 'plain' | 'satellite';
  /** false: bring in the ground only. */
  buildings?: boolean;
}

export interface SiteImportResult {
  lat: number;
  lng: number;
  address: string;
  size: number;
  buildings: number;
  /** Anything that didn't load; the site is still usable. */
  warnings: string[];
}

export interface SiteBuildingInfo {
  id: string;
  name: string;
  /** Height of its top above its lowest ground, metres. */
  height: number;
  heightSource: SiteBuildingData['heightSource'];
  /** A roof fitted from LiDAR; null for a flat top. */
  roof: { shape: string; pitch: number; eave: number } | null;
  /** The LiDAR shows open ground here: the height is the map's guess. */
  heightCheck: boolean;
  kind?: string;
  position: [number, number, number];
}

export type DrawingPoint = [number, number, number] | { x: number; y: number; z: number };

export interface SDK {
  // Primitives & Core Shapes
  createRectangle: (args: { width: number, height: number, position?: [number, number, number] }) => Shape;
  createBox: (args: { width: number, height: number, depth: number, position?: [number, number, number] }) => Shape;
  createSphere: (args: { radius: number, position?: [number, number, number] }) => Shape;
  createCone: (args: { radius: number, height: number, position?: [number, number, number] }) => Shape;
  createPyramid: (args: { radius: number, height: number, position?: [number, number, number] }) => Shape;
  createDonut: (args: { radius: number, tube: number, position?: [number, number, number] }) => Shape;
  createDome: (args: { radius: number, position?: [number, number, number] }) => Shape;
  createCylinder: (args: { radius: number, height: number, radiusTop?: number, position?: [number, number, number] }) => Shape;
  createPoly: (args: { vertices: [number, number, number][], position?: [number, number, number] }) => Shape;
  addObject: (type: Shape['type'], props: Partial<Shape>) => Shape;
  pushPull: (shape: Shape, amount: number) => Shape;
  applyColor: (shape: Shape, color: string) => void;
  setTag: (shape: Shape, key: string, value: string) => void;
  setName: (shape: Shape, name: string) => void;
  getObjectByName: (name: string) => Shape | undefined;
  getSelectedObject: () => Shape | null;
  select: (idOrIds: string | string[]) => void;
  deleteObject: (id: string) => void;
  updateObject: (id: string, changes: Partial<Shape>) => void;
  saveScene: (name: string) => void;
  setSkybox: (type: any, blur?: number, rotation?: number, intensity?: number) => void;
  setFog: (settings: any) => void;
  addLight: (lightData: any) => void;
  setBevelType: (type: 'radius' | 'chamfer') => void;
  setBevel: (shape: Shape, settings: { amount?: number, type?: 'radius' | 'chamfer', segments?: number }) => void;
  divideSurface: (shapeId: string, faceIndex: number, divisions?: number | [number, number]) => void;
  addProjectorLight: (lightData: any) => void;
  performCSG: (targetId: string, cutterId: string, operation: 'SUBTRACTION' | 'UNION' | 'INTERSECTION') => void;
  deformObject: (id: string, settings: { radius: number, strength: number, direction: 'outward' | 'inward' | 'both' }) => void;
  addNote: (text: string, position: [number, number, number]) => void;
  setNoteVisibility: (id: string, visible: boolean) => void;
  toggleAllNotes: (visible: boolean) => void;
  addRectLight: (color: string, intensity: number, position: [number, number, number], scale?: [number, number]) => void;
  animateSun: (cycleSpeed?: number) => void;
  toggleFloor: (enabled: boolean) => void;
  toggleGrid: (enabled: boolean) => void;
  setFloor: (enabled: boolean, color?: string) => void;
  setGrid: (enabled: boolean) => void;
  setShadows: (enabled: boolean) => void;
  setAmbientOcclusion: (enabled: boolean) => void;
  setAxisIndicator: (enabled: boolean) => void;
  setMiniAxisIndicator: (enabled: boolean) => void;
  // intensity: 1 is ordinary daylight (50 on the Sun Intensity slider), 0 is night, about 2.2 is a bright sun.
  setSunSettings: (settings: { intensity?: number; position?: [number, number, number]; animate?: boolean; speed?: number }) => void;
  setGraphicsSettings: (settings: GraphicsSettings) => void;
  setZoom: (zoom: number) => void;
  resetView: (view: 'perspective' | 'plan' | 'front' | 'rear' | 'left' | 'right') => void;
  setCameraDefaults: (position: [number, number, number], target: [number, number, number]) => void;
  focusObject: (id: string) => void;
  getSyncStatus: () => 'synced' | 'syncing' | 'error' | 'offline';
  getCollaborators: () => any[];
  diagLog: (category: string, message: string, values?: Record<string, unknown>) => void;
  setContactFriction: (enabled: boolean) => void;
  generateModel: (prompt: string) => void;
  openWebpage: (url: string) => void;
  log: (message: string) => void;

  // Architecture Subsystem
  architecture: {
    createRoof: (args: {
      roofType?: RoofType;
      width: number;
      depth: number;
      ridgeHeight?: number;
      pitchAngleDeg?: number;
      eaveOverhang?: number;
      fasciaHeight?: number;
      soffitDepth?: number;
      tileShape?: RoofTileShape;
      tileSize?: number;
      tileColor?: string;
      colorPalette?: string[];
      randomizeColor?: boolean;
      position?: [number, number, number];
      color?: string;
    }) => Shape;
    updateRoof: (roofId: string, params: Partial<RoofAssemblyUpdateParams>) => void;
    listRoofs: () => Shape[];
    /**
     * Roofs the whole building, as the Roof buttons do: the main roof on the top storey and a
     * roof on each extension below, replacing any existing roofs. `options.tiles` gives pitched
     * roofs the Roof panel's tile look; `options.ids` reuses recorded object ids.
     */
    roofBuilding: (params: RoofParams, options?: { tiles?: RoofTileLook; ids?: string[] }) => Shape[];
    checkStairPlacement: (args: { position: [number, number, number]; rotationY?: number; width: number; height: number; style?: StairStyleType; structure?: StairStructureType }) => StairPlacement | null;
    createStairs: (args: {
      style?: StairStyleType;
      width?: number;
      height?: number;
      length?: number;
      numSteps?: number;
      structure?: StairStructureType;
      railing?: RailingModeType;
      isParametric?: boolean;
      idealStepHeight?: number;
      strideConstant?: number;
      position?: [number, number, number];
      color?: string;
      handrailHeight?: number;
    }) => Shape;
    createScaleFigure: (args?: { characterId?: string; height?: number; position?: [number, number, number]; rotation?: number; name?: string }) => Shape;
    listScaleFigureCharacters: () => typeof SCALE_FIGURE_CHARACTERS;
    createRailing: (args: {
      length?: number;
      height?: number;
      position?: [number, number, number];
      color?: string;
    }) => Shape;
    createRoom: (args: {
      width: number;
      length: number;
      height?: number;
      wallThickness?: number;
      includeFloor?: boolean;
      includeCeiling?: boolean;
      includeFoundation?: boolean;
      slabThickness?: number;
      justification?: 'center' | 'exterior' | 'interior';
      story?: number;
      position?: [number, number, number];
      wallColor?: string;
      floorColor?: string;
      ceilingColor?: string;
      foundationColor?: string;
    }) => { roomId: string; wallShapes: Shape[]; floorShape?: Shape; ceilingShape?: Shape; foundationShape?: Shape };
    createWall: (args: {
      start?: [number, number, number];
      end?: [number, number, number];
      length?: number;
      height?: number;
      thickness?: number;
      position?: [number, number, number];
      color?: string;
      rotation?: [number, number, number];
    }) => Shape;
    createDoor: (args: {
      width?: number;
      height?: number;
      depth?: number;
      position?: [number, number, number];
      rotation?: [number, number, number];
      color?: string;
      style?: string;
      hostWallId?: string;
      name?: string;
    }) => Shape;
    createWindow: (args: {
      width?: number;
      height?: number;
      depth?: number;
      position?: [number, number, number];
      rotation?: [number, number, number];
      color?: string;
      style?: string;
      hostWallId?: string;
      name?: string;
    }) => Shape;
    setWallTransparency: (settings: { overall?: number; exterior?: number; interior?: number }) => void;
    generateTimberFraming: (options?: {
      /** When supplied, frame only this roof instead of the whole building. */
      roofId?: string;
      /** Stud/member spacing in metres. */
      spacing?: number;
      /** Preferred app terminology for the structural member width/depth. */
      memberWidth?: number;
      memberDepth?: number;
      /** Backwards-compatible aliases for memberWidth/memberDepth. */
      rafterWidth?: number;
      rafterDepth?: number;
      species?: string;
      grade?: string;
      color?: string;
      includeWalls?: boolean;
      includeFloors?: boolean;
      includeRoof?: boolean;
    }) => Shape[];
    clearTimberFraming: () => void;
    configureRoofDefaults: (settings: RoofConfigDefaults) => void;
    getRoofDefaults: () => RoofConfigDefaults;
    configureStairsDefaults: (settings: StairsConfigDefaults) => void;
    getStairsDefaults: () => StairsConfigDefaults;
    configureTimberFramingSettings: (settings: TimberFramingConfigDefaults) => void;
    getTimberFramingSettings: () => TimberFramingConfigDefaults;
    configureWallSettings: (settings: WallConfigDefaults) => void;
    getWallSettings: () => WallConfigDefaults;
    setActiveStory: (story: number) => void;
    getActiveStory: () => number;
    configureDoorDefaults: (settings: DoorConfigDefaults) => void;
    getDoorDefaults: () => DoorConfigDefaults;
    configureWindowDefaults: (settings: WindowConfigDefaults) => void;
    getWindowDefaults: () => WindowConfigDefaults;
  };

  // Reference Plan Subsystem
  referencePlans: {
    calibrate: (
      source: Pick<ReferencePlanSource, 'pixelWidth' | 'pixelHeight'>,
      calibration: ReferencePlanCalibration,
    ) => ReturnType<typeof calibrateReferencePlan>;
    add: (
      source: ReferencePlanSource,
      calibration: ReferencePlanCalibration,
      settings?: ReferencePlanSettings,
    ) => Shape;
  };

  // External / Generated Assets Subsystem
  externalAssets: {
    validate: (input: GeneratedAssetInput) => ReturnType<typeof validateGeneratedAsset>;
    add: (input: GeneratedAssetInput) => Shape;
  };

  // BIM Subsystem
  bim: {
    parseIfcMetadata: (text: string) => ReturnType<typeof parseIfcMetadata>;
    spatialPath: (
      model: ReturnType<typeof parseIfcMetadata>,
      stepId: number,
    ) => ReturnType<typeof ifcSpatialPath>;
    registerGeometryProvider: (provider: IfcGeometryProvider) => void;
    listGeometryProviders: () => string[];
    importGeometry: (providerId: string, source: ArrayBuffer | Uint8Array) => Promise<ReturnType<IfcGeometryProviderRegistry['import']> extends Promise<infer T> ? T : never>;
  };

  // Reconstruction Subsystem
  reconstruction: {
    validateDraft: (draft: ReconstructionDraft) => ReturnType<typeof validateReconstructionDraft>;
    commitDraft: (
      draft: ReconstructionDraft,
      options?: { includeFurniture?: boolean },
    ) => ReturnType<typeof commitReconstructionDraft>;
    checkModelHealth: () => ReturnType<typeof checkModelHealth>;
    fromImageObservation: (observation: ImageReconstructionObservation) => ReconstructionDraft;
    recogniseOrthogonalPlan: (image: RasterImageData, options: LocalPlanRecognitionOptions) => ReconstructionDraft;
    registerImageProvider: (provider: ImageReconstructionProvider) => void;
    listImageProviders: () => string[];
    reconstructImage: (
      providerId: string,
      request: ImageReconstructionProviderRequest,
    ) => Promise<ReconstructionDraft>;
    reviewDraft: (draft: ReconstructionDraft) => ReturnType<typeof buildReconstructionReview>;
    applyReview: (draft: ReconstructionDraft, decisions: Record<string, boolean>) => ReconstructionDraft;
  };

  // Interior Design Subsystem
  interiors: {
    listRooms: () => ReturnType<typeof detectRooms>;
    addFurniture: (type: InteriorFurnitureType, options?: {
      position?: [number, number, number];
      rotation?: number;
      color?: string;
      roomId?: string;
      params?: FurnitureParams;
    }) => Shape;
    listCatalog: () => ReturnType<typeof interiorFurnitureCatalog>;
    furnishRoom: (roomId: string, preset: FurnishingPreset) => ReturnType<typeof planRoomFurnishing>;
    bakeSimulation: (shapeId: string, strength?: number) => Shape;
  };

  // Landscape & Site Planning Subsystem
  landscape: {
    addPlant: (speciesId?: string, options?: {
      position?: [number, number, number];
      scale?: number;
      rotation?: number;
      variation?: string;
      color?: string;
    }) => Shape;
    addSiteFurniture: (type: 'bench' | 'lamp' | 'fence' | 'rock' | 'railing', options?: {
      position?: [number, number, number];
      rotation?: number;
      color?: string;
      length?: number;
      height?: number;
      size?: number;
    }) => Shape;
    createTerrain: (options: {
      width: number;
      depth: number;
      resolution: number;
      topography: 'flat' | 'rolling' | 'ridge' | 'terraced';
      roughness?: number;
      heightScale?: number;
      textureId?: string;
      textureScale?: number;
      position?: [number, number, number];
      name?: string;
    }) => Shape;
    applyTerrainTexture: (textureId: string) => void;
    listPlantCatalog: () => PlantSpecies[];
    listTerrainTextures: () => LandscapeTexturePreset[];
    configureLandscapeDefaults: (settings: LandscapeConfigDefaults) => void;
    getLandscapeDefaults: () => LandscapeConfigDefaults;
    configureSculptSettings: (settings: { radius?: number; intensity?: number; mode?: 'push' | 'pull' | 'smooth' | 'flatten' | 'pinch'; masked?: boolean }) => void;
    getSculptSettings: () => any;
    configureRoadSettings: (settings: { width?: number; embankment?: boolean; roadColor?: string; curbHeight?: number }) => void;
    getRoadSettings: () => any;
    /** A fence run through ground points [x, z], as the Fence tool makes one. */
    addFence: (points: [number, number][], options?: FenceOptions) => Shape;
    /** A slope-aware safety-railing chain through world-space points [x,y,z]. */
    addRailing: (points: [number, number, number][], options?: { height?: number; color?: string; name?: string }) => Shape[];
    /** A pond or lake filling an outline of ground points [x, z], as the Water tool makes one. */
    addPond: (points: [number, number][], options?: PondOptions) => Shape;
    updatePond: (id: string, changes: { depth?: number; clarity?: 'clear' | 'lake' | 'pond' | 'murky'; level?: number; dig?: boolean; flow?: { mode: 'still' | 'stream'; direction?: [number, number]; speed?: number; turbulence?: number } | null; name?: string }) => void;
    /** A patio or deck over an outline of ground points [x, z], as the Patio tool makes one. */
    addPatio: (points: [number, number][], options?: PatioOptions) => Shape;
    updatePatio: (id: string, changes: { level?: number; name?: string; settings?: Record<string, unknown>; steps?: Array<{ edge: number; t: number; width: number }> }) => void;
  };

  // Civil / Terrain Modifier Subsystem
  civil: {
    list: () => TerrainModifier[];
    addRoad: (options: {
      points: [number, number, number][];
      name?: string;
      width?: number;
      maxGradePercent?: number;
      bankingAngle?: number;
      profile?: Partial<CurbDitchProfile>;
      markings?: RoadMarkingPreset;
      material?: string;
      batterDistance?: number;
      enabled?: boolean;
    }) => RoadModifier;
    addPad: (options: {
      primitive?: PadPrimitiveType;
      center: [number, number, number];
      dimensions?: [number, number];
      rotationY?: number;
      targetElevation?: number;
      batterDistance?: number;
      batterProfile?: BatterFalloffType;
      name?: string;
      enabled?: boolean;
    }) => PadModifier;
    setPadSurface: (padId: string, options: {
      pattern: 'parking-striping' | 'hatch' | 'asphalt' | 'gravel';
      parkingConfig?: Partial<ParkingStallConfig>;
      enabled?: boolean;
      name?: string;
    } | null) => void;
    update: (id: string, changes: Partial<TerrainModifier>) => void;
    remove: (id: string) => void;
    clear: () => void;
  };

  // Materials & PBR Subsystem
  materials: {
    applyMaterial: (target: Shape | string, material: string | {
      color?: string;
      roughness?: number;
      metalness?: number;
      opacity?: number;
      textureUrl?: string;
      normalMapUrl?: string;
      normalScale?: number;
      roughnessMapUrl?: string;
      metalnessMapUrl?: string;
      aoMapUrl?: string;
      aoMapIntensity?: number;
      displacementMapUrl?: string;
      displacementScale?: number;
      uvScale?: number;
    }) => void;
    setEdgeLines: (settings: { enabled?: boolean; color?: string; opacity?: number; thickness?: number }) => void;
    listPresets: () => string[];
    configureMaterialDefaults: (settings: MaterialConfigDefaults) => void;
    getMaterialDefaults: () => MaterialConfigDefaults;
  };

  // Measurement & Dimensioning Subsystem
  measurement: {
    addDimension: (
      start: [number, number, number],
      end: [number, number, number],
      labelOrOptions?: string | { text?: string; offset?: [number, number, number] },
    ) => Shape;
    addAreaLabel: (faceId: number, anchor?: [number, number, number], position?: [number, number, number]) => Shape | null;
    addLeader: (target: [number, number, number], anchor: [number, number, number], text: string) => Shape;
    addGuide: (point: [number, number, number], direction: [number, number, number], distance?: number, reach?: number) => Shape;
    addProtractor: (options: { centre: [number, number, number]; base: [number, number, number]; normal?: [number, number, number]; angle: number; radius?: number }) => Shape;
    listGuides: () => Shape[];
    deleteGuides: () => number;
    measureDistance: (p1: [number, number, number], p2: [number, number, number]) => {
      distance: number;
      dx: number;
      dy: number;
      dz: number;
      horizontalRun: number;
      rise: number;
      pitchDeg: number;
      formatted: string;
    };
    setUnit: (unit: 'm' | 'cm' | 'mm') => void;
    getUnit: () => string;
    configureMeasurementSettings: (settings: MeasurementConfigDefaults) => void;
    getMeasurementSettings: () => MeasurementConfigDefaults;
  };

  // Section Plane Subsystem
  sections: {
    create: (options: { point: [number, number, number]; normal: [number, number, number]; size?: number; active?: boolean; showPlane?: boolean; xrayColor?: string; xrayOpacity?: number; exempt?: string[]; name?: string }) => Shape;
    list: () => Shape[];
    setActive: (id: string, active?: boolean) => void;
    move: (id: string, distance: number) => void;
    flip: (id: string) => void;
    setLayerCut: (id: string, layer: string, cut: boolean) => void;
    update: (id: string, changes: Partial<Pick<SectionArgs, 'size' | 'showPlane' | 'xrayColor' | 'xrayOpacity' | 'exempt'>>) => void;
    remove: (id: string) => void;
  };

  // Toolbars & Extensions Subsystem
  toolbars: {
    create: (def: {
      id?: string;
      title: string;
      position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'floating' | 'dock-left' | 'dock-top' | 'dock-bottom';
      orientation?: 'horizontal' | 'vertical';
      items?: CustomToolbarItem[];
      closable?: boolean;
      collapsed?: boolean;
      floatPosition?: { x: number; y: number };
    }) => CustomToolbarDef;
    addButton: (toolbarId: string, item: CustomToolbarItem) => void;
    addToBasicToolbar: (item: CustomToolbarItem) => void;
    configureToolbar: (toolbarId: string, settings: Partial<CustomToolbarConfig>) => void;
    configureButton: (toolbarId: string, buttonId: string, settings: Partial<CustomToolbarButton>) => void;
    configureBasicToolbarButton: (buttonId: string, settings: Partial<CustomToolbarButton>) => void;
    getToolbar: (toolbarId: string) => CustomToolbarDef | undefined;
    getButton: (toolbarId: string, buttonId: string) => CustomToolbarButton | undefined;
    removeButton: (toolbarId: string, buttonId: string) => void;
    removeFromBasicToolbar: (buttonId: string) => void;
    removeToolbar: (toolbarId: string) => void;
    list: () => CustomToolbarDef[];
    getBasicToolbarButtons: () => CustomToolbarItem[];
    clear: () => void;
  };
  createToolbar: (def: any) => CustomToolbarDef;
  addToolbarButton: (toolbarIdOrNull: string | null, item: CustomToolbarItem) => void;

  // Selection & Transform Subsystem
  selection: {
    select: (idOrIds: string | string[]) => void;
    deselectAll: () => void;
    getSelected: () => Shape[];
    group: (ids: string[], groupName?: string) => string;
    ungroup: (groupIdOrIds: string | string[]) => void;
    duplicateObject: (id: string, offset?: [number, number, number]) => Shape | null;
    hideObject: (id: string, hidden: boolean) => void;
    isolateObject: (id: string) => void;
    unhideAll: () => void;
    transformObject: (id: string, transform: {
      position?: [number, number, number];
      rotation?: [number, number, number];
      scale?: [number, number, number];
    }) => void;
    alignObjects: (ids: string[], axis: 'x' | 'y' | 'z', alignment: 'min' | 'center' | 'max') => void;
    setFilter: (filter: 'all' | 'shapes' | 'surfaces') => void;
    setMode: (mode: 'lasso' | 'marquee') => void;
  };

  // Camera & Presentation Subsystem
  camera: {
    setNavigationMode: (mode: 'orbit' | 'pan' | 'zoom' | 'look' | 'walk' | 'teleport') => void;
    configureWalk: (settings: { movementSpeed?: number; mouseSensitivity?: number }) => void;
    getWalkSettings: () => { movementSpeed?: number; mouseSensitivity?: number };
    setProjection: (mode: 'perspective' | 'orthographic') => void;
    resetView: (view: 'perspective' | 'plan' | 'front' | 'rear' | 'left' | 'right') => void;
    setDepthClipping: (settings: { enabled?: boolean; near?: number; far?: number }) => void;
    setAutoOrbit: (enabled: boolean, speed?: number) => void;
    focusObject: (id: string) => void;
    setCameraDefaults: (position: [number, number, number], target: [number, number, number]) => void;
    setZoom: (zoom: number) => void;
  };

  // AI Assistance Subsystem
  ai: {
    generateModel: (prompt: string) => void;
    openRenderer: (prompt?: string, style?: string) => void;
    askAssistant: (query?: string) => void;
    openPhotoTo3D: () => void;
  };

  // Performance Profiler Subsystem
  performance: {
    setEnabled: (enabled: boolean) => void;
    isEnabled: () => boolean;
    startBenchmark: () => void;
    startRecording: () => void;
    stop: () => void;
    cancel: () => void;
    getState: () => PerfState;
    listRuns: () => PerfRun[];
    latest: () => PerfRun | null;
    latestComparison: () => ReturnType<typeof perfStore.latestComparison>;
    removeRun: (id: string) => void;
    clearRuns: () => void;
    toMarkdown: (runOrId?: PerfRun | string) => string | null;
  };

  // Scene & History Subsystem
  scene: {
    exportJSON: () => string;
    importJSON: (jsonString: string) => void;
    clearScene: (confirm?: boolean) => void;
    getStats: () => {
      shapeCount: number;
      typeCounts: Record<string, number>;
      estimatedVertices: number;
      memoryEstimateKB: number;
      bounds: { min: [number, number, number]; max: [number, number, number] };
    };
    undo: () => void;
    redo: () => void;
    saveScene: (name: string) => void;
    // Raw geometry (positions/normals/uvs) for any shape currently in the
    // scene, by id - useful for thumbnails, measurement, cloning geometry
    // into a new shape, etc. Works for every shape type, not just one
    // feature's own catalog.
    getShapeGeometry: (id: string) => { positions: number[]; normals: number[]; uvs?: number[] } | null;
  };

  // Outliner Subsystem - introspect the grouping/hierarchy the Outliner
  // panel shows, so an extension can look up the id of any element or
  // group without needing its own bookkeeping.
  outliner: {
    list: () => { id: string; name: string; type: string; tags?: string[] }[];
    find: (predicate: (entry: { id: string; name: string; type: string; tags?: string[] }) => boolean) => { id: string; name: string; type: string; tags?: string[] } | null;
  };

  // Stud-Block Kit Subsystem - PolyForm's built-in LEGO-style block catalog
  // and placement tool. Namespaced like `ai`/`landscape`/`worldView` so any
  // extension (not just one example script) can build its own picker UI
  // around it.
  blockKit: {
    list: () => { id: string; label: string; category: string }[];
    getGeometry: (partId: string) => { positions: number[]; normals: number[]; uvs?: number[] } | null;
    // color can be a single hex string, or an array of hex strings - when
    // an array is given, a fresh random colour from it is picked for EACH
    // block placed (not just once when the tool is armed).
    place: (partId: string, color?: string | string[]) => void;
    // Whether the placement tool refuses to place a block that would
    // overlap an existing one (on by default).
    setPreventOverlap: (enabled: boolean) => void;
  };

  // WorldView Subsystem
  worldView: {
    importMap: (args: { lat: number, lng: number, zoom?: number, altitude?: number, radius?: number }) => void;
    setLocation: (lat: number, lng: number) => void;
    setRadius: (radius: number) => void;
    setZoom: (zoom: number) => void;
    setAltitude: (altitude: number) => void;
    // A real place in 3D: its ground (editable terrain) and existing buildings, from free map
    // data. `place` is an address, a UK postcode, "lat, lng", or { lat, lng }. At most 200 m square.
    // Importing again replaces the previous site. Resolves once the data is in the model.
    importArea: (place: string | { lat: number; lng: number }, options?: SiteImportOptions) => Promise<SiteImportResult>;
    getSite: () => WorldSiteInfo | null;
    listBuildings: () => SiteBuildingInfo[];
    removeBuilding: (id: string) => boolean;
    restoreBuilding: (id: string) => boolean;
    setBuildingHeight: (id: string, height: number) => boolean;
    // Draw removed buildings as see-through ghosts, for before-and-after.
    showExisting: (show: boolean) => void;
    setGroundStyle: (style: 'plain' | 'satellite') => void;
    // Google's Photorealistic 3D Tiles around the site (needs a Google Maps key with the Map
    // Tiles API). ground: 'cutout' shows the editable ground over the site, 'google' uses Google's.
    // nudge raises or lowers the layer, metres.
    setGoogleContext: (on: boolean, options?: { ground?: 'cutout' | 'google'; nudge?: number }) => void;
    // Style the site's buildings: satellite roofs, walls from the map's colour or material.
    styleBuildings: (on: boolean) => void;
    // Moving cars and people on the site. A level ('off' | 'quiet' | 'normal' | 'busy'), and/or
    // whether they also move in the editor (they always do in presentations unless 'off').
    setStreetLife: (options: StreetLifeLevel | { level?: StreetLifeLevel; inEditor?: boolean }) => void;
    // Auto Street Light: lamp posts along the site's roads (LED, cobra head, double arm) and gate / path lights at
    // some houses. Needs the roads loaded (turn on street life once). Off takes them away.
    autoStreetLights: (on: boolean) => void;
    // The site's routes: the map's roads and paths plus any drawn. Points are [x, z] metres.
    listRoutes: () => SiteRoute[];
    // A route of your own: 'path' for people, 'road' for cars. Returns its id (null without a site).
    addRoute: (kind: 'path' | 'road', points: [number, number][]) => string | null;
    removeRoute: (id: string) => boolean;
  };

  // Text Subsystem - flat text labels and solid 3D letters, as the Text tools place them.
  text: {
    add: (options: TextOptions) => Shape;
    add3D: (options: TextOptions) => Shape;
    edit: (id: string, changes: Partial<TextData>) => void;
  };

  // Drawing Subsystem - drawn geometry (the geometry kernel): lines, arcs and surfaces
  // drawn with Line / Arc / Rectangle / Circle / Polygon, and push/pull on their faces.
  // Faces are numbered; the same steps on the same drawing give the same numbers.
  drawing: {
    line: (from: DrawingPoint, to: DrawingPoint) => number[];
    arc: (spec: { centre: DrawingPoint; normal?: DrawingPoint; radius: number; startAngle?: number; sweep: number; segments?: number }) => number[];
    surface: (points: DrawingPoint[]) => number[];
    shape: (points: DrawingPoint[]) => number[];
    bezier: (curve: { knots: BezierKnotInput[]; resolution?: number; normal?: DrawingPoint }) => number[];
    rectangle: (spec: { centre?: DrawingPoint; width: number; depth: number; normal?: DrawingPoint; rotationDeg?: number }) => number[];
    circle: (spec: { centre?: DrawingPoint; radius: number; segments?: number; normal?: DrawingPoint }) => number[];
    polygon: (spec: { centre?: DrawingPoint; radius: number; sides: number; rotationDeg?: number; normal?: DrawingPoint }) => number[];
    triangle: (spec: { centre?: DrawingPoint; radius: number; rotationDeg?: number; normal?: DrawingPoint }) => number[];
    pie: (spec: { centre?: DrawingPoint; radius: number; startAngleDeg?: number; sweepDeg: number; segments?: number; normal?: DrawingPoint }) => number[];
    freehand: (points: DrawingPoint[], closed?: boolean) => number[];
    chamfer: (faceIds: number[], amount: number) => { ok: boolean; reason?: string };
    fillet: (faceIds: number[], radius: number) => { ok: boolean; reason?: string };
    boolean: (faceIds: number[], operation: 'merge' | 'subtract' | 'intersect') => { ok: boolean; faces?: number[]; reason?: string };
    followMe: (
      profileFaceId: number,
      path: { edgeId: number } | { faceId: number } | { points: DrawingPoint[]; closed?: boolean },
    ) => boolean;
    pushPull: (faceId: number, distance: number) => boolean;
    offset: (faceId: number, distance: number) => boolean;
    erase: (faceIds: number[]) => void;
    paint: (faceIds: number[], color: string) => void;
    listFaces: () => { id: number; label: string; color: string | null; hidden: boolean; area: number; holes: number }[];
    applyChanges: (changes: KernelPatch) => void;
  };

  // Convenient Top-Level Aliases
  createRoof: (args: any) => Shape;
  updateRoof: (roofId: string, params: any) => void;
  createStairs: (args: any) => Shape;
  createRailing: (args: any) => Shape;
  createRoom: (args: any) => any;
  createWall: (args: any) => Shape;
  addPlant: (speciesId?: string, options?: any) => Shape;
  addSiteFurniture: (type: any, options?: any) => Shape;
  applyMaterial: (target: any, material: any) => void;
  addDimension: (start: [number, number, number], end: [number, number, number], label?: string) => Shape;
  measureDistance: (p1: [number, number, number], p2: [number, number, number]) => any;
  duplicateObject: (id: string, offset?: [number, number, number]) => Shape | null;
  group: (ids: string[], groupName?: string) => string;
  ungroup: (groupIdOrIds: string | string[]) => void;
  isolateObject: (id: string) => void;
  unhideAll: () => void;
  transformObject: (id: string, transform: any) => void;
  clearScene: (confirm?: boolean) => void;
  exportScene: () => string;
  getStats: () => any;
}

export class DeveloperSDK implements SDK {
  private imageReconstructionProviders = new ImageReconstructionProviderRegistry();
  private ifcGeometryProviders = new IfcGeometryProviderRegistry();
  public shapes: Shape[];
  public setShapes: (shapes: Shape[] | ((prev: Shape[]) => Shape[])) => void;
  public updateShapeColor: (id: string, color: string) => void;
  public selectedId: string | null;
  public extraSetters: any;

  // Subsystems
  public architecture: any;
  public referencePlans: any;
  public externalAssets: any;
  public bim: any;
  public reconstruction: any;
  public interiors: any;
  public landscape: any;
  public civil: SDK['civil'];
  public materials: any;
  public measurement: any;
  public sections: SDK['sections'];
  public selection: any;
  public camera: any;
  public ai: any;
  public performance: SDK['performance'];
  public scene: any;
  public outliner: any;
  public blockKit: any;
  public worldView: any;

  /** Changes the imported site's settings (kept on its ground). */
  private updateSite(changes: Partial<WorldSiteInfo>) {
    const ground = findSiteGround(this.shapes);
    if (!ground) {
      this.log('worldView: there is no imported site - use worldView.importArea first.');
      return;
    }
    this.setShapes(prev => prev.map(s => (s.id === ground.id && s.terrainData?.site
      ? { ...s, terrainData: { ...s.terrainData, site: { ...s.terrainData.site, ...changes } } }
      : s)));
  }
  public drawing: SDK['drawing'];
  public text: SDK['text'];
  public toolbars: any;

  // Configuration Defaults
  public roofDefaults: RoofConfigDefaults;
  public stairsDefaults: StairsConfigDefaults;
  public timberFramingDefaults: TimberFramingConfigDefaults;
  public wallDefaults: WallConfigDefaults;
  public doorDefaults: DoorConfigDefaults;
  public windowDefaults: WindowConfigDefaults;
  public landscapeDefaults: LandscapeConfigDefaults;
  public measurementDefaults: MeasurementConfigDefaults;
  public materialDefaults: MaterialConfigDefaults;

  constructor(
    shapes: Shape[], 
    setShapes: (shapes: Shape[] | ((prev: Shape[]) => Shape[])) => void,
    updateShapeColor: (id: string, color: string) => void,
    selectedId: string | null,
    extraSetters?: any
  ) {
    this.shapes = shapes;
    // Keep this.shapes in step with every change, so later commands in the same script see what
    // earlier ones made (a roof on the room just created, a listRoofs after createRoof...).
    this.setShapes = (next) => {
      this.shapes = typeof next === 'function' ? next(this.shapes) : next;
      setShapes(next);
    };
    this.updateShapeColor = updateShapeColor;
    this.selectedId = selectedId;
    this.extraSetters = extraSetters || {};

    // Initial subsystem configuration states
    this.roofDefaults = {
      roofType: 'gable',
      pitchAngleDeg: 35,
      ridgeHeight: 2.0,
      eaveOverhang: 0.30,
      fasciaHeight: 0.18,
      soffitDepth: 0.30,
      roofThickness: 0.12,
      parapetHeight: 0.60,
      parapetThickness: 0.20,
      tileShape: 'none',
      tileSize: 1.0,
      tileColor: '#994d38',
      color: '#a85a44',
      fasciaColor: '#ffffff',
      ridgeCapColor: '#64748b',
      soffitColor: '#cbd5e1',
      pedimentColor: '#e2e8f0',
      copingColor: '#334155',
      randomizeColor: false,
      gableWalls: true
    };

    this.stairsDefaults = {
      style: 'straight',
      structure: 'closed',
      railing: 'both',
      width: 1.0,
      height: 2.7,
      length: 3.6,
      numSteps: 14,
      idealStepHeight: 0.175,
      strideConstant: 0.63,
      isParametric: true,
      handrailHeight: 0.95,
      stringerWidth: 0.05,
      treadThickness: 0.04,
      nosing: 0.025,
      color: '#e2e8f0',
      railingColor: '#475569'
    };

    this.timberFramingDefaults = {
      studSpacing: 0.60,
      studWidth: 0.045,
      studDepth: 0.145,
      joistSpacing: 0.40,
      joistDepth: 0.190,
      rafterSpacing: 0.60,
      rafterDepth: 0.145,
      species: 'douglas-fir',
      timberColor: '#b45309',
      includeWalls: true,
      includeFloors: true,
      includeRoof: true,
      blocking: true
    };

    this.wallDefaults = {
      thickness: 0.20,
      height: 2.80,
      justification: 'center',
      color: '#f1f5f9',
      miterWalls: true,
      snapToGrid: true,
      transparency: { overall: 1.0, exterior: 1.0, interior: 1.0 }
    };

    this.doorDefaults = {
      width: 0.90,
      height: 2.10,
      depth: 0.15,
      frameThickness: 0.05,
      color: '#78350f',
      panelColor: '#92400e'
    };

    this.windowDefaults = {
      width: 1.20,
      height: 1.50,
      depth: 0.15,
      sillHeight: 0.90,
      panes: 2,
      frameColor: '#ffffff',
      glassColor: '#38bdf8',
      glassOpacity: 0.35
    };

    this.landscapeDefaults = {
      defaultSpecies: 'english_oak',
      defaultScale: 1.0,
      scaleVariance: 0.15,
      defaultTerrainTexture: 'grass_lush',
      furnitureColor: '#475569'
    };

    this.measurementDefaults = {
      unit: (this.extraSetters.unit as any) || 'm',
      precision: 2,
      lineColor: '#2563eb',
      textColor: '#1e293b',
      fontSize: 14,
      showUnits: true,
      arrowheads: 'arrows'
    };

    this.materialDefaults = {
      roughness: 0.5,
      metalness: 0.0,
      opacity: 1.0,
      emissive: '#000000',
      emissiveIntensity: 0.0,
      wireframe: false
    };

    // ─────────────────────────────────────────────────────────────
    // ARCHITECTURE SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.architecture = {
      createRoof: (args: {
        roofType?: RoofType;
        width: number;
        depth: number;
        ridgeHeight?: number;
        pitchAngleDeg?: number;
        eaveOverhang?: number;
        fasciaHeight?: number;
        soffitDepth?: number;
        tileShape?: RoofTileShape;
        tileSize?: number;
        tileColor?: string;
        colorPalette?: string[];
        randomizeColor?: boolean;
        position?: [number, number, number];
        color?: string;
      }): Shape => {
        const roofType: RoofType = args.roofType || this.roofDefaults.roofType || 'gable';
        const width = Math.max(0.5, args.width);
        const depth = Math.max(0.5, args.depth);
        const eaveOverhang = args.eaveOverhang ?? this.roofDefaults.eaveOverhang ?? 0.30;
        const fasciaHeight = args.fasciaHeight ?? this.roofDefaults.fasciaHeight ?? 0.18;
        const span = Math.min(width, depth);
        let ridgeHeight = args.ridgeHeight ?? this.roofDefaults.ridgeHeight ?? 2.0;
        const pitchAngle = args.pitchAngleDeg ?? this.roofDefaults.pitchAngleDeg;
        if (pitchAngle) {
          const rad = THREE.MathUtils.degToRad(pitchAngle);
          ridgeHeight = Math.max(0.6, (span / 2 + eaveOverhang) * Math.tan(rad));
        }
        const pos: [number, number, number] = args.position || [0, 0, 0];
        const tileShape: RoofTileShape = args.tileShape ?? this.roofDefaults.tileShape ?? 'none';
        const tileColor = args.tileColor || this.roofDefaults.tileColor || '#994d38';

        let slopesGeom: THREE.BufferGeometry;
        if (roofType === 'hip') {
          slopesGeom = createDetailedHipRoofGeometry(width, depth, ridgeHeight, eaveOverhang, fasciaHeight);
        } else if (roofType === 'parapet') {
          const halfW = width / 2;
          const halfD = depth / 2;
          const t = 0.20;
          const outerPoly: [number, number][] = [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]];
          const innerPoly: [number, number][] = [[-halfW + t, -halfD + t], [halfW - t, -halfD + t], [halfW - t, halfD - t], [-halfW + t, halfD - t]];
          slopesGeom = createParapetWallsGeometry(outerPoly, innerPoly, ridgeHeight);
        } else {
          slopesGeom = createDetailedGableRoofGeometry(width, depth, ridgeHeight, eaveOverhang, fasciaHeight);
        }

        const id = Math.random().toString(36).substr(2, 9);
        const newShapes: Shape[] = [];

        const roofShape: Shape = {
          id,
          name: `Architectural Roof (${roofType})`,
          type: 'roof',
          position: pos,
          args: [width, ridgeHeight, depth],
          color: args.color || '#a85a44',
          tags: ['architecture', 'roof', `roof-${roofType}`],
          customData: {
            roofType,
            width,
            depth,
            ridgeHeight,
            eaveOverhang,
            fasciaHeight,
            tileShape,
            tileColor,
            tileSize: args.tileSize ?? 1.0,
            randomizeColor: args.randomizeColor ?? false,
            colorPalette: args.colorPalette
          },
          geometryData: geometryToData(slopesGeom)
        };
        newShapes.push(roofShape);

        // Generate 3D roof tiles if tileShape !== 'none'
        if (tileShape !== 'none' && roofType !== 'parapet') {
          const paletteItems = args.colorPalette
            ? args.colorPalette.map((c: any, i: number) =>
                typeof c === 'string'
                  ? { id: `palette-${i}`, type: 'color' as const, value: c, name: `Palette ${i + 1}` }
                  : c
              )
            : undefined;

          const tilesGeom = create3DRoofTilesGeometry({
            width,
            depth,
            ridgeHeight,
            eaveOverhang,
            roofType,
            tileShape,
            tileSize: args.tileSize ?? 1.0,
            randomizeColor: args.randomizeColor ?? false,
            colorPalette: paletteItems,
            tileColor: tileColor
          });
          if (tilesGeom && tilesGeom.attributes && tilesGeom.attributes.position && tilesGeom.attributes.position.count > 0) {
            const tileShapeObj: Shape = {
              id: `${id}-tiles`,
              name: `Roof Tiles (${tileShape})`,
              type: 'custom',
              position: pos,
              args: [],
              color: tileColor,
              tags: ['architecture', 'roof-tiles', 'roof-child'],
              customData: { parentRoofId: id },
              geometryData: geometryToData(tilesGeom)
            };
            newShapes.push(tileShapeObj);
          }
        }

        this.setShapes(prev => [...prev, ...newShapes]);
        this.log(`Created architectural ${roofType} roof (${width}m x ${depth}m, ridge: ${ridgeHeight.toFixed(2)}m, tiles: ${tileShape}).`);
        return roofShape;
      },

      updateRoof: (roofId: string, params: Partial<RoofAssemblyUpdateParams>): void => {
        this.setShapes(prev => {
          const target = prev.find(s => s.id === roofId);
          if (!target) {
            this.log(`Roof ${roofId} not found.`);
            return prev;
          }
          const res = updateRoofAssembly(prev, roofId, params as any);
          return res.updatedShapes;
        });
        this.log(`Updated roof ${roofId}.`);
      },

      listRoofs: (): Shape[] => {
        return this.shapes.filter(s => s.type === 'roof' || (s.tags && s.tags.includes('roof')));
      },

      roofBuilding: (params: RoofParams, options: { tiles?: RoofTileLook; ids?: string[] } = {}): Shape[] => {
        const result = withShapeIds(options.ids ?? [], () => roofBuilding(this.shapes, params, options.tiles));
        if (!result) {
          this.log('No roof made: draw a closed room of walls first.');
          return [];
        }
        this.setShapes(result.shapes);
        this.log(`Roofed the building (${result.roofs.length} roof${result.roofs.length === 1 ? '' : 's'}).`);
        return result.roofs;
      },

      checkStairPlacement: (args) => {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), args.rotationY ?? 0);
        return checkStairPlacement({
          position: args.position,
          quaternion: [q.x, q.y, q.z, q.w],
          width: args.width,
          height: args.height,
          style: args.style,
          structure: args.structure,
        }, this.shapes);
      },

      createStairs: (args: {
        style?: StairStyleType;
        width?: number;
        height?: number;
        length?: number;
        numSteps?: number;
        structure?: StairStructureType;
        railing?: RailingModeType;
        isParametric?: boolean;
        idealStepHeight?: number;
        strideConstant?: number;
        position?: [number, number, number];
        color?: string;
        handrailHeight?: number;
      }): Shape => {
        const style = args.style || this.stairsDefaults.style || 'straight';
        const width = args.width ?? this.stairsDefaults.width ?? 1.0;
        const height = args.height ?? this.stairsDefaults.height ?? 2.7;
        const length = args.length ?? this.stairsDefaults.length ?? 3.6;
        const numSteps = args.numSteps ?? this.stairsDefaults.numSteps ?? 14;
        const structure = args.structure || this.stairsDefaults.structure || 'closed';
        const railing = args.railing || this.stairsDefaults.railing || 'both';
        const pos: [number, number, number] = args.position || [0, 0, 0];

        const geom = createArchitecturalStaircaseGeometry({
          stairStyle: style,
          width,
          height,
          length,
          numSteps,
          stairStructure: structure,
          railingMode: railing,
          handrailHeight: args.handrailHeight ?? this.stairsDefaults.handrailHeight,
          isParametric: args.isParametric ?? this.stairsDefaults.isParametric ?? true,
          idealStepHeight: args.idealStepHeight ?? this.stairsDefaults.idealStepHeight,
          strideConstant: args.strideConstant ?? this.stairsDefaults.strideConstant
        });

        const id = Math.random().toString(36).substr(2, 9);
        const stairShape: Shape = {
          id,
          name: `Parametric Stairs (${style})`,
          type: 'staircase',
          position: pos,
          args: [width, height, length, numSteps],
          color: args.color || this.stairsDefaults.color || '#e2e8f0',
          tags: ['architecture', 'staircase', `stair-${style}`],
          customData: {
            style,
            structure,
            railing,
            width,
            height,
            length,
            numSteps,
            handrailHeight: args.handrailHeight ?? this.stairsDefaults.handrailHeight
          },
          geometryData: geometryToData(geom)
        };

        this.setShapes(prev => [...prev, stairShape]);
        this.log(`Created parametric stairs (${style}, height: ${height}m, steps: ${numSteps}, structure: ${structure}).`);
        return stairShape;
      },

      createScaleFigure: (args: { characterId?: string; height?: number; position?: [number, number, number]; rotation?: number; name?: string } = {}): Shape => {
        const character = SCALE_FIGURE_CHARACTERS.find(c => c.id === (args.characterId ?? 'architect-alex')) ?? SCALE_FIGURE_CHARACTERS[0]!;
        const height = args.height && args.height > 0.5 ? args.height : character.height;
        const geom = createScaleFigureGeometry(character.id, height);
        const shape: Shape = {
          id: Math.random().toString(36).slice(2, 11),
          name: args.name ?? character.name,
          type: 'scale_figure',
          position: args.position ?? [0, 0, 0],
          rotation: [0, args.rotation ?? 0, 0],
          args: [character.width * (height / character.height), height, character.depth * (height / character.height)],
          archStyle: character.id,
          color: character.primaryColor,
          tags: ['architecture', 'scale-figure', 'reference'],
          geometryData: geometryToData(geom),
        };
        geom.dispose();
        this.setShapes(prev => [...prev, shape]);
        return shape;
      },
      listScaleFigureCharacters: () => SCALE_FIGURE_CHARACTERS.map(c => ({ ...c })),

      createRailing: (args: {
        length?: number;
        height?: number;
        position?: [number, number, number];
        color?: string;
      }): Shape => {
        const length = args.length ?? 2.0;
        const height = args.height ?? 1.0;
        const pos: [number, number, number] = args.position || [0, 0, 0];
        const geom = createRailingGeometry(length, height);
        const id = Math.random().toString(36).substr(2, 9);
        const railingShape: Shape = {
          id,
          name: `Architectural Railing (${length}m)`,
          type: 'railing',
          position: pos,
          args: [length, height],
          color: args.color || '#475569',
          tags: ['architecture', 'railing'],
          geometryData: geometryToData(geom)
        };
        this.setShapes(prev => [...prev, railingShape]);
        this.log(`Created railing (${length}m x ${height}m).`);
        return railingShape;
      },

      createRoom: (args: {
        width: number;
        length: number;
        height?: number;
        wallThickness?: number;
        includeFloor?: boolean;
        includeCeiling?: boolean;
        includeFoundation?: boolean;
        slabThickness?: number;
        justification?: 'center' | 'exterior' | 'interior';
        story?: number;
        position?: [number, number, number];
        wallColor?: string;
        floorColor?: string;
        ceilingColor?: string;
        foundationColor?: string;
      }): { roomId: string; wallShapes: Shape[]; floorShape?: Shape; ceilingShape?: Shape; foundationShape?: Shape } => {
        const width = Math.max(1, args.width);
        const length = Math.max(1, args.length);
        const height = Math.max(0.5, args.height ?? this.wallDefaults.height ?? 2.8);
        const wallThickness = Math.max(0.05, args.wallThickness ?? this.wallDefaults.thickness ?? 0.20);
        const slabThickness = Math.max(0.05, args.slabThickness ?? 0.20);
        const pos = args.position ?? [0, 0, 0];
        const story = Math.max(1, Math.floor(args.story ?? this.extraSetters.activeStory ?? 1));
        const configuredJustification = this.wallDefaults.justification;
        const justification = args.justification
          ?? (configuredJustification === 'interior' || configuredJustification === 'exterior' || configuredJustification === 'center'
            ? configuredJustification
            : 'center');
        const roomId = `room-${Math.random().toString(36).slice(2, 9)}`;
        const halfW = width / 2, halfL = length / 2;
        const vertices = [
          new THREE.Vector3(pos[0] - halfW, pos[1], pos[2] - halfL),
          new THREE.Vector3(pos[0] + halfW, pos[1], pos[2] - halfL),
          new THREE.Vector3(pos[0] + halfW, pos[1], pos[2] + halfL),
          new THREE.Vector3(pos[0] - halfW, pos[1], pos[2] + halfL),
        ];
        const terrain = args.includeFloor === false
          ? null
          : this.shapes.find(shape => shape.type === 'terrain' && shape.terrainData) ?? null;
        const assembly = buildRoomAssembly(vertices, terrain, undefined, {
          wallHeight: height,
          wallThickness,
          slabThickness,
          justification,
          story,
          wallColor: args.wallColor ?? this.wallDefaults.color ?? '#f1f5f9',
          slabColor: args.floorColor ?? '#94a3b8',
          foundationColor: args.foundationColor,
        });

        const wallShapes = assembly.wallShapes.map((wall, index) => ({
          ...wall,
          name: `Room Wall ${index + 1}`,
          tags: [...new Set([...(wall.tags ?? []), 'wall', `room:${roomId}`])],
          customData: { ...(wall.customData ?? {}), roomId },
        }));
        const floorShape = args.includeFloor === false ? undefined : {
          ...assembly.slabShape,
          name: 'Room Floor Slab',
          tags: [...new Set([...(assembly.slabShape.tags ?? []), 'floor', `room:${roomId}`])],
          customData: { ...(assembly.slabShape.customData ?? {}), roomId },
        };
        const foundationShape = args.includeFloor === false || args.includeFoundation === false || !assembly.foundationShape
          ? undefined
          : {
            ...assembly.foundationShape,
            tags: [...new Set([...(assembly.foundationShape.tags ?? []), `room:${roomId}`])],
            customData: { ...(assembly.foundationShape.customData ?? {}), roomId },
          };

        let ceilingShape: Shape | undefined;
        if (args.includeCeiling) {
          const ceilingArgs = typeof assembly.slabShape.args === 'object' && !Array.isArray(assembly.slabShape.args)
            ? { ...assembly.slabShape.args, height: slabThickness }
            : assembly.slabShape.args;
          ceilingShape = {
            ...assembly.slabShape,
            id: Math.random().toString(36).slice(2, 11),
            name: 'Room Ceiling Slab',
            position: [assembly.slabShape.position[0], assembly.datumZ + height + slabThickness / 2, assembly.slabShape.position[2]],
            args: ceilingArgs,
            color: args.ceilingColor ?? '#e2e8f0',
            tags: [`story-${story}`, 'architecture', 'ceiling', `room:${roomId}`],
            customData: { roomId },
          };
        }

        const additions: Shape[] = [
          ...wallShapes,
          ...(floorShape ? [floorShape] : []),
          ...(foundationShape ? [foundationShape] : []),
          ...(ceilingShape ? [ceilingShape] : []),
        ];
        this.setShapes(prev => {
          const withTerrain = assembly.updatedTerrainData && assembly.modifiedTerrainShapeId
            ? prev.map(shape => shape.id === assembly.modifiedTerrainShapeId ? { ...shape, terrainData: assembly.updatedTerrainData! } : shape)
            : prev;
          return [...withTerrain, ...additions];
        });
        this.log(`Created room ${roomId} (${width}m × ${length}m × ${height}m) using Wall tool room assembly.`);
        return { roomId, wallShapes, floorShape, ceilingShape, foundationShape };
      },

      createWall: (args: {
        start?: [number, number, number];
        end?: [number, number, number];
        length?: number;
        height?: number;
        thickness?: number;
        position?: [number, number, number];
        color?: string;
        rotation?: [number, number, number];
      }): Shape => {
        let length = args.length ?? 3.0;
        const height = args.height ?? this.wallDefaults.height ?? 2.8;
        const thickness = args.thickness ?? this.wallDefaults.thickness ?? 0.20;
        let pos: [number, number, number] = args.position || [0, height / 2, 0];
        let rot: [number, number, number] = args.rotation || [0, 0, 0];

        if (args.start && args.end) {
          const dx = args.end[0] - args.start[0];
          const dz = args.end[2] - args.start[2];
          length = Math.sqrt(dx * dx + dz * dz);
          pos = [
            (args.start[0] + args.end[0]) / 2,
            (args.start[1] + args.end[1]) / 2 + height / 2,
            (args.start[2] + args.end[2]) / 2
          ];
          const angle = Math.atan2(dz, dx);
          rot = [0, -angle, 0];
        }

        const geom = createWallGeometry(length, height, thickness);
        const id = Math.random().toString(36).substr(2, 9);
        const wallShape: Shape = {
          id,
          name: `Wall (${length.toFixed(2)}m)`,
          type: 'wall',
          position: pos,
          rotation: rot,
          args: [length, height, thickness],
          color: args.color || this.wallDefaults.color || '#f1f5f9',
          tags: ['architecture', 'wall'],
          geometryData: geometryToData(geom)
        };

        this.setShapes(prev => [...prev, wallShape]);
        this.log(`Created wall (${length.toFixed(2)}m x ${height}m x ${thickness}m).`);
        return wallShape;
      },

      createDoor: (args: {
        width?: number;
        height?: number;
        depth?: number;
        position?: [number, number, number];
        rotation?: [number, number, number];
        color?: string;
        style?: string;
        hostWallId?: string;
        name?: string;
      }): Shape => {
        const width = args.width ?? this.doorDefaults.width ?? 0.90;
        const height = args.height ?? this.doorDefaults.height ?? 2.10;
        const depth = args.depth ?? this.doorDefaults.depth ?? 0.15;
        const pos: [number, number, number] = args.position || [0, height / 2, 0];
        const style = args.style ?? 'flush';
        const geom = createDoorGeometry(width, height, depth, style);
        const id = Math.random().toString(36).substr(2, 9);
        const doorShape: Shape = {
          id,
          name: args.name ?? `Door (${width}m x ${height}m)`,
          type: 'door',
          position: pos,
          rotation: args.rotation ?? [0, 0, 0],
          args: [width, height, depth],
          color: args.color || this.doorDefaults.color || '#78350f',
          tags: ['architecture', 'door', 'opening'],
          hostWallId: args.hostWallId,
          archStyle: style,
          geometryData: geometryToData(geom)
        };
        this.setShapes(prev => [...prev, doorShape]);
        this.log(`Created architectural door (${width}m x ${height}m).`);
        return doorShape;
      },

      createWindow: (args: {
        width?: number;
        height?: number;
        depth?: number;
        position?: [number, number, number];
        rotation?: [number, number, number];
        color?: string;
        style?: string;
        hostWallId?: string;
        name?: string;
      }): Shape => {
        const width = args.width ?? this.windowDefaults.width ?? 1.20;
        const height = args.height ?? this.windowDefaults.height ?? 1.50;
        const depth = args.depth ?? this.windowDefaults.depth ?? 0.15;
        const pos: [number, number, number] = args.position || [0, 1.5, 0];
        const style = args.style ?? 'cross';
        const geom = createWindowGeometry(width, height, depth, style);
        const id = Math.random().toString(36).substr(2, 9);
        const windowShape: Shape = {
          id,
          name: args.name ?? `Window (${width}m x ${height}m)`,
          type: 'window',
          position: pos,
          rotation: args.rotation ?? [0, 0, 0],
          args: [width, height, depth],
          color: args.color || this.windowDefaults.frameColor || '#ffffff',
          tags: ['architecture', 'window', 'opening'],
          hostWallId: args.hostWallId,
          archStyle: style,
          geometryData: geometryToData(geom)
        };
        this.setShapes(prev => [...prev, windowShape]);
        this.log(`Created architectural window (${width}m x ${height}m).`);
        return windowShape;
      },

      setWallTransparency: (settings: { overall?: number; exterior?: number; interior?: number }): void => {
        if (settings.overall !== undefined && this.extraSetters.setWallTransparency) {
          this.extraSetters.setWallTransparency(settings.overall);
        }
        if (settings.exterior !== undefined && this.extraSetters.setExteriorWallTransparency) {
          this.extraSetters.setExteriorWallTransparency(settings.exterior);
        }
        if (settings.interior !== undefined && this.extraSetters.setInteriorWallTransparency) {
          this.extraSetters.setInteriorWallTransparency(settings.interior);
        }
        this.log(`Set wall transparency (overall: ${settings.overall}, exterior: ${settings.exterior}, interior: ${settings.interior}).`);
      },

      generateTimberFraming: (options?: {
        roofId?: string;
        spacing?: number;
        memberWidth?: number;
        memberDepth?: number;
        rafterWidth?: number;
        rafterDepth?: number;
        species?: string;
        grade?: string;
        color?: string;
        includeWalls?: boolean;
        includeFloors?: boolean;
        includeRoof?: boolean;
      }): Shape[] => {
        try {
          const baseParams: TimberFrameParams = {
            ...DEFAULT_TIMBER_FRAME_PARAMS,
            ...(this.extraSetters.timberFrameParams ?? {}),
          };
          const params: TimberFrameParams = {
            ...baseParams,
            studSpacing: options?.spacing ?? this.timberFramingDefaults.studSpacing ?? baseParams.studSpacing,
            memberWidth: options?.memberWidth ?? options?.rafterWidth ?? this.timberFramingDefaults.studWidth ?? baseParams.memberWidth,
            memberDepth: options?.memberDepth ?? options?.rafterDepth ?? this.timberFramingDefaults.studDepth ?? baseParams.memberDepth,
            species: options?.species ?? this.timberFramingDefaults.species ?? baseParams.species,
            grade: options?.grade ?? baseParams.grade,
          };
          const framingOpts: TimberFrameOptions = {
            params,
            studSpacing: params.studSpacing,
            studWidth: params.memberWidth,
            studDepth: params.memberDepth,
            timberColor: options?.color || this.timberFramingDefaults.timberColor || '#b45309',
            includeRoof: options?.includeRoof ?? this.timberFramingDefaults.includeRoof ?? true,
            includeWalls: options?.includeWalls ?? this.timberFramingDefaults.includeWalls ?? true,
            includeFloors: options?.includeFloors ?? this.timberFramingDefaults.includeFloors ?? true,
          };

          let framingShapes: Shape[];
          if (options?.roofId) {
            const roof = this.shapes.find(s => s.id === options.roofId);
            if (!roof) {
              this.log(`Timber framing roof "${options.roofId}" was not found.`);
              return [];
            }
            framingShapes = generateTimberFrameForRoof(roof, this.shapes, framingOpts);
          } else {
            framingShapes = generateTimberFraming(this.shapes, framingOpts).shapes;
          }

          if (framingShapes.length > 0) {
            this.setShapes(prev => [...prev, ...framingShapes]);
            if (this.extraSetters.commitUpdatedFraming) {
              this.extraSetters.commitUpdatedFraming(framingShapes);
            }
            if (this.extraSetters.setTimberFrameParams) {
              this.extraSetters.setTimberFrameParams(params);
            }
            this.log(`Generated ${framingShapes.length} timber framing elements${options?.roofId ? ` for roof ${options.roofId}` : ''}.`);
            return framingShapes;
          }
        } catch (err: any) {
          this.log(`Error generating timber framing: ${err.message}`);
        }
        return [];
      },

      clearTimberFraming: (): void => {
        this.setShapes(prev => prev.filter(s => !(s.tags && s.tags.includes('timber-frame')) && !s.id.startsWith('tf-')));
        this.log('Cleared all timber framing elements.');
      },

      configureRoofDefaults: (settings: RoofConfigDefaults): void => {
        this.roofDefaults = { ...this.roofDefaults, ...settings };
        this.log(`Configured roof defaults: ${JSON.stringify(settings)}`);
      },

      getRoofDefaults: (): RoofConfigDefaults => {
        return { ...this.roofDefaults };
      },

      configureStairsDefaults: (settings: StairsConfigDefaults): void => {
        this.stairsDefaults = { ...this.stairsDefaults, ...settings };
        this.log(`Configured stairs defaults: ${JSON.stringify(settings)}`);
      },

      getStairsDefaults: (): StairsConfigDefaults => {
        return { ...this.stairsDefaults };
      },

      configureTimberFramingSettings: (settings: TimberFramingConfigDefaults): void => {
        this.timberFramingDefaults = { ...this.timberFramingDefaults, ...settings };
        if (this.extraSetters.setTimberFrameParams) {
          this.extraSetters.setTimberFrameParams((prev: any) => ({ ...prev, ...settings }));
        }
        this.log(`Configured timber framing settings: ${JSON.stringify(settings)}`);
      },

      getTimberFramingSettings: (): TimberFramingConfigDefaults => {
        return { ...this.timberFramingDefaults };
      },

      configureWallSettings: (settings: WallConfigDefaults): void => {
        this.wallDefaults = { ...this.wallDefaults, ...settings };
        if (this.extraSetters.setWallToolSettings) {
          this.extraSetters.setWallToolSettings((prev: any) => ({ ...prev, ...settings }));
        }
        if (settings.justification && this.extraSetters.setWallJustification) {
          this.extraSetters.setWallJustification(settings.justification);
        }
        if (settings.transparency) {
          this.architecture.setWallTransparency(settings.transparency);
        }
        this.log(`Configured wall settings: ${JSON.stringify(settings)}`);
      },

      getWallSettings: (): WallConfigDefaults => {
        return { ...this.wallDefaults };
      },

      setActiveStory: (story: number): void => {
        if (this.extraSetters.setActiveStory) {
          this.extraSetters.setActiveStory(story);
        }
        this.log(`Set active story to ${story}.`);
      },

      getActiveStory: (): number => {
        return this.extraSetters.activeStory || 1;
      },

      configureDoorDefaults: (settings: DoorConfigDefaults): void => {
        this.doorDefaults = { ...this.doorDefaults, ...settings };
        this.log(`Configured door defaults: ${JSON.stringify(settings)}`);
      },

      getDoorDefaults: (): DoorConfigDefaults => {
        return { ...this.doorDefaults };
      },

      configureWindowDefaults: (settings: WindowConfigDefaults): void => {
        this.windowDefaults = { ...this.windowDefaults, ...settings };
        this.log(`Configured window defaults: ${JSON.stringify(settings)}`);
      },

      getWindowDefaults: (): WindowConfigDefaults => {
        return { ...this.windowDefaults };
      }
    };

    // ─────────────────────────────────────────────────────────────
    // REFERENCE PLAN SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.referencePlans = {
      calibrate: (
        source: Pick<ReferencePlanSource, 'pixelWidth' | 'pixelHeight'>,
        calibration: ReferencePlanCalibration,
      ) => calibrateReferencePlan(source, calibration),

      add: (
        source: ReferencePlanSource,
        calibration: ReferencePlanCalibration,
        settings?: ReferencePlanSettings,
      ): Shape => {
        const shape = createReferencePlanShape(source, calibration, settings);
        this.placeBuilt(shape);
        this.log(`Added calibrated reference plan: ${shape.name ?? shape.id}.`);
        return shape;
      },
    };

    // ─────────────────────────────────────────────────────────────
    // EXTERNAL / GENERATED ASSET SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.externalAssets = {
      validate: (input: GeneratedAssetInput) => validateGeneratedAsset(input),
      add: (input: GeneratedAssetInput): Shape => {
        const shape = createExternalAssetShape(input);
        this.placeBuilt(shape);
        this.log(`Added external asset: ${shape.name ?? shape.id} (${input.provenance.source}).`);
        return shape;
      },
    };

    // ─────────────────────────────────────────────────────────────
    // BIM SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.bim = {
      parseIfcMetadata: (text: string) => parseIfcMetadata(text),
      spatialPath: (model: ReturnType<typeof parseIfcMetadata>, stepId: number) => ifcSpatialPath(model, stepId),
      registerGeometryProvider: (provider: IfcGeometryProvider) => this.ifcGeometryProviders.register(provider),
      listGeometryProviders: () => this.ifcGeometryProviders.list(),
      importGeometry: async (providerId: string, source: ArrayBuffer | Uint8Array) => {
        const imported = await this.ifcGeometryProviders.import(providerId, source);
        if (imported.shapes.length) this.setShapes(prev => [...prev, ...imported.shapes]);
        this.log(`Imported ${imported.shapes.length} IFC geometry elements through ${providerId}.`);
        return imported;
      },
    };

    // ─────────────────────────────────────────────────────────────
    // RECONSTRUCTION SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.reconstruction = {
      validateDraft: (draft: ReconstructionDraft) => validateReconstructionDraft(draft),

      checkModelHealth: () => checkModelHealth(this.shapes),

      fromImageObservation: (observation: ImageReconstructionObservation) => imageObservationToDraft(observation),

      recogniseOrthogonalPlan: (image: RasterImageData, options: LocalPlanRecognitionOptions) =>
        imageObservationToDraft(recogniseOrthogonalFloorPlan(image, options)),

      registerImageProvider: (provider: ImageReconstructionProvider) => {
        this.imageReconstructionProviders.register(provider);
      },

      listImageProviders: () => this.imageReconstructionProviders.list(),

      reconstructImage: (providerId: string, request: ImageReconstructionProviderRequest) =>
        this.imageReconstructionProviders.reconstruct(providerId, request),

      reviewDraft: (draft: ReconstructionDraft) => buildReconstructionReview(draft),

      applyReview: (draft: ReconstructionDraft, decisions: Record<string, boolean>) =>
        applyReconstructionReview(draft, decisions),

      commitDraft: (draft: ReconstructionDraft, options?: { includeFurniture?: boolean }) => {
        const result = commitReconstructionDraft(draft, options);
        if (result.shapes.length) {
          const ids = new Set(result.shapes.map(shape => shape.id));
          this.setShapes(prev => [
            ...prev.filter(shape => !ids.has(shape.id)),
            ...result.shapes,
          ]);
        }
        this.log(
          `Reconstruction: accepted ${result.acceptedIds.length}, rejected ${result.rejectedIds.length}, warnings ${result.validation.warnings}.`
        );
        return result;
      },
    };

    // ─────────────────────────────────────────────────────────────
    // INTERIOR DESIGN SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.interiors = {
      listRooms: () => detectRooms(this.shapes),

      addFurniture: (type: InteriorFurnitureType, options?: {
        position?: [number, number, number];
        rotation?: number;
        color?: string;
        roomId?: string;
        params?: FurnitureParams;
      }): Shape => {
        const shape = createInteriorFurnitureShape(type, {
          position: options?.position,
          rotationY: options?.rotation,
          color: options?.color,
          roomId: options?.roomId,
          params: options?.params,
        });
        this.placeBuilt(shape);
        this.log(`Added interior furniture: ${type} at [${shape.position.join(', ')}].`);
        return shape;
      },

      listCatalog: () => interiorFurnitureCatalog(),

      furnishRoom: (roomId: string, preset: FurnishingPreset) => {
        const room = detectRooms(this.shapes).find(candidate => candidate.id === roomId);
        if (!room) throw new Error(`Room not found: ${roomId}`);
        const plan = planRoomFurnishing(this.shapes, room, preset);
        if (plan.shapes.length) {
          this.setShapes(prev => [...prev, ...plan.shapes]);
        }
        this.log(`Furnished room ${roomId} with ${plan.shapes.length} items; ${plan.unplaced.length} unplaced.`);
        return plan;
      },

      bakeSimulation: (shapeId: string, strength?: number) => {
        const source = this.shapes.find(shape => shape.id === shapeId);
        if (!source) throw new Error(`Shape not found: ${shapeId}`);
        const baked = bakeSemanticSimulation(source, strength);
        this.setShapes(prev => prev.map(shape => shape.id === shapeId ? baked : shape));
        this.log(`Baked ${baked.customData?.simulationBake?.type ?? 'simulation'} for ${shapeId}.`);
        return baked;
      },
    };

    // ─────────────────────────────────────────────────────────────
    // LANDSCAPE SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.landscape = {
      addPlant: (speciesId: string = 'english_oak', options?: {
        position?: [number, number, number];
        scale?: number;
        rotation?: number;
        variation?: string;
        color?: string;
      }): Shape => {
        const pos = options?.position || [0, 0, 0];
        const scaleVal = options?.scale ?? 1.0;
        const rotation = options?.rotation ?? 0;
        const spec = PLANT_SPECIES_CATALOG.find(p => p.id === speciesId);
        const isBush = spec ? spec.category === 'bush' || spec.category === 'flower' || spec.category === 'hedge' : speciesId.includes('bush') || speciesId.includes('hedge');
        const type: Shape['type'] = isBush ? 'bush' : 'tree';

        let geom: THREE.BufferGeometry;
        if (isBush) {
          geom = createBushGeometry(speciesId);
        } else {
          geom = createTreeGeometry(speciesId);
        }

        const id = Math.random().toString(36).substr(2, 9);
        const plantShape: Shape = {
          id,
          name: spec ? spec.name : `Plant (${speciesId})`,
          type,
          position: pos,
          rotation: [0, rotation, 0],
          scale: [scaleVal, scaleVal, scaleVal],
          args: [1, 1, 1],
          color: options?.color || (spec ? spec.foliageColor : '#3e7a36'),
          tags: ['landscape', 'plant', type, `species-${speciesId}`],
          customData: {
            speciesId,
            variation: options?.variation,
            category: spec?.category || type
          },
          geometryData: geometryToData(geom)
        };

        this.setShapes(prev => [...prev, plantShape]);
        this.log(`Added plant: ${spec?.name || speciesId} at [${pos.join(', ')}].`);
        return plantShape;
      },

      addSiteFurniture: (type: 'bench' | 'lamp' | 'fence' | 'rock' | 'railing', options?: {
        position?: [number, number, number];
        rotation?: number;
        color?: string;
        length?: number;
        height?: number;
        size?: number;
      }): Shape => {
        const pos = options?.position || [0, 0, 0];
        const rot = options?.rotation ?? 0;
        let geom: THREE.BufferGeometry;
        let defaultColor = '#64748b';

        switch (type) {
          case 'bench':
            geom = createBenchGeometry(options?.length ?? 1.8);
            defaultColor = '#854d0e';
            break;
          case 'lamp':
            geom = createLampGeometry(options?.height ?? 3.2);
            defaultColor = '#334155';
            break;
          case 'fence':
            geom = createFenceGeometry(options?.length ?? 2.4, options?.height ?? 1.1);
            defaultColor = '#a16207';
            break;
          case 'rock':
            geom = createRockGeometry(options?.size ?? 1.2);
            defaultColor = '#6b7280';
            break;
          case 'railing':
          default:
            geom = createRailingGeometry(options?.length ?? 2.0, options?.height ?? 1.0);
            defaultColor = '#475569';
            break;
        }

        const id = Math.random().toString(36).substr(2, 9);
        const furnShape: Shape = {
          id,
          name: `Site Furniture (${type})`,
          type: type as any,
          position: pos,
          rotation: [0, rot, 0],
          args: [1, 1, 1],
          color: options?.color || defaultColor,
          tags: ['landscape', 'site-furniture', type],
          customData: { furnitureType: type },
          geometryData: geometryToData(geom)
        };

        this.setShapes(prev => [...prev, furnShape]);
        this.log(`Added site furniture: ${type} at [${pos.join(', ')}].`);
        return furnShape;
      },

      createTerrain: (options: {
        width: number;
        depth: number;
        resolution: number;
        topography: 'flat' | 'rolling' | 'ridge' | 'terraced';
        roughness?: number;
        heightScale?: number;
        textureId?: string;
        textureScale?: number;
        position?: [number, number, number];
        name?: string;
      }): Shape => {
        const terrainShape = createTerrainShape(options);
        this.setShapes(prev => [...prev, terrainShape]);
        this.log(`Created terrain canvas (${options.width}m x ${options.depth}m, ${options.topography}).`);
        return terrainShape;
      },

      applyTerrainTexture: (textureId: string): void => {
        this.setShapes(prev => prev.map(s => {
          if (s.type === 'terrain' || s.terrainData) {
            return {
              ...s,
              terrainData: {
                ...(s.terrainData || { gridX: 20, gridY: 20, width: 40, depth: 40, heights: [] }),
                textureUrl: textureId
              }
            };
          }
          return s;
        }));
        this.log(`Applied terrain texture preset: ${textureId}.`);
      },

      listPlantCatalog: (): PlantSpecies[] => {
        return PLANT_SPECIES_CATALOG;
      },

      listTerrainTextures: (): LandscapeTexturePreset[] => {
        return LANDSCAPE_TEXTURES;
      },

      configureLandscapeDefaults: (settings: LandscapeConfigDefaults): void => {
        this.landscapeDefaults = { ...this.landscapeDefaults, ...settings };
        if (settings.defaultSpecies && this.extraSetters.setActivePlantSpecies) {
          this.extraSetters.setActivePlantSpecies(settings.defaultSpecies);
        }
        if (settings.defaultScale !== undefined && this.extraSetters.setActivePlantScale) {
          this.extraSetters.setActivePlantScale(settings.defaultScale);
        }
        this.log(`Configured landscape defaults: ${JSON.stringify(settings)}`);
      },

      getLandscapeDefaults: (): LandscapeConfigDefaults => {
        return { ...this.landscapeDefaults };
      },

      configureSculptSettings: (settings: { radius?: number; intensity?: number; mode?: 'push' | 'pull' | 'smooth' | 'flatten' | 'pinch'; masked?: boolean }): void => {
        if (this.extraSetters.setLandscapeSculptSettings) {
          this.extraSetters.setLandscapeSculptSettings((prev: any) => ({ ...prev, ...settings }));
        }
        this.log(`Configured sculpt settings: ${JSON.stringify(settings)}`);
      },

      getSculptSettings: (): any => {
        return this.extraSetters.landscapeSculptSettings || {};
      },

      configureRoadSettings: (settings: { width?: number; embankment?: boolean; roadColor?: string; curbHeight?: number }): void => {
        if (this.extraSetters.setLandscapeRoadSettings) {
          this.extraSetters.setLandscapeRoadSettings((prev: any) => ({ ...prev, ...settings }));
        }
        this.log(`Configured road settings: ${JSON.stringify(settings)}`);
      },

      getRoadSettings: (): any => {
        return this.extraSetters.landscapeRoadSettings || {};
      },

      addFence: (points, options = {}) => this.placeBuilt(buildFence(this.shapes, points, options)),
      addRailing: (points: [number, number, number][], options: { height?: number; color?: string; name?: string } = {}) => {
        if (points.length < 2) throw new Error('landscape.addRailing requires at least two points.');
        const height = Math.max(0.2, options.height ?? 1.0);
        const made: Shape[] = [];
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]!, b = points[i]!;
          const dx = b[0] - a[0], dz = b[2] - a[2], rise = b[1] - a[1];
          const length = Math.hypot(dx, dz);
          if (length < 0.01) continue;
          const geom = createRailingGeometry(length, height, rise);
          const angle = Math.atan2(dz, dx);
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
          const shape: Shape = {
            id: Math.random().toString(36).slice(2, 11),
            name: options.name ? `${options.name} ${i}` : `Railing ${this.shapes.filter(s => s.type === 'railing').length + made.length + 1}`,
            type: 'railing',
            position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
            quaternion: [q.x, q.y, q.z, q.w],
            args: [length, height, 0.08],
            color: options.color ?? '#475569',
            tags: ['landscape', 'railing', 'guardrail'],
            geometryData: geometryToData(geom),
            customData: { railing: { start: a, end: b, rise } },
          };
          geom.dispose();
          made.push(shape);
        }
        if (made.length) this.setShapes(prev => [...prev, ...made]);
        return made;
      },
      addPond: (points, options = {}) => this.placeBuilt(buildWaterBody(this.shapes, points, options)),
      updatePond: (id, changes) => {
        this.setShapes(prev => prev.map(shape => {
          if (shape.id !== id || shape.type !== 'water' || !shape.waterData) return shape;
          const flow = changes.flow === null ? undefined : changes.flow === undefined ? shape.waterData.flow : {
            ...shape.waterData.flow,
            ...changes.flow,
            ...(changes.flow.speed !== undefined ? { speed: Math.max(0, changes.flow.speed) } : {}),
            ...(changes.flow.turbulence !== undefined ? { turbulence: Math.max(0, Math.min(1, changes.flow.turbulence)) } : {}),
          };
          return {
            ...shape,
            ...(changes.name !== undefined ? { name: changes.name } : {}),
            ...(changes.level !== undefined ? { position: [shape.position[0], changes.level, shape.position[2]] as [number, number, number] } : {}),
            waterData: {
              ...shape.waterData,
              ...(changes.depth !== undefined ? { depth: Math.max(0.01, changes.depth) } : {}),
              ...(changes.clarity !== undefined ? { clarity: changes.clarity } : {}),
              ...(changes.dig !== undefined ? { dig: changes.dig } : {}),
              flow,
            },
          };
        }));
      },
      addPatio: (points, options = {}) => this.placeBuilt(buildPatio(this.shapes, points, options)),
      updatePatio: (id, changes) => {
        this.setShapes(prev => prev.map(shape => {
          if (shape.id !== id || shape.type !== 'patio' || !shape.patioData) return shape;
          const settings = changes.settings ?? {};
          return {
            ...shape,
            ...(changes.name !== undefined ? { name: changes.name } : {}),
            ...(changes.level !== undefined ? { position: [shape.position[0], changes.level, shape.position[2]] as [number, number, number] } : {}),
            patioData: {
              ...shape.patioData,
              ...settings,
              ...(changes.steps !== undefined ? {
                steps: changes.steps.map(step => ({
                  edge: Math.max(0, Math.floor(step.edge)),
                  t: Math.max(0, Math.min(1, step.t)),
                  width: Math.max(0.1, step.width),
                })),
              } : {}),
              ...((settings as any).lights ? { lights: { ...shape.patioData.lights, ...(settings as any).lights } } : {}),
            },
          };
        }));
      },
    };

    // ─────────────────────────────────────────────────────────────
    // CIVIL / TERRAIN MODIFIER SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    const getTerrainModifiers = (): TerrainModifier[] => (this.extraSetters.terrainModifiers ?? []) as TerrainModifier[];
    const setTerrainModifiers = (updater: TerrainModifier[] | ((prev: TerrainModifier[]) => TerrainModifier[])) => {
      const prev = getTerrainModifiers();
      const next = typeof updater === 'function' ? updater(prev) : updater;
      this.extraSetters.terrainModifiers = next;
      this.extraSetters.setTerrainModifiers?.(next);
      return next;
    };
    this.civil = {
      list: () => [...getTerrainModifiers()],
      addRoad: (options) => {
        if (!Array.isArray(options.points) || options.points.length < 2) throw new Error('civil.addRoad requires at least two points.');
        const settings = this.extraSetters.civilRoadSettings ?? {};
        const profile: CurbDitchProfile = {
          width: options.profile?.width ?? settings.curbWidth ?? 0.15,
          height: options.profile?.height ?? settings.curbHeight ?? 0.15,
          ditchWidth: options.profile?.ditchWidth ?? settings.ditchWidth ?? 1.2,
          ditchDepth: options.profile?.ditchDepth ?? settings.ditchDepth ?? 0.35,
          hasCurb: options.profile?.hasCurb ?? settings.hasCurb ?? true,
          hasDitch: options.profile?.hasDitch ?? settings.hasDitch ?? false,
        };
        const road: RoadModifier = {
          id: `road-${Math.random().toString(36).slice(2, 10)}`,
          name: options.name ?? `Road ${getTerrainModifiers().filter(m => m.type === 'road').length + 1}`,
          type: 'road',
          enabled: options.enabled ?? true,
          points: options.points.map(p => [p[0], p[1], p[2]]),
          width: Math.max(0.1, options.width ?? settings.width ?? 6),
          maxGradePercent: Math.max(0, options.maxGradePercent ?? settings.maxGradePercent ?? 8),
          bankingAngle: options.bankingAngle ?? 0,
          profile,
          markings: options.markings ?? settings.markings ?? 'center-dashed',
          material: options.material ?? settings.material ?? 'asphalt-weathered',
          ...(options.batterDistance !== undefined ? { batterDistance: Math.max(0, options.batterDistance) } : {}),
        };
        setTerrainModifiers(prev => [...prev, road]);
        return road;
      },
      addPad: (options) => {
        const settings = this.extraSetters.civilPadSettings ?? {};
        const dimensions = options.dimensions ?? settings.dimensions ?? [18, 12];
        const pad: PadModifier = {
          id: `pad-${Math.random().toString(36).slice(2, 10)}`,
          name: options.name ?? `Pad ${getTerrainModifiers().filter(m => m.type === 'pad').length + 1}`,
          type: 'pad',
          enabled: options.enabled ?? true,
          primitive: options.primitive ?? settings.primitive ?? 'rectangle',
          center: [...options.center],
          dimensions: [Math.max(0.1, dimensions[0]), Math.max(0.1, dimensions[1])],
          rotationY: options.rotationY ?? 0,
          targetElevation: options.targetElevation ?? settings.targetElevation ?? 1.5,
          batterDistance: Math.max(0, options.batterDistance ?? settings.batterDistance ?? 3),
          batterProfile: options.batterProfile ?? settings.batterProfile ?? 'linear',
        };
        setTerrainModifiers(prev => [...prev, pad]);
        return pad;
      },
      setPadSurface: (padId, options) => {
        setTerrainModifiers(prev => prev.map(mod => {
          if (mod.id !== padId || mod.type !== 'pad') return mod;
          if (options === null) return { ...mod, surfaceModifier: undefined };
          const defaults = this.extraSetters.civilStripingSettings ?? {};
          const surface: SurfaceModifier = {
            id: mod.surfaceModifier?.id ?? `surface-${Math.random().toString(36).slice(2, 10)}`,
            name: options.name ?? mod.surfaceModifier?.name ?? 'Pad surface',
            type: 'surface',
            enabled: options.enabled ?? true,
            hostPadId: padId,
            pattern: options.pattern,
            ...(options.pattern === 'parking-striping' ? {
              parkingConfig: {
                angle: options.parkingConfig?.angle ?? defaults.angle ?? 90,
                stallWidth: options.parkingConfig?.stallWidth ?? defaults.stallWidth ?? 2.7,
                stallDepth: options.parkingConfig?.stallDepth ?? defaults.stallDepth ?? 5.5,
                stripeColor: options.parkingConfig?.stripeColor ?? defaults.stripeColor ?? '#FFFFFF',
                doubleRow: options.parkingConfig?.doubleRow ?? defaults.doubleRow ?? false,
              },
            } : {}),
          };
          return { ...mod, surfaceModifier: surface };
        }));
      },
      update: (id, changes) => {
        setTerrainModifiers(prev => prev.map(mod => mod.id === id ? ({ ...mod, ...changes, id: mod.id, type: mod.type } as TerrainModifier) : mod));
      },
      remove: (id) => {
        setTerrainModifiers(prev => prev.filter(mod => mod.id !== id && !(mod.type === 'surface' && mod.hostPadId === id)));
      },
      clear: () => setTerrainModifiers([]),
    };

    // ─────────────────────────────────────────────────────────────
    // MATERIALS & PBR SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.materials = {
      applyMaterial: (target: Shape | string, material: string | {
        color?: string;
        roughness?: number;
        metalness?: number;
        opacity?: number;
        textureUrl?: string;
        normalMapUrl?: string;
        normalScale?: number;
        roughnessMapUrl?: string;
        metalnessMapUrl?: string;
        aoMapUrl?: string;
        aoMapIntensity?: number;
        displacementMapUrl?: string;
        displacementScale?: number;
        uvScale?: number;
      }): void => {
        const targetId = typeof target === 'string' ? target : target.id;
        this.setShapes(prev => prev.map(s => {
          if (s.id !== targetId) return s;
          if (typeof material === 'string') {
            if (material.startsWith('#') || material.startsWith('rgb')) {
              return { ...s, color: material };
            }
            // Named preset (e.g. 'red-brick') - apply its real color/roughness/
            // metalness and whatever real texture maps it carries, and clear any
            // maps a previous preset left behind that this one doesn't supply.
            const preset = getMaterialPreset(material);
            if (!preset) {
              this.log(`Unknown material preset "${material}" - see sdk.materials.listPresets().`);
              return s;
            }
            return {
              ...s,
              color: preset.color,
              roughness: preset.roughness,
              metalness: preset.metalness,
              opacity: preset.opacity ?? 1.0,
              materialPreset: preset.id,
              textureUrl: preset.textureUrl,
              normalMapUrl: preset.normalMapUrl,
              roughnessMapUrl: preset.roughnessMapUrl,
              metalnessMapUrl: preset.metalnessMapUrl,
              aoMapUrl: preset.aoMapUrl,
              displacementMapUrl: preset.displacementMapUrl,
              tags: [...(s.tags || []).filter(t => !t.startsWith('material-')), `material-${preset.id}`]
            };
          }
          return {
            ...s,
            color: material.color ?? s.color,
            roughness: material.roughness ?? s.roughness ?? 0.5,
            metalness: material.metalness ?? s.metalness ?? 0.0,
            opacity: material.opacity ?? s.opacity ?? 1.0,
            textureUrl: material.textureUrl ?? s.textureUrl,
            normalMapUrl: material.normalMapUrl ?? s.normalMapUrl,
            normalScale: material.normalScale ?? s.normalScale,
            roughnessMapUrl: material.roughnessMapUrl ?? s.roughnessMapUrl,
            metalnessMapUrl: material.metalnessMapUrl ?? s.metalnessMapUrl,
            aoMapUrl: material.aoMapUrl ?? s.aoMapUrl,
            aoMapIntensity: material.aoMapIntensity ?? s.aoMapIntensity,
            displacementMapUrl: material.displacementMapUrl ?? s.displacementMapUrl,
            displacementScale: material.displacementScale ?? s.displacementScale,
            materialPreset: undefined
          };
        }));
        this.log(`Applied material to ${targetId}: ${typeof material === 'string' ? material : JSON.stringify(material)}`);
      },

      setEdgeLines: (settings: { enabled?: boolean; color?: string; opacity?: number; thickness?: number }): void => {
        if (settings.enabled !== undefined && this.extraSetters.setEdgeLinesEnabled) {
          this.extraSetters.setEdgeLinesEnabled(settings.enabled);
        }
        if (settings.color !== undefined && this.extraSetters.setEdgeLinesColor) {
          this.extraSetters.setEdgeLinesColor(settings.color);
        }
        if (settings.opacity !== undefined && this.extraSetters.setEdgeLinesOpacity) {
          this.extraSetters.setEdgeLinesOpacity(settings.opacity);
        }
        if (settings.thickness !== undefined && this.extraSetters.setEdgeLinesThickness) {
          this.extraSetters.setEdgeLinesThickness(settings.thickness);
        }
        this.log(`Configured edge lines: ${JSON.stringify(settings)}`);
      },

      listPresets: (): string[] => {
        return MATERIAL_PRESETS.map(p => p.id);
      },

      configureMaterialDefaults: (settings: MaterialConfigDefaults): void => {
        this.materialDefaults = { ...this.materialDefaults, ...settings };
        if (this.extraSetters.setActivePBR) {
          this.extraSetters.setActivePBR((prev: any) => ({ ...prev, ...settings }));
        }
        this.log(`Configured material defaults: ${JSON.stringify(settings)}`);
      },

      getMaterialDefaults: (): MaterialConfigDefaults => {
        return { ...this.materialDefaults };
      }
    };

    // ─────────────────────────────────────────────────────────────
    // MEASUREMENT & DIMENSIONING SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.measurement = {
      measureDistance: (p1: [number, number, number], p2: [number, number, number]): {
        distance: number;
        dx: number;
        dy: number;
        dz: number;
        horizontalRun: number;
        rise: number;
        pitchDeg: number;
        formatted: string;
      } => {
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const dz = p2[2] - p1[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const horiz = Math.sqrt(dx * dx + dz * dz);
        const pitchDeg = (Math.atan2(Math.abs(dy), Math.max(0.0001, horiz)) * 180) / Math.PI;
        const currentUnit = this.extraSetters.unit || 'm';

        let formatted = `${dist.toFixed(3)}m`;
        if (currentUnit === 'mm') formatted = `${(dist * 1000).toFixed(0)}mm`;
        else if (currentUnit === 'cm') formatted = `${(dist * 100).toFixed(1)}cm`;

        return { distance: dist, dx, dy, dz, horizontalRun: horiz, rise: dy, pitchDeg, formatted };
      },

      addDimension: (
        start: [number, number, number],
        end: [number, number, number],
        labelOrOptions?: string | { text?: string; offset?: [number, number, number] },
      ): Shape => {
        const info = this.measurement.measureDistance(start, end);
        const options = typeof labelOrOptions === 'string' ? { text: labelOrOptions } : (labelOrOptions ?? {});
        const offset = options.offset ?? [0, 0, 0];
        const args = makeDimensionArgs(start, end, offset);
        if (options.text) args.text = options.text;
        const id = Math.random().toString(36).substr(2, 9);
        const dimShape: Shape = {
          id,
          name: `Dimension ${options.text || info.formatted}`,
          type: 'measurement',
          position: [
            (start[0] + end[0]) / 2 + offset[0],
            (start[1] + end[1]) / 2 + offset[1],
            (start[2] + end[2]) / 2 + offset[2],
          ],
          args,
          color: '#0284c7',
          tags: ['annotation', 'dimension', 'measurement'],
          customData: {
            start,
            end,
            distance: info.distance,
            label: options.text || info.formatted,
          },
        };
        this.setShapes(prev => [...prev, dimShape]);
        this.log(`Added dimension: ${options.text || info.formatted} from [${start}] to [${end}].`);
        return dimShape;
      },

      addAreaLabel: (faceId: number, anchor?: [number, number, number], position?: [number, number, number]): Shape | null => {
        const host = this.extraSetters.kernelHost as KernelArcHost | undefined;
        if (!host) {
          this.log('Area label not added: geometry kernel is not available.');
          return null;
        }
        const measured = measureFace(host.graph, faceId as FaceId);
        const face = host.graph.faces.get(faceId as FaceId);
        if (!measured || !face) {
          this.log(`Area label not added: face ${faceId} was not found or could not be measured.`);
          return null;
        }
        const a = anchor ?? [face.plane.point.x, face.plane.point.y, face.plane.point.z] as [number, number, number];
        const lift = 0.05;
        const p = position ?? [
          a[0] + face.plane.normal.x * lift,
          a[1] + face.plane.normal.y * lift,
          a[2] + face.plane.normal.z * lift,
        ] as [number, number, number];
        const args: AreaLabelArgs = { kind: 'area', faceId, anchor: a, position: p, area: measured.area, perimeter: measured.perimeter };
        const shape: Shape = {
          id: Math.random().toString(36).slice(2, 11),
          name: 'Area label',
          type: 'measurement',
          position: a,
          args,
          color: '#10b981',
          tags: ['annotation', 'area', 'measurement'],
        };
        this.setShapes(prev => [...prev, shape]);
        return shape;
      },

      addLeader: (target: [number, number, number], anchor: [number, number, number], text: string): Shape => {
        const clean = text.trim();
        const args: LeaderArgs = { kind: 'leader', target, anchor, text: clean };
        const shape: Shape = {
          id: Math.random().toString(36).slice(2, 11),
          name: `Label: ${clean.slice(0, 24)}`,
          type: 'measurement',
          position: anchor,
          args,
          color: '#f59e0b',
          tags: ['annotation', 'leader', 'measurement'],
        };
        this.setShapes(prev => [...prev, shape]);
        return shape;
      },

      addGuide: (point, direction, distance = 0, reach = 100) => {
        const p = new THREE.Vector3(...point);
        const d = new THREE.Vector3(...direction);
        if (d.lengthSq() < 1e-12) throw new Error('Guide direction must not be zero.');
        const args = makeGuideArgs(p, d, distance, reach);
        const shape: Shape = {
          id: Math.random().toString(36).slice(2, 11),
          name: 'Guide',
          type: 'measurement',
          position: point,
          args,
          color: '#60a5fa',
          tags: ['annotation', 'guide', 'measurement'],
        };
        this.setShapes(prev => [...prev, shape]);
        return shape;
      },
      addProtractor: (options) => {
        const centre = new THREE.Vector3(...options.centre);
        const base = new THREE.Vector3(...options.base);
        const normal = new THREE.Vector3(...(options.normal ?? [0, 1, 0]));
        if (base.lengthSq() < 1e-12 || normal.lengthSq() < 1e-12) throw new Error('Protractor base and normal must not be zero.');
        normal.normalize();
        // Remove any component of the base along the normal so the saved protractor is planar.
        base.addScaledVector(normal, -base.dot(normal));
        if (base.lengthSq() < 1e-12) throw new Error('Protractor base must not be parallel to its normal.');
        base.normalize();
        const direction = base.clone().applyAxisAngle(normal, THREE.MathUtils.degToRad(options.angle)).normalize();
        const start = centre.clone().addScaledVector(direction, -40);
        const end = centre.clone().addScaledVector(direction, 40);
        const args: ProtractorArgs = {
          kind: 'protractor',
          centre: centre.toArray() as [number, number, number],
          base: base.toArray() as [number, number, number],
          direction: direction.toArray() as [number, number, number],
          normal: normal.toArray() as [number, number, number],
          angle: options.angle,
          radius: THREE.MathUtils.clamp(options.radius ?? 1.5, 0.3, 3),
          start: start.toArray() as [number, number, number],
          end: end.toArray() as [number, number, number],
          distance: 40 * 2,
        };
        const shape: Shape = {
          id: Math.random().toString(36).slice(2, 11),
          name: `Angle ${Math.abs(options.angle).toFixed(1)}°`,
          type: 'measurement',
          position: options.centre,
          args,
          color: '#0ea5e9',
          tags: ['annotation', 'protractor', 'guide', 'measurement'],
        };
        this.setShapes(prev => [...prev, shape]);
        return shape;
      },
      listGuides: () => this.shapes.filter(isGuideShape),
      deleteGuides: () => {
        const ids = new Set(this.shapes.filter(isGuideShape).map(shape => shape.id));
        this.setShapes(prev => prev.filter(shape => !ids.has(shape.id)));
        return ids.size;
      },

      setUnit: (unit: 'm' | 'cm' | 'mm'): void => {
        if (!['m', 'cm', 'mm'].includes(unit)) {
          this.log(`Unknown unit "${unit}" - use 'm', 'cm' or 'mm'.`);
          return;
        }
        if (this.extraSetters.setUnit) {
          this.extraSetters.setUnit(unit);
        }
        this.log(`Set active system units to: ${unit}.`);
      },

      getUnit: (): string => {
        return this.extraSetters.unit || 'm';
      },

      configureMeasurementSettings: (settings: MeasurementConfigDefaults): void => {
        this.measurementDefaults = { ...this.measurementDefaults, ...settings };
        if (settings.unit && this.extraSetters.setUnit) {
          this.extraSetters.setUnit(settings.unit);
        }
        this.log(`Configured measurement settings: ${JSON.stringify(settings)}`);
      },

      getMeasurementSettings: (): MeasurementConfigDefaults => {
        return { ...this.measurementDefaults };
      }
    };

    // ─────────────────────────────────────────────────────────────
    // SECTION PLANE SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.sections = {
      create: (options) => {
        const n = new THREE.Vector3(...options.normal);
        if (n.lengthSq() < 1e-12) throw new Error('Section normal must not be zero.');
        n.normalize();
        const args: SectionArgs = {
          kind: 'section',
          point: options.point,
          normal: [n.x, n.y, n.z],
          active: options.active ?? true,
          size: Math.max(0.1, options.size ?? 6),
          ...(options.showPlane !== undefined ? { showPlane: options.showPlane } : {}),
          ...(options.xrayColor !== undefined ? { xrayColor: options.xrayColor } : {}),
          ...(options.xrayOpacity !== undefined ? { xrayOpacity: Math.max(0, Math.min(1, options.xrayOpacity)) } : {}),
          ...(options.exempt?.length ? { exempt: [...options.exempt] } : {}),
        };
        const id = Math.random().toString(36).slice(2, 11);
        const count = this.shapes.filter(isSectionShape).length;
        if (args.active) {
          this.setShapes(prev => [
            ...prev.map(sh => isSectionShape(sh) && (sh.args as SectionArgs).active
              ? { ...sh, args: { ...(sh.args as SectionArgs), active: false } }
              : sh),
            { id, name: options.name ?? `Section ${count + 1}`, type: 'measurement', position: args.point, args, color: '#f97316' } as Shape,
          ]);
        } else {
          this.setShapes(prev => [...prev, { id, name: options.name ?? `Section ${count + 1}`, type: 'measurement', position: args.point, args, color: '#f97316' } as Shape]);
        }
        return this.shapes.find(sh => sh.id === id)!;
      },
      list: () => this.shapes.filter(isSectionShape),
      setActive: (id, active = true) => {
        this.setShapes(prev => prev.map(sh => {
          if (!isSectionShape(sh)) return sh;
          const args = sh.args as SectionArgs;
          if (sh.id === id) return { ...sh, args: { ...args, active } };
          return active && args.active ? { ...sh, args: { ...args, active: false } } : sh;
        }));
      },
      move: (id, distance) => {
        this.setShapes(prev => prev.map(sh => {
          if (sh.id !== id || !isSectionShape(sh)) return sh;
          const args = moveSection(sh.args as SectionArgs, distance);
          return { ...sh, args, position: args.point };
        }));
      },
      flip: (id) => {
        this.setShapes(prev => prev.map(sh => sh.id === id && isSectionShape(sh)
          ? { ...sh, args: flipSection(sh.args as SectionArgs) }
          : sh));
      },
      setLayerCut: (id, layer, cut) => {
        this.setShapes(prev => prev.map(sh => sh.id === id && isSectionShape(sh)
          ? { ...sh, args: withLayerCut(sh.args as SectionArgs, layer, cut) }
          : sh));
      },
      update: (id, changes) => {
        this.setShapes(prev => prev.map(sh => {
          if (sh.id !== id || !isSectionShape(sh)) return sh;
          const current = sh.args as SectionArgs;
          const args: SectionArgs = {
            ...current,
            ...changes,
            ...(changes.xrayOpacity !== undefined ? { xrayOpacity: Math.max(0, Math.min(1, changes.xrayOpacity)) } : {}),
          };
          return { ...sh, args };
        }));
      },
      remove: (id) => {
        this.setShapes(prev => prev.filter(sh => sh.id !== id || !isSectionShape(sh)));
      },
    };

    // ─────────────────────────────────────────────────────────────
    // SELECTION & TRANSFORM SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.selection = {
      select: (idOrIds: string | string[]): void => {
        const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
        this.selectedId = ids[0] || null;
        if (this.extraSetters.setSelectedIds) {
          this.extraSetters.setSelectedIds(ids);
        }
        if (this.extraSetters.setSelectedId) {
          this.extraSetters.setSelectedId(ids[0] || null);
        }
        this.log(`Selected ${ids.length} object(s): ${ids.join(', ')}`);
      },

      deselectAll: (): void => {
        if (this.extraSetters.setSelectedIds) this.extraSetters.setSelectedIds([]);
        if (this.extraSetters.setSelectedId) this.extraSetters.setSelectedId(null);
        this.log('Cleared selection.');
      },

      getSelected: (): Shape[] => {
        const selectedIds = this.extraSetters.selectedIds || (this.selectedId ? [this.selectedId] : []);
        return this.shapes.filter(s => selectedIds.includes(s.id));
      },

      group: (ids: string[], groupName?: string): string => {
        const groupId = `group-${Math.random().toString(36).substr(2, 7)}`;
        const gName = groupName || `Group (${ids.length} items)`;
        this.setShapes(prev => prev.map(s => {
          if (ids.includes(s.id)) {
            return {
              ...s,
              tags: [...(s.tags || []).filter(t => !t.startsWith('group:')), `group:${groupId}`],
              customData: { ...(s.customData || {}), groupId, groupName: gName }
            };
          }
          return s;
        }));
        this.log(`Grouped ${ids.length} objects into "${gName}" (${groupId}).`);
        return groupId;
      },

      ungroup: (groupIdOrIds: string | string[]): void => {
        const isGroupString = typeof groupIdOrIds === 'string' && groupIdOrIds.startsWith('group-');
        this.setShapes(prev => prev.map(s => {
          const sGroupId = s.customData?.groupId;
          const shouldUngroup = isGroupString ? sGroupId === groupIdOrIds : Array.isArray(groupIdOrIds) ? groupIdOrIds.includes(s.id) : s.id === groupIdOrIds;
          if (shouldUngroup) {
            const { groupId, groupName, ...restCustom } = s.customData || {};
            return {
              ...s,
              tags: (s.tags || []).filter(t => !t.startsWith('group:')),
              customData: restCustom
            };
          }
          return s;
        }));
        this.log(`Ungrouped target objects.`);
      },

      duplicateObject: (id: string, offset: [number, number, number] = [1, 0, 1]): Shape | null => {
        const orig = this.shapes.find(s => s.id === id);
        if (!orig) {
          this.log(`Object ${id} not found to duplicate.`);
          return null;
        }
        const newId = Math.random().toString(36).substr(2, 9);
        const newPos: [number, number, number] = [
          orig.position[0] + offset[0],
          orig.position[1] + offset[1],
          orig.position[2] + offset[2]
        ];
        const copy: Shape = {
          ...orig,
          id: newId,
          name: `${orig.name || 'Object'} (Copy)`,
          position: newPos,
          customData: { ...(orig.customData || {}) }
        };
        this.setShapes(prev => [...prev, copy]);
        this.log(`Duplicated object ${id} -> ${newId} with offset [${offset.join(', ')}].`);
        return copy;
      },

      hideObject: (id: string, hidden: boolean): void => {
        this.setShapes(prev => prev.map(s => s.id === id ? { ...s, hidden } : s));
        this.log(`${hidden ? 'Hidden' : 'Shown'} object ${id}.`);
      },

      isolateObject: (id: string): void => {
        this.setShapes(prev => prev.map(s => ({
          ...s,
          hidden: s.id !== id
        })));
        this.log(`Isolated object ${id}. All other objects hidden.`);
      },

      unhideAll: (): void => {
        this.setShapes(prev => prev.map(s => ({
          ...s,
          hidden: false
        })));
        this.log('Unhid all objects in the scene.');
      },

      transformObject: (id: string, transform: {
        position?: [number, number, number];
        rotation?: [number, number, number];
        scale?: [number, number, number];
      }): void => {
        this.setShapes(prev => prev.map(s => {
          if (s.id !== id) return s;
          return {
            ...s,
            position: transform.position || s.position,
            rotation: transform.rotation || s.rotation,
            scale: transform.scale || s.scale
          };
        }));
        this.log(`Transformed object ${id}: ${JSON.stringify(transform)}`);
      },

      alignObjects: (ids: string[], axis: 'x' | 'y' | 'z', alignment: 'min' | 'center' | 'max'): void => {
        const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
        const targets = this.shapes.filter(s => ids.includes(s.id));
        if (targets.length < 2) return;

        const vals = targets.map(s => s.position[axisIdx]);
        let targetVal: number;
        if (alignment === 'min') targetVal = Math.min(...vals);
        else if (alignment === 'max') targetVal = Math.max(...vals);
        else targetVal = vals.reduce((a, b) => a + b, 0) / vals.length;

        this.setShapes(prev => prev.map(s => {
          if (!ids.includes(s.id)) return s;
          const newPos = [...s.position] as [number, number, number];
          newPos[axisIdx] = targetVal;
          return { ...s, position: newPos };
        }));
        this.log(`Aligned ${targets.length} objects along ${axis.toUpperCase()} (${alignment} = ${targetVal.toFixed(2)}).`);
      },

      setFilter: (filter: 'all' | 'shapes' | 'surfaces'): void => {
        if (this.extraSetters.setSelectionFilter) {
          this.extraSetters.setSelectionFilter(filter);
        }
        this.log(`Set selection filter to: ${filter}`);
      },

      setMode: (mode: 'lasso' | 'marquee'): void => {
        if (this.extraSetters.setSelectionShapeMode) {
          this.extraSetters.setSelectionShapeMode(mode);
        }
        this.log(`Set selection mode to: ${mode}`);
      }
    };

    // ─────────────────────────────────────────────────────────────
    // CAMERA & PRESENTATION SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.camera = {
      setNavigationMode: (mode) => {
        this.extraSetters.setActiveTool?.(mode);
        this.log(`Camera navigation mode: ${mode}.`);
      },
      configureWalk: (settings) => {
        if (settings.movementSpeed !== undefined) this.extraSetters.setWalkMovementSpeed?.(settings.movementSpeed);
        if (settings.mouseSensitivity !== undefined) this.extraSetters.setWalkMouseSensitivity?.(settings.mouseSensitivity);
      },
      getWalkSettings: () => ({
        movementSpeed: this.extraSetters.walkMovementSpeed,
        mouseSensitivity: this.extraSetters.walkMouseSensitivity,
      }),
      setProjection: (mode: 'perspective' | 'orthographic'): void => {
        window.dispatchEvent(new CustomEvent('set-camera-projection', { detail: { mode } }));
        this.log(`Switched camera projection to: ${mode}`);
      },

      resetView: (view: 'perspective' | 'plan' | 'front' | 'rear' | 'left' | 'right'): void => {
        window.dispatchEvent(new CustomEvent('trigger-view-reset', { detail: { view } }));
        this.log(`Reset view to: ${view}`);
      },

      setDepthClipping: (settings: { enabled?: boolean; near?: number; far?: number }): void => {
        if (settings.enabled !== undefined && this.extraSetters.setCameraDepthClippingEnabled) {
          this.extraSetters.setCameraDepthClippingEnabled(settings.enabled);
        }
        if (settings.near !== undefined && this.extraSetters.setCameraNear) {
          this.extraSetters.setCameraNear(settings.near);
        }
        if (settings.far !== undefined && this.extraSetters.setCameraFar) {
          this.extraSetters.setCameraFar(settings.far);
        }
        this.log(`Updated camera depth clipping: ${JSON.stringify(settings)}`);
      },

      setAutoOrbit: (enabled: boolean, speed?: number): void => {
        if (this.extraSetters.setAutoOrbitEnabled) {
          this.extraSetters.setAutoOrbitEnabled(enabled);
        }
        if (speed !== undefined && this.extraSetters.setOrbitRotationSpeed) {
          this.extraSetters.setOrbitRotationSpeed(speed);
        }
        this.log(`Set auto-orbit: ${enabled}${speed !== undefined ? ` (speed: ${speed})` : ''}`);
      },

      focusObject: (id: string): void => {
        const mesh = this.shapes.find(s => s.id === id);
        if (mesh) {
          window.dispatchEvent(new CustomEvent('set-camera', { 
            detail: { 
              target: mesh.position,
              position: [mesh.position[0] + 5, mesh.position[1] + 5, mesh.position[2] + 5]
            } 
          }));
          this.log(`Focused camera on object ${id}.`);
        }
      },

      setCameraDefaults: (position: [number, number, number], target: [number, number, number]): void => {
        if (this.extraSetters.setDefaultCameraPosition) this.extraSetters.setDefaultCameraPosition(position);
        if (this.extraSetters.setDefaultCameraTarget) this.extraSetters.setDefaultCameraTarget(target);
        this.log(`Set camera defaults: pos [${position.join(', ')}], target [${target.join(', ')}].`);
      },

      setZoom: (zoom: number): void => {
        window.dispatchEvent(new CustomEvent('set-camera', { detail: { zoom } }));
        this.log(`Set camera zoom factor to: ${zoom}`);
      }
    };

    // ─────────────────────────────────────────────────────────────
    // AI SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.ai = {
      generateModel: (prompt: string): void => {
        if (this.extraSetters.setIsAIGenerateOpen) {
          this.extraSetters.setIsAIGenerateOpen(true);
        }
        this.log(`Opened AI 3D Generator with prompt: "${prompt}"`);
      },

      openRenderer: (prompt?: string, style?: string): void => {
        if (this.extraSetters.setIsAIRendererOpen) {
          this.extraSetters.setIsAIRendererOpen(true);
        }
        this.log(`Opened AI Architectural Renderer.`);
      },

      askAssistant: (query?: string): void => {
        if (this.extraSetters.setIsAIQueryOpen) {
          this.extraSetters.setIsAIQueryOpen(true);
        }
        this.log(`Opened AI Architectural Assistant.`);
      },

      openPhotoTo3D: (): void => {
        window.dispatchEvent(new CustomEvent('polyform:photo-to-3d'));
        this.log('Opened Photo to 3D.');
      }
    };

    // ─────────────────────────────────────────────────────────────
    // PERFORMANCE PROFILER SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.performance = {
      setEnabled: (enabled: boolean): void => {
        this.extraSetters.setPerfProfilerEnabled?.(enabled);
        this.log(`Performance profiler ${enabled ? 'enabled' : 'disabled'}.`);
      },
      isEnabled: (): boolean => Boolean(this.extraSetters.perfProfilerEnabled),
      startBenchmark: (): void => {
        this.extraSetters.setPerfProfilerEnabled?.(true);
        perfStore.startBenchmark();
        this.log('Started performance fly-around benchmark.');
      },
      startRecording: (): void => {
        this.extraSetters.setPerfProfilerEnabled?.(true);
        perfStore.startRecording();
        this.log('Started performance recording.');
      },
      stop: (): void => {
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('polyform-perf-stop'));
      },
      cancel: (): void => {
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('polyform-perf-cancel'));
      },
      getState: (): PerfState => perfStore.getState(),
      listRuns: (): PerfRun[] => [...perfStore.getState().runs],
      latest: (): PerfRun | null => perfStore.getState().runs.at(-1) ?? null,
      latestComparison: () => perfStore.latestComparison(),
      removeRun: (id: string): void => perfStore.removeRun(id),
      clearRuns: (): void => perfStore.clearRuns(),
      toMarkdown: (runOrId?: PerfRun | string): string | null => {
        const runs = perfStore.getState().runs;
        const run = typeof runOrId === 'string'
          ? runs.find(candidate => candidate.id === runOrId) ?? null
          : runOrId ?? runs.at(-1) ?? null;
        return run ? runToMarkdown(run) : null;
      },
    };

    // ─────────────────────────────────────────────────────────────
    // SCENE & STATS SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.scene = {
      exportJSON: (): string => {
        const json = JSON.stringify(this.shapes, null, 2);
        this.log(`Exported scene (${this.shapes.length} shapes, ${(json.length / 1024).toFixed(1)} KB).`);
        return json;
      },

      importJSON: (jsonString: string): void => {
        try {
          const parsed = JSON.parse(jsonString);
          if (Array.isArray(parsed)) {
            this.setShapes(parsed);
            this.log(`Imported ${parsed.length} shapes into active scene.`);
          }
        } catch (err: any) {
          this.log(`Error importing scene JSON: ${err.message}`);
        }
      },

      clearScene: (confirm: boolean = true): void => {
        if (confirm) {
          this.setShapes([]);
          this.log('Scene cleared completely.');
        }
      },

      getStats: (): {
        shapeCount: number;
        typeCounts: Record<string, number>;
        estimatedVertices: number;
        memoryEstimateKB: number;
        bounds: { min: [number, number, number]; max: [number, number, number] };
      } => {
        const typeCounts: Record<string, number> = {};
        let vertices = 0;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (const s of this.shapes) {
          typeCounts[s.type] = (typeCounts[s.type] || 0) + 1;
          if (s.geometryData?.positions) {
            vertices += s.geometryData.positions.length / 3;
          } else {
            vertices += 24;
          }
          const [x, y, z] = s.position;
          minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
        }

        if (this.shapes.length === 0) {
          minX = minY = minZ = maxX = maxY = maxZ = 0;
        }

        return {
          shapeCount: this.shapes.length,
          typeCounts,
          estimatedVertices: Math.round(vertices),
          memoryEstimateKB: Math.round((JSON.stringify(this.shapes).length * 2) / 1024),
          bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
        };
      },

      undo: (): void => {
        if (this.extraSetters.undo) this.extraSetters.undo();
        this.log('Triggered undo.');
      },

      redo: (): void => {
        if (this.extraSetters.redo) this.extraSetters.redo();
        this.log('Triggered redo.');
      },

      saveScene: (name: string): void => {
        this.saveScene(name);
      },

      getShapeGeometry: (id: string): { positions: number[]; normals: number[]; uvs?: number[] } | null => {
        const shape = this.shapes.find(s => s.id === id);
        if (!shape) return null;
        if (shape.geometryData?.positions?.length) {
          return {
            positions: shape.geometryData.positions,
            normals: shape.geometryData.normals || [],
            uvs: shape.geometryData.uvs
          };
        }
        // Built-in primitives (box, sphere, cone, ...) are meshed directly
        // by the viewport and don't carry raw geometryData - only shapes
        // built from explicit geometry (custom meshes, imported/exported
        // shapes, block-kit parts, etc.) can be read back this way.
        this.log(`getShapeGeometry: "${id}" (${shape.type}) has no stored geometry data.`);
        return null;
      }
    };

    // ─────────────────────────────────────────────────────────────
    // OUTLINER SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.outliner = {
      list: (): { id: string; name: string; type: string; tags?: string[] }[] => {
        return this.shapes.map(s => ({ id: s.id, name: s.name || s.type, type: s.type, tags: s.tags }));
      },
      find: (predicate: (entry: { id: string; name: string; type: string; tags?: string[] }) => boolean): { id: string; name: string; type: string; tags?: string[] } | null => {
        return this.outliner.list().find(predicate) || null;
      }
    };

    // ─────────────────────────────────────────────────────────────
    // BLOCK-KIT SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.blockKit = {
      list: (): { id: string; label: string; category: string }[] => {
        return BLOCK_CATALOG.map(p => ({ id: p.id, label: p.label, category: p.category }));
      },

      getGeometry: (partId: string): { positions: number[]; normals: number[]; uvs?: number[] } | null => {
        const part = getBlockPart(partId);
        if (!part) return null;
        return geometryToData(buildBlockGeometry(part));
      },

      /**
       * Arms the built-in block-placement tool for a given catalog part id
       * (see blockKit.list() for every available id/category). A ghost
       * preview then follows the cursor (snapping to the stud grid and to
       * existing blocks), arrow keys rotate it 90° at a time, and clicking
       * places it - clicking again places another of the same part,
       * Escape stops. This is a placement primitive, not a UI - build your
       * own picker panel around it with sdk.toolbars.create().
       *
       * Pass an array of hex colours instead of a single one to get a
       * fresh random pick from that array for every block placed (not
       * just once when the tool is armed).
       */
      place: (partId: string, color: string | string[] = '#dc2626'): void => {
        if (this.extraSetters.setActiveBlockPart) {
          const isPalette = Array.isArray(color);
          this.extraSetters.setActiveBlockPart({
            partId,
            color: isPalette ? (color[0] || '#dc2626') : color,
            rotationSteps: 0,
            randomPalette: isPalette ? color : undefined
          });
        }
        if (this.extraSetters.setActiveTool) {
          this.extraSetters.setActiveTool('block_picker');
        }
        this.log(`Armed block placement: ${partId} (${Array.isArray(color) ? 'random colour' : color}).`);
      },

      setPreventOverlap: (enabled: boolean): void => {
        if (this.extraSetters.setBlockPreventOverlap) {
          this.extraSetters.setBlockPreventOverlap(enabled);
        }
        this.log(`Block overlap prevention: ${enabled ? 'ON' : 'OFF'}.`);
      }
    };

    // ─────────────────────────────────────────────────────────────
    // WORLDVIEW SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────
    // DRAWING SUBSYSTEM (geometry kernel)
    // ─────────────────────────────────────────────────────────────
    const toVec = (p: DrawingPoint): Vec3 => Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : { x: p.x, y: p.y, z: p.z };
    const kernel = (): KernelArcHost | null => {
      const host = this.extraSetters.kernelHost as KernelArcHost | undefined;
      if (!host) this.log('Drawing is not available here.');
      return host ?? null;
    };
    const changed = () => this.extraSetters.bumpKernel?.();
    this.drawing = {
      line: (from, to) => {
        const host = kernel();
        if (!host) return [];
        const r = host.commitSegment(toVec(from), toVec(to));
        if (!r.ok) this.log(`Line not drawn: ${r.reason ?? 'rejected'}.`);
        changed();
        return [...r.edges];
      },
      arc: ({ centre, normal = [0, 1, 0], radius, startAngle = 0, sweep, segments = DEFAULT_SEGMENTS }) => {
        const host = kernel();
        if (!host) return [];
        const r = host.commitArc({ centre: toVec(centre), normal: toVec(normal), radius, startAngle, sweep, segments }, {});
        if (!r.ok) this.log(`Arc not drawn: ${r.reason}.`);
        changed();
        return r.ok ? [...r.edges] : [];
      },
      surface: (points) => {
        const host = kernel();
        if (!host) return [];
        const r = host.commitIsolatedRing(points.map(toVec));
        if (!r.ok) this.log(`Surface not drawn: ${r.reason ?? 'rejected'}.`);
        changed();
        return r.faces;
      },
      shape: (points) => {
        const host = kernel();
        if (!host) return [];
        const faces = host.commitIsolatedShape(points.map(toVec));
        if (!faces) this.log('Shape not drawn: its first side is too short.');
        changed();
        return faces ?? [];
      },
      bezier: ({ knots, resolution = 24, normal = [0, 1, 0] }) => {
        const host = kernel();
        if (!host) return [];
        const r = commitBezierSurface(host, knots, resolution, toVec(normal));
        if (!r.ok) this.log(`Bézier surface not drawn: ${r.reason}.`);
        changed();
        return r.ok ? r.faces : [];
      },
      rectangle: (spec) => {
        const centrePoint = spec.centre ?? [0, 0, 0];
        const normalPoint = spec.normal ?? [0, 1, 0];
        const c = new THREE.Vector3(centrePoint[0], centrePoint[1], centrePoint[2]);
        const n = new THREE.Vector3(normalPoint[0], normalPoint[1], normalPoint[2]).normalize();
        const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const u = new THREE.Vector3().crossVectors(ref, n).normalize();
        const v = new THREE.Vector3().crossVectors(n, u).normalize();
        const rot = THREE.MathUtils.degToRad(spec.rotationDeg ?? 0);
        u.applyAxisAngle(n, rot); v.applyAxisAngle(n, rot);
        const hw = Math.max(0.001, spec.width) / 2, hd = Math.max(0.001, spec.depth) / 2;
        const p = (a: number, b: number): DrawingPoint => {
          const q = c.clone().addScaledVector(u, a).addScaledVector(v, b);
          return [q.x, q.y, q.z];
        };
        return this.drawing.shape([p(-hw, -hd), p(hw, -hd), p(hw, hd), p(-hw, hd)]);
      },
      circle: (spec) => this.drawing.polygon({ ...spec, sides: Math.max(8, Math.floor(spec.segments ?? 32)) }),
      polygon: (spec) => {
        const centrePoint = spec.centre ?? [0, 0, 0];
        const normalPoint = spec.normal ?? [0, 1, 0];
        const c = new THREE.Vector3(centrePoint[0], centrePoint[1], centrePoint[2]);
        const n = new THREE.Vector3(normalPoint[0], normalPoint[1], normalPoint[2]).normalize();
        const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const u = new THREE.Vector3().crossVectors(ref, n).normalize();
        const v = new THREE.Vector3().crossVectors(n, u).normalize();
        const sides = Math.max(3, Math.min(1000, Math.floor(spec.sides)));
        const radius = Math.max(0.001, spec.radius);
        const phase = THREE.MathUtils.degToRad(spec.rotationDeg ?? 0);
        const points: DrawingPoint[] = Array.from({ length: sides }, (_, i) => {
          const a = phase + i * Math.PI * 2 / sides;
          const q = c.clone().addScaledVector(u, Math.cos(a) * radius).addScaledVector(v, Math.sin(a) * radius);
          return [q.x, q.y, q.z];
        });
        return this.drawing.shape(points);
      },
      triangle: (spec) => this.drawing.polygon({ ...spec, sides: 3 }),
      pie: (spec) => {
        const centrePoint = spec.centre ?? [0, 0, 0];
        const normalPoint = spec.normal ?? [0, 1, 0];
        const c = new THREE.Vector3(centrePoint[0], centrePoint[1], centrePoint[2]);
        const n = new THREE.Vector3(normalPoint[0], normalPoint[1], normalPoint[2]).normalize();
        const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const u = new THREE.Vector3().crossVectors(ref, n).normalize();
        const v = new THREE.Vector3().crossVectors(n, u).normalize();
        const count = Math.max(2, Math.floor(spec.segments ?? Math.ceil(Math.abs(spec.sweepDeg) / 10)));
        const start = THREE.MathUtils.degToRad(spec.startAngleDeg ?? 0);
        const sweep = THREE.MathUtils.degToRad(spec.sweepDeg);
        const points: DrawingPoint[] = [[c.x, c.y, c.z]];
        for (let i = 0; i <= count; i++) {
          const a = start + sweep * i / count;
          const q = c.clone().addScaledVector(u, Math.cos(a) * spec.radius).addScaledVector(v, Math.sin(a) * spec.radius);
          points.push([q.x, q.y, q.z]);
        }
        return this.drawing.shape(points);
      },
      freehand: (points, closed = false) => {
        if (points.length < 2) return [];
        if (closed && points.length >= 3) return this.drawing.shape(points);
        const ids: number[] = [];
        for (let i = 1; i < points.length; i++) ids.push(...this.drawing.line(points[i - 1]!, points[i]!));
        return ids;
      },

      chamfer: (faceIds, amount) => {
        const host = kernel();
        if (!host) return { ok: false, reason: 'geometry kernel is not available' };
        const binding = createChamferBinding(host, changed);
        const faces = faceIds.map(id => id as FaceId);
        const begun = binding.begin(faces);
        if (!begun.ok) return begun;
        binding.update(amount);
        return binding.commit();
      },
      fillet: (faceIds, radius) => {
        const host = kernel();
        if (!host) return { ok: false, reason: 'geometry kernel is not available' };
        const binding = createFilletBinding(host, changed);
        const faces = faceIds.map(id => id as FaceId);
        const begun = binding.begin(faces);
        if (!begun.ok) return begun;
        binding.update(radius);
        return binding.commit();
      },
      boolean: (faceIds, operation) => {
        const host = kernel();
        if (!host) return { ok: false, reason: 'geometry kernel is not available' };
        const selected = faceIds.map(id => id as FaceId);
        const groups = orderedShapeGroups(host.graph, selected);
        const plan = planBoolean(host.graph, groups, operation as BooleanOp);
        if (!plan.ok) return { ok: false, reason: 'reason' in plan ? plan.reason : 'kernel boolean planning failed' };
        let resultFaces: FaceId[] = [];
        const ok = host.transact(() => {
          const ctx = { graph: host.graph, tolerances: host.tolerances, index: host.spatialIndex };
          resultFaces = applyBoolean(ctx, plan, host.deriveOptions);
          return true;
        });
        if (!ok) return { ok: false, reason: 'kernel boolean transaction failed' };
        changed();
        return { ok: true, faces: resultFaces as number[] };
      },

      followMe: (profileFaceId, pathSpec) => {
        const host = kernel();
        if (!host) return false;
        const profile = profileFaceId as FaceId;
        if (!host.graph.faces.has(profile)) {
          this.log(`Follow Me: profile face ${profileFaceId} does not exist.`);
          return false;
        }
        let path: FollowMePath | null = null;
        if ('edgeId' in pathSpec) path = pathFromEdge(host.graph, pathSpec.edgeId as EdgeId);
        else if ('faceId' in pathSpec) path = pathFromFace(host.graph, pathSpec.faceId as FaceId);
        else {
          path = {
            points: pathSpec.points.map(toVec),
            closed: pathSpec.closed ?? false,
            edges: [],
          };
        }
        if (!path) {
          this.log('Follow Me: the requested path could not be resolved.');
          return false;
        }
        const result = commitKernelFollowMe(host, profile, path);
        if (!result.ok) {
          this.log(`Follow Me: ${result.reason}`);
          return false;
        }
        changed();
        return true;
      },
      offset: (faceId, distance) => {
        const host = kernel();
        if (!host) return false;
        const ok = commitKernelFaceOffset(host, faceId as FaceId, distance);
        if (!ok) this.log(`Offset of face ${faceId} did nothing.`);
        changed();
        return ok;
      },
      pushPull: (faceId, distance) => {
        const host = kernel();
        if (!host) return false;
        const ok = commitKernelPushPull(host, faceId as FaceId, distance);
        if (!ok) this.log(`Push/pull of face ${faceId} did nothing.`);
        changed();
        return ok;
      },
      erase: (faceIds) => {
        const host = kernel();
        if (!host) return;
        host.transact(() => { deleteGroupFacesAndEdges(host.graph, faceIds as FaceId[]); return true; });
        host.refreshIndex();
        changed();
      },
      paint: (faceIds, color) => {
        const host = kernel();
        if (!host) return;
        host.transact(() => paintFaces(host.graph, faceIds as FaceId[], color) > 0);
        changed();
      },
      listFaces: () => {
        const host = kernel();
        return host ? faceSummaries(host.graph).map(f => ({ ...f, id: f.id as number })) : [];
      },
      applyChanges: (changes) => {
        const host = kernel();
        if (!host) return;
        host.transact(() => { applyKernelPatch(host.graph, changes); return true; });
        host.refreshIndex();
        changed();
      },
    };

    // ─────────────────────────────────────────────────────────────
    // TEXT SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.text = {
      add: (options) => this.placeBuilt(buildTextShape('text', options)),
      add3D: (options) => this.placeBuilt(buildTextShape('text3d', options)),
      edit: (id, changes) => {
        const shape = this.shapes.find(s => s.id === id);
        if (!shape?.textData) {
          this.log(`text.edit: no text object with id ${id}.`);
          return;
        }
        const edited = editTextShape(shape, changes);
        this.setShapes(prev => prev.map(s => (s.id === id ? edited : s)));
      },
    };

    this.worldView = {
      importMap: (args: { lat: number, lng: number, zoom?: number, altitude?: number, radius?: number }) => {
        if (this.extraSetters.setWorldViewLocation) this.extraSetters.setWorldViewLocation({ lat: args.lat, lng: args.lng });
        if (args.zoom !== undefined && this.extraSetters.setZoom) this.extraSetters.setZoom(args.zoom);
        if (args.altitude !== undefined && this.extraSetters.setWorldViewAltitude) this.extraSetters.setWorldViewAltitude(args.altitude);
        if (args.radius !== undefined && this.extraSetters.setWorldViewRadius) this.extraSetters.setWorldViewRadius(args.radius);
        if (this.extraSetters.setIsWorldViewActive) this.extraSetters.setIsWorldViewActive(true);
        if (this.extraSetters.triggerFocusOnMap) this.extraSetters.triggerFocusOnMap();
        this.log(`Imported world map overlay at (${args.lat}, ${args.lng}).`);
      },
      setLocation: (lat: number, lng: number) => {
        if (this.extraSetters.setWorldViewLocation) this.extraSetters.setWorldViewLocation({ lat, lng });
        this.log(`Set world location to (${lat}, ${lng}).`);
      },
      setRadius: (radius: number) => {
        if (this.extraSetters.setWorldViewRadius) this.extraSetters.setWorldViewRadius(radius);
        this.log(`Set world radius to ${radius}m.`);
      },
      setZoom: (zoom: number) => {
        if (this.extraSetters.setZoom) this.extraSetters.setZoom(zoom);
        this.log(`Set world zoom to ${zoom}.`);
      },
      setAltitude: (altitude: number) => {
        if (this.extraSetters.setWorldViewAltitude) this.extraSetters.setWorldViewAltitude(altitude);
        this.log(`Set world altitude to ${altitude}m.`);
      },
      importArea: async (place: string | { lat: number; lng: number }, options: SiteImportOptions = {}): Promise<SiteImportResult> => {
        const found = typeof place === 'string'
          ? await findPlace(place, this.extraSetters.googleMapsApiKey)
          : { lat: place.lat, lng: place.lng, address: `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}` };
        if (!found) {
          this.log(`worldView.importArea: couldn't find "${place}".`);
          throw new Error(`Couldn't find "${place}". Try a postcode, a full address or "lat, lng".`);
        }
        const size = clampSiteSize(options.size ?? 100);
        const io: SiteIO = this.extraSetters.siteIO ?? browserSiteIO;
        const built = await buildSite(io, {
          origin: { lat: found.lat, lng: found.lng },
          size,
          address: found.address,
          groundStyle: options.groundStyle,
          skipBuildings: options.buildings === false,
        });
        this.setShapes(prev => replaceSite(prev, built));
        this.extraSetters.setWorldViewLocation?.({ lat: found.lat, lng: found.lng, address: found.address });
        // The flat map would sit inside the new ground.
        this.extraSetters.setIsWorldViewActive?.(false);
        this.log(`Imported a ${size} m site at ${found.address}: ${built.buildings.length} buildings.${built.warnings.length ? ` ${built.warnings.join(' ')}` : ''}`);
        return { lat: found.lat, lng: found.lng, address: found.address, size, buildings: built.buildings.length, warnings: built.warnings };
      },
      getSite: () => findSiteGround(this.shapes)?.terrainData?.site ?? null,
      listBuildings: () => this.shapes
        .filter(s => s.type === 'site_building' && s.siteBuildingData)
        .map(s => ({
          id: s.id,
          name: s.name ?? 'Existing building',
          height: s.siteBuildingData!.height,
          heightSource: s.siteBuildingData!.heightSource,
          roof: s.siteBuildingData!.roof ? { shape: s.siteBuildingData!.roof.shape, pitch: s.siteBuildingData!.roof.pitch, eave: s.siteBuildingData!.roof.eave } : null,
          heightCheck: !!s.siteBuildingData!.heightCheck,
          kind: s.siteBuildingData!.kind,
          position: [...s.position] as [number, number, number],
        })),
      removeBuilding: (id: string) => {
        if (!this.shapes.some(s => s.id === id && s.type === 'site_building')) {
          this.log(`worldView.removeBuilding: no existing building with id ${id}.`);
          return false;
        }
        this.setShapes(prev => prev.filter(s => s.id !== id));
        return true;
      },
      restoreBuilding: (id: string) => {
        const ground = findSiteGround(this.shapes);
        const snap = removedBuildings(ground?.terrainData?.siteExisting, this.shapes).find(b => b.id === id);
        if (!snap) {
          this.log(`worldView.restoreBuilding: ${id} isn't a removed building of this site.`);
          return false;
        }
        this.setShapes(prev => [...prev, shapeFromSnapshot(snap)]);
        return true;
      },
      setBuildingHeight: (id: string, height: number) => {
        const shape = this.shapes.find(s => s.id === id && s.type === 'site_building' && s.siteBuildingData);
        if (!shape || !(height > 0)) {
          this.log(`worldView.setBuildingHeight: no existing building ${id}, or a height that isn't above 0.`);
          return false;
        }
        const next = withBuildingHeight(shape.siteBuildingData!, height);
        this.setShapes(prev => prev.map(s => (s.id === id ? { ...s, siteBuildingData: next } : s)));
        return true;
      },
      showExisting: (show: boolean) => this.updateSite({ showRemoved: !!show }),
      setGroundStyle: (style: 'plain' | 'satellite') => {
        if (style !== 'plain' && style !== 'satellite') {
          this.log(`worldView.setGroundStyle: use 'plain' or 'satellite'.`);
          return;
        }
        this.updateSite({ groundStyle: style });
      },
      setGoogleContext: (on: boolean, options?: { ground?: 'cutout' | 'google'; nudge?: number }) => {
        if (options?.ground !== undefined && options.ground !== 'cutout' && options.ground !== 'google') {
          this.log(`worldView.setGoogleContext: ground is 'cutout' or 'google'.`);
          return;
        }
        this.updateSite({
          googleContext: !!on,
          ...(options?.ground !== undefined ? { googleGround: options.ground } : {}),
          ...(typeof options?.nudge === 'number' && Number.isFinite(options.nudge) ? { googleNudge: Math.max(-30, Math.min(30, options.nudge)) } : {}),
        });
      },
      styleBuildings: (on: boolean) => this.updateSite({ styledBuildings: !!on }),
      setStreetLife: (options: StreetLifeLevel | { level?: StreetLifeLevel; inEditor?: boolean }) => {
        const o = typeof options === 'string' ? { level: options } : options ?? {};
        if (o.level !== undefined && !STREET_LIFE_LEVELS.some(l => l.id === o.level)) {
          this.log(`worldView.setStreetLife: use 'off', 'quiet', 'normal' or 'busy'.`);
          return;
        }
        this.updateSite({
          ...(o.level !== undefined ? { streetLife: o.level } : {}),
          ...(o.inEditor !== undefined ? { streetLifeInEditor: !!o.inEditor } : {}),
        });
      },
      autoStreetLights: (on: boolean) => {
        const site = findSiteGround(this.shapes)?.terrainData?.site;
        if (!site) { this.log('worldView.autoStreetLights: import a 3D site first.'); return; }
        if (on && !site.routes) { this.log('worldView.autoStreetLights: the roads are not loaded yet. Show street life once (setStreetLife) and try again.'); return; }
        this.setShapes(prev => applyAutoStreetLights(prev, !!on));
      },
      listRoutes: () => (findSiteGround(this.shapes)?.terrainData?.site?.routes ?? []).map(r => ({ ...r, points: r.points.map(p => [...p] as [number, number]) })),
      addRoute: (kind: 'path' | 'road', points: [number, number][]) => {
        if (!findSiteGround(this.shapes)) {
          this.log('worldView.addRoute: import a 3D site first.');
          return null;
        }
        if ((kind !== 'path' && kind !== 'road') || !Array.isArray(points) || points.length < 2) {
          this.log(`worldView.addRoute: give 'path' or 'road' and at least two [x, z] points.`);
          return null;
        }
        const id = `drawn-${Math.random().toString(36).slice(2, 9)}`;
        this.setShapes(prev => withDrawnRoute(prev, kind, points.map(p => [Number(p[0]), Number(p[1])] as [number, number]), id));
        return id;
      },
      removeRoute: (id: string) => {
        if (!findSiteGround(this.shapes)?.terrainData?.site?.routes?.some(r => r.id === id)) {
          this.log(`worldView.removeRoute: no route with id ${id}.`);
          return false;
        }
        this.setShapes(prev => withoutRoutes(prev, [id]));
        return true;
      },
    };

    // ─────────────────────────────────────────────────────────────
    // TOOLBARS & EXTENSIONS SUBSYSTEM
    // ─────────────────────────────────────────────────────────────
    this.toolbars = {
      create: (toolbar: CustomToolbarConfig): CustomToolbarDef => {
        const toolbarId = toolbar.id || `tb-${Math.random().toString(36).substr(2, 7)}`;
        const normalizedToolbar: CustomToolbarDef = {
          id: toolbarId,
          title: toolbar.title || 'Custom Toolbar',
          position: toolbar.position || 'floating',
          orientation: toolbar.orientation || 'horizontal',
          items: toolbar.items || toolbar.buttons || [],
          closable: toolbar.closable ?? true,
          collapsed: toolbar.collapsed ?? false,
          floatPosition: toolbar.floatPosition
        };

        if (this.extraSetters.setCustomToolbars) {
          this.extraSetters.setCustomToolbars((prev: CustomToolbarDef[] = []) => {
            const existingIdx = prev.findIndex(t => t.id === toolbarId);
            if (existingIdx >= 0) {
              const updated = [...prev];
              updated[existingIdx] = normalizedToolbar;
              return updated;
            }
            return [...prev, normalizedToolbar];
          });
        }
        this.log(`Created/updated custom toolbar "${toolbarId}" ("${normalizedToolbar.title}").`);
        return normalizedToolbar;
      },

      addButton: (toolbarId: string, button: CustomToolbarButton): void => {
        if (this.extraSetters.setCustomToolbars) {
          this.extraSetters.setCustomToolbars((prev: CustomToolbarDef[] = []) => {
            return prev.map(tb => {
              if (tb.id === toolbarId) {
                const btnExists = tb.items.some(b => b.id === button.id);
                const items = btnExists
                  ? tb.items.map(b => b.id === button.id ? button : b)
                  : [...tb.items, button];
                return { ...tb, items };
              }
              return tb;
            });
          });
        }
        this.log(`Added button "${button.id}" (${button.label}) to toolbar "${toolbarId}".`);
      },

      addToBasicToolbar: (button: CustomToolbarButton): void => {
        if (this.extraSetters.setBasicToolbarExtensions) {
          this.extraSetters.setBasicToolbarExtensions((prev: CustomToolbarButton[] = []) => {
            const exists = prev.some(b => b.id === button.id);
            if (exists) {
              return prev.map(b => b.id === button.id ? button : b);
            }
            return [...prev, button];
          });
        }
        this.log(`Added extension button "${button.id}" (${button.label}) to basic left toolbar.`);
      },

      configureToolbar: (toolbarId: string, settings: Partial<CustomToolbarConfig>): void => {
        if (this.extraSetters.setCustomToolbars) {
          this.extraSetters.setCustomToolbars((prev: CustomToolbarDef[] = []) => {
            return prev.map(tb => {
              if (tb.id === toolbarId) {
                return {
                  ...tb,
                  ...settings,
                  title: settings.title !== undefined ? settings.title : tb.title,
                  position: settings.position !== undefined ? settings.position : tb.position,
                  orientation: settings.orientation !== undefined ? settings.orientation : tb.orientation,
                  collapsed: settings.collapsed !== undefined ? settings.collapsed : tb.collapsed,
                  floatPosition: settings.floatPosition !== undefined ? settings.floatPosition : tb.floatPosition,
                };
              }
              return tb;
            });
          });
        }
        this.log(`Configured toolbar "${toolbarId}": ${JSON.stringify(settings)}`);
      },

      configureButton: (toolbarId: string, buttonId: string, settings: Partial<CustomToolbarButton>): void => {
        if (this.extraSetters.setCustomToolbars) {
          const applyToItems = (items: CustomToolbarButton[]): CustomToolbarButton[] => items.map(b => {
            if (b.id === buttonId) return { ...b, ...settings };
            if ((b as any).items) return { ...b, items: applyToItems((b as any).items) } as any;
            return b;
          });
          this.extraSetters.setCustomToolbars((prev: CustomToolbarDef[] = []) => {
            return prev.map(tb => tb.id === toolbarId ? { ...tb, items: applyToItems(tb.items) } : tb);
          });
        }
        this.log(`Configured button "${buttonId}" on toolbar "${toolbarId}": ${JSON.stringify(settings)}`);
      },

      configureBasicToolbarButton: (buttonId: string, settings: Partial<CustomToolbarButton>): void => {
        if (this.extraSetters.setBasicToolbarExtensions) {
          this.extraSetters.setBasicToolbarExtensions((prev: CustomToolbarButton[] = []) => {
            return prev.map(b => b.id === buttonId ? { ...b, ...settings } : b);
          });
        }
        this.log(`Configured basic toolbar extension button "${buttonId}": ${JSON.stringify(settings)}`);
      },

      getToolbar: (toolbarId: string): CustomToolbarDef | undefined => {
        return (this.extraSetters.customToolbars || []).find((t: CustomToolbarDef) => t.id === toolbarId);
      },

      getButton: (toolbarId: string, buttonId: string): CustomToolbarButton | undefined => {
        const tb = (this.extraSetters.customToolbars || []).find((t: CustomToolbarDef) => t.id === toolbarId);
        if (!tb) return undefined;
        // Searches into 'section' items' nested children too, not just the
        // toolbar's top-level items - a button built inside a collapsible
        // section (like the block-kit tiles) is just as findable this way.
        const find = (items: CustomToolbarButton[]): CustomToolbarButton | undefined => {
          for (const b of items) {
            if (b.id === buttonId) return b;
            if ((b as any).items) {
              const nested = find((b as any).items);
              if (nested) return nested;
            }
          }
          return undefined;
        };
        return find(tb.items);
      },

      removeButton: (toolbarId: string, buttonId: string): void => {
        if (this.extraSetters.setCustomToolbars) {
          this.extraSetters.setCustomToolbars((prev: CustomToolbarDef[] = []) => {
            return prev.map(tb => {
              if (tb.id === toolbarId) {
                return { ...tb, items: tb.items.filter(b => b.id !== buttonId) };
              }
              return tb;
            });
          });
        }
        this.log(`Removed button "${buttonId}" from toolbar "${toolbarId}".`);
      },

      removeFromBasicToolbar: (buttonId: string): void => {
        if (this.extraSetters.setBasicToolbarExtensions) {
          this.extraSetters.setBasicToolbarExtensions((prev: CustomToolbarButton[] = []) => 
            prev.filter(b => b.id !== buttonId)
          );
        }
        this.log(`Removed button "${buttonId}" from basic toolbar.`);
      },

      removeToolbar: (toolbarId: string): void => {
        if (this.extraSetters.setCustomToolbars) {
          this.extraSetters.setCustomToolbars((prev: CustomToolbarDef[] = []) => 
            prev.filter(t => t.id !== toolbarId)
          );
        }
        this.log(`Removed custom toolbar "${toolbarId}".`);
      },

      list: (): CustomToolbarDef[] => {
        return this.extraSetters.customToolbars || [];
      },

      getBasicToolbarButtons: (): CustomToolbarButton[] => {
        return this.extraSetters.basicToolbarExtensions || [];
      },

      clear: (): void => {
        if (this.extraSetters.setCustomToolbars) {
          this.extraSetters.setCustomToolbars([]);
        }
        if (this.extraSetters.setBasicToolbarExtensions) {
          this.extraSetters.setBasicToolbarExtensions([]);
        }
        this.log('Cleared all custom toolbars and basic toolbar extensions.');
      }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // CORE GEOMETRY & PRIMITIVES
  // ─────────────────────────────────────────────────────────────
  private _createShape(type: Shape['type'], args: any, position?: [number, number, number]): Shape {
    const id = Math.random().toString(36).substr(2, 9);
    const newShape: Shape = {
      id,
      type,
      position: position || [0, 0, 0],
      args,
      color: '#ffffff'
    };
    // `this.shapes` is the same array reference as the live React state
    // (see DeveloperSuite.tsx's `new DeveloperSDK(shapes, setShapes, ...)`).
    // Pushing onto it directly, in addition to the setShapes() call below,
    // used to mutate that array in place before setShapes's own updater
    // spread it - so every primitive created through this method (every
    // sdk.createBox/createRectangle/createSphere/... call) was added to
    // the scene twice.
    this.setShapes(prev => [...prev, newShape]);
    return newShape;
  }

  createRectangle(args: { width: number, height: number, position?: [number, number, number] }): Shape {
    return this._createShape('rect', [args.width, 0.01, args.height], args.position);
  }

  createBox(args: { width: number, height: number, depth: number, position?: [number, number, number] }): Shape {
    return this._createShape('box', [args.width, args.height, args.depth], args.position);
  }

  createSphere(args: { radius: number, position?: [number, number, number] }): Shape {
    return this._createShape('sphere', [args.radius, 32, 32], args.position);
  }

  createCone(args: { radius: number, height: number, position?: [number, number, number] }): Shape {
    return this._createShape('cone', [args.radius, args.height, 32], args.position);
  }

  createPyramid(args: { radius: number, height: number, position?: [number, number, number] }): Shape {
    return this._createShape('pyramid', [args.radius, args.height, 4], args.position);
  }

  createDonut(args: { radius: number, tube: number, position?: [number, number, number] }): Shape {
    return this._createShape('donut', [args.radius, args.tube, 16, 100], args.position);
  }

  createDome(args: { radius: number, position?: [number, number, number] }): Shape {
    return this._createShape('dome', [args.radius, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2], args.position);
  }

  createCylinder(args: { radius: number, height: number, radiusTop?: number, position?: [number, number, number] }): Shape {
    return this._createShape('cylinder', [args.radiusTop ?? args.radius, args.radius, args.height, 32], args.position);
  }

  createPoly(args: { vertices: [number, number, number][], position?: [number, number, number] }): Shape {
    if (!args.vertices || args.vertices.length < 3) return null as any;
    
    const v0 = new THREE.Vector3(...args.vertices[0]);
    const v1 = new THREE.Vector3(...args.vertices[1]);
    const v2 = new THREE.Vector3(...args.vertices[2]);
    
    const normal = new THREE.Vector3().crossVectors(
      v1.clone().sub(v0),
      v2.clone().sub(v0)
    ).normalize();
    
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(normal.dot(up)) > 0.99) up.set(0, 0, 1);
    const tangent = new THREE.Vector3().crossVectors(normal, up).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    
    const p2d = args.vertices.map(v => {
      const vec = new THREE.Vector3(...v);
      const diff = vec.clone().sub(v0);
      return [diff.dot(tangent), diff.dot(bitangent)];
    });

    const id = Math.random().toString(36).substr(2, 9);
    const newShape: Shape = {
      id,
      type: 'poly',
      position: [v0.x, v0.y, v0.z],
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      args: { vertices: p2d },
      color: '#ffffff'
    };
    
    this.setShapes(prev => [...prev, newShape]);
    return newShape;
  }

  pushPull(shape: Shape, amount: number): Shape {
    if (!shape) return null as any;
    const newArgs = [...shape.args];
    newArgs[1] = amount;
    const newPos: [number, number, number] = [
      shape.position[0],
      shape.position[1] + amount / 2,
      shape.position[2]
    ];
    
    const updatedShape: Shape = {
      ...shape,
      type: 'box',
      args: newArgs,
      position: newPos
    };

    this.setShapes(prev => prev.map(s => s.id === shape.id ? updatedShape : s));
    return updatedShape;
  }

  applyColor(shape: Shape, color: string): void {
    if (!shape) return;
    this.updateShapeColor(shape.id, color);
  }

  setTag(shape: Shape, key: string, value: string): void {
    if (!shape) return;
    this.setShapes(prev => prev.map(s => {
      if (s.id === shape.id) {
        const tags = s.tags || [];
        const newTag = `${key}:${value}`;
        if (!tags.includes(newTag)) {
          return { ...s, tags: [...tags, newTag] };
        }
      }
      return s;
    }));
  }

  getObjectByName(name: string): Shape | undefined {
    return this.shapes.find(s => s.id === name || s.name === name);
  }

  getSelectedObject(): Shape | null {
    const shape = this.shapes.find(s => s.id === this.selectedId) || null;
    if (!shape) return null;

    return new Proxy(shape, {
      set: (target, prop, value) => {
        if (['position', 'rotation', 'quaternion', 'scale'].includes(prop as string)) {
          this.setShapes(prev => prev.map(s => s.id === target.id ? { ...s, [prop]: value } : s));
          return true;
        }
        (target as any)[prop] = value;
        return true;
      }
    });
  }

  deleteObject(id: string): void {
    this.setShapes(prev => prev.filter(s => s.id !== id));
    this.log(`Deleted object ${id}.`);
  }

  saveScene(name: string): void {
    if (this.extraSetters.setScenes) {
      this.extraSetters.setScenes((prev: any) => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        name,
        shapes: [...this.shapes],
        timestamp: new Date().toISOString()
      }]);
      this.log(`Saved scene "${name}".`);
    }
  }

  setSkybox(type: any, blur?: number, rotation?: number, intensity?: number): void {
    if (this.extraSetters.setSkybox) this.extraSetters.setSkybox(type);
    if (blur !== undefined && this.extraSetters.setSkyboxBlur) this.extraSetters.setSkyboxBlur(blur);
    if (rotation !== undefined && this.extraSetters.setSkyboxRotation) this.extraSetters.setSkyboxRotation(rotation);
    if (intensity !== undefined && this.extraSetters.setEnvironmentIntensity) this.extraSetters.setEnvironmentIntensity(intensity);
    this.log(`Configured skybox (${type}).`);
  }

  setFog(settings: any): void {
    if (this.extraSetters.setFogSettings) {
      this.extraSetters.setFogSettings((prev: any) => ({ ...prev, ...settings }));
    }
    this.log(`Configured scene fog.`);
  }

  addLight(lightData: any): void {
    if (this.extraSetters.setCustomLights) {
      this.extraSetters.setCustomLights((prev: any) => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        ...lightData
      }]);
    }
    this.log(`Added custom light (${lightData.type || 'point'}).`);
  }

  setBevelType(type: 'radius' | 'chamfer'): void {
    if (this.extraSetters.setActiveBevelType) this.extraSetters.setActiveBevelType(type);
    this.log(`Set active bevel type to: ${type}.`);
  }

  setName(obj: Shape, name: string): void {
    if (!obj) return;
    this.setShapes(prev => prev.map(s => s.id === obj.id ? { ...s, name } : s));
  }

  setBevel(obj: Shape, settings: { amount?: number, type?: 'radius' | 'chamfer', segments?: number }): void {
    if (!obj) return;
    this.setShapes(prev => prev.map(s => s.id === obj.id ? {
      ...s,
      bevelAmount: settings.amount !== undefined ? settings.amount : s.bevelAmount,
      bevelType: settings.type !== undefined ? settings.type : s.bevelType,
      bevelSegments: settings.segments !== undefined ? settings.segments : s.bevelSegments
    } : s));
  }

  divideSurface(shapeId: string, faceIndex: number, divisions: number | [number, number] = 2): void {
    this.setShapes(prev => prev.map(s => {
      if (s.id === shapeId) {
        const surfaceDivisions = s.surfaceDivisions || {};
        const otherIdx = faceIndex % 2 === 0 ? faceIndex + 1 : faceIndex - 1;
        return {
          ...s,
          surfaceDivisions: {
            ...surfaceDivisions,
            [faceIndex]: divisions,
            [otherIdx]: divisions
          }
        };
      }
      return s;
    }));
    this.log(`Divided surface ${faceIndex} of ${shapeId}.`);
  }

  addProjectorLight(lightData: any): void {
    this.addLight({
      type: 'projector',
      ...lightData
    });
  }

  performCSG(targetId: string, cutterId: string, operation: 'SUBTRACTION' | 'UNION' | 'INTERSECTION' = 'SUBTRACTION'): void {
    window.dispatchEvent(new CustomEvent('request-csg', { detail: { targetId, cutterId, operation } }));
    this.log(`Dispatched CSG ${operation} (target: ${targetId}, cutter: ${cutterId}).`);
  }

  deformObject(id: string, settings: { radius: number, strength: number, direction: 'outward' | 'inward' | 'both' }): void {
    window.dispatchEvent(new CustomEvent('request-deform', { detail: { id, settings } }));
    this.log(`Dispatched deformation on ${id}.`);
  }

  setShadows(enabled: boolean): void {
    if (this.extraSetters.setShadowsEnabled) {
      this.extraSetters.setShadowsEnabled(enabled);
    }
    this.log(`Shadows ${enabled ? 'enabled' : 'disabled'}.`);
  }

  setGrid(enabled: boolean): void {
    if (this.extraSetters.setGridEnabled) {
      this.extraSetters.setGridEnabled(enabled);
    }
    this.log(`Grid ${enabled ? 'enabled' : 'disabled'}.`);
  }

  setAxisIndicator(enabled: boolean): void {
    if (this.extraSetters.setAxisIndicatorEnabled) {
      this.extraSetters.setAxisIndicatorEnabled(enabled);
    }
    this.log(`Axis indicator ${enabled ? 'enabled' : 'disabled'}.`);
  }

  setMiniAxisIndicator(enabled: boolean): void {
    if (this.extraSetters.setMiniAxisIndicatorEnabled) {
      this.extraSetters.setMiniAxisIndicatorEnabled(enabled);
    }
    this.log(`Mini axis indicator ${enabled ? 'enabled' : 'disabled'}.`);
  }

  setFloor(enabled: boolean, color?: string): void {
    if (this.extraSetters.setFloorEnabled) {
      this.extraSetters.setFloorEnabled(enabled);
    }
    if (color && this.extraSetters.setFloorColor) {
      this.extraSetters.setFloorColor(color);
    }
    this.log(`Floor ${enabled ? 'enabled' : 'disabled'}.`);
  }

  setAmbientOcclusion(enabled: boolean): void {
    if (this.extraSetters.setAmbientOcclusionEnabled) {
      this.extraSetters.setAmbientOcclusionEnabled(enabled);
    }
    this.log(`Ambient occlusion ${enabled ? 'enabled' : 'disabled'}.`);
  }

  setSunSettings(settings: { intensity?: number, position?: [number, number, number], animate?: boolean, speed?: number }): void {
    if (settings.intensity !== undefined && this.extraSetters.setSunIntensity) {
      this.extraSetters.setSunIntensity(settings.intensity);
    }
    if (settings.position !== undefined && this.extraSetters.setLightPosition) {
      this.extraSetters.setLightPosition(settings.position);
    }
    if (settings.animate !== undefined && this.extraSetters.setAnimateSun) {
      this.extraSetters.setAnimateSun(settings.animate);
    }
    if (settings.speed !== undefined && this.extraSetters.setSunSpeed) {
      this.extraSetters.setSunSpeed(settings.speed);
    }
    this.log(`Configured sun settings: ${JSON.stringify(settings)}`);
  }

  addNote(text: string, position: [number, number, number]): void {
    if (this.extraSetters.setNotes) {
      this.extraSetters.setNotes((prev: any[]) => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        text,
        position: { x: position[0], y: position[1], z: position[2] },
        authorUid: 'sdk',
        authorName: 'Developer SDK',
        createdAt: Date.now(),
        completed: false
      }]);
      this.log(`Added note "${text}" at [${position.join(', ')}].`);
    }
  }

  setNoteVisibility(id: string, visible: boolean): void {
    if (this.extraSetters.setNotes) {
      this.extraSetters.setNotes((prev: any[]) => prev.map(n => n.id === id ? { ...n, visible } : n));
    }
  }

  toggleAllNotes(visible: boolean): void {
    if (this.extraSetters.setAllNotesVisible) {
      this.extraSetters.setAllNotesVisible(visible);
    }
    this.log(`Notes visibility set to: ${visible}.`);
  }

  addRectLight(color: string, intensity: number, position: [number, number, number], scale?: [number, number]): void {
    this.addLight({
      type: 'rect',
      color,
      intensity,
      position,
      width: scale ? scale[0] : 5,
      height: scale ? scale[1] : 5
    });
  }

  animateSun(cycleSpeed?: number): void {
    if (this.extraSetters.setAnimateSun) this.extraSetters.setAnimateSun(true);
    if (cycleSpeed !== undefined && this.extraSetters.setSunSpeed) this.extraSetters.setSunSpeed(cycleSpeed);
    this.log(`Started sun animation (cycle speed: ${cycleSpeed || 1.0}).`);
  }

  addObject(type: Shape['type'], props: Partial<Shape>): Shape {
    const id = Math.random().toString(36).substr(2, 9);
    const newShape: Shape = {
      id,
      type,
      position: props.position || [0, 0, 0],
      args: props.args || (type === 'box' ? [1, 1, 1] : type === 'sphere' ? [1, 32, 32] : [1, 1, 1]),
      color: props.color || '#ffffff',
      ...props
    };
    // Adding an object whose id is already in the model replaces it, so a recorded
    // script replayed on the same model doesn't create duplicates.
    this.setShapes(prev => prev.some(s => s.id === newShape.id)
      ? prev.map(s => s.id === newShape.id ? newShape : s)
      : [...prev, newShape]);
    this.log(`Added object (${type}) ${newShape.id}.`);
    return newShape;
  }

  /** Adds (or, for an existing id, replaces) an object a builder made, and returns it. */
  private placeBuilt(shape: Shape): Shape {
    const put = (list: Shape[]) => list.some(s => s.id === shape.id)
      ? list.map(s => s.id === shape.id ? shape : s)
      : [...list, shape];
    this.setShapes(prev => put(prev));
    this.log(`Added ${shape.name ?? shape.type}.`);
    return shape;
  }

  updateObject(id: string, changes: Partial<Shape>): void {
    // Shallow merge; a field given as undefined is removed from the object.
    const apply = (s: Shape): Shape => {
      if (s.id !== id) return s;
      const next: any = { ...s, ...changes, id };
      for (const [k, v] of Object.entries(changes)) if (v === undefined) delete next[k];
      return next;
    };
    this.setShapes(prev => prev.map(apply));
  }

  toggleFloor(enabled: boolean): void {
    this.setFloor(enabled);
  }

  toggleGrid(enabled: boolean): void {
    this.setGrid(enabled);
  }

  setZoom(zoom: number): void {
    this.camera.setZoom(zoom);
  }

  resetView(view: 'perspective' | 'plan' | 'front' | 'rear' | 'left' | 'right'): void {
    this.camera.resetView(view);
  }

  setCameraDefaults(position: [number, number, number], target: [number, number, number]): void {
    this.camera.setCameraDefaults(position, target);
  }

  focusObject(id: string): void {
    this.camera.focusObject(id);
  }

  getSyncStatus(): 'synced' | 'syncing' | 'error' | 'offline' {
    return this.extraSetters.syncStatus || 'synced';
  }

  getCollaborators(): any[] {
    return this.extraSetters.collaborators || [];
  }
  
  diagLog(category: string, message: string, values?: Record<string, unknown>): void {
    if (this.extraSetters.diagLog) {
      this.extraSetters.diagLog(category, message, values);
    } else {
      console.log(`[SDK DIAG: ${category}] ${message}`, values);
    }
  }

  setGraphicsSettings(settings: GraphicsSettings): void {
    // Whole weather and vegetation-wind settings, checked and clamped the same way a saved model's are.
    if (this.extraSetters.setGraphicsSettings) {
      this.extraSetters.setGraphicsSettings(normalizeGraphicsSettings(settings));
    }
    this.log('Updated weather and vegetation settings.');
  }

  setContactFriction(enabled: boolean): void {
    if (this.extraSetters.setContactFrictionEnabled) {
      this.extraSetters.setContactFrictionEnabled(enabled);
    }
    this.log(`Contact friction ${enabled ? 'enabled' : 'disabled'}.`);
  }

  generateModel(prompt: string): void {
    this.ai.generateModel(prompt);
  }

  openWebpage(url: string): void {
    if (this.extraSetters.setEmbeddedWebpageUrl) {
      this.extraSetters.setEmbeddedWebpageUrl(url);
      if (this.extraSetters.diagLog) {
        this.extraSetters.diagLog('SDK', 'Opening embedded webpage', { url });
      }
    }
  }

  log(message: string): void {
    if (this.extraSetters.onLog) {
      this.extraSetters.onLog(message);
    } else {
      console.log(`[SDK LOG] ${message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // CONVENIENT DIRECT TOP-LEVEL ALIASES
  // ─────────────────────────────────────────────────────────────
  createRoof(args: any): Shape { return this.architecture.createRoof(args); }
  updateRoof(roofId: string, params: any): void { this.architecture.updateRoof(roofId, params); }
  createStairs(args: any): Shape { return this.architecture.createStairs(args); }
  createRailing(args: any): Shape { return this.architecture.createRailing(args); }
  createRoom(args: any): any { return this.architecture.createRoom(args); }
  createWall(args: any): Shape { return this.architecture.createWall(args); }
  addPlant(speciesId?: string, options?: any): Shape { return this.landscape.addPlant(speciesId, options); }
  addSiteFurniture(type: any, options?: any): Shape { return this.landscape.addSiteFurniture(type, options); }
  applyMaterial(target: any, material: any): void { this.materials.applyMaterial(target, material); }
  addDimension(start: [number, number, number], end: [number, number, number], label?: string): Shape {
    return this.measurement.addDimension(start, end, label);
  }
  measureDistance(p1: [number, number, number], p2: [number, number, number]): any {
    return this.measurement.measureDistance(p1, p2);
  }
  duplicateObject(id: string, offset?: [number, number, number]): Shape | null {
    return this.selection.duplicateObject(id, offset);
  }
  group(ids: string[], groupName?: string): string { return this.selection.group(ids, groupName); }
  ungroup(groupIdOrIds: string | string[]): void { this.selection.ungroup(groupIdOrIds); }
  isolateObject(id: string): void { this.selection.isolateObject(id); }
  unhideAll(): void { this.selection.unhideAll(); }
  transformObject(id: string, transform: any): void { this.selection.transformObject(id, transform); }
  select(idOrIds: string | string[]): void { this.selection.select(idOrIds); }
  selectObject(idOrIds: string | string[]): void { this.selection.select(idOrIds); }
  clearScene(confirm?: boolean): void { this.scene.clearScene(confirm); }
  exportScene(): string { return this.scene.exportJSON(); }
  getStats(): any { return this.scene.getStats(); }

  createToolbar(config: CustomToolbarConfig): CustomToolbarDef {
    return this.toolbars.create(config);
  }

  addToolbarButton(toolbarId: string, button: CustomToolbarButton): void {
    if (toolbarId === 'basic' || toolbarId === 'left') {
      this.toolbars.addToBasicToolbar(button);
    } else {
      this.toolbars.addButton(toolbarId, button);
    }
  }
}
