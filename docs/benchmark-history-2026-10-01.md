# Benchmark history — 1 October 2026

GPU Profiler → History opens a history dialog on desktop and mobile. Completed runs retain the last 100 local records rather than ten. Scenario for next run, model ID, start timestamp and build revision are captured before recording begins. Settings include Beta clouds/quality/atmosphere/grading, viewport exposure and camera projection alongside the previous shadow, AO and instancing switches. Revision capture now uses argument-based Git execution with a workspace-specific safe-directory option, avoiding unknown revisions in this managed checkout.

History imports legacy single-run JSON, arrays and versioned exports, validates finite metrics/nested structure, deduplicates IDs and keeps the newest 100 chronologically. Files are limited to 20 MB, cloud records to 200 KB and new run timelines to 600 representative points. Blocked or full browser storage retains runs in memory and shows an export notice. Importing the supplied polyform-perf-benchmark-2026-10-01T09-37-00.json succeeded as a legacy record.

Select any baseline and view frame/GPU/FPS/draw-call/triangle changes. Comparison warnings cover device, resolution, settings, workload kind, model ID, scenario and missing older metadata. A model ID does not prove identical geometry; saved-model revisions/content hashes and exact replay are not implemented. Existing diagnosis rules suggest bottlenecks without changing rendering settings. History and selected Markdown summaries can be exported.

## Private cloud history

Manual Save selected to cloud stores one idempotent record under users/{uid}/perfRuns/{runId} in the app's existing named Firestore database. There is no automatic upload. The cloud payload omits app URLs, browser user agent, object/texture names, free-text diagnoses and geometry. It retains GPU/vendor, performance summary, quality settings, model ID and the user-supplied scenario. Diagnoses are rebuilt from numeric data on load. Local exports remain full logs and can contain object names.

Load cloud history explicitly connects a standard ordered Firestore listener (startedAt descending, limit 100). This standard-query exception is required for live cross-device updates and offline cached reads. It disconnects on user action, dialog closure or account change. Sign-in is required; cloud errors are shown while local history remains available. Cloud records are not automatically pruned after 100: this is the current UI/read limit. No AI credentials, scheduled scanner, telemetry collection or automatic optimizer has been provisioned. An AI needs separately authorized read access or an exported log to analyse trends.

The configured Firestore database was confirmed to be Enterprise native mode in europe-west2. Prototype rules restrict gets, bounded lists, creates, updates and deletes to the path owner and validate the payload. Anonymous and other-account access is denied. These rules should be reviewed before broadly sharing the app.

The user explicitly approved production rule deployment. Deployed rules differed from repository rules for an unrelated feature, so deployment used a snapshot of the current live rules with only the new private history block inserted. The named-database release was fetched after deployment and matched the proposed additive file exactly; removing the block restored the prior live file exactly. Existing live access behavior was preserved. The repository rules also contain the new block; a future full repository deployment still needs to account for the pre-existing drift.

## Validation

81 application tests pass (history and presentation regressions), plus three isolated Firestore emulator tests. Emulator tests exercise owner creates/updates and bounded queries; anonymous/cross-account denials; invalid writes; and the actual cloud service save/load round trip with redacted payloads. The emulator runs in Standard mode, so Enterprise-native compatibility is checked by using the installed modular SDK and production rule compilation; no pipeline query is used. TypeScript and production Vite build pass; unchanged public asset copying was skipped. No production benchmark data was uploaded as a test. Live browser/mobile UI verification remains pending because browser control is unavailable.

## Water, vegetation and editor loupe status

Water's depth-aware shallow-water waves, independent weather wind, current turbulence, advected/decaying crest and shallow-flow foam are delivered. Overturning waves, spray, volumetric fluid and bounded rapids/terrain collision remain separate work.

Vegetation has CPU patch culling, related/dithered grass detail levels, extended distant cards/full-terrain canopy, paired close/mid blades, compacted species flower batches and lit distant tree impostors. Representative benchmarks show savings, but actual full-model/mobile benchmarks and the user's near grass density appearance remain outstanding. Close high-poly tree cost has not been eliminated.

The existing detail loupe renderer can be reused in edit mode through a View tool, independent editor state and a rim drag handle. Selection within the magnified region would need pointer rays mapped through the lens camera, so picking matches the visible magnified object. Centre click-through to the unmodified main camera would not be sufficient. Editing through the lens, touch interaction, transform handles, split view and per-camera vegetation preparation need dedicated verification. This turn documents the approach; it does not add the editor tool.
