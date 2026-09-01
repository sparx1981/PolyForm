import * as THREE from 'three';
import { WallJustification, WallSegment, WallToolSettings, DEFAULT_WALL_SETTINGS } from './inference/types';

export interface WallToolState {
  isDrawing: boolean;
  startPoint: THREE.Vector3 | null;
  currentCandidatePoint: THREE.Vector3 | null;
  justification: WallJustification;
  thickness: number;
  height: number;
  activeStory: number;
  chain: THREE.Vector3[];
}

export interface TJunctionResult {
  isJunction: boolean;
  adjustedEndPoint: THREE.Vector3;
  hostWallId?: string;
}

export interface MiteredWallVertex {
  outer: THREE.Vector3;
  inner: THREE.Vector3;
  center: THREE.Vector3;
}

export class WallTool {
  private state: WallToolState;
  private settings: WallToolSettings;

  constructor(settings?: Partial<WallToolSettings>) {
    this.settings = { ...DEFAULT_WALL_SETTINGS, ...settings };
    this.state = {
      isDrawing: false,
      startPoint: null,
      currentCandidatePoint: null,
      justification: 'exterior',
      thickness: this.settings.defaultExteriorThickness,
      height: this.settings.defaultWallHeight,
      activeStory: 1,
      chain: [],
    };
  }

  public updateSettings(settings: Partial<WallToolSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (!this.state.isDrawing) {
      this.state.thickness = this.settings.defaultExteriorThickness;
      this.state.height = this.settings.defaultWallHeight;
    }
  }

  public getSettings(): Readonly<WallToolSettings> {
    return this.settings;
  }

  public setJustification(justification: WallJustification): void {
    this.state.justification = justification;
  }

  public setHeight(height: number): void {
    this.state.height = Math.max(0.5, height);
  }

  public setThickness(thickness: number): void {
    this.state.thickness = Math.max(0.05, thickness);
  }

  public setActiveStory(story: number): void {
    this.state.activeStory = Math.max(1, Math.floor(story));
  }

  public cycleJustification(): WallJustification {
    const cycleMap: Record<WallJustification, WallJustification> = {
      exterior: 'center',
      center: 'interior',
      interior: 'exterior',
    };
    this.state.justification = cycleMap[this.state.justification];
    return this.state.justification;
  }

  public detectContextualThickness(isInteriorAttachment: boolean): number {
    this.state.thickness = isInteriorAttachment
      ? this.settings.defaultInteriorThickness
      : this.settings.defaultExteriorThickness;
    return this.state.thickness;
  }

  /**
   * Option A T-Junction Solver:
   * Truncates the candidate end-point at the interior face of the host wall.
   * This preserves a clean, continuous exterior facade without partition cut-throughs.
   */
  public solveOptionATJunction(
    start: THREE.Vector3,
    end: THREE.Vector3,
    hostWall: WallSegment
  ): TJunctionResult {
    const hostStart = new THREE.Vector3(...hostWall.startPoint);
    const hostEnd = new THREE.Vector3(...hostWall.endPoint);
    const hostDir = new THREE.Vector3().subVectors(hostEnd, hostStart);
    const hostLen = hostDir.length();
    if (hostLen < 1e-4) {
      return { isJunction: false, adjustedEndPoint: end };
    }
    hostDir.normalize();

    // 2D perpendicular normal in X-Z plane
    const hostNormal = new THREE.Vector3(-hostDir.z, 0, hostDir.x).normalize();

    // Determine which side the incoming partition approaches from
    const startOffset = new THREE.Vector3().subVectors(start, hostStart);
    const sideDot = startOffset.dot(hostNormal);
    const normalTowardStart = sideDot >= 0 ? hostNormal.clone() : hostNormal.clone().negate();

    // The interior core face line is offset by half thickness in the direction of the interior
    const halfThick = hostWall.thickness / 2;
    const interiorCorePoint = new THREE.Vector3()
      .copy(hostStart)
      .addScaledVector(normalTowardStart, halfThick);

    const wallDir = new THREE.Vector3().subVectors(end, start);
    if (wallDir.lengthSq() < 1e-6) {
      return { isJunction: false, adjustedEndPoint: end };
    }
    wallDir.normalize();

    // Plane along host wall's interior core face
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normalTowardStart, interiorCorePoint);
    const ray = new THREE.Ray(start, wallDir);
    const intersection = new THREE.Vector3();
    const hit = ray.intersectPlane(plane, intersection);

    if (hit) {
      // Confirm intersection lies along the host wall segment span
      const projOnHost = new THREE.Vector3().subVectors(intersection, hostStart).dot(hostDir);
      if (projOnHost >= -0.2 && projOnHost <= hostLen + 0.2) {
        intersection.y = (start.y + end.y) / 2; // Match elevation
        return {
          isJunction: true,
          adjustedEndPoint: intersection,
          hostWallId: hostWall.id,
        };
      }
    }

    return {
      isJunction: false,
      adjustedEndPoint: end,
    };
  }

  public startSegment(point: THREE.Vector3): void {
    this.state.isDrawing = true;
    this.state.startPoint = point.clone();
    this.state.currentCandidatePoint = point.clone();
    this.state.chain = [point.clone()];
  }

  public updateCursor(point: THREE.Vector3): void {
    this.state.currentCandidatePoint = point.clone();
  }

  public addPoint(point: THREE.Vector3): void {
    if (!this.state.isDrawing) {
      this.startSegment(point);
      return;
    }
    this.state.chain.push(point.clone());
    this.state.startPoint = point.clone();
  }

  public reset(): void {
    this.state.isDrawing = false;
    this.state.startPoint = null;
    this.state.currentCandidatePoint = null;
    this.state.chain = [];
  }

  public getState(): Readonly<WallToolState> {
    return this.state;
  }
}
