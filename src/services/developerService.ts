import * as THREE from 'three';
import { Shape, CustomLight, TerrainData, CustomToolbarDef, CustomToolbarItem, CustomToolbarButton, CustomToolbarConfig } from '../types';
import { getBlockPart, buildBlockGeometry, BLOCK_CATALOG } from '../lib/blockKitGeometry';

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
  unit?: 'm' | 'ft' | 'in' | 'mm';
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
} from '../lib/archRoofGenerator';
import { RoofTileShape, ROOF_TILE_SHAPES } from '../lib/roofTileGenerator';
import {
  createArchitecturalStaircaseGeometry,
  StairStyleType,
  StairStructureType,
  RailingModeType,
  ALL_STAIR_STYLES,
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
import { PLANT_SPECIES_CATALOG, PlantSpecies } from '../lib/plantLibrary';
import { LANDSCAPE_TEXTURES, LandscapeTexturePreset } from '../lib/landscapeTextures';
import { MATERIAL_PRESETS, getMaterialPreset } from '../lib/materialPresets';
import { createTerrainShape } from '../lib/terrain/terrainFactory';
import { generateTimberFraming, TimberFrameOptions } from '../lib/timberFrameGenerator';
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
      position?: [number, number, number];
      wallColor?: string;
      floorColor?: string;
      ceilingColor?: string;
    }) => { roomId: string; wallShapes: Shape[]; floorShape?: Shape; ceilingShape?: Shape };
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
      color?: string;
    }) => Shape;
    createWindow: (args: {
      width?: number;
      height?: number;
      depth?: number;
      position?: [number, number, number];
      color?: string;
    }) => Shape;
    setWallTransparency: (settings: { overall?: number; exterior?: number; interior?: number }) => void;
    generateTimberFraming: (options?: {
      roofId?: string;
      spacing?: number;
      rafterWidth?: number;
      rafterDepth?: number;
      species?: string;
      color?: string;
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
    configureSculptSettings: (settings: { radius?: number; strength?: number; mode?: 'raise' | 'lower' | 'smooth' | 'flatten' }) => void;
    getSculptSettings: () => any;
    configureRoadSettings: (settings: { width?: number; curbHeight?: number; material?: string }) => void;
    getRoadSettings: () => any;
  };

  // Materials & PBR Subsystem
  materials: {
    applyMaterial: (target: Shape | string, material: string | {
      color?: string;
      roughness?: number;
      metalness?: number;
      opacity?: number;
      textureUrl?: string;
      normalScale?: number;
      uvScale?: number;
    }) => void;
    setEdgeLines: (settings: { enabled?: boolean; color?: string; opacity?: number; thickness?: number }) => void;
    listPresets: () => string[];
    configureMaterialDefaults: (settings: MaterialConfigDefaults) => void;
    getMaterialDefaults: () => MaterialConfigDefaults;
  };

  // Measurement & Dimensioning Subsystem
  measurement: {
    addDimension: (start: [number, number, number], end: [number, number, number], label?: string) => Shape;
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
    setUnit: (unit: 'm' | 'ft' | 'in' | 'mm') => void;
    getUnit: () => string;
    configureMeasurementSettings: (settings: MeasurementConfigDefaults) => void;
    getMeasurementSettings: () => MeasurementConfigDefaults;
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
  public shapes: Shape[];
  public setShapes: (shapes: Shape[] | ((prev: Shape[]) => Shape[])) => void;
  public updateShapeColor: (id: string, color: string) => void;
  public selectedId: string | null;
  public extraSetters: any;

  // Subsystems
  public architecture: any;
  public landscape: any;
  public materials: any;
  public measurement: any;
  public selection: any;
  public camera: any;
  public ai: any;
  public scene: any;
  public outliner: any;
  public blockKit: any;
  public worldView: any;
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
    this.setShapes = setShapes;
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
            numSteps
          },
          geometryData: geometryToData(geom)
        };

        this.setShapes(prev => [...prev, stairShape]);
        this.log(`Created parametric stairs (${style}, height: ${height}m, steps: ${numSteps}, structure: ${structure}).`);
        return stairShape;
      },

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
        position?: [number, number, number];
        wallColor?: string;
        floorColor?: string;
        ceilingColor?: string;
      }): { roomId: string; wallShapes: Shape[]; floorShape?: Shape; ceilingShape?: Shape } => {
        const width = Math.max(1, args.width);
        const length = Math.max(1, args.length);
        const height = args.height ?? 2.8;
        const wallThick = args.wallThickness ?? 0.20;
        const pos = args.position || [0, 0, 0];
        const roomId = `room-${Math.random().toString(36).substr(2, 7)}`;
        const wallColor = args.wallColor || '#f8fafc';
        const floorColor = args.floorColor || '#94a3b8';
        const ceilingColor = args.ceilingColor || '#e2e8f0';

        const hw = width / 2;
        const hl = length / 2;
        const floorY = pos[1];
        const wallMidY = floorY + height / 2;
        const ceilingY = floorY + height;

        const wallShapes: Shape[] = [];

        // North wall (+Z)
        const nWall: Shape = {
          id: `${roomId}-wall-n`,
          name: `Room Wall (North)`,
          type: 'wall',
          position: [pos[0], wallMidY, pos[2] + hl],
          rotation: [0, 0, 0],
          args: [width, height, wallThick],
          color: wallColor,
          tags: ['architecture', 'wall', 'exterior-wall'],
          customData: { roomId, orientation: 'north' }
        };
        // South wall (-Z)
        const sWall: Shape = {
          id: `${roomId}-wall-s`,
          name: `Room Wall (South)`,
          type: 'wall',
          position: [pos[0], wallMidY, pos[2] - hl],
          rotation: [0, 0, 0],
          args: [width, height, wallThick],
          color: wallColor,
          tags: ['architecture', 'wall', 'exterior-wall'],
          customData: { roomId, orientation: 'south' }
        };
        // East wall (+X)
        const eWall: Shape = {
          id: `${roomId}-wall-e`,
          name: `Room Wall (East)`,
          type: 'wall',
          position: [pos[0] + hw, wallMidY, pos[2]],
          rotation: [0, Math.PI / 2, 0],
          args: [length - wallThick * 2, height, wallThick],
          color: wallColor,
          tags: ['architecture', 'wall', 'exterior-wall'],
          customData: { roomId, orientation: 'east' }
        };
        // West wall (-X)
        const wWall: Shape = {
          id: `${roomId}-wall-w`,
          name: `Room Wall (West)`,
          type: 'wall',
          position: [pos[0] - hw, wallMidY, pos[2]],
          rotation: [0, Math.PI / 2, 0],
          args: [length - wallThick * 2, height, wallThick],
          color: wallColor,
          tags: ['architecture', 'wall', 'exterior-wall'],
          customData: { roomId, orientation: 'west' }
        };

        wallShapes.push(nWall, sWall, eWall, wWall);
        const shapesToAdd: Shape[] = [...wallShapes];

        let floorShape: Shape | undefined;
        if (args.includeFloor !== false) {
          floorShape = {
            id: `${roomId}-floor`,
            name: `Room Floor Slab`,
            type: 'box',
            position: [pos[0], floorY - 0.1, pos[2]],
            args: [width + 0.4, 0.2, length + 0.4],
            color: floorColor,
            tags: ['architecture', 'slab', 'floor'],
            customData: { roomId }
          };
          shapesToAdd.push(floorShape);
        }

        let ceilingShape: Shape | undefined;
        if (args.includeCeiling) {
          ceilingShape = {
            id: `${roomId}-ceiling`,
            name: `Room Ceiling Slab`,
            type: 'box',
            position: [pos[0], ceilingY + 0.1, pos[2]],
            args: [width, 0.2, length],
            color: ceilingColor,
            tags: ['architecture', 'slab', 'ceiling'],
            customData: { roomId }
          };
          shapesToAdd.push(ceilingShape);
        }

        this.setShapes(prev => [...prev, ...shapesToAdd]);
        this.log(`Created room ${roomId} (${width}m x ${length}m x ${height}m, 4 walls + floor slab).`);
        return { roomId, wallShapes, floorShape, ceilingShape };
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
        color?: string;
      }): Shape => {
        const width = args.width ?? this.doorDefaults.width ?? 0.90;
        const height = args.height ?? this.doorDefaults.height ?? 2.10;
        const depth = args.depth ?? this.doorDefaults.depth ?? 0.15;
        const pos: [number, number, number] = args.position || [0, height / 2, 0];
        const geom = createDoorGeometry(width, height, depth);
        const id = Math.random().toString(36).substr(2, 9);
        const doorShape: Shape = {
          id,
          name: `Door (${width}m x ${height}m)`,
          type: 'door',
          position: pos,
          args: [width, height, depth],
          color: args.color || this.doorDefaults.color || '#78350f',
          tags: ['architecture', 'door', 'opening'],
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
        color?: string;
      }): Shape => {
        const width = args.width ?? this.windowDefaults.width ?? 1.20;
        const height = args.height ?? this.windowDefaults.height ?? 1.50;
        const depth = args.depth ?? this.windowDefaults.depth ?? 0.15;
        const pos: [number, number, number] = args.position || [0, 1.5, 0];
        const geom = createWindowGeometry(width, height, depth);
        const id = Math.random().toString(36).substr(2, 9);
        const windowShape: Shape = {
          id,
          name: `Window (${width}m x ${height}m)`,
          type: 'window',
          position: pos,
          args: [width, height, depth],
          color: args.color || this.windowDefaults.frameColor || '#ffffff',
          tags: ['architecture', 'window', 'opening'],
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
        rafterWidth?: number;
        rafterDepth?: number;
        species?: string;
        color?: string;
      }): Shape[] => {
        try {
          const framingOpts: TimberFrameOptions = {
            studSpacing: options?.spacing ?? this.timberFramingDefaults.studSpacing ?? 0.60,
            studWidth: options?.rafterWidth ?? this.timberFramingDefaults.studWidth ?? 0.045,
            studDepth: options?.rafterDepth ?? this.timberFramingDefaults.studDepth ?? 0.145,
            timberColor: options?.color || this.timberFramingDefaults.timberColor || '#b45309',
            includeRoof: this.timberFramingDefaults.includeRoof ?? true,
            includeWalls: this.timberFramingDefaults.includeWalls ?? true
          };
          const result = generateTimberFraming(this.shapes, framingOpts);
          if (result && result.shapes && result.shapes.length > 0) {
            this.setShapes(prev => [...prev, ...result.shapes]);
            if (this.extraSetters.commitUpdatedFraming) {
              this.extraSetters.commitUpdatedFraming(result.shapes);
            }
            this.log(`Generated ${result.shapes.length} timber framing elements.`);
            return result.shapes;
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

      configureSculptSettings: (settings: { radius?: number; strength?: number; mode?: 'raise' | 'lower' | 'smooth' | 'flatten' }): void => {
        if (this.extraSetters.setLandscapeSculptSettings) {
          this.extraSetters.setLandscapeSculptSettings((prev: any) => ({ ...prev, ...settings }));
        }
        this.log(`Configured sculpt settings: ${JSON.stringify(settings)}`);
      },

      getSculptSettings: (): any => {
        return this.extraSetters.landscapeSculptSettings || {};
      },

      configureRoadSettings: (settings: { width?: number; curbHeight?: number; material?: string }): void => {
        if (this.extraSetters.setLandscapeRoadSettings) {
          this.extraSetters.setLandscapeRoadSettings((prev: any) => ({ ...prev, ...settings }));
        }
        this.log(`Configured road settings: ${JSON.stringify(settings)}`);
      },

      getRoadSettings: (): any => {
        return this.extraSetters.landscapeRoadSettings || {};
      }
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
        else if (currentUnit === 'ft') formatted = `${(dist * 3.28084).toFixed(2)}ft`;
        else if (currentUnit === 'in') formatted = `${(dist * 39.3701).toFixed(1)}in`;

        return { distance: dist, dx, dy, dz, horizontalRun: horiz, rise: dy, pitchDeg, formatted };
      },

      addDimension: (start: [number, number, number], end: [number, number, number], label?: string): Shape => {
        const info = this.measurement.measureDistance(start, end);
        const mid: [number, number, number] = [
          (start[0] + end[0]) / 2,
          (start[1] + end[1]) / 2 + 0.15,
          (start[2] + end[2]) / 2
        ];
        const id = Math.random().toString(36).substr(2, 9);
        const dimShape: Shape = {
          id,
          name: `Dimension: ${label || info.formatted}`,
          type: 'measurement',
          position: mid,
          args: [start, end],
          color: '#0284c7',
          tags: ['annotation', 'dimension', 'measurement'],
          customData: {
            start,
            end,
            distance: info.distance,
            label: label || info.formatted
          }
        };
        this.setShapes(prev => [...prev, dimShape]);
        this.log(`Added dimension line: ${label || info.formatted} from [${start}] to [${end}].`);
        return dimShape;
      },

      setUnit: (unit: 'm' | 'ft' | 'in' | 'mm'): void => {
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
      }
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
      }
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
    this.shapes.push(newShape);
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
    this.setShapes(prev => [...prev, newShape]);
    this.log(`Added object (${type}) ${id}.`);
    return newShape;
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
