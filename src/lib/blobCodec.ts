import type { GeometryOffloadIO } from './firestoreGeometryOffload';

// Large values moved out of a model document (meshes, images, big terrain
// grids) are stored gzip-compressed as Firestore bytes, split across as many
// documents as needed so no single one nears Firestore's 1 MiB cap: the
// first under the value's own id, the rest under `${id}_p1`, `${id}_p2`, ...
// Documents written before this (a plain `data` string) still read back.

/** Bytes per document: comfortably under 1 MiB once the other fields are added. */
export const BLOB_PART_BYTES = 900_000;

type Encoding = 'gzip' | 'utf8';

async function pipe(bytes: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream }): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as any);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function packBlob(text: string): Promise<{ enc: Encoding; parts: Uint8Array[] }> {
  const raw = new TextEncoder().encode(text);
  const CS = (globalThis as any).CompressionStream;
  const enc: Encoding = CS ? 'gzip' : 'utf8';
  const bytes = CS ? await pipe(raw, new CS('gzip')) : raw;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < bytes.length || i === 0; i += BLOB_PART_BYTES) parts.push(bytes.subarray(i, i + BLOB_PART_BYTES));
  return { enc, parts };
}

export async function unpackBlob(enc: Encoding, parts: Uint8Array[]): Promise<string> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  if (enc === 'gzip') {
    const DS = (globalThis as any).DecompressionStream;
    if (!DS) throw new Error('This browser cannot read compressed model data.');
    return new TextDecoder().decode(await pipe(bytes, new DS('gzip')));
  }
  return new TextDecoder().decode(bytes);
}

/** How one Firestore SDK (web or admin) reads and writes a document of the blob store. */
export interface BlobDocs {
  write(docId: string, fields: Record<string, unknown>): Promise<void>;
  /** The document's fields, or null if it doesn't exist. */
  read(docId: string): Promise<Record<string, any> | null>;
  toBytes(bytes: Uint8Array): unknown;
  fromBytes(value: any): Uint8Array;
}

export function chunkedBlobIO(docs: BlobDocs, uid: () => string): GeometryOffloadIO {
  return {
    upload: async (docId, text) => {
      const { enc, parts } = await packBlob(text);
      const base = { userId: uid(), createdAt: Date.now() };
      // Extra parts first: the first document appearing means the whole value is there.
      await Promise.all(parts.slice(1).map((p, i) => docs.write(`${docId}_p${i + 1}`, { ...base, data: docs.toBytes(p) })));
      await docs.write(docId, { ...base, enc, parts: parts.length, data: docs.toBytes(parts[0]) });
    },
    fetch: async (docId) => {
      const first = await docs.read(docId);
      if (!first) throw new Error(`Offloaded data not found: ${docId}`);
      if (typeof first.data === 'string') return first.data;
      const count = Number(first.parts) || 1;
      const rest = await Promise.all(Array.from({ length: count - 1 }, async (_, i) => {
        const part = await docs.read(`${docId}_p${i + 1}`);
        if (!part) throw new Error(`Offloaded data incomplete: ${docId}`);
        return docs.fromBytes(part.data);
      }));
      return unpackBlob(first.enc === 'gzip' ? 'gzip' : 'utf8', [docs.fromBytes(first.data), ...rest]);
    },
  };
}
