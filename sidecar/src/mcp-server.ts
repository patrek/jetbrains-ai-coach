/*
 * Standalone stdio MCP server (decision D2, ADR 0002).
 *
 * Spawned directly by an MCP client (e.g. Claude Code) — NOT by the IDE. It
 * reads the same fork cache the IDE sidecar writes and parses on its own, so the
 * 12 analytics tools work with the IDE closed.
 *
 * FRESHNESS CONTRACT
 * ------------------
 * A cold parse can outrun an MCP client's per-call timeout, so we never block a
 * tool call on it. At startup we serve immediately from the disk cache (or empty
 * data when there is none) and kick off a background refresh through the vendored
 * worker pipeline, which itself is cache-aware: a fresh cache returns almost
 * instantly (the disk-cache hit), while a stale/missing cache re-parses. Until
 * that refresh resolves, every tool result is prefixed with a partial-data note
 * (see `partialDataNote`) so a client polling during a parse never mistakes
 * cached/empty figures for the complete dataset.
 *
 * HEADLESS TRUST (ADR 0005)
 * -------------------------
 * Rule-approval authority lives in the IDE host, which is not attached here. We
 * install the trust gate with an empty in-memory store (no host channel), so the
 * gated reload admits only built-in rules — every untrusted personal/project
 * rule stays pending and is excluded from tool output. Approving a rule requires
 * the IDE; the headless path simply leaves them pending.
 *
 * stdout is RESERVED for the MCP protocol (the transport writes there). The
 * vendored core's diagnostics go through `console.*`; `mcp-main.ts` redirects
 * `console.log/info/debug` to stderr before this module loads. We also skip
 * `analyzer.warmUp()` — it runs in a worker thread that inherits this process's
 * stdout, which would corrupt the protocol — and the formatters do not need it.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Analyzer } from '../vendor/core/analyzer';
import { loadCacheData } from '../vendor/core/cache';
import { findLogsDirs, parseAllLogsViaWorker } from '../vendor/core/parser';
import type { ParseResult } from '../vendor/core/parser';
import { createHostTrustMemento, installTrustMemento } from './host-shims';
import { filterExcludedDirs } from './dir-exclusion';
import { ruleScope } from './rule-scope';
import { MCP_TOOL_DEFS, partialDataNote, runTool } from './mcp-tools';

const SERVER_NAME = 'ai-engineer-coach';
const SERVER_VERSION = '0.1.0';

function emptyParseResult(): ParseResult {
  return {
    workspaces: new Map(),
    sessions: [],
    editLocIndex: new Map(),
    sessionSourceIndex: new Map(),
  };
}

/**
 * What the server needs from its data source to answer a tool call: the current
 * analyzer plus the freshness signals that drive the partial-data note. The
 * minimal surface lets tests drive `createMcpServer` with a fake instead of the
 * worker-backed lifecycle.
 */
export interface McpToolSource {
  getAnalyzer(): Analyzer;
  readonly isParsing: boolean;
  readonly currentSessionCount: number;
}

/**
 * Owns the analyzer and the cache-first / background-refresh lifecycle. Tools
 * read the current analyzer through `getAnalyzer()`; `isParsing` gates the
 * partial-data note.
 */
export class McpDataSource implements McpToolSource {
  private analyzer: Analyzer = new Analyzer([]);
  private sessionCount = 0;
  private parsing = true;

  /** Whether the background refresh is still running (figures may be partial). */
  get isParsing(): boolean {
    return this.parsing;
  }

  /** Session count behind the current analyzer (for the partial-data note). */
  get currentSessionCount(): number {
    return this.sessionCount;
  }

  getAnalyzer(): Analyzer {
    return this.analyzer;
  }

  /**
   * Install the headless trust gate, serve from the disk cache immediately, and
   * start the background refresh. Resolves as soon as cached data is in place —
   * it does NOT await the refresh.
   */
  async init(): Promise<void> {
    installTrustMemento(createHostTrustMemento());
    ruleScope.install();

    const cached = await loadCacheData();
    this.setResult(cached?.result ?? emptyParseResult());

    void this.refresh();
  }

  private setResult(result: ParseResult): void {
    this.analyzer = new Analyzer(result.sessions, result.editLocIndex, result.workspaces);
    this.sessionCount = result.sessions.length;
  }

  private async refresh(): Promise<void> {
    try {
      const result = await parseAllLogsViaWorker(filterExcludedDirs(findLogsDirs()));
      this.setResult(result);
    } catch (err) {
      process.stderr.write(`[mcp] background parse failed: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      this.parsing = false;
    }
  }
}

/** Build the MCP `Server`, registering the tool list and call dispatch. */
export function createMcpServer(source: McpToolSource): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: MCP_TOOL_DEFS.map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const { text, isError } = runTool(source.getAnalyzer(), name, args);
    const note = source.isParsing ? partialDataNote(source.currentSessionCount) : '';
    return { content: [{ type: 'text', text: note + text }], isError };
  });

  return server;
}

/** Entry point: load data, wire the server, and connect the stdio transport. */
export async function startMcpServer(): Promise<void> {
  const source = new McpDataSource();
  await source.init();
  const server = createMcpServer(source);
  await server.connect(new StdioServerTransport());
}
