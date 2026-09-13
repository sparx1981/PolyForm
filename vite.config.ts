import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  esbuild: mode === 'production' ? {
    // Strips diagnostic-only console.log/console.debug calls from the
    // production bundle (there are ~90+ of them scattered across
    // components, none behind an import.meta.env.DEV check) without
    // touching console.error/console.warn, which stay so real errors are
    // still visible in a user's browser console for support/debugging.
    pure: ['console.log', 'console.debug'],
  } : {},
}));
