#!/usr/bin/env node
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { discover, readSnapshot } from './discover';
import { createPlan } from './plan';
import { ingestPlan } from './download';
import { validateRelease } from './validate';
import { publishRelease } from './publish';
import { convertRelease } from './convert';
import type { ImporterConfig, IngestPlan } from './types';

function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const configPath = resolve(option(args, '--config') ?? 'config/polyhaven.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as ImporterConfig;
  const release = option(args, '--release');
  if (command === 'discover') { const snapshot = await discover(config, release); console.log(`Discovered ${Object.keys(snapshot.records).length} assets in ${snapshot.release}`); return; }
  if (command === 'plan') {
    if (!release) throw new Error('--release is required');
    const out = resolve(option(args, '--out') ?? join(config.workDirectory, 'releases', release, 'plan.json'));
    await mkdir(dirname(out), { recursive: true });
    const manifestPath = option(args, '--manifest');
    let selectedIds: Set<string> | undefined;
    if (manifestPath) {
      const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')) as { release: string; materials: string[]; hdris: string[] };
      if (manifest.release !== release) throw new Error(`Manifest release ${manifest.release} does not match ${release}`);
      selectedIds = new Set([...manifest.materials, ...manifest.hdris]);
    }
    const plan = await createPlan(config, await readSnapshot(config, release), out, selectedIds);
    const canonical = resolve(config.workDirectory, 'releases', release, 'plan.json');
    if (out !== canonical) await copyFile(out, canonical);
    console.log(JSON.stringify(plan.totals, null, 2)); return;
  }
  if (command === 'ingest') { const planPath = option(args, '--plan'); if (!planPath) throw new Error('--plan is required'); await ingestPlan(config, JSON.parse(await readFile(resolve(planPath), 'utf8')) as IngestPlan); return; }
  if (command === 'convert') { if (!release) throw new Error('--release is required'); console.log(JSON.stringify(await convertRelease(config, release), null, 2)); return; }
  if (command === 'validate') { if (!release) throw new Error('--release is required'); const report = await validateRelease(config, release); console.log(JSON.stringify(report, null, 2)); if (!report.valid) process.exitCode = 1; return; }
  if (command === 'publish') { if (!release) throw new Error('--release is required'); await publishRelease(config, release, args.includes('--dry-run')); return; }
  throw new Error('Usage: discover | plan --release ID [--manifest FILE] [--out FILE] | ingest --plan FILE --resume | convert --release ID | validate --release ID | publish --release ID [--dry-run]');
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
