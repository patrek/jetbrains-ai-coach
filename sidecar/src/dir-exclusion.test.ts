import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCLUDED_DIRS_ENV, excludedDirs, filterExcludedDirs, isExcluded } from './dir-exclusion';

const env = (value: string) => ({ [EXCLUDED_DIRS_ENV]: value }) as NodeJS.ProcessEnv;

describe('dir-exclusion', () => {
  describe('excludedDirs', () => {
    it('returns an empty list when the env var is unset or blank', () => {
      expect(excludedDirs({})).toEqual([]);
      expect(excludedDirs(env('   '))).toEqual([]);
    });

    it('splits on the platform path delimiter, trims, and resolves to absolute', () => {
      const value = ['/home/u/.claude', '  /home/u/.codex  '].join(path.delimiter);
      expect(excludedDirs(env(value))).toEqual([
        path.resolve('/home/u/.claude'),
        path.resolve('/home/u/.codex'),
      ]);
    });

    it('drops empty entries and de-duplicates', () => {
      const value = ['/a', '', '/a', '/b'].join(path.delimiter);
      expect(excludedDirs(env(value))).toEqual([path.resolve('/a'), path.resolve('/b')]);
    });
  });

  describe('isExcluded', () => {
    const excluded = [path.resolve('/home/u/.claude')];

    it('matches the excluded root exactly', () => {
      expect(isExcluded('/home/u/.claude', excluded)).toBe(true);
    });

    it('matches a directory nested under an excluded root', () => {
      expect(isExcluded('/home/u/.claude/projects/foo', excluded)).toBe(true);
    });

    it('does not match a sibling that merely shares a prefix string', () => {
      expect(isExcluded('/home/u/.claude-backup', excluded)).toBe(false);
    });

    it('never excludes when the list is empty', () => {
      expect(isExcluded('/anything', [])).toBe(false);
    });
  });

  describe('filterExcludedDirs', () => {
    it('removes excluded directories and keeps the rest', () => {
      const dirs = ['/home/u/.claude', '/home/u/.codex', '/home/u/.claude/projects/x'];
      expect(filterExcludedDirs(dirs, [path.resolve('/home/u/.claude')])).toEqual(['/home/u/.codex']);
    });

    it('returns the input unchanged when nothing is excluded', () => {
      const dirs = ['/a', '/b'];
      expect(filterExcludedDirs(dirs, [])).toBe(dirs);
    });
  });
});
