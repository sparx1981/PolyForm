import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import type { UnzipFile } from 'fflate';

/** A texture image or other material file the model refers to. Only its size and first bytes are kept: the image is not embedded in what we build. */
export interface FileStub {
  size: number;
  head: Uint8Array;
}

/** How much compressed data to feed the decompressor at a time. Bounds how much decompressed data is waiting. */
const FEED_BYTES = 2 * 1024 * 1024;
const STUB_HEAD_BYTES = 16;

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];

export class SkpArchiveError extends Error {}

function findZipStart(data: Uint8Array): number {
  const limit = Math.min(data.length - 4, 1 << 20);
  for (let i = 0; i <= limit; i++) {
    if (data[i] === ZIP_LOCAL_HEADER[0] && data[i + 1] === ZIP_LOCAL_HEADER[1] && data[i + 2] === ZIP_LOCAL_HEADER[2] && data[i + 3] === ZIP_LOCAL_HEADER[3]) return i;
  }
  throw new SkpArchiveError('No embedded ZIP archive found in the file');
}

/** Some writers store names as raw UTF-8 bytes read as Latin-1; undo that when the bytes really are UTF-8. */
function decodeEntryName(entry: string): string {
  if (!/[\u0080-ÿ]/.test(entry)) return entry;
  const bytes = new Uint8Array(entry.length);
  for (let i = 0; i < entry.length; i++) {
    const code = entry.charCodeAt(i);
    if (code > 255) return entry;
    bytes[i] = code;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return entry;
  }
}

/**
 * A SketchUp 2021+ file is a small header followed by a ZIP holding model.dat (every entity in the model) and
 * material files. Reading the ZIP the usual way inflates model.dat into one array as big as the whole model, which
 * can run to gigabytes. This inflates it a couple of megabytes at a time and hands the bytes out in order, so only
 * the part being read is ever in memory.
 */
export class SkpArchiveStream {
  /** Bytes of model.dat consumed so far. */
  pos = 0;
  readonly materialXml = new Map<string, Uint8Array>();
  readonly otherFiles = new Map<string, FileStub>();

  private readonly zip: Uint8Array;
  private readonly unzip: Unzip;
  private fed: number;
  private zipEnded = false;
  private chunks: Uint8Array[] = [];
  private chunkIndex = 0;
  private chunkOffset = 0;
  private available = 0;
  private modelSeen = false;
  private modelFinished = false;

  constructor(file: Uint8Array, private readonly onProgress?: (fedBytes: number, totalBytes: number) => void) {
    this.fed = findZipStart(file);
    this.zip = file;
    this.unzip = new Unzip();
    this.unzip.register(UnzipInflate);
    this.unzip.register(UnzipPassThrough);
    this.unzip.onfile = (entry) => this.onEntry(entry);
  }

  private onEntry(entry: UnzipFile): void {
    const name = decodeEntryName(entry.name);
    const lower = name.toLowerCase();
    if (lower === 'model.dat' || lower.endsWith('/model.dat')) {
      this.modelSeen = true;
      entry.ondata = (err, data, final) => {
        if (err) throw err;
        if (data.length > 0) {
          this.chunks.push(data);
          this.available += data.length;
        }
        if (final) this.modelFinished = true;
      };
      entry.start();
      return;
    }
    if (lower.startsWith('materials/') && lower.endsWith('material.xml')) {
      const parts: Uint8Array[] = [];
      entry.ondata = (err, data, final) => {
        if (err) throw err;
        parts.push(data);
        if (final) this.materialXml.set(name, concat(parts));
      };
      entry.start();
      return;
    }
    const wanted = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || (lower.includes('material') && !lower.endsWith('.xml'));
    if (!wanted) return;
    const head = new Uint8Array(STUB_HEAD_BYTES);
    let size = 0;
    entry.ondata = (err, data, final) => {
      if (err) throw err;
      if (size < STUB_HEAD_BYTES) head.set(data.subarray(0, STUB_HEAD_BYTES - size), size);
      size += data.length;
      if (final) this.otherFiles.set(name, { size, head: head.slice(0, Math.min(size, STUB_HEAD_BYTES)) });
    };
    entry.start();
  }

  /** Feeds the decompressor the next piece of the file. False once everything has been fed. */
  private feed(): boolean {
    if (this.zipEnded) return false;
    const end = Math.min(this.fed + FEED_BYTES, this.zip.length);
    const last = end >= this.zip.length;
    this.unzip.push(this.zip.subarray(this.fed, end), last);
    this.fed = end;
    if (last) this.zipEnded = true;
    this.onProgress?.(this.fed, this.zip.length);
    return true;
  }

  /** True when at least `n` more bytes of model.dat can be read. */
  ensure(n: number): boolean {
    while (this.available < n) {
      if (this.modelFinished || !this.feed()) return false;
    }
    return true;
  }

  /** Whether any model.dat bytes remain. */
  hasMore(): boolean {
    return this.ensure(1);
  }

  private consume(n: number): void {
    this.available -= n;
    this.pos += n;
    let left = n;
    while (left > 0) {
      const chunk = this.chunks[this.chunkIndex];
      const inChunk = chunk.length - this.chunkOffset;
      if (left < inChunk) {
        this.chunkOffset += left;
        left = 0;
      } else {
        left -= inChunk;
        this.chunks[this.chunkIndex] = EMPTY;
        this.chunkIndex++;
        this.chunkOffset = 0;
      }
    }
    if (this.chunkIndex > 64) {
      this.chunks = this.chunks.slice(this.chunkIndex);
      this.chunkIndex = 0;
    }
  }

  /** Reads a record header: its two tag bytes as one number, and its payload size. Null at the end of the data. */
  readHeader(): { tag: number; size: number } | null {
    if (!this.ensure(6)) return null;
    const b = this.peek(6);
    const tag = (b[0] << 8) | b[1];
    const size = (b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24)) >>> 0;
    this.consume(6);
    return { tag, size };
  }

  private peek(n: number): Uint8Array {
    const chunk = this.chunks[this.chunkIndex];
    if (chunk.length - this.chunkOffset >= n) return chunk.subarray(this.chunkOffset, this.chunkOffset + n);
    const out = new Uint8Array(n);
    let filled = 0;
    let index = this.chunkIndex;
    let offset = this.chunkOffset;
    while (filled < n) {
      const part = this.chunks[index];
      const take = Math.min(n - filled, part.length - offset);
      out.set(part.subarray(offset, offset + take), filled);
      filled += take;
      index++;
      offset = 0;
    }
    return out;
  }

  /** Reads exactly `n` bytes, or returns null when the data ends first. */
  take(n: number): Uint8Array | null {
    if (n === 0) return EMPTY;
    if (!this.ensure(n)) return null;
    const out = this.peek(n);
    this.consume(n);
    return out;
  }

  /** Steps over `n` bytes without keeping them. Returns false when the data ends first. */
  skip(n: number): boolean {
    let left = n;
    while (left > 0) {
      if (!this.ensure(1)) return false;
      const step = Math.min(left, this.available);
      this.consume(step);
      left -= step;
    }
    return true;
  }

  /** Reads the rest of the archive, so the material files that follow model.dat are collected too. */
  finish(): void {
    while (this.feed()) {
      // Whatever model.dat bytes are left over are not needed; drop them as they arrive.
      if (this.available > 0) this.consume(this.available);
    }
    if (this.available > 0) this.consume(this.available);
    if (!this.modelSeen) throw new SkpArchiveError('ZIP archive found but does not contain a model.dat entry');
  }
}

const EMPTY = new Uint8Array(0);

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
