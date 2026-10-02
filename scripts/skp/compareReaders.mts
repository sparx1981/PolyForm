// Runs OpenSKP's own reader and the low-memory reader on the same .skp and checks they build the same GLB.
import { readFileSync } from 'node:fs';
import { buildInstancedScene, toInstancedGLB } from 'openskp';
import { readSkpToGlbLean } from '../../src/lib/skp/skpLeanReader';

export function splitGlb(glb: Uint8Array) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  const binLength = view.getUint32(20 + jsonLength, true);
  const bin = glb.subarray(28 + jsonLength, 28 + jsonLength + binLength);
  return { json, bin };
}

export function compareGlb(a: Uint8Array, b: Uint8Array): string[] {
  const problems: string[] = [];
  const A = splitGlb(a), B = splitGlb(b);
  delete A.json.asset.generator; delete B.json.asset.generator;
  for (const key of new Set([...Object.keys(A.json), ...Object.keys(B.json)])) {
    const x = JSON.stringify(A.json[key]), y = JSON.stringify(B.json[key]);
    if (x !== y) problems.push(`json.${key} differs (${x?.length} vs ${y?.length} chars)`);
  }
  if (A.bin.length !== B.bin.length) problems.push(`binary length ${A.bin.length} vs ${B.bin.length}`);
  else if (Buffer.compare(Buffer.from(A.bin), Buffer.from(B.bin)) !== 0) problems.push('binary content differs');
  return problems;
}

if (process.argv[1]?.endsWith('compareReaders.mts')) {
  const file = process.argv[2];
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  let t = Date.now();
  const lean = readSkpToGlbLean(ab, { respectEdgeVisibility: true });
  console.log('lean', lean.length, 'bytes', Date.now() - t, 'ms', 'rss', Math.round(process.memoryUsage().rss / 1e6), 'MB');
  if (process.argv[3] !== 'lean-only') {
    t = Date.now();
    const ref = toInstancedGLB(buildInstancedScene(ab, { respectEdgeVisibility: true }));
    console.log('openskp', ref.length, 'bytes', Date.now() - t, 'ms');
    const problems = compareGlb(ref, lean);
    console.log(problems.length ? problems.join('\n') : 'IDENTICAL (json + binary)');
  }
}
