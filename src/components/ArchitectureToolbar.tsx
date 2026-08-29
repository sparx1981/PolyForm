import React, { useRef, useState } from 'react';
import { 
  Building2, 
  DoorOpen, 
  AppWindow, 
  Layers, 
  TrendingUp, 
  X,
  Maximize2,
  Settings2,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../AppContext';
import { ToolType } from '../types';
import { cn } from '../lib/utils';
import { FlyoutPortal } from './ui/FlyoutPortal';

interface ArchToolButtonProps {
  tool: ToolType;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  hotkey?: string;
}

function ArchToolButton({ tool, icon, label, subtitle, hotkey }: ArchToolButtonProps) {
  const { activeTool, setActiveTool, bannerColor, theme, toolbarVisibility } = useApp();
  const isActive = activeTool === tool;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);

  if (toolbarVisibility[tool] === false) return null;

  return (
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

      {/*
        No native title attribute (see the equivalent ToolButton/UnifiedToolRail
        comments): it renders at the OS/browser-chrome level, outside any CSS
        stacking context, so it cannot be reordered or suppressed relative to
        this custom tooltip — they simply compete for the same space with no
        way to referee it.

        Portaled to document.body: this toolbar is a SIBLING of LeftToolbar
        and LandscapesToolbar in App.tsx, and a child's z-index can never
        escape a losing tie between its own parent's container and a
        sibling toolbar's — see FlyoutPortal's own doc comment.
      */}
      <FlyoutPortal anchorRef={buttonRef} open={hovered}>
        {hovered && (
          <div className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-md whitespace-nowrap shadow-xl border border-gray-700 pointer-events-none">
            <div className="font-semibold flex items-center gap-1.5">
              <span>{label}</span>
              {hotkey && <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-300 font-mono">({hotkey})</span>}
            </div>
            <div className="text-[10px] text-gray-400 font-normal">{subtitle}</div>
          </div>
        )}
      </FlyoutPortal>
    </button>
  );
}

export default function ArchitectureToolbar() {
  const { 
    isArchitectureToolbarEnabled, 
    theme, 
    bannerColor,
    activeTool,
    setActiveTool
  } = useApp();

  if (!isArchitectureToolbarEnabled) return null;

  return (
    <aside 
      id="architecture-toolbar"
      aria-label="Basic Architecture Toolbar"
      className={cn(
        "w-12 border-r flex flex-col items-center py-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative",
        theme === 'dark' ? "bg-gray-850 border-gray-700" : "bg-slate-50/90 border-gray-200"
      )}
    >
      {/* Architectural Tools */}
      <ArchToolButton 
        tool="wall" 
        icon={<Maximize2 size={19} className="rotate-45" />} 
        label="Wall Tool" 
        subtitle="Click & drag or click to place wall segment (3m × 2.8m × 0.2m)"
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
    </aside>
  );
}
