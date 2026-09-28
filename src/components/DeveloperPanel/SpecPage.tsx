// Technical Product Specification — PolyForm Developer Extensibility Suite
// Checked against the code by SpecPage.test.ts (cited files exist; snippets call real SDK methods).

import React, { useState } from 'react';
import { useApp } from '../../AppContext';
import { SDK_METHOD_COUNT, SDK_REFERENCE } from '../marketing/sdkFullReference';

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
// Every tool, panel, shortcut and file named here is checked against the code by
// SpecPage.test.ts: cited files must exist, and try-it snippets may only call real SDK methods.

const TECH_TILES = [
  { title: 'React 19 + Three.js', desc: 'The viewport is React Three Fiber (with drei and postprocessing) over Three.js; the rest of the UI is React with Tailwind.' },
  { title: 'Geometry kernel', desc: 'PolyForm\'s own half-edge kernel for drawn geometry: lines, arcs, faces derived from closed loops, push/pull, offset, fillet, chamfer and booleans.' },
  { title: 'three-bvh-csg', desc: 'Boolean operations (subtract, combine, intersect) on objects, accelerated by three-mesh-bvh.' },
  { title: 'Straight-skeleton roofs', desc: 'Roofs for any building outline come from the straight skeleton of its walls, with dormers, extensions and timber sized from span tables.' },
  { title: 'Firebase', desc: 'Google sign-in, Firestore for models, scripts, materials and collaboration, and Storage for uploads. Models can also live in Google Drive or Trimble Connect.' },
  { title: 'Google Gemini', desc: 'AI Generate, the AI assistant and the AI renderer (@google/genai).' },
  { title: 'WorldView', desc: 'A Google Maps overlay under the model, placed by address or coordinates.' },
  { title: 'TypeScript + Vite', desc: 'Strictly typed kernel (tsconfig.kernel.json), Vitest for tests, Vite for the dev server and builds.' },
];

export const TOOL_SECTIONS: Section[] = [
  {
    id: 'selection',
    icon: '🖱️',
    title: 'Selection & Editing',
    cards: [
      {
        title: 'Select',
        badges: ['SHORTCUT: SPACE', 'OBJECTS + FACES'],
        functional: 'Click an object, a drawn face or an edge to select it; drag for a window selection. Shift adds to the selection. Pressing L while in Select switches between lasso and box (marquee) selection.',
        implementation: 'Viewport raycasts objects (Shape[]) and drawn geometry (kernel faces) separately; the two selections are kept apart (selectedIds vs selectedFaceIds). Lasso and marquee test screen-space polygons against projected geometry.',
        source: 'src/components/Viewport.tsx\nsrc/tools/lassoSelection.ts\nsrc/tools/kernelSelection.ts',
        tryItSnippet: 'const box = sdk.createBox({ width: 2, height: 1, depth: 2 });\nsdk.select(box.id);',
      },
      {
        title: 'Eraser',
        badges: ['SHORTCUT: E'],
        functional: 'Click an object to delete it. On drawn geometry a click deletes the whole drawn object; Shift+click deletes a single surface and the edges only it uses.',
        implementation: 'Objects are removed from Shape[]; drawn faces are removed in one kernel transaction (one undo step) with deleteGroupFacesAndEdges / deleteFaceAndEdges.',
        source: 'src/components/Viewport.tsx\nsrc/tools/kernelSelection.ts',
        tryItSnippet: 'const faces = sdk.drawing.listFaces();\nif (faces.length) sdk.drawing.erase([faces[0].id]);',
      },
      {
        title: 'Paint Bucket',
        badges: ['SHORTCUT: B', 'MATERIALS'],
        functional: 'Applies the active colour or library material to a face or object; Shift+click paints the whole object. Materials carry roughness, metalness, opacity and optional height (surface depth).',
        implementation: 'Objects get color/PBR fields and material bindings; drawn faces store the colour and finish on the face (paintFace / paintFaces).',
        source: 'src/components/Viewport.tsx\nsrc/tools/kernelSelection.ts\nsrc/lib/materialPresets.ts',
        tryItSnippet: 'const box = sdk.createBox({ width: 2, height: 2, depth: 2 });\nsdk.materials.applyMaterial(box, "red-brick");',
      },
    ],
  },
  {
    id: 'drawing',
    icon: '✏️',
    title: 'Drawing',
    subtitle: 'Drawn geometry lives in the geometry kernel: a closed loop of edges on one plane becomes a face.',
    cards: [
      {
        title: 'Line',
        badges: ['SHORTCUT: L', 'KERNEL'],
        functional: 'Drag to draw a line. Lines join and split each other where they meet, so closing a loop - or dividing an existing face - makes new faces. Type a length while drawing for an exact size; X / Y / Z lock the axis.',
        implementation: 'One segment is one kernel transaction and one undo step. Edges are inserted with snapping to existing vertices, then faces are derived for every plane the edit touched.',
        source: 'src/tools/lineToolBinding.ts\nsrc/tools/lineTool.ts\nsrc/tools/kernelLineHost.ts\nsrc/lib/geometry/insert.ts\nsrc/lib/geometry/derive.ts',
        tryItSnippet: 'sdk.drawing.line([0, 0, 0], [3, 0, 0]);\nsdk.drawing.line([3, 0, 0], [3, 0, 2]);\nsdk.drawing.line([3, 0, 2], [0, 0, 2]);\nsdk.drawing.line([0, 0, 2], [0, 0, 0]);',
      },
      {
        title: 'Arc',
        badges: ['KERNEL', 'CURVES'],
        functional: 'Two-point and three-point arcs, and pie shapes that close back to the centre. An arc started from the end of a line continues tangent to it.',
        implementation: 'Arcs are stored as a curve plus its segments, so they stay editable as a curve.',
        source: 'src/tools/arcTool.ts\nsrc/tools/kernelArcHost.ts\nsrc/lib/geometry/curve.ts',
        tryItSnippet: 'sdk.drawing.arc({ centre: [0, 0, 0], radius: 2, sweep: Math.PI });',
      },
      {
        title: 'Rectangle, Circle, Triangle',
        badges: ['SHORTCUTS: R, C', 'ISOLATED SHAPES'],
        functional: 'Draw a whole flat shape in one drag. Unlike lines, a shape does not split (or get split by) geometry it merely crosses, so overlapping rectangles stay separate.',
        implementation: 'The outline is committed side by side as isolated edges in one undo step, and its faces are marked so push/pull keeps them isolated too.',
        source: 'src/components/Viewport.tsx\nsrc/tools/kernelLineHost.ts',
        tryItSnippet: 'sdk.drawing.shape([[0, 0, 0], [4, 0, 0], [4, 0, 3], [0, 0, 3]]);',
      },
      {
        title: 'Polygon and Poly Line',
        badges: ['KERNEL'],
        functional: 'Polygon draws a regular N-sided shape; Poly Line clicks out any outline and closes it into a surface. An outline that crosses itself is refused.',
        implementation: 'Points are flattened onto the drawing plane and committed as one isolated ring.',
        source: 'src/tools/polygon/PolygonTool.ts\nsrc/lib/planarPolygon.ts\nsrc/components/Viewport.tsx',
        tryItSnippet: 'sdk.drawing.surface([[0, 0, 0], [5, 0, 0], [5, 0, 5], [0, 0, 5]]);',
      },
      {
        title: 'Bézier Curve',
        badges: ['KERNEL', 'EDITABLE'],
        functional: 'Click knots and drag handles to draw a smooth closed curve, which becomes a flat surface ready for Offset or Push/Pull. The knots are kept, so the curve can be edited later.',
        implementation: 'The curve is tessellated, flattened onto its plane and committed like the other shape tools.',
        source: 'src/tools/bezier/BezierTool.ts\nsrc/tools/bezier/tessellate.ts\nsrc/tools/bezier/bezierSurface.ts',
        tryItSnippet: 'sdk.drawing.bezier({ knots: [\n  { point: [0, 0, 0], handleOut: [1, 0, -1] },\n  { point: [3, 0, 0], handleIn: [2, 0, -1] },\n  { point: [1.5, 0, 3] },\n] });',
      },
      {
        title: '3D Primitives',
        badges: ['OBJECTS'],
        functional: 'Box, sphere, cylinder, cone, pyramid, torus and dome, placed by dragging a footprint then a height.',
        implementation: 'Primitives are objects (Shape[]) rather than drawn geometry, sized by their args.',
        source: 'src/components/Viewport.tsx',
        tryItSnippet: 'sdk.createSphere({ radius: 1, position: [0, 1, 0] });',
      },
    ],
  },
  {
    id: 'modelling',
    icon: '🔧',
    title: 'Modelling',
    cards: [
      {
        title: 'Extrude (Push/Pull)',
        badges: ['SHORTCUT: P', 'KERNEL'],
        functional: 'Drag a face along its normal to extrude it into a solid, or into a solid to cut a recess. A live distance label shows the amount.',
        implementation: 'The face is extruded in the kernel as one transaction; a drawn shape\'s new sides stay isolated from other geometry.',
        source: 'src/tools/kernelPushPull.ts\nsrc/lib/geometry/pushpull.ts',
        tryItSnippet: 'const [face] = sdk.drawing.shape([[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]]);\nsdk.drawing.pushPull(face, 1.5);',
      },
      {
        title: 'Offset',
        badges: ['KERNEL'],
        functional: 'Grows or shrinks a face\'s outline within its own plane, following the cursor. A face with holes cannot be offset.',
        implementation: 'Inserts the offset outline inside (or around) the face; the original boundary is untouched.',
        source: 'src/tools/kernelFaceOffset.ts\nsrc/lib/geometry/faceOffset.ts',
        tryItSnippet: 'const [face] = sdk.drawing.shape([[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]]);\nsdk.drawing.offset(face, -0.5);',
      },
      {
        title: 'Combine, Subtract and Intersect',
        badges: ['SHORTCUT: X (SUBTRACT)', 'CSG'],
        functional: 'Combine merges shapes, Subtract cuts one shape out of another, Intersect keeps only the overlap. Works on flat drawn shapes and on 3D objects.',
        implementation: 'Drawn faces use the kernel\'s own booleans; objects use three-bvh-csg, and the result is stored as a custom mesh.',
        source: 'src/tools/combinePicks.ts\nsrc/tools/kernelBoolean.ts\nsrc/components/Viewport.tsx',
        tryItSnippet: 'const a = sdk.createBox({ width: 2, height: 2, depth: 2 });\nconst b = sdk.createSphere({ radius: 1.2 });\nsdk.performCSG(a.id, b.id, "SUBTRACTION");',
      },
      {
        title: 'Bevel (Fillet and Chamfer)',
        badges: ['KERNEL', 'OBJECTS'],
        functional: 'Rounds (fillet) or cuts (chamfer) the edges of a drawn solid or an object.',
        implementation: 'Drawn solids are rebuilt in the kernel; objects carry bevelAmount / bevelType / bevelSegments.',
        source: 'src/tools/kernelFillet.ts\nsrc/tools/kernelChamfer.ts\nsrc/lib/geometry/fillet.ts\nsrc/lib/geometry/chamfer.ts',
        tryItSnippet: 'const box = sdk.createBox({ width: 2, height: 2, depth: 2 });\nsdk.setBevel(box, { amount: 0.2, type: "radius", segments: 4 });',
      },
      {
        title: 'Move, Rotate, Scale',
        badges: ['SHORTCUTS: M / G, Q, S'],
        functional: 'Transform the selection with a gizmo. In Move, X / Y / Z lock the axis. Drawn groups move as a unit.',
        implementation: 'Objects update position / quaternion / scale; drawn groups are transformed in the kernel as one undo step.',
        source: 'src/components/Viewport.tsx\nsrc/tools/kernelGroupTransform.ts\nsrc/lib/geometry/grouptransform.ts',
        tryItSnippet: 'const box = sdk.createBox({ width: 1, height: 1, depth: 1 });\nsdk.selection.transformObject(box.id, { position: [3, 0.5, 0] });',
      },
      {
        title: 'Deform',
        badges: ['SHORTCUT: D'],
        functional: 'Sculpts an object with a radial brush, pushing, pulling or both.',
        implementation: 'Vertices within the brush radius move along their normals; the result is stored as a custom mesh.',
        source: 'src/components/Viewport.tsx',
        tryItSnippet: 'const s = sdk.createSphere({ radius: 1 });\nsdk.deformObject(s.id, { radius: 0.5, strength: 0.3, direction: "outward" });',
      },
      {
        title: 'Text and 3D Text',
        badges: ['ANNOTATION'],
        functional: 'Text places a flat label on a surface or the ground, reading the right way up from where you are; 3D Text places solid letters that stand up facing you, or stand out of a wall. Click, type the words and size, then edit them later in Entity Info.',
        implementation: 'A text object stores only its words and settings (textData); the letters are drawn from the bundled Helvetiker font when it renders.',
        source: 'src/lib/textShapes.ts\nsrc/components/TextMesh.tsx\nsrc/components/TextPlacementDialog.tsx\nsrc/components/TextEntityFields.tsx',
        tryItSnippet: 'sdk.text.add({ text: "Kitchen", position: [0, 0, 0], size: 0.5 });\nsdk.text.add3D({ text: "No. 12", position: [2, 0, 0], depth: 0.1 });',
      },
      {
        title: 'Measuring Tape and Protractor',
        badges: ['MEASUREMENT'],
        functional: 'Measure distances and angles and place guide lines. Lengths show in the display unit (m, cm or mm).',
        implementation: 'Measurements are parsed and formatted by one module shared by the tools and typed input.',
        source: 'src/tools/measurement.ts\nsrc/components/Viewport.tsx',
        tryItSnippet: 'console.log(sdk.measurement.measureDistance([0, 0, 0], [3, 1, 4]));',
      },
    ],
  },
  {
    id: 'architecture',
    icon: '🏠',
    title: 'Architecture',
    cards: [
      {
        title: 'Wall',
        badges: ['SHORTCUT: W'],
        functional: 'Click or drag to chain walls; closing the chain (C or Enter) assembles a room with mitred corners. While drawing, Tab / J cycles justification, T cycles thickness and H cycles height.',
        implementation: 'Each wall is a box object with its storey derived from its height above the ground; closing a loop builds the room, floor slab and corner mitres.',
        source: 'src/components/Viewport.tsx\nsrc/tools/wallTool.ts\nsrc/lib/archRoomAssembly.ts\nsrc/lib/wallRuns.ts',
        tryItSnippet: 'sdk.architecture.createRoom({ width: 6, length: 4, height: 2.8 });',
      },
      {
        title: 'Door and Window',
        badges: ['HOSTED'],
        functional: 'Click a wall to place a door or window; it cuts its own opening and moves with its wall. Roof windows sit on the roof pitch.',
        implementation: 'The opening records its host wall (hostWallId); walls are cut with the opening\'s outline, and any timber framing is regenerated around it.',
        source: 'src/components/Viewport.tsx\nsrc/lib/wallCutGeometry.ts\nsrc/lib/hostedFixturePicking.ts',
        tryItSnippet: 'sdk.architecture.createDoor({ width: 0.9, height: 2.1 });',
      },
      {
        title: 'Roof',
        badges: ['STRAIGHT SKELETON', 'DORMERS'],
        functional: 'Roofs the whole building: the main roof on the top storey and a roof on each extension below. Gable, hip or parapet (flat), with tiles, dormers, ridge caps and gutters.',
        implementation: 'Slopes come from the straight skeleton of the wall outline, so any outline gets correct slopes; roof timber is sized from span tables.',
        source: 'src/lib/buildingRoofs.ts\nsrc/lib/archRoofGenerator.ts\nsrc/lib/roofSkeleton.ts\nsrc/lib/dormers.ts\nsrc/lib/roofFraming.ts',
        tryItSnippet: 'sdk.architecture.createRoom({ width: 6, length: 4, height: 2.8 });\nsdk.architecture.roofBuilding({ roofType: "gable", pitchAngleDeg: 35, usePitchAngle: true });',
      },
      {
        title: 'Stairs and Steps',
        badges: ['PARAMETRIC'],
        functional: 'Straight, L, U, winder, spiral, curved and bifurcated flights with closed, open, floating or mono-stringer structures and railings. R or the arrow / bracket keys turn them while placing.',
        implementation: 'Stairs are parametric: riser count follows the ideal step height, and the geometry is generated from the stored parameters.',
        source: 'src/lib/archStairGenerator.ts\nsrc/lib/parametricStairs.ts\nsrc/lib/archStairwell.ts',
        tryItSnippet: 'sdk.architecture.createStairs({ style: "l-shape", height: 2.8, railing: "both" });',
      },
      {
        title: 'Timber Frame',
        badges: ['STUDS', 'JOISTS', 'RAFTERS'],
        functional: 'Generates studs, plates, headers, noggins, joists and rafters for the building, and regenerates them when openings or roofs change.',
        implementation: 'Framing is derived from the walls, openings and roofs, then kept in step with them.',
        source: 'src/lib/timberFrameGenerator.ts\nsrc/lib/timberFrameContracts.ts',
        tryItSnippet: 'sdk.architecture.createRoom({ width: 5, length: 4 });\nsdk.architecture.generateTimberFraming({ spacing: 0.6 });',
      },
      {
        title: 'Scale Figure',
        badges: ['REFERENCE'],
        functional: 'Places a person at eye level for a sense of scale.',
        implementation: 'Figures are built procedurally at the chosen height.',
        source: 'src/lib/scaleFigureGeometry.ts',
      },
    ],
  },
  {
    id: 'landscape',
    icon: '🌳',
    title: 'Landscape and Site',
    cards: [
      {
        title: 'Terrain and Sculpting',
        badges: ['TERRAIN'],
        functional: 'Create flat or procedural terrain, sculpt it (push, pull, smooth, flatten, pinch), paint ground textures, grass and wildflower meadows, and grade roads and pads.',
        implementation: 'Terrain stores a height grid; building floors flatten the ground under them automatically.',
        source: 'src/lib/landscapeGeometry.ts\nsrc/lib/landscapeTextures.ts\nsrc/lib/terrain\nsrc/components/LandscapesToolbar.tsx',
        tryItSnippet: 'sdk.landscape.createTerrain({ width: 30, depth: 30, resolution: 32, topography: "rolling" });',
      },
      {
        title: 'Plants',
        badges: ['SPECIES CATALOG'],
        functional: 'Place trees, bushes and grasses from the species catalog, with variation and scale; vegetation moves in the wind.',
        implementation: 'Plants render from their species (instanced where possible), so a placed plant stores only its species and placement.',
        source: 'src/lib/plantLibrary.ts\nsrc/lib/landscapeGeometry.ts\nsrc/components/graphics/InstancedVegetation.tsx',
        tryItSnippet: 'sdk.landscape.addPlant("english_oak", { position: [4, 0, 2] });',
      },
      {
        title: 'Fence, Pond and Patio',
        badges: ['FOLLOWS THE GROUND'],
        functional: 'Fence runs follow the ground in many styles; ponds and lakes dig their basin into the terrain; patios and decks level themselves with the house floor when drawn against a wall, with steps, railings and lights.',
        implementation: 'Each is one object holding its outline (fenceData / waterData / patioData); the SDK and the Claude connector build them with the same code as the tools.',
        source: 'src/lib/siteBuilders.ts\nsrc/lib/fence\nsrc/lib/water\nsrc/lib/patio',
        tryItSnippet: 'sdk.landscape.addFence([[0, 0], [8, 0], [8, 5]], { style: "picket", height: 1 });\nsdk.landscape.addPond([[12, 0], [16, 0], [16, 3], [12, 3]]);',
      },
      {
        title: 'Site Furniture',
        badges: ['LIGHTS', 'BENCHES', 'ROCKS'],
        functional: 'Benches, light fixtures (street lamps, ceiling lights and more, which cast light), railings and boulders.',
        implementation: 'Lamps are lights as well as objects; styles come from one catalog.',
        source: 'src/lib/lampStyles.ts\nsrc/components/graphics/LampLightBinding.tsx',
        tryItSnippet: 'sdk.landscape.addSiteFurniture("bench", { position: [2, 0, 2] });',
      },
    ],
  },
  {
    id: 'navigation',
    icon: '🧭',
    title: 'Viewing and Navigation',
    cards: [
      {
        title: 'Orbit, Pan and Zoom',
        badges: ['SHORTCUTS: O, H, Z'],
        functional: 'Orbit around the model, pan and zoom. Standard views (perspective, plan, front, back, left, right) and perspective or orthographic projection.',
        implementation: 'Camera controls in the viewport; views are also available to scripts.',
        source: 'src/components/Viewport.tsx',
        tryItSnippet: 'sdk.camera.resetView("plan");',
      },
      {
        title: 'Walk, Look and Portal Navigation',
        badges: ['FIRST PERSON'],
        functional: 'Walk through the model in first person, look around on the spot, or click a wall, door, window or floor to go there.',
        implementation: 'Walk mode handles collision and floors; portal navigation picks a sensible standing point for what was clicked.',
        source: 'src/components/walk/WalkModeController.tsx\nsrc/lib/walkMode\nsrc/lib/portalNavigation.ts',
      },
      {
        title: 'WorldView',
        badges: ['GOOGLE MAPS'],
        functional: 'Lays a map under the model at an address or coordinates, covering 50-450 m.',
        implementation: 'A Google Maps overlay at the origin, under the model.',
        source: 'src/components/Viewport.tsx',
        tryItSnippet: 'sdk.worldView.importMap({ lat: 51.5007, lng: -0.1246, zoom: 18 });',
      },
      {
        title: 'Depth Clipping',
        badges: ['SECTIONS'],
        functional: 'Near and far clipping planes to look inside a model.',
        implementation: 'Adjusts the camera frustum.',
        source: 'src/components/Viewport.tsx',
        tryItSnippet: 'sdk.camera.setDepthClipping({ enabled: true, near: 5, far: 40 });',
      },
    ],
  },
];

export const PANEL_CARDS: FeatureCard[] = [
  {
    title: 'Entity Info',
    badges: ['PROPERTIES'],
    functional: 'Name, dimensions, position and rotation of the selection, typed in exactly, plus duplicate and delete. Tool-specific settings appear here for the selected object (roof, stairs, fence, patio, lamp...).',
    implementation: 'Edits go through the same state updates as the tools, so they are undoable and recorded by the action recorder.',
    source: 'src/components/RightPanelStack.tsx\nsrc/components/RoofModifierSection.tsx',
  },
  {
    title: 'Outliner',
    badges: ['HIERARCHY'],
    functional: 'Every object, drawn surface, roof part and timber member, grouped by kind, with show/hide, select, duplicate and delete.',
    implementation: 'Scripts can read the same hierarchy through sdk.outliner.',
    source: 'src/components/RightPanelStack.tsx',
    tryItSnippet: 'console.log(sdk.outliner.list().length, "entries");',
  },
  {
    title: 'Materials and Styles',
    badges: ['LIBRARY'],
    functional: 'The material library (including Poly Haven assets), custom materials with texture maps, and whole-model styles.',
    implementation: 'Materials are bound per object or face; textures are stored once however many objects use them.',
    source: 'src/components/RightPanelStack.tsx\nsrc/lib/materials\nsrc/lib/assets',
    tryItSnippet: 'console.log(sdk.materials.listPresets());',
  },
  {
    title: 'Tags and Scenes',
    badges: ['ORGANISE'],
    functional: 'Tag objects to show or hide them together; save camera views and visibility as scenes.',
    implementation: 'Stored with the model (tags, scenes).',
    source: 'src/components/RightPanelStack.tsx',
  },
  {
    title: 'Visualisation',
    badges: ['WEATHER', 'LIGHTING'],
    functional: 'Sky and environment, sun and lighting, weather (rain, snow, clouds, mist, wind), edge lines, wall transparency, animations and scene helpers.',
    implementation: 'Weather and vegetation wind are GPU effects; settings save with the model (graphicsSettings).',
    source: 'src/components/RightPanelStack.tsx\nsrc/components/graphics/WeatherControls.tsx\nsrc/lib/graphics',
    tryItSnippet: 'sdk.setSkybox("golden-hour");\nsdk.setSunSettings({ intensity: 1.2 });',
  },
  {
    title: 'Components',
    badges: ['REUSE'],
    functional: 'Groups of geometry saved as components to place again.',
    implementation: 'Components are made with the Make Component tool.',
    source: 'src/components/RightPanelStack.tsx',
  },
  {
    title: 'Collaboration and Messaging',
    badges: ['LIVE'],
    functional: 'Invite people by email, see who is in the model and where their cursor is, and message them.',
    implementation: 'One Firestore document per person per model in collaborations/{modelId}_{email} holds role, status and the cursor position (sent about once a second).',
    source: 'src/components/RightPanelStack.tsx\nsrc/AppContext.tsx',
    tryItSnippet: 'console.log(sdk.getCollaborators());',
  },
  {
    title: 'Notes',
    badges: ['SHORTCUT: N'],
    functional: 'Pin notes to the model, show or hide them, and mark them done.',
    implementation: 'Notes save with the model (notes[]).',
    source: 'src/components/RightPanelStack.tsx',
    tryItSnippet: 'sdk.addNote("Check this corner", [0, 1, 0]);',
  },
  {
    title: 'Tool Modifiers',
    badges: ['TOOL SETTINGS'],
    functional: 'Settings for the active tool: wall size and justification, roof shape, fence style, patio look, sculpt brush and more.',
    implementation: 'The same settings scripts change with the configure… SDK methods.',
    source: 'src/components/ToolModifierPalette.tsx',
    tryItSnippet: 'sdk.architecture.configureWallSettings({ thickness: 0.25, height: 3 });',
  },
  {
    title: 'Developer Console',
    badges: ['SDK', 'RECORDER'],
    functional: 'Write and run scripts against the SDK, save them to a library, build custom toolbars, and record what you do by hand as a script (the action recorder).',
    implementation: 'Scripts run with an sdk object built from the current app state. The recorder compares the model after each step and writes the exact SDK lines, or a tool\'s own command when it reproduces the step exactly.',
    source: 'src/components/DeveloperSuite.tsx\nsrc/services/developerService.ts\nsrc/components/CodeRecorder.tsx\nsrc/lib/macroRecorder.ts\nsrc/lib/macroVerify.ts',
  },
];

export const SHORTCUTS: ShortcutRow[] = [
  { key: 'Space', action: 'Select' },
  { key: 'L', action: 'Line (in Select: switch lasso / box selection)' },
  { key: 'E', action: 'Eraser (Shift+click: one surface)' },
  { key: 'B', action: 'Paint Bucket (Shift+click: whole object)' },
  { key: 'R', action: 'Rectangle' },
  { key: 'C', action: 'Circle' },
  { key: 'P', action: 'Extrude (Push/Pull)' },
  { key: 'M / G', action: 'Move' },
  { key: 'Q', action: 'Rotate' },
  { key: 'S', action: 'Scale' },
  { key: 'W', action: 'Wall' },
  { key: 'X', action: 'Subtract' },
  { key: 'D', action: 'Deform' },
  { key: 'N', action: 'Note' },
  { key: 'O', action: 'Orbit' },
  { key: 'H', action: 'Pan' },
  { key: 'Z', action: 'Zoom' },
  { key: 'X / Y / Z (Move, or while drawing)', action: 'Lock to an axis' },
  { key: 'Tab or J (Wall)', action: 'Cycle wall justification' },
  { key: 'T (Wall)', action: 'Cycle wall thickness (100 / 200 / 300 mm)' },
  { key: 'H (Wall)', action: 'Cycle wall height (2.4 / 2.8 / 3.2 m)' },
  { key: 'C or Enter (Wall)', action: 'Close the walls into a room' },
  { key: 'R, arrows, [ ] (Stairs)', action: 'Turn stairs 90° (Shift: 15°)' },
  { key: 'Enter', action: 'Finish the current drawing' },
  { key: 'Escape', action: 'Cancel the current drawing' },
  { key: 'Delete / Backspace', action: 'Delete the selection' },
  { key: 'Ctrl+Z', action: 'Undo (while drawing: remove the last point)' },
  { key: 'Ctrl+Y', action: 'Redo' },
  { key: 'Ctrl+Shift+L', action: 'Show or hide the diagnostic log' },
];

const DATA_MODELS: DataModel[] = [
  {
    name: 'Model',
    path: 'models/{modelId}',
    fields: [
      { name: 'name, userId, userName', type: 'string', description: 'The model\'s name and owner.' },
      { name: 'shapes', type: 'Shape[]', description: 'Every object (see Shape). Large meshes overflow into geometryOverflow documents.' },
      { name: 'kernel', type: 'SerializedGraph', description: 'Drawn geometry: vertices, edges, loops, faces and curves of the geometry kernel.' },
      { name: 'tags, scenes', type: 'Tag[], SceneState[]', description: 'Tags for showing/hiding groups of objects, and saved views.' },
      { name: 'notes', type: 'SceneNote[]', description: 'Notes pinned to the model.' },
      { name: 'graphicsSettings', type: 'GraphicsSettings', description: 'Weather layers and vegetation wind.' },
      { name: 'environment, materialBindings', type: 'object', description: 'Sky/lighting environment, and material library bindings.' },
      { name: 'terrainModifiers', type: 'TerrainModifier[]', description: 'Roads, pads and grading on terrain.' },
      { name: 'createdAt, updatedAt', type: 'timestamp', description: 'Saved about five seconds after the last change.' },
      { name: 'storage', type: 'ExternalFileRef?', description: 'For models kept in Google Drive or Trimble Connect: where the file is (see docs/STORAGE.md).' },
    ],
  },
  {
    name: 'Shape (object)',
    path: 'models/{modelId}.shapes[]',
    fields: [
      { name: 'id, name, type', type: 'string', description: 'type is box, sphere, cylinder, cone, pyramid, donut, dome, wall, door, window, staircase, step, roof, tree, bush, fence, water, patio, terrain, custom and more.' },
      { name: 'position', type: '[x, y, z]', description: 'Metres; y is up.' },
      { name: 'rotation / quaternion', type: '[x, y, z] / [x, y, z, w]', description: 'Orientation (Euler radians, or a quaternion).' },
      { name: 'scale', type: '[x, y, z]?', description: 'Scale multipliers.' },
      { name: 'args', type: 'any', description: 'Size parameters for the type (e.g. a box\'s width, height, depth).' },
      { name: 'color, roughness, metalness, opacity', type: 'string / number', description: 'Appearance; texture and PBR map URLs are separate fields.' },
      { name: 'tags, groupId, hidden', type: 'string[] / string / boolean', description: 'Organisation and visibility.' },
      { name: 'hostWallId', type: 'string?', description: 'For a door or window: the wall it cuts and moves with.' },
      { name: 'roofData, fenceData, waterData, patioData, terrainData', type: 'object?', description: 'Each tool\'s own parameters, from which its geometry is built.' },
      { name: 'geometryData', type: 'object?', description: 'A stored mesh, for objects that cannot be rebuilt from parameters (boolean results, sculpted meshes).' },
    ],
  },
  {
    name: 'SceneNote',
    path: 'models/{modelId}.notes[]',
    fields: [
      { name: 'id, text', type: 'string', description: 'The note.' },
      { name: 'authorUid, authorName', type: 'string', description: 'Who wrote it.' },
      { name: 'position', type: '{ x, y, z }', description: 'Where it is pinned.' },
      { name: 'createdAt', type: 'number', description: 'Milliseconds since 1970.' },
      { name: 'completed, completedAt, completedBy', type: 'boolean / number / string', description: 'Marked done, when and by whom.' },
      { name: 'visible', type: 'boolean?', description: 'Shown in the viewport.' },
    ],
  },
  {
    name: 'Collaborator',
    path: 'collaborations/{modelId}_{email}',
    fields: [
      { name: 'uid, email, displayName', type: 'string', description: 'Who.' },
      { name: 'role', type: '"owner" | "collaborator"', description: 'Owner or invited collaborator.' },
      { name: 'status', type: '"invited" | "active" | "offline"', description: 'Presence.' },
      { name: 'cursorPosition, lastSeen', type: '{ x, y, z } / number', description: 'Their 3D cursor, sent about once a second.' },
    ],
  },
  {
    name: 'DeveloperScript',
    path: 'scripts/{scriptId}',
    fields: [
      { name: 'id, userId, userName', type: 'string', description: 'The script and its owner.' },
      { name: 'name, code', type: 'string', description: 'Name and JavaScript source (run with an sdk object in scope).' },
      { name: 'createdAt', type: 'string', description: 'ISO 8601 time.' },
      { name: 'pinned, isPublic', type: 'boolean', description: 'Pinned to the top; shared with everyone.' },
    ],
  },
  {
    name: 'CustomToolbarDef',
    path: 'sdk.toolbars',
    fields: [
      { name: 'id, title', type: 'string', description: 'The toolbar.' },
      { name: 'position', type: 'string?', description: 'top-left | top-center | top-right | bottom-left | bottom-center | bottom-right | floating | dock-left | dock-top | dock-bottom' },
      { name: 'orientation', type: '"horizontal" | "vertical"', description: 'Layout.' },
      { name: 'items', type: 'CustomToolbarItem[]', description: 'Buttons, groups and sections, each running SDK code.' },
      { name: 'closable, collapsed, floatPosition', type: 'boolean / boolean / { x, y }', description: 'Chrome and placement.' },
    ],
  },
];

/** The SDK's namespaces and their methods, straight from the SDK reference (so this can't drift). */
const SDK_MODEL: DataModel = {
  name: 'sdk',
  path: 'The object scripts, custom toolbars and the recorder use',
  fields: SDK_REFERENCE.map(tag => ({
    name: tag.id === 'core' ? 'sdk.*' : `sdk.${tag.id}`,
    type: `${tag.methods.length} methods`,
    description: tag.methods.map(m => m.name).join(', '),
  })),
};

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
          <TechBadge label="REACT 19" />
          <TechBadge label="THREE.JS" />
          <TechBadge label="VITE" />
        </div>
      </div>
      <div style={S.divider} />
      <div style={S.cardCols}>
        <div>
          <div style={S.colLabel}>Layout Structure</div>
          <p style={S.colText}>
            Top bar, tool rail and toolbars (basic, architecture, landscape), the 3D viewport, and the
            right-hand panel stack. Measurement labels, note pins and collaborator cursors are drawn in
            the scene. The status bar shows the active tool's hint, the units and live measurements.
          </p>
        </div>
        <div>
          <div style={S.colLabel}>State Architecture</div>
          <p style={S.colText}>
            One AppContext holds the model: objects (Shape[]), drawn geometry (the geometry kernel),
            notes, tags, scenes, materials and settings, with one undo history across objects and drawn
            geometry. A model saves about five seconds after the last change, to Firestore or to its
            Google Drive / Trimble Connect file; large meshes and images are stored separately so the
            model document stays small.
          </p>
        </div>
      </div>
      <div style={S.sourceLabel}>Source Reference</div>
      <code style={S.sourceCode}>
        src/AppContext.tsx{'\n'}
        src/components/Viewport.tsx{'\n'}
        src/components/RightPanelStack.tsx{'\n'}
        src/lib/geometry/serialize.ts{'\n'}
        src/lib/firestoreGeometryOffload.ts{'\n'}
        docs/STORAGE.md
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
            Each person in a model has one document, collaborations/{'{modelId}'}_{'{email}'}, holding
            their role, status and 3D cursor position (sent about once a second). Everyone listens to
            the model's collaboration documents to show who is there and where they are pointing.
          </p>
        </div>
        <div>
          <div style={S.colLabel}>Edits</div>
          <p style={S.colText}>
            The model document is shared: each client listens to it and saves its own changes, and the
            last save wins. The owner's presence document is created in a transaction so two tabs
            opening the model at once don't race.
          </p>
        </div>
      </div>
      <div style={S.sourceLabel}>Source Reference</div>
      <code style={S.sourceCode}>src/AppContext.tsx{'\n'}src/components/Viewport.tsx{'\n'}src/components/RightPanelStack.tsx</code>
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
        <div style={S.cardBadges}><TechBadge label="COLLAPSIBLE" /></div>
      </div>
      <div style={S.divider} />
      <p style={S.colText}>
        A vertical stack of collapsible panels; a panel's body renders only while it is open. Entity
        Info and Tool Modifiers start open, Tool Modifiers opens itself for tools that have settings,
        and Materials opens when you choose to pick a material.
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
      <h2 style={S.sectionTitle}>Data Models & SDK</h2>
    </div>
    {[...DATA_MODELS, SDK_MODEL].map(model => (
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
        <p style={S.subtitle}>Product Management Documentation · PolyForm Professional Edition</p>
        <div style={S.metaBadges}>
          <span style={S.metaBadge}>{TOOL_SECTIONS.reduce((n, s) => n + s.cards.length, 0)} tool groups</span>
          <span style={S.metaBadge}>{PANEL_CARDS.length} panels</span>
          <span style={S.metaBadge}>{SDK_METHOD_COUNT} SDK methods</span>
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
