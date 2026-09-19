import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PolyHavenApi, mapConcurrent, sha256Json } from './api';
import type { ImporterConfig, ReleaseSnapshot } from './types';

function recordMap(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected API object map');
  return input as Record<string, unknown>;
}

function findTaxonomyNode(input: unknown, slug: string): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  if (Array.isArray(input)) {
    for (const value of input) { const found = findTaxonomyNode(value, slug); if (found) return found; }
    return undefined;
  }
  const object = input as Record<string, unknown>;
  if (object.slug === slug) return object;
  for (const value of Object.values(object)) { const found = findTaxonomyNode(value, slug); if (found) return found; }
  return undefined;
}

export async function discover(config: ImporterConfig, release = new Date().toISOString().replace(/[:.]/g, '-')): Promise<ReleaseSnapshot> {
  if (!config.operatorContact) throw new Error('config.polyhaven.operatorContact must be set for identifiable API requests');
  const api = new PolyHavenApi(config);
  const base = await mapConcurrent(['/api-docs/swagger.json', '/taxonomy/textures', '/taxonomy/hdris', '/assets?type=textures'], config.metadataConcurrency, path => api.get(path));
  const [openApi, textureTaxonomy, hdriTaxonomy, textures] = base;
  for (const [slug, expectedId] of Object.entries(config.environmentRoots)) {
    const node = findTaxonomyNode(hdriTaxonomy, slug);
    if (!node || node.id !== expectedId) throw new Error(`HDRI taxonomy root mismatch for ${slug}`);
  }
  const groupNames = Object.keys(config.environmentRoots);
  const hdriGroups = await mapConcurrent(groupNames, config.metadataConcurrency, group => api.get(`/assets?type=hdris&category=${encodeURIComponent(group)}`));
  const textureAssets = recordMap(textures);
  const hdriAssets: Record<string, unknown> = {};
  hdriGroups.forEach(group => Object.assign(hdriAssets, recordMap(group)));
  const items = [
    ...Object.keys(textureAssets).map(id => ({ id, kind: 'material' as const })),
    ...Object.keys(hdriAssets).map(id => ({ id, kind: 'hdri' as const })),
  ];
  const hdriMembership = new Map<string, string>();
  hdriGroups.forEach((group, index) => Object.keys(recordMap(group)).forEach(id => {
    if (!hdriMembership.has(id)) hdriMembership.set(id, groupNames[index]!);
  }));
  const recordsArray = await mapConcurrent(items, config.metadataConcurrency, async item => ({
    id: item.id,
    record: {
      info: await api.get(`/info/${encodeURIComponent(item.id)}`), files: await api.get(`/files/${encodeURIComponent(item.id)}`), kind: item.kind,
      ...(item.kind === 'hdri' ? { environmentGroup: hdriMembership.get(item.id) } : {}),
    },
  }));
  const records = Object.fromEntries(recordsArray.map(({ id, record }) => [id, record]));
  const snapshot: ReleaseSnapshot = {
    schemaVersion: 1, release, acquiredAt: new Date().toISOString(), openApiSha256: sha256Json(openApi),
    taxonomy: { textures: textureTaxonomy, hdris: hdriTaxonomy }, assets: { textures: textureAssets, hdris: hdriAssets }, records,
  };
  const dir = join(config.workDirectory, 'releases', release);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'discovery.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(join(dir, 'openapi.json'), `${JSON.stringify(openApi, null, 2)}\n`);
  return snapshot;
}

export async function readSnapshot(config: ImporterConfig, release: string): Promise<ReleaseSnapshot> {
  return JSON.parse(await readFile(join(config.workDirectory, 'releases', release, 'discovery.json'), 'utf8')) as ReleaseSnapshot;
}
