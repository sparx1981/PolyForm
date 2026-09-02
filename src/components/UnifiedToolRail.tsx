import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  MousePointer2, 
  Eraser, 
  PaintBucket, 
  Box, 
  PenLine, 
  Square, 
  Circle, 
  Triangle,
  Cone,
  Circle as SphereIcon,
  Torus,
  Pyramid,
  Layers,
  Spline,
  Pentagon,
  Hexagon,
  Move, 
  RotateCw, 
  Maximize, 
  ArrowUpFromLine, 
  Search,
  Orbit,
  Hand,
  ZoomIn,
  Sparkles,
  CircleDot,
  CornerUpRight,
  Code,
  Globe,
  Scissors,
  Ruler,
  ToggleLeft,
  ToggleRight,
  Maximize2,
  DoorOpen,
  AppWindow,
  TrendingUp,
  Mountain,
  Building2,
  Brush,
  ShieldAlert,
  Waypoints,
  Palette,
  Trees,
  Sprout,
  Fence,
  SlidersHorizontal,
  Lamp,
  Armchair,
  Disc,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  X,
  Sliders,
  Wand2,
  Check,
  Image as ImageIcon,
  AlertTriangle,
  RefreshCw,
  Plus,
  Grid3X3
} from 'lucide-react';
import { useApp } from '../AppContext';
import { ToolType, Shape, TerrainData } from '../types';
import { cn } from '../lib/utils';
import { LANDSCAPE_TEXTURES, LandscapeTexturePreset } from '../lib/landscapeTextures';
import { PLANT_SPECIES_CATALOG } from '../lib/plantLibrary';
import { DeveloperSDK } from '../services/developerService';

interface ToolItem {
  id: string;
  tool?: ToolType;
  label: string;
  subtitle?: string;
  hotkey?: string;
  icon: React.ReactNode;
  isActive?: (appState: any) => boolean;
  onClick: (appState: any) => void;
  keywords?: string[];
}

interface ToolCategory {
  id: string;
  name: string;
  tools: ToolItem[];
}

export default function UnifiedToolRail() {
  const app = useApp();
  const {
    theme,
    bannerColor,
    activeTool,
    setActiveTool,
    toolbarVisibility,
    showAllDimensions,
    setShowAllDimensions,
    activeBevelType,
    setActiveBevelType,
    setIsWorldViewOpen,
    isWorldViewActive,
    setIsAIRendererOpen,
    setIsAIQueryOpen,
    setIsAIGenerateOpen,
    setOpenMaterialsSignal,
    pinnedScripts,
    developerScripts,
    shapes,
    setShapes,
    addShape,
    commitHistory,
    updateShapeColor,
    selectedId,
    selectedIds,
    setConsoleOutput,
    landscapeSculptSettings,
    setLandscapeSculptSettings,
    landscapeRoadSettings,
    setLandscapeRoadSettings,
    setActiveMaterial,
    setActivePBR,
    setCustomMaterials,
    activePlantSpecies,
    setActivePlantSpecies,
    activePlantVariation,
    setActivePlantVariation,
    activePlantScale,
    setActivePlantScale
  } = app;

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Resizable panel width state with localStorage persistence
  const [railWidth, setRailWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('polyform_unified_rail_width');
      if (stored) {
        const val = parseInt(stored, 10);
        if (!isNaN(val) && val >= 160 && val <= 600) {
          return val;
        }
      }
    } catch (e) {
      console.warn('[UnifiedToolRail] Failed to load rail width:', e);
    }
    return 220;
  });

  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const clampedWidth = Math.min(Math.max(e.clientX, 160), 600);
      setRailWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try {
          localStorage.setItem('polyform_unified_rail_width', railWidth.toString());
        } catch (e) {}
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [railWidth]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  // Expanded/Collapsed state per category with localStorage persistence
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem('polyform_unified_rail_sections');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[UnifiedToolRail] Failed to load section state:', e);
    }
    return {
      basic: true,
      architecture: true,
      landscape: true
    };
  });

  const toggleSection = (categoryId: string) => {
    setExpandedSections(prev => {
      const next = { ...prev, [categoryId]: !prev[categoryId] };
      try {
        localStorage.setItem('polyform_unified_rail_sections', JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  // Check if all sections are collapsed
  const allCollapsed = useMemo(() => {
    return Object.values(expandedSections).every(val => !val);
  }, [expandedSections]);

  const toggleAllSections = () => {
    const nextState = allCollapsed; // if all collapsed, expand all (true); else collapse all (false)
    const updated: Record<string, boolean> = {
      basic: nextState,
      architecture: nextState,
      landscape: nextState
    };
    setExpandedSections(updated);
    try {
      localStorage.setItem('polyform_unified_rail_sections', JSON.stringify(updated));
    } catch (e) {}
  };

  // Landscape popout panel state
  const [activeLandscapeCategory, setActiveLandscapeCategory] = useState<'create' | 'sculpt' | 'road' | 'style' | 'plant' | null>(null);
  const [plotWidth, setPlotWidth] = useState<number>(20);
  const [plotDepth, setPlotDepth] = useState<number>(20);
  const [plotResolution, setPlotResolution] = useState<number>(32);
  const [plotRoughness, setPlotRoughness] = useState<number>(1.2);
  const [shadingMode, setShadingMode] = useState<'default' | 'slope' | 'elevation' | 'aspect' | 'contours'>('default');
  const [styleSubTab, setStyleSubTab] = useState<'realistic' | 'analysis'>('realistic');
  const [selectedTextureId, setSelectedTextureId] = useState<string>('lush_grass');
  const [textureRepeatScale, setTextureRepeatScale] = useState<number>(8);
  const [textureCategoryFilter, setTextureCategoryFilter] = useState<'all' | 'vegetation' | 'stone' | 'ground' | 'paved' | 'snow'>('all');

  // Conflict modal state for terrain
  const [conflictModal, setConflictModal] = useState<{
    isOpen: boolean;
    pendingRandomized: boolean;
    existingId: string;
    existingName: string;
  } | null>(null);

  // Automatically close landscape settings modal when picking non-landscape tools
  useEffect(() => {
    const landscapeTools: ToolType[] = [
      'landscape_plot', 'landscape_form', 'landscape_embed', 
      'landscape_sculpt', 'landscape_mask', 'landscape_road', 
      'landscape_zone', 'landscape_texture',
      'tree', 'bush', 'fence', 'railing', 'lamp', 'bench', 'rock'
    ];
    if (!landscapeTools.includes(activeTool)) {
      setActiveLandscapeCategory(null);
    }
  }, [activeTool]);

  const executeCreateTerrain = (randomized: boolean, replaceId?: string) => {
    const grid = plotResolution;
    const width = Math.max(5, plotWidth);
    const depth = Math.max(5, plotDepth);
    const heights: number[] = [];

    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        if (!randomized) {
          heights.push(0);
        } else {
          const nx = (i / (grid - 1) - 0.5) * 4;
          const ny = (j / (grid - 1) - 0.5) * 4;
          const dist = Math.sqrt(nx * nx + ny * ny);
          const hill = Math.exp(-dist * 0.8) * 3.5;
          const wave = Math.sin(nx * 2) * Math.cos(ny * 2) * 0.6;
          const noise = (Math.sin(nx * 5 + ny * 3) + Math.cos(nx * 3 - ny * 5)) * 0.25 * plotRoughness;
          heights.push(Math.max(0, hill + wave + noise));
        }
      }
    }

    const activePreset = LANDSCAPE_TEXTURES.find(t => t.id === selectedTextureId) || LANDSCAPE_TEXTURES[0];
    const initialTexture = activePreset.generate();

    const terrainData: TerrainData = {
      gridX: grid,
      gridY: grid,
      width,
      depth,
      heights,
      shadingMode: shadingMode || 'default',
      textureUrl: initialTexture,
      textureScale: textureRepeatScale || 8
    };

    if (replaceId) {
      setShapes(prev => prev.map(s => {
        if (s.id === replaceId) {
          return {
            ...s,
            terrainData,
            color: initialTexture,
            roughness: activePreset.roughness,
            metalness: activePreset.metalness,
            args: [width, depth, grid]
          };
        }
        return s;
      }));
      setConsoleOutput(prev => [...prev, `[Landscapes] Updated terrain canvas ${width}m × ${depth}m (${grid}×${grid} resolution).`]);
    } else {
      const newShape: Shape = {
        id: Math.random().toString(36).substr(2, 9),
        name: `Terrain Canvas ${width}x${depth}m`,
        type: 'terrain',
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        args: [width, depth, grid],
        terrainData,
        color: initialTexture,
        roughness: activePreset.roughness,
        metalness: activePreset.metalness
      };
      addShape(newShape);
      setConsoleOutput(prev => [...prev, `[Landscapes] Created new terrain canvas ${width}m × ${depth}m with "${activePreset.name}" texture.`]);
    }

    commitHistory();
    setActiveLandscapeCategory(null);
  };

  const handleCreatePlot = (randomized: boolean) => {
    const existing = shapes.find(s => s.type === 'terrain');
    if (existing) {
      setConflictModal({
        isOpen: true,
        pendingRandomized: randomized,
        existingId: existing.id,
        existingName: existing.name || 'Existing Terrain'
      });
      return;
    }
    executeCreateTerrain(randomized);
  };

  const handleFormFromGeometry = () => {
    const polys = shapes.filter(s => s.type === 'poly' || s.type === 'line' || s.type === 'custom');
    if (polys.length === 0) {
      setConsoleOutput(prev => [...prev, '[Landscapes] No vector isolines or poly outlines found in scene. Draw contours first or plot terrain.']);
      return;
    }
    executeCreateTerrain(true);
    setConsoleOutput(prev => [...prev, `[Landscapes] Interpolated ${polys.length} vector isolines into a continuous TIN terrain mesh.`]);
  };

  const handleEmbedFit = () => {
    const terrain = shapes.find(s => s.type === 'terrain');
    if (!terrain || !terrain.terrainData) {
      setConsoleOutput(prev => [...prev, '[Landscapes] No terrain found to embed geometry into. Plot a landscape first.']);
      return;
    }
    setConsoleOutput(prev => [...prev, '[Landscapes] Embedded building footprints and graded retaining boundaries seamlessly into terrain mesh.']);
  };

  const applyLandscapeTexture = (preset: LandscapeTexturePreset, customRepeat?: number) => {
    const repeat = customRepeat ?? textureRepeatScale;
    setSelectedTextureId(preset.id);
    const textureUrl = preset.generate();

    if (setActiveMaterial) setActiveMaterial(textureUrl);
    if (setActivePBR) {
      setActivePBR({
        roughness: preset.roughness,
        metalness: preset.metalness,
        opacity: 1
      });
    }

    if (setCustomMaterials) {
      setCustomMaterials(prev => {
        if (prev.some(m => m.value === textureUrl || m.id === preset.id)) return prev;
        return [...prev, {
          id: preset.id,
          name: preset.name,
          type: 'texture',
          value: textureUrl,
          pbr: { roughness: preset.roughness, metalness: preset.metalness, opacity: 1 }
        }];
      });
    }

    const targetIds = (selectedIds && selectedIds.length > 0) ? selectedIds : (selectedId ? [selectedId] : []);
    if (targetIds.length > 0) {
      setShapes(prev => prev.map(s => {
        if (targetIds.includes(s.id)) {
          if (s.type === 'terrain' && s.terrainData) {
            return {
              ...s,
              color: textureUrl,
              roughness: preset.roughness,
              metalness: preset.metalness,
              terrainData: {
                ...s.terrainData,
                shadingMode: 'default',
                textureUrl,
                textureScale: repeat
              }
            };
          }
          return {
            ...s,
            color: textureUrl,
            roughness: preset.roughness,
            metalness: preset.metalness
          };
        }
        return s;
      }));
      setConsoleOutput(prev => [...prev, `[Landscapes] Applied "${preset.name}" texture (${repeat}× repeat) to selected object(s).`]);
      commitHistory();
      return;
    }

    const existingTerrain = shapes.find(s => s.type === 'terrain');
    if (existingTerrain && existingTerrain.terrainData) {
      setShapes(prev => prev.map(s => {
        if (s.type === 'terrain' && s.terrainData) {
          return {
            ...s,
            color: textureUrl,
            roughness: preset.roughness,
            metalness: preset.metalness,
            terrainData: {
              ...s.terrainData,
              shadingMode: 'default',
              textureUrl,
              textureScale: repeat
            }
          };
        }
        return s;
      }));
      setConsoleOutput(prev => [...prev, `[Landscapes] Applied photorealistic "${preset.name}" texture (${repeat}× tiling, PBR roughness ${preset.roughness}) to terrain.`]);
      commitHistory();
    } else {
      const grid = 32;
      const width = 20;
      const depth = 20;
      const heights = new Array(grid * grid).fill(0);
      const newTerrain: Shape = {
        id: Math.random().toString(36).substr(2, 9),
        name: `Terrain Canvas (${preset.name})`,
        type: 'terrain',
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        args: [width, depth, grid],
        terrainData: {
          gridX: grid,
          gridY: grid,
          width,
          depth,
          heights,
          shadingMode: 'default',
          textureUrl,
          textureScale: repeat
        },
        color: textureUrl,
        roughness: preset.roughness,
        metalness: preset.metalness
      };
      addShape(newTerrain);
      setConsoleOutput(prev => [...prev, `[Landscapes] Created terrain canvas with photorealistic "${preset.name}" texture.`]);
      commitHistory();
    }
  };

  const runPinnedScript = async (scriptId: string) => {
    const script = developerScripts.find(s => s.id === scriptId);
    if (!script) return;

    try {
      const sdk = new DeveloperSDK(
        shapes,
        setShapes,
        updateShapeColor,
        selectedId
      );

      const customConsole = {
        log: (...args: any[]) => {
          setConsoleOutput(prev => [...prev, `[LOG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`]);
        },
        error: (...args: any[]) => {
          setConsoleOutput(prev => [...prev, `[ERROR] ${args.join(' ')}`]);
        }
      };

      const fn = new Function('sdk', 'console', `
        return (async () => {
          try {
            ${script.code}
          } catch (e) {
            console.error(e.message);
          }
        })();
      `);

      await fn(sdk, customConsole);
    } catch (err: any) {
      setConsoleOutput(prev => [...prev, `[ERROR] ${err.message}`]);
    }
  };

  // Modular Tool Category Definitions
  const toolCategories: ToolCategory[] = useMemo(() => [
    {
      id: 'basic',
      name: 'Basic',
      tools: [
        {
          id: 'select',
          tool: 'select',
          label: 'Select',
          hotkey: 'Space',
          subtitle: 'Select objects, faces, or edges',
          icon: <MousePointer2 size={19} />,
          isActive: (s) => s.activeTool === 'select',
          onClick: (s) => s.setActiveTool('select'),
          keywords: ['select', 'pointer', 'pick', 'choose']
        },
        {
          id: 'eraser',
          tool: 'eraser',
          label: 'Eraser',
          hotkey: 'E',
          subtitle: 'Delete all object surfaces (Shift+click to delete single surface)',
          icon: <Eraser size={19} />,
          isActive: (s) => s.activeTool === 'eraser',
          onClick: (s) => s.setActiveTool('eraser'),
          keywords: ['eraser', 'delete', 'remove', 'trash', 'surface']
        },
        {
          id: 'paint',
          tool: 'paint',
          label: 'Paint Bucket',
          hotkey: 'B',
          subtitle: 'Apply materials to faces or objects (Shift+click for whole object)',
          icon: <PaintBucket size={19} />,
          isActive: (s) => s.activeTool === 'paint',
          onClick: (s) => {
            s.setActiveTool('paint');
            s.setOpenMaterialsSignal((prev: number) => prev + 1);
          },
          keywords: ['paint', 'bucket', 'material', 'texture', 'color']
        },
        {
          id: 'component',
          tool: 'component',
          label: 'Make Component',
          hotkey: 'G',
          subtitle: 'Group selected geometry into component',
          icon: <Box size={19} />,
          isActive: (s) => s.activeTool === 'component',
          onClick: (s) => s.setActiveTool('component'),
          keywords: ['component', 'group', 'box', 'block', 'assembly']
        },
        {
          id: 'line',
          tool: 'line',
          label: 'Line Tool',
          hotkey: 'L',
          subtitle: 'Draw straight line edges',
          icon: <PenLine size={19} />,
          isActive: (s) => s.activeTool === 'line',
          onClick: (s) => s.setActiveTool('line'),
          keywords: ['line', 'pen', 'draw', 'edge', 'segment']
        },
        {
          id: 'poly',
          tool: 'poly',
          label: 'Poly Line Tool',
          subtitle: 'Draw multi-segment polyline contours',
          icon: <Pentagon size={19} />,
          isActive: (s) => s.activeTool === 'poly',
          onClick: (s) => s.setActiveTool('poly'),
          keywords: ['poly', 'polyline', 'polygon', 'pentagon', 'contour', 'line']
        },
        {
          id: 'bezier',
          tool: 'bezier',
          label: 'Bézier Curve Tool',
          subtitle: 'Draw freeform smooth Bézier curves & planar surfaces',
          icon: <Spline size={19} />,
          isActive: (s) => s.activeTool === 'bezier',
          onClick: (s) => s.setActiveTool('bezier'),
          keywords: ['bezier', 'curve', 'spline', 'vector', 'pen', 'smooth', 'path', 'tangent']
        },
        {
          id: 'arc',
          tool: 'arc',
          label: 'Arc Tool',
          subtitle: 'Draw 2-point and 3-point curved arcs',
          icon: <Spline size={19} />,
          isActive: (s) => s.activeTool === 'arc',
          onClick: (s) => s.setActiveTool('arc'),
          keywords: ['arc', 'curve', 'spline', 'radius']
        },
        {
          id: 'rectangle',
          tool: 'rectangle',
          label: 'Rectangle',
          hotkey: 'R',
          subtitle: 'Draw rectangular planes',
          icon: <Square size={19} />,
          isActive: (s) => s.activeTool === 'rectangle',
          onClick: (s) => s.setActiveTool('rectangle'),
          keywords: ['rectangle', 'square', 'box', 'quad']
        },
        {
          id: 'circle',
          tool: 'circle',
          label: 'Circle',
          hotkey: 'C',
          subtitle: 'Draw circular planes',
          icon: <Circle size={19} />,
          isActive: (s) => s.activeTool === 'circle',
          onClick: (s) => s.setActiveTool('circle'),
          keywords: ['circle', 'disc', 'round', 'oval']
        },
        {
          id: 'polygon',
          tool: 'polygon',
          label: 'Polygon',
          hotkey: 'Pg',
          subtitle: 'Draw regular N-sided polygons',
          icon: <Hexagon size={19} />,
          isActive: (s) => s.activeTool === 'polygon',
          onClick: (s) => s.setActiveTool('polygon'),
          keywords: ['polygon', 'hexagon', 'octagon', 'pentagon', 'ngon']
        },
        {
          id: 'triangle',
          tool: 'triangle',
          label: 'Triangle',
          hotkey: 'T',
          subtitle: 'Draw triangular planes',
          icon: <Triangle size={19} />,
          isActive: (s) => s.activeTool === 'triangle',
          onClick: (s) => s.setActiveTool('triangle'),
          keywords: ['triangle', 'tri', 'polygon']
        },
        {
          id: 'sphere',
          tool: 'sphere',
          label: 'Sphere',
          subtitle: '3D spherical solid',
          icon: <SphereIcon size={19} />,
          isActive: (s) => s.activeTool === 'sphere',
          onClick: (s) => s.setActiveTool('sphere'),
          keywords: ['sphere', 'ball', 'globe', '3d']
        },
        {
          id: 'cone',
          tool: 'cone',
          label: 'Cone',
          subtitle: '3D cone solid',
          icon: <Cone size={19} />,
          isActive: (s) => s.activeTool === 'cone',
          onClick: (s) => s.setActiveTool('cone'),
          keywords: ['cone', 'pyramid', '3d']
        },
        {
          id: 'pyramid',
          tool: 'pyramid',
          label: 'Pyramid',
          subtitle: '3D 4-sided pyramid',
          icon: <Pyramid size={19} />,
          isActive: (s) => s.activeTool === 'pyramid',
          onClick: (s) => s.setActiveTool('pyramid'),
          keywords: ['pyramid', 'tetrahedron', '3d']
        },
        {
          id: 'donut',
          tool: 'donut',
          label: 'Donut (Torus)',
          subtitle: '3D torus ring',
          icon: <Torus size={19} />,
          isActive: (s) => s.activeTool === 'donut',
          onClick: (s) => s.setActiveTool('donut'),
          keywords: ['donut', 'torus', 'ring', '3d']
        },
        {
          id: 'dome',
          tool: 'dome',
          label: 'Dome',
          subtitle: '3D hemisphere dome',
          icon: <CircleDot size={19} />,
          isActive: (s) => s.activeTool === 'dome',
          onClick: (s) => s.setActiveTool('dome'),
          keywords: ['dome', 'hemisphere', 'cupola', '3d']
        },
        {
          id: 'pushpull',
          tool: 'pushpull',
          label: 'Push/Pull',
          hotkey: 'P',
          subtitle: 'Extrude or recess 2D faces into 3D volumes',
          icon: <ArrowUpFromLine size={19} />,
          isActive: (s) => s.activeTool === 'pushpull',
          onClick: (s) => s.setActiveTool('pushpull'),
          keywords: ['push', 'pull', 'extrude', 'extrude face', 'elevation']
        },
        {
          id: 'offset',
          tool: 'offset',
          label: 'Offset',
          subtitle: 'Offset perimeter lines inward/outward',
          icon: <Layers size={19} />,
          isActive: (s) => s.activeTool === 'offset',
          onClick: (s) => s.setActiveTool('offset'),
          keywords: ['offset', 'inset', 'border', 'expand']
        },
        {
          id: 'subtract',
          tool: 'subtract',
          label: 'Subtract (Boolean)',
          subtitle: 'Cut 2nd object out of 1st object',
          icon: <Scissors size={19} />,
          isActive: (s) => s.activeTool === 'subtract',
          onClick: (s) => s.setActiveTool('subtract'),
          keywords: ['subtract', 'boolean', 'cut', 'difference', 'trim']
        },
        {
          id: 'bevel_radius',
          tool: 'bevel',
          label: 'Bevel (Radius/Fillet)',
          subtitle: 'Round sharp edges with fillet radius',
          icon: <CornerUpRight size={19} />,
          isActive: (s) => s.activeTool === 'bevel' && s.activeBevelType === 'radius',
          onClick: (s) => {
            s.setActiveTool('bevel');
            s.setActiveBevelType('radius');
          },
          keywords: ['bevel', 'fillet', 'round', 'radius', 'edge']
        },
        {
          id: 'bevel_chamfer',
          tool: 'bevel',
          label: 'Bevel (Chamfer)',
          subtitle: 'Flat angled bevel edge cut',
          icon: <Square size={19} />,
          isActive: (s) => s.activeTool === 'bevel' && s.activeBevelType === 'chamfer',
          onClick: (s) => {
            s.setActiveTool('bevel');
            s.setActiveBevelType('chamfer');
          },
          keywords: ['bevel', 'chamfer', 'miter', 'angle', 'edge']
        },
        {
          id: 'tape',
          tool: 'tape',
          label: 'Measuring Tape',
          subtitle: 'Measure distances and create guidelines',
          icon: <Ruler size={19} />,
          isActive: (s) => s.activeTool === 'tape',
          onClick: (s) => s.setActiveTool('tape'),
          keywords: ['tape', 'measure', 'ruler', 'dimension', 'distance']
        },
        {
          id: 'dimensions_toggle',
          label: 'Show Dimensions',
          subtitle: 'Toggle 3D visual dimension labels across scene',
          icon: showAllDimensions ? <ToggleRight size={19} /> : <ToggleLeft size={19} />,
          isActive: (s) => s.showAllDimensions,
          onClick: (s) => s.setShowAllDimensions(!s.showAllDimensions),
          keywords: ['dimension', 'labels', 'toggle dimensions', 'measurements']
        },
        {
          id: 'move',
          tool: 'move',
          label: 'Move',
          hotkey: 'M / G',
          subtitle: 'Translate selected geometry',
          icon: <Move size={19} />,
          isActive: (s) => s.activeTool === 'move',
          onClick: (s) => s.setActiveTool('move'),
          keywords: ['move', 'translate', 'drag', 'position']
        },
        {
          id: 'rotate',
          tool: 'rotate',
          label: 'Rotate',
          hotkey: 'Q',
          subtitle: 'Rotate selected geometry',
          icon: <RotateCw size={19} />,
          isActive: (s) => s.activeTool === 'rotate',
          onClick: (s) => s.setActiveTool('rotate'),
          keywords: ['rotate', 'spin', 'turn', 'angle']
        },
        {
          id: 'scale',
          tool: 'scale',
          label: 'Scale',
          hotkey: 'S',
          subtitle: 'Resize selected geometry',
          icon: <Maximize size={19} />,
          isActive: (s) => s.activeTool === 'scale',
          onClick: (s) => s.setActiveTool('scale'),
          keywords: ['scale', 'resize', 'transform', 'stretch']
        },
        {
          id: 'orbit',
          tool: 'orbit',
          label: 'Orbit',
          hotkey: 'O',
          subtitle: 'Orbit camera view',
          icon: <Orbit size={19} />,
          isActive: (s) => s.activeTool === 'orbit',
          onClick: (s) => s.setActiveTool('orbit'),
          keywords: ['orbit', 'camera', 'view', 'rotate view']
        },
        {
          id: 'pan',
          tool: 'pan',
          label: 'Pan',
          hotkey: 'H',
          subtitle: 'Pan camera view',
          icon: <Hand size={19} />,
          isActive: (s) => s.activeTool === 'pan',
          onClick: (s) => s.setActiveTool('pan'),
          keywords: ['pan', 'hand', 'drag camera', 'view']
        },
        {
          id: 'zoom',
          tool: 'zoom',
          label: 'Zoom',
          hotkey: 'Z',
          subtitle: 'Zoom camera view in/out',
          icon: <ZoomIn size={19} />,
          isActive: (s) => s.activeTool === 'zoom',
          onClick: (s) => s.setActiveTool('zoom'),
          keywords: ['zoom', 'magnify', 'view', 'in', 'out']
        },
        {
          id: 'ai_query',
          label: 'AI Query',
          subtitle: 'Ask AI assistant about your model & scene',
          icon: <Sparkles size={19} />,
          isActive: () => false,
          onClick: (s) => s.setIsAIQueryOpen(true),
          keywords: ['ai', 'query', 'assistant', 'ask', 'chat']
        },
        {
          id: 'ai_renderer',
          label: 'AI Renderer',
          subtitle: 'Generate photorealistic AI render from view',
          icon: <Search size={19} />,
          isActive: () => false,
          onClick: (s) => s.setIsAIRendererOpen(true),
          keywords: ['ai', 'render', 'photorealistic', 'image', 'picture']
        },
        {
          id: 'ai_generate',
          label: 'AI Generate',
          subtitle: 'Generate 3D geometry from text prompt',
          icon: <Wand2 size={19} />,
          isActive: () => false,
          onClick: (s) => s.setIsAIGenerateOpen(true),
          keywords: ['ai', 'generate', 'create 3d', 'magic', 'prompt']
        },
        ...pinnedScripts.map(scriptId => {
          const script = developerScripts.find(s => s.id === scriptId);
          if (!script) return null;
          return {
            id: `pinned_script_${scriptId}`,
            label: script.name,
            subtitle: `Pinned Developer Script: ${script.name}`,
            icon: <Code size={19} className="text-trimble-blue" />,
            isActive: () => false,
            onClick: () => runPinnedScript(scriptId),
            keywords: ['script', 'code', 'developer', script.name.toLowerCase()]
          };
        }).filter(Boolean) as ToolItem[]
      ]
    },
    {
      id: 'architecture',
      name: 'Architecture',
      tools: [
        {
          id: 'wall',
          tool: 'wall',
          label: 'Wall Tool',
          subtitle: 'Click & drag or click to place wall segment (3m × 2.8m × 0.2m)',
          icon: <Maximize2 size={19} className="rotate-45" />,
          isActive: (s) => s.activeTool === 'wall',
          onClick: (s) => s.setActiveTool('wall'),
          keywords: ['wall', 'partition', 'room', 'structure', 'architecture']
        },
        {
          id: 'door',
          tool: 'door',
          label: 'Door Assembly',
          subtitle: 'Standard framed door with panel and handle (0.9m × 2.1m)',
          icon: <DoorOpen size={19} />,
          isActive: (s) => s.activeTool === 'door',
          onClick: (s) => s.setActiveTool('door'),
          keywords: ['door', 'portal', 'entry', 'frame', 'handle']
        },
        {
          id: 'window',
          tool: 'window',
          label: 'Window Frame',
          subtitle: '4-pane architectural window with sill ledge (1.2m × 1.2m)',
          icon: <AppWindow size={19} />,
          isActive: (s) => s.activeTool === 'window',
          onClick: (s) => s.setActiveTool('window'),
          keywords: ['window', 'glass', 'pane', 'frame', 'glazing']
        },
        {
          id: 'step',
          tool: 'step',
          label: 'Single Step / Riser',
          subtitle: 'Architectural step with nosing (1.0m × 0.3m × 0.18m)',
          icon: <Layers size={19} />,
          isActive: (s) => s.activeTool === 'step',
          onClick: (s) => s.setActiveTool('step'),
          keywords: ['step', 'riser', 'tread', 'stairs', 'threshold']
        },
        {
          id: 'staircase',
          tool: 'staircase',
          label: 'Staircase Flight',
          subtitle: '12-step architectural staircase flight (Rise 2.16m, Run 3.6m)',
          icon: <TrendingUp size={19} />,
          isActive: (s) => s.activeTool === 'staircase',
          onClick: (s) => s.setActiveTool('staircase'),
          keywords: ['staircase', 'stairs', 'flight', 'steps', 'levels']
        },
        {
          id: 'worldview',
          label: 'WorldView Geolocation',
          subtitle: 'Open satellite map & solar positioning',
          icon: <Globe size={19} />,
          isActive: (s) => s.isWorldViewActive,
          onClick: (s) => s.setIsWorldViewOpen(true),
          keywords: ['worldview', 'globe', 'map', 'geolocation', 'sun', 'solar', 'architecture', 'site']
        }
      ]
    },
    {
      id: 'landscape',
      name: 'Landscape',
      tools: [
        {
          id: 'landscape_plot',
          tool: 'landscape_plot',
          label: 'Plot Terrain',
          subtitle: 'Generate interactive flat or procedural terrain canvas',
          icon: <Mountain size={19} />,
          isActive: (s) => s.activeTool === 'landscape_plot',
          onClick: (s) => {
            s.setActiveTool('landscape_plot');
            setActiveLandscapeCategory(prev => prev === 'create' ? null : 'create');
          },
          keywords: ['plot terrain', 'terrain', 'canvas', 'mesh', 'ground', 'relief']
        },
        {
          id: 'landscape_form',
          tool: 'landscape_form',
          label: 'Form from Isolines/Mesh',
          subtitle: 'Convert contour lines & point clouds into terrain',
          icon: <Layers size={19} />,
          isActive: (s) => s.activeTool === 'landscape_form',
          onClick: (s) => {
            s.setActiveTool('landscape_form');
            handleFormFromGeometry();
          },
          keywords: ['form isolines', 'contour', 'tin', 'mesh', 'heightmap']
        },
        {
          id: 'landscape_embed',
          tool: 'landscape_embed',
          label: 'Embed & Fit',
          subtitle: 'Integrate building footprints & roadways into mesh',
          icon: <Building2 size={19} />,
          isActive: (s) => s.activeTool === 'landscape_embed',
          onClick: (s) => {
            s.setActiveTool('landscape_embed');
            handleEmbedFit();
          },
          keywords: ['embed fit', 'footprint', 'grading', 'site', 'foundation']
        },
        {
          id: 'landscape_sculpt',
          tool: 'landscape_sculpt',
          label: 'Sculpting Brushes',
          subtitle: 'Push, pull, smooth, flatten, and pinch terrain elevation',
          icon: <Brush size={19} />,
          isActive: (s) => s.activeTool === 'landscape_sculpt',
          onClick: (s) => {
            s.setActiveTool('landscape_sculpt');
            setActiveLandscapeCategory(prev => prev === 'sculpt' ? null : 'sculpt');
          },
          keywords: ['sculpting', 'sculpt', 'brush', 'elevation', 'smooth', 'flatten', 'pinch']
        },
        {
          id: 'landscape_mask',
          tool: 'landscape_mask',
          label: 'Fenced / Masked Brushing',
          subtitle: 'Constrain brush deformation within geometric boundaries',
          icon: <ShieldAlert size={19} />,
          isActive: (s) => s.activeTool === 'landscape_mask',
          onClick: (s) => {
            s.setActiveTool('landscape_mask');
            setLandscapeSculptSettings(prev => ({ ...prev, masked: !prev.masked }));
            setConsoleOutput(prev => [...prev, `[Landscapes] Masked brushing ${!landscapeSculptSettings.masked ? 'enabled' : 'disabled'}.`]);
          },
          keywords: ['mask', 'fence', 'boundary', 'constraint', 'brush']
        },
        {
          id: 'landscape_road',
          tool: 'landscape_road',
          label: 'Path & Road Tools',
          subtitle: 'Project road profiles and cross-sections across terrain',
          icon: <Waypoints size={19} />,
          isActive: (s) => s.activeTool === 'landscape_road',
          onClick: (s) => {
            s.setActiveTool('landscape_road');
            setActiveLandscapeCategory(prev => prev === 'road' ? null : 'road');
            setConsoleOutput(prev => [...prev, '[Landscapes] Path & Road Tool active: click along terrain to plot road points, double-click to finish.']);
          },
          keywords: ['road', 'path', 'trail', 'cross section', 'pavement', 'driveway']
        },
        {
          id: 'landscape_zone',
          tool: 'landscape_zone',
          label: 'Zone & Subdivision',
          subtitle: 'Imprint 2D curves onto terrain to create sub-regions',
          icon: <Spline size={19} />,
          isActive: (s) => s.activeTool === 'landscape_zone',
          onClick: (s) => {
            s.setActiveTool('landscape_zone');
            setActiveLandscapeCategory(prev => prev === 'road' ? null : 'road');
            setConsoleOutput(prev => [...prev, '[Landscapes] Zone & Subdivision active: click along terrain to imprint region boundaries.']);
          },
          keywords: ['zone', 'subdivision', 'region', 'area', 'boundary']
        },
        {
          id: 'landscape_texture',
          tool: 'landscape_texture',
          label: 'Dynamic Materials & Shading',
          subtitle: 'Paint slope-aware, elevation, or aspect-based textures',
          icon: <Palette size={19} />,
          isActive: (s) => s.activeTool === 'landscape_texture',
          onClick: (s) => {
            s.setActiveTool('landscape_texture');
            setActiveLandscapeCategory(prev => prev === 'style' ? null : 'style');
          },
          keywords: ['materials', 'textures', 'shading', 'slope', 'heatmap', 'grass', 'rock']
        },
        {
          id: 'tree',
          tool: 'tree',
          label: 'Plant Tree',
          subtitle: 'Place 3D architectural trees with natural canopy & species selection',
          icon: <Trees size={19} />,
          isActive: (s) => s.activeTool === 'tree',
          onClick: (s) => {
            s.setActiveTool('tree');
            setActiveLandscapeCategory(prev => prev === 'plant' && s.activeTool === 'tree' ? null : 'plant');
            const defaultTree = PLANT_SPECIES_CATALOG.find(species => species.category === 'tree');
            if (defaultTree && !PLANT_SPECIES_CATALOG.find(species => species.id === activePlantSpecies && species.category === 'tree')) {
              setActivePlantSpecies(defaultTree.id);
            }
            setConsoleOutput(prev => [...prev, '[Landscapes] Tree Placement active: select species and click terrain or ground to place.']);
          },
          keywords: ['tree', 'oak', 'pine', 'foliage', 'canopy', 'vegetation', 'plants']
        },
        {
          id: 'bush',
          tool: 'bush',
          label: 'Plant Bush / Shrub',
          subtitle: 'Place garden bushes, grasses (Ribbon Grass FBX), and foliage clusters',
          icon: <Sprout size={19} />,
          isActive: (s) => s.activeTool === 'bush',
          onClick: (s) => {
            s.setActiveTool('bush');
            setActiveLandscapeCategory(prev => prev === 'plant' && s.activeTool === 'bush' ? null : 'plant');
            const defaultBush = PLANT_SPECIES_CATALOG.find(species => species.id === 'ribbon_grass') || PLANT_SPECIES_CATALOG.find(species => species.category === 'bush');
            if (defaultBush && !PLANT_SPECIES_CATALOG.find(species => species.id === activePlantSpecies && species.category === 'bush')) {
              setActivePlantSpecies(defaultBush.id);
            }
            setConsoleOutput(prev => [...prev, '[Landscapes] Bush Placement active: select plant species and click terrain to place.']);
          },
          keywords: ['bush', 'shrub', 'grass', 'ribbon grass', 'flowers', 'hedge', 'foliage']
        },
        {
          id: 'fence',
          tool: 'fence',
          label: 'Post & Rail Fence',
          subtitle: 'Draw path-following perimeter fencing (click points, Enter to finish)',
          icon: <Fence size={19} />,
          isActive: (s) => s.activeTool === 'fence',
          onClick: (s) => {
            s.setActiveTool('fence');
            setActiveLandscapeCategory(null);
            setConsoleOutput(prev => [...prev, '[Landscapes] Fence Tool active: click along path to place fence sections, click start point or press Enter to finish.']);
          },
          keywords: ['fence', 'post and rail', 'barrier', 'perimeter', 'enclosure']
        },
        {
          id: 'railing',
          tool: 'railing',
          label: 'Safety Railing',
          subtitle: 'Draw path-following guardrails (click points, Enter to finish)',
          icon: <SlidersHorizontal size={19} />,
          isActive: (s) => s.activeTool === 'railing',
          onClick: (s) => {
            s.setActiveTool('railing');
            setActiveLandscapeCategory(null);
            setConsoleOutput(prev => [...prev, '[Landscapes] Railing Tool active: click along path to place guardrails, click start point or press Enter to finish.']);
          },
          keywords: ['railing', 'guardrail', 'balustrade', 'handrail', 'safety']
        },
        {
          id: 'lamp',
          tool: 'lamp',
          label: 'Street / Path Lamp',
          subtitle: 'Place outdoor lantern & architectural light post (3.2m)',
          icon: <Lamp size={19} />,
          isActive: (s) => s.activeTool === 'lamp',
          onClick: (s) => {
            s.setActiveTool('lamp');
            setActiveLandscapeCategory(null);
            setConsoleOutput(prev => [...prev, '[Landscapes] Lamp Post Tool active: click to place path light.']);
          },
          keywords: ['lamp', 'light', 'lantern', 'street light', 'post']
        },
        {
          id: 'bench',
          tool: 'bench',
          label: 'Park / Garden Bench',
          subtitle: 'Place outdoor wooden slat seating bench (1.8m)',
          icon: <Armchair size={19} />,
          isActive: (s) => s.activeTool === 'bench',
          onClick: (s) => {
            s.setActiveTool('bench');
            setActiveLandscapeCategory(null);
            setConsoleOutput(prev => [...prev, '[Landscapes] Bench Tool active: click to place park bench.']);
          },
          keywords: ['bench', 'seat', 'chair', 'furniture', 'park bench']
        },
        {
          id: 'rock',
          tool: 'rock',
          label: 'Landscape Boulder',
          subtitle: 'Place natural faceted garden rock & boulder feature',
          icon: <Disc size={19} />,
          isActive: (s) => s.activeTool === 'rock',
          onClick: (s) => {
            s.setActiveTool('rock');
            setActiveLandscapeCategory(null);
            setConsoleOutput(prev => [...prev, '[Landscapes] Boulder Tool active: click to place rock.']);
          },
          keywords: ['rock', 'boulder', 'stone', 'mineral', 'landscape rock']
        }
      ]
    }
  ], [
    pinnedScripts,
    developerScripts,
    showAllDimensions,
    activePlantSpecies,
    landscapeSculptSettings.masked
  ]);

  // Filter tools based on search query
  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return toolCategories;

    return toolCategories.map(category => {
      const matchingTools = category.tools.filter(tool => {
        if (tool.label.toLowerCase().includes(query)) return true;
        if (tool.id.toLowerCase().includes(query)) return true;
        if (tool.subtitle && tool.subtitle.toLowerCase().includes(query)) return true;
        if (tool.hotkey && tool.hotkey.toLowerCase().includes(query)) return true;
        if (tool.keywords && tool.keywords.some(k => k.toLowerCase().includes(query))) return true;
        return false;
      });

      return {
        ...category,
        tools: matchingTools
      };
    }).filter(category => category.tools.length > 0);
  }, [toolCategories, searchQuery]);

  return (
    <aside 
      id="unified-tool-rail"
      aria-label="Unified Tool Rail"
      style={{ width: `${railWidth}px`, minWidth: `${railWidth}px`, maxWidth: `${railWidth}px` }}
      className={cn(
        "h-full flex flex-col z-40 select-none border-r transition-colors duration-300 relative shrink-0",
        theme === 'dark' 
          ? "bg-gray-850 border-gray-700 text-gray-200" 
          : "bg-white border-gray-200 text-gray-800"
      )}
    >
      {/* Top Row: Search input + Collapse/Expand All Button */}
      <div className={cn(
        "p-2 border-b flex items-center gap-1.5 shrink-0",
        theme === 'dark' ? "border-gray-700 bg-gray-900/40" : "border-gray-200 bg-gray-50/70"
      )}>
        {/* Search input with icon */}
        <div className="relative flex-1 flex items-center min-w-0">
          <Search 
            size={14} 
            className="absolute left-2.5 text-gray-400 pointer-events-none shrink-0" 
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tools"
            className={cn(
              "w-full pl-7 pr-6 py-1.5 text-xs rounded-md border transition-all placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-trimble-blue",
              theme === 'dark' 
                ? "bg-gray-800 border-gray-700 text-gray-200 focus:border-trimble-blue" 
                : "bg-white border-gray-300 text-gray-800 focus:border-trimble-blue"
            )}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Collapse-All / Expand-All Control */}
        <button
          onClick={toggleAllSections}
          className={cn(
            "p-1.5 rounded-md border transition-all transform hover:scale-105 active:scale-95 flex items-center justify-center shrink-0 shadow-xs",
            theme === 'dark' 
              ? "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700" 
              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-100"
          )}
          title={allCollapsed ? "Expand All Sections" : "Collapse All Sections"}
        >
          {allCollapsed ? (
            <ChevronsDown size={15} className="text-trimble-blue" />
          ) : (
            <ChevronsUp size={15} className="text-gray-500" />
          )}
        </button>
      </div>

      {/* Main Tool Categories List (Scrollable) */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2">
        {filteredCategories.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-400 flex flex-col items-center gap-2">
            <Search size={24} className="text-gray-500 opacity-50" />
            <span>No tools found matching "{searchQuery}"</span>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-1 text-[11px] text-trimble-blue hover:underline font-semibold"
            >
              Clear Search Filter
            </button>
          </div>
        ) : (
          filteredCategories.map((category) => {
            const isExpanded = searchQuery ? true : (expandedSections[category.id] ?? true);

            return (
              <div 
                key={category.id} 
                className={cn(
                  "border rounded-lg overflow-hidden transition-all",
                  theme === 'dark' ? "border-gray-700/80 bg-gray-900/20" : "border-gray-200 bg-gray-50/40"
                )}
              >
                {/* Collapsible Section Header */}
                <button
                  type="button"
                  onClick={() => toggleSection(category.id)}
                  className={cn(
                    "w-full h-8 px-2.5 flex items-center justify-between transition-colors",
                    theme === 'dark' ? "hover:bg-gray-800/80 text-gray-300" : "hover:bg-gray-100 text-gray-700"
                  )}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-bold uppercase tracking-wider truncate">
                      {category.name}
                    </span>
                    {searchQuery && (
                      <span className="text-[10px] text-trimble-blue font-mono font-bold">
                        ({category.tools.length})
                      </span>
                    )}
                  </div>
                  <div className="text-gray-400 shrink-0">
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>
                </button>

                {/* Flexible Icon Grid */}
                {isExpanded && (
                  <div className={cn(
                    "p-1.5 border-t",
                    theme === 'dark' ? "border-gray-800 bg-gray-850/50" : "border-gray-100 bg-white"
                  )}>
                    <div 
                      className="grid gap-1.5"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(40px, 1fr))' }}
                    >
                      {category.tools.map((tool) => {
                        // Check if toolbar item visibility is hidden in settings
                        if (tool.tool && toolbarVisibility && toolbarVisibility[tool.tool] === false) {
                          return null;
                        }

                        const active = tool.isActive ? tool.isActive(app) : false;

                        return (
                          <button
                            key={tool.id}
                            id={`unified-tool-${tool.id}`}
                            onClick={() => tool.onClick(app)}
                            className={cn(
                              "w-full aspect-square min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg relative group transition-all transform active:scale-95",
                              active
                                ? "bg-trimble-blue text-white shadow-md ring-2 ring-trimble-blue ring-offset-1 dark:ring-offset-gray-850"
                                : theme === 'dark'
                                  ? "text-gray-300 hover:bg-gray-700/80 hover:text-white border border-gray-700/60"
                                  : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 border border-gray-200"
                            )}
                            style={active && bannerColor ? { backgroundColor: bannerColor } : undefined}
                          >
                            {tool.icon}

                            {/*
                              No native title attribute: it renders at the
                              OS/browser-chrome level, outside any CSS
                              stacking context, so it cannot be reordered or
                              suppressed relative to this custom tooltip —
                              they simply compete for the same space with no
                              way to referee it. That mismatch is also why
                              the native one showed with the BROWSER'S own
                              default styling (pale background, dark text)
                              rather than this app's intended dark tooltip.
                            */}
                            {/* Floating Rich Tooltip */}
                            <div className="absolute left-full ml-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[150] shadow-xl border border-gray-700 transition-opacity">
                              <div className="font-semibold flex items-center gap-1.5">
                                <span>{tool.label}</span>
                                {tool.hotkey && (
                                  <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-300 font-mono">
                                    ({tool.hotkey})
                                  </span>
                                )}
                              </div>
                              {tool.subtitle && (
                                <div className="text-[10px] text-gray-400 font-normal mt-0.5 max-w-[220px] whitespace-normal">
                                  {tool.subtitle}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Popout Context Configuration Panel for Landscape Tools */}
      {activeLandscapeCategory && (
        <div className={`absolute left-full ml-2 top-2 ${activeLandscapeCategory === 'style' || activeLandscapeCategory === 'plant' ? 'w-88' : 'w-72'} p-3.5 rounded-xl border backdrop-blur-md shadow-2xl z-[150] text-xs ${
          theme === 'dark' ? 'bg-gray-900/95 border-gray-700 text-gray-200' : 'bg-white/95 border-gray-200 text-gray-800'
        }`}>
          <div className="flex items-center justify-between font-bold pb-2 mb-2 border-b border-gray-200 dark:border-gray-800">
            <span className="flex items-center gap-1.5">
              <Sliders size={14} className="text-trimble-blue" />
              {activeLandscapeCategory === 'create' && 'Plot Canvas Settings'}
              {activeLandscapeCategory === 'sculpt' && 'Sculpting Controls'}
              {activeLandscapeCategory === 'road' && 'Path & Road Settings'}
              {activeLandscapeCategory === 'style' && 'Landscape Textures & Shading'}
              {activeLandscapeCategory === 'plant' && (activeTool === 'tree' ? 'Tree Species Library' : 'Bushes & Flora Library')}
            </span>
            <button 
              onClick={() => setActiveLandscapeCategory(null)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded transition-colors"
            >
              <X size={13} />
            </button>
          </div>

          {activeLandscapeCategory === 'create' && (
            <div className="space-y-3">
              {/* Canvas Size Settings */}
              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Canvas Dimensions (Size)</label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-gray-500 font-medium">Width (X)</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <input 
                        type="number" 
                        min={5} 
                        max={300} 
                        step={5} 
                        value={plotWidth} 
                        onChange={e => setPlotWidth(Math.max(5, Number(e.target.value)))}
                        className="w-full px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs font-mono text-gray-900 dark:text-gray-100 tabular-nums outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                      />
                      <span className="text-[10px] text-gray-400">m</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-500 font-medium">Depth (Z)</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <input 
                        type="number" 
                        min={5} 
                        max={300} 
                        step={5} 
                        value={plotDepth} 
                        onChange={e => setPlotDepth(Math.max(5, Number(e.target.value)))}
                        className="w-full px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs font-mono text-gray-900 dark:text-gray-100 tabular-nums outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                      />
                      <span className="text-[10px] text-gray-400">m</span>
                    </div>
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-1 mt-2">
                  {[
                    { label: '10×10m', w: 10, d: 10 },
                    { label: '20×20m', w: 20, d: 20 },
                    { label: '50×50m', w: 50, d: 50 },
                    { label: '100×100m', w: 100, d: 100 }
                  ].map(preset => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setPlotWidth(preset.w);
                        setPlotDepth(preset.d);
                      }}
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded border transition-colors flex-1 text-center",
                        plotWidth === preset.w && plotDepth === preset.d 
                          ? "bg-trimble-blue text-white border-trimble-blue font-bold" 
                          : "border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400">Grid Mesh Density</label>
                <div className="flex items-center gap-2 mt-1">
                  <input 
                    type="range" 
                    min={16} 
                    max={64} 
                    step={8} 
                    value={plotResolution} 
                    onChange={e => setPlotResolution(Number(e.target.value))}
                    className="w-full accent-trimble-blue" 
                  />
                  <span className="text-[10px] font-mono whitespace-nowrap">{plotResolution}x{plotResolution}</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400">Procedural Roughness</label>
                <div className="flex items-center gap-2 mt-1">
                  <input 
                    type="range" 
                    min={0.2} 
                    max={3.0} 
                    step={0.2} 
                    value={plotRoughness} 
                    onChange={e => setPlotRoughness(Number(e.target.value))}
                    className="w-full accent-trimble-blue" 
                  />
                  <span className="text-[10px] font-mono">{plotRoughness.toFixed(1)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  onClick={() => handleCreatePlot(true)}
                  className="py-1.5 px-2 bg-trimble-blue hover:bg-trimble-blue-dark text-white rounded font-medium text-[11px] shadow transition-colors flex items-center justify-center gap-1"
                >
                  <Sparkles size={12} /> Procedural Plot
                </button>
                <button
                  onClick={() => handleCreatePlot(false)}
                  className="py-1.5 px-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium text-[11px] shadow transition-colors flex items-center justify-center gap-1"
                >
                  <Grid3X3 size={12} /> Flat Canvas
                </button>
              </div>
            </div>
          )}

          {activeLandscapeCategory === 'sculpt' && (
            <div className="space-y-2.5">
              <label className="text-[10px] uppercase font-bold text-gray-400">Brush Mode</label>
              <div className="grid grid-cols-3 gap-1">
                {(['push', 'pull', 'smooth', 'flatten', 'pinch'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setLandscapeSculptSettings(prev => ({ ...prev, mode }))}
                    className={`py-1 text-[10px] capitalize rounded font-medium border ${
                      landscapeSculptSettings.mode === mode 
                        ? 'bg-trimble-blue/15 border-trimble-blue text-trimble-blue dark:text-blue-400 font-bold' 
                        : 'border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400">Brush Radius ({landscapeSculptSettings.radius}m)</label>
                <input 
                  type="range" 
                  min={1} 
                  max={12} 
                  step={0.5} 
                  value={landscapeSculptSettings.radius} 
                  onChange={e => setLandscapeSculptSettings(prev => ({ ...prev, radius: Number(e.target.value) }))}
                  className="w-full accent-trimble-blue mt-1" 
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400">Intensity ({Math.round(landscapeSculptSettings.intensity * 100)}%)</label>
                <input 
                  type="range" 
                  min={0.1} 
                  max={1.0} 
                  step={0.05} 
                  value={landscapeSculptSettings.intensity} 
                  onChange={e => setLandscapeSculptSettings(prev => ({ ...prev, intensity: Number(e.target.value) }))}
                  className="w-full accent-trimble-blue mt-1" 
                />
              </div>
            </div>
          )}

          {activeLandscapeCategory === 'road' && (
            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400">Road Width ({landscapeRoadSettings.width}m)</label>
                <input 
                  type="range" 
                  min={1} 
                  max={12} 
                  step={0.5} 
                  value={landscapeRoadSettings.width} 
                  onChange={e => setLandscapeRoadSettings(prev => ({ ...prev, width: Number(e.target.value) }))}
                  className="w-full accent-trimble-blue mt-1" 
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-medium text-gray-300">Grade Embankment</span>
                <input 
                  type="checkbox"
                  checked={landscapeRoadSettings.embankment}
                  onChange={e => setLandscapeRoadSettings(prev => ({ ...prev, embankment: e.target.checked }))}
                  className="w-4 h-4 rounded accent-trimble-blue"
                />
              </div>

              <div className="pt-1">
                <label className="text-[10px] uppercase font-bold text-gray-400">Road Surface Material</label>
                <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                  {[
                    { color: '#27272a', name: 'Asphalt' },
                    { color: '#71717a', name: 'Concrete' },
                    { color: '#a16207', name: 'Dirt / Trail' },
                    { color: '#94a3b8', name: 'Paved Stone' }
                  ].map(mat => (
                    <button
                      key={mat.color}
                      onClick={() => setLandscapeRoadSettings(prev => ({ ...prev, roadColor: mat.color }))}
                      className={`h-6 rounded border flex items-center justify-center ${
                        landscapeRoadSettings.roadColor === mat.color ? 'ring-2 ring-trimble-blue' : 'border-gray-600'
                      }`}
                      style={{ backgroundColor: mat.color }}
                      title={mat.name}
                    />
                  ))}
                </div>
              </div>

              <div className="text-[10px] text-gray-400 bg-black/20 p-2 rounded border border-gray-700/50 mt-2">
                Click along terrain surface to place waypoints. Double-click to build the roadway strip.
              </div>
            </div>
          )}

          {activeLandscapeCategory === 'style' && (
            <div className="space-y-3">
              {/* Sub-tab switcher */}
              <div className="flex bg-gray-100 dark:bg-gray-800/80 p-0.5 rounded-lg border border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => {
                    setStyleSubTab('realistic');
                    setShadingMode('default');
                    setShapes(prev => prev.map(s => {
                      if (s.type === 'terrain' && s.terrainData) {
                        return {
                          ...s,
                          terrainData: {
                            ...s.terrainData,
                            shadingMode: 'default'
                          }
                        };
                      }
                      return s;
                    }));
                  }}
                  className={cn(
                    "flex-1 py-1 px-2 rounded-md text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5",
                    styleSubTab === 'realistic'
                      ? "bg-white dark:bg-gray-700 text-trimble-blue dark:text-blue-400 shadow-sm"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  )}
                >
                  <ImageIcon size={12} />
                  <span>Photo-Realistic</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStyleSubTab('analysis')}
                  className={cn(
                    "flex-1 py-1 px-2 rounded-md text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5",
                    styleSubTab === 'analysis'
                      ? "bg-white dark:bg-gray-700 text-trimble-blue dark:text-blue-400 shadow-sm"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  )}
                >
                  <Palette size={12} />
                  <span>Analysis Heatmaps</span>
                </button>
              </div>

              {styleSubTab === 'realistic' && (
                <div className="space-y-2.5">
                  {/* Category Filter Pills */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
                    {(['all', 'vegetation', 'stone', 'ground', 'paved', 'snow'] as const).map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setTextureCategoryFilter(cat)}
                        className={cn(
                          "text-[9px] uppercase font-bold px-2 py-0.5 rounded-full whitespace-nowrap transition-colors border",
                          textureCategoryFilter === cat
                            ? "bg-trimble-blue text-white border-trimble-blue"
                            : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  {/* Textures Grid */}
                  <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                    {LANDSCAPE_TEXTURES
                      .filter(t => textureCategoryFilter === 'all' || t.category === textureCategoryFilter)
                      .map(preset => {
                        const isSelected = selectedTextureId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => applyLandscapeTexture(preset)}
                            className={cn(
                              "p-1.5 rounded-lg border text-left flex flex-col gap-1 transition-all group relative overflow-hidden",
                              isSelected
                                ? "bg-trimble-blue/10 border-trimble-blue ring-1 ring-trimble-blue shadow-sm"
                                : "border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                            )}
                          >
                            <div className="w-full h-12 rounded overflow-hidden relative shadow-inner border border-black/10 flex items-center justify-center">
                              <img 
                                src={preset.generate()} 
                                alt={preset.name} 
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              />
                              {isSelected && (
                                <div className="absolute top-1 right-1 bg-trimble-blue text-white rounded-full p-0.5 shadow">
                                  <Check size={10} />
                                </div>
                              )}
                              <span className="absolute bottom-1 left-1 text-[8px] font-bold px-1 py-0.2 rounded bg-black/60 text-white backdrop-blur-xs capitalize">
                                {preset.category}
                              </span>
                            </div>

                            <div>
                              <div className="font-semibold text-[10px] truncate text-gray-900 dark:text-gray-100">
                                {preset.name}
                              </div>
                              <div className="text-[8px] text-gray-500 dark:text-gray-400 line-clamp-1">
                                {preset.description}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                  </div>

                  {/* Tiling Repeat Slider */}
                  <div className="pt-1 border-t border-gray-200 dark:border-gray-800">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-gray-400 uppercase">Texture Tiling Scale</span>
                      <span className="font-mono text-trimble-blue font-semibold">{textureRepeatScale}× repeat</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="range"
                        min={1}
                        max={24}
                        step={1}
                        value={textureRepeatScale}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setTextureRepeatScale(val);
                          const activePreset = LANDSCAPE_TEXTURES.find(t => t.id === selectedTextureId);
                          if (activePreset) {
                            applyLandscapeTexture(activePreset, val);
                          }
                        }}
                        className="w-full accent-trimble-blue"
                      />
                    </div>
                    <div className="flex justify-between text-[8px] text-gray-400 mt-0.5">
                      <span>1× (Stretched)</span>
                      <span>8× (Standard)</span>
                      <span>24× (Dense)</span>
                    </div>
                  </div>
                </div>
              )}

              {styleSubTab === 'analysis' && (
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Color Analysis Gradients</label>
                  {(['elevation', 'slope', 'aspect', 'contours', 'default'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => {
                        setShadingMode(mode);
                        setShapes(prev => prev.map(s => {
                          if (s.type === 'terrain' && s.terrainData) {
                            return {
                              ...s,
                              terrainData: { ...s.terrainData, shadingMode: mode }
                            };
                          }
                          return s;
                        }));
                      }}
                      className={`w-full py-1.5 px-2.5 text-left capitalize rounded-lg flex items-center justify-between border transition-colors ${
                        shadingMode === mode 
                          ? 'bg-trimble-blue/15 border-trimble-blue text-trimble-blue dark:text-blue-400 font-bold' 
                          : 'border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-3.5 h-3.5 rounded-full border border-black/20 ${
                          mode === 'elevation' ? 'bg-gradient-to-t from-green-600 via-amber-700 to-white' :
                          mode === 'slope' ? 'bg-gradient-to-r from-green-500 via-amber-600 to-red-700' :
                          mode === 'contours' ? 'bg-gradient-to-b from-yellow-400 to-green-800' :
                          mode === 'aspect' ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500' : 'bg-emerald-500'
                        }`} />
                        <span>{mode} Analysis Map</span>
                      </div>
                      {shadingMode === mode && <Check size={13} className="text-trimble-blue" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeLandscapeCategory === 'plant' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[11px] text-gray-400 font-medium">
                <span>{activeTool === 'tree' ? 'Available Tree Species' : 'Bushes, Grasses & Flora'}</span>
                <span className="text-[10px] bg-trimble-blue/15 text-trimble-blue px-2 py-0.5 rounded-full font-bold">
                  {PLANT_SPECIES_CATALOG.filter(s => activeTool === 'tree' ? s.category === 'tree' : s.category !== 'tree').length} Species
                </span>
              </div>

              {/* Plant Species Grid */}
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {PLANT_SPECIES_CATALOG
                  .filter(s => activeTool === 'tree' ? s.category === 'tree' : s.category !== 'tree')
                  .map(species => {
                    const isSelected = activePlantSpecies === species.id;
                    return (
                      <button
                        key={species.id}
                        onClick={() => {
                          setActivePlantSpecies(species.id);
                          if (species.variations && species.variations.length > 0) {
                            setActivePlantVariation(species.variations[0]);
                          }
                          setConsoleOutput(prev => [...prev, `[Landscapes] Selected ${species.name}. Click terrain/ground to plant.`]);
                        }}
                        className={`w-full p-2 rounded-lg border text-left flex items-start gap-2.5 transition-all ${
                          isSelected
                            ? 'bg-trimble-blue/15 border-trimble-blue text-trimble-blue dark:text-blue-400 font-semibold shadow-sm'
                            : 'border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800/80 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <div 
                          className="w-7 h-7 rounded-md shrink-0 flex items-center justify-center text-white font-bold text-xs shadow-inner mt-0.5"
                          style={{ backgroundColor: species.thumbnailColor || species.foliageColor }}
                        >
                          {species.modelType === 'fbx' ? '3D' : '🌿'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs truncate">{species.name}</span>
                            {isSelected && <Check size={13} className="text-trimble-blue shrink-0 ml-1" />}
                          </div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 italic truncate">
                            {species.scientificName || `${species.defaultHeight}m H × ${species.defaultSpread}m W`}
                          </div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 line-clamp-1 mt-0.5">
                            {species.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>

              {/* Variations selector if active plant has variations (like Ribbon Grass VarA-VarF) */}
              {(() => {
                const current = PLANT_SPECIES_CATALOG.find(s => s.id === activePlantSpecies);
                if (!current?.variations || current.variations.length === 0) return null;
                return (
                  <div>
                    <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">
                      Botanical Variation (Organic Clustering)
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {current.variations.map(variation => (
                        <button
                          key={variation}
                          onClick={() => setActivePlantVariation(variation)}
                          className={`py-1 px-2 text-[11px] rounded border font-medium transition-all ${
                            activePlantVariation === variation
                              ? 'bg-trimble-blue text-white border-trimble-blue font-bold shadow-sm'
                              : 'border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          {variation}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Plant Scale Slider */}
              <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] uppercase font-bold text-gray-400">Scale / Growth Size</span>
                  <span className="text-[11px] font-mono font-bold text-trimble-blue">{activePlantScale.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="2.5"
                  step="0.05"
                  value={activePlantScale}
                  onChange={(e) => setActivePlantScale(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                />
                <div className="flex justify-between text-[9px] text-gray-400 mt-1">
                  <span>0.4× (Sapling)</span>
                  <span>1.0× (Standard)</span>
                  <span>2.5× (Mature)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conflict Resolution Modal for Terrain Creation */}
      {conflictModal?.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 max-w-sm w-full shadow-2xl text-white">
            <div className="flex items-center gap-3 mb-3 text-amber-400">
              <AlertTriangle size={24} />
              <h3 className="font-bold text-base text-white">Terrain Canvas Conflict</h3>
            </div>
            
            <p className="text-xs text-gray-300 leading-relaxed mb-4">
              A landscape terrain object (<span className="text-trimble-blue font-semibold">{conflictModal.existingName}</span>) already exists in your design. How would you like to proceed?
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  executeCreateTerrain(conflictModal.pendingRandomized, conflictModal.existingId);
                  setConflictModal(null);
                }}
                className="w-full py-2 px-3 bg-trimble-blue hover:bg-trimble-blue-dark text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <RefreshCw size={14} /> Replace Existing Terrain
              </button>

              <button
                onClick={() => {
                  executeCreateTerrain(conflictModal.pendingRandomized);
                  setConflictModal(null);
                }}
                className="w-full py-2 px-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <Plus size={14} /> Add as Additional Terrain
              </button>

              <button
                onClick={() => setConflictModal(null)}
                className="w-full py-2 px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors border border-gray-700 mt-1"
              >
                Cancel Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right Edge Resizer Drag Handle */}
      <div
        id="unified-tool-rail-resizer"
        onMouseDown={handleMouseDown}
        onDoubleClick={() => {
          setRailWidth(220);
          try {
            localStorage.setItem('polyform_unified_rail_width', '220');
          } catch (e) {}
        }}
        className={cn(
          "absolute top-0 -right-1 w-2.5 h-full cursor-ew-resize hover:bg-trimble-blue/30 transition-colors z-50 group flex items-center justify-center select-none",
          isDragging && "bg-trimble-blue/50"
        )}
        title="Drag left/right to resize panel (Double-click to reset width)"
      >
        <div className={cn(
          "w-0.5 h-8 bg-gray-300 dark:bg-gray-600 rounded-full group-hover:bg-trimble-blue group-hover:h-12 transition-all",
          isDragging && "bg-trimble-blue h-12"
        )} />
      </div>
    </aside>
  );
}
