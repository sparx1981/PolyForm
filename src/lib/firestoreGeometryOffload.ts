import type { Shape } from '../types';

// Firestore documents are capped at 1 MiB. A roof with detailed 3D tiles
// (e.g. standing-seam) or a dense timber-frame assembly can carry many
// thousands of vertices in a single shape's geometryData - large enough on
// its own, or combined with the rest of a design, to push a model's
// document past that ceiling with no way to trim it after the fact (the
// write is rejected outright, with the actual byte count and limit in the
// error message but nothing actionable done about it). Shapes whose
// geometryData serializes past OFFLOAD_SIZE_THRESHOLD are instead uploaded
// as a standalone JSON blob (to Storage in production) and replaced with a
// small marker object carrying just its URL, keeping the Firestore
// document itself small regardless of how detailed any one shape's mesh
// is. hydrateOffloadedGeometry reverses this when a model is loaded back
// into the scene.
const OFFLOAD_MARKER = '__offloadedGeometryUrl';
const OFFLOAD_SIZE_THRESHOLD = 40000;

export interface GeometryOffloadIO {
  upload: (path: string, jsonText: string) => Promise<string>;
  fetch: (url: string) => Promise<string>;
}

export async function offloadLargeGeometryForSave(
  shapes: Shape[],
  uid: string,
  io: GeometryOffloadIO
): Promise<Shape[]> {
  return Promise.all(
    shapes.map(async (shape) => {
      if (!shape.geometryData) return shape;
      const serialized = JSON.stringify(shape.geometryData);
      if (serialized.length <= OFFLOAD_SIZE_THRESHOLD) return shape;
      try {
        const path = `geometry-overflow/${uid}/${shape.id}-${Date.now()}.json`;
        const url = await io.upload(path, serialized);
        return { ...shape, geometryData: { [OFFLOAD_MARKER]: url } as any };
      } catch {
        // If the upload itself fails, fall back to saving inline - a
        // possible oversized-document error at least surfaces a clear
        // reason, which is better than silently dropping the geometry.
        return shape;
      }
    })
  );
}

export async function hydrateOffloadedGeometry(
  shapes: Shape[],
  io: Pick<GeometryOffloadIO, 'fetch'>
): Promise<Shape[]> {
  return Promise.all(
    shapes.map(async (shape) => {
      const url = (shape.geometryData as any)?.[OFFLOAD_MARKER];
      if (!url) return shape;
      try {
        const text = await io.fetch(url);
        return { ...shape, geometryData: JSON.parse(text) };
      } catch {
        // Leave the marker in place rather than crash the whole load - the
        // shape just renders without geometry until this can be retried.
        return shape;
      }
    })
  );
}
