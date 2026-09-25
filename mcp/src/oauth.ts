import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { Caller } from './store';

/**
 * OAuth 2.1 for the Claude connector, with nothing stored server-side: client registrations,
 * sign-in requests, codes and tokens are all short signed tokens. Sign-in itself is Google via
 * the PolyForm Firebase project, and only the allowed email addresses get through.
 */

export interface OAuthConfig {
  /** Secret used to sign everything (at least 32 characters). */
  secret: string;
  /** Emails allowed to sign in (lower case). */
  allowedEmails: string[];
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
}

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const ISSUER = 'polyform-mcp';
const key = (config: OAuthConfig) => new TextEncoder().encode(config.secret);

async function sign(config: OAuthConfig, typ: string, claims: JWTPayload, ttlSeconds: number) {
  return new SignJWT({ ...claims, typ })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key(config));
}

async function open<T extends JWTPayload>(config: OAuthConfig, token: string | undefined, typ: string, code = 'invalid_grant'): Promise<T> {
  if (!token) throw new OAuthError(code, `Missing ${typ}`);
  try {
    const { payload } = await jwtVerify(token, key(config), { issuer: ISSUER });
    if (payload.typ !== typ) throw new Error('wrong kind of token');
    return payload as T;
  } catch (e) {
    throw new OAuthError(code, `Invalid or expired ${typ}`);
  }
}

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['polyform'],
  };
}

export function protectedResourceMetadata(base: string) {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: ['polyform'],
    bearer_methods_supported: ['header'],
    resource_name: 'PolyForm',
  };
}

function checkRedirect(uri: string) {
  let url: URL;
  try { url = new URL(uri); } catch { throw new OAuthError('invalid_redirect_uri', 'Redirect address is not a valid URL'); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new OAuthError('invalid_redirect_uri', 'Redirect address must use https');
  }
}

/** Dynamic client registration: the client id itself carries the allowed redirect addresses. */
export async function registerClient(config: OAuthConfig, body: any) {
  const redirectUris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!redirectUris.length) throw new OAuthError('invalid_redirect_uri', 'redirect_uris is required');
  redirectUris.forEach(checkRedirect);
  const name = typeof body?.client_name === 'string' ? body.client_name.slice(0, 100) : 'Claude';
  const clientId = await sign(config, 'client', { redirect_uris: redirectUris, name }, 10 * 365 * 24 * 3600);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

export interface PendingSignIn {
  clientName: string;
  /** Signed request to hand back with the Google ID token. */
  pending: string;
}

/** Checks an /authorize request and wraps it into a signed "pending sign-in". */
export async function startAuthorization(config: OAuthConfig, query: URLSearchParams): Promise<PendingSignIn> {
  const client = await open<{ redirect_uris: string[]; name: string }>(config, query.get('client_id') ?? undefined, 'client', 'invalid_client');
  const redirectUri = query.get('redirect_uri') ?? client.redirect_uris[0];
  if (!client.redirect_uris.includes(redirectUri)) throw new OAuthError('invalid_request', 'Redirect address was not registered for this client');
  if (query.get('response_type') !== 'code') throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported');
  const challenge = query.get('code_challenge');
  if (!challenge || (query.get('code_challenge_method') ?? 'S256') !== 'S256') {
    throw new OAuthError('invalid_request', 'PKCE with S256 is required');
  }
  const pending = await sign(config, 'pending', {
    client_id: query.get('client_id')!,
    redirect_uri: redirectUri,
    state: query.get('state') ?? undefined,
    code_challenge: challenge,
    resource: query.get('resource') ?? undefined,
  }, 15 * 60);
  return { clientName: client.name, pending };
}

export interface VerifiedGoogleUser {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/** After Google sign-in: checks the person is allowed and returns where to send the browser. */
export async function finishAuthorization(
  config: OAuthConfig,
  pendingToken: string,
  user: VerifiedGoogleUser,
): Promise<string> {
  const pending = await open<{ client_id: string; redirect_uri: string; state?: string; code_challenge: string }>(config, pendingToken, 'pending', 'invalid_request');
  const email = (user.email ?? '').toLowerCase();
  if (!email || user.email_verified === false || !config.allowedEmails.includes(email)) {
    throw new OAuthError('access_denied', `${email || 'This account'} is not allowed to use this connector.`, 403);
  }
  const code = await sign(config, 'code', {
    sub: user.uid,
    email,
    name: user.name,
    client_id: pending.client_id,
    redirect_uri: pending.redirect_uri,
    code_challenge: pending.code_challenge,
  }, 5 * 60);
  const url = new URL(pending.redirect_uri);
  url.searchParams.set('code', code);
  if (pending.state) url.searchParams.set('state', pending.state);
  return url.toString();
}

function s256(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function issueTokens(config: OAuthConfig, who: { sub: string; email: string; name?: string; client_id: string }) {
  const accessTtl = config.accessTtlSeconds ?? 3600;
  const claims = { sub: who.sub, email: who.email, name: who.name, client_id: who.client_id };
  return {
    access_token: await sign(config, 'access', claims, accessTtl),
    token_type: 'Bearer',
    expires_in: accessTtl,
    refresh_token: await sign(config, 'refresh', claims, config.refreshTtlSeconds ?? 30 * 24 * 3600),
    scope: 'polyform',
  };
}

/** The /token endpoint (form fields). */
export async function exchangeToken(config: OAuthConfig, form: URLSearchParams) {
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    const code = await open<{ sub: string; email: string; name?: string; client_id: string; redirect_uri: string; code_challenge: string }>(config, form.get('code') ?? undefined, 'code');
    if (form.get('client_id') && form.get('client_id') !== code.client_id) throw new OAuthError('invalid_grant', 'Code was issued to another client');
    if (form.get('redirect_uri') && form.get('redirect_uri') !== code.redirect_uri) throw new OAuthError('invalid_grant', 'Redirect address does not match');
    const verifier = form.get('code_verifier');
    if (!verifier || s256(verifier) !== code.code_challenge) throw new OAuthError('invalid_grant', 'PKCE check failed');
    if (!config.allowedEmails.includes(code.email)) throw new OAuthError('access_denied', 'Account no longer allowed', 403);
    return issueTokens(config, code);
  }
  if (grant === 'refresh_token') {
    const refresh = await open<{ sub: string; email: string; name?: string; client_id: string }>(config, form.get('refresh_token') ?? undefined, 'refresh');
    if (!config.allowedEmails.includes(refresh.email)) throw new OAuthError('access_denied', 'Account no longer allowed', 403);
    return issueTokens(config, refresh);
  }
  throw new OAuthError('unsupported_grant_type', `Unsupported grant_type ${grant}`);
}

/** Checks a Bearer token on an /mcp request. */
export async function verifyAccessToken(config: OAuthConfig, header: string | undefined): Promise<Caller> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  const claims = await open<{ sub: string; email: string; name?: string }>(config, token, 'access', 'invalid_token');
  if (!config.allowedEmails.includes(claims.email)) throw new OAuthError('invalid_token', 'Account not allowed', 401);
  return { uid: claims.sub, email: claims.email, name: claims.name };
}
