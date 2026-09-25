import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exchangeToken, finishAuthorization, registerClient, startAuthorization, verifyAccessToken, type OAuthConfig } from '../src/oauth';

const config: OAuthConfig = { secret: 'x'.repeat(40), allowedEmails: ['me@example.com'] };
const me = { uid: 'u1', email: 'Me@Example.com', email_verified: true, name: 'Me' };

async function signIn(user = me, verifier = randomBytes(32).toString('base64url')) {
  const client = await registerClient(config, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude' });
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    client_id: client.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'abc',
  });
  const { pending, clientName } = await startAuthorization(config, query);
  expect(clientName).toBe('Claude');
  const redirect = new URL(await finishAuthorization(config, pending, user));
  return { client, redirect, verifier };
}

describe('connector sign-in', () => {
  it('runs the whole authorization code flow with PKCE', async () => {
    const { client, redirect, verifier } = await signIn();
    expect(redirect.origin + redirect.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(redirect.searchParams.get('state')).toBe('abc');
    const tokens = await exchangeToken(config, new URLSearchParams({
      grant_type: 'authorization_code', code: redirect.searchParams.get('code')!, code_verifier: verifier,
      client_id: client.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    }));
    const caller = await verifyAccessToken(config, `Bearer ${tokens.access_token}`);
    expect(caller).toEqual({ uid: 'u1', email: 'me@example.com', name: 'Me' });

    const refreshed = await exchangeToken(config, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }));
    expect((await verifyAccessToken(config, `Bearer ${refreshed.access_token}`)).uid).toBe('u1');
  });

  it('refuses anyone not on the allowed list', async () => {
    await expect(signIn({ ...me, email: 'someone@else.com' })).rejects.toThrow(/not allowed/);
  });

  it('refuses a code without the matching PKCE verifier', async () => {
    const { redirect } = await signIn();
    await expect(exchangeToken(config, new URLSearchParams({
      grant_type: 'authorization_code', code: redirect.searchParams.get('code')!, code_verifier: 'wrong',
    }))).rejects.toThrow(/PKCE/);
  });

  it('refuses redirects that were not registered, and non-https ones', async () => {
    const client = await registerClient(config, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    await expect(startAuthorization(config, new URLSearchParams({
      client_id: client.client_id, redirect_uri: 'https://evil.example/cb', response_type: 'code', code_challenge: 'c',
    }))).rejects.toThrow(/not registered/);
    await expect(registerClient(config, { redirect_uris: ['http://evil.example/cb'] })).rejects.toThrow(/https/);
  });

  it('does not accept a refresh token or code as an access token', async () => {
    const { redirect } = await signIn();
    await expect(verifyAccessToken(config, `Bearer ${redirect.searchParams.get('code')}`)).rejects.toThrow();
  });
});
