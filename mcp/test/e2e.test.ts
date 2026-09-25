import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/http';
import { MemoryStore } from '../src/store';

/** A real MCP client talking to the connector over HTTP, after the same OAuth flow Claude uses. */
let server: Server;
let base = '';
const store = new MemoryStore();
const shots: string[] = [];

beforeAll(async () => {
  const app = createApp({
    oauth: { secret: 's'.repeat(40), allowedEmails: ['me@example.com'] },
    store,
    renderer: { screenshot: async (_c, modelId, opts) => { shots.push(`${modelId}:${opts.view}`); return Buffer.from('png'); } },
    verifyIdToken: async token => ({ uid: 'u1', email: token === 'good' ? 'me@example.com' : 'x@y.z', email_verified: true }),
    firebaseWebConfig: {},
    loginScript: async () => '/* login */',
  });
  server = createServer((req, res) => void app(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

async function json(path: string, init?: RequestInit) {
  const res = await fetch(base + path, init);
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

async function signIn(idToken = 'good') {
  const redirectUri = 'http://localhost:9999/callback';
  const reg = await json('/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirectUri] }) });
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const page = await fetch(`${base}/authorize?${new URLSearchParams({ client_id: reg.body.client_id, redirect_uri: redirectUri, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1' })}`);
  const html = await page.text();
  const pending = html.match(/data-pending="([^"]+)"/)![1];
  const done = await json('/authorize/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pending, idToken }) });
  if (done.status !== 200) return { error: done };
  const code = new URL(done.body.redirect).searchParams.get('code')!;
  const token = await json('/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }).toString() });
  return { token: token.body.access_token as string };
}

async function connect(accessToken: string) {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
  return client;
}

const parse = (result: any) => JSON.parse(result.content[0].text);

describe('connector over HTTP', () => {
  it('publishes OAuth metadata and challenges unauthenticated calls', async () => {
    expect((await json('/.well-known/oauth-authorization-server')).body.token_endpoint).toBe(`${base}/token`);
    expect((await json('/.well-known/oauth-protected-resource/mcp')).body.resource).toBe(`${base}/mcp`);
    const res = await json('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata');
  });

  it('refuses a Google account that is not allowed', async () => {
    const result = await signIn('bad');
    expect(result.error?.status).toBe(403);
  });

  it('builds, reads, screenshots and undoes through the tools', async () => {
    const { token } = await signIn();
    const client = await connect(token!);
    const names = (await client.listTools()).tools.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_models', 'add_room', 'add_opening', 'add_patio', 'screenshot', 'undo_last_change']));

    const created = parse(await client.callTool({ name: 'create_model', arguments: { name: 'Garden studio' } }));
    const room = parse(await client.callTool({ name: 'add_room', arguments: { model: 'Garden studio', width: 5, length: 4 } }));
    expect(room.created).toHaveLength(5);
    const wall = room.created.find((o: any) => o.type === 'wall');
    const door = parse(await client.callTool({ name: 'add_opening', arguments: { model: created.id, wall: wall.id, kind: 'door' } }));
    expect(door.created[0].inWall).toBe(wall.id);

    await client.callTool({ name: 'add_patio', arguments: { model: created.id, kind: 'patio', points: [[-2, 2.1], [2, 2.1], [2, 5], [-2, 5]] } });
    const summary = parse(await client.callTool({ name: 'get_model', arguments: { model: 'garden' } }));
    expect(summary.byType).toMatchObject({ wall: 4, box: 1, door: 1, patio: 1 });
    expect(summary.totals.patioAreaM2).toBeCloseTo(11.6);

    const shot = await client.callTool({ name: 'screenshot', arguments: { model: created.id, view: 'plan' } }) as any;
    expect(shot.content[0].type).toBe('image');
    expect(shots).toContain(`${created.id}:plan`);

    const preview = await client.callTool({ name: 'preview_model', arguments: { model: created.id, room_labels: [{ level: 1, at: [0, 0], name: 'Studio' }] } }) as any;
    const info = JSON.parse(preview.content[0].text);
    expect(info.levels[0].rooms[0]).toMatchObject({ name: 'Studio' });
    expect(preview.content.slice(1).map((c: any) => c.type)).toEqual(['image', 'image']); // the 3D view, then the plan
    expect(Buffer.from(preview.content[2].data, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(shots).toContain(`${created.id}:perspective`);

    const bad = await client.callTool({ name: 'add_opening', arguments: { model: created.id, wall: 'nope', kind: 'door' } }) as any;
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/No object "nope"/);

    await client.callTool({ name: 'delete_objects', arguments: { model: created.id, objects: [wall.id] } });
    let objects = parse(await client.callTool({ name: 'list_objects', arguments: { model: created.id } }));
    expect(objects.total).toBe(5); // the wall and its door are gone

    const undo = await client.callTool({ name: 'undo_last_change', arguments: { model: created.id } }) as any;
    expect(undo.content[0].text).toMatch(/Undid: Deleted/);
    objects = parse(await client.callTool({ name: 'list_objects', arguments: { model: created.id } }));
    expect(objects.total).toBe(7);
    await client.close();
  });

  it('roofs a room with the app roof assembly and replaces it on a second call', async () => {
    const { token } = await signIn();
    const client = await connect(token!);
    const { id } = parse(await client.callTool({ name: 'create_model', arguments: { name: 'Roof test' } }));
    const refused = await client.callTool({ name: 'add_roof', arguments: { model: id } }) as any;
    expect(refused.isError).toBe(true);
    await client.callTool({ name: 'add_room', arguments: { model: id, width: 6, length: 5 } });
    const first = parse(await client.callTool({ name: 'add_roof', arguments: { model: id, roof_type: 'gable' } }));
    expect(first.created.length).toBeGreaterThanOrEqual(3);
    await client.callTool({ name: 'add_roof', arguments: { model: id, roof_type: 'hip' } });
    const all = parse(await client.callTool({ name: 'list_objects', arguments: { model: id } }));
    const roofs = all.objects.filter((o: any) => /roof/i.test(o.name));
    expect(roofs.length).toBeGreaterThan(0);
    expect(roofs.every((o: any) => !/gable/i.test(o.name))).toBe(true);
    await client.close();
  });

  it('levels patios with the ground floor of a two-storey house, keeps plants light, and places stairs from the bottom', async () => {
    const { token } = await signIn();
    const client = await connect(token!);
    const { id } = parse(await client.callTool({ name: 'create_model', arguments: { name: 'Two storey' } }));
    await client.callTool({ name: 'add_wall', arguments: { model: id, start: [0, 0.15, 0], end: [6, 0.15, 0], height: 2.85 } });
    await client.callTool({ name: 'add_wall', arguments: { model: id, start: [0, 3, 0], end: [6, 3, 0], height: 2.8 } });
    const patio = parse(await client.callTool({ name: 'add_patio', arguments: { model: id, kind: 'patio', points: [[0, -0.1], [6, -0.1], [6, -4], [0, -4]] } }));
    expect(patio.created[0].position[1]).toBeCloseTo(0.15);

    await client.callTool({ name: 'add_plant', arguments: { model: id, species: 'lavender_shrub', points: [[1, -6], [2, -6]] } });
    const plants = parse(await client.callTool({ name: 'list_objects', arguments: { model: id, type: 'bush' } }));
    expect(plants.total).toBe(2);
    const plant = parse(await client.callTool({ name: 'get_object', arguments: { model: id, object: plants.objects[0].id } }));
    expect(plant.plantSpeciesId).toBe('lavender_shrub');
    expect(plant.geometryData).toBeUndefined();

    const stairs = parse(await client.callTool({ name: 'add_stairs', arguments: { model: id, rise: 2.85, position: [1, 0.15, 1] } }));
    const [, y, z] = stairs.created[0].position;
    expect(y).toBeCloseTo(0.15 + 2.85 / 2, 1);
    expect(z).toBeGreaterThan(1);
    await client.close();
  });
});
