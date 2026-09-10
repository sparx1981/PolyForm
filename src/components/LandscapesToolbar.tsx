import React, { useState, useRef, createContext, useContext, useEffect } from 'react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { FlyoutPortal } from './ui/FlyoutPortal';
import { 
  Route, 
  Square, 
  Circle, 
  Grid3X3, 
  Layers, 
  HardHat, 
  X, 
  Check, 
  Activity, 
  Mountain,
  Plus,
  Trash2,
  RefreshCw,
  Paintbrush,
  ArrowDownToLine,
  ArrowUpFromLine,
  Waves,
  MinusSquare,
  CheckCircle2,
  ShieldCheck,
  Eye,
  EyeOff,
  MousePointer2
} from 'lucide-react';
import { ToolType, RoadMarkingPreset, BatterFalloffType, ParkingAngle, PadModifier, RoadModifier, TerrainModifier, Shape } from '../types';
import { createTerrainShape, generateTerrainHeights, TopographyPreset } from '../lib/terrain/terrainFactory';
import { LANDSCAPE_TEXTURES } from '../lib/landscapeTextures';
import { applyPadGradingToTerrain } from '../lib/terrain/padGeometry';
import { flattenTerrainForFloorSlabs } from '../lib/archRoomAssembly';
import { ROAD_MATERIALS } from '../lib/terrain/roadMaterials';
import { regradeTerrainWithModifiers } from '../lib/terrain/roadGeometry';

const FlyoutSideContext = createContext<'right' | 'bottom'>('right');

interface CivilToolButtonProps {
  tool: ToolType;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: string;
  hotkey?: string;
}

function CivilToolButton({
  tool,
  label,
  subtitle,
  icon,
  active,
  onClick,
  badge,
  hotkey,
}: CivilToolButtonProps) {
  const { toolbarVisibility, theme, bannerColor } = useApp();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const flyoutSide = useContext(FlyoutSideContext);

  if (toolbarVisibility && toolbarVisibility[tool] === false) return null;

  return (
    <button
      ref={buttonRef}
      id={`civil-tool-${tool}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "toolbar-btn relative flex items-center justify-center transition-colors cursor-pointer",
        active && "toolbar-btn-active",
        theme === 'dark' ? "hover:bg-gray-700 text-gray-200" : "hover:bg-gray-200 text-gray-700"
      )}
      style={active && bannerColor ? { backgroundColor: bannerColor, color: '#ffffff' } : undefined}
    >
      <div className="relative flex items-center justify-center">
        {icon}
        {badge && (
          <span className={cn(
            "absolute -top-1.5 -right-1.5 text-[8px] font-bold rounded-full px-1 leading-none py-0.5 shadow-xs",
            active ? "bg-white text-trimble-blue" : "bg-trimble-blue text-white"
          )}>
            {badge}
          </span>
        )}
      </div>

      <FlyoutPortal anchorRef={buttonRef} open={hovered} side={flyoutSide}>
        {hovered && (
          <div className="px-2.5 py-1.5 bg-trimble-gray text-white text-xs rounded whitespace-nowrap shadow-modus-2 pointer-events-none z-50">
            <div className="font-semibold flex items-center gap-1.5">
              <span>{label}</span>
              {hotkey && <span className="text-[10px] bg-black/30 px-1 py-0.5 rounded font-mono">({hotkey})</span>}
            </div>
            {subtitle && <div className="text-[10px] text-gray-300 font-normal mt-0.5">{subtitle}</div>}
          </div>
        )}
      </FlyoutPortal>
    </button>
  );
}

interface LandscapesToolbarProps {
  dock?: 'left' | 'top' | 'bottom';
}

export default function LandscapesToolbar({ dock = 'left' }: LandscapesToolbarProps = {}) {
  const horizontal = dock !== 'left';
  const flyoutSide: 'right' | 'bottom' = horizontal ? 'bottom' : 'right';

  const { 
    isLandscapesToolbarEnabled, 
    activeTool, 
    setActiveTool, 
    shapes,
    setShapes,
    addShape,
    selectedId,
    setSelectedId,
    commitHistory,
    civilRoadSettings, 
    setCivilRoadSettings,
    civilPadSettings, 
    setCivilPadSettings,
    civilStripingSettings, 
    setCivilStripingSettings,
    setIsBakeModalOpen,
    setConsoleOutput,
    landscapeSculptSettings,
    setLandscapeSculptSettings,
    terrainModifiers,
    setTerrainModifiers,
    updateTerrainModifier,
    selectedModifierId,
    setSelectedModifierId,
    activeSplineDraft,
    setActiveSplineDraft,
    activePadDraft,
    setActivePadDraft,
    showCutFillOverlay,
    setShowCutFillOverlay,
    setMeasurements,
    theme
  } = useApp();

  const selectedTerrain = shapes.find(s => s.id === selectedId && s.type === 'terrain' && s.terrainData);
  const existingTerrain = shapes.find(s => s.type === 'terrain' && !s.hidden);
  const activeTerrain = selectedTerrain || existingTerrain;

  const selectedPad = terrainModifiers.find(
    (m): m is PadModifier => m.id === selectedModifierId && m.type === 'pad'
  );

  const selectedRoad = terrainModifiers.find(
    (m): m is RoadModifier => m.id === selectedModifierId && m.type === 'road'
  );

  const [terrainOptions, setTerrainOptions] = useState<{
    width: number;
    depth: number;
    resolution: number;
    topography: TopographyPreset;
    roughness: number;
    textureId: string;
  }>({
    width: 50,
    depth: 50,
    resolution: 32,
    topography: 'flat',
    roughness: 0.5,
    textureId: 'lush_grass'
  });

  const [padSubTab, setPadSubTab] = useState<'geometry' | 'surface'>('geometry');

  // Sync terrain options from the active or selected terrain
  useEffect(() => {
    if (activeTerrain?.terrainData) {
      const td = activeTerrain.terrainData;
      setTerrainOptions(prev => ({
        ...prev,
        width: td.width || prev.width,
        depth: td.depth || prev.depth,
        resolution: td.gridX || prev.resolution,
        topography: (td.topography as TopographyPreset) || prev.topography,
        roughness: td.roughness !== undefined ? td.roughness : prev.roughness,
      }));
    }
  }, [activeTerrain?.id, activeTerrain?.terrainData?.roughness, activeTerrain?.terrainData?.topography, activeTerrain?.terrainData?.width, activeTerrain?.terrainData?.depth]);

  // Sync road settings when a road is selected
  useEffect(() => {
    if (selectedRoad) {
      setCivilRoadSettings(prev => ({
        ...prev,
        width: selectedRoad.width,
        maxGradePercent: selectedRoad.maxGradePercent ?? prev.maxGradePercent,
        hasCurb: selectedRoad.profile?.hasCurb ?? prev.hasCurb,
        hasDitch: selectedRoad.profile?.hasDitch ?? prev.hasDitch,
        markings: selectedRoad.markings || 'center-dashed',
        material: selectedRoad.material || 'asphalt-weathered'
      }));
    }
  }, [selectedRoad?.id, selectedRoad?.width, selectedRoad?.profile?.hasCurb, selectedRoad?.profile?.hasDitch, selectedRoad?.markings, selectedRoad?.material]);

  // Update road settings and immediately regrade terrain
  const handleUpdateRoadSetting = (patch: {
    width?: number;
    maxGradePercent?: number;
    hasCurb?: boolean;
    hasDitch?: boolean;
    markings?: RoadMarkingPreset;
    material?: string;
  }) => {
    setCivilRoadSettings(prev => ({
      ...prev,
      ...patch
    }));

    if (selectedRoad) {
      const updatedModifiers = terrainModifiers.map(m => {
        if (m.id === selectedRoad.id && m.type === 'road') {
          return {
            ...m,
            ...(patch.width !== undefined && { width: patch.width }),
            ...(patch.maxGradePercent !== undefined && { maxGradePercent: patch.maxGradePercent }),
            ...(patch.markings !== undefined && { markings: patch.markings }),
            ...(patch.material !== undefined && { material: patch.material }),
            profile: {
              ...m.profile,
              ...(patch.hasCurb !== undefined && { hasCurb: patch.hasCurb }),
              ...(patch.hasDitch !== undefined && { hasDitch: patch.hasDitch }),
            }
          };
        }
        return m;
      });

      setTerrainModifiers(updatedModifiers);

      const terrainShape = shapes.find(s => s.type === 'terrain' && s.terrainData);
      if (terrainShape) {
        const regraded = regradeTerrainWithModifiers(terrainShape, updatedModifiers);
        if (regraded) {
          setShapes(prev => prev.map(s => s.id === terrainShape.id ? { ...s, terrainData: regraded } : s));
        }
      }
    }
  };

  const handleRoughnessChange = (newRoughness: number) => {
    setTerrainOptions(o => ({ ...o, roughness: newRoughness }));
    if (activeTerrain && activeTerrain.terrainData) {
      const newHeights = generateTerrainHeights({
        resolution: terrainOptions.resolution,
        topography: terrainOptions.topography,
        roughness: newRoughness
      });
      const updatedShape: Shape = {
        ...activeTerrain,
        terrainData: {
          ...activeTerrain.terrainData,
          heights: [...newHeights],
          baseHeights: [...newHeights],
          roughness: newRoughness
        }
      };
      if (terrainModifiers.length > 0) {
        const regraded = regradeTerrainWithModifiers(updatedShape, terrainModifiers);
        if (regraded) {
          updatedShape.terrainData = regraded;
        }
      }
      setShapes(prev => prev.map(s => s.id === activeTerrain.id ? updatedShape : s));
    }
  };

  const handleAddOrUpdateTerrain = (customOpts?: Partial<{
    width: number;
    depth: number;
    resolution: number;
    topography: TopographyPreset;
    roughness: number;
    textureId: string;
  }>) => {
    const opts = { ...terrainOptions, ...customOpts };
    const targetId = activeTerrain?.id;
    const newTerrain = createTerrainShape({
      width: opts.width,
      depth: opts.depth,
      resolution: opts.resolution,
      topography: opts.topography,
      roughness: opts.roughness,
      textureId: opts.textureId
    }, targetId);

    if (terrainModifiers.length > 0) {
      const regraded = regradeTerrainWithModifiers(newTerrain, terrainModifiers);
      if (regraded) {
        newTerrain.terrainData = regraded;
      }
    }

    if (activeTerrain) {
      setShapes(prev => prev.map(s => s.id === activeTerrain.id ? newTerrain : s));
      setSelectedId(newTerrain.id);
      commitHistory();
      setConsoleOutput(c => [...c, `[Terrain Studio] Updated terrain canvas (${opts.width}m × ${opts.depth}m, ${opts.topography} topography, roughness ${(opts.roughness * 100).toFixed(0)}%).`]);
    } else {
      addShape(newTerrain);
      setSelectedId(newTerrain.id);
      commitHistory();
      setConsoleOutput(c => [...c, `[Terrain Studio] Added ${opts.width}m × ${opts.depth}m terrain canvas (${opts.topography} topography) to design.`]);
    }
  };

  const handleRegenerateHeights = () => {
    if (!activeTerrain) return;
    const newHeights = generateTerrainHeights({
      resolution: terrainOptions.resolution,
      topography: terrainOptions.topography,
      roughness: terrainOptions.roughness
    });
    const updatedShape: Shape = {
      ...activeTerrain,
      terrainData: {
        ...activeTerrain.terrainData!,
        heights: [...newHeights],
        baseHeights: [...newHeights],
        gridX: terrainOptions.resolution,
        gridY: terrainOptions.resolution,
        topography: terrainOptions.topography,
        roughness: terrainOptions.roughness
      }
    };
    if (terrainModifiers.length > 0) {
      const regraded = regradeTerrainWithModifiers(updatedShape, terrainModifiers);
      if (regraded) {
        updatedShape.terrainData = regraded;
      }
    }
    setShapes(prev => prev.map(s => s.id === activeTerrain.id ? updatedShape : s));
    commitHistory();
    setConsoleOutput(c => [...c, `[Terrain Studio] Regenerated topography heights with '${terrainOptions.topography}' preset.`]);
  };

  const handleRemoveTerrain = () => {
    if (!existingTerrain) return;
    if (window.confirm('Remove base terrain canvas from design? Road alignments and grading pads will lose ground elevations.')) {
      setShapes(prev => prev.filter(s => s.id !== existingTerrain.id));
      commitHistory();
      setConsoleOutput(c => [...c, '[Terrain Studio] Base terrain canvas removed from design.']);
    }
  };

  const handleCommitPadToTerrain = () => {
    if (!existingTerrain || !existingTerrain.terrainData) {
      setMeasurements?.('No terrain canvas exists. Add a base site terrain first.');
      setConsoleOutput(c => [...c, '[Terrain Studio] Cannot grade pad: Add a base terrain canvas first.']);
      return;
    }

    const targetCenter: [number, number, number] = activePadDraft
      ? activePadDraft.center
      : [existingTerrain.position[0], civilPadSettings.targetElevation, existingTerrain.position[2]];

    const padSpec: PadModifier = {
      id: `pad-${Date.now()}`,
      name: `${civilPadSettings.primitive === 'rectangle' ? 'Building' : 'Circular'} Pad`,
      type: 'pad',
      enabled: true,
      center: targetCenter,
      primitive: civilPadSettings.primitive,
      dimensions: [civilPadSettings.dimensions[0], civilPadSettings.dimensions[1]],
      rotationY: 0,
      targetElevation: civilPadSettings.targetElevation,
      batterDistance: civilPadSettings.batterDistance,
      batterProfile: civilPadSettings.batterProfile,
    };

    const updatedData = applyPadGradingToTerrain(existingTerrain, padSpec);
    if (!updatedData) {
      setMeasurements?.('Pad location is outside the terrain boundaries.');
      setConsoleOutput(c => [...c, '[Terrain Studio] Pad location is outside terrain boundaries.']);
      return;
    }

    setShapes(prev => prev.map(s => s.id === existingTerrain.id ? { ...s, terrainData: updatedData } : s));
    commitHistory();
    setActivePadDraft(null);
    setSelectedModifierId(null);
    setMeasurements?.(`Graded terrain to ${civilPadSettings.primitive} pad platform at EL ${civilPadSettings.targetElevation >= 0 ? '+' : ''}${civilPadSettings.targetElevation}m.`);
    setConsoleOutput(c => [...c, `[Terrain Studio] Graded terrain to ${civilPadSettings.primitive} pad at EL ${civilPadSettings.targetElevation}m.`]);
  };

  const handleGradeFloorSlabs = () => {
    if (!existingTerrain || !existingTerrain.terrainData) {
      setMeasurements?.('No terrain canvas exists. Add a base terrain first.');
      return;
    }

    const updated = flattenTerrainForFloorSlabs(existingTerrain, shapes, 1.0);
    if (updated) {
      setShapes(prev => prev.map(s => s.id === existingTerrain.id ? { ...s, terrainData: updated } : s));
      commitHistory();
      setMeasurements?.('Graded terrain: 1m safety apron excavated for all floor slabs.');
      setConsoleOutput(c => [...c, '[Terrain Studio] Graded 1m safety apron around all floor slabs and excavated foundations. Terrain clashes eliminated.']);
    } else {
      setConsoleOutput(c => [...c, '[Terrain Studio] All floor slabs already have clear 1m graded safety aprons.']);
    }
  };

  const handleGlobalSmoothTerrain = () => {
    if (!existingTerrain || !existingTerrain.terrainData) return;
    const { gridX, gridY, heights } = existingTerrain.terrainData;
    const smoothed = [...heights];

    for (let y = 1; y < gridY - 1; y++) {
      for (let x = 1; x < gridX - 1; x++) {
        const idx = y * gridX + x;
        const avg = (
          heights[idx] * 4 +
          heights[idx - 1] + heights[idx + 1] +
          heights[idx - gridX] + heights[idx + gridX] +
          heights[idx - gridX - 1] * 0.5 + heights[idx - gridX + 1] * 0.5 +
          heights[idx + gridX - 1] * 0.5 + heights[idx + gridX + 1] * 0.5
        ) / 10;
        smoothed[idx] = avg;
      }
    }

    let finalData = { ...existingTerrain.terrainData, heights: smoothed };
    const withSlabs = flattenTerrainForFloorSlabs({ ...existingTerrain, terrainData: finalData }, shapes, 1.0);
    if (withSlabs) finalData = withSlabs;

    setShapes(prev => prev.map(s => s.id === existingTerrain.id ? { ...s, terrainData: finalData } : s));
    commitHistory();
    setConsoleOutput(c => [...c, '[Terrain Studio] Applied global smoothing pass across terrain mesh.']);
  };

  const handleGlobalFlattenTerrain = (datumY: number = 0) => {
    if (!existingTerrain || !existingTerrain.terrainData) return;
    const { gridX, gridY } = existingTerrain.terrainData;
    const posY = existingTerrain.position[1];
    const flatH = datumY - posY;
    const newHeights = new Array(gridX * gridY).fill(flatH);

    let finalData = { ...existingTerrain.terrainData, heights: newHeights };
    const withSlabs = flattenTerrainForFloorSlabs({ ...existingTerrain, terrainData: finalData }, shapes, 1.0);
    if (withSlabs) finalData = withSlabs;

    setShapes(prev => prev.map(s => s.id === existingTerrain.id ? { ...s, terrainData: finalData } : s));
    commitHistory();
    setConsoleOutput(c => [...c, `[Terrain Studio] Flattened entire terrain surface to EL ${datumY}m.`]);
  };

  const handleApplyStripingToPad = () => {
    const pad = selectedPad || terrainModifiers.find((m): m is PadModifier => m.type === 'pad');
    if (!pad) {
      setMeasurements?.('No pad found. Select or create a building/grading pad first.');
      return;
    }
    const updatedSurface = {
      id: `surf-${pad.id}`,
      name: `${pad.name} Striping`,
      type: 'surface' as const,
      enabled: true,
      hostPadId: pad.id,
      pattern: 'parking-striping' as const,
      parkingConfig: { ...civilStripingSettings },
    };
    updateTerrainModifier(pad.id, { surfaceModifier: updatedSurface });
    setSelectedModifierId(pad.id);
    setMeasurements?.(`Applied parking striping to ${pad.name} (${civilStripingSettings.angle}°, ${civilStripingSettings.stallWidth}m width).`);
    setConsoleOutput(c => [...c, `[Terrain Studio] Applied parking stall striping to ${pad.name}.`]);
  };

  const handleRemoveStripingFromPad = () => {
    const pad = selectedPad || terrainModifiers.find((m): m is PadModifier => m.type === 'pad' && !!m.surfaceModifier);
    if (!pad) return;
    updateTerrainModifier(pad.id, { surfaceModifier: undefined });
    setMeasurements?.(`Removed parking striping from ${pad.name}.`);
    setConsoleOutput(c => [...c, `[Terrain Studio] Removed parking striping from ${pad.name}.`]);
  };

  const handleClearHighlightsAndSelection = () => {
    setSelectedModifierId(null);
    setActiveSplineDraft([]);
    setActivePadDraft(null);
    setShowCutFillOverlay(false);
    setMeasurements?.('Selection, alignment drafts, and earthwork highlights cleared.');
  };

  const [activeTier, setActiveTier] = useState<'terrain' | 'sculpt' | 'corridors' | 'pads' | null>(() => {
    if (activeTool === 'terrain') return 'terrain';
    if (activeTool === 'landscape_sculpt') return 'sculpt';
    if (activeTool === 'road') return 'corridors';
    if (activeTool === 'pad-rect' || activeTool === 'pad-circle' || activeTool === 'striping') return 'pads';
    return null;
  });

  useEffect(() => {
    if (activeTool === 'terrain') setActiveTier('terrain');
    else if (activeTool === 'landscape_sculpt') setActiveTier('sculpt');
    else if (activeTool === 'road') setActiveTier('corridors');
    else if (activeTool === 'pad-rect' || activeTool === 'pad-circle') {
      setActiveTier('pads');
      setPadSubTab('geometry');
    } else if (activeTool === 'striping') {
      setActiveTier('pads');
      setPadSubTab('surface');
    }
  }, [activeTool]);

  if (!isLandscapesToolbarEnabled) return null;

  const isPadToolActive = activeTool === 'pad-rect' || activeTool === 'pad-circle' || activeTool === 'striping';
  const hasActiveHighlights = selectedModifierId !== null || activeSplineDraft.length > 0 || activePadDraft !== null || showCutFillOverlay;

  return (
    <FlyoutSideContext.Provider value={flyoutSide}>
      <aside 
        id="landscapes-toolbar-root"
        aria-label="PolyForm Landscapes & Civil Studio"
        className={cn(
          horizontal
            ? cn("h-12 flex flex-row items-center px-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative",
                 dock === 'top' ? "border-b" : "border-t")
            : "w-12 border-r flex flex-col items-center py-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative",
          theme === 'dark' ? "bg-gray-800 border-gray-700 text-gray-200" : "bg-white border-gray-200 text-gray-800"
        )}
      >
        {/* Tier 0: Base Site Terrain Canvas */}
        <div className="relative group">
          <CivilToolButton
            tool="terrain"
            label="Base Site Terrain"
            subtitle="Base Site Canvas: Add or configure civil ground surface for roads, pads & grading"
            icon={<Mountain size={20} />}
            active={activeTool === 'terrain'}
            badge={existingTerrain ? "Active" : undefined}
            hotkey="T"
            onClick={() => {
              setActiveTool('terrain');
              setActiveTier(prev => prev === 'terrain' && activeTool === 'terrain' ? null : 'terrain');
              setConsoleOutput(c => [...c, '[Terrain Studio] Base Site Terrain tool active: add or configure site terrain surface.']);
            }}
          />
        </div>

        {/* Divider between Tier 0 and Tier 0.5 */}
        <div className={horizontal ? "h-8 w-px bg-gray-200 dark:bg-gray-700 mx-1" : "w-8 h-px bg-gray-200 dark:bg-gray-700 my-1"} />

        {/* Tier 0.5: Terrain Sculpting (Push, Pull, Smooth, Flatten) */}
        <div className="relative group flex flex-col sm:flex-row items-center gap-1">
          <CivilToolButton
            tool="landscape_sculpt"
            label="Sculpt Terrain Surface"
            subtitle={`Sculpting Brushes: Push, pull, smooth & flatten terrain (${landscapeSculptSettings.mode.toUpperCase()})`}
            icon={<Paintbrush size={20} />}
            active={activeTool === 'landscape_sculpt'}
            badge={landscapeSculptSettings.mode.toUpperCase()}
            hotkey="S"
            onClick={() => {
              setActiveTool('landscape_sculpt');
              setActiveTier(prev => prev === 'sculpt' && activeTool === 'landscape_sculpt' ? null : 'sculpt');
              setConsoleOutput(c => [...c, `[Terrain Studio] Sculpt Terrain Surface active (${landscapeSculptSettings.mode.toUpperCase()} mode). Drag on terrain to sculpt.`]);
            }}
          />
        </div>

        {/* Divider between Tier 0.5 and Tier 1 */}
        <div className={horizontal ? "h-8 w-px bg-gray-200 dark:bg-gray-700 mx-1" : "w-8 h-px bg-gray-200 dark:bg-gray-700 my-1"} />

        {/* Tier 1: Corridors & Pathways */}
        <div className="relative group">
          <CivilToolButton
            tool="road"
            label="Corridors & Pathways"
            subtitle="Corridors & Pathways: Catmull-Rom spline alignment with curb, ditch & markings"
            icon={<Route size={20} />}
            active={activeTool === 'road'}
            onClick={() => {
              setActiveTool('road');
              setActiveTier(prev => prev === 'corridors' && activeTool === 'road' ? null : 'corridors');
              setConsoleOutput(c => [...c, '[Terrain Studio] Corridors & Pathways active: click to add road alignment control points.']);
            }}
          />
        </div>

        {/* Divider between Tier 1 and Tier 2 */}
        <div className={horizontal ? "h-8 w-px bg-gray-200 dark:bg-gray-700 mx-1" : "w-8 h-px bg-gray-200 dark:bg-gray-700 my-1"} />

        {/* Tier 2: Building & Grading Pads (Single unified icon combining Rect, Circle, and Surface Detailing) */}
        <div className="relative group">
          <CivilToolButton
            tool="pad-rect"
            label="Building & Grading Pads"
            subtitle="Building & Grading Pads: Platforms, batter daylight slopes, elevations & surface detailing"
            icon={<Layers size={20} />}
            active={isPadToolActive}
            badge={civilPadSettings.primitive === 'circle' ? 'Circle' : 'Rect'}
            onClick={() => {
              const nextTool = civilPadSettings.primitive === 'circle' ? 'pad-circle' : 'pad-rect';
              setActiveTool(nextTool);
              setActiveTier(prev => prev === 'pads' && isPadToolActive ? null : 'pads');
              setConsoleOutput(c => [...c, `[Terrain Studio] Building & Grading Pads active (${civilPadSettings.primitive}). Click terrain to position pad.`]);
            }}
          />
        </div>

        {/* Additional Civil Actions & Inspection Tools */}
        <div className={horizontal ? "ml-auto flex items-center gap-1" : "mt-auto flex flex-col items-center gap-1"}>
          {/* Earthwork Cut/Fill Volume Overlay Toggle */}
          <button
            type="button"
            onClick={() => setShowCutFillOverlay(prev => !prev)}
            className={cn(
              "toolbar-btn relative transition-colors cursor-pointer",
              showCutFillOverlay && "toolbar-btn-active",
              theme === 'dark' ? "hover:bg-gray-700 text-gray-200" : "hover:bg-gray-200 text-gray-700"
            )}
            title={showCutFillOverlay ? "Hide Earthwork Cut/Fill Overlay (Orange/Cyan)" : "Show Earthwork Cut/Fill Overlay (Orange/Cyan)"}
          >
            {showCutFillOverlay ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>

          {/* Clear Highlights & Selection button (turns off persistent highlights) */}
          {hasActiveHighlights && (
            <button
              type="button"
              onClick={handleClearHighlightsAndSelection}
              className="toolbar-btn relative transition-colors text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer"
              title="Clear Highlights & Deselect Modifier"
            >
              <MousePointer2 size={18} />
            </button>
          )}

          {/* Bake to Model Modal */}
          <button
            type="button"
            onClick={() => setIsBakeModalOpen(true)}
            className="toolbar-btn relative transition-colors text-trimble-blue hover:bg-trimble-blue/10 dark:hover:bg-trimble-blue/20 cursor-pointer"
            title="Bake Civil Terrain to Model (Non-Destructive Mesh Baking)"
          >
            <HardHat size={18} />
          </button>
        </div>

        {/* Interactive Parametric Flyout / Drawer Panel for Active Tier (Styled as ToolModifierPalette) */}
        {activeTier && (
          <div 
            id="civil-tier-settings-panel"
            className={cn(
              "absolute z-50 w-80 rounded-xl border shadow-xl overflow-hidden text-xs select-none transition-all duration-200 flex flex-col",
              theme === 'dark' ? "bg-gray-900 border-gray-700 text-gray-200 shadow-black/50" : "bg-white border-gray-200 text-gray-800 shadow-xl",
              horizontal
                ? (dock === 'top' ? "top-full left-2 mt-2" : "bottom-full left-2 mb-2")
                : "left-full top-2 ml-2"
            )}
          >
            {/* Header matching ToolModifierPalette styling */}
            <div className={cn(
              "px-3 h-10 border-b flex items-center justify-between select-none shrink-0",
              theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-100"
            )}>
              <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[10px] text-gray-600 dark:text-gray-300">
                {activeTier === 'terrain' && (
                  <>
                    <Mountain size={14} className="text-trimble-blue" />
                    <span>Base Site Terrain</span>
                  </>
                )}
                {activeTier === 'sculpt' && (
                  <>
                    <Paintbrush size={14} className="text-trimble-blue" />
                    <span>Sculpt Terrain Surface</span>
                  </>
                )}
                {activeTier === 'corridors' && (
                  <>
                    <Route size={14} className="text-trimble-blue" />
                    <span>Corridors & Pathways</span>
                  </>
                )}
                {activeTier === 'pads' && (
                  <>
                    <Layers size={14} className="text-trimble-blue" />
                    <span>Building & Grading Pads</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-trimble-blue px-1.5 py-0.5 bg-trimble-blue/10 rounded font-bold">
                  {activeTier === 'terrain' ? 'TERRAIN' : activeTier === 'sculpt' ? 'SCULPT' : activeTier === 'corridors' ? 'ROAD' : 'PAD'}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTier(null)}
                  className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
                  title="Close Panel"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="p-3 space-y-4 max-h-[calc(100vh-140px)] overflow-y-auto select-text flex-1">
            {/* 1. Base Site Terrain Controls */}
            {activeTier === 'terrain' && (
              <div className="space-y-3.5">
                {/* Status card */}
                <div className={cn(
                  "p-2.5 rounded-xl border flex items-center gap-2.5 text-xs transition-colors",
                  activeTerrain 
                    ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300" 
                    : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/60 text-blue-800 dark:text-blue-300"
                )}>
                  {activeTerrain ? (
                    <Check size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <Activity size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
                  )}
                  <div className="leading-tight flex-1 min-w-0">
                    <div className="font-semibold truncate">
                      {selectedTerrain 
                        ? `Selected: ${selectedTerrain.name || 'Base Site Terrain'}`
                        : activeTerrain
                          ? `Active Site: ${terrainOptions.width}m × ${terrainOptions.depth}m` 
                          : 'No Terrain Canvas'}
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {activeTerrain 
                        ? `Grid: ${terrainOptions.resolution}×${terrainOptions.resolution} · Roughness: ${(terrainOptions.roughness * 100).toFixed(0)}%` 
                        : 'Add terrain canvas below to enable road & pad tools'}
                    </div>
                  </div>
                  {selectedTerrain && (
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="text-[10px] text-emerald-700 dark:text-emerald-300 hover:underline shrink-0 font-medium cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Topography Preset Selection */}
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1.5">Topography Preset</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'flat', label: 'Flat Site', desc: '0m Civil Grade' },
                      { id: 'rolling', label: 'Rolling Hills', desc: 'Gentle Organic' },
                      { id: 'ridge', label: 'Ridge / Slope', desc: 'Hillside' },
                      { id: 'terraced', label: 'Terraced', desc: 'Stepped Benches' }
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTerrainOptions(o => ({ ...o, topography: t.id as TopographyPreset }))}
                        className={cn(
                          "py-1.5 px-2 rounded-xl border text-left transition-all cursor-pointer",
                          terrainOptions.topography === t.id
                            ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue shadow-xs font-semibold"
                            : "bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                        )}
                      >
                        <div className="font-bold text-xs">{t.label}</div>
                        <div className="text-[9px] text-gray-500 dark:text-gray-400">{t.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dimensions: Width & Depth */}
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Site Width (X)</label>
                      <span className="font-mono text-trimble-blue font-semibold">{terrainOptions.width} m</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="150"
                      step="5"
                      value={terrainOptions.width}
                      onChange={(e) => setTerrainOptions(o => ({ ...o, width: parseInt(e.target.value, 10) || 50 }))}
                      className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Site Depth (Z)</label>
                      <span className="font-mono text-trimble-blue font-semibold">{terrainOptions.depth} m</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="150"
                      step="5"
                      value={terrainOptions.depth}
                      onChange={(e) => setTerrainOptions(o => ({ ...o, depth: parseInt(e.target.value, 10) || 50 }))}
                      className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                    />
                  </div>
                </div>

                {/* Terrain Roughness Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Terrain Roughness</label>
                    <span className="font-mono text-trimble-blue font-semibold">{(terrainOptions.roughness * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={terrainOptions.roughness}
                    onChange={(e) => handleRoughnessChange(parseFloat(e.target.value))}
                    className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                  />
                  <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                    <span>Smooth (0%)</span>
                    <span>Natural (50%)</span>
                    <span>Rugged (100%)</span>
                  </div>
                </div>

                {/* Grid Density */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Mesh Resolution</label>
                    <span className="font-mono text-gray-600 dark:text-gray-400">{terrainOptions.resolution} × {terrainOptions.resolution}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { res: 32, label: 'Standard (32)' },
                      { res: 48, label: 'Detailed (48)' },
                      { res: 64, label: 'Precision (64)' }
                    ].map(r => (
                      <button
                        key={r.res}
                        type="button"
                        onClick={() => setTerrainOptions(o => ({ ...o, resolution: r.res }))}
                        className={cn(
                          "py-1 rounded-xl border text-[11px] text-center font-medium transition-all cursor-pointer",
                          terrainOptions.resolution === r.res
                            ? "bg-trimble-blue text-white shadow-xs font-bold"
                            : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Texture preset */}
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1">Ground Material</label>
                  <select
                    value={terrainOptions.textureId}
                    onChange={(e) => setTerrainOptions(o => ({ ...o, textureId: e.target.value }))}
                    className="w-full h-8 px-2.5 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-700 outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                  >
                    {LANDSCAPE_TEXTURES.map(tex => (
                      <option key={tex.id} value={tex.id}>
                        {tex.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 space-y-2 border-t border-gray-200 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => handleAddOrUpdateTerrain()}
                    className="w-full py-2 px-3 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer bg-trimble-blue hover:bg-trimble-blue/90 text-white text-xs"
                  >
                    {existingTerrain ? (
                      <>
                        <RefreshCw size={14} />
                        <span>Update Terrain Canvas</span>
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        <span>Add Terrain to Design</span>
                      </>
                    )}
                  </button>

                  {existingTerrain && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleRegenerateHeights}
                        className="py-1.5 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <RefreshCw size={12} />
                        <span>Regen Heights</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleRemoveTerrain}
                        className="py-1.5 px-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Trash2 size={12} />
                        <span>Remove</span>
                      </button>
                    </div>
                  )}

                  {existingTerrain && (
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                      <button
                        type="button"
                        onClick={handleGradeFloorSlabs}
                        className="w-full py-1.5 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <Layers size={14} className="text-trimble-blue" />
                        <span>Grade Floor Slabs (1m Apron)</span>
                      </button>
                      <div className="text-[9px] text-gray-500 dark:text-gray-400 text-center mt-1">
                        Prevents terrain clipping into building floor slabs
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 2. Terrain Sculpting Controls */}
            {activeTier === 'sculpt' && (
              <div className="space-y-3.5">
                {/* Mode Selector */}
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1.5">
                    Sculpt Toolset Brush
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { mode: 'push', label: 'Push (Depress)', icon: <ArrowDownToLine size={13} />, desc: 'Excavate down' },
                      { mode: 'pull', label: 'Pull (Elevate)', icon: <ArrowUpFromLine size={13} />, desc: 'Raise mound' },
                      { mode: 'smooth', label: 'Smooth (Relax)', icon: <Waves size={13} />, desc: 'Blend surface' },
                      { mode: 'flatten', label: 'Flatten (Level)', icon: <MinusSquare size={13} />, desc: 'Level to plane' },
                    ].map(item => {
                      const isSelected = landscapeSculptSettings.mode === item.mode;
                      return (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => {
                            setLandscapeSculptSettings(s => ({ ...s, mode: item.mode as any }));
                            setActiveTool('landscape_sculpt');
                          }}
                          className={cn(
                            "py-2 px-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-0.5",
                            isSelected
                              ? "bg-trimble-blue text-white shadow-xs font-bold border-trimble-blue"
                              : "bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                          )}
                        >
                          <div className="flex items-center gap-1.5 text-xs font-semibold">
                            {item.icon}
                            <span>{item.label}</span>
                          </div>
                          <span className={cn("text-[9px]", isSelected ? "text-blue-100" : "text-gray-500 dark:text-gray-400")}>
                            {item.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Brush Radius Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Brush Radius</label>
                    <span className="font-mono text-trimble-blue font-semibold">{landscapeSculptSettings.radius.toFixed(1)} m</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="30.0"
                    step="0.5"
                    value={landscapeSculptSettings.radius}
                    onChange={(e) => setLandscapeSculptSettings(s => ({ ...s, radius: parseFloat(e.target.value) }))}
                    className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                  />
                  <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                    <span>1.0m (Fine)</span>
                    <span>Default: 6.0m</span>
                    <span>30.0m (Broad)</span>
                  </div>
                </div>

                {/* Brush Intensity Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Brush Intensity / Strength</label>
                    <span className="font-mono text-trimble-blue font-semibold">{Math.round(landscapeSculptSettings.intensity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.05"
                    max="1.0"
                    step="0.05"
                    value={landscapeSculptSettings.intensity}
                    onChange={(e) => setLandscapeSculptSettings(s => ({ ...s, intensity: parseFloat(e.target.value) }))}
                    className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                  />
                  <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                    <span>Gentle (5%)</span>
                    <span>Moderate (50%)</span>
                    <span>Aggressive (100%)</span>
                  </div>
                </div>

                {/* Boundary Edges Protection */}
                <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setLandscapeSculptSettings(s => ({ ...s, masked: !s.masked }))}
                    className={cn(
                      "w-full py-1.5 px-2.5 rounded-lg border flex items-center justify-between text-xs transition-colors cursor-pointer",
                      landscapeSculptSettings.masked
                        ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue font-semibold"
                        : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-750"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck size={14} className={landscapeSculptSettings.masked ? "text-trimble-blue" : "text-gray-400"} />
                      <span>Protect Boundary Edges</span>
                    </div>
                    <span className="text-[10px] font-mono">{landscapeSculptSettings.masked ? 'ON' : 'OFF'}</span>
                  </button>
                </div>

                {/* Global Utilities */}
                <div className="pt-2 border-t border-gray-200 dark:border-gray-800 space-y-1.5">
                  <div className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 mb-1">Quick Mesh Utilities</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={handleGlobalSmoothTerrain}
                      className="py-1.5 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Waves size={13} className="text-trimble-blue" />
                      <span>Global Smooth</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGlobalFlattenTerrain(0)}
                      className="py-1.5 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <MinusSquare size={13} className="text-trimble-blue" />
                      <span>Level to 0.0m</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleGradeFloorSlabs}
                    className="w-full py-1.5 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Layers size={13} className="text-trimble-blue" />
                    <span>Grade Slabs & 1m Apron</span>
                  </button>
                </div>
              </div>
            )}

            {/* 3. Corridors & Pathways Controls */}
            {activeTier === 'corridors' && (
              <div className="space-y-3.5">
                {/* Selected Road Status Banner */}
                {selectedRoad ? (
                  <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 font-semibold text-blue-900 dark:text-blue-200 truncate">
                      <Route size={14} className="shrink-0 text-trimble-blue" />
                      <span className="truncate">Active Road: {selectedRoad.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedModifierId(null)}
                      className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline shrink-0 ml-2 cursor-pointer font-medium"
                    >
                      Deselect
                    </button>
                  </div>
                ) : (
                  <div className="p-2 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/60 text-[11px] text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                    <MousePointer2 size={13} className="text-gray-400 shrink-0" />
                    <span>Adjust default parameters below or select a road to edit.</span>
                  </div>
                )}

                {/* Road Width */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Road Width</label>
                    <span className="font-mono text-trimble-blue font-semibold">{civilRoadSettings.width.toFixed(1)} m</span>
                  </div>
                  <input
                    type="range"
                    min="3.0"
                    max="18.0"
                    step="0.5"
                    value={civilRoadSettings.width}
                    onChange={(e) => handleUpdateRoadSetting({ width: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                  />
                  <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                    <span>3.0m</span>
                    <span>Standard: 6.0m</span>
                    <span>18.0m</span>
                  </div>
                </div>

                {/* Max Grade % Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Max Grade Threshold</label>
                    <span className={cn(
                      "font-mono font-semibold",
                      civilRoadSettings.maxGradePercent > 12 ? "text-amber-600 dark:text-amber-400" : "text-trimble-blue"
                    )}>
                      {civilRoadSettings.maxGradePercent.toFixed(1)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="20"
                    step="1"
                    value={civilRoadSettings.maxGradePercent}
                    onChange={(e) => handleUpdateRoadSetting({ maxGradePercent: parseFloat(e.target.value) })}
                    className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                  />
                  <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                    <span>2%</span>
                    <span>Civil Std: 8%</span>
                    <span>20%</span>
                  </div>
                </div>

                {/* Curb & Ditch Toggles */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleUpdateRoadSetting({ hasCurb: !civilRoadSettings.hasCurb })}
                    className={cn(
                      "py-2 px-3 rounded-lg border font-semibold flex items-center justify-between transition-all cursor-pointer",
                      civilRoadSettings.hasCurb
                        ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue shadow-xs"
                        : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                    )}
                  >
                    <span>Curb</span>
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-bold",
                      civilRoadSettings.hasCurb ? "bg-trimble-blue text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                    )}>
                      {civilRoadSettings.hasCurb ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateRoadSetting({ hasDitch: !civilRoadSettings.hasDitch })}
                    className={cn(
                      "py-2 px-3 rounded-lg border font-semibold flex items-center justify-between transition-all cursor-pointer",
                      civilRoadSettings.hasDitch
                        ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue shadow-xs"
                        : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                    )}
                  >
                    <span>Ditch</span>
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-bold",
                      civilRoadSettings.hasDitch ? "bg-trimble-blue text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                    )}>
                      {civilRoadSettings.hasDitch ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>

                {/* Road / Pathway Material Dropdown */}
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1">Road / Pathway Material</label>
                  <select
                    value={civilRoadSettings.material || 'asphalt-weathered'}
                    onChange={(e) => handleUpdateRoadSetting({ material: e.target.value })}
                    className="w-full h-8 px-2.5 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-700 outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                  >
                    <optgroup label="Roadways">
                      {ROAD_MATERIALS.filter(m => m.category === 'road').map(mat => (
                        <option key={mat.id} value={mat.id}>
                          {mat.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Pathways & Trails">
                      {ROAD_MATERIALS.filter(m => m.category === 'pathway').map(mat => (
                        <option key={mat.id} value={mat.id}>
                          {mat.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {/* Markings Preset Dropdown */}
                <div>
                  <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1">Road Markings Preset</label>
                  <select
                    value={civilRoadSettings.markings}
                    onChange={(e) => handleUpdateRoadSetting({ markings: e.target.value as RoadMarkingPreset })}
                    className="w-full h-8 px-2.5 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-700 outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                  >
                    <option value="none">None</option>
                    <option value="center-dashed">Center Dashed (Single Stripe)</option>
                    <option value="center-solid">Center Solid (No Passing)</option>
                    <option value="bike-lanes">Dual Bike Lanes</option>
                    <option value="pedestrian-walkway">Pedestrian Walkway Ribbon</option>
                  </select>
                </div>
              </div>
            )}

            {/* 4. Building & Grading Pads Controls (Unified with Surface Detailing) */}
            {activeTier === 'pads' && (
              <div className="space-y-3.5">
                {/* Sub-Tabs: Pad & Grading vs Surface Detailing */}
                <div className="grid grid-cols-2 gap-1 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setPadSubTab('geometry');
                      const tool = civilPadSettings.primitive === 'circle' ? 'pad-circle' : 'pad-rect';
                      setActiveTool(tool);
                    }}
                    className={cn(
                      "py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                      padSubTab === 'geometry'
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                    )}
                  >
                    <Layers size={13} />
                    <span>Pad & Grading</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPadSubTab('surface');
                      setActiveTool('striping');
                    }}
                    className={cn(
                      "py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                      padSubTab === 'surface'
                        ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                    )}
                  >
                    <Grid3X3 size={13} />
                    <span>Surface Detailing</span>
                  </button>
                </div>

                {/* SubTab 1: Pad Geometry & Grading */}
                {padSubTab === 'geometry' && (
                  <div className="space-y-3 animate-in fade-in duration-100">
                    {/* Active Pad Primitive selection: Rect vs Circle */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1">
                        Pad Shape
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTool('pad-rect');
                            setCivilPadSettings(s => ({ ...s, primitive: 'rectangle' }));
                            if (selectedPad) {
                              updateTerrainModifier(selectedPad.id, { primitive: 'rectangle' });
                            }
                          }}
                          className={cn(
                            "py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1.5 font-semibold text-xs transition-all cursor-pointer",
                            civilPadSettings.primitive === 'rectangle'
                              ? "bg-trimble-blue text-white border-trimble-blue shadow-xs font-bold"
                              : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                          )}
                        >
                          <Square size={13} />
                          <span>Rect Pad</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setActiveTool('pad-circle');
                            setCivilPadSettings(s => ({ ...s, primitive: 'circle' }));
                            if (selectedPad) {
                              updateTerrainModifier(selectedPad.id, { primitive: 'circle' });
                            }
                          }}
                          className={cn(
                            "py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1.5 font-semibold text-xs transition-all cursor-pointer",
                            civilPadSettings.primitive === 'circle'
                              ? "bg-trimble-blue text-white border-trimble-blue shadow-xs font-bold"
                              : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                          )}
                        >
                          <Circle size={13} />
                          <span>Circle Pad</span>
                        </button>
                      </div>
                    </div>

                    {/* Pad Dimensions / Sizing */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">
                          {civilPadSettings.primitive === 'rectangle' ? 'Pad Dimensions (Width × Depth)' : 'Pad Diameter'}
                        </label>
                        <span className="font-mono text-trimble-blue font-semibold">
                          {civilPadSettings.primitive === 'rectangle'
                            ? `${civilPadSettings.dimensions[0].toFixed(1)}m × ${civilPadSettings.dimensions[1].toFixed(1)}m`
                            : `${civilPadSettings.dimensions[0].toFixed(1)}m Ø`}
                        </span>
                      </div>

                      {civilPadSettings.primitive === 'rectangle' ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 w-8 font-mono">W (X):</span>
                            <input
                              type="range"
                              min="2.0"
                              max="60.0"
                              step="1.0"
                              value={civilPadSettings.dimensions[0]}
                              onChange={(e) => {
                                const w = parseFloat(e.target.value) || 2;
                                setCivilPadSettings(s => ({ ...s, dimensions: [w, s.dimensions[1]] }));
                                if (selectedPad) {
                                  updateTerrainModifier(selectedPad.id, { dimensions: [w, selectedPad.dimensions[1]] });
                                }
                              }}
                              className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                            />
                            <input
                              type="number"
                              min="2"
                              max="100"
                              step="0.5"
                              value={civilPadSettings.dimensions[0]}
                              onChange={(e) => {
                                const w = parseFloat(e.target.value) || 2;
                                setCivilPadSettings(s => ({ ...s, dimensions: [w, s.dimensions[1]] }));
                                if (selectedPad) {
                                  updateTerrainModifier(selectedPad.id, { dimensions: [w, selectedPad.dimensions[1]] });
                                }
                              }}
                              className="w-14 h-7 px-1.5 py-0.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-right text-xs font-mono text-gray-900 dark:text-gray-100"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 w-8 font-mono">D (Z):</span>
                            <input
                              type="range"
                              min="2.0"
                              max="60.0"
                              step="1.0"
                              value={civilPadSettings.dimensions[1]}
                              onChange={(e) => {
                                const d = parseFloat(e.target.value) || 2;
                                setCivilPadSettings(s => ({ ...s, dimensions: [s.dimensions[0], d] }));
                                if (selectedPad) {
                                  updateTerrainModifier(selectedPad.id, { dimensions: [selectedPad.dimensions[0], d] });
                                }
                              }}
                              className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                            />
                            <input
                              type="number"
                              min="2"
                              max="100"
                              step="0.5"
                              value={civilPadSettings.dimensions[1]}
                              onChange={(e) => {
                                const d = parseFloat(e.target.value) || 2;
                                setCivilPadSettings(s => ({ ...s, dimensions: [s.dimensions[0], d] }));
                                if (selectedPad) {
                                  updateTerrainModifier(selectedPad.id, { dimensions: [selectedPad.dimensions[0], d] });
                                }
                              }}
                              className="w-14 h-7 px-1.5 py-0.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-right text-xs font-mono text-gray-900 dark:text-gray-100"
                            />
                          </div>

                          {/* Quick Presets for Rect Pad */}
                          <div className="grid grid-cols-4 gap-1 pt-0.5">
                            {[
                              { w: 6, d: 6, label: '6×6m' },
                              { w: 12, d: 10, label: '12×10m' },
                              { w: 20, d: 15, label: '20×15m' },
                              { w: 30, d: 20, label: '30×20m' },
                            ].map(pre => (
                              <button
                                key={pre.label}
                                type="button"
                                onClick={() => {
                                  setCivilPadSettings(s => ({ ...s, dimensions: [pre.w, pre.d] }));
                                  if (selectedPad) {
                                    updateTerrainModifier(selectedPad.id, { dimensions: [pre.w, pre.d] });
                                  }
                                }}
                                className={cn(
                                  "py-1 px-1 rounded-lg border text-[10px] font-mono text-center transition-colors cursor-pointer",
                                  civilPadSettings.dimensions[0] === pre.w && civilPadSettings.dimensions[1] === pre.d
                                    ? "bg-trimble-blue text-white font-bold border-trimble-blue"
                                    : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                                )}
                              >
                                {pre.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500 w-8 font-mono">Diam:</span>
                            <input
                              type="range"
                              min="2.0"
                              max="60.0"
                              step="1.0"
                              value={civilPadSettings.dimensions[0]}
                              onChange={(e) => {
                                const diam = parseFloat(e.target.value) || 2;
                                setCivilPadSettings(s => ({ ...s, dimensions: [diam, diam] }));
                                if (selectedPad) {
                                  updateTerrainModifier(selectedPad.id, { dimensions: [diam, diam] });
                                }
                              }}
                              className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                            />
                            <input
                              type="number"
                              min="2"
                              max="100"
                              step="0.5"
                              value={civilPadSettings.dimensions[0]}
                              onChange={(e) => {
                                const diam = parseFloat(e.target.value) || 2;
                                setCivilPadSettings(s => ({ ...s, dimensions: [diam, diam] }));
                                if (selectedPad) {
                                  updateTerrainModifier(selectedPad.id, { dimensions: [diam, diam] });
                                }
                              }}
                              className="w-14 h-7 px-1.5 py-0.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-right text-xs font-mono text-gray-900 dark:text-gray-100"
                            />
                          </div>

                          {/* Quick Presets for Circle Pad */}
                          <div className="grid grid-cols-4 gap-1 pt-0.5">
                            {[
                              { d: 6, label: '6m Ø' },
                              { d: 12, label: '12m Ø' },
                              { d: 20, label: '20m Ø' },
                              { d: 30, label: '30m Ø' },
                            ].map(pre => (
                              <button
                                key={pre.label}
                                type="button"
                                onClick={() => {
                                  setCivilPadSettings(s => ({ ...s, dimensions: [pre.d, pre.d] }));
                                  if (selectedPad) {
                                    updateTerrainModifier(selectedPad.id, { dimensions: [pre.d, pre.d] });
                                  }
                                }}
                                className={cn(
                                  "py-1 px-1 rounded-lg border text-[10px] font-mono text-center transition-colors cursor-pointer",
                                  civilPadSettings.dimensions[0] === pre.d
                                    ? "bg-trimble-blue text-white font-bold border-trimble-blue"
                                    : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                                )}
                              >
                                {pre.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Batter Falloff Distance Slider */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Batter Falloff Distance</label>
                        <span className="font-mono text-trimble-blue font-semibold">{civilPadSettings.batterDistance.toFixed(1)} m</span>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="12.0"
                        step="0.5"
                        value={civilPadSettings.batterDistance}
                        onChange={(e) => {
                          const dist = parseFloat(e.target.value);
                          setCivilPadSettings(s => ({ ...s, batterDistance: dist }));
                          if (selectedPad) {
                            updateTerrainModifier(selectedPad.id, { batterDistance: dist });
                          }
                        }}
                        className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                      />
                      <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                        <span>1.0m (Steep)</span>
                        <span>Default: 3.0m</span>
                        <span>12.0m (Gentle)</span>
                      </div>
                    </div>

                    {/* Batter Profile Selector */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1">Batter Profile</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['linear', 'curved', 'stepped'] as BatterFalloffType[]).map((prof) => (
                          <button
                            key={prof}
                            type="button"
                            onClick={() => {
                              setCivilPadSettings(s => ({ ...s, batterProfile: prof }));
                              if (selectedPad) {
                                updateTerrainModifier(selectedPad.id, { batterProfile: prof });
                              }
                            }}
                            className={cn(
                              "py-1.5 px-2 rounded-lg border text-center capitalize text-xs transition-all cursor-pointer",
                              civilPadSettings.batterProfile === prof
                                ? "bg-trimble-blue text-white font-bold border-trimble-blue shadow-xs"
                                : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                            )}
                          >
                            {prof}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Target Elevation */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1">Target Elevation</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.5"
                          value={civilPadSettings.targetElevation}
                          onChange={(e) => {
                            const elev = parseFloat(e.target.value) || 0;
                            setCivilPadSettings(s => ({ ...s, targetElevation: elev }));
                            if (selectedPad) {
                              updateTerrainModifier(selectedPad.id, { targetElevation: elev });
                            }
                          }}
                          className="w-full h-8 px-2.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs font-mono outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                        />
                        <span className="text-gray-500 text-xs font-mono">meters</span>
                      </div>
                    </div>

                    {/* Commit Location & Grade Terrain Action */}
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-800 space-y-2">
                      <button
                        type="button"
                        onClick={() => handleCommitPadToTerrain()}
                        className="w-full py-2.5 px-3 rounded-lg bg-trimble-blue hover:bg-trimble-blue/90 text-white font-bold flex items-center justify-center gap-2 text-xs shadow-xs transition-all cursor-pointer"
                      >
                        <CheckCircle2 size={16} />
                        <span>Commit Location & Grade Terrain</span>
                      </button>
                      <p className="text-[9px] text-gray-500 dark:text-gray-400 text-center leading-tight">
                        Levels terrain under pad to EL {civilPadSettings.targetElevation >= 0 ? '+' : ''}{civilPadSettings.targetElevation}m and computes {civilPadSettings.batterDistance}m daylight batter.
                      </p>

                      <button
                        type="button"
                        onClick={handleGradeFloorSlabs}
                        className="w-full py-1.5 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Layers size={13} className="text-trimble-blue" />
                        <span>Grade Slabs & 1m Apron</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* SubTab 2: Surface Detailing & Striping (Combined into Building & Grading Pads) */}
                {padSubTab === 'surface' && (
                  <div className="space-y-3 animate-in fade-in duration-100">
                    <div className="p-2.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 text-[11px] leading-relaxed">
                      Select or click a pad in the viewport to apply parking stall bay striping directly onto the pad platform.
                    </div>

                    {/* Stall Angle Selector */}
                    <div>
                      <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1.5">Stall Angle</label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {([0, 45, 60, 90] as ParkingAngle[]).map((ang) => (
                          <button
                            key={ang}
                            type="button"
                            onClick={() => setCivilStripingSettings(s => ({ ...s, angle: ang }))}
                            className={cn(
                              "py-1.5 rounded-lg border text-center font-mono text-xs transition-all cursor-pointer",
                              civilStripingSettings.angle === ang
                                ? "bg-trimble-blue text-white font-bold border-trimble-blue shadow-xs"
                                : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                            )}
                          >
                            {ang}°
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Stall Width */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400">Stall Width</label>
                        <span className="font-mono text-trimble-blue font-semibold">{civilStripingSettings.stallWidth.toFixed(2)} m</span>
                      </div>
                      <input
                        type="range"
                        min="2.2"
                        max="3.8"
                        step="0.05"
                        value={civilStripingSettings.stallWidth}
                        onChange={(e) => setCivilStripingSettings(s => ({ ...s, stallWidth: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                      />
                      <div className="flex justify-between text-[9px] text-gray-500 dark:text-gray-400 font-mono mt-0.5">
                        <span>2.2m (Compact)</span>
                        <span>Default: 2.7m</span>
                        <span>3.8m (Accessible)</span>
                      </div>
                    </div>

                    {/* Double-Row Toggle */}
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setCivilStripingSettings(s => ({ ...s, doubleRow: !s.doubleRow }))}
                        className={cn(
                          "w-full py-2 px-3 rounded-lg border font-semibold flex items-center justify-between transition-all cursor-pointer",
                          civilStripingSettings.doubleRow
                            ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue shadow-xs"
                            : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                        )}
                      >
                        <span>Double-Row Stall Bay</span>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-bold",
                          civilStripingSettings.doubleRow ? "bg-trimble-blue text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                        )}>
                          {civilStripingSettings.doubleRow ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </button>
                    </div>

                    {/* Action Buttons: Apply & Remove Striping */}
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-800 space-y-1.5">
                      <button
                        type="button"
                        onClick={handleApplyStripingToPad}
                        className="w-full py-2 px-3 rounded-lg bg-trimble-blue hover:bg-trimble-blue/90 text-white font-semibold flex items-center justify-center gap-1.5 text-xs shadow-xs cursor-pointer"
                      >
                        <Grid3X3 size={14} />
                        <span>Apply Striping to Pad</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleRemoveStripingFromPad}
                        className="w-full py-1.5 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-gray-600 dark:text-gray-400 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Trash2 size={12} />
                        <span>Remove Striping</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        )}
      </aside>
    </FlyoutSideContext.Provider>
  );
}
