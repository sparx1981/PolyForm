import { writeFile } from 'node:fs/promises';
import type { ImporterConfig, IngestPlan, ReleaseSnapshot } from './types';
import { normalizeFileInventory } from './normalize';

export async function createPlan(config: ImporterConfig, snapshot: ReleaseSnapshot, output: string, selectedIds?: ReadonlySet<string>): Promise<IngestPlan> {
  if (selectedIds) {
    const missing = [...selectedIds].filter(id => !snapshot.records[id]);
    if (missing.length) throw new Error(`Release manifest references unknown assets: ${missing.join(', ')}`);
  }
  const assets = Object.entries(snapshot.records).filter(([id]) => !selectedIds || selectedIds.has(id)).map(([id, record]) => {
    const choices = normalizeFileInventory(record.files, config.sourceCeiling);
    const selected = choices.filter(choice => choice.status === 'selected');
    return { id, kind: record.kind, choices, estimatedBytes: selected.reduce((sum, choice) => sum + (choice.leaf?.size ?? 0), 0) };
  });
  const plan: IngestPlan = {
    schemaVersion: 1, release: snapshot.release, generatedAt: new Date().toISOString(), sourceCeiling: config.sourceCeiling, assets,
    totals: {
      assets: assets.length,
      files: assets.reduce((sum, asset) => sum + asset.choices.filter(choice => choice.status === 'selected').length, 0),
      estimatedBytes: assets.reduce((sum, asset) => sum + asset.estimatedBytes, 0),
      blocking: assets.reduce((sum, asset) => sum + asset.choices.filter(choice => choice.status === 'unresolved-map').length, 0),
    },
  };
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}
