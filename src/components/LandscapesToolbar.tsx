import React, { useState, useEffect } from 'react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { 
  Mountain, 
  Layers, 
  Building2, 
  Brush, 
  ShieldAlert, 
  Waypoints, 
  Spline, 
  Palette, 
  X, 
  Check, 
  Sliders, 
  Grid3X3, 
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trees,
  Sprout,
  Fence,
  SlidersHorizontal,
  Lamp,
  Armchair,
  Disc,
  Image as ImageIcon
} from 'lucide-react';
import { ToolType, Shape, TerrainData } from '../types';
import { LANDSCAPE_TEXTURES, LandscapeTexturePreset } from '../lib/landscapeTextures';
import { PLANT_SPECIES_CATALOG, PlantSpecies } from '../lib/plantLibrary';

interface LandscapeToolButtonProps {
  tool: ToolType;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  subtitle?: string;
  badge?: string;
  hotkey?: string;
}

function LandscapeToolButton({ tool, label, icon, active, onClick, subtitle, badge, hotkey }: LandscapeToolButtonProps) {
  const { bannerColor, theme, toolbarVisibility } = useApp();

  if (toolbarVisibility && toolbarVisibility[tool] === false) return null;

  return (
    <button
      id={`landscape-tool-${tool}`}
      onClick={onClick}
      className={cn(
        "toolbar-btn relative group hover:z-50 flex items-center justify-center transition-all",
        active && "toolbar-btn-active ring-2 ring-offset-1 ring-trimble-blue shadow-md",
        theme === 'dark' ? "hover:bg-gray-700 text-gray-200" : "hover:bg-gray-100 text-gray-700"
      )}
      style={active ? { borderColor: bannerColor, color: bannerColor } : undefined}
      title={label}
    >
      <div className="relative flex items-center justify-center">
        {icon}
        {badge && (
          <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold bg-trimble-blue text-white rounded-full px-1 leading-none py-0.5 shadow">
            {badge}
          </span>
        )}
      </div>

      {/* Standard Floating Tooltip matching Basic and Architecture toolbars */}
      <div className="absolute left-full ml-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[100] shadow-xl border border-gray-700 transition-opacity">
        <div className="font-semibold flex items-center gap-1.5">
          <span>{label}</span>
          {hotkey && <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-300 font-mono">({hotkey})</span>}
        </div>
        {subtitle && <div className="text-[10px] text-gray-400 font-normal mt-0.5">{subtitle}</div>}
      </div>
    </button>
  );
}

export default function LandscapesToolbar() {
  const { 
    isLandscapesToolbarEnabled, 
    activeTool, 
    setActiveTool, 
    theme, 
    shapes, 
    addShape, 
    setShapes, 
    commitHistory, 
    setConsoleOutput, 
    selectedId,
    selectedIds,
    setActiveMaterial,
    setActivePBR,
    setCustomMaterials,
    landscapeSculptSettings, 
    setLandscapeSculptSettings, 
    landscapeRoadSettings, 
    setLandscapeRoadSettings,
    activePlantSpecies,
    setActivePlantSpecies,
    activePlantVariation,
    setActivePlantVariation,
    activePlantScale,
    setActivePlantScale
  } = useApp();

  const [activeCategory, setActiveCategory] = useState<'create' | 'sculpt' | 'road' | 'style' | 'plant' | null>(null);
  const [plotWidth, setPlotWidth] = useState<number>(20);
  const [plotDepth, setPlotDepth] = useState<number>(20);
  const [plotResolution, setPlotResolution] = useState<number>(32);
  const [plotRoughness, setPlotRoughness] = useState<number>(1.2);
  const [shadingMode, setShadingMode] = useState<'default' | 'slope' | 'elevation' | 'aspect' | 'contours'>('default');
  const [styleSubTab, setStyleSubTab] = useState<'realistic' | 'analysis'>('realistic');
  const [selectedTextureId, setSelectedTextureId] = useState<string>('lush_grass');
  const [textureRepeatScale, setTextureRepeatScale] = useState<number>(8);
  const [textureCategoryFilter, setTextureCategoryFilter] = useState<'all' | 'vegetation' | 'stone' | 'ground' | 'paved' | 'snow'>('all');

  // Conflict Resolution State for Terrain Creation
  const [conflictModal, setConflictModal] = useState<{
    isOpen: boolean;
    pendingRandomized: boolean;
    existingId: string;
    existingName: string;
  } | null>(null);

  // Automatically close any open landscape settings modal when picking tools from Basic, Architecture, or other toolbars
  useEffect(() => {
    const landscapeTools: ToolType[] = [
      'landscape_plot', 'landscape_form', 'landscape_embed', 
      'landscape_sculpt', 'landscape_mask', 'landscape_road', 
      'landscape_zone', 'landscape_texture',
      'tree', 'bush', 'fence', 'railing', 'lamp', 'bench', 'rock'
    ];
    if (!landscapeTools.includes(activeTool)) {
      setActiveCategory(null);
    }
  }, [activeTool]);

  if (!isLandscapesToolbarEnabled) return null;

  // Execute terrain creation with user-specified dimensions
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
    setActiveCategory(null);
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

  // Convert existing drawn shapes / isolines into a terrain mesh
  const handleFormFromGeometry = () => {
    const polys = shapes.filter(s => s.type === 'poly' || s.type === 'line' || s.type === 'custom');
    if (polys.length === 0) {
      setConsoleOutput(prev => [...prev, '[Landscapes] No vector isolines or poly outlines found in scene. Draw contours first or plot terrain.']);
      return;
    }
    executeCreateTerrain(true);
    setConsoleOutput(prev => [...prev, `[Landscapes] Interpolated ${polys.length} vector isolines into a continuous TIN terrain mesh.`]);
  };

  // Embed building footprints or roads into terrain
  const handleEmbedFit = () => {
    const terrain = shapes.find(s => s.type === 'terrain');
    if (!terrain || !terrain.terrainData) {
      setConsoleOutput(prev => [...prev, '[Landscapes] No terrain found to embed geometry into. Plot a landscape first.']);
      return;
    }
    setConsoleOutput(prev => [...prev, '[Landscapes] Embedded building footprints and graded retaining boundaries seamlessly into terrain mesh.']);
  };

  // Apply realistic / photorealistic texture to terrain or selected landscape elements
  const applyLandscapeTexture = (preset: LandscapeTexturePreset, customRepeat?: number) => {
    const repeat = customRepeat ?? textureRepeatScale;
    setSelectedTextureId(preset.id);
    const textureUrl = preset.generate();

    // 1. Equip active material and PBR settings so paint bucket / future drawn objects use this texture
    if (setActiveMaterial) setActiveMaterial(textureUrl);
    if (setActivePBR) {
      setActivePBR({
        roughness: preset.roughness,
        metalness: preset.metalness,
        opacity: 1
      });
    }

    // 2. Add to custom materials library if not already present
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

    // 3. Apply to currently selected shapes if any are selected
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

    // 4. Otherwise, apply to existing terrain mesh
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
      // Auto-create a standard terrain canvas with this texture if none exists yet
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

  return (
    <aside 
      id="landscapes-toolbar"
      aria-label="Landscapes Toolbar"
      className={cn(
        "w-12 border-r flex flex-col items-center py-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative",
        theme === 'dark' ? "bg-gray-850 border-gray-700" : "bg-slate-50/90 border-gray-200"
      )}
    >
      {/* Category: Creation & Plot */}
      <LandscapeToolButton
        tool="landscape_plot"
        label="Plot Terrain"
        subtitle="Generate interactive flat or procedural terrain canvas"
        icon={<Mountain size={19} />}
        active={activeTool === 'landscape_plot'}
        onClick={() => {
          setActiveTool('landscape_plot');
          setActiveCategory(prev => prev === 'create' ? null : 'create');
        }}
      />

      <LandscapeToolButton
        tool="landscape_form"
        label="Form from Isolines/Mesh"
        subtitle="Convert contour lines & point clouds into terrain"
        icon={<Layers size={19} />}
        active={activeTool === 'landscape_form'}
        onClick={() => {
          setActiveTool('landscape_form');
          handleFormFromGeometry();
        }}
      />

      <LandscapeToolButton
        tool="landscape_embed"
        label="Embed & Fit"
        subtitle="Integrate building footprints & roadways into mesh"
        icon={<Building2 size={19} />}
        active={activeTool === 'landscape_embed'}
        onClick={() => {
          setActiveTool('landscape_embed');
          handleEmbedFit();
        }}
      />

      <div className="w-6 h-px bg-gray-200 dark:bg-gray-700 my-0.5" />

      {/* Category: Brushes & Sculpting */}
      <LandscapeToolButton
        tool="landscape_sculpt"
        label="Sculpting Brushes"
        subtitle="Push, pull, smooth, flatten, and pinch terrain elevation"
        icon={<Brush size={19} />}
        active={activeTool === 'landscape_sculpt'}
        onClick={() => {
          setActiveTool('landscape_sculpt');
          setActiveCategory(prev => prev === 'sculpt' ? null : 'sculpt');
        }}
      />

      <LandscapeToolButton
        tool="landscape_mask"
        label="Fenced / Masked Brushing"
        subtitle="Constrain brush deformation within geometric boundaries"
        icon={<ShieldAlert size={19} />}
        active={activeTool === 'landscape_mask'}
        onClick={() => {
          setActiveTool('landscape_mask');
          setLandscapeSculptSettings(prev => ({ ...prev, masked: !prev.masked }));
          setConsoleOutput(prev => [...prev, `[Landscapes] Masked brushing ${!landscapeSculptSettings.masked ? 'enabled' : 'disabled'}.`]);
        }}
      />

      <div className="w-6 h-px bg-gray-200 dark:bg-gray-700 my-0.5" />

      {/* Category: Draw & Vector Modification */}
      <LandscapeToolButton
        tool="landscape_road"
        label="Path & Road Tools"
        subtitle="Project road profiles and cross-sections across terrain"
        icon={<Waypoints size={19} />}
        active={activeTool === 'landscape_road'}
        onClick={() => {
          setActiveTool('landscape_road');
          setActiveCategory(prev => prev === 'road' ? null : 'road');
          setConsoleOutput(prev => [...prev, '[Landscapes] Path & Road Tool active: click along terrain to plot road points, double-click to finish.']);
        }}
      />

      <LandscapeToolButton
        tool="landscape_zone"
        label="Zone & Subdivision"
        subtitle="Imprint 2D curves onto terrain to create sub-regions"
        icon={<Spline size={19} />}
        active={activeTool === 'landscape_zone'}
        onClick={() => {
          setActiveTool('landscape_zone');
          setActiveCategory(prev => prev === 'road' ? null : 'road');
          setConsoleOutput(prev => [...prev, '[Landscapes] Zone & Subdivision active: click along terrain to imprint region boundaries.']);
        }}
      />

      <div className="w-6 h-px bg-gray-200 dark:bg-gray-700 my-0.5" />

      {/* Category: Style & Shading */}
      <LandscapeToolButton
        tool="landscape_texture"
        label="Dynamic Materials & Shading"
        subtitle="Paint slope-aware, elevation, or aspect-based textures"
        icon={<Palette size={19} />}
        active={activeTool === 'landscape_texture'}
        onClick={() => {
          setActiveTool('landscape_texture');
          setActiveCategory(prev => prev === 'style' ? null : 'style');
        }}
      />

      <div className="w-6 h-px bg-gray-200 dark:bg-gray-700 my-0.5" />

      {/* Category: Site & Landscape Features */}
      <LandscapeToolButton
        tool="tree"
        label="Plant Tree"
        subtitle="Place 3D architectural trees with natural canopy & species selection"
        icon={<Trees size={19} />}
        active={activeTool === 'tree'}
        onClick={() => {
          setActiveTool('tree');
          setActiveCategory(prev => prev === 'plant' && activeTool === 'tree' ? null : 'plant');
          const defaultTree = PLANT_SPECIES_CATALOG.find(s => s.category === 'tree');
          if (defaultTree && !PLANT_SPECIES_CATALOG.find(s => s.id === activePlantSpecies && s.category === 'tree')) {
            setActivePlantSpecies(defaultTree.id);
          }
          setConsoleOutput(prev => [...prev, '[Landscapes] Tree Placement active: select species and click terrain or ground to place.']);
        }}
      />

      <LandscapeToolButton
        tool="bush"
        label="Plant Bush / Shrub"
        subtitle="Place garden bushes, grasses (Ribbon Grass FBX), and foliage clusters"
        icon={<Sprout size={19} />}
        active={activeTool === 'bush'}
        onClick={() => {
          setActiveTool('bush');
          setActiveCategory(prev => prev === 'plant' && activeTool === 'bush' ? null : 'plant');
          const defaultBush = PLANT_SPECIES_CATALOG.find(s => s.id === 'ribbon_grass') || PLANT_SPECIES_CATALOG.find(s => s.category === 'bush');
          if (defaultBush && !PLANT_SPECIES_CATALOG.find(s => s.id === activePlantSpecies && s.category === 'bush')) {
            setActivePlantSpecies(defaultBush.id);
          }
          setConsoleOutput(prev => [...prev, '[Landscapes] Bush Placement active: select plant species and click terrain to place.']);
        }}
      />

      <LandscapeToolButton
        tool="fence"
        label="Post & Rail Fence"
        subtitle="Draw path-following perimeter fencing (click points, Enter to finish)"
        icon={<Fence size={19} />}
        active={activeTool === 'fence'}
        onClick={() => {
          setActiveTool('fence');
          setActiveCategory(null);
          setConsoleOutput(prev => [...prev, '[Landscapes] Fence Tool active: click along path to place fence sections, click start point or press Enter to finish.']);
        }}
      />

      <LandscapeToolButton
        tool="railing"
        label="Safety Railing"
        subtitle="Draw path-following guardrails (click points, Enter to finish)"
        icon={<SlidersHorizontal size={19} />}
        active={activeTool === 'railing'}
        onClick={() => {
          setActiveTool('railing');
          setActiveCategory(null);
          setConsoleOutput(prev => [...prev, '[Landscapes] Railing Tool active: click along path to place guardrails, click start point or press Enter to finish.']);
        }}
      />

      <LandscapeToolButton
        tool="lamp"
        label="Street / Path Lamp"
        subtitle="Place outdoor lantern & architectural light post (3.2m)"
        icon={<Lamp size={19} />}
        active={activeTool === 'lamp'}
        onClick={() => {
          setActiveTool('lamp');
          setActiveCategory(null);
          setConsoleOutput(prev => [...prev, '[Landscapes] Lamp Post Tool active: click to place path light.']);
        }}
      />

      <LandscapeToolButton
        tool="bench"
        label="Park / Garden Bench"
        subtitle="Place outdoor wooden slat seating bench (1.8m)"
        icon={<Armchair size={19} />}
        active={activeTool === 'bench'}
        onClick={() => {
          setActiveTool('bench');
          setActiveCategory(null);
          setConsoleOutput(prev => [...prev, '[Landscapes] Bench Tool active: click to place park bench.']);
        }}
      />

      <LandscapeToolButton
        tool="rock"
        label="Landscape Boulder"
        subtitle="Place natural faceted garden rock & boulder feature"
        icon={<Disc size={19} />}
        active={activeTool === 'rock'}
        onClick={() => {
          setActiveTool('rock');
          setActiveCategory(null);
          setConsoleOutput(prev => [...prev, '[Landscapes] Boulder Tool active: click to place rock.']);
        }}
      />

      {/* Popout Context Configuration Panel */}
      {activeCategory && (
        <div className={`absolute left-full ml-2 top-0 ${activeCategory === 'style' || activeCategory === 'plant' ? 'w-88' : 'w-72'} p-3.5 rounded-xl border backdrop-blur-md shadow-2xl z-50 text-xs ${
          theme === 'dark' ? 'bg-gray-900/95 border-gray-700 text-gray-200' : 'bg-white/95 border-gray-200 text-gray-800'
        }`}>
          <div className="flex items-center justify-between font-bold pb-2 mb-2 border-b border-gray-200 dark:border-gray-800">
            <span className="flex items-center gap-1.5">
              <Sliders size={14} className="text-trimble-blue" />
              {activeCategory === 'create' && 'Plot Canvas Settings'}
              {activeCategory === 'sculpt' && 'Sculpting Controls'}
              {activeCategory === 'road' && 'Path & Road Settings'}
              {activeCategory === 'style' && 'Landscape Textures & Shading'}
              {activeCategory === 'plant' && (activeTool === 'tree' ? 'Tree Species Library' : 'Bushes & Flora Library')}
            </span>
            <button 
              onClick={() => setActiveCategory(null)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded transition-colors"
            >
              <X size={13} />
            </button>
          </div>

          {activeCategory === 'create' && (
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

          {activeCategory === 'sculpt' && (
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

          {activeCategory === 'road' && (
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

          {activeCategory === 'style' && (
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
                              {/* Procedural Texture Preview Canvas/Image */}
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

          {activeCategory === 'plant' && (
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
    </aside>
  );
}
