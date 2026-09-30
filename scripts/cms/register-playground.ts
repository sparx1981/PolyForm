// Adds the Developers page playground's text and example scripts to the CMS catalog (idempotent).
// Run after changing src/lib/playground/examples.ts:  npx tsx scripts/cms/register-playground.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { copyKey } from '../../src/components/cms/model';
import { PLAYGROUND_EXAMPLES, PLAYGROUND_TEXT } from '../../src/lib/playground/examples';

const path = 'src/components/cms/catalog.json';
const catalog = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { value: string; groups: string[] }>;
const values = [
  ...Object.values(PLAYGROUND_TEXT),
  ...PLAYGROUND_EXAMPLES.flatMap(e => [e.title, e.text, e.code]),
];
let added = 0;
for (const value of values) {
  const key = copyKey(value);
  if (catalog[key] && catalog[key]!.value !== value) throw new Error(`Hash collision for ${key}`);
  if (!catalog[key]) { catalog[key] = { value, groups: ['Developers'] }; added++; }
  else if (!catalog[key]!.groups.includes('Developers')) catalog[key]!.groups.push('Developers');
}
writeFileSync(path, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Registered ${values.length} strings (${added} new).`);
