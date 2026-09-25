import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

/** Turns SVG drawings into PNGs, with the font the plans are drawn in (no browser needed). */

let ready: Promise<Uint8Array> | null = null;

/** The font ships next to the server (assets/ in the build, mcp/assets/ in the source tree). */
async function loadFont(): Promise<Uint8Array> {
  for (const path of ['./assets/DejaVuSans.ttf', '../assets/DejaVuSans.ttf']) {
    try {
      return new Uint8Array(await readFile(new URL(path, import.meta.url)));
    } catch { /* try the next place */ }
  }
  throw new Error('The plan font (DejaVuSans.ttf) is missing from the build.');
}

function setup() {
  ready ??= (async () => {
    const wasm = await readFile(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'));
    await initWasm(wasm);
    return loadFont();
  })().catch(error => { ready = null; throw error; });
  return ready;
}

export async function svgToPng(svg: string): Promise<Buffer> {
  const font = await setup();
  const resvg = new Resvg(svg, { font: { fontBuffers: [font], defaultFontFamily: 'DejaVu Sans', loadSystemFonts: false } });
  const png = resvg.render().asPng();
  resvg.free();
  return Buffer.from(png);
}
