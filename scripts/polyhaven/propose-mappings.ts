import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ReleaseSnapshot } from './types';

const LEGACY = [
  ['architectural', 'red-brick'], ['architectural', 'coursed-stone'], ['architectural', 'polished-concrete'],
  ['architectural', 'stucco-white'], ['architectural', 'vertical-timber'], ['architectural', 'architectural-glass'],
  ['architectural', 'standing-seam-zinc'], ['architectural', 'weathered-steel'], ['architectural', 'travertine-marble'],
  ['architectural', 'terracotta-tile'], ['architectural', 'black-granite'],
  ...['lush_grass', 'manicured_turf', 'alpine_rock', 'forest_mulch', 'desert_sand', 'cobblestone', 'crushed_gravel', 'fresh_snow', 'weathered_asphalt', 'terracotta_clay']
    .map(key => ['terrain', key]),
] as const;

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[_-]/g, ' ').split(/[^a-z0-9]+/).filter(Boolean));
}

function score(legacy: string, id: string, record: unknown): number {
  const left = tokens(legacy);
  const raw = record && typeof record === 'object' ? record as Record<string, unknown> : {};
  const right = tokens(`${id} ${String(raw.name ?? '')} ${String(raw.categories ?? '')} ${String(raw.tags ?? '')}`);
  return [...left].reduce((total, token) => total + (right.has(token) ? 1 : 0), 0) / Math.max(left.size, 1);
}

async function main() {
  const args = process.argv.slice(2);
  const input = args[args.indexOf('--snapshot') + 1];
  const output = args[args.indexOf('--out') + 1];
  if (!input || !output) throw new Error('Usage: propose-mappings --snapshot discovery.json --out candidates.json');
  const snapshot = JSON.parse(await readFile(resolve(input), 'utf8')) as ReleaseSnapshot;
  const candidates = LEGACY.map(([legacyNamespace, legacyKey]) => ({
    legacyNamespace, legacyKey, scoringVersion: 1, sourceRelease: snapshot.release,
    candidates: Object.entries(snapshot.records).filter(([, value]) => value.kind === 'material')
      .map(([id, value]) => ({ assetId: `ph:material:${id}`, score: score(legacyKey, id, value.info) }))
      .filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score).slice(0, 3),
  }));
  await writeFile(resolve(output), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), candidates }, null, 2)}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
