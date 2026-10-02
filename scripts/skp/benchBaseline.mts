import { writeFileSync } from 'node:fs';
import { buildSkp, definition, gridGeometry, instance, translation, rec } from '../../src/lib/skp/testing/synthSkp';
import { buildInstancedScene, toInstancedGLB } from 'openskp';

const defs = Number(process.argv[2] ?? 2000), grid = Number(process.argv[3] ?? 4), inst = Number(process.argv[4] ?? 5000);
const model = [];
const defRecs = [];
for (let d = 1; d <= defs; d++) defRecs.push(definition(d, `Part ${d}`, gridGeometry(grid, grid)));
// F901 holds all definitions, as it appears to in real files
model.push(rec('F901', defRecs));
const roots = [];
for (let i = 0; i < inst; i++) roots.push(instance(1 + (i % defs), translation((i % 100) * 500, Math.floor(i / 100) * 500, 0)));
model.push(rec('F601', roots));
const skp = buildSkp({ model });
console.log('skp bytes', skp.length);
if (process.argv[5]) writeFileSync(process.argv[5], skp);
const ab = skp.buffer.slice(skp.byteOffset, skp.byteOffset + skp.byteLength);
const t = Date.now();
const scene = buildInstancedScene(ab, { respectEdgeVisibility: true });
const glb = toInstancedGLB(scene);
console.log('glb bytes', glb.length, 'nodes', scene.sceneHierarchy.children.length, 'ms', Date.now() - t, 'rss MB', Math.round(process.memoryUsage().rss / 1e6));
