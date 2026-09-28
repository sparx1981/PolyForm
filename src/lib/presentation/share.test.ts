// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// loadPresentation goes through the Firestore and Storage SDKs directly; these mocks stand in
// for both so the test can control what each call returns without a real Firebase project.
const getDocMock = vi.fn();
const getBytesMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  collection: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage: unknown, path: string) => ({ path })),
  getBytes: (...args: unknown[]) => getBytesMock(...args),
  getDownloadURL: vi.fn(),
  uploadBytes: vi.fn(),
  uploadString: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock('../../firebase', () => ({ db: {}, storage: {} }));

const { loadPresentation, ShareNotFoundError } = await import('./share');

function docSnap(exists: boolean, data?: unknown) {
  return { exists: () => exists, data: () => data };
}

describe('loadPresentation', () => {
  beforeEach(() => {
    getDocMock.mockReset();
    getBytesMock.mockReset();
  });

  it('throws ShareNotFoundError when the share link is gone', async () => {
    getDocMock.mockResolvedValue(docSnap(false));
    await expect(loadPresentation('missing-id')).rejects.toBeInstanceOf(ShareNotFoundError);
    expect(getBytesMock).not.toHaveBeenCalled();
  });

  it('returns the parsed bundle on success', async () => {
    const meta = { version: 1, storagePath: 'presentations/owner/id/project.json' };
    getDocMock.mockResolvedValue(docSnap(true, meta));
    const bundle = { project: { shapes: [] }, roomNames: [], bom: [] };
    getBytesMock.mockResolvedValue(new TextEncoder().encode(JSON.stringify(bundle)));

    const result = await loadPresentation('some-id');
    expect(result.meta).toEqual(meta);
    expect(result.bundle).toEqual(bundle);
  });

  it('turns a Storage read failure (e.g. missing bucket CORS) into a clear, actionable error', async () => {
    getDocMock.mockResolvedValue(docSnap(true, { version: 1, storagePath: 'presentations/owner/id/project.json' }));
    getBytesMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(loadPresentation('some-id')).rejects.toThrow(/CORS/i);
    // The original SDK/network error is kept, not swallowed, so real debugging still works.
    await expect(loadPresentation('some-id')).rejects.toThrow(/Failed to fetch/);
    // And it must not be mistaken for "the link doesn't exist".
    await expect(loadPresentation('some-id')).rejects.not.toBeInstanceOf(ShareNotFoundError);
  });
});
