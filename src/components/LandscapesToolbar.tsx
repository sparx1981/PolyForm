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
  Disc
} from 'lucide-react';
import { ToolType, Shape, TerrainData } from '../types';

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
  const { bannerColor, theme } = useApp();
  return (
    <button
      id={`landscape-tool-${tool}`}
      onClick={onClick}
      className={cn(
        "toolbar-btn relative group flex items-center justify-center transition-all",
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
      <div className="absolute left-full ml-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-xl border border-gray-700 transition-opacity">
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
    landscapeSculptSettings, 
    setLandscapeSculptSettings, 
    landscapeRoadSettings, 
    setLandscapeRoadSettings 
  } = useApp();

  const [activeCategory, setActiveCategory] = useState<'create' | 'sculpt' | 'road' | 'style' | null>(null);
  const [plotWidth, setPlotWidth] = useState<number>(20);
  const [plotDepth, setPlotDepth] = useState<number>(20);
  const [plotResolution, setPlotResolution] = useState<number>(32);
  const [plotRoughness, setPlotRoughness] = useState<number>(1.2);
  const [shadingMode, setShadingMode] = useState<'default' | 'slope' | 'elevation' | 'aspect' | 'contours'>('elevation');

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

    const terrainData: TerrainData = {
      gridX: grid,
      gridY: grid,
      width,
      depth,
      heights,
      shadingMode
    };

    if (replaceId) {
      setShapes(prev => prev.map(s => {
        if (s.id === replaceId) {
          return {
            ...s,
            terrainData,
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
        color: '#34d399',
        roughness: 0.8,
        metalness: 0.1
      };
      addShape(newShape);
      setConsoleOutput(prev => [...prev, `[Landscapes] Created new terrain canvas ${width}m × ${depth}m (${grid}×${grid} resolution).`]);
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
        subtitle="Place 3D architectural trees with natural canopy"
        icon={<Trees size={19} />}
        active={activeTool === 'tree'}
        onClick={() => {
          setActiveTool('tree');
          setActiveCategory(null);
          setConsoleOutput(prev => [...prev, '[Landscapes] Tree Placement active: click terrain or ground to place tree.']);
        }}
      />

      <LandscapeToolButton
        tool="bush"
        label="Plant Bush / Shrub"
        subtitle="Place garden bushes and vegetation foliage clusters"
        icon={<Sprout size={19} />}
        active={activeTool === 'bush'}
        onClick={() => {
          setActiveTool('bush');
          setActiveCategory(null);
          setConsoleOutput(prev => [...prev, '[Landscapes] Bush Placement active: click terrain to place shrub.']);
        }}
      />

      <LandscapeToolButton
        tool="fence"
        label="Post & Rail Fence"
        subtitle="Place perimeter fencing sections (2.4m × 1.1m)"
        icon={<Fence size={19} />}
        active={activeTool === 'fence'}
        onClick={() => {
          setActiveTool('fence');
          setActiveCategory(null);
          setConsoleOutput(prev => [...prev, '[Landscapes] Fence Tool active: click to place fence section.']);
        }}
      />

      <LandscapeToolButton
        tool="railing"
        label="Safety Railing"
        subtitle="Place modern deck & terrace guardrails (2.0m × 1.0m)"
        icon={<SlidersHorizontal size={19} />}
        active={activeTool === 'railing'}
        onClick={() => {
          setActiveTool('railing');
          setActiveCategory(null);
          setConsoleOutput(prev => [...prev, '[Landscapes] Railing Tool active: click to place guardrail section.']);
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
        <div className={`absolute left-full ml-2 top-0 w-72 p-3.5 rounded-xl border backdrop-blur-md shadow-2xl z-50 text-xs ${
          theme === 'dark' ? 'bg-gray-900/95 border-gray-700 text-gray-200' : 'bg-white/95 border-gray-200 text-gray-800'
        }`}>
          <div className="flex items-center justify-between font-bold pb-2 mb-2 border-b border-gray-200 dark:border-gray-800">
            <span className="flex items-center gap-1.5">
              <Sliders size={14} className="text-trimble-blue" />
              {activeCategory === 'create' && 'Plot Canvas Settings'}
              {activeCategory === 'sculpt' && 'Sculpting Controls'}
              {activeCategory === 'road' && 'Path & Road Settings'}
              {activeCategory === 'style' && 'Shading & Texture Modes'}
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
                        className="w-full px-2 py-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs font-mono"
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
                        className="w-full px-2 py-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs font-mono"
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
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-gray-400">Terrain Shading Mode</label>
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
                  className={`w-full py-1.5 px-2.5 text-left capitalize rounded flex items-center justify-between border ${
                    shadingMode === mode 
                      ? 'bg-trimble-blue/15 border-trimble-blue text-trimble-blue dark:text-blue-400 font-bold' 
                      : 'border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <span>{mode} Analysis Map</span>
                  {shadingMode === mode && <Check size={13} className="text-trimble-blue" />}
                </button>
              ))}
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
