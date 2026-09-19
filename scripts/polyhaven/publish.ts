import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ImporterConfig } from './types';

export async function publishRelease(config: ImporterConfig, release: string, dryRun: boolean): Promise<void> {
  const releaseDir = resolve(config.workDirectory, 'releases', release);
  const validation = JSON.parse(await readFile(join(releaseDir, 'validation.json'), 'utf8')) as { valid: boolean };
  if (!validation.valid) throw new Error(`Release ${release} did not pass validation`);
  const outputDir = join(releaseDir, 'output');
  try { await access(outputDir); } catch { throw new Error(`Release ${release} has no converted output directory`); }
  const destination = resolve(config.publicDirectory, 'releases', release);
  if (dryRun) { console.log(JSON.stringify({ dryRun: true, release, source: releaseDir, destination }, null, 2)); return; }
  await mkdir(dirname(destination), { recursive: true });
  await cp(outputDir, destination, { recursive: true, errorOnExist: true, force: false });
  const catalogBytes = await readFile(join(outputDir, 'catalog.v1.json'));
  const catalogSha256 = createHash('sha256').update(catalogBytes).digest('hex');
  await writeFile(resolve(config.publicDirectory, 'catalog.v1.json'), catalogBytes);
  const pointerPath = resolve(config.publicDirectory, 'active-release.json');
  const temporaryPointer = `${pointerPath}.tmp`;
  await writeFile(temporaryPointer, `${JSON.stringify({
    schemaVersion: 1,
    activeRelease: release,
    catalogUrl: `/polyhaven/releases/${release}/catalog.v1.json`,
    catalogSha256,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  await rename(temporaryPointer, pointerPath);
}
