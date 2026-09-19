import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { ImporterConfig, IngestPlan, SourceMapChoice } from './types';
import { mapConcurrent } from './api';

async function digestFile(path: string, algorithm: 'md5' | 'sha256'): Promise<string> {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(path), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } }), new Transform({ transform(_chunk, _encoding, callback) { callback(); } }));
  return hash.digest('hex');
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function downloadChoice(config: ImporterConfig, release: string, assetId: string, choice: SourceMapChoice): Promise<{ path: string; sha256: string; byteLength: number }> {
  if (!choice.leaf?.url) throw new Error(`No URL for ${assetId}/${choice.sourceKey}`);
  const url = new URL(choice.leaf.url);
  if (url.protocol !== 'https:' || !config.allowedDownloadHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error(`Download host is not allowed: ${url.hostname}`);
  }
  const directory = join(config.workDirectory, 'releases', release, 'source', assetId);
  await mkdir(directory, { recursive: true });
  const suffix = basename(url.pathname).replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalPath = join(directory, `${choice.sourceKey}__${choice.resolution ?? 'native'}__${suffix}`);
  const metaPath = `${finalPath}.json`;
  if (await exists(finalPath) && await exists(metaPath)) {
    const metadata = JSON.parse(await readFile(metaPath, 'utf8')) as { sha256: string; byteLength: number };
    if ((await stat(finalPath)).size === metadata.byteLength && await digestFile(finalPath, 'sha256') === metadata.sha256) return { path: finalPath, ...metadata };
  }
  const partPath = `${finalPath}.part`;
  const userAgent = config.operatorContact && !config.userAgent.includes(config.operatorContact)
    ? `${config.userAgent} ${config.operatorContact}` : config.userAgent;
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
    try {
      const partExists = await exists(partPath);
      const offset = partExists ? (await stat(partPath)).size : 0;
      if (offset === 0 && partExists) await rm(partPath, { force: true });
      const response = await fetch(url, { headers: { 'User-Agent': userAgent, ...(offset ? { Range: `bytes=${offset}-` } : {}) } });
      if (!response.ok || !response.body) throw new Error(`Download failed ${response.status}: ${url}`);
      const append = offset > 0 && response.status === 206;
      if (offset > 0 && !append) await rm(partPath, { force: true });
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partPath, { flags: append ? 'a' : 'wx' }));
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < config.maxRetries) await new Promise(resolve => setTimeout(resolve, attempt * 2_000));
    }
  }
  if (lastError) throw lastError;
  const fileStat = await stat(partPath);
  if (choice.leaf.size !== undefined && fileStat.size !== choice.leaf.size) throw new Error(`Size mismatch for ${assetId}/${choice.sourceKey}`);
  if (choice.leaf.md5 && await digestFile(partPath, 'md5') !== choice.leaf.md5.toLowerCase()) throw new Error(`MD5 mismatch for ${assetId}/${choice.sourceKey}`);
  const sha256 = await digestFile(partPath, 'sha256');
  await rename(partPath, finalPath);
  const metadata = { path: finalPath, sha256, byteLength: fileStat.size };
  await writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

export async function ingestPlan(config: ImporterConfig, plan: IngestPlan): Promise<void> {
  const jobs = plan.assets.flatMap(asset => asset.choices.filter(choice => choice.status === 'selected').map(choice => ({ asset, choice })));
  await mapConcurrent(jobs, config.downloadConcurrency, job => downloadChoice(config, plan.release, job.asset.id, job.choice));
}
