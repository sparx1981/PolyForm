import * as THREE from 'three';
import { BezierCurveState, BezierKnot, HandleMode } from './types';
import { KernelBezierHost } from './KernelBezierHost';
import { tessellateEntireCurve } from './tessellate';

export class BezierTool {
  private state: BezierCurveState;
  private activeKnotIndex: number | null = null;
  private isDraggingHandle: boolean = false;
  private isEditingExistingKnot: boolean = false;

  constructor(private host?: KernelBezierHost) {
    this.state = {
      knots: [],
      segmentsPerSpan: 24,
      isClosed: false,
      activePlane: null
    };
  }

  public activate(): void {
    // Reset state on tool activation
    this.state = {
      knots: [],
      segmentsPerSpan: this.state.segmentsPerSpan || 24,
      isClosed: false,
      activePlane: null
    };
    this.activeKnotIndex = null;
    this.isDraggingHandle = false;
    this.isEditingExistingKnot = false;
  }

  public setState(state: BezierCurveState): void {
    this.state = {
      ...state,
      knots: state.knots.map(k => ({
        point: k.point.clone(),
        handleIn: k.handleIn ? k.handleIn.clone() : null,
        handleOut: k.handleOut ? k.handleOut.clone() : null,
        mode: k.mode
      }))
    };
  }

  public getState(): BezierCurveState {
    return this.state;
  }

  public getKnots(): BezierKnot[] {
    return this.state.knots;
  }

  public getActiveKnotIndex(): number | null {
    return this.activeKnotIndex;
  }

  public getIsDragging(): boolean {
    return this.isDraggingHandle;
  }

  public getSegmentsPerSpan(): number {
    return this.state.segmentsPerSpan;
  }

  public getTessellatedPoints(): THREE.Vector3[] {
    return tessellateEntireCurve(this.state.knots, this.state.isClosed, this.state.segmentsPerSpan);
  }

  public onPointerDown(point: THREE.Vector3, isAltPressed: boolean, snappedPlane?: THREE.Plane): { closed: boolean; knotIndex: number } {
    // 1. Establish Work Plane on first click if not set
    if (!this.state.activePlane) {
      this.state.activePlane = snappedPlane ?? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    }

    const projectedPoint = this.projectToActivePlane(point);

    // 2. Check for Loop Closure: clicked close to start knot
    if (this.state.knots.length >= 2) {
      const origin = this.state.knots[0]!.point;
      if (projectedPoint.distanceTo(origin) < 0.25) {
        this.state.isClosed = true;
        this.host?.commitCurve(this.state, false);
        return { closed: true, knotIndex: 0 };
      }
    }

    // 3. Insert New Knot
    const newKnot: BezierKnot = {
      point: projectedPoint,
      handleIn: null,
      handleOut: null,
      mode: isAltPressed ? 'broken' : 'mirrored',
    };

    this.state.knots.push(newKnot);
    this.activeKnotIndex = this.state.knots.length - 1;
    this.isDraggingHandle = true;
    this.isEditingExistingKnot = false;

    return { closed: false, knotIndex: this.activeKnotIndex };
  }

  public onPointerMove(currentPoint: THREE.Vector3, isAltPressed: boolean): void {
    if (!this.isDraggingHandle || this.activeKnotIndex === null) return;

    const projectedPoint = this.projectToActivePlane(currentPoint);
    const knot = this.state.knots[this.activeKnotIndex];
    if (!knot) return;
    
    if (isAltPressed) {
      knot.mode = 'broken';
    }

    const dist = projectedPoint.distanceTo(knot.point);
    if (dist > 0.001) {
      knot.handleOut = projectedPoint.clone();

      // Enforce symmetry unless broken
      if (knot.mode === 'mirrored') {
        const tangentVec = new THREE.Vector3().subVectors(projectedPoint, knot.point);
        knot.handleIn = new THREE.Vector3().copy(knot.point).sub(tangentVec);
      }
    }

    // Trigger re-solve live preview update via host if editing existing knot
    if (this.state.knots.length > 1) {
      this.host?.commitCurve(this.state, true);
    }
  }

  public onPointerUp(): void {
    this.isDraggingHandle = false;
    if (this.state.knots.length > 1) {
      this.host?.commitCurve(this.state, false);
    }
  }

  public closeLoop(): void {
    if (this.state.knots.length >= 2) {
      this.state.isClosed = true;
      this.host?.commitCurve(this.state, false);
    }
  }

  public escape(): void {
    if (this.state.knots.length > 1) {
      this.host?.commitCurve(this.state, false);
    }
    this.activate(); // Reset tool
  }

  /**
   * Measurement field integration (e.g. user typed '36s')
   */
  public updateResolution(segments: number): void {
    if (segments >= 2 && segments <= 1000) {
      this.state.segmentsPerSpan = segments;
      if (this.state.knots.length > 1) {
        this.host?.commitCurve(this.state, true); // replaceUndo = true
      }
    }
  }

  /**
   * Tangent Lock integration (e.g. user typed '1.5m' or '2.0')
   */
  public setTangentLength(length: number): void {
    if (this.activeKnotIndex === null || length <= 0) return;
    const knot = this.state.knots[this.activeKnotIndex];
    if (!knot) return;

    if (knot.handleOut) {
      const dir = new THREE.Vector3().subVectors(knot.handleOut, knot.point).normalize();
      knot.handleOut = new THREE.Vector3().copy(knot.point).addScaledVector(dir, length);
    }
    if (knot.handleIn && knot.mode === 'mirrored' && knot.handleOut) {
      const dir = new THREE.Vector3().subVectors(knot.point, knot.handleOut).normalize();
      knot.handleIn = new THREE.Vector3().copy(knot.point).addScaledVector(dir, length);
    } else if (knot.handleIn) {
      const dir = new THREE.Vector3().subVectors(knot.handleIn, knot.point).normalize();
      knot.handleIn = new THREE.Vector3().copy(knot.point).addScaledVector(dir, length);
    }

    if (this.state.knots.length > 1) {
      this.host?.commitCurve(this.state, true);
    }
  }

  public selectKnot(index: number): void {
    if (index >= 0 && index < this.state.knots.length) {
      this.activeKnotIndex = index;
    }
  }

  public updateKnotHandle(index: number, handleType: 'in' | 'out' | 'point', newPos: THREE.Vector3, isAltPressed: boolean): void {
    const knot = this.state.knots[index];
    if (!knot) return;

    const projected = this.projectToActivePlane(newPos);

    if (handleType === 'point') {
      const delta = new THREE.Vector3().subVectors(projected, knot.point);
      knot.point.copy(projected);
      if (knot.handleIn) knot.handleIn.add(delta);
      if (knot.handleOut) knot.handleOut.add(delta);
    } else if (handleType === 'out') {
      if (isAltPressed) knot.mode = 'broken';
      knot.handleOut = projected.clone();
      if (knot.mode === 'mirrored') {
        const tangentVec = new THREE.Vector3().subVectors(projected, knot.point);
        knot.handleIn = new THREE.Vector3().copy(knot.point).sub(tangentVec);
      }
    } else if (handleType === 'in') {
      if (isAltPressed) knot.mode = 'broken';
      knot.handleIn = projected.clone();
      if (knot.mode === 'mirrored') {
        const tangentVec = new THREE.Vector3().subVectors(projected, knot.point);
        knot.handleOut = new THREE.Vector3().copy(knot.point).sub(tangentVec);
      }
    }

    if (this.state.knots.length > 1) {
      this.host?.commitCurve(this.state, true);
    }
  }

  public setHandleMode(index: number, mode: HandleMode): void {
    const knot = this.state.knots[index];
    if (!knot) return;
    knot.mode = mode;
    if (mode === 'mirrored' && knot.handleOut) {
      const tangentVec = new THREE.Vector3().subVectors(knot.handleOut, knot.point);
      knot.handleIn = new THREE.Vector3().copy(knot.point).sub(tangentVec);
    } else if (mode === 'none') {
      knot.handleIn = null;
      knot.handleOut = null;
    }
    if (this.state.knots.length > 1) {
      this.host?.commitCurve(this.state, true);
    }
  }

  private projectToActivePlane(point: THREE.Vector3): THREE.Vector3 {
    if (!this.state.activePlane) return point.clone();
    const projected = new THREE.Vector3();
    this.state.activePlane.projectPoint(point, projected);
    return projected;
  }
}
