import React from 'react';
import { useApp } from '../AppContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Settings, Info, Zap, Move, RotateCw, Maximize2, Scissors, Circle, MousePointer2, PanelRightClose } from 'lucide-react';

export const ToolModifierPalette: React.FC = () => {
  const { 
    activeTool, 
    theme,
    contactFrictionEnabled,
    setContactFrictionEnabled,
    activeBevelAmount,
    setActiveBevelAmount,
    activeBevelType,
    deformationSettings,
    setDeformationSettings,
    diagLog,
    autoOrbitEnabled,
    setAutoOrbitEnabled,
    orbitRotationSpeed,
    setOrbitRotationSpeed,
    rightPanelVisible,
    isToolModifierDocked,
    setIsToolModifierDocked
  } = useApp();

  const hasSettings = [
    'move', 
    'bevel', 
    'deform', 
    'orbit'
  ].includes(activeTool);

  if (!hasSettings) return null;

  return (
    <motion.div
      drag={!isToolModifierDocked}
      dragMomentum={false}
      initial={{ x: 300, opacity: 0 }}
      animate={{ 
        x: 0,
        opacity: 1,
      }}
      style={!isToolModifierDocked ? {
        right: rightPanelVisible ? 320 : 16,
        top: 80,
      } : {}}
      exit={{ x: 300, opacity: 0 }}
      className={cn(
        "z-30 rounded-xl border shadow-xl overflow-hidden transition-all duration-300",
        theme === 'dark' ? "bg-gray-900 border-gray-700 shadow-black/50" : "bg-white border-gray-200 shadow-xl",
        isToolModifierDocked ? "relative w-full shadow-none border-none rounded-none" : "fixed w-60"
      )}
    >
      <div 
        className={cn(
          "px-3 h-10 border-b flex items-center justify-between select-none",
          theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-100",
          !isToolModifierDocked ? "cursor-move active:cursor-grabbing" : "cursor-default"
        )}
      >
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-trimble-blue" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Tool Modifiers</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[9px] font-mono text-trimble-blue px-1.5 py-0.5 bg-trimble-blue/10 rounded">
            {activeTool.toUpperCase()}
          </div>
          <button 
            onClick={() => setIsToolModifierDocked(!isToolModifierDocked)}
            className={cn(
              "p-1.5 hover:bg-black/5 rounded-lg transition-colors",
              isToolModifierDocked ? "text-trimble-blue bg-trimble-blue/10" : "text-gray-400"
            )}
            title={isToolModifierDocked ? "Undock Palette" : "Dock Palette"}
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-4">
        {activeTool === 'move' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn("p-1 rounded", theme === 'dark' ? "bg-gray-700" : "bg-gray-100")}>
                  <Zap size={12} className="text-yellow-500" />
                </div>
                <span className="text-xs font-medium">Contact Friction</span>
              </div>
              <button 
                onClick={() => setContactFrictionEnabled(!contactFrictionEnabled)}
                className={cn(
                  "w-8 h-4 rounded-full relative transition-colors",
                  contactFrictionEnabled ? "bg-trimble-blue" : "bg-gray-300"
                )}
                title="Resistance when objects touch"
              >
                <div className={cn(
                  "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                  contactFrictionEnabled ? "left-4.5" : "left-0.5"
                )} />
              </button>
            </div>
            <p className="text-[9px] text-gray-400 italic leading-tight">
              Adds resistance at the point two surfaces first meet.
            </p>
          </div>
        )}

        {activeTool === 'bevel' && (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                <span>{activeBevelType === 'radius' ? 'Radius Strength' : 'Chamfer Strength'}</span>
                <span>{activeBevelAmount.toFixed(1)}</span>
              </div>
              <input 
                type="range" min="0" max="250" step="0.5"
                value={activeBevelAmount}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setActiveBevelAmount(val);
                  diagLog('TOOL', 'Bevel amount updated', { val });
                }}
                className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                title="Set the strength of the bevel"
              />
            </div>
            <p className="text-[9px] text-gray-400 italic">Controls the amount of rounding or chamfer applied.</p>
          </div>
        )}

        {activeTool === 'deform' && (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase">
                <span>Brush Radius</span>
                <span>{deformationSettings.radius.toFixed(1)}</span>
              </div>
              <input 
                type="range" min="0.5" max="10" step="0.1"
                value={deformationSettings.radius}
                onChange={(e) => setDeformationSettings({ ...deformationSettings, radius: parseFloat(e.target.value) })}
                className="w-full h-1 bg-gray-200 rounded-lg appearance-none accent-trimble-blue"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase">
                <span>Brush Strength</span>
                <span>{deformationSettings.strength.toFixed(1)}</span>
              </div>
              <input 
                type="range" min="0.1" max="10" step="0.1"
                value={deformationSettings.strength}
                onChange={(e) => setDeformationSettings({ ...deformationSettings, strength: parseFloat(e.target.value) })}
                className="w-full h-1 bg-gray-200 rounded-lg appearance-none accent-trimble-blue"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              {(['outward', 'inward', 'both'] as const).map(dir => (
                <button
                  key={dir}
                  onClick={() => setDeformationSettings({ ...deformationSettings, direction: dir })}
                  className={cn(
                    "flex-1 py-1 px-1.5 text-[9px] font-bold uppercase rounded border transition-all",
                    deformationSettings.direction === dir 
                      ? "bg-trimble-blue text-white border-trimble-blue" 
                      : (theme === 'dark' ? "text-gray-400 border-gray-700" : "text-gray-500 border-gray-200 hover:bg-gray-50")
                  )}
                >
                  {dir}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTool === 'orbit' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCw size={12} className="text-trimble-blue" />
                <span className="text-xs font-medium">Auto Orbit</span>
              </div>
              <button 
                onClick={() => setAutoOrbitEnabled(!autoOrbitEnabled)}
                className={cn(
                  "w-8 h-4 rounded-full relative transition-colors",
                  autoOrbitEnabled ? "bg-trimble-blue" : "bg-gray-300"
                )}
                title="Automatically rotate the view"
              >
                <div className={cn(
                  "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
                  autoOrbitEnabled ? "left-4.5" : "left-0.5"
                )} />
              </button>
            </div>

            {autoOrbitEnabled && (
              <div className="space-y-1 animate-in fade-in slide-in-from-top-1">
                <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase">
                  <span>Rotation Speed</span>
                  <span className="text-trimble-blue">
                    {orbitRotationSpeed < 0.5 ? 'Slow' : orbitRotationSpeed > 1.5 ? 'Fast' : 'Mid'}
                  </span>
                </div>
                <input 
                  type="range" min="0.1" max="2.0" step="0.1"
                  value={orbitRotationSpeed}
                  onChange={(e) => setOrbitRotationSpeed(parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                  title="Control orbit velocity"
                />
              </div>
            )}
            <p className="text-[9px] text-gray-400 italic">Automatically rotates around the workspace center.</p>
          </div>
        )}
      </div>

      <div className={cn(
        "px-3 py-1.5 flex items-center gap-2 border-t",
        theme === 'dark' ? "bg-gray-900/50 border-gray-700" : "bg-gray-50/50 border-gray-100"
      )}>
        <Info size={10} className="text-gray-400" />
        <span className="text-[9px] text-gray-400 leading-none">Settings are saved automatically</span>
      </div>
    </motion.div>
  );
};
