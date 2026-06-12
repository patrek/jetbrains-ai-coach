import { defineConfig } from 'vitest/config';

// Runs two suites together:
//   - vendor/**: the vendored upstream tests (byte-identical to upstream),
//     which assert the shared core/webview code still behaves after a re-sync
//     and after the fork's patches are applied.
//   - src/** and test/**: the sidecar's own unit tests plus the stdio
//     integration suite, which builds the bundle and drives it over NDJSON.
//
// The global setup builds the sidecar bundle and generates the fixture logs
// the integration suite spawns against.
export default defineConfig({
  test: {
    include: ['vendor/**/*.test.ts', 'src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    globalSetup: ['./test/global-setup.ts'],
  },
});
