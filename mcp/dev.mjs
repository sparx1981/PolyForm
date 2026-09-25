// Runs the connector locally: builds it, then serves it on http://localhost:8787 using the same
// environment variables as Vercel (see README). CHROME_PATH points at a local Chromium for screenshots.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { buildLoginScript, serverBuildOptions } from './build.mjs';

const dir = join(import.meta.dirname, '.dev');
await build({ ...serverBuildOptions, entryPoints: [join(import.meta.dirname, 'src/main.ts')], outfile: join(dir, 'index.mjs') });
await buildLoginScript(join(dir, 'login.js'));
const { default: handler } = await import(join(dir, 'index.mjs'));
const port = Number(process.env.PORT ?? 8787);
createServer((req, res) => handler(req, res)).listen(port, () => console.log(`PolyForm connector on http://localhost:${port}/mcp`));
