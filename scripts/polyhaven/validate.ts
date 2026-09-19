import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { ImporterConfig, IngestPlan, SourceMapChoice } from './types';
import { runTool } from './convert';

export interface ValidationReport {
  release: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  assets: number;
  sourceFiles: number;
  derivativeFiles: number;
  sourceBytes: number;
  derivativeBytes: number;
}

interface ManifestVariant {
  url: string;
  fallbackUrl?: string;
  fallbackSha256?: string;
  fallbackByteLength?: number;
  sha256: string;
  byteLength: number;
  width: number;
  height: number;
  format: string;
  encoding: string;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function digest(path: string, algorithm: 'md5' | 'sha256'): Promise<string> {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function sourcePath(directory: string, assetId: string, choice: SourceMapChoice): string {
  if (!choice.leaf?.url) return '';
  return join(directory, 'source', assetId, `${choice.sourceKey}__${choice.resolution ?? 'native'}__${basename(new URL(choice.leaf.url).pathname)}`);
}

function localDerivative(outputDir: string, release: string, url: string): string {
  const prefix = `/polyhaven/releases/${release}/`;
  if (!url.startsWith(prefix)) throw new Error(`Derivative URL escapes release: ${url}`);
  return join(outputDir, url.slice(prefix.length));
}

export async function validateRelease(config: ImporterConfig, release: string): Promise<ValidationReport> {
  const directory = resolve(config.workDirectory, 'releases', release);
  const outputDir = join(directory, 'output');
  const errors: string[] = [];
  const warnings: string[] = [];
  const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8')) as IngestPlan;
  let sourceFiles = 0;
  let sourceBytes = 0;
  for (const asset of plan.assets) {
    for (const choice of asset.choices) {
      if (choice.status === 'unresolved-map') errors.push(`${asset.id}: unresolved source map ${choice.sourceKey}`);
      if (choice.status !== 'selected' || !choice.leaf?.url) continue;
      const path = sourcePath(directory, asset.id, choice);
      const metadataPath = `${path}.json`;
      if (!await exists(path)) { errors.push(`${asset.id}: source absent ${choice.sourceKey}`); continue; }
      if (!await exists(metadataPath)) { errors.push(`${asset.id}: source metadata absent ${choice.sourceKey}`); continue; }
      const file = await stat(path);
      sourceFiles += 1;
      sourceBytes += file.size;
      if (choice.leaf.size !== undefined && file.size !== choice.leaf.size) errors.push(`${asset.id}: byte size mismatch ${choice.sourceKey}`);
      if (choice.leaf.md5 && await digest(path, 'md5') !== choice.leaf.md5.toLowerCase()) errors.push(`${asset.id}: MD5 mismatch ${choice.sourceKey}`);
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as { sha256: string; byteLength: number };
      if (metadata.byteLength !== file.size || await digest(path, 'sha256') !== metadata.sha256) errors.push(`${asset.id}: local SHA-256 mismatch ${choice.sourceKey}`);
    }
  }

  const catalogPath = join(outputDir, 'catalog.v1.json');
  if (!await exists(catalogPath)) errors.push('Converted catalog is absent');
  const catalog = await exists(catalogPath)
    ? JSON.parse(await readFile(catalogPath, 'utf8')) as { release: string; assets: Array<{ id: string; sourceId: string; manifestUrl: string; thumbnailUrl: string; availableTiers: string[] }> }
    : { release, assets: [] };
  if (catalog.release !== release) errors.push(`Catalog release mismatch: ${catalog.release}`);
  if (catalog.assets.length !== plan.assets.length) errors.push(`Catalog has ${catalog.assets.length} assets; plan has ${plan.assets.length}`);

  const oiio = resolve(config.tools.oiiotoolPath ?? 'oiiotool');
  const ktx2check = join(dirname(resolve(config.tools.toktxPath ?? 'toktx')), 'ktx2check.exe');
  const checked = new Set<string>();
  for (const summary of catalog.assets) {
    try {
      const thumbnail = localDerivative(outputDir, release, summary.thumbnailUrl);
      if (!await exists(thumbnail)) errors.push(`${summary.sourceId}: thumbnail absent`);
      else checked.add(thumbnail);
      const manifestPath = localDerivative(outputDir, release, summary.manifestUrl);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        asset: { id: string };
        tiers: Record<string, Record<string, ManifestVariant>>;
        coverage: Array<{ sourceKey: string; status: string }>;
      };
      if (manifest.asset.id !== summary.id) errors.push(`${summary.sourceId}: manifest identity mismatch`);
      if (manifest.coverage.some(item => item.status === 'unsupported-blocking')) errors.push(`${summary.sourceId}: blocking map coverage remains`);
      const plannedKeys = new Set(plan.assets.find(asset => asset.id === summary.sourceId)?.choices.map(choice => choice.sourceKey) ?? []);
      for (const item of manifest.coverage) plannedKeys.delete(item.sourceKey);
      if (plannedKeys.size) errors.push(`${summary.sourceId}: manifest omits source keys ${[...plannedKeys].join(', ')}`);
      for (const tier of summary.availableTiers) {
        const maps = manifest.tiers[tier];
        if (!maps || Object.keys(maps).length === 0) errors.push(`${summary.sourceId}: empty tier ${tier}`);
        for (const [semantic, derivative] of Object.entries(maps ?? {})) {
          const path = localDerivative(outputDir, release, derivative.url);
          if (!await exists(path)) { errors.push(`${summary.sourceId}/${tier}/${semantic}: derivative absent`); continue; }
          const file = await stat(path);
          checked.add(path);
          if (file.size !== derivative.byteLength) errors.push(`${summary.sourceId}/${tier}/${semantic}: byte size mismatch`);
          if (await digest(path, 'sha256') !== derivative.sha256) errors.push(`${summary.sourceId}/${tier}/${semantic}: SHA-256 mismatch`);
          const expected = tier === '1k' ? 1024 : tier === '2k' ? 2048 : 4096;
          if (derivative.width !== expected || derivative.height !== (summary.id.startsWith('ph:hdri:') ? expected / 2 : expected)) errors.push(`${summary.sourceId}/${tier}/${semantic}: dimensions mismatch`);
          if (semantic === 'basecolor' && derivative.encoding !== 'srgb') errors.push(`${summary.sourceId}/${tier}: basecolor is not sRGB`);
          if (semantic !== 'basecolor' && derivative.encoding === 'srgb') errors.push(`${summary.sourceId}/${tier}/${semantic}: data map marked sRGB`);
          if (derivative.fallbackUrl) {
            const fallback = localDerivative(outputDir, release, derivative.fallbackUrl);
            if (!await exists(fallback)) errors.push(`${summary.sourceId}/${tier}/${semantic}: fallback absent`);
            else {
              checked.add(fallback);
              if (derivative.fallbackByteLength !== (await stat(fallback)).size || !derivative.fallbackSha256 || await digest(fallback, 'sha256') !== derivative.fallbackSha256) errors.push(`${summary.sourceId}/${tier}/${semantic}: fallback integrity mismatch`);
            }
          }
        }
      }
    } catch (error) {
      errors.push(`${summary.sourceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const path of checked) {
    try {
      if (path.endsWith('.ktx2')) await runTool(ktx2check, [path]);
      else await runTool(oiio, ['--info', path]);
    } catch (error) {
      errors.push(`Decoder rejected ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const derivativeFiles: string[] = [];
  async function inventory(path: string): Promise<void> {
    if (!await exists(path)) return;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await inventory(child); else derivativeFiles.push(child);
    }
  }
  await inventory(outputDir);
  let derivativeBytes = 0;
  for (const path of derivativeFiles) derivativeBytes += (await stat(path)).size;
  const report: ValidationReport = { release, valid: errors.length === 0, errors, warnings, assets: plan.assets.length, sourceFiles, derivativeFiles: derivativeFiles.length, sourceBytes, derivativeBytes };
  await writeFile(join(directory, 'validation.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
