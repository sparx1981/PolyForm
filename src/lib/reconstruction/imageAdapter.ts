import type { FurnitureParams, InteriorFurnitureType } from '../interiors/parametricFurniture';
import type {
  ReconstructionDraft,
  ReconstructionFurnitureCandidate,
  ReconstructionOpeningCandidate,
  ReconstructionRoomHint,
  ReconstructionSource,
  ReconstructionWallCandidate,
} from './draft';

export type RecognitionCoordinateSpace = 'pixels' | 'metres';

export interface ImageReconstructionTransform {
  coordinateSpace: RecognitionCoordinateSpace;
  /** Required when coordinates are pixels. */
  metresPerPixel?: number;
  /** Pixel point that maps to world [0,0]. Defaults to image centre. */
  pixelOrigin?: [number, number];
  /** Optional clockwise rotation into PolyForm X/Z, in radians. */
  rotationY?: number;
}

export interface RecognisedWall {
  id: string;
  start: [number, number];
  end: [number, number];
  height?: number;
  thickness?: number;
  confidence?: number;
}

export interface RecognisedOpening {
  id: string;
  kind: 'door' | 'window';
  wallId: string;
  centerT: number;
  width: number;
  height: number;
  sill?: number;
  style?: string;
  confidence?: number;
}

export interface RecognisedFurniture {
  id: string;
  type: InteriorFurnitureType;
  position: [number, number];
  rotationY?: number;
  params?: FurnitureParams;
  confidence?: number;
}

export interface RecognisedRoom {
  name?: string;
  at: [number, number];
  confidence?: number;
}

export interface ImageReconstructionObservation {
  source: ReconstructionSource;
  imageSize?: [number, number];
  transform: ImageReconstructionTransform;
  walls: RecognisedWall[];
  openings?: RecognisedOpening[];
  furniture?: RecognisedFurniture[];
  rooms?: RecognisedRoom[];
  uncertainties?: string[];
}

export interface ImageReconstructionProviderRequest {
  imageDataUrl: string;
  fileName?: string;
  mode?: 'floor-plan' | 'photo';
  hints?: string[];
}

export interface ImageReconstructionProvider {
  id: string;
  recognise(request: ImageReconstructionProviderRequest): Promise<ImageReconstructionObservation>;
}

function finitePoint(p: [number, number]): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

function toMetres(
  point: [number, number],
  observation: ImageReconstructionObservation,
): [number, number] {
  if (!finitePoint(point)) throw new Error('Recognition coordinates must be finite.');
  if (observation.transform.coordinateSpace === 'metres') return point;

  const mpp = observation.transform.metresPerPixel;
  if (!(mpp && mpp > 0) || !Number.isFinite(mpp)) {
    throw new Error('Pixel recognition requires a positive metresPerPixel calibration.');
  }
  const origin = observation.transform.pixelOrigin
    ?? (observation.imageSize ? [observation.imageSize[0] / 2, observation.imageSize[1] / 2] as [number, number] : [0, 0]);
  const x = (point[0] - origin[0]) * mpp;
  const z = (point[1] - origin[1]) * mpp;
  const a = observation.transform.rotationY ?? 0;
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

export function imageObservationToDraft(observation: ImageReconstructionObservation): ReconstructionDraft {
  if (!observation.source || !['image', 'photo', 'roomplan', 'pdf-vector', 'ifc'].includes(observation.source.kind)) {
    throw new Error('Image reconstruction source is invalid.');
  }

  const wallIds = new Set<string>();
  const walls: ReconstructionWallCandidate[] = observation.walls.map(wall => {
    if (!wall.id || wallIds.has(wall.id)) throw new Error(`Duplicate or missing recognised wall id: ${wall.id || '(empty)'}`);
    wallIds.add(wall.id);
    return {
      ...wall,
      start: toMetres(wall.start, observation),
      end: toMetres(wall.end, observation),
    };
  });

  const openings: ReconstructionOpeningCandidate[] = (observation.openings ?? []).map(opening => ({
    ...opening,
  }));

  const furniture: ReconstructionFurnitureCandidate[] = (observation.furniture ?? []).map(item => ({
    ...item,
    position: toMetres(item.position, observation),
    rotationY: (item.rotationY ?? 0) + (observation.transform.rotationY ?? 0),
  }));

  const rooms: ReconstructionRoomHint[] = (observation.rooms ?? []).map(room => ({
    ...room,
    at: toMetres(room.at, observation),
  }));

  return {
    version: 1,
    source: observation.source,
    coordinateSpace: 'metres',
    walls,
    openings,
    furniture,
    rooms,
    uncertainties: observation.uncertainties,
  };
}

export class ImageReconstructionProviderRegistry {
  private providers = new Map<string, ImageReconstructionProvider>();

  register(provider: ImageReconstructionProvider): void {
    if (!provider.id.trim()) throw new Error('Image reconstruction provider id is required.');
    this.providers.set(provider.id, provider);
  }

  list(): string[] {
    return [...this.providers.keys()].sort();
  }

  async reconstruct(
    providerId: string,
    request: ImageReconstructionProviderRequest,
  ): Promise<ReconstructionDraft> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown image reconstruction provider: ${providerId}`);
    const observation = await provider.recognise(request);
    return imageObservationToDraft(observation);
  }
}
