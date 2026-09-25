// Builds the connector for Vercel (Build Output API v3) into .vercel/output:
// one Node function that serves every path, plus the sign-in page script.
import { build } from 'esbuild';
import { nodeFileTrace } from '@vercel/nft';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP = dirname(fileURLToPath(import.meta.url));
const OUT = join(MCP, '.vercel/output');
const FUNC = join(OUT, 'functions/index.func');

/** Packages loaded at run time from node_modules rather than bundled (native binaries, dynamic requires). */
export const EXTERNAL = ['@sparticuz/chromium', 'playwright-core', 'firebase-admin'];

/**
 * Packages imported by the app's own files resolve from this package's node_modules (the only
 * install on Vercel), so there is one copy of three.js. The app imports three.js examples the
 * browser-bundler way, without the .js extension; add it.
 */
export const threePlugin = {
  name: 'polyform-packages',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, async args => {
      if (args.pluginData?.polyformResolved || EXTERNAL.some(p => args.path === p || args.path.startsWith(`${p}/`))) return undefined;
      const fromApp = args.importer && !args.importer.startsWith(MCP);
      const isThree = /^three(\/.*)?$/.test(args.path);
      if (!fromApp && !isThree) return undefined;
      let path = args.path;
      if (/^three\/examples\/jsm\/.+/.test(path) && !path.endsWith('.js')) path += '.js';
      return b.resolve(path, { kind: args.kind, resolveDir: MCP, pluginData: { polyformResolved: true } });
    });
  },
};

export const serverBuildOptions = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: EXTERNAL.flatMap(p => [p, `${p}/*`]),
  plugins: [threePlugin],
  nodePaths: [join(MCP, 'node_modules')],
  define: { __BUILD_COMMIT__: '"mcp"', __BUILD_TIME__: '"mcp"' },
  banner: { js: "import { createRequire as __pfRequire } from 'node:module'; const require = __pfRequire(import.meta.url);" },
  logLevel: 'warning',
};

export async function buildLoginScript(outfile) {
  await build({
    entryPoints: [join(MCP, 'src/loginClient.ts')],
    outfile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    nodePaths: [join(MCP, 'node_modules')],
    logLevel: 'warning',
  });
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(FUNC, { recursive: true });

  await build({ ...serverBuildOptions, entryPoints: [join(MCP, 'src/main.ts')], outfile: join(FUNC, 'index.mjs') });
  await buildLoginScript(join(FUNC, 'login.js'));

  // Copy the external packages and everything they load into the function.
  const probe = join(MCP, '.external-probe.mjs');
  await writeFile(probe, [
    "import '@sparticuz/chromium';",
    "import 'playwright-core';",
    "import 'firebase-admin/app';",
    "import 'firebase-admin/auth';",
    "import 'firebase-admin/firestore';",
  ].join('\n'));
  const { fileList } = await nodeFileTrace([probe], { base: MCP });
  await rm(probe);
  for (const file of fileList) {
    if (!file.startsWith('node_modules/')) continue;
    await mkdir(dirname(join(FUNC, file)), { recursive: true });
    await cp(join(MCP, file), join(FUNC, file), { dereference: true });
  }
  // Chromium's compressed browser is read from its bin folder by path, which tracing can miss.
  await cp(join(MCP, 'node_modules/@sparticuz/chromium'), join(FUNC, 'node_modules/@sparticuz/chromium'), { recursive: true });

  await writeFile(join(FUNC, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(FUNC, '.vc-config.json'), JSON.stringify({
    runtime: 'nodejs22.x',
    handler: 'index.mjs',
    launcherType: 'Nodejs',
    shouldAddHelpers: false,
    maxDuration: 120,
    memory: 2048,
  }, null, 2));
  await writeFile(join(OUT, 'config.json'), JSON.stringify({
    version: 3,
    routes: [{ src: '/(.*)', dest: '/index' }],
  }, null, 2));
  console.log(`Built ${relative(MCP, OUT)} (${fileList.size} traced files)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exit(1); });
}
