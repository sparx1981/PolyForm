import { useSyncExternalStore } from 'react';

/**
 * How the main view is projected: perspective (with a chosen lens) or orthographic, plus the ready-made
 * plan / elevation / isometric directions. Pure maths and a tiny store; the Viewport owns the cameras.
 */
export type Projection = 'perspective' | 'orthographic';
export interface CameraViewSettings { projection: Projection; fov: number }

export const DEFAULT_CAMERA_VIEW: CameraViewSettings = { projection: 'perspective', fov: 50 };
export const FOV_RANGE: readonly [number, number] = [12, 100];

/** Vertical field of view. 50 is the app's long-standing default. */
export const LENS_PRESETS = [
  { id: 'wide', name: 'Wide', fov: 75, hint: 'Takes in more of a room; edges stretch' },
  { id: 'standard', name: 'Standard', fov: 50, hint: 'The normal view' },
  { id: 'tele', name: 'Telephoto', fov: 30, hint: 'Flatter, closer to what the eye sees at a distance' },
  { id: 'long', name: 'Long lens', fov: 18, hint: 'Compressed depth, like a facade photograph' },
] as const;

export type StandardView = 'plan' | 'front' | 'rear' | 'left' | 'right' | 'iso-se' | 'iso-sw' | 'iso-ne' | 'iso-nw';
export const STANDARD_VIEWS: ReadonlyArray<{ id: StandardView; name: string; group: 'Drawing' | 'Isometric' }> = [
  { id: 'plan', name: 'Plan', group: 'Drawing' }, { id: 'front', name: 'Front', group: 'Drawing' }, { id: 'rear', name: 'Rear', group: 'Drawing' },
  { id: 'left', name: 'Left', group: 'Drawing' }, { id: 'right', name: 'Right', group: 'Drawing' },
  { id: 'iso-se', name: 'South-east', group: 'Isometric' }, { id: 'iso-sw', name: 'South-west', group: 'Isometric' },
  { id: 'iso-ne', name: 'North-east', group: 'Isometric' }, { id: 'iso-nw', name: 'North-west', group: 'Isometric' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const unit = (x: number, y: number, z: number): [number, number, number] => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };

/** Unit vector from the target towards the camera. Plan leans a hair to +z so "up" on screen is defined. */
export function viewDirection(view: StandardView): [number, number, number] {
  switch (view) {
    case 'plan': return unit(0, 1, 0.001);
    case 'front': return [0, 0, 1];
    case 'rear': return [0, 0, -1];
    case 'left': return [-1, 0, 0];
    case 'right': return [1, 0, 0];
    // Equal angles to all three axes: the true isometric elevation of 35.264 degrees.
    case 'iso-se': return unit(1, 1, 1);
    case 'iso-sw': return unit(-1, 1, 1);
    case 'iso-ne': return unit(1, 1, -1);
    case 'iso-nw': return unit(-1, 1, -1);
  }
}

/** Orthographic zoom (pixels per metre) that shows what a perspective camera sees at `distance`. */
export function orthoZoomFor(distance: number, fovDeg: number, viewportHeight: number): number {
  return viewportHeight / (2 * Math.max(distance, 1e-3) * Math.tan((fovDeg * Math.PI) / 360));
}
/** The perspective distance that matches an orthographic zoom. */
export function distanceForOrthoZoom(zoom: number, fovDeg: number, viewportHeight: number): number {
  return viewportHeight / (2 * Math.max(zoom, 1e-6) * Math.tan((fovDeg * Math.PI) / 360));
}

export interface FramedView { position: [number, number, number]; target: [number, number, number]; zoom?: number }

/** Camera pose that shows a bounding sphere from `view`, with a little air around it. */
export function frameView(input: {
  view: StandardView; center: { x: number; y: number; z: number }; radius: number;
  projection: Projection; fov: number; viewportWidth: number; viewportHeight: number;
}): FramedView {
  const radius = Math.max(input.radius, 0.5) * 1.15, dir = viewDirection(input.view), c = input.center;
  const w = Math.max(input.viewportWidth, 1), h = Math.max(input.viewportHeight, 1);
  let distance: number, zoom: number | undefined;
  if (input.projection === 'orthographic') {
    // Depth does not change the picture; stand well back so nothing sits behind the camera.
    distance = radius * 3 + 10;
    zoom = Math.min(w, h) / 2 / radius;
  } else {
    const vertical = (clamp(input.fov, FOV_RANGE[0], FOV_RANGE[1]) * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * (w / h));
    distance = radius / Math.sin(Math.min(vertical, horizontal) / 2);
  }
  const result: FramedView = { position: [c.x + dir[0] * distance, c.y + dir[1] * distance, c.z + dir[2] * distance], target: [c.x, c.y, c.z] };
  if (zoom !== undefined) result.zoom = zoom;
  return result;
}

// ---- Store ------------------------------------------------------------------------------------------------

const STORAGE_KEY = 'polyform_camera_view_v1';

export function sanitizeCameraView(input: unknown): CameraViewSettings {
  const r = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const fov = typeof r.fov === 'number' && Number.isFinite(r.fov) ? clamp(r.fov, FOV_RANGE[0], FOV_RANGE[1]) : DEFAULT_CAMERA_VIEW.fov;
  return { projection: r.projection === 'orthographic' ? 'orthographic' : 'perspective', fov };
}

function load(): CameraViewSettings {
  try { return sanitizeCameraView(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')); } catch { return { ...DEFAULT_CAMERA_VIEW }; }
}

let state: CameraViewSettings = load();
const listeners = new Set<() => void>();

export const cameraView = {
  get: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  set(patch: Partial<CameraViewSettings>) {
    const next = sanitizeCameraView({ ...state, ...patch });
    if (next.projection === state.projection && next.fov === state.fov) return;
    state = next;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
    listeners.forEach(l => l());
  },
};

export const useCameraView = () => useSyncExternalStore(cameraView.subscribe, cameraView.get, cameraView.get);
