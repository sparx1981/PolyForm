export type IfcEntityType =
  | 'IFCPROJECT'
  | 'IFCSITE'
  | 'IFCBUILDING'
  | 'IFCBUILDINGSTOREY'
  | 'IFCSPACE'
  | 'IFCWALL'
  | 'IFCWALLSTANDARDCASE'
  | 'IFCDOOR'
  | 'IFCWINDOW'
  | 'IFCSLAB'
  | 'IFCBEAM'
  | 'IFCCOLUMN'
  | 'IFCROOF'
  | 'IFCSTAIR'
  | 'IFCFURNISHINGELEMENT'
  | string;

export interface IfcEntitySummary {
  stepId: number;
  type: IfcEntityType;
  globalId?: string;
  name?: string;
  description?: string;
  parentStepId?: number;
  children: number[];
  propertySets: Record<string, Record<string, string | number | boolean | null>>;
}

export interface IfcModelSummary {
  schema?: string;
  project?: IfcEntitySummary;
  roots: IfcEntitySummary[];
  entities: IfcEntitySummary[];
  byStepId: Record<number, IfcEntitySummary>;
  countsByType: Record<string, number>;
}

interface StepRecord {
  id: number;
  type: string;
  args: string[];
}

function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let start = 0, depth = 0, quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'") {
      if (quoted && value[i + 1] === "'") { i++; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        out.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  out.push(value.slice(start).trim());
  return out;
}

function unquote(v: string | undefined): string | undefined {
  if (!v || v === '$' || v === '*') return undefined;
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

function refs(v: string | undefined): number[] {
  if (!v) return [];
  return [...v.matchAll(/#(\d+)/g)].map(m => Number(m[1]));
}

function parseValue(v: string): string | number | boolean | null {
  if (v === '$' || v === '*') return null;
  const s = unquote(v);
  if (s !== undefined && s !== v) return s;
  const wrapped = /^IFC[A-Z0-9_]+\((.*)\)$/i.exec(v);
  if (wrapped) return parseValue(wrapped[1].trim());
  if (/^\.T\.$/i.test(v)) return true;
  if (/^\.F\.$/i.test(v)) return false;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return v;
}

function records(text: string): StepRecord[] {
  const compact = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const matches = compact.matchAll(/#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*?)\)\s*;/gis);
  const out: StepRecord[] = [];
  for (const match of matches) {
    out.push({
      id: Number(match[1]),
      type: match[2].toUpperCase(),
      args: splitTopLevel(match[3]),
    });
  }
  return out;
}

const SPATIAL = new Set(['IFCPROJECT','IFCSITE','IFCBUILDING','IFCBUILDINGSTOREY','IFCSPACE']);
const ELEMENT_PREFIXES = [
  'IFCWALL','IFCDOOR','IFCWINDOW','IFCSLAB','IFCBEAM','IFCCOLUMN',
  'IFCROOF','IFCSTAIR','IFCFURNISHINGELEMENT',
];

function isElementType(type: string): boolean {
  return SPATIAL.has(type) || ELEMENT_PREFIXES.some(prefix => type.startsWith(prefix));
}

/** Lightweight IFC STEP metadata parser; geometry remains the job of a future web-ifc adapter. */
export function parseIfcMetadata(text: string): IfcModelSummary {
  const recs = records(text);
  const recById = new Map(recs.map(r => [r.id, r]));
  const entities: IfcEntitySummary[] = [];
  const byId = new Map<number, IfcEntitySummary>();

  for (const record of recs) {
    if (!isElementType(record.type)) continue;
    const entity: IfcEntitySummary = {
      stepId: record.id,
      type: record.type,
      globalId: unquote(record.args[0]),
      // IFC root: GlobalId, OwnerHistory, Name, Description...
      name: unquote(record.args[2]),
      description: unquote(record.args[3]),
      children: [],
      propertySets: {},
    };
    entities.push(entity);
    byId.set(record.id, entity);
  }

  // IFCRELAGGREGATES(RelatingObject, RelatedObjects) and spatial containment.
  for (const record of recs) {
    if (record.type === 'IFCRELAGGREGATES') {
      const parent = refs(record.args[4])[0];
      const children = refs(record.args[5]);
      for (const child of children) link(parent, child);
    } else if (record.type === 'IFCRELCONTAINEDINSPATIALSTRUCTURE') {
      const children = refs(record.args[4]);
      const parent = refs(record.args[5])[0];
      for (const child of children) link(parent, child);
    }
  }

  function link(parentId?: number, childId?: number) {
    if (!parentId || !childId) return;
    const parent = byId.get(parentId), child = byId.get(childId);
    if (!parent || !child) return;
    child.parentStepId = parentId;
    if (!parent.children.includes(childId)) parent.children.push(childId);
  }

  // Property single values.
  const propertyValues = new Map<number, { name: string; value: string | number | boolean | null }>();
  for (const record of recs) {
    if (record.type !== 'IFCPROPERTYSINGLEVALUE') continue;
    const name = unquote(record.args[0]) ?? `Property ${record.id}`;
    propertyValues.set(record.id, { name, value: parseValue(record.args[2] ?? '$') });
  }

  const psets = new Map<number, { name: string; values: Record<string, string | number | boolean | null> }>();
  for (const record of recs) {
    if (record.type !== 'IFCPROPERTYSET') continue;
    const name = unquote(record.args[2]) ?? `Pset ${record.id}`;
    const values: Record<string, string | number | boolean | null> = {};
    for (const id of refs(record.args[4])) {
      const prop = propertyValues.get(id);
      if (prop) values[prop.name] = prop.value;
    }
    psets.set(record.id, { name, values });
  }

  for (const record of recs) {
    if (record.type !== 'IFCRELDEFINESBYPROPERTIES') continue;
    const targets = refs(record.args[4]);
    const psetId = refs(record.args[5])[0];
    const pset = psetId ? psets.get(psetId) : undefined;
    if (!pset) continue;
    for (const id of targets) {
      const target = byId.get(id);
      if (target) target.propertySets[pset.name] = { ...pset.values };
    }
  }

  const countsByType: Record<string, number> = {};
  for (const entity of entities) countsByType[entity.type] = (countsByType[entity.type] ?? 0) + 1;

  const schema = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(text)?.[1];
  const roots = entities.filter(entity => entity.parentStepId === undefined);
  const objectById: Record<number, IfcEntitySummary> = {};
  for (const entity of entities) objectById[entity.stepId] = entity;
  return {
    schema,
    project: entities.find(entity => entity.type === 'IFCPROJECT'),
    roots,
    entities,
    byStepId: objectById,
    countsByType,
  };
}

export function ifcSpatialPath(model: IfcModelSummary, stepId: number): IfcEntitySummary[] {
  const out: IfcEntitySummary[] = [];
  const seen = new Set<number>();
  let current = model.byStepId[stepId];
  while (current && !seen.has(current.stepId)) {
    seen.add(current.stepId);
    out.unshift(current);
    current = current.parentStepId ? model.byStepId[current.parentStepId] : undefined;
  }
  return out;
}
