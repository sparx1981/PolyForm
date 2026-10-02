import { ToolError, type Caller } from './store';

/**
 * Saves a file to the signed-in person's Google Drive, the way the app's own Drive storage does
 * (src/lib/storage/googleDrive.ts): the `drive.file` permission, which reaches only files PolyForm creates,
 * and a "PolyForm" folder. The token comes from the connector sign-in and lasts about an hour.
 */
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'PolyForm';
const MIME = 'application/json';
const CALL_TIMEOUT_MS = 25_000;
/** Google rejects a token a little before it expires; stop trusting it a minute early. */
const MARGIN_MS = 60_000;

export interface SavedFile {
  fileId: string;
  fileName: string;
  /** Opens the file in Drive (where it can be downloaded). */
  webUrl?: string;
  location: string;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const RECONNECT = 'Disconnect and reconnect the PolyForm connector in Claude, and allow the Google Drive permission when Google asks, then try again.';

/** The Drive token for this request, or a plain-words error saying how to get one. Call before doing slow work. */
export function driveTokenFor(caller: Caller, now = Date.now()): string {
  if (!caller.driveToken) {
    throw new ToolError(`This connection has no Google Drive access, so the file cannot be saved. ${RECONNECT}`);
  }
  if ((caller.driveTokenExpiresAt ?? 0) < now + MARGIN_MS) {
    throw new ToolError(`The Google Drive access from your last sign-in has expired (Google's lasts about an hour), so the file cannot be saved. ${RECONNECT}`);
  }
  return caller.driveToken;
}

async function call(fetcher: Fetcher, token: string, url: string, init: RequestInit, what: string) {
  let res: Response;
  try {
    res = await fetcher(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ToolError(`${what} did not complete: ${(e as Error).message}`);
  }
  if (res.status === 401) throw new ToolError(`Google Drive refused the saved sign-in while ${what.toLowerCase()}. ${RECONNECT}`);
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    const hint = res.status === 403
      ? ` Check that the Google Drive API is switched on for the PolyForm Google Cloud project, and that the Drive permission was allowed at sign-in. ${RECONNECT}`
      : '';
    throw new ToolError(`${what} failed (Google Drive answered ${res.status}${detail ? `: ${detail}` : ''}).${hint}`);
  }
  return res;
}

async function folderId(fetcher: Fetcher, token: string): Promise<string> {
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await call(fetcher, token, `${API}/files?q=${q}&fields=files(id,name)&spaces=drive`, {}, 'Looking for the PolyForm folder in Drive')).json();
  if (found.files?.length) return found.files[0].id as string;
  const created = await (await call(fetcher, token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  }, 'Creating the PolyForm folder in Drive')).json();
  return created.id as string;
}

/** Saves `text` as a new file in the person's Drive "PolyForm" folder. */
export async function saveToDrive(caller: Caller, fileName: string, text: string, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<SavedFile> {
  const token = driveTokenFor(caller);
  const parent = await folderId(fetcher, token);
  const boundary = `polyform${Math.random().toString(36).slice(2)}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name: fileName, mimeType: MIME, parents: [parent] }),
    `--${boundary}`,
    `Content-Type: ${MIME}`,
    '',
    text,
    `--${boundary}--`,
  ].join('\r\n');
  const file = await (await call(fetcher, token, `${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  }, 'Saving the file to Google Drive')).json();
  return { fileId: file.id, fileName: file.name, webUrl: file.webViewLink, location: `My Drive › ${FOLDER_NAME}` };
}
