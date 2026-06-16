/*
 * Scanned-directory exclusion policy for the sidecar.
 *
 * The Kotlin host forwards the user's "Excluded directories" setting as the
 * `AI_COACH_EXCLUDED_DIRS` environment variable (the platform path separator
 * joins the entries). This module is the sidecar-side owner of the contract so
 * the entry point and the tests agree on one parsing/matching implementation.
 *
 * It is applied at the sidecar-owned discovery seam — `findLogsDirs()` results
 * in `rpc-server.ts` and `mcp-server.ts` (Copilot CLI). Claude / Codex / OpenCode
 * discovery lives in the vendored `parser-harnesses.ts` and reads the same env
 * var via the sanctioned patch `tools/patches/0007-dir-exclusion-env.patch`.
 *
 * A directory is excluded when it equals an excluded entry or is nested under
 * one, so excluding `~/.claude` also excludes `~/.claude/projects/foo`.
 */

import * as path from 'node:path';

/** Env var carrying the platform-path-separator-joined exclusion list. */
export const EXCLUDED_DIRS_ENV = 'AI_COACH_EXCLUDED_DIRS';

/** The configured exclusion roots for this run, normalized and de-duplicated. */
export function excludedDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[EXCLUDED_DIRS_ENV];
  if (!raw || !raw.trim()) return [];
  const seen = new Set<string>();
  for (const entry of raw.split(path.delimiter)) {
    const trimmed = entry.trim();
    if (trimmed) seen.add(path.resolve(trimmed));
  }
  return [...seen];
}

/** True when [dir] equals an excluded root or is nested under one. */
export function isExcluded(dir: string, excluded: string[] = excludedDirs()): boolean {
  if (excluded.length === 0) return false;
  const normalized = path.resolve(dir);
  return excluded.some(root => normalized === root || normalized.startsWith(root + path.sep));
}

/** Drop every directory in [dirs] that is excluded. */
export function filterExcludedDirs(dirs: string[], excluded: string[] = excludedDirs()): string[] {
  if (excluded.length === 0) return dirs;
  return dirs.filter(dir => !isExcluded(dir, excluded));
}
