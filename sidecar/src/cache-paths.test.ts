import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CACHE_DIR_ENV, cacheFilePaths, defaultCacheDir, resolveCacheDir } from './cache-paths';

describe('cache-paths', () => {
  it('defaults to ~/.ai-coach-jetbrains/cache (decision D1)', () => {
    expect(defaultCacheDir()).toBe(path.join(os.homedir(), '.ai-coach-jetbrains', 'cache'));
  });

  it('honors the AI_COACH_CACHE_DIR override', () => {
    expect(resolveCacheDir({ [CACHE_DIR_ENV]: '/tmp/custom-cache' })).toBe('/tmp/custom-cache');
  });

  it('falls back to the default when the override is empty or unset', () => {
    expect(resolveCacheDir({})).toBe(defaultCacheDir());
    expect(resolveCacheDir({ [CACHE_DIR_ENV]: '   ' })).toBe(defaultCacheDir());
  });

  it('derives the parsed/meta file paths under the cache dir', () => {
    expect(cacheFilePaths('/c')).toEqual({
      parsed: path.join('/c', 'parsed.json'),
      meta: path.join('/c', 'meta.json'),
    });
  });
});
