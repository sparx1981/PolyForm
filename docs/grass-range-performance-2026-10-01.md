# Grass range and performance — 1 October 2026

## Delivered

The three existing blade rings retain their near density, height, colours and wind controls. A fourth two-triangle tuft-card layer extends the nominal range from 60–150 m to 180–450 m depending on grass height. Fade endpoints remain 97% of nominal range. Each card cuts six varied grass silhouettes and receives standard lighting, shadows, fog and cloud material hooks. Distant cards omit the detailed blade shader's Voronoi neighbour search and walk-trail loop.

The CPU rejects empty, off-terrain, inactive-distance and unseen 16×16 patches before submitting geometry. Eligible patches compact into one instanced draw per ring, rather than one draw per tile. One patch-origin attribute is shared by 256 roots. Mask occupancy uses a summed-area table, with a cached tile-window query; static camera results are reused. This adds at most roughly 4 MiB of CPU occupancy storage per terrain and small patch buffers, with no new image assets or dependency packages.

Preparation runs through the shared scene registry before Three uploads buffers, separately for each render camera, including water mirrors. Wind/pixel-width margins conservatively bound moving geometry. The existing per-root GPU mask still resolves exclusion edges exactly. Grass geometry is visual only and does not enter raycasting or walking collisions.

Integer hierarchical root selection scatters coarse roots across their cells while preserving exact membership in every finer lattice. This removes aligned distant rows without resampling on camera movement. Existing complementary pixel dithering still blends layers. Elevated views now measure detail distance along the ground from the nearest visible point instead of subtracting camera height from a three-dimensional distance; the latter produced visible rectangular density boundaries. Walking retains true camera distance.

## Matched representative benchmark

A deterministic 500×500 m flat field with a 16×20 m excluded slab, density 10, height 0.3 m ±0.2 m, FOV 55°, browser viewport 1280×720 and drawing buffer 1920×1080. Original rendering from e6ed219 and the new component ran alternately in the same fixture. One standard raster pass without editor AO, shadows, Beta or water mirrors. Actual saved-model comparison remains pending model selection.

| View | Original triangles | New triangles | Original GPU median | New GPU median |
| --- | ---: | ---: | ---: | ---: |
| Walking, camera [0,1.8,12] | 6,719,678 | 1,830,926 | 0.809 ms | 0.431 ms |
| Elevated, camera [30,45,65] | 6,719,678 | 3,598,350 | 0.763 ms | 0.455 ms |
| High overview, camera [0,110,130] | 6,719,678 | 3,633,166 | 0.766 ms | 0.473 ms |

Walking triangles fell about 73%; observed GPU median fell about 47%, while the new distant range was enabled. Standard fixture draws rose from five to six (ground, slab and three/four grass rings). Moving continuously at 1.5 m/s through more than 100 m retained approximately 1.82 M submitted triangles, 0.427 ms GPU median and 0.2 ms median CPU render time. Static CPU render medians were about 0.1 ms. Before caching mask-window queries, moving preparation raised the CPU render median to about 0.4 ms.

GPU timing uses EXT_disjoint_timer_query_webgl2, discards the first 120 frames and disjoint samples, and reports the latest 240 samples. Timings vary with hardware and workload; these are grass microbenchmarks, not a promise of full-editor FPS improvement. The added CPU culling cost and extra draw should also be checked on actual phones and scenes with multiple render passes. Very short grass naturally reads as ground texture at long distance; this pass does not add a terrain-wide grass shading material or replace trees.

Full captured measurements are in grass-range-benchmark-2026-10-01.json. Scratch fixtures and before/after screenshots remain outside the commit.

## Validation

25 focused tests across five files cover nested positive/negative root identities, patch capacity, world anchoring, empty masks, boundary retention, raised terrain, cache invalidation, perspective/orthographic and alternate-camera preparation, grass exclusions and ground ray handling. TypeScript and production build passed. Browser checks covered walking, elevated and high views, continuous movement, the clear slab footprint and clean shader logs.
