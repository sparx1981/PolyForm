// Service Worker for WorldView Application
// Handles CORS proxying, message stability, and resource caching

const VERSION = 'v1.2.0';
const CACHE_NAME = `worldview-cache-${VERSION}`;

// Resources to cache on install (optional, focusing on stability first)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

/**
 * Enhanced fetch handler
 * 1. Handles Gemini Model API proxying (stable endpoint focus)
 * 2. Safely handles fetch failures for external assets
 *
 * This used to also "proxy" firebasestorage.googleapis.com and physicallybased.info requests
 * here to bolt on Access-Control-Allow-Origin headers. That cannot work: a service worker's own
 * fetch() is still a real cross-origin network request, so the browser enforces CORS on it
 * exactly as it would on the page's original request, and blocks the response before any of
 * this worker's code runs - the header rewriting below never executes. All it did in practice
 * was turn a real (and fixable - see the CORS config on the Storage bucket) failure into a
 * misleading "500 Proxy Error" logged from here, and risked breaking plain <img> loads of the
 * same bucket's files, which work in "no-cors" mode without any of this. Removed; these
 * requests now go through the default handler below like everything else.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Gemini Model API Proxying (Stable endpoint focus)
  if (url.hostname === 'generativelanguage.googleapis.com') {
    event.respondWith(handleAIRequest(event.request));
    return;
  }

  // Default fetch
  event.respondWith(fetch(event.request).catch(err => {
    console.error('[SW] Fetch failed:', err);
    return new Response('Network error occurred', { status: 408 });
  }));
});

/**
 * Handles AI requests with stable endpoints
 */
async function handleAIRequest(request) {
  // We can modify the request URL here if needed to force a stable model
  // but usually it's better to do this in the app code.
  // Here we just ensure the response is handled correctly.
  return fetch(request);
}

// 3. Handle Message Channel Stability
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PING') {
    event.ports[0].postMessage({ type: 'PONG', version: VERSION });
  }
});
