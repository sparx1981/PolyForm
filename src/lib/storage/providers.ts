/**
 * Where a model is stored. PolyForm cloud keeps the model in Firestore (live collaboration, the
 * Claude connector); Google Drive and Trimble Connect keep a complete `.polyform` file in the
 * user's own storage, with no size limit, while Firestore keeps only a small index entry so the
 * model still appears in Cloud Models.
 */
export type StorageLocation = 'polyform' | 'google-drive' | 'trimble-connect';
export type ExternalLocation = Exclude<StorageLocation, 'polyform'>;

/** The index entry's pointer to the file (stored on the model document as `storage`). */
export interface ExternalFileRef {
  provider: ExternalLocation;
  fileId: string;
  fileName: string;
  /** Human-readable place, e.g. "My Drive › PolyForm" or "Project › Folder". */
  locationLabel?: string;
  webUrl?: string;
  /** Trimble Connect: project, folder and API host of the file. */
  projectId?: string;
  folderId?: string;
  apiBase?: string;
}

/** A folder the user can choose to save into (Trimble Connect). */
export interface StorageFolder {
  id: string;
  name: string;
  projectId: string;
  label: string;
}

/** Thrown when the account needs connecting (or reconnecting after its sign-in expired). */
export class StorageAuthError extends Error {}

export interface StorageProvider {
  id: ExternalLocation;
  label: string;
  /** False when the app has not been set up for this provider (e.g. no Trimble client id). */
  configured(): boolean;
  connected(): boolean;
  /** Interactive sign-in; call from a click so the popup is allowed. */
  connect(): Promise<void>;
  disconnect(): void;
  create(fileName: string, text: string, folder?: StorageFolder): Promise<ExternalFileRef>;
  update(ref: ExternalFileRef, text: string): Promise<ExternalFileRef>;
  download(ref: ExternalFileRef): Promise<string>;
  /** Folders to choose from; undefined when the provider picks the place itself. */
  listFolders?(): Promise<StorageFolder[]>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Keeps an access token for this browser tab, surviving reloads but not new tabs. */
export class TokenStore {
  private memory: { token: string; expiresAt: number } | null = null;
  constructor(private key: string) {}

  get(): string | null {
    let entry = this.memory;
    if (!entry) {
      try {
        const raw = sessionStorage.getItem(this.key);
        entry = raw ? JSON.parse(raw) : null;
      } catch {
        entry = null;
      }
    }
    if (!entry || entry.expiresAt < Date.now() + 60_000) return null;
    this.memory = entry;
    return entry.token;
  }

  set(token: string, expiresInSeconds: number) {
    this.memory = { token, expiresAt: Date.now() + expiresInSeconds * 1000 };
    try {
      sessionStorage.setItem(this.key, JSON.stringify(this.memory));
    } catch {
      // Storage may be blocked; the token then lasts for this page only.
    }
  }

  clear() {
    this.memory = null;
    try {
      sessionStorage.removeItem(this.key);
    } catch {
      // ignore
    }
  }
}

export async function failOnError(res: Response, what: string): Promise<Response> {
  if (res.status === 401 || res.status === 403) throw new StorageAuthError(`${what}: please reconnect your account.`);
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      // ignore
    }
    throw new Error(`${what} failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return res;
}
