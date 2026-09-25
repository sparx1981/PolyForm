import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

/** The only account that can see the login activity log (gated in the burger menu and the panel itself). */
export const LOGIN_ACTIVITY_ADMIN_EMAIL = 'craigtrickett@gmail.com';

export type LoginMethod = 'google' | 'password';

export interface LoginActivityRecord {
  id: string;
  email: string;
  success: boolean;
  method: LoginMethod;
  reason?: string;
  userAgent?: string;
  /** Resolved client-side from the Firestore Timestamp so the panel can sort/format without waiting on serverTimestamp() to settle. */
  timestamp: Date;
}

/**
 * Records a sign-in attempt, success or failure. Failures happen before the user is
 * authenticated, so this collection accepts unauthenticated writes (see firestore.rules) - tightly
 * validated there, and readable only by LOGIN_ACTIVITY_ADMIN_EMAIL. Never throws: a logging
 * failure must not block sign-in.
 */
export async function recordLoginActivity(entry: { email: string; success: boolean; method: LoginMethod; reason?: string }) {
  try {
    await addDoc(collection(db, 'loginActivity'), {
      email: (entry.email || '').toLowerCase().slice(0, 320),
      success: entry.success,
      method: entry.method,
      reason: entry.reason ? entry.reason.slice(0, 200) : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[loginActivity] failed to record sign-in attempt', err);
  }
}
