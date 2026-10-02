import { sniffImageMime } from 'openskp';
import { isOutOfMemoryError } from './outOfMemory';
import { GeometryAccumulator } from './leanGeometry';
import type { DefTemplate } from './leanGeometry';
import { SkpArchiveStream } from './skpArchive';
import { NodeStore, packPrimitive, writeInstancedGlb } from './skpGlb';
import type { GlbMaterial, MeshResource } from './skpGlb';
import { buildFaceGroups } from './skpMesh';
import type { FinishedGroup, MeshContext, RgbColor } from './skpMesh';
import { buildMaterialTables } from './skpMaterials';
import type { SkpMaterial } from './skpMaterials';
import {
  CONTAINER_TAGS,
  TAG,
  entityIdFromPayload,
  extractEdgeFast,
  extractEntityId,
  extractEntity,
  extractVertexFast,
  findChildTag,
  isGenericDefinitionName,
  isGeometryEntity,
  parseTlvRecursive,
  parseVarInt,
} from './skpRecords';
import type { EntitySink, FaceRecord, InstanceRecord, TlvNode } from './skpRecords';

/** The file is not one this reader handles (for example the pre-2021 format); the caller should use another reader. */
export class LeanSkpUnsupported extends Error {}

/** The file was read without trouble but nothing in it could be drawn: its layout is probably not one this reader knows. */
export class LeanSkpEmpty extends Error {}

export interface LeanSkpOptions {
  /** Leave out faces SketchUp itself hides. */
  respectEdgeVisibility?: boolean;
  /**
   * Read only the components that end up placed in the model, skipping unused ones. Costs a quick extra pass over the
   * file. Used automatically as a second attempt when the browser runs out of memory; set it to force that behaviour.
   */
  onlyUsedDefinitions?: boolean;
  /** Return a scene with nothing in it instead of throwing {@link LeanSkpEmpty}. */
  allowEmptyScene?: boolean;
  onProgress?: (info: { stage: string; current: number; total: number }) => void;
}

const utf8 = new TextDecoder('utf-8');
const cleanText = (bytes: Uint8Array): string => utf8.decode(bytes).replace(/\0/g, '').trim();

/** Records of at most this size are read whole; anything bigger that we would want is not a real entity. */
const MAX_ENTITY_BYTES = 256 * 1024 * 1024;

interface Frame {
  tag: number;
  end: number;
  accumulator: GeometryAccumulator | null;
  /** Set on the record of a component definition. */
  definition: { name: string; skip: boolean; altId: number | null } | null;
  /** The definition this record sits in (or is), if any. */
  owner: Frame | null;
  /**
   * How a definition's id is found, following OpenSKP: an id record that is a direct child wins; failing that, the
   * first id found by searching the children in order. On a record inside a definition these hold what that search
   * has turned up so far for this record.
   */
  idDirect: number | null;
  idVia: number | null;
  wrapper: boolean;
}

/** Which of a definition's two candidate ids placements refer to. See {@link chooseKeys}. */
type KeyKind = 'id' | 'alt';

interface ReadMode {
  /** Only note where components are placed; skip all their geometry. */
  placementsOnly?: boolean;
  /** Skip the geometry of definitions not in this set (their ids, as chosen by `keys`). */
  used?: ReadonlySet<number>;
  keys?: KeyKind;
}

interface ModelRecords {
  /** Every definition read, with both candidate ids recorded on it. */
  templates: DefTemplate[];
  root: DefTemplate;
  layerIdToName: Map<number, string>;
  materialIdToName: Map<number, string>;
}

function nodeFromBody(tag: number, body: Uint8Array): TlvNode {
  const children = body.length > 0 && CONTAINER_TAGS.has(tag) ? parseTlvRecursive(body, 0, body.length) : [];
  return { tag, children, payload: children.length > 0 ? new Uint8Array(0) : body };
}

const idOf = (tag: number, payload: Uint8Array): number => (tag === TAG.ENTITY_ID ? entityIdFromPayload(payload) : parseVarInt(payload, 0, payload.length));

/**
 * Reads model.dat as it is inflated. Component definitions are turned into compact triangle meshes the moment their
 * records end, so memory use follows the size of one definition, not the size of the file.
 */
function readModelRecords(archive: SkpArchiveStream, mode: ReadMode = {}): ModelRecords {
  const templates: DefTemplate[] = [];
  const layerIdToName = new Map<number, string>();
  const materialIdToName = new Map<number, string>();
  const rootAccumulator = new GeometryAccumulator();
  const pool: GeometryAccumulator[] = [];
  const stack: Frame[] = [];
  const active: GeometryAccumulator[] = [];

  const sink: EntitySink = {
    vertex(id, x, y, z) {
      for (let i = 0; i < active.length; i++) active[i].vertex(id, x, y, z);
    },
    edge(id, v1, v2) {
      for (let i = 0; i < active.length; i++) active[i].edge(id, v1, v2);
    },
    face(face: FaceRecord) {
      for (let i = 0; i < active.length; i++) active[i].face(face);
    },
    instance(instance: InstanceRecord) {
      for (let i = 0; i < active.length; i++) active[i].instance(instance);
    },
  };

  const closeTop = () => {
    const frame = stack.pop()!;
    const parent = stack[stack.length - 1];
    if (frame.owner && !frame.definition) {
      const result = frame.idDirect ?? frame.idVia;
      if (result !== null && parent && parent.idVia === null) parent.idVia = result;
    }
    if (!frame.accumulator) return;
    active.pop();
    if (frame.definition) {
      const id = frame.idDirect ?? frame.idVia;
      const altId = frame.definition.altId;
      const key = mode.keys === 'alt' ? altId : id;
      const unused = mode.used !== undefined && key !== null && !mode.used.has(key);
      if (!frame.definition.skip && !unused && (id !== null || altId !== null)) {
        const template = frame.accumulator.finalize(frame.definition.name);
        template.id = id;
        template.altId = altId;
        templates.push(template);
      }
      pool.push(frame.accumulator);
    }
  };

  const readLayerTable = (node: TlvNode) => {
    for (const child of node.children) {
      if (child.tag !== TAG.LAYER) continue;
      const idNode = findChildTag(child.children, TAG.ENTITY_ID);
      const nameNode = findChildTag(child.children, TAG.LAYER_NAME);
      if (idNode && nameNode) layerIdToName.set(entityIdFromPayload(idNode.payload), cleanText(nameNode.payload));
    }
  };

  const readMaterialEntry = (node: TlvNode) => {
    const idNode = findChildTag(node.children, TAG.ENTITY_ID);
    const nameNode = findChildTag(node.children, TAG.MATERIAL_NAME);
    if (idNode && nameNode) materialIdToName.set(entityIdFromPayload(idNode.payload), utf8.decode(nameNode.payload));
  };

  for (;;) {
    // Close every record that has ended. Anything left over inside it is too short to be a record.
    for (;;) {
      const top = stack[stack.length - 1];
      if (!top) break;
      const left = top.end - archive.pos;
      if (left >= 6) break;
      if (left > 0) archive.skip(left);
      closeTop();
    }
    const header = archive.readHeader();
    if (!header) break;
    const { tag, size } = header;
    const parent = stack[stack.length - 1];
    const end = archive.pos + size;
    if (parent && end > parent.end) {
      // A record that claims to run past the one holding it: the rest of the holder is not read.
      const left = parent.end - archive.pos;
      if (left > 0) archive.skip(left);
      closeTop();
      continue;
    }
    const owner = parent ? parent.owner : null;

    if (parent?.definition && tag === TAG.DEFINITION_NAME) {
      const payload = archive.take(size);
      if (!payload) break;
      parent.definition.name = cleanText(payload);
      continue;
    }

    // Id records inside a definition. Most are skipped; these are the ones that can name the definition.
    if (owner && (tag === TAG.ENTITY_ID || tag === TAG.ENTITY_ID_INNER)) {
      const atDefinition = parent.definition !== null;
      const wantDirect = atDefinition ? owner.idDirect === null : owner.idVia === null && parent.idDirect === null;
      const grand = stack[stack.length - 2];
      const great = stack[stack.length - 3];
      // The id in a definition's own flags block (definition > container > D007 > id) is a second candidate.
      const wantAlt = tag === TAG.ENTITY_ID && owner.definition!.altId === null && parent.tag === TAG.FLAGS_BLOCK && !!grand && !grand.definition && great === owner;
      if (wantDirect || wantAlt) {
        const payload = archive.take(size);
        if (!payload) break;
        const value = idOf(tag, payload);
        if (wantDirect) {
          if (atDefinition) {
            owner.idDirect = value;
            if (mode.used && mode.keys !== 'alt' && !mode.used.has(value)) {
              // Nothing places this component, so the rest of it need not be read.
              owner.definition!.skip = true;
              const left = parent.end - archive.pos;
              if (left > 0 && !archive.skip(left)) break;
            }
          } else {
            parent.idDirect = value;
          }
        }
        if (wantAlt) owner.definition!.altId = value;
        continue;
      }
    }

    const collecting = active.length > 0;
    const needVia = !!owner && owner.idVia === null && parent.idVia === null;
    if (collecting && isGeometryEntity(tag) && mode.placementsOnly && tag !== TAG.INSTANCE) {
      // Only the id of the first such record in a holder can matter, and only when a definition's id is still being searched for.
      if (needVia && size <= MAX_ENTITY_BYTES) {
        const body = archive.take(size);
        if (!body) break;
        parent.idVia = extractEntityId(nodeFromBody(tag, body));
      } else if (!archive.skip(size)) break;
      continue;
    }
    if ((collecting && isGeometryEntity(tag)) || tag === TAG.LAYER_TABLE || tag === TAG.MATERIAL_ENTRY) {
      if (size > MAX_ENTITY_BYTES) {
        if (!archive.skip(size)) break;
        continue;
      }
      const body = archive.take(size);
      if (!body) break;
      let entityId = -1;
      if (tag === TAG.VERTEX) entityId = extractVertexFast(body, sink);
      else if (tag === TAG.EDGE) entityId = extractEdgeFast(body, sink);
      if (entityId < 0) {
        const node = nodeFromBody(tag, body);
        if (tag === TAG.LAYER_TABLE) readLayerTable(node);
        else if (tag === TAG.MATERIAL_ENTRY) readMaterialEntry(node);
        else {
          extractEntity(node, sink);
          if (needVia) {
            const found = extractEntityId(node);
            if (found !== null) entityId = found;
          }
        }
      }
      if (needVia && entityId >= 0) parent.idVia = entityId;
      continue;
    }

    const newFrame = (accumulator: GeometryAccumulator | null, definition: Frame['definition'], wrapper: boolean): Frame => {
      const frame: Frame = { tag, end, accumulator, definition, owner: null, idDirect: null, idVia: null, wrapper };
      frame.owner = definition ? frame : owner;
      return frame;
    };
    if (tag === TAG.DEFINITION) {
      const accumulator = pool.pop() ?? new GeometryAccumulator();
      accumulator.reset();
      active.push(accumulator);
      stack.push(newFrame(accumulator, { name: '', skip: false, altId: null }, false));
      continue;
    }
    const atTop = stack.length === 0 || (stack.length === 1 && stack[0].wrapper);
    if (tag === TAG.ROOT_GEOMETRY && atTop) {
      active.push(rootAccumulator);
      stack.push(newFrame(rootAccumulator, null, false));
      continue;
    }
    if (size > 0 && CONTAINER_TAGS.has(tag)) {
      stack.push(newFrame(null, null, tag === TAG.FILE_WRAPPER && stack.length === 0));
      continue;
    }
    if (!archive.skip(size)) break;
  }
  while (stack.length) closeTop();
  return { templates, root: rootAccumulator.finalize('ROOT_MODEL'), layerIdToName, materialIdToName };
}

/**
 * A definition's id as OpenSKP finds it can differ from the id its placements use, depending on where in the
 * definition its records happen to be. Both candidates were recorded; use whichever one more of the file's
 * placements refer to.
 */
function chooseKeys(templates: DefTemplate[], root: DefTemplate): { definitions: Map<number, DefTemplate>; keys: KeyKind } {
  const byId = new Set<number>();
  const byAlt = new Set<number>();
  for (const t of templates) {
    if (t.id != null) byId.add(t.id);
    if (t.altId != null) byAlt.add(t.altId);
  }
  let idHits = 0;
  let altHits = 0;
  const count = (instances: DefTemplate['instances']) => {
    for (const inst of instances) {
      if (byId.has(inst.refIdx)) idHits++;
      if (byAlt.has(inst.refIdx)) altHits++;
    }
  };
  count(root.instances);
  for (const t of templates) count(t.instances);
  const keys: KeyKind = altHits > idHits ? 'alt' : 'id';
  const definitions = new Map<number, DefTemplate>();
  for (const t of templates) {
    const key = keys === 'alt' ? t.altId : t.id;
    if (key != null) definitions.set(key, t);
  }
  return { definitions, keys };
}

const IDENTITY_MATRIX13 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

/** SketchUp's 3x3 + translation instance matrix as a glTF 4x4 (y up, metres). */
function toGltfMatrix(m: number[]): number[] {
  const scale = 0.0254;
  const [a, b, c, d, e, f, g, h, i] = m;
  const tx = m[9] ?? 0;
  const ty = m[10] ?? 0;
  const tz = m[11] ?? 0;
  return [a, g, -d, 0, c, i, -f, 0, -b, -h, e, 0, tx * scale, tz * scale, -ty * scale, 1];
}

function buildScene(records: ModelRecords & { definitions: Map<number, DefTemplate> }, tables: ReturnType<typeof buildMaterialTables>, options: LeanSkpOptions): Uint8Array {
  const { definitions, root, layerIdToName, materialIdToName } = records;
  const { materialsMap, materialsByFolder, layerColors } = tables;
  const nodes = new NodeStore();
  const meshes: MeshResource[] = [];
  const glbMaterials: GlbMaterial[] = [];
  const materialIndexByKey = new Map<string, number>();
  const resourceByVariant = new Map<string, number>();
  const textureIndexByKey = new Map<string, number>();
  const textureIndexByObject = new WeakMap<object, number | null>();
  const materialKeys = new WeakMap<SkpMaterial, string>();
  const layerColorCache = new Map<string, RgbColor>();

  const layerColor = (name: string): RgbColor => {
    let color = layerColorCache.get(name);
    if (!color) {
      const c = layerColors.get(name) || [136, 136, 136];
      color = { r: c[0], g: c[1], b: c[2] };
      layerColorCache.set(name, color);
    }
    return color;
  };

  const textureIndexFor = (texture: SkpMaterial['texture'] | undefined): number | null => {
    if (!texture || !texture.data || texture.data.size === 0) return null;
    const cached = textureIndexByObject.get(texture);
    if (cached !== undefined) return cached;
    let result: number | null = null;
    if (sniffImageMime(texture.data.head) !== null) {
      const key = `${texture.data.size}:${Array.from(texture.data.head).join(',')}`;
      let idx = textureIndexByKey.get(key);
      if (idx === undefined) {
        idx = textureIndexByKey.size;
        textureIndexByKey.set(key, idx);
      }
      result = idx;
    }
    textureIndexByObject.set(texture, result);
    return result;
  };

  const materialIndexFor = (color: RgbColor, doubleSided: boolean, textureIndex: number | null, transparency: number): number => {
    const key = `${color.r},${color.g},${color.b},${doubleSided},${textureIndex ?? -1},${transparency}`;
    const hit = materialIndexByKey.get(key);
    if (hit !== undefined) return hit;
    const material: Record<string, unknown> = {
      pbrMetallicRoughness: { baseColorFactor: [color.r / 255, color.g / 255, color.b / 255, transparency], metallicFactor: 0, roughnessFactor: 0.8 },
    };
    if (doubleSided) material.doubleSided = true;
    if (transparency < 1) material.alphaMode = 'BLEND';
    else if (textureIndex !== null) material.alphaMode = 'MASK';
    const index = glbMaterials.length;
    glbMaterials.push({ json: JSON.stringify(material) });
    materialIndexByKey.set(key, index);
    return index;
  };

  const materialKey = (material: SkpMaterial | undefined): string => {
    if (!material) return '-';
    let key = materialKeys.get(material);
    if (key === undefined) {
      const tex = material.texture;
      const texKey = tex && tex.data && tex.data.size > 0 ? `${tex.data.size}:${Array.from(tex.data.head).join(',')}:${tex.width}x${tex.height}` : '-';
      key = `${material.name}|${material.color.r},${material.color.g},${material.color.b}|${texKey}`;
      materialKeys.set(material, key);
    }
    return key;
  };

  const resolveMaterial = (id: number): SkpMaterial | undefined => {
    if (id < 0) return undefined;
    const name = materialIdToName.get(id);
    if (!name) return undefined;
    return materialsMap.get(name) || materialsByFolder.get(name);
  };

  const respectVisibility = options.respectEdgeVisibility ?? false;

  /** The mesh for a definition as seen when placed inside this material and layer, built once per distinct look. Returns -1 for none. */
  const meshFor = (definitionKey: number | 'ROOT', template: DefTemplate | undefined, inherited: SkpMaterial | undefined, layer: string): number => {
    if (!template || template.faceCount === 0) return -1;
    const lc = layerColor(layer);
    const variant = `${definitionKey}|${materialKey(inherited)}|${lc.r},${lc.g},${lc.b}`;
    const hit = resourceByVariant.get(variant);
    if (hit !== undefined) return hit;
    const ctx: MeshContext = { resolveMaterial, textureIndexFor, inheritedMaterial: inherited, fallbackLayerColor: lc, respectVisibility };
    const groups: FinishedGroup[] = buildFaceGroups(template, ctx);
    if (groups.length === 0) {
      resourceByVariant.set(variant, -1);
      return -1;
    }
    const primitives = groups.map((g) => packPrimitive(g, materialIndexFor(g.color, g.doubleSided, g.textureIndex, g.transparency)));
    const index = meshes.length;
    meshes.push({ name: template.name, primitives });
    resourceByVariant.set(variant, index);
    return index;
  };

  let placed = 0;
  const activeDefinitions = new Set<number>();

  const walk = (template: DefTemplate | undefined, parentNode: number, parentLayer: string, inheritedMaterial: SkpMaterial | undefined) => {
    if (!template) return;
    for (const inst of template.instances) {
      const refIdx = inst.refIdx;
      let layer = parentLayer;
      let instanceMaterial = inheritedMaterial;
      if (inst.layerId >= 0) layer = layerIdToName.get(inst.layerId) || parentLayer;
      if (inst.materialId >= 0) {
        const materialName = materialIdToName.get(inst.materialId);
        if (materialName) {
          const material = materialsMap.get(materialName) || materialsByFolder.get(materialName);
          if (material) instanceMaterial = material;
        }
      }
      placed++;
      if (placed % 500 === 0) options.onProgress?.({ stage: 'build_scene', current: placed, total: 0 });
      if (activeDefinitions.has(refIdx)) throw new Error('Recursive component definition');

      const child = definitions.get(refIdx);
      const childName = child?.name || '';
      const nameIsReal = !!childName && !isGenericDefinitionName(childName);
      const display = inst.nameOverride ?? (inst.name ? inst.name : nameIsReal ? childName : `Component_${refIdx}`);

      const node = nodes.add(parentNode);
      nodes.setName(node, display);
      nodes.setMatrix(node, toGltfMatrix(inst.matrix.length ? inst.matrix : IDENTITY_MATRIX13));

      activeDefinitions.add(refIdx);
      walk(child, node, layer, instanceMaterial);
      activeDefinitions.delete(refIdx);

      nodes.setMesh(node, meshFor(refIdx, child, instanceMaterial, layer));
    }
  };

  const rootNode = nodes.add(-1);
  nodes.setName(rootNode, 'ROOT');
  nodes.setMatrix(rootNode, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  walk(root, rootNode, 'Layer0', undefined);
  nodes.setMesh(rootNode, meshFor('ROOT', root, undefined, 'Layer0'));

  if (meshes.length === 0 && !options.allowEmptyScene) {
    throw new LeanSkpEmpty(`Nothing to draw: ${definitions.size} components, ${root.instances.length} placements in the model, ${root.faceCount} loose faces`);
  }
  return writeInstancedGlb(nodes, meshes, glbMaterials);
}

function hasBytes(data: Uint8Array, needle: number[], limit: number): boolean {
  const end = Math.min(data.length, limit) - needle.length;
  outer: for (let i = 0; i <= end; i++) {
    for (let j = 0; j < needle.length; j++) if (data[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Throws {@link LeanSkpUnsupported} for a file this reader cannot handle. */
function checkContainer(data: Uint8Array): void {
  if (!(data.length >= 4 && data[0] === 0xff && data[1] === 0xfe && data[2] === 0xff && data[3] === 0x0e)) {
    throw new LeanSkpUnsupported('Not a SketchUp 2021+ file (bad header)');
  }
  const hasZip = hasBytes(data, [0x50, 0x4b, 0x03, 0x04], 256);
  const isLegacy = !hasZip && hasBytes(data, Array.from('CVersionMap', (c) => c.charCodeAt(0)), 512);
  if (isLegacy) throw new LeanSkpUnsupported('Older SketchUp file format');
}

/** The ids of every component reachable from the model itself through placements, and which kind of id they are. */
function findUsedDefinitions(data: Uint8Array, options: LeanSkpOptions): { used: Set<number>; keys: KeyKind } {
  const archive = new SkpArchiveStream(data, (fed, total) => options.onProgress?.({ stage: 'scan_placements', current: fed, total }));
  const scanned = readModelRecords(archive, { placementsOnly: true });
  const { definitions, keys } = chooseKeys(scanned.templates, scanned.root);
  const used = new Set<number>();
  const pending: DefTemplate[] = [scanned.root];
  while (pending.length) {
    for (const inst of pending.pop()!.instances) {
      if (used.has(inst.refIdx)) continue;
      used.add(inst.refIdx);
      const child = definitions.get(inst.refIdx);
      if (child) pending.push(child);
    }
  }
  return { used, keys };
}

function readOnce(data: Uint8Array, options: LeanSkpOptions, only: { used: Set<number>; keys: KeyKind } | undefined): Uint8Array {
  const archive = new SkpArchiveStream(data, (fed, total) => options.onProgress?.({ stage: 'tlv_walk', current: fed, total }));
  const records = readModelRecords(archive, only ? { used: only.used, keys: only.keys } : {});
  archive.finish();
  const tables = buildMaterialTables(archive.materialXml, archive.otherFiles);
  const { definitions } = chooseKeys(records.templates, records.root);
  return buildScene({ ...records, definitions }, tables, options);
}

/**
 * Reads a SketchUp (2021 or newer) file into a GLB, with memory use that follows the biggest single component in the
 * file rather than the size of the whole file. The result matches what OpenSKP builds for the same file.
 *
 * If the browser still runs out of memory, the file is read a second time with every component that nothing places
 * left out (SketchUp files often carry plenty of those). That does not change what the model looks like.
 */
export function readSkpToGlbLean(buffer: ArrayBuffer, options: LeanSkpOptions = {}): Uint8Array {
  const data = new Uint8Array(buffer);
  checkContainer(data);
  if (options.onlyUsedDefinitions) return readOnce(data, options, findUsedDefinitions(data, options));
  try {
    return readOnce(data, options, undefined);
  } catch (error) {
    if (!isOutOfMemoryError(error)) throw error;
    options.onProgress?.({ stage: 'retry_used_only', current: 0, total: 0 });
    return readOnce(data, options, findUsedDefinitions(data, options));
  }
}
