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
  Globe,
  Scissors,
  CircleDashed,
  Grab,
  Wand2,
  Ruler,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import { useState } from 'react';
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

  if (toolbarVisibility[tool] === false) return null;

  return (
    <button
      onClick={() => {
        setActiveTool(tool);
        if (tool === 'paint') setOpenMaterialsSignal((s: number) => s + 1);
      }}
      className={cn(
        "toolbar-btn relative group hover:z-50",
        isActive && "toolbar-btn-active"
      )}
      title={label}
    >
      {icon}
      <div className="absolute left-full ml-2 px-2 py-1 bg-trimble-gray text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[150] shadow-modus-2">
        {label}
      </div>
    </button>
  );
}

interface LeftToolbarProps {
  layoutMode?: 'classic' | 'unified';
}

export default function LeftToolbar({ layoutMode }: LeftToolbarProps = {}) {
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
  const [is3DPopoutOpen, setIs3DPopoutOpen] = useState(false);
  const [isLinePopoutOpen, setIsLinePopoutOpen] = useState(false);
  const [isBevelPopoutOpen, setIsBevelPopoutOpen] = useState(false);
  const [isMeasurePopoutOpen, setIsMeasurePopoutOpen] = useState(false);
  const [hoverTimeout, setHoverTimeout] = useState<NodeJS.Timeout|null>(null);
  const [hover3DTimeout, setHover3DTimeout] = useState<NodeJS.Timeout|null>(null);
  const [hoverLineTimeout, setHoverLineTimeout] = useState<NodeJS.Timeout|null>(null);
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
  };

  const handleAILeave = () => {
    const timeout = setTimeout(() => {
      setIsAIPopoutOpen(false);
    }, 300);
    setHoverTimeout(timeout);
  };

  const handle3DEnter = () => {
    if (hover3DTimeout) clearTimeout(hover3DTimeout);
    setIs3DPopoutOpen(true);
  };

  const handle3DLeave = () => {
    const timeout = setTimeout(() => {
      setIs3DPopoutOpen(false);
    }, 300);
    setHover3DTimeout(timeout);
  };

  const handleBevelEnter = () => {
    if (hoverBevelTimeout) clearTimeout(hoverBevelTimeout);
    setIsBevelPopoutOpen(true);
  };

  const handleBevelLeave = () => {
    const timeout = setTimeout(() => {
      setIsBevelPopoutOpen(false);
    }, 300);
    setHoverBevelTimeout(timeout);
  };

  const handleMeasureEnter = () => {
    if (hoverMeasureTimeout) clearTimeout(hoverMeasureTimeout);
    setIsMeasurePopoutOpen(true);
  };

  const handleMeasureLeave = () => {
    const timeout = setTimeout(() => {
      setIsMeasurePopoutOpen(false);
    }, 300);
    setHoverMeasureTimeout(timeout);
  };

  const handleLineEnter = () => {
    if (hoverLineTimeout) clearTimeout(hoverLineTimeout);
    setIsLinePopoutOpen(true);
  };

  const handleLineLeave = () => {
    const timeout = setTimeout(() => {
      setIsLinePopoutOpen(false);
    }, 300);
    setHoverLineTimeout(timeout);
  };

  const is3DActive = ['sphere', 'cone', 'pyramid', 'donut', 'dome'].includes(activeTool);

  if (!isBasicToolbarEnabled) return null;

  return (
    <aside className={cn(
      "w-12 border-r flex flex-col items-center py-2 gap-1 z-40 transition-colors duration-300",
      theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
    )}>
      <div 
        className="relative"
        onMouseEnter={handleAIEnter}
        onMouseLeave={handleAILeave}
      >
        <button 
          onClick={() => setIsAIQueryOpen(true)}
          className="toolbar-btn mb-2 transition-colors"
          style={{ color: bannerColor }}
          title="AI Model Query"
        >
          <Sparkles size={20} />
        </button>

        <AnimatePresence>
          {isAIPopoutOpen && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className={cn(
                "absolute left-full top-0 ml-2 border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[140px] z-50",
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
      
      <ToolButton tool="select" icon={<MousePointer2 size={20} />} label="Select (Space)" />
      <ToolButton tool="eraser" icon={<Eraser size={20} />} label="Eraser (E)" />
      <ToolButton tool="paint" icon={<PaintBucket size={20} />} label="Paint Bucket (B) - click: face/sub-face, Shift+click: whole object" />
      <ToolButton tool="component" icon={<Box size={20} />} label="Make Component (G)" />
      
      <div className="w-8 h-px bg-gray-200 my-1" />
      
      <div 
        className="relative"
        onMouseEnter={handleLineEnter}
        onMouseLeave={handleLineLeave}
      >
        <button 
          onClick={() => setActiveTool('line')}
          className={cn(
            "toolbar-btn transition-colors",
            (activeTool === 'line' || activeTool === 'poly' || activeTool === 'arc') && "toolbar-btn-active"
          )}
          title="Line, Poly & Arc Tools"
        >
          {activeTool === 'poly' ? <Pentagon size={20} /> : activeTool === 'arc' ? <Spline size={20} /> : <PenLine size={20} />}
        </button>

        <AnimatePresence>
          {isLinePopoutOpen && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className={cn(
                "absolute left-full top-0 ml-2 border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[140px] z-50",
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
                <span>Poly Tool</span>
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

      <ToolButton tool="rectangle" icon={<Square size={20} />} label="Rectangle (R)" />
      <ToolButton tool="circle" icon={<Circle size={20} />} label="Circle (C)" />
      <ToolButton tool="triangle" icon={<TriangleIcon size={20} />} label="Triangle (T)" />

      <div 
        className="relative"
        onMouseEnter={handle3DEnter}
        onMouseLeave={handle3DLeave}
      >
        <button 
          className={cn(
            "toolbar-btn transition-colors",
            is3DActive && "toolbar-btn-active"
          )}
          title="3D Primitives"
        >
          <Cone size={20} />
        </button>

        <AnimatePresence>
          {is3DPopoutOpen && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className={cn(
                "absolute left-full top-0 ml-2 border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[140px] z-50",
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

      <div 
        className="relative"
        onMouseEnter={handleBevelEnter}
        onMouseLeave={handleBevelLeave}
      >
        <button 
          onClick={() => setActiveTool('bevel')}
          className={cn(
            "toolbar-btn transition-colors",
            activeTool === 'bevel' && "toolbar-btn-active"
          )}
          title="Bevel Tool"
        >
          <CornerUpRight size={20} />
        </button>

        <AnimatePresence>
          {isBevelPopoutOpen && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className={cn(
                "absolute left-full top-0 ml-2 border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[140px] z-50",
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
      
      <div className="w-8 h-px bg-gray-200 my-1" />
      
      <ToolButton tool="pushpull" icon={<ArrowUpFromLine size={20} />} label="Push/Pull (P)" />
      <ToolButton tool="offset" icon={<Layers size={20} />} label="Offset" />
      <ToolButton tool="subtract" icon={<Scissors size={20} />} label="Subtract Tool - 1st click on the object to keep, 2nd click on object to subtract" />
      <div 
        className="relative"
        onMouseEnter={handleMeasureEnter}
        onMouseLeave={handleMeasureLeave}
      >
        <button 
          onClick={() => setActiveTool('tape')}
          className={cn(
            "toolbar-btn transition-colors",
            activeTool === 'tape' && "toolbar-btn-active"
          )}
          title="Measure Tool"
        >
          <Ruler size={20} />
        </button>

        <AnimatePresence>
          {isMeasurePopoutOpen && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className={cn(
                "absolute left-full top-0 ml-2 border rounded-lg shadow-modus-3 p-2 flex flex-col gap-1 min-w-[190px] z-50",
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
      
      <div className="w-8 h-px bg-gray-200 my-1" />
      
      <ToolButton tool="move" icon={<Move size={20} />} label="Move (M / G)" />
      <ToolButton tool="rotate" icon={<RotateCw size={20} />} label="Rotate (Q)" />
      <ToolButton tool="scale" icon={<Maximize size={20} />} label="Scale (S)" />
      
      <div className="w-8 h-px bg-gray-200 my-1" />
      
      <ToolButton tool="orbit" icon={<Orbit size={20} />} label="Orbit (O)" />
      <ToolButton tool="pan" icon={<Hand size={20} />} label="Pan (H)" />
      <ToolButton tool="zoom" icon={<ZoomIn size={20} />} label="Zoom (Z)" />
      
      <div className="w-8 h-px bg-gray-200 my-1" />

      <button
        onClick={() => setIsWorldViewOpen(true)}
        className={cn(
          "toolbar-btn relative group transition-colors",
          isWorldViewActive && "bg-trimble-blue/10"
        )}
        title="WorldView Geolocation"
      >
        <Globe size={20} className={isWorldViewActive ? "text-trimble-blue" : "text-gray-500"} />
        <div className="absolute left-full ml-2 px-2 py-1 bg-trimble-gray text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-modus-2">
          WorldView Geolocation
        </div>
      </button>

      {pinnedScripts.length > 0 && (
        <>
          <div className="w-8 h-px bg-gray-200 my-1" />
          {pinnedScripts.map(scriptId => {
            const script = developerScripts.find(s => s.id === scriptId);
            if (!script) return null;
            return (
              <button
                key={scriptId}
                onClick={() => runPinnedScript(scriptId)}
                className="toolbar-btn relative group text-trimble-blue"
                title={script.name}
              >
                <Code size={20} />
                <div className="absolute left-full ml-2 px-2 py-1 bg-trimble-gray text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 shadow-modus-2">
                  {script.name}
                </div>
              </button>
            );
          })}
        </>
      )}
    </aside>
  );
}
