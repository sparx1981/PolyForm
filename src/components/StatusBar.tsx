import { HelpCircle, MousePointer2, Camera, CloudCheck, CloudUpload, CloudOff, AlertTriangle, ShieldAlert, Cloud } from 'lucide-react';
import { useApp } from '../AppContext';

// Per-tool status bar instructions. Every tool in ToolType should have an entry here so the
// status bar never falls back to the generic "Select Tool" message while another tool is active.
const TOOL_INSTRUCTIONS: Record<string, string> = {
select: 'Click to select objects. Shift to add/subtract.',
lasso: 'Drag to select multiple objects.',
eraser: 'Click an edge or object to erase it.',
paint: 'Click a surface to apply the active material.',
component: 'Click to place a new component.',
line: 'Click to place points. Click the start point or press Enter to finish.',
poly: 'Click to place points. Double-click to finish the shape.',
freehand: 'Click and drag to draw a freehand line.',
rectangle: 'Click and drag to draw a rectangle.',
circle: 'Click a center point, then drag to set the radius.',
polygon: 'Click a center point, then drag to set the size.',
arc: 'Click to set the start point, end point, and bulge of the arc.',
pie: 'Click to set the center, radius, and angle of the pie.',
triangle: 'Click and drag to draw a triangle.',
move: 'Click and drag an object to move it.',
rotate: 'Click and drag to rotate the selected object.',
scale: 'Drag a handle to resize the selected object.',
pushpull: 'Click and drag a face to push or pull it.',
followme: 'Select a path, then click a profile to extrude along it.',
offset: 'Click a face or edge, then drag to offset it.',
flip: 'Click an object to mirror it.',
tape: 'Click two points to measure the distance between them.',
protractor: 'Click three points to measure an angle.',
dimensions: 'Click two points to add a dimension label.',
text: 'Click to place a 2D text label.',
text3d: 'Click to place 3D text.',
axes: 'Click to reposition the model axes.',
section: 'Click to place a section cutting plane.',
orbit: 'Click and drag to orbit the camera.',
pan: 'Click and drag to pan the view.',
zoom: 'Click and drag up/down to zoom.',
zoomextents: 'Click to zoom and fit the whole model in view.',
sphere: 'Click and drag to draw a sphere.',
cone: 'Click and drag to draw a cone.',
pyramid: 'Click and drag to draw a pyramid.',
donut: 'Click and drag to draw a donut.',
dome: 'Click and drag to draw a dome.',
bevel: 'Click an edge to bevel it.',
subtract: 'Click the object to keep, then click the object to subtract.',
note: 'Click to place a note.',
deform: 'Click and drag on the surface to deform it.'
};

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
{TOOL_INSTRUCTIONS[activeTool] || 'Click to select objects. Shift to add/subtract.'}
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
{syncStatus === 'unsaved' && (
<div
className="flex items-center gap-1.5 text-amber-600"
title="Your work is not being saved yet. Use the menu (top-left) and choose Save to store this model."
>
<Cloud size={12} />
<span className="font-bold uppercase tracking-widest text-[9px]">Not Saved</span>
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
