/** Standalone development benchmark. Not imported by the editor or production build.
 * EZ-Tree source and textures retain their upstream MIT/CC0 licences in the scratch checkout.
 * Atlas is an experimental colour-only bake, not production vegetation.
 */
import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
// Optional research dependency; see docs/tree-source-benchmark-2026-10-01.md.
// Keeping the URL dynamic avoids making the application build depend on this scratch checkout.
const ezTreeUrl = "/.test-cache/ez-tree/src/lib/tree.js";
const { Tree } = await import(/* @vite-ignore */ ezTreeUrl);
import { loadPlantPrimitives } from "../../src/lib/graphics/plantAssets";
import { VegetationBatch } from "../../src/lib/graphics/VegetationBatch";
import { VegetationWind } from "../../src/lib/graphics/VegetationWind";
const ui = document.createElement("div");
ui.style.cssText = "position:fixed;top:8px;left:8px;z-index:2;background:white;padding:12px;font:13px sans-serif;max-width:740px";
ui.innerHTML = '<b>Tree comparison \u2014 shared batches, matched positions and height</b><p><label>Source <select id="source"><option value="original">Existing pine</option><option value="ez">EZ-Tree pine</option><option value="card">Existing pine atlas</option></select></label> <label>Placements (3 trunks each) <select id="count"><option>100</option><option>1000</option><option>1</option></select></label> <label>View <select id="view"><option value="far">Distant</option><option value="mid">Middle</option><option value="near">Close</option></select></label> <label><input type="checkbox" id="shadows"> Shadows</label> <button id="run">Record run</button></p><p id="status">Loading real tree meshes and textures\u2026</p><pre id="stats" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:68px;overflow:auto"></pre><pre id="history" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:68px;overflow:auto"></pre>';
document.body.append(ui);
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFShadowMap;
document.body.append(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#b9d3e5");
const camera = new T.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 3e3);
scene.add(new T.HemisphereLight("#ffffff", "#52633d", 1.8));
const sun = new T.DirectionalLight("#ffffff", 2);
sun.position.set(70, 100, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, far: 400 });
scene.add(sun);
const ground = new T.Mesh(new T.PlaneGeometry(1500, 1500), new T.MeshStandardMaterial({ color: "#708355", roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const wind = new VegetationWind();
wind.configure({ strength: 0.12, speed: 1.6 });
const textures = new T.TextureLoader();
const textureRoot = "/.test-cache/ez-tree/src/app/public/textures/";
const start = performance.now();
const originals = await Promise.all([0, 1, 2].map((l) => loadPlantPrimitives("ph_pine_tree_01", void 0, l)));
const originalLoadMs = performance.now() - start;
const maps = await Promise.all(["leaves/pine.png", "bark/Bark003_1K-JPG/Bark003_1K-JPG_Color.jpg", "bark/Bark003_1K-JPG/Bark003_1K-JPG_NormalGL.jpg", "bark/Bark003_1K-JPG/Bark003_1K-JPG_Roughness.jpg"].map((f) => textures.loadAsync(textureRoot + f)));
maps[0].colorSpace = maps[1].colorSpace = T.SRGBColorSpace;
const genStart = performance.now();
const tree = new Tree();
tree.loadPreset("Pine Medium");
tree.options.leaves.map = maps[0];
tree.options.bark.maps = { color: maps[1], normal: maps[2], roughness: maps[3] };
const height = Math.max(...originals[0].map((p) => new T.Box3().setFromBufferAttribute(p.geometry.getAttribute("position")).max.y));
const geometryLevels = [[], [], []];
for (let seed = 0; seed < 3; seed++) {
  tree.options.seed = 13977 + seed * 717;
  tree.generate();
  const bounds = new T.Box3().setFromObject(tree), target = height * (seed === 1 ? 0.75 : 1), scale = target / (bounds.max.y - bounds.min.y);
  const norm = new T.Matrix4().makeScale(scale, scale, scale);
  norm.setPosition((seed - 1) * 3, -bounds.min.y * scale, seed === 1 ? 0.3 : 0);
  [{}, Tree.defaultLODLevels[1].detail, Tree.defaultLODLevels[2].detail].forEach((d, i) => {
    const geo = tree.createGeometry(d);
    geometryLevels[i].push([geo.branches.applyMatrix4(norm), geo.leaves.applyMatrix4(norm)]);
  });
}
const ez = geometryLevels.map((level) => [0, 1].map((i) => {
  const source = i ? tree.leavesMesh.material : tree.branchesMesh.material;
  const mat = source.clone();
  mat.onBeforeCompile = () => {
  };
  mat.customProgramCacheKey = () => "";
  const geometry = mergeGeometries(level.map((g) => g[i]));
  level.forEach((g) => g[i].dispose());
  return { geometry, material: mat };
}));
const generationMs = performance.now() - genStart;
const bakeStart = performance.now();
const bakeScene = new T.Scene();
bakeScene.add(new T.HemisphereLight("#fff", "#52633d", 1.8));
const bakeSun = new T.DirectionalLight("#fff", 2);
bakeSun.position.set(70, 100, 40);
bakeScene.add(bakeSun);
originals[1].forEach((p) => bakeScene.add(new T.Mesh(p.geometry, p.material)));
const box = new T.Box3().setFromObject(bakeScene), w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 1.1, h = (box.max.y - box.min.y) * 1.05, cy = (box.max.y + box.min.y) / 2;
const atlas = new T.WebGLRenderTarget(2048, 1024, { depthBuffer: true });
const bakeCam = new T.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, 500);
renderer.setRenderTarget(atlas);
renderer.setClearColor(0, 0);
renderer.clear();
atlas.scissorTest = true;
for (let i = 0; i < 8; i++) {
  const angle = i * Math.PI / 4;
  bakeCam.position.set(Math.sin(angle) * 100, cy, Math.cos(angle) * 100);
  bakeCam.lookAt(0, cy, 0);
  atlas.viewport.set(i % 4 * 512, Math.floor(i / 4) * 512, 512, 512);
  atlas.scissor.copy(atlas.viewport);
  renderer.setRenderTarget(atlas);
  renderer.render(bakeScene, bakeCam);
}
renderer.setRenderTarget(null);
renderer.setClearColor("#b9d3e5", 1);
const cardGeo = new T.PlaneGeometry(w, h);
cardGeo.translate(0, cy, 0);
const cardMat = new T.MeshStandardMaterial({ map: atlas.texture, alphaTest: 0.3, side: T.DoubleSide, roughness: 1, emissive: "#ffffff", emissiveMap: atlas.texture, color: "#000000", name: "baked leaves" });
cardMat.onBeforeCompile = (s) => {
  s.vertexShader = "varying float atlasView;\n" + s.vertexShader;
  s.fragmentShader = "varying float atlasView;\n" + s.fragmentShader;
  s.vertexShader = s.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
 mat4 world = modelMatrix * instanceMatrix;
 vec3 centre = (world * vec4(0.,0.,0.,1.)).xyz;
 vec3 toCamera=normalize(vec3(cameraPosition.x-centre.x,0.,cameraPosition.z-centre.z));
 float yaw=atan(world[2].x,world[2].z);
 atlasView=mod(floor((atan(toCamera.x,toCamera.z)-yaw)/0.7853981634+0.5)+16.,8.);
 vec3 right=vec3(toCamera.z,0.,-toCamera.x);
 transformed = (inverse(world)*vec4(centre+right*transformed.x+vec3(0.,transformed.y,0.),1.)).xyz;
 `);
  s.fragmentShader = s.fragmentShader.replace("#include <map_fragment>", `vec2 atlasUV=(vMapUv+vec2(mod(atlasView,4.),floor(atlasView/4.)))/vec2(4.,2.);
 vec4 sampledDiffuseColor=texture2D(map,atlasUV);diffuseColor*=sampledDiffuseColor;`).replace("#include <emissivemap_fragment>", `totalEmissiveRadiance*=texture2D(emissiveMap,atlasUV).rgb;`);
};
cardMat.customProgramCacheKey = () => "tree-atlas-experiment-v1";
const bakeMs = performance.now() - bakeStart;
const cards = [{ geometry: cardGeo, material: cardMat }];
let batches = [], frames = 0, pending = [], samples = [], cpu = [], history = [];
const ctx = renderer.getContext(), ext = ctx.getExtension("EXT_disjoint_timer_query_webgl2");
const select = (id) => document.getElementById(id);
const shadow = () => document.getElementById("shadows").checked;
const metric = (assets) => ({ triangles: assets.reduce((s, p) => s + (p.geometry.index?.count ?? p.geometry.attributes.position.count) / 3, 0), geometryBytes: assets.reduce((s, p) => s + Object.values(p.geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0) + (p.geometry.index?.array.byteLength ?? 0), 0) });
const metadata = { benchmarkVersion: 2, trunksPerPlacement: 3, height, originalLoadMs, generationMs, bakeMs, original: originals.map(metric), ez: ez.map(metric), card: metric(cards), atlasBytesWithMipmaps: 2048 * 1024 * 4 * 4 / 3 };
function rebuild() {
  document.getElementById("run").disabled = true;
  document.getElementById("stats").textContent = "Warming up…";
  batches.forEach((b) => b.dispose());
  batches = [];
  samples = [];
  cpu = [];
  frames = 0;
  pending.forEach((q) => ctx.deleteQuery(q));
  pending = [];
  const source = select("source").value, view = select("view").value, n = Number(select("count").value), lod = view === "far" ? 2 : view === "mid" ? 1 : 0;
  const assets = source === "ez" ? ez[lod] : source === "card" ? cards : originals[lod];
  const shadowAssets = source === "ez" ? ez[Math.min(2, lod + 1)] : originals[Math.min(2, lod + 1)];
  const side = Math.ceil(Math.sqrt(n)), spacing = 18, width = (side - 1) * spacing;
  camera.position.set(0, view === "near" ? height * 0.5 : view === "mid" ? 40 : 140, view === "near" ? width / 2 + 28 : view === "mid" ? width / 2 + 130 : width / 2 + 580);
  camera.lookAt(0, height * 0.4, 0);
  camera.updateMatrixWorld(true);
  const cells = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const x = (i % side - (side - 1) / 2) * spacing, z = (Math.floor(i / side) - (side - 1) / 2) * spacing;
    const key = `${Math.floor(x / 48)}/${Math.floor(z / 48)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push({ id: String(i), position: new T.Vector3(x, 0, z), rotation: new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), i * 2.399963 % (Math.PI * 2)) });
  }
  for (const placements of cells.values()) {
    for (const p of assets) {
      const b = new VegetationBatch(p.geometry, p.material, wind, placements.length);
      if (source === "card") {
        const hook = b.mesh.material.onBeforeCompile;
        const key = b.mesh.material.customProgramCacheKey();
        b.mesh.material.onBeforeCompile = (s, r) => {
          cardMat.onBeforeCompile(s, r);
          hook(s, r);
        };
        b.mesh.material.customProgramCacheKey = () => key + "atlas";
      }
      b.setInstances(placements);
      b.mesh.castShadow = false;
      b.mesh.receiveShadow = shadow() && source !== "card";
      b.init(scene);
      batches.push(b);
    }
    if (shadow() && lod < 2 && source !== "card") {
      for (const p of shadowAssets) {
        const b = new VegetationBatch(p.geometry, p.material, wind, placements.length);
        b.setInstances(placements);
        b.mesh.material.colorWrite = false;
        b.mesh.material.depthWrite = false;
        b.mesh.castShadow = true;
        b.mesh.receiveShadow = false;
        b.init(scene);
        batches.push(b);
      }
    }
  }
  document.getElementById("status").textContent = `${source} / ${n} placements / ${view} / height ${height.toFixed(2)}m / ${shadow() ? "shadows" : "no shadows"}`;
}
["source", "count", "view", "shadows"].forEach((id) => document.getElementById(id).addEventListener("change", rebuild));
let report;
const recordButton = document.getElementById("run");
document.getElementById("run").onclick = () => {
  if (!report || report.cpuSamples < 240 || (ext && report.samples < 240)) return;
  history.push(report);
  document.getElementById("history").textContent = JSON.stringify(history);
};
rebuild();
renderer.setAnimationLoop((t) => {
  wind.setTime(t / 1e3);
  if (ext) {
    pending = pending.filter((q2) => {
      if (!ctx.getQueryParameter(q2, ctx.QUERY_RESULT_AVAILABLE)) return true;
      if (!ctx.getParameter(ext.GPU_DISJOINT_EXT) && frames > 120) samples.push(ctx.getQueryParameter(q2, ctx.QUERY_RESULT) / 1e6);
      ctx.deleteQuery(q2);
      return false;
    });
  }
  const q = ext && pending.length < 4 ? ctx.createQuery() : null;
  const before = performance.now();
  renderer.info.autoReset = false;
  renderer.info.reset();
  if (q) ctx.beginQuery(ext.TIME_ELAPSED_EXT, q);
  renderer.render(scene, camera);
  if (q) {
    ctx.endQuery(ext.TIME_ELAPSED_EXT);
    pending.push(q);
  }
  if (frames > 120) cpu.push(performance.now() - before);
  if (samples.length > 480) samples.splice(0, samples.length - 480);
  if (cpu.length > 480) cpu.splice(0, cpu.length - 480);
  frames++;
  if (frames % 30 === 0) {
    const a = samples.slice(-240).sort((a2, b) => a2 - b), c = cpu.slice(-240).sort((a2, b) => a2 - b);
    report = { source: select("source").value, count: Number(select("count").value), view: select("view").value, shadows: shadow(), triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.calls, gpuMedianMs: a[Math.floor(a.length * 0.5)] ?? null, gpuP95Ms: a[Math.floor(a.length * 0.95)] ?? null, cpuMedianMs: c[Math.floor(c.length * 0.5)] ?? null, samples: a.length, cpuSamples: c.length, gpuTimingAvailable: Boolean(ext), resolution: [renderer.domElement.width, renderer.domElement.height], camera: camera.position.toArray(), metadata };
    recordButton.disabled = c.length < 240 || (ext && a.length < 240);
    document.getElementById("stats").textContent = JSON.stringify({ ...report, metadata: void 0 });
  }
});

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  rebuild();
});
window.addEventListener('pagehide', () => {
  renderer.setAnimationLoop(null);
  batches.forEach(batch => batch.dispose());
  pending.forEach(query => ctx.deleteQuery(query));
  atlas.dispose();
  [...ez.flat(), ...cards].forEach(p => { p.geometry.dispose(); p.material.dispose(); });
  maps.forEach(map => map.dispose());
  ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
}, {once: true});
