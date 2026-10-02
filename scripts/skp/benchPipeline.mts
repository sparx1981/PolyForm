// The whole import as the app does it, on a big synthetic model: read, load, merge, store as JSON, rebuild, pick tree.
// usage: tsx benchPipeline.mts <file.skp>
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { SkpService, importedGroupToShapes } from '../../src/services/skpService';
import { customTriangleCount } from '../../src/lib/heavyMesh';
import { CENTER, MeshBVH } from 'three-mesh-bvh';

const buf = readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const time = async <T,>(label: string, f: () => T | Promise<T>): Promise<T> => { const t = Date.now(); const r = await f(); console.log(label.padEnd(34), String(Date.now() - t).padStart(7), 'ms   heap', Math.round(process.memoryUsage().heapUsed / 1e6), 'MB'); return r; };
const group: THREE.Group = await time('SkpService.importSKP (read + load)', () => SkpService.importSKP(new File([new Uint8Array(ab)], 'model.skp')));
const { shapes, triangles } = await time('split + merge + store per part', () => importedGroupToShapes(group));
console.log('  objects', shapes.length, 'triangles', Math.round(triangles), 'largest object triangles', Math.max(...shapes.map((x) => customTriangleCount(x.geometryData))));
const biggest = shapes.reduce((a, b) => (customTriangleCount(b.geometryData) > customTriangleCount(a.geometryData) ? b : a));
const rebuilt = await time('rebuild the largest object', () => new THREE.BufferGeometryLoader().parse(biggest.geometryData));
await time('its picking tree (BVH)', () => { rebuilt.boundsTree = new MeshBVH(rebuilt, { strategy: CENTER, indirect: true }); });
console.log('peak RSS', Math.round(process.resourceUsage().maxRSS / 1024), 'MB');
