import { describe, expect, it } from 'vitest';
import { GoogleDriveProvider, DRIVE_FOLDER_NAME } from './googleDrive';
import { TrimbleConnectProvider, trimbleConfigFromEnv } from './trimbleConnect';
import { StorageAuthError } from './providers';

type Call = { url: string; init?: RequestInit };

/** A fake HTTP service: each handler matches a method + URL prefix and returns JSON or text. */
function fakeFetch(routes: [string, (call: Call) => unknown][]) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find(([key]) => {
      const [m, prefix] = key.split(' ');
      return m === method && url.startsWith(prefix);
    });
    if (!route) return new Response('not found', { status: 404 });
    const out = route[1]({ url, init });
    if (out instanceof Response) return out;
    return new Response(typeof out === 'string' ? out : JSON.stringify(out), { status: 200 });
  };
  return { fetcher, calls };
}

describe('Google Drive storage', () => {
  it('creates the PolyForm folder once, saves, updates and opens a file', async () => {
    let folders = 0;
    const { fetcher, calls } = fakeFetch([
      ['GET https://www.googleapis.com/drive/v3/files?q=', () => ({ files: [] })],
      ['POST https://www.googleapis.com/drive/v3/files', () => { folders++; return { id: 'folder1' }; }],
      ['POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', () => ({ id: 'file1', name: 'House.polyform', webViewLink: 'https://drive/x' })],
      ['PATCH https://www.googleapis.com/upload/drive/v3/files/file1', () => ({ id: 'file1', name: 'House.polyform' })],
      ['GET https://www.googleapis.com/drive/v3/files/file1?alt=media', () => '{"format":"polyform","shapes":[]}'],
    ]);
    const drive = new GoogleDriveProvider(() => null, fetcher);
    drive.useToken('tok');

    const ref = await drive.create('House.polyform', '{"a":1}');
    expect(ref).toMatchObject({ provider: 'google-drive', fileId: 'file1', locationLabel: `My Drive › ${DRIVE_FOLDER_NAME}` });
    const upload = calls.find(c => c.url.includes('uploadType=multipart'))!;
    expect(String(upload.init!.body)).toContain('"parents":["folder1"]');
    expect((upload.init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');

    await drive.create('Other.polyform', '{}');
    expect(folders).toBe(1);

    await drive.update(ref, '{"a":2}');
    expect(calls.some(c => c.init?.method === 'PATCH' && c.init.body === '{"a":2}')).toBe(true);
    expect(await drive.download(ref)).toContain('polyform');
  });

  it('asks to reconnect when there is no token or it has expired', async () => {
    const { fetcher } = fakeFetch([['GET https://www.googleapis.com/drive/v3/files/f?alt=media', () => new Response('', { status: 401 })]]);
    const drive = new GoogleDriveProvider(() => null, fetcher);
    await expect(drive.download({ provider: 'google-drive', fileId: 'f', fileName: 'x' })).rejects.toThrow(StorageAuthError);
    drive.useToken('old');
    await expect(drive.download({ provider: 'google-drive', fileId: 'f', fileName: 'x' })).rejects.toThrow(/reconnect/);
    expect(drive.connected()).toBe(false);
  });
});

describe('Trimble Connect storage', () => {
  const config = trimbleConfigFromEnv({ VITE_TRIMBLE_CLIENT_ID: 'client', VITE_TRIMBLE_APP_NAME: 'PolyForm' }, 'https://app.example')!;

  it('is switched off until the app has a Trimble client id', () => {
    expect(trimbleConfigFromEnv({}, 'https://app.example')).toBeNull();
    expect(new TrimbleConnectProvider(null).configured()).toBe(false);
    expect(config.redirectUri).toBe('https://app.example/trimble-callback.html');
  });

  it('exchanges the sign-in code, lists folders by region, saves versions and downloads', async () => {
    const eu = 'https://app21.connect.trimble.com/tc/api/2.0';
    const { fetcher, calls } = fakeFetch([
      ['POST https://id.trimble.com/oauth/token', () => ({ access_token: 'tt', expires_in: 3600 })],
      ['GET https://app.connect.trimble.com/tc/api/2.0/regions', () => [{ 'tc-api': 'https://app21.connect.trimble.com/tc/api/2.0/' }]],
      [`GET ${eu}/projects`, () => [{ id: 'p1', name: 'Barn', rootId: 'root1' }]],
      [`GET ${eu}/folders/root1/items`, () => [{ id: 'f1', name: 'Models', type: 'FOLDER' }, { id: 'x', name: 'a.ifc', type: 'FILE' }]],
      [`POST ${eu}/files?parentId=f1`, () => ({ id: 'file9', name: 'House.polyform' })],
      [`POST ${eu}/files?fileId=file9`, () => ({ id: 'file9' })],
      [`GET ${eu}/files/fs/file9/downloadurl`, () => ({ url: 'https://s3.example/signed' })],
      ['GET https://s3.example/signed', () => '{"format":"polyform"}'],
    ]);
    const tc = new TrimbleConnectProvider(config, fetcher);
    await tc.exchange('code', 'verifier');
    const tokenCall = calls[0];
    expect(String(tokenCall.init!.body)).toContain('code_verifier=verifier');
    expect(tc.connected()).toBe(true);

    const folders = await tc.listFolders();
    expect(folders.map(f => f.label)).toEqual(['Barn › (top folder)', 'Barn › Models']);

    const ref = await tc.create('House.polyform', '{}', folders[1]);
    expect(ref).toMatchObject({ fileId: 'file9', projectId: 'p1', folderId: 'f1', apiBase: eu, locationLabel: 'Barn › Models' });
    await tc.update(ref, '{"v":2}');
    expect(calls.some(c => c.url.startsWith(`${eu}/files?fileId=file9`))).toBe(true);

    expect(await tc.download(ref)).toContain('polyform');
    const signed = calls.find(c => c.url === 'https://s3.example/signed')!;
    expect(signed.init?.headers).toBeUndefined();
  });
});
