import * as THREE from 'three';

/**
 * One shared offscreen WebGL context, reused to snapshot every geometry thumbnail in
 * the app (lamp styles, and anything else that adopts this) as a static PNG data URL.
 *
 * The alternative - a live <Canvas> per thumbnail, which is what LampStyleThumbnail
 * used before this - creates its own WebGL context per item. A picker grid with a
 * whole style library's worth of thumbnails open at once (the lamp picker went from
 * 4 to 19 styles across two tabs this session) can exhaust the browser's WebGL
 * context budget outright; when that happens the browser doesn't just fail the new
 * canvas, it force-loses an EXISTING context to make room, which can and did take
 * down the main viewport's own context - the app "crashes" from the user's
 * perspective, but the mechanism is real WebGL context loss, not a render exception.
 * Rendering everything through one persistent context keeps the total fixed at one,
 * however large the library grows.
 */
let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.PerspectiveCamera | undefined;
let mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | undefined;

function ensureRenderer() {
  if (renderer) return;
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(2, 3, 2);
  scene.add(dir);
  mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 }));
  scene.add(mesh);
}

/**
 * Renders `geometry` once from a fixed 3/4 angle, framed by its own bounding sphere
 * (same framing convention as the live-Canvas thumbnails elsewhere in the app), and
 * returns a PNG data URL. The caller keeps ownership of `geometry` and disposes it as
 * usual; this only reads from it during the synchronous render call.
 */
export function renderGeometryThumbnail(geometry: THREE.BufferGeometry, sizePx = 192): string {
  if (typeof document === 'undefined') return '';
  ensureRenderer();

  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius || 1;
  const center = geometry.boundingSphere?.center || new THREE.Vector3();
  const dist = Math.max(radius, 0.01) * 2.6;

  mesh!.geometry = geometry;
  mesh!.position.set(-center.x, -center.y, -center.z);
  camera!.position.set(dist * 0.7, dist * 0.7, dist * 0.7);
  camera!.aspect = 1;
  camera!.lookAt(0, 0, 0);
  camera!.updateProjectionMatrix();

  renderer!.setPixelRatio(1);
  renderer!.setSize(sizePx, sizePx, false);
  renderer!.render(scene!, camera!);
  return renderer!.domElement.toDataURL('image/png');
}
