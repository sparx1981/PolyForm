// One-shot discovery for a specific list of Poly Haven MODEL assets (trees, bushes, grass,
// flowers, boulders - full meshes, not the material/HDRI kinds the rest of this pipeline
// handles). Poly Haven's /info and /files responses for models have a different shape than
// for textures (LOD tiers, mesh formats like gltf/fbx/blend, embedded vs external textures)
// that this codebase hasn't ingested before, so rather than guess at a plan/download/convert
// pipeline blind, this just dumps the real API responses for inspection - the actual model
// import pipeline gets built from what these responses turn out to contain.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PolyHavenApi, mapConcurrent } from './api';
import type { ImporterConfig } from './types';

export const DEFAULT_MODEL_SLUGS = [
  'tree_small_02',
  'island_tree_01',
  'jacaranda_tree',
  'grass_medium_01',
  'fir_sapling_medium',
  'fir_tree_01',
  'pine_tree_01',
  'boulder_01',
  'flower_heliophila',
  'fern_02',
  'flower_gazania',
  'shrub_03',
  'leipoldtia_schultzei',
];

export type ModelDiscoveryResult =
  | { slug: string; ok: true; info: unknown; files: unknown }
  | { slug: string; ok: false; error: string };

export async function discoverModels(config: ImporterConfig, slugs: string[] = DEFAULT_MODEL_SLUGS): Promise<{ outPath: string; results: ModelDiscoveryResult[] }> {
  if (!config.operatorContact) throw new Error('config.operatorContact must be set for identifiable API requests');
  const api = new PolyHavenApi(config);
  const results = await mapConcurrent(slugs, config.metadataConcurrency, async (slug): Promise<ModelDiscoveryResult> => {
    try {
      const [info, files] = await Promise.all([api.get(`/info/${encodeURIComponent(slug)}`), api.get(`/files/${encodeURIComponent(slug)}`)]);
      return { slug, ok: true, info, files };
    } catch (error) {
      return { slug, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  const outDir = join(config.workDirectory, 'model-discovery');
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(outPath, `${JSON.stringify(results, null, 2)}\n`);

  for (const r of results) {
    if (r.ok === false) { console.log(`FAILED ${r.slug}: ${r.error}`); continue; }
    const info = r.info as { type?: number; categories?: string[]; tags?: string[] };
    const fileFormats = r.files && typeof r.files === 'object' ? Object.keys(r.files as object) : [];
    console.log(`OK ${r.slug} - type=${info.type} categories=${(info.categories || []).join(',')} fileFormats=${fileFormats.join(',')}`);
  }
  console.log(`\nFull responses written to ${outPath}`);
  return { outPath, results };
}
