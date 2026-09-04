import { 
  MousePointer2, 
  Eraser, 
  PaintBucket, 
  Box, 
  PenLine, 
  Square, 
  Circle, 
  Triangle as TriangleIcon,
  Cone,
  Circle as SphereIcon,
  Torus,
  Pyramid as PyramidIcon,
  Layers,
  Spline,
  Pentagon,
  Hexagon,
  Move, 
  RotateCw, 
  Maximize, 
  ArrowUpFromLine, 
  Search,
  MoreHorizontal,
  Orbit,
  Hand,
  ZoomIn,
  Sparkles,
  CircleDot,
  CornerUpRight,
  Code,
  Scissors,
  CircleDashed,
  Grab,
  Wand2,
  Ruler,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import { useRef, useState, createContext, useContext } from 'react';
import { FlyoutPortal } from './ui/FlyoutPortal';

/**
 * Which side tooltips/flyouts open toward — 'right' for the original
 * vertical (left-docked) layout, 'bottom' once this toolbar is docked to
 * the top or bottom edge instead. A context rather than a prop threaded
 * through every ToolButton call site (there are 16+ of them) — the value
 * is the same for every button in this toolbar at any given moment, so
 * there is nothing per-call-site to actually customize.
 */
const FlyoutSideContext = createContext<'right' | 'bottom'>('right');
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../AppContext';
import { ToolType } from '../types';
import { cn } from '../lib/utils';
import { DeveloperSDK } from '../services/developerService';

interface ToolButtonProps {
  tool: ToolType;
  icon: React.ReactNode;
  label: string;
}

function ToolButton({ tool, icon, label }: ToolButtonProps) {
  const { activeTool, setActiveTool, toolbarVisibility, setOpenMaterialsSignal } = useApp();
  const isActive = activeTool === tool;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const flyoutSide = useContext(FlyoutSideContext);

  if (toolbarVisibility[tool] === false) return null;

  return (
    <button
      ref={buttonRef}
      onClick={() => {
        setActiveTool(tool);
        if (tool === 'paint') setOpenMaterialsSignal((s: number) => s + 1);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "toolbar-btn relative",
        isActive && "toolbar-btn-active"
      )}
    >
      {icon}
      <FlyoutPortal anchorRef={buttonRef} open={hovered} side={flyoutSide}>
        {hovered && (
          <div className="px-2 py-1 bg-trimble-gray text-white text-xs rounded whitespace-nowrap shadow-modus-2 pointer-events-none">
            {label}
          </div>
        )}
      </FlyoutPortal>
    </button>
  );
}

interface LeftToolbarProps {
  layoutMode?: 'classic' | 'unified';
  /** Which edge this toolbar is currently docked to — governs whether it
   *  renders as its original vertical column or a horizontal strip, and
   *  which side its tooltips/flyouts open toward. Defaults to 'left',
   *  matching how this toolbar has always looked, so every OTHER caller
   *  (unified layout, anywhere dock doesn't apply) is unaffected. */
  dock?: 'left' | 'top' | 'bottom';
}

export default function LeftToolbar({ layoutMode, dock = 'left' }: LeftToolbarProps = {}) {
  const horizontal = dock !== 'left';
  const flyoutSide: 'right' | 'bottom' = horizontal ? 'bottom' : 'right';
  const { 
    isBasicToolbarEnabled,
    setIsAIRendererOpen, 
    setIsAIQueryOpen, 
    setIsAIGenerateOpen,
    theme, 
    bannerColor, 
    toolbarVisibility, 
    activeTool, 
    setActiveTool,
    showAllDimensions,
    setShowAllDimensions,
    activeBevelType,
    setActiveBevelType,
    activeBevelAmount,
    setActiveBevelAmount,
    pinnedScripts,
    developerScripts,
    shapes,
    setShapes,
    updateShapeColor,
    selectedId,
    setConsoleOutput,
    setIsWorldViewOpen,
    isWorldViewActive,
    triggerFocusOnMap
  } = useApp();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAIPopoutOpen, setIsAIPopoutOpen] = useState(false);
  const aiGroupRef = useRef<HTMLDivElement>(null);
  const [aiGroupHovered, setAiGroupHovered] = useState(false);
  const [is3DPopoutOpen, setIs3DPopoutOpen] = useState(false);
  const threeDGroupRef = useRef<HTMLDivElement>(null);
  const [threeDGroupHovered, setThreeDGroupHovered] = useState(false);
  const [isLinePopoutOpen, setIsLinePopoutOpen] = useState(false);
  const lineGroupRef = useRef<HTMLDivElement>(null);
  const [lineGroupHovered, setLineGroupHovered] = useState(false);
  const [isCirclePopoutOpen, setIsCirclePopoutOpen] = useState(false);
  const circleGroupRef = useRef<HTMLDivElement>(null);
  const [circleGroupHovered, setCircleGroupHovered] = useState(false);
  const [isBevelPopoutOpen, setIsBevelPopoutOpen] = useState(false);
  const bevelGroupRef = useRef<HTMLDivElement>(null);
  const [bevelGroupHovered, setBevelGroupHovered] = useState(false);
  const [isMeasurePopoutOpen, setIsMeasurePopoutOpen] = useState(false);
  const measureGroupRef = useRef<HTMLDivElement>(null);
  const [measureGroupHovered, setMeasureGroupHovered] = useState(false);
  const [hoverTimeout, setHoverTimeout] = useState<NodeJS.Timeout|null>(null);
  const [hover3DTimeout, setHover3DTimeout] = useState<NodeJS.Timeout|null>(null);
  const [hoverLineTimeout, setHoverLineTimeout] = useState<NodeJS.Timeout|null>(null);
  const [hoverCircleTimeout, setHoverCircleTimeout] = useState<NodeJS.Timeout|null>(null);
  const [hoverBevelTimeout, setHoverBevelTimeout] = useState<NodeJS.Timeout|null>(null);
  const [hoverMeasureTimeout, setHoverMeasureTimeout] = useState<NodeJS.Timeout|null>(null);

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

  const handleAIEnter = () => {
    if (hoverTimeout) clearTimeout(hoverTimeout);
    setIsAIPopoutOpen(true);
    setAiGroupHovered(true);
  };

  const handleAILeave = () => {
    const timeout = setTimeout(() => {
      setIsAIPopoutOpen(false);
    }, 300);
    setHoverTimeout(timeout);
    setAiGroupHovered(false);
  };

  const handle3DEnter = () => {
    if (hover3DTimeout) clearTimeout(hover3DTimeout);
    setIs3DPopoutOpen(true);
    setThreeDGroupHovered(true);
  };

  const handle3DLeave = () => {
    const timeout = setTimeout(() => {
      setIs3DPopoutOpen(false);
    }, 300);
    setHover3DTimeout(timeout);
    setThreeDGroupHovered(false);
  };

  const handleBevelEnter = () => {
    if (hoverBevelTimeout) clearTimeout(hoverBevelTimeout);
    setIsBevelPopoutOpen(true);
    setBevelGroupHovered(true);
  };

  const handleBevelLeave = () => {
    const timeout = setTimeout(() => {
      setIsBevelPopoutOpen(false);
    }, 300);
    setHoverBevelTimeout(timeout);
    setBevelGroupHovered(false);
  };

  const handleMeasureEnter = () => {
    if (hoverMeasureTimeout) clearTimeout(hoverMeasureTimeout);
    setIsMeasurePopoutOpen(true);
    setMeasureGroupHovered(true);
  };

  const handleMeasureLeave = () => {
    const timeout = setTimeout(() => {
      setIsMeasurePopoutOpen(false);
    }, 300);
    setHoverMeasureTimeout(timeout);
    setMeasureGroupHovered(false);
  };

  const handleLineEnter = () => {
    if (hoverLineTimeout) clearTimeout(hoverLineTimeout);
    setIsLinePopoutOpen(true);
    setLineGroupHovered(true);
  };

  const handleLineLeave = () => {
    const timeout = setTimeout(() => {
      setIsLinePopoutOpen(false);
    }, 300);
    setHoverLineTimeout(timeout);
    setLineGroupHovered(false);
  };

  const handleCircleEnter = () => {
    if (hoverCircleTimeout) clearTimeout(hoverCircleTimeout);
    setIsCirclePopoutOpen(true);
    setCircleGroupHovered(true);
  };

  const handleCircleLeave = () => {
    const timeout = setTimeout(() => {
      setIsCirclePopoutOpen(false);
    }, 300);
    setHoverCircleTimeout(timeout);
    setCircleGroupHovered(false);
  };

  const is3DActive = ['sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool);

  if (!isBasicToolbarEnabled) return null;

  return (
    <FlyoutSideContext.Provider value={flyoutSide}>
    <aside className={cn(
      horizontal
        ? cn("h-12 flex flex-row items-center px-2 gap-1 z-40 transition-colors duration-300", dock === 'top' ? "border-b" : "border-t")
        : "w-12 border-r flex flex-col items-center py-2 gap-1 z-40 transition-colors duration-300",
      theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
    )}>
      <div 
        className="relative"
        ref={aiGroupRef}
        onMouseEnter={handleAIEnter}
        onMouseLeave={handleAILeave}
      >
        <button 
          onClick={() => setIsAIQueryOpen(true)}
          className={cn("toolbar-btn transition-colors relative", horizontal ? "mr-2" : "mb-2")}
          style={{ color: bannerColor }}
        >
          <Sparkles size={20} />
        </button>

        <FlyoutPortal anchorRef={aiGroupRef} open={aiGroupHovered && !isAIPopoutOpen} side={flyoutSide}>
          {aiGroupHovered && !isAIPopoutOpen && (
            <div className="px-2 py-1 bg-trimble-gray text-white text-xs rounded whitespace-nowrap shadow-modus-2 pointer-events-none">
              AI Model Query
            </div>
          )}
        </FlyoutPortal>

        <FlyoutPortal anchorRef={aiGroupRef} open={isAIPopoutOpen} side={flyoutSide}>
          <div onMouseEnter={handleAIEnter} onMouseLeave={handleAILeave}>
            <AnimatePresence>
              {isAIPopoutOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className={cn(
                    "border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[140px]",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                  )}
                >
                  <button 
                    onClick={() => setIsAIQueryOpen(true)}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700"
                    )}
                  >
                    <Sparkles size={16} style={{ color: bannerColor }} />
                    <span>AI Query</span>
                  </button>
                  <button 
                    onClick={() => setIsAIRendererOpen(true)}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700"
                    )}
                  >
                    <Search size={16} style={{ color: bannerColor }} />
                    <span>AI Renderer</span>
                  </button>
                  <button 
                    onClick={() => setIsAIGenerateOpen(true)}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700"
                    )}
                  >
                    <Wand2 size={16} style={{ color: bannerColor }} />
                    <span>AI Generate</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </FlyoutPortal>
      </div>
      
      <ToolButton tool="select" icon={<MousePointer2 size={20} />} label="Select (Space)" />
      <ToolButton tool="eraser" icon={<Eraser size={20} />} label="Eraser (E) - click: delete object, Shift+click: delete surface" />
      <ToolButton tool="paint" icon={<PaintBucket size={20} />} label="Paint Bucket (B) - click: face/sub-face, Shift+click: whole object" />
      <ToolButton tool="component" icon={<Box size={20} />} label="Make Component (G)" />
      
      <div className={horizontal ? "h-8 w-px bg-gray-200 mx-1" : "w-8 h-px bg-gray-200 my-1"} />
      
      <div 
        className="relative"
        ref={lineGroupRef}
        onMouseEnter={handleLineEnter}
        onMouseLeave={handleLineLeave}
      >
        <button 
          onClick={() => setActiveTool('line')}
          className={cn(
            "toolbar-btn transition-colors relative",
            (activeTool === 'line' || activeTool === 'poly' || activeTool === 'bezier' || activeTool === 'arc') && "toolbar-btn-active"
          )}
        >
          {activeTool === 'poly' ? <Pentagon size={20} /> : activeTool === 'bezier' || activeTool === 'arc' ? <Spline size={20} /> : <PenLine size={20} />}
        </button>

        {/*
          No native title here (see ToolButton's own comment): the group
          icon and its flyout are both visible at once whenever this
          tool group is hovered, so a browser-native tooltip and this
          popover ended up overlapping — a native tooltip renders at the
          OS/browser-chrome level and simply cannot be reordered or
          suppressed by any CSS z-index. This custom tooltip is a normal
          page element instead, so it participates in the SAME stacking
          order as the flyout beside it and never fights it for space.

          Both this tooltip and the flyout below are portaled: LeftToolbar,
          ArchitectureToolbar and LandscapesToolbar are SIBLINGS in
          App.tsx, so a z-index on either only ever wins ties within its
          OWN toolbar's stacking context — it can still lose outright to a
          sibling toolbar that happens to render later in the DOM. Portaling
          to document.body sidesteps that entirely.
        */}
        <FlyoutPortal anchorRef={lineGroupRef} open={lineGroupHovered && !isLinePopoutOpen} side={flyoutSide}>
          {lineGroupHovered && !isLinePopoutOpen && (
            <div className="px-2 py-1 bg-trimble-gray text-white text-xs rounded whitespace-nowrap shadow-modus-2 pointer-events-none">
              Line, Poly, Bézier & Arc Tools
            </div>
          )}
        </FlyoutPortal>

        <FlyoutPortal anchorRef={lineGroupRef} open={isLinePopoutOpen} side={flyoutSide}>
          <div onMouseEnter={handleLineEnter} onMouseLeave={handleLineLeave}>
            <AnimatePresence>
              {isLinePopoutOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className={cn(
                    "border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[150px]",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                  )}
                >
                  <button 
                    onClick={() => setActiveTool('line')}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      activeTool === 'line' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <PenLine size={16} />
                    <span>Line Tool (L)</span>
                  </button>
                  <button 
                    onClick={() => setActiveTool('poly')}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      activeTool === 'poly' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <Pentagon size={16} />
                    <span>Poly Line Tool</span>
                  </button>
                  <button 
                    onClick={() => setActiveTool('bezier')}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      activeTool === 'bezier' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <Spline size={16} />
                    <span>Bézier Curve Tool</span>
                  </button>
                  <button
                    onClick={() => setActiveTool('arc')}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      activeTool === 'arc' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <Spline size={16} />
                    <span>Arc Tool</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </FlyoutPortal>
      </div>

      <ToolButton tool="rectangle" icon={<Square size={20} />} label="Rectangle (R)" />

      {/* Circle, Polygon & Triangle Group Flyout */}
      <div 
        className="relative"
        ref={circleGroupRef}
        onMouseEnter={handleCircleEnter}
        onMouseLeave={handleCircleLeave}
      >
        <button 
          onClick={() => setActiveTool('circle')}
          className={cn(
            "toolbar-btn transition-colors relative",
            (activeTool === 'circle' || activeTool === 'polygon' || activeTool === 'triangle' || activeTool === 'rectangle') && "toolbar-btn-active"
          )}
        >
          {activeTool === 'polygon' ? <Hexagon size={20} /> : activeTool === 'triangle' ? <TriangleIcon size={20} /> : activeTool === 'rectangle' ? <Square size={20} /> : <Circle size={20} />}
        </button>

        <FlyoutPortal anchorRef={circleGroupRef} open={circleGroupHovered && !isCirclePopoutOpen} side={flyoutSide}>
          {circleGroupHovered && !isCirclePopoutOpen && (
            <div className="px-2 py-1 bg-trimble-gray text-white text-xs rounded whitespace-nowrap shadow-modus-2 pointer-events-none">
              Circle & Polygon Tools
            </div>
          )}
        </FlyoutPortal>

        <FlyoutPortal anchorRef={circleGroupRef} open={isCirclePopoutOpen} side={flyoutSide}>
          <div onMouseEnter={handleCircleEnter} onMouseLeave={handleCircleLeave}>
            <AnimatePresence>
              {isCirclePopoutOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className={cn(
                    "border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[160px]",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                  )}
                >
                  <button 
                    onClick={() => setActiveTool('circle')}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      activeTool === 'circle' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <Circle size={16} />
                    <span>Circle Tool (C)</span>
                  </button>
                  <button 
                    onClick={() => setActiveTool('polygon')}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      activeTool === 'polygon' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <Hexagon size={16} />
                    <span>Polygon Tool (Pg)</span>
                  </button>
                  <button 
                    onClick={() => setActiveTool('triangle')}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      activeTool === 'triangle' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <TriangleIcon size={16} />
                    <span>Triangle (T)</span>
                  </button>
                  <button 
                    onClick={() => setActiveTool('rectangle')}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      activeTool === 'rectangle' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <Square size={16} />
                    <span>Rectangle (R)</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </FlyoutPortal>
      </div>

      <div 
        className="relative"
        ref={threeDGroupRef}
        onMouseEnter={handle3DEnter}
        onMouseLeave={handle3DLeave}
      >
        <button 
          className={cn(
            "toolbar-btn transition-colors relative",
            is3DActive && "toolbar-btn-active"
          )}
        >
          <Cone size={20} />
        </button>

        <FlyoutPortal anchorRef={threeDGroupRef} open={threeDGroupHovered && !is3DPopoutOpen} side={flyoutSide}>
          {threeDGroupHovered && !is3DPopoutOpen && (
            <div className="px-2 py-1 bg-trimble-gray text-white text-xs rounded whitespace-nowrap shadow-modus-2 pointer-events-none">
              3D Primitives
            </div>
          )}
        </FlyoutPortal>

        <FlyoutPortal anchorRef={threeDGroupRef} open={is3DPopoutOpen} side={flyoutSide}>
          <div onMouseEnter={handle3DEnter} onMouseLeave={handle3DLeave}>
            <AnimatePresence>
              {is3DPopoutOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className={cn(
                    "border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[140px]",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                  )}
                >
              <button 
                onClick={() => setActiveTool('sphere')}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                  activeTool === 'sphere' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                )}
              >
                <SphereIcon size={16} />
                <span>Sphere</span>
              </button>
              <button 
                onClick={() => setActiveTool('cone')}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                  activeTool === 'cone' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                )}
              >
                <Cone size={16} />
                <span>Cone</span>
              </button>
              <button 
                onClick={() => setActiveTool('pyramid')}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                  activeTool === 'pyramid' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                )}
              >
                <PyramidIcon size={16} />
                <span>Pyramid</span>
              </button>
              <button 
                onClick={() => setActiveTool('donut')}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                  activeTool === 'donut' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                )}
              >
                <Torus size={16} />
                <span>Donut</span>
              </button>
              <button 
                onClick={() => setActiveTool('dome')}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                  activeTool === 'dome' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                )}
              >
                <CircleDot size={16} />
                    <span>Dome</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </FlyoutPortal>
      </div>

      <div 
        className="relative"
        ref={bevelGroupRef}
        onMouseEnter={handleBevelEnter}
        onMouseLeave={handleBevelLeave}
      >
        <button 
          onClick={() => setActiveTool('bevel')}
          className={cn(
            "toolbar-btn transition-colors relative",
            activeTool === 'bevel' && "toolbar-btn-active"
          )}
        >
          <CornerUpRight size={20} />
        </button>

        <FlyoutPortal anchorRef={bevelGroupRef} open={bevelGroupHovered && !isBevelPopoutOpen} side={flyoutSide}>
          {bevelGroupHovered && !isBevelPopoutOpen && (
            <div className="px-2 py-1 bg-trimble-gray text-white text-xs rounded whitespace-nowrap shadow-modus-2 pointer-events-none">
              Bevel Tool
            </div>
          )}
        </FlyoutPortal>

        <FlyoutPortal anchorRef={bevelGroupRef} open={isBevelPopoutOpen} side={flyoutSide}>
          <div onMouseEnter={handleBevelEnter} onMouseLeave={handleBevelLeave}>
            <AnimatePresence>
              {isBevelPopoutOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className={cn(
                    "border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[140px]",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                  )}
                >
                  <button 
                    onClick={() => { setActiveTool('bevel'); setActiveBevelType('radius'); }}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      (activeTool === 'bevel' && activeBevelType === 'radius') ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <Circle size={16} />
                    <span>Radius (Fillet)</span>
                  </button>
                  <button 
                    onClick={() => { setActiveTool('bevel'); setActiveBevelType('chamfer'); }}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      (activeTool === 'bevel' && activeBevelType === 'chamfer') ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <Square size={16} />
                    <span>Chamfer</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </FlyoutPortal>
      </div>
      
      <div className={horizontal ? "h-8 w-px bg-gray-200 mx-1" : "w-8 h-px bg-gray-200 my-1"} />
      
      <ToolButton tool="pushpull" icon={<ArrowUpFromLine size={20} />} label="Push/Pull (P)" />
      <ToolButton tool="offset" icon={<Layers size={20} />} label="Offset" />
      <ToolButton tool="subtract" icon={<Scissors size={20} />} label="Subtract Tool - 1st click on the object to keep, 2nd click on object to subtract" />
      <div 
        className="relative"
        ref={measureGroupRef}
        onMouseEnter={handleMeasureEnter}
        onMouseLeave={handleMeasureLeave}
      >
        <button 
          onClick={() => setActiveTool('tape')}
          className={cn(
            "toolbar-btn transition-colors relative",
            activeTool === 'tape' && "toolbar-btn-active"
          )}
        >
          <Ruler size={20} />
        </button>

        <FlyoutPortal anchorRef={measureGroupRef} open={measureGroupHovered && !isMeasurePopoutOpen} side={flyoutSide}>
          {measureGroupHovered && !isMeasurePopoutOpen && (
            <div className="px-2 py-1 bg-trimble-gray text-white text-xs rounded whitespace-nowrap shadow-modus-2 pointer-events-none">
              Measure Tool
            </div>
          )}
        </FlyoutPortal>

        <FlyoutPortal anchorRef={measureGroupRef} open={isMeasurePopoutOpen} side={flyoutSide}>
          <div onMouseEnter={handleMeasureEnter} onMouseLeave={handleMeasureLeave}>
            <AnimatePresence>
              {isMeasurePopoutOpen && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className={cn(
                    "border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[190px]",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                  )}
                >
                  <button 
                    onClick={() => setActiveTool('tape')}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      activeTool === 'tape' ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    <Ruler size={16} />
                    <span>Measuring Tape</span>
                  </button>
                  <button 
                    onClick={() => setShowAllDimensions(!showAllDimensions)}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                      showAllDimensions ? (theme === 'dark' ? "bg-gray-700 text-white" : "bg-gray-100 text-gray-900") : (theme === 'dark' ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-50 text-gray-700")
                    )}
                  >
                    {showAllDimensions ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    <span>Show All Dimensions</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </FlyoutPortal>
      </div>
      
      <div className={horizontal ? "h-8 w-px bg-gray-200 mx-1" : "w-8 h-px bg-gray-200 my-1"} />
      
      <ToolButton tool="move" icon={<Move size={20} />} label="Move (M / G)" />
      <ToolButton tool="rotate" icon={<RotateCw size={20} />} label="Rotate (Q)" />
      <ToolButton tool="scale" icon={<Maximize size={20} />} label="Scale (S)" />
      
      <div className={horizontal ? "h-8 w-px bg-gray-200 mx-1" : "w-8 h-px bg-gray-200 my-1"} />
      
      <ToolButton tool="orbit" icon={<Orbit size={20} />} label="Orbit (O)" />
      <ToolButton tool="pan" icon={<Hand size={20} />} label="Pan (H)" />
      <ToolButton tool="zoom" icon={<ZoomIn size={20} />} label="Zoom (Z)" />

      {pinnedScripts.length > 0 && (
        <>
          <div className={horizontal ? "h-8 w-px bg-gray-200 mx-1" : "w-8 h-px bg-gray-200 my-1"} />
          {pinnedScripts.map(scriptId => {
            const script = developerScripts.find(s => s.id === scriptId);
            if (!script) return null;
            return (
              <PinnedScriptButton
                key={scriptId}
                name={script.name}
                onClick={() => runPinnedScript(scriptId)}
              />
            );
          })}
        </>
      )}
    </aside>
    </FlyoutSideContext.Provider>
  );
}

function PinnedScriptButton({ name, onClick }: { name: string; onClick: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const flyoutSide = useContext(FlyoutSideContext);

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="toolbar-btn relative text-trimble-blue"
    >
      <Code size={20} />
      <FlyoutPortal anchorRef={buttonRef} open={hovered} side={flyoutSide}>
        {hovered && (
          <div className="px-2 py-1 bg-trimble-gray text-white text-xs rounded whitespace-nowrap shadow-modus-2 pointer-events-none">
            {name}
          </div>
        )}
      </FlyoutPortal>
    </button>
  );
}
