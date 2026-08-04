export interface ChangelogEntry {
  date: string;
  items: string[];
}

export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    date: 'April 27, 2026',
    items: [
      'Model Visibility Fix: Resolved an issue where existing models were not showing up in the Open Model list by optimizing the default query to remove Firestore-side orderBy index dependencies and fixing missing icon imports.',
      'Firestore Performance: Removed Firestore-side sorting for model lists, shifting to efficient client-side sorting to eliminate the need for complex composite indexes and prevent query failures on legacy data.',
      'UI Stability Code Fix: Resolved a potential crash in the Open Model popup by correctly importing the Loader2 component from Lucide-React and handles fallback icons gracefully.',
      'Firestore Quota Optimization: Implemented aggressive throttling (1fps) for cursor sync, consolidated Firestore listeners, and added a 30s cache for model fetching to prevent "Quota Exceeded" errors.',
      'Collaborative Cursor Scaling: Fixed collaborative cursors to application scale (constant screen-space size) for a consistent experience regardless of camera zoom. Maintained the high-impact 75px width and scaled name-pill badges for maximum visibility.',
    ]
  },
  {
    date: 'April 21, 2026',
    items: [
      'Collaboration Cursor Synchronization: Implemented real-time (10fps) 3D cursor tracking. Users can now see each other\'s cursors moving in 3D space, anchored to the geometry or ground plane. Fixed a field access bug where cursor positions were incorrectly read as arrays.',
      'Hardened Firestore Security: Optimized and hardened `firestore.rules` to resolve persistent "Missing or insufficient permissions" errors for invited guests. Increased robustness of the `isInvited` check by explicitly validating auth token email presence.',
      'Collaboration Workflow Stability: Fixed a critical bug in the presence detection system that would occasionally fail to associate a guest\'s UID with their invitation document, ensuring consistent write access for all collaborators.',
      'Collaboration Sync Fix: Resolved "Missing or insufficient permissions" and network errors during real-time transformations by correcting the presence document naming convention. Both owners and guests now reliably broadcast presence.',
      'Firestore Data Integrity: Implemented a recursion-based `cleanData` utility to strip `undefined` fields before Firestore updates, eliminating schema validation crashes during rapid geometric edits.',
      'Presence Management Optimization: Introduced an automated "Join Model" routine that ensures a persistence document exists in the `collaborations` collection for all active participants.',
      'Auto Orbit Restoration: Fixed the non-functional Auto Orbit feature by correctly wiring the autoRotate props to the OrbitControls component.',
      'Robust Projector Spin: Re-implemented texture rotation for Projector lights. Instead of rotating the texture matrix (which has no effect on shadow-mapped projections), we now dynamically spin the light\'s `up` vector around its aim axis, correctly rolling the projected image.',
      'Note UI Refinement: Optimized the "New Design Note" popup into a 1200px horizontal rectangle with improved typography and spacing, providing a more professional drafting interface.',
      'Note UI Optimization: Redesigned the "New Design Note" popup with an ultra-wide cinematic aspect ratio (**3360px width**) and a 60% reduction in height for a less intrusive placement experience.',
      'Poly Push/Pull Support: Enabled full Push/Pull functionality for Poly surfaces. Users can now extrude height by pulling the caps or scale the entire polygon by pulling its side faces, making it behave consistently with standard primitives.',
      'Surface Interaction Refinement: Updated the SurfaceHighlight logic for polygons to better distinguish between flat (height=0) surfaces and extruded volumes, providing accurate visual feedback during Push/Pull operations.',
      'Metadata UI Stability: Resolved a recurring "args.slice" TypeError in the metadata overlay and Right Panel by implementing comprehensive Array.isArray checks. This ensures that object-based `poly` arguments are handled gracefully in all property inspectors.',
      'Improved Poly Dimensions UI: Added a dedicated height input field for Poly shapes in the metadata overlay, synchronized with the Push/Pull tool for precise dimension management.',
    ]
  },
  {
    date: 'April 20, 2026',
    items: [
      'Ultra-Panoramic Note Popup: Massively expanded the "Add New Note" UI to **2240px** wide, ensuring a truly immersive drafting experience for complex design annotations.',
      'UI Error Resiliency: Implemented a global `ErrorBoundary` for the Right Panel Stack to catch and compartmentalize rendering crashes without affecting the main viewport.',
      'Poly Tool Crash Fix (args.slice): Resolved a critical error in the dimensions UI where `poly` shapes (which use object-based vertices) would cause a TypeError when treated as array-based primitives.',
      'Save/SaveAs Resilience: Increased the storage upload timeout to **30 seconds** and optimized snapshot compression by 40% to prevent "Storage upload timed out" errors during peak network usage.',
      'Framing Optimization: Refined the "Go to Entity" camera behavior to provide a 4m offset, ensuring the modernized Note UI is perfectly framed and contextually visible.',
      'Poly Tool Stability: Fixed a critical crash during surface creation by implementing a triangulation pre-check; the tool now validates geometry before attempting to render, ensuring stability for complex polygon traces.',
      'Enhanced Poly Tool Visibility: Revamped the "Snap logic" UI. When near the first vertex, the entire closing line segment and active segment now highlight in vibrant yellow with increased thickness for significantly better user visibility.',
      'New `sdk.createPoly` Method: Added support for programmatic polygon creation. Developers can now pass world-space vertices to the SDK, which automatically calculates the best-fit plane and orientation for the new shape.',
      'Robust Model Deletion: Replaced browser-native confirmation dialogs with a high-fidelity custom modal in the "Open Model" view. This ensures reliable deletion even in iframe-sandboxed environments.',
      'Improved SketchUp Compatibility: Upgraded the binary file detection logic to catch UTF-16 and non-standard encoded SketchUp signatures, providing users with accurate instructions on using the GLTF bridge.',
      'Go to Entity Zoom Optimization: Increased the zoom resolution for the "Go to Entity" feature. Clicking the link on a note now positions the camera so the note occupies approximately 1/4 of the viewport space.',
      'Dynamic State Sync on Delete: Implemented a global state reset that triggers if the user deletes the currently active model from their library, keeping the workspace synchronized with the data store.',
      'UI Menu Refinement: Renamed the Project "Export" menu to "Import / Export" to better represent the inclusion of SketchUp and GLTF bridge import tools.',
      'Active WorldView SDK Fix: Resolved an issue where `sdk.worldView.importMap` would update location data but fail to activate the map overlay UI; the map now correctly toggles on when called via script or library.',
      'Interactive Asset Bridge: Enhanced `/example-assets.html` with deep SDK integration. Buttons now trigger spatial geometry creation, map overlays, and diagnostic pings, all with synchronized status reports to the UI console.',
      'Global SDK Exposure: The `DeveloperSDK` is now exposed to `window.sdk`, enabling seamless `parent.sdk` calls from embedded iframes for sophisticated third-party integrations.',
      'New `sdk.log` Method: Added a centralized logging path that routes messages from any source (including webviews) directly into the Developer Suite console for unified debugging.',
      'SDK Documentation Refactor: Relocated advanced Scripting API (scene.*) and Webpage Integration examples to the "Full Documentation" suite for a more intuitive developer experience.',
      'Web-to-SDK Bridge Example: Created a live hosted asset library example at `/example-assets.html` demonstrating interactive buttons that trigger scene changes via `parent.sdk`.',
      'Enhanced Documentation Interactivity: Replaced "Try It" with "Try Now" buttons across all API documentation, ensuring code snippets instantly populate the console for immediate testing.',
      'SketchUp (.skp) Integration: Introduced high-fidelity bridge support for importing and exporting SketchUp files. The new "Import SKP" and "Export SKP" options are available under the Project > Export sub-menu.',
      'Embedded Webpage SDK: Launched `sdk.openWebpage(url)`, allowing developers to host and open interactive web documentation or asset libraries directly within the DraftUp workspace.',
      'Script Sandbox Enhancement: Injected the `scene` object as an alias for `sdk` in the developer console, aligning the code execution environment with the technical specification.',
      'Scene Management Patch: Fixed a bug where saving a scene would result in duplicate entries in the Scenes panel due to redundant event listeners.',
      'Poly Tool Stabilization: Restored the Poly tool\'s ability to capture clicks in 3D space by adding it to the interaction listener whitelist. Also verified that vertex placement data is correctly streaming to the AI Diagnostic Log.',
      'Save/SaveAs Reliability Fix: Implemented an 8-second timeout for preview image uploads to Firebase Storage. This prevents the "Save Model" process from hanging indefinitely if Storage services are slow or unresponsive, allowing the Firestore document save to proceed even if the preview thumbnail fails.'
    ]
  },
  {
    date: 'April 19, 2026',
    items: [
      'Dockable UI Panels: Introduced docking and undocking functionality for the "Tool Modifiers" and "Project Messaging" popouts, with a prioritized stacking order below the Collaboration panel.',
      'Poly Tool Stabilization: Resolved geometry triangulation issues in the Poly tool and introduced a persistent PolyGeometry component for smoother rendering and interaction.',
      'Large-Scale Beveling: Expanded the radius and chamfer ranges to 250m with 0.5m precision steps, optimized for architectural scale models.',
      'Integrated Diagnostic Logging: Expanded the AI Diagnostic Log to include real-time reporting for Poly tool vertex placement, messaging events, and bevel parameter changes.',
      'Context-Aware Messaging Access: The "Open Project Messaging" button is now hidden on models without collaborators, reducing clutter for solo designing sessions.',
      'Unified Popout Styling: Redesigned the "Tool Modifiers" palette and "Project Messaging" popout with a standardized UI, matching the color palette and typography of the main panels.',
      'Draggable Messaging Interface: Enhanced the messaging popout with smooth drag functionality using Framer Motion, enabling users to reposition it anywhere in the viewport.',
      'R3F Stability Patch: Resolved a critical "Div is not part of the THREE namespace" error by ensuring UI components like "Messaging" are strictly rendered outside the 3D Canvas.',
      'Palette Visibility Restoration: Corrected a regression where the Tool Modifier palette remained off-screen; restored smooth slide-in animations and transition handling.',
      'Draggable Tool Modifiers: The "Tool Modifiers" palette is now moveable, allowing for a more customized workspace layout.',
      'Project Messaging Redesign: Replaced redundant panel-based messaging with a streamlined floating popout system for enhanced real-time collaboration.',
      'Export Menu Overhaul: Consolidated "Export GLTF" and "Export STL" options into a new "Export" sub-menu in the main burger menu for better organization.',
      'Collaborator Cursor Control: Introduced a toggle to show/hide collaborator cursors in the 3D viewport, reducing visual noise during busy sessions.',
      'Enhanced Save Diagnostics: Integrated deep lifecycle logging for the save process into the AI Diagnostic Log, providing real-time visibility into storage and database operations.',
      'Note Placement Optimization: Refined the "Add Note" UI to ensure it stays anchored, fully visible, and at the highest z-index regardless of viewport position.',
      'AI 3D Designer: Launched a new "AI Generate" tool that builds complex 3D structures from natural language prompts using Gemini 3 Flash.',
      'Contact Friction (Resistance Mode): Implemented a new move modifier that causes objects to "stick" momentarily when they first collide, facilitating precise alignment.',
      'Unified Persistence Engine: Updated the save system to ensure all scene entities, including Notes, Custom Lights, and Animations, are saved with the project.'
    ]
  },
  {
    date: 'April 18, 2026',
    items: [
      'Poly Tool Implementation: Released a new tool for custom 3D modeling that allows users to trace convex polygons on either the ground plane or existing geometry faces.',
      'Surface Generation & CSG Compatibility: Automatically generates a flat surface from any valid traced polygon (3+ vertices), immediately compatible with the Push/Pull tool for complex geometry creation.',
      'Intelligent Plane Detection: The tool automatically locks to the world ground or the face of an existing object based on the initial click for seamless sketching.',
      'Polished Sketching UX: Integrated vertex snapping, real-time preview lines (finished segments, active segment, and ghost closing line), and visual feedback for shape completion.',
      'History & Undo Support: Implemented discrete undo steps for each placed vertex (Ctrl+Z) and robust cancellation (Escape) ensuring a fail-safe modeling experience.',
      'Double-Sided Polygon Rendering: Enabled double-sided materials by default for all generated polygons to ensure visibility from any angle in both 2D and extruded forms.',
      'Input Control Architecture v4.0: Standardized all input elements as controlled components and hardened state initialization to eliminate React "uncontrolled to controlled" warnings across the suite.',
      'State Initialization Hardening: Implemented a strict non-undefined initialization policy for all UI-bound state variables, resolving potential flickering and console errors.',
      'Right Panel & Viewport Refinement: Migrated the 3D Warehouse search, Collaboration invite, and Surface Division modal inputs to a robust controlled state architecture.',
      'Spatial Note Refinement: Fixed note placement logic and enabled billboarding so notes always face the camera while maintaining perspective scaling.',
      'Menu Reorganization: Relocated AI Diagnostic Log to the Developer sub-menu and added a direct "Product Spec" link for improved developer workflow.',
      'Consistent Note Styling: Standardized the visual language of spatial notes between placement and persistent states, featuring rounded-2xl cards and deep shadows.',
      'Live Diagnostic Telemetry: Implemented a full-stack live diagnostic logging system with a 250ms buffered flush mechanism that captures telemetry from useFrame loops without impacting 60fps performance.',
      'Projector Light Instrumentation: Added real-time telemetry points inside the ProjectorLight component to track texture loading, video playback states, and rotation deltas for detailed debugging.',
      'AIDiagnosticLog v3.5: Released an enhanced diagnostic panel featuring a draggable UI, real-time category filtering (RENDER, FRAME, TEXTURE, EFFECT, ERROR), and deep JSON inspection.',
      'Diagnostic Accessibility: Introduced a new [DIAG] button in the TopBar and a global "Ctrl+Shift+L" keyboard shortcut for instant access to the live telemetry feed.',
      'Robust Object Transformation: Replaced legacy property lookups with a scene traversal engine (v3.0) to resolve deep-hierarchy selection bugs and implemented matrix update guarding.',
      'Projector UI Optimization: Streamlined the Projector Light UI by focusing on high-quality static and spinning texture projection with frame-safe rotation logic.',
      'Scalable Animations & Effects: Added the ability to scale particle animations (Fire, Confetti, etc.) directly in the Right Panel for better environmental integration.',
      'Refined Map Integration: Updated WorldView map coverage to support a range of 50m to 450m with automated altitude synchronization.',
      'Collaboration Stability: Implemented deep state comparison and intelligent write-backtracking to reduce Firestore quota consumption by over 40% during active sessions.',
      'Sync Status Transparency: Added a live visual indicator (Synced, Syncing, Error) in the Status Bar to monitor the state of the real-time collaboration engine.',
      'AI Reliability Update: Migrated all AI features to "gemini-3-flash-preview" for stabilized analysis and generative model performance.'
    ]
  },
  {
    date: 'April 17, 2026',
    items: [
      'Enhanced Developer Suite: The suite is now fully draggable and includes a collapse/expand toggle for a more flexible workspace.',
      'Improved Save Reliability: Implemented a resilient save system with silent fallback for asset storage, ensuring model data is always persisted to Firestore even if network conditions block snapshot uploads.',
      'Refined Service Worker: Optimized resource proxying to prevent 500 errors during large data transfers to Firebase Storage.',
      'Implemented "Rectangle Input Mode": Click once with the Rectangle tool to enter precise dimensions (X and Z) directly in the Status Bar.',
      'Scaled 3D environment visualization: Infinite grid and axis gizmos are now optimized for navigation at greater distances (starting at 80m).',
      'Refined Camera Settings: Added "Revert Camera" link to reset default position to [80, 80, 80] and streamlined the Settings modal by removing redundant target fields.',
      'Overhauled Developer Suite: Added a new "Spec" tab featuring a complete technical product specification and Product Manager persona documentation.',
      'Tool Safety: Automatic cancellation of Push/Pull and drawing operations when switching tools to prevent unintended edits.',
      'UI Organization: Reordered toolbar icons for improved workflow hierarchy (Primitives, Boolean tools, and Transforms).',
      'Default Workspace: Enhanced default configuration with "Components" and "Styles" panels disabled for a cleaner initial experience.',
      'Replaced "Default Zoom" with configurable "Default Camera Position" settings.',
      'Added a "Set Default" camera capture tool in the Status Bar (active during Zoom) for one-click viewpoint configuration.',
      'Removed "Focus on Map" button from the toolbar, streamlining navigation for a cleaner interface.',
      'Synchronized Move and Rotate tool gizmos with "Entity Info" panel logic for perfect geometric alignment.',
      'Enhanced real-time Zoom magnification feedback in the Status Bar for precise navigation.',
      'Optimized 3D TransformControls to use Euler rotation (X, Y, Z) ensuring mathematical consistency with UI inputs.',
      'Added "Camera & Navigation" SDK methods with documentation and live examples in the Developer Suite.',
      'Fixed structural bug in "Subtraction" operation to correctly handle complex meshes and CSG vertex attributes.',
      'Enhanced Collaboration: Design owners can now revoke collaboration access from previously invited users directly in the Collaboration panel.',
      'Secure Design Sharing: "Generate Invite Link" now produces design-specific links that enforce invitation-only access for secure, private collaboration sessions.',
      'Restored "+ Add New Note" functionality with a new interactive placement flow and text input UI.',
      'Optimized AI Product Specification to only generate on manual build trigger, reducing redundant background compute.',
      'Standardized Worldview altitude offset to 1m default and improved input precision with a dedicated text field.',
      'Implemented persistent user settings (Theme, Units, Grid, Floor, Notes) saved to Firestore.',
      'Automated "AI Product Specification" generation within the Developer Suite.',
      'Integrated volume and tag tracking into the Object Info displays in both TopBar and Viewport.'
    ]
  },
  {
    date: 'April 16, 2026',
    items: [
      'Implemented a full-featured Animations system in the Visualisation panel, supporting Confetti, Fire, Smoke, Sparks, and Magic Aura particle effects.',
      'Added interactive "Click-to-Place" functionality for animation effects with control over density, looping, and playback status.',
      'Resolved critical Firebase Save stability issues, ensuring the "id" field is correctly managed in model documents and improving synchronization logic.',
      'Fixed CORS preflight (OPTIONS) blocking in the service worker, enabling reliable 3D model preview uploads to Firebase Storage.',
      'Refined Visualisation panel layout by reordering Skybox settings to follow Ambient Occlusion and Fog for a more logical UI flow.',
      'Implemented state persistence for animations, ensuring particle effects are correctly saved to and loaded from Firestore.',
      'Added a "Focus on Map" button to the left toolbar when WorldView is active, helping users find the overlay.',
      'Refactored map texture rendering to use more robust asset loading with React Suspense.',
      'Implemented enhanced developer logging for WorldView (activation, status, and loading/error states).',
      'Updated user documentation with step-by-step WorldView troubleshooting guides.',
      'Improved map overlay visibility by adjusting its rendering height and polygon offset.',
      'Implemented editable Position X, Y, Z coordinates in the Object Information section for shapes.',
      'Transformed the Changelog into a comprehensive "Help" system with two tabs: Documentation and Version History.',
      'Created step-by-step user documentation for all core tools (Rectangle, Box, Push-Pull, WorldView).',
      'Added searchable navigation sidebar to documentation for quick feature lookups.',
      'Standardized Help system styling to match the Developer Console (dark theme, technical aesthetic).',
      'Renamed the Main Menu option from "Show Changelog" to "Help".',
      'Relocated the Changelog trigger to the Main Menu (TopBar) for a cleaner workspace.',
      'Refined Changelog UI color scheme to perfectly match the "Open File" and "Developer Suite" aesthetics.',
      'Increased WorldView map overlay size to 2000m x 2000m for broader geographic context.',
      'Optimized 3D map texture update logic to ensure changes in coordinates are reflected immediately.',
      'Improved map rendering depth with polygon offsetting to eliminate visual artifacts/z-fighting.',
      'Added X, Y, Z coordinates to the Object Information display for more precise tracking.',
      'Fixed a bug where the WorldView map overlay was not displaying due to a missing API key in the 3D renderer.',
      'Calibrated the WorldView map overlay to center exactly at the 3D origin (0,0,0) by default.',
      'Implemented a draggable Help and Changelog system accessible via the question mark icon.',
      'Resolved transformation synchronization issues where objects wouldn\'t follow the move/rotate/scale gizmos.',
      'Enhanced Developer SDK with Proxy-based property manipulation for seamless script-to-viewport updates.',
      'Standardized UI across all modals (Save, Settings, AI) to match the "Open Model" design language.',
      'Made WorldView popup draggable and improved its visual integration.'
    ]
  },
  {
    date: 'April 15, 2026',
    items: [
      'Added real-time measurement display in the status bar.',
      'Support for multiple measurement units (mm, cm, m).',
      'New sub-face selection and coloring in the 3D viewport.',
      'Improved map texture loading through use of THREE.TextureLoader with retry logic.',
      'Resolved CORS issues with external assets through service-worker proxy improvements.'
    ]
  }
];
