# GPU environment modules

These modules target PolyForm's Three.js r183 WebGLRenderer and React Three Fiber render loop. Import from `src/lib/graphics/index.ts`. They have no store, editor, or global scene dependency.

## What is integrated

`PlantModelMesh.tsx` now uses shared wind uniforms per plant instead of traversing imported models every frame. Visible, directional/spot shadow, and point shadow passes use the same deformation. Imported GLTF materials retain their PBR textures and alpha cutouts. Procedural fallbacks also animate; geometry is memoized and released. Loader callbacks are cancelled on replacement/unmount, private materials are disposed, FBX geometry edits use clones, and grass uses alpha testing with opaque depth writes.

The existing species picker automatically includes **Norway spruce, flowering cherry, creeping juniper, and rosemary** through `plantLibrary.ts` and `landscapeGeometry.ts`. These are new procedural geometries; no external assets or licences are needed. Existing default species are unchanged.

Instanced rendering, surface displacement, and weather are explicit opt-in modules. Existing individually editable plant objects are not automatically removed or converted: use batches for scattered/repeated planting. Weather is a standalone new component with its own uniforms and scene objects, and has no dependency on other environment features.

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

Supply enough vertices for the **coarse relief**: typically a 32×32 or 64×64 surface tile, or a low-resolution subdivided bark cylinder. The module does not subdivide imported geometry automatically. A two-triangle plane cannot show detailed displacement. Keep fine bark pores/brick grains in a matching normal map; displacement does not reconstruct normals. Adjust normal-map strength when changing depth scale substantially. Avoid large amplitudes at hard-normal/UV seams because vertices can separate. CPU raycasts/collision shapes remain undisplaced.

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
weather.setCenter(new THREE.Vector3(0, 20, 0)); // bounding box is centered here

// Render loop: O(1), updates a shared time scalar only.
weather.update(deltaTime);
// UI controls:
weather.configureLayer('rain', { opacity: 0.2, gravity: 4, turbulence: 0.08 });
weather.setEnabled('snow', false);
weather.setWind(new THREE.Vector2(2, -1));
// After renderer size/pixel-ratio changes:
weather.resize(renderer);
// Optional camera-following volume, once per frame: weather.setCenter(camera.position)
// Cleanup:
weather.dispose();
```

Only explicitly requested layers are created. Each layer is one `THREE.Points`/`BufferGeometry` draw. Static seeded attributes are allocated on creation/count changes. Gravity uses analytic `v*t + 0.5*g*t²`, with lifetime solved from volume height; modulo time respawns precipitation at the top. Drift, wrapping, turbulence and boundary fades run entirely in the vertex shader. Fragments draw soft flakes, camera-oriented rain streaks and soft billow sprites. No particle loop, transform upload, compute readback or CPU respawn runs per frame. Count changes intentionally reallocate geometry; other controls update uniforms without rebuilding.

Size is world-space sprite diameter; the module handles perspective and orthographic cameras, drawing-buffer resolution, and the GPU point-size limit. Opacity is 0–1; speed/gravity/turbulence are nonnegative; count is an integer from 0–200,000 per layer (a guardrail, not a recommended density). Changing speed, gravity or bounds recalculates analytic trajectories and can cause a visible jump. Pausing means omitting `update`; hiding a layer keeps its simulated time advancing. Keep volume transforms unscaled and unrotated for values to remain world units.

Clouds and mist are inexpensive layered sprites, not volumetric ray-marched clouds. Their billows are unlit tints and do not cast shadows. Alpha blending does not sort individual particles; keep opacities low. Opaque scene geometry depth-tests correctly, but intersections have no depth-texture softening. There is no ground/roof collision, accumulation, or wet-material coupling. Very large nearby sprites are capped by hardware; for huge cloud banks use more smaller billows or a future billboard-quad implementation. These limits are deliberate for the Points implementation. Transparency overdraw, rather than CPU motion, is the main weather performance cost; start with 5–15k rain and fewer than 200 cloud/mist sprites.

## React Three Fiber integration

Create controllers in an effect, add them to `useThree().scene`, and return their `dispose()` cleanup. Store controllers in refs, and use one `useFrame((_, dt) => { windRef.current?.update(dt); weatherRef.current?.update(dt); })` at the landscape level. Use a separate effect on viewport size/DPR for `weather.resize(gl)`. Route controls to `configureLayer()`/`configure()` and do not allocate controllers during render. Existing `PlantModelMesh` already owns its own wind clock; do not additionally update that clock.

## Preview and checks

Run `npm run dev` and open `/examples/gpu-environment.html` for 1,024 instanced trees in 16 cells, all four weather layers, displacement, live controls, and perspective/orthographic switching. This is a development example; it is not included in the production entry point.

```sh
npx tsc -p tsconfig.graphics.json --noEmit
npx vitest run src/lib/graphics/graphics.test.ts
npm run build
```

Tests cover buffer immutability during updates, control validation, bounds, IDs/capacity, hook composition, shared visible/shadow uniforms, cleanup, and new species geometry. Browser verification exercises actual shader compilation and directional/point shadow rendering; it is not an FPS benchmark. The repository-wide typecheck currently reports an unrelated `Effects.tsx` particle-type mismatch. The checked-in npm lockfile also predates several declared dependencies; validation used `npm install --ignore-scripts --package-lock=false` without editing it.
