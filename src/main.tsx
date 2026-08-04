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
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
