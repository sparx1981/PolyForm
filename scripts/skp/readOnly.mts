import { readFileSync } from 'node:fs';
import { readSkpToGlbLean } from '../../src/lib/skp/skpLeanReader';
const buf = readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const t = Date.now();
const glb = readSkpToGlbLean(ab, { respectEdgeVisibility: true });
console.log('glb', Math.round(glb.length / 1e6), 'MB in', ((Date.now() - t) / 1000).toFixed(1), 's; peak RSS', Math.round(process.resourceUsage().maxRSS / 1024), 'MB');
