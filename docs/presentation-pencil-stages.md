# Presentation pencil stages

Sketch now takes 24–42 seconds, depending on architectural stroke count, followed by 18 seconds of stage transitions. The timeline waits for the initial illustration to complete before entering Massing. Manual stage selection/scrubbing still works; timeline Pause freezes the pencil, including when clicked before the first canvas frame.

Architectural edges are drawn sequentially in foundation/wall/roof order, with continuous partial strokes and short pen lifts. Subdivided lines use fixed freehand offsets, occasional overshoots, a faint second pencil pass and graphite opacity variation. These offsets are deterministic rather than animated noise. They decrease to 22% at Massing and disappear by Detailed, while solid white volumes emerge. Furniture, fittings and frame detail remain reserved for the later stage. Landscape pencil silhouettes enter after the architecture.

Existing editor edge overlays are hidden during the pencil stages and restored afterwards, so the complete crisp drawing cannot show through behind unfinished strokes. Shared source geometry is never modified; each visible part has its own reveal geometry, avoiding simultaneous reveals when objects share the same mesh geometry. Added geometry and materials are disposed and original geometry/materials/transforms/edge visibility restored on exit.

The local `/examples/presentation-quality.html` review now uses the production Sketch hold behaviour. Regression checks cover shared-geometry sequencing, duration, pause/resume, immediate pause, deterministic roughness, Massing refinement and editor restoration. Browser review checks the partial sketch, Massing and completed model and shader compilation.
