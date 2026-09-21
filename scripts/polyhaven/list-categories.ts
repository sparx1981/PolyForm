#!/usr/bin/env node
// Diagnostic: prints every distinct value found in each discovered asset's
// info.categories, plus a count of how many assets carry it. Run this against
// a release's discovery.json when a `plan --category` filter comes back with
// no matches, to see the real category vocabulary Poly Haven's API returns
// (which may not be the same as the hyphenated slug shown in its URLs).
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
  const releaseArgIndex = process.argv.indexOf('--release');
  const release = releaseArgIndex >= 0 ? process.argv[releaseArgIndex + 1] : undefined;
  if (!release) throw new Error('Usage: list-categories --release ID [--config FILE]');
  const configArgIndex = process.argv.indexOf('--config');
  const configPath = resolve(configArgIndex >= 0 ? process.argv[configArgIndex + 1]! : 'config/polyhaven.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as { workDirectory: string };
  const snapshotPath = resolve(config.workDirectory, 'releases', release, 'discovery.json');
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as {
    records: Record<string, { info: unknown; kind: 'material' | 'hdri' }>;
  };
  const counts = new Map<string, number>();
  for (const record of Object.values(snapshot.records)) {
    const categories = (record.info as { categories?: unknown })?.categories;
    if (!Array.isArray(categories)) continue;
    for (const raw of categories) {
      const key = String(raw);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [category, count] of sorted) console.log(`${count}\t${category}`);
  console.log(`\n${sorted.length} distinct category values across ${Object.keys(snapshot.records).length} assets`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
