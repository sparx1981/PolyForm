import type { Shape } from '../../types';
import { createInteriorFurnitureShape, type FurnitureParams, type InteriorFurnitureType } from '../interiors/parametricFurniture';

export type ReconstructionSourceKind = 'pdf-vector' | 'image' | 'photo' | 'roomplan' | 'ifc';

export interface ReconstructionSource {
  kind: ReconstructionSourceKind;
  fileName?: string;
  importedAt?: number;
}

export interface ReconstructionWallCandidate {
  id: string;
  start: [number, number];
  end: [number, number];
  height?: number;
  thickness?: number;
  confidence?: number;
}

export interface ReconstructionOpeningCandidate {
  id: string;
  kind: 'door' | 'window';
  wallId: string;
  /** -0.5 = wall start, +0.5 = wall end. */
  centerT: number;
  width: number;
  height: number;
  sill?: number;
  style?: string;
  confidence?: number;
}

export interface ReconstructionFurnitureCandidate {
  id: string;
  type: InteriorFurnitureType;
  position: [number, number];
  rotationY?: number;
  params?: FurnitureParams;
  confidence?: number;
}

export interface ReconstructionRoomHint {
  name?: string;
  at: [number, number];
  confidence?: number;
}

export interface ReconstructionDraft {
  version: 1;
  source: ReconstructionSource;
  /** Candidate geometry is always normalised to PolyForm metres before this stage. */
  coordinateSpace: 'metres';
  walls: ReconstructionWallCandidate[];
  openings?: ReconstructionOpeningCandidate[];
  furniture?: ReconstructionFurnitureCandidate[];
  rooms?: ReconstructionRoomHint[];
  uncertainties?: string[];
}

export type ReconstructionIssueSeverity = 'error' | 'warning';

export interface ReconstructionIssue {
  severity: ReconstructionIssueSeverity;
  code:
    | 'wall-too-short'
    | 'wall-invalid'
    | 'duplicate-wall'
    | 'opening-host-missing'
    | 'opening-invalid'
    | 'opening-too-wide'
    | 'furniture-invalid'
    | 'low-confidence';
  message: string;
  entityId?: string;
}

export interface ReconstructionValidation {
  valid: boolean;
  issues: ReconstructionIssue[];
  errors: number;
  warnings: number;
}

export interface ReconstructionCommitResult {
  shapes: Shape[];
  validation: ReconstructionValidation;
  acceptedIds: string[];
  rejectedIds: string[];
}

const confidenceOf = (v?: number) => v === undefined ? 1 : Math.max(0, Math.min(1, v));
const finite2 = (p: [number, number]) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
const wallLength = (w: ReconstructionWallCandidate) => Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);

function samePoint(a: [number, number], b: [number, number], tolerance: number) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
}

function duplicateWall(a: ReconstructionWallCandidate, b: ReconstructionWallCandidate, tolerance: number) {
  return (samePoint(a.start, b.start, tolerance) && samePoint(a.end, b.end, tolerance))
    || (samePoint(a.start, b.end, tolerance) && samePoint(a.end, b.start, tolerance));
}

export function validateReconstructionDraft(
  draft: ReconstructionDraft,
  options: { lowConfidence?: number; duplicateToleranceM?: number } = {},
): ReconstructionValidation {
  const issues: ReconstructionIssue[] = [];
  const low = options.lowConfidence ?? 0.65;
  const duplicateTolerance = options.duplicateToleranceM ?? 0.03;
  const wallIds = new Set<string>();

  for (const wall of draft.walls ?? []) {
    wallIds.add(wall.id);
    if (!finite2(wall.start) || !finite2(wall.end)) {
      issues.push({ severity: 'error', code: 'wall-invalid', entityId: wall.id, message: 'Wall coordinates must be finite.' });
      continue;
    }
    if (wallLength(wall) < 0.2) {
      issues.push({ severity: 'error', code: 'wall-too-short', entityId: wall.id, message: 'Wall is shorter than 0.2 m.' });
    }
    if ((wall.height !== undefined && (!(wall.height > 0.2) || !Number.isFinite(wall.height)))
      || (wall.thickness !== undefined && (!(wall.thickness > 0.02) || !Number.isFinite(wall.thickness)))) {
      issues.push({ severity: 'error', code: 'wall-invalid', entityId: wall.id, message: 'Wall height/thickness is invalid.' });
    }
    if (confidenceOf(wall.confidence) < low) {
      issues.push({ severity: 'warning', code: 'low-confidence', entityId: wall.id, message: 'Wall confidence is low and should be reviewed.' });
    }
  }

  for (let i = 0; i < draft.walls.length; i++) {
    for (let j = i + 1; j < draft.walls.length; j++) {
      if (duplicateWall(draft.walls[i], draft.walls[j], duplicateTolerance)) {
        issues.push({
          severity: 'error',
          code: 'duplicate-wall',
          entityId: draft.walls[j].id,
          message: `Wall duplicates ${draft.walls[i].id}.`,
        });
      }
    }
  }

  const byWall = new Map(draft.walls.map(w => [w.id, w]));
  for (const opening of draft.openings ?? []) {
    const host = byWall.get(opening.wallId);
    if (!host) {
      issues.push({ severity: 'error', code: 'opening-host-missing', entityId: opening.id, message: 'Opening host wall does not exist.' });
      continue;
    }
    if (!Number.isFinite(opening.centerT) || opening.centerT < -0.5 || opening.centerT > 0.5
      || !(opening.width > 0.15) || !(opening.height > 0.2)
      || !Number.isFinite(opening.width) || !Number.isFinite(opening.height)) {
      issues.push({ severity: 'error', code: 'opening-invalid', entityId: opening.id, message: 'Opening dimensions/position are invalid.' });
    } else if (opening.width > wallLength(host) - 0.1) {
      issues.push({ severity: 'error', code: 'opening-too-wide', entityId: opening.id, message: 'Opening is wider than its host wall.' });
    }
    if (confidenceOf(opening.confidence) < low) {
      issues.push({ severity: 'warning', code: 'low-confidence', entityId: opening.id, message: 'Opening confidence is low and should be reviewed.' });
    }
  }

  for (const item of draft.furniture ?? []) {
    if (!finite2(item.position) || !['bed', 'sofa', 'cabinet', 'curtain'].includes(item.type)) {
      issues.push({ severity: 'error', code: 'furniture-invalid', entityId: item.id, message: 'Furniture candidate is invalid.' });
    }
    if (confidenceOf(item.confidence) < low) {
      issues.push({ severity: 'warning', code: 'low-confidence', entityId: item.id, message: 'Furniture confidence is low and should be reviewed.' });
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.length - errors;
  return { valid: errors === 0, issues, errors, warnings };
}

function reconstructionMeta(draft: ReconstructionDraft, candidateId: string, confidence?: number) {
  return {
    source: draft.source,
    candidateId,
    confidence: confidenceOf(confidence),
  };
}

function wallShape(draft: ReconstructionDraft, wall: ReconstructionWallCandidate): Shape {
  const length = wallLength(wall);
  const dx = wall.end[0] - wall.start[0], dz = wall.end[1] - wall.start[1];
  const height = wall.height ?? 2.8;
  const thickness = wall.thickness ?? 0.2;
  const rotationY = Math.atan2(-dz, dx);
  return {
    id: wall.id,
    name: 'Reconstructed wall',
    type: 'wall',
    position: [(wall.start[0] + wall.end[0]) / 2, height / 2, (wall.start[1] + wall.end[1]) / 2],
    rotation: [0, rotationY, 0],
    args: [length, height, thickness],
    color: '#e8e5df',
    tags: ['architecture', 'reconstructed'],
    customData: { reconstruction: reconstructionMeta(draft, wall.id, wall.confidence) },
  };
}

function openingShape(
  draft: ReconstructionDraft,
  opening: ReconstructionOpeningCandidate,
  host: ReconstructionWallCandidate,
): Shape {
  const dx = host.end[0] - host.start[0], dz = host.end[1] - host.start[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const t = opening.centerT + 0.5;
  const x = host.start[0] + dx * t, z = host.start[1] + dz * t;
  const sill = opening.kind === 'door' ? 0 : (opening.sill ?? 0.9);
  return {
    id: opening.id,
    name: `Reconstructed ${opening.kind}`,
    type: opening.kind,
    position: [x, sill + opening.height / 2, z],
    rotation: [0, Math.atan2(-uz, ux), 0],
    args: [opening.width, opening.height, Math.max(0.12, host.thickness ?? 0.2)],
    color: opening.kind === 'door' ? '#8a6f55' : '#d7e8ef',
    opacity: opening.kind === 'window' ? 0.6 : 1,
    hostWallId: opening.wallId,
    archStyle: opening.style,
    tags: ['architecture', 'reconstructed', opening.kind],
    customData: { reconstruction: reconstructionMeta(draft, opening.id, opening.confidence) },
  };
}

/**
 * Deterministically converts a reviewed reconstruction draft into ordinary
 * PolyForm shapes. Entities with validation errors are rejected; warnings do
 * not prevent committing so reviewers can accept low-confidence proposals.
 */
export function commitReconstructionDraft(
  draft: ReconstructionDraft,
  options: { includeFurniture?: boolean } = {},
): ReconstructionCommitResult {
  const validation = validateReconstructionDraft(draft);
  const rejected = new Set(validation.issues.filter(i => i.severity === 'error').map(i => i.entityId).filter(Boolean) as string[]);
  const shapes: Shape[] = [];
  const acceptedIds: string[] = [];

  for (const wall of draft.walls) {
    if (rejected.has(wall.id)) continue;
    shapes.push(wallShape(draft, wall));
    acceptedIds.push(wall.id);
  }
  const wallMap = new Map(draft.walls.map(w => [w.id, w]));
  for (const opening of draft.openings ?? []) {
    if (rejected.has(opening.id) || rejected.has(opening.wallId)) continue;
    const host = wallMap.get(opening.wallId);
    if (!host) continue;
    shapes.push(openingShape(draft, opening, host));
    acceptedIds.push(opening.id);
  }

  if (options.includeFurniture !== false) {
    for (const item of draft.furniture ?? []) {
      if (rejected.has(item.id)) continue;
      const shape = createInteriorFurnitureShape(item.type, {
        id: item.id,
        position: [item.position[0], 0, item.position[1]],
        rotationY: item.rotationY,
        params: item.params,
      });
      shape.customData = {
        ...shape.customData,
        reconstruction: reconstructionMeta(draft, item.id, item.confidence),
      };
      shapes.push(shape);
      acceptedIds.push(item.id);
    }
  }

  return { shapes, validation, acceptedIds, rejectedIds: [...rejected].sort() };
}
