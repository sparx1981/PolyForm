export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export enum InferenceType {
  ENDPOINT = 1,
  CURVE_CENTER = 2,
  MIDPOINT = 3,
  FACE_CENTROID = 4,
  INTERSECTION = 5,
  GUIDE_POINT = 6,
  ON_EDGE = 7,
  ON_FACE = 8,
}

export const INFERENCE_PRIORITY: Record<InferenceType, number> = {
  [InferenceType.ENDPOINT]: 1,
  [InferenceType.INTERSECTION]: 2,
  [InferenceType.MIDPOINT]: 3,
  [InferenceType.CURVE_CENTER]: 4,
  [InferenceType.FACE_CENTROID]: 5,
  [InferenceType.GUIDE_POINT]: 6,
  [InferenceType.ON_EDGE]: 7,
  [InferenceType.ON_FACE]: 8,
};

export function inferencePriority(type: InferenceType): number {
  return INFERENCE_PRIORITY[type];
}

export interface InferenceCandidate {
  type: InferenceType;
  point: Vector3;
  screenDistance: number;
  sourceEntityId?: string;
  tooltip: string;
  edgeVector?: Vector3;
  planeNormal?: Vector3;
}

export interface InferenceEngineOptions {
  snapRadius?: number;
  hysteresisBoost?: number;
}

export class PolyformInferenceEngine {
  public snapRadius: number;
  public hysteresisBoost: number;
  private _activeCandidate: InferenceCandidate | null = null;

  constructor(options: InferenceEngineOptions = {}) {
    this.snapRadius = options.snapRadius ?? 10;
    this.hysteresisBoost = options.hysteresisBoost ?? 14;
  }

  public get activeCandidate(): InferenceCandidate | null {
    return this._activeCandidate;
  }

  public resolveCandidate(candidates: InferenceCandidate[]): InferenceCandidate | null {
    if (!candidates || candidates.length === 0) {
      this._activeCandidate = null;
      return null;
    }

    const inSnapCandidates = candidates.filter(c => c.screenDistance <= this.snapRadius);

    let currentRetained: InferenceCandidate | null = null;
    if (this._activeCandidate) {
      const activeMatch = candidates.find(c =>
        (c.sourceEntityId && c.sourceEntityId === this._activeCandidate?.sourceEntityId) ||
        (c.type === this._activeCandidate?.type &&
          Math.hypot(c.point.x - this._activeCandidate.point.x, c.point.y - this._activeCandidate.point.y, c.point.z - this._activeCandidate.point.z) < 1e-4)
      );

      if (activeMatch && activeMatch.screenDistance <= this.hysteresisBoost) {
        currentRetained = activeMatch;
      }
    }

    let strictlyHigherCandidate: InferenceCandidate | null = null;
    if (inSnapCandidates.length > 0) {
      inSnapCandidates.sort((a, b) => {
        const prioA = inferencePriority(a.type);
        const prioB = inferencePriority(b.type);
        if (prioA !== prioB) return prioA - prioB;
        if (a.screenDistance !== b.screenDistance) return a.screenDistance - b.screenDistance;
        const idA = a.sourceEntityId ?? '';
        const idB = b.sourceEntityId ?? '';
        return idA.localeCompare(idB);
      });

      const bestInSnap = inSnapCandidates[0];
      if (bestInSnap) {
        if (currentRetained) {
          if (inferencePriority(bestInSnap.type) < inferencePriority(currentRetained.type)) {
            strictlyHigherCandidate = bestInSnap;
          }
        } else {
          strictlyHigherCandidate = bestInSnap;
        }
      }
    }

    const finalChoice = strictlyHigherCandidate ?? currentRetained ?? null;
    this._activeCandidate = finalChoice;
    return finalChoice;
  }
}
