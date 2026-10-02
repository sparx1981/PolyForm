// Builds a big synthetic model and reads it with the low-memory reader, reporting time and peak memory.
// usage: tsx benchLean.mts <definitions> <gridSize> <placements> [saveTo]
import { writeFileSync } from 'node:fs';
import { buildSkp, definition, gridGeometry, instance, rec, translation } from '../../src/lib/skp/testing/synthSkp';
import { readSkpToGlbLean } from '../../src/lib/skp/skpLeanReader';

const defs = Number(process.argv[2] ?? 2000), grid = Number(process.argv[3] ?? 4), inst = Number(process.argv[4] ?? 5000);
const defRecs: Buffer[] = [];
for (let d = 1; d <= defs; d++) defRecs.push(definition(d, `Part ${d}`, gridGeometry(grid, grid)));
const roots: Buffer[] = [];
for (let i = 0; i < inst; i++) roots.push(instance(1 + (i % defs), translation((i % 300) * 500, Math.floor(i / 300) * 500, 0)));
const modelBytes = defRecs.reduce((s, r) => s + r.length, 0) + roots.reduce((s, r) => s + r.length, 0);
let skp = buildSkp({ model: [rec('F901', defRecs), rec('F601', roots)] });
console.log('model.dat ~', Math.round(modelBytes / 1e6), 'MB uncompressed;', 'skp', Math.round(skp.length / 1e6), 'MB');
if (process.argv[5]) writeFileSync(process.argv[5], skp);
defRecs.length = 0; roots.length = 0;
const ab = skp.buffer.slice(skp.byteOffset, skp.byteOffset + skp.byteLength) as ArrayBuffer;
skp = Buffer.alloc(0);
global.gc?.();
const before = process.resourceUsage().maxRSS;
const t = Date.now();
let last = 0;
const glb = readSkpToGlbLean(ab, { respectEdgeVisibility: true, onProgress: (p) => { if (p.stage === 'tlv_walk' && p.current - last > 20e6) { last = p.current; } } });
console.log('glb', Math.round(glb.length / 1e6), 'MB in', ((Date.now() - t) / 1000).toFixed(1), 's; peak RSS', Math.round(process.resourceUsage().maxRSS / 1024), 'MB (before reading:', Math.round(before / 1024), 'MB)');
