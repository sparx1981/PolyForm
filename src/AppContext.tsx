import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ToolType, AppState, Shape, Tag, SceneState, SkyboxType, FogSettings, SceneAnimation, SceneNote, Collaborator, ChatMessage, DiagLogEntry, CustomLight } from './types';
import { db, auth, handleFirestoreError, OperationType, isQuotaLocked } from './firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, query, where, getDocs, or, setDoc, getDoc, orderBy, limit, serverTimestamp } from 'firebase/firestore';

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

// Helper to strip undefined values for Firestore
const cleanData = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(cleanData);
  if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj).reduce((acc: any, [key, value]) => {
      if (value !== undefined) acc[key] = cleanData(value);
      return acc;
    }, {});
  }
  return obj;
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [measurements, setMeasurements] = useState('');
  const [activeMaterial, setActiveMaterial] = useState('#ffffff');
  const [activePBR, setActivePBR] = useState({ roughness: 0.5, metalness: 0, opacity: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedSurface, setSelectedSurface] = useState<{ shapeId: string, faceIndex: number, subFaceIndex?: number } | null>(null);
  const [selectedLightId, setSelectedLightId] = useState<string | null>(null);
  const [placingLightId, setPlacingLightId] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Shape[]>(INITIAL_SHAPES);
  const [isAIRendererOpen, setIsAIRendererOpen] = useState(false);
  const [isAIQueryOpen, setIsAIQueryOpen] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [bannerColor, setBannerColor] = useState('#0063A3');
  const [customMaterials, setCustomMaterials] = useState<any[]>([]);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);
  const [currentModelName, setCurrentModelName] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [allTagsVisible, setAllTagsVisible] = useState(true);
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [shadowsEnabled, setShadowsEnabled] = useState(false);
  const [showLightsource, setShowLightsource] = useState(false);
  const [showAllDimensions, setShowAllDimensions] = useState(false);
  const [lightPosition, setLightPosition] = useState<[number, number, number]>([5, 5, 5]);
  const [animateSun, setAnimateSun] = useState(false);
  const [sunSpeed, setSunSpeed] = useState(1.0);
  const [sunIntensity, setSunIntensity] = useState(1.0);
  const [shadowOpacity, setShadowOpacity] = useState(0.25);
  const [ambientOcclusionEnabled, setAmbientOcclusionEnabled] = useState(false);
  const [activeBevelType, setActiveBevelType] = useState<'radius' | 'chamfer'>('radius');
  const [skybox, setSkybox] = useState<SkyboxType>('none');
  const [customLights, setCustomLights] = useState<CustomLight[]>([]);
  const [fogSettings, setFogSettings] = useState<FogSettings>(DEFAULT_FOG);
  const [gridEnabled, setGridEnabled] = useState(true);
  const [floorEnabled, setFloorEnabled] = useState(false);
  const [floorColor, setFloorColor] = useState('#f9fafb');
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
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'surface' | 'multi' | 'light', data?: any } | null>(null);
  const [history, setHistory] = useState<Shape[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'offline' | 'unsaved'>('unsaved');
  const [quotaLockdownTime, setQuotaLockdownTime] = useState<number>(0);
  const [totalReads, setTotalReads] = useState(0);
  
  const checkQuota = () => Date.now() < quotaLockdownTime;
  const incrementReads = (count: number) => setTotalReads(prev => prev + count);

  const [isDiagnosticLogOpen, setIsDiagnosticLogOpen] = useState(false);
  const [lastInteractionData, setLastInteractionData] = useState<any>(null);
  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagLogEntry[]>([]);
  const [embeddedWebpageUrl, setEmbeddedWebpageUrl] = useState<string | null>(null);
  
  const [isMessagingOpen, setIsMessagingOpen] = useState(false);
  const [isMessagingCollapsed, setIsMessagingCollapsed] = useState(false);
  const [isMessagingDocked, setIsMessagingDocked] = useState(false);
  const [activeBevelAmount, setActiveBevelAmount] = useState(1);
  // Default true: this restores SketchUp-style movement friction (dragging pauses
  // briefly the instant two objects' surfaces touch, then lets you continue past it).
  // It's fully wired (Viewport.tsx's handleTransformObjectChange + checkCollision, and
  // the "Contact Friction" toggle in ToolModifierPalette/RightPanelStack), but was
  // defaulting to off with no obvious way to discover the toggle, which made the
  // feature look removed.
  const [contactFrictionEnabled, setContactFrictionEnabled] = useState(true);
  const [isToolModifierDocked, setIsToolModifierDocked] = useState(true);
  const [isAIGenerateOpen, setIsAIGenerateOpen] = useState(false);
  const [autoOrbitEnabled, setAutoOrbitEnabled] = useState(false);
  const [orbitRotationSpeed, setOrbitRotationSpeed] = useState(1.0);
  
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
  const pushInProgress = useRef(false);
  const needsSync = useRef(false);
  const lastStateHash = useRef('');

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
        )
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
        where('userId', '==', user.uid)
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
  const [defaultCameraPosition, setDefaultCameraPosition] = useState<[number, number, number]>([80, 80, 80]);
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
            floorEnabled,
            allNotesVisible,
            defaultCameraPosition,
            defaultCameraTarget,
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
  }, [theme, unit, gridEnabled, floorEnabled, allNotesVisible, defaultCameraPosition, defaultCameraTarget, user?.uid]);

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
          if (data.floorEnabled !== undefined) setFloorEnabled(data.floorEnabled);
          if (data.allNotesVisible !== undefined) setAllNotesVisible(data.allNotesVisible);
          if (data.defaultCameraPosition) setDefaultCameraPosition(data.defaultCameraPosition);
          if (data.defaultCameraTarget) setDefaultCameraTarget(data.defaultCameraTarget);
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
      setCollaborators([]);
      setChatMessages([]);
      return;
    }

    // 1. Sync Collaborators
    const collabQuery = query(collection(db, 'collaborations'), where('modelId', '==', currentModelId));
    const unsubCollabs = onSnapshot(collabQuery, (snapshot) => {
      incrementReads(snapshot.size || 1);
      setCollaborators(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)) as Collaborator[]);
    }, (error) => {
       handleFirestoreError(error, OperationType.GET, 'collaborations');
       setQuotaLockdownTime(Date.now() + 600000);
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
    const unsubModel = onSnapshot(modelRef, { includeMetadataChanges: true }, (snapshot) => {
      incrementReads(1);
      // If the change is from this client, skip re-applying to prevent flicker/jitter
      if (snapshot.metadata.hasPendingWrites) {
        setSyncStatus('syncing');
        return;
      }

      if (snapshot.exists()) {
        const data = snapshot.data();
        isRemoteUpdate.current = true;
        
        // Update local hash to prevent redundant pushes
        const newState = {
          shapes: data.shapes || [],
          tags: data.tags || [],
          scenes: data.scenes || [],
          customMaterials: data.customMaterials || [],
          animations: data.animations || []
        };
        lastStateHash.current = JSON.stringify(newState);

        if (data.shapes) setShapes(data.shapes);
        if (data.tags) setTags(data.tags);
        if (data.scenes) setScenes(data.scenes);
        if (data.customMaterials) setCustomMaterials(data.customMaterials);
        if (data.animations) setAnimations(data.animations);
        if (data.notes) setNotes(data.notes);
        if (data.customLights) setCustomLights(data.customLights);
        if (data.name) setCurrentModelName(data.name);
        
        setSyncStatus('synced');
      }
    }, (error) => {
      console.error('[Model Sync] Error:', error);
      setSyncStatus('error');
      handleFirestoreError(error, OperationType.GET, `models/${currentModelId}`);
      setQuotaLockdownTime(Date.now() + 600000);
    });

    // Ensure we have a collaboration document for presence
    const ensurePresence = async () => {
      if (!user?.email || currentModelId.startsWith('new') || checkQuota()) return;
      
      const collabId = `${currentModelId}_${user.email.toLowerCase()}`;
      const collabRef = doc(db, 'collaborations', collabId);
      
      try {
        const path = `collaborations/${collabId}`;
        const snap = await getDoc(collabRef);
        if (!snap.exists()) {
          // If we are the owner, create our own presence doc
          const modelSnap = await getDoc(doc(db, 'models', currentModelId));
          if (modelSnap.exists() && modelSnap.data().userId === user.uid) {
            await setDoc(collabRef, {
              modelId: currentModelId,
              email: user.email.toLowerCase(),
              uid: user.uid,
              displayName: user.displayName || user.email.split('@')[0],
              role: 'owner',
              status: 'active',
              lastSeen: Date.now(),
              createdAt: serverTimestamp()
            });
            console.log('[Collab] Created owner presence document');
          }
        } else {
          // Invited or returning, update status
          await updateDoc(collabRef, {
            uid: user.uid,
            status: 'active',
            lastSeen: Date.now()
          });
          console.log('[Collab] Joined as active');
        }
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

    // Check if state actually changed
    const currentState = { shapes, tags, scenes, customMaterials, animations, notes, customLights };
    const currentStateHash = JSON.stringify(currentState);
    
    if (currentStateHash === lastStateHash.current) {
      return;
    }

    const sync = async () => {
      if (pushInProgress.current) {
        needsSync.current = true;
        return;
      }
      
      pushInProgress.current = true;
      setSyncStatus('syncing');
      
      try {
        const stateToPush = cleanData({ 
          shapes, 
          tags, 
          scenes, 
          customMaterials, 
          animations,
          notes,
          customLights,
          updatedAt: serverTimestamp() 
        });
        
        await updateDoc(doc(db, 'models', currentModelId), stateToPush);
        lastStateHash.current = currentStateHash;
        setSyncStatus('synced');
      } catch (error: any) {
        console.error('[Sync] Error pushing to Firestore:', error);
        setSyncStatus('error');
        handleFirestoreError(error, OperationType.UPDATE, `models/${currentModelId}`);
      } finally {
        pushInProgress.current = false;
        if (needsSync.current) {
          needsSync.current = false;
          sync(); // Clear the backlog
        }
      }
    };

    const timeoutId = setTimeout(sync, 5000); // 5 second debounce for model synchronization
    return () => clearTimeout(timeoutId);
  }, [shapes, tags, scenes, customMaterials, animations, notes, customLights, currentModelId, user?.uid]);

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

  const handleSetShapes = (newShapesOrFn: Shape[] | ((prev: Shape[]) => Shape[])) => {
    setShapes(prev => {
      const nextShapes = typeof newShapesOrFn === 'function' ? newShapesOrFn(prev) : newShapesOrFn;
      saveToHistory(nextShapes);
      return nextShapes;
    });
  };

  const setShapesSilent = (newShapesOrFn: Shape[] | ((prev: Shape[]) => Shape[])) => {
    lastStateHash.current = ''; // Force next push to re-evaluate if needed, but not immediately
    setShapes(newShapesOrFn);
  };

  const setTagsSilent = (newTagsOrFn: Tag[] | ((prev: Tag[]) => Tag[])) => {
    lastStateHash.current = '';
    setTags(newTagsOrFn);
  };
  
  const setScenesSilent = (newScenesOrFn: SceneState[] | ((prev: SceneState[]) => SceneState[])) => {
    lastStateHash.current = '';
    setScenes(newScenesOrFn);
  };

  const setCustomMaterialsSilent = (newMaterialsOrFn: any[] | ((prev: any[]) => any[])) => {
    lastStateHash.current = '';
    setCustomMaterials(newMaterialsOrFn);
  };

  const setAnimationsSilent = (newAnimationsOrFn: SceneAnimation[] | ((prev: SceneAnimation[]) => SceneAnimation[])) => {
    lastStateHash.current = '';
    setAnimations(newAnimationsOrFn);
  };

  const setCustomLightsSilent = (newLightsOrFn: CustomLight[] | ((prev: CustomLight[]) => CustomLight[])) => {
    lastStateHash.current = '';
    setCustomLights(newLightsOrFn);
  };

  const setNotesSilent = (newNotesOrFn: SceneNote[] | ((prev: SceneNote[]) => SceneNote[])) => {
    lastStateHash.current = '';
    setNotes(newNotesOrFn);
  };

  const commitHistory = () => {
    saveToHistory(shapes);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const prevShapes = history[historyIndex - 1];
      setShapes(prevShapes);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const nextShapes = history[historyIndex + 1];
      setShapes(nextShapes);
      setHistoryIndex(historyIndex + 1);
    }
  };

  const addShape = (shape: Shape) => {
    handleSetShapes(prev => [...prev, shape]);
    
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

  const handleSetSkybox = (type: SkyboxType) => {
    setSkybox(type);
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
    handleSetShapes(prev => prev.map(s => s.id === id ? { 
      ...s, 
      color, 
      surfaceMaterials: {},
      roughness: pbr?.roughness ?? s.roughness,
      metalness: pbr?.metalness ?? s.metalness,
      opacity: pbr?.opacity ?? s.opacity
    } : s));
    recordAction(`const obj = sdk.getObjectByName("${id}");\nif (obj) sdk.applyColor(obj, "${color}");`);
  };

  const updateShapeDimensions = (id: string, position: [number, number, number], args: any) => {
    handleSetShapes(prev => prev.map(s => s.id === id ? { ...s, position, args } : s));
    recordAction(`const obj = sdk.getObjectByName("${id}");\nif (obj) {\n  obj.position = [${position.map(p => p.toFixed(2)).join(', ')}];\n  obj.args = [${args.map((a: any) => typeof a === 'number' ? a.toFixed(2) : a).join(', ')}];\n}`);
  };

  const clearShapes = () => {
    setShapes([]);
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
    setNotes([]);
    setCustomLights([]);
    setAnimations([]);
    setHistory([]);
    setHistoryIndex(-1);
    setSkybox('none');
    setMeasurements('');
    setIsWorldViewActive(false);
    setGridEnabled(true);
    setSunIntensity(1.0);
    setLightPosition([5, 5, 5]);
    
    // Broadcast camera reset
    window.dispatchEvent(new CustomEvent('reset-camera'));
  };

  const handleSetShadowsEnabled = (enabled: boolean) => {
    setShadowsEnabled(enabled);
    recordAction(`sdk.setShadows(${enabled});`);
  };

  const handleSetGridEnabled = (enabled: boolean) => {
    setGridEnabled(enabled);
    recordAction(`sdk.setGrid(${enabled});`);
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
    recordAction(`sdk.setSkybox("${skybox}", { blur: ${blur} });`);
  };

  const handleSetEnvironmentIntensity = (intensity: number) => {
    setEnvironmentIntensity(intensity);
    recordAction(`sdk.setSkybox("${skybox}", { intensity: ${intensity} });`);
  };

  const handleSetSkyboxRotation = (rotation: number) => {
    setSkyboxRotation(rotation);
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
      activeMaterial,
      setActiveMaterial,
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
      setIsAIRendererOpen,
      isAIQueryOpen,
      setIsAIQueryOpen,
      user,
      setUser,
      theme,
      setTheme,
      bannerColor,
      setBannerColor,
      customMaterials,
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
      lightPosition,
      setLightPosition: handleSetLightPosition,
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
      floorEnabled,
      setFloorEnabled: handleSetFloorEnabled,
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
      // Camera
      defaultCameraPosition,
      setDefaultCameraPosition,
      defaultCameraTarget,
      setDefaultCameraTarget,
      zoom,
      setZoom,
      syncStatus,
      isDiagnosticLogOpen,
      setIsDiagnosticLogOpen,
      contactFrictionEnabled,
      setContactFrictionEnabled,
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
      incrementReads
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
