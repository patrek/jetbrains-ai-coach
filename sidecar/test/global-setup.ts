/*
 * Vitest global setup: build the sidecar bundle and generate fixtures once
 * before the integration tests run. Both are prerequisites for spawning
 * `dist/main.js` and driving it against real-shaped logs.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { generateFixtures } from './fixtures/generate-fixtures.mjs';
import { SIDECAR_ROOT, FIXTURE_HOME, FIXTURE_CACHE_DIR, FIXTURE_SESSION_COUNT } from './paths';

export default function setup(): void {
  // Build the bundles the integration tests spawn.
  execFileSync('node', ['esbuild.mjs'], { cwd: SIDECAR_ROOT, stdio: 'inherit' });

  // Generate the synthetic Claude logs under the fixture HOME.
  fs.mkdirSync(FIXTURE_HOME, { recursive: true });
  generateFixtures(FIXTURE_HOME, { sessions: FIXTURE_SESSION_COUNT });

  // Start each run from a clean cache dir so cold/warm-start tests are honest.
  fs.rmSync(FIXTURE_CACHE_DIR, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_CACHE_DIR, { recursive: true });
}
