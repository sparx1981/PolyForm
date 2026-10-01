# Tree, grass and mobile furnishing follow-up — 1 October 2026

## Full-terrain grass coverage

The existing extended grass radius did not prevent visible brown ground between increasingly sparse distant roots. Added one aggregate canopy mesh following the original terrain height grid. It uses the same coverage/exclusion mask and grass colours as blades, receives lighting and shadows, and fades in between 7 and 24 metres. It has no distance cutoff: 150 metre terrains and larger extents remain covered wherever the mask permits grass. Detailed blades remain near the camera; wider distant tuft cards reinforce the transition.

This is an approximation of grass below pixel size, not dense physical blades across the entire terrain. Its cost scales with the terrain height grid rather than blade density. A flat 500 × 500 metre verification terrain added two triangles and one draw call; walking view had 1,830,928 total triangles and seven calls. The isolated desktop fixture measured roughly 0.43 ms median GPU time. This is not a mobile-device benchmark or an application-wide FPS claim. Masked slab remained clear; elevated and walking screenshots showed continuous coverage.

## Distant tree cards

Existing catalogue tree species with generated LODs now have runtime eight-view albedo and normal atlases. The atlases use the existing distant geometry, with no replacement tree package or new source assets. Colour is unlit; normals allow live directional/ambient lighting and received shadows. Adjacent azimuth views blend, and geometry/card coverage uses complementary spatial dithering across 20–32 projected CSS pixels. Wind deformation remains attached to batched materials.

Atlases are cached per renderer/species, baked serially with yields between views, and disposed on context loss. Render-target viewport/scissor coordinates use physical target pixels, independent of device pixel ratio. Each species uses two 1024 × 512 RGBA targets, plus depth storage, and an eight-triangle segmented billboard per placement. Cold atlas generation still has a cost and keeps distant geometry visible until ready.

Steep overhead and orthographic views use geometry because horizontal atlas captures cannot represent the crown from above. Selected objects follow the existing editable geometry path. Billboard picking uses conservative crown volumes rather than alpha-accurate leaves. Source asset download size is unchanged. Actual Beta cloud-shadow appearance and mobile GPU timings have not been measured in this follow-up.

An actual InstancedVegetation fixture with 1,000 pine placements rendered 8,002 triangles in the distant view, including the ground. Overhead view had zero cards. Selecting one tree removed its card and rendered editable geometry. Day/night lighting changed card appearance. No shader errors were recorded. Geometry remains expensive in close/overhead views; this work specifically addresses distant trees.

The prior research colour-atlas timings are not an appearance-faithful baseline because its viewport setup was incorrect at non-unit DPR. The research harness is corrected and the original geometry/EZ-Tree comparisons are unaffected; the production path above uses separate unlit colour/normal targets.

## Mobile Interior Studio

Interior Studio is now part of the shared architecture tool list used by the mobile Build menu, with soft furnishings keywords and the same event as the desktop button. It also appears in toolbar visibility settings. Verified the button and actual dialog at portrait 390 × 844 and landscape 844 × 390. Test-only visibility changes and viewport overrides were restored afterwards.

## Validation

44 focused tests passed across tree atlas/fades/picking, canopy geometry/masks, grass distribution/culling and vegetation integration. TypeScript checking and the production Vite build passed; the build omitted copying the large unchanged public asset directory. Existing font import/chunk-size warnings remain.
