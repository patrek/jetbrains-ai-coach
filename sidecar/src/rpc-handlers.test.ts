import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveHandler, LLM_UNAVAILABLE_METHODS, type HandlerContext } from './rpc-handlers';
import { cleanRuleMarkdown } from '../vendor/webview/panel-rpc';
import type { ParseResult } from '../vendor/core/parser';
import type { Analyzer } from '../vendor/core/analyzer';
import type { Workspace } from '../vendor/core/types';

// Inject a fake CLI provider: the handlers call resolveProvider('fake') and run
// it without ever spawning a real binary.
const { fakeRun } = vi.hoisted(() => ({ fakeRun: vi.fn() }));
vi.mock('./cli-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cli-provider')>();
  return {
    ...actual,
    resolveProvider: (id: string) => (id === 'fake' ? { id: 'fake', run: fakeRun } : actual.resolveProvider(id)),
  };
});

// explainOccurrence looks the rule up via getRule; stub a single known rule so
// the provider path is reachable without a loaded rule registry.
vi.mock('../vendor/core/rule-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../vendor/core/rule-engine')>();
  return {
    ...actual,
    getRule: (id: string) =>
      id === 'rule-1' ? { id: 'rule-1', name: 'Rule One', description: 'A rule', rawSource: 'when: true' } : actual.getRule(id),
  };
});

const FAKE_PROVIDER = { id: 'fake', binaryPath: '/fake/cli' };

/** A minimal rule markdown that passes validateRuleMarkdown on the first try. */
const VALID_RULE = [
  '---',
  'id: generated-rule',
  'name: Generated Rule',
  'group: prompt-quality',
  'severity: low',
  'scope: requests',
  '---',
  '',
  '# Description',
  'A generated rule.',
  '',
  '# When Triggered',
  '{{count}} occurrences.',
  '',
  '# How to Improve',
  'Improve it.',
  '',
  '# Detection Logic',
  '```detect',
  'scan: requests',
  'match: messageLength > 0',
  'check: count > 1',
  '```',
].join('\n');

/** A session shaped just enough for buildOccurrenceSessionSummary. */
function analyzerWithSession(sessionId: string): Analyzer {
  const session = { sessionId, workspaceName: 'w', requestCount: 0, harness: 'claude', requests: [] };
  return { filterSessions: () => [session] } as unknown as Analyzer;
}

afterEach(() => {
  fakeRun.mockReset();
});

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
   it('degrades every still-unavailable LLM method to the typed error', async () => {
    // generateRule + explainOccurrence left the set when they were wired to a
    // provider, dropping it from 12 to 10. compileNlRule and the 9 extension
    // LLM methods remain.
    expect(LLM_UNAVAILABLE_METHODS.size).toBe(10);
    expect(LLM_UNAVAILABLE_METHODS.has('generateRule')).toBe(false);
    expect(LLM_UNAVAILABLE_METHODS.has('explainOccurrence')).toBe(false);
    expect(LLM_UNAVAILABLE_METHODS.has('compileNlRule')).toBe(true);
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

describe('generateRule (provider-wired)', () => {
  it('returns the cleaned rule markdown on a provider success', async () => {
    fakeRun.mockResolvedValue({ ok: true, text: VALID_RULE });
    const handler = resolveHandler('generateRule')!;
    const result = await handler(ctx({ provider: FAKE_PROVIDER, params: { prompt: 'lazy prompts' } }));
    expect(result).toEqual({ markdown: cleanRuleMarkdown(VALID_RULE) });
    expect(fakeRun).toHaveBeenCalledTimes(1); // valid first try, no retry
  });

  it('degrades to llm-unavailable + reason on a provider failure', async () => {
    fakeRun.mockResolvedValue({ ok: false, reason: 'timeout' });
    const handler = resolveHandler('generateRule')!;
    const result = await handler(ctx({ provider: FAKE_PROVIDER, params: { prompt: 'x' } }));
    expect(result).toEqual({ error: 'llm-unavailable', reason: 'timeout' });
  });

  it('degrades to a bare llm-unavailable when no provider is stamped', async () => {
    const handler = resolveHandler('generateRule')!;
    const result = await handler(ctx({ params: { prompt: 'x' } }));
    expect(result).toEqual({ error: 'llm-unavailable' });
    expect(fakeRun).not.toHaveBeenCalled(); // never reaches a provider
  });

  it('retries with the prior attempt + issues, then returns the last attempt', async () => {
    fakeRun
      .mockResolvedValueOnce({ ok: true, text: 'not a valid rule' })
      .mockResolvedValueOnce({ ok: true, text: 'still invalid' })
      .mockResolvedValueOnce({ ok: true, text: VALID_RULE });
    const handler = resolveHandler('generateRule')!;
    const result = await handler(ctx({ provider: FAKE_PROVIDER, params: { prompt: 'x' } }));
    expect(result).toEqual({ markdown: cleanRuleMarkdown(VALID_RULE) });
    expect(fakeRun).toHaveBeenCalledTimes(3); // 2 attempts + 1 final
    // The retry prompt embeds the prior attempt and its validation issues.
    expect(fakeRun.mock.calls[1][0]).toContain('not a valid rule');
    expect(fakeRun.mock.calls[1][0]).toContain('issues');
  });

  it('degrades mid-retry if the provider fails after a first invalid attempt', async () => {
    fakeRun
      .mockResolvedValueOnce({ ok: true, text: 'not a valid rule' })
      .mockResolvedValueOnce({ ok: false, reason: 'cli-error' });
    const handler = resolveHandler('generateRule')!;
    const result = await handler(ctx({ provider: FAKE_PROVIDER, params: { prompt: 'x' } }));
    expect(result).toEqual({ error: 'llm-unavailable', reason: 'cli-error' });
    expect(fakeRun).toHaveBeenCalledTimes(2);
  });
});

describe('explainOccurrence (provider-wired)', () => {
  it('returns the trimmed explanation on a provider success', async () => {
    fakeRun.mockResolvedValue({ ok: true, text: '  this session matches  ' });
    const handler = resolveHandler('explainOccurrence')!;
    const result = await handler(
      ctx({ provider: FAKE_PROVIDER, analyzer: analyzerWithSession('sess-1'), params: { ruleId: 'rule-1', sessionId: 'sess-1' } }),
    );
    expect(result).toEqual({ ok: true, explanation: 'this session matches' });
  });

  it('degrades to llm-unavailable + reason on a provider failure', async () => {
    fakeRun.mockResolvedValue({ ok: false, reason: 'cli-error' });
    const handler = resolveHandler('explainOccurrence')!;
    const result = await handler(
      ctx({ provider: FAKE_PROVIDER, analyzer: analyzerWithSession('sess-1'), params: { ruleId: 'rule-1', sessionId: 'sess-1' } }),
    );
    expect(result).toEqual({ error: 'llm-unavailable', reason: 'cli-error' });
  });

  it('degrades to a bare llm-unavailable when no provider is stamped', async () => {
    const handler = resolveHandler('explainOccurrence')!;
    const result = await handler(
      ctx({ analyzer: analyzerWithSession('sess-1'), params: { ruleId: 'rule-1', sessionId: 'sess-1' } }),
    );
    expect(result).toEqual({ error: 'llm-unavailable' });
    expect(fakeRun).not.toHaveBeenCalled();
  });

  it('returns an input error (not a provider call) for a missing session', async () => {
    const handler = resolveHandler('explainOccurrence')!;
    const result = await handler(
      ctx({ provider: FAKE_PROVIDER, analyzer: analyzerWithSession('other'), params: { ruleId: 'rule-1', sessionId: 'missing' } }),
    );
    expect(result).toEqual({ ok: false, explanation: '', error: 'Session not found' });
    expect(fakeRun).not.toHaveBeenCalled();
  });
});
