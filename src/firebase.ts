import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1'); // Default region, change if you deployed elsewhere
export const googleProvider = new GoogleAuthProvider();

// Validate connection to Firestore on initialization
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('unavailable'))) {
      console.warn('[FIRESTORE] Connection check: client operating in offline mode or network delayed.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

let quotaLockdownUntil = 0;

export const isQuotaLocked = () => Date.now() < quotaLockdownUntil;
export const getQuotaLockdownUntil = () => quotaLockdownUntil;

export interface FirestoreErrorResult {
  isQuotaError: boolean;
  isOfflineError: boolean;
  message: string;
}

// Every call site treats this as fire-and-forget from inside a catch block or
// an onSnapshot error callback, so throwing here (as this used to do for the
// generic case) never reaches a handler - it only produces an unhandled
// promise rejection or an uncaught exception. Callers that want to surface
// something to the user should read the returned classification instead.
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): FirestoreErrorResult {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCode = (error as any)?.code as string | undefined;
  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }

  console.error('Firestore Error: ', JSON.stringify(errInfo));

  const isQuotaError = errorCode === 'resource-exhausted' || errorMessage.includes('Quota exceeded');
  const isOfflineError = !isQuotaError && (
    errorCode === 'unavailable' ||
    errorMessage.includes('unavailable') ||
    errorMessage.includes('client is offline') ||
    errorMessage.includes('offline')
  );

  // If quota exceeded, initiate global lockdown
  if (isQuotaError) {
     quotaLockdownUntil = Date.now() + 600000; // 10 minute lockdown
     console.warn(`[QUOTA] Global lockdown initiated until ${new Date(quotaLockdownUntil).toLocaleTimeString()}`);
  } else if (isOfflineError) {
    console.warn(`[FIRESTORE] Backend currently unreachable (${errorMessage}). Operating in offline mode.`);
  }

  return {
    isQuotaError,
    isOfflineError,
    message: isQuotaError
      ? 'Cloud save quota exceeded - saving is paused for 10 minutes.'
      : isOfflineError
        ? 'No connection to the cloud - your changes will save once you are back online.'
        : errorMessage
  };
}
