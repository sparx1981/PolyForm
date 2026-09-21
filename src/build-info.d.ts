// Injected by vite.config.ts's `define` at build time, so the running app can report exactly
// which commit/build it was compiled from (see AIDiagnosticLog.tsx) - useful for confirming a
// tester is actually running the build that contains a given fix, not a stale cached one.
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;
