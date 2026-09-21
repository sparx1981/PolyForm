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
function optionAll(args: string[], name: string): string[] { return args.flatMap((arg, i) => arg === name && args[i + 1] ? [args[i + 1]!] : []); }

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
    const categories = optionAll(args, '--category').map(c => c.toLowerCase());
    let selectedIds: Set<string> | undefined;
    const snapshot = await readSnapshot(config, release);
    if (manifestPath || categories.length) {
      selectedIds = new Set<string>();
      if (manifestPath) {
        const manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')) as { release: string; materials: string[]; hdris: string[] };
        if (manifest.release !== release) throw new Error(`Manifest release ${manifest.release} does not match ${release}`);
        for (const id of [...manifest.materials, ...manifest.hdris]) selectedIds.add(id);
      }
      if (categories.length) {
        // Poly Haven's own category slugs (e.g. "brick-block", "ground-terrain") as shown
        // in a texture/HDRI's info.categories - the same slugs that appear in its URL under
        // https://polyhaven.com/categories/textures. Matches any asset carrying ANY of the
        // given categories, so multiple --category flags accumulate rather than intersect.
        // Combines (union) with --manifest rather than replacing it, so a release can mix
        // "everything in these categories" with a hand-picked list of specific named assets.
        let categoryMatches = 0;
        for (const [id, record] of Object.entries(snapshot.records)) {
          const assetCategories = Array.isArray((record.info as { categories?: unknown })?.categories)
            ? ((record.info as { categories: unknown[] }).categories.map(c => String(c).toLowerCase()))
            : [];
          // HDRIs are only ever discovered under one of the three configured environmentRoots
          // groups (see discover.ts) - matching on that too covers the case where an HDRI's own
          // info.categories doesn't happen to repeat its taxonomy root slug.
          const matches = (record.environmentGroup && categories.includes(record.environmentGroup.toLowerCase()))
            || categories.some(c => assetCategories.includes(c));
          if (matches) { selectedIds.add(id); categoryMatches++; }
        }
        if (categoryMatches === 0) throw new Error(`No discovered assets matched category: ${categories.join(', ')}`);
      }
    }
    const plan = await createPlan(config, snapshot, out, selectedIds);
    const canonical = resolve(config.workDirectory, 'releases', release, 'plan.json');
    if (out !== canonical) await copyFile(out, canonical);
    console.log(JSON.stringify(plan.totals, null, 2)); return;
  }
  if (command === 'ingest') { const planPath = option(args, '--plan'); if (!planPath) throw new Error('--plan is required'); await ingestPlan(config, JSON.parse(await readFile(resolve(planPath), 'utf8')) as IngestPlan); return; }
  if (command === 'convert') { if (!release) throw new Error('--release is required'); console.log(JSON.stringify(await convertRelease(config, release), null, 2)); return; }
  if (command === 'validate') { if (!release) throw new Error('--release is required'); const report = await validateRelease(config, release); console.log(JSON.stringify(report, null, 2)); if (!report.valid) process.exitCode = 1; return; }
  if (command === 'publish') { if (!release) throw new Error('--release is required'); await publishRelease(config, release, args.includes('--dry-run')); return; }
  throw new Error('Usage: discover | plan --release ID [--manifest FILE] [--category SLUG ...] [--out FILE] | ingest --plan FILE --resume | convert --release ID | validate --release ID | publish --release ID [--dry-run]');
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
