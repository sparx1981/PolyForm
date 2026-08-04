// Technical Product Specification — DraftUp Developer Extensibility Suite
// Version 2.2.0 | Last Updated: 2026-04-27

import React, { useState } from 'react';
import { useApp } from '../../AppContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeatureCard {
  title: string;
  badges: string[];
  functional: string;
  implementation: string;
  source: string;
  tryItSnippet?: string;
}

interface Section {
  id: string;
  icon: string;
  title: string;
  subtitle?: string;
  cards: FeatureCard[];
}

interface ShortcutRow {
  key: string;
  action: string;
}

interface DataModelField {
  name: string;
  type: string;
  description: string;
}

interface DataModel {
  name: string;
  path: string;
  fields: DataModelField[];
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    background: '#0f1318',
    color: '#e2e8f0',
    height: '100%',
    width: '100%',
    padding: '0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '32px 36px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '6px',
  },
  headerIcon: {
    width: '32px',
    height: '32px',
    background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: '16px',
  },
  h1: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#f1f5f9',
    margin: 0,
    letterSpacing: '-0.3px',
  },
  subtitle: {
    fontSize: '13px',
    color: '#64748b',
    margin: '0 0 20px 44px',
  },
  metaBadges: {
    display: 'flex',
    gap: '8px',
    marginLeft: '44px',
    flexWrap: 'wrap' as const,
  },
  metaBadge: {
    padding: '3px 10px',
    borderRadius: '20px',
    fontSize: '11px',
    fontWeight: '500',
    background: 'rgba(59,130,246,0.15)',
    color: '#60a5fa',
    border: '1px solid rgba(59,130,246,0.2)',
  },
  body: {
    padding: '0 36px 48px',
    flex: 1,
    overflowY: 'auto',
  },
  // ── Tech tiles (like Gemini / CSG at top) ──
  techGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '12px',
    margin: '24px 0',
  },
  techTile: {
    background: '#1a2035',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '10px',
    padding: '18px 20px',
    cursor: 'default',
  },
  techTileTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: '5px',
  },
  techTileDesc: {
    fontSize: '12px',
    color: '#64748b',
    lineHeight: '1.5',
  },
  // ── Section heading ──
  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: '36px 0 16px',
  },
  sectionIcon: {
    fontSize: '18px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#f1f5f9',
    margin: 0,
  },
  // ── Feature card ──
  featureCard: {
    background: '#141922',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '12px',
    padding: '22px 24px',
    marginBottom: '14px',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '14px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#f1f5f9',
    margin: 0,
  },
  cardBadges: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap' as const,
  },
  badge: {
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.5px',
    background: '#1e293b',
    color: '#94a3b8',
    border: '1px solid rgba(255,255,255,0.07)',
    textTransform: 'uppercase' as const,
  },
  divider: {
    height: '1px',
    background: 'rgba(255,255,255,0.07)',
    margin: '0 0 16px',
  },
  cardCols: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px',
  },
  cardColsSingle: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '20px',
  },
  colLabel: {
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '1px',
    color: '#2dd4bf',
    textTransform: 'uppercase' as const,
    marginBottom: '8px',
  },
  colText: {
    fontSize: '13px',
    color: '#94a3b8',
    lineHeight: '1.65',
    margin: 0,
  },
  sourceLabel: {
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '1px',
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
    marginTop: '16px',
    marginBottom: '6px',
  },
  sourceCode: {
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
    fontSize: '11px',
    color: '#94a3b8',
    background: '#0d1117',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '6px',
    padding: '8px 12px',
    display: 'block',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  // ── Shortcut table ──
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    marginTop: '4px',
  },
  th: {
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.8px',
    color: '#2dd4bf',
    textTransform: 'uppercase' as const,
    padding: '8px 12px',
    textAlign: 'left' as const,
    borderBottom: '1px solid rgba(255,255,255,0.07)',
  },
  td: {
    fontSize: '13px',
    color: '#94a3b8',
    padding: '8px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    verticalAlign: 'top' as const,
  },
  kbd: {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: '11px',
    background: '#1e293b',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '4px',
    padding: '2px 6px',
    color: '#e2e8f0',
    display: 'inline-block',
  },
  // ── Data model ──
  modelCard: {
    background: '#141922',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '12px',
    padding: '20px 24px',
    marginBottom: '14px',
  },
  modelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px',
  },
  modelName: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#f1f5f9',
  },
  modelPath: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11px',
    color: '#60a5fa',
    background: 'rgba(59,130,246,0.1)',
    border: '1px solid rgba(59,130,246,0.2)',
    borderRadius: '4px',
    padding: '2px 8px',
  },
  fieldRow: {
    display: 'grid',
    gridTemplateColumns: '160px 140px 1fr',
    gap: '12px',
    padding: '6px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    alignItems: 'start',
  },
  fieldName: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12px',
    color: '#a5f3fc',
  },
  fieldType: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12px',
    color: '#fbbf24',
  },
  fieldDesc: {
    fontSize: '12px',
    color: '#64748b',
  },
  // ── Tab bar (for main nav) ──
  tabBar: {
    display: 'flex',
    gap: '2px',
    padding: '0 36px',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    background: '#0f1318',
    zIndex: 10,
  },
  tab: {
    padding: '12px 16px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#64748b',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    transition: 'color 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap' as const,
    background: 'none',
    border: 'none',
    outline: 'none',
  },
  tabActive: {
    color: '#f1f5f9',
    borderBottom: '2px solid #3b82f6',
  },
  // ── Panel controls info ──
  controlRow: {
    display: 'grid',
    gridTemplateColumns: '200px 1fr',
    gap: '12px',
    padding: '6px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    alignItems: 'start',
  },
  controlName: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12px',
    color: '#a5f3fc',
  },
  controlDesc: {
    fontSize: '12px',
    color: '#64748b',
    lineHeight: '1.5',
  },
};

// ─── Data ─────────────────────────────────────────────────────────────────────

const TECH_TILES = [
  { title: 'Three.js + R3F', desc: 'WebGL 3D rendering engine with React Three Fiber for declarative scene management.' },
  { title: 'Google Gemini AI', desc: 'LLM integration for generative 3D logic, scripting assist, and project analysis.' },
  { title: 'Three-BVH-CSG', desc: 'Optimised Constructive Solid Geometry for real-time boolean operations (Push/Pull, Subtract).' },
  { title: 'Firebase / Firestore', desc: 'Real-time persistence, authentication, file storage, and multi-user presence sync.' },
  { title: 'TypeScript + Vite', desc: 'Strongly-typed codebase with fast HMR dev server and optimised production builds.' },
  { title: 'WorldView / OSM', desc: 'Geo-anchored satellite tile overlay using OpenStreetMap proxied tile service.' },
];

const TOOL_SECTIONS: Section[] = [
  {
    id: 'selection',
    icon: '🖱',
    title: 'Selection & Editing Tools',
    cards: [
      {
        title: 'Select Tool',
        badges: ['SHORTCUT: S / ESC', 'RAYCASTING'],
        functional: 'The primary interaction tool. Click to select individual mesh objects or sub-faces in the viewport. Shift-click extends multi-selection. Clicking empty space clears selection. Right-click opens the context menu (Duplicate, Delete, Isolate, Group, Assign Material, Add Note). Pressing F while an object is selected enters face-selection mode, highlighting individual faces for per-face colour or deletion operations.',
        implementation: 'Fires a THREE.Raycaster on every pointerdown event against the scene\'s object array. Hit objects are stored in AppContext.selectedObjectIds[]. Face selection uses the BVH accelerated mesh intersect to resolve faceIndex from the intersection result. The Transform Gizmo (TransformControls) attaches to the selection\'s computed bounding box centre.',
        source: 'src/components/Viewport.tsx (handlePointerDown)\nsrc/context/AppContext.tsx (selectedObjectIds)',
      },
      {
        title: 'Eraser Tool',
        badges: ['SHORTCUT: E', 'BRUSH'],
        functional: 'Brush-style deletion. Pointer-down and drag removes geometry intersected within the circular brush radius. Works in two modes: Object Mode (deletes entire meshes) and Face Mode (removes individual faces, capping holes). Brush radius is adjustable in the tool options strip (0.1 m – 5.0 m). All deletions are undoable.',
        implementation: 'Renders a screen-space circle overlay tracking cursor position. On each pointermove while pressed, fires a sphere-cast at the brush position. In Face Mode, removes matching face indices from the geometry\'s index buffer and recomputes normals. Mutations are pushed to the undo stack before applying.',
        source: 'src/tools/EraserTool.ts\nsrc/utils/geometry.ts (removeFaces)',
      },
      {
        title: 'Paint Bucket Tool',
        badges: ['SHORTCUT: P', 'MATERIAL'],
        functional: 'Click any face or object to apply the currently active material from the Materials Panel. In Object Mode, the material is assigned to the entire mesh. In Face Mode (toggle F in tool options), only the clicked face receives the material override. Drag-painting continuously applies the material to all faces the cursor crosses while held.',
        implementation: 'On pointerdown, raycasts to determine hit mesh and faceIndex. Calls applyMaterial(materialId, objectId) or applyMaterialToFace(materialId, objectId, faceIndex) on AppContext. Face overrides are stored in the SceneObject.faceColors map and serialised to Firestore on save.',
        source: 'src/tools/PaintBucketTool.ts\nsrc/context/AppContext.tsx (applyMaterialToFace)',
      },
    ],
  },
  {
    id: 'drawing',
    icon: '✏️',
    title: 'Drawing & Primitive Tools',
    cards: [
      {
        title: 'Line Tool',
        badges: ['SHORTCUT: L', 'THREE.LINE'],
        functional: 'Click to place vertices sequentially, forming a polyline. Each click anchors a vertex; the mouse preview shows the next segment. Grid-snap aligns vertices to the configured grid resolution. Double-click or Enter terminates the line. The result is a THREE.Line object stored as a LineObject in the scene.',
        implementation: 'Maintains a mutable vertices array during placement. On each click, a new Vector3 is added. A preview Line mesh updates on pointermove. On termination, the final LineGeometry is created and added to the scene via addSceneObject(). The Closed Path option adds a segment from last to first vertex.',
        source: 'src/tools/LineTool.ts\nsrc/components/Viewport.tsx',
      },
      {
        title: 'Rectangle Tool',
        badges: ['SHORTCUT: R', 'PLANEGEOMETRY'],
        functional: 'Click-drag to define a flat rectangle on the XZ ground plane (or on the surface of an existing face). Shift constrains to a square. Live dimension labels show width and depth during drag. On release, a PlaneGeometry mesh is created. Corner Radius (0–1 m) and Extrude Height can be set in tool options before or after placement.',
        implementation: 'Stores the pointer-down world position as anchor. On pointermove, computes the delta to form a bounding rect. Renders a preview PlaneGeometry scaled to the drag delta. On pointerup, commits the final geometry. If Corner Radius > 0, uses RoundedBoxGeometry from the drei helpers.',
        source: 'src/tools/RectangleTool.ts',
      },
      {
        title: 'Circle Tool',
        badges: ['SHORTCUT: C', 'CIRCLEGEOMETRY'],
        functional: 'Click to set centre, drag to define radius, release to create. Renders a flat CircleGeometry mesh. The segment count (8–128, default 32) controls polygon smoothness and is configurable in the tool options strip. An optional Extrude Height instantly converts the circle to a cylinder.',
        implementation: 'Computes radius as the distance from anchor to current pointer position in world space. Updates a preview CircleGeometry each frame during drag. Segment count is read from tool state. On commit, the final mesh is created and persisted to AppContext.',
        source: 'src/tools/CircleTool.ts',
      },
      {
        title: 'Triangle Tool',
        badges: ['SHORTCUT: T', 'BUFFERGEOMETRY'],
        functional: 'Click-drag to create a triangle. Default mode creates an equilateral triangle sized by drag distance. Holding Shift at release switches to right-angle mode where the drag vector becomes the hypotenuse. A mode selector in the tool options offers Equilateral, Isosceles, and Right-Angle variants.',
        implementation: 'Constructs a custom BufferGeometry with 3 vertices. For equilateral mode, derives vertices from centroid and circumradius. For right-angle, uses drag start/end as two vertices and computes the third via perpendicular projection. Normal is computed and assigned before commit.',
        source: 'src/tools/TriangleTool.ts\nsrc/utils/geometry.ts',
      },
      {
        title: '3D Primitives Tool',
        badges: ['SHORTCUT: B', '8 TYPES'],
        functional: 'Expands inline into a Primitive Picker strip: Box, Sphere, Cylinder, Cone, Torus, Capsule, Wedge, Pyramid. Click a thumbnail, then click-drag in the viewport to place. Drag footprint defines the XZ bounding; vertical mouse movement sets height. Placed primitives are immediately selected with their parameters editable in the Properties Panel.',
        implementation: 'Each primitive type maps to a Three.js geometry constructor. Placement uses a two-phase pointer handler: phase 1 (pointerdown → pointermove) defines the XZ footprint via a bounding rect; phase 2 (pointermove with button held) maps mouse Y delta to height. Final geometry is constructed from computed dimensions and added as a SceneObject.',
        source: 'src/tools/PrimitiveTool.ts\nsrc/components/PrimitivePicker.tsx',
        tryItSnippet: 'sdk.addBox({ width: 2, height: 2, depth: 2 });',
      },
      {
        title: 'Poly Tool',
        badges: ['SHORTCUT: P', 'NEW', 'SHAPEGEOMETRY'],
        functional: 'Place sequential vertices on surfaces or the ground. Enter to close. Generates flat polygon meshes with optimized triangulation.',
        implementation: 'Uses THREE.Shape and dynamic projection to the first-vertex plane. Stabilized via PolyGeometry component. Features real-time self-intersection prevention and detailed diagnostic logging for debugging vertex placement and orientation.',
        source: 'src/components/Viewport.tsx (finalizePoly)',
        tryItSnippet: 'sdk.createPoly({ vertices: [[0,0], [5,0], [5,5], [0,5]] });',
      },
    ],
  },
  {
    id: 'modelling',
    icon: '🔧',
    title: '3D Modelling Tools',
    cards: [
      {
        title: 'Bevel Tool',
        badges: ['SHORTCUT: V', 'LARGE MODELS', 'MODIFIED'],
        functional: 'Highlight edges on the selected object. Drag to apply a bevel. Optimized for large-scale models with an expanded range (up to 250m) and 0.5m precision steps.',
        implementation: 'Scaled range input (0-250m) in the tool modifier palette. Uses HalfEdge structures for underlying geometry mutation. Real-time diagnostic logging is active for performance monitoring.',
        source: 'src/tools/BevelTool.ts\nsrc/components/ToolModifierPalette.tsx',
        tryItSnippet: 'sdk.applyBevel({ radius: 10, segments: 4 });',
      },
      {
        title: 'Push / Pull Tool',
        badges: ['SHORTCUT: U', 'CSG', 'EXTRUDE'],
        functional: 'Hover any flat face to highlight it. Click and drag along the face normal to extrude outward (pull) or indent inward (push). A live distance label shows the extrusion amount. Type a numeric value then Enter for precision input. Supports multi-face extrusion when faces are pre-selected. Results are stored as custom geometry.',
        implementation: 'On face hover, computes the face normal using the BufferGeometry index and position attributes. On pointerdown, constrains all subsequent pointer movement to the normal axis. Constructs new side faces and a cap geometry at the offset position. Uses three-bvh-csg\'s Evaluator for cases where the push operation results in boolean intersection.',
        source: 'src/components/Viewport.tsx (handlePushPullPointerMove)\nsrc/utils/performCSGOperation.ts',
      },
      {
        title: 'Subtract Mode (CSG)',
        badges: ['SHORTCUT: X', 'THREE-BVH-CSG', 'BOOLEAN'],
        functional: 'CSG Boolean Subtraction. Workflow: select the target object, activate Subtract Mode, click the cutter object. A preview of the subtracted result renders before confirmation. Press Enter or click Apply to commit — the cutter is consumed and the target becomes a modified custom mesh. A "Keep Cutter" option in tool options retains the cutter post-operation.',
        implementation: 'Uses the Evaluator from three-bvh-csg to perform a SUBTRACTION operation between the target and cutter MeshBVH geometries. The resulting geometry is a new BufferGeometry converted back to a SceneObject of type "custom" and stored with its serialised vertex/index buffers in Firestore. Smooth Normals toggle calls computeVertexNormals() on the result.',
        source: 'src/utils/performCSGOperation.ts\nsrc/tools/SubtractTool.ts',
      },
      {
        title: 'Move Tool',
        badges: ['SHORTCUT: G', 'TRANSFORMCONTROLS'],
        functional: 'Activates the Translation Gizmo: X/Y/Z axis arrows (red/green/blue) and XY/XZ/YZ plane squares. Drag an axis arrow to constrain to that axis; drag a plane handle for free 2-plane movement. Type a numeric offset after initiating a move for precision. Grid Snap constrains to the configured grid increment. Multiple selected objects move as a group.',
        implementation: 'Attaches THREE.TransformControls in "translate" mode to the selection\'s pivot object. Axis/plane constraints are set via setAxis() on the TransformControls instance. On dragend, reads the final world position delta and applies it to all selected SceneObjects. Numeric input intercepts keydown events during an active drag.',
        source: 'src/components/TransformGizmo.tsx\nsrc/tools/MoveTool.ts',
      },
      {
        title: 'Rotate Tool',
        badges: ['SHORTCUT: SHIFT+R', 'TRANSFORMCONTROLS'],
        functional: 'Activates the Rotation Gizmo: X/Y/Z arc rings. Drag an arc to rotate around that axis. Live degree readout appears near the gizmo. Angle Snap (toggleable in Settings) constrains to 15° increments. Numeric input allows typing a precise degree value. Pivot Point options: Object Centre, World Origin, or Cursor.',
        implementation: 'Attaches THREE.TransformControls in "rotate" mode. Pivot Point setting adjusts the pivot group\'s world position before attaching. Angle Snap is implemented by rounding the drag delta to the nearest 15° in the change event handler. Final Euler angles are converted to degrees and written back to SceneObject.rotation.',
        source: 'src/components/TransformGizmo.tsx\nsrc/tools/RotateTool.ts',
      },
      {
        title: 'Scale Tool',
        badges: ['SHORTCUT: SHIFT+S', 'TRANSFORMCONTROLS'],
        functional: 'Activates the Scale Gizmo: X/Y/Z axis handles for non-uniform scale plus a central white cube for uniform scale. Drag any axis handle for per-axis scaling; drag the central handle for uniform scaling. Live multiplier label (e.g. ×1.50). Numeric input accepts a multiplier value. Scale is written to the SceneObject.scale vector; actual computed sizes are stored in Firestore.',
        implementation: 'Attaches THREE.TransformControls in "scale" mode. Uniform scale is detected when the central handle is dragged by checking which axis handle is active. Scale values are clamped to a minimum of 0.001 to prevent degenerate geometry. On dragend, the Object3D.scale components are read and persisted.',
        source: 'src/components/TransformGizmo.tsx\nsrc/tools/ScaleTool.ts',
      },
    ],
  },
  {
    id: 'sculpt',
    icon: '🎨',
    title: 'Deformation & Sculpting Tools',
    cards: [
      {
        title: 'Deformation Brush',
        badges: ['SHORTCUT: D', 'VERTEX DISPLACEMENT', 'SCULPT'],
        functional: 'Brush-based vertex displacement along surface normals. Push outward by default; Alt held inverts to pull inward. A spherical brush indicator renders on the mesh surface showing radius and falloff zone. Displacement attenuates from the brush centre via a Gaussian curve. Modes: Push, Pull, Smooth, Flatten, Pinch. Symmetry mirrors deformation across X, Y, or Z. Results stored as custom geometry.',
        implementation: 'On each pointermove while pressed, collects all BufferGeometry vertices within the brush radius via BVH sphere-cast. For each vertex, computes the displacement magnitude using a Gaussian falloff: strength × exp(−(dist² / (2 × radius²))). Mutates the geometry\'s position attribute Float32Array in place. After pointer release, calls computeVertexNormals(). For symmetry, mirrors the affected vertex positions across the selected axis after each stroke.',
        source: 'src/tools/DeformTool.ts\nsrc/utils/geometry.ts (gaussianFalloff)',
      },
    ],
  },
  {
    id: 'navigation',
    icon: '🧭',
    title: 'Viewport Navigation Tools',
    cards: [
      {
        title: 'Orbit',
        badges: ['SHORTCUT: O / ALT+DRAG', 'ORBITCONTROLS'],
        functional: 'Rotates the camera around the orbit target (default: world origin or selection centre). Horizontal drag adjusts azimuth; vertical drag adjusts elevation, clamped at ±89°. Press F with an object selected to refocus the orbit target on the selection bounding box centre. Double-clicking an object selects it and refocuses simultaneously.',
        implementation: 'Wraps THREE.OrbitControls. The orbit target is a THREE.Vector3 stored in viewport state. On F key, computes the selection bounding box centre and calls controls.target.copy(centre) then controls.update(). The perspective camera position is spherically interpolated to maintain current zoom distance.',
        source: 'src/components/Viewport.tsx (OrbitControls config)',
      },
      {
        title: 'Pan',
        badges: ['SHORTCUT: H / MMB+DRAG', 'ORBITCONTROLS'],
        functional: 'Translates the camera parallel to the current view plane. Middle Mouse Drag or Shift+Left Drag activates pan at any time regardless of active tool. Pan speed scales with camera distance — fine near geometry, coarse at distance. In orthographic views, pan maps directly to world-space offset.',
        implementation: 'Handled natively by THREE.OrbitControls panSpeed. Speed scaling uses the formula panSpeed = cameraDistance × 0.002. Shift+LMB is intercepted in the viewport\'s pointerdown handler and temporarily sets controls.mouseButtons.LEFT to THREE.MOUSE.PAN for the duration of the gesture.',
        source: 'src/components/Viewport.tsx (pan intercept logic)',
      },
      {
        title: 'Zoom',
        badges: ['SHORTCUT: Z / SCROLL', 'ORBITCONTROLS'],
        functional: 'Dollies the camera toward the orbit target. Scroll up = zoom in; scroll down = zoom out. Speed exponentially slows when very close to prevent geometry clipping. Ctrl+Scroll zooms 10× faster. F fits the current selection to view; Shift+F fits all scene geometry.',
        implementation: 'Zoom is handled by OrbitControls zoomSpeed. Exponential slowdown is implemented by multiplying zoomSpeed by Math.min(1, cameraDistance / 0.5) when distance < 0.5 m. Fit-to-selection computes the selection bounding sphere, then moves the camera to distance = sphere.radius × 2.5 along the current view direction.',
        source: 'src/components/Viewport.tsx (zoom handlers, fitToSelection)',
      },
      {
        title: 'WorldView GeoLocation',
        badges: ['SHORTCUT: W', 'OSM TILES', 'GEOLOCATION'],
        functional: 'Toggles the geo-anchored map tile overlay on the XZ ground plane. When active, a satellite/street map tile is projected at real-world scale (1 unit = 1 m). The tile is fetched using the lat/lon configured in the WorldView Panel. "Focus on Map" flies the camera to a top-down overhead view of the tile. The overlay can be toggled without interrupting the active modelling tool.',
        implementation: 'Loads the map tile as a THREE.Texture via a proxied fetch to prevent CORS issues. The texture is applied to a PlaneGeometry mesh scaled to the real-world tile extent in metres (computed from lat/lon zoom level using the Mercator tile formula). Tile URL is constructed as: /tile-proxy/{zoom}/{x}/{y}.png. The overlay mesh\'s renderOrder is set to -1 so it renders beneath all scene geometry.',
        source: 'src/components/WorldViewOverlay.tsx\nsrc/utils/tileUtils.ts (latLonToTileXY)',
      },
    ],
  },
];

const PANEL_CARDS: FeatureCard[] = [
  {
    title: 'Properties Panel',
    badges: ['TRANSFORM', 'GEOMETRY', 'OBJECT FLAGS'],
    functional: 'Displays and edits the selected object\'s full state. Transform Section: Name, Position XYZ, Rotation XYZ (degrees), Scale XYZ with linked uniform toggle, Reset Transform button. Geometry Section: Shape Type label, dynamic shape parameters (Width/Height/Depth for box; Radius/Segments for sphere, etc.), Subdivide, Flip Normals, Merge Vertices utilities. Object Section: Visible toggle, Locked toggle, Cast/Receive Shadow toggles, Delete button.',
    implementation: 'Reads AppContext.selectedObjectIds[0] and renders controlled inputs bound to the corresponding SceneObject fields. Each input onChange calls updateSceneObject(id, delta) which updates both the Three.js Object3D transform and the AppContext state. Firestore sync is debounced 500 ms to batch rapid slider changes.',
    source: 'src/components/Panels/PropertiesPanel.tsx',
  },
  {
    title: 'Materials Panel',
    badges: ['PBR', 'COLOUR PICKER', 'TEXTURE URL', 'FACE OVERRIDE'],
    functional: 'Material Library: a grid of Material Cards (swatch, name, type badge) with + New Material and context menu per card (Rename, Duplicate, Delete, Apply to Selection). Active material indicated by highlighted border. Material Editor: Type toggle (Solid Colour / Texture URL), Colour Picker with HEX/HSL/RGB modes, Texture URL + Load, UV Tiling. PBR Properties: Roughness (0–1), Metalness (0–1), Opacity (0–1), Emissive Colour and Intensity, Wireframe toggle. Face Overrides section when a face selection exists.',
    implementation: 'Materials are stored in Firestore /materials/{materialId} and mirrored in AppContext.materials[]. On Apply, a THREE.MeshStandardMaterial is constructed from the Material record and assigned to the target mesh. Texture loading uses THREE.TextureLoader with the tile proxy for cross-origin URLs. Face overrides are stored in SceneObject.faceColors and applied via a multi-material groups array on the mesh.',
    source: 'src/components/Panels/MaterialsPanel.tsx\nsrc/hooks/useMaterials.ts',
  },
  {
    title: 'Scene Panel',
    badges: ['OUTLINER', 'HIERARCHY', 'LAYERS'],
    functional: 'Hierarchical object outliner. Rows show visibility toggle, lock toggle, object name, shape type badge. Click selects the object (synced with viewport). Drag-and-drop re-parents objects into Groups. Right-click context menu: Rename, Duplicate, Group, Delete, Focus in Viewport. Search bar filters by name. Scene Stats footer shows total Objects, Triangles, Vertices, and Materials.',
    implementation: 'Renders a virtualised list of SceneObjects from AppContext. Parent-child relationships are determined by SceneObject.parentId. Drag-and-drop uses the HTML5 draggable API; on drop, updates the dragged object\'s parentId and recalculates the Three.js scene graph parent via scene.attach(). Stats are computed from the Three.js renderer.info object.',
    source: 'src/components/Panels/ScenePanel.tsx\nsrc/hooks/useSceneHierarchy.ts',
  },
  {
    title: 'Visualisation Panel',
    badges: ['LIGHTING', 'FOG', 'SKYBOX', 'ANIMATIONS', 'PARTICLE FX'],
    functional: 'Lighting: Ambient and Directional light intensity/colour, Shadow Quality (Off/Low/Medium/High), Sun Azimuth and Elevation sliders. AO: Enable toggle, Radius (0.1–5 m), Intensity (0–2). Fog: Enable toggle, Colour, Density (0.001–0.1). Skybox: Type (None/Gradient/HDRI/Solid), gradient pickers, HDRI URL loader. Animations: list of placed particle effects with per-effect controls: Type (Confetti, Fire, Smoke, Sparks, Magic Aura), Density, Loop, Play/Stop, XYZ position, Delete.',
    implementation: 'Lighting controls mutate the scene\'s AmbientLight and DirectionalLight instances directly via refs stored in ViewportContext. Shadow Quality sets the DirectionalLight.shadow.mapSize. Skybox type changes swap the scene.background/environment. Particle effects use a custom ParticleSystem class per type; emitter positions and parameters are stored in SceneAnimation[] in Firestore and reconstructed on load.',
    source: 'src/components/Panels/VisualisationPanel.tsx\nsrc/rendering/ParticleSystem.ts',
  },
  {
    title: 'WorldView Panel',
    badges: ['GEOLOCATION API', 'OSM TILES', 'GEOCODER'],
    functional: 'Geo Location: Latitude/Longitude numeric inputs, Use My Location button (Geolocation API), Address Search geocoder. Map Display: Tile Style dropdown (Street/Satellite/Topographic), Tile Zoom Level (14–20), Map Opacity (0–1), Map Scale read-only label. Utilities: Focus on Map (overhead camera), North Indicator toggle, True North Alignment button (rotates scene to align +Z with True North).',
    implementation: 'lat/lon values are stored in AppContext.geoLocation and persisted to the Model document in Firestore. Tile fetching uses the formula: tileX = floor((lon + 180) / 360 × 2^zoom). The tile proxy at /tile-proxy/ handles CORS. True North rotation computes the magnetic declination offset from the longitude and applies a one-time Y-axis rotation to the scene root object.',
    source: 'src/components/Panels/WorldViewPanel.tsx\nsrc/utils/tileUtils.ts',
  },
  {
    title: 'Measurements Panel',
    badges: ['UNITS', 'TAPE MEASURE', 'BOUNDING BOX'],
    functional: 'Unit System: Display Unit toggle (mm/cm/m), Grid Resolution dropdown, Show Grid toggle. Tape Measure: click-activate, place two points in 3D space, dimension label rendered. Measurement List: all created measurements with label, distance, anchor type, delete button. Selection Dimensions auto-section: Width, Height, Depth, Surface Area (m²), Volume (m³) computed from the selected object bounding box and mesh data.',
    implementation: 'Unit conversion is applied at the display layer: all internal values are in metres. The active unit multiplier is derived from AppContext.settings.unit. Tape Measure placements are stored as Measurement[] objects in scene state. Bounding box dimensions use THREE.Box3.getSize(). Volume is computed via signed tetrahedron decomposition of all mesh faces.',
    source: 'src/components/Panels/MeasurementsPanel.tsx\nsrc/utils/measureUtils.ts',
  },
  {
    title: 'Notes Panel',
    badges: ['SPATIAL NOTES', 'SHORTCUT: N', 'STATUS TRACKING'],
    functional: '+ Add Note activates placement mode — click any surface in the viewport to anchor a pin. Show All Notes toggle. Filter by Status dropdown (All/Open/In Progress/Resolved). Note cards show author avatar, name, timestamp, editable text, status badge (Open=yellow, In Progress=blue, Resolved=green), Go to Note camera fly-to, and Delete. Pins are circular icons at the anchor point, scaling to constant screen size; hover shows a tooltip; click opens inline editor.',
    implementation: 'SpatialNote records are stored in the Model document\'s notes[] array in Firestore. Pins are rendered as THREE.Sprite objects parented to a Notes layer group. Status colour is applied via sprite material colour. Go to Note calls controls.target.copy(note.position) and animates the camera distance to 2 m for close-up view. Note pin screen size is maintained by updating sprite scale = cameraDistance × 0.04 on each render.',
    source: 'src/components/Panels/NotesPanel.tsx\nsrc/components/NotePins.tsx',
  },
  {
    title: 'Collaboration Panel',
    badges: ['MESSAGING', 'DOCKABLE', 'MODIFIED'],
    functional: 'Invite team members and manage real-time messaging. The Messaging entry point is now context-aware and only visible when collaborators are present. Supports independent docking/undocking from the right-hand panel stack.',
    implementation: 'React-based sub-panel management. Messaging visibility gated by presence. Docking functionality integrated into RightPanelStack.',
    source: 'src/components/RightPanelStack.tsx\nsrc/components/Messaging.tsx',
    tryItSnippet: 'sdk.openMessaging();',
  },
  {
    title: 'Scripts / Developer Panel',
    badges: ['JS SANDBOX', 'MONACO EDITOR', 'DRAFTUP API'],
    functional: 'Script Library: saved scripts from Firestore with Run, Edit, Delete per card. Script Editor: Monaco/CodeMirror editor with JS highlighting, DraftUp API auto-complete, Name/Description fields, Save/Run/Clear Output buttons. Script Output Console: terminal-style scrollable output, console.log() routed here, errors in red with stack traces. Sandbox: no DOM/window access; DraftUp API object injected into scope; async scripts supported; 5-second execution timeout.',
    implementation: 'Scripts are stored in Firestore /scripts/{scriptId}. Execution wraps the script code in an async IIFE inside a new Function() constructor with a restricted scope: new Function("scene", "console", scriptCode)(draftUpAPI, sandboxedConsole). The draftUpAPI object is constructed fresh on each run from the current AppContext state. Timeout is enforced via a Promise.race with a 5 s rejection.',
    source: 'src/components/Panels/ScriptsPanel.tsx\nsrc/scripting/sandbox.ts\nsrc/scripting/DraftUpAPI.ts',
  },
  {
    title: 'Settings Panel',
    badges: ['THEME', 'UNITS', 'DISPLAY', 'ACCOUNT'],
    functional: 'Appearance: Light/Dark theme toggle, Accent Colour picker, Banner Colour picker, Panel Order drag-and-drop reorder list. Units & Grid: Default Unit, Grid Enabled toggle, Grid Resolution, Show Floor toggle, Angle Snap toggle. Display: Show Gizmos, Show Object Labels, Show Edge Highlights, Render Quality (Low 0.75×/Medium 1×/High 1.5× SSAA), Shadows Enabled master toggle. Account: Display Name (editable), Email (read-only), Sign Out, Delete Account (with confirmation).',
    implementation: 'Settings are persisted to Firestore /user_settings/{uid} and loaded on auth. Theme toggle adds/removes the "dark" class on document.body. Accent Colour updates the --color-accent CSS variable via document.documentElement.style.setProperty(). Render Quality calls renderer.setPixelRatio(). Panel order is stored in localStorage keyed by userId and applied to the RightPanelStack render order.',
    source: 'src/components/Panels/SettingsPanel.tsx\nsrc/hooks/useUserSettings.ts',
  },
];

const SHORTCUTS: ShortcutRow[] = [
  { key: 'S / Esc', action: 'Select Tool' },
  { key: 'E', action: 'Eraser Tool' },
  { key: 'P', action: 'Paint Bucket' },
  { key: 'L', action: 'Line Tool' },
  { key: 'R', action: 'Rectangle Tool' },
  { key: 'C', action: 'Circle Tool' },
  { key: 'T', action: 'Triangle Tool' },
  { key: 'B', action: '3D Primitives Picker' },
  { key: 'V', action: 'Bevel Tool' },
  { key: 'U', action: 'Push / Pull Tool' },
  { key: 'X', action: 'Subtract Mode (CSG)' },
  { key: 'D', action: 'Deformation Brush' },
  { key: 'G', action: 'Move Tool (Grab)' },
  { key: 'Shift+R', action: 'Rotate Tool' },
  { key: 'Shift+S', action: 'Scale Tool' },
  { key: 'O', action: 'Orbit (explicit)' },
  { key: 'H', action: 'Pan (Hand)' },
  { key: 'Z', action: 'Zoom (explicit)' },
  { key: 'W', action: 'WorldView Overlay Toggle' },
  { key: 'N', action: 'Add Spatial Note' },
  { key: 'F', action: 'Focus on Selection / Enter Face-Select Mode' },
  { key: 'Shift+F', action: 'Fit All geometry in viewport' },
  { key: 'Ctrl+Z', action: 'Undo' },
  { key: 'Ctrl+Shift+Z / Ctrl+Y', action: 'Redo' },
  { key: 'Ctrl+D', action: 'Duplicate Selected' },
  { key: 'Delete / Backspace', action: 'Delete Selected' },
  { key: 'Ctrl+G', action: 'Group Selected' },
  { key: 'Ctrl+S', action: 'Save Model' },
];

const DATA_MODELS: DataModel[] = [
  {
    name: 'SceneObject',
    path: 'Model.shapes[]',
    fields: [
      { name: 'id', type: 'string', description: 'Unique identifier for the object.' },
      { name: 'name', type: 'string', description: 'Display name shown in the Scene Panel.' },
      { name: 'type', type: 'ShapeType', description: 'box | sphere | cylinder | cone | torus | capsule | plane | circle | triangle | line | wedge | pyramid | custom' },
      { name: 'position', type: '[number,number,number]', description: 'World XYZ position in metres.' },
      { name: 'rotation', type: '[number,number,number]', description: 'Euler XYZ rotation in radians.' },
      { name: 'scale', type: '[number,number,number]', description: 'XYZ scale multipliers.' },
      { name: 'materialId', type: 'string?', description: 'Reference to a Material document.' },
      { name: 'faceColors', type: '{ [face: number]: string }?', description: 'Per-face hex colour overrides.' },
      { name: 'params', type: 'Record<string,number>?', description: 'Shape-specific geometry parameters (e.g. radius, segments).' },
      { name: 'vertexBuffer', type: 'number[]?', description: 'Serialised Float32Array for custom / sculpted meshes.' },
      { name: 'indexBuffer', type: 'number[]?', description: 'Serialised Uint32Array triangle index buffer.' },
      { name: 'parentId', type: 'string?', description: 'ID of parent group object, if grouped.' },
      { name: 'visible', type: 'boolean', description: 'Toggles object visibility in the viewport.' },
      { name: 'locked', type: 'boolean', description: 'Prevents the object from being selected or modified.' },
      { name: 'castShadow', type: 'boolean', description: 'Whether the mesh casts shadows.' },
      { name: 'receiveShadow', type: 'boolean', description: 'Whether the mesh receives shadows from other objects.' },
    ],
  },
  {
    name: 'Material',
    path: '/materials/{materialId}',
    fields: [
      { name: 'id', type: 'string', description: 'Unique identifier.' },
      { name: 'userId', type: 'string', description: 'Owner UID (Firestore security rule enforced).' },
      { name: 'name', type: 'string', description: 'Display name in the Material Library.' },
      { name: 'type', type: '"color" | "texture"', description: 'Whether the material is a solid colour or a texture URL.' },
      { name: 'value', type: 'string', description: 'Hex colour string (#rrggbb) or texture image URL.' },
      { name: 'pbr.roughness', type: 'number', description: 'Surface roughness 0 (mirror) – 1 (fully diffuse).' },
      { name: 'pbr.metalness', type: 'number', description: 'Metallic factor 0 (dielectric) – 1 (metallic).' },
      { name: 'pbr.opacity', type: 'number', description: 'Transparency 0 (invisible) – 1 (opaque).' },
      { name: 'pbr.emissive', type: 'string?', description: 'Emissive colour hex. Causes the surface to glow.' },
      { name: 'pbr.emissiveIntensity', type: 'number?', description: 'Emissive brightness multiplier (0–5).' },
    ],
  },
  {
    name: 'SceneAnimation',
    path: 'Model.animations[]',
    fields: [
      { name: 'id', type: 'string', description: 'Unique identifier.' },
      { name: 'type', type: 'AnimationEffectType', description: 'confetti | fire | smoke | sparks | magic_aura' },
      { name: 'position', type: '[number,number,number]', description: 'World XYZ position of the particle emitter.' },
      { name: 'density', type: 'number', description: 'Emission rate multiplier (0.1 – 5.0).' },
      { name: 'loop', type: 'boolean', description: 'Whether the effect loops indefinitely or is a one-shot burst.' },
      { name: 'playing', type: 'boolean', description: 'Current playback state.' },
    ],
  },
  {
    name: 'SpatialNote',
    path: 'Model.notes[]',
    fields: [
      { name: 'id', type: 'string', description: 'Unique identifier.' },
      { name: 'authorUid', type: 'string', description: 'Firebase UID of the note creator.' },
      { name: 'authorName', type: 'string', description: 'Display name at time of creation.' },
      { name: 'text', type: 'string', description: 'Note body content.' },
      { name: 'position', type: '[number,number,number]', description: 'World XYZ anchor position of the note pin.' },
      { name: 'status', type: '"open" | "in_progress" | "resolved"', description: 'Current review status.' },
      { name: 'createdAt', type: 'string', description: 'ISO 8601 timestamp of creation.' },
      { name: 'updatedAt', type: 'string', description: 'ISO 8601 timestamp of last update.' },
    ],
  },
  {
    name: 'Script',
    path: '/scripts/{scriptId}',
    fields: [
      { name: 'id', type: 'string', description: 'Unique identifier.' },
      { name: 'userId', type: 'string', description: 'Owner UID.' },
      { name: 'name', type: 'string', description: 'Script display name in the Library.' },
      { name: 'description', type: 'string?', description: 'Short description shown below the script name.' },
      { name: 'code', type: 'string', description: 'Full JavaScript source code of the script.' },
      { name: 'createdAt', type: 'string', description: 'ISO 8601 creation timestamp.' },
      { name: 'updatedAt', type: 'string', description: 'ISO 8601 last-updated timestamp.' },
    ],
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

const TechBadge: React.FC<{ label: string }> = ({ label }) => (
  <span style={S.badge}>{label}</span>
);

const FeatureCardComp: React.FC<{ card: FeatureCard }> = ({ card }) => {
  const { diagLog } = useApp();
  
  const handleTryIt = () => {
    if (!card.tryItSnippet) return;
    navigator.clipboard.writeText(card.tryItSnippet);
    diagLog('UI', 'Snippet copied to clipboard', { title: card.title });
    alert(`Example code for ${card.title} copied to clipboard! Paste it into the Developer Console to try it.`);
  };

  return (
    <div style={S.featureCard}>
      <div style={S.cardHeader}>
        <h3 style={S.cardTitle}>{card.title}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {card.tryItSnippet && (
            <button 
              onClick={handleTryIt}
              style={{
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>▶</span> Try It
            </button>
          )}
          <div style={S.cardBadges}>
            {card.badges.map(b => <TechBadge key={b} label={b} />)}
          </div>
        </div>
      </div>
      <div style={S.divider} />
      <div style={S.cardCols}>
        <div>
          <div style={S.colLabel}>Functional Description</div>
          <p style={S.colText}>{card.functional}</p>
        </div>
        <div>
          <div style={S.colLabel}>Implementation Strategy</div>
          <p style={S.colText}>{card.implementation}</p>
        </div>
      </div>
      <div style={S.sourceLabel}>Source Reference</div>
      <code style={S.sourceCode}>{card.source}</code>
      {card.tryItSnippet && (
        <div style={{ marginTop: '12px' }}>
          <div style={S.colLabel}>Example Code</div>
          <pre style={{ ...S.sourceCode, background: '#0a0d12', padding: '10px', fontSize: '11px' }}>
            {card.tryItSnippet}
          </pre>
        </div>
      )}
    </div>
  );
};

const SectionComp: React.FC<{ section: Section }> = ({ section }) => (
  <div>
    <div style={S.sectionHeading}>
      <span style={S.sectionIcon}>{section.icon}</span>
      <h2 style={S.sectionTitle}>{section.title}</h2>
    </div>
    {section.cards.map(card => (
      <FeatureCardComp key={card.title} card={card} />
    ))}
  </div>
);

// ─── Tab Views ────────────────────────────────────────────────────────────────

const OverviewTab: React.FC = () => (
  <div>
    <div style={S.techGrid}>
      {TECH_TILES.map(t => (
        <div key={t.title} style={S.techTile}>
          <div style={S.techTileTitle}>{t.title}</div>
          <div style={S.techTileDesc}>{t.desc}</div>
        </div>
      ))}
    </div>

    <div style={S.sectionHeading}>
      <span style={S.sectionIcon}>📐</span>
      <h2 style={S.sectionTitle}>Application Architecture</h2>
    </div>
    <div style={S.featureCard}>
      <div style={S.cardHeader}>
        <h3 style={S.cardTitle}>Layout & Rendering Pipeline</h3>
        <div style={S.cardBadges}>
          <TechBadge label="REACT 18" />
          <TechBadge label="THREE.JS" />
          <TechBadge label="VITE" />
        </div>
      </div>
      <div style={S.divider} />
      <div style={S.cardCols}>
        <div>
          <div style={S.colLabel}>Layout Structure</div>
          <p style={S.colText}>
            Top Bar → Left Toolbar → Three.js Viewport → Right Panel Stack.
            The viewport occupies the full remaining space. Overlay elements
            (gizmos, measurement labels, note pins, collaborator cursors)
            are rendered as Three.js objects within the scene, not as DOM overlays.
            The status bar at the bottom shows Active Tool, Units, Cursor XYZ,
            and online collaborator count.
          </p>
        </div>
        <div>
          <div style={S.colLabel}>State Architecture</div>
          <p style={S.colText}>
            A singleton AppContext (React.createContext) owns all scene state:
            shapes[], materials[], notes[], animations[], collaborators[],
            selectedObjectIds[], activeTool, and settings. The Three.js
            SceneManager is a ref-held singleton. Tool handlers mutate the
            Three.js scene directly then mark SceneObjects dirty for Firestore
            batch sync (debounced 500 ms).
          </p>
        </div>
      </div>
      <div style={S.sourceLabel}>Source Reference</div>
      <code style={S.sourceCode}>
        src/context/AppContext.tsx{'\n'}
        src/components/Viewport.tsx{'\n'}
        src/components/RightPanelStack.tsx{'\n'}
        src/hooks/useFirestore.ts
      </code>
    </div>

    <div style={S.featureCard}>
      <div style={S.cardHeader}>
        <h3 style={S.cardTitle}>Real-time Collaboration Architecture</h3>
        <div style={S.cardBadges}>
          <TechBadge label="FIRESTORE LISTENERS" />
          <TechBadge label="PRESENCE" />
        </div>
      </div>
      <div style={S.divider} />
      <div style={S.cardCols}>
        <div>
          <div style={S.colLabel}>Presence & Cursor Sync</div>
          <p style={S.colText}>
            Each authenticated client writes its 3D cursor position and active
            tool to Firestore at /collaborations/{'{modelId}'}/presence/{'{uid}'}
            every 100 ms (throttled). Firestore onSnapshot listeners on all
            sibling presence documents reconstruct remote collaborator state.
            Remote cursors are labelled triangle pointers rendered in the
            Three.js scene using Html overlays.
          </p>
        </div>
        <div>
          <div style={S.colLabel}>Conflict Resolution</div>
          <p style={S.colText}>
            Firestore last-write-wins for shape mutations. Shape updates are
            keyed by object ID so independent edits to different objects do not
            conflict. Destructive operations (delete, CSG boolean) set an
            optimistic lock flag on the document; if another client holds the
            lock, the operation is queued and retried after 500 ms.
          </p>
        </div>
      </div>
      <div style={S.sourceLabel}>Source Reference</div>
      <code style={S.sourceCode}>src/hooks/useCollaboration.ts{'\n'}src/components/Panels/CollaborationPanel.tsx</code>
    </div>
  </div>
);

const ToolsTab: React.FC = () => (
  <div>
    {TOOL_SECTIONS.map(section => (
      <SectionComp key={section.id} section={section} />
    ))}
  </div>
);

const PanelsTab: React.FC = () => (
  <div>
    <div style={S.sectionHeading}>
      <span style={S.sectionIcon}>🗂</span>
      <h2 style={S.sectionTitle}>Right Panel System</h2>
    </div>
    <div style={{ ...S.featureCard, marginBottom: '20px' }}>
      <div style={S.cardHeader}>
        <h3 style={S.cardTitle}>Panel Host — RightPanelStack</h3>
        <div style={S.cardBadges}><TechBadge label="COLLAPSIBLE" /><TechBadge label="DRAG REORDER" /></div>
      </div>
      <div style={S.divider} />
      <p style={S.colText}>
        Renders a vertical stack of collapsible panel sections. Each panel header has a label, expand/collapse chevron,
        and optional badge (e.g. note count). Panel bodies render only when expanded. Expanded state persists to
        localStorage. Panels are scrollable and reorderable via drag-and-drop (order stored in user_settings).
      </p>
      <div style={S.sourceLabel}>Source Reference</div>
      <code style={S.sourceCode}>src/components/RightPanelStack.tsx</code>
    </div>
    {PANEL_CARDS.map(card => (
      <FeatureCardComp key={card.title} card={card} />
    ))}
  </div>
);

const DataModelsTab: React.FC = () => (
  <div>
    <div style={S.sectionHeading}>
      <span style={S.sectionIcon}>🗄</span>
      <h2 style={S.sectionTitle}>Firestore Data Models</h2>
    </div>
    {DATA_MODELS.map(model => (
      <div key={model.name} style={S.modelCard}>
        <div style={S.modelHeader}>
          <div style={S.modelName}>{model.name}</div>
          <span style={S.modelPath}>{model.path}</span>
        </div>
        <div style={S.divider} />
        <div style={{ ...S.fieldRow, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '6px', marginBottom: '4px' }}>
          <div style={{ ...S.fieldName, color: '#475569', fontSize: '11px', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Field</div>
          <div style={{ ...S.fieldType, color: '#475569', fontSize: '11px', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Type</div>
          <div style={{ ...S.fieldDesc, color: '#475569', fontSize: '11px', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Description</div>
        </div>
        {model.fields.map(field => (
          <div key={field.name} style={S.fieldRow}>
            <div style={S.fieldName}>{field.name}</div>
            <div style={S.fieldType}>{field.type}</div>
            <div style={S.fieldDesc}>{field.description}</div>
          </div>
        ))}
      </div>
    ))}
  </div>
);

const ShortcutsTab: React.FC = () => (
  <div>
    <div style={S.sectionHeading}>
      <span style={S.sectionIcon}>⌨️</span>
      <h2 style={S.sectionTitle}>Keyboard Shortcuts</h2>
    </div>
    <div style={S.featureCard}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: '200px' }}>Key Binding</th>
            <th style={S.th}>Action</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((row, i) => (
            <tr key={row.key} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
              <td style={S.td}><kbd style={S.kbd}>{row.key}</kbd></td>
              <td style={{ ...S.td, color: '#cbd5e1' }}>{row.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

type TabId = 'overview' | 'tools' | 'panels' | 'data' | 'shortcuts';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'tools', label: 'Tools' },
  { id: 'panels', label: 'Right Panels' },
  { id: 'data', label: 'Data Models & API' },
  { id: 'shortcuts', label: 'Shortcuts' },
];

const SpecPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerTitle}>
          <div style={S.headerIcon}>📄</div>
          <h1 style={S.h1}>Technical Product Specification</h1>
        </div>
        <p style={S.subtitle}>Product Management Documentation · DraftUp Professional Edition</p>
        <div style={S.metaBadges}>
          <span style={S.metaBadge}>Version 2.2.0</span>
          <span style={S.metaBadge}>Updated 2026-04-27</span>
          <span style={S.metaBadge}>19 Tools</span>
          <span style={S.metaBadge}>10 Panels</span>
          <span style={S.metaBadge}>TypeScript · React · Three.js</span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={S.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...S.tab,
              ...(activeTab === tab.id ? S.tabActive : {}),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={S.body}>
        <div style={{ paddingTop: '24px' }}>
          {activeTab === 'overview'  && <OverviewTab />}
          {activeTab === 'tools'     && <ToolsTab />}
          {activeTab === 'panels'    && <PanelsTab />}
          {activeTab === 'data'      && <DataModelsTab />}
          {activeTab === 'shortcuts' && <ShortcutsTab />}
        </div>
      </div>
    </div>
  );
};

export default SpecPage;
