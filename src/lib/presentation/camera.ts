import * as THREE from 'three';
import { mainSceneRef } from '../../components/Viewport';
import { canvasRef } from './recorder';
import { easeInOutCubic } from './classify';

/** The viewport's orbit controls (camera + target), once the 3D view is up. */
export function orbitControls(): { object: THREE.Camera; target: THREE.Vector3; update: () => void; enabled: boolean } | null {
  return (mainSceneRef.current?.userData?.controls as any) ?? null;
}

/** Where the camera is and what it looks at, rounded to the centimetre. */
export function currentView(): { position: [number, number, number]; target: [number, number, number] } | null {
  const c = orbitControls();
  if (!c) return null;
  const r = (v: THREE.Vector3) => v.toArray().map(n => Math.round(n * 100) / 100) as [number, number, number];
  return { position: r(c.object.position), target: r(c.target) };
}

let flight = 0;

/**
 * Glides the camera to a view, swinging round the target rather than cutting through the model.
 * Resolves when it arrives (or when another flight takes over).
 */
export function flyTo(position: [number, number, number], target: [number, number, number], seconds = 1.6): Promise<void> {
  const c = orbitControls();
  if (!c) return Promise.resolve();
  const id = ++flight;
  const p0 = c.object.position.clone(), t0 = c.target.clone();
  const p1 = new THREE.Vector3(...position), t1 = new THREE.Vector3(...target);
  // Interpolate in spherical coordinates about the moving target, so the camera arcs.
  const s0 = new THREE.Spherical().setFromVector3(p0.clone().sub(t0));
  const s1 = new THREE.Spherical().setFromVector3(p1.clone().sub(t1));
  let dTheta = s1.theta - s0.theta;
  if (dTheta > Math.PI) dTheta -= Math.PI * 2;
  if (dTheta < -Math.PI) dTheta += Math.PI * 2;
  const start = performance.now();
  return new Promise(resolve => {
    const step = () => {
      if (id !== flight) return resolve();
      const k = Math.min(1, (performance.now() - start) / (seconds * 1000));
      const e = easeInOutCubic(k);
      const t = t0.clone().lerp(t1, e);
      const sph = new THREE.Spherical(
        s0.radius + (s1.radius - s0.radius) * e,
        s0.phi + (s1.phi - s0.phi) * e,
        s0.theta + dTheta * e,
      );
      c.object.position.copy(t).add(new THREE.Vector3().setFromSpherical(sph));
      c.target.copy(t);
      c.update();
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Stops any camera flight in progress (the user grabbed the view). */
export function cancelFlight() {
  flight++;
}

/**
 * Whether a ray hit should count as a surface the viewer sees. The depth-of-field pass only knows what the depth
 * buffer holds, so a pick must ignore everything that never writes to it: invisible meshes, glass and haze
 * (transparent without depth writes), the inside of the sky dome, and helpers. Doors and windows are multi-material,
 * so the material is the one that was actually hit.
 */
export function isSeenSurface(hit: THREE.Intersection): boolean {
  const mesh = hit.object as THREE.Mesh;
  if (!mesh.isMesh) return false;
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
    if (!o.visible || o.userData?.presentationAux || o.userData?.isGrass || o.userData?.isPreview) return false;
  }
  const material = Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material;
  if (!material) return true;
  if (material.visible === false || material.colorWrite === false || material.depthWrite === false) return false;
  if (material.transparent && material.opacity < 0.05) return false;
  return material.side !== THREE.BackSide;
}

/** The point on the model under a screen position, or null (ignores presentation helpers). */
export function pickPoint(clientX: number, clientY: number): [number, number, number] | null {
  const scene = mainSceneRef.current, canvas = canvasRef.current, c = orbitControls();
  if (!scene || !canvas || !c) return null;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, c.object);
  const hit = ray.intersectObjects(scene.children, true).find(isSeenSurface);
  return hit ? hit.point.toArray().map(n => Math.round(n * 1000) / 1000) as [number, number, number] : null;
}

/** Screen position of a world point in the 3D view, or null when it's behind the camera. */
export function project(point: [number, number, number]): { x: number; y: number } | null {
  const canvas = canvasRef.current, c = orbitControls();
  if (!canvas || !c) return null;
  const v = new THREE.Vector3(...point).project(c.object);
  if (v.z > 1 || v.z < -1) return null;
  const r = canvas.getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}

/** True when something solid is between the camera and the point. */
export function hidden(point: [number, number, number]): boolean {
  const scene = mainSceneRef.current, c = orbitControls();
  if (!scene || !c) return false;
  const p = new THREE.Vector3(...point);
  const from = c.object.position.clone();
  const dir = p.clone().sub(from);
  const dist = dir.length();
  const ray = new THREE.Raycaster(from, dir.normalize(), 0.01, dist - 0.08);
  for (const h of ray.intersectObjects(scene.children, true)) {
    let o: THREE.Object3D | null = h.object, skip = false;
    for (; o; o = o.parent) if (!o.visible || o.userData?.presentationAux || o.userData?.isGrass) { skip = true; break; }
    const m = (h.object as THREE.Mesh).material as THREE.Material | undefined;
    if (skip || !(h.object as THREE.Mesh).isMesh || (m && (m.visible === false || m.transparent))) continue;
    return true;
  }
  return false;
}

/** Set while a tool is waiting for a click on the model (placing a label or a comment pin). */
export const pickMode = { active: false };

/** The shape under a screen position: its root object, id and the mesh hit. */
export function pickShape(clientX: number, clientY: number): { root: THREE.Object3D; id: string; mesh: THREE.Mesh } | null {
  const scene = mainSceneRef.current, canvas = canvasRef.current, c = orbitControls();
  if (!scene || !canvas || !c) return null;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, c.object);
  for (const h of ray.intersectObjects(scene.children, true)) {
    const mesh = h.object as THREE.Mesh;
    if (!mesh.isMesh) continue;
    const m = mesh.material as THREE.Material | undefined;
    if (m && !Array.isArray(m) && (m.visible === false || (m.transparent && m.opacity < 0.05))) continue;
    let root: THREE.Object3D | null = null, skip = false;
    for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
      if (!o.visible || o.userData?.isGrass) { skip = true; break; }
      if (o.userData?.isShape) root = o;
    }
    if (skip) continue;
    // A door leaf split off by the door opener is a presentation helper under the door's mesh.
    if (!root) continue;
    return { root, id: String(root.userData.id), mesh };
  }
  return null;
}
