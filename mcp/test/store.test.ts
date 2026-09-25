import { describe, expect, it } from 'vitest';
import { externalStorageError } from '../src/store';

describe('models kept in Drive or Trimble Connect', () => {
  it('are explained, not opened', () => {
    expect(externalStorageError('House', { provider: 'google-drive', fileId: 'f' })?.message).toMatch(/stored in Google Drive/);
    expect(externalStorageError('House', { provider: 'trimble-connect', fileId: 'f' })?.message).toMatch(/Trimble Connect/);
    expect(externalStorageError('House', undefined)).toBeNull();
  });
});
