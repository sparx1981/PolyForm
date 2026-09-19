import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Mapping { legacyNamespace: string; legacyKey: string; targetAssetId?: string; targetRevision?: string; decision: 'replace' | 'retain' }

function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }

async function main() {
  const args = process.argv.slice(2);
  const projectPath = option(args, '--project');
  const mapPath = option(args, '--mapping') ?? 'config/polyhaven-legacy-map.v1.json';
  const reportPath = option(args, '--out') ?? 'polyhaven-migration-report.json';
  if (!projectPath) throw new Error('Usage: migrate-projects --project file.polyform [--mapping map.json] [--out report.json] [--write]');
  const project = JSON.parse(await readFile(resolve(projectPath), 'utf8')) as Record<string, unknown>;
  const map = JSON.parse(await readFile(resolve(mapPath), 'utf8')) as { mappings: Mapping[] };
  const bindings: Record<string, unknown> = project.materialBindings && typeof project.materialBindings === 'object' ? { ...project.materialBindings as object } : {};
  const counts = { mapped: 0, retained: 0, ambiguous: 0, broken: 0, missing: 0 };
  const shapes = Array.isArray(project.shapes) ? project.shapes.map((shape: unknown) => {
    if (!shape || typeof shape !== 'object') return shape;
    const copy = { ...shape as Record<string, unknown> };
    const preset = typeof copy.materialPreset === 'string' ? copy.materialPreset : undefined;
    if (!preset) return copy;
    const mapping = map.mappings.find(item => item.legacyNamespace === 'architectural' && item.legacyKey === preset);
    if (!mapping) { counts.missing += 1; return copy; }
    if (mapping.decision === 'retain') { counts.retained += 1; return copy; }
    if (!mapping.targetAssetId || !mapping.targetRevision) { counts.broken += 1; return copy; }
    const bindingId = `legacy:${preset}`;
    bindings[bindingId] = { ref: { assetId: mapping.targetAssetId, revision: mapping.targetRevision } };
    copy.materialBindingId = bindingId;
    counts.mapped += 1;
    return copy;
  }) : [];
  const migrated = { ...project, format: 'polyform', version: 3, assetSchemaVersion: 1, materialBindings: bindings, shapes };
  const report = { dryRun: !args.includes('--write'), project: resolve(projectPath), mappingVersion: 1, counts };
  await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
  if (args.includes('--write')) await writeFile(resolve(projectPath), `${JSON.stringify(migrated, null, 2)}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
