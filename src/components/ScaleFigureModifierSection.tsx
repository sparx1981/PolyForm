import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { SCALE_FIGURE_CHARACTERS } from '../lib/scaleFigureGeometry';
import { cn } from '../lib/utils';
import {
  PersonStanding,
  Ruler,
  Check
} from 'lucide-react';

export const ScaleFigureModifierSection: React.FC = () => {
  const {
    activeScaleFigureCharacter,
    setActiveScaleFigureCharacter,
    activeScaleFigureHeight,
    setActiveScaleFigureHeight,
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
      setMeasurements(`Selected scale figure: ${char.name} (${char.height.toFixed(2)}m)`);
    }
  };

  const handleHeightChange = (newHeight: number) => {
    const clamped = Math.max(0.6, Math.min(2.5, Number(newHeight.toFixed(2))));
    setActiveScaleFigureHeight(clamped);
    setMeasurements(`Scale figure height set to ${clamped.toFixed(2)}m (Eye-level ${(clamped * 0.93).toFixed(2)}m)`);
  };

  const heightPresets = [
    { label: 'Child', height: 1.10 },
    { label: 'Teen', height: 1.52 },
    { label: 'Avg Female', height: 1.65 },
    { label: 'Avg Male', height: 1.78 },
    { label: 'Tall', height: 1.92 }
  ];

  return (
    <div className="space-y-4">
      {/* Height Adjustment Slider & Presets */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <Ruler size={13} className="text-trimble-blue" />
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
              className="w-16 h-6 px-1.5 text-right font-mono text-xs rounded bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-trimble-blue"
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
          className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
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
                    ? "bg-trimble-blue text-white shadow-xs font-semibold"
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

      {/* Category Tabs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-500">
          <span>Characters</span>
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
                  ? "bg-trimble-blue text-white shadow-xs"
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
                    ? "border-trimble-blue bg-trimble-blue/10 ring-1 ring-trimble-blue"
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
                  <Check size={14} className="text-trimble-blue shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center pt-2 border-t border-gray-200 dark:border-gray-800">
        Tip: Hover & click anywhere on 3D slabs, roofs, or ground to place a scale figure
      </p>
    </div>
  );
};
