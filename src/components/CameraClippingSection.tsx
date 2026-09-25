import React from 'react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { RotateCcw, Crop } from 'lucide-react';

interface CameraClippingSectionProps {
  idPrefix?: string;
  className?: string;
}

export const CameraClippingSection: React.FC<CameraClippingSectionProps> = ({
  idPrefix = 'modifier',
  className
}) => {
  const {
    cameraDepthClippingEnabled,
    setCameraDepthClippingEnabled,
    cameraNear,
    setCameraNear,
    cameraFar,
    setCameraFar
  } = useApp();

  return (
    <div className={cn("space-y-3 px-1 py-1", className)}>
      {/* Enable Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
            Enable Depth Clipping
          </span>
          <span className="text-[9px] text-gray-400">Near &amp; Far Frustum Planes</span>
        </div>
        <button
          id={`${idPrefix}-toggle-camera-depth-clipping`}
          onClick={() => setCameraDepthClippingEnabled(!cameraDepthClippingEnabled)}
          className={cn(
            "w-8 h-4 rounded-full relative transition-colors cursor-pointer",
            cameraDepthClippingEnabled ? "bg-polyform-blue" : "bg-gray-300 dark:bg-gray-600"
          )}
          title={cameraDepthClippingEnabled ? "Disable Camera Depth Clipping" : "Enable Camera Depth Clipping"}
        >
          <div
            className={cn(
              "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all",
              cameraDepthClippingEnabled ? "left-4.5" : "left-0.5"
            )}
          />
        </button>
      </div>

      {/* Near Clipping Plane */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
              Near Plane
            </span>
            <span className="text-[9px] text-gray-400">(Min Distance)</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.05"
              value={cameraNear}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0.01) {
                  setCameraNear(val);
                  if (!cameraDepthClippingEnabled) setCameraDepthClippingEnabled(true);
                }
              }}
              className="w-16 px-1.5 py-0.5 text-right font-mono text-[10px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            />
            <span className="text-[10px] text-gray-400 font-mono">m</span>
          </div>
        </div>
        <input 
          type="range" 
          min="0.01" 
          max="25" 
          step="0.05"
          value={Math.min(cameraNear, 25)}
          onChange={(e) => {
            setCameraNear(parseFloat(e.target.value));
            if (!cameraDepthClippingEnabled) setCameraDepthClippingEnabled(true);
          }}
          className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-polyform-blue" 
        />
        <div className="text-[9px] text-gray-400 leading-normal">
          Hides any geometry that falls between the camera lens and this minimum distance. Critical for navigating tight interior spaces, allowing the camera to see through objects (like a wall directly behind the lens) without them blocking the viewport.
        </div>
        <div className="flex items-center gap-1 pt-0.5 flex-wrap">
          <span className="text-[8px] uppercase font-bold text-gray-400 mr-1">Presets:</span>
          {[
            { label: '0.1m', val: 0.1 },
            { label: '0.8m', val: 0.8 },
            { label: '1.5m', val: 1.5 },
            { label: '3.0m', val: 3.0 },
            { label: '5.0m', val: 5.0 },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                setCameraNear(preset.val);
                if (!cameraDepthClippingEnabled) setCameraDepthClippingEnabled(true);
              }}
              className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-mono border transition-colors cursor-pointer",
                cameraNear === preset.val
                  ? "bg-polyform-blue text-white border-polyform-blue"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-polyform-blue"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Far Clipping Plane */}
      <div className="space-y-1.5 pt-2 border-t border-gray-100 dark:border-gray-700/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">
              Far Plane
            </span>
            <span className="text-[9px] text-gray-400">(Max Distance)</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="1"
              max="10000"
              step="1"
              value={cameraFar}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 1) {
                  setCameraFar(val);
                  if (!cameraDepthClippingEnabled) setCameraDepthClippingEnabled(true);
                }
              }}
              className="w-16 px-1.5 py-0.5 text-right font-mono text-[10px] rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
            />
            <span className="text-[10px] text-gray-400 font-mono">m</span>
          </div>
        </div>
        <input 
          type="range" 
          min="5" 
          max="3000" 
          step="5"
          value={Math.min(cameraFar, 3000)}
          onChange={(e) => {
            setCameraFar(parseFloat(e.target.value));
            if (!cameraDepthClippingEnabled) setCameraDepthClippingEnabled(true);
          }}
          className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-polyform-blue" 
        />
        <div className="text-[9px] text-gray-400 leading-normal">
          Culls and hides any geometry that sits beyond this maximum distance. Primarily used to optimize rendering performance in massive scenes or fade out distant background clutter.
        </div>
        <div className="flex items-center gap-1 pt-0.5 flex-wrap">
          <span className="text-[8px] uppercase font-bold text-gray-400 mr-1">Presets:</span>
          {[
            { label: '25m', val: 25 },
            { label: '100m', val: 100 },
            { label: '500m', val: 500 },
            { label: '2000m', val: 2000 },
            { label: '5000m', val: 5000 },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                setCameraFar(preset.val);
                if (!cameraDepthClippingEnabled) setCameraDepthClippingEnabled(true);
              }}
              className={cn(
                "px-1.5 py-0.5 rounded text-[9px] font-mono border transition-colors cursor-pointer",
                cameraFar === preset.val
                  ? "bg-polyform-blue text-white border-polyform-blue"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-polyform-blue"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reset Button */}
      <div className="pt-2">
        <button
          onClick={() => {
            setCameraNear(0.1);
            setCameraFar(2000);
            setCameraDepthClippingEnabled(false);
          }}
          className="w-full py-1.5 px-2 text-[10px] font-medium rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          title="Reset Near and Far clipping planes to default camera settings"
        >
          <RotateCcw size={12} />
          <span>Reset to Camera Defaults (0.1m / 2000m)</span>
        </button>
      </div>
    </div>
  );
};
