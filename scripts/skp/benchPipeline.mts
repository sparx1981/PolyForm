// The whole import as the app does it, on a big synthetic model: read, load, merge, store as JSON, rebuild, pick tree.
// usage: tsx benchPipeline.mts <file.skp>
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
// @ts-ignore
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { readSkpToGlbLean } from '../../src/lib/skp/skpLeanReader';
import { mergeImportedGroup } from '../../src/services/skpService';
import { customTriangleCount } from '../../src/lib/heavyMesh';
import { CENTER, MeshBVH } from 'three-mesh-bvh';

const buf = readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const time = async <T,>(label: string, f: () => T | Promise<T>): Promise<T> => { const t = Date.now(); const r = await f(); console.log(label.padEnd(34), String(Date.now() - t).padStart(7), 'ms   heap', Math.round(process.memoryUsage().heapUsed / 1e6), 'MB'); return r; };
const glb = await time('read .skp -> GLB (worker work)', () => readSkpToGlbLean(ab, { respectEdgeVisibility: true, appearance: 'polyform' }));
console.log('  GLB', Math.round(glb.length / 1e6), 'MB');
const arr = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
const group: THREE.Group = await time('GLTFLoader.parse', () => new Promise((res, rej) => new GLTFLoader().parse(arr, '', (g: any) => res(g.scene), rej)));
const merged = await time('mergeImportedGroup', () => mergeImportedGroup(group));
console.log('  vertices', merged.attributes.position.count, 'triangles', merged.index!.count / 3);
const json = await time('geometry.toJSON()', () => merged.toJSON());
console.log('  customTriangleCount', customTriangleCount(json));
const rebuilt = await time('BufferGeometryLoader.parse', () => new THREE.BufferGeometryLoader().parse(json));
await time('picking tree (BVH)', () => { rebuilt.boundsTree = new MeshBVH(rebuilt, { strategy: CENTER, indirect: true }); });
const ray = new THREE.Raycaster(new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, -1, 0));
const mesh = new THREE.Mesh(rebuilt, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
mesh.raycast = (THREE.Mesh.prototype.raycast as any);
await time('100 pick rays (with tree)', () => { for (let i = 0; i < 100; i++) { ray.ray.origin.set(i * 30, 500, i * 20); (rebuilt.boundsTree as any).raycastFirst(ray.ray, THREE.DoubleSide); } });
console.log('peak RSS', Math.round(process.resourceUsage().maxRSS / 1024), 'MB');
