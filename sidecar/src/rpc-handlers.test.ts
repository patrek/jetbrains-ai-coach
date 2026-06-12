import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveHandler, LLM_UNAVAILABLE_METHODS, type HandlerContext } from './rpc-handlers';
import type { ParseResult } from '../vendor/core/parser';
import type { Analyzer } from '../vendor/core/analyzer';
import type { Workspace } from '../vendor/core/types';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function emptyParseResult(workspaces: Map<string, Workspace> = new Map()): ParseResult {
  return { workspaces, sessions: [], editLocIndex: new Map(), sessionSourceIndex: new Map() };
}

function ctx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    analyzer: {} as Analyzer,
    parseResult: emptyParseResult(),
    params: {},
    ...overrides,
  };
}

describe('resolveHandler precedence', () => {
  it('degrades every LLM method to the typed error (LLM set wins)', async () => {
    expect(LLM_UNAVAILABLE_METHODS.size).toBe(12);
    for (const method of LLM_UNAVAILABLE_METHODS) {
      const handler = resolveHandler(method);
      expect(handler, `no handler for ${method}`).toBeTypeOf('function');
      await expect(Promise.resolve(handler!(ctx()))).resolves.toEqual({ error: 'llm-unavailable' });
    }
  });

  it('uses the saveRule override (not the vendored handler)', async () => {
    const handler = resolveHandler('saveRule');
    expect(handler).toBeTypeOf('function');
    // Empty markdown short-circuits to { ok: false } in the override.
    await expect(Promise.resolve(handler!(ctx({ params: { markdown: '' } })))).resolves.toEqual({ ok: false });
  });

  it('falls through to a vendored handler for a plain core method', () => {
    expect(resolveHandler('getStats')).toBeTypeOf('function');
  });

  it('returns undefined for an unknown method', () => {
    expect(resolveHandler('totallyNotAMethod')).toBeUndefined();
  });
});

describe('getWorkspaceDeps', () => {
  it('reads dependencies from each workspace package.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicoach-deps-'));
    tempDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { left: '1.0.0' }, devDependencies: { vitest: '4.0.0' } }),
      'utf-8',
    );

    const workspaces = new Map<string, Workspace>([['w1', { id: 'w1', name: 'acme', path: dir }]]);
    const handler = resolveHandler('getWorkspaceDeps')!;
    const result = handler(ctx({ parseResult: emptyParseResult(workspaces) })) as {
      deps: { workspace: string; dependencies: string[]; devDependencies: string[] }[];
    };

    expect(result.deps).toEqual([{ workspace: 'acme', dependencies: ['left'], devDependencies: ['vitest'] }]);
  });

  it('skips workspaces without a readable package.json', () => {
    const workspaces = new Map<string, Workspace>([['w1', { id: 'w1', name: 'ghost', path: '/nonexistent/path' }]]);
    const handler = resolveHandler('getWorkspaceDeps')!;
    const result = handler(ctx({ parseResult: emptyParseResult(workspaces) })) as { deps: unknown[] };
    expect(result.deps).toEqual([]);
  });

  it('clamps a negative limit instead of dropping items off the end', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aicoach-deps-'));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf-8');
    const workspaces = new Map<string, Workspace>([['w1', { id: 'w1', name: 'acme', path: dir }]]);
    const handler = resolveHandler('getWorkspaceDeps')!;
    const result = handler(ctx({ parseResult: emptyParseResult(workspaces), params: { limit: -5 } })) as { deps: unknown[] };
    expect(result.deps).toEqual([]); // clamped to 0, not a negative slice
  });
});
