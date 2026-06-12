/*
 * Cache-path policy for the sidecar.
 *
 * The vendored core writes its parsed-session cache to a single directory whose
 * location it computes at module load from `AI_COACH_CACHE_DIR` (falling back to
 * `~/.ai-coach-jetbrains/cache/`). That fork divergence lives in
 * `tools/patches/0001-cache-dir-and-atomic-writes.patch`; this module is the
 * sidecar-side owner of the same policy so the entry point and the tests agree
 * on one source of truth instead of duplicating the path literal.
 *
 * Decision D1 (parent plan): the fork uses its OWN cache dir, separate from the
 * VS Code extension's `~/.copilot-analytics-cache`, to avoid a mutual
 * CACHE_VERSION eviction loop and a smaller-session-set overwrite between the
 * two hosts. Writes are atomic (temp-file + rename) and a corrupted/truncated
 * cache is treated as a miss and re-parsed — never a crash (the vendored
 * `loadCacheData` already returns `null` on any parse error).
 */

import * as os from 'node:os';
import * as path from 'node:path';

/** Env var the vendored cache module reads to locate its directory. */
export const CACHE_DIR_ENV = 'AI_COACH_CACHE_DIR';

/** The fork's default cache directory: `~/.ai-coach-jetbrains/cache/`. */
export function defaultCacheDir(): string {
  return path.join(os.homedir(), '.ai-coach-jetbrains', 'cache');
}

/**
 * The cache directory the vendored core will actually use this run: the
 * `AI_COACH_CACHE_DIR` override if set (tests and the IDE host point it at an
 * isolated dir), otherwise the fork default.
 */
export function resolveCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[CACHE_DIR_ENV];
  return override && override.trim() ? override : defaultCacheDir();
}

/** Absolute paths of the two cache files written under the cache directory. */
export function cacheFilePaths(cacheDir: string = resolveCacheDir()): {
  parsed: string;
  meta: string;
} {
  return {
    parsed: path.join(cacheDir, 'parsed.json'),
    meta: path.join(cacheDir, 'meta.json'),
  };
}
