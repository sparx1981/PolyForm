import * as THREE from 'three';
import {
  SnapCandidate,
  AcquiredReference,
  InferenceResult,
  InferenceSettings,
  TrackingGuide,
} from './types';
import { findOrthoTrackingProjection } from './math';

export class InferenceEngine {
  private settings: InferenceSettings;
  private hoveredCandidate: SnapCandidate | null = null;
  private hoverStartTime: number | null = null;
  private acquiredReference: AcquiredReference | null = null;

  constructor(settings?: Partial<InferenceSettings>) {
    this.settings = {
      hoverDwellMs: 500,
      snapTolerancePx: 14,
      orthoTrackingAngleToleranceRad: THREE.MathUtils.degToRad(2),
      ...settings,
    };
  }

  public updateSettings(settings: Partial<InferenceSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  public clearReference(): void {
    this.hoveredCandidate = null;
    this.hoverStartTime = null;
    this.acquiredReference = null;
  }

  public getAcquiredReference(): AcquiredReference | null {
    return this.acquiredReference;
  }

  public setAcquiredReference(ref: AcquiredReference | null): void {
    this.acquiredReference = ref;
  }

  public evaluate(
    rawPoint: THREE.Vector3,
    bestCandidate: SnapCandidate | null,
    now: number = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  ): InferenceResult {
    // 1. Process candidate hovering and dwell timer
    if (bestCandidate && bestCandidate.screenDistance <= this.settings.snapTolerancePx) {
      if (
        !this.hoveredCandidate ||
        this.hoveredCandidate.point.distanceTo(bestCandidate.point) > 1e-4
      ) {
        this.hoveredCandidate = bestCandidate;
        this.hoverStartTime = now;
      } else if (
        this.hoverStartTime !== null &&
        now - this.hoverStartTime >= this.settings.hoverDwellMs
      ) {
        this.acquiredReference = {
          point: bestCandidate.point.clone(),
          kind: bestCandidate.kind,
          acquiredAt: now,
        };
      }
    } else {
      this.hoveredCandidate = null;
      this.hoverStartTime = null;
    }

    // 2. Direct snap priority if candidate is within pixel tolerance
    if (bestCandidate && bestCandidate.screenDistance <= this.settings.snapTolerancePx) {
      return {
        rawPoint,
        snappedPoint: bestCandidate.point.clone(),
        activeReference: this.acquiredReference,
        activeGuide: null,
        isLocked: true,
      };
    }

    // 3. Orthogonal tracking projection relative to acquired reference
    if (this.acquiredReference) {
      const match = findOrthoTrackingProjection(
        this.acquiredReference.point,
        rawPoint,
        0.25
      );

      if (match) {
        const guide: TrackingGuide = {
          sourcePoint: this.acquiredReference.point,
          direction: match.direction,
          color: match.color,
          projectedPoint: match.projectedPoint,
          guideSegment: [this.acquiredReference.point.clone(), match.projectedPoint.clone()],
          label: match.label,
        };

        return {
          rawPoint,
          snappedPoint: match.projectedPoint,
          activeReference: this.acquiredReference,
          activeGuide: guide,
          isLocked: true,
        };
      }
    }

    // 4. Default unclamped position
    return {
      rawPoint,
      snappedPoint: rawPoint.clone(),
      activeReference: this.acquiredReference,
      activeGuide: null,
      isLocked: false,
    };
  }

  public getAcquisitionProgress(now: number = (typeof performance !== 'undefined' ? performance.now() : Date.now())): number {
    if (this.hoverStartTime === null || this.acquiredReference) return 0;
    return Math.min(1, Math.max(0, (now - this.hoverStartTime) / this.settings.hoverDwellMs));
  }
}
