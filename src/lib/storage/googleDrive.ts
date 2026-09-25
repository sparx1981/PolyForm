import { GoogleAuthProvider, reauthenticateWithPopup, linkWithPopup, type Auth } from 'firebase/auth';
import {
  failOnError, StorageAuthError, TokenStore,
  type ExternalFileRef, type FetchLike, type StorageProvider,
} from './providers';
import { PROJECT_FILE_MIME } from './projectFile';

/** Only files PolyForm itself creates or opens: no access to anything else in the Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER_NAME = 'PolyForm';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Google Drive storage. Sign-in reuses the PolyForm Google account (Firebase), adding the
 * drive.file permission; models are saved as `.polyform` files in a "PolyForm" folder.
 */
export class GoogleDriveProvider implements StorageProvider {
  readonly id = 'google-drive' as const;
  readonly label = 'Google Drive';
  private tokens = new TokenStore('polyform_drive_token');
  private folderId: string | null = null;

  constructor(private auth: () => Auth | null, private fetcher: FetchLike = (i, init) => fetch(i, init)) {}

  configured() {
    return true;
  }

  connected() {
    return !!this.tokens.get();
  }

  async connect() {
    const auth = this.auth();
    const user = auth?.currentUser;
    if (!auth || !user) throw new StorageAuthError('Sign in to PolyForm first.');
    const provider = new GoogleAuthProvider();
    provider.addScope(DRIVE_SCOPE);
    provider.setCustomParameters({ login_hint: user.email ?? '' });
    const signedInWithGoogle = user.providerData.some(p => p.providerId === 'google.com');
    const result = signedInWithGoogle
      ? await reauthenticateWithPopup(user, provider)
      : await linkWithPopup(user, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) throw new StorageAuthError('Google did not grant Drive access.');
    // Google access tokens last an hour.
    this.tokens.set(credential.accessToken, 3500);
  }

  disconnect() {
    this.tokens.clear();
    this.folderId = null;
  }

  /** For tests and for tokens obtained elsewhere. */
  useToken(token: string, expiresInSeconds = 3500) {
    this.tokens.set(token, expiresInSeconds);
  }

  private token(): string {
    const token = this.tokens.get();
    if (!token) throw new StorageAuthError('Connect Google Drive to save or open this model.');
    return token;
  }

  private async call(url: string, init: RequestInit = {}, what = 'Google Drive') {
    const res = await this.fetcher(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.token()}` } });
    if (res.status === 401) this.tokens.clear();
    return failOnError(res, what);
  }

  /** The app's own "PolyForm" folder (drive.file can only see folders the app created). */
  private async folder(): Promise<string> {
    if (this.folderId) return this.folderId;
    const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const found = await (await this.call(`${API}/files?q=${q}&fields=files(id,name)&spaces=drive`)).json();
    if (found.files?.length) return (this.folderId = found.files[0].id as string);
    const created = await (await this.call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    }, 'Creating the PolyForm folder')).json();
    return (this.folderId = created.id as string);
  }

  async create(fileName: string, text: string): Promise<ExternalFileRef> {
    const folderId = await this.folder();
    const boundary = `polyform${Math.random().toString(36).slice(2)}`;
    const metadata = { name: fileName, mimeType: PROJECT_FILE_MIME, parents: [folderId] };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${PROJECT_FILE_MIME}`,
      '',
      text,
      `--${boundary}--`,
    ].join('\r\n');
    const file = await (await this.call(`${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }, 'Saving to Google Drive')).json();
    return this.ref(file);
  }

  async update(ref: ExternalFileRef, text: string): Promise<ExternalFileRef> {
    const file = await (await this.call(`${UPLOAD}/files/${encodeURIComponent(ref.fileId)}?uploadType=media&fields=id,name,webViewLink`, {
      method: 'PATCH',
      headers: { 'Content-Type': PROJECT_FILE_MIME },
      body: text,
    }, 'Saving to Google Drive')).json();
    return this.ref(file);
  }

  async download(ref: ExternalFileRef): Promise<string> {
    const res = await this.call(`${API}/files/${encodeURIComponent(ref.fileId)}?alt=media`, {}, 'Opening from Google Drive');
    return res.text();
  }

  private ref(file: { id: string; name: string; webViewLink?: string }): ExternalFileRef {
    return {
      provider: this.id,
      fileId: file.id,
      fileName: file.name,
      locationLabel: `My Drive › ${DRIVE_FOLDER_NAME}`,
      webUrl: file.webViewLink,
    };
  }
}
