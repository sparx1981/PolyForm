// Service Worker for WorldView Application
// Handles CORS proxying, message stability, and resource caching

const VERSION = 'v1.1.0';
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
 * 1. Proxies requests to firebasestorage.googleapis.com to add correct headers
 * 2. Handles preflight OPTIONS requests for mapped domains
 * 3. Safely handles fetch failures for external assets
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Handle Firestore/Firebase Storage Proxying (Only for GET requests/textures)
  if (url.hostname === 'firebasestorage.googleapis.com' || url.hostname === 'physicallybased.info') {
    if (event.request.method === 'GET') {
      event.respondWith(handleProxiedRequest(event.request));
      return;
    }
    // Allow native handle for POST/PUT (Storage uploads)
    return;
  }

  // 2. Handle Gemini Model API Proxying (Stable endpoint focus)
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
 * Proxies requests to bypass CORS issues
 */
async function handleProxiedRequest(request) {
  try {
    const response = await fetch(request);
    
    // Create a new response with corrected CORS headers
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    newHeaders.set('Access-Control-Allow-Headers', '*');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  } catch (error) {
    console.error('[SW] Proxy failure:', error);
    return new Response(null, { status: 500, statusText: 'Proxy Error' });
  }
}

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
