import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // The kernel must be deterministic run to run (§10.3), so no retries
    // masking a flaky result.
    retry: 0,
  },
});
