import * as THREE from 'three';
import { PolygonState } from './types';
import { generatePolygonVertices } from './math';

export interface KernelSessionLike {
  drawChain?: (vertices: THREE.Vector3[]) => void;
  canUndo?: boolean;
  undo?: () => void;
  replaceUndoEntry?: () => void;
}

export class PolygonTool {
  private state: PolygonState;
  
  constructor(private session?: KernelSessionLike) {
    this.state = {
      center: null,
      radiusPoint: null,
      sides: 6,
      activePlane: null,
      isCommitted: false
    };
  }

  public activate(): void {
    this.state = { 
      center: null, 
      radiusPoint: null, 
      sides: this.state.sides || 6, 
      activePlane: null, 
      isCommitted: false 
    };
  }

  public setSides(sides: number): void {
    this.state.sides = Math.max(3, Math.min(128, Math.floor(sides)));
  }

  public setCenter(center: THREE.Vector3, plane?: THREE.Plane): void {
    this.state.center = center.clone();
    this.state.activePlane = plane ?? new THREE.Plane(new THREE.Vector3(0, 1, 0), -center.y);
    this.state.isCommitted = false;
  }

  public setRadiusPoint(point: THREE.Vector3): void {
    this.state.radiusPoint = this.projectToActivePlane(point);
  }

  public onPointerDown(point: THREE.Vector3, snappedPlane?: THREE.Plane): boolean {
    if (!this.state.center) {
      this.state.center = point.clone();
      this.state.activePlane = snappedPlane ?? new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y);
      this.state.isCommitted = false;
      return false;
    } else if (!this.state.isCommitted) {
      this.state.radiusPoint = this.projectToActivePlane(point);
      this.commitShape();
      return true;
    }
    return false;
  }

  public onPointerMove(currentPoint: THREE.Vector3): void {
    if (this.state.center && !this.state.isCommitted) {
      this.state.radiusPoint = this.projectToActivePlane(currentPoint);
    }
  }

  public onKeyDown(key: string): void {
    if (this.state.isCommitted) return;
    
    if (key === 'ArrowUp') {
      this.state.sides = Math.min(128, this.state.sides + 1);
    } else if (key === 'ArrowDown') {
      this.state.sides = Math.max(3, this.state.sides - 1);
    }
  }

  public handleMeasurementInput(value: number, type: 'sides' | 'radius'): void {
    if (type === 'sides') {
      this.state.sides = Math.max(3, Math.min(128, Math.floor(value)));
      if (this.state.isCommitted) {
        this.recommitShape(); 
      }
    } else if (type === 'radius' && this.state.center && this.state.radiusPoint) {
      const direction = new THREE.Vector3().subVectors(this.state.radiusPoint, this.state.center).normalize();
      this.state.radiusPoint = this.state.center.clone().add(direction.multiplyScalar(value));
      if (!this.state.isCommitted) this.commitShape();
    }
  }

  public getState(): Readonly<PolygonState> {
    return this.state;
  }

  public setState(newState: Partial<PolygonState>): void {
    this.state = { ...this.state, ...newState };
  }

  public getPreviewPolyline(): THREE.Vector3[] {
    if (!this.state.center || !this.state.radiusPoint || !this.state.activePlane) return [];
    return generatePolygonVertices(this.state.center, this.state.radiusPoint, this.state.sides, this.state.activePlane);
  }

  private commitShape(): void {
    this.state.isCommitted = true;
    const vertices = this.getPreviewPolyline();
    if (this.session?.drawChain && vertices.length >= 3) {
      this.session.drawChain(vertices);
    }
  }

  private recommitShape(): void {
    if (this.session?.canUndo && this.session?.undo) {
      this.session.undo();
      this.commitShape();
      if (this.session.replaceUndoEntry) {
        this.session.replaceUndoEntry();
      }
    }
  }

  private projectToActivePlane(point: THREE.Vector3): THREE.Vector3 {
    if (!this.state.activePlane) return point.clone();
    const projected = new THREE.Vector3();
    this.state.activePlane.projectPoint(point, projected);
    return projected;
  }
}
