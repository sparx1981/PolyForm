// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../../api/overpass';

const query = '[out:json][timeout:25];(way["building"](51.5,-0.12,51.501,-0.119););out geom;';
const ask = (q = query) => handler(new Request(`https://app.example/api/overpass?data=${encodeURIComponent(q)}`));

afterEach(() => vi.unstubAllGlobals());

describe('OpenStreetMap relay', () => {
  it('tries the next server when one is busy, and returns a cacheable answer', async () => {
    const hosts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      hosts.push(new URL(url).host);
      return hosts.length === 1
        ? new Response('<html>Too busy</html>', { status: 504 })
        : new Response('{"elements":[{"type":"way","id":1}]}', { status: 200 });
    }));
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ elements: [{ type: 'way', id: 1 }] });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toContain('s-maxage');
    expect(hosts).toEqual(['overpass-api.de', 'overpass.private.coffee']);
  });

  it('says so when every server is busy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    const res = await ask();
    expect(res.status).toBe(503);
    expect((await res.json()).details).toHaveLength(4);
  });

  it('only relays building queries', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await ask('[out:json];node(1,2,3,4);out;')).status).toBe(400);
    expect((await ask('<osm-script/>')).status).toBe(400);
  });
});
