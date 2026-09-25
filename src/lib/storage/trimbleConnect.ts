import {
  failOnError, StorageAuthError, TokenStore,
  type ExternalFileRef, type FetchLike, type StorageFolder, type StorageProvider,
} from './providers';
import { PROJECT_FILE_MIME } from './projectFile';

/**
 * Trimble Connect storage. Sign-in is Trimble Identity (OAuth 2 authorization code with PKCE in
 * a popup); models are saved as `.polyform` files in a Connect project folder the user picks, and
 * each save uploads a new version of the same file.
 *
 * Needs a Trimble Developer Console application: VITE_TRIMBLE_CLIENT_ID and VITE_TRIMBLE_APP_NAME
 * (the scope), with `<app origin>/trimble-callback.html` as a redirect URL. Until those are set
 * the option shows as "needs setup".
 */
export interface TrimbleConfig {
  clientId: string;
  /** The application name registered in the Trimble Developer Console (used as the scope). */
  appName: string;
  identityBase: string;
  /** Any Connect API host; the user's region is looked up from it. */
  connectBase: string;
  redirectUri: string;
}

export function trimbleConfigFromEnv(env: Record<string, string | undefined>, origin: string): TrimbleConfig | null {
  if (!env.VITE_TRIMBLE_CLIENT_ID || !env.VITE_TRIMBLE_APP_NAME) return null;
  return {
    clientId: env.VITE_TRIMBLE_CLIENT_ID,
    appName: env.VITE_TRIMBLE_APP_NAME,
    identityBase: env.VITE_TRIMBLE_IDENTITY_URL || 'https://id.trimble.com',
    connectBase: env.VITE_TRIMBLE_CONNECT_URL || 'https://app.connect.trimble.com/tc/api/2.0',
    redirectUri: `${origin}/trimble-callback.html`,
  };
}

function base64Url(bytes: Uint8Array): string {
  let text = '';
  bytes.forEach(b => { text += String.fromCharCode(b); });
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** Opens the Trimble sign-in popup and resolves with the authorization code. */
function popupForCode(url: string, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const popup = window.open(url, 'trimble-signin', 'width=520,height=720');
    if (!popup) return reject(new StorageAuthError('Allow pop-ups to sign in with Trimble.'));
    const done = (fn: () => void) => { window.removeEventListener('message', onMessage); clearInterval(timer); fn(); };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'trimble-auth') return;
      if (event.data.state !== state) return done(() => reject(new StorageAuthError('Trimble sign-in did not match; try again.')));
      if (event.data.error) return done(() => reject(new StorageAuthError(`Trimble sign-in failed: ${event.data.error}`)));
      done(() => resolve(event.data.code));
    };
    window.addEventListener('message', onMessage);
    const timer = window.setInterval(() => {
      if (popup.closed) done(() => reject(new StorageAuthError('Trimble sign-in was closed.')));
    }, 500);
  });
}

export class TrimbleConnectProvider implements StorageProvider {
  readonly id = 'trimble-connect' as const;
  readonly label = 'Trimble Connect';
  private tokens = new TokenStore('polyform_trimble_token');
  private apiBase: string | null = null;

  constructor(private config: TrimbleConfig | null, private fetcher: FetchLike = (i, init) => fetch(i, init)) {}

  configured() {
    return !!this.config;
  }

  connected() {
    return !!this.tokens.get();
  }

  private cfg(): TrimbleConfig {
    if (!this.config) throw new StorageAuthError('Trimble Connect has not been set up for this app yet.');
    return this.config;
  }

  async connect() {
    const cfg = this.cfg();
    const { verifier, challenge } = await pkcePair();
    const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      scope: `openid ${cfg.appName}`,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const code = await popupForCode(`${cfg.identityBase}/oauth/authorize?${params}`, state);
    await this.exchange(code, verifier);
  }

  /** Swaps an authorization code for a token (separate for tests). */
  async exchange(code: string, verifier: string) {
    const cfg = this.cfg();
    const res = await this.fetcher(`${cfg.identityBase}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
        client_id: cfg.clientId,
        code_verifier: verifier,
      }).toString(),
    });
    const body = await (await failOnError(res, 'Trimble sign-in')).json();
    if (!body.access_token) throw new StorageAuthError('Trimble did not return an access token.');
    this.tokens.set(body.access_token, Number(body.expires_in) || 3600);
    this.apiBase = null;
  }

  disconnect() {
    this.tokens.clear();
    this.apiBase = null;
  }

  private async call(url: string, init: RequestInit = {}, what = 'Trimble Connect') {
    const token = this.tokens.get();
    if (!token) throw new StorageAuthError('Connect Trimble Connect to save or open this model.');
    const res = await this.fetcher(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
    if (res.status === 401) this.tokens.clear();
    return failOnError(res, what);
  }

  /** Connect keeps data per region; projects are listed per region host. */
  private async hosts(): Promise<string[]> {
    const cfg = this.cfg();
    try {
      const regions = await (await this.call(`${cfg.connectBase}/regions`)).json();
      const bases = (Array.isArray(regions) ? regions : [])
        .map((r: any) => r['tc-api'] || r.tcApi || r.origin)
        .filter((u: unknown): u is string => typeof u === 'string')
        .map((u: string) => (u.includes('/tc/api/') ? u.replace(/\/$/, '') : `${u.replace(/\/$/, '')}/tc/api/2.0`));
      if (bases.length) return [...new Set(bases)];
    } catch (e) {
      if (e instanceof StorageAuthError) throw e;
    }
    return [cfg.connectBase];
  }

  async listFolders(): Promise<StorageFolder[]> {
    const out: StorageFolder[] = [];
    for (const base of await this.hosts()) {
      let projects: any[] = [];
      try {
        projects = await (await this.call(`${base}/projects?fullyLoaded=false`)).json();
      } catch (e) {
        if (e instanceof StorageAuthError) throw e;
        continue;
      }
      for (const p of Array.isArray(projects) ? projects : []) {
        if (!p?.rootId) continue;
        out.push({ id: `${base}|${p.rootId}`, name: p.name, projectId: p.id, label: `${p.name} › (top folder)` });
        try {
          const items = await (await this.call(`${base}/folders/${encodeURIComponent(p.rootId)}/items`)).json();
          for (const item of Array.isArray(items) ? items : []) {
            if (item?.type === 'FOLDER') out.push({ id: `${base}|${item.id}`, name: item.name, projectId: p.id, label: `${p.name} › ${item.name}` });
          }
        } catch (e) {
          if (e instanceof StorageAuthError) throw e;
        }
      }
    }
    return out;
  }

  private upload(url: string, fileName: string, text: string) {
    const form = new FormData();
    form.append('file', new Blob([text], { type: PROJECT_FILE_MIME }), fileName);
    return this.call(url, { method: 'POST', body: form }, 'Saving to Trimble Connect');
  }

  async create(fileName: string, text: string, folder?: StorageFolder): Promise<ExternalFileRef> {
    if (!folder) throw new Error('Choose a Trimble Connect folder to save into.');
    const [base, folderId] = folder.id.split('|');
    const file = await (await this.upload(`${base}/files?parentId=${encodeURIComponent(folderId)}&parentType=FOLDER`, fileName, text)).json();
    return {
      provider: this.id,
      fileId: file.id,
      fileName: file.name ?? fileName,
      locationLabel: folder.label,
      projectId: folder.projectId,
      folderId,
      apiBase: base,
    };
  }

  async update(ref: ExternalFileRef, text: string): Promise<ExternalFileRef> {
    const base = ref.apiBase || this.cfg().connectBase;
    // Uploading with the file's id adds a new version of the same file.
    const file = await (await this.upload(`${base}/files?fileId=${encodeURIComponent(ref.fileId)}`, ref.fileName, text)).json();
    return { ...ref, fileId: file.id ?? ref.fileId };
  }

  async download(ref: ExternalFileRef): Promise<string> {
    const base = ref.apiBase || this.cfg().connectBase;
    const { url } = await (await this.call(`${base}/files/fs/${encodeURIComponent(ref.fileId)}/downloadurl`, {}, 'Opening from Trimble Connect')).json();
    // The download link is pre-signed; it must not carry the Trimble token.
    const res = await this.fetcher(url);
    return (await failOnError(res, 'Opening from Trimble Connect')).text();
  }
}
