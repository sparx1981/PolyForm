import { SkpArchiveStream } from './skpArchive';
import { CONTAINER_TAGS } from './skpRecords';

interface TagStats {
  count: number;
  bytes: number;
  /** How many times a record with this tag is not a known container but its bytes read as a list of records. */
  looksNested: number;
  minDepth: number;
}

/** Largest unknown record whose contents we try reading as nested records. */
const PROBE_LIMIT_BYTES = 256 * 1024;
const MAX_PROBES = 200_000;
const MAX_DEPTH = 8;

const hex = (tag: number): string => tag.toString(16).toUpperCase().padStart(4, '0');

/** True when the bytes are exactly a sequence of well-formed records. */
function looksLikeRecords(body: Uint8Array): boolean {
  let pos = 0;
  let count = 0;
  while (pos <= body.length - 6) {
    const size = (body[pos + 2] | (body[pos + 3] << 8) | (body[pos + 4] << 16) | (body[pos + 5] << 24)) >>> 0;
    if (pos + 6 + size > body.length) return false;
    pos += 6 + size;
    count++;
  }
  return pos === body.length && count > 0;
}

/**
 * Describes the layout of a SketchUp file's model data: which kinds of record it holds, how many and how big, and which
 * unfamiliar ones seem to contain further records. Used when a file opens but no geometry can be found in it, so the
 * reader can be taught the layout.
 */
export function diagnoseSkp(buffer: ArrayBuffer): string {
  const data = new Uint8Array(buffer);
  const archive = new SkpArchiveStream(data);
  const stats = new Map<number, TagStats>();
  const topLevel: string[] = [];
  let probes = 0;

  const note = (tag: number, size: number, depth: number): TagStats => {
    let s = stats.get(tag);
    if (!s) {
      s = { count: 0, bytes: 0, looksNested: 0, minDepth: depth };
      stats.set(tag, s);
    }
    s.count++;
    s.bytes += size;
    if (depth < s.minDepth) s.minDepth = depth;
    return s;
  };

  const scanMemory = (body: Uint8Array, depth: number) => {
    let pos = 0;
    while (pos <= body.length - 6) {
      const tag = (body[pos] << 8) | body[pos + 1];
      const size = (body[pos + 2] | (body[pos + 3] << 8) | (body[pos + 4] << 16) | (body[pos + 5] << 24)) >>> 0;
      if (pos + 6 + size > body.length) return;
      const s = note(tag, size, depth);
      const inner = body.subarray(pos + 6, pos + 6 + size);
      if (depth < MAX_DEPTH && size >= 6 && (CONTAINER_TAGS.has(tag) || looksLikeRecords(inner))) {
        if (!CONTAINER_TAGS.has(tag)) s.looksNested++;
        scanMemory(inner, depth + 1);
      }
      pos += 6 + size;
    }
  };

  const ends: number[] = [];
  for (;;) {
    while (ends.length && archive.pos >= ends[ends.length - 1]) ends.pop();
    const header = archive.readHeader();
    if (!header) break;
    const depth = ends.length;
    const { tag, size } = header;
    const s = note(tag, size, depth);
    if (depth <= 1 && topLevel.length < 40) topLevel.push(`${hex(tag)}:${(size / 1048576).toFixed(1)}MB`);
    if (size > 0 && CONTAINER_TAGS.has(tag)) {
      ends.push(archive.pos + size);
      continue;
    }
    if (size >= 6 && size <= PROBE_LIMIT_BYTES && probes < MAX_PROBES) {
      const body = archive.take(size);
      if (!body) break;
      probes++;
      if (looksLikeRecords(body)) {
        s.looksNested++;
        scanMemory(body, depth + 1);
      }
      continue;
    }
    if (!archive.skip(size)) break;
  }
  archive.finish();

  const rows = [...stats.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 45)
    .map(([tag, s]) => `${hex(tag)} x${s.count} ${(s.bytes / 1024).toFixed(0)}KB d${s.minDepth}${CONTAINER_TAGS.has(tag) ? ' C' : ''}${s.looksNested ? ` nested${s.looksNested}` : ''}`);
  const key = [0x7c15, 0xc409, 0xb80b, 0xac0d, 0x6419, 0xf601].map((t) => `${hex(t)}=${stats.get(t)?.count ?? 0}`).join(' ');
  return [
    `model records, ${(archive.pos / 1048576).toFixed(0)}MB read`,
    `key records: ${key}`,
    `top level: ${topLevel.join(' ')}`,
    `by size (tag, count, bytes, shallowest depth, C=known container): ${rows.join(' | ')}`,
    `material files: ${archive.materialXml.size} xml, ${archive.otherFiles.size} images`,
  ].join('\n');
}
