// A relay for OpenStreetMap's Overpass API: the public servers are often busy, and a busy one
// answers without the CORS header browsers need, so the app can't even see the error to try the
// next one. From here each server is tried in turn, and the answer is cached (buildings change
// slowly), so the same site imported again comes straight from the cache.
export const config = { runtime: 'edge' };

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export default async function handler(req: Request): Promise<Response> {
  const query = new URL(req.url).searchParams.get('data') ?? '';
  // Only the kind of query the app makes: JSON, buildings, bounded, small.
  if (!query.startsWith('[out:json]') || !query.includes('"building"') || query.length > 2000) {
    return new Response('Bad query', { status: 400 });
  }
  const errors: string[] = [];
  for (const server of SERVERS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`${server}?data=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'PolyForm WorldView (+https://polyform-alpha.vercel.app)' },
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith('{') && text.includes('"elements"')) {
        return new Response(text, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600, s-maxage=604800',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      errors.push(`${new URL(server).host}: HTTP ${res.status}`);
    } catch (err) {
      errors.push(`${new URL(server).host}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return new Response(JSON.stringify({ error: 'All OpenStreetMap servers are busy', details: errors }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
