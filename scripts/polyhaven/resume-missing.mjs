#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const release = process.argv[2];
if (!release) throw new Error('Usage: node resume-missing.mjs RELEASE');
const root = join('.polyhaven', 'releases', release);
const plan = JSON.parse(await readFile(join(root, 'plan.json'), 'utf8'));

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function digest(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function download(job) {
  const { asset, choice } = job;
  const url = new URL(choice.leaf.url);
  const suffix = basename(url.pathname).replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalPath = join(root, 'source', asset.id, `${choice.sourceKey}__${choice.resolution ?? 'native'}__${suffix}`);
  const metaPath = `${finalPath}.json`;
  if (await exists(finalPath) && await exists(metaPath)) return;
  await mkdir(dirname(finalPath), { recursive: true });
  const partPath = `${finalPath}.part`;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const partExists = await exists(partPath);
      const offset = partExists ? (await stat(partPath)).size : 0;
      if (offset === 0 && partExists) await rm(partPath, { force: true });
      const headers = { 'User-Agent': 'PolyformAssetImporter/1.0 craigtrickett@gmail.com', ...(offset ? { Range: `bytes=${offset}-` } : {}) };
      const response = await fetch(url, { headers });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const append = offset > 0 && response.status === 206;
      if (offset > 0 && !append) await rm(partPath, { force: true });
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partPath, { flags: append ? 'a' : 'wx' }));
      const fileStat = await stat(partPath);
      if (choice.leaf.size !== undefined && fileStat.size !== choice.leaf.size) throw new Error(`size ${fileStat.size} != ${choice.leaf.size}`);
      if (choice.leaf.md5 && await digest(partPath, 'md5') !== choice.leaf.md5.toLowerCase()) throw new Error('MD5 mismatch');
      const sha256 = await digest(partPath, 'sha256');
      await rename(partPath, finalPath);
      await writeFile(metaPath, `${JSON.stringify({ path: finalPath, sha256, byteLength: fileStat.size }, null, 2)}\n`);
      console.log(`Downloaded ${asset.id}/${choice.sourceKey}`);
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
}

const jobs = plan.assets.flatMap(asset => asset.choices
  .filter(choice => choice.status === 'selected' && choice.leaf?.url)
  .map(choice => ({ asset, choice })));
for (const job of jobs) await download(job);
