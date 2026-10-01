# Water, vegetation and Beta follow-up — 1 October 2026

## Delivered

### Beta scene stability

The old root changed the React ancestry of cameras, controls and geometry twice: when the runtime module loaded and again when its assets became ready. This could reset camera fitting, geometry owners and presentation material overrides. The editor scene now keeps the same provider and child path throughout loading, enable/disable and failure recovery. The atmosphere publishes its context to the existing composer without wrapping or remounting the scene. Both runtime and effect failures restore the existing renderer independently of model ownership.

A browser fixture containing normal model shapes and an explicit red/blue checker material retained the camera UUID, camera position, mesh UUID and texture UUID when Beta was toggled. Colour and the checker texture remained visible. A regression test repeats enable/disable three times and asserts one scene-owner mount and zero unmounts.

The lab has a header drag handle, a dock/undock button and a right-panel host. Its dock preference is stored locally; blocked browser storage does not prevent docking. Phone panels remain within the screen, scroll, and reset desktop drag offsets when the layout changes. Opening the lab never enables effects.

### Water realism

The existing depth-aware staggered shallow-water solver now accepts Weather wind independently of prescribed current. Wind pressure uses wind speed, basin fetch and finite-depth dispersion. A still lake can develop wind waves; removing wind lets existing waves decay rather than abruptly switching them off. Enable Weather and use its east/west and north/south wind settings. Current turbulence continues to add irregular energy.

Foam responds to steep positive crests, shallow fast flow and converging wave velocity. It advects and decays. Laminar current in deep water remains unfoamed; maximum turbulence is not a blanket white paint effect. The existing optical absorption, sun scattering and mirror materials are preserved. Fixed-camera mirrors update at up to 30 Hz; camera movement and water-level changes refresh immediately. Vegetation in mirrors is culled and prepared for the mirror camera separately.

This remains a two-dimensional free-surface heightfield approximation. It does not implement overturning waves, volumetric spray, SPH or the complete WebGPU fluid repository. A bounded rapids/splash simulation remains a later integration, with terrain collision and a GPU budget required first.

### Wildflower and vegetation performance

- Detailed and distant flower models share each species' stem, leaf, head/floret and colouring conventions. Distant models reduce strip subdivisions, stem sections, centre sides and floret sides; flower heads retain their real size.
- Spatial patches are culled on the CPU, then compacted into one instanced batch per species and detail level. Near/far levels use identical roots, transforms, variation and wind, with complementary dithering across the transition.
- Only eligible roots are submitted. Dithering by itself would still submit both levels' full geometry.
- Geometry buffers are prepared through a shared scene hook **before Three uploads them**, for each render camera. This avoids a one-frame or mirror/main-camera mismatch from updating attributes in a mesh's `onBeforeRender` callback.
- Multiple meadows can unmount in any order without invoking disposed batches. Bounding volumes include shader height and wind movement.
- Unrelated furniture/material edits no longer regenerate flower placements: the dependency is the actual exclusion footprint signature.
- Existing grass rings, related LODs and tree instancing remain intact. Reduced flower work and throttled fixed-view water mirrors are this pass's vegetation savings. Tree replacement and far grass impostors still need separate matched benchmarks.

## Matched browser microbenchmark

Same deterministic 64 × 64 m mixed meadow, requested density 3/m², 12,061 accepted roots, camera [0,3,12], FOV 55°, 1280 × 720 browser viewport, 1920 × 1080 drawing buffer (DPR 1.5). One standard render with no editor AO or shadow passes. The original component was loaded alongside the new component and switched in the same fixture. No roots were deleted to obtain the reduction.

| Measurement | Original | Final |
|---|---:|---:|
| Submitted triangles | 3,878,378 | 1,153,028 |
| Draw calls, including ground | 6 | 11 |
| Stored flower roots | 12,061 | 12,061 |
| Observed GPU median, after warmup | ~0.25 ms | ~0.11 ms |

Submitted triangles fell about 70%. GPU medians use `EXT_disjoint_timer_query_webgl2`, reject disjoint results, discard the first 120 frames and use up to 240 samples. Tail timings varied significantly during this desktop session, so this is not evidence of a p95 improvement or a guaranteed FPS gain in the full editor. Rerun the supplied model/camera scenario with the same AO, shadows, DPR and Beta settings for the production comparison.

An initial implementation submitted one draw per species/detail **per patch**. Although it reduced triangles, 73 draw calls worsened GPU time. That approach was discarded in favour of shared species batches and CPU patch culling.

## Toolbar audit

Settings previously omitted many standard modelling tools, Section Plane, all four AI icon toggles and Beta. Camera options were duplicated. Settings now includes these controls, and grouped classic flyouts and classic AI buttons respect the same visibility keys as the unified rail. Walk Mode now reaches its existing modifier panel.

The phone uses the **same visible tool categories and tool items** as the desktop unified rail. Icons are in Draw, Build, Land, View and AI sheets, subject to the same enabled-toolbar and icon visibility settings; they are not permanently arranged as desktop right-side icon bars. `More` opens the shared right-panel stack. Built-in geometry actions and panel contents therefore remain available on phones, including the four AI actions. Custom developer/script buttons remain managed through their existing custom-toolbar controls.

## Validation

47 focused tests across 10 files passed, covering water rest/decay/whitecaps/deep laminar current/wind forcing, water controls and geometry, grass LOD, flower models, per-camera preparation and cleanup, cloud material hooks, and repeated Beta toggles. Type checking and production build were also run. Browser checks covered checker textures with Beta, clouds, header dragging, right-panel docking, phone modelling/AI sheets and turbulent water rendering. No new runtime shader errors were observed after clean reloads; development fixture HMR messages were excluded from production conclusions.
