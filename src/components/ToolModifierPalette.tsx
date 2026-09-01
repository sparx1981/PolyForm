import React, { useState } from 'react';
import { useApp } from '../AppContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { Settings, Info, Zap, Move, RotateCw, Maximize2, Scissors, Circle, MousePointer2, PanelRightClose, Building2, Home, AlignCenter, AlignLeft, AlignRight, CheckCircle2, ChevronDown, ChevronUp, Hammer, Layers } from 'lucide-react';
import { buildRoofShapeForRoom, buildRoofAssemblyForRoom, buildNextFloorLevel, buildCeilingSlabForRoom, RoofParams } from '../lib/archRoofGenerator';
import { generateTimberFrameForBuilding } from '../lib/timberFrameGenerator';
import { WallJustification } from '../tools/inference/types';

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

  const hasSettings = [
    'move', 
    'bevel', 
    'deform', 
    'orbit',
    'wall'
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

  const handleGenerateRoof = (roofType: 'gable' | 'hip') => {
    const wallShapes = shapes.filter(s => s.type === 'wall');
    if (wallShapes.length === 0) {
      setMeasurements('No walls found. Draw a closed room to generate a roof.');
      return;
    }
    const assembly = buildRoofAssemblyForRoom(wallShapes, { 
      roofType, 
      pitchAngleDeg: roofPitchAngle, 
      usePitchAngle: true,
      eaveOverhang: roofOverhang,
      fasciaHeight: roofFasciaHeight,
      color: roofColor,
      fasciaColor: fasciaColor
    }, shapes);
    if (assembly) {
      assembly.allShapes.forEach(s => addShape(s));
      commitHistory();
      setMeasurements(`Created detailed ${roofType === 'hip' ? 'Hip' : 'Gable'} Roof assembly with all parts (${roofPitchAngle}°, ${((roofOverhang) * 100).toFixed(0)}cm overhang, ${((roofFasciaHeight) * 100).toFixed(0)}cm fascia).`);
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
        "z-30 rounded-xl border shadow-xl overflow-hidden transition-all duration-300",
        theme === 'dark' ? "bg-gray-900 border-gray-700 shadow-black/50" : "bg-white border-gray-200 shadow-xl",
        isToolModifierDocked ? "relative w-full shadow-none border-none rounded-none" : "fixed w-64"
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
          {activeTool === 'wall' ? (
            <Building2 size={14} className="text-trimble-blue" />
          ) : (
            <Settings size={14} className="text-trimble-blue" />
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {activeTool === 'wall' ? 'Architecture Modifiers' : 'Tool Modifiers'}
          </span>
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

              {/* 2. Gable / Hip Roof Grid */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  id="arch-gable-roof-btn"
                  onClick={() => handleGenerateRoof('gable')}
                  className="py-1.5 px-2 bg-gray-50 hover:bg-trimble-blue/5 dark:bg-gray-800 dark:hover:bg-gray-700/80 text-gray-700 dark:text-gray-200 hover:text-trimble-blue dark:hover:text-sky-300 border border-gray-200 dark:border-gray-700 hover:border-trimble-blue/30 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  title="Generate Detailed Parametric Gable Roof with Fascia & Eaves"
                >
                  <Home size={12} className="text-trimble-blue dark:text-sky-400" />
                  <span>Gable Roof</span>
                </button>
                <button
                  id="arch-hip-roof-btn"
                  onClick={() => handleGenerateRoof('hip')}
                  className="py-1.5 px-2 bg-gray-50 hover:bg-trimble-blue/5 dark:bg-gray-800 dark:hover:bg-gray-700/80 text-gray-700 dark:text-gray-200 hover:text-trimble-blue dark:hover:text-sky-300 border border-gray-200 dark:border-gray-700 hover:border-trimble-blue/30 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  title="Generate Detailed Parametric Hip Roof with Fascia & Eaves"
                >
                  <Home size={12} className="text-trimble-blue dark:text-sky-400" />
                  <span>Hip Roof</span>
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
                  <div className="pt-1.5 space-y-2 border-t border-gray-200/50 dark:border-gray-700/50">
                    {/* Pitch Angle */}
                    <div>
                      <div className="flex justify-between text-gray-500 dark:text-gray-400 mb-1">
                        <span>Pitch Angle</span>
                        <span className="font-mono text-gray-800 dark:text-gray-200">{roofPitchAngle}°</span>
                      </div>
                      <input 
                        type="range"
                        min={15}
                        max={60}
                        step={1}
                        value={roofPitchAngle}
                        onChange={(e) => setRoofPitchAngle(Number(e.target.value))}
                        className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                      />
                    </div>

                    {/* Eave Overhang */}
                    <div>
                      <div className="flex justify-between text-gray-500 dark:text-gray-400 mb-1">
                        <span>Eave Overhang</span>
                        <span className="font-mono text-gray-800 dark:text-gray-200">{((roofOverhang) * 100).toFixed(0)} cm</span>
                      </div>
                      <input 
                        type="range"
                        min={0.10}
                        max={0.80}
                        step={0.05}
                        value={roofOverhang}
                        onChange={(e) => setRoofOverhang(Number(e.target.value))}
                        className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                      />
                    </div>

                    {/* Fascia Board Height */}
                    <div>
                      <div className="flex justify-between text-gray-500 dark:text-gray-400 mb-1">
                        <span>Fascia Board Trim</span>
                        <span className="font-mono text-gray-800 dark:text-gray-200">{((roofFasciaHeight) * 100).toFixed(0)} cm</span>
                      </div>
                      <input 
                        type="range"
                        min={0.08}
                        max={0.35}
                        step={0.02}
                        value={roofFasciaHeight}
                        onChange={(e) => setRoofFasciaHeight(Number(e.target.value))}
                        className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
                      />
                    </div>

                    {/* Roof Material / Color Palette */}
                    <div>
                      <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-1">
                        <span>Roof Color Finish</span>
                        <span className="w-2.5 h-2.5 rounded-full border border-gray-300 dark:border-gray-600 inline-block" style={{ backgroundColor: roofColor }} />
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {[
                          { name: 'Terracotta', color: '#991b1b' },
                          { name: 'Slate', color: '#1e293b' },
                          { name: 'Spanish Clay', color: '#b45309' },
                          { name: 'Anthracite', color: '#334155' },
                          { name: 'Forest Green', color: '#14532d' },
                          { name: 'Stone Grey', color: '#475569' }
                        ].map((mat) => (
                          <button
                            key={mat.name}
                            onClick={() => setRoofColor(mat.color)}
                            title={mat.name}
                            className={cn(
                              "w-5 h-5 rounded-full border transition-all cursor-pointer",
                              roofColor === mat.color ? "ring-2 ring-trimble-blue scale-110 border-white shadow-xs" : "border-gray-300 dark:border-gray-600 opacity-80 hover:opacity-100"
                            )}
                            style={{ backgroundColor: mat.color }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Fascia & Trim Material / Color Palette */}
                    <div>
                      <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-1">
                        <span>Fascia & Trim Color</span>
                        <span className="w-2.5 h-2.5 rounded-full border border-gray-300 dark:border-gray-600 inline-block" style={{ backgroundColor: fasciaColor }} />
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {[
                          { name: 'Pure White', color: '#ffffff' },
                          { name: 'Off-White', color: '#fef08a' },
                          { name: 'Light Grey', color: '#e2e8f0' },
                          { name: 'Slate Grey', color: '#64748b' },
                          { name: 'Anthracite', color: '#1e293b' },
                          { name: 'Rich Timber', color: '#78350f' },
                          { name: 'Match Roof', color: roofColor }
                        ].map((fMat) => (
                          <button
                            key={fMat.name}
                            onClick={() => {
                              setFasciaColor(fMat.color);
                              if (selectedId) {
                                setShapes(prev => prev.map(s => {
                                  if (s.id === selectedId && (s.tags?.includes('roof-fascia') || s.name?.includes('Fascia'))) {
                                    return { ...s, color: fMat.color };
                                  }
                                  return s;
                                }));
                              }
                            }}
                            title={fMat.name}
                            className={cn(
                              "w-5 h-5 rounded-full border transition-all cursor-pointer",
                              fasciaColor === fMat.color ? "ring-2 ring-trimble-blue scale-110 border-white shadow-xs" : "border-gray-300 dark:border-gray-600 opacity-80 hover:opacity-100"
                            )}
                            style={{ backgroundColor: fMat.color }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Add Timber Frame */}
              <button
                id="arch-add-timber-frame-btn"
                onClick={handleAddTimberFrame}
                className="w-full py-1.5 px-2.5 bg-amber-50 hover:bg-amber-100/80 dark:bg-amber-950/30 dark:hover:bg-amber-900/40 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800/60 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
                title="Generate Timber Frame structure (Studs, Bottom/Top Plates, Headers, Floor Joists & Roof Rafters) meeting building guidelines"
              >
                <Hammer size={13} className="text-amber-700 dark:text-amber-400" />
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
                <span className="font-mono text-trimble-blue">{activeBevelAmount.toFixed(1)}</span>
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


