import React, { useRef, useState, createContext, useContext } from 'react';
import { 
  Building2, 
  DoorOpen, 
  AppWindow, 
  Layers, 
  TrendingUp, 
  X,
  Maximize2,
  Settings2,
  Info,
  ChevronRight,
  Plus,
  Home,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../AppContext';
import { ToolType, Shape } from '../types';
import { cn } from '../lib/utils';
import { FlyoutPortal } from './ui/FlyoutPortal';
import { buildRoofShapeForRoom, buildRoofAssemblyForRoom, buildNextFloorLevel } from '../lib/archRoofGenerator';

/** Same pattern as LeftToolbar's own FlyoutSideContext — a context rather
 *  than threading a `side` prop through every ArchToolButton call site. */
const FlyoutSideContext = createContext<'right' | 'bottom'>('right');

interface ArchToolButtonProps {
  tool: ToolType;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  hotkey?: string;
  children?: React.ReactNode;
}

function ArchToolButton({ tool, icon, label, subtitle, hotkey, children }: ArchToolButtonProps) {
  const { activeTool, setActiveTool, bannerColor, theme, toolbarVisibility } = useApp();
  const isActive = activeTool === tool;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const flyoutSide = useContext(FlyoutSideContext);

  if (toolbarVisibility[tool] === false) return null;

  return (
    <div className="relative group">
      <button
        ref={buttonRef}
        id={`arch-tool-${tool}`}
        onClick={() => setActiveTool(tool)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "toolbar-btn relative flex items-center justify-center transition-all",
          isActive && "toolbar-btn-active ring-2 ring-offset-1 ring-trimble-blue shadow-md",
          theme === 'dark' ? "hover:bg-gray-700 text-gray-200" : "hover:bg-gray-100 text-gray-700"
        )}
        style={isActive ? { borderColor: bannerColor, color: bannerColor } : undefined}
      >
        {icon}

        <FlyoutPortal anchorRef={buttonRef} open={hovered} side={flyoutSide}>
          {hovered && (
            <div className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-md whitespace-nowrap shadow-xl border border-gray-700 pointer-events-none z-50">
              <div className="font-semibold flex items-center gap-1.5">
                <span>{label}</span>
                {hotkey && <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-300 font-mono">({hotkey})</span>}
              </div>
              <div className="text-[10px] text-gray-400 font-normal">{subtitle}</div>
            </div>
          )}
        </FlyoutPortal>
      </button>
      {children}
    </div>
  );
}

interface ArchitectureToolbarProps {
  /** Which edge this toolbar is currently docked to — see LeftToolbar's
   *  own doc comment on the identical prop for the full rationale.
   *  Defaults to 'left', matching how this toolbar has always looked. */
  dock?: 'left' | 'top' | 'bottom';
}

export default function ArchitectureToolbar({ dock = 'left' }: ArchitectureToolbarProps = {}) {
  const horizontal = dock !== 'left';
  const flyoutSide: 'right' | 'bottom' = horizontal ? 'bottom' : 'right';
  const { 
    isArchitectureToolbarEnabled, 
    theme, 
    bannerColor,
    activeTool,
    setActiveTool,
    wallToolSettings,
    setWallToolSettings,
    wallJustification,
    setWallJustification,
    activeStory,
    setActiveStory,
    shapes,
    addShape,
    commitHistory,
    setMeasurements
  } = useApp();

  const [showWallOptions, setShowWallOptions] = useState(false);
  const [showRoofOptions, setShowRoofOptions] = useState(false);

  if (!isArchitectureToolbarEnabled) return null;

  // Handle Multi-Story Stacking action
  const handleStackStory = () => {
    const wallShapes = shapes.filter(s => s.type === 'wall');
    if (wallShapes.length === 0) {
      setMeasurements('No walls found to stack. Draw a room first.');
      return;
    }
    const { newWalls, newOpenings, newSlabs } = buildNextFloorLevel(wallShapes, shapes, true);
    newWalls.forEach(w => addShape(w));
    newOpenings.forEach(op => addShape(op));
    newSlabs.forEach(slab => addShape(slab));
    commitHistory();
    setActiveStory(prev => prev + 1);
    setMeasurements(`Stacked new Story Level ${activeStory + 1} with floor slab and walls.`);
  };

  // Handle Roof Generation action
  const handleGenerateRoof = (roofType: 'gable' | 'hip') => {
    const wallShapes = shapes.filter(s => s.type === 'wall');
    if (wallShapes.length === 0) {
      setMeasurements('No walls found. Draw a closed room to generate a roof.');
      return;
    }
    const assembly = buildRoofAssemblyForRoom(wallShapes, { roofType, pitchAngleDeg: 35, usePitchAngle: true, color: '#991b1b', fasciaColor: '#ffffff' }, shapes);
    if (assembly) {
      assembly.allShapes.forEach(s => addShape(s));
      commitHistory();
      setMeasurements(`Created ${roofType === 'hip' ? 'Hip' : 'Gable'} Roof assembly with all constituent parts.`);
    }
  };

  return (
    <FlyoutSideContext.Provider value={flyoutSide}>
    <aside 
      id="architecture-toolbar"
      aria-label="Basic Architecture Toolbar"
      className={cn(
        horizontal
          ? cn("h-12 flex flex-row items-center px-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative", dock === 'top' ? "border-b" : "border-t")
          : "w-12 border-r flex flex-col items-center py-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative",
        theme === 'dark' ? "bg-gray-850 border-gray-700" : "bg-slate-50/90 border-gray-200"
      )}
    >
      {/* Architectural Tools */}
      <ArchToolButton 
        tool="wall" 
        icon={<Maximize2 size={19} className="rotate-45" />} 
        label="Wall Tool" 
        subtitle="Continuous 3D walls with inference snapping & miters (Hotkey: W)"
        hotkey="W"
      />

      <ArchToolButton 
        tool="door" 
        icon={<DoorOpen size={19} />} 
        label="Door Assembly" 
        subtitle="Standard framed door with panel and handle (0.9m × 2.1m)"
      />

      <ArchToolButton 
        tool="window" 
        icon={<AppWindow size={19} />} 
        label="Window Frame" 
        subtitle="4-pane architectural window with sill ledge (1.2m × 1.2m)"
      />

      <ArchToolButton 
        tool="step" 
        icon={<Layers size={19} />} 
        label="Single Step / Riser" 
        subtitle="Architectural step with nosing (1.0m × 0.3m × 0.18m)"
      />

      <ArchToolButton 
        tool="staircase" 
        icon={<TrendingUp size={19} />} 
        label="Staircase Flight" 
        subtitle="12-step architectural staircase flight (Rise 2.16m, Run 3.6m)"
      />

      <div className={cn("my-1 border-t", horizontal ? "h-6 border-l border-t-0 my-0 mx-1" : "w-8", theme === 'dark' ? "border-gray-700" : "border-gray-200")} />

      {/* Story Level Stacking */}
      <button
        id="arch-stack-story-btn"
        onClick={handleStackStory}
        title="Stack Next Story Level (Duplicates ground floor walls + ceiling slab)"
        className={cn(
          "toolbar-btn relative flex items-center justify-center transition-all",
          theme === 'dark' ? "hover:bg-gray-700 text-cyan-400" : "hover:bg-gray-100 text-cyan-600"
        )}
      >
        <Building2 size={18} />
      </button>

      {/* Parametric Roof Generator */}
      <div className="relative">
        <button
          id="arch-roof-menu-btn"
          onClick={() => setShowRoofOptions(!showRoofOptions)}
          title="Parametric Roof Generator (Gable / Hip / Parapet)"
          className={cn(
            "toolbar-btn relative flex items-center justify-center transition-all",
            theme === 'dark' ? "hover:bg-gray-700 text-amber-400" : "hover:bg-gray-100 text-amber-600"
          )}
        >
          <Home size={18} />
        </button>

        {showRoofOptions && (
          <div 
            className={cn(
              "absolute left-14 top-0 z-50 p-2 rounded-xl shadow-2xl border text-xs min-w-[170px] space-y-1 backdrop-blur-md",
              theme === 'dark' ? "bg-gray-900/95 border-gray-700 text-white" : "bg-white/95 border-gray-200 text-gray-800"
            )}
          >
            <div className="font-bold text-[10px] uppercase text-gray-400 px-1 py-0.5">Generate Roof</div>
            <button
              onClick={() => { handleGenerateRoof('gable'); setShowRoofOptions(false); }}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-trimble-blue/15 hover:text-trimble-blue transition-colors flex items-center justify-between"
            >
              <span>Gable Roof (35°)</span>
              <span className="text-[10px] text-gray-400 font-mono">35°</span>
            </button>
            <button
              onClick={() => { handleGenerateRoof('hip'); setShowRoofOptions(false); }}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-trimble-blue/15 hover:text-trimble-blue transition-colors flex items-center justify-between"
            >
              <span>Hip Roof (4 slopes)</span>
              <span className="text-[10px] text-gray-400 font-mono">35°</span>
            </button>
          </div>
        )}
      </div>
    </aside>
    </FlyoutSideContext.Provider>
  );
}
