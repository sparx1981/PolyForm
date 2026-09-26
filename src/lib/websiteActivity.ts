import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export type MarketingPage = 'home' | 'features' | 'claude' | 'developers' | 'sdk-docs';

export interface WebsiteActivityRecord {
  id: string;
  visitorId: string;
  sessionId: string;
  page: MarketingPage;
  path: string;
  referrer?: string;
  device: 'desktop' | 'tablet' | 'mobile';
  timestamp: Date;
}

const VISITOR_KEY = 'polyform_marketing_visitor_id';
const SESSION_KEY = 'polyform_marketing_session_id';

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return prefix + '_' + crypto.randomUUID();
  }
  return prefix + '_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getStoredId(storage: Storage | undefined, key: string, prefix: string) {
  if (!storage) return createId(prefix);
  try {
    const existing = storage.getItem(key);
    if (existing) return existing.slice(0, 100);
    const id = createId(prefix).slice(0, 100);
    storage.setItem(key, id);
    return id;
  } catch {
    return createId(prefix).slice(0, 100);
  }
}

function classifyDevice(): WebsiteActivityRecord['device'] {
  if (typeof window === 'undefined') return 'desktop';
  const width = window.innerWidth;
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/**
 * Records an anonymous marketing-page view. No names, email addresses, IP addresses,
 * query strings or full user-agent strings are stored.
 */
export async function recordWebsiteActivity(page: MarketingPage) {
  if (typeof window === 'undefined') return;

  try {
    const visitorId = getStoredId(window.localStorage, VISITOR_KEY, 'v');
    const sessionId = getStoredId(window.sessionStorage, SESSION_KEY, 's');
    const path = window.location.pathname.slice(0, 120) || '/';

    let referrer = '';
    try {
      if (document.referrer) {
        const ref = new URL(document.referrer);
        referrer = ref.hostname.slice(0, 200);
      }
    } catch {
      // Ignore malformed or unavailable referrers.
    }

    await addDoc(collection(db, 'websiteActivity'), {
      visitorId,
      sessionId,
      page,
      path,
      referrer: referrer || null,
      device: classifyDevice(),
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    // Analytics must never interfere with the marketing experience.
    console.warn('[websiteActivity] failed to record page view', err);
  }
}
