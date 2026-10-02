import { SkpArchiveStream } from './skpArchive';
import { CONTAINER_TAGS } from './skpRecords';

/** Largest unfamiliar record whose bytes we read whole to see whether they are a list of records. */
const PROBE_LIMIT_BYTES = 256 * 1024;
const MAX_DEPTH = 12;
const MAX_PATHS = 6000;
const SAMPLE_BYTES = 28;

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

const hexOf = (bytes: Uint8Array, n: number): string => Array.from(bytes.subarray(0, n), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Describes the layout of a SketchUp file's model data: which records sit inside which, how many there are and how
 * big, plus the first bytes of the largest plain records. Used when a file opens but nothing can be drawn from it, so
 * the reader can be taught the layout. Nothing but record types, sizes and a few raw bytes is reported.
 *
 * Every record is treated as a possible container; a record that does not fit inside the one holding it is taken as a
 * sign that the holder was not a container after all, and reading carries on after the holder.
 */
export function diagnoseSkp(buffer: ArrayBuffer): string {
  const archive = new SkpArchiveStream(new Uint8Array(buffer));
  const paths = new Map<string, { count: number; bytes: number }>();
  const tags = new Map<number, { count: number; bytes: number }>();
  const samples = new Map<number, { size: number; bytes: number; hex: string }>();
  const topLevel: string[] = [];
  let misfits = 0;

  const note = (tag: number, path: string, size: number) => {
    let t = tags.get(tag);
    if (!t) tags.set(tag, (t = { count: 0, bytes: 0 }));
    t.count++;
    t.bytes += size;
    let p = paths.get(path);
    if (!p) {
      if (paths.size >= MAX_PATHS) return;
      paths.set(path, (p = { count: 0, bytes: 0 }));
    }
    p.count++;
    p.bytes += size;
  };

  const sample = (tag: number, body: Uint8Array) => {
    let s = samples.get(tag);
    if (!s) samples.set(tag, (s = { size: body.length, bytes: 0, hex: hexOf(body, SAMPLE_BYTES) }));
    s.bytes += body.length;
  };

  const scanMemory = (body: Uint8Array, depth: number, prefix: string) => {
    let pos = 0;
    while (pos <= body.length - 6) {
      const tag = (body[pos] << 8) | body[pos + 1];
      const size = (body[pos + 2] | (body[pos + 3] << 8) | (body[pos + 4] << 16) | (body[pos + 5] << 24)) >>> 0;
      if (pos + 6 + size > body.length) {
        misfits++;
        return;
      }
      const path = `${prefix}>${hex(tag)}`;
      note(tag, path, size);
      const inner = body.subarray(pos + 6, pos + 6 + size);
      if (depth < MAX_DEPTH && size >= 6 && (CONTAINER_TAGS.has(tag) || looksLikeRecords(inner))) scanMemory(inner, depth + 1, path);
      else if (size > 0) sample(tag, inner);
      pos += 6 + size;
    }
  };

  const frames: Array<{ end: number; path: string }> = [];
  for (;;) {
    for (;;) {
      const top = frames[frames.length - 1];
      if (!top) break;
      const left = top.end - archive.pos;
      if (left >= 6) break;
      if (left > 0) archive.skip(left);
      frames.pop();
    }
    const header = archive.readHeader();
    if (!header) break;
    const { tag, size } = header;
    const parent = frames[frames.length - 1];
    if (parent && archive.pos + size > parent.end) {
      // Does not fit in its holder, so the holder was plain data.
      misfits++;
      const left = parent.end - archive.pos;
      if (left > 0) archive.skip(left);
      frames.pop();
      continue;
    }
    const path = `${parent ? parent.path : 'model'}>${hex(tag)}`;
    note(tag, path, size);
    if (frames.length <= 1 && topLevel.length < 60) topLevel.push(`${hex(tag)}:${size > 1048576 ? `${(size / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(size / 1024))}KB`}`);
    if (size === 0) continue;
    if (frames.length < MAX_DEPTH && (CONTAINER_TAGS.has(tag) || size > PROBE_LIMIT_BYTES)) {
      frames.push({ end: archive.pos + size, path });
      continue;
    }
    if (size >= 6 && size <= PROBE_LIMIT_BYTES) {
      const body = archive.take(size);
      if (!body) break;
      if (looksLikeRecords(body)) scanMemory(body, frames.length + 1, path);
      else sample(tag, body);
      continue;
    }
    if (size > 0 && size < 6) {
      const body = archive.take(size);
      if (!body) break;
      sample(tag, body);
      continue;
    }
    if (!archive.skip(size)) break;
  }
  archive.finish();

  const pathRows = [...paths.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 70)
    .map(([path, s]) => `${path.replace(/^model>/, '')} x${s.count} ${s.bytes >= 1048576 ? `${(s.bytes / 1048576).toFixed(1)}MB` : `${Math.round(s.bytes / 1024)}KB`}`);
  const sampleRows = [...samples.entries()]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 30)
    .map(([tag, s]) => `${hex(tag)}(${s.size}) ${s.hex}`);
  const key = [0x7c15, 0xc409, 0xb80b, 0xac0d, 0x6419, 0xf601, 0xf901].map((t) => `${hex(t)}=${tags.get(t)?.count ?? 0}`).join(' ');
  return [
    `model records, ${(archive.pos / 1048576).toFixed(0)}MB read, ${misfits} records did not fit their holder`,
    `key records: ${key}`,
    `top level: ${topLevel.join(' ')}`,
    `paths (nesting, count, bytes): ${pathRows.join(' | ')}`,
    `first bytes of plain records, largest kinds first: ${sampleRows.join(' | ')}`,
    `material files: ${archive.materialXml.size} xml, ${archive.otherFiles.size} images`,
  ].join('\n');
}
