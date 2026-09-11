import type { KernelArcHost } from './tools/kernelArcHost';
import type * as THREE from 'three';
import type { FaceId } from './lib/geometry/types';
import type { ToolbarKey, DockZone } from './AppContext';

export type CivilToolMode = 'terrain' | 'road' | 'pad-rect' | 'pad-circle' | 'striping';

export type ToolType = 
  | 'select' | 'lasso' | 'eraser' | 'paint' | 'component'
  | 'line' | 'poly' | 'bezier' | 'freehand' | 'rectangle' | 'circle' | 'polygon' | 'arc' | 'pie' | 'triangle'
  | 'move' | 'rotate' | 'scale' | 'pushpull' | 'followme' | 'offset' | 'flip'
  | 'tape' | 'protractor' | 'dimensions' | 'text' | 'text3d' | 'axes' | 'section'
  | 'orbit' | 'pan' | 'zoom' | 'zoomextents'
  | 'sphere' | 'cone' | 'pyramid' | 'donut' | 'dome'
  | 'bevel' | 'subtract' | 'note' | 'deform'
  | 'wall' | 'door' | 'window' | 'step' | 'staircase'
  | 'landscape_plot' | 'landscape_form' | 'landscape_embed' | 'landscape_sculpt' | 'landscape_mask' | 'landscape_road' | 'landscape_zone' | 'landscape_texture'
  | 'tree' | 'bush' | 'fence' | 'railing' | 'lamp' | 'bench' | 'rock'
  | 'roof' | 'timber-frame' | 'scale_figure'
  | CivilToolMode;

export type ToolMode = ToolType | CivilToolMode;

export type SkyboxType = 'none' | 'golden-hour' | 'woodland' | 'sunrise' | 'twilight' | 'cyberspace-neon' | 'studio';

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
  textureScale?: number;
  roughness?: number;
  topography?: string;
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

export interface Shape {
  id: string;
  name?: string;
  type: 'box' | 'rect' | 'circle' | 'line' | 'triangle' | 'prism' | 'sphere' | 'cone' | 'pyramid' | 'donut' | 'dome' | 'cylinder' | 'custom' | 'poly' | 'bezier' | 'measurement' | 'arc' | 'wall' | 'door' | 'window' | 'step' | 'staircase' | 'terrain' | 'tree' | 'bush' | 'fence' | 'railing' | 'lamp' | 'bench' | 'rock' | 'roof' | 'scale_figure';
  position: [number, number, number];
  rotation?: [number, number, number];
  quaternion?: [number, number, number, number];
  scale?: [number, number, number];
  args: any;
  terrainData?: TerrainData;
  color: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  tags?: string[];
  groupId?: string; hidden?: boolean;
  surfaceMaterials?: Record<number, string>; // face index -> material/color
  surfaceDivisions?: Record<number, number | [number, number]>; // face index -> gridSize or [gridX, gridY]
  bevelAmount?: number;
  bevelType?: 'radius' | 'chamfer';
  bevelSegments?: number;
  geometryData?: any; // For custom/CSG meshes
  hostWallId?: string; // For door/window shapes hosted on a wall
  archStyle?: string; // Style identifier for architectural doors, windows, and stairs
  wallStyle?: string;
  stairStyle?: 'straight' | 'l-shape' | 'u-shape' | 'c-shape' | 'winder' | 'spiral' | 'curved' | 'bifurcated' | string;
  stairStructure?: 'closed' | 'open' | 'floating' | 'mono-stringer';
  railingMode?: 'none' | 'left' | 'right' | 'both';
  parentShapeId?: string;
  parentDepth?: number;
  faceIndex?: number;
  customBounds?: { minU: number; maxU: number; minV: number; maxV: number };
  isRingSection?: boolean;
  plantSpeciesId?: string;
  plantVariation?: string;
  roofData?: any;
  roofTileData?: any;
  textureUrl?: string;
  isParametric?: boolean;
  parametricData?: any;
  customData?: any;
  parentWallOrRoofId?: string;
  timberFrame?: TimberFrameShapeData;
  timberMemberData?: TimberMemberData;
  layerStack?: LayerStackItem[];
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
}

export interface CustomLight {
  id: string;
  type: 'point' | 'directional' | 'spot' | 'projector' | 'rect';
  color: string;
  intensity: number;
  contrast?: number; // 0 to 1
  position: [number, number, number];
  target?: [number, number, number];
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
  type: 'confetti' | 'fire' | 'smoke' | 'sparks' | 'magic_aura';
  position: [number, number, number];
  density: number;
  scale?: number;
  looping: boolean;
  playing: boolean;
}

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
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  measurements: string;
  setMeasurements: (val: string) => void;
  activeMaterial: string;
  setActiveMaterial: (color: string) => void;
  activePBR: { roughness: number, metalness: number, opacity: number };
  setActivePBR: (pbr: { roughness: number, metalness: number, opacity: number }) => void;
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
  addShape: (shape: Shape) => void;
  removeShape: (id: string) => void;
  updateShapeColor: (id: string, color: string, pbr?: { roughness: number, metalness: number, opacity: number }) => void;
  updateShapeDimensions: (id: string, position: [number, number, number], args: any) => void;
  isAIRendererOpen: boolean;
  setIsAIRendererOpen: (open: boolean) => void;
  isAIQueryOpen: boolean;
  setIsAIQueryOpen: (open: boolean) => void;
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
  activeBevelType: 'radius' | 'chamfer';
  setActiveBevelType: (type: 'radius' | 'chamfer') => void;
  skybox: SkyboxType;
  setSkybox: (skybox: SkyboxType) => void;
  customLights: CustomLight[];
  setCustomLights: (lights: CustomLight[] | ((prev: CustomLight[]) => CustomLight[])) => void;
  fogSettings: FogSettings;
  setFogSettings: (settings: FogSettings | ((prev: FogSettings) => FogSettings)) => void;
  gridEnabled: boolean;
  setGridEnabled: (enabled: boolean) => void;
  floorEnabled: boolean;
  setFloorEnabled: (enabled: boolean) => void;
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
  recordAction: (code: string) => void;
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
  isWorldViewOpen: boolean;
  setIsWorldViewOpen: (open: boolean) => void;
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
  setViewportToast: (msg: string | null) => void;
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
  terrainModifiers?: TerrainModifier[];
  previewUrl?: string;
  createdAt: any;
  updatedAt: any;
  isPublic?: boolean;
  password?: string;
  hasPassword?: boolean;
}

export * from './lib/PolyformInferenceEngine';

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

export interface CustomToolbarItem {
  id: string;
  label: string;
  icon?: string; // Lucide icon name (e.g. 'Home', 'Hammer', 'TreePine', 'Sparkles'), emoji, or text
  tooltip?: string;
  color?: string;
  badge?: string;
  hotkey?: string;
  code?: string; // JavaScript code to execute
  scriptId?: string; // Reference to existing saved script
  action?: (sdk: any) => void | Promise<void>; // In-memory callback function
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




