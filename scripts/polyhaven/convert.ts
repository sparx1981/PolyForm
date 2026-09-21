import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { ImporterConfig, IngestPlan, SourceMapChoice } from './types';

type Tier = '1k' | '2k' | '4k';
type Semantic = 'basecolor' | 'normal-gl' | 'orm' | 'height' | 'environment' | 'specular' | 'transmission';

interface Variant {
  url: string;
  fallbackUrl?: string;
  fallbackFormat?: 'webp' | 'png';
  fallbackSha256?: string;
  fallbackByteLength?: number;
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
  format: 'ktx2' | 'webp' | 'png' | 'exr' | 'hdr';
  encoding: 'srgb' | 'linear-color' | 'data';
  channels: Record<string, 'r' | 'g' | 'b' | 'a'>;
  sourceKeys: string[];
  uvChannel: number;
}

export function runTool(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function toolPath(config: ImporterConfig, key: 'toktx' | 'oiiotool'): string {
  const configured = key === 'toktx' ? config.tools.toktxPath : config.tools.oiiotoolPath;
  return configured ? resolve(configured) : key;
}

/** CI must install the pinned tools. Browser canvas is never used for conversion. */
export async function verifyConversionTools(config: ImporterConfig): Promise<void> {
  if (!config.tools.toktx || !config.tools.oiiotool) throw new Error('Pinned conversion tool versions are required');
  await runTool(toolPath(config, 'toktx'), ['--version']);
  await runTool(toolPath(config, 'oiiotool'), ['--version']);
}

function selected(asset: IngestPlan['assets'][number], semantic: string): SourceMapChoice | undefined {
  return asset.choices.find(choice => choice.status === 'selected' && choice.semantic === semantic && choice.leaf?.url);
}

function sourcePath(releaseDir: string, assetId: string, choice: SourceMapChoice): string {
  if (!choice.leaf?.url || !choice.resolution) throw new Error(`${assetId}/${choice.sourceKey} has no downloadable source`);
  return join(releaseDir, 'source', assetId, `${choice.sourceKey}__${choice.resolution}__${basename(new URL(choice.leaf.url).pathname)}`);
}

function tierPixels(tier: Tier, hdri: boolean): [number, number] {
  const width = tier === '1k' ? 1024 : tier === '2k' ? 2048 : 4096;
  return [width, hdri ? width / 2 : width];
}

function publicUrl(release: string, path: string): string {
  return `/polyhaven/releases/${release}/${path.replaceAll('\\', '/')}`;
}

async function makeVariant(path: string, url: string, width: number, height: number, format: Variant['format'], encoding: Variant['encoding'], sourceKey: string, channels: Variant['channels'], fallback?: { path: string; url: string; format: 'webp' | 'png' }): Promise<Variant> {
  const info = await stat(path);
  return {
    url,
    ...(fallback ? {
      fallbackUrl: fallback.url,
      fallbackFormat: fallback.format,
      fallbackSha256: await sha256(fallback.path),
      fallbackByteLength: (await stat(fallback.path)).size,
    } : {}),
    sha256: await sha256(path),
    byteLength: info.size,
    width,
    height,
    format,
    encoding,
    channels,
    sourceKeys: [sourceKey],
    uvChannel: 0,
  };
}

async function resize(oiio: string, input: string, output: string, width: number, height: number, extra: string[] = []): Promise<void> {
  if (await exists(output)) return;
  await mkdir(dirname(output), { recursive: true });
  await runTool(oiio, [input, '--resize', `${width}x${height}`, ...extra, '-o', output]);
}

async function compressKtx(toktx: string, input: string, output: string, mode: 'color' | 'normal' | 'data'): Promise<void> {
  if (await exists(output)) return;
  const common = ['--t2', '--genmipmap', '--threads', '4'];
  const encoding = mode === 'color'
    ? ['--encode', 'etc1s', '--clevel', '2', '--qlevel', '192', '--assign_oetf', 'srgb']
    : ['--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '9', '--assign_oetf', 'linear'];
  // Preserve RGB XYZ because THREE.MeshPhysicalMaterial consumes ordinary
  // tangent-space normal textures; normal_mode's two-channel swizzle requires
  // a custom shader decode that the editor intentionally does not use.
  const normal = mode === 'normal' ? ['--normalize'] : [];
  await runTool(toktx, [...common, ...encoding, ...normal, output, input]);
}

function titleFromId(id: string): string {
  return id.split(/[_-]/).map(word => word ? word[0].toUpperCase() + word.slice(1) : word).join(' ');
}

function parseTileMeters(info: Record<string, unknown>): [number, number] | undefined {
  const scale = typeof info.scale === 'string' ? info.scale.match(/^([0-9.]+)x([0-9.]+)$/) : null;
  return scale ? [Number(scale[1]), Number(scale[2])] : undefined;
}

export async function convertRelease(config: ImporterConfig, release: string): Promise<{ assets: number; files: number; bytes: number }> {
  await verifyConversionTools(config);
  const releaseDir = resolve(config.workDirectory, 'releases', release);
  const outputDir = join(releaseDir, 'output');
  const workDir = join(releaseDir, 'convert-work');
  const plan = JSON.parse(await readFile(join(releaseDir, 'plan.json'), 'utf8')) as IngestPlan;
  const snapshot = JSON.parse(await readFile(join(releaseDir, 'discovery.json'), 'utf8')) as { records: Record<string, { info: Record<string, unknown>; environmentGroup?: string }> };
  const oiio = toolPath(config, 'oiiotool');
  const toktx = toolPath(config, 'toktx');
  const summaries: Array<Record<string, unknown>> = [];

  for (const asset of plan.assets) {
    const record = snapshot.records[asset.id];
    const info = record?.info ?? {};
    const kindFolder = asset.kind === 'material' ? 'materials' : 'hdris';
    const relativeRoot = join('assets', kindFolder, asset.id);
    const assetOut = join(outputDir, relativeRoot);
    await mkdir(assetOut, { recursive: true });
    const tiers: Partial<Record<Tier, Partial<Record<Semantic, Variant>>>> = {};

    for (const tier of config.runtimeTiers) {
      const [width, height] = tierPixels(tier, asset.kind === 'hdri');
      const tierDir = join(assetOut, tier);
      await mkdir(tierDir, { recursive: true });
      const maps: Partial<Record<Semantic, Variant>> = {};

      if (asset.kind === 'hdri') {
        const environment = selected(asset, 'environment');
        if (!environment) throw new Error(`${asset.id}: no HDR environment source`);
        const input = sourcePath(releaseDir, asset.id, environment);
        const hdr = join(tierDir, 'environment.hdr');
        await resize(oiio, input, hdr, width, height);
        maps.environment = await makeVariant(hdr, publicUrl(release, join(relativeRoot, tier, 'environment.hdr')), width, height, 'hdr', 'linear-color', environment.sourceKey, { color: 'r' });
      } else {
        // No delivered PNG/WebP fallback: it doubled published storage (every map shipped
        // twice) for a case - a browser with no KTX2/WebGL2 support - rare enough that the
        // pilot library's total size matters more. The intermediate PNG below only feeds
        // toktx; it never leaves convert-work.
        const recipes: Array<{ semantic: 'basecolor' | 'normal-gl' | 'orm' | 'specular' | 'transmission'; mode: 'color' | 'normal' | 'data'; channels: Variant['channels'] }> = [
          { semantic: 'basecolor', mode: 'color', channels: { red: 'r', green: 'g', blue: 'b', alpha: 'a' } },
          { semantic: 'normal-gl', mode: 'normal', channels: { x: 'r', y: 'g', z: 'b' } },
          { semantic: 'orm', mode: 'data', channels: { ao: 'r', roughness: 'g', metalness: 'b' } },
          { semantic: 'specular', mode: 'data', channels: { specular: 'r' } },
          { semantic: 'transmission', mode: 'data', channels: { transmission: 'r' } },
        ];
        for (const recipe of recipes) {
          const choice = selected(asset, recipe.semantic);
          if (!choice) continue;
          const input = sourcePath(releaseDir, asset.id, choice);
          const intermediate = join(workDir, relativeRoot, tier, `${recipe.semantic}.png`);
          await resize(oiio, input, intermediate, width, height);
          const ktx = join(tierDir, `${recipe.semantic}.ktx2`);
          await compressKtx(toktx, intermediate, ktx, recipe.mode);
          maps[recipe.semantic] = await makeVariant(
            ktx,
            publicUrl(release, join(relativeRoot, tier, `${recipe.semantic}.ktx2`)),
            width,
            height,
            'ktx2',
            recipe.mode === 'color' ? 'srgb' : 'data',
            choice.sourceKey,
            recipe.channels,
          );
        }
        const heightChoice = selected(asset, 'height');
        if (heightChoice) {
          const input = sourcePath(releaseDir, asset.id, heightChoice);
          const exr = join(tierDir, 'height.exr');
          await resize(oiio, input, exr, width, height, ['-d', 'half']);
          maps.height = await makeVariant(exr, publicUrl(release, join(relativeRoot, tier, 'height.exr')), width, height, 'exr', 'data', heightChoice.sourceKey, { height: 'r' });
        }
      }
      tiers[tier] = maps;
    }

    const previewChoice = asset.kind === 'material' ? selected(asset, 'basecolor') : selected(asset, 'environment');
    if (!previewChoice) throw new Error(`${asset.id}: no source for preview`);
    const preview = join(assetOut, 'preview.webp');
    const previewExtra = asset.kind === 'hdri'
      ? ['--colorconvert', 'linear', 'sRGB', '--clamp', '-d', 'uint8', '--attrib', 'webp:quality', '82']
      : ['--attrib', 'webp:quality', '82'];
    await resize(oiio, sourcePath(releaseDir, asset.id, previewChoice), preview, 256, asset.kind === 'hdri' ? 128 : 256, previewExtra);

    const categoryPath = typeof info.category === 'string' ? info.category : (asset.kind === 'material' ? 'Materials' : 'Environments');
    const revision = release;
    const summary = {
      id: `ph:${asset.kind}:${asset.id}`,
      sourceId: asset.id,
      kind: asset.kind,
      name: typeof info.name === 'string' ? info.name : titleFromId(asset.id),
      source: 'polyhaven',
      license: 'CC0-1.0',
      revision,
      manifestUrl: publicUrl(release, join('manifests', `${asset.kind}-${asset.id}.json`)),
      thumbnailUrl: publicUrl(release, join(relativeRoot, 'preview.webp')),
      categoryId: typeof info.category_id === 'string' ? info.category_id : `${asset.kind}-uncategorized`,
      categoryPath,
      categorySlugPath: categoryPath.toLowerCase().replaceAll('&', 'and').replace(/[^a-z0-9/]+/g, '-'),
      ancestorCategoryIds: [],
      legacyCategories: Array.isArray(info.categories) ? info.categories : [],
      tags: Array.isArray(info.tags) ? info.tags : [],
      attributes: {
        ...(info.attributes && typeof info.attributes === 'object' ? info.attributes : {}),
        ...(typeof info.files_hash === 'string' ? { sourceFilesHash: info.files_hash } : {}),
      },
      ...(asset.kind === 'hdri' && record?.environmentGroup ? { environmentGroup: record.environmentGroup } : {}),
      availableTiers: config.runtimeTiers,
      ...(asset.kind === 'material' ? { hasHeight: Boolean(selected(asset, 'height')) } : {}),
    };
    summaries.push(summary);

    const coverage = asset.choices.map(choice => ({
      sourceKey: choice.sourceKey,
      status: choice.status === 'selected' && ['basecolor', 'normal-gl', 'orm', 'height', 'environment', 'specular', 'transmission'].includes(choice.semantic ?? '') ? 'converted' : 'alternative',
      ...(choice.semantic ? { semantic: choice.semantic } : {}),
      reason: choice.status === 'selected' ? 'Selected source accounted for by the deterministic pilot recipe.' : choice.reason,
    }));
    const tileMeters = parseTileMeters(info);
    const manifest = {
      schemaVersion: 1,
      asset: summary,
      tiers,
      scalarFallbacks: { color: '#ffffff', roughness: 1, metalness: 0, opacity: 1 },
      ...(asset.kind === 'material' && tileMeters ? { physicalTileMeters: tileMeters } : {}),
      ...(asset.kind === 'material' && selected(asset, 'height') ? { height: { scaleMeters: 0.05, biasMeters: 0, calibrated: false, provenance: 'Poly Haven displacement map; default pilot scale pending asset-specific calibration.' } } : {}),
      coverage,
      publication: { status: 'staged' },
    };
    const manifestPath = join(outputDir, 'manifests', `${asset.kind}-${asset.id}.json`);
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Converted ${asset.id}`);
  }

  await writeFile(join(outputDir, 'catalog.v1.json'), `${JSON.stringify({ schemaVersion: 1, release, generatedAt: new Date().toISOString(), assets: summaries }, null, 2)}\n`);
  const files: string[] = [];
  async function inventory(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inventory(path); else files.push(path);
    }
  }
  await inventory(outputDir);
  let bytes = 0;
  for (const file of files) bytes += (await stat(file)).size;
  await writeFile(join(releaseDir, 'conversion.json'), `${JSON.stringify({ release, assets: summaries.length, files: files.length, bytes, tools: config.tools }, null, 2)}\n`);
  return { assets: summaries.length, files: files.length, bytes };
}
