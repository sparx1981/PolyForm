// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../../../api/overpass';
import { OverpassError, raceOverpass } from './overpassRace';

const query = '[out:json][timeout:25];(way["building"](51.5,-0.12,51.501,-0.119););out geom;';
const ask = (q = query) => handler(new Request(`https://app.example/api/overpass?data=${encodeURIComponent(q)}`));
const answer = '{"elements":[{"type":"way","id":1}]}';
const servers = ['https://a.example/api', 'https://b.example/api', 'https://c.example/api'];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

afterEach(() => vi.unstubAllGlobals());

describe('racing the Overpass servers', () => {
  it('takes the first real answer and doesn\'t wait on a hung server', async () => {
    const asked: string[] = [];
    const aborted: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const host = new URL(url).host;
      asked.push(host);
      if (host === 'a.example') {
        // Hangs until cancelled.
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => { aborted.push(host); reject(new Error('aborted')); }));
      }
      return new Response(answer);
    }) as unknown as typeof fetch;
    const started = Date.now();
    expect(await raceOverpass(query, { servers, stagger: 30, deadline: 2000, fetch: fetchImpl })).toBe(answer);
    expect(Date.now() - started).toBeLessThan(500);
    expect(asked).toEqual(['a.example', 'b.example']);
    await wait(80);
    expect(asked).toEqual(['a.example', 'b.example']); // c never asked
    expect(aborted).toEqual(['a.example']);
  });

  it('skips busy servers that answer with an error page', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes('c.example') ? new Response(answer) : new Response('<html>busy</html>', { status: 504 }))) as unknown as typeof fetch;
    expect(await raceOverpass(query, { servers, stagger: 5, deadline: 2000, fetch: fetchImpl })).toBe(answer);
  });

  it('asks them all again after a pause when every server was busy', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => (++calls > 3 ? new Response(answer) : new Response('rate limited', { status: 429 }))) as unknown as typeof fetch;
    expect(await raceOverpass(query, { servers, stagger: 5, retryPause: 50, deadline: 2000, fetch: fetchImpl })).toBe(answer);
    expect(calls).toBe(4);
  });

  it('gives up with every server\'s reason, or at the deadline', async () => {
    const busy = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const err = await raceOverpass(query, { servers, stagger: 5, deadline: 2000, fetch: busy }).catch(e => e);
    expect(err).toBeInstanceOf(OverpassError);
    expect(err.details).toHaveLength(3);
    const hang = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const started = Date.now();
    await expect(raceOverpass(query, { servers, stagger: 5, deadline: 100, fetch: hang })).rejects.toBeInstanceOf(OverpassError);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('OpenStreetMap relay', () => {
  it('returns a cacheable answer the browser may read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(answer)));
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ elements: [{ type: 'way', id: 1 }] });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toContain('s-maxage');
  });

  it('only relays building queries', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect((await ask('[out:json];node(1,2,3,4);out;')).status).toBe(400);
    expect((await ask('<osm-script/>')).status).toBe(400);
  });
});
