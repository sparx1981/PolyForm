/**
 * Polyform Inference Engine
 * Core 3D Computational Geometry Snapping, Hysteresis, and Inference-Locking Engine.
 * 
 * Implements deterministic CAD/BIM snapping hierarchy, analytical ray-to-skew-line & 
 * ray-to-plane solvers with numerical guards, Green's theorem polygon centroids, 
 * secondary orthogonal projection snapping, and keyboard inference locking.
 */

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Ray {
  origin: Vector3;
  direction: Vector3; // Must be normalized
}

export interface Plane {
  point: Vector3;
  normal: Vector3; // Must be normalized
}

export interface CameraViewportInfo {
  width: number;
  height: number;
  projectToScreen: (worldPoint: Vector3) => { x: number; y: number; inFront: boolean };
}

export enum InferenceType {
  ENDPOINT = 1,      // Priority 1 (Highest)
  CURVE_CENTER = 2,  // Priority 2
  MIDPOINT = 3,      // Priority 3
  FACE_CENTROID = 4, // Priority 4
  INTERSECTION = 5,  // Priority 5
  GUIDE_POINT = 6,   // Priority 6
  ON_EDGE = 7,       // Priority 7
  ON_FACE = 8        // Priority 8 (Lowest)
}

export enum LockMode {
  UNLOCKED = 'UNLOCKED',
  LOCKED_VECTOR = 'LOCKED_VECTOR', // Line/Axis lock (Arrow keys, Shift on edge/axis)
  LOCKED_PLANE = 'LOCKED_PLANE'    // Planar lock (Rotate tool, Protractor, Shift on face)
}

export interface InferenceCandidate {
  type: InferenceType;
  point: Vector3;
  screenDistance: number;
  sourceEntityId?: string;
  tooltip: string;
  edgeVector?: Vector3; // Optional direction if candidate is on an edge
  planeNormal?: Vector3; // Optional normal if candidate is on a plane/face
}

export interface ActiveLock {
  mode: LockMode;
  origin: Vector3;       // P0: last clicked point or hovered reference
  direction?: Vector3;   // Normalized unit vector (if LOCKED_VECTOR)
  plane?: Plane;         // Point & Normal (if LOCKED_PLANE)
  isLocalContainer: boolean;
  colorHex: string;      // Red, Green, Blue, Magenta
  label?: string;
}

export interface TrackedPoint {
  id: string;
  point: Vector3;
  type: InferenceType;
  dwellStartTime: number;
  isAwakened: boolean;
  tooltip?: string;
}

export interface TrackingRayHit {
  sourcePoint: Vector3;
  rayDirection: Vector3;
  axisName: 'Red' | 'Green' | 'Blue' | 'Custom';
  axisColor: string;
  projectedPoint: Vector3;
  screenDistance: number;
  tooltip: string;
}

export interface CompoundIntersectionHit {
  point: Vector3;
  source1: Vector3;
  source2: Vector3;
  ray1Direction: Vector3;
  ray2Direction: Vector3;
  axis1Name: string;
  axis2Name: string;
  axis1Color: string;
  axis2Color: string;
  screenDistance: number;
  tooltip: string;
}

export interface SecondarySnapGuide {
  sourcePoint: Vector3;
  projectedPoint: Vector3;
  distance: number;
  tooltip: string;
  colorHex?: string;
  isTrackingRay?: boolean;
  isCompound?: boolean;
  sourcePoint2?: Vector3;
}

export interface InferenceResult {
  point: Vector3;
  activeLock: ActiveLock | null;
  activeCandidate: InferenceCandidate | null;
  secondaryGuide: SecondarySnapGuide | null;
  trackedPoints: TrackedPoint[];
  tooltip: string;
  isLocked: boolean;
  isSnapped: boolean;
}

// -----------------------------------------------------------------------------
// VECTOR MATH UTILITIES (Pure Functional)
// -----------------------------------------------------------------------------

export class VecMath {
  static readonly EPSILON = 1e-6;

  static create(x = 0, y = 0, z = 0): Vector3 {
    return { x, y, z };
  }

  static clone(v: Vector3): Vector3 {
    return { x: v.x, y: v.y, z: v.z };
  }

  static add(a: Vector3, b: Vector3): Vector3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  static sub(a: Vector3, b: Vector3): Vector3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  static scale(v: Vector3, s: number): Vector3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  static dot(a: Vector3, b: Vector3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  static cross(a: Vector3, b: Vector3): Vector3 {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  static lengthSq(v: Vector3): number {
    return v.x * v.x + v.y * v.y + v.z * v.z;
  }

  static magnitude(v: Vector3): number {
    return Math.sqrt(VecMath.lengthSq(v));
  }

  static len(v: Vector3): number {
    return Math.sqrt(VecMath.lengthSq(v));
  }

  static distance(a: Vector3, b: Vector3): number {
    return VecMath.magnitude(VecMath.sub(a, b));
  }

  static distanceSq(a: Vector3, b: Vector3): number {
    return VecMath.lengthSq(VecMath.sub(a, b));
  }

  static normalize(v: Vector3): Vector3 {
    const l = VecMath.magnitude(v);
    if (l < VecMath.EPSILON) {
      return { x: 0, y: 0, z: 0 };
    }
    const inv = 1.0 / l;
    return { x: v.x * inv, y: v.y * inv, z: v.z * inv };
  }

  static equals(a: Vector3, b: Vector3, tol = VecMath.EPSILON): boolean {
    return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;
  }

  static isZero(v: Vector3, tol = VecMath.EPSILON): boolean {
    return Math.abs(v.x) <= tol && Math.abs(v.y) <= tol && Math.abs(v.z) <= tol;
  }

  static lerp(a: Vector3, b: Vector3, t: number): Vector3 {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t
    };
  }
}

// -----------------------------------------------------------------------------
// POLYFORM INFERENCE ENGINE
// -----------------------------------------------------------------------------

export class PolyformInferenceEngine {
  // Configuration Constants
  public readonly snapRadius: number = 10.0; // R_snap (screen pixels)
  public readonly hysteresisBoost: number = 14.0; // H_boost = 1.4 * R_snap (14px)
  public readonly dwellRadius: number = 8.0; // Screen radius for hover-dwell (pixels)
  public readonly dwellTimeMs: number = 600; // Dwell duration to awaken (600ms)
  public readonly maxTrackedPoints: number = 2; // FIFO cache of up to 2 active points
  public readonly mathEpsilon: number = 1e-6;

  // Axis Color Constants
  public static readonly COLOR_X_AXIS = '#E53E3E';     // Red (X: [1, 0, 0])
  public static readonly COLOR_Y_AXIS = '#38A169';     // Green (Y: [0, 1, 0])
  public static readonly COLOR_Z_AXIS = '#3182CE';     // Blue (Z: [0, 0, 1])
  public static readonly COLOR_PARALLEL = '#D53F8C';   // Magenta (Parallel/Perp)
  public static readonly COLOR_INFERENCE = '#805AD5';  // Purple (General Inference)
  public static readonly COLOR_TRACKING = '#DD6B20';   // Amber / Orange (Awakened tracking)

  // Internal State
  private _activeLock: ActiveLock | null = null;
  private _activeCandidate: InferenceCandidate | null = null;
  private _hoveredEdgeVector: Vector3 | null = null;
  private _hoveredPlaneNormal: Vector3 | null = null;
  private _shiftPressed = false;
  private _toolType: 'linear' | 'rotational' = 'linear';
  private _numericOverride: number | null = null;

  // Hover Awakening / Tracking Cache
  private _trackedReferences: TrackedPoint[] = [];
  private _currentDwellTarget: { point: Vector3; type: InferenceType; screenPos: { x: number; y: number }; startTime: number; tooltip?: string } | null = null;
  private _lastPointerScreenPos: { x: number; y: number } = { x: 0, y: 0 };
  private _lastTickTimestamp: number = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  constructor(options?: { snapRadius?: number; hysteresisMultiplier?: number; dwellTimeMs?: number }) {
    if (options?.snapRadius) {
      this.snapRadius = options.snapRadius;
      this.hysteresisBoost = options.snapRadius * (options.hysteresisMultiplier ?? 1.4);
    }
    if (options?.dwellTimeMs !== undefined) {
      this.dwellTimeMs = options.dwellTimeMs;
    }
  }

  // ---------------------------------------------------------------------------
  // PUBLIC ACCESSORS & CONFIG
  // ---------------------------------------------------------------------------

  public getTrackedReferences(): TrackedPoint[] {
    return [...this._trackedReferences];
  }

  public getAwakenedPoints(): TrackedPoint[] {
    return this._trackedReferences.filter(t => t.isAwakened);
  }

  public clearTrackedReferences(): void {
    this._trackedReferences = [];
    this._currentDwellTarget = null;
  }

  public removeTrackedPoint(id: string): void {
    this._trackedReferences = this._trackedReferences.filter(p => p.id !== id);
  }

  public setToolType(type: 'linear' | 'rotational'): void {
    this._toolType = type;
  }

  public getToolType(): 'linear' | 'rotational' {
    return this._toolType;
  }

  public getActiveLock(): ActiveLock | null {
    return this._activeLock;
  }

  public setActiveLock(lock: ActiveLock | null): void {
    this._activeLock = lock;
  }

  public clearLock(): void {
    this._activeLock = null;
  }

  public setNumericOverride(val: number | null): void {
    this._numericOverride = val;
  }

  public setHoveredReferences(edgeVec: Vector3 | null, planeNormal: Vector3 | null): void {
    this._hoveredEdgeVector = edgeVec ? VecMath.normalize(edgeVec) : null;
    this._hoveredPlaneNormal = planeNormal ? VecMath.normalize(planeNormal) : null;
  }

  // ---------------------------------------------------------------------------
  // 1. HOVER-DWELL TIMER & TRACKING POOL SUBSYSTEM
  // ---------------------------------------------------------------------------

  /**
   * Pointer move handler to track cursor dwell and potential point awakening.
   * Checks if cursor is dwelling over Endpoint, Midpoint, Centroid, or Guide.
   */
  public handlePointerMove(
    screenX: number,
    screenY: number,
    candidates: InferenceCandidate[],
    timestamp: number = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  ): void {
    this._lastPointerScreenPos = { x: screenX, y: screenY };

    // Find the best valid snap target candidate (Endpoint, Midpoint, Centroid, Arc Center)
    const validDwellCandidate = candidates.find(c =>
      (c.type === InferenceType.ENDPOINT ||
       c.type === InferenceType.MIDPOINT ||
       c.type === InferenceType.CURVE_CENTER ||
       c.type === InferenceType.FACE_CENTROID ||
       c.type === InferenceType.GUIDE_POINT) &&
      c.screenDistance <= this.dwellRadius
    );

    if (validDwellCandidate) {
      if (
        this._currentDwellTarget &&
        VecMath.distanceSq(this._currentDwellTarget.point, validDwellCandidate.point) < 1e-4
      ) {
        // Still hovering over the same dwell target
        const elapsed = timestamp - this._currentDwellTarget.startTime;
        if (elapsed >= this.dwellTimeMs) {
          this.awakenPoint(validDwellCandidate.point, validDwellCandidate.type, validDwellCandidate.tooltip);
        }
      } else {
        // New candidate hover target detected
        this._currentDwellTarget = {
          point: VecMath.clone(validDwellCandidate.point),
          type: validDwellCandidate.type,
          screenPos: { x: screenX, y: screenY },
          startTime: timestamp,
          tooltip: validDwellCandidate.tooltip
        };
      }
    } else {
      // Cursor moved away from candidate
      if (this._currentDwellTarget) {
        const distFromDwellStart = Math.hypot(
          screenX - this._currentDwellTarget.screenPos.x,
          screenY - this._currentDwellTarget.screenPos.y
        );
        if (distFromDwellStart > this.dwellRadius) {
          this._currentDwellTarget = null;
        }
      }
    }
  }

  /**
   * Tick update for dwell timer when pointer is motionless
   */
  public tick(
    deltaTimeMs?: number,
    currentTime: number = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  ): void {
    this._lastTickTimestamp = currentTime;
    if (this._currentDwellTarget) {
      const elapsed = currentTime - this._currentDwellTarget.startTime;
      if (elapsed >= this.dwellTimeMs) {
        this.awakenPoint(this._currentDwellTarget.point, this._currentDwellTarget.type, this._currentDwellTarget.tooltip);
      }
    }
  }

  /**
   * Awakens a point and manages the FIFO tracking pool (max 2 points)
   */
  private awakenPoint(point: Vector3, type: InferenceType, tooltip?: string): void {
    // Check if already in cache
    const existingIndex = this._trackedReferences.findIndex(p =>
      VecMath.distanceSq(p.point, point) < 1e-4
    );

    if (existingIndex >= 0) {
      this._trackedReferences[existingIndex].isAwakened = true;
      this._trackedReferences[existingIndex].dwellStartTime = this._lastTickTimestamp;
      return;
    }

    // Add new awakened point (FIFO eviction if capacity exceeded)
    const newTrackedPoint: TrackedPoint = {
      id: `tp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      point: VecMath.clone(point),
      type,
      dwellStartTime: this._lastTickTimestamp,
      isAwakened: true,
      tooltip: tooltip || 'Awakened Reference Point'
    };

    if (this._trackedReferences.length >= this.maxTrackedPoints) {
      this._trackedReferences.shift(); // Evict oldest point (FIFO)
    }

    this._trackedReferences.push(newTrackedPoint);
  }

  /**
   * Confirms a clicked point, clearing transient tracking cache
   */
  public handleConfirmClick(): void {
    this.clearTrackedReferences();
  }

  // ---------------------------------------------------------------------------
  // 3. MATHEMATICAL SOLVERS & GUARDS
  // ---------------------------------------------------------------------------

  /**
   * A. Ray-to-Line Analytical Solver (Skew Lines in 3D)
   * 
   * Camera ray: r(t) = O + t * D
   * Constraint line: L(s) = P0 + s * v
   * 
   * Let w0 = O - P0, b = D · v, d = D · w0, e = v · w0
   * s = (e - b * d) / (1 - b^2)
   * t = (b * e - d) / (1 - b^2)
   * 
   * Guards:
   * 1. |1 - b^2| < 10^-6 (Ray is parallel or co-directional to constraint line)
   * 2. t <= 0 (Intersection is behind camera)
   */
  public solveRayToLine(
    ray: Ray,
    lineOrigin: Vector3,
    lineDirection: Vector3
  ): { pointOnLine: Vector3; pointOnRay: Vector3; s: number; t: number } | null {
    const D = VecMath.normalize(ray.direction);
    const v = VecMath.normalize(lineDirection);
    const O = ray.origin;
    const P0 = lineOrigin;

    const w0 = VecMath.sub(O, P0);
    const b = VecMath.dot(D, v);
    const denom = 1.0 - (b * b);

    // Guard 1: Ray is parallel / grazing the constraint line
    if (Math.abs(denom) < this.mathEpsilon) {
      return null;
    }

    const d = VecMath.dot(D, w0);
    const e = VecMath.dot(v, w0);

    const s = (e - (b * d)) / denom;
    const t = ((b * e) - d) / denom;

    // Guard 2: Closest approach is behind the camera eye
    if (t <= this.mathEpsilon) {
      return null;
    }

    const pointOnLine = VecMath.add(P0, VecMath.scale(v, s));
    const pointOnRay = VecMath.add(O, VecMath.scale(D, t));

    return { pointOnLine, pointOnRay, s, t };
  }

  /**
   * B. Ray-to-Plane Analytical Solver
   * 
   * Camera ray: r(t) = O + t * D
   * Plane: (x - P0) · n = 0
   * 
   * t = ((P0 - O) · n) / (D · n)
   * P_constrained = O + t * D
   * 
   * Guards:
   * 1. |D · n| < 10^-6 (View ray is grazing/parallel to plane)
   * 2. t <= 0 (Plane intersection is behind camera)
   */
  public solveRayToPlane(
    ray: Ray,
    plane: Plane
  ): { point: Vector3; t: number } | null {
    const D = VecMath.normalize(ray.direction);
    const n = VecMath.normalize(plane.normal);
    const O = ray.origin;
    const P0 = plane.point;

    const dotDN = VecMath.dot(D, n);

    // Guard 1: Grazing or parallel ray to plane normal
    if (Math.abs(dotDN) < this.mathEpsilon) {
      return null;
    }

    const t = VecMath.dot(VecMath.sub(P0, O), n) / dotDN;

    // Guard 2: Behind camera
    if (t <= this.mathEpsilon) {
      return null;
    }

    const point = VecMath.add(O, VecMath.scale(D, t));
    return { point, t };
  }

  // ---------------------------------------------------------------------------
  // 3.C CENTROID & CENTER COMPUTATIONS
  // ---------------------------------------------------------------------------

  /**
   * Triangle Centroid: C = (V1 + V2 + V3) / 3
   */
  public static computeTriangleCentroid(v1: Vector3, v2: Vector3, v3: Vector3): Vector3 {
    return {
      x: (v1.x + v2.x + v3.x) / 3.0,
      y: (v1.y + v2.y + v3.y) / 3.0,
      z: (v1.z + v2.z + v3.z) / 3.0
    };
  }

  /**
   * Rectangle Centroid: C = (V1 + V3) / 2 (or average of 4 vertices)
   */
  public static computeRectangleCentroid(v1: Vector3, v2: Vector3, v3: Vector3, v4?: Vector3): Vector3 {
    if (v4) {
      return {
        x: (v1.x + v2.x + v3.x + v4.x) * 0.25,
        y: (v1.y + v2.y + v3.y + v4.y) * 0.25,
        z: (v1.z + v2.z + v3.z + v4.z) * 0.25
      };
    }
    return {
      x: (v1.x + v3.x) * 0.5,
      y: (v1.y + v3.y) * 0.5,
      z: (v1.z + v3.z) * 0.5
    };
  }

  /**
   * Circle / Arc Center from 3 non-collinear boundary points
   */
  public static computeArcCenterFrom3Points(p1: Vector3, p2: Vector3, p3: Vector3): Vector3 | null {
    const v12 = VecMath.sub(p2, p1);
    const v13 = VecMath.sub(p3, p1);
    const normal = VecMath.cross(v12, v13);

    const normalLenSq = VecMath.lengthSq(normal);
    if (normalLenSq < 1e-10) {
      // Collinear points - no valid arc center
      return null;
    }

    const v12Sq = VecMath.lengthSq(v12);
    const v13Sq = VecMath.lengthSq(v13);

    const cross1 = VecMath.scale(VecMath.cross(normal, v12), v13Sq);
    const cross2 = VecMath.scale(VecMath.cross(v13, normal), v12Sq);
    const offset = VecMath.scale(VecMath.add(cross1, cross2), 1.0 / (2.0 * normalLenSq));

    return VecMath.add(p1, offset);
  }

  /**
   * General 3D Polygon Centroid using 2D Green's Theorem projected on dominant axis
   * and back-projected onto the 3D polygon plane.
   */
  public static computePolygonCentroid(vertices: Vector3[], planeNormal?: Vector3): Vector3 {
    const n = vertices.length;
    if (n === 0) return { x: 0, y: 0, z: 0 };
    if (n === 1) return VecMath.clone(vertices[0]);
    if (n === 2) return VecMath.scale(VecMath.add(vertices[0], vertices[1]), 0.5);
    if (n === 3) return PolyformInferenceEngine.computeTriangleCentroid(vertices[0], vertices[1], vertices[2]);

    // 1. Calculate Newell's polygon normal if not provided
    let norm = planeNormal ? VecMath.normalize(planeNormal) : { x: 0, y: 0, z: 0 };
    if (!planeNormal || VecMath.isZero(norm)) {
      for (let i = 0; i < n; i++) {
        const curr = vertices[i];
        const next = vertices[(i + 1) % n];
        norm.x += (curr.y - next.y) * (curr.z + next.z);
        norm.y += (curr.z - next.z) * (curr.x + next.x);
        norm.z += (curr.x - next.x) * (curr.y + next.y);
      }
      norm = VecMath.normalize(norm);
    }

    if (VecMath.isZero(norm)) {
      // Fallback: simple arithmetic average
      let sum = { x: 0, y: 0, z: 0 };
      for (const v of vertices) sum = VecMath.add(sum, v);
      return VecMath.scale(sum, 1.0 / n);
    }

    // 2. Select projection plane by dropping coordinate with largest normal component
    const absX = Math.abs(norm.x);
    const absY = Math.abs(norm.y);
    const absZ = Math.abs(norm.z);

    let coordU: 'x' | 'y' | 'z' = 'x';
    let coordV: 'x' | 'y' | 'z' = 'y';
    let dropped: 'x' | 'y' | 'z' = 'z';

    if (absX >= absY && absX >= absZ) {
      coordU = 'y';
      coordV = 'z';
      dropped = 'x';
    } else if (absY >= absX && absY >= absZ) {
      coordU = 'x';
      coordV = 'z';
      dropped = 'y';
    } else {
      coordU = 'x';
      coordV = 'y';
      dropped = 'z';
    }

    // 3. Green's Theorem in 2D projected coordinates
    let signedArea = 0.0;
    let centroidU = 0.0;
    let centroidV = 0.0;

    for (let i = 0; i < n; i++) {
      const p0 = vertices[i];
      const p1 = vertices[(i + 1) % n];

      const u0 = p0[coordU];
      const v0 = p0[coordV];
      const u1 = p1[coordU];
      const v1 = p1[coordV];

      const cross = (u0 * v1) - (u1 * v0);
      signedArea += cross;
      centroidU += (u0 + u1) * cross;
      centroidV += (v0 + v1) * cross;
    }

    signedArea *= 0.5;

    if (Math.abs(signedArea) < 1e-8) {
      // Degenerate area: return arithmetic mean
      let sum = { x: 0, y: 0, z: 0 };
      for (const v of vertices) sum = VecMath.add(sum, v);
      return VecMath.scale(sum, 1.0 / n);
    }

    const factor = 1.0 / (6.0 * signedArea);
    centroidU *= factor;
    centroidV *= factor;

    // 4. Re-project 2D centroid onto 3D plane: (C - V0) · norm = 0
    const v0 = vertices[0];
    const planeD = VecMath.dot(v0, norm); // norm.x*x + norm.y*y + norm.z*z = planeD

    const result: Vector3 = { x: 0, y: 0, z: 0 };
    result[coordU] = centroidU;
    result[coordV] = centroidV;

    if (dropped === 'x') {
      result.x = (planeD - (norm.y * centroidU + norm.z * centroidV)) / norm.x;
    } else if (dropped === 'y') {
      result.y = (planeD - (norm.x * centroidU + norm.z * centroidV)) / norm.y;
    } else {
      result.z = (planeD - (norm.x * centroidU + norm.y * centroidV)) / norm.z;
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // 2. DETERMINISTIC PRIORITY STACK & HYSTERESIS RESOLUTION
  // ---------------------------------------------------------------------------

  /**
   * Resolves the highest-priority snap candidate evaluating hysteresis:
   * - Retains active candidate as long as cursor distance <= H_boost (14px)
   * - UNLESS a candidate with strictly higher priority enters R_snap (10px)
   * - Among equal priority within R_snap, picks lowest screen distance
   */
  public resolveCandidate(
    candidates: InferenceCandidate[]
  ): InferenceCandidate | null {
    if (!candidates || candidates.length === 0) {
      this._activeCandidate = null;
      return null;
    }

    // Filter candidates within snapping radius
    const inSnapCandidates = candidates.filter(c => c.screenDistance <= this.snapRadius);

    // Check if current active candidate is still within hysteresis threshold (H_boost)
    let currentRetained: InferenceCandidate | null = null;
    if (this._activeCandidate) {
      const activeMatch = candidates.find(c => 
        (c.sourceEntityId && c.sourceEntityId === this._activeCandidate?.sourceEntityId) ||
        (c.type === this._activeCandidate?.type && VecMath.distanceSq(c.point, this._activeCandidate.point) < 1e-4)
      );

      if (activeMatch && activeMatch.screenDistance <= this.hysteresisBoost) {
        currentRetained = activeMatch;
      }
    }

    // Check if any candidate has strictly higher priority than the retained candidate
    let strictlyHigherCandidate: InferenceCandidate | null = null;
    if (inSnapCandidates.length > 0) {
      // Sort in-snap candidates by: 1) Priority ascending (1 is highest), 2) Screen distance ascending
      inSnapCandidates.sort((a, b) => {
        if (a.type !== b.type) return a.type - b.type;
        return a.screenDistance - b.screenDistance;
      });

      const bestInSnap = inSnapCandidates[0];

      if (currentRetained) {
        // Priority check: lower enum numeric value = higher priority
        if (bestInSnap.type < currentRetained.type) {
          strictlyHigherCandidate = bestInSnap;
        }
      } else {
        strictlyHigherCandidate = bestInSnap;
      }
    }

    const finalChoice = strictlyHigherCandidate || currentRetained;
    this._activeCandidate = finalChoice;
    return finalChoice;
  }

  // ---------------------------------------------------------------------------
  // 2. CARDINAL TRACKING RAYS & COMPOUND DUAL-RAY INTERSECTIONS
  // ---------------------------------------------------------------------------

  /**
   * Evaluates cardinal tracking rays emanating from all awakened points:
   * Red Axis: L_X(u) = Q + u * [1, 0, 0]
   * Green Axis: L_Y(u) = Q + u * [0, 1, 0]
   * Blue Axis: L_Z(u) = Q + u * [0, 0, 1]
   */
  public evaluateTrackingRays(
    cursorRay: Ray,
    viewportInfo?: CameraViewportInfo
  ): TrackingRayHit | null {
    const awakened = this.getAwakenedPoints();
    if (awakened.length === 0) return null;

    const axes: Array<{ dir: Vector3; name: 'Red' | 'Green' | 'Blue'; color: string }> = [
      { dir: { x: 1, y: 0, z: 0 }, name: 'Red', color: PolyformInferenceEngine.COLOR_X_AXIS },
      { dir: { x: 0, y: 1, z: 0 }, name: 'Green', color: PolyformInferenceEngine.COLOR_Y_AXIS },
      { dir: { x: 0, y: 0, z: 1 }, name: 'Blue', color: PolyformInferenceEngine.COLOR_Z_AXIS },
    ];

    let bestHit: TrackingRayHit | null = null;
    let minScreenDist = Infinity;

    for (const ref of awakened) {
      const Q = ref.point;
      for (const axis of axes) {
        const solve = this.solveRayToLine(cursorRay, Q, axis.dir);
        if (!solve) continue;

        // Calculate screen-space or 3D proximity
        let screenDist = 0;
        if (viewportInfo && viewportInfo.projectToScreen) {
          const projLine = viewportInfo.projectToScreen(solve.pointOnLine);
          const projRay = viewportInfo.projectToScreen(solve.pointOnRay);
          if (projLine.inFront && projRay.inFront) {
            screenDist = Math.hypot(projLine.x - projRay.x, projLine.y - projRay.y);
          } else {
            continue;
          }
        } else {
          // Approximate screen distance with 3D distance if viewport info not supplied
          screenDist = VecMath.distance(solve.pointOnLine, solve.pointOnRay) * 20.0;
        }

        if (screenDist <= this.snapRadius && screenDist < minScreenDist) {
          minScreenDist = screenDist;
          bestHit = {
            sourcePoint: Q,
            rayDirection: axis.dir,
            axisName: axis.name,
            axisColor: axis.color,
            projectedPoint: solve.pointOnLine,
            screenDistance: screenDist,
            tooltip: `From Point along ${axis.name} Axis`
          };
        }
      }
    }

    return bestHit;
  }

  /**
   * Resolves compound 3D intersection between cardinal tracking rays of 2 awakened points:
   * e.g. L_{Q1, Red} ∩ L_{Q2, Green}
   */
  public evaluateCompoundIntersections(
    cursorRay: Ray,
    viewportInfo?: CameraViewportInfo
  ): CompoundIntersectionHit | null {
    const awakened = this.getAwakenedPoints();
    if (awakened.length < 2) return null;

    const Q1 = awakened[0].point;
    const Q2 = awakened[1].point;

    const axes: Array<{ dir: Vector3; name: string; color: string }> = [
      { dir: { x: 1, y: 0, z: 0 }, name: 'Red', color: PolyformInferenceEngine.COLOR_X_AXIS },
      { dir: { x: 0, y: 1, z: 0 }, name: 'Green', color: PolyformInferenceEngine.COLOR_Y_AXIS },
      { dir: { x: 0, y: 0, z: 1 }, name: 'Blue', color: PolyformInferenceEngine.COLOR_Z_AXIS },
    ];

    let bestCompound: CompoundIntersectionHit | null = null;
    let minScreenDist = Infinity;

    for (const axis1 of axes) {
      for (const axis2 of axes) {
        // Parallel rays don't intersect in a single unique point
        const cross = VecMath.cross(axis1.dir, axis2.dir);
        if (VecMath.lengthSq(cross) < 1e-4) continue;

        // Skew line closest approach between Ray1(s) = Q1 + s * dir1 and Ray2(u) = Q2 + u * dir2
        // Since cardinal axes are orthogonal:
        // Q1 + s*dir1 = Q2 + u*dir2 => construct intersection point
        // For orthogonal axes:
        const interPoint: Vector3 = {
          x: (axis1.dir.x !== 0) ? Q2.x : (axis2.dir.x !== 0 ? Q1.x : (Q1.x + Q2.x) * 0.5),
          y: (axis1.dir.y !== 0) ? Q2.y : (axis2.dir.y !== 0 ? Q1.y : (Q1.y + Q2.y) * 0.5),
          z: (axis1.dir.z !== 0) ? Q2.z : (axis2.dir.z !== 0 ? Q1.z : (Q1.z + Q2.z) * 0.5)
        };

        // If one axis is X and the other is Y:
        // Point is (Q2.x, Q1.y, (Q1.z+Q2.z)/2) etc. depending on active directions
        if (axis1.dir.x !== 0 && axis2.dir.y !== 0) {
          interPoint.x = Q2.x;
          interPoint.y = Q1.y;
          interPoint.z = Q1.z; // Same plane z if applicable
        } else if (axis1.dir.y !== 0 && axis2.dir.x !== 0) {
          interPoint.x = Q1.x;
          interPoint.y = Q2.y;
          interPoint.z = Q1.z;
        } else if (axis1.dir.x !== 0 && axis2.dir.z !== 0) {
          interPoint.x = Q2.x;
          interPoint.y = Q1.y;
          interPoint.z = Q1.z;
        } else if (axis1.dir.z !== 0 && axis2.dir.x !== 0) {
          interPoint.x = Q1.x;
          interPoint.y = Q1.y;
          interPoint.z = Q2.z;
        } else if (axis1.dir.y !== 0 && axis2.dir.z !== 0) {
          interPoint.x = Q1.x;
          interPoint.y = Q2.y;
          interPoint.z = Q1.z;
        } else if (axis1.dir.z !== 0 && axis2.dir.y !== 0) {
          interPoint.x = Q1.x;
          interPoint.y = Q1.y;
          interPoint.z = Q2.z;
        }

        // Distance from cursor ray to intersection point
        const rayToPt = VecMath.sub(interPoint, cursorRay.origin);
        const t = VecMath.dot(rayToPt, cursorRay.direction);
        if (t <= this.mathEpsilon) continue;

        const ptOnRay = VecMath.add(cursorRay.origin, VecMath.scale(cursorRay.direction, t));
        let screenDist = 0;

        if (viewportInfo && viewportInfo.projectToScreen) {
          const projInter = viewportInfo.projectToScreen(interPoint);
          const projRay = viewportInfo.projectToScreen(ptOnRay);
          if (projInter.inFront && projRay.inFront) {
            screenDist = Math.hypot(projInter.x - projRay.x, projInter.y - projRay.y);
          } else {
            continue;
          }
        } else {
          screenDist = VecMath.distance(interPoint, ptOnRay) * 20.0;
        }

        if (screenDist <= this.snapRadius && screenDist < minScreenDist) {
          minScreenDist = screenDist;
          bestCompound = {
            point: interPoint,
            source1: Q1,
            source2: Q2,
            ray1Direction: axis1.dir,
            ray2Direction: axis2.dir,
            axis1Name: axis1.name,
            axis2Name: axis2.name,
            axis1Color: axis1.color,
            axis2Color: axis2.color,
            screenDistance: screenDist,
            tooltip: `Intersection of ${axis1.name} & ${axis2.name} from Reference Points`
          };
        }
      }
    }

    return bestCompound;
  }

  // ---------------------------------------------------------------------------
  // 4. MAIN INFERENCE UPDATE PIPELINE
  // ---------------------------------------------------------------------------

  /**
   * Main per-frame update method.
   * Handles active vector/plane constraints, hysteresis candidate priority stack,
   * hover-dwell tracking rays & compound intersections, secondary orthogonal snapping,
   * and numeric bypass.
   */
  public update(
    cursorX: number,
    cursorY: number,
    cameraRay: Ray,
    candidates: InferenceCandidate[],
    currentClickOrigin: Vector3 | null,
    viewportInfo?: CameraViewportInfo
  ): InferenceResult {
    // Update pointer dwell for hover awakening
    this.handlePointerMove(cursorX, cursorY, candidates);

    // 1. Resolve Primary Snap Candidate using Hysteresis
    const activeCandidate = this.resolveCandidate(candidates);

    // 2. Check for Numeric Length Bypass
    if (this._numericOverride !== null && this._activeLock && this._activeLock.mode === LockMode.LOCKED_VECTOR && this._activeLock.direction) {
      const P0 = currentClickOrigin || this._activeLock.origin;
      const v = VecMath.normalize(this._activeLock.direction);
      const P_final = VecMath.add(P0, VecMath.scale(v, this._numericOverride));

      return {
        point: P_final,
        activeLock: this._activeLock,
        activeCandidate: null,
        secondaryGuide: null,
        trackedPoints: this.getTrackedReferences(),
        tooltip: `Distance: ${this._numericOverride.toFixed(2)} (${this._activeLock.label || 'Locked Vector'})`,
        isLocked: true,
        isSnapped: false
      };
    }

    // 3. Evaluate Locked State
    if (this._activeLock && this._activeLock.mode !== LockMode.UNLOCKED) {
      // -----------------------------------------------------------------------
      // A. LOCKED VECTOR (Axis / Edge / Directional Constraint)
      // -----------------------------------------------------------------------
      if (this._activeLock.mode === LockMode.LOCKED_VECTOR && this._activeLock.direction) {
        const P0 = currentClickOrigin || this._activeLock.origin;
        const v = VecMath.normalize(this._activeLock.direction);

        // Solve cursor ray to locked constraint line
        const lineSolve = this.solveRayToLine(cameraRay, P0, v);
        let currentConstrainedPoint = lineSolve ? lineSolve.pointOnLine : P0;

        let secondaryGuide: SecondarySnapGuide | null = null;
        let secondarySnapped = false;

        // Integration with Inference Locking & Awakened Points:
        // Test intersection between locked line and tracking rays from awakened points
        const awakened = this.getAwakenedPoints();
        let trackingRayIntersectHit: { pt: Vector3; source: Vector3; tooltip: string; color: string } | null = null;

        if (awakened.length > 0) {
          const axes: Array<{ dir: Vector3; name: string; color: string }> = [
            { dir: { x: 1, y: 0, z: 0 }, name: 'Red', color: PolyformInferenceEngine.COLOR_X_AXIS },
            { dir: { x: 0, y: 1, z: 0 }, name: 'Green', color: PolyformInferenceEngine.COLOR_Y_AXIS },
            { dir: { x: 0, y: 0, z: 1 }, name: 'Blue', color: PolyformInferenceEngine.COLOR_Z_AXIS },
          ];

          let minIntersectDist = Infinity;

          for (const ref of awakened) {
            for (const axis of axes) {
              // Line 1: Locked line L_locked(s) = P0 + s * v
              // Line 2: Tracking ray L_track(u) = ref.point + u * axis.dir
              const cross = VecMath.cross(v, axis.dir);
              if (VecMath.lengthSq(cross) < 1e-4) continue; // Parallel lines

              // Analytical skew line solver between locked line and tracking ray
              const solve = this.solveRayToLine(
                { origin: ref.point, direction: axis.dir },
                P0,
                v
              );

              if (solve) {
                const distBetweenLines = VecMath.distance(solve.pointOnLine, solve.pointOnRay);
                if (distBetweenLines < 0.1) { // Lines actually intersect/cross in 3D
                  // Check screen proximity to cursor
                  let screenDist = 0;
                  if (viewportInfo && viewportInfo.projectToScreen) {
                    const proj = viewportInfo.projectToScreen(solve.pointOnLine);
                    if (proj.inFront) {
                      screenDist = Math.hypot(proj.x - cursorX, proj.y - cursorY);
                    }
                  } else {
                    screenDist = VecMath.distance(solve.pointOnLine, currentConstrainedPoint) * 20.0;
                  }

                  if (screenDist <= this.snapRadius && screenDist < minIntersectDist) {
                    minIntersectDist = screenDist;
                    trackingRayIntersectHit = {
                      pt: solve.pointOnLine,
                      source: ref.point,
                      tooltip: `Intersection of ${this._activeLock.label || 'Axis'} and ${axis.name} from Point`,
                      color: axis.color
                    };
                  }
                }
              }
            }
          }
        }

        if (trackingRayIntersectHit) {
          currentConstrainedPoint = trackingRayIntersectHit.pt;
          secondaryGuide = {
            sourcePoint: trackingRayIntersectHit.source,
            projectedPoint: trackingRayIntersectHit.pt,
            distance: VecMath.distance(trackingRayIntersectHit.source, trackingRayIntersectHit.pt),
            tooltip: trackingRayIntersectHit.tooltip,
            colorHex: trackingRayIntersectHit.color,
            isTrackingRay: true
          };
          secondarySnapped = true;
        } else {
          // Secondary Snapping Along Locked Vector:
          // Test for hovered reference points Q (endpoints, midpoints, centroids) within snap radius
          const secondaryCandidates = candidates.filter(c => 
            c.type <= InferenceType.GUIDE_POINT && 
            c.screenDistance <= this.snapRadius
          );

          if (secondaryCandidates.length > 0) {
            secondaryCandidates.sort((a, b) => (a.type !== b.type ? a.type - b.type : a.screenDistance - b.screenDistance));
            const bestQ = secondaryCandidates[0];

            // Project Q orthogonally onto the locked line: s_projected = (Q - P0) · v
            const Q = bestQ.point;
            const s_projected = VecMath.dot(VecMath.sub(Q, P0), v);
            const P_final = VecMath.add(P0, VecMath.scale(v, s_projected));

            secondaryGuide = {
              sourcePoint: Q,
              projectedPoint: P_final,
              distance: VecMath.distance(Q, P_final),
              tooltip: `Constrained on Line from ${bestQ.tooltip || 'Inference Point'}`
            };

            currentConstrainedPoint = P_final;
            secondarySnapped = true;
          }
        }

        const tooltip = secondaryGuide 
          ? secondaryGuide.tooltip 
          : `Constrained on ${this._activeLock.label || 'Axis'}`;

        return {
          point: currentConstrainedPoint,
          activeLock: this._activeLock,
          activeCandidate: activeCandidate,
          secondaryGuide,
          trackedPoints: this.getTrackedReferences(),
          tooltip,
          isLocked: true,
          isSnapped: secondarySnapped || (activeCandidate !== null)
        };
      }

      // -----------------------------------------------------------------------
      // B. LOCKED PLANE (Planar Constraint for Rotations / Faces)
      // -----------------------------------------------------------------------
      if (this._activeLock.mode === LockMode.LOCKED_PLANE && this._activeLock.plane) {
        const planeSolve = this.solveRayToPlane(cameraRay, this._activeLock.plane);
        const resolvedPoint = planeSolve ? planeSolve.point : (currentClickOrigin || this._activeLock.origin);

        return {
          point: resolvedPoint,
          activeLock: this._activeLock,
          activeCandidate: activeCandidate,
          secondaryGuide: null,
          trackedPoints: this.getTrackedReferences(),
          tooltip: `Locked to ${this._activeLock.label || 'Plane'}`,
          isLocked: true,
          isSnapped: false
        };
      }
    }

    // 4. Primary Snap Candidate (Highest Priority: Direct Point Snap)
    if (activeCandidate) {
      return {
        point: activeCandidate.point,
        activeLock: null,
        activeCandidate,
        secondaryGuide: null,
        trackedPoints: this.getTrackedReferences(),
        tooltip: activeCandidate.tooltip,
        isLocked: false,
        isSnapped: true
      };
    }

    // 5. Compound Dual-Ray Tracking Intersection (Directly above single-axis tracking)
    const compoundHit = this.evaluateCompoundIntersections(cameraRay, viewportInfo);
    if (compoundHit) {
      const compoundGuide: SecondarySnapGuide = {
        sourcePoint: compoundHit.source1,
        sourcePoint2: compoundHit.source2,
        projectedPoint: compoundHit.point,
        distance: VecMath.distance(compoundHit.source1, compoundHit.point),
        tooltip: compoundHit.tooltip,
        colorHex: compoundHit.axis1Color,
        isTrackingRay: true,
        isCompound: true
      };

      return {
        point: compoundHit.point,
        activeLock: null,
        activeCandidate: null,
        secondaryGuide: compoundGuide,
        trackedPoints: this.getTrackedReferences(),
        tooltip: compoundHit.tooltip,
        isLocked: false,
        isSnapped: true
      };
    }

    // 6. Single Cardinal Tracking Ray ("From Point along [Axis] Axis")
    const trackingRayHit = this.evaluateTrackingRays(cameraRay, viewportInfo);
    if (trackingRayHit) {
      const trackingGuide: SecondarySnapGuide = {
        sourcePoint: trackingRayHit.sourcePoint,
        projectedPoint: trackingRayHit.projectedPoint,
        distance: VecMath.distance(trackingRayHit.sourcePoint, trackingRayHit.projectedPoint),
        tooltip: trackingRayHit.tooltip,
        colorHex: trackingRayHit.axisColor,
        isTrackingRay: true
      };

      return {
        point: trackingRayHit.projectedPoint,
        activeLock: null,
        activeCandidate: null,
        secondaryGuide: trackingGuide,
        trackedPoints: this.getTrackedReferences(),
        tooltip: trackingRayHit.tooltip,
        isLocked: false,
        isSnapped: true
      };
    }

    // Default: Ground plane or ray intersection fallback (e.g. y = 0 plane)
    const groundPlane: Plane = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
    const groundSolve = this.solveRayToPlane(cameraRay, groundPlane);
    const fallbackPoint = groundSolve ? groundSolve.point : VecMath.add(cameraRay.origin, VecMath.scale(cameraRay.direction, 10));

    return {
      point: fallbackPoint,
      activeLock: null,
      activeCandidate: null,
      secondaryGuide: null,
      trackedPoints: this.getTrackedReferences(),
      tooltip: '',
      isLocked: false,
      isSnapped: false
    };
  }

  // ---------------------------------------------------------------------------
  // 4. KEYBOARD EVENT HANDLERS & INFERENCE LOCKING MAPPINGS
  // ---------------------------------------------------------------------------

  /**
   * Handle KeyDown:
   * - Escape: Clears all tracked references and locks
   * - Arrow Right: Lock Red Axis (X: [1, 0, 0])
   * - Arrow Left: Lock Green Axis (Y: [0, 1, 0] or [0, 0, 1])
   * - Arrow Up: Lock Blue Axis (Z: [0, 0, 1] or [0, 1, 0])
   * - Arrow Down: Lock Parallel/Perpendicular to hovered edge
   * - Shift (Hold): Lock to active hovered vector/axis
   * - Tapping arrow toggles ON/OFF
   */
  public handleKeyDown(
    event: { key: string; shiftKey?: boolean; preventDefault?: () => void },
    currentOrigin: Vector3 = { x: 0, y: 0, z: 0 }
  ): boolean {
    const P0 = this._activeCandidate?.point || currentOrigin;

    // Escape clears tracked references and locks
    if (event.key === 'Escape') {
      this.clearTrackedReferences();
      this.clearLock();
      return true;
    }

    // Shift Key Hold
    if (event.key === 'Shift' || event.shiftKey) {
      this._shiftPressed = true;
      if (!this._activeLock || this._activeLock.mode === LockMode.UNLOCKED) {
        if (this._hoveredEdgeVector) {
          this.lockVector(this._hoveredEdgeVector, P0, PolyformInferenceEngine.COLOR_PARALLEL, 'Parallel to Edge');
          return true;
        } else if (this._hoveredPlaneNormal) {
          this.lockPlane(this._hoveredPlaneNormal, P0, PolyformInferenceEngine.COLOR_PARALLEL, 'Aligned to Face');
          return true;
        }
      }
    }

    if (this._toolType === 'linear') {
      switch (event.key) {
        case 'ArrowRight': {
          // Lock / Toggle Red (X Axis)
          event.preventDefault?.();
          this.toggleVectorLock({ x: 1, y: 0, z: 0 }, P0, PolyformInferenceEngine.COLOR_X_AXIS, 'Red Axis (X)');
          return true;
        }

        case 'ArrowLeft': {
          // Lock / Toggle Green (Y Axis)
          event.preventDefault?.();
          this.toggleVectorLock({ x: 0, y: 1, z: 0 }, P0, PolyformInferenceEngine.COLOR_Y_AXIS, 'Green Axis (Y)');
          return true;
        }

        case 'ArrowUp': {
          // Lock / Toggle Blue (Z Axis)
          event.preventDefault?.();
          this.toggleVectorLock({ x: 0, y: 0, z: 1 }, P0, PolyformInferenceEngine.COLOR_Z_AXIS, 'Blue Axis (Z)');
          return true;
        }

        case 'ArrowDown': {
          // Lock / Toggle Parallel or Perpendicular to active hovered edge
          event.preventDefault?.();
          if (this._hoveredEdgeVector) {
            this.toggleVectorLock(this._hoveredEdgeVector, P0, PolyformInferenceEngine.COLOR_PARALLEL, 'Parallel to Edge');
          } else {
            // Perpendicular to ground/last vector
            this.toggleVectorLock({ x: 0, y: 1, z: 0 }, P0, PolyformInferenceEngine.COLOR_PARALLEL, 'Perpendicular');
          }
          return true;
        }
      }
    } else if (this._toolType === 'rotational') {
      // Rotational/Planar Tools constrain plane normals
      switch (event.key) {
        case 'ArrowRight': {
          event.preventDefault?.();
          this.togglePlaneLock({ x: 1, y: 0, z: 0 }, P0, PolyformInferenceEngine.COLOR_X_AXIS, 'Red Plane (X Normal)');
          return true;
        }
        case 'ArrowLeft': {
          event.preventDefault?.();
          this.togglePlaneLock({ x: 0, y: 1, z: 0 }, P0, PolyformInferenceEngine.COLOR_Y_AXIS, 'Green Plane (Y Normal)');
          return true;
        }
        case 'ArrowUp': {
          event.preventDefault?.();
          this.togglePlaneLock({ x: 0, y: 0, z: 1 }, P0, PolyformInferenceEngine.COLOR_Z_AXIS, 'Blue Plane (Z Normal)');
          return true;
        }
        case 'ArrowDown': {
          event.preventDefault?.();
          if (this._hoveredPlaneNormal) {
            this.togglePlaneLock(this._hoveredPlaneNormal, P0, PolyformInferenceEngine.COLOR_PARALLEL, 'Face Normal Plane');
          }
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Handle KeyUp: Releases Shift lock if currently locked via shift
   */
  public handleKeyUp(event: { key: string }): void {
    if (event.key === 'Shift') {
      this._shiftPressed = false;
      // Only unlock if the lock was ephemeral (e.g. shift-held parallel/edge lock)
      if (this._activeLock && this._activeLock.label?.includes('Parallel to Edge')) {
        this.clearLock();
      }
    }
  }

  /**
   * Toggles vector lock on/off
   */
  private toggleVectorLock(direction: Vector3, origin: Vector3, colorHex: string, label: string): void {
    const dirNorm = VecMath.normalize(direction);
    if (
      this._activeLock && 
      this._activeLock.mode === LockMode.LOCKED_VECTOR && 
      this._activeLock.direction &&
      VecMath.equals(this._activeLock.direction, dirNorm)
    ) {
      // Toggle OFF
      this.clearLock();
    } else {
      // Toggle ON
      this.lockVector(dirNorm, origin, colorHex, label);
    }
  }

  /**
   * Toggles plane lock on/off
   */
  private togglePlaneLock(normal: Vector3, origin: Vector3, colorHex: string, label: string): void {
    const norm = VecMath.normalize(normal);
    if (
      this._activeLock && 
      this._activeLock.mode === LockMode.LOCKED_PLANE && 
      this._activeLock.plane &&
      VecMath.equals(this._activeLock.plane.normal, norm)
    ) {
      // Toggle OFF
      this.clearLock();
    } else {
      // Toggle ON
      this.lockPlane(norm, origin, colorHex, label);
    }
  }

  private lockVector(direction: Vector3, origin: Vector3, colorHex: string, label: string): void {
    this._activeLock = {
      mode: LockMode.LOCKED_VECTOR,
      origin: VecMath.clone(origin),
      direction: VecMath.normalize(direction),
      isLocalContainer: false,
      colorHex,
      label
    };
  }

  private lockPlane(normal: Vector3, origin: Vector3, colorHex: string, label: string): void {
    this._activeLock = {
      mode: LockMode.LOCKED_PLANE,
      origin: VecMath.clone(origin),
      plane: {
        point: VecMath.clone(origin),
        normal: VecMath.normalize(normal)
      },
      isLocalContainer: false,
      colorHex,
      label
    };
  }
}
