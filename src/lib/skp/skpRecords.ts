/**
 * Reads the individual records inside a SketchUp (.skp) model.dat, following the same rules as OpenSKP
 * (an open-source reverse-engineered reader, MIT licence, https://github.com/iamahsanmehmood/openskp) so the
 * result is identical. The difference is memory: OpenSKP keeps a JavaScript object for every record of the
 * whole file, which costs roughly thirty times the size of the data. Here only one entity's records are ever
 * turned into objects at a time, and what the model needs is copied straight into compact typed arrays.
 */

/** A record's two tag bytes as one number: bytes F9 01 are 0xF901. */
export type Tag = number;

export const TAG = {
  FILE_WRAPPER: 0xf401,
  DEFINITION: 0x7c15,
  DEFINITION_GUID: 0x7d15,
  DEFINITION_NAME: 0x7e15,
  ROOT_GEOMETRY: 0xf601,
  LAYER_TABLE: 0x993a,
  LAYER: 0x8c3c,
  LAYER_NAME: 0x8d3c,
  LAYER_HIDDEN: 0x8e3c,
  MATERIAL_ENTRY: 0xc832,
  MATERIAL_NAME: 0xcc32,
  ENTITY_ID: 0xdc05,
  ENTITY_ID_INNER: 0xde05,
  VERTEX: 0xc409,
  VERTEX_POSITION: 0xc509,
  EDGE: 0xb80b,
  EDGE_START: 0xb90b,
  EDGE_END: 0xba0b,
  FACE: 0xac0d,
  FACE_NORMAL: 0xad0d,
  FACE_LOOPS: 0xae0d,
  FACE_BACK_MATERIAL: 0xaf0d,
  LOOP: 0x9411,
  CO_EDGE: 0xa00f,
  INSTANCE: 0x6419,
  INSTANCE_NAME: 0x6519,
  INSTANCE_MATRIX: 0x6619,
  INSTANCE_DEFINITION: 0x6719,
  INSTANCE_GUID: 0x6819,
  FLAGS_BLOCK: 0xd007,
  MATERIAL_REF: 0xd107,
  LAYER_REF: 0xd207,
  FLAGS: 0xd307,
} as const;

/** Records whose payload is itself a list of records. Same set as OpenSKP's reader. */
export const CONTAINER_TAGS: ReadonlySet<Tag> = new Set([
  0xf401, 0xf701, 0xd430, 0xd530, 0xc832, 0x7c15, 0x8813, 0x8913, 0x8a13, 0x8b13, 0x8c13, 0x8d13, 0x4c1d, 0x6419, 0xf901,
  0x7017, 0x7117, 0xd007, 0xc409, 0x9411, 0x9511, 0x0f01, 0x384a, 0xb80b, 0x9713, 0x2c4c, 0xac0d, 0xae0d, 0xf601, 0xf801,
  0x983a, 0x993a, 0x8c3c, 0x8d3c, 0x9013, 0x401f,
]);

/** The kinds of record that carry model geometry. */
export function isGeometryEntity(tag: Tag): boolean {
  return tag === TAG.VERTEX || tag === TAG.EDGE || tag === TAG.FACE || tag === TAG.INSTANCE;
}

export interface TlvNode {
  tag: Tag;
  children: TlvNode[];
  payload: Uint8Array;
}

const EMPTY = new Uint8Array(0);

export function readU32(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) throw new Error('Out of bounds readU32');
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

const f64Scratch = new Float64Array(1);
const f64Bytes = new Uint8Array(f64Scratch.buffer);
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const dataViewScratch = new DataView(new ArrayBuffer(8));
export function readF64(data: Uint8Array, offset: number): number {
  if (offset + 8 > data.length) throw new Error('Out of bounds readF64');
  if (HOST_IS_LITTLE_ENDIAN) {
    for (let i = 0; i < 8; i++) f64Bytes[i] = data[offset + i];
    return f64Scratch[0];
  }
  for (let i = 0; i < 8; i++) dataViewScratch.setUint8(i, data[offset + i]);
  return dataViewScratch.getFloat64(0, true);
}

/** A little-endian whole number of `length` bytes (not a LEB128 varint, despite the name OpenSKP gives it). */
export function parseVarInt(data: Uint8Array, offset: number, length: number): number {
  let val = 0;
  let scale = 1;
  for (let i = 0; i < length; i++) {
    val += data[offset + i] * scale;
    scale *= 256;
  }
  return val;
}

/** Splits `data[start, end)` into records, nesting the ones whose tag is a container. */
export function parseTlvRecursive(data: Uint8Array, start: number, end: number, containers: ReadonlySet<Tag> = CONTAINER_TAGS): TlvNode[] {
  let pos = start;
  const elements: TlvNode[] = [];
  while (pos <= end - 6) {
    const tag = (data[pos] << 8) | data[pos + 1];
    const size = readU32(data, pos + 2);
    if (pos + 6 + size > end) break;
    let children: TlvNode[] = [];
    if (size > 0 && containers.has(tag)) children = parseTlvRecursive(data, pos + 6, pos + 6 + size, containers);
    elements.push({ tag, children, payload: children.length > 0 ? EMPTY : data.subarray(pos + 6, pos + 6 + size) });
    pos += 6 + size;
  }
  return elements;
}

export function findChildTag(nodes: TlvNode[], target: Tag): TlvNode | null {
  for (const n of nodes) {
    if (n.tag === target) return n;
    const found = findChildTag(n.children, target);
    if (found) return found;
  }
  return null;
}

function findAllNodes(nodes: TlvNode[], target: Tag, results: TlvNode[]): void {
  for (const n of nodes) {
    if (n.tag === target) results.push(n);
    findAllNodes(n.children, target, results);
  }
}

/** The id stored in a DC05 payload: either a bare number or a DE05 record holding it. */
export function entityIdFromPayload(payload: Uint8Array): number {
  if (payload.length >= 6 && payload[0] === 0xde && payload[1] === 0x05) return parseVarInt(payload, 6, readU32(payload, 2));
  return parseVarInt(payload, 0, payload.length);
}

export function extractEntityId(node: TlvNode): number | null {
  for (const child of node.children) {
    if (child.tag === TAG.ENTITY_ID_INNER) return parseVarInt(child.payload, 0, child.payload.length);
    if (child.tag === TAG.ENTITY_ID) return entityIdFromPayload(child.payload);
  }
  for (const child of node.children) {
    const res = extractEntityId(child);
    if (res !== null) return res;
  }
  return null;
}

type TlvFlat = Array<[number, Uint8Array]>;

function tlvFlat(payload: Uint8Array): TlvFlat {
  let pos = 0;
  const out: TlvFlat = [];
  while (pos <= payload.length - 6) {
    const tag = (payload[pos] << 8) | payload[pos + 1];
    const size = readU32(payload, pos + 2);
    if (pos + 6 + size > payload.length) break;
    out.push([tag, payload.subarray(pos + 6, pos + 6 + size)]);
    pos += 6 + size;
  }
  return out;
}

function findFlat(seq: TlvFlat, tag: Tag): Uint8Array | null {
  for (const [t, body] of seq) if (t === tag) return body;
  return null;
}

/** The front and back texture placement matrices of a face, when it has them. */
function extractUvTransforms(dc05Payload: Uint8Array): [number[] | null, number[] | null] {
  const dd05 = findFlat(tlvFlat(dc05Payload), 0xdd05);
  if (dd05 === null) return [null, null];
  const b136 = findFlat(tlvFlat(dd05), 0xb136);
  if (b136 === null) return [null, null];
  const b236 = findFlat(tlvFlat(b136), 0xb236);
  if (b236 === null) return [null, null];
  const t1027 = findFlat(tlvFlat(b236), 0x1027);
  if (t1027 === null) return [null, null];
  const sides = tlvFlat(t1027);
  const result: Array<number[] | null> = [];
  for (const sideTag of [0x1127, 0x1227]) {
    const side = findFlat(sides, sideTag);
    let mat: number[] | null = null;
    if (side !== null) {
      const t1327 = findFlat(tlvFlat(side), 0x1327);
      if (t1327 !== null) {
        const t1527 = findFlat(tlvFlat(t1327), 0x1527);
        if (t1527 !== null && t1527.length === 72) {
          mat = [];
          for (let i = 0; i < 9; i++) mat.push(readF64(t1527, i * 8));
        }
      }
    }
    result.push(mat);
  }
  return [result[0], result[1]];
}

export interface FaceRecord {
  id: number;
  normal: [number, number, number];
  /** Each loop is its co-edges as flat (edgeId, orientation) pairs; orientation is 1 or -1. */
  loops: number[][];
  materialId: number;
  backMaterialId: number;
  hidden: boolean;
  uvFront: number[] | null;
  uvBack: number[] | null;
}

export interface InstanceRecord {
  /** Index of the definition it places, or -1. */
  refIdx: number;
  name: string;
  /** Thirteen numbers (3x3 rotation, translation, scale), or empty when the record had no matrix. */
  matrix: number[];
  materialId: number;
  layerId: number;
  hidden: boolean;
  /** The instance's own display name from its attribute dictionaries, when it has one. */
  nameOverride: string | null;
}

/** Where extracted geometry goes. Ids and references use -1 for "none". */
export interface EntitySink {
  vertex(id: number, x: number, y: number, z: number): void;
  edge(id: number, v1: number, v2: number, flags: number): void;
  face(face: FaceRecord): void;
  instance(instance: InstanceRecord): void;
}

const utf8 = new TextDecoder('utf-8');
const cleanText = (bytes: Uint8Array): string => utf8.decode(bytes).replace(/\0/g, '').trim();

function readFace(el: TlvNode): FaceRecord | null {
  const id = extractEntityId(el);
  if (id === null) return null;
  let normal: [number, number, number] = [0, 0, 1];
  const ad0d = findChildTag(el.children, TAG.FACE_NORMAL);
  if (ad0d && ad0d.payload.length >= 24) normal = [readF64(ad0d.payload, 0), readF64(ad0d.payload, 8), readF64(ad0d.payload, 16)];
  const loops: number[][] = [];
  const ae0d = findChildTag(el.children, TAG.FACE_LOOPS);
  if (ae0d) {
    const loopNodes: TlvNode[] = [];
    findAllNodes(ae0d.children, TAG.LOOP, loopNodes);
    for (const loopNode of loopNodes) {
      const coEdges: number[] = [];
      const coNodes: TlvNode[] = [];
      findAllNodes(loopNode.children, TAG.CO_EDGE, coNodes);
      for (const coNode of coNodes) {
        const payload = coNode.payload;
        let edgeId: number | null = null;
        let orient: number | null = null;
        let subPos = 0;
        while (subPos < payload.length - 6) {
          const subSize = readU32(payload, subPos + 2);
          if (subPos + 6 + subSize <= payload.length) {
            const val = parseVarInt(payload, subPos + 6, subSize);
            if (payload[subPos] === 0xa1 && payload[subPos + 1] === 0x0f) edgeId = val;
            else if (payload[subPos] === 0xa2 && payload[subPos + 1] === 0x0f) orient = val;
          }
          subPos += 6 + subSize;
        }
        if (edgeId !== null && orient !== null) coEdges.push(edgeId, orient === 0 ? 1 : -1);
      }
      if (coEdges.length > 0) loops.push(coEdges);
    }
  }
  let materialId = -1;
  let uvFront: number[] | null = null;
  let uvBack: number[] | null = null;
  let hidden = false;
  const d007 = el.children.find((c) => c.tag === TAG.FLAGS_BLOCK);
  if (d007) {
    const d107 = d007.children.find((c) => c.tag === TAG.MATERIAL_REF);
    if (d107) materialId = parseVarInt(d107.payload, 0, d107.payload.length);
    const dc05 = d007.children.find((c) => c.tag === TAG.ENTITY_ID);
    if (dc05) [uvFront, uvBack] = extractUvTransforms(dc05.payload);
    const d307 = d007.children.find((c) => c.tag === TAG.FLAGS);
    if (d307 && d307.payload.length > 0) hidden = (d307.payload[0] & 1) !== 0;
  }
  let backMaterialId = -1;
  const af0d = el.children.find((c) => c.tag === TAG.FACE_BACK_MATERIAL);
  if (af0d && af0d.payload.length > 0) backMaterialId = parseVarInt(af0d.payload, 0, af0d.payload.length);
  return { id, normal, loops, materialId, backMaterialId, hidden, uvFront, uvBack };
}

function readInstance(el: TlvNode): InstanceRecord {
  const nodes = el.children.length > 0 ? el.children : [el];
  let defIdx = -1;
  let name = '';
  const matrix: number[] = [];
  const defIdxNode = findChildTag(nodes, TAG.INSTANCE_DEFINITION);
  if (defIdxNode) defIdx = parseVarInt(defIdxNode.payload, 0, defIdxNode.payload.length);
  const nameNode = findChildTag(nodes, TAG.INSTANCE_NAME);
  if (nameNode) name = cleanText(nameNode.payload);
  const matNode = findChildTag(nodes, TAG.INSTANCE_MATRIX);
  if (matNode && matNode.payload.length >= 104) for (let idx = 0; idx < 13; idx++) matrix.push(readF64(matNode.payload, idx * 8));
  let materialId = -1;
  let layerId = -1;
  let hidden = false;
  let nameOverride: string | null = null;
  const d007 = el.children.find((c) => c.tag === TAG.FLAGS_BLOCK);
  if (d007) {
    const d107 = d007.children.find((c) => c.tag === TAG.MATERIAL_REF);
    if (d107) materialId = parseVarInt(d107.payload, 0, d107.payload.length);
    const d207 = d007.children.find((c) => c.tag === TAG.LAYER_REF);
    if (d207 && d207.payload.length > 0) {
      const p = d207.payload;
      layerId = p.length === 1 ? p[0] : parseVarInt(p, 0, p.length);
    }
    const d307 = d007.children.find((c) => c.tag === TAG.FLAGS);
    if (d307 && d307.payload.length > 0) hidden = (d307.payload[0] & 1) !== 0;
    try {
      nameOverride = findNameOverride(extractAttributeDictionaries(d007));
    } catch {
      nameOverride = null;
    }
  }
  return { refIdx: defIdx, name, matrix, materialId, layerId, hidden, nameOverride };
}

/**
 * Reads a vertex record straight from its bytes, without building a tree of objects for it. Vertices are by far the
 * most numerous records. Returns false (having done nothing) when the record is not in the usual plain shape, in which
 * case {@link extractEntity} must be used.
 */
export function extractVertexFast(body: Uint8Array, sink: EntitySink): boolean {
  const n = body.length;
  let pos = 0;
  let id = -1;
  let haveId = false;
  let positionAt = -2;
  while (pos <= n - 6) {
    const tag = (body[pos] << 8) | body[pos + 1];
    const size = (body[pos + 2] | (body[pos + 3] << 8) | (body[pos + 4] << 16) | (body[pos + 5] << 24)) >>> 0;
    if (pos + 6 + size > n) break;
    if (size > 0 && CONTAINER_TAGS.has(tag)) return false;
    if (!haveId && (tag === TAG.ENTITY_ID || tag === TAG.ENTITY_ID_INNER)) {
      const payload = body.subarray(pos + 6, pos + 6 + size);
      id = tag === TAG.ENTITY_ID ? entityIdFromPayload(payload) : parseVarInt(payload, 0, payload.length);
      haveId = true;
    } else if (tag === TAG.VERTEX_POSITION && positionAt === -2) {
      positionAt = size >= 24 ? pos + 6 : -1;
    }
    pos += 6 + size;
  }
  if (!haveId) return false;
  if (positionAt >= 0) sink.vertex(id, readF64(body, positionAt), readF64(body, positionAt + 8), readF64(body, positionAt + 16));
  return true;
}

/** The same shortcut for an edge record. The edge's display flags are not needed, so its flags block is stepped over. */
export function extractEdgeFast(body: Uint8Array, sink: EntitySink): boolean {
  const n = body.length;
  let pos = 0;
  let id = -1;
  let haveId = false;
  let v1 = -1;
  let v2 = -1;
  let haveV1 = false;
  let haveV2 = false;
  while (pos <= n - 6) {
    const tag = (body[pos] << 8) | body[pos + 1];
    const size = (body[pos + 2] | (body[pos + 3] << 8) | (body[pos + 4] << 16) | (body[pos + 5] << 24)) >>> 0;
    if (pos + 6 + size > n) break;
    if (size > 0 && tag !== TAG.FLAGS_BLOCK && CONTAINER_TAGS.has(tag)) return false;
    if (!haveId && (tag === TAG.ENTITY_ID || tag === TAG.ENTITY_ID_INNER)) {
      const payload = body.subarray(pos + 6, pos + 6 + size);
      id = tag === TAG.ENTITY_ID ? entityIdFromPayload(payload) : parseVarInt(payload, 0, payload.length);
      haveId = true;
    } else if (tag === TAG.EDGE_START && !haveV1) {
      v1 = parseVarInt(body, pos + 6, size);
      haveV1 = true;
    } else if (tag === TAG.EDGE_END && !haveV2) {
      v2 = parseVarInt(body, pos + 6, size);
      haveV2 = true;
    }
    pos += 6 + size;
  }
  if (!haveId) return false;
  sink.edge(id, v1, v2, -1);
  return true;
}

/** Hands one record (and everything inside it) to the sink if it is a vertex, edge, face or instance. */
export function extractEntity(el: TlvNode, sink: EntitySink): void {
  switch (el.tag) {
    case TAG.VERTEX: {
      const id = extractEntityId(el);
      const pos = findChildTag(el.children, TAG.VERTEX_POSITION);
      if (id !== null && pos && pos.payload.length >= 24) sink.vertex(id, readF64(pos.payload, 0), readF64(pos.payload, 8), readF64(pos.payload, 16));
      return;
    }
    case TAG.EDGE: {
      const id = extractEntityId(el);
      if (id === null) return;
      const v1Node = findChildTag(el.children, TAG.EDGE_START);
      const v2Node = findChildTag(el.children, TAG.EDGE_END);
      const v1 = v1Node ? parseVarInt(v1Node.payload, 0, v1Node.payload.length) : -1;
      const v2 = v2Node ? parseVarInt(v2Node.payload, 0, v2Node.payload.length) : -1;
      let flags = -1;
      const d007 = el.children.find((c) => c.tag === TAG.FLAGS_BLOCK);
      if (d007) {
        const d307 = d007.children.find((c) => c.tag === TAG.FLAGS);
        if (d307 && d307.payload.length > 0) flags = d307.payload[0];
      }
      sink.edge(id, v1, v2, flags);
      return;
    }
    case TAG.FACE: {
      const face = readFace(el);
      if (face) sink.face(face);
      return;
    }
    case TAG.INSTANCE:
      sink.instance(readInstance(el));
      return;
  }
}

// --- Attribute dictionaries (only used to find an instance's display name) ---

type AttrValue = string | number | number[] | AttrValue[] | null;

const ATTR_DOUBLE_TAGS = new Set([0xaf38, 0xa938]);

function decodeAttrValue(a438: TlvNode): AttrValue {
  if (!a438.children || a438.children.length === 0) return null;
  const child = a438.children[0];
  const tag = child.tag;
  const payload = child.payload;
  if (tag === 0xad38) {
    try {
      return cleanText(payload);
    } catch {
      return null;
    }
  }
  if (ATTR_DOUBLE_TAGS.has(tag) && payload.length === 8) return readF64(payload, 0);
  if (tag === 0xa738 && payload.length === 4) return (payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24)) | 0;
  if ((tag === 0xb438 || tag === 0xb538) && payload.length === 24) return [readF64(payload, 0), readF64(payload, 8), readF64(payload, 16)];
  if (tag === 0xae38) return (child.children ?? []).map(decodeAttrValue);
  return null;
}

function stringifyAttrValue(value: AttrValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return (value as AttrValue[]).map((v) => stringifyAttrValue(v)).join(',');
  return String(value);
}

const ATTR_CONTAINER_TAGS: ReadonlySet<Tag> = new Set([0xdd05, 0xb536, 0xb136, 0xb236, 0xb336, 0xb036, 0xa438, 0xae38]);

function extractAttributeDictionaries(d007: TlvNode): Record<string, Record<string, AttrValue>> {
  const dictionaries: Record<string, Record<string, AttrValue>> = {};
  const dc05 = d007.children.find((c) => c.tag === TAG.ENTITY_ID);
  if (!dc05) return dictionaries;
  const propElements = parseTlvRecursive(dc05.payload, 0, dc05.payload.length, ATTR_CONTAINER_TAGS);
  let currentKey: string | null = null;
  const extractEntries = (nodes: TlvNode[], entries: Record<string, AttrValue>) => {
    for (const n of nodes) {
      if (n.tag === 0xb636) {
        try {
          currentKey = cleanText(n.payload);
        } catch {
          currentKey = null;
        }
      } else if (n.tag === 0xa438 && currentKey) {
        entries[currentKey] = decodeAttrValue(n);
        currentKey = null;
      } else if (n.children && n.children.length > 0) {
        extractEntries(n.children, entries);
      }
    }
  };
  const walk = (nodes: TlvNode[]) => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].tag === 0xb436) {
        let name = '';
        try {
          name = cleanText(nodes[i].payload);
        } catch {
          // keep the empty name
        }
        const entries: Record<string, AttrValue> = {};
        currentKey = null;
        if (i + 1 < nodes.length && nodes[i + 1].children) extractEntries(nodes[i + 1].children, entries);
        dictionaries[name] = entries;
      } else if (nodes[i].children && nodes[i].children.length > 0) {
        walk(nodes[i].children);
      }
    }
  };
  walk(propElements);
  return dictionaries;
}

const NAME_OVERRIDE_KEYS = ['name', 'label', 'code'];

function findNameOverride(dicts: Record<string, Record<string, AttrValue>>): string | null {
  for (const dictName of Object.keys(dicts)) {
    if (dictName === 'dynamic_attributes' || dictName === 'SU_InstanceSet') continue;
    const entries = dicts[dictName];
    for (const key of NAME_OVERRIDE_KEYS) {
      if (!(key in entries)) continue;
      const val = stringifyAttrValue(entries[key]);
      if (val) return val;
    }
  }
  return null;
}

const GENERIC_DEFINITION_NAME = /^(?:Group|Component)\d*#\d+$/;
export const isGenericDefinitionName = (name: string): boolean => GENERIC_DEFINITION_NAME.test(name);
