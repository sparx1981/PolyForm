import type { ImageReconstructionObservation, RecognisedOpening, RecognisedWall } from './imageAdapter';
import { detectPlanGeometry, type PlanGeometry, type PlanRaster } from './planGeometry';
import { estimateScaleFromDimensions, type ScaleEstimate } from './dimensionScale';

export type RasterImageData = PlanRaster;

export interface LocalPlanRecognitionOptions {
  /** Known scale. Leave it out to read the scale from the plan itself. */
  metresPerPixel?: number;
  fileName?: string;
  darkThreshold?: number;
  minRunPx?: number;
  /** Ignored: kept so older scripts still type-check. */
  minCoverage?: number;
  rotationY?: number;
  wallHeightM?: number;
}

export interface PlanAnalysis {
  observation: ImageReconstructionObservation;
  geometry: PlanGeometry;
  /** The scale used, and how it was found. */
  scale: ScaleEstimate;
}

/** A standard interior door leaf: used only when nothing on the plan states a length. */
const TYPICAL_DOOR_M = 0.9;

/** Scale from the printed dimensions, else from the width of the doors. */
export function estimatePlanScale(geometry: PlanGeometry): ScaleEstimate | null {
  const doorPx = geometry.openings.filter(o => o.kind === 'door').map(o => o.a1 - o.a0).sort((a, b) => a - b);
  const byDoors: ScaleEstimate | null = doorPx.length
    ? {
        metresPerPixel: TYPICAL_DOOR_M / doorPx[Math.floor(doorPx.length / 2)]!,
        source: 'door-width',
        confidence: doorPx.length >= 3 ? 0.45 : 0.3,
        evidence: `Estimated from ${doorPx.length} door${doorPx.length > 1 ? 's' : ''}, assuming ${TYPICAL_DOOR_M} m wide. Check it against a length you know.`,
      }
    : null;
  if (geometry.bounds) {
    const fromText = estimateScaleFromDimensions(
      { luminance: geometry.luminance, width: geometry.width, height: geometry.height, bounds: geometry.bounds },
      byDoors ? { metresPerPixel: byDoors.metresPerPixel } : undefined,
    );
    if (fromText && fromText.confidence >= 0.6) return fromText;
    if (fromText && !byDoors) return fromText;
  }
  return byDoors;
}

export function planGeometryToObservation(
  geometry: PlanGeometry,
  metresPerPixel: number,
  options: { fileName?: string; rotationY?: number; wallHeightM?: number } = {},
): ImageReconstructionObservation {
  const walls: RecognisedWall[] = [];
  const openings: RecognisedOpening[] = [];
  const wallHeight = options.wallHeightM ?? 2.7;
  const openingById = new Map(geometry.openings.map(o => [o.id, o]));

  for (const wall of geometry.walls) {
    // Posts between window panes are only a wall thickness long: part of the window, not a wall.
    if ((wall.a1 - wall.a0) * metresPerPixel < 0.2 && !wall.openingIds.length) continue;
    const c = (wall.c0 + wall.c1) / 2;
    const id = wall.id;
    walls.push({
      id,
      start: wall.o === 'h' ? [wall.a0, c] : [c, wall.a0],
      end: wall.o === 'h' ? [wall.a1, c] : [c, wall.a1],
      height: wallHeight,
      thickness: Math.max(0.06, (wall.c1 - wall.c0) * metresPerPixel),
      confidence: Math.max(0.6, Math.min(0.98, 0.7 + wall.solidity * 0.28)),
    });
    for (const openingId of wall.openingIds) {
      const op = openingById.get(openingId);
      if (!op || op.kind === 'passage') continue;
      const length = wall.a1 - wall.a0;
      const centreAlong = (op.a0 + op.a1) / 2;
      openings.push({
        id: `${op.kind}-${openingId.replace('opening-', '')}`,
        kind: op.kind,
        wallId: id,
        centerT: (centreAlong - wall.a0) / length - 0.5,
        width: (op.a1 - op.a0) * metresPerPixel,
        height: op.kind === 'door' ? 2.05 : 1.2,
        ...(op.kind === 'window' ? { sill: 0.9 } : {}),
        confidence: op.confidence,
      });
    }
  }

  return {
    source: { kind: 'image', fileName: options.fileName },
    imageSize: [geometry.width, geometry.height],
    transform: { coordinateSpace: 'pixels', metresPerPixel, rotationY: options.rotationY },
    walls,
    openings,
    uncertainties: walls.length
      ? ['Recognition reads straight (orthogonal) walls, doors and windows only; review every item before committing.']
      : ['No strong orthogonal wall lines were detected.'],
  };
}

/** Everything the Studio needs: walls, doors, windows and the scale, with how the scale was found. */
export function analyseFloorPlan(image: RasterImageData, options: LocalPlanRecognitionOptions = {}): PlanAnalysis {
  if (options.metresPerPixel !== undefined && !(options.metresPerPixel > 0 && Number.isFinite(options.metresPerPixel))) {
    throw new Error('A positive calibration scale is required before recognising a plan.');
  }
  const geometry = detectPlanGeometry(image, { darkThreshold: options.darkThreshold, minRunPx: options.minRunPx });
  let scale: ScaleEstimate;
  if (options.metresPerPixel !== undefined) {
    scale = { metresPerPixel: options.metresPerPixel, source: 'dimension-text', confidence: 1, evidence: 'Set by you.' };
  } else {
    const estimated = geometry.walls.length ? estimatePlanScale(geometry) : null;
    if (!estimated) throw new Error('A positive calibration scale is required before recognising a plan.');
    scale = estimated;
  }
  const observation = planGeometryToObservation(geometry, scale.metresPerPixel, options);
  return { observation, geometry, scale };
}

/**
 * Local recogniser for orthogonal floor plans. Walls are the thick strokes (any thickness), openings
 * are the gaps in them, and a door swing or glazing line decides which is which. With no scale given
 * it reads one from the plan's own dimension text. Nothing leaves the browser.
 */
export function recogniseOrthogonalFloorPlan(image: RasterImageData, options: LocalPlanRecognitionOptions = {}): ImageReconstructionObservation {
  return analyseFloorPlan(image, options).observation;
}
