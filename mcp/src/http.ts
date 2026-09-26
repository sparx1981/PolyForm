import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  OAuthError, authorizationServerMetadata, exchangeToken, finishAuthorization, protectedResourceMetadata,
  registerClient, startAuthorization, verifyAccessToken, type OAuthConfig, type VerifiedGoogleUser,
} from './oauth';
import { errorPage, homePage, loginPage } from './pages';
import { registerTools, type Renderer } from './tools';
import type { ModelStore } from './store';

export interface AppDeps {
  oauth: OAuthConfig;
  store: ModelStore;
  renderer?: Renderer;
  /** Checks a Firebase ID token from the sign-in page. */
  verifyIdToken: (idToken: string) => Promise<VerifiedGoogleUser>;
  firebaseWebConfig: object;
  /** Public address of this server; worked out from the request when not set. */
  baseUrl?: string;
  /** The bundled sign-in script. */
  loginScript: () => Promise<string>;
}

const INSTRUCTIONS = `PolyForm is a 3D modelling app for buildings and gardens. Units are metres; y is up and the ground is y = 0 (or the terrain).
Find the model first (list_models), then read it (get_model, list_objects) before changing it. Always pass the model's id, not its name, to every tool after that. Building tools add real PolyForm objects that also appear live in the app if it is open.
Screenshots are slow and costly: take one only when you need to check something you can't tell from list_objects, not after every change. When a design is finished (created or changed), always call preview_model once and show the user its pictures: a 3D view and, for buildings, a floor plan of each level. Pass room_labels naming the rooms you built.
Each change can be reversed with undo_last_change.`;

function baseUrl(req: IncomingMessage, deps: AppDeps) {
  if (deps.baseUrl) return deps.baseUrl.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host);
  return `${proto}://${host}`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  if ((req as any).body !== undefined) {
    const b = (req as any).body;
    return typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString('utf8') : JSON.stringify(b);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, body: string | object, type = 'application/json', extra: Record<string, string> = {}) {
  res.writeHead(status, {
    'content-type': typeof body === 'string' && type === 'application/json' ? 'application/json' : type,
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-expose-headers': 'mcp-session-id, www-authenticate',
};

export function createApp(deps: AppDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const base = baseUrl(req, deps);
    const url = new URL(req.url ?? '/', base);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') return send(res, 204, '');

    try {
      if (path === '/.well-known/oauth-authorization-server' || path.startsWith('/.well-known/openid-configuration')) {
        return send(res, 200, authorizationServerMetadata(base));
      }
      if (path.startsWith('/.well-known/oauth-protected-resource')) {
        return send(res, 200, protectedResourceMetadata(base));
      }
      if (path === '/register' && req.method === 'POST') {
        return send(res, 201, await registerClient(deps.oauth, JSON.parse((await readBody(req)) || '{}')));
      }
      if (path === '/authorize' && req.method === 'GET') {
        try {
          const { clientName, pending } = await startAuthorization(deps.oauth, url.searchParams);
          return send(res, 200, loginPage(clientName, pending, deps.firebaseWebConfig), 'text/html; charset=utf-8');
        } catch (e) {
          return send(res, 400, errorPage((e as Error).message), 'text/html; charset=utf-8');
        }
      }
      if (path === '/authorize/complete' && req.method === 'POST') {
        const { pending, idToken } = JSON.parse(await readBody(req));
        let user: VerifiedGoogleUser;
        try {
          user = await deps.verifyIdToken(idToken);
        } catch {
          throw new OAuthError('access_denied', 'Google sign-in could not be verified.', 401);
        }
        return send(res, 200, { redirect: await finishAuthorization(deps.oauth, pending, user) });
      }
      if (path === '/token' && req.method === 'POST') {
        const raw = await readBody(req);
        const form = String(req.headers['content-type'] ?? '').includes('json')
          ? new URLSearchParams(JSON.parse(raw))
          : new URLSearchParams(raw);
        return send(res, 200, await exchangeToken(deps.oauth, form));
      }
      if (path === '/login.js') {
        return send(res, 200, await deps.loginScript(), 'text/javascript; charset=utf-8', { 'cache-control': 'public, max-age=300' });
      }
      if (path === '/mcp') {
        let caller;
        try {
          caller = await verifyAccessToken(deps.oauth, req.headers.authorization);
        } catch (e) {
          return send(res, 401, { error: 'invalid_token', error_description: (e as Error).message }, 'application/json', {
            'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
          });
        }
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' }, 'application/json', { allow: 'POST' });
        const server = new McpServer({ name: 'polyform', version: '0.1.0' }, { instructions: INSTRUCTIONS });
        registerTools(server, { caller, store: deps.store, renderer: deps.renderer });
        // Stateless: a fresh server per request, no sessions to keep between serverless calls.
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => { transport.close(); server.close(); });
        await server.connect(transport);
        const raw = await readBody(req);
        await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
        return;
      }
      if (path === '/') return send(res, 200, homePage(base), 'text/html; charset=utf-8');
      return send(res, 404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof OAuthError) return send(res, e.status, { error: e.code, error_description: e.message });
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'server_error', error_description: (e as Error).message });
    }
  };
}
