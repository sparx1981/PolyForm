import type { Shape } from '../../types';

export type ReferencePlanKind = 'image' | 'pdf-page' | 'svg';

export interface ReferencePlanSource {
  kind: ReferencePlanKind;
  name?: string;
  /** Browser-safe URL/data URL for the rendered page/image. */
  imageUrl: string;
  page?: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface ReferencePlanCalibration {
  pixelA: [number, number];
  pixelB: [number, number];
  knownDistanceM: number;
}

export interface ReferencePlanSettings {
  opacity?: number;
  rotationY?: number;
  position?: [number, number, number];
  locked?: boolean;
}

export interface CalibratedReferencePlan {
  metresPerPixel: number;
  widthM: number;
  heightM: number;
}

export function calibrateReferencePlan(
  source: Pick<ReferencePlanSource, 'pixelWidth' | 'pixelHeight'>,
  calibration: ReferencePlanCalibration,
): CalibratedReferencePlan {
  const pixelDistance = Math.hypot(
    calibration.pixelB[0] - calibration.pixelA[0],
    calibration.pixelB[1] - calibration.pixelA[1],
  );
  if (!(pixelDistance > 0) || !Number.isFinite(pixelDistance)) {
    throw new Error('Reference calibration points must be different.');
  }
  if (!(calibration.knownDistanceM > 0) || !Number.isFinite(calibration.knownDistanceM)) {
    throw new Error('Reference calibration distance must be positive.');
  }
  if (!(source.pixelWidth > 0) || !(source.pixelHeight > 0)) {
    throw new Error('Reference image dimensions must be positive.');
  }
  const metresPerPixel = calibration.knownDistanceM / pixelDistance;
  return {
    metresPerPixel,
    widthM: source.pixelWidth * metresPerPixel,
    heightM: source.pixelHeight * metresPerPixel,
  };
}

/**
 * A calibrated plan is an ordinary thin PolyForm box laid flat in X/Z with a
 * texture, so existing transforms, visibility, save/load and export rules apply.
 */
export function createReferencePlanShape(
  source: ReferencePlanSource,
  calibration: ReferencePlanCalibration,
  settings: ReferencePlanSettings = {},
): Shape {
  const scale = calibrateReferencePlan(source, calibration);
  const opacity = Math.max(0.05, Math.min(1, settings.opacity ?? 0.55));
  return {
    id: Math.random().toString(36).slice(2, 11),
    name: source.name ? `Reference: ${source.name}` : 'Reference plan',
    type: 'box',
    position: settings.position ?? [0, 0.002, 0],
    rotation: [0, settings.rotationY ?? 0, 0],
    args: [scale.widthM, 0.004, scale.heightM],
    color: '#ffffff',
    textureUrl: source.imageUrl,
    opacity,
    roughness: 1,
    metalness: 0,
    tags: ['reference', 'floorplan-underlay'],
    customData: {
      referencePlan: {
        source,
        calibration,
        metresPerPixel: scale.metresPerPixel,
        locked: settings.locked ?? true,
      },
    },
  };
}

export function isReferencePlanShape(shape: Shape): boolean {
  return Boolean(shape.customData?.referencePlan);
}

/** Pixel coordinate on the source page -> world X/Z on the calibrated underlay. */
export function referencePixelToWorld(
  shape: Shape,
  pixel: [number, number],
): [number, number] {
  const ref = shape.customData?.referencePlan;
  if (!ref) throw new Error('Shape is not a calibrated reference plan.');
  const source = ref.source as ReferencePlanSource;
  const mpp = Number(ref.metresPerPixel);
  const localX = (pixel[0] - source.pixelWidth / 2) * mpp;
  const localZ = (pixel[1] - source.pixelHeight / 2) * mpp;
  const angle = shape.rotation?.[1] ?? 0;
  const c = Math.cos(angle), s = Math.sin(angle);
  return [
    shape.position[0] + localX * c + localZ * s,
    shape.position[2] - localX * s + localZ * c,
  ];
}
