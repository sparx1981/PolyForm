# DraftUp Product Specification

> **Last Updated:** 2026-04-27 | **Changed:** Quota Optimization v5.6: Added "Quota Locked" reactive banner in App.tsx and StatusBar, 10-minute reactive lockdown state.

## 1. Architecture Overview
DraftUp is a browser-based architectural 3D modeling workspace built with React 18+, Three.js (via React Three Fiber), and Firebase.
- **Frontend:** React 18+, TypeScript, Tailwind CSS, motion/react.
- **3D Engine:** Three.js, R3F, Drei, Three-BVH-CSG for boolean operations.
- **Backend:** Firebase Authentication, Firestore (Real-time DB), Firebase Storage (Asset Hosting).
  - **Quota Management (v6.0):** Implements multi-tier optimization to maintain Spark Plan stability:
    - **Reactive Global Lockdown:** Catching "Quota exceeded" triggers a **10-minute reactive operational pause**.
    - **Tiered Warning Banners:** 
      - **Yellow (25k reads):** Soft warning.
      - **Orange (40k reads):** High alert.
      - **Red (Lockdown):** Complete sync suspension with countdown.
    - **Listener Teardown:** All real-time `onSnapshot` listeners are automatically detached during lockdown to prevent reconnection attempts.
    - **Library & Settings Caching:** Scripts/Materials use a **5-minute** cache; User Settings/Models use a **10-minute** cache.
    - **Broadcast Scaling:** Collaborator sync stabilized to **1s** (cursors and transforms).
    - **Debounced Persistence:** Model state changes debounced to **5s**.
    - **Optimized Listing:** Open Model uses a **10-minute per-filter** client-side cache.
  - **Security Rules:** Hardened "Master Gate" architecture. Access to models and sub-resources is gated by ownership or an active invitation record in the `collaborations` collection.
- **Collaboration & UI:** 
  - **Presence System:** Real-time transformation and cursor synchronization powered by the `collaborations` collection (throttled to 1fps).
  - **Cursor Tracking:** Collaborative 3D cursors feature personal color-coding (stable color hashing via email) with a high-impact 75px wide triangle arrow pointer and scaled name-pill badges. This design is fixed to the **3D application scale** (constant screen-space size), ensuring maximum visibility and consistency regardless of camera zoom or perspective distance on complex models.
  - **Session Join Logic:** Robust `isCollaborator` verification in Firestore allows guests to push structural changes to the shared model document synchronously.
  - Real-time messaging with **Draggable / Dockable** interface.
  - **Context-Aware Panel Docking:** Both "Project Messaging" and "Tool Modifiers" can be floating popouts or docked within the Right Panel Stack.
  - **Docking Order:** Docked panels are prioritized to appear below the **Collaboration** panel and above **Keyboard Shortcuts** for optimal team workflow.
  - Restricted "Project Messaging" entry point visible only when $\ge 1$ collaborator exists.

## 2. Left Toolbar Tools

| ID | Icon | Keyboard Shortcut | Description | Options / Behavior |
|----|------|-------------------|-------------|---------------------|
| `select` | `MousePointer2` | `Space` | Select objects in the viewport. | Shift-click to toggle multiple selection. |
| `eraser` | `Eraser` | `E` | Delete objects by clicking. | Instant deletion of targeted mesh. |
| `paint` | `PaintBucket` | `B` | Apply the active material/color to objects. | Applies to the entire object or specific faces. |
| `component` | `Box` | `G` | Group selected objects into a component. | Creates a logical grouping for mass transformations. |
| `line` | `PenLine` | `L` | Draw connected line segments. | Snaps to axes and vertices. |
| `poly` | `Pentagon` | - | Trace custom polygons on planes. | Locks to detected face or ground plane. Implements 0.8m snap-to-origin with thick yellow highlight. Complete with Enter or first-vertex click. Supports Push/Pull extrusion into 3D volumes. |
| `rectangle` | `Square` | `R` | Draw 2D rectangular surfaces. | Supports "Precise Input Mode" via Status Bar. |
| `circle` | `Circle` | `C` | Draw 2D circles. | Drag to define radius. |
| `triangle` | `Triangle` | `T` | Draw 2D triangles. | Three-point definition. |
| `sphere` | `Sphere` | - | Create 3D spheres. | Drag to define radius. (Under 3D Primitives) |
| `cone` | `Cone` | - | Create 3D cones. | Drag to define base and height. (Under 3D Primitives) |
| `pyramid` | `Pyramid` | - | Create 3D pyramids. | Drag to define base and height. (Under 3D Primitives) |
| `donut` | `Torus` | - | Create 3D tori. | Drag to define major and minor radii. (Under 3D Primitives) |
| `dome` | `CircleDot` | - | Create 3D domes. | Half-sphere primitive. (Under 3D Primitives) |
| `bevel` | `CornerUpRight` | - | Apply rounded or flat bevels to edges. | Options for Bevel Amount and Segments. |
| `pushpull` | `ArrowUpFromLine`| `P` | Extrude 2D faces into 3D volumes. | Real-time vertex offsetting via CSG. |
| `subtract` | `Scissors` | `X` | Carve holes using one object as a cutter. | Requires Target selection followed by Cutter. |
| `deform` | `CircleDashed` | `D` | Sculpt geometry vertices using a brush. | Brush Radius and Strength controls in Right Panel. |
| `move` | `Move` | `M` / `G` | Translate objects in 3D space. | Uses TransformControls gizmo. Implements stale-closure protection via useRefs for reliable real-time tracking. |
| `rotate` | `RotateCw` | `Q` | Rotate objects around axes. | Uses TransformControls gizmo. |
| `scale` | `Maximize` | `S` | Adjust object dimensions. | Uses TransformControls gizmo. |
| `orbit` | `Orbit` | `O` | Rotate the camera around the target. | Click and drag in viewport. |
| `pan` | `Hand` | `H` | Move the camera parallel to the view plane. | Click and drag in viewport. |
| `zoom` | `ZoomIn` | `Z` | Adjust camera field of view / distance. | Includes "Set Default" capture in Status Bar. Uses optimized billboard scaling for notes. |
| `ai-generate`| `Wand2` | - | Generate 3D models from text prompts. | Uses Gemini 3 Flash to create scene objects. |
| `ai-renderer` | `Image` | - | Generate high-fidelity renders from the viewport. | Integrated via Right Panel or dedicated AI button. |
| `worldview`| `Globe` | - | Geolocation map overlay. | Renders map plane at origin with configurable coverage (50-450m, default 100m). Default altitude is fixed at -0.1m to prevent Z-fighting. |

## 3. Right Panels & Controls

### Object Properties
- **Move Tools:**
  - **Contact Friction:** Optional resistance mode for the Move tool. Objects "stick" for 200ms when their bounding boxes first intersect, providing physical feedback for alignment.
- **PBR Material:** Adjust Roughness, Metalness, and Opacity.
- **Dimensions:** Edit X, Y, Z dimensions of the selection.
- **Position:** Edit X, Y, Z world coordinates.
- **Bevel Settings:** Configure Bevel Amount (0-1) and Segments (1-20).
- **Deform Brush:** Configure Radius (0-10) and Strength (0-1) for sculpting.

### Visualisation
- **Skybox:** Choose background (Golden Hour, Woodland, etc) and adjust Blur, Intensity, and Rotation.
- **Lighting:** Global Shadows toggle, Ambient Occlusion, Sun Intensity, and Sun Animation Speed.
- **Custom Lights:** Spot, Point, Directional, and Projector lights.
  - **Scale:** Spot, Point, and Directional lights are resizable via a Scale multiplier.
  - **Projector:** Specialized Spotlight that projects a texture or video map. Supports static images and looped video backgrounds.
  - **Texture Rotation:** Projectors support a "Spin" mode with configurable rotation speed (radians/sec) and a "Static" mode.
- **Fog:** Standard or "Super Mega" fog with density and height controls.
- **Animations:** Manage particle effects (Confetti, Fire, Smoke, Sparks, Magic Aura).
  - **Scalable:** Particles can be scaled to fit designs of different sizes via the Scale slider.
  - **Set Position:** Behave like lights for positioning in the 3D workspace.

- **Spatial Notes (N):**
  - **Behavior:** 3D tooltips anchored to geometry using `Html` with billboarding (always facing camera).
  - **Placement UI:** Modernized centered overlay (**1200px wide horizontal rectangle**) with high-fidelity glassmorphism styling and coordinates readout.
  - **Go to Entity:** Camera automates fly-to with a 10m offset for optimal framing of the note content.
  - **Scaling:** Note size remains relative to the 3D space via `distanceFactor` scaling with zoom to prevent viewport clutter.
  - **Styling:** Consistent UI card layout for both placement and persistence, featuring author name, task text, completion status, and creation date.

- **Open Model:**
  - **Recent Section:** Default landing view that lists models created/updated by the user, sorted chronologically with the most recently worked-on models appearing first.
  - **Filtering:** Tabbed navigation between 'Recent', 'All', 'Made By Me', and 'Shared' (Public) models.
  - **Password Protection:** Gated access to protected models with secure password validation.
  - **Sharing:** Toggle public status and manage optional password protection for hosted designs.

### TopBar / Menus
- **Project Sub-Menu:**
  - **Export:** Grouped sub-menu containing **Export GLTF**, **Export STL**, and **Export SKP**.
  - **Import SKP:** Direct entry point for importing SketchUp-optimized bridge files.
- **Embedded Webpage Browser:** Floating window for hosting external URLs (support for manufacturer docs, web-hosted assets, and live previews).
- **Developer Sub-Menu:** Centralized hub for developer tools.
  - **Console / Library / Documentation:** Accessible directly from the sub-menu.
  - **Product Spec:** New link that opens the `Spec` tab in the Developer Suite.
  - **AI Diagnostic Log:** Relocated from the Help menu to this sub-menu for better logical grouping.

## 4. Firestore Data Models

### `models/{modelId}`
```typescript
export interface CustomLight {
  id: string;
  type: 'point' | 'directional' | 'spot' | 'projector' | 'rect';
  color: string;
  intensity: number;
  position: [number, number, number];
  scale?: number; // Scaling multiplier for intensity/distance
  map?: string; // Texture URL for projector
  projectorMode?: 'texture';
}

export interface SceneAnimation {
  id: string;
  type: 'confetti' | 'fire' | 'smoke' | 'sparks' | 'magic_aura';
  position: [number, number, number];
  density: number;
  scale?: number;
  looping: boolean;
  playing: boolean;
}
```

### `collaborations/{collabId}`
```typescript
interface Collaborator {
  uid: string;
  email: string;
  modelId: string;
  status: 'invited' | 'active' | 'offline';
  role: 'owner' | 'collaborator';
}
```

## 5. Scripting API (SDK)

The `sdk` object is available in the Developer Console.

- `sdk.createBox({ width, height, depth, position })`
- `sdk.pushPull(shape, amount)`
- `sdk.applyColor(shape, color)`
- `sdk.setBevel(shape, { amount, type, segments })`
- `sdk.performCSG(targetId, cutterId, "SUBTRACTION")`
- `sdk.createPoly({ vertices: [[x,y,z], ...] })`
- `sdk.openWebpage(url)`: Opens an internal floating iframe with the specified URL.
- `sdk.getSyncStatus()`: Returns `'synced' | 'syncing' | 'error' | 'offline'`.
- `sdk.getCollaborators()`: Returns list of active users.
- `sdk.worldView.importMap({ lat, lng, zoom, altitude })`

## 6. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Select Tool |
| `E` | Eraser Tool |
| `B` | Paint Bucket |
| `R` | Rectangle Tool |
| `C` | Circle Tool |
| `P` | Push-Pull Tool |
| `M` / `G` | Move Tool |
| `Q` | Rotate Tool |
| `S` | Scale Tool |
| `O` | Orbit Tool |
| `H` | Pan Tool |
| `Z` | Zoom Tool |
| `X` | Subtract Tool |
| `D` | Deform Tool |
| `N` | Note Tool |
| `T` | Triangle Tool |

## 7. Diagnostic Utilities

### AI Diagnostic Log
- **Access:** Menubar -> Developer -> AI Diagnostic Log | **Keyboard Shortcut:** `Ctrl+Shift+L`.
- **Behavior:** Floating, draggable modal (via Framer Motion) providing a real-time high-fidelity stream of Three.js telemetry.
- **Engine v3.5 Features:**
  - **Live Telemetry:** 250ms buffered flush mechanism that captures telemetry from `useFrame` loops without impacting performance.
  - **Category Filtering:** Filter by `RENDER`, `FRAME`, `TEXTURE`, `EFFECT`, `EVENT`, and `ERROR`.
  - **Projector Diagnostics:** Specialized instrumentation for Projector Lights to monitor texture load status, video state, and rotation deltas.
- **Captured Data (Live interaction feed):**
  - **Environment:** THREE.REVISION and system timestamp.
  - **Interaction:** Mouse NDC, Raycaster origins, and Camera state.
  - **Mesh Telemetry:** `meshFound` (boolean), `meshWorldPosition` (decomposition), `meshLocalPosition`, `matrixAutoUpdate` status, and `parentId` (hierarchy monitoring).
  - **Control State:** `transformControlsAttached` (ID of object currently bound to gizmo).
  - **Snapshots:** Full JSON dump of the selected object's matrices and quaternions for AI-driven reconstruction.

## 8. Development Standards

### Input Control Architecture (v4.0)
- **Standard:** All inputs, textareas, and selects must be implemented as **Controlled Components**.
- **Initialization:** State variables bound to `value` props must be initialized with typed defaults (e.g., `''`, `0`, `'#ffffff'`) and never `null` or `undefined` to prevent React "uncontrolled to controlled" warnings.
- **Graceful Failover:** Optional object properties used in input values must implement fallbacks: `value={object?.property || ''}`.

## 9. Build and Deployment
- **Port:** Fixed to 3000.
- **Build Command:** `npm run build`
- **Output:** `dist/`
- **Runtime:** Node.js / Vite SPA.
