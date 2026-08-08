export type ToolType = 
  | 'select' | 'lasso' | 'eraser' | 'paint' | 'component'
  | 'line' | 'poly' | 'freehand' | 'rectangle' | 'circle' | 'polygon' | 'arc' | 'pie' | 'triangle'
  | 'move' | 'rotate' | 'scale' | 'pushpull' | 'followme' | 'offset' | 'flip'
  | 'tape' | 'protractor' | 'dimensions' | 'text' | 'text3d' | 'axes' | 'section'
  | 'orbit' | 'pan' | 'zoom' | 'zoomextents'
  | 'sphere' | 'cone' | 'pyramid' | 'donut' | 'dome'
  | 'bevel' | 'subtract' | 'note' | 'deform';

export type SkyboxType = 'none' | 'golden-hour' | 'woodland' | 'sunrise' | 'twilight' | 'cyberspace-neon' | 'studio';

export interface Shape {
  id: string;
  name?: string;
  type: 'box' | 'rect' | 'circle' | 'line' | 'triangle' | 'prism' | 'sphere' | 'cone' | 'pyramid' | 'donut' | 'dome' | 'custom' | 'poly' | 'measurement';
  position: [number, number, number];
  rotation?: [number, number, number];
  quaternion?: [number, number, number, number];
  scale?: [number, number, number];
  args: any;
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
  contextMenu: { x: number, y: number, type: 'surface' | 'multi' | 'light', data?: any } | null;
  setContextMenu: (menu: { x: number, y: number, type: 'surface' | 'multi' | 'light', data?: any } | null) => void;
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
  previewUrl?: string;
  createdAt: any;
  updatedAt: any;
  isPublic?: boolean;
  password?: string;
  hasPassword?: boolean;
}
