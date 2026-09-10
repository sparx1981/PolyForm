import React, { useState } from 'react';
import { useApp } from '../../AppContext';
import { 
  Eye, 
  EyeOff, 
  ChevronUp, 
  ChevronDown, 
  Trash2, 
  Layers, 
  Route, 
  Square, 
  Circle, 
  Grid3X3, 
  Sliders, 
  Plus, 
  HardHat, 
  Edit3, 
  Check, 
  Sparkles,
  ArrowUpDown,
  Maximize2
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { TerrainModifier, PadModifier, RoadModifier, SurfaceModifier, BatterFalloffType, RoadMarkingPreset, ParkingAngle } from '../../types';
import { regradeTerrainWithModifiers } from '../../lib/terrain/roadGeometry';

export default function TerrainModifierStack() {
  const {
    terrainModifiers,
    setTerrainModifiers,
    selectedModifierId,
    setSelectedModifierId,
    setIsBakeModalOpen,
    setConsoleOutput,
    commitHistory,
    setViewportToast,
    setActiveTool,
    shapes,
    setShapes
  } = useApp();

  const [expandedId, setExpandedId] = useState<string | null>(selectedModifierId || (terrainModifiers[0]?.id ?? null));

  const applyRegrade = (updatedModifiers: TerrainModifier[]) => {
    const terrainShape = shapes.find(s => s.type === 'terrain' && s.terrainData);
    if (terrainShape) {
      const regraded = regradeTerrainWithModifiers(terrainShape, updatedModifiers);
      if (regraded) {
        setShapes(prev => prev.map(s => s.id === terrainShape.id ? { ...s, terrainData: regraded } : s));
      }
    }
  };

  // Toggle visibility / enabled state
  const handleToggleEnabled = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextModifiers = terrainModifiers.map(mod => {
      if (mod.id === id) {
        const nextState = !mod.enabled;
        setConsoleOutput(c => [...c, `[Modifier Stack] ${mod.name} is now ${nextState ? 'enabled' : 'disabled'}.`]);
        return { ...mod, enabled: nextState };
      }
      return mod;
    });
    setTerrainModifiers(nextModifiers);
    applyRegrade(nextModifiers);
    commitHistory();
  };

  // Reordering up
  const handleMoveUp = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index <= 0) return;
    const next = [...terrainModifiers];
    const temp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = temp;
    setTerrainModifiers(next);
    applyRegrade(next);
    commitHistory();
  };

  // Reordering down
  const handleMoveDown = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index >= terrainModifiers.length - 1) return;
    const next = [...terrainModifiers];
    const temp = next[index + 1];
    next[index + 1] = next[index];
    next[index] = temp;
    setTerrainModifiers(next);
    applyRegrade(next);
    commitHistory();
  };

  // Delete modifier
  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextModifiers = terrainModifiers.filter(m => m.id !== id);
    setTerrainModifiers(nextModifiers);
    if (selectedModifierId === id) {
      setSelectedModifierId(null);
    }
    if (expandedId === id) {
      setExpandedId(null);
    }
    setConsoleOutput(c => [...c, `[Modifier Stack] Deleted modifier ${id}.`]);
    setViewportToast("Modifier removed from stack.");
    applyRegrade(nextModifiers);
    commitHistory();
  };

  // Select and expand for inline editing
  const handleSelectModifier = (id: string) => {
    setSelectedModifierId(id);
    setExpandedId(prev => prev === id ? null : id);
  };

  // Update pad modifier properties
  const handleUpdatePad = (id: string, patch: Partial<PadModifier>) => {
    const nextModifiers = terrainModifiers.map(m => {
      if (m.id === id && m.type === 'pad') {
        return { ...m, ...patch };
      }
      return m;
    });
    setTerrainModifiers(nextModifiers);
    applyRegrade(nextModifiers);
  };

  // Update road modifier properties
  const handleUpdateRoad = (id: string, patch: Partial<RoadModifier>) => {
    const nextModifiers = terrainModifiers.map(m => {
      if (m.id === id && m.type === 'road') {
        return { ...m, ...patch };
      }
      return m;
    });
    setTerrainModifiers(nextModifiers);
    applyRegrade(nextModifiers);
  };

  // Update surface modifier properties
  const handleUpdateSurface = (id: string, patch: Partial<SurfaceModifier>) => {
    setTerrainModifiers(prev => prev.map(m => {
      if (m.id === id && m.type === 'surface') {
        return { ...m, ...patch };
      }
      return m;
    }));
  };

  // Add new modifier preset
  const handleAddModifier = (type: 'pad' | 'road' | 'surface') => {
    const id = `mod-${type}-${Date.now()}`;
    let newMod: TerrainModifier;

    if (type === 'pad') {
      newMod = {
        id,
        name: `Grading Pad ${terrainModifiers.filter(m => m.type === 'pad').length + 1}`,
        type: 'pad',
        enabled: true,
        primitive: 'rectangle',
        center: [0, 2.0, 0],
        dimensions: [16, 12],
        rotationY: 0,
        targetElevation: 2.0,
        batterDistance: 3.5,
        batterProfile: 'linear'
      };
      setActiveTool('pad-rect');
    } else if (type === 'road') {
      newMod = {
        id,
        name: `Corridor ${terrainModifiers.filter(m => m.type === 'road').length + 1}`,
        type: 'road',
        enabled: true,
        points: [
          [-20, 0, -10],
          [-5, 1.0, 0],
          [10, 1.8, 10],
          [25, 2.2, 20]
        ],
        width: 6.0,
        maxGradePercent: 8.0,
        bankingAngle: 0,
        profile: {
          width: 0.15,
          height: 0.15,
          ditchWidth: 1.2,
          ditchDepth: 0.35,
          hasCurb: true,
          hasDitch: false
        },
        markings: 'center-dashed'
      };
      setActiveTool('road');
    } else {
      newMod = {
        id,
        name: `Stall Bay ${terrainModifiers.filter(m => m.type === 'surface').length + 1}`,
        type: 'surface',
        enabled: true,
        hostPadId: terrainModifiers.find(m => m.type === 'pad')?.id || '',
        pattern: 'parking-striping',
        parkingConfig: {
          angle: 90,
          stallWidth: 2.7,
          stallDepth: 5.5,
          stripeColor: '#FFFFFF',
          doubleRow: false
        }
      };
      setActiveTool('striping');
    }

    setTerrainModifiers(prev => [...prev, newMod]);
    setSelectedModifierId(id);
    setExpandedId(id);
    commitHistory();
    setViewportToast(`Added ${newMod.name}`);
  };

  const getModifierIcon = (mod: TerrainModifier) => {
    if (mod.type === 'road') return <Route size={14} className="text-trimble-blue" />;
    if (mod.type === 'pad') {
      return mod.primitive === 'circle' 
        ? <Circle size={14} className="text-amber-500" />
        : <Square size={14} className="text-amber-500" />;
    }
    return <Grid3X3 size={14} className="text-emerald-500" />;
  };

  return (
    <div id="terrain-modifier-stack" className="space-y-3 select-none text-gray-800 dark:text-gray-200">
      {/* Top action header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
          <Layers size={14} className="text-trimble-blue" />
          <span>Active Modifiers ({terrainModifiers.length})</span>
        </div>
        
        {/* Quick Add Menu */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleAddModifier('pad')}
            className="px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-750 text-[10px] font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1 border border-gray-200 dark:border-gray-700 cursor-pointer transition-colors"
            title="Add Grading Pad Modifier"
          >
            <Plus size={11} /> Pad
          </button>
          <button
            onClick={() => handleAddModifier('road')}
            className="px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-750 text-[10px] font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1 border border-gray-200 dark:border-gray-700 cursor-pointer transition-colors"
            title="Add Road Corridor Modifier"
          >
            <Plus size={11} /> Road
          </button>
        </div>
      </div>

      {/* Empty State */}
      {terrainModifiers.length === 0 && (
        <div className="p-4 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 text-center bg-gray-50 dark:bg-gray-800/40">
          <p className="text-xs text-gray-600 dark:text-gray-400">No active terrain modifiers.</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Select a road or pad tool to start shaping earthwork.</p>
        </div>
      )}

      {/* Ordered Stack List */}
      <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-0.5">
        {terrainModifiers.map((mod, index) => {
          const isSelected = selectedModifierId === mod.id;
          const isExpanded = expandedId === mod.id;

          return (
            <div 
              key={mod.id}
              className={cn(
                "rounded-xl border transition-all text-xs overflow-hidden",
                isSelected
                  ? "bg-blue-50/50 dark:bg-blue-950/20 border-trimble-blue ring-1 ring-trimble-blue/30 shadow-xs"
                  : "bg-white dark:bg-gray-800/70 border-gray-200 dark:border-gray-700/80 hover:bg-gray-50 dark:hover:bg-gray-800"
              )}
            >
              {/* Card Header Row */}
              <div 
                onClick={() => handleSelectModifier(mod.id)}
                className="flex items-center justify-between p-2.5 cursor-pointer"
              >
                {/* Left: icon & title */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    {getModifierIcon(mod)}
                  </span>
                  <div className="truncate">
                    <span className={cn(
                      "font-semibold block truncate leading-tight text-gray-900 dark:text-gray-100",
                      !mod.enabled && "line-through opacity-40 text-gray-400 dark:text-gray-500"
                    )}>
                      {mod.name}
                    </span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-tight font-mono">
                      {mod.type === 'pad' ? `${mod.primitive} pad` : mod.type}
                    </span>
                  </div>
                </div>

                {/* Right controls */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Reorder Up */}
                  <button
                    onClick={(e) => handleMoveUp(index, e)}
                    disabled={index === 0}
                    className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 disabled:hover:text-gray-400 transition-colors cursor-pointer"
                    title="Move Up in Stack"
                  >
                    <ChevronUp size={13} />
                  </button>

                  {/* Reorder Down */}
                  <button
                    onClick={(e) => handleMoveDown(index, e)}
                    disabled={index === terrainModifiers.length - 1}
                    className="p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 disabled:hover:text-gray-400 transition-colors cursor-pointer"
                    title="Move Down in Stack"
                  >
                    <ChevronDown size={13} />
                  </button>

                  {/* Visibility Toggle */}
                  <button
                    onClick={(e) => handleToggleEnabled(mod.id, e)}
                    className={cn(
                      "p-1 rounded transition-colors cursor-pointer",
                      mod.enabled ? "text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white" : "text-gray-400 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-400"
                    )}
                    title={mod.enabled ? "Disable Modifier" : "Enable Modifier"}
                  >
                    {mod.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDelete(mod.id, e)}
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors ml-0.5 cursor-pointer"
                    title="Delete Modifier"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Inline Parametric Editor */}
              {isExpanded && (
                <div className="p-3 bg-gray-50 dark:bg-gray-900/80 border-t border-gray-200 dark:border-gray-700/80 space-y-2.5 text-[11px]">
                  {/* Name field */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-gray-500 dark:text-gray-400 block mb-1">Modifier Label</label>
                    <input 
                      type="text"
                      value={mod.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTerrainModifiers(prev => prev.map(m => m.id === mod.id ? { ...m, name: val } : m));
                      }}
                      className="w-full px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs focus:border-trimble-blue focus:outline-none"
                    />
                  </div>

                  {/* Pad Specific Controls */}
                  {mod.type === 'pad' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 block mb-0.5">Target Elev. ({mod.targetElevation.toFixed(1)}m)</label>
                          <input 
                            type="number"
                            step="0.2"
                            value={mod.targetElevation}
                            onChange={(e) => handleUpdatePad(mod.id, { targetElevation: parseFloat(e.target.value) || 0 })}
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 block mb-0.5">Batter Falloff ({mod.batterDistance.toFixed(1)}m)</label>
                          <input 
                            type="range"
                            min="0.5"
                            max="15"
                            step="0.5"
                            value={mod.batterDistance}
                            onChange={(e) => handleUpdatePad(mod.id, { batterDistance: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue mt-2"
                          />
                        </div>
                      </div>

                      {/* Batter Profile selection */}
                      <div>
                        <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 block mb-1">Batter Profile</label>
                        <div className="grid grid-cols-3 gap-1">
                          {(['linear', 'curved', 'stepped'] as BatterFalloffType[]).map((prof) => (
                            <button
                              key={prof}
                              type="button"
                              onClick={() => handleUpdatePad(mod.id, { batterProfile: prof })}
                              className={cn(
                                "py-1 px-1.5 rounded-lg border text-center capitalize transition-all cursor-pointer",
                                mod.batterProfile === prof
                                  ? "bg-trimble-blue text-white border-trimble-blue font-semibold shadow-xs"
                                  : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                              )}
                            >
                              {prof}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Dimensions */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 block mb-0.5">Width ({mod.dimensions[0]}m)</label>
                          <input 
                            type="number"
                            min="2"
                            max="100"
                            value={mod.dimensions[0]}
                            onChange={(e) => handleUpdatePad(mod.id, { dimensions: [parseFloat(e.target.value) || 2, mod.dimensions[1]] })}
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 block mb-0.5">Depth ({mod.dimensions[1]}m)</label>
                          <input 
                            type="number"
                            min="2"
                            max="100"
                            value={mod.dimensions[1]}
                            onChange={(e) => handleUpdatePad(mod.id, { dimensions: [mod.dimensions[0], parseFloat(e.target.value) || 2] })}
                            className="w-full px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Road Specific Controls */}
                  {mod.type === 'road' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 block mb-0.5">Road Width ({mod.width}m)</label>
                          <input 
                            type="range"
                            min="2.5"
                            max="20"
                            step="0.5"
                            value={mod.width}
                            onChange={(e) => handleUpdateRoad(mod.id, { width: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue mt-2"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 block mb-0.5">Max Grade ({mod.maxGradePercent}%)</label>
                          <input 
                            type="range"
                            min="2"
                            max="20"
                            step="1"
                            value={mod.maxGradePercent}
                            onChange={(e) => handleUpdateRoad(mod.id, { maxGradePercent: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue mt-2"
                          />
                        </div>
                      </div>

                      {/* Curb and ditch toggles */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleUpdateRoad(mod.id, { 
                            profile: { ...mod.profile, hasCurb: !mod.profile.hasCurb } 
                          })}
                          className={cn(
                            "py-1 px-2 rounded-lg border text-center transition-all cursor-pointer",
                            mod.profile.hasCurb 
                              ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue font-semibold"
                              : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-750"
                          )}
                        >
                          Curb {mod.profile.hasCurb ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateRoad(mod.id, { 
                            profile: { ...mod.profile, hasDitch: !mod.profile.hasDitch } 
                          })}
                          className={cn(
                            "py-1 px-2 rounded-lg border text-center transition-all cursor-pointer",
                            mod.profile.hasDitch 
                              ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue font-semibold"
                              : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-750"
                          )}
                        >
                          Ditch {mod.profile.hasDitch ? 'ON' : 'OFF'}
                        </button>
                      </div>

                      {/* Markings */}
                      <div>
                        <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 block mb-1">Road Markings</label>
                        <select
                          value={mod.markings}
                          onChange={(e) => handleUpdateRoad(mod.id, { markings: e.target.value as RoadMarkingPreset })}
                          className="w-full px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 text-xs focus:border-trimble-blue focus:outline-none"
                        >
                          <option value="none">None</option>
                          <option value="center-dashed">Center Dashed</option>
                          <option value="center-solid">Center Solid</option>
                          <option value="bike-lanes">Bike Lanes</option>
                          <option value="pedestrian-walkway">Pedestrian Walkway</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Surface Specific Controls */}
                  {mod.type === 'surface' && mod.parkingConfig && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] uppercase text-gray-500 dark:text-gray-400 block mb-1">Stall Angle</label>
                        <div className="grid grid-cols-4 gap-1">
                          {([0, 45, 60, 90] as ParkingAngle[]).map((ang) => (
                            <button
                              key={ang}
                              type="button"
                              onClick={() => handleUpdateSurface(mod.id, {
                                parkingConfig: { ...mod.parkingConfig!, angle: ang }
                              })}
                              className={cn(
                                "py-1 rounded-lg border text-center font-mono text-[10px] cursor-pointer transition-all",
                                mod.parkingConfig!.angle === ang
                                  ? "bg-trimble-blue text-white border-trimble-blue font-bold shadow-xs"
                                  : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750"
                              )}
                            >
                              {ang}°
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Double-Row Layout</span>
                        <button
                          type="button"
                          onClick={() => handleUpdateSurface(mod.id, {
                            parkingConfig: { ...mod.parkingConfig!, doubleRow: !mod.parkingConfig!.doubleRow }
                          })}
                          className={cn(
                            "px-2 py-0.5 rounded-lg text-[10px] font-bold border cursor-pointer transition-all",
                            mod.parkingConfig.doubleRow
                              ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue font-semibold"
                              : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-750"
                          )}
                        >
                          {mod.parkingConfig.doubleRow ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bake to Model Action Button */}
      <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setIsBakeModalOpen(true)}
          className="w-full py-2 px-3 rounded-xl bg-trimble-blue hover:bg-trimble-blue/90 text-white font-bold text-xs shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <HardHat size={14} />
          <span>Bake to Model</span>
        </button>
      </div>
    </div>
  );
}
