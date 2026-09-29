// A relay for the national LiDAR services that don't let browsers read their answers (no CORS).
// Only those services' hosts are allowed (see src/lib/worldSite/lidar.ts), GET only, and the answer
// is passed back as it came, so this can't be used to fetch anything else.
export const config = { runtime: 'edge' };

const ALLOWED = new Set(['environment.data.gov.uk', 'service.pdok.nl', 'elevation.nationalmap.gov']);

export default async function handler(req: Request): Promise<Response> {
  const target = new URL(req.url).searchParams.get('url');
  let url: URL;
  try {
    url = new URL(target ?? '');
  } catch {
    return new Response('Missing or bad url', { status: 400 });
  }
  if (url.protocol !== 'https:' || !ALLOWED.has(url.hostname)) {
    return new Response('Host not allowed', { status: 403 });
  }
  const upstream = await fetch(url.toString(), { headers: { 'User-Agent': 'PolyForm WorldView (+https://polyform-alpha.vercel.app)' } });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
