import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { ToolType, AppState, Shape, Tag, SceneState, SkyboxType, FogSettings, SceneAnimation, SceneNote, Collaborator, ChatMessage, DiagLogEntry, CustomLight, isTextureUrl, CustomToolbarDef, CustomToolbarItem, TerrainModifier, PadPrimitiveType, BatterFalloffType, RoadMarkingPreset, ParkingAngle, CutFillMetrics, ToolbarKey, DockZone } from './types';
import { WallToolSettings, WallJustification, DEFAULT_WALL_SETTINGS } from './tools/inference/types';
import { db, auth, handleFirestoreError, OperationType, isQuotaLocked, restoreFirestoreArraysAfterLoad, cleanFirestoreDataForSave, offloadLargeGeometryForSave, hydrateOffloadedGeometry, firebaseGeometryIO } from './firebase';
import { KernelArcHost } from './tools/kernelArcHost';
import type { FaceId } from './lib/geometry/types';
import { serializeGraph, deserializeGraph } from './lib/geometry/serialize';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, query, where, getDocs, or, setDoc, getDoc, orderBy, limit, serverTimestamp, runTransaction } from 'firebase/firestore';
import { applyStairwellHolesToSlabs } from './lib/archStairwell';
import { flattenTerrainForFloorSlabs } from './lib/archRoomAssembly';
import { updateTimberFramesIfPresent, generateTimberFrameForWall, generateTimberFrameForRoof, generateTimberFrameForBuilding } from './lib/timberFrameGenerator';
import { DEFAULT_TIMBER_FRAME_PARAMS } from './constants/timberFrameDefaults';
import { TimberFrameParams, TimberFrameRecomputeState, WalkModePhase } from './types';
import { createWalkBridge } from './lib/walkMode/inputState';
import { MOVEMENT_SPEED_RANGE, MOUSE_SENSITIVITY_RANGE } from './lib/walkMode/constants';
import { defaultGraphicsSettings, normalizeGraphicsSettings } from './lib/graphics/graphicsSettings';
import type { EnvironmentState, MaterialInstance } from './lib/assets/types';
import { legacyEnvironmentState } from './lib/assets/legacyAdapter';
import { readAssetProjectState } from './lib/assets/projectCodec';

const AppContext = createContext<AppState | undefined>(undefined);

const INITIAL_SHAPES: Shape[] = [];

const DEFAULT_FOG: FogSettings = {
  enabled: false,
  type: 'standard',
  colorCount: 1,
  colors: ['#FFFFFF', '#D3D3D3', '#A9A9A9'],
  density: 0.015,
  height: 0,
  heightEnd: 10,
  animate: false,
  speed: 10,
  superMegaDensity: 0.01
};

// Sanitizing for Firestore (stripping undefined values and wrapping nested
// arrays, e.g. roofData.localWallPoly/localEavePoly on L-shaped and
// general-polygon roofs) lives in firebase.ts as cleanFirestoreDataForSave,
// shared with every other write site - this is the live auto-sync push, so
// without it every edit to a model containing such a roof failed silently.
const cleanData = cleanFirestoreDataForSave;

// Re-exported for existing importers (e.g. App.tsx's `import { ... type
// ToolbarKey, type DockZone } from './AppContext'`) — the actual
// definitions live in types.ts now. See types.ts's own comment on why:
// this file is not part of the geometry kernel, but types.ts is imported
// by all of it, and tsconfig.kernel.json's strict settings used to get
// applied to this entire file's dependency graph as a result of the
// reverse import that used to live in types.ts.
export type { ToolbarKey, DockZone };

export function AppProvider({ children }: { children: React.ReactNode }) {
  // --- Geometry kernel -----------------------------------------------------
  // Coexists with Shape[]: the kernel owns DRAWN geometry (lines, arcs,
  // rectangles, polygons), Shape[] keeps primitives, plants and terrain.
  const [kernelRevision, setKernelRevision] = useState(0);
  const bumpKernel = useCallback(() => setKernelRevision((r) => r + 1), []);
  const kernelHostRef = useRef<KernelArcHost | null>(null);
  if (!kernelHostRef.current) {
    kernelHostRef.current = new KernelArcHost({
      // PolyForm is Y-up (three.js default), so tell the kernel. Without it,
      // §6.4's "horizontal faces point up" rule never fires for a ground-plane
      // face and orientation falls through to the camera heuristic.
      upAxis: { x: 0, y: 1, z: 0 },
      onChange: () => bumpKernel(),
    });
  }
  const kernelHost = kernelHostRef.current;

  // Kernel face selection. Deliberately separate from selectedIds: those are
  // Shape ids (strings), these are FaceIds (numbers) in the kernel graph, and
  // conflating them would make every consumer guess which it is holding.
  const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);

  // Selection tool settings (Lasso / Marquee)
  const [selectionShapeMode, setSelectionShapeMode] = useState<'lasso' | 'marquee'>('lasso');
  const [selectionFilter, setSelectionFilter] = useState<'all' | 'shapes' | 'surfaces'>('all');
  const [selectionCriteria, setSelectionCriteria] = useState<'crossing' | 'window'>('crossing');


  /**
   * Swaps the kernel graph's contents in place.
   *
   * The host holds one Graph object and the spatial index is built against
   * it, so the object identity must survive; only its contents change. Pass
   * null to empty it.
   */
  const replaceKernelGraph = useCallback((data: unknown) => {
    const next = deserializeGraph(data as never);
    const g = kernelHostRef.current!.graph;
    g.vertices = next.vertices;
    g.edges = next.edges;
    g.loops = next.loops;
    g.faces = next.faces;
    g.curves = next.curves;
    g.components = next.components;
    g.nextId = next.nextId;
    kernelHostRef.current!.reindex();
    setSelectedFaceIds([]);
    setKernelRevision(r => r + 1);
  }, []);

  // Console handle for driving the kernel by hand.
  //
  // Enabled in dev, OR on any build when ?kernel-dev is in the URL. The
  // published build sets import.meta.env.DEV to false, so a DEV-only guard
  // makes this unreachable exactly where it is most needed — on the deployed
  // app. The query-string opt-in keeps it off by default without hiding it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const enabled = import.meta.env.DEV || params.has('kernel-dev') || params.has('kernel-test');
    if (!enabled) return;

    (window as unknown as Record<string, unknown>).__polyform = { kernelHost, bumpKernel };
    console.info('[PolyForm] kernel handle ready: window.__polyform');

    // ?kernel-test draws a 4x4 square and reports the derived face count, so
    // the kernel can be verified without pasting anything into the console.
    if (params.has('kernel-test')) {
      // On the GROUND plane: y = 0, spanning X and Z. Drawing at z = 0
      // spanning X and Y would stand the square up as a wall in a Y-up world.
      const p0 = { x: 0, y: 0, z: 0 };
      const p1 = { x: 4, y: 0, z: 0 };
      const p2 = { x: 4, y: 0, z: 4 };
      const p3 = { x: 0, y: 0, z: 4 };
      for (const [a, b] of [[p0, p1], [p1, p2], [p2, p3], [p3, p0]] as const) {
        kernelHost.commitSegment(a, b);
      }
      bumpKernel();
      const faces = kernelHost.graph.faces.size;
      const edges = kernelHost.graph.edges.size;
      const ok = faces === 1 && edges === 4;
      console.info(
        `[PolyForm] kernel self-test: ${faces} face(s), ${edges} edge(s) — ` +
          `expected 1 and 4. ${ok ? 'PASS' : 'FAIL'}`,
      );
    }
  }, [kernelHost, bumpKernel]);

  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [measurements, setMeasurements] = useState('');
  /**
   * A dedicated, hard-to-miss banner for things the user actively needs to
   * notice (an unsupported tool, a failed operation) — separate from
   * `measurements`, which is only ever a small, easy-to-miss status-bar
   * readout. Lives in context (not local Viewport/Scene state) and gets
   * rendered from OUTSIDE the R3F <Canvas> specifically: Scene() is
   * rendered by react-three-fiber's own custom reconciler, not react-dom's
   * — a plain <div> (even via createPortal) created from within it is not
   * a THREE object and R3F's reconciler rejects it outright. Rendering the
   * toast from the outer Viewport() component, which react-dom itself
   * renders, sidesteps that entirely.
   */
  const [viewportToast, setViewportToast] = useState<string | null>(null);
  /**
   * Where a new note gets its position from is a genuine 3D interaction
   * (a raycast hit point from a click), which only Scene() can produce —
   * but the dialog that lets the user actually type and confirm the note
   * is plain 2D UI. Lives in context for the same reason `viewportToast`
   * does: the dialog used to be a createPortal call from inside Scene()
   * itself (react-three-fiber's own reconciler, not react-dom's), which is
   * a real, reproduced crash — "Div is not part of the THREE namespace" —
   * not a hypothetical one. Scene() sets this on click; the outer,
   * react-dom-rendered Viewport() function renders the actual dialog.
   */
  const [placingNotePos, setPlacingNotePos] = useState<THREE.Vector3 | null>(null);
  const [activeMaterial, setActiveMaterialState] = useState('#ffffff');
  const [activeMaterialBindingId, setActiveMaterialBindingId] = useState<string | null>(null);
  const [materialBindings, setMaterialBindings] = useState<Record<string, MaterialInstance>>({});
  const [activePBR, setActivePBR] = useState({ roughness: 0.5, metalness: 0, opacity: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedSurface, setSelectedSurface] = useState<{ shapeId: string, faceIndex: number, subFaceIndex?: number } | null>(null);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [placingLightId, setPlacingLightId] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Shape[]>(INITIAL_SHAPES);
  const [isAIRendererOpen, setIsAIRendererOpen] = useState(false);
  const [isAIQueryOpen, setIsAIQueryOpen] = useState(false);
  const [activeBlockPart, setActiveBlockPart] = useState<{ partId: string; color: string; rotationSteps: number; randomPalette?: string[] } | null>(null);
  const [blockPlacementDraft, setBlockPlacementDraft] = useState<{ position: [number, number, number]; rotationSteps: number; blocked?: boolean } | null>(null);
  const [blockPreventOverlap, setBlockPreventOverlap] = useState<boolean>(true);
  const [user, setUser] = useState<any | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  /*
    NOTE: the theme is deliberately NOT mirrored onto <html>.

    Doing so switches on Tailwind's `dark:` variants globally, and PolyForm's
    chrome is only partly dark-aware — the toolbars and panels carry a handful
    of `dark:` rules while most of their colour is hardcoded light. The result
    is dark dialogs floating in a light application, which reads as broken
    rather than as a dark theme.

    Components that need to respond to the theme should read the `theme`
    value from this context, as StyleLibraryModal does. Turning on the global
    variant is a decision for whenever the chrome is genuinely dark-ready.
  */
  const [openMaterialsSignal, setOpenMaterialsSignal] = useState(0);
  const [bannerColor, setBannerColor] = useState('#0063A3');
  const [customMaterials, setCustomMaterials] = useState<any[]>([]);
  const [graphicsSettings, setGraphicsSettings] = useState(defaultGraphicsSettings);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [currentModelName, setCurrentModelName] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [allTagsVisible, setAllTagsVisible] = useState(true);
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [shadowsEnabled, setShadowsEnabled] = useState(false);
  const [showLightsource, setShowLightsource] = useState(false);
  const [showAllDimensions, setShowAllDimensions] = useState(false);
  // Task #155: SketchUp-style edge line rendering settings -- user-configurable on/off, colour, opacity.
  const [edgeLinesEnabled, setEdgeLinesEnabled] = useState<boolean>(true);
  const [edgeLinesColor, setEdgeLinesColor] = useState<string>('#1a1a1a');
  const [edgeLinesOpacity, setEdgeLinesOpacity] = useState<number>(0.3);
  const [edgeLinesThickness, setEdgeLinesThickness] = useState<number>(2);
  const [lightPosition, setLightPosition] = useState<[number, number, number]>([5, 5, 5]);
  // The point the sun orbits around when animateSun is on — defaults to
  // the origin (the design space's own centre), same as it always
  // implicitly did before this existed.
  const [sunOrbitCenter, setSunOrbitCenter] = useState<[number, number, number]>([0, 0, 0]);
  // True for the single click after "Pick Sun Centre" is pressed — the
  // next click anywhere in the viewport (a Shape, a kernel face, or the
  // ground plane) sets sunOrbitCenter to that point and clears this back
  // to false. Mirrors placingNotePos's own click-to-place pattern (see
  // that state's own doc comment) rather than introducing a new
  // activeTool value — this is a one-off pick, not an ongoing drawing
  // mode, so it doesn't belong in that type union.
  const [pickingSunCenter, setPickingSunCenter] = useState(false);
  const [animateSun, setAnimateSun] = useState(false);
  const [sunSpeed, setSunSpeed] = useState(1.0);
  const [sunIntensity, setSunIntensity] = useState(1.0);
  const [shadowOpacity, setShadowOpacity] = useState(0.25);
  const [ambientOcclusionEnabled, setAmbientOcclusionEnabled] = useState(false);
  const [activeBevelType, setActiveBevelType] = useState<'radius' | 'chamfer'>('radius');
  const [skybox, setSkybox] = useState<SkyboxType>('none');
  const [environment, setEnvironment] = useState<EnvironmentState>(() => legacyEnvironmentState('none', 1, 0, 0));
  const [customLights, setCustomLights] = useState<CustomLight[]>([]);
  const [fogSettings, setFogSettings] = useState<FogSettings>(DEFAULT_FOG);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [axisIndicatorEnabled, setAxisIndicatorEnabled] = useState(true);
  const [miniAxisIndicatorEnabled, setMiniAxisIndicatorEnabled] = useState(true);
  const [floorEnabled, setFloorEnabled] = useState(false);
  const [floorColor, setFloorColor] = useState('#f9fafb');

  // Walk Mode (see src/lib/walkMode/ and the Walk Mode spec). Not
  // persisted as the active tool on reload/autosave - it's a transient
  // navigation mode, never part of the saved model.
  const [walkModePhase, setWalkModePhase] = useState<WalkModePhase>('inactive');
  const [walkMovementSpeed, setWalkMovementSpeedState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(MOVEMENT_SPEED_RANGE.storageKey);
      if (stored !== null) {
        const parsed = parseFloat(stored);
        if (Number.isFinite(parsed)) return THREE.MathUtils.clamp(parsed, MOVEMENT_SPEED_RANGE.min, MOVEMENT_SPEED_RANGE.max);
      }
    } catch (e) {}
    return MOVEMENT_SPEED_RANGE.default;
  });
  const setWalkMovementSpeed = (speed: number) => {
    const clamped = THREE.MathUtils.clamp(speed, MOVEMENT_SPEED_RANGE.min, MOVEMENT_SPEED_RANGE.max);
    setWalkMovementSpeedState(clamped);
    try { localStorage.setItem(MOVEMENT_SPEED_RANGE.storageKey, String(clamped)); } catch (e) {}
  };
  const [walkMouseSensitivity, setWalkMouseSensitivityState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(MOUSE_SENSITIVITY_RANGE.storageKey);
      if (stored !== null) {
        const parsed = parseFloat(stored);
        if (Number.isFinite(parsed)) return THREE.MathUtils.clamp(parsed, MOUSE_SENSITIVITY_RANGE.min, MOUSE_SENSITIVITY_RANGE.max);
      }
    } catch (e) {}
    return MOUSE_SENSITIVITY_RANGE.default;
  });
  const setWalkMouseSensitivity = (sensitivity: number) => {
    const clamped = THREE.MathUtils.clamp(sensitivity, MOUSE_SENSITIVITY_RANGE.min, MOUSE_SENSITIVITY_RANGE.max);
    setWalkMouseSensitivityState(clamped);
    try { localStorage.setItem(MOUSE_SENSITIVITY_RANGE.storageKey, String(clamped)); } catch (e) {}
  };
  // Stable for the lifetime of the app - see WalkBridge's own doc comment
  // for why WalkModeController and WalkModeOverlay need this instead of props.
  const walkBridgeRef = useRef(createWalkBridge());
  const [skyboxBlur, setSkyboxBlur] = useState(0);
  const [environmentIntensity, setEnvironmentIntensity] = useState(1.0);
  const [skyboxRotation, setSkyboxRotation] = useState(0);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [toolbarVisibility, setToolbarVisibility] = useState<Record<string, boolean>>({
    component: false
  });
  const [panelVisibility, setPanelVisibility] = useState<Record<string, boolean>>({
    components: false,
    styles: false
  });
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'surface' | 'multi' | 'light' | 'kernel', data?: any, faceId?: any } | null>(null);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'offline' | 'unsaved'>('unsaved');
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const [quotaLockdownTime, setQuotaLockdownTime] = useState<number>(0);
  const [totalReads, setTotalReads] = useState(0);
  
  const checkQuota = () => isQuotaLocked() || Date.now() < quotaLockdownTime;
  const incrementReads = (count: number) => setTotalReads(prev => prev + count);

  const [isDiagnosticLogOpen, setIsDiagnosticLogOpen] = useState(false);
  const [lastInteractionData, setLastInteractionData] = useState<any>(null);
  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagLogEntry[]>([]);
  const [embeddedWebpageUrl, setEmbeddedWebpageUrl] = useState<string | null>(null);

  // Timber Frame Parametric State & Scoped Recompute
  const [timberFrameParams, setTimberFrameParams] = useState<TimberFrameParams>(DEFAULT_TIMBER_FRAME_PARAMS);
  const [timberFrameRecomputeState, setTimberFrameRecomputeState] = useState<TimberFrameRecomputeState>({
    status: 'idle',
    state: 'idle',
    affectedWallIds: [],
    lastComputedAt: null,
  });
  const staleWallOrRoofIdsRef = useRef<Set<string>>(new Set());
  const timberRecomputeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Camera Frustum Depth Clipping (Near and Far Clipping Planes)
  const [cameraDepthClippingEnabled, setCameraDepthClippingEnabled] = useState<boolean>(false);
  const [cameraNear, setCameraNear] = useState<number>(0.1);
  const [cameraFar, setCameraFar] = useState<number>(2000);

  // Wall & Roof Transparency in Architecture Visualization
  const [wallTransparency, setWallTransparency] = useState<number>(0);
  const [exteriorWallTransparency, setExteriorWallTransparency] = useState<number>(0);
  const [interiorWallTransparency, setInteriorWallTransparency] = useState<number>(0);
  const [roofTransparency, setRoofTransparency] = useState<number>(0);
  const [floorTransparency, setFloorTransparency] = useState<number>(0);
  const [fixturesTransparency, setFixturesTransparency] = useState<number>(0);
  
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [isMessagingCollapsed, setIsMessagingCollapsed] = useState(false);
  const [isMessagingDocked, setIsMessagingDocked] = useState(false);
  const [activeBevelAmount, setActiveBevelAmount] = useState(0.5);
  // Default true: this restores SketchUp-style movement friction (dragging pauses
  // briefly the instant two objects' surfaces touch, then lets you continue past it).
  // It's fully wired (Viewport.tsx's handleTransformObjectChange + checkCollision, and
  // the "Contact Friction" toggle in ToolModifierPalette/RightPanelStack), but was
  // defaulting to off with no obvious way to discover the toggle, which made the
  // feature look removed.
  const [contactFrictionEnabled, setContactFrictionEnabled] = useState(true);
  const [contactFrictionStrength, setContactFrictionStrength] = useState(50); // 0-100 scale, default 50%
  const [isToolModifierDocked, setIsToolModifierDocked] = useState(false);
  const [isAIGenerateOpen, setIsAIGenerateOpen] = useState(false);
  const [autoOrbitEnabled, setAutoOrbitEnabled] = useState(false);
  const [orbitRotationSpeed, setOrbitRotationSpeed] = useState(1.0);

  // Architecture & Wall Tool Engine State
  const [wallToolSettings, setWallToolSettings] = useState<WallToolSettings>(DEFAULT_WALL_SETTINGS);
  const [wallJustification, setWallJustification] = useState<WallJustification>('exterior');
  const [activeStory, setActiveStory] = useState<number>(1);
  const [roofModalTargetIds, setRoofModalTargetIds] = useState<string[] | null>(null);
  const [storyPromptTargetIds, setStoryPromptTargetIds] = useState<string[] | null>(null);
  
  const logBuffer = useRef<DiagLogEntry[]>([]);
  const diagLog = (category: string, message: string, values?: Record<string, unknown>) => {
    const entry: DiagLogEntry = {
      time: new Date().toLocaleTimeString('en-GB', { hour12: false }) + '.' + new Date().getMilliseconds().toString().padStart(3, '0'),
      category,
      message,
      values
    };
    logBuffer.current.push(entry);
    
    if (message.includes('Quota exceeded')) {
      setQuotaLockdownTime(Date.now() + 600000);
    }
  };

  const clearDiagnosticLogs = () => {
    setDiagnosticLogs([]);
    logBuffer.current = [];
  };

  // Periodic flush of diagnostic logs to prevent excessive re-renders
  useEffect(() => {
    const interval = setInterval(() => {
      if (logBuffer.current.length > 0) {
        setDiagnosticLogs(prev => {
          const next = [...prev, ...logBuffer.current];
          logBuffer.current = [];
          return next.slice(-200); // Limit to last 200 entries
        });
      }
    }, 250);
    return () => clearInterval(interval);
  }, []);

  // Sync Guards
  const isRemoteUpdate = useRef(false);
  const retrySyncRef = useRef<(() => void) | null>(null);

  /**
   * Push-sync bookkeeping (in-flight flag, pending-retry flag, last-pushed
   * hash, retry backoff state), keyed by model id. A single set of shared
   * refs here used to mean that a slow push for model A still in flight
   * when the user switched to model B would have B's own edits queue up
   * behind A's `pushInProgress`/`needsSync` flags — and when A's push
   * finally settled, its own `finally` block would re-invoke ITS OWN
   * closure (over A's stale data and A's document id), silently dropping
   * B's pending edit rather than ever pushing it. Scoping this state per
   * model makes each model's push queue fully independent, so a slow or
   * retrying push for one model can never block, drop, or misdirect
   * another model's sync.
   */
  interface ModelSyncState {
    pushInProgress: boolean;
    needsSync: boolean;
    lastStateHash: string;
    retryCount: number;
    retryTimeoutId: ReturnType<typeof setTimeout> | null;
  }
  const syncStatesRef = useRef<Map<string, ModelSyncState>>(new Map());
  // Kept in sync with currentModelId on every render (see assignment below,
  // right after currentModelId itself is declared) so the *Silent setters
  // just below — which intentionally use an empty useCallback dependency
  // array — can reset the right model's sync state instead of a stale one
  // captured from their first render.
  const currentModelIdRef = useRef<string | null>(null);
  currentModelIdRef.current = currentModelId;
  const getSyncState = (modelId: string): ModelSyncState => {
    let s = syncStatesRef.current.get(modelId);
    if (!s) {
      s = { pushInProgress: false, needsSync: false, lastStateHash: '', retryCount: 0, retryTimeoutId: null };
      syncStatesRef.current.set(modelId, s);
    }
    return s;
  };

  // Developer Suite
  const [isDeveloperConsoleOpen, setIsDeveloperConsoleOpen] = useState(false);
  const [activeDeveloperTab, setActiveDeveloperTab] = useState<'console' | 'library' | 'settings' | 'docs' | 'fullDocs' | 'spec'>('console');
  const [developerScripts, setDeveloperScripts] = useState<any[]>([]);
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [unit, setUnit] = useState<'mm' | 'cm' | 'm'>('m');
  const [allNotesVisible, setAllNotesVisible] = useState(true);
  const [showCollaboratorCursors, setShowCollaboratorCursors] = useState(true);

  // Sync scripts with Firestore (Optimized: One-time fetch with cache)
  const lastScriptsFetch = useRef<number>(0);
  const SCRIPTS_CACHE_TIME = 300000; // 5 minutes cache

  const fetchScripts = async (force = false) => {
    if (!user?.uid || checkQuota()) return;
    const now = Date.now();
    if (!force && now - lastScriptsFetch.current < SCRIPTS_CACHE_TIME && developerScripts.length > 0) return;

    try {
      const q = query(
        collection(db, 'scripts'),
        or(
          where('userId', '==', user.uid),
          where('isPublic', '==', true)
        ),
        limit(200)
      );
      const snapshot = await getDocs(q);
      incrementReads(snapshot.size || 1);
      const scripts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setDeveloperScripts(scripts);
      lastScriptsFetch.current = now;
    } catch (error: any) {
      console.error('[Scripts] Fetch error:', error);
      handleFirestoreError(error, OperationType.LIST, 'scripts');
    }
  };

  useEffect(() => {
    fetchScripts();
  }, [user?.uid, quotaLockdownTime]);

  // Sync materials with Firestore (Optimized: One-time fetch)
  const lastMaterialsFetch = useRef<number>(0);
  const fetchMaterials = async (force = false) => {
    if (!user?.uid || checkQuota()) return;
    const now = Date.now();
    if (!force && now - lastMaterialsFetch.current < SCRIPTS_CACHE_TIME && customMaterials.length > 0) return;

    try {
      const q = query(
        collection(db, 'materials'),
        where('userId', '==', user.uid),
        limit(500)
      );
      const snapshot = await getDocs(q);
      incrementReads(snapshot.size || 1);
      const materials = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCustomMaterials(materials);
      lastMaterialsFetch.current = now;
    } catch (error: any) {
      console.error('[Materials] Fetch error:', error);
      handleFirestoreError(error, OperationType.LIST, 'materials');
    }
  };

  useEffect(() => {
    fetchMaterials();
  }, [user?.uid, quotaLockdownTime]);

  const [developerCode, setDeveloperCode] = useState(`// Example: Create a rectangle
const myRect = sdk.createRectangle({
  width: 5,
  height: 3,
  position: [0, 0, 0]
});

console.log("Created rectangle:", myRect.id);`);
  const [developerSuiteWidth, setDeveloperSuiteWidth] = useState(800);
  const [isDeveloperSuiteCollapsed, setIsDeveloperSuiteCollapsed] = useState(false);
  const [pinnedScripts, setPinnedScripts] = useState<string[]>([]);
  const [customToolbars, setCustomToolbars] = useState<CustomToolbarDef[]>([]);
  const [basicToolbarExtensions, setBasicToolbarExtensions] = useState<CustomToolbarItem[]>([]);

  // Code Recorder
  const [codeRecorderEnabled, setCodeRecorderEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedCode, setRecordedCode] = useState('');
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [animations, setAnimations] = useState<SceneAnimation[]>([]);
  const [placingAnimationId, setPlacingAnimationId] = useState<string | null>(null);
  
  // Notes
  const [notes, setNotes] = useState<SceneNote[]>([]);
  const [placingNoteId, setPlacingNoteId] = useState<string | null>(null);
  
  // Collaboration
  const [isCollaborationOpen, setIsCollaborationOpen] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [defaultCameraPosition, setDefaultCameraPosition] = useState<[number, number, number]>([14, 12, 16]);
  const [defaultCameraTarget, setDefaultCameraTarget] = useState<[number, number, number]>([0, 0, 0]);
  const [zoom, setZoom] = useState(1.0);
  
  // Rectangle Input Mode
  const [rectangleInputState, setRectangleInputState] = useState<{
    active: boolean;
    startPoint: { x: number, y: number, z: number } | null;
    width: string;
    depth: string;
  }>({
    active: false,
    startPoint: null,
    width: '',
    depth: ''
  });
  
  // Deformation
  const [deformationSettings, setDeformationSettings] = useState({
    radius: 1,
    density: 1,
    direction: 'outward' as 'outward' | 'inward' | 'both',
    strength: 0.5
  });
  
  // Subtract
  const [subtractCutterId, setSubtractCutterId] = useState<string | null>(null);
  const [subtractTargetId, setSubtractTargetId] = useState<string | null>(null);
  // The kernel-solid equivalent of subtractTargetId above — a set of
  // FaceIds (the whole group, from groupContaining) rather than a Shape
  // id, since kernel solids don't have their own top-level id the way a
  // Shape does. Kept as a fully separate state rather than unifying the
  // two into one polymorphic type: the click handling for each already
  // lives in two completely separate handlers (Shape mesh vs kernel
  // face), so a shared type would need to be discriminated right back
  // apart at every use anyway.
  const [kernelSubtractTarget, setKernelSubtractTarget] = useState<FaceId[] | null>(null);

  // Basic Toolbar (Enabled by default, persisted across sessions)
  const [isBasicToolbarEnabled, setIsBasicToolbarEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('polyform_basic_toolbar');
      if (stored !== null) return stored === 'true';
    } catch (e) {}
    return true;
  });

  const setIsBasicToolbarEnabled = (val: boolean | ((prev: boolean) => boolean)) => {
    setIsBasicToolbarEnabledState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        localStorage.setItem('polyform_basic_toolbar', String(next));
      } catch (e) {}
      return next;
    });
  };

  // Architecture Toolbar (Disabled by default, persisted across sessions)
  const [isArchitectureToolbarEnabled, setIsArchitectureToolbarEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('polyform_arch_toolbar');
      if (stored !== null) return stored === 'true';
    } catch (e) {}
    return false;
  });

  const setIsArchitectureToolbarEnabled = (val: boolean | ((prev: boolean) => boolean)) => {
    setIsArchitectureToolbarEnabledState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        localStorage.setItem('polyform_arch_toolbar', String(next));
      } catch (e) {}
      return next;
    });
  };

  // Landscapes Toolbar (Disabled by default, persisted across sessions)
  const [isLandscapesToolbarEnabled, setIsLandscapesToolbarEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('polyform_landscapes_toolbar');
      if (stored !== null) return stored === 'true';
    } catch (e) {}
    return false;
  });

  const setIsLandscapesToolbarEnabled = (val: boolean | ((prev: boolean) => boolean)) => {
    setIsLandscapesToolbarEnabledState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        localStorage.setItem('polyform_landscapes_toolbar', String(next));
      } catch (e) {}
      return next;
    });
  };

  // Camera Toolbar (Enabled by default, persisted across sessions)
  const [isCameraToolbarEnabled, setIsCameraToolbarEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('polyform_camera_toolbar');
      if (stored !== null) return stored === 'true';
    } catch (e) {}
    return true;
  });

  const setIsCameraToolbarEnabled = (val: boolean | ((prev: boolean) => boolean)) => {
    setIsCameraToolbarEnabledState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        localStorage.setItem('polyform_camera_toolbar', String(next));
      } catch (e) {}
      return next;
    });
  };

  // Toolbar Layout Mode ('classic' | 'unified', default 'classic')
  const [layoutMode, setLayoutModeState] = useState<'classic' | 'unified'>(() => {
    try {
      const stored = localStorage.getItem('polyform_layout_mode');
      if (stored === 'classic' || stored === 'unified') return stored;
    } catch (e) {}
    return 'classic';
  });

  const setLayoutMode = (val: 'classic' | 'unified' | ((prev: 'classic' | 'unified') => 'classic' | 'unified')) => {
    setLayoutModeState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        localStorage.setItem('polyform_layout_mode', next);
      } catch (e) {}
      return next;
    });
  };

  /**
   * Which order the classic-layout toolbars (Basic, Architecture,
   * Landscapes, Camera) render in, left to right — user-reorderable by dragging,
   * the same way a desktop app like Word or Excel lets you drag a
   * toolbar to reposition it. Persisted the same way layoutMode is.
   */
  const DEFAULT_TOOLBAR_ORDER: ToolbarKey[] = ['left', 'architecture', 'landscapes', 'camera'];
  const ALL_TOOLBAR_KEYS: ToolbarKey[] = ['left', 'architecture', 'landscapes', 'camera'];
  const [toolbarOrder, setToolbarOrderState] = useState<ToolbarKey[]>(() => {
    try {
      const stored = localStorage.getItem('polyform_toolbar_order');
      if (stored) {
        const parsed = JSON.parse(stored);
        // A valid permutation: every element a real toolbar key, no
        // duplicates, and one entry per key this stored value predates
        // 'camera' by (3, from before that toolbar existed) or covers all
        // 4. Anything else (missing/duplicate keys, unknown values) falls
        // back to the default rather than being used half-broken.
        if (
          Array.isArray(parsed) &&
          new Set(parsed).size === parsed.length &&
          parsed.every((k) => ALL_TOOLBAR_KEYS.includes(k))
        ) {
          if (parsed.length === ALL_TOOLBAR_KEYS.length) {
            return parsed as ToolbarKey[];
          }
          if (parsed.length === ALL_TOOLBAR_KEYS.length - 1 && !parsed.includes('camera')) {
            return [...parsed, 'camera'] as ToolbarKey[];
          }
        }
      }
    } catch (e) {}
    return DEFAULT_TOOLBAR_ORDER;
  });

  const setToolbarOrder = (val: ToolbarKey[] | ((prev: ToolbarKey[]) => ToolbarKey[])) => {
    setToolbarOrderState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        localStorage.setItem('polyform_toolbar_order', JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  /**
   * Which EDGE of the window each classic-layout toolbar is docked to —
   * dragging one all the way to the top or bottom of the window re-docks
   * it there as a horizontal strip, the same way dragging a toolbar to a
   * different edge in Word or Excel re-docks it, rather than just
   * reordering it among its current neighbours. Defaults to 'left' for
   * all four, matching how they've always looked. `toolbarOrder` above
   * still governs relative order WITHIN whichever dock a toolbar ends up
   * in — the two pieces of state are independent by design, so moving a
   * toolbar to a new edge doesn't need to also decide a new order for it.
   */
  const DEFAULT_TOOLBAR_DOCKS: Record<ToolbarKey, DockZone> = {
    left: 'left',
    architecture: 'left',
    landscapes: 'left',
    camera: 'left',
  };
  const [toolbarDocks, setToolbarDocksState] = useState<Record<ToolbarKey, DockZone>>(() => {
    try {
      const stored = localStorage.getItem('polyform_toolbar_docks');
      if (stored) {
        const parsed = JSON.parse(stored);
        const isValidZone = (z: unknown): z is DockZone => z === 'left' || z === 'top' || z === 'bottom';
        if (
          parsed && typeof parsed === 'object' &&
          (['left', 'architecture', 'landscapes'] as ToolbarKey[]).every((k) => isValidZone(parsed[k]))
        ) {
          return {
            left: parsed.left,
            architecture: parsed.architecture,
            landscapes: parsed.landscapes,
            camera: isValidZone(parsed.camera) ? parsed.camera : 'left',
          };
        }
      }
    } catch (e) {}
    return DEFAULT_TOOLBAR_DOCKS;
  });

  const setToolbarDocks = (
    val: Record<ToolbarKey, DockZone> | ((prev: Record<ToolbarKey, DockZone>) => Record<ToolbarKey, DockZone>),
  ) => {
    setToolbarDocksState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        localStorage.setItem('polyform_toolbar_docks', JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  const [landscapeSculptSettings, setLandscapeSculptSettings] = useState<{
    mode: 'push' | 'pull' | 'smooth' | 'flatten' | 'pinch';
    radius: number;
    intensity: number;
    masked: boolean;
  }>({
    mode: 'push',
    radius: 3,
    intensity: 0.5,
    masked: false
  });

  const [landscapeRoadSettings, setLandscapeRoadSettings] = useState<{
    width: number;
    embankment: boolean;
    roadColor: string;
    curbHeight: number;
  }>({
    width: 3.5,
    embankment: true,
    roadColor: '#334155',
    curbHeight: 0.15
  });

  // Plant & Vegetation Selection
  const [activePlantSpecies, setActivePlantSpecies] = useState<string>('ribbon_grass');
  const [activePlantVariation, setActivePlantVariation] = useState<string>('VarA');
  const [activePlantScale, setActivePlantScale] = useState<number>(1.0);

  // Scale Figure Selection
  const [activeScaleFigureCharacter, setActiveScaleFigureCharacter] = useState<string>('architect-alex');
  const [activeScaleFigureHeight, setActiveScaleFigureHeight] = useState<number>(1.78);

  // Civil Toolset & Terrain Studio
  const [terrainModifiers, setTerrainModifiers] = useState<TerrainModifier[]>([]);
  const [selectedModifierId, setSelectedModifierId] = useState<string | null>(null);
  const [activeSplineDraft, setActiveSplineDraft] = useState<[number, number, number][]>([]);
  const [activePadDraft, setActivePadDraft] = useState<{ center: [number, number, number]; dimensions: [number, number]; primitive: 'rectangle' | 'circle' } | null>(null);
  const [isBakeModalOpen, setIsBakeModalOpen] = useState<boolean>(false);
  const [civilRoadSettings, setCivilRoadSettings] = useState<{
    width: number;
    maxGradePercent: number;
    hasCurb: boolean;
    hasDitch: boolean;
    curbWidth: number;
    curbHeight: number;
    ditchWidth: number;
    ditchDepth: number;
    markings: RoadMarkingPreset;
    material: string;
  }>({
    width: 6.0,
    maxGradePercent: 8.0,
    hasCurb: true,
    hasDitch: false,
    curbWidth: 0.15,
    curbHeight: 0.15,
    ditchWidth: 1.2,
    ditchDepth: 0.35,
    markings: 'center-dashed',
    material: 'asphalt-weathered',
  });
  const [civilPadSettings, setCivilPadSettings] = useState<{
    primitive: PadPrimitiveType;
    batterDistance: number;
    batterProfile: BatterFalloffType;
    targetElevation: number;
    dimensions: [number, number];
  }>({
    primitive: 'rectangle',
    batterDistance: 3.0,
    batterProfile: 'linear',
    targetElevation: 1.5,
    dimensions: [18, 12],
  });
  const [civilStripingSettings, setCivilStripingSettings] = useState<{
    angle: ParkingAngle;
    stallWidth: number;
    stallDepth: number;
    stripeColor: string;
    doubleRow: boolean;
  }>({
    angle: 90,
    stallWidth: 2.7,
    stallDepth: 5.5,
    stripeColor: '#FFFFFF',
    doubleRow: false,
  });
  const [activeCivilGrade, setActiveCivilGrade] = useState<number | null>(null);
  const [cutFillMetrics, setCutFillMetrics] = useState<CutFillMetrics>({
    cutVolumeM3: 0,
    fillVolumeM3: 0,
    netVolumeM3: 0,
    cutAreaM2: 0,
    fillAreaM2: 0,
  });
  const [showCutFillOverlay, setShowCutFillOverlay] = useState<boolean>(false);

  // Persistence for user settings
  useEffect(() => {
    if (user?.uid) {
      const saveSettings = async () => {
        if (checkQuota()) return;
        try {
          await setDoc(doc(db, 'user_settings', user.uid), {
            theme,
            unit,
            gridEnabled,
            axisIndicatorEnabled,
            miniAxisIndicatorEnabled,
            floorEnabled,
            allNotesVisible,
            defaultCameraPosition,
            defaultCameraTarget,
            isArchitectureToolbarEnabled,
            isLandscapesToolbarEnabled,
            isCameraToolbarEnabled,
            layoutMode,
            updatedAt: Date.now()
          }, { merge: true });
        } catch (error: any) {
          console.error('[Settings] Save error:', error);
          handleFirestoreError(error, OperationType.UPDATE, `user_settings/${user.uid}`);
        }
      };
      
      const timeout = setTimeout(saveSettings, 30000); // 30s debounce for settings
      return () => clearTimeout(timeout);
    }
  }, [theme, unit, gridEnabled, axisIndicatorEnabled, miniAxisIndicatorEnabled, floorEnabled, allNotesVisible, defaultCameraPosition, defaultCameraTarget, isArchitectureToolbarEnabled, isLandscapesToolbarEnabled, isCameraToolbarEnabled, layoutMode, user?.uid]);

  // Load user settings
  const lastSettingsLoad = useRef<number>(0);
  useEffect(() => {
    if (!user?.uid || checkQuota()) return;
    if (Date.now() - lastSettingsLoad.current < 600000) return; // 10 min cache for settings load

    const loadSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'user_settings', user.uid));
        incrementReads(1);
        lastSettingsLoad.current = Date.now();
        if (settingsDoc.exists()) {
          const data = settingsDoc.data();
          if (data.theme) setTheme(data.theme);
          if (data.unit) setUnit(data.unit);
          if (data.gridEnabled !== undefined) setGridEnabled(data.gridEnabled);
          if (data.axisIndicatorEnabled !== undefined) setAxisIndicatorEnabled(data.axisIndicatorEnabled);
          if (data.miniAxisIndicatorEnabled !== undefined) setMiniAxisIndicatorEnabled(data.miniAxisIndicatorEnabled);
          if (data.floorEnabled !== undefined) setFloorEnabled(data.floorEnabled);
          if (data.allNotesVisible !== undefined) setAllNotesVisible(data.allNotesVisible);
          // Deliberately NOT loading data.defaultCameraPosition/
          // defaultCameraTarget here on cold start — confirmed as the
          // actual cause of "click File New has a different zoom level
          // / viewpoint in comparison to when the application first
          // loads." These are user-level settings (this collection is
          // per-user, not per-model), so a value saved from an earlier
          // session — however it got set — silently overrode the
          // [80,80,80]/[0,0,0] default every subsequent cold start,
          // while File > New's own reset-camera event explicitly resets
          // to that same hardcoded default and ignores this collection
          // entirely. Matching that behavior on cold start too, per
          // explicit request, rather than guessing whether the saved-
          // viewpoint feature itself should still exist elsewhere in the
          // app — it's untouched, just no longer loaded automatically
          // here.
          if (data.isArchitectureToolbarEnabled !== undefined) {
            setIsArchitectureToolbarEnabled(Boolean(data.isArchitectureToolbarEnabled));
          }
          if (data.isLandscapesToolbarEnabled !== undefined) {
            setIsLandscapesToolbarEnabled(Boolean(data.isLandscapesToolbarEnabled));
          }
          if (data.isCameraToolbarEnabled !== undefined) {
            setIsCameraToolbarEnabled(Boolean(data.isCameraToolbarEnabled));
          }
          if (data.layoutMode === 'classic' || data.layoutMode === 'unified') {
            setLayoutMode(data.layoutMode);
          }
        }
      } catch (error: any) {
        console.error('[Settings] Load error:', error);
        handleFirestoreError(error, OperationType.GET, `user_settings/${user.uid}`);
      }
    };

    loadSettings();
  }, [user?.uid, quotaLockdownTime]);

  // Real-time Collaboration Sync
  useEffect(() => {
    if (!currentModelId || checkQuota()) {
      setCollaborators(prev => prev.length > 0 ? [] : prev);
      setChatMessages(prev => prev.length > 0 ? [] : prev);
      return;
    }

    // 1. Sync Collaborators
    const collabQuery = query(collection(db, 'collaborations'), where('modelId', '==', currentModelId));
    const unsubCollabs = onSnapshot(collabQuery, (snapshot) => {
      incrementReads(snapshot.size || 1);
      setCollaborators(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)) as Collaborator[]);
    }, (error) => {
       const result = handleFirestoreError(error, OperationType.GET, 'collaborations');
       if (result.isQuotaError) setQuotaLockdownTime(Date.now() + 600000);
    });

    // 2. Sync Chat Messages
    const chatQuery = query(
      collection(db, 'models', currentModelId, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(100)
    );
    const unsubChat = onSnapshot(chatQuery, (snapshot) => {
      incrementReads(snapshot.size || 1);
      setChatMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)) as ChatMessage[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `models/${currentModelId}/messages`);
    });

    // 3. Sync Model Data (Shapes, Tags, etc.)
    const modelRef = doc(db, 'models', currentModelId);
    const unsubModel = onSnapshot(modelRef, { includeMetadataChanges: true }, async (snapshot) => {
      incrementReads(1);
      // If the change is from this client, skip re-applying to prevent flicker/jitter
      if (snapshot.metadata.hasPendingWrites) {
        setSyncStatus('syncing');
        return;
      }

      if (snapshot.exists()) {
        const data = restoreFirestoreArraysAfterLoad(snapshot.data());
        const assetState = readAssetProjectState(data);
        // Reverses offloadLargeGeometryForSave: any shape whose
        // geometryData was too large to store inline in the document (see
        // the sync push above) comes back here as a small URL marker -
        // fetch the real geometry back before it reaches the scene.
        if (Array.isArray(data.shapes)) {
          data.shapes = await hydrateOffloadedGeometry(data.shapes, firebaseGeometryIO);
        }
        isRemoteUpdate.current = true;

        // Update local hash to prevent redundant pushes
        const newState = {
          shapes: data.shapes || [],
          tags: data.tags || [],
          scenes: data.scenes || [],
          customMaterials: data.customMaterials || [],
          graphicsSettings: normalizeGraphicsSettings(data.graphicsSettings),
          animations: data.animations || [],
          timberFrameParams: data.timberFrameParams || null,
          terrainModifiers: data.terrainModifiers || [],
          environment: assetState.environment,
          materialBindings: assetState.materialBindings,
        };
        getSyncState(currentModelId).lastStateHash = JSON.stringify(newState);

        // Replace the kernel graph wholesale, and ALWAYS — including when the
        // document has none. Skipping the empty case is what leaks the
        // previous model's geometry into this one, because the provider (and
        // so the graph) survives a document switch.
        replaceKernelGraph(data.kernel ?? null);

        if (data.shapes) setShapes(data.shapes);
        if (data.tags) setTags(data.tags);
        if (data.scenes) setScenes(data.scenes);
        if (data.customMaterials) setCustomMaterials(data.customMaterials);
        setGraphicsSettings(normalizeGraphicsSettings(data.graphicsSettings));
        if (data.animations) setAnimations(data.animations);
        if (data.notes) setNotes(data.notes);
        if (data.customLights) setCustomLights(data.customLights);
        if (data.timberFrameParams) setTimberFrameParams(data.timberFrameParams);
        if (data.terrainModifiers && Array.isArray(data.terrainModifiers)) setTerrainModifiers(data.terrainModifiers.filter((m: any) => m.type !== 'pad'));
        setEnvironment(assetState.environment);
        setMaterialBindings(assetState.materialBindings);
        if (data.name) setCurrentModelName(data.name);

        setSyncStatus('synced');
        setSyncErrorMessage(null);
      }
    }, (error) => {
      console.error('[Model Sync] Error:', error);
      setSyncStatus('error');
      const result = handleFirestoreError(error, OperationType.GET, `models/${currentModelId}`);
      setSyncErrorMessage(result.message);
      if (result.isQuotaError) setQuotaLockdownTime(Date.now() + 600000);
    });

    // Ensure we have a collaboration document for presence
    const ensurePresence = async () => {
      if (!user?.email || currentModelId.startsWith('new') || checkQuota()) return;

      const email = user.email;
      const uid = user.uid;
      const displayName = user.displayName;
      const collabId = `${currentModelId}_${email.toLowerCase()}`;
      const collabRef = doc(db, 'collaborations', collabId);
      const modelRef = doc(db, 'models', currentModelId);

      try {
        // Two tabs/devices opening the same model at once could both read
        // "no presence doc yet" and both try to create the owner's own
        // presence doc, racing on createdAt/role. A transaction makes the
        // check-then-write atomic: Firestore retries the whole callback if
        // another write lands on collabRef in between its read and write.
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(collabRef);
          if (!snap.exists()) {
            // If we are the owner, create our own presence doc
            const modelSnap = await transaction.get(modelRef);
            if (modelSnap.exists() && modelSnap.data().userId === uid) {
              transaction.set(collabRef, {
                modelId: currentModelId,
                email: email.toLowerCase(),
                uid,
                displayName: displayName || email.split('@')[0],
                role: 'owner',
                status: 'active',
                lastSeen: Date.now(),
                createdAt: serverTimestamp()
              });
            }
          } else {
            // Invited or returning, update status
            transaction.update(collabRef, {
              uid,
              status: 'active',
              lastSeen: Date.now()
            });
          }
        });
        console.log('[Collab] Presence ensured');
      } catch (err: any) {
        console.warn('[Collab] Presence init error:', err);
        handleFirestoreError(err, OperationType.WRITE, `collaborations/${collabId}`);
      }
    };
    ensurePresence();

    return () => {
      unsubCollabs();
      unsubChat();
      unsubModel();
    };
  }, [currentModelId, user?.uid, user?.email, quotaLockdownTime]);

  // Push local changes to Firestore (Debounced)
  useEffect(() => {
    if (!currentModelId || !user) {
      setSyncStatus('unsaved');
      return;
    }
    if (checkQuota()) return;
    
    // If this update was triggered by a remote sync, don't push it back
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }

    // Per-model push state — see its own doc comment above for why this
    // must not be shared across models.
    const syncState = getSyncState(currentModelId);

    // Check if state actually changed
    // kernelRevision stands in for the graph itself: the graph is mutated in
    // place, so hashing it by reference would never change and a
    // geometry-only edit would never be saved.
    const currentState = { shapes, tags, scenes, customMaterials, graphicsSettings, animations, notes, customLights, kernelRevision, timberFrameParams, terrainModifiers, environment, materialBindings };
    const currentStateHash = JSON.stringify(currentState);

    if (currentStateHash === syncState.lastStateHash) {
      return;
    }

    // A genuinely new local edit - drop any backoff retry left over from a
    // previous failure and start counting fresh for this attempt.
    if (syncState.retryTimeoutId) {
      clearTimeout(syncState.retryTimeoutId);
      syncState.retryTimeoutId = null;
    }
    syncState.retryCount = 0;

    const sync = async () => {
      if (checkQuota()) return;
      if (syncState.pushInProgress) {
        syncState.needsSync = true;
        return;
      }

      syncState.pushInProgress = true;
      setSyncStatus('syncing');

      try {
        // Offload any single shape's geometryData that's too large to
        // comfortably fit in a Firestore document (e.g. a detailed
        // roof-tile mesh) to Storage before writing - otherwise a
        // sufficiently detailed design fails outright on every auto-save
        // attempt with "document ... exceeds the maximum allowed size",
        // and this is the path that fires on every edit, not just an
        // explicit Save.
        const offloadedShapes = user?.uid
          ? await offloadLargeGeometryForSave(shapes, user.uid, firebaseGeometryIO)
          : shapes;

        const stateToPush = cleanData({
          shapes: offloadedShapes,
          tags,
          scenes,
          customMaterials,
          graphicsSettings,
          animations,
          notes,
          customLights,
          timberFrameParams,
          terrainModifiers,
          assetSchemaVersion: 1,
          assetCatalogRelease: '2026-09-18-pilot-r1',
          environment,
          materialBindings,
          // Drawn geometry lives in the kernel graph, not in shapes. Without
          // this it is never persisted, and because the provider does not
          // unmount when you switch documents it also leaks between them:
          // the previous model's surfaces appear in the next one.
          kernel: serializeGraph(kernelHost.graph),
          updatedAt: serverTimestamp()
        });

        await updateDoc(doc(db, 'models', currentModelId), stateToPush);
        syncState.lastStateHash = currentStateHash;
        setSyncStatus('synced');
        setSyncErrorMessage(null);
        syncState.retryCount = 0;
      } catch (error: any) {
        console.error('[Sync] Error pushing to Firestore:', error);
        setSyncStatus('error');
        const result = handleFirestoreError(error, OperationType.UPDATE, `models/${currentModelId}`);
        setSyncErrorMessage(result.message);
        // This auto-save path only otherwise surfaces as a small hover
        // tooltip on the status bar's sync icon (see StatusBar.tsx) - easy
        // to miss, and gone the moment the tab closes. Recording it here
        // too means a failed background save is still visible afterwards
        // in the AI Diagnostic Log, with the actual Firestore error code
        // attached, instead of just "a save didn't happen" with no trace
        // of why.
        diagLog('Sync', 'Auto-save to Firestore FAILED', {
          modelId: currentModelId,
          code: error?.code,
          message: error?.message,
          isQuotaError: result.isQuotaError,
          isOfflineError: result.isOfflineError,
          retryCount: syncState.retryCount,
        });

        // Auto-retry with exponential backoff. Quota lockdowns are skipped
        // here since checkQuota() already blocks pushes until it clears -
        // retrying immediately would just fail the same way.
        if (!result.isQuotaError && syncState.retryCount < 5) {
          const delay = Math.min(60000, 10000 * Math.pow(2, syncState.retryCount));
          syncState.retryCount += 1;
          syncState.retryTimeoutId = setTimeout(() => {
            syncState.retryTimeoutId = null;
            sync();
          }, delay);
        }
      } finally {
        syncState.pushInProgress = false;
        if (syncState.needsSync) {
          syncState.needsSync = false;
          sync(); // Clear the backlog
        }
      }
    };

    // Lets the "Sync Error" status badge trigger an immediate manual retry.
    retrySyncRef.current = () => {
      if (syncState.retryTimeoutId) {
        clearTimeout(syncState.retryTimeoutId);
        syncState.retryTimeoutId = null;
      }
      syncState.retryCount = 0;
      sync();
    };

    const timeoutId = setTimeout(sync, 5000); // 5 second debounce for model synchronization
    return () => {
      clearTimeout(timeoutId);
      if (syncState.retryTimeoutId) {
        clearTimeout(syncState.retryTimeoutId);
        syncState.retryTimeoutId = null;
      }
    };
  }, [shapes, tags, scenes, customMaterials, graphicsSettings, animations, notes, customLights, currentModelId, user?.uid, timberFrameParams, terrainModifiers, environment, materialBindings]);

  const retrySync = useCallback(() => {
    retrySyncRef.current?.();
  }, []);

  // Service Worker

  // WorldView
  const [isWorldViewOpen, setIsWorldViewOpen] = useState(false);
  const [worldViewLocation, setWorldViewLocation] = useState<{ lat: number, lng: number, address?: string }>({ lat: 51.5074, lng: -0.1278 }); // London default
  const [worldViewAltitude, setWorldViewAltitude] = useState(-0.1);
  const [worldViewRadius, setWorldViewRadius] = useState(100); // 100m default
  const [worldViewMapType, setWorldViewMapType] = useState<'satellite' | '3d'>('satellite');
  const [googleMapsApiKey, setGoogleMapsApiKeyState] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('polyform_google_maps_api_key');
      if (stored) return stored;
    } catch (e) {}
    return (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';
  });
  const setGoogleMapsApiKey = (key: string) => {
    setGoogleMapsApiKeyState(key);
    try {
      if (key) localStorage.setItem('polyform_google_maps_api_key', key);
      else localStorage.removeItem('polyform_google_maps_api_key');
    } catch (e) {}
  };

  const [isWorldViewActive, setIsWorldViewActive] = useState(false);
  const [focusOnMapTrigger, setFocusOnMapTrigger] = useState(0);

  // Service Worker
  const [swReady, setSwReady] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(() => {
        setSwReady(true);
        console.log('[SYSTEM] ServiceWorker is ready');
      });
      
      // Also check if controller exists (already active)
      if (navigator.serviceWorker.controller) {
        setSwReady(true);
      }
    } else {
      // If SW not supported, assume "ready" for fallback purposes
      setSwReady(true);
    }
  }, []);

  const triggerFocusOnMap = () => {
    setFocusOnMapTrigger(prev => prev + 1);
  };

  const recordAction = (code: string) => {
    if (isRecording) {
      setRecordedCode(prev => prev + code + '\n');
    }
  };

  const saveToHistory = (newShapes: Shape[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push([...newShapes]);
    if (newHistory.length > 100) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const scheduleScopedTimberRecompute = useCallback((affectedIds: string[]) => {
    if (affectedIds.length === 0) return;

    affectedIds.forEach(id => staleWallOrRoofIdsRef.current.add(id));
    const currentAffected = Array.from(staleWallOrRoofIdsRef.current);

    setTimberFrameRecomputeState(prev => ({
      ...prev,
      status: 'pending',
      state: 'pending',
      affectedWallIds: currentAffected,
    }));

    if (timberRecomputeTimerRef.current) {
      clearTimeout(timberRecomputeTimerRef.current);
    }

    timberRecomputeTimerRef.current = setTimeout(() => {
      setTimberFrameRecomputeState(prev => ({
        ...prev,
        status: 'computing',
        state: 'computing',
      }));

      setShapes(prevShapes => {
        const idsToRecompute = Array.from(staleWallOrRoofIdsRef.current);
        staleWallOrRoofIdsRef.current.clear();

        const hasTimber = prevShapes.some(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber ') || s.id.startsWith('tf-'));
        if (!hasTimber) {
          setTimberFrameRecomputeState({
            status: 'idle',
            state: 'idle',
            affectedWallIds: [],
            lastComputedAt: Date.now(),
          });
          return prevShapes;
        }

        let updated = [...prevShapes];

        idsToRecompute.forEach(targetId => {
          const target = updated.find(s => s.id === targetId);
          // Remove old framing for this target
          updated = updated.filter(s => {
            const isTargetTimber =
              s.id.includes(`tf-wall-${targetId}`) ||
              s.id.includes(`tf-roof-${targetId}`) ||
              s.parentWallOrRoofId === targetId;
            return !isTargetTimber;
          });

          // Recompute if target still exists
          if (target) {
            const isWall = target.type === 'wall' || target.tags?.some(t => t.includes('wall')) || target.name?.toLowerCase().includes('wall');
            const isRoof = target.type === 'roof' || target.tags?.some(t => t.includes('roof')) || target.name?.toLowerCase().includes('roof');
            if (isWall) {
              const newMembers = generateTimberFrameForWall(target, updated, {
                params: timberFrameParams,
                offsetJoists: timberFrameParams.offsetFloorJoists ?? timberFrameParams.offsetJoists,
                offsetFloorJoists: timberFrameParams.offsetFloorJoists ?? timberFrameParams.offsetJoists,
                offsetWallJoists: timberFrameParams.offsetWallJoists,
                offsetFloorNoggins: timberFrameParams.offsetFloorNoggins,
                offsetWallNoggins: timberFrameParams.offsetWallNoggins,
                studSpacing: timberFrameParams.studSpacing,
              });
              target.timberFrame = {
                params: timberFrameParams,
                lastComputedAt: new Date().toISOString()
              };
              updated.push(...newMembers);
            } else if (isRoof) {
              const newMembers = generateTimberFrameForRoof(target, updated, {
                params: timberFrameParams,
                offsetJoists: timberFrameParams.offsetFloorJoists ?? timberFrameParams.offsetJoists,
                offsetFloorJoists: timberFrameParams.offsetFloorJoists ?? timberFrameParams.offsetJoists,
                offsetWallJoists: timberFrameParams.offsetWallJoists,
                offsetFloorNoggins: timberFrameParams.offsetFloorNoggins,
                offsetWallNoggins: timberFrameParams.offsetWallNoggins,
                studSpacing: timberFrameParams.studSpacing,
              });
              target.timberFrame = {
                params: timberFrameParams,
                lastComputedAt: new Date().toISOString()
              };
              updated.push(...newMembers);
            }
          }
        });

        setTimberFrameRecomputeState({
          status: 'idle',
          state: 'idle',
          affectedWallIds: [],
          lastComputedAt: Date.now(),
        });

        return updated;
      });
    }, 250);
  }, [timberFrameParams]);

  const commitUpdatedFraming = useCallback((candidateShapes?: Shape[]) => {
    setShapes(currentShapes => {
      const baseShapes = candidateShapes || currentShapes;
      const existingTimber = baseShapes.filter(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber ') || s.id.startsWith('tf-'));
      const existingIds = new Set(existingTimber.map(t => t.id));
      const remainingShapes = baseShapes.filter(s => !existingIds.has(s.id));

      const result = generateTimberFrameForBuilding(remainingShapes, {
        params: timberFrameParams,
        offsetJoists: timberFrameParams.offsetFloorJoists ?? timberFrameParams.offsetJoists,
        offsetFloorJoists: timberFrameParams.offsetFloorJoists ?? timberFrameParams.offsetJoists,
        offsetWallJoists: timberFrameParams.offsetWallJoists,
        offsetFloorNoggins: timberFrameParams.offsetFloorNoggins,
        offsetWallNoggins: timberFrameParams.offsetWallNoggins,
        studSpacing: timberFrameParams.studSpacing,
        joistSpacing: timberFrameParams.studSpacing,
        rafterSpacing: timberFrameParams.studSpacing * 1.5,
      });

      if (result.members.length === 0) {
        return baseShapes;
      }

      const nowIso = new Date().toISOString();
      const updatedArchShapes = remainingShapes.map(s => {
        const isWall = s.type === 'wall' || s.tags?.some(t => t.includes('wall')) || s.name?.toLowerCase().includes('wall');
        const isRoof = s.type === 'roof' || s.tags?.some(t => t.includes('roof')) || s.name?.toLowerCase().includes('roof');
        if (isWall || isRoof) {
          const wallAssemblies = result.openingAssemblies?.filter(oa => oa.hostWallId === s.id) || [];
          return {
            ...s,
            timberFrame: {
              params: timberFrameParams,
              openingAssemblies: wallAssemblies,
              lastComputedAt: nowIso
            }
          };
        }
        return s;
      });

      const nextShapes = [...updatedArchShapes, ...result.members];
      saveToHistory(nextShapes);
      return nextShapes;
    });
  }, [timberFrameParams, saveToHistory]);

  useEffect(() => {
    return () => {
      if (timberRecomputeTimerRef.current) {
        clearTimeout(timberRecomputeTimerRef.current);
      }
    };
  }, []);

  /**
   * The derived-state pipeline every shape mutation goes through: re-derives
   * stairwell cutouts against floor slabs, re-flattens terrain under floor
   * slabs, and schedules a timber-frame recompute for whatever walls/roofs/
   * openings changed between `prev` and the incoming shapes. Pulled out of
   * handleSetShapes so undo/redo can run the exact same reconciliation on
   * the historic snapshot they restore — they used to call setShapes(...)
   * directly, skipping all of this, which could leave terrain excavation,
   * floor-slab cutouts, or timber framing out of sync with the shapes an
   * undo/redo had just restored until the user made another edit.
   */
  const deriveShapesState = (rawShapes: Shape[], prev: Shape[]): Shape[] => {
      const withCutouts = applyStairwellHolesToSlabs(rawShapes);

      // Ensure terrain excavation with 1m safety apron is maintained for all floor slabs
      const terrainShape = withCutouts.find(s => s.type === 'terrain' && s.terrainData);
      let workingShapes = withCutouts;
      if (terrainShape && terrainShape.terrainData) {
        const hasFloorSlabs = withCutouts.some(s => s.id !== terrainShape.id && (
          s.tags?.includes('floor-slab') ||
          s.tags?.includes('foundation-skirt') ||
          s.name?.toLowerCase().includes('floor slab') ||
          s.name?.toLowerCase().includes('foundation') ||
          (s.type === 'poly' && s.tags?.includes('architecture'))
        ));
        if (hasFloorSlabs) {
          const updatedTerrain = flattenTerrainForFloorSlabs(terrainShape, withCutouts, 1.0);
          if (updatedTerrain) {
            workingShapes = withCutouts.map(s => s.id === terrainShape.id ? { ...s, terrainData: updatedTerrain } : s);
          }
        }
      }

      const hasTimber = workingShapes.some(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber ') || s.id.startsWith('tf-'));
      if (hasTimber) {
        const prevMap = new Map(prev.map(s => [s.id, s]));
        const nextMap = new Map(workingShapes.map(s => [s.id, s]));
        const affected = new Set<string>();

        const isWallOrRoof = (s: Shape) =>
          s.type === 'wall' || s.type === 'roof' ||
          s.tags?.some(t => t.includes('wall') || t.includes('roof')) ||
          s.name?.toLowerCase().includes('wall') || s.name?.toLowerCase().includes('roof');

        const isOpening = (s: Shape) =>
          s.type === 'door' || s.type === 'window' ||
          s.tags?.some(t => t.includes('door') || t.includes('window')) ||
          s.name?.toLowerCase().includes('door') || s.name?.toLowerCase().includes('window');

        for (const next of workingShapes) {
          const old = prevMap.get(next.id);
          if (!old) {
            if (isWallOrRoof(next)) affected.add(next.id);
            else if (isOpening(next) && next.hostWallId) affected.add(next.hostWallId);
          } else {
            const posChanged = old.position[0] !== next.position[0] || old.position[1] !== next.position[1] || old.position[2] !== next.position[2];
            const argsChanged = JSON.stringify(old.args) !== JSON.stringify(next.args);
            const hostChanged = old.hostWallId !== next.hostWallId;
            // A roof edit that changes eaveOverhang/pitchAngleDeg/roofType
            // without changing its compact [width, ridgeHeight, depth]
            // args tuple used to leave argsChanged false, so the roof
            // never made it into `affected` and its timber framing was
            // never recomputed against the new roof shape.
            const roofDataChanged = JSON.stringify(old.roofData || old.customData || null) !== JSON.stringify(next.roofData || next.customData || null);
            if (posChanged || argsChanged || hostChanged || roofDataChanged) {
              if (isWallOrRoof(next)) affected.add(next.id);
              else if (isOpening(next)) {
                if (next.hostWallId) affected.add(next.hostWallId);
                if (old.hostWallId) affected.add(old.hostWallId);
              }
            }
          }
        }

        for (const old of prev) {
          if (!nextMap.has(old.id)) {
            if (isWallOrRoof(old)) affected.add(old.id);
            else if (isOpening(old) && old.hostWallId) affected.add(old.hostWallId);
          }
        }

        if (affected.size > 0) {
          scheduleScopedTimberRecompute(Array.from(affected));
          return workingShapes;
        }
      }

      return updateTimberFramesIfPresent(workingShapes);
  };

  const handleSetShapes = (newShapesOrFn: Shape[] | ((prev: Shape[]) => Shape[])) => {
    setShapes(prev => {
      const rawShapes = typeof newShapesOrFn === 'function' ? newShapesOrFn(prev) : newShapesOrFn;
      const nextShapes = deriveShapesState(rawShapes, prev);
      saveToHistory(nextShapes);
      return nextShapes;
    });
  };

  // Force next push to re-evaluate if needed, but not immediately. Reads
  // currentModelIdRef (not the currentModelId closed over here) since these
  // callbacks intentionally keep an empty dependency array.
  const resetSyncHashForCurrentModel = () => {
    const modelId = currentModelIdRef.current;
    if (modelId) getSyncState(modelId).lastStateHash = '';
  };

  const setShapesSilent = useCallback((newShapesOrFn: Shape[] | ((prev: Shape[]) => Shape[])) => {
    resetSyncHashForCurrentModel();
    setShapes(newShapesOrFn);
  }, []);

  const setTagsSilent = useCallback((newTagsOrFn: Tag[] | ((prev: Tag[]) => Tag[])) => {
    resetSyncHashForCurrentModel();
    setTags(newTagsOrFn);
  }, []);

  const setScenesSilent = useCallback((newScenesOrFn: SceneState[] | ((prev: SceneState[]) => SceneState[])) => {
    resetSyncHashForCurrentModel();
    setScenes(newScenesOrFn);
  }, []);

  const setCustomMaterialsSilent = useCallback((newMaterialsOrFn: any[] | ((prev: any[]) => any[])) => {
    resetSyncHashForCurrentModel();
    setCustomMaterials(newMaterialsOrFn);
  }, []);

  const setAnimationsSilent = useCallback((newAnimationsOrFn: SceneAnimation[] | ((prev: SceneAnimation[]) => SceneAnimation[])) => {
    resetSyncHashForCurrentModel();
    setAnimations(newAnimationsOrFn);
  }, []);

  const setCustomLightsSilent = useCallback((newLightsOrFn: CustomLight[] | ((prev: CustomLight[]) => CustomLight[])) => {
    resetSyncHashForCurrentModel();
    setCustomLights(newLightsOrFn);
  }, []);

  const setNotesSilent = useCallback((newNotesOrFn: SceneNote[] | ((prev: SceneNote[]) => SceneNote[])) => {
    resetSyncHashForCurrentModel();
    setNotes(newNotesOrFn);
  }, []);

  const commitHistory = () => {
    saveToHistory(shapes);
  };

  const addTerrainModifier = useCallback((mod: TerrainModifier) => {
    setTerrainModifiers(prev => [...prev, mod]);
    setSelectedModifierId(mod.id);
  }, []);

  const updateTerrainModifier = useCallback((id: string, updates: Partial<TerrainModifier>) => {
    setTerrainModifiers(prev => prev.map(m => m.id === id ? ({ ...m, ...updates } as TerrainModifier) : m));
  }, []);

  const removeTerrainModifier = useCallback((id: string) => {
    setTerrainModifiers(prev => prev.filter(m => m.id !== id));
    setSelectedModifierId(prev => prev === id ? null : prev);
  }, []);

  const reorderTerrainModifiers = useCallback((sourceIndex: number, destIndex: number) => {
    setTerrainModifiers(prev => {
      if (sourceIndex < 0 || sourceIndex >= prev.length || destIndex < 0 || destIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(destIndex, 0, moved);
      return next;
    });
  }, []);

  const bakeTerrainModifiers = useCallback(async (mode: 'mesh' | 'glb' | 'obj') => {
    const activeModifiers = terrainModifiers.filter(m => m.enabled);
    if (mode === 'mesh') {
      const newBakedShape: Shape = {
        id: `baked-terrain-${Date.now()}`,
        name: `Baked Civil Terrain (${activeModifiers.length} Modifiers)`,
        type: 'box',
        position: [0, 0, 0],
        args: [30, 1.5, 30],
        color: '#64748b',
        roughness: 0.9,
        metalness: 0.05,
        opacity: 1.0,
      };
      setShapes(prev => [...prev, newBakedShape]);
      saveToHistory([...shapes, newBakedShape]);
      setConsoleOutput(prev => [...prev, `[Terrain Studio] Baked ${activeModifiers.length} civil modifiers into static mesh.`]);
      setViewportToast(`Terrain baked: ${activeModifiers.length} modifiers flattened into scene mesh.`);
    } else {
      setConsoleOutput(prev => [...prev, `[Terrain Studio] Exported ${activeModifiers.length} modifiers as ${mode.toUpperCase()}.`]);
      setViewportToast(`Civil terrain exported as ${mode.toUpperCase()}.`);
    }
  }, [terrainModifiers, shapes]);

  const undo = () => {
    if (historyIndex > 0) {
      const targetShapes = history[historyIndex - 1];
      // Runs the restored snapshot through the same reconciliation
      // handleSetShapes uses (stairwell cutouts, terrain flattening under
      // floor slabs, timber-frame recompute) instead of setShapes(target)
      // directly — undoing/redoing past an architecture edit used to leave
      // those derived states stale until the next unrelated edit forced a
      // recompute. Does not call saveToHistory: undo/redo navigate the
      // existing history stack, they don't extend it.
      setShapes(prev => deriveShapesState(targetShapes, prev));
      setHistoryIndex(historyIndex - 1);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const targetShapes = history[historyIndex + 1];
      setShapes(prev => deriveShapesState(targetShapes, prev));
      setHistoryIndex(historyIndex + 1);
    }
  };

  const addShape = (shape: Shape) => {
    handleSetShapes(prev => {
      let nextShapes = [...prev, shape];

      const isFloorSlabOrFoundation = (
        shape.tags?.includes('floor-slab') ||
        shape.tags?.includes('foundation-skirt') ||
        shape.name?.toLowerCase().includes('floor slab') ||
        shape.name?.toLowerCase().includes('foundation') ||
        (shape.type === 'poly' && shape.tags?.includes('architecture'))
      );

      if (shape.type === 'terrain' && shape.terrainData) {
        // Terrain added: flatten against any existing floor slabs
        const updatedTerrainData = flattenTerrainForFloorSlabs(shape, prev, 1.0);
        if (updatedTerrainData) {
          nextShapes = nextShapes.map(s => s.id === shape.id ? { ...s, terrainData: updatedTerrainData } : s);
        }
      } else if (isFloorSlabOrFoundation) {
        // Floor slab added: flatten any existing terrain
        const terrainShape = prev.find(s => s.type === 'terrain');
        if (terrainShape && terrainShape.terrainData) {
          const updatedTerrainData = flattenTerrainForFloorSlabs(terrainShape, nextShapes, 1.0);
          if (updatedTerrainData) {
            nextShapes = nextShapes.map(s => s.id === terrainShape.id ? { ...s, terrainData: updatedTerrainData } : s);
          }
        }
      }

      return nextShapes;
    });
    
    // Record action
    let sdkCall = '';
    const pos = `[${shape.position.map(p => p.toFixed(2)).join(', ')}]`;
    
    switch(shape.type) {
      case 'rect': sdkCall = `sdk.createRectangle({ width: ${shape.args[0]}, height: ${shape.args[2]}, position: ${pos} });`; break;
      case 'box': sdkCall = `sdk.createBox({ width: ${shape.args[0]}, height: ${shape.args[1]}, depth: ${shape.args[2]}, position: ${pos} });`; break;
      case 'sphere': sdkCall = `sdk.createSphere({ radius: ${shape.args[0]}, position: ${pos} });`; break;
      case 'cone': sdkCall = `sdk.createCone({ radius: ${shape.args[0]}, height: ${shape.args[1]}, position: ${pos} });`; break;
      case 'pyramid': sdkCall = `sdk.createPyramid({ radius: ${shape.args[0]}, height: ${shape.args[1]}, position: ${pos} });`; break;
      case 'donut': sdkCall = `sdk.createDonut({ radius: ${shape.args[0]}, tube: ${shape.args[1]}, position: ${pos} });`; break;
      case 'dome': sdkCall = `sdk.createDome({ radius: ${shape.args[0]}, position: ${pos} });`; break;
      case 'poly': {
        const worldVertices = (shape.args.vertices || []).map((v: number[]) => {
          const local = new THREE.Vector3(v[0], v[1], 0);
          const quat = new THREE.Quaternion(...(shape.quaternion || [0,0,0,1]));
          return local.applyQuaternion(quat).add(new THREE.Vector3(...shape.position)).toArray();
        });
        sdkCall = `sdk.createPoly({ vertices: ${JSON.stringify(worldVertices)}, position: ${pos} });`; 
        break;
      }
    }
    
    if (sdkCall) recordAction(sdkCall);
  };

  const removeShape = (id: string) => {
    handleSetShapes(prev => prev.filter(s => s.id !== id));
    setSelectedIds(prev => prev.filter(sid => sid !== id));
    if (selectedId === id) setSelectedId(null);
    recordAction(`sdk.deleteObject("${id}");`);
  };

  /**
   * The single, shared duplicate implementation — previously
   * Viewport.tsx's own right-click "Duplicate Object" and the
   * Outliner's own duplicate buttons each had their own separate copy
   * of this logic, and had drifted apart: different position offset
   * (0.3 vs 1), different name format, whether the new copy became
   * selected, and whether the action got logged via recordAction.
   * Moved here and exposed through context so every caller shares
   * this exact behavior going forward, rather than two definitions
   * that can silently diverge again.
   */
  const duplicateObject = (id: string) => {
    const shape = shapes.find(s => s.id === id);
    if (!shape) return;

    const newShape = {
      ...shape,
      id: crypto.randomUUID(),
      position: [shape.position[0] + 1, shape.position[1], shape.position[2] + 1] as [number, number, number],
      name: `${shape.name || shape.type} (Copy)`
    };

    handleSetShapes(prev => [...prev, newShape]);
    setSelectedId(newShape.id);
    recordAction(`sdk.duplicateObject("${id}");`);
  };

  const duplicateMultiple = (ids: string[]) => {
    const newShapes: Shape[] = [];
    ids.forEach(id => {
      const shape = shapes.find(s => s.id === id);
      if (shape) {
        newShapes.push({
          ...shape,
          id: crypto.randomUUID(),
          position: [shape.position[0] + 1, shape.position[1], shape.position[2] + 1] as [number, number, number],
          name: `${shape.name || shape.type} (Copy)`
        });
      }
    });
    if (newShapes.length > 0) {
      handleSetShapes(prev => [...prev, ...newShapes]);
      setSelectedIds(newShapes.map(s => s.id));
      recordAction(`sdk.duplicateObjects(${JSON.stringify(ids)});`);
    }
  };

  const handleSetSkybox = (type: SkyboxType) => {
    setSkybox(type);
    setEnvironment(previous => previous.ref ? previous : {
      ...previous,
      legacySkybox: type,
      background: type !== 'none',
    });
    recordAction(`sdk.setSkybox("${type}", ${skyboxBlur}, ${skyboxRotation}, ${environmentIntensity});`);
  };

  const handleSetFogSettings = (settings: FogSettings | ((prev: FogSettings) => FogSettings)) => {
    setFogSettings(prev => {
      const next = typeof settings === 'function' ? settings(prev) : settings;
      recordAction(`sdk.setFog(${JSON.stringify(next)});`);
      return next;
    });
  };

  const handleSetCustomLights = (lights: CustomLight[] | ((prev: CustomLight[]) => CustomLight[])) => {
    setCustomLights(prev => {
      const next = typeof lights === 'function' ? lights(prev) : lights;
      if (next.length > prev.length) {
        const newLight = next[next.length - 1];
        recordAction(`sdk.addLight(${JSON.stringify(newLight)});`);
      }
      return next;
    });
  };

  const handleSetActiveBevelType = (type: 'radius' | 'chamfer') => {
    setActiveBevelType(type);
    recordAction(`sdk.setBevelType("${type}");`);
  };

  const handleSetScenes = (newScenes: SceneState[] | ((prev: SceneState[]) => SceneState[])) => {
    setScenes(prev => {
      const next = typeof newScenes === 'function' ? newScenes(prev) : newScenes;
      if (next.length > prev.length) {
        const newScene = next[next.length - 1];
        recordAction(`sdk.saveScene("${newScene.name}");`);
      }
      return next;
    });
  };

  const handleSetAnimations = (newAnimations: SceneAnimation[] | ((prev: SceneAnimation[]) => SceneAnimation[])) => {
    setAnimations(prev => {
      const next = typeof newAnimations === 'function' ? newAnimations(prev) : newAnimations;
      return next;
    });
  };

  const updateShapeColor = (id: string, color: string, pbr?: { roughness: number, metalness: number, opacity: number }) => {
    handleSetShapes(prev => prev.map(s => {
      if (s.id === id) {
        const updated: Shape = {
          ...s,
          color,
          materialBindingId: activeMaterialBindingId ?? undefined,
          surfaceMaterials: undefined,
          surfaceMaterialBindings: undefined,
          roughness: pbr?.roughness ?? s.roughness,
          metalness: pbr?.metalness ?? s.metalness,
          opacity: pbr?.opacity ?? s.opacity
        };
        if (s.type === 'terrain' && s.terrainData) {
          updated.terrainData = {
            ...s.terrainData,
            textureUrl: isTextureUrl(color) ? color : undefined,
            shadingMode: 'default'
          };
        }
        return updated;
      }
      return s;
    }));
    recordAction(`const obj = sdk.getObjectByName("${id}");\nif (obj) sdk.applyColor(obj, "${color}");`);
  };

  const handleSetActiveMaterial = (value: string) => {
    setActiveMaterialState(value);
    setActiveMaterialBindingId(null);
  };

  const updateShapeDimensions = (id: string, position: [number, number, number], args: any) => {
    handleSetShapes(prev => prev.map(s => s.id === id ? { ...s, position, args } : s));
    recordAction(`const obj = sdk.getObjectByName("${id}");\nif (obj) {\n  obj.position = [${position.map(p => p.toFixed(2)).join(', ')}];\n  obj.args = [${args.map((a: any) => typeof a === 'number' ? a.toFixed(2) : a).join(', ')}];\n}`);
  };

  const clearShapes = () => {
    setShapes([]);
    replaceKernelGraph(null);
    setTerrainModifiers([]);
    setSelectedModifierId(null);
    setActiveSplineDraft([]);
    setActivePadDraft(null);
    setSelectedFaceIds([]);
    setCurrentModelId(null);
    setCurrentModelName(null);
    setSyncStatus('unsaved');
    setSelectedId(null);
    setSelectedIds([]);
    setSelectedSurface(null);
    setTags([]);
    setActiveTagId(null);
    setScenes([]);
    setCustomMaterials([]);
    setMaterialBindings({});
    setActiveMaterialBindingId(null);
    setEnvironment(legacyEnvironmentState('none', 1, 0, 0));
    setGraphicsSettings(defaultGraphicsSettings());
    setNotes([]);
    setCustomLights([]);
    setAnimations([]);
    setHistory([]);
    setHistoryIndex(-1);
    setSkybox('none');
    setMeasurements('');
    setIsWorldViewActive(false);
    setGridEnabled(true);
    setAxisIndicatorEnabled(true);
    setMiniAxisIndicatorEnabled(true);
    setSunIntensity(1.0);
    setLightPosition([5, 5, 5]);
    setActiveTool('select');
    setCutFillMetrics({
      cutVolumeM3: 0,
      fillVolumeM3: 0,
      netVolumeM3: 0,
      cutAreaM2: 0,
      fillAreaM2: 0
    });
    setActiveCivilGrade(null);
    setIsBakeModalOpen(false);
    
    // Broadcast camera reset and 3D space clear
    window.dispatchEvent(new CustomEvent('reset-camera'));
    window.dispatchEvent(new CustomEvent('clear-3d-space'));
    
    recordAction(`sdk.clear();`);
  };

  const handleSetShadowsEnabled = (enabled: boolean) => {
    setShadowsEnabled(enabled);
    recordAction(`sdk.setShadows(${enabled});`);
  };

  const handleSetGridEnabled = (enabled: boolean) => {
    setGridEnabled(enabled);
    recordAction(`sdk.setGrid(${enabled});`);
  };

  const handleSetAxisIndicatorEnabled = (enabled: boolean) => {
    setAxisIndicatorEnabled(enabled);
    recordAction(`sdk.setAxisIndicator(${enabled});`);
  };

  const handleSetMiniAxisIndicatorEnabled = (enabled: boolean) => {
    setMiniAxisIndicatorEnabled(enabled);
    recordAction(`sdk.setMiniAxisIndicator(${enabled});`);
  };

  const handleSetFloorEnabled = (enabled: boolean) => {
    setFloorEnabled(enabled);
    recordAction(`sdk.setFloor(${enabled});`);
  };

  const handleSetAmbientOcclusionEnabled = (enabled: boolean) => {
    setAmbientOcclusionEnabled(enabled);
    recordAction(`sdk.setAmbientOcclusion(${enabled});`);
  };

  const handleSetSunIntensity = (intensity: number) => {
    setSunIntensity(intensity);
    recordAction(`sdk.setSunSettings({ intensity: ${intensity} });`);
  };

  const handleSetSkyboxBlur = (blur: number) => {
    setSkyboxBlur(blur);
    setEnvironment(previous => ({ ...previous, blur }));
    recordAction(`sdk.setSkybox("${skybox}", { blur: ${blur} });`);
  };

  const handleSetEnvironmentIntensity = (intensity: number) => {
    setEnvironmentIntensity(intensity);
    setEnvironment(previous => ({ ...previous, intensity, backgroundIntensity: intensity }));
    recordAction(`sdk.setSkybox("${skybox}", { intensity: ${intensity} });`);
  };

  const handleSetSkyboxRotation = (rotation: number) => {
    setSkyboxRotation(rotation);
    setEnvironment(previous => ({ ...previous, rotationRadians: rotation * Math.PI / 180 }));
    recordAction(`sdk.setSkybox("${skybox}", { rotation: ${rotation} });`);
  };

  const handleSetAnimateSun = (animate: boolean) => {
    setAnimateSun(animate);
    recordAction(`sdk.setSunSettings({ animate: ${animate} });`);
  };

  const handleSetSunSpeed = (speed: number) => {
    setSunSpeed(speed);
    recordAction(`sdk.setSunSettings({ speed: ${speed} });`);
  };

  const handleSetLightPosition = (pos: [number, number, number]) => {
    setLightPosition(pos);
    recordAction(`sdk.setSunSettings({ position: [${pos[0]}, ${pos[1]}, ${pos[2]}] });`);
  };

  return (
    <AppContext.Provider value={{ 
      activeTool, 
      setActiveTool, 
      measurements, 
      setMeasurements,
      viewportToast,
      setViewportToast,
      placingNotePos,
      setPlacingNotePos,
      activeMaterial,
      setActiveMaterial: handleSetActiveMaterial,
      activeMaterialBindingId,
      setActiveMaterialBindingId,
      materialBindings,
      setMaterialBindings,
      environment,
      setEnvironment,
      activePBR,
      setActivePBR,
      selectedId,
      setSelectedId,
      selectedIds,
      setSelectedIds,
      selectedSurface,
      setSelectedSurface,
      selectedLightId,
      setSelectedLightId,
      placingLightId,
      setPlacingLightId,
      shapes,
      setShapes: handleSetShapes,
      duplicateObject,
      duplicateMultiple,
      setShapesSilent,
      setTagsSilent,
      setScenesSilent,
      setCustomMaterialsSilent,
      setAnimationsSilent,
      setCustomLightsSilent,
      setNotesSilent,
      commitHistory,
      addShape,
      removeShape,
      updateShapeColor,
      updateShapeDimensions,
      isAIRendererOpen,
      activeBlockPart,
      setActiveBlockPart,
      blockPlacementDraft,
      setBlockPlacementDraft,
      blockPreventOverlap,
      setBlockPreventOverlap,
      setIsAIRendererOpen,
      isAIQueryOpen,
      setIsAIQueryOpen,
      user,
      setUser,
      theme,
      setTheme,
    openMaterialsSignal,
    setOpenMaterialsSignal,
      bannerColor,
      setBannerColor,
      customMaterials,
      graphicsSettings,
      setGraphicsSettings,
      setCustomMaterials,
      clearShapes,
      currentModelId,
      setCurrentModelId,
      currentModelName,
      setCurrentModelName,
      tags,
      setTags,
      activeTagId,
      setActiveTagId,
      allTagsVisible,
      setAllTagsVisible,
      shadowsEnabled,
      setShadowsEnabled: handleSetShadowsEnabled,
      showLightsource,
      setShowLightsource,
      showAllDimensions,
      setShowAllDimensions,
      edgeLinesEnabled,
      setEdgeLinesEnabled,
      edgeLinesColor,
      setEdgeLinesColor,
      edgeLinesOpacity,
      setEdgeLinesOpacity,
      edgeLinesThickness,
      setEdgeLinesThickness,
      lightPosition,
      setLightPosition: handleSetLightPosition,
      sunOrbitCenter,
      setSunOrbitCenter,
      pickingSunCenter,
      setPickingSunCenter,
      animateSun,
      setAnimateSun: handleSetAnimateSun,
      sunSpeed,
      setSunSpeed: handleSetSunSpeed,
      sunIntensity,
      setSunIntensity: handleSetSunIntensity,
      shadowOpacity,
      setShadowOpacity,
      ambientOcclusionEnabled,
      setAmbientOcclusionEnabled: handleSetAmbientOcclusionEnabled,
      activeBevelType,
      setActiveBevelType: handleSetActiveBevelType,
      skybox,
      setSkybox: handleSetSkybox,
      customLights,
      setCustomLights: handleSetCustomLights,
      fogSettings,
      setFogSettings: handleSetFogSettings,
      gridEnabled,
      setGridEnabled: handleSetGridEnabled,
      axisIndicatorEnabled,
      setAxisIndicatorEnabled: handleSetAxisIndicatorEnabled,
      miniAxisIndicatorEnabled,
      setMiniAxisIndicatorEnabled: handleSetMiniAxisIndicatorEnabled,
      floorEnabled,
      setFloorEnabled: handleSetFloorEnabled,
      walkModePhase,
      setWalkModePhase,
      walkMovementSpeed,
      setWalkMovementSpeed,
      walkMouseSensitivity,
      setWalkMouseSensitivity,
      walkBridgeRef,
      floorColor,
      setFloorColor,
      skyboxBlur,
      setSkyboxBlur: handleSetSkyboxBlur,
      environmentIntensity,
      setEnvironmentIntensity: handleSetEnvironmentIntensity,
      skyboxRotation,
      setSkyboxRotation: handleSetSkyboxRotation,
      rightPanelVisible,
      setRightPanelVisible,
      toolbarVisibility,
      setToolbarVisibility,
      panelVisibility,
      setPanelVisibility,
      contextMenu,
      setContextMenu,
      undo,
      redo,
      recordAction,
      scenes,
      setScenes: handleSetScenes,
      isDeveloperConsoleOpen,
      setIsDeveloperConsoleOpen,
      activeDeveloperTab,
      setActiveDeveloperTab,
      developerScripts,
      setDeveloperScripts,
      consoleOutput,
      setConsoleOutput,
      developerCode,
      setDeveloperCode,
      developerSuiteWidth,
      setDeveloperSuiteWidth,
      isDeveloperSuiteCollapsed,
      setIsDeveloperSuiteCollapsed,
      pinnedScripts,
      setPinnedScripts,
      customToolbars,
      setCustomToolbars,
      basicToolbarExtensions,
      setBasicToolbarExtensions,
      refreshScripts: () => fetchScripts(true),
      refreshMaterials: () => fetchMaterials(true),
      codeRecorderEnabled,
      setCodeRecorderEnabled,
      isRecording,
      setIsRecording,
      recordedCode,
      setRecordedCode,
      isChangelogOpen,
      setIsChangelogOpen,
      // Units
      unit,
      setUnit,
      showCollaboratorCursors,
      setShowCollaboratorCursors,
      // Messaging
      isMessagingOpen,
      setIsMessagingOpen,
      isMessagingCollapsed,
      setIsMessagingCollapsed,
      isMessagingDocked,
      setIsMessagingDocked,
      isToolModifierDocked,
      setIsToolModifierDocked,
      // Tool settings
      activeBevelAmount,
      setActiveBevelAmount,
      // WorldView
      isWorldViewOpen,
      setIsWorldViewOpen,
      worldViewLocation,
      setWorldViewLocation,
      worldViewAltitude,
      setWorldViewAltitude,
      worldViewRadius,
      setWorldViewRadius,
      worldViewMapType,
      setWorldViewMapType,
      googleMapsApiKey,
      setGoogleMapsApiKey,
      isWorldViewActive,
      setIsWorldViewActive,
      focusOnMapTrigger,
      triggerFocusOnMap,
      // Service Worker
      swReady,
      setSwReady,
      animations,
      setAnimations: handleSetAnimations,
      placingAnimationId,
      setPlacingAnimationId,
      // Notes
      notes,
      setNotes,
      placingNoteId,
      setPlacingNoteId,
      allNotesVisible,
      setAllNotesVisible,
      // Collaboration
      isCollaborationOpen,
      setIsCollaborationOpen,
      collaborators,
      setCollaborators,
      chatMessages,
      setChatMessages,
      // Rectangle Input
      rectangleInputState,
      setRectangleInputState,
      // Deformation
      deformationSettings,
      setDeformationSettings,
      // Subtract
      subtractCutterId,
      setSubtractCutterId,
      subtractTargetId,
      setSubtractTargetId,
      kernelSubtractTarget,
      setKernelSubtractTarget,
      // Camera
      defaultCameraPosition,
      setDefaultCameraPosition,
      defaultCameraTarget,
      setDefaultCameraTarget,
      zoom,
      setZoom,
      syncStatus,
      syncErrorMessage,
      retrySync,
      isDiagnosticLogOpen,
      setIsDiagnosticLogOpen,
      // Architecture, Landscapes & Camera Toolbars
      isBasicToolbarEnabled,
      setIsBasicToolbarEnabled,
      isArchitectureToolbarEnabled,
      setIsArchitectureToolbarEnabled,
      isLandscapesToolbarEnabled,
      setIsLandscapesToolbarEnabled,
      isCameraToolbarEnabled,
      setIsCameraToolbarEnabled,
      layoutMode,
      setLayoutMode,
      toolbarOrder,
      setToolbarOrder,
      toolbarDocks,
      setToolbarDocks,
      landscapeSculptSettings,
      setLandscapeSculptSettings,
      landscapeRoadSettings,
      setLandscapeRoadSettings,
      // Plant Library Selection
      activePlantSpecies,
      setActivePlantSpecies,
      activePlantVariation,
      setActivePlantVariation,
      activePlantScale,
      setActivePlantScale,
      // Scale Figure Selection
      activeScaleFigureCharacter,
      setActiveScaleFigureCharacter,
      activeScaleFigureHeight,
      setActiveScaleFigureHeight,
      contactFrictionEnabled,
      setContactFrictionEnabled,
      contactFrictionStrength,
      setContactFrictionStrength,
      isAIGenerateOpen,
      setIsAIGenerateOpen,
      autoOrbitEnabled,
      setAutoOrbitEnabled,
      orbitRotationSpeed,
      setOrbitRotationSpeed,
      lastInteractionData,
      setLastInteractionData,
      embeddedWebpageUrl,
      setEmbeddedWebpageUrl,
      diagnosticLogs,
      diagLog,
      clearDiagnosticLogs,
      quotaLockdownTime,
      isQuotaLocked: checkQuota,
      totalReads,
      incrementReads,
      kernelHost,
      kernelRevision,
      bumpKernel,
      selectedFaceIds,
      setSelectedFaceIds,
      selectionShapeMode,
      setSelectionShapeMode,
      selectionFilter,
      setSelectionFilter,
      selectionCriteria,
      setSelectionCriteria,
      wallToolSettings,
      setWallToolSettings,
      wallJustification,
      setWallJustification,
      activeStory,
      setActiveStory,
      roofModalTargetIds,
      setRoofModalTargetIds,
      storyPromptTargetIds,
      setStoryPromptTargetIds,
      // Timber Frame
      timberFrameParams,
      setTimberFrameParams,
      timberFrameRecomputeState,
      setTimberFrameRecomputeState,
      scheduleScopedTimberRecompute,
      commitUpdatedFraming,
      // Camera Depth Clipping
      cameraDepthClippingEnabled,
      setCameraDepthClippingEnabled,
      cameraNear,
      setCameraNear,
      cameraFar,
      setCameraFar,
      // Wall & Roof Transparency
      wallTransparency,
      setWallTransparency,
      exteriorWallTransparency,
      setExteriorWallTransparency,
      interiorWallTransparency,
      setInteriorWallTransparency,
      roofTransparency,
      setRoofTransparency,
      floorTransparency,
      setFloorTransparency,
      fixturesTransparency,
      setFixturesTransparency,
      // Civil Toolset & Terrain Studio
      terrainModifiers,
      setTerrainModifiers,
      selectedModifierId,
      setSelectedModifierId,
      isBakeModalOpen,
      setIsBakeModalOpen,
      civilRoadSettings,
      setCivilRoadSettings,
      civilPadSettings,
      setCivilPadSettings,
      civilStripingSettings,
      setCivilStripingSettings,
      activeCivilGrade,
      setActiveCivilGrade,
      cutFillMetrics,
      setCutFillMetrics,
      showCutFillOverlay,
      setShowCutFillOverlay,
      activeSplineDraft,
      setActiveSplineDraft,
      activePadDraft,
      setActivePadDraft,
      addTerrainModifier,
      updateTerrainModifier,
      removeTerrainModifier,
      reorderTerrainModifiers,
      bakeTerrainModifiers
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
