import { readFile } from 'node:fs/promises';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { createApp } from './http';
import { FirestoreStore } from './store';
import { AppRenderer } from './render';

/** Production wiring from environment variables (see README). */
function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function serviceAccount() {
  const raw = env('FIREBASE_SERVICE_ACCOUNT').trim();
  return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
}

let handler: ReturnType<typeof createApp> | null = null;

export function getHandler() {
  if (handler) return handler;
  const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount()), projectId: firebaseConfig.projectId });
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  const auth = getAuth(app);
  const secret = env('TOKEN_SECRET');
  if (secret.length < 32) throw new Error('TOKEN_SECRET must be at least 32 characters');
  const appUrl = env('POLYFORM_APP_URL', 'https://gen-lang-client-0540185995.web.app');
  handler = createApp({
    oauth: {
      secret,
      allowedEmails: env('ALLOWED_EMAILS').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
    },
    store: new FirestoreStore(db, () => FieldValue.serverTimestamp()),
    renderer: new AppRenderer(appUrl, uid => auth.createCustomToken(uid), undefined, process.env.APP_BYPASS_SECRET || undefined),
    verifyIdToken: async idToken => {
      const t = await auth.verifyIdToken(idToken);
      return { uid: t.uid, email: t.email, email_verified: t.email_verified, name: t.name };
    },
    firebaseWebConfig: {
      apiKey: firebaseConfig.apiKey,
      authDomain: firebaseConfig.authDomain,
      projectId: firebaseConfig.projectId,
      appId: firebaseConfig.appId,
    },
    baseUrl: process.env.PUBLIC_URL,
    loginScript: () => readFile(new URL('./login.js', import.meta.url), 'utf8'),
  });
  return handler;
}

export default async function (req: any, res: any) {
  return getHandler()(req, res);
}
