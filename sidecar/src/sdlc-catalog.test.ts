import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveHandler, type HandlerContext } from './rpc-handlers';
import type { ParseResult } from '../vendor/core/parser';
import type { Analyzer } from '../vendor/core/analyzer';
import type { Session, Workspace } from '../vendor/core/types';

const tempDirs: string[] = [];
let savedHome: string | undefined;
const realFetch = globalThis.fetch;
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  if (savedHome !== undefined) {
    process.env.HOME = savedHome;
    savedHome = undefined;
  }
  globalThis.fetch = realFetch;
});

/** Minimal `Response` stub for the no-`body` text path of `readTextWithByteLimit`. */
function textResponse(body: string, ok = true): Response {
  return {
    ok,
    body: null,
    headers: { get: () => null },
    text: async () => body,
  } as unknown as Response;
}

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function parseResult(over: Partial<ParseResult> = {}): ParseResult {
  return { workspaces: new Map(), sessions: [], editLocIndex: new Map(), sessionSourceIndex: new Map(), ...over };
}

function ctx(over: Partial<HandlerContext> = {}): HandlerContext {
  return { analyzer: {} as Analyzer, parseResult: parseResult(), params: {}, ...over };
}

function session(workspaceId: string, workspaceName: string, harness: string, tools: string[]): Session {
  return {
    workspaceId,
    workspaceName,
    harness,
    creationDate: 1,
    lastMessageDate: 2,
    requests: [{ toolsUsed: tools }],
  } as unknown as Session;
}

describe('getSdlcToolAnalysis', () => {
  it('counts mcp_ tool usage per server, labels known servers, and sorts by call count', () => {
    const sessions = [
      session('w1', 'acme', 'Claude', ['mcp_github_create_pr', 'mcp_github_list', 'read_file']),
      session('w1', 'acme', 'Claude', ['mcp_customserver_do', 'mcp_github_create_pr']),
    ];
    const handler = resolveHandler('getSdlcToolAnalysis')!;
    const { mcpServers } = handler(ctx({ parseResult: parseResult({ sessions }) })) as {
      mcpServers: Array<{ id: string; label: string; toolCalls: number; isSdlcRelevant: boolean }>;
    };

    expect(mcpServers[0]).toMatchObject({ id: 'github', label: 'GitHub', toolCalls: 3, isSdlcRelevant: true });
    const custom = mcpServers.find((s) => s.id === 'customserver');
    expect(custom).toMatchObject({ label: 'customserver', toolCalls: 1, isSdlcRelevant: false });
  });

  it('honors the workspace filter', () => {
    const sessions = [
      session('w1', 'acme', 'Claude', ['mcp_github_x']),
      session('w2', 'other', 'Claude', ['mcp_jira_y']),
    ];
    const handler = resolveHandler('getSdlcToolAnalysis')!;
    const { mcpServers } = handler(ctx({ parseResult: parseResult({ sessions }), params: { filter: { workspaceId: 'w1' } } })) as {
      mcpServers: Array<{ id: string }>;
    };
    expect(mcpServers.map((s) => s.id)).toEqual(['github']);
  });
});

describe('getSdlcRepoScan', () => {
  it('reports the GitHub remote and .github layout for each resolved workspace root', () => {
    const root = tempDir('aicoach-repo-');
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'config'), '[remote "origin"]\n  url = git@github.com:acme/widget.git\n');
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci');
    fs.writeFileSync(path.join(root, '.github', 'copilot-instructions.md'), '# hi');

    const workspaces = new Map<string, Workspace>([['w1', { id: 'w1', name: 'widget', path: root }]]);
    const handler = resolveHandler('getSdlcRepoScan')!;
    const { repos } = handler(ctx({ parseResult: parseResult({ workspaces }) })) as {
      repos: Array<{ workspace: string; remote: string | null; workflows: string[]; contextFiles: string[] }>;
    };

    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ workspace: 'widget', remote: 'acme/widget', workflows: ['ci.yml'] });
    expect(repos[0].contextFiles).toContain('copilot-instructions.md');
  });

  it('skips workspaces whose root cannot be resolved', () => {
    const workspaces = new Map<string, Workspace>([['w1', { id: 'w1', name: 'ghost', path: '/nonexistent' }]]);
    const handler = resolveHandler('getSdlcRepoScan')!;
    const { repos } = handler(ctx({ parseResult: parseResult({ workspaces }) })) as { repos: unknown[] };
    expect(repos).toEqual([]);
  });
});

describe('installSkill', () => {
  it('writes the skill under ~/.agents/skills and returns its path', async () => {
    const home = tempDir('aicoach-home-');
    savedHome = process.env.HOME;
    process.env.HOME = home;

    const handler = resolveHandler('installSkill')!;
    const result = (await handler(ctx({ params: { filename: 'my-skill.md', content: '# Skill' } }))) as { ok: boolean; path: string };
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(result.path, 'utf8')).toBe('# Skill');
    expect(result.path.startsWith(path.join(home, '.agents', 'skills'))).toBe(true);
  });

  it('rejects a path-traversal filename without writing', async () => {
    const home = tempDir('aicoach-home-');
    savedHome = process.env.HOME;
    process.env.HOME = home;

    const handler = resolveHandler('installSkill')!;
    const result = (await handler(ctx({ params: { filename: '../evil.md', content: 'x' } }))) as { error?: string };
    expect(result.error).toBeTruthy();
    expect(fs.existsSync(path.join(home, '.agents'))).toBe(false);
  });

  it('errors on missing content', async () => {
    const handler = resolveHandler('installSkill')!;
    const result = (await handler(ctx({ params: { filename: 'x.md' } }))) as { error?: string };
    expect(result.error).toBe('Missing filename or content');
  });
});

describe('installCatalogItem path guard', () => {
  it('rejects a traversal or absolute catalog path before any fetch', async () => {
    let fetched = false;
    globalThis.fetch = (async () => { fetched = true; return textResponse(''); }) as typeof fetch;
    const handler = resolveHandler('installCatalogItem')!;
    for (const bad of ['../secrets', '/etc/passwd', 'a/../b']) {
      const result = (await handler(ctx({ params: { path: bad, title: 'x' } }))) as { error?: string };
      expect(result.error).toBe('Invalid catalog path');
    }
    expect(fetched, 'a rejected path must never reach the network').toBe(false);
  });
});

describe('installCatalogItem happy path', () => {
  it('fetches the raw catalog file and writes it under ~/.agents/<kind>/<slug>/', async () => {
    const home = tempDir('aicoach-home-');
    savedHome = process.env.HOME;
    process.env.HOME = home;

    let requestedUrl = '';
    globalThis.fetch = (async (url: string | URL) => {
      requestedUrl = String(url);
      return textResponse('# My Skill body');
    }) as typeof fetch;

    const handler = resolveHandler('installCatalogItem')!;
    const result = (await handler(ctx({ params: { path: 'skills/foo.md', kind: 'skill', title: 'My Skill' } }))) as {
      content?: string;
      filename?: string;
    };

    expect(requestedUrl).toBe('https://raw.githubusercontent.com/github/awesome-copilot/main/skills/foo.md');
    expect(result.content).toBe('# My Skill body');
    expect(result.filename).toBe('my-skill/foo.md');
    const written = path.join(home, '.agents', 'skills', 'my-skill', 'foo.md');
    expect(fs.readFileSync(written, 'utf8')).toBe('# My Skill body');
  });

  it('rejects a non-OK fetch with a typed error, not a throw', async () => {
    const home = tempDir('aicoach-home-');
    savedHome = process.env.HOME;
    process.env.HOME = home;
    globalThis.fetch = (async () => textResponse('', false)) as typeof fetch;

    const handler = resolveHandler('installCatalogItem')!;
    const result = (await handler(ctx({ params: { path: 'skills/foo.md', title: 'X' } }))) as { error?: string };
    expect(result.error).toContain('Failed to fetch');
  });
});

describe('discoverCatalog', () => {
  it('returns the items/totalScanned shape (empty when the catalog is unreachable)', async () => {
    globalThis.fetch = (async () => textResponse('', false)) as typeof fetch;
    const handler = resolveHandler('discoverCatalog')!;
    const result = (await handler(ctx())) as { items?: unknown[]; totalScanned?: number };
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.totalScanned).toBe(result.items!.length);
  });
});

describe('handler registration', () => {
  it('resolves every ported SDLC/catalog method to a function', () => {
    for (const method of ['getSdlcToolAnalysis', 'getSdlcRepoScan', 'discoverCatalog', 'installSkill', 'installCatalogItem']) {
      expect(resolveHandler(method), method).toBeTypeOf('function');
    }
  });
});
