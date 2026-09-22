// Poly Haven's model meshes and textures are captured at scan/production resolution, not
// real-time-rendering resolution - one polygon-heavy tree or rock dropped into a scene with
// dozens of instances noticeably drains frame rate, and the highest-poly ones (pine_tree_01's
// raw mesh alone runs into the hundreds of MB) are the same files the remote-CDN pipeline
// (remoteModelCatalog.ts) streams to the browser as-is.
//
// This downloads each model once (its .gltf, .bin and textures, exactly like downloadModels.ts),
// runs it through glTF Transform's "optimize" pipeline - mesh simplification, vertex
// quantization, texture downscale + WebP recompression, unused-property pruning - and writes a
// single self-contained .glb per model. That .glb needs no include map (no separate .bin or
// texture files to remap against Poly Haven's own file layout, unlike the remote-CDN catalog),
// and typically comes out one to two orders of magnitude smaller than the source - small enough
// to check into the repo and serve as an ordinary static asset instead of proxying Poly Haven's
// CDN at runtime.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { PolyHavenApi } from './api';
import { DEFAULT_MODEL_SLUGS } from './discoverModels';
import type { ImporterConfig, Quality } from './types';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

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

export interface DecimatedModelCatalogEntry {
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
  // Always empty: the optimized output is a single self-contained .glb (mesh and textures
  // embedded), so there is nothing external left for a loader to resolve. Kept on the entry
  // only so this shares its shape with RemoteModelCatalogEntry - plantLibrary.ts reads both the
  // same way, and an empty map is simply a no-op for the urlRemap it builds from `includes`.
  includes: Record<string, string>;
  originalBytes: number;
  decimatedBytes: number;
}

export interface DecimateOptions {
  slugs?: string[];
  tier?: Quality;
  outDir?: string;
  catalogPath?: string;
  /** Target fraction (0-1) of vertices to keep. Lower = more aggressive. */
  simplifyRatio?: number;
  /** Max simplification error, as a fraction of the mesh's own extent. Higher = more aggressive. */
  simplifyError?: number;
  /** Max texture width/height in pixels after resize. */
  textureSize?: number;
}

async function downloadVerified(url: string, destPath: string, expectedMd5: string): Promise<number> {
  await mkdir(dirname(destPath), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  if (!response.body) throw new Error(`Empty response body: ${url}`);

  const hash = createHash('md5');
  let byteLength = 0;
  const source = Readable.fromWeb(response.body as any);
  source.on('data', (chunk: Buffer) => { hash.update(chunk); byteLength += chunk.byteLength; });
  await pipeline(source, createWriteStream(destPath));

  const actualMd5 = hash.digest('hex');
  if (actualMd5.toLowerCase() !== expectedMd5.toLowerCase()) {
    throw new Error(`MD5 mismatch for ${url}: expected ${expectedMd5}, got ${actualMd5}`);
  }
  return byteLength;
}

function basenameFromUrl(url: string): string {
  return url.split('/').pop() || url;
}

export async function decimateModels(
  config: ImporterConfig,
  options: DecimateOptions = {}
): Promise<{ outDir: string; catalog: DecimatedModelCatalogEntry[] }> {
  if (!config.operatorContact) throw new Error('config.operatorContact must be set for identifiable API requests');
  const slugs = options.slugs ?? DEFAULT_MODEL_SLUGS;
  const tier = options.tier ?? '1k';
  const outDir = options.outDir ?? join('public', 'polyhaven-models-decimated');
  const catalogPath = options.catalogPath ?? join('src', 'lib', 'graphics', 'polyhavenModelCatalog.json');
  const simplifyRatio = options.simplifyRatio ?? 0.25;
  const simplifyError = options.simplifyError ?? 0.01;
  const textureSize = options.textureSize ?? 1024;
  // The package's "bin" entry isn't listed in its "exports" map, so it can't be resolved
  // directly under strict ESM resolution - resolve the package's main export instead and
  // derive the bin script's path from its own root (main is always <root>/dist/cli.mjs).
  const cliMain = require.resolve('@gltf-transform/cli');
  const cliPath = join(dirname(cliMain), '..', 'bin', 'cli.js');

  const api = new PolyHavenApi(config);
  const catalog: DecimatedModelCatalogEntry[] = [];
  await mkdir(outDir, { recursive: true });

  for (const slug of slugs) {
    const workDir = await mkdtemp(join(tmpdir(), `ph-decimate-${slug}-`));
    try {
      console.log(`Decimating ${slug} (${tier})...`);
      const [info, files] = await Promise.all([
        api.get(`/info/${encodeURIComponent(slug)}`) as Promise<ModelInfo>,
        api.get(`/files/${encodeURIComponent(slug)}`) as Promise<Record<string, Record<string, { gltf?: FileLeaf }>>>,
      ]);

      const tierEntry = files.gltf?.[tier]?.gltf;
      if (!tierEntry) {
        console.log(`  SKIP: no gltf.${tier} entry for ${slug} (available tiers: ${Object.keys(files.gltf || {}).join(', ')})`);
        continue;
      }

      const gltfFilename = basenameFromUrl(tierEntry.url);
      const inputGltf = join(workDir, gltfFilename);
      let originalBytes = await downloadVerified(tierEntry.url, inputGltf, tierEntry.md5);
      for (const [relativePath, leaf] of Object.entries(tierEntry.include || {})) {
        originalBytes += await downloadVerified(leaf.url, join(workDir, relativePath), leaf.md5);
      }

      const outputGlb = join(outDir, `${slug}.glb`);
      // quantize (not meshopt/draco) so the existing GLTFLoader - which has no Draco/Meshopt
      // decoder wired up (see plantModelLoader.ts) - can still load the result unmodified;
      // KHR_mesh_quantization decodes automatically in three.js's GLTFLoader. --palette and
      // --instance are single-model no-ops (palette merges materials across multiple assets,
      // instancing needs repeated node references) so are turned off rather than left to do
      // unpredictable per-model material surgery.
      await execFileAsync(process.execPath, [
        cliPath, 'optimize', inputGltf, outputGlb,
        '--compress', 'quantize',
        '--texture-compress', 'webp',
        '--texture-size', String(textureSize),
        '--simplify-ratio', String(simplifyRatio),
        '--simplify-error', String(simplifyError),
        '--palette', 'false',
        '--instance', 'false',
      ], { maxBuffer: 1024 * 1024 * 64 });

      const decimatedBytes = (await stat(outputGlb)).size;
      console.log(`  OK: ${(originalBytes / 1_000_000).toFixed(1)}MB -> ${(decimatedBytes / 1_000_000).toFixed(2)}MB`);

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
        gltfUrl: `/polyhaven-models-decimated/${slug}.glb`,
        includes: {},
        originalBytes,
        decimatedBytes,
      });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  // Merge into any existing catalog.json (keyed by sourceId) - a partial `--slugs` run leaves
  // every other model's entry (remote or previously decimated) untouched rather than dropping it.
  let existingAssets: DecimatedModelCatalogEntry[] = [];
  try {
    const existing = JSON.parse(await readFile(catalogPath, 'utf8')) as { assets?: DecimatedModelCatalogEntry[] };
    existingAssets = Array.isArray(existing.assets) ? existing.assets : [];
  } catch {
    // No existing catalog (or unreadable/corrupt) - start fresh.
  }
  const mergedBySourceId = new Map(existingAssets.map(asset => [asset.sourceId, asset]));
  for (const asset of catalog) mergedBySourceId.set(asset.sourceId, asset);
  const mergedAssets = [...mergedBySourceId.values()];

  await mkdir(dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), assets: mergedAssets }, null, 2)}\n`);
  console.log(`\nWrote catalog for ${mergedAssets.length} model(s) (${catalog.length} from this run) to ${catalogPath}`);

  return { outDir, catalog: mergedAssets };
}
