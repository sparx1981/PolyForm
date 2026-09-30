# Performance logs

Runs saved by the in-app **GPU Profiler** (Visualisation > Scene Helpers > GPU Profiler).

1. Switch the profiler on. A panel appears bottom-left with live frame time, GPU time, draw calls and triangles.
2. **Run benchmark** orbits the camera once round the model the same way every time (about 14 s). **Record** measures whatever you do until you press Stop.
3. **Download log** saves a `.json` file with the device, quality settings, scene cost (heaviest objects, textures), statistics, findings and a per-second timeline. Drop it in this folder (or send it to Claude) to compare before/after a change.

Use the same model, browser and window size when comparing two runs. GPU timings need Chrome or Edge; other browsers still give frame time, draw calls and triangles.
