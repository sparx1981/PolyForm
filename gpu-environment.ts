import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VegetationBatch, VegetationWind, SurfaceDepth, WeatherSystem, type WeatherKind } from './src/lib/graphics';
import { createTreeGeometry, createBushGeometry } from './src/lib/landscapeGeometry';

const status = document.querySelector('#status')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.append(renderer.domElement);
const failures: string[] = [];
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  failures.push([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'));
  status.textContent = failures.join('\n');
};
const scene = new THREE.Scene(); scene.background = new THREE.Color('#607789');
const perspective = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400);
const orthographic = new THREE.OrthographicCamera(-22, 22, 16, -16, 0.1, 400);
perspective.position.set(17, 11, 24); orthographic.position.copy(perspective.position);
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspective;
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 3, 0); controls.update();
scene.add(new THREE.HemisphereLight('#d8edff', '#425532', 2));
const sun = new THREE.DirectionalLight('#fff0da', 3); sun.position.set(15, 30, 10); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, far: 90 });
scene.add(sun);
const point = new THREE.PointLight('#ffdbb5', 45, 28); point.position.set(-2, 5, 3); point.castShadow = true;
point.shadow.mapSize.set(256, 256); scene.add(point);
const floorGeometry = new THREE.PlaneGeometry(240, 240); floorGeometry.rotateX(-Math.PI / 2);
const floor = new THREE.Mesh(floorGeometry, new THREE.MeshStandardMaterial({ color: '#687354', roughness: 1 }));
floor.receiveShadow = true; scene.add(floor);
const wind = new VegetationWind();
const spruce = createTreeGeometry('norway_spruce');
const plantMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const batches: VegetationBatch[] = [];
// Cells keep frustum culling useful. One instanced draw per cell/material/pass.
for (let cell = 0; cell < 16; cell++) {
  const batch = new VegetationBatch(spruce, plantMaterial, wind, 64).init(scene);
  const placements = Array.from({ length: 64 }, (_, i) => {
    const x = (cell % 4) * 48 + (i % 8) * 6 - 96;
    const z = Math.floor(cell / 4) * 48 + Math.floor(i / 8) * 6 - 130;
    const scale = 0.5 + ((i * 17 + cell * 3) % 31) / 62;
    return { id: `${cell}-${i}`, position: new THREE.Vector3(x, 0, z), scale: new THREE.Vector3(scale, scale, scale),
      rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.39996) };
  });
  batch.setInstances(placements); batches.push(batch);
}
spruce.dispose(); plantMaterial.dispose();
for (const [i, id] of ['flowering_cherry', 'creeping_juniper', 'rosemary_shrub'].entries()) {
  const geom = i === 0 ? createTreeGeometry(id) : createBushGeometry(id);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const batch = new VegetationBatch(geom, mat, wind, 1).init(scene);
  batch.setInstances([{ id, position: new THREE.Vector3(-6 + i * 5, 0, 2) }]); batches.push(batch);
  geom.dispose(); mat.dispose();
}
// Height and matching tangent-space normals are generated once for the demo only.
const width = 128, heights = new Uint8Array(width * width * 4), normals = new Uint8Array(width * width * 4);
function height(x: number, y: number) { return 0.5 + 0.45 * Math.sin(x * Math.PI * 8 / width) * Math.sin(y * Math.PI * 8 / width); }
for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
  const index = (y * width + x) * 4;
  const h = height(x, y) * 255;
  heights.set([h, h, h, 255], index);
  const n = new THREE.Vector3(-(height(x + 1, y) - height(x - 1, y)) * 0.06 * width / 12,
    -(height(x, y + 1) - height(x, y - 1)) * 0.06 * width / 12, 1).normalize();
  normals.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], index);
}
const heightMap = new THREE.DataTexture(heights, width, width); heightMap.needsUpdate = true;
const normalMap = new THREE.DataTexture(normals, width, width); normalMap.needsUpdate = true;
const tileGeometry = new THREE.PlaneGeometry(6, 6, 48, 48);
const tile = new THREE.Mesh(tileGeometry, new THREE.MeshPhysicalMaterial({ color: '#c18752', roughness: 0.5, normalMap }));
tile.rotation.x = -Math.PI / 2; tile.position.set(0, 0.15, 7); tile.castShadow = tile.receiveShadow = true; scene.add(tile);
const depth = new SurfaceDepth(heightMap, 0.06, -0.03).init(tile);
const weather = new WeatherSystem({ bounds: new THREE.Vector3(65, 30, 65), layers: {
  rain: { count: 6000 }, snow: { count: 2000 }, clouds: {}, mist: {} } }).init(scene, renderer);
weather.setCenter(new THREE.Vector3(0, 14, 0));
for (const kind of ['rain', 'snow', 'clouds', 'mist'] as WeatherKind[]) {
  document.querySelector<HTMLInputElement>(`#${kind}`)!.onchange = event => weather.setEnabled(kind, (event.target as HTMLInputElement).checked);
}
document.querySelector<HTMLInputElement>('#wind')!.oninput = event => wind.configure({ strength: +(event.target as HTMLInputElement).value });
document.querySelector<HTMLInputElement>('#depth')!.oninput = event => {
  const scale = +(event.target as HTMLInputElement).value; depth.configure(scale, -scale / 2);
  tile.material.normalScale.setScalar(scale / 0.06);
};
document.querySelector<HTMLButtonElement>('#camera')!.onclick = () => {
  const previous = camera;
  camera = camera === perspective ? orthographic : perspective;
  camera.position.copy(previous.position); camera.quaternion.copy(previous.quaternion);
  controls.object = camera; resize(); controls.update();
};
function resize() {
  renderer.setSize(innerWidth, innerHeight); perspective.aspect = innerWidth / innerHeight; perspective.updateProjectionMatrix();
  orthographic.left = -16 * innerWidth / innerHeight; orthographic.right = -orthographic.left; orthographic.updateProjectionMatrix();
  weather.resize(renderer);
}
addEventListener('resize', resize);
let previousTime: number | undefined, frames = 0;
renderer.setAnimationLoop(now => {
  const delta = previousTime === undefined ? 0 : Math.max(0, Math.min(0.1, (now - previousTime) / 1000)); previousTime = now;
  wind.update(delta); weather.update(delta); renderer.render(scene, camera); frames++;
  if (!failures.length && frames % 60 === 0) status.textContent = `GPU programs compiled · ${renderer.info.programs?.length} programs · ${renderer.info.render.calls} draws in visible pass · ${camera.type}`;
});
addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null); controls.dispose(); weather.dispose(); depth.dispose();
  batches.forEach(batch => batch.dispose()); heightMap.dispose(); normalMap.dispose();
  tileGeometry.dispose(); tile.material.dispose(); floorGeometry.dispose(); floor.material.dispose(); renderer.dispose();
}, { once: true });
