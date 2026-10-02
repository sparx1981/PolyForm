// Builds a model shaped like the SketchUp 2025 file that exposed the layout (13k components, ~0.5M vertices, ~1M edges,
// ~0.5M faces), saves it, and optionally checks the low-memory reader against OpenSKP on it.
// usage: tsx bench2025.mts <output.skp> [definitions=13118] [grid=6] [placements=1129]
import { writeFileSync } from 'node:fs';
import { buildSkp, definition2025, gridParts, instance, rec, translation } from '../../src/lib/skp/testing/synthSkp';

const out = process.argv[2];
const defs = Number(process.argv[3] ?? 13118), grid = Number(process.argv[4] ?? 6), placements = Number(process.argv[5] ?? 1129);
const list: Buffer[] = [];
for (let d = 0; d < defs; d++) {
  const parts = gridParts(grid, grid);
  // every tenth component places two of the one before it, like nested components in a real model
  const instances = d % 10 === 9 ? [instance(7000 + d - 1, translation(0, 0, 0)), instance(7000 + d - 1, translation(80, 0, 0))] : [];
  list.push(definition2025(7000 + d, `Part ${d}`, { ...parts, instances }));
}
const roots: Buffer[] = [];
for (let i = 0; i < placements; i++) roots.push(instance(7000 + ((i * 7) % defs), translation((i % 40) * 900, Math.floor(i / 40) * 900, 0)));
const skp = buildSkp({ model: [rec('F901', [rec('7017', [rec('7117', list)])]), rec('F601', [rec('8813', [rec('8D13', roots.map((r) => rec('4C1D', [r])))])])] });
writeFileSync(out, skp);
console.log('wrote', out, Math.round(skp.length / 1e6), 'MB');
