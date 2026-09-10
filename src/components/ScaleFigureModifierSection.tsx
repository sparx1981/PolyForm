import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { SCALE_FIGURE_CHARACTERS } from '../lib/scaleFigureGeometry';
import { cn } from '../lib/utils';
import { 
  PersonStanding, 
  Ruler, 
  Check, 
  Sparkles, 
  MapPin, 
  Eye, 
  Tag, 
  RotateCcw,
  Layers
} from 'lucide-react';
import { Shape } from '../types';

export const ScaleFigureModifierSection: React.FC = () => {
  const {
    activeScaleFigureCharacter,
    setActiveScaleFigureCharacter,
    activeScaleFigureHeight,
    setActiveScaleFigureHeight,
    addShape,
    commitHistory,
    setMeasurements,
    theme
  } = useApp();

  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const activeChar = SCALE_FIGURE_CHARACTERS.find(c => c.id === activeScaleFigureCharacter) || SCALE_FIGURE_CHARACTERS[0];
  const currentHeight = activeScaleFigureHeight && activeScaleFigureHeight > 0.4 ? activeScaleFigureHeight : activeChar.height;

  const categories = ['all', 'Professional', 'Site & Construction', 'Casual & Public'];

  const filteredCharacters = selectedCategory === 'all'
    ? SCALE_FIGURE_CHARACTERS
    : SCALE_FIGURE_CHARACTERS.filter(c => c.category === selectedCategory);

  const handleSelectCharacter = (charId: string) => {
    setActiveScaleFigureCharacter(charId);
    const char = SCALE_FIGURE_CHARACTERS.find(c => c.id === charId);
    if (char) {
      setActiveScaleFigureHeight(char.height);
      setMeasurements(`Selected scale figure archetype: ${char.name} (${char.height.toFixed(2)}m)`);
    }
  };

  const handleHeightChange = (newHeight: number) => {
    const clamped = Math.max(0.6, Math.min(2.5, Number(newHeight.toFixed(2))));
    setActiveScaleFigureHeight(clamped);
    setMeasurements(`Scale figure height set to ${clamped.toFixed(2)}m (Eye-level ${(clamped * 0.93).toFixed(2)}m)`);
  };

  const handlePlaceAtOrigin = () => {
    const char = activeChar;
    const targetH = currentHeight;

    const newShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      name: `${char.name} (${targetH.toFixed(2)}m)`,
      type: 'scale_figure',
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      args: [char.width, targetH, char.depth],
      color: char.primaryColor,
      roughness: 0.65,
      metalness: 0.1,
      archStyle: char.id,
      tags: ['scale-figure', 'architecture', char.category.toLowerCase().replace(/\s+/g, '-')]
    };

    addShape(newShape);
    commitHistory();
    setMeasurements(`Placed ${char.name} at origin [0.00, 0.00, 0.00] (${targetH.toFixed(2)}m datum reference)`);
  };

  const heightPresets = [
    { label: 'Child', height: 1.10 },
    { label: 'Teen', height: 1.52 },
    { label: 'Avg Female', height: 1.65 },
    { label: 'Avg Male', height: 1.78 },
    { label: 'Tall', height: 1.92 }
  ];

  const eyeLevelDatum = (currentHeight * 0.93).toFixed(2);
  const doorMargin = (2.10 - currentHeight).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Active Character Summary Card */}
      <div className={cn(
        "p-3 rounded-xl border transition-all",
        theme === 'dark' ? "bg-gray-800/70 border-gray-700" : "bg-emerald-50/50 border-emerald-200/80"
      )}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold shadow-xs shrink-0"
              style={{ backgroundColor: activeChar.primaryColor }}
            >
              <PersonStanding size={18} />
            </div>
            <div>
              <div className="text-xs font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                <span>{activeChar.name}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-medium bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
                  {currentHeight.toFixed(2)}m
                </span>
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                {activeChar.category} • {activeChar.propName}
              </div>
            </div>
          </div>
          <button
            onClick={() => handleSelectCharacter(activeChar.id)}
            title="Reset height to character archetype default"
            className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <RotateCcw size={13} />
          </button>
        </div>

        <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
          {activeChar.description}
        </p>

        {/* Feature Badges */}
        <div className="mt-2.5 flex flex-wrap gap-1">
          {activeChar.features.map((feat, idx) => (
            <span 
              key={idx}
              className="text-[9px] px-1.5 py-0.5 rounded-full bg-white dark:bg-gray-700/80 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 flex items-center gap-1"
            >
              <Tag size={9} className="text-emerald-600 dark:text-emerald-400" />
              <span>{feat}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Height Adjustment Slider & Presets */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <Ruler size={13} className="text-emerald-600 dark:text-emerald-400" />
            <span>Scale Height</span>
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              min="0.6"
              max="2.5"
              value={currentHeight}
              onChange={(e) => handleHeightChange(parseFloat(e.target.value) || activeChar.height)}
              className="w-16 h-6 px-1.5 text-right font-mono text-xs rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <span className="text-xs text-gray-400 font-mono">m</span>
          </div>
        </div>

        <input
          type="range"
          min="0.80"
          max="2.20"
          step="0.01"
          value={currentHeight}
          onChange={(e) => handleHeightChange(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-600"
        />

        {/* Quick Presets */}
        <div className="grid grid-cols-5 gap-1 pt-1">
          {heightPresets.map(preset => {
            const isSelected = Math.abs(currentHeight - preset.height) < 0.02;
            return (
              <button
                key={preset.label}
                onClick={() => handleHeightChange(preset.height)}
                className={cn(
                  "py-1 px-1 rounded text-[10px] font-medium transition-all text-center",
                  isSelected
                    ? "bg-emerald-600 text-white shadow-xs font-semibold"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                )}
              >
                <div>{preset.label}</div>
                <div className="text-[9px] opacity-75 font-mono">{preset.height}m</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Architectural Ergonomic Datums */}
      <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700/60 space-y-1.5 text-[11px]">
        <div className="font-bold text-[10px] uppercase tracking-wider text-gray-500 flex items-center gap-1">
          <Eye size={12} className="text-emerald-600" />
          <span>Ergonomic Benchmarks</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="bg-white dark:bg-gray-800 p-1.5 rounded border border-gray-200 dark:border-gray-700">
            <span className="text-gray-400 block">Eye-Level Sightline</span>
            <span className="font-mono font-bold text-gray-900 dark:text-gray-100">{eyeLevelDatum} m</span>
          </div>
          <div className="bg-white dark:bg-gray-800 p-1.5 rounded border border-gray-200 dark:border-gray-700">
            <span className="text-gray-400 block">Standard Door Head (2.1m)</span>
            <span className="font-mono font-bold text-gray-900 dark:text-gray-100">
              +{doorMargin} m clear
            </span>
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-500">
          <span>Character Archetypes</span>
          <span className="text-[10px] font-mono text-gray-400">{filteredCharacters.length} Models</span>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition-all",
                selectedCategory === cat
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              )}
            >
              {cat === 'all' ? 'All Roles' : cat}
            </button>
          ))}
        </div>

        {/* Character Grid */}
        <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
          {filteredCharacters.map(char => {
            const isSelected = activeChar.id === char.id;
            return (
              <button
                key={char.id}
                onClick={() => handleSelectCharacter(char.id)}
                className={cn(
                  "w-full text-left p-2 rounded-lg border transition-all flex items-center justify-between gap-2.5",
                  isSelected
                    ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
                    : "border-gray-200 dark:border-gray-800 hover:bg-gray-100/60 dark:hover:bg-gray-800/60"
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div 
                    className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 text-[10px] font-bold text-white shadow-xs"
                    style={{ backgroundColor: char.primaryColor }}
                  >
                    <PersonStanding size={13} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {char.name}
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                      {char.category} • {char.height.toFixed(2)}m
                    </div>
                  </div>
                </div>
                {isSelected && (
                  <Check size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Place Actions */}
      <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
        <button
          onClick={handlePlaceAtOrigin}
          className="w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          <MapPin size={14} />
          <span>Place Benchmark at Origin [0, 0, 0]</span>
        </button>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center mt-1.5">
          Tip: You can also hover & click anywhere on 3D slabs, roofs, or ground
        </p>
      </div>
    </div>
  );
};
