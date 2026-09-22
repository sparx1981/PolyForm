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
  /** Retries with escalating aggressiveness while the output stays above this size. */
  maxOutputBytes?: number;
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
  // A real run at ratio 0.12 / error 0.03 produced trees that rendered as a spiky black
  // "hedgehog" mess instead of foliage: mesh simplification only minimizes GEOMETRIC surface
  // deviation, and has no notion that most of a leaf/needle card is transparent (alpha cutout).
  // Collapsing those cards at an aggressive ratio doesn't shrink the visible silhouette the way
  // it would on a solid mesh - it mangles the card's internal layout into degenerate slivers,
  // since the simplifier is "successfully" preserving a shape that isn't the one that's actually
  // visible. These defaults are conservative enough to avoid that (mostly cleaning up truly
  // redundant coplanar subdivisions on trunks/rocks); the real size win now comes from meshopt
  // compression instead of destructive simplification (see --compress below).
  const simplifyRatio = options.simplifyRatio ?? 0.6;
  const simplifyError = options.simplifyError ?? 0.005;
  const textureSize = options.textureSize ?? 1024;
  // GitHub hard-rejects any pushed file over 100MB - a decimation pass that still clears that
  // bar hasn't just under-performed, it has produced something that can never be committed.
  // 90MB leaves headroom before that wall rather than cutting it exactly at 100.
  const maxOutputBytes = options.maxOutputBytes ?? 90_000_000;
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
      // meshopt (not quantize) as the primary size lever: it re-encodes the vertex/index
      // buffers into a far more compact form WITHOUT changing the actual geometry, unlike
      // simplification, which is destructive and - per the comment above - actively unsafe on
      // alpha-cutout foliage. Requires a decoder wired into the loader; see
      // src/lib/plantModelLoader.ts's `loader.setMeshoptDecoder(MeshoptDecoder)`.
      //
      // --texture-compress is deliberately "auto" (resize + recompress in the SOURCE format),
      // not "webp": a real run produced foliage that rendered pitch black, with the browser
      // console repeating "Texture marked for update but no image data found" - the embedded
      // EXT_texture_webp images were failing to decode. "auto" keeps the original JPEG/PNG
      // encoding, which has no such extension-support risk, at the cost of a smaller size win.
      //
      // --palette and --instance are single-model no-ops (palette merges materials across
      // multiple assets, instancing needs repeated node references), so are turned off rather
      // than left to do unpredictable per-model material surgery.
      //
      // --prune-attributes is force-disabled: confirmed by reproducing it locally (a synthetic
      // glTF with two UV channels, one bound to a KHR_texture_transform, put through `optimize`
      // with and without this flag) that its default "unused attribute" detection doesn't
      // recognize a UV channel referenced only via a material extension's texCoord index - it
      // silently drops TEXCOORD_1 as "unused". Poly Haven's foliage materials bind exactly that:
      // KHR_texture_transform on TEXCOORD_1, offsetting each leaf into a different region of one
      // shared atlas texture. Losing that channel is why decimated foliage rendered as a
      // black/mangled mess even after the mesh-simplification and texture-format fixes - every
      // leaf was sampling whatever coordinate the now-missing channel happened to fall back to.
      let ratio = simplifyRatio, error = simplifyError, texSize = textureSize, decimatedBytes = Infinity;
      // Some assets (dense foliage especially) don't hit the byte target even at the requested
      // aggressiveness - rather than silently ship whatever came out, escalate a few times
      // before giving up and flagging it. Texture size is escalated hardest since it carries no
      // simplification risk; the simplify ratio is only nudged down mildly and floored well
      // short of the wireframe-destroying territory a full halving-per-attempt reached before.
      for (let attempt = 0; attempt < 4; attempt++) {
        await execFileAsync(process.execPath, [
          cliPath, 'optimize', inputGltf, outputGlb,
          '--compress', 'meshopt',
          '--texture-compress', 'auto',
          '--texture-size', String(texSize),
          '--simplify-ratio', String(ratio),
          '--simplify-error', String(error),
          '--palette', 'false',
          '--instance', 'false',
          '--prune-attributes', 'false',
        ], { maxBuffer: 1024 * 1024 * 64 });
        decimatedBytes = (await stat(outputGlb)).size;
        if (decimatedBytes <= maxOutputBytes) break;
        const nextRatio = Math.max(0.35, ratio * 0.85), nextTexSize = Math.max(512, texSize / 2);
        if (nextRatio === ratio && nextTexSize === texSize) break; // no more room to escalate
        console.log(`  ${(decimatedBytes / 1_000_000).toFixed(1)}MB still over the ${(maxOutputBytes / 1_000_000).toFixed(0)}MB target - retrying more aggressively (ratio ${nextRatio}, texture ${nextTexSize})`);
        ratio = nextRatio; texSize = nextTexSize;
      }
      if (decimatedBytes > maxOutputBytes) {
        console.log(`  WARNING: ${slug} is still ${(decimatedBytes / 1_000_000).toFixed(1)}MB after maximum escalation - this will be rejected by a git push over GitHub's 100MB limit.`);
      }
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
