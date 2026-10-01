# Polyform Beta environment proposal

Reviewed 1 October 2026 against [sparx1981/three-geospatial](https://github.com/sparx1981/three-geospatial), commit `b012ad06d858fc035d88aacfd73f092f93c994e4`. The approved first Beta stage is implemented; implementation and verification notes follow below. The water section remains a separate proposal.

## Recommended integration

Add an opt-in **Beta** toolbar with an **Environment lab** panel containing all six requested features. Each feature has its own toggle and controls. Keep the current rendering available as the immediate reset/fallback. Save Beta settings per model, default them off for existing models, and use the same settings for presentation and image capture.

Use the existing WebGL renderer for the first implementation. The fork supplies WebGL/R3F implementations compatible in principle with Polyform's current React 19, R3F 9, Drei 10, Three 0.186 and postprocessing 6 stack. Its WebGPU API is a separate implementation, with clouds still marked in progress in the reviewed README. Moving the whole modelling viewport to WebGPU would make this a much larger change.

The reviewed atmosphere package is `@takram/three-atmosphere` 0.19.1, its core dependency is `@takram/three-geospatial` 0.9.1, and effects is `@takram/three-geospatial-effects` 0.6.4. Pin a mutually compatible published package set after a small compatibility preview; the fork's source versions alone do not prove npm availability or runtime compatibility.

## Features and their Polyform equivalents

| Feature | Implementation in the fork | Proposed Polyform behaviour |
| --- | --- | --- |
| Sky | `Atmosphere` + `Sky`, using precomputed atmospheric scattering, solar direction and date/location | A physically based sky option with date, time and site location; share the same solar direction with scene lighting. Switch background ownership from the existing skybox/HDRI only while enabled. |
| Stars | `Stars` with a binary catalogue; `Stars-Basic.tsx` rotates it from inertial to Earth-fixed coordinates using the date | Night sky aligned to the project's location and time, with intensity and visibility controls. Fade against daylight so stars do not appear through a bright daytime sky. Host the catalogue with our application assets. |
| Clouds | `@takram/three-clouds`: volumetric ray marching, weather/shape/detail/blue-noise textures, animated layers, temporal reconstruction and cloud shadows | Coverage, cloud type/layers, altitude, thickness, wind and a Low/Medium/High quality selector. Connect wind to the existing Weather settings. Begin with one controlled layer and expose additional layers as advanced options. All requested features remain available in the first Beta panel. |
| Lens flare | `LensFlare` post-processing, including ghost and halo controls; examples apply it before tone mapping | Optional optical glare from bright scene sources, with intensity, ghosts and halo controls. Default off for architectural editing. It is an image effect, not a water/wave effect or an automatic sun-only occlusion system. |
| Atmosphere | `AerialPerspective`, with atmospheric transmittance/inscattering and optional post-process lighting | Distance haze and atmospheric colour using correct depth and site coordinates. Use `SunLight` / `SkyLight` for the PBR architecture and furnishings. Do not enable a second sun/sky lighting calculation on already-lit PBR surfaces. |
| Colour grading | The examples combine `ToneMapping` with a Hald image LUT, converted by `createHaldLookupTexture` and passed to the existing postprocessing `LUT` component | Neutral / warm / cool grading presets, strength, exposure and reset. Apply exactly one tone-mapping stage; colour grading follows it, with antialiasing/dithering last. Keep a neutral architectural preset for judging material colours. |

Sources: [atmosphere guide](https://github.com/sparx1981/three-geospatial/blob/main/packages/atmosphere/README.md), [clouds guide](https://github.com/sparx1981/three-geospatial/blob/main/packages/clouds/README.md), [stars example](https://github.com/sparx1981/three-geospatial/blob/main/storybook/src/atmosphere/Stars-Basic.tsx), [lens flare example](https://github.com/sparx1981/three-geospatial/blob/main/storybook/src/effects/LensFlare-Basic.tsx), [colour LUT helper](https://github.com/sparx1981/three-geospatial/blob/main/storybook/src/helpers/HaldLUT.tsx).

## What the 3D Tiles examples teach us

The [clouds / 3D Tiles example](https://github.com/sparx1981/three-geospatial/blob/main/storybook/src/clouds/3DTilesRenderer-Story.tsx) combines the tile renderer, geodetic camera placement, `Atmosphere`, `Clouds`, `AerialPerspective`, flare, tone mapping, LUT, SMAA and dithering. It updates effect camera settings when globe controls change near/far planes. Its [Globe helper](https://github.com/sparx1981/three-geospatial/blob/main/storybook/src/helpers/Globe.tsx) also uses tile fading, attribution and creased-normal generation.

Polyform already uses `3d-tiles-renderer` in `src/components/GoogleTilesLayer.tsx`, including Google authentication, Draco support, attribution/status, site cut-outs and flattening under edited buildings. Retain that implementation and the editor's Orbit/Walk controls; adding the atmospheric pipeline does not require replacing the tile layer or installing globe controls.

The important adaptation is coordinate space. Polyform's `tilesToSiteMatrix` maps Earth-centred tile coordinates to **x east, y up, z south**, preserving metre-scale local editing. Use its inverse, based on the site's latitude, longitude and elevation, for the atmosphere's `worldToECEFMatrix`. The fork's [world-origin-rebasing example](https://github.com/sparx1981/three-geospatial/blob/main/storybook/src/atmosphere/Atmosphere-WorldOriginRebasing.tsx) demonstrates this pattern. Do not copy its North/Up/East frame without adapting axis order, and do not move editable buildings to million-metre Earth coordinates. Google tile alignment lift must not silently change the physical location of the editable site.

There are two distinct lighting approaches in the atmosphere guide. The globe examples can light unlit/albedo tiles in post-processing, using an approximate Lambertian model. That is unsuitable as the default for Polyform's PBR furnishings, glass and metals. Start with the light-source approach (`SunLight`, `SkyLight`, atmosphere without additional post-process direct lighting), then evaluate a lighting mask specifically for the Google photographic tiles if required. This avoids double lighting and preserves the editor's material response.

## Performance and validation before release

* Reuse one effect composer, integrating with the existing ambient occlusion, god rays and fog. Establish effect order and background ownership explicitly rather than stacking independent composers and skies.
* Clouds should start at Low on mobile, with temporal reconstruction enabled and a reduced render resolution. The cloud guide explicitly recommends a skybox fallback if Low remains too slow; do not promise desktop cloud quality on every phone.
* Host required atmosphere/star/cloud/LUT assets ourselves, with provenance and licence records. The cloud package's default remote GitHub asset URLs are unsuitable as a production dependency. Preserve the MIT notices; audit the individual catalogue and LUT assets too.
* Validate frame time and memory with actual phone and desktop hardware, tile loading on/off, Walk Mode, shadows, glass, water, uploaded/PBR furnishing materials, orthographic plan views and image/presentation capture. Browser viewport emulation alone does not establish mobile GPU performance.
* Check context loss, toggling/reset, project save/open and lazy loading. Failure to load Beta assets should leave the existing scene usable.

Approval requested: implement this as one opt-in Environment lab containing all six controls, using the existing WebGL viewport and local site coordinates, with mobile cloud quality/fallback settings.

## Implemented first stage

The Beta Environment lab supplies all six features, model-persisted settings, date/location controls, shared physical solar lighting, local assets, asynchronous loading and immediate reset to the existing environment. Dependencies are pinned to atmosphere 0.19.1, clouds 0.7.6, effects 0.6.4 and core 0.9.1. One composer integrates clouds, atmospheric distance haze, flare, tone mapping, original neutral/warm/cool grades, SMAA and dithering. The legacy sky, clouds and fog yield ownership only while their Beta replacements are enabled. Captures retain the composed frame.

Catalogue stars are decoded from the upstream factual catalogue into ordinary Three points, rotated from ECI through ECEF into the local east/up/south frame, and faded by solar altitude. This avoids the library star shader's dark output in the editor's composed pipeline. Cloud noise is an original generated volume; no NVIDIA STBN assets are distributed. Asset notices are in `public/beta/NOTICE.md`.

Browser verification covered daytime sky/clouds, night stars, feature toggles, date changes, neutral/warm grading, reset and the scrollable panel at 390px width. Settings/import and nested grass-root tests pass, as do TypeScript and production bundling. Phone-width testing is not a mobile GPU benchmark. Cloud reflections in the captured sky environment are not included; orthographic views omit volumetric effects. Photographic tiles retain their existing surface materials and need representative site visual review before this Beta becomes a default.

Grass now uses nested world-space root identities and complementary pixel dithering. Existing distance and instance budgets remain in place. Distant cards and spatial tile culling remain the next performance stage before extending the radius; smoothing transitions alone does not establish additional GPU headroom.

The supplied RTX 5090 benchmark is dominated by wildflowers: about 3.586M of 3.627M scene triangles, and roughly 32M triangles submitted across all passes. Average GPU time is approximately 13ms. It is a baseline, not evidence of a Beta speed improvement. Wildflower detail/LOD and shadow work deserve measurement before increasing vegetation range.

## Pond/lake water: separate work

This repository does not provide a water or wave solver. Its cloud turbulence is a noise input for volumetric clouds and cannot be reused as realistic lake turbulence. Sky, cloud shadows, atmospheric lighting, grading and glare could improve how water is illuminated, but they do not fix its underlying motion.

The current Polyform solver is a linear shallow-water heightfield, stirred by a small sine pressure field. Its stirring amplitude and foam activation are tied to current speed, the pressure pattern has limited wavelength variation, and foam is estimated from steepness/height/Froude thresholds. These are approximations, not resolved breaking waves. This explains why a stronger turbulence slider still need not resemble real white water.

Recommended water follow-up: separate current velocity, wind-generated waves and turbulence; add a directional multi-wavelength wind-wave model with depth-dependent propagation; drive turbulent disturbances around depth changes and obstacles; generate, transport and dissipate foam from breaking/compression and fast shallow flow. A pond at zero current should still support wind waves, while fast deep water should not automatically become white water. Use lake, shallow rapid and sheltered pond reference cases at identical camera/lighting settings before accepting the change. A true breaking-fluid solver would be a separate, substantially more expensive GPU simulation.

## Grass: wider coverage without LOD popping

Yes, related LODs and spatial dithering could help Polyform preserve a convincing field over larger distances, but smoothing transitions alone does not reduce the cost of a larger visible area.

Polyform already has camera-following near/middle/far rings, fixed instance budgets, slope/obstacle masks and hash-based density fades. Its far ring reaches roughly 60–150 metres depending on grass height. However, each ring has a different spacing and independently generated root positions; a far blade is not necessarily a simplified version of a near blade. Its transition shrinks/drops blades by hash rather than providing corresponding LOD geometry with complementary pixel dithering.

Recommended upgrade: generate stable blade/clump identities from one world-space lattice; make distant roots a nested subset of that lattice; keep wind phase, facing and colour identical across corresponding LODs; use complementary spatial dither transitions; add inexpensive distant clump cards/ground shading and spatial tile culling before extending the view radius. Keep near-field density intact and measure the GPU budget at walking and elevated camera heights.

The [Grassworks documentation](https://grassworks.techredux.co/docs) currently describes a WebGPU renderer, four LODs and camera-following tiles, with [maximum distance versus active workload](https://grassworks.techredux.co/docs/performance/tiling-and-culling) and [density/detail trade-offs](https://grassworks.techredux.co/docs/performance/lod). The quoted upcoming related-LOD technique is useful as an approach; it is not evidence that its commercial package can drop directly into Polyform's WebGL viewport. I recommend adapting the technique to our current grass rather than changing the entire renderer for it.
