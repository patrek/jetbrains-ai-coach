/* Covers the directory-exclusion behavior inlined into the vendored
 * parser-harnesses.ts by tools/patches/0007-dir-exclusion-env.patch. That
 * `excludeScannedDirs` helper is not exported, so it is exercised through the
 * exported `hasExternalHarnessSources`. This test is sidecar-owned (not in
 * vendor/) so it survives an upstream re-sync, unlike the vendored harness test. */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasExternalHarnessSources } from '../vendor/core/parser-harnesses';

const EXCLUDED_ENV = 'AI_COACH_EXCLUDED_DIRS';

function withHome(setup: (home: string) => void, body: (home: string) => void): void {
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'excl-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    setup(home);
    body(home);
  } finally {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

describe('parser-harnesses directory exclusion (patch 0007)', () => {
  afterEach(() => { delete process.env[EXCLUDED_ENV]; });

  const seedClaude = (home: string) => fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });

  it('finds the harness source when nothing is excluded', () => {
    withHome(seedClaude, () => {
      delete process.env[EXCLUDED_ENV];
      expect(hasExternalHarnessSources()).toBe(true);
    });
  });

  it('drops the harness source when its root is excluded', () => {
    withHome(seedClaude, (home) => {
      process.env[EXCLUDED_ENV] = path.join(home, '.claude');
      expect(hasExternalHarnessSources()).toBe(false);
    });
  });

  it('keeps the source when a different directory is excluded', () => {
    withHome(seedClaude, (home) => {
      process.env[EXCLUDED_ENV] = path.join(home, '.codex');
      expect(hasExternalHarnessSources()).toBe(true);
    });
  });
});
