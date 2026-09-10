import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../AppContext';
import { 
  Home, 
  Dices, 
  Plus, 
  Trash2, 
  Shuffle, 
  Layers, 
  Sparkles, 
  Sliders, 
  Palette, 
  Check, 
  ChevronDown, 
  ChevronUp,
  Hammer
} from 'lucide-react';
import { cn } from '../lib/utils';
import { 
  ROOF_TILE_SHAPES, 
  RoofTileShape, 
  RoofTilePaletteItem, 
  RoofTileSettings, 
  DEFAULT_ROOF_TILE_SETTINGS, 
  PRESET_ROOF_COLORS, 
  PRESET_ROOF_TEXTURES, 
  generateRoofTileTexture 
} from '../lib/roofTileGenerator';
import { 
  buildRoofAssemblyForRoom, 
  updateRoofAssembly,
  updateRoofAssemblyHeight 
} from '../lib/archRoofGenerator';
import { Shape } from '../types';

export const RoofModifierSection: React.FC = () => {
  const { 
    shapes, 
    setShapes, 
    addShape, 
    selectedId, 
    setSelectedId, 
    theme, 
    setMeasurements, 
    commitHistory, 
    commitUpdatedFraming 
  } = useApp();

  // 1. Identify Target Roof
  const roofShapes = useMemo(() => {
    return shapes.filter(s => 
      (s.type === 'roof' || s.tags?.includes('roof-assembly') || s.tags?.includes('roof-slopes') || s.name?.toLowerCase().includes('roof')) &&
      !s.tags?.includes('roof-fascia') &&
      !s.tags?.includes('roof-ridge-cap') &&
      !s.tags?.includes('roof-pediment') &&
      !s.tags?.includes('roof-soffit')
    );
  }, [shapes]);

  const activeRoof = useMemo(() => {
    if (selectedId) {
      const selected = shapes.find(s => s.id === selectedId);
      if (selected && (selected.tags?.includes('roof-slopes') || selected.type === 'roof' || selected.name?.toLowerCase().includes('roof'))) {
        return selected;
      }
      // If a child part was selected (e.g. fascia or ridge), find parent roof
      if (selected?.parentShapeId) {
        const parent = shapes.find(s => s.id === selected.parentShapeId);
        if (parent) return parent;
      }
    }
    return roofShapes[0] || null;
  }, [selectedId, shapes, roofShapes]);

  // 2. State for Tile Configuration
  const [tileShape, setTileShape] = useState<RoofTileShape>(
    activeRoof?.roofTileData?.shape || 'none'
  );
  const [tileSize, setTileSize] = useState<number>(
    activeRoof?.roofTileData?.size ?? 0.35
  );
  const [tileColor, setTileColor] = useState<string>(
    activeRoof?.roofTileData?.color || activeRoof?.color || '#991b1b'
  );
  const [randomizeColor, setRandomizeColor] = useState<boolean>(
    activeRoof?.roofTileData?.randomizeColor ?? false
  );
  const [colorPalette, setColorPalette] = useState<RoofTilePaletteItem[]>(
    activeRoof?.roofTileData?.colorPalette || DEFAULT_ROOF_TILE_SETTINGS.colorPalette
  );
  const [seed, setSeed] = useState<number>(
    activeRoof?.roofTileData?.seed || 42
  );

  // 3. State for Roof Height (Realistic range: 0.60m to 4.50m)
  const [roofHeight, setRoofHeight] = useState<number>(() => {
    if (activeRoof) {
      if (Array.isArray(activeRoof.args) && activeRoof.args[1]) {
        return Math.max(0.60, Math.min(4.50, activeRoof.args[1]));
      }
      if (activeRoof.roofData?.ridgeHeight) {
        return Math.max(0.60, Math.min(4.50, activeRoof.roofData.ridgeHeight));
      }
    }
    return 2.20;
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [eaveOverhang, setEaveOverhang] = useState<number>(activeRoof?.roofData?.eaveOverhang ?? 0.30);
  const [fasciaHeight, setFasciaHeight] = useState<number>(0.18);

  // Synchronize when active roof changes
  useEffect(() => {
    if (activeRoof) {
      if (activeRoof.roofTileData) {
        setTileShape(activeRoof.roofTileData.shape || 'none');
        setTileSize(activeRoof.roofTileData.size ?? 0.35);
        setTileColor(activeRoof.roofTileData.color || '#991b1b');
        setRandomizeColor(Boolean(activeRoof.roofTileData.randomizeColor));
        if (activeRoof.roofTileData.colorPalette?.length) {
          setColorPalette(activeRoof.roofTileData.colorPalette);
        }
        if (activeRoof.roofTileData.seed !== undefined) {
          setSeed(activeRoof.roofTileData.seed);
        }
      } else if (activeRoof.color && !activeRoof.color.startsWith('data:')) {
        setTileColor(activeRoof.color);
      }

      if (activeRoof.roofData?.eaveOverhang !== undefined) {
        setEaveOverhang(activeRoof.roofData.eaveOverhang);
      }
      if (activeRoof.roofData?.fasciaHeight !== undefined) {
        setFasciaHeight(activeRoof.roofData.fasciaHeight);
      }

      if (Array.isArray(activeRoof.args) && activeRoof.args[1]) {
        setRoofHeight(Math.max(0.60, Math.min(4.50, activeRoof.args[1])));
      } else if (activeRoof.roofData?.ridgeHeight) {
        setRoofHeight(Math.max(0.60, Math.min(4.50, activeRoof.roofData.ridgeHeight)));
      }
    }
  }, [activeRoof?.id]);

  // Check if timber frame is present
  const hasTimberFraming = useMemo(() => {
    return shapes.some(s => 
      s.tags?.includes('timber-frame') || 
      s.name?.startsWith('Timber ') || 
      s.id.startsWith('tf-')
    );
  }, [shapes]);

  // Apply complete Roof Assembly Modifications (3D Tiles, Overhang, Fascia, Slopes)
  const applyRoofAssemblyModifications = useCallback((params: {
    height?: number;
    eaveOverhang?: number;
    fasciaHeight?: number;
    shape?: RoofTileShape;
    size?: number;
    color?: string;
    randomize?: boolean;
    palette?: RoofTilePaletteItem[];
    seedVal?: number;
  }) => {
    if (!activeRoof) return;

    const targetHeight = params.height ?? roofHeight;
    const targetOverhang = params.eaveOverhang ?? eaveOverhang;
    const targetFascia = params.fasciaHeight ?? fasciaHeight;
    const targetTileShape = params.shape ?? tileShape;
    const targetTileSize = params.size ?? tileSize;
    const targetTileColor = params.color ?? tileColor;
    const targetRandomize = params.randomize !== undefined ? params.randomize : randomizeColor;
    const targetPalette = params.palette ?? colorPalette;
    const targetSeed = params.seedVal ?? seed;

    // Generate fallback/underlayment texture
    const tileTextureUrl = generateRoofTileTexture({
      shape: targetTileShape,
      size: targetTileSize,
      color: targetTileColor,
      randomizeColor: targetRandomize,
      colorPalette: targetPalette,
      seed: targetSeed,
    });

    // Parametrically update slopes, ridge cap, fascia, soffits, and generate high-detail 3D tile models
    const { updatedShapes, pitchAngleDeg, actualHeight } = updateRoofAssembly(shapes, activeRoof.id, {
      height: targetHeight,
      eaveOverhang: targetOverhang,
      fasciaHeight: targetFascia,
      tileShape: targetTileShape,
      tileSize: targetTileSize,
      tileColor: targetTileColor,
      randomizeColor: targetRandomize,
      colorPalette: targetPalette,
      seed: targetSeed,
    });

    // Also update textureUrl on roof slopes for crisp underlayment (or remove texture for 'none')
    const finalShapes = updatedShapes.map(s => {
      if (s.id === activeRoof.id || (s.parentShapeId === activeRoof.id && s.tags?.includes('roof-slopes'))) {
        return {
          ...s,
          color: targetTileColor,
          textureUrl: tileTextureUrl || undefined,
        };
      }
      return s;
    });

    setShapes(finalShapes);

    // If timber frame exists in the design and height or overhang changed, run "Commit Updated Framing"
    if (hasTimberFraming && (params.height !== undefined || params.eaveOverhang !== undefined)) {
      commitUpdatedFraming(finalShapes);
      setMeasurements(`Roof updated (${actualHeight.toFixed(2)}m height, ${(targetOverhang * 100).toFixed(0)}cm overhang, ${pitchAngleDeg}° pitch). Recomputed timber framing.`);
    }

    commitHistory();
  }, [
    activeRoof, 
    shapes, 
    roofHeight, 
    eaveOverhang, 
    fasciaHeight, 
    tileShape, 
    tileSize, 
    tileColor, 
    randomizeColor, 
    colorPalette, 
    seed, 
    hasTimberFraming, 
    setShapes, 
    commitUpdatedFraming, 
    commitHistory, 
    setMeasurements
  ]);

  // Handler for Tile Shape selection
  const handleSelectShape = (shapeId: RoofTileShape) => {
    setTileShape(shapeId);
    applyRoofAssemblyModifications({ shape: shapeId });
    if (shapeId === 'none') {
      setMeasurements('Roof tile profile set to No Tile (smooth clean planes, maximum performance).');
    } else {
      setMeasurements(`Roof tile profile set to 3D ${ROOF_TILE_SHAPES.find(s => s.id === shapeId)?.name}.`);
    }
  };

  // Handler for Tile Size change
  const handleSizeChange = (newSize: number) => {
    const clamped = Math.max(0.15, Math.min(0.80, newSize));
    setTileSize(clamped);
    applyRoofAssemblyModifications({ size: clamped });
  };

  // Handler for Base Tile Color change
  const handleColorChange = (newColor: string) => {
    setTileColor(newColor);
    applyRoofAssemblyModifications({ color: newColor });
  };

  // Handler for Randomize Toggle
  const handleToggleRandomize = () => {
    const nextVal = !randomizeColor;
    setRandomizeColor(nextVal);
    applyRoofAssemblyModifications({ randomize: nextVal });
    setMeasurements(nextVal 
      ? `Randomized tile colors enabled from ${colorPalette.length} swatches.` 
      : 'Single solid tile color enabled.'
    );
  };

  // Handler for Shuffling Random Seed
  const handleShuffleSeed = () => {
    const nextSeed = Math.floor(Math.random() * 1000000);
    setSeed(nextSeed);
    applyRoofAssemblyModifications({ seedVal: nextSeed });
    setMeasurements('Shuffled randomized 3D roof tile color distribution.');
  };

  // Add new color/texture swatch (up to 8)
  const handleAddPaletteItem = () => {
    if (colorPalette.length >= 8) return;
    const defaultPresets = PRESET_ROOF_COLORS.map(p => p.value);
    const unusedColor = defaultPresets.find(c => !colorPalette.some(item => item.value === c)) || '#d97706';
    const newItem: RoofTilePaletteItem = {
      id: `pal-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type: 'color',
      value: unusedColor,
      name: `Color ${colorPalette.length + 1}`
    };
    const updated = [...colorPalette, newItem];
    setColorPalette(updated);
    if (randomizeColor) {
      applyRoofAssemblyModifications({ palette: updated });
    }
  };

  // Remove palette swatch
  const handleRemovePaletteItem = (id: string) => {
    if (colorPalette.length <= 1) return;
    const updated = colorPalette.filter(item => item.id !== id);
    setColorPalette(updated);
    if (randomizeColor) {
      applyRoofAssemblyModifications({ palette: updated });
    }
  };

  // Update a palette swatch value
  const handleUpdatePaletteItem = (id: string, updates: Partial<RoofTilePaletteItem>) => {
    const updated = colorPalette.map(item => {
      if (item.id === id) {
        return { ...item, ...updates };
      }
      return item;
    });
    setColorPalette(updated);
    if (randomizeColor) {
      applyRoofAssemblyModifications({ palette: updated });
    }
  };

  // 4. Handler for Roof Height Slider
  const handleRoofHeightChange = (newHeight: number) => {
    const clampedHeight = Math.max(0.60, Math.min(4.50, Number(newHeight.toFixed(2))));
    setRoofHeight(clampedHeight);
    applyRoofAssemblyModifications({ height: clampedHeight });
  };

  // 5. Handlers for Eave Overhang and Fascia Board Trim
  const handleEaveOverhangChange = (newOverhang: number) => {
    const clamped = Math.max(0.05, Math.min(1.20, Number(newOverhang.toFixed(2))));
    setEaveOverhang(clamped);
    applyRoofAssemblyModifications({ eaveOverhang: clamped });
    setMeasurements(`Eave overhang updated to ${(clamped * 100).toFixed(0)} cm.`);
  };

  const handleFasciaHeightChange = (newFascia: number) => {
    const clamped = Math.max(0.06, Math.min(0.50, Number(newFascia.toFixed(2))));
    setFasciaHeight(clamped);
    applyRoofAssemblyModifications({ fasciaHeight: clamped });
    setMeasurements(`Fascia board trim height updated to ${(clamped * 100).toFixed(0)} cm.`);
  };

  // Handler for Generating New Roof
  const handleGenerateRoofType = (roofType: 'gable' | 'hip' | 'parapet') => {
    const wallShapes = shapes.filter(s => s.type === 'wall');
    if (wallShapes.length === 0) {
      setMeasurements('No walls found. Draw a closed room to generate a roof.');
      return;
    }

    const tileTextureUrl = generateRoofTileTexture({
      shape: tileShape,
      size: tileSize,
      color: tileColor,
      randomizeColor: randomizeColor,
      colorPalette: colorPalette,
      seed: seed,
    });

    const assembly = buildRoofAssemblyForRoom(wallShapes, {
      roofType,
      ridgeHeight: roofHeight,
      usePitchAngle: false,
      eaveOverhang: roofType === 'parapet' ? 0 : eaveOverhang,
      fasciaHeight: fasciaHeight,
      color: tileColor,
      tileShape,
      tileSize,
      tileColor,
      randomizeColor,
      colorPalette,
      seed,
    }, shapes);

    if (assembly) {
      // Apply tile texture and tileData to roof shape
      assembly.roofShape.textureUrl = tileTextureUrl;
      assembly.roofShape.roofTileData = {
        shape: tileShape,
        size: tileSize,
        color: tileColor,
        randomizeColor: randomizeColor,
        colorPalette: colorPalette,
        seed: seed,
      };

      const isExistingRoof = (s: Shape) =>
        s.type === 'roof' ||
        s.tags?.some(t => t.startsWith('roof-') || t === 'roof') ||
        s.name?.toLowerCase().includes('roof') ||
        s.id.startsWith('roof_') ||
        s.id.startsWith('tiles_roof_');
      const nonRoofShapes = shapes.filter(s => !isExistingRoof(s));
      const finalShapes = [...nonRoofShapes, ...assembly.allShapes];
      setShapes(finalShapes);
      commitHistory();
      setSelectedId(assembly.roofShape.id);

      if (hasTimberFraming) {
        commitUpdatedFraming(finalShapes);
      }

      setMeasurements(`Replaced roof with ${roofType === 'hip' ? 'Hip' : roofType === 'parapet' ? 'Parapet' : 'Gable'} Roof (${roofHeight.toFixed(2)}m height).`);
    }
  };

  return (
    <div className="space-y-4 text-xs select-none">
      {/* Target Roof Status Banner */}
      <div className={cn(
        "p-2.5 rounded-lg border flex items-center justify-between transition-colors",
        activeRoof 
          ? (theme === 'dark' ? "bg-sky-950/30 border-sky-800/60 text-sky-200" : "bg-sky-50 border-sky-200 text-sky-900")
          : (theme === 'dark' ? "bg-gray-800/50 border-gray-700/60 text-gray-400" : "bg-gray-50 border-gray-200 text-gray-600")
      )}>
        <div className="flex items-center gap-2">
          <Home size={15} className={activeRoof ? "text-sky-500" : "text-gray-400"} />
          <div>
            <div className="font-semibold text-[11px] leading-tight">
              {activeRoof ? activeRoof.name || 'Roof Structure' : 'No Roof in Model'}
            </div>
            <div className="text-[9px] opacity-75 font-mono">
              {activeRoof ? `Height: ${roofHeight.toFixed(2)}m` : 'Generate a roof from room walls below'}
            </div>
          </div>
        </div>
        {hasTimberFraming && (
          <div className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold" title="Timber framing is active: modifying roof height automatically updates framing">
            <Hammer size={10} />
            <span>Framing Linked</span>
          </div>
        )}
      </div>

      {/* 1. ROOF OVERALL HEIGHT SLIDER (Realistic Range: 0.60m to 4.50m) */}
      <div className="space-y-1.5 rounded-lg bg-gray-50/70 dark:bg-gray-800/40 p-2.5 border border-gray-200/70 dark:border-gray-700/60">
        <div className="flex items-center justify-between">
          <label htmlFor="roof-height-slider" className="font-semibold text-[11px] text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
            <Sliders size={13} className="text-trimble-blue" />
            <span>Roof Overall Height</span>
          </label>
          <div className="flex items-center gap-1 font-mono text-[11px] font-bold text-trimble-blue">
            <span>{roofHeight.toFixed(2)} m</span>
            <span className="text-[9px] text-gray-400 font-normal">
              (~{Math.round(Math.atan(roofHeight / 3.3) * (180 / Math.PI))}°)
            </span>
          </div>
        </div>

        <input 
          id="roof-height-slider"
          type="range"
          min={0.60}
          max={4.50}
          step={0.05}
          value={roofHeight}
          onChange={(e) => handleRoofHeightChange(Number(e.target.value))}
          className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
          title="Adjust overall roof ridge height (realistic range: 0.60m to 4.50m)"
        />

        {/* Quick Height Presets */}
        <div className="grid grid-cols-4 gap-1 pt-1">
          {[
            { label: 'Low 1.0m', val: 1.00 },
            { label: 'Std 2.2m', val: 2.20 },
            { label: 'High 3.2m', val: 3.20 },
            { label: 'Steep 4.0m', val: 4.00 },
          ].map(p => (
            <button
              key={p.label}
              type="button"
              onClick={() => handleRoofHeightChange(p.val)}
              className={cn(
                "py-1 px-1 text-[9px] rounded font-mono text-center transition-all cursor-pointer",
                Math.abs(roofHeight - p.val) < 0.1
                  ? "bg-trimble-blue text-white font-bold shadow-xs"
                  : "bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200/80 dark:border-gray-600 hover:border-trimble-blue/60"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {hasTimberFraming && (
          <p className="text-[9px] text-amber-600 dark:text-amber-400 pt-1 leading-tight flex items-center gap-1">
            <span>⚡ Automatically recomputes & commits timber roof rafters to match new height.</span>
          </p>
        )}
      </div>

      {/* 2. TILE SHAPE SELECTION */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">
            Tile Shape Profile
          </label>
          <span className="text-[9px] text-trimble-blue font-mono font-medium capitalize">
            {ROOF_TILE_SHAPES.find(s => s.id === tileShape)?.name}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {ROOF_TILE_SHAPES.map((shapeOpt) => {
            const isSelected = tileShape === shapeOpt.id;
            return (
              <button
                key={shapeOpt.id}
                type="button"
                onClick={() => handleSelectShape(shapeOpt.id)}
                className={cn(
                  "p-2 rounded-lg border text-left flex flex-col justify-between transition-all cursor-pointer",
                  isSelected
                    ? "bg-trimble-blue/10 border-trimble-blue text-trimble-blue ring-1 ring-trimble-blue/50 shadow-xs"
                    : "bg-white dark:bg-gray-800/80 border-gray-200/80 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
                )}
                title={shapeOpt.description}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <svg className="w-5 h-5 text-current" viewBox="0 0 40 36" fill="currentColor">
                    <path d={shapeOpt.svgPath} />
                  </svg>
                  <div className="flex items-center gap-1">
                    {shapeOpt.id === 'none' && (
                      <span className="text-[7.5px] px-1 py-0.5 rounded font-bold font-mono bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        FAST
                      </span>
                    )}
                    {isSelected && <Check size={12} className="text-trimble-blue font-bold" />}
                  </div>
                </div>
                <div className="font-semibold text-[10px] leading-snug line-clamp-1">
                  {shapeOpt.name}
                </div>
                <div className="text-[8px] text-gray-400 uppercase font-mono mt-0.5">
                  {shapeOpt.category}
                </div>
              </button>
            );
          })}
        </div>

        {/* Performance Mode Callout for No Tile */}
        {tileShape === 'none' && (
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-800 dark:text-emerald-300 text-[10px] leading-relaxed flex items-start gap-2">
            <span className="text-xs pt-0.5">⚡</span>
            <div>
              <div className="font-bold">Fast Performance Mode Active</div>
              <p className="text-[9px] opacity-90 mt-0.5 text-emerald-700 dark:text-emerald-400">
                Smooth planar roof planes with zero 3D tile models or texture mapping. Ideal for low-spec hardware, large models, or clean modern architecture.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 3. TILE SIZE SLIDER (Only when 3D tiles are active) */}
      {tileShape !== 'none' && (
        <div className="space-y-1 rounded-lg bg-gray-50/70 dark:bg-gray-800/40 p-2.5 border border-gray-200/70 dark:border-gray-700/60">
          <div className="flex items-center justify-between">
            <label htmlFor="roof-tile-size-slider" className="font-semibold text-[11px] text-gray-700 dark:text-gray-200">
              Tile Scale / Size
            </label>
            <div className="font-mono text-[10px] font-bold text-gray-700 dark:text-gray-300">
              {(tileSize * 100).toFixed(0)} cm ({tileSize.toFixed(2)}m)
            </div>
          </div>
          <input 
            id="roof-tile-size-slider"
            type="range"
            min={0.15}
            max={0.75}
            step={0.01}
            value={tileSize}
            onChange={(e) => handleSizeChange(Number(e.target.value))}
            className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
          />
          <div className="flex justify-between text-[9px] text-gray-400 font-mono pt-0.5">
            <span>Small (15cm)</span>
            <span>Standard (35cm)</span>
            <span>Large (75cm)</span>
          </div>
        </div>
      )}

      {/* 4. BASE TILE COLOUR & SWATCHES */}
      <div className="space-y-2 rounded-lg bg-gray-50/70 dark:bg-gray-800/40 p-2.5 border border-gray-200/70 dark:border-gray-700/60">
        <div className="flex items-center justify-between">
          <label className="font-semibold text-[11px] text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
            <Palette size={13} className="text-trimble-blue" />
            <span>{tileShape === 'none' ? 'Roof Surface Colour' : 'Primary Tile Colour'}</span>
          </label>
          <div className="flex items-center gap-1.5">
            <input 
              type="color"
              value={tileColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
              title="Pick custom hex color"
            />
            <span className="font-mono text-[10px] text-gray-500 uppercase">{tileColor}</span>
          </div>
        </div>

        {/* Preset Color Swatches */}
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          {PRESET_ROOF_COLORS.map((pc) => (
            <button
              key={pc.name}
              type="button"
              onClick={() => handleColorChange(pc.value)}
              className={cn(
                "w-5 h-5 rounded-full border transition-transform cursor-pointer relative",
                tileColor.toLowerCase() === pc.value.toLowerCase()
                  ? "ring-2 ring-trimble-blue ring-offset-1 scale-110 border-white shadow-xs"
                  : "border-gray-300 dark:border-gray-600 opacity-80 hover:opacity-100"
              )}
              style={{ backgroundColor: pc.value }}
              title={pc.name}
            />
          ))}
        </div>
      </div>

      {/* 5. RANDOMISE TILE COLOUR PALETTE (Up to 8 user-defined colours / textures, only when tiles active) */}
      {tileShape !== 'none' && (
      <div className="space-y-2.5 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 bg-white dark:bg-gray-800/90 shadow-xs">
        <div className="flex items-center justify-between pb-1.5 border-b border-gray-100 dark:border-gray-700">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 font-semibold text-[11px] text-gray-800 dark:text-gray-200">
              <Sparkles size={13} className={randomizeColor ? "text-amber-500 animate-spin" : "text-gray-400"} />
              <span>Randomise Tile Colours</span>
            </div>
            <p className="text-[9px] text-gray-500 dark:text-gray-400">
              Multi-tone blending from up to 8 custom colors or textures
            </p>
          </div>

          <div className="flex items-center gap-2">
            {randomizeColor && (
              <button
                type="button"
                onClick={handleShuffleSeed}
                className="p-1 rounded bg-gray-100 dark:bg-gray-700 hover:bg-trimble-blue/10 hover:text-trimble-blue text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                title="Shuffle Random Variation Seed"
              >
                <Shuffle size={13} />
              </button>
            )}

            {/* Toggle Switch */}
            <button
              type="button"
              role="switch"
              aria-checked={randomizeColor}
              onClick={handleToggleRandomize}
              className={cn(
                "w-9 h-5 shrink-0 flex items-center rounded-full p-0.5 transition-colors cursor-pointer",
                randomizeColor ? "bg-trimble-blue" : "bg-gray-300 dark:bg-gray-600"
              )}
            >
              <div
                className={cn(
                  "bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform",
                  randomizeColor ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>
        </div>

        {/* User-Defined Palette Swatches List (up to 8) */}
        {randomizeColor && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-[10px] text-gray-500 font-mono">
              <span>Active Swatches ({colorPalette.length}/8)</span>
              {colorPalette.length < 8 && (
                <button
                  type="button"
                  onClick={handleAddPaletteItem}
                  className="flex items-center gap-1 text-[10px] text-trimble-blue font-semibold hover:underline cursor-pointer"
                >
                  <Plus size={11} />
                  <span>Add Swatch</span>
                </button>
              )}
            </div>

            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
              {colorPalette.map((item, idx) => (
                <div 
                  key={item.id}
                  className="flex items-center justify-between p-1.5 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200/60 dark:border-gray-600/60 text-[10px]"
                >
                  <div className="flex items-center gap-2 flex-1">
                    {/* Swatch indicator / Color Input */}
                    {item.type === 'color' ? (
                      <div className="relative">
                        <input 
                          type="color"
                          value={item.value}
                          onChange={(e) => handleUpdatePaletteItem(item.id, { value: e.target.value })}
                          className="w-6 h-6 rounded border cursor-pointer p-0 bg-transparent"
                          title="Change swatch color"
                        />
                      </div>
                    ) : (
                      <div 
                        className="w-6 h-6 rounded border border-gray-300 dark:border-gray-500 shrink-0"
                        style={{ 
                          backgroundColor: PRESET_ROOF_TEXTURES.find(t => t.id === item.value)?.previewColor || '#964423' 
                        }}
                      />
                    )}

                    {/* Mode Toggle: Color vs Texture */}
                    <select
                      value={item.type}
                      onChange={(e) => {
                        const nextType = e.target.value as 'color' | 'texture';
                        handleUpdatePaletteItem(item.id, { 
                          type: nextType, 
                          value: nextType === 'texture' ? 'weathered_clay' : '#b45309' 
                        });
                      }}
                      className="text-[9px] font-mono py-0.5 px-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300"
                    >
                      <option value="color">Solid</option>
                      <option value="texture">Texture</option>
                    </select>

                    {/* Detail Selector */}
                    {item.type === 'texture' ? (
                      <select
                        value={item.value}
                        onChange={(e) => handleUpdatePaletteItem(item.id, { value: e.target.value })}
                        className="text-[9px] py-0.5 px-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 flex-1 truncate"
                      >
                        {PRESET_ROOF_TEXTURES.map(tex => (
                          <option key={tex.id} value={tex.id}>{tex.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-mono text-[9px] text-gray-500 uppercase flex-1">
                        {item.value}
                      </span>
                    )}
                  </div>

                  {/* Remove Button (if > 1) */}
                  {colorPalette.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemovePaletteItem(item.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors ml-1"
                      title="Remove this swatch"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleShuffleSeed}
              className="w-full py-1.5 px-2 bg-trimble-blue/10 hover:bg-trimble-blue/15 text-trimble-blue font-semibold rounded-md flex items-center justify-center gap-1.5 text-[10px] transition-colors cursor-pointer"
            >
              <Dices size={13} />
              <span>Randomise / Roll Variation</span>
            </button>
          </div>
        )}
      </div>
      )}

      {/* 6. GENERATE NEW ROOF ACTIONS */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
          {activeRoof ? 'Replace / Generate Roof' : 'Generate Roof on Room'}
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => handleGenerateRoofType('gable')}
            className="py-2 px-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-trimble-blue hover:text-trimble-blue rounded-lg text-center flex flex-col items-center justify-center gap-1 transition-all cursor-pointer shadow-xs"
            title="Generate Gable Roof with selected tiles and height"
          >
            <Home size={14} className="text-trimble-blue" />
            <span className="text-[10px] font-bold">Gable</span>
          </button>

          <button
            type="button"
            onClick={() => handleGenerateRoofType('hip')}
            className="py-2 px-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-trimble-blue hover:text-trimble-blue rounded-lg text-center flex flex-col items-center justify-center gap-1 transition-all cursor-pointer shadow-xs"
            title="Generate Hip Roof with 4 slopes, selected tiles and height"
          >
            <Home size={14} className="text-sky-500" />
            <span className="text-[10px] font-bold">Hip</span>
          </button>

          <button
            type="button"
            onClick={() => handleGenerateRoofType('parapet')}
            className="py-2 px-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-trimble-blue hover:text-trimble-blue rounded-lg text-center flex flex-col items-center justify-center gap-1 transition-all cursor-pointer shadow-xs"
            title="Generate Parapet Flat Roof with Coping"
          >
            <Layers size={14} className="text-slate-500" />
            <span className="text-[10px] font-bold">Parapet</span>
          </button>
        </div>
      </div>

      {/* 7. EXPANDABLE ADVANCED TRIM & EAVES */}
      <div className="border border-gray-200/70 dark:border-gray-700/60 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full p-2 bg-gray-50/60 dark:bg-gray-800/40 flex items-center justify-between text-gray-600 dark:text-gray-300 font-medium text-[10px] hover:text-trimble-blue transition-colors cursor-pointer"
        >
          <span>Advanced Trim & Eaves</span>
          {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showAdvanced && (
          <div className="p-2.5 space-y-2 border-t border-gray-200/60 dark:border-gray-700/60 bg-white dark:bg-gray-800">
            {/* Eave Overhang */}
            <div>
              <div className="flex justify-between text-gray-500 dark:text-gray-400 mb-1 text-[10px]">
                <span>Eave Overhang</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{(eaveOverhang * 100).toFixed(0)} cm</span>
              </div>
              <input 
                type="range"
                min={0.10}
                max={0.80}
                step={0.05}
                value={eaveOverhang}
                onChange={(e) => handleEaveOverhangChange(Number(e.target.value))}
                className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
              />
            </div>

            {/* Fascia Height */}
            <div>
              <div className="flex justify-between text-gray-500 dark:text-gray-400 mb-1 text-[10px]">
                <span>Fascia Board Trim</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{(fasciaHeight * 100).toFixed(0)} cm</span>
              </div>
              <input 
                type="range"
                min={0.08}
                max={0.35}
                step={0.02}
                value={fasciaHeight}
                onChange={(e) => handleFasciaHeightChange(Number(e.target.value))}
                className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-trimble-blue"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
