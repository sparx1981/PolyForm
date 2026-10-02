# Beta cloud grain: measurements (3 October 2026)

Measured, not yet changed. Static camera, Beta clouds at Medium, coverage 60%, exposure 3. Five frames 1.5 s apart,
luma 0 to 255 over a 480x410 patch of sky. "Temporal" is the mean frame-to-frame change; "spatial" is the mean
difference from the 3x3 local average. Lower is smoother. Software renderer (SwiftShader, about 1 frame a second), so
absolute numbers are inflated and temporal blending has had very few frames to settle; compare rows with each other.

| Variant | Temporal | Spatial |
| --- | --- | --- |
| Current (Polyform noise volume) | 0.864 | 0.878 |
| Pure white noise | 0.884 | 0.890 |
| No jitter at all (flat noise) | 0.355 | 0.460 |
| Current noise + slower history blend (alpha 0.03) | 0.568 | 0.762 |
| Current noise, golden-ratio shifted per frame | 0.831 | 0.787 |

What it shows:

* Our "blue" noise volume (`public/beta/stbn.bin`) gives the same grain as white noise. Each of its 64 slices is made
  independently, so it has no structure over time, and its spatial shaping is a single 4-neighbour high-pass.
* The grain comes from the stochastic ray-march jitter: removing the jitter halves it.
* A longer history blend helps, but trades clarity when the camera moves.
* Shifting each frame by the golden ratio (a low-discrepancy sequence per pixel) helps spatially and a little in time.

Not measured: cloud shadows on surfaces. In this environment no cloud shadow appeared on a 150 m terrain at all (ground
rows identical across every variant), so the shadow map's grain could not be separated out. By inspection, surfaces
sample the map with a fixed 3x3 filter (no random taps), but the map is itself built from jittered ray marching and
temporal accumulation (`shadow.temporalJitter`), so residual noise there is plausible.

Also found: at the default exposure of 1 the physical sky is under-exposed (a dark navy noon). Exposure 4 gives a
normal-looking noon sky. The lab's exposure range stops at 4; the library's own demos run near 10.
