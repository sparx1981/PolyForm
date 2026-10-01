# Tree sources and distant impostors — 1 October 2026

The benchmark supports adding distant impostors to the existing tree catalogue first, then offering EZ-Tree as an additional source. It does not support silently replacing every saved tree. This pass adds a reproducible development benchmark and results; production tree rendering and saved models are unchanged.

## Comparison

Polyform baseline: `e109184`. EZ-Tree: [`dcf309bd86bd521083d9c70f01f2de45fdc7c457`](https://github.com/dgreenheck/ez-tree/tree/dcf309bd86bd521083d9c70f01f2de45fdc7c457). Existing pine meshes are loaded through the actual `loadPlantPrimitives` pipeline, including dequantization and material-group isolation. All candidates use `VegetationBatch`, shared immutable geometry, 48 m spatial cells, deterministic placements/rotations and the same landscape wind.

The existing pine asset contains **three trunks per placement**. The final EZ-Tree candidate therefore combines three different fixed seeds, with heights 8.5 / 6.375 / 8.5 m and approximately matched trunk spacing. Initial single-tree procedural measurements were discarded. Canopy density and shape still differ: the procedural trees have fuller, more regular conical crowns; the existing model is airier and more irregular. This is a source comparison, not proof of identical visual quality.

The atlas candidate captures the existing middle mesh from eight azimuths into a 2048 × 1024 RGBA target. Each placement uses one camera-facing quad and picks the nearest capture angle after accounting for instance rotation. This is a WebGL experiment inspired by impostor techniques, **not an integration of SeedThree's WebGPU code**.

## Measurements

1280 × 720 CSS / 1920 × 1080 drawing buffer, FOV 55°, 18 m placement spacing. Warm-up: 120 frames; each recorded run has 240 valid GPU samples. Timer: `EXT_disjoint_timer_query_webgl2`, rejecting disjoint samples. Counts include the ground and all submitted passes. No Beta, mirrors, AO, postprocessing or editor UI workload.

| Scenario | Existing pine | EZ-Tree three-trunk grove | Existing-tree atlas |
| --- | ---: | ---: | ---: |
| 1,000 distant placements: submitted triangles | 148,466,002 | 10,368,002 | 2,002 |
| 1,000 distant placements: draw calls | 865 | 289 | 145 |
| 1,000 distant placements: GPU median | 14.7–15.0 ms | 4.3–4.6 ms | 0.29–0.55 ms |
| 100 middle placements, shadows: submitted triangles | 102,846,202 | 4,548,002 | Not evaluated |
| 100 middle placements, shadows: GPU median | ~9.37 ms | ~3.12 ms | Not evaluated |
| One close placement, shadows: submitted triangles | 4,433,757 | 109,106 | Unsuitable for close inspection |

The existing shadow-proxy batches also submit an invisible main-pass draw, so the shadow scenarios include that current production overhead. Tiers are deliberately forced per scenario to isolate their cost; automatic LOD selection is not exercised by this fixture. The scene has no mixed-species or edited/selected trees.

GPU timings fluctuate with scheduling and clocks. For example, the atlas GPU p95 was ~3.8 ms despite its much lower median. Repeated distant runs are included in the JSON. These results establish a promising direction, **not a full-editor or phone FPS guarantee**. Physical mobile hardware, mixed species, terrain, changing camera elevation, Beta daylight/cloud shadows and water reflections remain necessary acceptance cases.

Raw data: [tree-source-benchmark-2026-10-01.json](tree-source-benchmark-2026-10-01.json).

## Memory, downloads and application size

| Shared template geometry | Existing three-trunk pine | EZ-Tree three-trunk grove |
| --- | ---: | ---: |
| Close attribute/index arrays | 290.70 MiB | 2.73 MiB |
| Middle attribute/index arrays | 86.49 MiB | 1.27 MiB |
| Distant attribute/index arrays | 18.91 MiB | 0.60 MiB |

These are measured CPU geometry array sizes, not total GPU VRAM. Instances share these templates; they are not duplicated 1,000 times. The loader also retains its original GLTF cache, which this table does not count.

The existing three GLBs total 62,062,052 bytes (~59.19 MiB). The four reference EZ-Tree texture files used here total 4,790,232 bytes (~4.57 MiB), plus generator code and presets. Generating the three-seed grove and its detail geometry took ~228 ms on this machine; cached assets should be generated once, preferably away from the interaction thread. Startup/load timings are local/cache-dependent, not remote download benchmarks.

The atlas uses ~8 MiB of RGBA colour storage, or ~10.67 MiB including a complete mip chain, plus its bake depth target. The bake submission took ~74 ms on the CPU; this is not a separately timed GPU bake or PNG/download-size measurement. A shipped atlas should be baked offline and the temporary depth/bake resources released. The experiment currently loads all existing tiers to compare them, so it does **not** demonstrate a smaller application bundle or lower end-to-end peak memory.

Removing legacy assets would reduce deployed static bytes, but could break saved-model appearance. Keeping legacy trees and adding procedural choices will not by itself shrink deployment size. Lazy loading only the requested tiers, offline atlas compression and cache ownership are more useful first steps.

## Recommended implementation

1. Add a fourth, very distant representation to existing catalogue trees. Begin around 25–30 projected CSS pixels, with hysteresis and complementary dithering; verify the cutoff visually before making it default. Retain actual geometry for close/middle views and selected trees. Avoid per-cell texture duplication.
2. Bake **albedo, normal/depth and alpha**, with edge dilation and padding. Re-light at runtime so the Beta day cycle, night and moving cloud shadows remain believable. The colour-only experimental atlas has fixed lighting, eight-angle changes and no elevation captures; it is not ready to ship. Blend neighbouring angles and preserve alpha coverage in mipmaps. Use real geometry when camera elevation exceeds the captures' useful range.
3. Keep near/middle shadow proxies; distant trees retain today's no-cast-shadow policy. Ensure the billboard path still supports wind, plant IDs/selection, erasure, ground anchoring, presentation stages, per-camera reflections and conservative bounds.
4. Offer EZ-Tree as new procedural species, using a bounded shared seed catalogue rather than unique geometry per placement. Tune species/materials and compare canopy coverage before offering an explicit conversion of existing trees. Do not substitute a conical pine for an existing airy scanned pine automatically.
5. Use [SeedThree's impostor implementation](https://github.com/SkyeShark/SeedThree/blob/cf2eaad39d9b7355ed086aca2a95fb785e539242/src/core/impostor.js) as a reference for multi-channel baking and alpha-edge dilation. Its TSL/WebGPU material path requires adaptation to Polyform's WebGL renderer; do not install a second renderer for this feature.

## Reproduce

From the Polyform checkout, retrieve the optional reference into the scratch directory (do not add it to the production dependency manifest):

```powershell
git clone --filter=blob:none --sparse https://github.com/dgreenheck/ez-tree.git .test-cache/ez-tree
git -C .test-cache/ez-tree checkout dcf309bd86bd521083d9c70f01f2de45fdc7c457
git -C .test-cache/ez-tree sparse-checkout set src/lib src/app/public/textures
npm run dev -- --host 127.0.0.1 --port 3013
```

Open `http://localhost:3013/scripts/benchmarks/trees.html`. Choose source, placement count, view and shadows. **Record run** enables after warm-up and 240 samples; GPU timing stays unavailable rather than becoming zero on unsupported devices. Run each configuration repeatedly, alternating sources. Avoid other GPU-heavy pages during measurement. The recorded JSON appears in the history panel. Source: `scripts/benchmarks/trees.mjs`; no benchmark code is imported by the application entry point.

EZ-Tree code/leaf textures are MIT (Daniel Greenheck); the reference bark textures are ambientCG CC0. The reference checkout retains its licence and texture attribution. Existing Poly Haven assets keep their current provenance. No third-party tree generator or texture assets were vendored into the application.

Verification: benchmark page renders all three sources without shader errors; shared production vegetation/loading tests: 23 passed across three files; TypeScript and benchmark JavaScript syntax checks passed. Browser close and distant views inspected with matching cameras. No full-renderer rewrite or saved-model migration occurred.
