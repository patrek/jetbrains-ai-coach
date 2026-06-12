/*
 * Shared, deterministic paths for the integration tests.
 *
 * The fixture HOME and cache dir live under a fixed name in the OS temp dir so
 * the global setup (which generates them) and the test workers (separate
 * processes) agree without passing state through env.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIDECAR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Repo-relative sidecar dir (`.../sidecar`). */
export const SIDECAR_ROOT = SIDECAR_DIR;

/** The built entry the integration tests spawn. */
export const DIST_MAIN = path.join(SIDECAR_DIR, 'dist', 'main.js');

/** The fixture generator script. */
export const FIXTURE_GENERATOR = path.join(SIDECAR_DIR, 'test', 'fixtures', 'generate-fixtures.mjs');

const TEST_ROOT = path.join(os.tmpdir(), 'aicoach-sidecar-test');

/** Fixture HOME — contains `.claude/projects/...`; the sidecar reads logs here. */
export const FIXTURE_HOME = path.join(TEST_ROOT, 'home');

/** Isolated cache dir (`AI_COACH_CACHE_DIR`) so tests never touch the real one. */
export const FIXTURE_CACHE_DIR = path.join(TEST_ROOT, 'cache');

/** Number of synthetic sessions generated for the suite. */
export const FIXTURE_SESSION_COUNT = 500;
