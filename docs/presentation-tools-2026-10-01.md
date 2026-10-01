# Presentation tools and near grass — 1 October 2026

## Implemented

Present mode adds **Glass**, **Quality still** and **Effects** to its horizontally scrollable control strip. They are transient presentation settings; leaving presentation resets the lens and postprocessing effects.

### Glass

A draggable, keyboard-accessible circular detail loupe renders the actual geometry through a cropped second camera. It does not simply enlarge existing framebuffer pixels. Magnification is adjustable from 1.5× to 6×, and lens diameter from 140 to 360 CSS pixels (bounded for small viewports). The centre is undistorted; refraction and highlights are confined to the rim. There is no random film-grain shader.

The loupe supports perspective, orthographic and already-cropped cameras without changing the live camera. It uses a 512×512 half-float target, refreshes the scene at most 30 times per second and reuses existing shadow maps. A separate overlay scene is rendered after the main composer. Main render target, auto-clear and shadow-update state are restored. All lens GPU resources are disposed when switched off. Its interior receives scene lighting/materials but does not replay every main-view postprocessing effect, so atmospheric/DOF appearance may differ inside the lens. This requires visual review with Beta enabled.

### Quality still — experimental

The official MIT-licensed [three-gpu-pathtracer 0.0.26](https://github.com/gkjohnson/three-gpu-pathtracer/tree/v0.0.26) WebGL entry is loaded only on request. The existing Three 0.186 and three-mesh-bvh 0.9.15 satisfy its peer requirements. A frozen scene/camera is copied into an independent renderer; instance transforms and tints are preserved, and source materials/geometry are not disposed.

The dialog offers 32/64/256 samples, sample progress, cancellation, a PNG export and the original raster capture as a fallback. Render resolution is capped at 1024 pixels on the longest side, with 3×3 tiling, six bounces and 512-pixel texture packing. BVH construction runs in a worker. Context loss, unsupported floating-point targets and shader errors return to the raster fallback. Cancelling or closing disposes the worker, tracer, temporary environment and renderer, and closing releases the owned snapshot. The modal supports Escape, focus trapping and focus restoration.

This is a bounded first implementation for architectural stills. It rejects unconverted section/cut planes, more than two million source triangles or over 64 unique textures. Procedural grass, distant tree cards, skinned characters and custom shader surfaces such as water are omitted with warnings shown before rendering. Wind/fabric shader deformation uses the rest geometry; procedural sky/clouds or PMREM environments use a gradient approximation. These effects need conversion/baking for full scene fidelity. Save raster retains the live scene's appearance. No silent switch to a purportedly equivalent quality result is made.

### Effects

Bloom intensity (off by default) and depth of field (off by default) use the existing EffectComposer, avoiding a second full-screen postprocessing pipeline. Bloom uses a high luminance threshold and half-resolution mip blur. Depth of field has a focus-distance control in metres, restrained bokeh and a bounded 480-pixel processing height. Exiting Present disables them.

### Near grass

The close and middle layers now use two differently oriented, offset blades per root. The near template uses two curve segments per blade, keeping its original sixteen triangles per root while increasing vertex work from fifteen to eighteen vertices. Middle triangles increase from twelve to sixteen per root. Ring root budgets are unchanged; this is not a claim of zero GPU cost.

Full-density coverage now extends to 72% of each ring radius instead of 55%; CPU patch culling and GPU transitions share constants so their handover remains aligned. The masked canopy begins between 0.75 and 6 metres, shaded darker at its roots, to avoid nearby bare soil between stems. Roads/slabs and slope exclusions continue to use the shared mask. Existing grass settings and colours apply.

## Validation and remaining verification

70 focused tests pass, covering presentation regressions, camera crop ray identity, split-view/orthographic support, instance snapshot transforms/tints, geometry budgets, hidden/clipped surfaces, asynchronous cancellation/cleanup, raster fallback, grass template cost and transition/culling consistency. TypeScript checking and production Vite build pass. The build includes the separate lazy path-tracer chunk and BVH workers; copying unchanged public assets was skipped.

Browser control reported no available browsers/apps during this implementation, so there is **no live GPU/shader or visual verification claim**. A backend-free preview is at `/.test-cache/presentation-tools.html` on the running port 3013 development server and was queued in Codex. Before calling this visually verified, inspect the loupe with composer on/off and Beta active, drag it on mobile, render/cancel/export a quality still, compare bloom/focus changes, and compare near grass on the user's phone and full model. The existing font import and large-chunk build warnings remain.
