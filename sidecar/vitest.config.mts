import { defineConfig } from 'vitest/config';

// Runs the vendored upstream test suite (copied into vendor/ by
// tools/sync-upstream.mjs). The vendored tests are byte-identical to upstream
// and assert that the shared core/webview code still behaves after a re-sync.
export default defineConfig({
  test: {
    include: ['vendor/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
