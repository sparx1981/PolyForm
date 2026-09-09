import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LAYER } from './ui/Surface';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, Play, Trash2, Save, FolderOpen, BookOpen, Terminal, Library as LibraryIcon, ChevronRight, Download, Upload, Plus, AlertCircle, Globe, User, Users, Settings, Circle as CircleIcon, Square as SquareIcon, Box as BoxIcon, Triangle as TriangleIcon, Cone as ConeIcon, Pyramid as PyramidIcon, Torus as TorusIcon, CircleDot, MousePointer2, Eraser, PaintBucket, Move, ArrowUpFromLine, RotateCw, Maximize, CornerUpRight, Orbit, Hand, ZoomIn, Sparkles, Search, MoreHorizontal, Video, Image, Palette, Layers, Box, PenLine, Radio, Zap, Disc, Hexagon, FileCode, FileText, Scissors, Trees, Ruler, Compass, Eye, EyeOff, Copy, Group, Undo, Redo, Hammer, Building, Home, CheckCircle2, ChevronDown, RefreshCw } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import SpecPage from './DeveloperPanel/SpecPage';

import { DeveloperSDK } from '../services/developerService';

export function DeveloperSuite() {
  const { 
    isDeveloperConsoleOpen, 
    setIsDeveloperConsoleOpen, 
    activeDeveloperTab, 
    setActiveDeveloperTab,
    consoleOutput,
    setConsoleOutput,
    theme,
    shapes,
    setShapes,
    updateShapeColor,
    selectedId,
    setSelectedId,
    selectedIds,
    setSelectedIds,
    developerSuiteWidth,
    setDeveloperSuiteWidth,
    developerScripts,
    setDeveloperScripts,
    user,
    setScenes,
    setSkybox,
    setSkyboxBlur,
    setSkyboxRotation,
    setEnvironmentIntensity,
    setFogSettings,
    setCustomLights,
    setActiveBevelType,
    setZoom,
    setDefaultCameraPosition,
    setDefaultCameraTarget,
    isDeveloperSuiteCollapsed,
    setIsDeveloperSuiteCollapsed,
    syncStatus,
    collaborators,
    diagLog,
    setContactFrictionEnabled,
    setIsAIGenerateOpen,
    setAutoOrbitEnabled,
    setEmbeddedWebpageUrl,
    setIsWorldViewActive,
    setWorldViewLocation,
    setWorldViewAltitude,
    setWorldViewRadius,
    triggerFocusOnMap,
    developerCode,
    setDeveloperCode,
    refreshScripts,
    activeTool,
    setActiveTool,
    activeMaterial,
    setActiveMaterial,
    activePBR,
    setActivePBR,
    unit,
    setUnit,
    isAIRendererOpen,
    setIsAIRendererOpen,
    isAIQueryOpen,
    setIsAIQueryOpen,
    timberFrameParams,
    setTimberFrameParams,
    commitUpdatedFraming,
    activePlantSpecies,
    setActivePlantSpecies,
    activePlantVariation,
    setActivePlantVariation,
    activePlantScale,
    setActivePlantScale,
    wallTransparency,
    setWallTransparency,
    exteriorWallTransparency,
    setExteriorWallTransparency,
    interiorWallTransparency,
    setInteriorWallTransparency,
    cameraDepthClippingEnabled,
    setCameraDepthClippingEnabled,
    cameraNear,
    setCameraNear,
    cameraFar,
    setCameraFar,
    orbitRotationSpeed,
    setOrbitRotationSpeed,
    edgeLinesEnabled,
    setEdgeLinesEnabled,
    edgeLinesColor,
    setEdgeLinesColor,
    edgeLinesOpacity,
    setEdgeLinesOpacity,
    edgeLinesThickness,
    setEdgeLinesThickness,
    undo,
    redo,
    selectionFilter,
    setSelectionFilter,
    selectionShapeMode,
    setSelectionShapeMode,
    setShadowsEnabled,
    setGridEnabled,
    setFloorEnabled,
    setFloorColor,
    setAmbientOcclusionEnabled,
    setSunIntensity,
    setLightPosition,
    setAnimateSun,
    setSunSpeed,
    setNotes,
    setAllNotesVisible,
    customToolbars,
    setCustomToolbars,
    basicToolbarExtensions,
    setBasicToolbarExtensions,
    landscapeSculptSettings,
    setLandscapeSculptSettings,
    landscapeRoadSettings,
    setLandscapeRoadSettings
  } = useApp();

  const dragControls = useDragControls();
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const isResizing = useRef(false);

  const startResizing = (e: React.MouseEvent) => {
    isResizing.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - e.clientX;
    setDeveloperSuiteWidth(Math.max(400, Math.min(newWidth, window.innerWidth - 100)));
  };

  const stopResizing = () => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
  };

  const sdkInstance = useMemo(() => {
    return new DeveloperSDK(
      shapes,
      setShapes,
      updateShapeColor,
      selectedId,
      {
        setScenes,
        setSkybox,
        setSkyboxBlur,
        setSkyboxRotation,
        setEnvironmentIntensity,
        setFogSettings,
        setCustomLights,
        setActiveBevelType,
        setZoom,
        setDefaultCameraPosition,
        setDefaultCameraTarget,
        syncStatus,
        collaborators,
        diagLog,
        setContactFrictionEnabled,
        setIsAIGenerateOpen,
        setAutoOrbitEnabled,
        setEmbeddedWebpageUrl,
        setIsWorldViewActive,
        setWorldViewLocation,
        setWorldViewAltitude,
        setWorldViewRadius,
        triggerFocusOnMap,
        onLog: (msg: string) => setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]),
        // Extended App State Setters
        selectedIds,
        setSelectedIds,
        setSelectedId,
        activeTool,
        setActiveTool,
        activeMaterial,
        setActiveMaterial,
        activePBR,
        setActivePBR,
        unit,
        setUnit,
        isAIRendererOpen,
        setIsAIRendererOpen,
        isAIQueryOpen,
        setIsAIQueryOpen,
        timberFrameParams,
        setTimberFrameParams,
        commitUpdatedFraming,
        activePlantSpecies,
        setActivePlantSpecies,
        activePlantVariation,
        setActivePlantVariation,
        activePlantScale,
        setActivePlantScale,
        wallTransparency,
        setWallTransparency,
        exteriorWallTransparency,
        setExteriorWallTransparency,
        interiorWallTransparency,
        setInteriorWallTransparency,
        cameraDepthClippingEnabled,
        setCameraDepthClippingEnabled,
        cameraNear,
        setCameraNear,
        cameraFar,
        setCameraFar,
        orbitRotationSpeed,
        setOrbitRotationSpeed,
        edgeLinesEnabled,
        setEdgeLinesEnabled,
        edgeLinesColor,
        setEdgeLinesColor,
        edgeLinesOpacity,
        setEdgeLinesOpacity,
        edgeLinesThickness,
        setEdgeLinesThickness,
        undo,
        redo,
        selectionFilter,
        setSelectionFilter,
        selectionShapeMode,
        setSelectionShapeMode,
        setShadowsEnabled,
        setGridEnabled,
        setFloorEnabled,
        setFloorColor,
        setAmbientOcclusionEnabled,
        setSunIntensity,
        setLightPosition,
        setAnimateSun,
        setSunSpeed,
        setNotes,
        setAllNotesVisible,
        customToolbars,
        setCustomToolbars,
        basicToolbarExtensions,
        setBasicToolbarExtensions,
        landscapeSculptSettings,
        setLandscapeSculptSettings,
        landscapeRoadSettings,
        setLandscapeRoadSettings
      }
    );
  }, [
    shapes, setShapes, updateShapeColor, selectedId, setScenes, setSkybox, 
    setSkyboxBlur, setSkyboxRotation, setEnvironmentIntensity, setFogSettings, 
    setCustomLights, setActiveBevelType, setZoom, setDefaultCameraPosition, 
    setDefaultCameraTarget, syncStatus, collaborators, diagLog, 
    setContactFrictionEnabled, setIsAIGenerateOpen, setAutoOrbitEnabled, 
    setEmbeddedWebpageUrl, setConsoleOutput, setIsWorldViewActive,
    setWorldViewLocation, setWorldViewAltitude, setWorldViewRadius,
    triggerFocusOnMap, selectedIds, setSelectedIds, setSelectedId, activeTool,
    setActiveTool, activeMaterial, setActiveMaterial, activePBR, setActivePBR,
    unit, setUnit, isAIRendererOpen, setIsAIRendererOpen, isAIQueryOpen,
    setIsAIQueryOpen, timberFrameParams, setTimberFrameParams,
    commitUpdatedFraming, activePlantSpecies, setActivePlantSpecies,
    activePlantVariation, setActivePlantVariation, activePlantScale,
    setActivePlantScale, wallTransparency, setWallTransparency,
    exteriorWallTransparency, setExteriorWallTransparency,
    interiorWallTransparency, setInteriorWallTransparency,
    cameraDepthClippingEnabled, setCameraDepthClippingEnabled,
    cameraNear, setCameraNear, cameraFar, setCameraFar,
    orbitRotationSpeed, setOrbitRotationSpeed, edgeLinesEnabled,
    setEdgeLinesEnabled, edgeLinesColor, setEdgeLinesColor,
    edgeLinesOpacity, setEdgeLinesOpacity, edgeLinesThickness,
    setEdgeLinesThickness, undo, redo, selectionFilter, setSelectionFilter,
    selectionShapeMode, setSelectionShapeMode, setShadowsEnabled,
    setGridEnabled, setFloorEnabled, setFloorColor, setAmbientOcclusionEnabled,
    setSunIntensity, setLightPosition, setAnimateSun, setSunSpeed,
    setNotes, setAllNotesVisible, customToolbars, setCustomToolbars,
    basicToolbarExtensions, setBasicToolbarExtensions,
    landscapeSculptSettings, setLandscapeSculptSettings,
    landscapeRoadSettings, setLandscapeRoadSettings
  ]);

  useEffect(() => {
    (window as any).sdk = sdkInstance;
  }, [sdkInstance]);

  if (!isDeveloperConsoleOpen) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ 
        opacity: 1, 
        x: position.x, 
        y: position.y,
        height: isDeveloperSuiteCollapsed ? '48px' : 'calc(100vh - 32px)'
      }}
      exit={{ opacity: 0, x: 20 }}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      onDragEnd={(_, info) => setPosition(prev => ({ x: prev.x + info.offset.x, y: prev.y + info.offset.y }))}
      className="fixed top-4 right-4 z-[100] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden"
      style={{ width: developerSuiteWidth }}
    >
      {/* Resize Handle (only show when not collapsed) */}
      {!isDeveloperSuiteCollapsed && (
        <div 
          className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-trimble-blue/50 transition-colors z-10"
          onMouseDown={startResizing}
        />
      )}

      {/* Header */}
      <div 
        onPointerDown={(e) => dragControls.start(e)}
        className="h-12 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 bg-gray-50 dark:bg-gray-800/50 cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-trimble-blue" />
            <span className="font-bold text-sm text-gray-900 dark:text-white whitespace-nowrap">Developer Extensibility Suite</span>
          </div>
          {!isDeveloperSuiteCollapsed && (
            <div className="flex items-center bg-gray-200 dark:bg-gray-800 rounded-lg p-0.5">
              {[
                { id: 'console', label: 'Console' },
                { id: 'library', label: 'Library' },
                { id: 'docs', label: 'Getting Started' },
                { id: 'fullDocs', label: 'Full Documentation' },
                { id: 'spec', label: 'Spec' },
                { id: 'settings', label: 'Settings' }
              ].map(tab => (
                <button 
                  key={tab.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDeveloperTab(tab.id as any);
                  }}
                  className={cn(
                    "px-3 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap",
                    activeDeveloperTab === tab.id 
                      ? "bg-white dark:bg-gray-700 shadow-sm text-trimble-blue" 
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsDeveloperSuiteCollapsed(!isDeveloperSuiteCollapsed);
            }}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
            title={isDeveloperSuiteCollapsed ? "Expand" : "Collapse"}
          >
            {isDeveloperSuiteCollapsed ? <Maximize size={16} className="text-gray-500" /> : <MoreHorizontal size={16} className="text-gray-500" />}
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsDeveloperConsoleOpen(false);
            }}
            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>
      </div>

      {/* Content */}
      {!isDeveloperSuiteCollapsed && (
        <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeDeveloperTab === 'console' && (
            <DeveloperConsole 
              key="console" 
              sdkProps={{ 
                shapes, 
                setShapes, 
                updateShapeColor, 
                selectedId,
                extraSetters: {
                  setScenes,
                  setSkybox,
                  setSkyboxBlur,
                  setSkyboxRotation,
                  setEnvironmentIntensity,
                  setFogSettings,
                  setCustomLights,
                  setActiveBevelType,
                  setZoom,
                  setDefaultCameraPosition,
                  setDefaultCameraTarget,
                  syncStatus,
                  collaborators,
                  diagLog,
                  setContactFrictionEnabled,
                  setIsAIGenerateOpen,
                  setAutoOrbitEnabled,
                  setEmbeddedWebpageUrl
                }
              }} 
            />
          )}
          {activeDeveloperTab === 'library' && <DeveloperLibrary key="library" />}
          {activeDeveloperTab === 'docs' && <GettingStarted key="docs" />}
          {activeDeveloperTab === 'fullDocs' && <FullDocumentation key="fullDocs" />}
          {activeDeveloperTab === 'spec' && <ProductSpecification key="spec" />}
          {activeDeveloperTab === 'settings' && <DeveloperSettings key="settings" />}
        </AnimatePresence>
      </div>
      )}
    </motion.div>
  );
}

function ProductSpecification() {
  return <SpecPage />;
}

function DeveloperConsole({ sdkProps }: { sdkProps: any }) {
  const { 
    consoleOutput, 
    setConsoleOutput, 
    theme, 
    developerCode, 
    setDeveloperCode,
    developerScripts,
    setDeveloperScripts,
    setActiveDeveloperTab,
    user,
    refreshScripts
  } = useApp();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [consoleOutput]);

  const handleLoadFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.txt';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (re) => {
        setDeveloperCode(re.target?.result as string);
        setConsoleOutput(prev => [...prev, `[SYSTEM] Loaded script from ${file.name}`]);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleSaveFile = () => {
    const blob = new Blob([developerCode], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'script.js';
    a.click();
    URL.revokeObjectURL(url);
    setConsoleOutput(prev => [...prev, `[SYSTEM] Script saved to local file.`]);
  };

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newScriptName, setNewScriptName] = useState('New Script');

  const QUICK_TEMPLATES = [
    {
      name: 'Terracotta Gable Roof',
      code: `// Create a Gable Roof with Spanish 3D Terracotta Tiles
const roof = sdk.architecture.createRoof({
  roofType: "gable",
  width: 8,
  depth: 12,
  pitchAngleDeg: 30,
  eaveOverhang: 0.45,
  fasciaHeight: 0.20,
  tileShape: "spanish",
  tileSize: 0.85,
  tileColor: "#c2410c",
  randomizeColor: true,
  colorPalette: ["#c2410c", "#9a3412", "#ea580c", "#b45309"],
  position: [0, 3, 0]
});
console.log("Created roof assembly:", roof.id);`
    },
    {
      name: 'Floating Staircase',
      code: `// Create an architectural floating staircase with dual railings
const stairs = sdk.architecture.createStairs({
  style: "straight",
  width: 1.2,
  height: 3.0,
  length: 4.2,
  structure: "floating",
  railing: "both",
  isParametric: true,
  idealStepHeight: 0.175,
  handrailHeight: 0.95,
  position: [0, 0, 0]
});
console.log("Created floating stairs:", stairs.id);`
    },
    {
      name: 'Complete Room Envelope',
      code: `// Build 4 mitered walls, floor slab, and ceiling
const room = sdk.architecture.createRoom({
  width: 8,
  length: 10,
  height: 3.2,
  wallThickness: 0.25,
  wallColor: "#f8fafc",
  floorColor: "#334155"
});
console.log("Room envelope generated:", room.length, "elements");`
    },
    {
      name: 'Structural Timber Framing',
      code: `// Auto-generate studs, plates, and roof rafters
const framing = sdk.architecture.generateTimberFraming({
  spacing: 0.60,
  rafterWidth: 0.045,
  rafterDepth: 0.145,
  species: "douglas-fir",
  color: "#b45309"
});
console.log("Timber framing generated:", framing.length, "members");`
    },
    {
      name: 'Landscape & Trees',
      code: `// Place specimen trees, shrubs, and street furniture
sdk.landscape.addPlant("english_oak", { position: [-5, 0, -4], scale: 1.2 });
sdk.landscape.addPlant("scots_pine", { position: [6, 0, -4], scale: 1.0 });
sdk.landscape.addPlant("hydrangea_bush", { position: [-3, 0, 2] });
sdk.landscape.addSiteFurniture("bench", { position: [0, 0, 4] });
sdk.landscape.addSiteFurniture("lamp", { position: [3, 0, 4] });
console.log("Landscape elements placed!");`
    },
    {
      name: 'PBR Material & Edges',
      code: `// Apply architectural preset & enable linework outlines
const obj = sdk.getSelectedObject();
if (obj) {
  sdk.materials.applyMaterial(obj.id, "vertical-timber");
}
sdk.materials.setEdgeLines({
  enabled: true,
  color: "#0f172a",
  thickness: 1.5,
  opacity: 0.95
});
console.log("PBR material and edge outlines updated!");`
    },
    {
      name: '3D Measure & Annotate',
      code: `// Add dimension line and measure vector slope
sdk.measurement.addDimension([0, 0, 0], [8, 0, 0], "Building Span: 8.00m");
const m = sdk.measurement.measureDistance([0, 0, 0], [0, 3.2, 4.0]);
console.log("Distance:", m.formatted, "Pitch Angle:", m.pitchDeg.toFixed(1) + "°");`
    },
    {
      name: 'Scene Stats & Export',
      code: `// Inspect scene metrics and export JSON
const stats = sdk.scene.getStats();
console.log("Scene Metrics:", stats);
const json = sdk.scene.exportJSON();
console.log("JSON export length:", json.length, "bytes");`
    },
    {
      name: 'Custom Floating Toolbar',
      code: `// 1. Create a Custom Floating or Docked Toolbar
const customTb = sdk.toolbars.create({
  id: "arch-studio-toolbar",
  title: "Arch Studio Ext",
  position: "floating",
  orientation: "horizontal",
  floatPosition: { x: 80, y: 120 },
  items: [
    {
      id: "btn-quick-pavilion",
      label: "Pavilion",
      icon: "Building",
      tooltip: "Build complete room envelope with 4 walls & floor slab",
      color: "#3b82f6",
      badge: "PRO",
      code: \`
        sdk.architecture.createRoom({
          width: 8,
          length: 10,
          height: 3.2,
          wallThickness: 0.25,
          wallColor: "#f8fafc",
          floorColor: "#334155"
        });
        console.log("Pavilion envelope generated!");
      \`
    },
    {
      id: "btn-spanish-roof",
      label: "Tile Roof",
      icon: "Home",
      tooltip: "Generate Spanish terracotta roof assembly",
      color: "#ea580c",
      code: \`
        sdk.architecture.createRoof({
          roofType: "gable",
          width: 8.5,
          depth: 10.5,
          pitchAngleDeg: 28,
          tileShape: "spanish",
          tileColor: "#c2410c",
          position: [0, 3.2, 0]
        });
        console.log("Spanish terracotta roof added!");
      \`
    },
    {
      id: "btn-add-trees",
      label: "Grove",
      icon: "Trees",
      tooltip: "Scatter landscape specimen trees",
      color: "#16a34a",
      code: \`
        sdk.landscape.addPlant("english_oak", { position: [-6, 0, -4], scale: 1.2 });
        sdk.landscape.addPlant("scots_pine", { position: [7, 0, -3], scale: 1.0 });
        sdk.landscape.addSiteFurniture("bench", { position: [0, 0, 6] });
        console.log("Landscape grove & furniture placed!");
      \`
    }
  ]
});

// 2. Add an additional action button dynamically
sdk.toolbars.addButton("arch-studio-toolbar", {
  id: "btn-edge-lines",
  label: "Edges",
  icon: "PenLine",
  tooltip: "Toggle architectural linework outlines",
  color: "#8b5cf6",
  badge: "CAD",
  code: \`
    sdk.materials.setEdgeLines({ enabled: true, color: "#0f172a", thickness: 2, opacity: 0.95 });
    console.log("Architectural CAD outlines applied!");
  \`
});

console.log("Custom toolbar created! ID:", customTb.id);`
    },
    {
      name: 'Basic Toolbar Extension',
      code: `// Add custom extension buttons directly to the Left Rail Basic Toolbar
sdk.toolbars.addToBasicToolbar({
  id: "ext-quick-stairs",
  label: "Floating Stairs",
  icon: "Layers",
  tooltip: "Quickly generate parametric floating staircase",
  color: "#f59e0b",
  badge: "NEW",
  hotkey: "Ctrl+Alt+S",
  code: \`
    const stairs = sdk.architecture.createStairs({
      style: "straight",
      width: 1.2,
      height: 3.0,
      length: 4.2,
      structure: "floating",
      railing: "both",
      idealStepHeight: 0.175,
      position: [0, 0, 0]
    });
    console.log("Floating stairs placed via basic toolbar extension:", stairs.id);
  \`
});

sdk.toolbars.addToBasicToolbar({
  id: "ext-quick-measure",
  label: "Span Measure",
  icon: "Ruler",
  tooltip: "Add span dimension across active bounds",
  color: "#06b6d4",
  badge: "DIM",
  code: \`
    const dim = sdk.measurement.addDimension([0, 0, 0], [8, 0, 0], "Span: 8.00m");
    console.log("Dimension line added:", dim.id);
  \`
});

console.log("Added 2 custom extension buttons to basic toolbar!");`
    },
    {
      name: 'Configure Tool Parameters',
      code: `// Configure defaults & variables matching all main tools

// 1. Architecture: Roof Defaults
sdk.architecture.configureRoofDefaults({
  roofType: "gable",
  pitchAngleDeg: 35,
  eaveOverhang: 0.5,
  fasciaHeight: 0.22,
  tileShape: "spanish",
  tileSize: 0.85,
  tileColor: "#c2410c",
  randomizeColor: true,
  colorPalette: ["#c2410c", "#9a3412", "#ea580c", "#b45309"],
  ridgeCap: true,
  gutter: true
});

// 2. Architecture: Stair Defaults
sdk.architecture.configureStairDefaults({
  style: "straight",
  structure: "floating",
  railing: "both",
  width: 1.2,
  height: 3.0,
  idealStepHeight: 0.175,
  treadColor: "#d97706",
  stringerColor: "#334155",
  handrailHeight: 0.95
});

// 3. Architecture: Wall Defaults
sdk.architecture.configureWallDefaults({
  wallThickness: 0.25,
  wallHeight: 3.2,
  wallColor: "#f1f5f9",
  transparency: 0.0
});

// 4. Landscape: Sculpt Settings
sdk.landscape.configureSculptSettings({
  mode: "push",
  radius: 4.5,
  intensity: 0.6,
  masked: false
});

// 5. Landscape: Road Settings
sdk.landscape.configureRoadSettings({
  width: 4.0,
  embankment: true,
  roadColor: "#1e293b",
  curbHeight: 0.2
});

// 6. Materials & Edges Defaults
sdk.materials.configureMaterialDefaults({
  roughness: 0.45,
  metalness: 0.05,
  opacity: 1.0,
  edgeLinesEnabled: true,
  edgeLinesColor: "#0f172a",
  edgeLinesThickness: 1.5,
  edgeLinesOpacity: 0.95
});

// 7. Measurement Defaults
sdk.measurement.configureMeasurementSettings({
  unit: "m",
  precision: 3,
  showAllDimensions: true
});

console.log("All tool parameters and variables successfully configured!");`
    }
  ];

  const handleSaveToLibrary = () => {
    setIsSaveModalOpen(true);
  };

  const confirmSaveToLibrary = async () => {
    const scriptName = newScriptName.trim() || `Script ${new Date().toLocaleDateString()}`;

    const newScript = {
      userId: user?.uid || 'anonymous',
      userName: user?.displayName || 'Anonymous User',
      name: scriptName,
      code: developerCode,
      createdAt: new Date().toISOString(),
      pinned: false,
      isPublic: false
    };

    try {
      await addDoc(collection(db, 'scripts'), newScript);
      refreshScripts();
      setConsoleOutput(prev => [...prev, `[SYSTEM] Script "${scriptName}" saved to library.`]);
      setIsSaveModalOpen(false);
      
      // Switch to library tab to show success
      setTimeout(() => setActiveDeveloperTab('library'), 500);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'scripts');
    }
  };

  const runScript = async () => {
    setIsRunning(true);
    setProgress(0);
    setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Starting execution...`]);

    try {
      const customConsole = {
        log: (...args: any[]) => {
          setConsoleOutput(prev => [...prev, `[LOG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`]);
        },
        error: (...args: any[]) => {
          setConsoleOutput(prev => [...prev, `[ERROR] ${args.join(' ')}`]);
        }
      };

      // Simple execution for now (not in worker yet)
      const fn = new Function('sdk', 'scene', 'console', `
        return (async () => {
          try {
            ${developerCode}
          } catch (e) {
            console.error(e.message);
          }
        })();
      `);

      await fn((window as any).sdk, (window as any).sdk, customConsole);
      setConsoleOutput(prev => [...prev, `[${new Date().toLocaleTimeString()}] Execution completed successfully.`]);
    } catch (err: any) {
      setConsoleOutput(prev => [...prev, `[ERROR] ${err.message}`]);
    } finally {
      setIsRunning(false);
      setProgress(100);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Output Window */}
      <div className="h-1/3 border-b border-gray-200 dark:border-gray-800 flex flex-col">
        <div className="h-8 px-4 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Output</span>
          <button 
            onClick={() => setConsoleOutput([])}
            className="text-[10px] font-bold text-trimble-blue hover:underline uppercase"
          >
            Clear History
          </button>
        </div>
        <div 
          ref={outputRef}
          className="flex-1 p-4 font-mono text-xs overflow-y-auto bg-gray-900 text-gray-300"
        >
          {consoleOutput.length === 0 ? (
            <span className="text-gray-600 italic">No output yet...</span>
          ) : (
            consoleOutput.map((line, i) => (
              <div key={i} className={cn(
                "mb-1",
                line.includes('[ERROR]') ? "text-red-400" : 
                line.includes('[LOG]') ? "text-blue-400" : "text-gray-400"
              )}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 relative flex flex-col">
        <div className="h-8 px-4 flex items-center justify-between bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Editor</span>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleLoadFile}
              className="p-1 hover:bg-white/10 rounded transition-colors text-white" 
              title="Load File"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={handleSaveFile}
              className="p-1 hover:bg-white/10 rounded transition-colors text-white" 
              title="Save File"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={handleSaveToLibrary}
              className="p-1 hover:bg-white/10 rounded transition-colors text-white" 
              title="Save to Library"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Quick Snippets Bar */}
        <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700/80 flex items-center gap-1.5 overflow-x-auto text-[11px] no-scrollbar">
          <span className="text-[9px] uppercase font-bold text-gray-400 whitespace-nowrap mr-1 tracking-wider">Templates:</span>
          {QUICK_TEMPLATES.map((tpl, idx) => (
            <button
              key={idx}
              onClick={() => setDeveloperCode(tpl.code)}
              className="px-2 py-0.5 rounded bg-white dark:bg-gray-700/80 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-trimble-blue hover:text-trimble-blue dark:hover:text-trimble-blue whitespace-nowrap transition-colors text-[10px] font-medium"
              title={`Load ${tpl.name}`}
            >
              {tpl.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            defaultLanguage="javascript"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={developerCode}
            onChange={(val) => setDeveloperCode(val || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>

        {/* Controls */}
        <div className="h-12 px-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-gray-900">
          <div className="flex-1 max-w-xs h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full bg-trimble-blue"
            />
          </div>
          <button 
            onClick={runScript}
            disabled={isRunning}
            className={cn(
              "flex items-center gap-2 px-6 py-1.5 rounded-lg text-sm font-bold transition-all",
              isRunning 
                ? "bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed" 
                : "bg-trimble-blue text-white hover:bg-trimble-blue/90 shadow-lg shadow-trimble-blue/20"
            )}
          >
            {isRunning ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            {isRunning ? "Running..." : "Run Script"}
          </button>
        </div>
      </div>

      {/* Save Modal */}
      <AnimatePresence>
        {isSaveModalOpen && (
          <div className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" style={{ zIndex: LAYER.nested }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)] overflow-hidden"
            >
              <header className="px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Save to library</h2>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  Saved scripts are available from the library in every model.
                </p>
              </header>
              <div className="px-6 py-5">
                <div>
                  <label htmlFor="polyform-script-name" className="block text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    Script name
                  </label>
                  <input 
                    id="polyform-script-name"
                    type="text"
                    value={newScriptName}
                    onChange={(e) => setNewScriptName(e.target.value)}
                    className="mt-1 w-full h-9 px-3 rounded-lg text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                    autoFocus
                  />
                </div>
              </div>
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/30">
                  <button 
                    onClick={() => setIsSaveModalOpen(false)}
                    className="inline-flex items-center justify-center h-9 px-4 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-trimble-blue"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmSaveToLibrary}
                    className="inline-flex items-center justify-center h-9 px-4 rounded-lg bg-trimble-blue text-white text-sm font-medium hover:bg-trimble-blue/90 transition-colors shadow-sm shadow-trimble-blue/20 outline-none focus-visible:ring-2 focus-visible:ring-trimble-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
                  >
                    Save Script
                  </button>
                </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DeveloperLibrary() {
  const { developerScripts, setDeveloperScripts, setDeveloperCode, setActiveDeveloperTab, setPinnedScripts, user, refreshScripts } = useApp();
  const [filter, setFilter] = useState<'all' | 'me' | 'shared'>('all');
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [editingScriptName, setEditingScriptName] = useState('');

  const filteredScripts = useMemo(() => {
    return developerScripts.filter(s => {
      if (filter === 'me') return s.userId === (user?.uid || 'anonymous');
      if (filter === 'shared') return s.isPublic;
      return true;
    });
  }, [developerScripts, filter, user]);

  const copyScript = async (script: any) => {
    if (!user) return;
    
    const newScript = {
      userId: user.uid,
      userName: user.displayName || 'Anonymous User',
      name: `${script.name} (Copy)`,
      code: script.code,
      createdAt: new Date().toISOString(),
      pinned: false,
      isPublic: false
    };

    try {
      await addDoc(collection(db, 'scripts'), newScript);
      refreshScripts();
      alert('Script copied to your library!');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'scripts');
    }
  };

  const togglePin = async (id: string) => {
    const script = developerScripts.find(s => s.id === id);
    if (!script) return;
    
    const newPinned = !script.pinned;
    try {
      await updateDoc(doc(db, 'scripts', id), { pinned: newPinned });
      refreshScripts();
      if (newPinned) {
        setPinnedScripts(p => p.includes(id) ? p : [...p, id]);
      } else {
        setPinnedScripts(p => p.filter(pid => pid !== id));
      }
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `scripts/${id}`);
    }
  };

  const togglePublic = async (id: string) => {
    const script = developerScripts.find(s => s.id === id);
    if (!script) return;

    if (!script.isPublic) {
      if (window.confirm('Are you sure you want to make this script publicly available to other users?')) {
        try {
          await updateDoc(doc(db, 'scripts', id), { isPublic: true });
          refreshScripts();
        } catch (err: any) {
          handleFirestoreError(err, OperationType.UPDATE, `scripts/${id}`);
        }
      }
    } else {
      try {
        await updateDoc(doc(db, 'scripts', id), { isPublic: false });
        refreshScripts();
      } catch (err: any) {
        handleFirestoreError(err, OperationType.UPDATE, `scripts/${id}`);
      }
    }
  };

  const deleteScript = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this script?')) {
      try {
        await deleteDoc(doc(db, 'scripts', id));
        refreshScripts();
        setPinnedScripts(p => p.filter(pid => pid !== id));
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `scripts/${id}`);
      }
    }
  };

  const handleRename = async (id: string) => {
    if (!editingScriptName.trim()) {
      setEditingScriptId(null);
      return;
    }

    try {
      await updateDoc(doc(db, 'scripts', id), { name: editingScriptName.trim() });
      setEditingScriptId(null);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `scripts/${id}`);
    }
  };

  return (
    <div className="h-full p-6 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">Script Library</h2>
            <p className="text-sm text-gray-500">Manage your saved automation scripts.</p>
          </div>
          <div className="flex bg-gray-200 dark:bg-gray-800 rounded-lg p-1">
            {[
              { id: 'all', label: 'All Scripts', icon: <Globe size={12} /> },
              { id: 'me', label: 'Made By Me', icon: <User size={12} /> },
              { id: 'shared', label: 'Shared Scripts', icon: <Users size={12} /> }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as any)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                  filter === f.id ? "bg-white dark:bg-gray-700 shadow-sm text-trimble-blue" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                )}
              >
                {f.icon}
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredScripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700">
            <LibraryIcon className="w-12 h-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">No scripts found</p>
            <p className="text-xs text-gray-400 mt-1">Try changing your filter or saving a new script.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredScripts.map(script => (
              <div key={script.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      {editingScriptId === script.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingScriptName}
                            onChange={(e) => setEditingScriptName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(script.id);
                              if (e.key === 'Escape') setEditingScriptId(null);
                            }}
                            className="flex-1 px-2 py-1 text-sm bg-gray-50 dark:bg-gray-900 border border-trimble-blue rounded focus:outline-none text-gray-900 dark:text-white"
                            autoFocus
                            onBlur={() => handleRename(script.id)}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group/title">
                          <h3 className="font-bold text-sm text-gray-900 dark:text-white truncate">{script.name}</h3>
                          {script.userId === user?.uid && (
                            <button
                              onClick={() => {
                                setEditingScriptId(script.id);
                                setEditingScriptName(script.name);
                              }}
                              className="opacity-0 group-hover/title:opacity-100 p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-all text-gray-400 hover:text-trimble-blue"
                              title="Rename Script"
                            >
                              <PenLine size={12} />
                            </button>
                          )}
                        </div>
                      )}
                      <p className="text-[10px] text-gray-400">Created By: {script.userName || 'Unknown'}</p>
                    </div>
                    {script.isPublic && <span title="Public Script"><Globe size={12} className="text-trimble-blue shrink-0" /></span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => togglePublic(script.id)}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        script.isPublic
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : "text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400"
                      )}
                      title={script.isPublic ? "Make Private" : "Make Public"}
                    >
                      <Globe className="w-3.5 h-3.5" />
                    </button>
                    {script.userId === user?.uid ? (
                      <button 
                        onClick={() => togglePin(script.id)}
                        className={cn(
                          "p-1.5 rounded-lg transition-colors",
                          script.pinned ? "text-trimble-blue bg-trimble-blue/10" : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                        )}
                        title={script.pinned ? "Unpin from Toolbar" : "Pin to Toolbar"}
                      >
                        <Plus className={cn("w-3.5 h-3.5 transition-transform", script.pinned && "rotate-45")} />
                      </button>
                    ) : (
                      <button 
                        onClick={() => copyScript(script)}
                        className="p-1.5 text-trimble-blue hover:bg-trimble-blue/10 rounded-lg transition-colors"
                        title="Copy to My Library"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button 
                      onClick={() => deleteScript(script.id)}
                      className="p-1.5 text-red-400/80 dark:text-red-400/70 hover:text-red-700 dark:hover:text-red-300 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 mb-4 font-mono truncate bg-gray-50 dark:bg-gray-900/50 p-2 rounded">
                  {script.code.substring(0, 100)}...
                </p>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      setDeveloperCode(script.code);
                      setActiveDeveloperTab('console');
                    }}
                    className="flex-1 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-xs font-bold transition-colors"
                  >
                    Open in Console
                  </button>
                  <button 
                    onClick={() => {
                      // Shared run logic
                    }}
                    className="px-3 py-1.5 bg-trimble-blue text-white rounded-lg text-xs font-bold hover:bg-trimble-blue/90 transition-colors"
                  >
                    <Play className="w-3 h-3 fill-current" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GettingStarted() {
  const { setActiveDeveloperTab, setDeveloperCode } = useApp();

  const examples = [
    {
      title: "Pavilion with Terracotta 3D Tile Roof",
      description: "Generates a complete room envelope and caps it with a 30° gable roof featuring 3D Spanish terracotta tiles and eave overhangs.",
      code: `// 1. Build room envelope (4 mitered walls, floor slab, ceiling)
const room = sdk.architecture.createRoom({
  width: 8,
  length: 12,
  height: 3.2,
  wallThickness: 0.25,
  wallColor: "#f8fafc",
  floorColor: "#334155"
});

// 2. Add Gable roof with 3D Spanish terracotta tiles and eave overhang
const roof = sdk.architecture.createRoof({
  roofType: "gable",
  width: 8,
  depth: 12,
  pitchAngleDeg: 30,
  eaveOverhang: 0.45,
  fasciaHeight: 0.20,
  tileShape: "spanish",
  tileSize: 0.85,
  tileColor: "#c2410c",
  randomizeColor: true,
  colorPalette: ["#c2410c", "#9a3412", "#ea580c", "#b45309"],
  position: [0, 3.2, 0]
});

console.log("Pavilion created with roof ID:", roof.id);`
    },
    {
      title: "Parametric Floating Staircase with Railings",
      description: "Generates an ergonomic floating staircase with continuous steel/glass railings and precise riser/tread geometry.",
      code: `// Create an architectural floating staircase
const stairs = sdk.architecture.createStairs({
  style: "straight",
  width: 1.2,
  height: 3.0,
  length: 4.2,
  structure: "floating",
  railing: "both",
  isParametric: true,
  idealStepHeight: 0.175,
  handrailHeight: 0.95,
  color: "#e2e8f0",
  position: [0, 0, 0]
});

console.log("Staircase generated:", stairs.id);`
    },
    {
      title: "Site Planning, Specimen Trees & Urban Furniture",
      description: "Populates the site with botanical specimens from the 3D plant catalog, site furniture, and terrain ground textures.",
      code: `// Place specimen trees and flowering shrubs
sdk.landscape.addPlant("english_oak", { position: [-5, 0, -4], scale: 1.2 });
sdk.landscape.addPlant("scots_pine", { position: [6, 0, -4], scale: 1.1 });
sdk.landscape.addPlant("hydrangea_bush", { position: [-3, 0, 2], scale: 0.9 });

// Place site fixtures
sdk.landscape.addSiteFurniture("bench", { position: [-1, 0, 4], rotation: 0.3 });
sdk.landscape.addSiteFurniture("lamp", { position: [4, 0, 4] });

// Apply terrain texture
sdk.landscape.applyTerrainTexture("grass");
console.log("Site planning completed successfully!");`
    },
    {
      title: "Automated Structural Timber Framing",
      description: "Generates structural studs, sole/top plates, and roof rafters with standard 600mm spacing and timber member sizing.",
      code: `// Generate studs, plates, and rafters
const framing = sdk.architecture.generateTimberFraming({
  spacing: 0.60,
  rafterWidth: 0.045,
  rafterDepth: 0.145,
  species: "douglas-fir",
  color: "#b45309"
});

console.log(\`Generated \${framing.length} structural timber members.\`);`
    },
    {
      title: "Architectural PBR Cladding & Edge Outlines",
      description: "Applies architectural material presets (vertical timber, stone, brick) and configures high-contrast linework outlines.",
      code: `// Apply architectural material to selection
const obj = sdk.getSelectedObject();
if (obj) {
  sdk.materials.applyMaterial(obj.id, "vertical-timber", {
    roughness: 0.7,
    metalness: 0.05
  });
}

// Enable crisp architectural linework
sdk.materials.setEdgeLines({
  enabled: true,
  color: "#0f172a",
  thickness: 1.5,
  opacity: 0.95
});

console.log("PBR materials and edge linework applied!");`
    },
    {
      title: "3D Measurement, Dimensions & Pitch Angle",
      description: "Places spatial dimension annotations and measures true 3D distance, horizontal run, vertical rise, and slope angle.",
      code: `// Place dimension line annotation
sdk.measurement.addDimension([0, 0, 0], [8, 0, 0], "Building Span: 8.00m");

// Calculate 3D distance, run, rise, and slope pitch
const m = sdk.measurement.measureDistance([0, 0, 0], [0, 3.2, 4.0]);
console.log("Vector Distance:", m.formatted);
console.log("Horizontal Run:", m.run.toFixed(2) + "m");
console.log("Vertical Rise:", m.rise.toFixed(2) + "m");
console.log("Roof Pitch Angle:", m.pitchDeg.toFixed(1) + "°");`
    },
    {
      title: "Boolean CSG Solid Modeling",
      description: "Carves architectural openings and reveals using solid boolean subtraction, union, or intersection.",
      code: `// Create solid target and cutter
const wall = sdk.createBox({ width: 6, height: 3, depth: 0.3, position: [0, 1.5, 0] });
const doorway = sdk.createBox({ width: 1.2, height: 2.2, depth: 0.5, position: [0, 1.1, 0] });

// Subtract doorway from wall after geometry mounts
setTimeout(() => {
  sdk.performCSG(wall.id, doorway.id, "SUBTRACTION");
  console.log("CSG Subtraction completed!");
}, 150);`
    },
    {
      title: "Scene Diagnostics, Stats & JSON Export",
      description: "Queries real-time scene geometry statistics, memory usage, and exports the full scene graph as JSON.",
      code: `// Query live scene metrics
const stats = sdk.scene.getStats();
console.log("Total Shapes:", stats.shapeCount);
console.log("Estimated Vertices:", stats.estimatedVertices);
console.log("Bounding Box:", JSON.stringify(stats.boundingBox));

// Export full project JSON
const sceneData = sdk.scene.exportJSON();
console.log(\`Exported JSON size: \${(sceneData.length / 1024).toFixed(1)} KB\`);`
    }
  ];

  return (
    <div className="h-full p-6 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">Getting Started</h2>
          <p className="text-sm text-gray-500">Automate your 3D architectural, landscape, and structural workflows using the Developer SDK.</p>
        </div>

        <div className="space-y-6">
          <section className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-white">
              <BookOpen className="w-5 h-5 text-trimble-blue" />
              SDK Architecture & Subsystems
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
              The Developer SDK exposes modular subsystems accessible via the global <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-trimble-blue font-mono text-xs">sdk</code> instance:
              <br />
              <span className="font-semibold text-gray-800 dark:text-gray-200">sdk.architecture</span> (roofs with 3D tile profiles, rooms, parametric stairs, timber framing) · 
              <span className="font-semibold text-gray-800 dark:text-gray-200"> sdk.landscape</span> (trees, shrubs, site furniture, terrain) · 
              <span className="font-semibold text-gray-800 dark:text-gray-200"> sdk.materials</span> (PBR presets, linework edge lines) · 
              <span className="font-semibold text-gray-800 dark:text-gray-200"> sdk.measurement</span> (dimension lines, pitch angle calculations, units) · 
              <span className="font-semibold text-gray-800 dark:text-gray-200"> sdk.selection</span> (grouping, alignment, duplicate, transform) · 
              <span className="font-semibold text-gray-800 dark:text-gray-200"> sdk.camera</span> (section depth clipping, projections, auto-orbit) · 
              <span className="font-semibold text-gray-800 dark:text-gray-200"> sdk.ai</span> (generative massing, rendering, copilot) · 
              <span className="font-semibold text-gray-800 dark:text-gray-200"> sdk.scene</span> (statistics, JSON export, undo/redo).
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {examples.map((example, i) => (
                <div key={i} className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-trimble-blue/30 transition-all flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-sm text-gray-900 dark:text-white">{example.title}</h4>
                      <button 
                        onClick={() => {
                          setDeveloperCode(example.code);
                          setActiveDeveloperTab('console');
                        }}
                        className="text-[10px] font-bold text-trimble-blue hover:underline uppercase flex items-center gap-1 shrink-0 ml-2"
                      >
                        Try It Now
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">{example.description}</p>
                  </div>
                  <pre className="p-3 bg-gray-900 text-gray-300 rounded-lg text-[10px] font-mono overflow-x-auto max-h-48">
                    {example.code}
                  </pre>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function FullDocumentation() {
  const { setActiveDeveloperTab, setDeveloperCode } = useApp();

  const categories = [
    {
      title: "Architecture: Roofs & 3D Tile Profiles",
      icon: <Home className="w-4 h-4 text-orange-500" />,
      items: [
        {
          name: "Create Roof (Spanish 3D Tiles)",
          code: `// Supported profiles: 'none', 'roman', 'mission', 'spanish', 'flat', 'slate', 'shingle', 'barrel', 'scallop', 'interlocking', 'standing-seam'
// Supported roof types: 'gable', 'hip', 'mansard', 'shed', 'flat', 'dutch-hip', 'gambrel', 'butterfly', 'saltbox', 'parapet'
sdk.architecture.createRoof({
  roofType: "gable",
  width: 8,
  depth: 12,
  pitchAngleDeg: 30,       // or ridgeHeight: 2.5
  eaveOverhang: 0.40,
  fasciaHeight: 0.18,
  tileShape: "spanish",
  tileSize: 0.85,
  tileColor: "#c2410c",
  randomizeColor: true,
  colorPalette: ["#c2410c", "#9a3412", "#ea580c"],
  position: [0, 3.2, 0]
});`
        },
        {
          name: "Create Hip Roof (No Tile for Performance)",
          code: `// Uses 'none' tile shape profile for optimal rendering speed
sdk.architecture.createRoof({
  roofType: "hip",
  width: 10,
  depth: 10,
  pitchAngleDeg: 25,
  eaveOverhang: 0.50,
  tileShape: "none",
  tileColor: "#475569",
  position: [0, 3, 0]
});`
        },
        {
          name: "Update Existing Roof",
          code: `// Modify roof pitch, fascia, or tile profile at runtime
const roofs = sdk.architecture.listRoofs();
if (roofs.length > 0) {
  sdk.architecture.updateRoof(roofs[0].id, {
    pitchAngleDeg: 35,
    tileShape: "barrel",
    eaveOverhang: 0.60
  });
}`
        },
        {
          name: "List Scene Roofs",
          code: `// Retrieve all architectural roof assemblies
const roofs = sdk.architecture.listRoofs();
console.log(\`Found \${roofs.length} roofs in scene.\`);`
        }
      ]
    },
    {
      title: "Architecture: Rooms, Walls & Openings",
      icon: <Building className="w-4 h-4 text-blue-500" />,
      items: [
        {
          name: "Create Room Envelope",
          code: `// Generates 4 mitered walls, floor slab, and ceiling in 1 call
sdk.architecture.createRoom({
  width: 8,
  length: 10,
  height: 3.2,
  wallThickness: 0.25,
  wallColor: "#f8fafc",
  floorColor: "#334155",
  ceilingColor: "#ffffff",
  position: [0, 0, 0]
});`
        },
        {
          name: "Create Single Wall",
          code: `// Place parametric wall by length or between coordinates
sdk.architecture.createWall({
  start: [0, 0, 0],
  end: [6, 0, 0],
  height: 3.0,
  thickness: 0.20,
  color: "#e2e8f0"
});`
        },
        {
          name: "Create Door / Window Opening",
          code: `// Place architectural door or window opening
sdk.architecture.createDoor({
  width: 0.95,
  height: 2.10,
  depth: 0.15,
  position: [2, 1.05, 0]
});
sdk.architecture.createWindow({
  width: 1.50,
  height: 1.20,
  depth: 0.15,
  position: [4, 1.60, 0]
});`
        },
        {
          name: "Set Wall Transparency",
          code: `// Control overall, exterior, and interior wall transparency (0 to 1)
sdk.architecture.setWallTransparency({
  overall: 0.2,
  exterior: 0.1,
  interior: 0.3
});`
        }
      ]
    },
    {
      title: "Architecture: Parametric Stairs & Railings",
      icon: <ArrowUpFromLine className="w-4 h-4 text-green-500" />,
      items: [
        {
          name: "Straight Floating Staircase",
          code: `// Styles: 'straight', 'l-shape', 'u-shape', 'spiral', 'curved', 'winder'
// Structures: 'closed', 'open', 'floating', 'mono-stringer'
sdk.architecture.createStairs({
  style: "straight",
  width: 1.2,
  height: 3.0,
  length: 4.2,
  structure: "floating",
  railing: "both",
  isParametric: true,
  idealStepHeight: 0.175,
  handrailHeight: 0.95,
  color: "#cbd5e1"
});`
        },
        {
          name: "L-Shape Staircase with Landing",
          code: `sdk.architecture.createStairs({
  style: "l-shape",
  width: 1.0,
  height: 3.2,
  length: 3.8,
  structure: "closed",
  railing: "right",
  position: [0, 0, 0]
});`
        },
        {
          name: "Spiral Staircase",
          code: `sdk.architecture.createStairs({
  style: "spiral",
  width: 1.1,
  height: 3.4,
  structure: "mono-stringer",
  railing: "both",
  position: [0, 0, 0]
});`
        },
        {
          name: "Create Architectural Railing",
          code: `// Add standalone railing / balustrade
sdk.architecture.createRailing({
  start: [0, 3.0, 0],
  end: [5, 3.0, 0],
  height: 1.0,
  style: "glass-metal",
  color: "#94a3b8"
});`
        }
      ]
    },
    {
      title: "Architecture: Structural Timber Framing",
      icon: <Hammer className="w-4 h-4 text-amber-500" />,
      items: [
        {
          name: "Generate Timber Framing",
          code: `// Auto-calculates studs, top/sole plates, rafters, and ridge beams
const members = sdk.architecture.generateTimberFraming({
  spacing: 0.60,             // 0.40m (16in) or 0.60m (24in) centers
  rafterWidth: 0.045,        // 45mm timber
  rafterDepth: 0.145,        // 145mm timber
  species: "douglas-fir",    // 'douglas-fir', 'pine', 'oak', 'cedar'
  color: "#b45309"
});
console.log(\`Framing member count: \${members.length}\`);`
        },
        {
          name: "Clear Timber Framing",
          code: `// Removes all generated timber framing elements
sdk.architecture.clearTimberFraming();
console.log("Timber framing cleared.");`
        }
      ]
    },
    {
      title: "Landscaping, Plants & Site Planning",
      icon: <Trees className="w-4 h-4 text-emerald-500" />,
      items: [
        {
          name: "Place Botanical Plant / Tree",
          code: `// Species: 'english_oak', 'mediterranean_cypress', 'scots_pine', 'japanese_maple', 'boxwood_shrub', 'hydrangea_bush', 'ribbon_grass'
sdk.landscape.addPlant("english_oak", {
  position: [-4, 0, -3],
  scale: 1.25,
  rotation: Math.PI / 6
});`
        },
        {
          name: "Place Site Furniture & Fixtures",
          code: `// Types: 'bench', 'lamp', 'fence', 'rock', 'planter'
sdk.landscape.addSiteFurniture("bench", { position: [0, 0, 3] });
sdk.landscape.addSiteFurniture("lamp", { position: [3, 0, 3] });`
        },
        {
          name: "Apply Terrain Surface Texture",
          code: `// Textures: 'grass', 'gravel', 'paving', 'mulch', 'flagstone'
sdk.landscape.applyTerrainTexture("grass");`
        },
        {
          name: "List Plant Catalog Species",
          code: `// Inspect all available species in catalog
const catalog = sdk.landscape.listPlantCatalog();
console.log("Available plants:", catalog.map(p => p.commonName).join(", "));`
        }
      ]
    },
    {
      title: "Materials, PBR & Edge Lines",
      icon: <Palette className="w-4 h-4 text-pink-500" />,
      items: [
        {
          name: "Apply Architectural Material Preset",
          code: `// Presets: 'red-brick', 'coursed-stone', 'polished-concrete', 'stucco-white', 'vertical-timber', 'architectural-glass', 'slate-tile'
const obj = sdk.getSelectedObject();
if (obj) {
  sdk.materials.applyMaterial(obj.id, "red-brick", {
    roughness: 0.8,
    metalness: 0.0,
    uvScale: [2, 2]
  });
}`
        },
        {
          name: "Configure Architectural Edge Lines",
          code: `// Crisp outlines highlight model contours and massing
sdk.materials.setEdgeLines({
  enabled: true,
  color: "#0f172a",
  thickness: 1.5,
  opacity: 0.95
});`
        },
        {
          name: "List Material Presets",
          code: `const presets = sdk.materials.listPresets();
console.log("Available Presets:", presets.join(", "));`
        }
      ]
    },
    {
      title: "Measurement, Snapping & Units",
      icon: <Ruler className="w-4 h-4 text-cyan-500" />,
      items: [
        {
          name: "Add 3D Dimension Annotation",
          code: `// Anchor 3D measurement line between points with text
sdk.measurement.addDimension([0, 0, 0], [8, 0, 0], "Width: 8.00m");`
        },
        {
          name: "Measure Vector Distance & Slope",
          code: `// Computes true distance, horizontal run, vertical rise, and pitch angle
const res = sdk.measurement.measureDistance([0, 0, 0], [0, 3.2, 4.0]);
console.log("Distance:", res.formatted);
console.log("Pitch Angle:", res.pitchDeg.toFixed(1) + "°");`
        },
        {
          name: "Set Active Unit",
          code: `// Supported: 'm', 'ft', 'in', 'mm'
sdk.measurement.setUnit("m");
console.log("Active unit is now:", sdk.measurement.getUnit());`
        }
      ]
    },
    {
      title: "Selection, Grouping & Transform",
      icon: <MousePointer2 className="w-4 h-4 text-purple-500" />,
      items: [
        {
          name: "Select / Deselect Objects",
          code: `// Select single or multiple IDs
sdk.selection.select(["id-1", "id-2"]);
// Or clear selection:
// sdk.selection.deselectAll();`
        },
        {
          name: "Group & Ungroup",
          code: `const selected = sdk.selection.getSelected();
if (selected.length > 1) {
  const group = sdk.selection.group(selected.map(s => s.id), "Facade Bay");
  console.log("Created group:", group.id);
}`
        },
        {
          name: "Duplicate Object with Offset",
          code: `const obj = sdk.getSelectedObject();
if (obj) {
  const copy = sdk.selection.duplicateObject(obj.id, [2.5, 0, 0]);
  console.log("Duplicated object:", copy.id);
}`
        },
        {
          name: "Align Objects Along Axis",
          code: `// Axis: 'x'|'y'|'z', Alignment: 'min'|'center'|'max'
const ids = sdk.selection.getSelected().map(s => s.id);
if (ids.length > 1) {
  sdk.selection.alignObjects(ids, "z", "center");
}`
        },
        {
          name: "Hide, Isolate & Unhide",
          code: `const obj = sdk.getSelectedObject();
if (obj) {
  sdk.selection.isolateObject(obj.id); // Hides all other objects
  // sdk.selection.unhideAll();       // Restores visibility
}`
        },
        {
          name: "Transform Object",
          code: `const obj = sdk.getSelectedObject();
if (obj) {
  sdk.selection.transformObject(obj.id, {
    position: [0, 2, 0],
    rotation: [0, Math.PI / 4, 0],
    scale: [1.2, 1.2, 1.2]
  });
}`
        }
      ]
    },
    {
      title: "Direct Modeling & 3D Primitives",
      icon: <BoxIcon className="w-4 h-4 text-amber-500" />,
      items: [
        {
          name: "Create Box / Cube",
          code: `sdk.createBox({ width: 4, height: 3, depth: 4, position: [0, 1.5, 0] });`
        },
        {
          name: "Create Cylinder / Sphere / Cone",
          code: `sdk.createSphere({ radius: 1.5, position: [3, 1.5, 0] });
sdk.createCone({ radius: 1.2, height: 2.5, position: [-3, 1.25, 0] });`
        },
        {
          name: "Push-Pull Face Extrusion",
          code: `const rect = sdk.createRectangle({ width: 3, height: 3 });
sdk.pushPull(rect, 2.5); // Extrudes 2D shape into 3D volume`
        },
        {
          name: "Divide Surface / Paneling",
          code: `const obj = sdk.getSelectedObject();
if (obj) {
  sdk.divideSurface(obj.id, 0, [4, 4]); // 4x4 panel grid
}`
        },
        {
          name: "Set Edge Bevel & Chamfer",
          code: `const obj = sdk.getSelectedObject();
if (obj) {
  sdk.setBevel(obj, { amount: 0.15, type: "radius", segments: 8 });
}`
        }
      ]
    },
    {
      title: "Boolean Solid Modeling (CSG)",
      icon: <Scissors className="w-4 h-4 text-red-500" />,
      items: [
        {
          name: "CSG Subtraction (Carve Reveal)",
          code: `const wall = sdk.createBox({ width: 4, height: 3, depth: 0.3 });
const cut = sdk.createBox({ width: 1.2, height: 2.1, depth: 0.5 });
setTimeout(() => {
  sdk.performCSG(wall.id, cut.id, "SUBTRACTION");
}, 100);`
        },
        {
          name: "CSG Union & Intersection",
          code: `// Operations: 'UNION', 'SUBTRACTION', 'INTERSECTION'
const partA = sdk.createBox({ width: 2, height: 2, depth: 2 });
const partB = sdk.createSphere({ radius: 1.2, position: [0.5, 0.5, 0.5] });
setTimeout(() => {
  sdk.performCSG(partA.id, partB.id, "UNION");
}, 100);`
        }
      ]
    },
    {
      title: "Camera, Section Clipping & Views",
      icon: <ZoomIn className="w-4 h-4 text-indigo-500" />,
      items: [
        {
          name: "Switch Projection (Perspective vs Ortho)",
          code: `// Mode: 'perspective' | 'orthographic'
sdk.camera.setProjection("orthographic");`
        },
        {
          name: "Set Standard Architectural View",
          code: `// Views: 'plan', 'front', 'rear', 'left', 'right', 'perspective'
sdk.camera.resetView("plan"); // Top-down architectural plan`
        },
        {
          name: "Set Section Depth Clipping",
          code: `// Cut section planes across the building
sdk.camera.setDepthClipping(true, 5.0, 50.0);`
        },
        {
          name: "Start Cinematic Auto-Orbit",
          code: `// Rotates camera smoothly around orbit target
sdk.camera.setAutoOrbit(true, 1.2);`
        },
        {
          name: "Focus on Object",
          code: `const obj = sdk.getSelectedObject();
if (obj) sdk.camera.focusObject(obj.id);`
        }
      ]
    },
    {
      title: "Environment, Sun & Lighting",
      icon: <Sparkles className="w-4 h-4 text-yellow-500" />,
      items: [
        {
          name: "Set Skybox Environment",
          code: `// Presets: 'golden-hour', 'studio', 'cloudy', 'sunset', 'night'
sdk.setSkybox("golden-hour", { intensity: 1.5, blur: 0.1, rotation: 45 });`
        },
        {
          name: "Configure Atmospheric Fog",
          code: `sdk.setFog({ enabled: true, density: 0.02, colors: ["#ffffff", "#94a3b8"] });`
        },
        {
          name: "Add Custom Spot / Point / Rect Light",
          code: `sdk.addLight({
  type: "point",
  color: "#ffedd5",
  intensity: 3,
  position: [0, 4, 0]
});`
        },
        {
          name: "Animate Solar Study",
          code: `// Animate sun position across 30 seconds
sdk.animateSun(30);`
        }
      ]
    },
    {
      title: "AI Architectural Copilot",
      icon: <Sparkles className="w-4 h-4 text-violet-500" />,
      items: [
        {
          name: "Generative Massing Model",
          code: `sdk.ai.generateModel("A minimalist Scandinavian timber lakehouse with cantilevered terrace");`
        },
        {
          name: "Open AI Architectural Renderer",
          code: `sdk.ai.openRenderer("Warm dusk light, photorealistic architectural photography");`
        },
        {
          name: "Ask Architectural Assistant",
          code: `sdk.ai.askAssistant("Suggest structural bay spacing for mass timber construction.");`
        }
      ]
    },
    {
      title: "WorldView & Geolocation",
      icon: <Globe className="w-4 h-4 text-blue-500" />,
      items: [
        {
          name: "Import Real-World Map Overlay",
          code: `sdk.worldView.importMap({
  lat: 51.5074,
  lng: -0.1278,
  zoom: 18,
  altitude: -0.05,
  radius: 500
});`
        },
        {
          name: "Update Coordinates & Radius",
          code: `sdk.worldView.setLocation(40.7128, -74.0060);
sdk.worldView.setRadius(750);`
        }
      ]
    },
    {
      title: "Scene Management, Diagnostics & Export",
      icon: <Terminal className="w-4 h-4 text-teal-500" />,
      items: [
        {
          name: "Export Full Scene JSON",
          code: `const json = sdk.scene.exportJSON();
console.log("Exported JSON string length:", json.length);`
        },
        {
          name: "Query Geometry Statistics",
          code: `const stats = sdk.scene.getStats();
console.log("Stats:", stats);`
        },
        {
          name: "Undo & Redo Action",
          code: `sdk.scene.undo();
// sdk.scene.redo();`
        },
        {
          name: "Record Diagnostic Telemetry",
          code: `sdk.diagLog("SDK", "Script executed successfully", { timestamp: Date.now() });`
        }
      ]
    }
  ];

  return (
    <div className="h-full p-6 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">Full API Documentation</h2>
          <p className="text-sm text-gray-500">Comprehensive reference guide for all DraftUp Developer SDK functions, options, and subsystems.</p>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {categories.map((cat, i) => (
            <section key={i} className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
              <h3 className="text-md font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-3">
                {cat.icon}
                {cat.title}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cat.items.map((item, j) => (
                  <div key={j} className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-800 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-gray-800 dark:text-gray-200">{item.name}</span>
                        <button 
                          onClick={() => {
                            setDeveloperCode(item.code);
                            setActiveDeveloperTab('console');
                          }}
                          className="text-[9px] font-bold text-trimble-blue hover:underline uppercase shrink-0 ml-2"
                        >
                          Try Now
                        </button>
                      </div>
                    </div>
                    <pre className="p-2.5 bg-gray-900 text-gray-300 rounded text-[9.5px] font-mono overflow-x-auto max-h-40 leading-relaxed">
                      {item.code}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Deprecated Notice */}
        <div className="mt-12 opacity-60">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Deprecated Examples
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-gray-200 dark:bg-gray-800/30 rounded-xl border border-gray-300 dark:border-gray-800">
              <span className="text-[10px] font-bold text-gray-500 line-through">Legacy Projector Spin</span>
              <p className="text-[9px] text-gray-400 my-1 italic">Reason: Rotating texture matrix does not affect shadow-mapped projections. Use up-vector roll instead.</p>
              <pre className="p-2 bg-gray-900 text-gray-600 rounded text-[9px] font-mono overflow-x-auto">
                {`texture.rotation += delta * speed;\ntexture.updateMatrix();`}
              </pre>
            </div>
            <div className="p-3 bg-gray-200 dark:bg-gray-800/30 rounded-xl border border-gray-300 dark:border-gray-800">
              <span className="text-[10px] font-bold text-gray-500 line-through">Legacy Browser Prompt</span>
              <p className="text-[9px] text-gray-400 my-1 italic">Reason: Prompt dialogs are blocked in iframe. Use sdk.addNote instead.</p>
              <pre className="p-2 bg-gray-900 text-gray-600 rounded text-[9px] font-mono overflow-x-auto">
                {`const text = prompt("Enter note");\nsdk.addNote(text, [0,0,0]);`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeveloperSettings() {
  const { codeRecorderEnabled, setCodeRecorderEnabled } = useApp();

  return (
    <div className="h-full p-6 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">Developer Settings</h2>
          <p className="text-sm text-gray-500">Configure your development environment and experimental features.</p>
        </div>

        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-trimble-blue/10 rounded-xl flex items-center justify-center text-trimble-blue">
                  <Radio className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">Code Recorder</h3>
                  <p className="text-xs text-gray-500">Record your actions in the 3D space and generate SDK code automatically.</p>
                </div>
              </div>
              <button 
                onClick={() => setCodeRecorderEnabled(!codeRecorderEnabled)}
                className={cn(
                  "w-10 h-5 rounded-full relative transition-colors",
                  codeRecorderEnabled ? "bg-trimble-blue" : "bg-gray-300"
                )}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all",
                  codeRecorderEnabled ? "left-5.5" : "left-0.5"
                )} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
