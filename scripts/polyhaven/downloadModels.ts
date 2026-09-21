// Downloads Poly Haven MODEL assets (trees, bushes, grass, flowers, boulders) into
// public/polyhaven-models, one folder per asset, mirroring the exact relative file layout
// Poly Haven's own /files response describes (a .gltf, its .bin, and a "textures/" folder) -
// so the downloaded .gltf's own internal relative references resolve with zero rewriting.
//
// Unlike the material/HDRI pipeline, a model's mesh (the .bin) is identical across every
// quality tier - only the tier's textures differ - so there is nothing to choose per tier
// beyond texture resolution, and no LOD selection to make.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PolyHavenApi } from './api';
import { DEFAULT_MODEL_SLUGS } from './discoverModels';
import type { ImporterConfig, Quality } from './types';

interface FileLeaf {
  url: string;
  md5: string;
  size: number;
  include?: Record<string, FileLeaf>;
}

interface ModelInfo {
  name?: string;
  categories?: string[];
  tags?: string[];
}

export interface ModelCatalogEntry {
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
  byteLength: number;
}

async function downloadVerified(url: string, destPath: string, expectedMd5: string): Promise<number> {
  await mkdir(dirname(destPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const actualMd5 = createHash('md5').update(buffer).digest('hex');
  if (actualMd5.toLowerCase() !== expectedMd5.toLowerCase()) {
    throw new Error(`MD5 mismatch for ${url}: expected ${expectedMd5}, got ${actualMd5}`);
  }
  await writeFile(destPath, buffer);
  return buffer.byteLength;
}

function basenameFromUrl(url: string): string {
  return url.split('/').pop() || url;
}

export async function downloadModels(
  config: ImporterConfig,
  options: { slugs?: string[]; tier?: Quality; outDir?: string } = {}
): Promise<{ outDir: string; catalog: ModelCatalogEntry[] }> {
  if (!config.operatorContact) throw new Error('config.operatorContact must be set for identifiable API requests');
  const slugs = options.slugs ?? DEFAULT_MODEL_SLUGS;
  const tier = options.tier ?? '1k';
  const outDir = options.outDir ?? join('public', 'polyhaven-models');
  const api = new PolyHavenApi(config);
  const catalog: ModelCatalogEntry[] = [];

  for (const slug of slugs) {
    console.log(`Downloading ${slug} (${tier})...`);
    const [info, files] = await Promise.all([
      api.get(`/info/${encodeURIComponent(slug)}`) as Promise<ModelInfo>,
      api.get(`/files/${encodeURIComponent(slug)}`) as Promise<Record<string, Record<string, { gltf?: FileLeaf }>>>,
    ]);

    const tierEntry = files.gltf?.[tier]?.gltf;
    if (!tierEntry) {
      console.log(`  SKIP: no gltf.${tier} entry for ${slug} (available tiers: ${Object.keys(files.gltf || {}).join(', ')})`);
      continue;
    }

    const assetDir = join(outDir, slug);
    const gltfFilename = basenameFromUrl(tierEntry.url);
    let totalBytes = await downloadVerified(tierEntry.url, join(assetDir, gltfFilename), tierEntry.md5);

    const includeEntries = Object.entries(tierEntry.include || {});
    for (const [relativePath, leaf] of includeEntries) {
      totalBytes += await downloadVerified(leaf.url, join(assetDir, relativePath), leaf.md5);
    }
    console.log(`  OK: ${gltfFilename} + ${includeEntries.length} included files (${(totalBytes / 1_000_000).toFixed(1)} MB)`);

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
      gltfUrl: `/polyhaven-models/${slug}/${gltfFilename}`,
      byteLength: totalBytes,
    });
  }

  const catalogPath = join(outDir, 'catalog.json');
  await mkdir(outDir, { recursive: true });
  await writeFile(catalogPath, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), assets: catalog }, null, 2)}\n`);
  console.log(`\nWrote catalog for ${catalog.length} model(s) to ${catalogPath}`);

  return { outDir, catalog };
}
