import React, { useRef, useState, createContext, useContext } from 'react';
import { Aperture, RotateCcw, Crop } from 'lucide-react';
import { useApp } from '../AppContext';
import { ToolType } from '../types';
import { cn } from '../lib/utils';
import { FlyoutPortal } from './ui/FlyoutPortal';

const FlyoutSideContext = createContext<'right' | 'bottom'>('right');

interface CameraToolButtonProps {
  tool: ToolType | 'reset_camera';
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  onClick?: () => void;
  isActive?: boolean;
}

function CameraToolButton({ tool, icon, label, subtitle, onClick, isActive }: CameraToolButtonProps) {
  const { activeTool, setActiveTool, bannerColor, theme, toolbarVisibility, isToolModifierDocked, rightPanelVisible, setRightPanelVisible } = useApp();
  const active = isActive !== undefined ? isActive : activeTool === tool;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const flyoutSide = useContext(FlyoutSideContext);

  if (toolbarVisibility[tool] === false) return null;

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      setActiveTool(tool as ToolType);
      if (tool === 'clipping' && isToolModifierDocked && !rightPanelVisible) {
        setRightPanelVisible(true);
      }
    }
  };

  return (
    <div className="relative group">
      <button
        ref={buttonRef}
        id={`camera-tool-${tool}`}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={label}
        className={cn(
          "toolbar-btn relative flex items-center justify-center transition-all",
          active && "toolbar-btn-active ring-2 ring-offset-1 ring-trimble-blue shadow-md",
          theme === 'dark' ? "hover:bg-gray-700 text-gray-200" : "hover:bg-gray-100 text-gray-700"
        )}
        style={active ? { borderColor: bannerColor, color: bannerColor } : undefined}
      >
        {icon}

        <FlyoutPortal anchorRef={buttonRef} open={hovered} side={flyoutSide}>
          {hovered && (
            <div className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-md whitespace-nowrap shadow-xl border border-gray-700 pointer-events-none z-50">
              <div className="font-semibold flex items-center gap-1.5">
                <span>{label}</span>
              </div>
              <div className="text-[10px] text-gray-400 font-normal">{subtitle}</div>
            </div>
          )}
        </FlyoutPortal>
      </button>
    </div>
  );
}

interface CameraToolbarProps {
  /** Which edge this toolbar is currently docked to. Defaults to 'left'. */
  dock?: 'left' | 'top' | 'bottom';
}

export default function CameraToolbar({ dock = 'left' }: CameraToolbarProps = {}) {
  const horizontal = dock !== 'left';
  const flyoutSide: 'right' | 'bottom' = horizontal ? 'bottom' : 'right';
  const { 
    isCameraToolbarEnabled, 
    theme, 
    activeTool,
    setActiveTool,
    isToolModifierDocked,
    rightPanelVisible,
    setRightPanelVisible
  } = useApp();

  if (!isCameraToolbarEnabled) return null;

  return (
    <FlyoutSideContext.Provider value={flyoutSide}>
      <aside 
        id="camera-toolbar"
        aria-label="Camera Toolbar"
        className={cn(
          horizontal
            ? cn("h-12 flex flex-row items-center px-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative", dock === 'top' ? "border-b" : "border-t")
            : "w-12 border-r flex flex-col items-center py-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative",
          theme === 'dark' ? "bg-gray-850 border-gray-700" : "bg-slate-50/90 border-gray-200"
        )}
      >
        {/* Portal Navigation Tool */}
        <CameraToolButton 
          tool="teleport"
          icon={<Aperture size={19} className="text-indigo-500 dark:text-indigo-400" />}
          label="Portal Navigation"
          subtitle="Click a wall, window, door, or floor to walk there"
        />

        {/* Reset Camera Position */}
        <CameraToolButton 
          tool="reset_camera"
          icon={<RotateCcw size={18} className="text-indigo-500 dark:text-indigo-400" />}
          label="Reset Camera Position"
          subtitle="Return to default isometric framing"
          isActive={false}
          onClick={() => {
            window.dispatchEvent(new CustomEvent('reset-camera'));
          }}
        />

        {/* Camera Depth Clipping */}
        <CameraToolButton 
          tool="clipping"
          icon={<Crop size={19} className="text-sky-500 dark:text-sky-400" />}
          label="Camera Depth Clipping"
          subtitle="Near & Far frustum clipping planes"
          isActive={activeTool === 'clipping'}
          onClick={() => {
            setActiveTool('clipping');
            if (isToolModifierDocked && !rightPanelVisible) {
              setRightPanelVisible(true);
            }
          }}
        />
      </aside>
    </FlyoutSideContext.Provider>
  );
}
