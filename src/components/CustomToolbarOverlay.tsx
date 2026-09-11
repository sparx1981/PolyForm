import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../AppContext';
import { CustomToolbarDef, CustomToolbarItem } from '../types';
import { DynamicIcon } from './ui/DynamicIcon';
import { DeveloperSDK } from '../services/developerService';
import { cn } from '../lib/utils';
import { GripVertical, X, ChevronUp, ChevronDown, Sparkles, Loader2, PanelRightClose } from 'lucide-react';

interface RunningItemState {
  [itemId: string]: boolean;
}

export const CustomToolbarOverlay: React.FC = () => {
  const {
    customToolbars,
    setCustomToolbars,
    shapes,
    setShapes,
    updateShapeColor,
    selectedId,
    selectedIds,
    setSelectedIds,
    setSelectedId,
    theme,
    setMeasurements,
    setConsoleOutput,
    diagLog,
    developerScripts,
    activeTool,
    setActiveTool,
    activeMaterial,
    setActiveMaterial,
    activePBR,
    setActivePBR,
    unit,
    setUnit,
    isAIRendererOpen,
    setIsAIRendererOpen,
    isAIQueryOpen,
    setIsAIQueryOpen,
    setActiveBlockPart,
    timberFrameParams,
    setTimberFrameParams,
    commitUpdatedFraming,
    activePlantSpecies,
    setActivePlantSpecies,
    activePlantVariation,
    setActivePlantVariation,
    activePlantScale,
    setActivePlantScale,
    wallTransparency,
    setWallTransparency,
    exteriorWallTransparency,
    setExteriorWallTransparency,
    interiorWallTransparency,
    setInteriorWallTransparency,
    cameraDepthClippingEnabled,
    setCameraDepthClippingEnabled,
    cameraNear,
    setCameraNear,
    cameraFar,
    setCameraFar,
    orbitRotationSpeed,
    setOrbitRotationSpeed,
    edgeLinesEnabled,
    setEdgeLinesEnabled,
    edgeLinesColor,
    setEdgeLinesColor,
    edgeLinesOpacity,
    setEdgeLinesOpacity,
    edgeLinesThickness,
    setEdgeLinesThickness,
    undo,
    redo,
    selectionFilter,
    setSelectionFilter,
    selectionShapeMode,
    setSelectionShapeMode,
    setShadowsEnabled,
    setGridEnabled,
    setFloorEnabled,
    setFloorColor,
    setAmbientOcclusionEnabled,
    setSunIntensity,
    setLightPosition,
    setAnimateSun,
    setSunSpeed,
    setNotes,
    setAllNotesVisible,
    basicToolbarExtensions,
    setBasicToolbarExtensions,
    wallToolSettings,
    setWallToolSettings,
    wallJustification,
    setWallJustification,
    activeStory,
    setActiveStory,
    landscapeSculptSettings,
    setLandscapeSculptSettings,
    landscapeRoadSettings,
    setLandscapeRoadSettings,
    commitHistory
  } = useApp();

  const [runningItems, setRunningItems] = useState<RunningItemState>({});
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [collapsedToolbars, setCollapsedToolbars] = useState<Record<string, boolean>>({});
  const draggingToolbarRef = useRef<{ id: string; startX: number; startY: number; initX: number; initY: number } | null>(null);

  // Execute extension action, code string, or scriptId. `value` is only
  // meaningful for non-button widgets (slider/checkbox/color-swatch/tabs) -
  // it's the new value the user just picked, exposed to the code as `value`.
  const executeItem = async (item: CustomToolbarItem, toolbarTitle?: string, value?: any) => {
    setRunningItems(prev => ({ ...prev, [item.id]: true }));
    setMeasurements(`Executing extension "${item.label}"...`);

    const extraSetters: any = {
      selectedIds,
      setSelectedIds,
      setSelectedId,
      activeTool,
      setActiveTool,
      activeMaterial,
      setActiveMaterial,
      activePBR,
      setActivePBR,
      unit,
      setUnit,
      isAIRendererOpen,
      setIsAIRendererOpen,
      isAIQueryOpen,
      setIsAIQueryOpen,
      setActiveBlockPart,
      timberFrameParams,
      setTimberFrameParams,
      commitUpdatedFraming,
      activePlantSpecies,
      setActivePlantSpecies,
      activePlantVariation,
      setActivePlantVariation,
      activePlantScale,
      setActivePlantScale,
      wallTransparency,
      setWallTransparency,
      exteriorWallTransparency,
      setExteriorWallTransparency,
      interiorWallTransparency,
      setInteriorWallTransparency,
      cameraDepthClippingEnabled,
      setCameraDepthClippingEnabled,
      cameraNear,
      setCameraNear,
      cameraFar,
      setCameraFar,
      orbitRotationSpeed,
      setOrbitRotationSpeed,
      edgeLinesEnabled,
      setEdgeLinesEnabled,
      edgeLinesColor,
      setEdgeLinesColor,
      edgeLinesOpacity,
      setEdgeLinesOpacity,
      edgeLinesThickness,
      setEdgeLinesThickness,
      undo,
      redo,
      selectionFilter,
      setSelectionFilter,
      selectionShapeMode,
      setSelectionShapeMode,
      setShadowsEnabled,
      setGridEnabled,
      setFloorEnabled,
      setFloorColor,
      setAmbientOcclusionEnabled,
      setSunIntensity,
      setLightPosition,
      setAnimateSun,
      setSunSpeed,
      setNotes,
      setAllNotesVisible,
      customToolbars,
      setCustomToolbars,
      basicToolbarExtensions,
      setBasicToolbarExtensions,
      developerScripts,
      wallToolSettings,
      setWallToolSettings,
      wallJustification,
      setWallJustification,
      activeStory,
      setActiveStory,
      landscapeSculptSettings,
      setLandscapeSculptSettings,
      landscapeRoadSettings,
      setLandscapeRoadSettings,
      onLog: (msg: string) => setConsoleOutput(prev => [...prev, `[EXT] ${msg}`])
    };

    const sdk = new DeveloperSDK(
      shapes,
      setShapes,
      updateShapeColor,
      selectedId,
      extraSetters
    );

    const customConsole = {
      log: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
        setConsoleOutput(prev => [...prev, `[EXT] ${msg}`]);
        if (diagLog) diagLog('info', `Extension log: ${msg}`);
      },
      warn: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
        setConsoleOutput(prev => [...prev, `[WARN] ${msg}`]);
      },
      error: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
        setConsoleOutput(prev => [...prev, `[ERROR] ${msg}`]);
        if (diagLog) diagLog('error', `Extension error: ${msg}`);
      }
    };

    try {
      if (typeof item.action === 'function') {
        await item.action(sdk);
      } else if (item.code && item.code.trim()) {
        const fn = new Function('sdk', 'console', 'value', `
          return (async () => {
            try {
              ${item.code}
            } catch (e) {
              console.error(e.message || String(e));
              throw e;
            }
          })();
        `);
        await fn(sdk, customConsole, value);
      } else if (item.scriptId) {
        const script = developerScripts.find(s => s.id === item.scriptId);
        if (script) {
          const fn = new Function('sdk', 'console', `
            return (async () => {
              try {
                ${script.code}
              } catch (e) {
                console.error(e.message || String(e));
                throw e;
              }
            })();
          `);
          await fn(sdk, customConsole);
        } else {
          customConsole.warn(`Script ID "${item.scriptId}" not found in library.`);
        }
      } else {
        customConsole.warn(`No action, code, or scriptId defined for button "${item.label}".`);
      }
      commitHistory();
      setMeasurements(`Extension "${item.label}" executed successfully.`);
      if (diagLog) diagLog('info', `Extension button "${item.label}" clicked in ${toolbarTitle || 'toolbar'}`);
    } catch (err: any) {
      console.error('[Extension Error]', err);
      setConsoleOutput(prev => [...prev, `[ERROR] In ${item.label}: ${err.message || String(err)}`]);
      setMeasurements(`Error in "${item.label}": ${err.message || 'Check developer console'}`);
    } finally {
      setRunningItems(prev => ({ ...prev, [item.id]: false }));
    }
  };

  const handlePointerDown = (e: React.PointerEvent, toolbarId: string) => {
    const current = positions[toolbarId] || { x: 100, y: 70 };
    draggingToolbarRef.current = {
      id: toolbarId,
      startX: e.clientX,
      startY: e.clientY,
      initX: current.x,
      initY: current.y
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingToolbarRef.current) return;
    const { id, startX, startY, initX, initY } = draggingToolbarRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    setPositions(prev => ({
      ...prev,
      [id]: {
        x: Math.max(10, Math.min(window.innerWidth - 80, initX + dx)),
        y: Math.max(50, Math.min(window.innerHeight - 80, initY + dy))
      }
    }));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingToolbarRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (_) {}
      draggingToolbarRef.current = null;
    }
  };

  const removeToolbar = (toolbarId: string) => {
    setCustomToolbars(prev => prev.filter(t => t.id !== toolbarId));
  };

  const toggleCollapse = (toolbarId: string) => {
    setCollapsedToolbars(prev => ({ ...prev, [toolbarId]: !prev[toolbarId] }));
  };

  // Patches one widget item (anywhere in a toolbar, including inside a
  // 'section' item's nested list) so sliders/checkboxes/color-swatches/tabs
  // visually reflect the user's last interaction.
  const updateItemState = (toolbarId: string, itemId: string, patch: Partial<CustomToolbarItem>) => {
    const applyToItems = (items: CustomToolbarItem[]): CustomToolbarItem[] => items.map(it => {
      if (it.id === itemId) return { ...it, ...patch };
      if (it.items) return { ...it, items: applyToItems(it.items) };
      return it;
    });
    setCustomToolbars(prev => prev.map(t => t.id === toolbarId ? { ...t, items: applyToItems(t.items) } : t));
  };

  // Lets the user switch a custom toolbar between floating (draggable) and
  // docked (fixed to a side of the viewport) directly from its own header,
  // independent of whatever position the script that created it specified.
  const toggleDock = (toolbarId: string) => {
    setCustomToolbars(prev => prev.map(t => {
      if (t.id !== toolbarId) return t;
      const isCurrentlyFloating = (t.position || 'top-center') === 'floating' || (t.position || '').startsWith('custom');
      return { ...t, position: isCurrentlyFloating ? 'top-center' : 'floating' };
    }));
  };

  // A toolbar containing any rich widget (anything beyond a plain icon
  // button) renders as a vertical panel instead of a row of icons, since
  // sliders/checkboxes/swatches/tabs/sections need real width to be usable.
  const hasRichWidgets = (items: CustomToolbarItem[]): boolean =>
    items.some(it => (it.type && it.type !== 'button') || (it.items && it.items.length > 0));

  const renderToolbarItem = (item: CustomToolbarItem, toolbar: CustomToolbarDef, isHorizontal: boolean): React.ReactNode => {
    const type = item.type || 'button';
    const isRunning = runningItems[item.id] || false;

    if (type === 'label') {
      return (
        <div key={item.id} className="px-1 py-1 text-[11px] text-gray-500 dark:text-gray-400">
          {item.label}
        </div>
      );
    }

    if (type === 'slider') {
      return (
        <div key={item.id} className="w-full px-1 py-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
            <span>{item.label}</span>
            <span className="font-mono text-trimble-blue">{item.value ?? item.min ?? 0}</span>
          </div>
          <input
            type="range"
            min={item.min ?? 0}
            max={item.max ?? 100}
            step={item.step ?? 1}
            value={item.value ?? item.min ?? 0}
            onChange={e => {
              const v = parseFloat(e.target.value);
              updateItemState(toolbar.id, item.id, { value: v });
              executeItem(item, toolbar.title, v);
            }}
            className="w-full h-1 accent-trimble-blue"
          />
          {item.description && <p className="text-[10px] text-gray-400 mt-0.5">{item.description}</p>}
        </div>
      );
    }

    if (type === 'checkbox') {
      return (
        <label key={item.id} className="w-full flex items-start gap-2 px-1 py-1 text-[11px] text-gray-600 dark:text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={!!item.checked}
            onChange={e => {
              const v = e.target.checked;
              updateItemState(toolbar.id, item.id, { checked: v });
              executeItem(item, toolbar.title, v);
            }}
            className="accent-trimble-blue mt-0.5"
          />
          <span>
            {item.label}
            {item.description && <div className="text-[10px] text-gray-400">{item.description}</div>}
          </span>
        </label>
      );
    }

    if (type === 'color-swatch') {
      return (
        <div key={item.id} className="w-full px-1 py-1">
          {item.label && <div className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">{item.label}</div>}
          <div className="grid grid-cols-9 gap-1.5">
            {(item.colors || []).map(c => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => {
                  updateItemState(toolbar.id, item.id, { selectedColor: c });
                  executeItem(item, toolbar.title, c);
                }}
                className={cn(
                  "w-6 h-6 rounded-md border-2 transition-transform hover:scale-110",
                  item.selectedColor === c ? "border-trimble-blue" : "border-transparent"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            {item.allowCustomColor && (
              <input
                type="color"
                value={item.selectedColor || '#ffffff'}
                onChange={e => {
                  const v = e.target.value;
                  updateItemState(toolbar.id, item.id, { selectedColor: v });
                  executeItem(item, toolbar.title, v);
                }}
                className="w-6 h-6 rounded-md border-2 border-gray-300 dark:border-gray-600 cursor-pointer bg-transparent"
                title="Custom colour"
              />
            )}
          </div>
        </div>
      );
    }

    if (type === 'tabs') {
      return (
        <div key={item.id} className="w-full px-1 py-1 flex flex-wrap gap-1">
          {(item.options || []).map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                updateItemState(toolbar.id, item.id, { selected: opt });
                executeItem(item, toolbar.title, opt);
              }}
              className={cn(
                "px-2 py-1 rounded-full text-[10px] font-medium whitespace-nowrap",
                item.selected === opt ? "bg-trimble-blue text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      );
    }

    if (type === 'section') {
      const isOpen = !item.collapsed;
      return (
        <div key={item.id} className="w-full border-t border-gray-100 dark:border-gray-800 first:border-t-0 pt-1">
          <button
            type="button"
            onClick={() => updateItemState(toolbar.id, item.id, { collapsed: isOpen })}
            className="w-full flex items-center justify-between px-1 py-1 text-[11px] font-bold text-gray-700 dark:text-gray-200"
          >
            <span className="flex items-center gap-1.5"><DynamicIcon nameOrEmoji={item.icon} size={13} />{item.label}</span>
            {isOpen ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
          </button>
          {isOpen && (
            <div className="flex flex-col gap-1 pb-1">
              {(item.items || []).map(child => renderToolbarItem(child, toolbar, isHorizontal))}
            </div>
          )}
        </div>
      );
    }

    // Default: 'button' (including variant: 'tile')
    if (item.variant === 'tile') {
      return (
        <button
          key={item.id}
          id={`toolbar-btn-${item.id}`}
          onClick={() => executeItem(item, toolbar.title)}
          disabled={isRunning}
          title={item.tooltip || item.label}
          className={cn(
            "flex flex-col items-center gap-1 p-2 rounded-lg border text-center transition-all w-full",
            theme === 'dark' ? "border-gray-700 hover:bg-gray-800" : "border-gray-200 hover:bg-gray-50"
          )}
        >
          <div className="w-8 h-8 rounded flex items-center justify-center" style={{ backgroundColor: item.color || '#94a3b8' }}>
            {isRunning ? <Loader2 size={14} className="animate-spin text-white" /> : <DynamicIcon nameOrEmoji={item.icon} size={14} className="text-white" />}
          </div>
          <span className="text-[10px] font-medium">{item.label}</span>
        </button>
      );
    }

    return (
      <button
        key={item.id}
        id={`toolbar-btn-${item.id}`}
        onClick={() => executeItem(item, toolbar.title)}
        disabled={isRunning}
        title={item.tooltip || item.label}
        className={cn(
          "relative group flex items-center justify-center p-2 rounded-lg transition-all duration-150 active:scale-95 disabled:opacity-60",
          theme === 'dark'
            ? "hover:bg-gray-800 text-gray-200 hover:text-white"
            : "hover:bg-slate-100 text-gray-700 hover:text-gray-900"
        )}
        style={item.color ? { color: item.color } : undefined}
      >
        {isRunning ? (
          <Loader2 size={18} className="animate-spin text-trimble-blue" />
        ) : (
          <DynamicIcon nameOrEmoji={item.icon} size={18} />
        )}

        {item.badge && (
          <span className="absolute -top-1 -right-1 px-1 py-0.2 bg-trimble-blue text-white rounded text-[9px] font-bold leading-none shadow">
            {item.badge}
          </span>
        )}

        <div
          className={cn(
            "absolute z-50 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-[11px] px-2 py-1 rounded shadow-lg",
            isHorizontal ? "top-full mt-1.5 left-1/2 -translate-x-1/2" : "left-full ml-1.5 top-1/2 -translate-y-1/2",
            theme === 'dark' ? "bg-gray-800 text-white border border-gray-700" : "bg-gray-900 text-white"
          )}
        >
          <div className="font-semibold">{item.label}</div>
          {item.tooltip && item.tooltip !== item.label && (
            <div className="text-[10px] text-gray-300 font-normal">{item.tooltip}</div>
          )}
          {item.hotkey && (
            <div className="text-[9px] text-gray-400 font-mono mt-0.5">Hotkey: {item.hotkey}</div>
          )}
        </div>
      </button>
    );
  };

  if (!customToolbars || customToolbars.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {customToolbars.map((toolbar, index) => {
        const isCollapsed = collapsedToolbars[toolbar.id] ?? toolbar.collapsed ?? false;
        const position = toolbar.position || 'top-center';
        const isFloating = position === 'floating' || position.startsWith('custom');
        const posCoord = positions[toolbar.id] || toolbar.floatPosition || { x: 140 + index * 30, y: 70 + index * 40 };

        // Position styling for docked positions
        let positionClasses = "";
        let inlineStyle: React.CSSProperties = {};

        if (isFloating) {
          inlineStyle = {
            position: 'absolute',
            left: `${posCoord.x}px`,
            top: `${posCoord.y}px`
          };
        } else {
          switch (position) {
            case 'top-left':
              positionClasses = "absolute top-14 left-16";
              break;
            case 'top-center':
              positionClasses = "absolute top-14 left-1/2 -translate-x-1/2";
              break;
            case 'top-right':
              positionClasses = "absolute top-14 right-20";
              break;
            case 'bottom-left':
              positionClasses = "absolute bottom-12 left-16";
              break;
            case 'bottom-center':
              positionClasses = "absolute bottom-12 left-1/2 -translate-x-1/2";
              break;
            case 'bottom-right':
              positionClasses = "absolute bottom-12 right-20";
              break;
            case 'dock-left':
              positionClasses = "absolute top-28 left-14";
              break;
            case 'dock-top':
              positionClasses = "absolute top-14 left-1/3";
              break;
            case 'dock-bottom':
              positionClasses = "absolute bottom-12 left-1/3";
              break;
            default:
              positionClasses = "absolute top-14 left-1/2 -translate-x-1/2";
          }
        }

        const isHorizontal = toolbar.orientation !== 'vertical';

        return (
          <div
            key={toolbar.id}
            id={`custom-toolbar-${toolbar.id}`}
            style={inlineStyle}
            className={cn(
              "pointer-events-auto select-none rounded-xl shadow-2xl border transition-all backdrop-blur-md",
              positionClasses,
              theme === 'dark' 
                ? "bg-gray-900/90 border-gray-700/80 text-white shadow-black/40" 
                : "bg-white/95 border-gray-200/90 text-gray-800 shadow-slate-300/60"
            )}
          >
            {/* Toolbar Header / Drag Grip */}
            <div 
              onPointerDown={e => handlePointerDown(e, toolbar.id)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className={cn(
                "flex items-center justify-between px-2.5 py-1.5 border-b cursor-grab active:cursor-grabbing text-xs font-semibold gap-2",
                theme === 'dark' ? "border-gray-800 bg-gray-850/50" : "border-gray-100 bg-slate-50/70"
              )}
            >
              <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                <GripVertical size={13} className="opacity-60" />
                <span className="text-[11px] font-bold tracking-tight text-gray-800 dark:text-gray-200 truncate max-w-[140px]">
                  {toolbar.title}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleDock(toolbar.id)}
                  className={cn(
                    "p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors",
                    isFloating ? "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" : "text-trimble-blue bg-trimble-blue/10"
                  )}
                  title={isFloating ? "Dock Toolbar" : "Undock Toolbar (Make Floating)"}
                >
                  <PanelRightClose size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => toggleCollapse(toolbar.id)}
                  className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                  title={isCollapsed ? "Expand Toolbar" : "Collapse Toolbar"}
                >
                  {isCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                </button>
                {toolbar.closable !== false && (
                  <button
                    type="button"
                    onClick={() => removeToolbar(toolbar.id)}
                    className="p-0.5 rounded hover:bg-red-500/15 hover:text-red-500 text-gray-400 transition-colors"
                    title="Close Toolbar"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Toolbar Content */}
            {!isCollapsed && (
              <div
                className={cn(
                  "p-1.5 gap-1.5 flex",
                  hasRichWidgets(toolbar.items) ? "flex-col w-64 max-h-[70vh] overflow-y-auto" : (isHorizontal ? "flex-row items-center" : "flex-col items-center")
                )}
              >
                {toolbar.items.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-gray-400 italic">
                    No buttons registered
                  </div>
                ) : (
                  toolbar.items.map(item => renderToolbarItem(item, toolbar, isHorizontal))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
