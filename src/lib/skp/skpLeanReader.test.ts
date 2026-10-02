import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
// @ts-ignore three ships this loader without types
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { buildInstancedScene, toInstancedGLB } from 'openskp';
import { LeanSkpUnsupported, readSkpToGlbLean } from './skpLeanReader';
import { GeometryAccumulator } from './leanGeometry';
import { IdMap } from './idMap';
import type { FaceOptions } from './testing/synthSkp';
import { buildSkp, definition, edge, face, gridGeometry, instance, layer, materialEntry, materialXml, rec, translation, vertex, IDENTITY } from './testing/synthSkp';

/** Splits a GLB into its JSON and binary parts. */
function splitGlb(glb: Uint8Array) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  if (glb.byteLength <= 20 + jsonLength) return { json, bin: new Uint8Array(0) };
  const binLength = view.getUint32(20 + jsonLength, true);
  return { json, bin: glb.subarray(28 + jsonLength, 28 + jsonLength + binLength) };
}

const toArrayBuffer = (buf: Buffer): ArrayBuffer => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

/** The low-memory reader must build exactly what OpenSKP builds. */
function expectSameAsOpenSkp(skp: Buffer) {
  const ab = toArrayBuffer(skp);
  const reference = toInstancedGLB(buildInstancedScene(ab.slice(0), { respectEdgeVisibility: true }));
  const lean = readSkpToGlbLean(ab.slice(0), { respectEdgeVisibility: true });
  const a = splitGlb(reference);
  const b = splitGlb(lean);
  delete a.json.asset.generator;
  delete b.json.asset.generator;
  expect(b.json).toEqual(a.json);
  expect(Buffer.compare(Buffer.from(b.bin), Buffer.from(a.bin))).toBe(0);
  return b;
}

/** A polygon (with optional holes) as vertex, edge and face records. Ids come from `ids`. */
function polygon(ids: { v: number; e: number; f: number }, outer: number[][], holes: number[][][] = [], opts: FaceOptions = {}) {
  const records: Buffer[] = [];
  const loops: Array<Array<[number, number]>> = [];
  for (const points of [outer, ...holes]) {
    const vertexIds = points.map((p) => {
      records.push(vertex(ids.v, p[0], p[1], p[2] ?? 0));
      return ids.v++;
    });
    const coEdges: Array<[number, number]> = [];
    for (let i = 0; i < vertexIds.length; i++) {
      records.push(edge(ids.e, vertexIds[i], vertexIds[(i + 1) % vertexIds.length]));
      coEdges.push([ids.e++, 0]);
    }
    loops.push(coEdges);
  }
  records.push(face(ids.f++, 0, 0, 1, loops, opts));
  return records;
}

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(40, 3)]);

function richModel(wrapF401: boolean) {
  const ids = { v: 1, e: 1, f: 1 };
  const chair = definition(1, 'Chair', [...gridGeometry(2, 2, 10, 1), ...polygon({ v: 100, e: 100, f: 100 }, [[0, 0, 5], [4, 0, 5], [4, 4, 5], [0, 4, 5]], [], { material: 2, backMaterial: 1 })]);
  const lShape = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
  const hole = [[2, 2], [8, 2], [8, 8], [2, 8]];
  const group = definition(2, 'Group#1', [
    ...polygon(ids, lShape, [hole], { material: 3 }),
    ...polygon({ v: 500, e: 500, f: 500 }, [[0, 0, 40], [5, 0, 40], [5, 5, 40], [0, 5, 40]], [], { hidden: true }),
    instance(1, translation(50, 0, 0), { name: 'Seat' }),
  ]);
  const table = definition(3, 'Table', [
    instance(2, translation(0, 20, 0), { layer: 1 }),
    instance(1, [0, 1, 0, -1, 0, 0, 0, 0, 1, 10, 10, 10, 1], { attributes: ['Info', 'name', 'Kitchen chair'] }),
    ...polygon({ v: 900, e: 900, f: 900 }, [[0, 0], [100, 0], [100, 60], [0, 60]], [], { uvFront: [1, 0, 0, 0, 1, 0, 0, 0, 1] }),
  ]);
  const model = [
    materialEntry(1, 'Red'),
    materialEntry(2, 'Blue'),
    materialEntry(3, 'Glass'),
    materialEntry(4, 'Tiles'),
    layer(1, 'Roof'),
    rec('F901', [chair, group, table]),
    rec('F601', [
      instance(3, translation(0, 0, 0)),
      instance(3, translation(300, 0, 0), { material: 3 }),
      instance(1, translation(0, 200, 0), { name: 'Lone chair', material: 4 }),
      instance(99, translation(5, 5, 5)),
      ...polygon({ v: 2000, e: 2000, f: 2000 }, [[-50, -50], [400, -50], [400, 300], [-50, 300]], [], { material: 4 }),
    ]),
  ];
  const files = {
    'Materials/Red/material.xml': materialXml('Red', 200, 20, 20),
    'Materials/Blue/material.xml': materialXml('Blue', 20, 20, 200),
    'Materials/Glass/material.xml': materialXml('Glass', 150, 200, 220, 'useTrans="1" trans="0.6"'),
    'Materials/Tiles/material.xml': Buffer.from('<material name="Tiles" colorRed="90" colorGreen="90" colorBlue="90"><texture textureFilename="tiles.png" xScale="24" yScale="24"/></material>'),
    'Materials/Tiles/tiles.png': png,
    'Materials/Layer_Roof/material.xml': materialXml('Layer_Roof', 10, 160, 40),
  };
  return buildSkp({ model, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Uint8Array(v as Buffer)])), wrapF401 });
}

describe('readSkpToGlbLean', () => {
  it('builds exactly what OpenSKP builds for a model with materials, layers, textures, holes and nested components', () => {
    const { json } = expectSameAsOpenSkp(richModel(true));
    expect(json.meshes.length).toBeGreaterThan(3);
    expect(json.materials.some((m: { alphaMode?: string }) => m.alphaMode === 'BLEND')).toBe(true);
    expect(json.materials.some((m: { alphaMode?: string }) => m.alphaMode === 'MASK')).toBe(true);
  });

  it('reads the same model when its records are not wrapped in a single top-level record', () => {
    expectSameAsOpenSkp(richModel(false));
  });

  it('names a placed component after its own attribute when it has one', () => {
    const { json } = expectSameAsOpenSkp(richModel(true));
    expect(json.nodes.some((n: { name?: string }) => n.name === 'Kitchen chair')).toBe(true);
    expect(json.nodes.some((n: { name?: string }) => n.name === 'Lone chair')).toBe(true);
  });

  it('keeps going through a definition placed inside itself like OpenSKP: by refusing the file', () => {
    const model = [rec('F901', [definition(1, 'Loop', [instance(1, IDENTITY)])]), rec('F601', [instance(1, IDENTITY)])];
    const skp = buildSkp({ model });
    expect(() => toInstancedGLB(buildInstancedScene(toArrayBuffer(skp), {}))).toThrow(/Recursive/);
    expect(() => readSkpToGlbLean(toArrayBuffer(skp), {})).toThrow(/Recursive/);
  });

  it('reports progress while it reads', () => {
    const skp = buildSkp({ model: [rec('F901', [definition(1, 'Slab', gridGeometry(3, 3))]), rec('F601', [instance(1, IDENTITY)])] });
    const stages = new Set<string>();
    readSkpToGlbLean(toArrayBuffer(skp), { onProgress: (p) => stages.add(p.stage) });
    expect(stages.has('tlv_walk')).toBe(true);
  });

  it('declines files in the pre-2021 format and files that are not SketchUp files, so another reader can try', () => {
    expect(() => readSkpToGlbLean(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow(LeanSkpUnsupported);
    const legacy = Buffer.concat([Buffer.from([0xff, 0xfe, 0xff, 0x0e]), Buffer.from('xxxxxxxx CVersionMap xxxxxxxx')]);
    expect(() => readSkpToGlbLean(toArrayBuffer(legacy))).toThrow(LeanSkpUnsupported);
  });

  it('can skip components nothing places and still build the same model', () => {
    const skp = richModel(true);
    const { json } = expectSameAsOpenSkp(skp);
    const ab = toArrayBuffer(skp);
    const trimmed = splitGlb(readSkpToGlbLean(ab.slice(0), { respectEdgeVisibility: true, onlyUsedDefinitions: true }));
    delete trimmed.json.asset.generator;
    const full = splitGlb(readSkpToGlbLean(ab.slice(0), { respectEdgeVisibility: true }));
    delete full.json.asset.generator;
    expect(trimmed.json).toEqual(full.json);
    expect(Buffer.compare(Buffer.from(trimmed.bin), Buffer.from(full.bin))).toBe(0);
    expect(json.nodes.length).toBeGreaterThan(5);
  });

  it('leaves out the geometry of unplaced components when asked to', () => {
    const model = [
      rec('F901', [definition(1, 'Used', gridGeometry(2, 2)), definition(2, 'Spare', gridGeometry(6, 6)), definition(3, 'Nested', gridGeometry(3, 3))]),
      rec('F601', [instance(1, IDENTITY), instance(3, translation(100, 0, 0))]),
    ];
    const skp = buildSkp({ model });
    const ab = toArrayBuffer(skp);
    const everything = splitGlb(readSkpToGlbLean(ab.slice(0), {}));
    const trimmed = splitGlb(readSkpToGlbLean(ab.slice(0), { onlyUsedDefinitions: true }));
    expect(trimmed.json).toEqual(everything.json);
  });

  it('tries again with unplaced components left out when the first attempt runs out of memory, and builds the same model', () => {
    const skp = richModel(true);
    const ab = toArrayBuffer(skp);
    let failed = false;
    const stages: string[] = [];
    const retried = splitGlb(
      readSkpToGlbLean(ab.slice(0), {
        respectEdgeVisibility: true,
        onProgress: (p) => {
          stages.push(p.stage);
          if (p.stage === 'tlv_walk' && !failed) {
            failed = true;
            throw new RangeError('Array buffer allocation failed');
          }
        },
      }),
    );
    expect(stages).toContain('retry_used_only');
    const plain = splitGlb(readSkpToGlbLean(ab.slice(0), { respectEdgeVisibility: true }));
    delete retried.json.asset.generator;
    delete plain.json.asset.generator;
    expect(retried.json).toEqual(plain.json);
  });

  it('does not retry for a failure that is not about memory', () => {
    const skp = buildSkp({ model: [rec('F901', []), rec('F601', [])] });
    expect(() =>
      readSkpToGlbLean(toArrayBuffer(skp), {
        onProgress: () => {
          throw new Error('boom');
        },
      }),
    ).toThrow('boom');
  });

  it('writes a valid, empty scene for a model that has no geometry at all', () => {
    const skp = buildSkp({ model: [rec('F901', []), rec('F601', [])] });
    const { json, bin } = splitGlb(readSkpToGlbLean(toArrayBuffer(skp)));
    expect(json.nodes).toHaveLength(1);
    expect(json.buffers).toBeUndefined();
    expect(bin.length).toBe(0);
  });

  it('produces a GLB that three.js loads, with every placed mesh drawn', async () => {
    const skp = richModel(true);
    const glb = readSkpToGlbLean(toArrayBuffer(skp), { respectEdgeVisibility: true });
    const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    const scene: THREE.Group = await new Promise((resolve, reject) => new GLTFLoader().parse(ab, '', (g: { scene: THREE.Group }) => resolve(g.scene), reject));
    let meshes = 0;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    // three.js makes one object per primitive (one per paint) of each placed mesh.
    const { json } = splitGlb(glb);
    const expected = json.nodes.reduce((sum: number, n: { mesh?: number }) => sum + (n.mesh === undefined ? 0 : json.meshes[n.mesh].primitives.length), 0);
    expect(meshes).toBe(expected);
    expect(new THREE.Box3().setFromObject(scene).isEmpty()).toBe(false);
  });
});

describe('IdMap', () => {
  it('stores, replaces, grows and clears', () => {
    const map = new IdMap();
    for (let i = 0; i < 1000; i++) expect(map.set(i * 7 + 3, i)).toBe(-1);
    for (let i = 0; i < 1000; i++) expect(map.get(i * 7 + 3)).toBe(i);
    expect(map.get(4)).toBe(-1);
    expect(map.set(3, 42)).toBe(0);
    expect(map.get(3)).toBe(42);
    expect(map.set(2 ** 40 + 5, 9)).toBe(-1);
    expect(map.get(2 ** 40 + 5)).toBe(9);
    map.clear();
    expect(map.get(3)).toBe(-1);
    expect(map.size).toBe(0);
  });
});

describe('GeometryAccumulator', () => {
  it('can be reused for the next definition without leaking the last one', () => {
    const acc = new GeometryAccumulator();
    acc.vertex(1, 0, 0, 0);
    acc.vertex(2, 1, 0, 0);
    acc.vertex(3, 0, 1, 0);
    acc.edge(1, 1, 2, -1);
    acc.edge(2, 2, 3, -1);
    acc.edge(3, 3, 1, -1);
    acc.face({ id: 1, normal: [0, 0, 1], loops: [[1, 1, 2, 1, 3, 1]], materialId: -1, backMaterialId: -1, hidden: false, uvFront: null, uvBack: null });
    const first = acc.finalize('A');
    expect(first.faceCount).toBe(1);
    expect(first.tris.length).toBe(3);
    acc.reset();
    const second = acc.finalize('B');
    expect(second.faceCount).toBe(0);
    expect(second.coords.length).toBe(0);
    expect(first.tris.length).toBe(3);
  });
});
