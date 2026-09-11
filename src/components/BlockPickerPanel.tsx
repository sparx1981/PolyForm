import React, { useState, useMemo, useRef } from 'react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import {
  Box, X, ChevronDown, ChevronUp, Sparkles, Layers, FileText, LayoutGrid,
  GripVertical
} from 'lucide-react';
import { BLOCK_CATALOG, BLOCK_CATEGORIES, BlockPart } from '../lib/blockKitGeometry';

const SWATCHES = [
  '#dc2626', '#2563eb', '#facc15', '#16a34a', '#f1f5f9', '#18181b', '#78350f', '#94a3b8', '#4b5563',
  '#d4a574', '#a16207', '#f97316', '#7f1d1d', '#1e3a8a', '#94a3a8', '#a3a832', '#14532d', '#f9a8d4',
  '#6d28d9', '#0891b2', '#84cc16', '#3f2c1d', '#f0fdf4', '#7dd3fc', '#ef4444'
];

function CollapsibleRow({
  icon, label, isOpen, onToggle, children
}: { icon: React.ReactNode; label: string; isOpen: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <div className="border-b border-gray-100 dark:border-gray-800">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
      >
        <span className="flex items-center gap-2">{icon}{label}</span>
        {isOpen ? <ChevronUp size={13} className="text-gray-400" /> : <ChevronDown size={13} className="text-gray-400" />}
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export default function BlockPickerPanel() {
  const {
    isBlockPickerOpen, setIsBlockPickerOpen,
    activeBlockPart, setActiveBlockPart,
    setActiveTool, theme, setMeasurements, setConsoleOutput
  } = useApp();

  const [scaleFactor, setScaleFactor] = useState(8);
  const [preventOverlaps, setPreventOverlaps] = useState(true);
  const [selectedColor, setSelectedColor] = useState('#dc2626');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    scale: true, colour: true, aiBuild: false, assemblies: false, partsList: false, modelLibrary: false, blocks: true, Basics: true
  });
  const [categoryFilter, setCategoryFilter] = useState<'All' | string>('All');
  const [isMinimized, setIsMinimized] = useState(false);
  const [pos, setPos] = useState({ x: 96, y: 72 });
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);

  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const filteredParts = useMemo(() => {
    return categoryFilter === 'All' ? BLOCK_CATALOG : BLOCK_CATALOG.filter(p => p.category === categoryFilter);
  }, [categoryFilter]);

  const partsByCategory = useMemo(() => {
    const map: Record<string, BlockPart[]> = {};
    for (const p of filteredParts) {
      (map[p.category] ||= []).push(p);
    }
    return map;
  }, [filteredParts]);

  if (!isBlockPickerOpen) return null;

  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, initX: pos.x, initY: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos({ x: dragRef.current.initX + dx, y: dragRef.current.initY + dy });
  };
  const handlePointerUp = () => { dragRef.current = null; };

  const selectPart = (part: BlockPart) => {
    setActiveBlockPart({ partId: part.id, color: selectedColor, rotationSteps: 0 });
    setActiveTool('block_picker');
    setMeasurements(`${part.label} selected - click in the viewport to position it.`);
  };

  const pitchMm = (0.08 * (scaleFactor / 8) * 1000).toFixed(1);
  const brickMm = (0.096 * (scaleFactor / 8) * 1000).toFixed(1);
  const plateMm = (0.032 * (scaleFactor / 8) * 1000).toFixed(1);

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, width: 300, zIndex: 60 }}
      className={cn(
        "rounded-xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh]",
        theme === 'dark' ? "bg-gray-900 border-gray-700 text-gray-100" : "bg-white border-gray-200 text-gray-900"
      )}
    >
      {/* Header */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={cn(
          "flex items-center justify-between px-3 h-9 border-b cursor-grab active:cursor-grabbing shrink-0",
          theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
        )}
      >
        <div className="flex items-center gap-2 text-xs font-bold">
          <GripVertical size={13} className="text-gray-400" />
          <Box size={14} className="text-trimble-blue" />
          <span>Block Picker</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setIsMinimized(m => !m)} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" title={isMinimized ? "Expand" : "Minimize"}>
            {isMinimized ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
          <button type="button" onClick={() => { setIsBlockPickerOpen(false); if (setActiveTool) setActiveTool('select'); }} className="p-1 rounded hover:bg-red-500/15 hover:text-red-500 text-gray-400" title="Close">
            <X size={13} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="overflow-y-auto flex-1 text-xs">
          {/* Scale */}
          <CollapsibleRow icon={<LayoutGrid size={13} className="text-trimble-blue" />} label="Scale" isOpen={openSections.scale} onToggle={() => toggleSection('scale')}>
            <input
              type="range" min={1} max={16} step={1} value={scaleFactor}
              onChange={e => setScaleFactor(parseInt(e.target.value))}
              className="w-full h-1 accent-trimble-blue mb-1.5"
            />
            <div className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
              {scaleFactor}x &rarr; {pitchMm}mm pitch, {brickMm}mm brick, {plateMm}mm plate
            </div>
            <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={preventOverlaps} onChange={e => setPreventOverlaps(e.target.checked)} className="accent-trimble-blue" />
              Prevent overlaps (blocks can't merge; studs still nest as normal)
            </label>
          </CollapsibleRow>

          {/* Colour */}
          <CollapsibleRow icon={<span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: selectedColor }} />} label="Colour" isOpen={openSections.colour} onToggle={() => toggleSection('colour')}>
            <div className="grid grid-cols-9 gap-1.5">
              {SWATCHES.map(c => (
                <button
                  key={c} type="button" onClick={() => setSelectedColor(c)}
                  className={cn("w-6 h-6 rounded-md border-2 transition-transform hover:scale-110", selectedColor === c ? "border-trimble-blue" : "border-transparent")}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <input
                type="color" value={selectedColor} onChange={e => setSelectedColor(e.target.value)}
                className="w-6 h-6 rounded-md border-2 border-gray-300 dark:border-gray-600 cursor-pointer bg-transparent"
                title="Custom colour"
              />
            </div>
          </CollapsibleRow>

          {/* AI Build */}
          <CollapsibleRow icon={<Sparkles size={13} className="text-violet-500" />} label="AI Build" isOpen={openSections.aiBuild} onToggle={() => toggleSection('aiBuild')}>
            <button
              type="button"
              onClick={() => {
                const idea = window.prompt("Describe a build concept (e.g. 'a small lighthouse'):");
                if (idea) {
                  setConsoleOutput(c => [...c, `[Block Picker] Requested AI concept build for: ${idea}`]);
                }
              }}
              className="w-full py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5"
            >
              <Sparkles size={12} /> Generate Concept
            </button>
          </CollapsibleRow>

          {/* Nav rows */}
          <CollapsibleRow icon={<Layers size={13} className="text-amber-500" />} label="Assemblies / Groups" isOpen={openSections.assemblies} onToggle={() => toggleSection('assemblies')}>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">Multi-block assemblies you've saved will appear here.</p>
          </CollapsibleRow>
          <CollapsibleRow icon={<FileText size={13} className="text-emerald-500" />} label="Used Parts List" isOpen={openSections.partsList} onToggle={() => toggleSection('partsList')}>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">A bill-of-materials of placed blocks will appear here.</p>
          </CollapsibleRow>
          <CollapsibleRow icon={<Box size={13} className="text-sky-500" />} label="Model Library" isOpen={openSections.modelLibrary} onToggle={() => toggleSection('modelLibrary')}>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">Saved preset builds will appear here.</p>
          </CollapsibleRow>

          {/* Blocks browser */}
          <CollapsibleRow icon={<Box size={13} className="text-trimble-blue" />} label="Blocks" isOpen={openSections.blocks} onToggle={() => toggleSection('blocks')}>
            <div className="flex flex-wrap gap-1 mb-2">
              {['All', ...BLOCK_CATEGORIES].map(cat => (
                <button
                  key={cat} type="button" onClick={() => setCategoryFilter(cat)}
                  className={cn(
                    "px-2 py-1 rounded-full text-[10px] font-medium whitespace-nowrap",
                    categoryFilter === cat ? "bg-trimble-blue text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            {Object.entries(partsByCategory).map(([category, parts]) => (
              <div key={category} className="mb-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{category}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {parts.map(part => (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => selectPart(part)}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-lg border text-center transition-all",
                        activeBlockPart?.partId === part.id
                          ? "border-trimble-blue bg-trimble-blue/10"
                          : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                      )}
                    >
                      <div className="w-8 h-8 rounded" style={{ backgroundColor: selectedColor }} />
                      <span className="text-[10px] font-medium">{part.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </CollapsibleRow>
        </div>
      )}
    </div>
  );
}
