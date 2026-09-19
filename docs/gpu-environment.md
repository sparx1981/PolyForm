# GPU environment modules

These modules target PolyForm's Three.js r183 WebGLRenderer and React Three Fiber render loop. Import from `src/lib/graphics/index.ts`. They have no store, editor, or global scene dependency.

## What is integrated

The modules now run inside the existing editor, with project settings persisted through local `.polyform` files, cloud save/autosave, Save As and shared-model loading. Legacy projects receive safe defaults (weather off). The lower-level classes remain usable independently.

- **Visualisation → Weather:** rain, snow, clouds and mist toggles; density, opacity, size, colour and wind. Clouds also have altitude, thickness, puffy/wispy/layered types and a Fast/Volumetric selector. Mist has independent altitude, thickness and density.
- **Landscapes → vegetation/plant category → Vegetation rendering:** batching and wind controls. Repeated eligible plants batch automatically into 48 m cells; selected/grouped plants and modelling tools retain individual meshes. Instance clicks resolve to the original shape IDs. Geometry and material templates are shared by both paths.
- **Materials → Surface depth:** select a supported single-material object, upload a height map and optionally a matching normal map, then set amount, offset and detail. Height textures are embedded (up to 512 px and 450 KB per map); large collections still need to respect the existing cloud document size limit. Refinement is render-only and bounded to 98,304 vertices; source modelling geometry and face IDs are retained. Disable depth or remove the map to restore the base surface.

`PlantModelMesh.tsx` uses shared wind uniforms per plant instead of traversing models every frame. Visible, directional/spot shadow, and point shadow passes use the same deformation. Imported GLTF materials retain their PBR textures and alpha cutouts. Procedural species also animate. Cached asset templates live for the application lifetime; private materials and batches are disposed on replacement/unmount. FBX edits use clones, and grass uses alpha testing with opaque depth writes.

The existing species picker automatically includes **Norway spruce, flowering cherry, creeping juniper, and rosemary** through `plantLibrary.ts` and `landscapeGeometry.ts`. These are new procedural geometries; no external assets or licences are needed. Existing default species are unchanged.

Weather is a standalone new component with its own uniforms and scene objects, and has no dependency on other environment features. `SceneWeather`, `InstancedVegetation` and `SurfaceDepthBinding` are the editor adapters; the controls mutate serializable `graphicsSettings` or per-shape depth fields.

## Instanced vegetation

```ts
import * as THREE from 'three';
import { VegetationBatch, VegetationWind } from './lib/graphics';
import { createTreeGeometry } from './lib/landscapeGeometry';

const wind = new VegetationWind(0.4); // maximum local-space sway amplitude budget
const geometry = createTreeGeometry('norway_spruce');
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const batch = new VegetationBatch(geometry, material, wind, 2048).init(scene);
// Batch owns clones; caller retains ownership of these inputs.
geometry.dispose();
material.dispose();

batch.setInstances(placements.map((plant, i) => ({
  id: plant.id,
  position: new THREE.Vector3(...plant.position),
  rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.39996),
  scale: new THREE.Vector3().setScalar(0.8 + (i % 11) * 0.04),
  color: new THREE.Color().setHSL(0.28, 0.1, 0.85), // optional multiplicative tint
})));

// Render loop: call ONCE for the shared controller, regardless of batch count.
wind.update(deltaTime);
// UI changes:
wind.configure({ strength: 0.2, speed: 1.8, direction: new THREE.Vector2(1, 0.4) });

// Raycaster/R3F gives instanceId. Route through the batch to your shape selection.
const shapeId = batch.idAt(intersection.instanceId!);
// Cleanup:
batch.dispose();
```

Partition by species, model variation, geometry/material pair, and spatial cell (e.g. 32–64 m). Each batch uses one draw per geometry group per visible/shadow pass, rather than one draw per plant. Cells allow useful frustum culling; one giant world-spanning batch does not. Size each capacity for its cell. `setInstances()` uploads matrices/colors and computes conservative bounds only when placements change. Empty batches are hidden. Positive non-uniform scales and quaternion rotations are supported; mirrored/zero scales are rejected. Ground-up, Y-axis models and predominantly yaw rotations give the intended wind direction.

For imported GLTF/FBX, make one batch per static mesh/material primitive; bake that primitive's hierarchy transform into a private geometry before batching (`clone().applyMatrix4(relativeMatrix)`). All primitives of a plant use the same placement IDs/transforms. Split multi-material meshes into primitives if necessary. Preserve texture/alpha-test settings in each source material. Skinned/morph-animated assets and prepatched materials are outside this static batch contract. Textures remain caller-owned; batch disposal does not dispose shared textures.

`VegetationWind.attachMesh(mesh, baseHeight, bendHeight)` also works on a private, single-material mesh; retain its returned cleanup. `attach(material, baseHeight, bendHeight)` is the lower-level `onBeforeCompile` injection. The controller composes with existing hooks and supplies a stable program cache key. Its two-frequency spatially phased bend is root-anchored; normals and tangents follow the bend analytically. Deformation is shared by shadow shaders, including alpha cutouts. Ordinary editor meshes disable CPU culling conservatively; batches use expanded bounds. Call `configure`, rather than writing uniforms directly, so sway remains inside the bounding budget.

Instanced raycasting tests the undeformed CPU geometry, so selecting a moving leaf can differ slightly from its displayed position. Standard automatic shadow updates must be enabled if animated shadows are wanted. Instancing reduces draw calls, not triangle count: use simplified geometry/LODs for distant planting and limit shadow-casting cells. This module does not generate automatic LODs.

## Surface depth on existing PBR materials

```ts
import { SurfaceDepth } from './lib/graphics';

heightTexture.colorSpace = THREE.NoColorSpace; // data, not sRGB
// mesh.material is an existing private MeshStandardMaterial or MeshPhysicalMaterial.
mesh.material.normalMap = matchingNormalTexture;
const relief = new SurfaceDepth(heightTexture, 0.035, -0.0175, 0.1).init(mesh);
// scale, bias in mesh-local units; white=high, black=low
relief.configure(0.05, -0.025);
// No update() required. Release before disposing mesh/material:
relief.dispose();
```

This uses **optimized GPU vertex displacement**, not POM. An `onBeforeCompile` patch replaces the displacement chunk with one clamped height lookup per vertex and shared live scale/bias uniforms. Existing Standard/Physical lighting, roughness, metalness, normal mapping and UV transforms remain in Three.js's pipeline. Matching depth/distance patches generate real displaced shadows, including point lights. Height texture channels/offset/repeat use Three.js's normal displacement-map UV support. The geometry is cloned once to expand bounds; its CPU positions never change. Original geometry/material settings are restored on disposal. Attach once per private mesh/material, after wind when using both, and dispose depth before wind/batch cleanup. Reattach depth if you replace instance placements while it is active so restoration bounds remain valid.

Supply enough vertices for the **coarse relief**: typically a 32×32 or 64×64 surface tile, or a low-resolution subdivided bark cylinder. The lower-level class does not subdivide geometry; the editor adapter performs bounded subdivision when enabled or when detail changes. A two-triangle plane cannot show detailed displacement. Keep fine bark pores/brick grains in a matching normal map; displacement does not reconstruct normals. Adjust normal-map strength when changing depth scale substantially. Avoid large amplitudes at hard-normal/UV seams because vertices can separate. CPU raycasts/collision shapes remain undisplaced. The current editor UI excludes bevelled, multi-material and plant assets; custom meshes must have UVs and normals.

This choice avoids a multi-step fragment ray march on large screen-covering terrain while providing actual silhouette/shadow depth. POM would be preferable for strong apparent microrelief on an unchanged two-triangle plane, but would require additional shadow/self-occlusion decisions. Reference: [Three.js MeshStandardMaterial displacement documentation](https://threejs.org/docs/pages/MeshStandardMaterial.html).

## Independent weather

```ts
import { WeatherSystem } from './lib/graphics';

const weather = new WeatherSystem({
  seed: 42,
  bounds: new THREE.Vector3(80, 40, 80),
  wind: new THREE.Vector2(1.2, 0.3), // x/z metres per second
  layers: {
    rain: { count: 12000, size: 0.3, speed: 14, gravity: 9.81, opacity: 0.45 },
    snow: { count: 4000, size: 0.12, speed: 0.8, gravity: 0.3, turbulence: 0.7 },
    clouds: { count: 100, size: 14, opacity: 0.13 },
    mist: { count: 180, size: 7, opacity: 0.065 },
  },
}).init(scene, renderer);
weather.setCenter(new THREE.Vector3(0, 0, 0)); // x/z center and vertical base

// Render loop: O(1), updates a shared time scalar only.
weather.update(deltaTime);
// UI controls:
weather.configureLayer('rain', { opacity: 0.2, gravity: 4, turbulence: 0.08 });
weather.configureLayer('clouds', { density: 0.8, altitude: 60, thickness: 12, cloudType: 'cirrus' });
weather.configureLayer('mist', { density: 0.3, altitude: 1, thickness: 2 });
weather.setCloudMode('volumetric'); // or 'fast'
weather.setEnabled('snow', false);
weather.setWind(new THREE.Vector2(2, -1));
// After renderer size/pixel-ratio changes:
weather.resize(renderer);
// Editor follows camera x/z only; ground and cloud altitude stay world-anchored.
// Cleanup:
weather.dispose();
```

Only explicitly requested layers are created. Each layer is one `THREE.Points`/`BufferGeometry` draw. Static seeded attributes are allocated on creation/count changes. Gravity uses analytic `v*t + 0.5*g*t²`, with lifetime solved from volume height; modulo time respawns precipitation at the top. Precipitation spans base Y to base Y + bounds height; cloud/mist altitude is relative to base Y. Drift, wrapping, turbulence and boundary fades run entirely in the vertex shader. No particle loop, transform upload, compute readback or CPU respawn runs per frame. Count changes intentionally reallocate geometry; density changes only the draw range, and other controls update uniforms without rebuilding.

Size is world-space sprite diameter; the module handles perspective and orthographic cameras, drawing-buffer resolution, and the GPU point-size limit. Opacity is 0–1; speed/gravity/turbulence are nonnegative; count is an integer from 0–200,000 per layer (a guardrail, not a recommended density). Changing speed, gravity or bounds recalculates analytic trajectories and can cause a visible jump. Pausing means omitting `update`; hiding a layer keeps its simulated time advancing. Keep volume transforms unscaled and unrotated for values to remain world units.

Fast clouds and mist are inexpensive tinted billow sprites. Volumetric mode adds a 16-step density ray march through each camera-facing cloudlet and approximate directional shading: it is not a world-space full-sky volume and does not cast cloud shadows. Both modes expose the same type/colour/density controls. Alpha blending does not sort individual particles; keep opacities low. Opaque scene geometry depth-tests correctly, but intersections have no depth-texture softening. There is no ground/roof collision, accumulation, or wet-material coupling. Very large nearby sprites are capped by hardware; for huge cloud banks use more smaller billows or a future billboard-quad implementation. Transparency overdraw, rather than CPU motion, is the main weather performance cost; start with 5–15k rain and fewer than 200 cloud/mist sprites. Volumetric is deliberately opt-in.

## React Three Fiber integration

Create controllers in an effect, add them to `useThree().scene`, and return their `dispose()` cleanup. Store controllers in refs, and use one `useFrame((_, dt) => { windRef.current?.update(dt); weatherRef.current?.update(dt); })` at the landscape level. Use a separate effect on viewport size/DPR for `weather.resize(gl)`. Route controls to `configureLayer()`/`configure()` and do not allocate controllers during render. Existing `PlantModelMesh` already owns its own wind clock; do not additionally update that clock.

## Preview and checks

Run `npm run dev` and open `/examples/gpu-environment.html` for 1,024 instanced trees in 16 cells, all four weather layers, displacement, live controls, and perspective/orthographic switching. This is a development example; it is not included in the production entry point.

`/examples/editor-graphics.html` exercises the actual provider, viewport and panels with disposable local fixture shapes, without signing in or writing to the cloud. It only renders in development.

```sh
npx tsc -p tsconfig.graphics.json --noEmit
npx vitest run src/lib/graphics src/AppContext.test.tsx
npm run build
```

Tests cover buffer immutability during updates, control validation, bounds, IDs/capacity, hook composition, shared visible/shadow uniforms, cleanup, and new species geometry. Browser verification exercises actual shader compilation and directional/point shadow rendering; it is not an FPS benchmark. The repository-wide typecheck currently reports an unrelated `Effects.tsx` particle-type mismatch. The checked-in npm lockfile also predates several declared dependencies; validation used `npm install --ignore-scripts --package-lock=false` without editing it.
