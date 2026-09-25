import { auth } from '../../firebase';
import { GoogleDriveProvider } from './googleDrive';
import { TrimbleConnectProvider, trimbleConfigFromEnv } from './trimbleConnect';
import type { ExternalLocation, StorageProvider } from './providers';

/** The app's storage providers (one of each, shared by every screen). */
export const storageProviders: Record<ExternalLocation, StorageProvider> = {
  'google-drive': new GoogleDriveProvider(() => auth),
  'trimble-connect': new TrimbleConnectProvider(
    trimbleConfigFromEnv(import.meta.env as Record<string, string | undefined>, typeof window === 'undefined' ? '' : window.location.origin),
  ),
};

export const STORAGE_LABELS: Record<'polyform' | ExternalLocation, string> = {
  polyform: 'PolyForm cloud',
  'google-drive': 'Google Drive',
  'trimble-connect': 'Trimble Connect',
};
