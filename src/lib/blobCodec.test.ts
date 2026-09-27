import { describe, expect, it } from 'vitest';
import { BLOB_PART_BYTES, chunkedBlobIO, packBlob, unpackBlob } from './blobCodec';

function memoryDocs() {
  const docs = new Map<string, Record<string, any>>();
  return {
    docs,
    io: chunkedBlobIO({
      write: async (id, fields) => { docs.set(id, fields); },
      read: async id => docs.get(id) ?? null,
      toBytes: b => b.slice(),
      fromBytes: v => v,
    }, () => 'uid1'),
  };
}

// Not compressible: random digits, so the gzip output stays large.
const noise = (chars: number) => Array.from({ length: chars }, () => Math.floor(Math.random() * 10)).join('');

describe('blobCodec', () => {
  it('compresses mesh-like text losslessly', async () => {
    const text = JSON.stringify({ positions: Array.from({ length: 30000 }, (_, i) => (i % 97) * 0.125) });
    const { enc, parts } = await packBlob(text);
    expect(enc).toBe('gzip');
    expect(parts[0].length).toBeLessThan(text.length / 5);
    expect(await unpackBlob(enc, parts)).toBe(text);
  });

  it('splits a value too big for one document across several and reads it back whole', async () => {
    const { docs, io } = memoryDocs();
    const text = noise(BLOB_PART_BYTES * 5);
    await io.upload('big', text);
    expect(docs.get('big')!.parts).toBeGreaterThan(1);
    for (const [, fields] of docs) {
      expect(fields.data.length).toBeLessThanOrEqual(BLOB_PART_BYTES);
      expect(fields.userId).toBe('uid1');
    }
    expect(await io.fetch('big')).toBe(text);
  });

  it('reads documents saved before compression', async () => {
    const { docs, io } = memoryDocs();
    docs.set('old', { userId: 'uid1', data: '{"positions":[1,2]}' });
    expect(await io.fetch('old')).toBe('{"positions":[1,2]}');
  });
});
