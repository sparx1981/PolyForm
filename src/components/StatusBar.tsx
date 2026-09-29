import { MousePointer2, Camera, CloudCheck, CloudUpload, CloudOff, AlertTriangle, ShieldAlert, Cloud } from 'lucide-react';
import { useApp } from '../AppContext';

// Per-tool status bar instructions. Every tool in ToolType should have an entry here so the
// status bar never falls back to the generic "Select Tool" message while another tool is active.
const TOOL_INSTRUCTIONS: Record<string, string> = {
select: 'Click to select objects. Shift to add/subtract.',
lasso: 'Drag to select multiple objects.',
eraser: 'Click an object to delete all its surfaces. Shift+click to delete a single surface.',
paint: 'Click a surface to apply the active material.',
component: 'Click to place a new component.',
line: 'Drag to draw a line (snaps to ends, middles and centres; X/Y/Z lock an axis). Type a length and press Enter - while dragging or just after - to make it exact.',
poly: 'Click to place points. Double-click to finish the shape.',
freehand: 'Click and drag to draw a freehand line.',
rectangle: 'Drag to draw a rectangle, then type width,depth (e.g. 4,3) and press Enter to make it exact. A single click opens width and depth boxes.',
circle: 'Drag from the centre to set the radius; type a radius and press Enter to make it exact.',
polygon: 'Drag from the centre to set the size; type a radius, or sides like 8s, and press Enter. Up/Down arrows change the sides.',
arc: 'Click to set the start point, end point, and bulge of the arc.',
pie: 'Click to set the center, radius, and angle of the pie.',
triangle: 'Drag from the centre to draw a triangle; type a size and press Enter to make it exact.',
move: 'Drag the gizmo to move. Then type a distance, an offset <x,y,z> or a point [x,y,z] and press Enter to make it exact.',
rotate: 'Drag the gizmo to rotate. Then type an angle in degrees and press Enter to make it exact.',
scale: 'Drag a handle to resize. Then type a factor (e.g. 2 or 0.5) and press Enter to make it exact.',
pushpull: 'Drag a face to extrude it, then type a distance and press Enter to make it exact (a minus sign goes the other way).',
followme: 'Select a path, then click a profile to extrude along it.',
offset: 'Press on a flat surface and drag inward or outward, then release; type a distance and press Enter to make it exact. Red means the offset is too large.',
combine: 'Choose Merge, Subtract or Intersect, click the flat shapes or 3D objects (the first one leads), then press Enter or Apply.',
flip: 'Click an object to mirror it.',
tape: 'Click two points to measure the distance between them.',
protractor: 'Click three points to measure an angle.',
dimensions: 'Click two points to add a dimension label.',
text: 'Click a surface or the ground to place a flat text label, then type the words.',
text3d: 'Click the ground or a wall to place solid 3D letters, then type the words.',
axes: 'Click to reposition the model axes.',
section: 'Click to place a section cutting plane.',
orbit: 'Click and drag to orbit the camera.',
pan: 'Click and drag to pan the view.',
zoom: 'Click and drag up/down to zoom.',
zoomextents: 'Click to zoom and fit the whole model in view.',
sphere: 'Drag to draw a sphere; type a radius and press Enter to make it exact.',
cone: 'Drag for the base, then the height; type each and press Enter to make it exact.',
pyramid: 'Drag for the base, then the height; type each and press Enter to make it exact.',
donut: 'Drag for the ring, then the tube; type each and press Enter to make it exact.',
dome: 'Drag to draw a dome; type a radius and press Enter to make it exact.',
bevel: 'Click an edge to bevel it.',
subtract: 'Click the object to keep, then click the object to subtract.',
note: 'Click to place a note.',
deform: 'Click and drag on the surface to deform it.',
  wall: 'Click points (90° default, hold Shift for free angles), or type a length and press Enter for the next wall that long towards the cursor. Double-click, Enter or Esc to finish.',
  door: 'Click on a wall to place door & cut opening (or place on ground). Move tool repositions.',
  window: 'Click on a wall to place window & cut opening (or place on ground). Move tool repositions.',
  step: 'Click to place an architectural step with nosing.',
  staircase: 'Click to place a 12-step architectural staircase flight.',
  fence: 'Click points along the ground, or type a length and press Enter for the next point that far towards the cursor. Enter to finish.',
  railing: 'Click points, or type a length and press Enter for the next point that far towards the cursor. Enter to finish.',
  water: 'Click the outline, or type a length and press Enter for the next point that far towards the cursor. Enter to finish.',
};

export default function StatusBar() {
const { measurements, activeTool, unit, zoom, rectangleInputState, setRectangleInputState, syncStatus, syncErrorMessage, retrySync, isQuotaLocked } = useApp();

const defaultVal = unit === 'mm' ? '0.0 mm' : unit === 'cm' ? '0.00 cm' : '0.000 m';
const quotaLocked = isQuotaLocked();

return (
<footer className="h-8 bg-white border-t border-gray-200 flex items-center justify-between px-3 text-[11px] text-gray-600 z-50">
<div className="flex items-center gap-4">
<div className="flex items-center gap-1.5">
<MousePointer2 size={12} className="text-polyform-blue" />
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
<div className="flex items-center gap-1.5 text-polyform-blue animate-pulse">
<CloudUpload size={12} />
<span className="font-bold uppercase tracking-widest text-[9px]">Syncing...</span>
</div>
)}
{syncStatus === 'error' && (
<button
  type="button"
  onClick={retrySync}
  title={`${syncErrorMessage || 'Cloud save failed.'} Click to retry now.`}
  className="flex items-center gap-1.5 text-red-500 hover:text-red-600 cursor-pointer"
>
<AlertTriangle size={12} />
<span className="font-bold uppercase tracking-widest text-[9px]">Sync Error - Retry</span>
</button>
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
className="ml-2 p-1 hover:bg-gray-100 rounded text-polyform-blue transition-colors group flex items-center gap-1 px-2"
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
