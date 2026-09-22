# High-poly tree performance review

Measured from the checked-in `public/polyhaven-models-decimated/*.glb` files on 22 September 2026. Triangle counts are the sum of glTF triangle primitive index counts (or position counts where unindexed); file sizes include compressed geometry and embedded images.

| Tree | GLB size | Triangles | Vertices | Embedded image bytes |
| --- | ---: | ---: | ---: | ---: |
| Pine Tree 01 | 42.1 MiB | 2,970,695 | 4,210,421 | 0.7 MiB |
| Fir Tree 01 | 40.0 MiB | 1,666,034 | 3,338,196 | 0.7 MiB |
| Jacaranda Tree | 13.4 MiB | 909,159 | 1,142,357 | 0.6 MiB |
| Small Tree 02 | 6.3 MiB | 492,075 | 545,353 | 0.5 MiB |
| Island Tree 01 | 5.1 MiB | 377,044 | 430,818 | 0.6 MiB |
| Fir Sapling | 8.2 MiB | 366,408 | 660,423 | 0.3 MiB |

The current pipeline already compresses and decimates source assets, caches loaded templates, batches eligible plants by species/variation and 48 m spatial cell, and retains frustum culling with wind-padded bounds. The largest remaining cost is drawing the same dense mesh at every distance. File compression reduces transfer size but does not reduce triangles submitted to the GPU. The pine alone still has nearly three million triangles.

## Recommended order

1. **Add distance-based geometry tiers per tree.** Keep the current mesh for close inspection. Build a middle tier around 15–25% of current triangles and a distant tier around 2–5%, then choose by projected screen height with hysteresis. Preserve the crown silhouette, trunk profile, UV sets, alpha behavior, and material assignments when simplifying. Validate each species at several camera distances before shipping. [Three.js LOD](https://threejs.org/docs/pages/LOD.html) describes the underlying switch; the app's existing spatial batches should be grouped by both cell and tier.
2. **Render simpler shadows.** Foliage geometry is currently submitted for shadows as well as the main view. Use a much simpler trunk/canopy shadow proxy or stop expensive tree shadows beyond a measured distance. Keep near-tree shadows for visual grounding.
3. **Reduce duplicate geometry copies across cells.** `VegetationBatch` clones each primitive geometry for every spatial cell. For these large meshes, that can multiply CPU and GPU memory as scenes spread across cells. Share immutable geometry per species and detail tier, with per-batch bounds for wind sway, before removing the clone. [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) is already used correctly to reduce draw calls within each cell.
4. **Profile edit modes separately.** Batching is enabled only for select, orbit, pan, and zoom. Eraser and transform modes render each tree separately; a dense scene can therefore slow down during editing even if navigation is smooth. Extend batching only where object picking and manipulation remain correct.

Texture conversion is a lower priority for these six assets because embedded images total less than 1 MiB per tree. [KTX2](https://threejs.org/docs/pages/KTX2Loader.html) remains useful for larger texture-heavy assets.

Before choosing exact thresholds, compare 1, 10, and 50 tree scenes at near, middle, and far views. Record GPU frame time, draw calls, rendered triangles, memory, load time, and side-by-side screenshots. Accept a tier only when silhouette and foliage density remain convincing at its switching distance.
