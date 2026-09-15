import type { Shape } from '../types';

// Firestore documents are capped at 1 MiB. A roof with detailed 3D tiles
// (e.g. standing-seam) or a dense timber-frame assembly can carry many
// thousands of vertices in a single shape's geometryData - large enough on
// its own, or combined with the rest of a design, to push a model's
// document past that ceiling with no way to trim it after the fact (the
// write is rejected outright, with the actual byte count and limit in the
// error message but nothing actionable done about it). Shapes whose
// geometryData serializes past OFFLOAD_SIZE_THRESHOLD are instead written
// to their own small Firestore document (in a dedicated
// `geometryOverflow` collection, not Storage - a raw browser fetch() of a
// Storage download URL requires the bucket to have CORS configured for
// this app's exact origin, which isn't something app code can arrange,
// and fails hard with no fallback when it isn't; going through the
// Firestore SDK like every other read/write in this app has no such
// requirement) and replaced with a small marker object carrying just its
// document id, keeping the model's own Firestore document small
// regardless of how detailed any one shape's mesh is.
// hydrateOffloadedGeometry reverses this when a model is loaded back into
// the scene.
const OFFLOAD_MARKER = '__offloadedGeometryDocId';
const OFFLOAD_SIZE_THRESHOLD = 40000;

export interface GeometryOffloadIO {
  upload: (docId: string, jsonText: string) => Promise<void>;
  fetch: (docId: string) => Promise<string>;
}

// Firestore document ids can't contain '/', so shape ids (which are
// otherwise arbitrary strings) are sanitized before being used as one.
function toSafeDocId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
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
        const docId = `${toSafeDocId(uid)}_${toSafeDocId(shape.id)}_${Date.now()}`;
        await io.upload(docId, serialized);
        return { ...shape, geometryData: { [OFFLOAD_MARKER]: docId } as any };
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
      const docId = (shape.geometryData as any)?.[OFFLOAD_MARKER];
      if (!docId) return shape;
      try {
        const text = await io.fetch(docId);
        return { ...shape, geometryData: JSON.parse(text) };
      } catch {
        // Leave the marker in place rather than crash the whole load - the
        // shape just renders without geometry until this can be retried.
        return shape;
      }
    })
  );
}
