import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register Service Worker for CORS and Stability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/_service-worker.js')
      .then(registration => {
        console.log('[SYSTEM] ServiceWorker registered:', registration.scope);
      })
      .catch(error => {
        console.error('[SYSTEM] ServiceWorker registration failed:', error);
      });

    // The service worker calls self.skipWaiting() + clients.claim()
    // unconditionally on every install/activate, so a new deploy takes
    // over network requests for this already-open tab immediately —
    // silently, with no reload. The currently-running JS in memory is now
    // the OLD bundle talking to a NEW service worker, which used to have
    // no user-facing signal at all. This is the standard hook for that:
    // fires exactly once when a new worker takes control of this page.
    let hasReloadedForNewServiceWorker = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hasReloadedForNewServiceWorker) return;
      hasReloadedForNewServiceWorker = true;
      if (window.confirm('A new version of PolyForm is available. Reload to update?')) {
        window.location.reload();
      }
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
