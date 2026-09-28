// A relay for OpenStreetMap's Overpass API. The public servers are often busy, and a busy one
// answers without the CORS header browsers need, so the app can't even see the error. From here
// the servers are raced (see raceOverpass), well inside Vercel's time limit, and the answer is
// cached (buildings change slowly), so the same site imported again comes straight from the cache.
import { OverpassError, raceOverpass } from '../src/lib/worldSite/overpassRace';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const query = new URL(req.url).searchParams.get('data') ?? '';
  // Only the kind of query the app makes: JSON, buildings, bounded, small.
  if (!query.startsWith('[out:json]') || !query.includes('"building"') || query.length > 2000) {
    return new Response('Bad query', { status: 400 });
  }
  try {
    const text = await raceOverpass(query, {
      deadline: 22000,
      headers: { 'User-Agent': 'PolyForm WorldView (+https://polyform-alpha.vercel.app)' },
    });
    return new Response(text, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600, s-maxage=604800',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'All OpenStreetMap servers are busy', details: err instanceof OverpassError ? err.details : [String(err)] }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
