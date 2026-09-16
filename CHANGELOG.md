# Changelog

All notable changes to this project will be documented in this file.

## [1.10.2] - 2026-09-16
### Changed
- **Walk Mode Collision Policy**: Switched from an allow-list (only a curated set of architecture/landscape types collided) to a deny-list - basic shapes, drawn/poly geometry, floor slabs and everything else now collides by default, so anything you draw can be walked into, stood on, or jumped onto. Only doors, small plants (bushes; trees still block), scale-reference figures, and dimension annotations remain walk-through. This also likely explains being unable to reach an upper floor via a staircase: floor slabs are generated as generic "poly" geometry, which the old allow-list didn't cover, so the floor above the stairs wasn't solid at all.

## [1.10.1] - 2026-09-16
### Fixed
- **Portal Navigation Preview Stutter**: Every hover tick during Portal Navigation was updating a shared tooltip state on Viewport's own (very large) top-level component, re-rendering it in full on nearly every mouse move - expensive enough to read as flicker/stutter across the whole viewport, not just the preview disc. The tooltip is now local, self-contained state inside the small preview component itself, so a hover update only re-renders that.
- **Walk Mode Strafe Controls Reversed**: D moved left and A moved right. The wish-direction "right" vector used the wrong sign relative to the camera's actual local +X (screen-right) axis; fixed the formula and added a regression test that derives the camera's true right vector and checks the player actually moves toward it.
- **Camera Toolbar Icon Colors**: Portal Navigation, Walk Mode, Reset Camera and Camera Depth Clipping had permanently tinted icons (indigo/sky) unlike every other toolbar, whose icons use a neutral color that only changes on hover/active. Removed the forced tint so the Camera toolbar matches.
- **Camera Toolbar Icons Settings List**: The "Camera Toolbar Icons" section of the visibility settings panel was missing Walk Mode, so it couldn't be hidden/shown from there like its siblings.
### Added
- **Walk Mode Sprint**: Holding Shift while walking now sprints (1.6x Movement Speed).

## [1.10.0] - 2026-09-16
### Added
- **Walk Mode**: A new first-person navigation tool (Camera toolbar/group, next to Portal Navigation, Reset Camera and Camera Depth Clipping, in both the classic and unified layouts). Click a spot on the floor to start walking with WASD movement, mouse look, jumping, gravity, and automatic step/stair climbing, using a capsule collider against the model's architecture and landscape geometry (walls, windows, steps, staircases, roofs, terrain, fences, railings; doors remain walk-through).
- **Walk Mode Settings**: Movement Speed and Mouse Sensitivity controls in the Tool Modifier panel, persisted across sessions.
- **Walk Mode Touch Controls**: On-screen joystick, drag-to-look, Jump and Exit buttons for touch devices.
### Fixed
- **Walk Mode Crash**: Fixed "Preparing Walk Mode..." hanging forever - the collision builder threw when a model mixed indexed and non-indexed geometry (a `StaticGeometryGenerator` requirement). Every collidable mesh is now normalized to world-space, position-only, non-indexed geometry by hand before merging, and the build is wrapped so a future geometry edge case exits Walk Mode with a message instead of freezing it.
- **Portal Navigation Preview Flicker**: The disc/ring could jump to an unrelated point or blink off for a frame when hovering near an edge, thin member, or opening. A first pass required a changed hit target to be confirmed for two frames, which cut the flicker but made real hover tracking feel laggy - it delayed every object change equally, including normal cursor movement sliding across a wall built from many small panels. The hysteresis now only applies when the cursor's own screen position is essentially unmoved between frames (the actual signature of the glitch); genuine mouse movement, to any new target, is applied immediately.
- **Toolbar Layout Validation**: Restored strict validation of stored toolbar order/dock preferences (rejecting duplicate or invalid entries) that had been loosened when the Camera toolbar group was added, while still upgrading older 3-toolbar saved layouts to include it.

## [1.9.0] - 2026-04-28
### Optimized
- **Real-time Performance**: Restored Collaborative Transformations and Cursors to a fluid 1-second sync interval.
- **Improved Responsiveness**: Reduced Model State Cloud push debounce to 5 seconds (from 20s).
### Added
- **Tiered Usage Awareness**: Introduced Yellow (25,000 reads) and Orange (40,000 reads) warning banners to proactively inform users of Firestore consumption before lockdown.
- **Session Read Tracking**: Implemented client-side read estimation to drive usage-based UI warnings.

## [1.8.0] - 2026-04-27
### Fixed
- **Quota Resilience v5.6**: Implemented a reactive "Quota Locked" system that pauses all Firestore listeners and background sync immediately upon resource exhaustion.
### Added
- **Visual Feedback**: A red high-priority warning banner now appears at the top of the application during lockdown, showing a countdown to when sync will resume.
- **Status Indicator**: Added a persistent "Quota Locked" badge to the StatusBar for subtle awareness.

## [1.7.0] - 2026-04-27
### Fixed
- **Quota Management v5.5 (Critical Tier)**: Addressed "Quota exceeded" failures by implementing a 10-minute global lockdown failsafe.
### Optimized
- **Aggressive Caching**: Script and Material libraries extended to 5-minute cache; Model Listing extended to 10-minute cache.
- **Write Debouncing**: Drastically reduced Firestore write pressure by slowing Model synchronization to 20s and User Settings to 30s.
- **Broadcast Throttling**: Collaborative 3D transformations further throttled to 3-second intervals to minimize real-time overhead.
- **Proactive Guards**: Added `isQuotaLocked` safety checks across all data-fetching modules to prevent redundant server-side requests.

## [1.6.0] - 2026-04-27

### Changed
- **Quota Optimization v4.5**: Replaced expensive `onSnapshot` real-time listeners for 'scripts' and 'materials' with a 2-minute local caching system and one-time fetches. Added `refreshScripts` and `refreshMaterials` hooks to manually invalidate cache after writes, reducing background reads by ~95%.
- **Transformation Throttling**: Throttled 3D object manipulation broadcasts to **2Hz (500ms intervals)**.
- **Collaborator Sync Optimization**: Slowed down cursor position broadcasts to **0.5Hz (2s intervals)** to stay within Firestore free-tier limits.
- **Persistence Debouncing**: Increased debounce intervals for user settings (5s) and model data (4s) persistence.

### Fixed
- **Scope Errors**: Resolved context destructuring issues in Developer Suite sub-components (`DeveloperConsole`, `DeveloperLibrary`).
- **Geometry Type Safety**: Fixed TypeScript tuple-length errors in `Viewport.tsx` by applying necessary geometry argument casting.

## [1.5.0] - 2026-04-27

### Added
- **Recent Models Section**: New default view in the "Open Model" popup that displays recently edited projects for quicker access.

### Changed
- **Firestore Quota Optimization**: Implemented aggressive throttling for cursor synchronization (reduced from 10fps to 1fps), centralized Firestore listeners to minimize redundant reads, and added client-side caching for model listing. This significantly extends the application's availability within Firebase's free tier quotas.
- **Model Sorting**: Implemented server-side and client-side sorting in the "Open Model" popup. The "Recent" tab now correctly displays models in descending order of their last modified date (`updatedAt`).
- **Collaborative Cursor Scaling**: Fixed collaborative cursors to the 3D application scale (constant screen-space size) for a consistent experience regardless of camera zoom, matching the behavior of primary UI controls.
- **Collaborative Cursor Size**: Maintained a high-impact 75px width for maximum visibility while ensuring it remains perspective-independent.

### Fixed
- **Model List Visibility**: Corrected a state initialization issue in the "Open Model" popup that prevented existing models from populating the list for some users.

## [1.4.0] - 2026-04-18

### Added
- **Real-time Synchronization Engine**: Fully optimized multi-user state synchronization with deep equality checks and intelligent write-backtracking.
- **Sync Status Indicator**: New visual feedback system in the Status Bar (Synced, Syncing, Error) to monitor cloud connectivity.
- **Enhanced SDK Collaboration**: Added `getSyncStatus()` and `getCollaborators()` methods to the Developer SDK for programmatic session monitoring.

### Changed
- **AI Model Upgrade**: Updated all generative and query components to use the recommended `gemini-3-flash-preview` model, resolving previous 404 errors.
- **Load Optimization**: Implemented "Silent" state updates during initial design joins to eliminate redundant database writes and preserve quota.
- **Sync Resilience**: Integrated a "needsSync" queuing system to ensure data integrity during high-frequency concurrent edits.

## [1.3.0] - 2026-04-17

### Added
- **Vertex Deformation Tool**: New "Deform" brush allows real-time sculpting of 3D geometry with radius and strength controls.
- **Boolean Subtraction (CSG)**: Implemented advanced volume manipulation via the "Subtract" tool for cutting meshes.
- **Dynamic Spatial Notes**: Full support for placing, viewing, and completing 3D spatial comments on geometry for review.
- **Real-time Collaboration**: Integrated active collaborator tracking, shared cursor visibility, and a global design chat.
- **Custom Geometry Support**: Implemented a "Custom" shape type to persist sculpted and CSG-generated meshes in Firestore.
- **Keyboard Shortcuts**: New binds for Deform (D), Subtract (X), and Note (N) tools.

### Fixed
- **Critical Crash Fix**: Resolved a `ReferenceError: animations is not defined` that prevented the application from loading.
- **Scene Duplication**: Fixed a bug where saving a scene would result in duplicate entries due to unstable listener dependencies.
- **Type Safety**: Renamed `AnimationEffect` to `SceneAnimation` throughout the codebase.
- **Stability**: Refined state hooks in `RightPanelStack.tsx` and `AppContext.tsx`.

## [1.2.1] - 2026-04-16

### Added
- **Animations Sub-panel**: New "Animations" section in the Visualisation panel with support for particle effects: Confetti, Fire, Smoke, Sparks, and Magic Aura.
- **Interactive Placement**: Support for "Click-to-Place" functionality to position animation effects precisely in 3D space.
- **Animation Controls**: Real-time control over Effect Type, Density, Looping, and Play/Stop for every individual effect.
- **Persistence**: Added full support for saving and loading animation data to/from Firestore.

### Changed
- **Visualisation Redesign**: Reordered Skybox settings to follow Ambient Occlusion and Fog for better UX flow.
- **Model Schema**: Updated the internal data structure to include `animations` and ensure every saved document includes its Firestore `id`.

### Fixed
- **Firebase Save Stability**: Resolved failures in uploading preview images by optimizing Service Worker CORS proxying and handling `OPTIONS` preflight requests.
- **WorldView Navigation**: Added a "Focus on Map" utility to help users locate the geographical overlay in the scene.

## [1.1.0] - 2026-04-15

### Added
- Real-time measurement display with support for multiple units (mm, cm, m).
- Sub-face selection and individual face coloring in the 3D viewport.
- Enhanced map texture loading with retry logic and improved proxy handling.
