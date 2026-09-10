import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Settings, Info, Zap, Move, RotateCw, RotateCcw, Maximize2, Scissors, Circle, MousePointer2, PanelRightClose, Building2, Home, AlignCenter, AlignLeft, AlignRight, CheckCircle2, ChevronDown, ChevronUp, Hammer, Layers, Spline, Hexagon, Lasso, SquareDashed, CheckSquare, X, AlertCircle, Loader2, SlidersHorizontal, PersonStanding } from 'lucide-react';
import { buildRoofShapeForRoom, buildRoofAssemblyForRoom, buildNextFloorLevel, buildCeilingSlabForRoom, RoofParams } from '../lib/archRoofGenerator';
import { generateTimberFrameForBuilding } from '../lib/timberFrameGenerator';
import { WallJustification } from '../tools/inference/types';
import { NumberField, SectionLabel, EmptyState, Chip } from './ui/Surface';
import { DEFAULT_TIMBER_FRAME_PARAMS, STRUCTURAL_VALIDATION_RULES } from '../constants/timberFrameDefaults';
import { TimberFrameParams, Shape } from '../types';
import { ErrorBoundary } from './ErrorBoundary';
import { RoofModifierSection } from './RoofModifierSection';
import { ScaleFigureModifierSection } from './ScaleFigureModifierSection';

export const ToolModifierPalette: React.FC = () => {
  const { 
    activeTool, 
    theme,
    contactFrictionEnabled,
    setContactFrictionEnabled,
    contactFrictionStrength,
    setContactFrictionStrength,
    deformationSettings,
    setDeformationSettings,
    autoOrbitEnabled,
    setAutoOrbitEnabled,
    orbitRotationSpeed,
    setOrbitRotationSpeed,
    rightPanelVisible,
    isToolModifierDocked,
    setIsToolModifierDocked,
    wallToolSettings,
    setWallToolSettings,
    wallJustification,
    setWallJustification,
    activeStory,
    setActiveStory,
    shapes,
    setShapes,
    selectedId,
    setSelectedId,
    selectedIds,
    setSelectedIds,
    selectedFaceIds,
    setSelectedFaceIds,
    selectionShapeMode,
    setSelectionShapeMode,
    selectionFilter,
    setSelectionFilter,
    kernelHost,
    addShape,
    commitHistory,
    setMeasurements
  } = useApp();

  // Roof parametric customization state
  const [roofPitchAngle, setRoofPitchAngle] = useState<number>(35);
  const [roofOverhang, setRoofOverhang] = useState<number>(0.30);
  const [roofFasciaHeight, setRoofFasciaHeight] = useState<number>(0.18);
  const [roofColor, setRoofColor] = useState<string>('#991b1b');
  const [fasciaColor, setFasciaColor] = useState<string>('#ffffff');
  const [showRoofSettings, setShowRoofSettings] = useState<boolean>(false);
  const [bezierSegments, setBezierSegments] = useState<number>(24);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const hasSettings = [
    'move', 
    'bevel', 
    'deform', 
    'orbit',
    'wall',
    'bezier',
    'polygon',
    'select',
    'lasso',
    'timber-frame',
    'roof',
    'scale_figure'
  ].includes(activeTool);

  if (!hasSettings) return null;

  const handleCloseRoom = () => {
    // 1. Dispatch custom event so Viewport cleanly closes the active in-flight wall loop
    window.dispatchEvent(new CustomEvent('polyform:close-wall-room'));

    // 2. Also dispatch keyboard event 'c' as secondary fallback
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));

    // 3. If no in-flight wall loop is active, but walls exist on the model, verify if slab is already present or assemble one
    const wallShapes = shapes.filter(s => s.type === 'wall');
    if (wallShapes.length >= 3) {
      const hasSlab = shapes.some(s => 
        (s.tags?.includes('floor-slab') || s.name?.toLowerCase().includes('floor slab')) &&
        (s.tags?.includes(`story-${activeStory || 1}`) || !s.tags?.some(t => t.startsWith('story-')))
      );
      if (!hasSlab) {
        const slab = buildCeilingSlabForRoom(wallShapes, 0.20, '#cbd5e1');
        if (slab) {
          slab.name = `Floor Slab (Story ${activeStory || 1})`;
          slab.tags = ['architecture', `story-${activeStory || 1}`, 'floor-slab'];
          addShape(slab);
          commitHistory();
          setMeasurements(`Closed room and created floor slab for Story ${activeStory || 1}.`);
        }
      }
    }
  };

  const handleStackStory = () => {
    const wallShapes = shapes.filter(s => s.type === 'wall');
    if (wallShapes.length === 0) {
      setMeasurements('No walls found to stack. Draw a room first.');
      return;
    }
    const { newWalls, newOpenings, newSlabs } = buildNextFloorLevel(wallShapes, shapes, true);
    newWalls.forEach(w => addShape(w));
    newOpenings.forEach(op => addShape(op));
    newSlabs.forEach(slab => addShape(slab));
    commitHistory();
    setActiveStory(prev => prev + 1);
    setMeasurements(`Stacked new Story Level ${activeStory + 1} with floor slab and walls.`);
  };

  const handleGenerateRoof = (roofType: 'gable' | 'hip' | 'parapet') => {
    const wallShapes = shapes.filter(s => s.type === 'wall');
    if (wallShapes.length === 0) {
      setMeasurements('No walls found. Draw a closed room to generate a roof.');
      return;
    }
    const assembly = buildRoofAssemblyForRoom(wallShapes, { 
      roofType, 
      pitchAngleDeg: roofType === 'parapet' ? 0 : roofPitchAngle, 
      usePitchAngle: roofType !== 'parapet',
      eaveOverhang: roofType === 'parapet' ? 0 : roofOverhang,
      fasciaHeight: roofFasciaHeight,
      color: roofType === 'parapet' ? '#475569' : roofColor,
      fasciaColor: fasciaColor
    }, shapes);
    if (assembly) {
      const isExistingRoof = (s: Shape) =>
        s.type === 'roof' ||
        s.tags?.some(t => t.startsWith('roof-') || t === 'roof') ||
        s.name?.toLowerCase().includes('roof') ||
        s.id.startsWith('roof_') ||
        s.id.startsWith('tiles_roof_');
      const nonRoofShapes = shapes.filter(s => !isExistingRoof(s));
      setShapes([...nonRoofShapes, ...assembly.allShapes]);
      commitHistory();
      if (setSelectedId) setSelectedId(assembly.roofShape.id);
      setMeasurements(`Replaced roof with ${roofType === 'parapet' ? 'Parapet Roof' : roofType === 'hip' ? 'Hip' : 'Gable'} Roof assembly.`);
    }
  };

  const handleAddTimberFrame = () => {
    // Check if timber frame already exists
    const existingTimber = shapes.filter(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber '));
    if (existingTimber.length > 0) {
      // Remove old and regenerate
      const existingIds = new Set(existingTimber.map(t => t.id));
      const remainingShapes = shapes.filter(s => !existingIds.has(s.id));
      const result = generateTimberFrameForBuilding(remainingShapes, {
        studSpacing: 0.40,
        joistSpacing: 0.40,
        rafterSpacing: 0.60
      });
      if (result.members.length === 0) {
        setMeasurements('No walls, floors, or roof found to frame.');
        return;
      }
      setShapes([...remainingShapes, ...result.members]);
      commitHistory();
      setMeasurements(`Updated Timber Frame construction (${result.members.length} members: studs, plates, headers, joists & rafters).`);
      return;
    }

    const result = generateTimberFrameForBuilding(shapes, {
      studSpacing: 0.40,
      joistSpacing: 0.40,
      rafterSpacing: 0.60
    });
    if (result.members.length === 0) {
      setMeasurements('No walls, floors, or roof found. Draw walls, floors or a roof first to generate timber frame construction.');
      return;
    }
    result.members.forEach(m => addShape(m));
    commitHistory();
    setMeasurements(`Added Timber Frame construction (${result.members.length} members: walls, floors & roof).`);
  };

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
        "z-30 rounded-xl border shadow-xl overflow-hidden transition-all duration-300 flex flex-col",
        theme === 'dark' ? "bg-gray-900 border-gray-700 shadow-black/50" : "bg-white border-gray-200 shadow-xl",
        isToolModifierDocked ? "relative w-full shadow-none border-none rounded-none max-h-full" : "fixed w-64 max-h-[calc(100vh-100px)]"
      )}
    >
      <div 
        className={cn(
          "px-3 h-10 border-b flex items-center justify-between select-none shrink-0",
          theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-100",
          !isToolModifierDocked ? "cursor-move active:cursor-grabbing" : "cursor-default"
        )}
      >
        <div className="flex items-center gap-2">
          {activeTool === 'wall' ? (
            <Building2 size={14} className="text-trimble-blue" />
          ) : activeTool === 'timber-frame' ? (
            <Hammer size={14} className="text-amber-500" />
          ) : activeTool === 'roof' ? (
            <Home size={14} className="text-sky-500" />
          ) : activeTool === 'scale_figure' ? (
            <PersonStanding size={14} className="text-emerald-500" />
          ) : activeTool === 'bezier' ? (
            <Spline size={14} className="text-trimble-blue" />
          ) : (activeTool === 'select' || activeTool === 'lasso') ? (
            <Lasso size={14} className="text-trimble-blue" />
          ) : (
            <Settings size={14} className="text-trimble-blue" />
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {activeTool === 'wall' ? 'Architecture Modifiers' : activeTool === 'timber-frame' ? 'Timber Frame Modifiers' : activeTool === 'roof' ? 'Roof Modifiers' : activeTool === 'scale_figure' ? 'Scale Figure Modifiers' : activeTool === 'bezier' ? 'Bézier Modifiers' : (activeTool === 'select' || activeTool === 'lasso') ? 'Selection Modifiers' : 'Tool Modifiers'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[9px] font-mono text-trimble-blue px-1.5 py-0.5 bg-trimble-blue/10 rounded">
            {activeTool.toUpperCase()}
          </div>
          {!isToolModifierDocked && (
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              title={isCollapsed ? "Expand Palette" : "Collapse Palette"}
            >
              {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          )}
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

      {(!isCollapsed || isToolModifierDocked) && (
        <>
          <div className="p-3 space-y-4 overflow-y-auto flex-1 max-h-[calc(100vh-140px)] select-text">
        {activeTool === 'wall' && (
          <div className="space-y-3">
            {/* Justification Selector */}
            <div className="space-y-1.5">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                Wall Justification <span className="font-mono text-gray-400 text-[9px]">(Tab / J)</span>
              </div>
              <div className="grid grid-cols-3 gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                {[
                  { id: 'exterior', label: 'Exterior', icon: <AlignLeft size={12} /> },
                  { id: 'center', label: 'Center', icon: <AlignCenter size={12} /> },
                  { id: 'interior', label: 'Interior', icon: <AlignRight size={12} /> },
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setWallJustification(item.id as WallJustification);
                      setWallToolSettings(prev => ({ ...prev, justification: item.id as WallJustification }));
                    }}
                    className={cn(
                      "py-1 px-1.5 rounded flex items-center justify-center gap-1 text-[10px] font-medium transition-all cursor-pointer",
                      (wallJustification === item.id || wallToolSettings.justification === item.id)
                        ? "bg-trimble-blue text-white shadow-sm font-bold"
                        : "text-gray-600 dark:text-gray-300 hover:bg-white/50 dark:hover:bg-gray-700"
                    )}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Thickness Presets */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                <span>Thickness <span className="font-mono text-gray-400 text-[9px]">(T)</span></span>
                <span className="font-mono text-trimble-blue">{(wallToolSettings.thickness * 1000).toFixed(0)} mm</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { value: 0.10, label: '100mm', sub: 'Partition' },
                  { value: 0.20, label: '200mm', sub: 'Standard' },
                  { value: 0.30, label: '300mm', sub: 'Cavity' },
                ].map(preset => (
                  <button
                    key={preset.value}
                    onClick={() => setWallToolSettings(prev => ({ ...prev, thickness: preset.value }))}
                    className={cn(
                      "py-1.5 px-1 rounded-lg border text-center transition-all cursor-pointer",
                      Math.abs(wallToolSettings.thickness - preset.value) < 0.01
                        ? "border-trimble-blue bg-trimble-blue/10 text-trimble-blue font-bold"
                        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-trimble-blue/40 hover:bg-gray-50 dark:hover:bg-gray-750"
                    )}
                  >
                    <div className="text-[11px] font-mono leading-none">{preset.label}</div>
                    <div className="text-[8px] text-gray-400 leading-tight mt-0.5">{preset.sub}</div>
                  </button>
                ))}
              </div>
              <input 
                type="range" min="0.05" max="0.60" step="0.01"
                value={wallToolSettings.thickness}
                onChange={(e) => setWallToolSettings(prev => ({ ...prev, thickness: parseFloat(e.target.value) }))}
                className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue mt-1"
                title="Adjust custom wall thickness"
              />
            </div>

            {/* Wall Height */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                <span>Wall Height</span>
                <span className="font-mono text-trimble-blue">{wallToolSettings.height.toFixed(2)} m</span>
              </div>
              <input 
                type="range" min="1.0" max="6.0" step="0.1"
                value={wallToolSettings.height}
                onChange={(e) => setWallToolSettings(prev => ({ ...prev, height: parseFloat(e.target.value) }))}
                className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                title="Adjust wall height"
              />
            </div>

            {/* Story & Roof Quick Actions */}
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-1.5">
              <div className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                Architecture Actions
              </div>

              {/* 1. Stack Story Level */}
              <button
                id="arch-stack-story-btn"
                onClick={handleStackStory}
                className="w-full py-1.5 px-2.5 bg-gray-50 hover:bg-trimble-blue/5 dark:bg-gray-800 dark:hover:bg-gray-700/80 text-gray-700 dark:text-gray-200 hover:text-trimble-blue dark:hover:text-sky-300 border border-gray-200 dark:border-gray-700 hover:border-trimble-blue/30 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                title="Duplicate & stack story walls onto the next vertical floor"
              >
                <Building2 size={13} className="text-trimble-blue dark:text-sky-400" />
                <span>Stack Story Level {activeStory + 1}</span>
              </button>

              {/* 2. Gable / Hip / Parapet Roof Grid */}
              <div className="grid grid-cols-3 gap-1">
                <button
                  id="arch-gable-roof-btn"
                  onClick={() => handleGenerateRoof('gable')}
                  className="py-1.5 px-1 bg-gray-50 hover:bg-trimble-blue/5 dark:bg-gray-800 dark:hover:bg-gray-700/80 text-gray-700 dark:text-gray-200 hover:text-trimble-blue dark:hover:text-sky-300 border border-gray-200 dark:border-gray-700 hover:border-trimble-blue/30 rounded-lg text-[10px] font-semibold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer"
                  title="Generate Detailed Parametric Gable Roof with Fascia & Eaves"
                >
                  <Home size={12} className="text-trimble-blue dark:text-sky-400" />
                  <span>Gable</span>
                </button>
                <button
                  id="arch-hip-roof-btn"
                  onClick={() => handleGenerateRoof('hip')}
                  className="py-1.5 px-1 bg-gray-50 hover:bg-trimble-blue/5 dark:bg-gray-800 dark:hover:bg-gray-700/80 text-gray-700 dark:text-gray-200 hover:text-trimble-blue dark:hover:text-sky-300 border border-gray-200 dark:border-gray-700 hover:border-trimble-blue/30 rounded-lg text-[10px] font-semibold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer"
                  title="Generate Detailed Parametric Hip Roof with Fascia & Eaves"
                >
                  <Home size={12} className="text-trimble-blue dark:text-sky-400" />
                  <span>Hip</span>
                </button>
                <button
                  id="arch-parapet-roof-btn"
                  onClick={() => handleGenerateRoof('parapet')}
                  className="py-1.5 px-1 bg-gray-50 hover:bg-trimble-blue/5 dark:bg-gray-800 dark:hover:bg-gray-700/80 text-gray-700 dark:text-gray-200 hover:text-trimble-blue dark:hover:text-sky-300 border border-gray-200 dark:border-gray-700 hover:border-trimble-blue/30 rounded-lg text-[10px] font-semibold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer"
                  title="Generate Detailed Parametric Parapet Flat Roof with Coping"
                >
                  <Home size={12} className="text-trimble-blue dark:text-sky-400" />
                  <span>Parapet</span>
                </button>
              </div>

              {/* Roof Details & Options Toggle */}
              <div className="bg-gray-50/80 dark:bg-gray-800/60 rounded-lg p-2 border border-gray-200/80 dark:border-gray-700/60 space-y-2 text-[11px]">
                <button 
                  onClick={() => setShowRoofSettings(!showRoofSettings)}
                  className="w-full flex items-center justify-between text-gray-600 dark:text-gray-300 font-medium hover:text-trimble-blue transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-trimble-blue" />
                    <span>Roof Design & Fascia Options</span>
                  </span>
                  {showRoofSettings ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>

                {showRoofSettings && (
                  <div className="pt-2 border-t border-gray-200/50 dark:border-gray-700/50">
                    <RoofModifierSection />
                  </div>
                )}
              </div>

              {/* 3. Add Timber Frame */}
              <button
                id="arch-add-timber-frame-btn"
                onClick={handleAddTimberFrame}
                className="w-full py-1.5 px-2.5 bg-sky-50/80 hover:bg-sky-100/90 dark:bg-sky-950/30 dark:hover:bg-sky-900/40 text-sky-900 dark:text-sky-200 border border-sky-200/80 dark:border-sky-800/60 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
                title="Generate Timber Frame structure (Studs, Bottom/Top Plates, Headers, Floor Joists & Roof Rafters) meeting building guidelines"
              >
                <Hammer size={13} className="text-trimble-blue dark:text-sky-400" />
                <span>{shapes.some(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber ')) ? 'Update Timber Frame' : 'Add Timber Frame'}</span>
              </button>

              {/* 4. Close Room (placed below Gable roof / hip roof buttons) */}
              <button
                id="arch-close-room-btn"
                onClick={handleCloseRoom}
                className="w-full py-2 px-3 bg-trimble-blue hover:bg-trimble-dark-blue active:scale-[0.99] text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                title="Assemble Monolithic Floor Slab & Close Room Loop directly back to origin (Shortcut: C or Enter)"
              >
                <CheckCircle2 size={14} className="text-white" />
                <span>Close Room</span>
                <span className="ml-auto text-[9px] font-mono opacity-80 bg-white/20 px-1 py-0.5 rounded">C / ↵</span>
              </button>
            </div>
          </div>
        )}

        {activeTool === 'timber-frame' && (
          <ErrorBoundary name="Timber Frame Panel" compact>
            <TimberFrameModifierSection />
          </ErrorBoundary>
        )}

        {activeTool === 'roof' && (
          <ErrorBoundary name="Roof Modifiers Panel" compact>
            <RoofModifierSection />
          </ErrorBoundary>
        )}

        {activeTool === 'scale_figure' && (
          <ErrorBoundary name="Scale Figure Modifiers Panel" compact>
            <ScaleFigureModifierSection />
          </ErrorBoundary>
        )}

        {activeTool === 'bezier' && (
          <div className="space-y-3">
            {/* Resolution (Segments per span) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                <span>Span Resolution</span>
                <span className="font-mono text-trimble-blue">{bezierSegments} segments</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[12, 24, 36, 48].map((seg) => (
                  <button
                    key={seg}
                    onClick={() => {
                      setBezierSegments(seg);
                      window.dispatchEvent(new CustomEvent('polyform:set-bezier-resolution', { detail: { segments: seg } }));
                      setMeasurements(`Resolution set to ${seg}s`);
                    }}
                    className={cn(
                      "py-1 text-[10px] font-mono font-bold rounded border transition-colors cursor-pointer",
                      bezierSegments === seg
                        ? "bg-trimble-blue text-white border-trimble-blue shadow-xs"
                        : theme === 'dark' ? "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700" : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                    )}
                  >
                    {seg}s
                  </button>
                ))}
              </div>
            </div>

            {/* Vector Mechanics Guide */}
            <div className={cn(
              "p-2 rounded-lg border text-[10px] space-y-1.5",
              theme === 'dark' ? "bg-gray-800/60 border-gray-700/80 text-gray-300" : "bg-blue-50/60 border-blue-100 text-blue-950"
            )}>
              <div className="font-semibold text-[10px] text-trimble-blue flex items-center gap-1.5">
                <Spline size={12} />
                <span>Vector Mechanics</span>
              </div>
              <ul className="space-y-1 text-[9px] list-disc list-inside text-gray-500 dark:text-gray-400">
                <li><strong className="text-gray-700 dark:text-gray-200">Click:</strong> Sharp corner knot</li>
                <li><strong className="text-gray-700 dark:text-gray-200">Click & Drag:</strong> Smooth C1 tangent</li>
                <li><strong className="text-gray-700 dark:text-gray-200">Alt + Drag:</strong> Broken tangent handle</li>
                <li><strong className="text-gray-700 dark:text-gray-200">Type '36s':</strong> Set segment resolution</li>
                <li><strong className="text-gray-700 dark:text-gray-200">Type length:</strong> Lock tangent magnitude</li>
              </ul>
            </div>

            {/* Action buttons */}
            <div className="space-y-1.5 pt-1">
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('polyform:close-bezier-loop'));
                  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
                }}
                className="w-full py-2 px-3 bg-trimble-blue hover:bg-trimble-blue-hover text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                title="Close loop back to origin and generate a solid planar face ready for Push/Pull"
              >
                <CheckCircle2 size={14} className="text-white" />
                <span>Close Loop & Form Surface</span>
                <span className="ml-auto text-[9px] font-mono opacity-80 bg-white/20 px-1 py-0.5 rounded">C</span>
              </button>

              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('polyform:finish-bezier-path'));
                  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                }}
                className={cn(
                  "w-full py-1.5 px-3 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 transition-colors cursor-pointer",
                  theme === 'dark' ? "border-gray-700 hover:bg-gray-800 text-gray-300" : "border-gray-200 hover:bg-gray-50 text-gray-700"
                )}
                title="Commit open curve path as edge chain"
              >
                <span>Finish Open Path</span>
                <span className="ml-auto text-[9px] font-mono opacity-60">↵ Enter</span>
              </button>
            </div>
          </div>
        )}

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
                  "w-8 h-4 rounded-full relative transition-colors cursor-pointer",
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

            {contactFrictionEnabled && (
              <div className="space-y-1.5 pt-1 border-t border-gray-100 dark:border-gray-800">
                <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                  <span>Friction Strength</span>
                  <span className="font-mono text-trimble-blue">{contactFrictionStrength}%</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="100" 
                  step="5"
                  value={contactFrictionStrength}
                  onChange={(e) => setContactFrictionStrength(Number(e.target.value))}
                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                  title={`Friction Strength: ${contactFrictionStrength}%`}
                />
                <div className="flex justify-between text-[8px] text-gray-400 font-mono">
                  <span>Soft (10%)</span>
                  <span>Medium (50%)</span>
                  <span>Firm (100%)</span>
                </div>
              </div>
            )}

            <p className="text-[9px] text-gray-400 italic leading-tight">
              Adds tactile resistance when objects touch to help precise alignment.
            </p>
          </div>
        )}

        {activeTool === 'deform' && (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase">
                <span>Brush Radius</span>
                <span className="font-mono text-trimble-blue">{deformationSettings.radius.toFixed(1)}</span>
              </div>
              <input 
                type="range" min="0.5" max="10" step="0.1"
                value={deformationSettings.radius}
                onChange={(e) => setDeformationSettings({ ...deformationSettings, radius: parseFloat(e.target.value) })}
                className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-gray-500 font-bold uppercase">
                <span>Brush Strength</span>
                <span className="font-mono text-trimble-blue">{deformationSettings.strength.toFixed(1)}</span>
              </div>
              <input 
                type="range" min="0.1" max="10" step="0.1"
                value={deformationSettings.strength}
                onChange={(e) => setDeformationSettings({ ...deformationSettings, strength: parseFloat(e.target.value) })}
                className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              {(['outward', 'inward', 'both'] as const).map(dir => (
                <button
                  key={dir}
                  onClick={() => setDeformationSettings({ ...deformationSettings, direction: dir })}
                  className={cn(
                    "flex-1 py-1 px-1.5 text-[9px] font-bold uppercase rounded border transition-all cursor-pointer",
                    deformationSettings.direction === dir 
                      ? "bg-trimble-blue text-white border-trimble-blue shadow-sm" 
                      : (theme === 'dark' ? "text-gray-400 border-gray-700 hover:bg-gray-800" : "text-gray-500 border-gray-200 hover:bg-gray-50")
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
                  "w-8 h-4 rounded-full relative transition-colors cursor-pointer",
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
                  <span className="font-mono text-trimble-blue">
                    {orbitRotationSpeed < 0.5 ? 'Slow' : orbitRotationSpeed > 1.5 ? 'Fast' : 'Mid'}
                  </span>
                </div>
                <input 
                  type="range" min="0.1" max="2.0" step="0.1"
                  value={orbitRotationSpeed}
                  onChange={(e) => setOrbitRotationSpeed(parseFloat(e.target.value))}
                  className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                  title="Control orbit velocity"
                />
              </div>
            )}
            <p className="text-[9px] text-gray-400 italic">Automatically rotates around the workspace center.</p>
          </div>
        )}

        {activeTool === 'polygon' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                <span>Polygon Presets</span>
                <span className="font-mono text-trimble-blue">N-Gons</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {[
                  { sides: 3, label: 'Tri (3)' },
                  { sides: 4, label: 'Quad (4)' },
                  { sides: 5, label: 'Pent (5)' },
                  { sides: 6, label: 'Hex (6)' },
                  { sides: 8, label: 'Oct (8)' },
                  { sides: 10, label: 'Dec (10)' },
                  { sides: 12, label: 'Dodec (12)' },
                  { sides: 16, label: '16-Gon' },
                ].map(({ sides, label }) => (
                  <button
                    key={sides}
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('polyform:set-polygon-sides', { detail: { sides } }));
                      window.dispatchEvent(new CustomEvent('polyform:measurements', { detail: { text: `Polygon set to ${sides} sides` } }));
                    }}
                    className={cn(
                      "py-1 text-[9px] font-mono font-bold rounded border transition-colors cursor-pointer text-center",
                      theme === 'dark' ? "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 hover:text-white" : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className={cn(
              "p-2 rounded-lg border text-[10px] space-y-1.5",
              theme === 'dark' ? "bg-gray-800/60 border-gray-700/80 text-gray-300" : "bg-blue-50/60 border-blue-100 text-blue-950"
            )}>
              <div className="font-semibold text-[10px] text-trimble-blue flex items-center gap-1.5">
                <Hexagon size={12} />
                <span>Polygon Controls</span>
              </div>
              <ul className="space-y-1 text-[9px] list-disc list-inside text-gray-500 dark:text-gray-400">
                <li><strong className="text-gray-700 dark:text-gray-200">1st Click:</strong> Place center origin point</li>
                <li><strong className="text-gray-700 dark:text-gray-200">2nd Click:</strong> Set outer radius and orientation</li>
                <li><strong className="text-gray-700 dark:text-gray-200">↑ / ↓ Arrow keys:</strong> Increase / decrease side count</li>
                <li><strong className="text-gray-700 dark:text-gray-200">Type '8s' + Enter:</strong> Set exact side count (e.g. 8 sides)</li>
                <li><strong className="text-gray-700 dark:text-gray-200">Type radius + Enter:</strong> Lock exact radius (e.g. 2.4m)</li>
              </ul>
            </div>
          </div>
        )}

        {(activeTool === 'select' || activeTool === 'lasso') && (
          <div className="space-y-3.5">
            {/* Mode: Lasso vs Marquee */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Selection Gesture
              </label>
              <div className="grid grid-cols-2 gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                <button
                  onClick={() => setSelectionShapeMode('lasso')}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all",
                    selectionShapeMode === 'lasso'
                      ? "bg-white dark:bg-gray-700 text-trimble-blue shadow-sm font-semibold"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  )}
                  title="Draw a freehand custom path around objects"
                >
                  <Lasso size={13} />
                  <span>Freehand Lasso</span>
                </button>
                <button
                  onClick={() => setSelectionShapeMode('marquee')}
                  className={cn(
                    "flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all",
                    selectionShapeMode === 'marquee'
                      ? "bg-white dark:bg-gray-700 text-trimble-blue shadow-sm font-semibold"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  )}
                  title="Drag a rectangular marquee window"
                >
                  <SquareDashed size={13} />
                  <span>Marquee Box</span>
                </button>
              </div>
            </div>

            {/* Target Filter */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Target Filter
              </label>
              <div className="grid grid-cols-3 gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                {[
                  { id: 'all' as const, label: 'All' },
                  { id: 'shapes' as const, label: 'Shapes' },
                  { id: 'surfaces' as const, label: 'Surfaces' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectionFilter(item.id)}
                    className={cn(
                      "py-1 px-1.5 rounded-md text-[11px] font-medium transition-all text-center",
                      selectionFilter === item.id
                        ? "bg-white dark:bg-gray-700 text-trimble-blue shadow-sm font-semibold"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                <span className="font-semibold">Current Selection</span>
                <span className="font-mono text-trimble-blue">
                  {selectedIds.length} shapes · {selectedFaceIds.length} faces
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <button
                  onClick={() => {
                    const allShapeIds = shapes.filter(s => !s.hidden).map(s => s.id);
                    const allFaceIds = kernelHost?.graph ? Array.from(kernelHost.graph.faces.keys()) : [];
                    setSelectedIds(allShapeIds);
                    setSelectedFaceIds(allFaceIds);
                    setSelectedId(allShapeIds[0] || null);
                    setMeasurements(`Selected all (${allShapeIds.length} shapes, ${allFaceIds.length} surfaces)`);
                  }}
                  className={cn(
                    "py-1 px-1.5 rounded border text-[10px] font-medium transition-colors text-center",
                    theme === 'dark'
                      ? "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
                      : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                  )}
                >
                  Select All
                </button>

                <button
                  onClick={() => {
                    const allShapeIds = shapes.filter(s => !s.hidden).map(s => s.id);
                    const currentSet = new Set(selectedIds);
                    const invertedShapes = allShapeIds.filter(id => !currentSet.has(id));

                    const allFaceIds = kernelHost?.graph ? Array.from(kernelHost.graph.faces.keys()) : [];
                    const currentFaceSet = new Set(selectedFaceIds);
                    const invertedFaces = allFaceIds.filter(id => !currentFaceSet.has(id));

                    setSelectedIds(invertedShapes);
                    setSelectedFaceIds(invertedFaces);
                    setSelectedId(invertedShapes[0] || null);
                    setMeasurements(`Inverted selection (${invertedShapes.length} shapes, ${invertedFaces.length} surfaces)`);
                  }}
                  className={cn(
                    "py-1 px-1.5 rounded border text-[10px] font-medium transition-colors text-center",
                    theme === 'dark'
                      ? "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
                      : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100"
                  )}
                >
                  Invert
                </button>

                <button
                  onClick={() => {
                    setSelectedId(null);
                    setSelectedIds([]);
                    setSelectedFaceIds([]);
                    setMeasurements('Cleared selection');
                  }}
                  disabled={selectedIds.length === 0 && selectedFaceIds.length === 0}
                  className={cn(
                    "py-1 px-1.5 rounded border text-[10px] font-medium transition-colors text-center",
                    selectedIds.length === 0 && selectedFaceIds.length === 0
                      ? "opacity-50 cursor-not-allowed border-gray-200 dark:border-gray-800 text-gray-400"
                      : (theme === 'dark'
                          ? "bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700"
                          : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100")
                  )}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={cn(
        "px-3 py-1.5 flex items-center gap-2 border-t shrink-0",
        theme === 'dark' ? "bg-gray-900/50 border-gray-700" : "bg-gray-50/50 border-gray-100"
      )}>
        <Info size={10} className="text-gray-400" />
        <span className="text-[9px] text-gray-400 leading-none">Settings are saved automatically</span>
      </div>
        </>
      )}
    </motion.div>
  );
};

export function TimberFrameModifierSection() {
  const {
    shapes,
    setShapes,
    selectedId,
    commitHistory,
    setMeasurements,
    timberFrameParams,
    setTimberFrameParams,
    timberFrameRecomputeState
  } = useApp();

  const [params, setParams] = useState<TimberFrameParams>(timberFrameParams || DEFAULT_TIMBER_FRAME_PARAMS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [spacingTolerance, setSpacingTolerance] = useState(0.005);
  
  // Interactive state selector for evaluating all 3 explicit visual states
  const [visualMode, setVisualMode] = useState<'auto' | 'active' | 'pending' | 'empty'>('auto');

  // Scene inspection
  const selectedShape = shapes.find(s => s.id === selectedId);
  const isFramableSelected = selectedShape && (
    selectedShape.type === 'wall' || 
    selectedShape.tags?.some(t => t.includes('wall') || t.includes('roof') || t.includes('timber-frame')) ||
    selectedShape.name?.toLowerCase().includes('wall') ||
    selectedShape.name?.toLowerCase().includes('roof') ||
    selectedShape.name?.toLowerCase().includes('timber')
  );
  const hasExistingFraming = shapes.some(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber ') || s.id.startsWith('tf-'));

  // Determine current effective state (including background recompute status)
  const currentState: 'active' | 'pending' | 'empty' = 
    visualMode !== 'auto'
      ? visualMode
      : (timberFrameRecomputeState?.status === 'pending' || timberFrameRecomputeState?.status === 'computing')
        ? 'pending'
        : (isFramableSelected || hasExistingFraming)
          ? 'active'
          : 'empty';

  // Live validation checks against STRUCTURAL_VALIDATION_RULES
  const validationErrors: string[] = [];
  if (params.studSpacing > STRUCTURAL_VALIDATION_RULES.maxStudSpacing) {
    validationErrors.push(`Stud spacing of ${(params.studSpacing * 1000).toFixed(0)}mm exceeds code maximum (${STRUCTURAL_VALIDATION_RULES.maxStudSpacingMm}mm / 600mm c/c) per Eurocode 5 / BS 5268.`);
  }
  if (params.studSpacing < 0.20) {
    validationErrors.push(`Stud spacing of ${(params.studSpacing * 1000).toFixed(0)}mm is below minimum constructible spacing (200mm).`);
  }
  if (params.memberWidth < 0.035) {
    validationErrors.push(`Member width of ${(params.memberWidth * 1000).toFixed(0)}mm is below minimum structural width (35mm).`);
  }
  if (params.memberDepth < 0.070) {
    validationErrors.push(`Member depth of ${(params.memberDepth * 1000).toFixed(0)}mm is below minimum wall framing depth (70mm).`);
  }

  const isInvalid = validationErrors.length > 0;
  const isStudSpacingExceeded = params.studSpacing > STRUCTURAL_VALIDATION_RULES.maxStudSpacing;

  const handleResetDefaults = () => {
    const defaults: TimberFrameParams = {
      ...DEFAULT_TIMBER_FRAME_PARAMS,
      offsetJoists: false,
      offsetFloorJoists: false,
      offsetWallJoists: false,
      offsetFloorNoggins: false,
      offsetWallNoggins: false,
    };
    setParams(defaults);
    if (setTimberFrameParams) {
      setTimberFrameParams(defaults);
    }
    setAdvancedOpen(false);
    setSpacingTolerance(0.005);
    setVisualMode('auto');
    setMeasurements('Reset Timber Frame modifiers to defaults.');
  };

  const handleCommitFraming = () => {
    if (isInvalid) return;

    if (setTimberFrameParams) {
      setTimberFrameParams(params);
    }

    const existingTimber = shapes.filter(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber ') || s.id.startsWith('tf-'));
    const existingIds = new Set(existingTimber.map(t => t.id));
    const remainingShapes = shapes.filter(s => !existingIds.has(s.id));

    const result = generateTimberFrameForBuilding(remainingShapes, {
      params,
      offsetJoists: params.offsetFloorJoists ?? params.offsetJoists,
      offsetFloorJoists: params.offsetFloorJoists ?? params.offsetJoists,
      offsetWallJoists: params.offsetWallJoists,
      offsetFloorNoggins: params.offsetFloorNoggins,
      offsetWallNoggins: params.offsetWallNoggins,
      studSpacing: params.studSpacing,
      joistSpacing: params.studSpacing,
      rafterSpacing: params.studSpacing * 1.5,
    });

    if (result.members.length === 0) {
      setMeasurements('No walls, floors, or roof found to frame. Draw architecture elements first.');
      return;
    }

    const nowIso = new Date().toISOString();
    const updatedArchShapes = remainingShapes.map(s => {
      const isWall = s.type === 'wall' || s.tags?.some(t => t.includes('wall')) || s.name?.toLowerCase().includes('wall');
      const isRoof = s.type === 'roof' || s.tags?.some(t => t.includes('roof')) || s.name?.toLowerCase().includes('roof');
      if (isWall || isRoof) {
        const wallAssemblies = result.openingAssemblies?.filter(oa => oa.hostWallId === s.id) || [];
        return {
          ...s,
          timberFrame: {
            params,
            openingAssemblies: wallAssemblies,
            lastComputedAt: nowIso
          }
        };
      }
      return s;
    });

    setShapes([...updatedArchShapes, ...result.members]);
    commitHistory();
    setMeasurements(`Committed Timber Frame construction (${result.members.length} members: studs, plates, headers, sills, joists & rafters).`);
  };

  const handleAddTimberFrame = () => {
    if (setTimberFrameParams) {
      setTimberFrameParams(params);
    }

    const existingTimber = shapes.filter(s => s.tags?.includes('timber-frame') || s.name?.startsWith('Timber ') || s.id.startsWith('tf-'));
    const options = {
      params,
      offsetJoists: params?.offsetFloorJoists ?? params?.offsetJoists,
      offsetFloorJoists: params?.offsetFloorJoists ?? params?.offsetJoists,
      offsetWallJoists: params?.offsetWallJoists,
      offsetFloorNoggins: params?.offsetFloorNoggins,
      offsetWallNoggins: params?.offsetWallNoggins,
      studSpacing: params?.studSpacing || 0.40,
      joistSpacing: params?.studSpacing || 0.40,
      rafterSpacing: (params?.studSpacing ? params.studSpacing * 1.5 : 0.60)
    };

    if (existingTimber.length > 0) {
      // Remove old and regenerate
      const existingIds = new Set(existingTimber.map(t => t.id));
      const remainingShapes = shapes.filter(s => !existingIds.has(s.id));
      const result = generateTimberFrameForBuilding(remainingShapes, options);
      if (result.members.length === 0) {
        setMeasurements('No walls, floors, or roof found to frame.');
        return;
      }

      const nowIso = new Date().toISOString();
      const updatedArchShapes = remainingShapes.map(s => {
        const isWall = s.type === 'wall' || s.tags?.some(t => t.includes('wall')) || s.name?.toLowerCase().includes('wall');
        const isRoof = s.type === 'roof' || s.tags?.some(t => t.includes('roof')) || s.name?.toLowerCase().includes('roof');
        if (isWall || isRoof) {
          const wallAssemblies = result.openingAssemblies?.filter(oa => oa.hostWallId === s.id) || [];
          return {
            ...s,
            timberFrame: {
              params,
              openingAssemblies: wallAssemblies,
              lastComputedAt: nowIso
            }
          };
        }
        return s;
      });

      setShapes([...updatedArchShapes, ...result.members]);
      commitHistory();
      setMeasurements(`Updated Timber Frame construction (${result.members.length} members: studs, plates, headers, joists & rafters).`);
      return;
    }

    const result = generateTimberFrameForBuilding(shapes, options);
    if (result.members.length === 0) {
      setMeasurements('No walls, floors, or roof found. Draw walls, floors or a roof first to generate timber frame construction.');
      return;
    }

    const nowIso = new Date().toISOString();
    const updatedShapes = shapes.map(s => {
      const isWall = s.type === 'wall' || s.tags?.some(t => t.includes('wall')) || s.name?.toLowerCase().includes('wall');
      const isRoof = s.type === 'roof' || s.tags?.some(t => t.includes('roof')) || s.name?.toLowerCase().includes('roof');
      if (isWall || isRoof) {
        const wallAssemblies = result.openingAssemblies?.filter(oa => oa.hostWallId === s.id) || [];
        return {
          ...s,
          timberFrame: {
            params,
            openingAssemblies: wallAssemblies,
            lastComputedAt: nowIso
          }
        };
      }
      return s;
    });

    setShapes([...updatedShapes, ...result.members]);
    commitHistory();
    setMeasurements(`Added Timber Frame construction (${result.members.length} members: walls, floors & roof).`);
  };

  return (
    <div className="space-y-3 select-none">
      {/* Add / Update Timber Frame Button */}
      <button
        id="timber-add-frame-btn"
        onClick={handleAddTimberFrame}
        className="w-full py-1.5 px-2.5 bg-sky-50/80 hover:bg-sky-100/90 dark:bg-sky-950/30 dark:hover:bg-sky-900/40 text-sky-900 dark:text-sky-200 border border-sky-200/80 dark:border-sky-800/60 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
        title="Generate Timber Frame structure (Studs, Bottom/Top Plates, Headers, Floor Joists & Roof Rafters) meeting building guidelines"
      >
        <Hammer size={13} className="text-trimble-blue dark:text-sky-400" />
        <span>{hasExistingFraming ? 'Update Timber Frame' : 'Add Timber Frame'}</span>
      </button>

      {/* 1. EMPTY STATE */}
      {currentState === 'empty' && (
        <div className="py-2 space-y-3">
          <EmptyState
            title="No Timber Frame Selected"
            hint="Select a wall, roof, or building assembly in the viewport to display and configure reactive timber framing."
            icon={<Hammer size={24} className="text-gray-400 dark:text-gray-500" />}
          />
          <button
            id="timber-add-frame-empty-btn"
            onClick={handleAddTimberFrame}
            className="w-full py-2 px-3 bg-trimble-blue hover:bg-trimble-dark-blue active:scale-[0.99] text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
            title="Generate Timber Frame structure for all walls, floors, and roof in the building"
          >
            <Hammer size={14} className="text-white" />
            <span>{hasExistingFraming ? 'Update Timber Frame' : 'Add Timber Frame'}</span>
          </button>
        </div>
      )}

      {/* 2. PENDING / COMPUTING STATE */}
      {currentState === 'pending' && (
        <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/50 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-trimble-blue">
              <Loader2 size={15} className="animate-spin text-trimble-blue" />
              <span>Computing Framing Load Path...</span>
            </div>
            <Chip tone="accent">Calculating</Chip>
          </div>
          
          <div className="space-y-2 pt-1">
            <div className="h-4 bg-gray-200/80 dark:bg-gray-700/60 rounded animate-pulse w-4/5" />
            <div className="h-3 bg-gray-200/60 dark:bg-gray-700/40 rounded animate-pulse w-3/5" />
            <div className="h-3 bg-gray-200/40 dark:bg-gray-700/30 rounded animate-pulse w-1/2" />
          </div>

          <div className="pt-2 border-t border-gray-200/60 dark:border-gray-800 text-[11px] text-gray-500 flex items-center justify-between font-mono">
            <span>Affected members:</span>
            <span className="animate-pulse text-trimble-blue font-bold">est. 52 studs / 6 plates</span>
          </div>
        </div>
      )}

      {/* 3. ACTIVE STATE */}
      {currentState === 'active' && (
        <div className="space-y-3">
          {/* Header with Default Reset */}
          <div className="flex items-center justify-end pb-1 border-b border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="text-[10px] text-trimble-blue hover:text-trimble-dark-blue hover:underline cursor-pointer font-medium"
              title="Reset all values for this panel to defaults"
            >
              Default
            </button>
          </div>

          {/* Always-visible Parameters */}
          <div className="space-y-2.5">
            {/* Stud Spacing with inline validation feedback */}
            <div className={cn(
              "rounded-lg p-1 transition-all",
              isStudSpacingExceeded && "bg-red-50/60 dark:bg-red-950/20 border border-red-300 dark:border-red-800/80"
            )}>
              <NumberField
                label="Stud Spacing"
                value={params.studSpacing}
                onChange={(val) => setParams(p => ({ ...p, studSpacing: val }))}
                suffix="m"
                step={0.05}
                min={0.10}
                max={1.20}
                className={cn(
                  isStudSpacingExceeded && "[&_input]:border-red-500 [&_input]:ring-red-500/30 [&_input]:text-red-600 dark:[&_input]:text-red-400"
                )}
              />
              {isStudSpacingExceeded && (
                <div className="flex items-center gap-1.5 mt-1.5 px-1 text-[11px] font-medium text-red-600 dark:text-red-400 animate-in fade-in duration-200">
                  <AlertCircle size={12} className="shrink-0 text-red-500" />
                  <span>
                    Exceeds max allowable stud spacing ({STRUCTURAL_VALIDATION_RULES.maxStudSpacingMm}mm / {STRUCTURAL_VALIDATION_RULES.maxStudSpacing}m) per building code.
                  </span>
                </div>
              )}
            </div>

            {/* Member Width & Member Depth */}
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Member Width"
                value={params.memberWidth}
                onChange={(val) => setParams(p => ({ ...p, memberWidth: val }))}
                suffix="m"
                step={0.005}
                min={0.035}
                max={0.15}
              />
              <NumberField
                label="Member Depth"
                value={params.memberDepth}
                onChange={(val) => setParams(p => ({ ...p, memberDepth: val }))}
                suffix="m"
                step={0.01}
                min={0.05}
                max={0.35}
              />
            </div>

            {/* Reveal Distance */}
            <NumberField
              label="Reveal Distance (Plane Inset)"
              value={params.revealDistance}
              onChange={(val) => setParams(p => ({ ...p, revealDistance: val }))}
              suffix="m"
              step={0.005}
              min={0.0}
              max={0.10}
            />

            {/* Offset Joists Section (Floor & Wall Joists toggles) */}
            <div className="space-y-2 rounded-lg bg-gray-50/70 dark:bg-gray-800/50 border border-gray-200/80 dark:border-gray-700/60 p-2.5 transition-colors">
              <div className="flex items-center justify-between pb-1 border-b border-gray-200/60 dark:border-gray-700/50">
                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                  Offset Joists
                </span>
                <span className="text-[9px] text-gray-500 dark:text-gray-400 font-mono">
                  Lapped & Staggered
                </span>
              </div>

              {/* 1. Floor Joists Toggle */}
              <div className="flex items-center justify-between pt-0.5">
                <div className="space-y-0.5 pr-2">
                  <label htmlFor="timber-offset-floor-joists-toggle" className="text-xs font-semibold text-gray-700 dark:text-gray-200 cursor-pointer flex items-center gap-1.5">
                    <span>Floor Joists</span>
                  </label>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                    Staggers alternating floor joists by member width for lapped bearings
                  </p>
                </div>
                <button
                  id="timber-offset-floor-joists-toggle"
                  type="button"
                  role="switch"
                  aria-checked={!!(params.offsetFloorJoists ?? params.offsetJoists)}
                  onClick={() => {
                    const nextVal = !(params.offsetFloorJoists ?? params.offsetJoists);
                    setParams(p => ({ ...p, offsetFloorJoists: nextVal, offsetJoists: nextVal }));
                  }}
                  className={cn(
                    "w-9 h-5 shrink-0 flex items-center rounded-full p-0.5 transition-colors cursor-pointer",
                    (params.offsetFloorJoists ?? params.offsetJoists) ? "bg-trimble-blue" : "bg-gray-300 dark:bg-gray-600"
                  )}
                  title="Enable or disable offset floor joists"
                >
                  <div
                    className={cn(
                      "bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform",
                      (params.offsetFloorJoists ?? params.offsetJoists) ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </div>

              {/* 2. Wall Joists Toggle */}
              <div className="flex items-center justify-between pt-2 border-t border-gray-200/50 dark:border-gray-700/40">
                <div className="space-y-0.5 pr-2">
                  <label htmlFor="timber-offset-wall-joists-toggle" className="text-xs font-semibold text-gray-700 dark:text-gray-200 cursor-pointer flex items-center gap-1.5">
                    <span>Wall Joists</span>
                  </label>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                    Offsets alternating wall framing members and double top plate joints
                  </p>
                </div>
                <button
                  id="timber-offset-wall-joists-toggle"
                  type="button"
                  role="switch"
                  aria-checked={!!params.offsetWallJoists}
                  onClick={() => setParams(p => ({ ...p, offsetWallJoists: !p.offsetWallJoists }))}
                  className={cn(
                    "w-9 h-5 shrink-0 flex items-center rounded-full p-0.5 transition-colors cursor-pointer",
                    params.offsetWallJoists ? "bg-trimble-blue" : "bg-gray-300 dark:bg-gray-600"
                  )}
                  title="Enable or disable offset wall joists"
                >
                  <div
                    className={cn(
                      "bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform",
                      params.offsetWallJoists ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Offset Noggins Section (Floor & Wall Noggins toggles) */}
            <div className="space-y-2 rounded-lg bg-gray-50/70 dark:bg-gray-800/50 border border-gray-200/80 dark:border-gray-700/60 p-2.5 transition-colors">
              <div className="flex items-center justify-between pb-1 border-b border-gray-200/60 dark:border-gray-700/50">
                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                  Offset Noggins
                </span>
                <span className="text-[9px] text-gray-500 dark:text-gray-400 font-mono">
                  Staggered Blocking
                </span>
              </div>

              {/* Offset Floor Noggins Toggle */}
              <div className="flex items-center justify-between pt-0.5">
                <div className="space-y-0.5 pr-2">
                  <label htmlFor="timber-offset-floor-noggins-toggle" className="text-xs font-semibold text-gray-700 dark:text-gray-200 cursor-pointer flex items-center gap-1.5">
                    <span>Offset Floor Noggins</span>
                  </label>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                    Staggers solid floor blocking between joists for straight-through end-nailing
                  </p>
                </div>
                <button
                  id="timber-offset-floor-noggins-toggle"
                  type="button"
                  role="switch"
                  aria-checked={!!params.offsetFloorNoggins}
                  onClick={() => setParams(p => ({ ...p, offsetFloorNoggins: !p.offsetFloorNoggins }))}
                  className={cn(
                    "w-9 h-5 shrink-0 flex items-center rounded-full p-0.5 transition-colors cursor-pointer",
                    params.offsetFloorNoggins ? "bg-trimble-blue" : "bg-gray-300 dark:bg-gray-600"
                  )}
                  title="Enable or disable offset floor noggins"
                >
                  <div
                    className={cn(
                      "bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform",
                      params.offsetFloorNoggins ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </div>

              {/* Offset Wall Noggins Toggle */}
              <div className="flex items-center justify-between pt-2 border-t border-gray-200/50 dark:border-gray-700/40">
                <div className="space-y-0.5 pr-2">
                  <label htmlFor="timber-offset-wall-noggins-toggle" className="text-xs font-semibold text-gray-700 dark:text-gray-200 cursor-pointer flex items-center gap-1.5">
                    <span>Offset Wall Noggins</span>
                  </label>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
                    Offsets alternating wall blocking heights for easy two-nail stud fastening
                  </p>
                </div>
                <button
                  id="timber-offset-wall-noggins-toggle"
                  type="button"
                  role="switch"
                  aria-checked={!!params.offsetWallNoggins}
                  onClick={() => setParams(p => ({ ...p, offsetWallNoggins: !p.offsetWallNoggins }))}
                  className={cn(
                    "w-9 h-5 shrink-0 flex items-center rounded-full p-0.5 transition-colors cursor-pointer",
                    params.offsetWallNoggins ? "bg-trimble-blue" : "bg-gray-300 dark:bg-gray-600"
                  )}
                  title="Enable or disable offset wall noggins"
                >
                  <div
                    className={cn(
                      "bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform",
                      params.offsetWallNoggins ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Behind "Advanced" toggle (collapsed by default) */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden bg-gray-50/50 dark:bg-gray-900/30">
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-black/5 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal size={13} className="text-trimble-blue" />
                <span>Advanced Specification</span>
              </div>
              {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {advancedOpen && (
              <div className="p-3 space-y-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-850 animate-in fade-in duration-150">
                {/* Species */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    Timber Species
                  </label>
                  <select
                    value={params.species}
                    onChange={(e) => setParams(p => ({ ...p, species: e.target.value }))}
                    className="w-full h-8 px-2 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-700 outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                  >
                    <option value="Spruce-Pine-Fir">Spruce-Pine-Fir (SPF)</option>
                    <option value="Douglas Fir-Larch">Douglas Fir-Larch</option>
                    <option value="Southern Pine">Southern Pine</option>
                    <option value="Hem-Fir">Hem-Fir</option>
                    <option value="Glulam Engineered">Glulam Engineered</option>
                  </select>
                </div>

                {/* Structural Grade */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    Structural Grade
                  </label>
                  <select
                    value={params.grade}
                    onChange={(e) => setParams(p => ({ ...p, grade: e.target.value }))}
                    className="w-full h-8 px-2 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-700 outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                  >
                    <option value="C24">C24 (High Strength Structural)</option>
                    <option value="C16">C16 (Standard Framing)</option>
                    <option value="Select Structural">Select Structural</option>
                    <option value="No. 2 Framing">No. 2 Framing</option>
                  </select>
                </div>

                {/* Spacing Tolerances */}
                <NumberField
                  label="Spacing Tolerance"
                  value={spacingTolerance}
                  onChange={setSpacingTolerance}
                  suffix="m"
                  step={0.001}
                  min={0.001}
                  max={0.02}
                />

                {/* Header Depth Rule Overrides */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    Header Depth Rule Override
                  </label>
                  <select
                    value={params.headerDepthRule}
                    onChange={(e) => setParams(p => ({ ...p, headerDepthRule: e.target.value as any }))}
                    className="w-full h-8 px-2 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-700 outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30"
                  >
                    <option value="code-table">Code Table (Span-Bracketed)</option>
                    <option value="span-ratio-1-10">Span Ratio 1:10</option>
                    <option value="double-depth">Double Depth (Heavy Load)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Live Validation Panel */}
          {validationErrors.length > 0 && (
            <div id="timber-validation-errors" className="p-2.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/40 text-[11px] text-red-700 dark:text-red-300 space-y-1.5 animate-in fade-in duration-150">
              <div className="flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400">
                <AlertCircle size={14} className="text-red-500 shrink-0" />
                <span>Structural Validation Blocked ({validationErrors.length})</span>
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[10px] pl-1 text-red-600 dark:text-red-300">
                {validationErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
              <div className="text-[10px] font-medium text-red-700 dark:text-red-400 pt-0.5">
                Commit is blocked until parameters conform to building code.
              </div>
            </div>
          )}

          {/* Commit Framing Button */}
          <div className="pt-1">
            <button
              id="timber-commit-framing-btn"
              disabled={isInvalid || timberFrameRecomputeState?.status === 'computing'}
              onClick={handleCommitFraming}
              className={cn(
                "w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer",
                isInvalid
                  ? "bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed border border-gray-300 dark:border-gray-700"
                  : "bg-trimble-blue hover:bg-trimble-blue/90 text-white shadow-sm"
              )}
              title={isInvalid ? "Cannot commit: Resolve structural validation errors first" : "Commit timber framing to scene"}
            >
              <Hammer size={14} />
              <span>{hasExistingFraming ? 'Commit Updated Framing' : 'Commit Timber Framing'}</span>
            </button>
            {isInvalid && (
              <p className="text-[10px] text-red-500 dark:text-red-400 text-center mt-1">
                Framing commit blocked by structural validation rules
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


