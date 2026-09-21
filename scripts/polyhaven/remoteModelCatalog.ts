// Builds a small, git-friendly catalog of Poly Haven's own CDN URLs for each model - used
// instead of downloadModels.ts's approach of mirroring the files into public/polyhaven-models/.
// Some of these models' mesh (.bin) files run into the hundreds of MB (pine_tree_01 alone is
// ~905MB), which is both over GitHub's 100MB-per-file hard limit and, self-hosted via Vercel
// Blob or the deployment's own static assets, adds real storage cost on top of an account
// already well over its Deployment Storage quota. Referencing Poly Haven's public CDN directly
// avoids both: this script only fetches the small /info + /files metadata (never the actual
// model files) and writes their existing gltf URLs into a catalog the app loads at runtime.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PolyHavenApi } from './api';
import { DEFAULT_MODEL_SLUGS } from './discoverModels';
import type { ImporterConfig, Quality } from './types';

interface FileLeaf {
  url: string;
  md5: string;
  size: number;
}

interface ModelInfo {
  name?: string;
  categories?: string[];
  tags?: string[];
}

export interface RemoteModelCatalogEntry {
  id: string;
  sourceId: string;
  kind: 'model';
  name: string;
  source: 'polyhaven';
  license: 'CC0-1.0';
  categories: string[];
  tags: string[];
  tier: Quality;
  gltfUrl: string;
}

export async function buildRemoteModelCatalog(
  config: ImporterConfig,
  options: { slugs?: string[]; tier?: Quality; outPath?: string } = {}
): Promise<{ outPath: string; catalog: RemoteModelCatalogEntry[] }> {
  if (!config.operatorContact) throw new Error('config.operatorContact must be set for identifiable API requests');
  const slugs = options.slugs ?? DEFAULT_MODEL_SLUGS;
  const tier = options.tier ?? '1k';
  const outPath = options.outPath ?? join('src', 'lib', 'graphics', 'polyhavenModelCatalog.json');
  const api = new PolyHavenApi(config);
  const catalog: RemoteModelCatalogEntry[] = [];

  for (const slug of slugs) {
    const [info, files] = await Promise.all([
      api.get(`/info/${encodeURIComponent(slug)}`) as Promise<ModelInfo>,
      api.get(`/files/${encodeURIComponent(slug)}`) as Promise<Record<string, Record<string, { gltf?: FileLeaf }>>>,
    ]);

    const tierEntry = files.gltf?.[tier]?.gltf;
    if (!tierEntry) {
      console.log(`SKIP ${slug}: no gltf.${tier} entry (available tiers: ${Object.keys(files.gltf || {}).join(', ')})`);
      continue;
    }

    console.log(`OK ${slug}: ${tierEntry.url}`);
    catalog.push({
      id: `ph:model:${slug}`,
      sourceId: slug,
      kind: 'model',
      name: info.name || slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      source: 'polyhaven',
      license: 'CC0-1.0',
      categories: info.categories || [],
      tags: info.tags || [],
      tier,
      gltfUrl: tierEntry.url,
    });
  }

  await mkdir(join(outPath, '..'), { recursive: true });
  await writeFile(outPath, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), assets: catalog }, null, 2)}\n`);
  console.log(`\nWrote remote catalog for ${catalog.length} model(s) to ${outPath}`);

  return { outPath, catalog };
}
