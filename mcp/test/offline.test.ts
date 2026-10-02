import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FirestoreStore, MemoryStore, ToolError, bounded, DB_DEADLINE_MS, DB_HEAVY_DEADLINE_MS, type Caller } from '../src/store';
import { registerTools } from '../src/tools';
import { buildOffline } from '../src/offline';
import { driveTokenFor, saveToDrive } from '../src/drive';
import { exchangeToken, finishAuthorization, openDriveToken, registerClient, sealDriveToken, startAuthorization, verifyAccessToken, type OAuthConfig } from '../src/oauth';
import { parseProjectFile } from '../../src/lib/storage/projectFile';

const FUTURE = () => Date.now() + 50 * 60_000;
const me: Caller = { uid: 'u1', email: 'me@example.com' };
const withDrive: Caller = { ...me, driveToken: 'ya29.drive', driveTokenExpiresAt: FUTURE() };

function harness(caller: Caller) {
  const store = new MemoryStore();
  const tools = new Map<string, { schema: z.ZodObject<any>; run: (args: any) => Promise<any> }>();
  registerTools({
    registerTool: (name: string, config: any, run: any) => tools.set(name, { schema: z.object(config.inputSchema ?? {}), run }),
  } as any, { caller, store });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const tool = tools.get(name)!;
    const result = await tool.run(tool.schema.parse(args));
    const text: string = result.content[0].text;
    if (result.isError) return { error: text };
    try { return JSON.parse(text); } catch { return { text }; }
  };
  return { store, call };
}

/** A pretend Google Drive that remembers what is uploaded. */
function fakeDrive(opts: { folderExists?: boolean; status?: number } = {}) {
  const uploads: { url: string; body: string; auth: string }[] = [];
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const auth = String((init.headers as Record<string, string>)?.Authorization ?? '');
    if (opts.status) return new Response('{"error":{"message":"nope"}}', { status: opts.status });
    if (url.includes('/upload/')) {
      uploads.push({ url, body: String(init.body), auth });
      return Response.json({ id: 'file1', name: 'x.polyform', webViewLink: 'https://drive.google.com/file/d/file1/view' });
    }
    if (init.method === 'POST') return Response.json({ id: 'folder-new' });
    return Response.json({ files: opts.folderExists === false ? [] : [{ id: 'folder1', name: 'PolyForm' }] });
  };
  return { fetcher, uploads };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('database deadline', () => {
  it('passes a result through when the call finishes in time', async () => {
    await expect(bounded(Promise.resolve(7), 'Saving')).resolves.toBe(7);
  });

  it('turns a stalled call into an error that says what to do instead', async () => {
    vi.useFakeTimers();
    const stalled = bounded(new Promise(() => undefined), 'Creating the model');
    const check = expect(stalled).rejects.toThrow(/Creating the model did not finish within 20 seconds.*may or may not have been saved.*build_model/s);
    await vi.advanceTimersByTimeAsync(DB_DEADLINE_MS + 1);
    await check;
  });

  it('applies to Firestore writes: a hanging create_model fails fast instead of hanging', async () => {
    vi.useFakeTimers();
    const db: any = { collection: () => ({ doc: () => ({ id: 'abc', set: () => new Promise(() => undefined) }) }) };
    const store = new FirestoreStore(db, () => 'ts');
    const created = store.createModel(me, 'Hangs');
    const check = expect(created).rejects.toBeInstanceOf(ToolError);
    await vi.advanceTimersByTimeAsync(DB_DEADLINE_MS + 1);
    await check;
  });
});

describe('Drive token in the sign-in', () => {
  const config: OAuthConfig = { secret: 's'.repeat(40), allowedEmails: ['me@example.com'] };

  it('encrypts the token and rejects tampering or another secret', () => {
    const sealed = sealDriveToken(config, 'ya29.secret');
    expect(sealed).not.toContain('ya29');
    expect(openDriveToken(config, sealed)).toBe('ya29.secret');
    expect(openDriveToken(config, sealed.slice(0, -2) + 'AA')).toBeUndefined();
    expect(openDriveToken({ ...config, secret: 'x'.repeat(40) }, sealed)).toBeUndefined();
  });

  it('reaches the tools from sign-in, and is still carried (with its original expiry) after a refresh', async () => {
    const redirect = 'http://localhost:9999/cb';
    const reg = await registerClient(config, { redirect_uris: [redirect] });
    const verifier = 'v'.repeat(50);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const pending = await startAuthorization(config, new URLSearchParams({
      client_id: reg.client_id, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    }));
    const expiresAt = FUTURE();
    const done = await finishAuthorization(config, pending.pending, { uid: 'u1', email: 'me@example.com', email_verified: true }, { token: 'ya29.abc', expiresAt });
    const code = new URL(done).searchParams.get('code')!;
    const tokens = await exchangeToken(config, new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }));
    const caller = await verifyAccessToken(config, `Bearer ${tokens.access_token}`);
    expect(caller).toMatchObject({ uid: 'u1', driveToken: 'ya29.abc', driveTokenExpiresAt: expiresAt });
    // The token is not readable by anyone who can read the connector's access token.
    expect(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString()).not.toContain('ya29.abc');

    const refreshed = await exchangeToken(config, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }));
    expect(await verifyAccessToken(config, `Bearer ${refreshed.access_token}`)).toMatchObject({ driveToken: 'ya29.abc', driveTokenExpiresAt: expiresAt });
  });

  it('works without Drive access too (no token on the caller)', async () => {
    const reg = await registerClient(config, { redirect_uris: ['http://localhost:9999/cb'] });
    const verifier = 'w'.repeat(50);
    const pending = await startAuthorization(config, new URLSearchParams({
      client_id: reg.client_id, redirect_uri: 'http://localhost:9999/cb', response_type: 'code',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }));
    const code = new URL(await finishAuthorization(config, pending.pending, { uid: 'u1', email: 'me@example.com', email_verified: true })).searchParams.get('code')!;
    const tokens = await exchangeToken(config, new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier }));
    const caller = await verifyAccessToken(config, `Bearer ${tokens.access_token}`);
    expect(caller.driveToken).toBeUndefined();
  });
});

describe('saving to Drive', () => {
  it('says how to get Drive access when there is none, or when it has run out', () => {
    expect(() => driveTokenFor(me)).toThrow(/no Google Drive access.*reconnect/is);
    expect(() => driveTokenFor({ ...me, driveToken: 't', driveTokenExpiresAt: Date.now() - 1000 })).toThrow(/expired.*reconnect/is);
    expect(() => driveTokenFor({ ...me, driveToken: 't', driveTokenExpiresAt: Date.now() + 10_000 })).toThrow(/expired/i); // under a minute left
    expect(driveTokenFor(withDrive)).toBe('ya29.drive');
  });

  it('uploads into the PolyForm folder with the person\'s token', async () => {
    const drive = fakeDrive();
    const saved = await saveToDrive(withDrive, 'House.polyform', '{"a":1}', drive.fetcher);
    expect(saved).toMatchObject({ fileId: 'file1', webUrl: 'https://drive.google.com/file/d/file1/view', location: 'My Drive › PolyForm' });
    expect(drive.uploads[0].auth).toBe('Bearer ya29.drive');
    expect(drive.uploads[0].body).toContain('"parents":["folder1"]');
    expect(drive.uploads[0].body).toContain('{"a":1}');
  });

  it('creates the folder when there is none', async () => {
    const drive = fakeDrive({ folderExists: false });
    await saveToDrive(withDrive, 'House.polyform', '{}', drive.fetcher);
    expect(drive.uploads[0].body).toContain('"parents":["folder-new"]');
  });

  it('turns a refusal into advice', async () => {
    await expect(saveToDrive(withDrive, 'a.polyform', '{}', fakeDrive({ status: 401 }).fetcher)).rejects.toThrow(/refused.*reconnect/is);
    await expect(saveToDrive(withDrive, 'a.polyform', '{}', fakeDrive({ status: 403 }).fetcher)).rejects.toThrow(/Drive API is switched on/);
  });
});

describe('build_model steps', () => {
  it('builds in memory with the same tools, filling in the model and following earlier results', async () => {
    const built = await buildOffline(me, 'Test House', [
      { tool: 'add_terrain', args: { width: 60, depth: 60 } },
      { tool: 'add_room', args: { width: 8, length: 6, position: [0, 0, 0] } },
      { tool: 'add_wall', args: { start: [10, 0, 0], end: [14, 0, 0] } },
      { tool: 'set_appearance', args: { objects: ['$3.created.*.id'], color: '#ff0000' } },
    ]);
    expect(built.steps).toBe(4);
    const shapes = built.project.shapes as any[];
    expect(shapes.some(s => s.type === 'terrain')).toBe(true);
    expect(shapes.filter(s => s.type === 'wall').length).toBeGreaterThanOrEqual(5);
    const painted = shapes.find(s => s.type === 'wall' && s.color === '#ff0000');
    expect(painted).toBeTruthy();
    expect(built.project.name).toBe('Test House');
    expect((built.health as any).healthy).toBe(true);
  });

  it('refuses a step that fails, naming it, and saves nothing', async () => {
    await expect(buildOffline(me, 'X', [{ tool: 'add_terrain', args: {} }, { tool: 'add_room', args: { width: 0.2, length: 5 } }])).rejects.toThrow(/Step 2 \(add_room\).*Nothing was saved/s);
  });

  it('reports unknown tools, mistyped arguments, and references to steps that have not run', async () => {
    await expect(buildOffline(me, 'X', [{ tool: 'add_castle' }])).rejects.toThrow(/no tool called "add_castle"/);
    await expect(buildOffline(me, 'X', [{ tool: 'add_room', args: { width: 4, length: 4, colour: '#ffffff' } }])).rejects.toThrow(/arguments are not valid/);
    await expect(buildOffline(me, 'X', [{ tool: 'add_wall', args: { start: [0, 0, 0], end: ['$2.created.0.id' as any, 0, 0] } }, { tool: 'add_terrain' }])).rejects.toThrow(/not run yet/);
  });

  it('keeps the tools that touch stored models, or take pictures, out of a build', async () => {
    for (const tool of ['create_model', 'list_models', 'screenshot', 'preview_model', 'build_model', 'export_model']) {
      await expect(buildOffline(me, 'X', [{ tool }])).rejects.toThrow(/cannot be used inside a build/);
    }
  });

  it('stops when the time is up rather than running into the host limit', async () => {
    await expect(buildOffline(me, 'X', [{ tool: 'add_terrain' }, { tool: 'add_terrain' }], {}, -1)).rejects.toThrow(/ran out of time after 0 of 2 steps/);
  });
});

describe('build_model and export_model tools', () => {
  const steps = [{ tool: 'add_terrain', args: { width: 40, depth: 40 } }, { tool: 'add_room', args: { width: 6, length: 5 } }];

  it('build_model saves the project file to Drive and returns the link, with nothing stored', async () => {
    const drive = fakeDrive();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => drive.fetcher(url, init));
    const h = harness(withDrive);
    const out = await h.call('build_model', { name: 'McLaren test', steps });
    expect(out.file.link).toBe('https://drive.google.com/file/d/file1/view');
    expect(out.objects).toBeGreaterThan(2);
    expect(out.how_to_open).toMatch(/File > Open File/);
    expect(await h.store.listModels(withDrive)).toEqual([]);
    // What was uploaded is a valid project file the app can open.
    const text = drive.uploads[0].body.split('\r\n')[7];
    const project = parseProjectFile(text);
    expect(project.name).toBe('McLaren test');
    expect(project.shapes.length).toBe(out.objects);
  });

  it('build_model checks Drive access first, so no work is wasted', async () => {
    const h = harness(me);
    const out = await h.call('build_model', { name: 'X', steps });
    expect(out.error).toMatch(/no Google Drive access/);
  });

  it('export_model saves a stored model to Drive', async () => {
    const drive = fakeDrive();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => drive.fetcher(url, init));
    const h = harness(withDrive);
    const { id } = await h.call('create_model', { name: 'Stored' });
    await h.call('add_room', { model: id, width: 6, length: 5 });
    const out = await h.call('export_model', { model: id });
    expect(out.model).toBe(`Stored (${id})`);
    expect(out.file.link).toContain('drive.google.com');
    expect(parseProjectFile(drive.uploads[0].body.split('\r\n')[7]).shapes.length).toBe(out.objects);
  });

  it('export_model also reports when Drive access has run out', async () => {
    const h = harness({ ...me, driveToken: 't', driveTokenExpiresAt: Date.now() - 1 });
    const { id } = await h.call('create_model', { name: 'Stored' });
    expect((await h.call('export_model', { model: id })).error).toMatch(/expired/);
  });
});

describe('exporting from Firestore', () => {
  /** Just enough of Firestore for one model document owned by the caller. */
  const fakeDb = (data: Record<string, unknown>): any => ({
    collection: () => ({ doc: () => ({ id: 'model123456', get: async () => ({ exists: true, id: 'model123456', data: () => data }) }) }),
  });

  it('collects everything the app saves in a project file, not only what the tools change', async () => {
    const wall = { id: 'w1', type: 'wall', position: [0, 1, 0], args: [4, 2, 0.2] };
    const store = new FirestoreStore(fakeDb({
      name: 'Stored house', userId: 'u1', shapes: [wall],
      tags: [{ id: 't1' }], scenes: [{ id: 's1' }], notes: [{ id: 'n1' }], customMaterials: [{ id: 'm1' }],
      terrainModifiers: [], kernel: { version: 1 }, assetSchemaVersion: 1, assetCatalogRelease: 'r1',
    }), () => 'ts');
    const out = await store.exportProject(me, 'model123456');
    expect(out).toMatchObject({ id: 'model123456', name: 'Stored house' });
    expect(out.project.shapes).toHaveLength(1);
    expect(out.project).toMatchObject({ tags: [{ id: 't1' }], scenes: [{ id: 's1' }], notes: [{ id: 'n1' }], customMaterials: [{ id: 'm1' }], kernel: { version: 1 }, assetCatalogRelease: 'r1' });
  });

  it('refuses a model whose file lives in Google Drive, as the other tools do', async () => {
    const store = new FirestoreStore(fakeDb({ name: 'In Drive', userId: 'u1', storage: { provider: 'google-drive', fileId: 'f' } }), () => 'ts');
    await expect(store.exportProject(me, 'model123456')).rejects.toThrow(/stored in Google Drive/);
  });

  it('gives opening and saving a whole model more time than a small call', () => {
    expect(DB_HEAVY_DEADLINE_MS).toBeGreaterThan(DB_DEADLINE_MS);
    expect(DB_HEAVY_DEADLINE_MS).toBeLessThan(60_000);
  });
});
