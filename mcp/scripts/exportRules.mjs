// Writes RULES.md: bundles scripts/exportRules.ts the way the server is bundled (so the app's own code
// resolves one copy of three.js), then runs it. Usage: npm run rules:export
import { build } from 'esbuild';
import { join } from 'node:path';
import { serverBuildOptions } from '../build.mjs';

const MCP = join(import.meta.dirname, '..');
const out = join(MCP, '.dev/exportRules.mjs');
await build({ ...serverBuildOptions, entryPoints: [join(MCP, 'scripts/exportRules.ts')], outfile: out });
await import(out);
