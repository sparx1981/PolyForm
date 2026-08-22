/**
 * PolyForm geometry kernel — type contract.
 *
 * FROZEN. Every later phase depends on these signatures. Do not change an
 * exported type without an explicit, deliberate decision — a change here
 * invalidates work in every other kernel file.
 *
 * Scope note (coexistence decision): this kernel owns DRAWN geometry only —
 * lines, arcs, rectangles, polygons, and whatever push/pull later produces.
 * Parametric primitives, plants and terrain stay in `Shape[]` (src/types.ts).
 * A given object lives in exactly one of the two representations.
 *
 * Types and constants only. No logic in this file.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * Branded integer IDs. Integers (not strings) because edge IDs are sorted and
 * hashed on the derivation hot path (§6.3), and because they index directly
 * into dense arrays.
 */
export type VertexId = number & { readonly __brand: 'VertexId' };
export type EdgeId = number & { readonly __brand: 'EdgeId' };
export type FaceId = number & { readonly __brand: 'FaceId' };
export type LoopId = number & { readonly __brand: 'LoopId' };
export type CurveId = number & { readonly __brand: 'CurveId' };
export type ContainerId = number & { readonly __brand: 'ContainerId' };
export type ComponentId = number & { readonly __brand: 'ComponentId' };

/** Hash of a cycle's edge set. Order-independent. §6.3 */
export type CycleHash = string & { readonly __brand: 'CycleHash' };

/** Quantised plane key used to bucket coplanar geometry. §6.5 */
export type PlaneKey = string & { readonly __brand: 'PlaneKey' };

// ---------------------------------------------------------------------------
// Linear algebra
// ---------------------------------------------------------------------------

/**
 * All kernel coordinates are f64. Never store these in a Float32Array —
 * typed arrays belong at the GPU buffer boundary only. §10.3
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 2D point in a plane's local basis, produced by projection. §6.2 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Row-major 4x4 affine transform. Container local-to-parent. §2.5.2 */
export interface Mat4 {
  readonly m: readonly number[]; // length 16
}

/** Plane in point-normal form. `normal` must be unit length. */
export interface Plane {
  readonly point: Vec3;
  readonly normal: Vec3;
}

/**
 * A plane's 2D basis, cached per component. §6.5
 * `u` and `v` are orthonormal and span the plane; `origin` is its anchor.
 */
export interface PlaneBasis {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly normal: Vec3;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

// ---------------------------------------------------------------------------
// Topology — §2.1, §2.4
// ---------------------------------------------------------------------------

export interface Vertex {
  readonly id: VertexId;
  /** Position in the owning container's LOCAL frame. Never a world point. §2.5.2 */
  position: Vec3;
  /** Edges attached to this vertex. Length is the vertex degree. */
  edges: EdgeId[];
  /**
   * How this vertex came to exist. Governs whether R7 may dissolve it: only
   * `deletion` vertices are eligible, never ones the user placed. §7.2
   */
  provenance: VertexProvenance;
}

export type VertexProvenance =
  | 'user'      // explicitly placed by a drawing action
  | 'split'     // created by R2 intersection or R2b subdivision
  | 'deletion'  // became degree-2 as a consequence of a deletion
  | 'import';   // came from a file import

/**
 * An edge may be used by ANY number of faces — do not cap `uses`. Three walls
 * meeting at a corner, or a fin on a panel, are legal and common. The per-plane
 * limit of two is a separate invariant, checked during derivation. §2.4
 */
export interface Edge {
  readonly id: EdgeId;
  v0: VertexId;
  v1: VertexId;
  /** Unordered. Length 0 = boundary, 2 = manifold, 3+ = non-manifold. */
  uses: EdgeUse[];
  /** Hidden from rendering so adjacent faces shade continuously. §5.5 */
  smooth: boolean;
  /** Hidden from rendering entirely. Distinct from `smooth`. §7.1 */
  hidden: boolean;
  /** Curve this edge belongs to, if any. §5.5 */
  curve: CurveId | null;
}

export type EdgeClassification = 'boundary' | 'manifold' | 'non-manifold';

/**
 * One use of an edge by one loop, carrying a direction. The unit of
 * topological connectivity — a naive `Edge { faceA, faceB }` model will not
 * survive real user geometry. §2.4
 */
export interface EdgeUse {
  readonly edge: EdgeId;
  readonly loop: LoopId;
  /** True when the loop traverses this edge from v1 to v0. */
  readonly reversed: boolean;
}

/**
 * An ordered, closed cycle of edge-uses.
 *
 * Winding is a correctness requirement, not a convention: outer loops wind
 * counter-clockwise viewed from the face's front, inner loops wind clockwise.
 * Tessellators infer hole-versus-island from the relative winding. §6.4
 */
export interface Loop {
  readonly id: LoopId;
  readonly face: FaceId;
  uses: EdgeUse[];
  kind: 'outer' | 'inner';
  /** Signed area in the face's plane basis. Positive for outer, negative for inner. */
  signedArea: number;
}

/**
 * A planar region. NEVER constructed directly by a tool — always derived from
 * closed planar cycles of edges. §2.2 R3, §6
 */
export interface Face {
  readonly id: FaceId;
  outerLoop: LoopId;
  /** Holes. Each winds counter to the outer loop. §6.4 */
  innerLoops: LoopId[];
  plane: Plane;
  /** Cached, invalidated when the loop's edge set changes. */
  basis: PlaneBasis;
  /** Order-independent hash of the outer loop's edge set. Identity key. §6.3 */
  hash: CycleHash;
  attributes: FaceAttributes;
}

/**
 * UV mapping is an origin plus two in-plane vectors in WORLD coordinates.
 * Never per-vertex UVs, and never normalised to the face's bounding box —
 * bounds-normalisation is the standard mistake and its symptom is every split
 * visibly rescaling the texture on both halves. §6.3
 */
export interface UVBasis {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
}

export interface FaceAttributes {
  materialFront: string | null;
  materialBack: string | null;
  uv: UVBasis | null;
  layer: string | null;
  /** True when the stored winding puts the front where the user expects it. §6.4 */
  orientationLocked: boolean;
  custom: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Curves — §5.5, §5.7
// ---------------------------------------------------------------------------

/**
 * An ordered run of edges plus the analytic parameters that generated them.
 * NEVER store an arc as bare segments: radius, centre and tangency are needed
 * for offset, follow-me, dimensioning, and regeneration at a new segment count.
 */
export interface Curve {
  readonly id: CurveId;
  readonly kind: 'arc';
  /** Ordered and consecutive. */
  edges: EdgeId[];
  centre: Vec3;
  /** Unit length. Defines the arc's plane. */
  normal: Vec3;
  radius: number;
  startAngle: number;
  /** Signed, radians. */
  sweep: number;
  segments: number;
  /**
   * Set when a split landed mid-segment, so an end segment no longer lies on
   * the true circle. Disables `Ns` re-solve, and downstream operations read
   * these before trusting the analytic parameters. §5.7 Rule 3
   */
  startTruncated: boolean;
  endTruncated: boolean;
}

// ---------------------------------------------------------------------------
// Containers — §2.5
// ---------------------------------------------------------------------------

/**
 * A container holds its own graph in its own local frame. Stickiness stops at
 * the boundary (R8): geometry in different containers never merges, splits or
 * bounds a face together, however exactly it coincides in space. This is what
 * makes objects behave as objects rather than welding into one mass.
 */
export interface Container {
  readonly id: ContainerId;
  parent: ContainerId | null;
  children: ContainerId[];
  name: string;
  /** Local-to-parent. */
  transform: Mat4;
  /** Cached. Invalidate on transform change; never recompute in a hit-test loop. §2.5.2 */
  cachedWorld: Mat4 | null;
  cachedWorldInverse: Mat4 | null;
  /** For normals and planes. Not the same as the inverse. §2.5.2 */
  cachedWorldInverseTranspose: Mat4 | null;
  /** Negative determinant means a mirrored container: winding appears flipped. §2.5.2 */
  determinantSign: 1 | -1;
  graph: Graph;
}

/**
 * Monotonic ID counters. Part of the Graph so that IDs survive snapshot and
 * restore: undo must not reissue an ID that a live reference still holds. §7.0
 */
export interface IdCounters {
  vertex: number;
  edge: number;
  loop: number;
  face: number;
  curve: number;
  component: number;
}

/** One isolated topological graph. Every rule R1-R7 operates within one of these. */
export interface Graph {
  nextId: IdCounters;
  vertices: Map<VertexId, Vertex>;
  edges: Map<EdgeId, Edge>;
  loops: Map<LoopId, Loop>;
  faces: Map<FaceId, Face>;
  curves: Map<CurveId, Curve>;
  /** Coplanar connected components, keyed by quantised plane. §6.5 */
  components: Map<ComponentId, PlanarComponent>;
}

/**
 * A connected sub-graph of edges lying on one plane. Derivation is bounded to
 * these, never to whole planes — a floor plan may carry hundreds of
 * disconnected coplanar panels. §6.5
 */
export interface PlanarComponent {
  readonly id: ComponentId;
  readonly planeKey: PlaneKey;
  basis: PlaneBasis;
  edges: Set<EdgeId>;
  faces: Set<FaceId>;
  bounds: Bounds;
  /** Set when a deletion may have disconnected it; connectivity recomputed lazily. §6.5 */
  dirty: boolean;
}

/** The whole kernel model. Sits alongside `Shape[]`, does not replace it. */
export interface KernelModel {
  root: Container;
  containers: Map<ContainerId, Container>;
  /** The graph that drawing writes to. §2.5.2 */
  activeContext: ContainerId;
}

// ---------------------------------------------------------------------------
// Derivation support — §6
// ---------------------------------------------------------------------------

/** Snapshot of a face taken before derivation, for preserve-or-create. §6.3, §7.4 */
export interface FaceSnapshot {
  readonly id: FaceId;
  readonly hash: CycleHash;
  readonly edgeSet: ReadonlySet<EdgeId>;
  readonly attributes: FaceAttributes;
  readonly plane: Plane;
  readonly polygon2D: readonly Vec2[];
  readonly frontNormal: Vec3;
}

/**
 * Edges touched during the current transaction. A cycle derives a face only if
 * a face already existed on it, OR one of its edges appears here — the
 * preserve-or-create rule that keeps a deleted face deleted. §7.4
 *
 * Set unconditionally, even when an edit created no edges: a retrace that
 * discards every duplicate must still derive, or healing breaks. §6.2 Phase 1b
 */
export type TouchedEdges = ReadonlySet<EdgeId>;

export interface DerivationResult {
  created: FaceId[];
  preserved: FaceId[];
  deleted: FaceId[];
  diagnostics: Diagnostic[];
}

export type DiagnosticKind =
  | 'stray-edge'          // pruned; bounds no face. §6.2 Phase 3a
  | 'near-coplanar'       // cycle just missed COPLANARITY_TOLERANCE. §3
  | 'sliver-rejected'     // below MIN_FACE_AREA. §6.2
  | 'non-manifold-edge'   // 3+ uses. §2.4
  | 'non-manifold-vertex' // pinch point. §6.2
  | 'degenerate-rejected';// commit rolled back. §7.0

export interface Diagnostic {
  readonly kind: DiagnosticKind;
  readonly message: string;
  readonly edges?: readonly EdgeId[];
  readonly vertices?: readonly VertexId[];
}

// ---------------------------------------------------------------------------
// Transactions — §7.0
// ---------------------------------------------------------------------------

/**
 * One user action = one transaction = one undo entry. An arc's twelve edges
 * enter together and produce a single entry.
 *
 * Undo RESTORES the snapshot; it must never re-derive. Derivation is
 * deterministic in geometry but not in face identity, and selection state,
 * the undo stack and external references all key on face ID.
 */
export interface Transaction {
  readonly id: number;
  readonly label: string;
  readonly context: ContainerId;
  readonly before: GraphSnapshot;
  touched: Set<EdgeId>;
}

export interface GraphSnapshot {
  readonly graph: Graph;
  readonly faces: readonly FaceSnapshot[];
}

// ---------------------------------------------------------------------------
// Tolerances — §3
// ---------------------------------------------------------------------------

/**
 * Absolute, and therefore scale-dependent. Bind these to the document's unit
 * setting at model creation. Do NOT derive them from model bounds: that makes
 * derivation non-deterministic, since the same operation would then behave
 * differently depending on what else happens to be in the file. §3
 */
export interface Tolerances {
  /** Two vertices closer than this are one vertex. */
  readonly VERTEX_MERGE_TOLERANCE: number;
  /** Max deviation before a cycle is rejected as non-planar. */
  readonly COPLANARITY_TOLERANCE: number;
  /** Radians. Overdraw detection (R2b) and degree-2 dissolution (R7). */
  readonly COLINEARITY_TOLERANCE: number;
  /** Edges shorter than this are discarded, never created. */
  readonly MIN_EDGE_LENGTH: number;
  /** DERIVED from MIN_EDGE_LENGTH squared — see makeTolerances. */
  readonly MIN_FACE_AREA: number;
  /** Radians. Sweep floor below which a split arc demotes to plain edges. §5.7 */
  readonly MIN_ARC_SWEEP: number;
  /** A sine, hence an angle threshold, for cross-product construction. §5.2 */
  readonly MIN_CROSS_MAGNITUDE: number;
  /** Screen-space snap radius. Scales with input type. §4.2 */
  readonly SNAP_RADIUS_PX: number;
  /** Dwell before a reference point is acquired. §4.2 */
  readonly HOVER_DWELL_MS: number;
}

const DEG = Math.PI / 180;

/**
 * Default tolerances for a model authored in metres.
 *
 * MIN_FACE_AREA is DERIVED, never set independently: it is the area of the
 * smallest square buildable from legal edges. Defining it this way keeps it
 * consistent with MIN_EDGE_LENGTH by construction and makes it follow the unit
 * binding automatically. §3
 */
export function makeTolerances(
  overrides: Partial<Omit<Tolerances, 'MIN_FACE_AREA'>> = {},
): Tolerances {
  const base = {
    VERTEX_MERGE_TOLERANCE: 1e-3,
    COPLANARITY_TOLERANCE: 1e-3,
    COLINEARITY_TOLERANCE: 0.1 * DEG,
    MIN_EDGE_LENGTH: 1e-3,
    MIN_ARC_SWEEP: 1.0 * DEG,
    MIN_CROSS_MAGNITUDE: 1e-4,
    SNAP_RADIUS_PX: 12,
    HOVER_DWELL_MS: 200,
    ...overrides,
  };
  // The one derived value. MIN_FACE_AREA is never passed in, so it cannot
  // drift out of step with MIN_EDGE_LENGTH when units are rebound.
  return { ...base, MIN_FACE_AREA: base.MIN_EDGE_LENGTH ** 2 };
}

/** Defaults for a model authored in metres. */
export const DEFAULT_TOLERANCES: Tolerances = makeTolerances();

/**
 * Unit presets. Each rebinds MIN_EDGE_LENGTH; MIN_FACE_AREA follows
 * automatically because it is derived rather than listed. §3
 */
export const UNIT_TOLERANCES = {
  metres: makeTolerances({ MIN_EDGE_LENGTH: 1e-3, VERTEX_MERGE_TOLERANCE: 1e-3, COPLANARITY_TOLERANCE: 1e-3 }),
  millimetres: makeTolerances({ MIN_EDGE_LENGTH: 1.0, VERTEX_MERGE_TOLERANCE: 1.0, COPLANARITY_TOLERANCE: 1.0 }),
  feet: makeTolerances({ MIN_EDGE_LENGTH: 1 / 320, VERTEX_MERGE_TOLERANCE: 1 / 320, COPLANARITY_TOLERANCE: 1 / 320 }),
} as const;

/** Screen-space overrides for touch. §8 */
export const TOUCH_OVERRIDES = {
  SNAP_RADIUS_PX: 24,
  HOVER_DWELL_MS: 250,
} as const;
