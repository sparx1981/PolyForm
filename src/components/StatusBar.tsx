import { HelpCircle, MousePointer2, Camera, CloudCheck, CloudUpload, CloudOff, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useApp } from '../AppContext';

export default function StatusBar() {
  const { measurements, setMeasurements, activeTool, unit, zoom, rectangleInputState, setRectangleInputState, syncStatus, isQuotaLocked } = useApp();

  const defaultVal = unit === 'mm' ? '0.0 mm' : unit === 'cm' ? '0.00 cm' : '0.000 m';
  const quotaLocked = isQuotaLocked();

  return (
    <footer className="h-8 bg-white border-t border-gray-200 flex items-center justify-between px-3 text-[11px] text-gray-600 z-50">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <MousePointer2 size={12} className="text-trimble-blue" />
          <span className="font-medium uppercase tracking-tight">
            {activeTool.replace(/([A-Z])/g, ' $1')} Tool:
          </span>
          <span>
            {activeTool === 'zoom' ? 'Click and drag up/down to zoom.' : 'Click to select objects. Shift to add/subtract.'}
          </span>
        </div>

        <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
          {quotaLocked ? (
            <div className="flex items-center gap-1.5 text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-100">
              <ShieldAlert size={12} />
              <span className="uppercase tracking-widest text-[9px]">Quota Locked</span>
            </div>
          ) : (
            <>
              {syncStatus === 'synced' && (
                <div className="flex items-center gap-1.5 text-green-600">
                  <CloudCheck size={12} />
                  <span className="font-bold uppercase tracking-widest text-[9px]">Synced</span>
                </div>
              )}
              {syncStatus === 'syncing' && (
                <div className="flex items-center gap-1.5 text-trimble-blue animate-pulse">
                  <CloudUpload size={12} />
                  <span className="font-bold uppercase tracking-widest text-[9px]">Syncing...</span>
                </div>
              )}
              {syncStatus === 'error' && (
                <div className="flex items-center gap-1.5 text-red-500">
                  <AlertTriangle size={12} />
                  <span className="font-bold uppercase tracking-widest text-[9px]">Sync Error</span>
                </div>
              )}
              {syncStatus === 'offline' && (
                <div className="flex items-center gap-1.5 text-gray-400">
                  <CloudOff size={12} />
                  <span className="font-bold uppercase tracking-widest text-[9px]">Offline</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {activeTool === 'rectangle' && (
          <div className="flex items-center gap-2 border-l border-gray-200 pl-4 h-full">
            <div className="flex items-center gap-1.5 px-2 bg-neutral-800 rounded border border-neutral-700 shadow-inner">
              <span className="text-[9px] font-bold text-neutral-400 uppercase">X (Width)</span>
              <input 
                type="text"
                placeholder="0.0"
                value={rectangleInputState.width}
                onChange={e => setRectangleInputState({ ...rectangleInputState, width: e.target.value })}
                className="w-12 bg-transparent border-none outline-none text-right font-mono text-white p-0"
              />
              <span className="text-[9px] text-neutral-400">{unit}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 bg-neutral-800 rounded border border-neutral-700 shadow-inner">
              <span className="text-[9px] font-bold text-neutral-400 uppercase">Z (Depth)</span>
              <input 
                type="text"
                placeholder="0.0"
                value={rectangleInputState.depth}
                onChange={e => setRectangleInputState({ ...rectangleInputState, depth: e.target.value })}
                className="w-12 bg-transparent border-none outline-none text-right font-mono text-white p-0"
              />
              <span className="text-[9px] text-neutral-400">{unit}</span>
            </div>
            {rectangleInputState.active && (
              <span className="text-[9px] text-gray-400 italic ml-1 animate-pulse">Enter to Finish · Esc to Cancel</span>
            )}
          </div>
        )}
        {activeTool === 'zoom' && (
          <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
            <span className="uppercase font-semibold text-gray-400">Zoom Level</span>
            <div className="bg-neutral-800 border border-neutral-700 px-2 py-0.5 min-w-[60px] text-right font-mono text-white rounded">
              {(zoom || 1.0).toFixed(2)}x
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('capture-default-camera'))}
              className="ml-2 p-1 hover:bg-gray-100 rounded text-trimble-blue transition-colors group flex items-center gap-1 px-2"
              title="Set current camera as default"
            >
              <Camera size={12} />
              <span className="text-[9px] uppercase font-bold hidden group-hover:inline">Set Default</span>
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
          <span className="uppercase font-semibold text-gray-400">Measurements</span>
          <div className="bg-neutral-800 border border-neutral-700 px-2 py-0.5 min-w-[100px] text-right font-mono text-white rounded">
            {measurements || defaultVal}
          </div>
        </div>
      </div>
    </footer>
  );
}
