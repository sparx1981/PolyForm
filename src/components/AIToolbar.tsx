import React, { useRef, useState, createContext, useContext } from 'react';
import { Sparkles, Search, Wand2, Camera } from 'lucide-react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { FlyoutPortal } from './ui/FlyoutPortal';

const FlyoutSideContext = createContext<'right' | 'bottom'>('right');

interface AIToolButtonProps {
  id: string;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  onClick: () => void;
}

function AIToolButton({ id, icon, label, subtitle, onClick }: AIToolButtonProps) {
  const { bannerColor, theme, toolbarVisibility } = useApp();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const flyoutSide = useContext(FlyoutSideContext);

  if (toolbarVisibility[id] === false) return null;
  return (
    <div className="relative group">
      <button
        ref={buttonRef}
        id={`ai-tool-${id}`}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={label}
        className={cn(
          "toolbar-btn relative flex items-center justify-center transition-all",
          theme === 'dark' ? "hover:bg-gray-700 text-gray-200" : "hover:bg-gray-100 text-gray-700"
        )}
        style={{ color: bannerColor }}
      >
        {icon}

        <FlyoutPortal anchorRef={buttonRef} open={hovered} side={flyoutSide}>
          {hovered && (
            <div className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-md whitespace-nowrap shadow-xl border border-gray-700 pointer-events-none z-50">
              <div className="font-semibold">{label}</div>
              <div className="text-[10px] text-gray-400 font-normal">{subtitle}</div>
            </div>
          )}
        </FlyoutPortal>
      </button>
    </div>
  );
}

interface AIToolbarProps {
  /** Which edge this toolbar is currently docked to. Defaults to 'left'. */
  dock?: 'left' | 'top' | 'bottom';
}

export default function AIToolbar({ dock = 'left' }: AIToolbarProps = {}) {
  const horizontal = dock !== 'left';
  const flyoutSide: 'right' | 'bottom' = horizontal ? 'bottom' : 'right';
  const { isAIToolbarEnabled, theme, setIsAIQueryOpen, setIsAIRendererOpen, setIsAIGenerateOpen } = useApp();

  if (!isAIToolbarEnabled) return null;

  return (
    <FlyoutSideContext.Provider value={flyoutSide}>
      <aside
        id="ai-toolbar"
        aria-label="AI Toolbar"
        className={cn(
          horizontal
            ? cn("h-12 flex flex-row items-center px-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative", dock === 'top' ? "border-b" : "border-t")
            : "w-12 border-r flex flex-col items-center py-2 gap-1 z-40 transition-colors duration-300 select-none shadow-sm relative",
          theme === 'dark' ? "bg-gray-850 border-gray-700" : "bg-slate-50/90 border-gray-200"
        )}
      >
        <AIToolButton id="ai_query" icon={<Sparkles size={19} />} label="AI Query" subtitle="Ask AI assistant about your model & scene" onClick={() => setIsAIQueryOpen(true)} />
        <AIToolButton id="ai_generate" icon={<Wand2 size={19} />} label="AI Generate" subtitle="Generate 3D geometry from text prompt" onClick={() => setIsAIGenerateOpen(true)} />
        <AIToolButton id="ai_renderer" icon={<Search size={19} />} label="AI Renderer" subtitle="Generate photorealistic AI render from view" onClick={() => setIsAIRendererOpen(true)} />
        <AIToolButton id="photo_to_3d" icon={<Camera size={19} />} label="Reconstruction Studio" subtitle="Turn photos and plans into 3D models" onClick={() => window.dispatchEvent(new CustomEvent('polyform:photo-to-3d'))} />
      </aside>
    </FlyoutSideContext.Provider>
  );
}
