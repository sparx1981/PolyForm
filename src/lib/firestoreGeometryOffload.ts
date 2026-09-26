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

// 53-bit string hash (cyrb53) plus the length: plenty to tell two meshes of one shape apart.
function contentHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}${text.length.toString(36)}`;
}

// Offloaded geometry documents never change once written (their ids are
// content hashes, or timestamps for older ones), so a client can remember
// them: every auto-save would otherwise rewrite each large mesh, and every
// model snapshot (including the echo of this client's own save) would read
// each one back from Firestore again.
const CACHE_CHAR_BUDGET = 32_000_000;

export function withGeometryCache(io: GeometryOffloadIO): GeometryOffloadIO {
  const known = new Set<string>();
  const texts = new Map<string, string>();
  let chars = 0;
  const remember = (docId: string, text: string) => {
    known.add(docId);
    if (texts.has(docId)) texts.delete(docId);
    texts.set(docId, text);
    chars += text.length;
    for (const [oldest, oldText] of texts) {
      if (chars <= CACHE_CHAR_BUDGET || oldest === docId) break;
      texts.delete(oldest);
      chars -= oldText.length;
    }
  };
  return {
    upload: async (docId, jsonText) => {
      if (known.has(docId)) return;
      await io.upload(docId, jsonText);
      remember(docId, jsonText);
    },
    fetch: async (docId) => {
      const cached = texts.get(docId);
      if (cached !== undefined) return cached;
      const text = await io.fetch(docId);
      remember(docId, text);
      return text;
    },
  };
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
        // Named after the content, so saving unchanged geometry again maps to the
        // same document (which a cached IO then skips) instead of a new one per save.
        const docId = `${toSafeDocId(uid)}_${toSafeDocId(shape.id)}_g${contentHash(serialized)}`;
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
