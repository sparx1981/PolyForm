import type { Shape } from '../types';
import { landscapePresetIdForDataUrl } from './landscapeTextures';

// Firestore documents are capped at 1 MiB. A roof with detailed 3D tiles
// (e.g. standing-seam) or a dense timber-frame assembly can carry many
// thousands of vertices in a single shape's geometryData - large enough on
// its own, or combined with the rest of a design, to push a model's
// document past that ceiling with no way to trim it after the fact (the
// write is rejected outright, with the actual byte count and limit in the
// error message but nothing actionable done about it). Shapes whose
// geometryData serializes past OFFLOAD_SIZE_THRESHOLD are instead written,
// compressed and split into parts as needed (see blobCodec.ts), to their own
// Firestore documents (in a dedicated
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

// The same goes for embedded images (uploaded textures, generated texture
// canvases, scene previews), which are stored once each however many objects
// use them, and a terrain's height grids once they are large. Images are
// replaced by a `pf-blob:<id>` string, so a field that held a URL still holds
// a string if it can't be fetched back.
const IMAGE_MARKER_PREFIX = 'pf-blob:';
const IMAGE_SIZE_THRESHOLD = 20000;
const TERRAIN_MARKER = '__offloadedArraysDocId';
const TERRAIN_ARRAYS = ['heights', 'baseHeights', 'masks'] as const;
const TERRAIN_SIZE_THRESHOLD = 150000;

export interface GeometryOffloadIO {
  upload: (docId: string, jsonText: string) => Promise<void>;
  fetch: (docId: string) => Promise<string>;
}

// Firestore document ids can't contain '/', so user ids are sanitized first.
function toSafeDocId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// 53-bit string hash (cyrb53) plus the length: plenty to tell two meshes apart.
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

// Documents are named after their content, so saving an unchanged value again
// maps to the same document, and the same image used by twenty objects is
// stored once.
async function store(io: GeometryOffloadIO, uid: string, kind: string, text: string): Promise<string> {
  const docId = `${toSafeDocId(uid)}_${kind}${contentHash(text)}`;
  await io.upload(docId, text);
  return docId;
}

// Offloaded documents never change once written, so a client can remember
// them: every auto-save would otherwise rewrite each large value, and every
// model snapshot (including the echo of this client's own save) would read
// each one back from Firestore again.
const CACHE_CHAR_BUDGET = 32_000_000;

export function withGeometryCache(io: GeometryOffloadIO): GeometryOffloadIO {
  const known = new Set<string>();
  const texts = new Map<string, string>();
  const pending = new Map<string, Promise<unknown>>();
  let chars = 0;
  const remember = (docId: string, text: string) => {
    known.add(docId);
    if (texts.has(docId)) chars -= texts.get(docId)!.length;
    texts.delete(docId);
    texts.set(docId, text);
    chars += text.length;
    for (const [oldest, oldText] of texts) {
      if (chars <= CACHE_CHAR_BUDGET || oldest === docId) break;
      texts.delete(oldest);
      chars -= oldText.length;
    }
  };
  // One request per document even when several objects ask for it at once.
  const once = <T,>(key: string, run: () => Promise<T>): Promise<T> => {
    const inFlight = pending.get(key);
    if (inFlight) return inFlight as Promise<T>;
    const p = run().finally(() => pending.delete(key));
    pending.set(key, p);
    return p;
  };
  return {
    upload: async (docId, jsonText) => {
      if (known.has(docId)) return;
      await once(`u:${docId}`, async () => {
        if (known.has(docId)) return;
        await io.upload(docId, jsonText);
        remember(docId, jsonText);
      });
    },
    fetch: async (docId) => {
      const cached = texts.get(docId);
      if (cached !== undefined) return cached;
      return once(`f:${docId}`, async () => {
        const text = await io.fetch(docId);
        remember(docId, text);
        return text;
      });
    },
  };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Rebuilds `value` with `fn` applied to every string in its plain objects and
 * arrays (skipping `skip` keys), returning the same reference wherever nothing
 * changed. Other objects (Firestore sentinels, typed arrays) are left alone.
 */
async function mapStrings(value: unknown, fn: (s: string) => Promise<string>, skip: ReadonlySet<string> = new Set()): Promise<unknown> {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) {
    // Number grids and point lists: nothing to visit.
    if (value.every(v => v === null || (typeof v !== 'object' && typeof v !== 'string'))) return value;
    const next = await Promise.all(value.map(v => mapStrings(v, fn)));
    return next.some((v, i) => v !== value[i]) ? next : value;
  }
  if (isPlainObject(value)) {
    let changed = false;
    const next: Record<string, unknown> = {};
    await Promise.all(Object.entries(value).map(async ([k, v]) => {
      const out = skip.has(k) ? v : await mapStrings(v, fn);
      if (out !== v) changed = true;
      next[k] = out;
    }));
    return changed ? next : value;
  }
  return value;
}

function offloadImagesIn(value: unknown, uid: string, io: GeometryOffloadIO, skip?: ReadonlySet<string>) {
  return mapStrings(value, async (s) => {
    if (s.length <= IMAGE_SIZE_THRESHOLD || !s.startsWith('data:')) return s;
    // Built-in terrain textures are saved by name and redrawn identically on load.
    const builtIn = landscapePresetIdForDataUrl(s);
    if (builtIn) return builtIn;
    try {
      return IMAGE_MARKER_PREFIX + await store(io, uid, 'i', s);
    } catch {
      return s; // Kept inline: the save may still fit, and if not says why.
    }
  }, skip);
}

function hydrateImagesIn(value: unknown, io: Pick<GeometryOffloadIO, 'fetch'>, skip?: ReadonlySet<string>) {
  return mapStrings(value, async (s) => {
    if (!s.startsWith(IMAGE_MARKER_PREFIX)) return s;
    try {
      return await io.fetch(s.slice(IMAGE_MARKER_PREFIX.length));
    } catch {
      return s; // Left as the marker, so the next save keeps pointing at the image.
    }
  }, skip);
}

const SHAPE_SKIP = new Set(['geometryData']);
const TERRAIN_SKIP = new Set<string>(TERRAIN_ARRAYS);

async function offloadTerrain(terrainData: any, uid: string, io: GeometryOffloadIO) {
  if (!isPlainObject(terrainData)) return terrainData;
  const strip = (marker: string) => {
    const next: Record<string, unknown> = { ...terrainData, [TERRAIN_MARKER]: marker };
    for (const k of TERRAIN_ARRAYS) delete next[k];
    return next;
  };
  // Its grids never came back from storage: keep pointing at them rather than save stand-ins.
  const existing = terrainData[TERRAIN_MARKER];
  if (typeof existing === 'string') return strip(existing);
  const grids: Record<string, unknown> = {};
  for (const k of TERRAIN_ARRAYS) if (terrainData[k] !== undefined) grids[k] = terrainData[k];
  const serialized = JSON.stringify(grids);
  if (serialized.length <= TERRAIN_SIZE_THRESHOLD) return terrainData;
  try {
    return strip(await store(io, uid, 't', serialized));
  } catch {
    return terrainData;
  }
}

async function hydrateTerrain(terrainData: any, io: Pick<GeometryOffloadIO, 'fetch'>) {
  const docId = terrainData?.[TERRAIN_MARKER];
  if (typeof docId !== 'string') return terrainData;
  try {
    const next = { ...terrainData, ...JSON.parse(await io.fetch(docId)) };
    delete next[TERRAIN_MARKER];
    return next;
  } catch {
    // A flat stand-in so the scene still draws; the marker stays, so saving keeps the real grids.
    const count = Math.max(1, (terrainData.gridX || 1) * (terrainData.gridY || 1));
    return { ...terrainData, heights: new Array(count).fill(0) };
  }
}

/**
 * Moves each shape's large values (meshes, big terrain grids, embedded images)
 * out of the model document into their own compressed documents, leaving
 * small markers that hydrateOffloadedGeometry reverses.
 */
export async function offloadLargeGeometryForSave(
  shapes: Shape[],
  uid: string,
  io: GeometryOffloadIO
): Promise<Shape[]> {
  return Promise.all(
    shapes.map(async (original) => {
      let shape = (await offloadImagesIn(original, uid, io, SHAPE_SKIP)) as Shape;
      if (shape.terrainData) {
        const terrainData = await offloadTerrain(shape.terrainData, uid, io);
        if (terrainData !== shape.terrainData) shape = { ...shape, terrainData };
      }
      if (!shape.geometryData || (shape.geometryData as any)[OFFLOAD_MARKER]) return shape;
      const serialized = JSON.stringify(shape.geometryData);
      if (serialized.length <= OFFLOAD_SIZE_THRESHOLD) return shape;
      try {
        const docId = await store(io, uid, 'g', serialized);
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

export interface HydrateOptions {
  geometry?: boolean;
  terrain?: boolean;
  images?: boolean;
}

export async function hydrateOffloadedGeometry(
  shapes: Shape[],
  io: Pick<GeometryOffloadIO, 'fetch'>,
  { geometry = true, terrain = true, images = true }: HydrateOptions = {}
): Promise<Shape[]> {
  return Promise.all(
    shapes.map(async (original) => {
      let shape = images ? (await hydrateImagesIn(original, io, SHAPE_SKIP)) as Shape : original;
      if (terrain && shape.terrainData) {
        const terrainData = await hydrateTerrain(shape.terrainData, io);
        if (terrainData !== shape.terrainData) shape = { ...shape, terrainData };
      }
      const docId = geometry ? (shape.geometryData as any)?.[OFFLOAD_MARKER] : undefined;
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

// Model fields other than shapes that may hold images; the kernel graph is
// only numbers, and the rest are small settings or Firestore sentinels.
// previewUrl is the small list thumbnail, read straight from the document.
const MODEL_SKIP = new Set(['shapes', 'kernel', 'updatedAt', 'createdAt', 'previewUrl']);

/** offloadLargeGeometryForSave for a whole model: its shapes plus images in scenes, materials, notes... */
export async function offloadModelForSave<T extends Record<string, any>>(state: T, uid: string, io: GeometryOffloadIO): Promise<T> {
  const rest = (await offloadImagesIn(state, uid, io, MODEL_SKIP)) as T;
  if (!Array.isArray(state.shapes)) return rest;
  return { ...rest, shapes: await offloadLargeGeometryForSave(state.shapes, uid, io) };
}

/** Reverses offloadModelForSave on a model document's data. */
export async function hydrateOffloadedModel<T extends Record<string, any>>(data: T, io: Pick<GeometryOffloadIO, 'fetch'>): Promise<T> {
  const rest = (await hydrateImagesIn(data, io, MODEL_SKIP)) as T;
  if (!Array.isArray(data.shapes)) return rest;
  return { ...rest, shapes: await hydrateOffloadedGeometry(data.shapes, io) };
}
