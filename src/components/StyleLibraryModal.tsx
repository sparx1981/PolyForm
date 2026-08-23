import React, { useState } from 'react';
import { X, Check, Layers, Sparkles, Sliders, ArrowRight, ShieldCheck, Box } from 'lucide-react';
import { DOOR_STYLES, WINDOW_STYLES, ArchStyleDef } from '../lib/archStyles';
import { Shape } from '../types';
import { cn } from '../lib/utils';

interface StyleLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetShape: Shape | null;
  onApplyStyle: (styleId: string, dimensions?: [number, number, number]) => void;
  theme?: 'light' | 'dark';
}

function StyleDiagram({ style }: { style: ArchStyleDef }) {
  if (style.type === 'door') {
    switch (style.id) {
      case '4panel':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            {/* 4 Panels */}
            <rect x="20" y="18" width="26" height="52" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            <rect x="54" y="18" width="26" height="52" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            <rect x="20" y="82" width="26" height="60" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            <rect x="54" y="82" width="26" height="60" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            {/* Knob */}
            <circle cx="78" cy="80" r="3.5" fill="#f59e0b" stroke="#78350f" strokeWidth="1" />
          </svg>
        );
      case 'french':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#ffffff" stroke="currentColor" strokeWidth="3" rx="2" />
            {/* Glass Area */}
            <rect x="18" y="15" width="64" height="120" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="2" />
            {/* Muntins 2x3 */}
            <line x1="50" y1="15" x2="50" y2="135" stroke="currentColor" strokeWidth="2" />
            <line x1="18" y1="55" x2="82" y2="55" stroke="currentColor" strokeWidth="2" />
            <line x1="18" y1="95" x2="82" y2="95" stroke="currentColor" strokeWidth="2" />
            {/* Lever handle */}
            <rect x="74" y="80" width="10" height="3" fill="#64748b" rx="1" />
          </svg>
        );
      case 'half-glass':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            {/* Upper Glass */}
            <rect x="18" y="16" width="64" height="55" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="2" />
            <line x1="50" y1="16" x2="50" y2="71" stroke="currentColor" strokeWidth="2" />
            {/* Lower Panel */}
            <rect x="18" y="84" width="64" height="58" fill="#e2e8f0" stroke="currentColor" strokeWidth="1.5" rx="1" />
            {/* Handle */}
            <circle cx="76" cy="78" r="3" fill="#64748b" />
          </svg>
        );
      case 'double-french':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="5" y="5" width="90" height="150" fill="#ffffff" stroke="currentColor" strokeWidth="3" rx="2" />
            <line x1="50" y1="5" x2="50" y2="155" stroke="currentColor" strokeWidth="2" />
            {/* Left Glass */}
            <rect x="10" y="15" width="35" height="120" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="1.5" />
            <line x1="27.5" y1="15" x2="27.5" y2="135" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="55" x2="45" y2="55" stroke="currentColor" strokeWidth="1" />
            <line x1="10" y1="95" x2="45" y2="95" stroke="currentColor" strokeWidth="1" />
            {/* Right Glass */}
            <rect x="55" y="15" width="35" height="120" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="1.5" />
            <line x1="72.5" y1="15" x2="72.5" y2="135" stroke="currentColor" strokeWidth="1" />
            <line x1="55" y1="55" x2="90" y2="55" stroke="currentColor" strokeWidth="1" />
            <line x1="55" y1="95" x2="90" y2="95" stroke="currentColor" strokeWidth="1" />
          </svg>
        );
      case 'barn':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            {/* Top Track */}
            <rect x="2" y="4" width="96" height="5" fill="#1e293b" />
            <circle cx="28" cy="6" r="3" fill="#475569" />
            <circle cx="72" cy="6" r="3" fill="#475569" />
            {/* Door Leaf */}
            <rect x="12" y="12" width="76" height="142" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="1" />
            {/* Z-Brace */}
            <rect x="18" y="20" width="64" height="12" fill="#e2e8f0" stroke="currentColor" strokeWidth="1" />
            <rect x="18" y="130" width="64" height="12" fill="#e2e8f0" stroke="currentColor" strokeWidth="1" />
            <line x1="20" y1="32" x2="80" y2="130" stroke="currentColor" strokeWidth="4" />
            {/* Black Pull Bar */}
            <rect x="76" y="70" width="3" height="24" fill="#0f172a" rx="1" />
          </svg>
        );
      case 'horizontal-slat':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            {/* 5 Grooves */}
            <line x1="15" y1="35" x2="85" y2="35" stroke="currentColor" strokeWidth="2" />
            <line x1="15" y1="65" x2="85" y2="65" stroke="currentColor" strokeWidth="2" />
            <line x1="15" y1="95" x2="85" y2="95" stroke="currentColor" strokeWidth="2" />
            <line x1="15" y1="125" x2="85" y2="125" stroke="currentColor" strokeWidth="2" />
            {/* Tall Vertical Bar */}
            <rect x="76" y="50" width="3" height="50" fill="#64748b" rx="1" />
          </svg>
        );
      case 'pivot':
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="6" y="5" width="88" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            {/* Pivot Axis Indicator */}
            <circle cx="20" cy="8" r="3" fill="#0284c7" />
            <circle cx="20" cy="152" r="3" fill="#0284c7" />
            <line x1="20" y1="8" x2="20" y2="152" stroke="#0284c7" strokeWidth="1" strokeDasharray="3 3" />
            {/* Tall Stainless Bar */}
            <rect x="78" y="25" width="3" height="105" fill="#64748b" rx="1" />
          </svg>
        );
      case 'flush':
      default:
        return (
          <svg viewBox="0 0 100 160" className="w-full h-32 text-gray-700 dark:text-gray-300">
            <rect x="10" y="5" width="80" height="150" fill="#f8fafc" stroke="currentColor" strokeWidth="3" rx="2" />
            {/* Stainless Escutcheon & Lever */}
            <rect x="72" y="72" width="6" height="18" fill="#94a3b8" rx="1" />
            <rect x="70" y="78" width="14" height="3" fill="#475569" rx="1" />
          </svg>
        );
    }
  }

  // Windows
  switch (style.id) {
    case 'picture':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          <rect x="10" y="10" width="120" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
          {/* Sill */}
          <rect x="5" y="100" width="130" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
        </svg>
      );
    case 'georgian':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          <rect x="10" y="10" width="120" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
          {/* 3 cols x 2 rows (6 panes) */}
          <line x1="50" y1="10" x2="50" y2="100" stroke="currentColor" strokeWidth="2" />
          <line x1="90" y1="10" x2="90" y2="100" stroke="currentColor" strokeWidth="2" />
          <line x1="10" y1="55" x2="130" y2="55" stroke="currentColor" strokeWidth="2" />
          {/* Sill */}
          <rect x="5" y="100" width="130" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
        </svg>
      );
    case 'slider':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          <rect x="10" y="10" width="120" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
          <rect x="10" y="10" width="60" height="90" fill="none" stroke="currentColor" strokeWidth="2" />
          <rect x="68" y="10" width="62" height="90" fill="none" stroke="currentColor" strokeWidth="2" />
          <rect x="66" y="50" width="6" height="10" fill="#64748b" rx="1" />
          {/* Sill */}
          <rect x="5" y="100" width="130" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
        </svg>
      );
    case 'ribbon':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          <rect x="5" y="25" width="130" height="60" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
          {/* 3 Horizontal Ribbon Panes */}
          <line x1="48" y1="25" x2="48" y2="85" stroke="currentColor" strokeWidth="2.5" />
          <line x1="92" y1="25" x2="92" y2="85" stroke="currentColor" strokeWidth="2.5" />
          {/* Sill */}
          <rect x="2" y="85" width="136" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
        </svg>
      );
    case 'arch':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          {/* Arch outline */}
          <path d="M 20,100 L 20,45 A 50,35 0 0,1 120,45 L 120,100 Z" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" />
          <line x1="20" y1="50" x2="120" y2="50" stroke="currentColor" strokeWidth="2" />
          <line x1="70" y1="50" x2="70" y2="100" stroke="currentColor" strokeWidth="2" />
          {/* Sunburst rays */}
          <line x1="70" y1="50" x2="45" y2="25" stroke="currentColor" strokeWidth="1.5" />
          <line x1="70" y1="50" x2="95" y2="25" stroke="currentColor" strokeWidth="1.5" />
          {/* Sill */}
          <rect x="15" y="100" width="110" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
        </svg>
      );
    case 'double-hung':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          <rect x="15" y="10" width="110" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
          {/* Upper Sash */}
          <rect x="18" y="12" width="104" height="42" fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1="70" y1="12" x2="70" y2="54" stroke="currentColor" strokeWidth="1.5" />
          {/* Lower Sash */}
          <rect x="18" y="54" width="104" height="44" fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1="70" y1="54" x2="70" y2="98" stroke="currentColor" strokeWidth="1.5" />
          {/* Meeting rail lock */}
          <rect x="66" y="52" width="8" height="4" fill="#f59e0b" rx="1" />
          {/* Sill */}
          <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
        </svg>
      );
    case 'transom':
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          <rect x="15" y="10" width="110" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
          {/* Top Transom */}
          <rect x="17" y="12" width="106" height="25" fill="none" stroke="currentColor" strokeWidth="2" />
          {/* Main Lower Pane */}
          <rect x="17" y="37" width="106" height="61" fill="none" stroke="currentColor" strokeWidth="2" />
          {/* Sill */}
          <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
        </svg>
      );
    case 'cross':
    default:
      return (
        <svg viewBox="0 0 140 120" className="w-full h-32 text-gray-700 dark:text-gray-300">
          <rect x="15" y="10" width="110" height="90" fill="#bae6fd" fillOpacity="0.4" stroke="currentColor" strokeWidth="3" rx="1" />
          {/* 2x2 Cross Mullions */}
          <line x1="70" y1="10" x2="70" y2="100" stroke="currentColor" strokeWidth="2.5" />
          <line x1="15" y1="55" x2="125" y2="55" stroke="currentColor" strokeWidth="2.5" />
          {/* Sill */}
          <rect x="10" y="100" width="120" height="6" fill="#cbd5e1" stroke="currentColor" strokeWidth="1.5" rx="1" />
        </svg>
      );
  }
}

export default function StyleLibraryModal({
  isOpen,
  onClose,
  targetShape,
  onApplyStyle,
  theme = 'light'
}: StyleLibraryModalProps) {
  if (!isOpen || !targetShape) return null;

  const isDoor = targetShape.type === 'door';
  const styles = isDoor ? DOOR_STYLES : WINDOW_STYLES;
  const currentStyleId = targetShape.archStyle || (isDoor ? 'flush' : 'cross');

  const [selectedStyleId, setSelectedStyleId] = useState<string>(currentStyleId);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [width, setWidth] = useState<number>(
    Array.isArray(targetShape.args) ? targetShape.args[0] || (isDoor ? 0.9 : 1.2) : (isDoor ? 0.9 : 1.2)
  );
  const [height, setHeight] = useState<number>(
    Array.isArray(targetShape.args) ? targetShape.args[1] || (isDoor ? 2.1 : 1.2) : (isDoor ? 2.1 : 1.2)
  );
  const [depth, setDepth] = useState<number>(
    Array.isArray(targetShape.args) ? targetShape.args[2] || (isDoor ? 0.15 : 0.12) : (isDoor ? 0.15 : 0.12)
  );

  const categories = ['All', 'Modern', 'Classic', 'Specialty', 'Commercial'].filter(cat => 
    cat === 'All' || styles.some(s => s.category === cat)
  );

  const filteredStyles = activeCategory === 'All'
    ? styles
    : styles.filter(s => s.category === activeCategory);

  const handleSelectStyle = (style: ArchStyleDef) => {
    setSelectedStyleId(style.id);
  };

  const handleConfirm = () => {
    onApplyStyle(selectedStyleId, [width, height, depth]);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div 
        className={cn(
          "w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl shadow-2xl border overflow-hidden",
          theme === 'dark' ? "bg-gray-900 border-gray-700 text-gray-100" : "bg-white border-gray-200 text-gray-900"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={cn(
          "px-6 py-4 flex items-center justify-between border-b",
          theme === 'dark' ? "border-gray-800 bg-gray-900/50" : "border-gray-100 bg-gray-50/70"
        )}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-trimble-blue/10 text-trimble-blue flex items-center justify-center font-bold">
              <Layers size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                {isDoor ? 'Architectural Door Styles' : 'Architectural Window Styles'}
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-trimble-blue/10 text-trimble-blue">
                  {styles.length} Styles Available
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose a CAD-accurate architectural profile. Changes apply immediately to the 3D model and wall cutouts.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Categories Bar */}
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2 overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                activeCategory === cat
                  ? "bg-trimble-blue text-white shadow-sm"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredStyles.map((style) => {
            const isSelected = selectedStyleId === style.id;
            const isCurrent = currentStyleId === style.id;

            return (
              <div
                key={style.id}
                onClick={() => handleSelectStyle(style)}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectStyle(style); }
                }}
                className={cn(
                  "group relative flex flex-col rounded-xl border p-4 cursor-pointer transition-all duration-200",
                  "outline-none focus-visible:ring-2 focus-visible:ring-trimble-blue focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900",
                  isSelected
                    ? "border-trimble-blue ring-2 ring-trimble-blue/20 bg-trimble-blue/[0.03] shadow-md"
                    : "border-gray-200 dark:border-gray-800 hover:border-trimble-blue/50 hover:bg-gray-50/50 dark:hover:bg-gray-800/40"
                )}
              >
                {/* The drawing leads: it is what the eye compares. */}
                <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 flex items-center justify-center">
                  <StyleDiagram style={style} />
                </div>

                <h3 className={cn("mt-3 font-semibold text-sm leading-snug", theme === 'dark' ? "text-white" : "text-gray-900")}>
                  {style.name}
                </h3>

                {/* Two lines, reserved whether or not the copy fills them, so
                    cards stay the same height and the grid keeps its rhythm. */}
                <p className={cn("mt-1 text-xs leading-relaxed line-clamp-2 min-h-[2.5rem]", theme === 'dark' ? "text-gray-400" : "text-gray-600")}>
                  {style.description}
                </p>

                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-trimble-blue/10 text-trimble-blue">
                    {style.category}
                  </span>
                  {style.features.map((feat, idx) => (
                    <span key={idx} className={cn("text-[11px] px-2 py-0.5 rounded-full", theme === 'dark' ? "bg-gray-800/80 text-gray-300" : "bg-gray-100 text-gray-700")}>
                      {feat}
                    </span>
                  ))}
                </div>

                {/*
                  One mark for one state. Selection was previously carried by a
                  ring, a tinted background, a check badge AND a separate
                  "Active" pill, which left the user reading four signals for
                  the same fact and no signal for the difference between "the
                  style already applied" and "the style I just clicked".
                  The check is selection; the label below names the applied one.
                */}
                {isSelected && (
                  <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-trimble-blue text-white flex items-center justify-center shadow-sm shadow-trimble-blue/30">
                    <Check size={12} strokeWidth={3} />
                  </div>
                )}
                {isCurrent && !isSelected && (
                  <span className="absolute top-3 right-3 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                    Applied
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer Dimensions & Actions */}
        <div className={cn(
          "px-6 py-4 border-t flex flex-col sm:flex-row items-center justify-between gap-4",
          theme === 'dark' ? "border-gray-800 bg-gray-900/80" : "border-gray-100 bg-gray-50/80"
        )}>
          {/* Quick Dimensions */}
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <Sliders size={16} className="text-gray-400" />
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-gray-500">Width:</span>
              <input 
                type="number" 
                step="0.05"
                min="0.4"
                max="4.0"
                value={width}
                onChange={(e) => setWidth(parseFloat(e.target.value) || width)}
                className="w-16 px-2 py-1 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:border-trimble-blue"
              />
              <span className="text-gray-400">m</span>

              <span className="font-medium text-gray-500 ml-2">Height:</span>
              <input 
                type="number" 
                step="0.05"
                min="0.4"
                max="4.0"
                value={height}
                onChange={(e) => setHeight(parseFloat(e.target.value) || height)}
                className="w-16 px-2 py-1 text-xs font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:border-trimble-blue"
              />
              <span className="text-gray-400">m</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-5 py-2 text-xs font-bold rounded-lg bg-trimble-blue hover:bg-trimble-blue/90 text-white shadow-sm flex items-center gap-2 transition-transform active:scale-95"
            >
              <span>Apply Style</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
