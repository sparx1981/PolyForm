import { decode } from 'fast-png';
import type { SiteIO } from '../../src/lib/worldSite/site';
import { decodeTerrariumPixels, terrariumTileUrl } from '../../src/lib/worldSite/terrain';

// The server's way of fetching a World View site's data (the app's is src/lib/worldSite/fetchSite.ts):
// the same free services, with the height tiles' PNGs decoded here rather than on a canvas.

const USER_AGENT = 'PolyForm-MCP/0.1 (+https://polyform-alpha.vercel.app)';

async function get(url: string, init: RequestInit = {}, ms = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** RGBA pixels of a PNG, whatever its channel layout. */
export function pngRgba(bytes: Uint8Array): Uint8Array {
  const png = decode(bytes);
  const ch = png.channels;
  const out = new Uint8Array(png.width * png.height * 4);
  for (let i = 0; i < png.width * png.height; i++) {
    out[i * 4] = Number(png.data[i * ch]);
    out[i * 4 + 1] = Number(png.data[i * ch + 1]);
    out[i * 4 + 2] = Number(png.data[i * ch + 2]);
    out[i * 4 + 3] = 255;
  }
  return out;
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export const nodeSiteIO: SiteIO = {
  heightTiles: tiles => Promise.all(tiles.map(async t => {
    const res = await get(terrariumTileUrl(t.z, t.x, t.y));
    return { ...t, heights: decodeTerrariumPixels(pngRgba(new Uint8Array(await res.arrayBuffer()))) };
  })),
  overpass: async query => {
    let last: unknown = null;
    for (const url of OVERPASS) {
      try {
        const res = await get(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` });
        return await res.json() as { elements?: unknown[] };
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error('map service unavailable');
  },
};
