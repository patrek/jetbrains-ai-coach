/*
 * Sidecar stdio RPC server.
 *
 * Speaks the upstream webview envelope over NDJSON (one JSON object per line):
 *
 *   in   { type:'request', id, method, params?, projectRoot?, safeMode? }
 *        { type:'host-response', id, data }                 // reply to a host-request
 *   out  { type:'hello', version, capabilities }            // handshake, sent first
 *        { type:'progress', phase, detail, pct, ... }       // pushed during parse
 *        { type:'dataReady', currentWorkspace }             // pushed when analyzer is built
 *        { type:'response', id, data }                      // reply to a request
 *        { type:'host-request', id, method, params }        // sidecar -> host (e.g. trust/*)
 *
 * On startup it parses the local CLI-harness logs (VS Code/Xcode discovery is
 * patched out — see decision D8) and builds the `Analyzer`, queuing any requests
 * that arrive mid-load. When stdin closes it exits, so it can never outlive its
 * IDE host (orphan-prevention contract with part 3).
 *
 * The `projectRoot` envelope stamp is resolved per request (no mutable global
 * scope) and threaded into the handlers that need a project rule layer.
 */

import * as readline from 'node:readline';
import type { Readable } from 'node:stream';
import { Analyzer } from '../vendor/core/analyzer';
import { findLogsDirs, parseAllLogsViaWorker } from '../vendor/core/parser';
import type { ParseResult, LoadProgress } from '../vendor/core/parser';
import { errorResult, isString, isRecord } from '../vendor/webview/panel-shared';
import { createHostTrustMemento, installTrustMemento, loadTrustSeed, type HostChannel } from './host-shims';
import { filterExcludedDirs } from './dir-exclusion';
import { resolveHandler } from './rpc-handlers';
import { ruleScope } from './rule-scope';

/** Protocol version reported in the `hello` handshake. */
export const SIDECAR_PROTOCOL_VERSION = '1.0.0';

/** How long a host-bound request (e.g. `trust/get`) waits for its
 *  `host-response` before degrading. A real IDE host answers the stubbed trust
 *  router immediately; the bound is a safety net so a host that never replies
 *  (or a standalone run with no host) can't wedge startup forever. */
const HOST_REQUEST_TIMEOUT_MS = 10_000;

/** Static capability flags the webview gates its UI on. The sidecar has no LLM
 *  or GitHub auth of its own — those live in the IDE host. */
export interface Capabilities {
  llm: boolean;
  github: boolean;
}
export const SIDECAR_CAPABILITIES: Capabilities = { llm: false, github: false };

export interface RpcServerOptions {
  /** Incoming NDJSON stream (defaults to process.stdin). */
  input?: Readable;
  /**
   * Writes one already-serialized protocol line. Defaults to process.stdout.
   * `main.ts` injects a writer captured BEFORE it redirects stdout to stderr,
   * so vendored console output can never corrupt the protocol stream.
   */
  write?: (line: string) => void;
}

type IncomingRequest = {
  id: string;
  method: string;
  params: Record<string, unknown>;
  projectRoot?: string;
  safeMode?: boolean;
};

export class RpcServer {
  private readonly input: Readable;
  private readonly writeLine: (line: string) => void;
  private analyzer: Analyzer | null = null;
  private parseResult: ParseResult | null = null;
  private dataReady = false;
  private readonly pending: IncomingRequest[] = [];
  /** In-flight host-bound requests, correlated by id on their `host-response`. */
  private hostSeq = 0;
  private readonly hostPending = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(opts: RpcServerOptions = {}) {
    this.input = opts.input ?? process.stdin;
    this.writeLine = opts.write ?? ((line) => process.stdout.write(line));
  }

  /** Start framing, emit the handshake, and kick off the data load. */
  async start(): Promise<void> {
    const rl = readline.createInterface({ input: this.input, crlfDelay: Infinity });
    rl.on('line', (line) => this.onLine(line));
    // stdin close => the host is gone => exit so we never orphan.
    this.input.on('end', () => this.shutdown());
    rl.on('close', () => this.shutdown());

    this.send({ type: 'hello', version: SIDECAR_PROTOCOL_VERSION, capabilities: SIDECAR_CAPABILITIES });

    // Trust authority lives in the IDE host (decision D5). Open the host channel,
    // seed the in-memory mirror from the host once (`trust/get`), and route
    // `update`s back through (`trust/update`). With no host attached the seed
    // degrades to empty and the mirror runs locally — the channel requests time
    // out instead of wedging startup.
    const channel: HostChannel = { request: (method, params) => this.hostRequest(method, params) };
    const seed = await loadTrustSeed(channel);
    installTrustMemento(createHostTrustMemento({ channel, seed }));

    // Install the trust gate and perform the first GATED rule/metric reload,
    // replacing the ungated personal-rules load that ran at detector-registry
    // module load. No request is served before this (loadData gates dataReady).
    ruleScope.install();

    await this.loadData();
  }

  private send(message: Record<string, unknown>): void {
    this.writeLine(`${JSON.stringify(message)}\n`);
  }

  /** Issue a host-bound RPC over stdout and resolve on its correlated
   *  `host-response`. Rejects (degrading the caller) if the host never replies. */
  private hostRequest(method: string, params: unknown): Promise<unknown> {
    const id = `h${this.hostSeq++}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.hostPending.delete(id);
        reject(new Error(`host request timed out: ${method}`));
      }, HOST_REQUEST_TIMEOUT_MS);
      // Never let a pending host reply keep the process alive past stdin close.
      timer.unref?.();
      this.hostPending.set(id, { resolve, reject, timer });
      this.send({ type: 'host-request', id, method, params });
    });
  }

  /** Resolve the pending host request a `host-response` line correlates to. */
  private onHostResponse(msg: Record<string, unknown>): void {
    if (!isString(msg.id)) return;
    const entry = this.hostPending.get(msg.id);
    if (!entry) return;
    this.hostPending.delete(msg.id);
    clearTimeout(entry.timer);
    entry.resolve(msg.data);
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // ignore non-JSON noise
    }
    if (!isRecord(msg)) return;
    if (msg.type === 'host-response') return this.onHostResponse(msg);
    if (msg.type !== 'request' || !isString(msg.id) || !isString(msg.method)) return;
    if (msg.params !== undefined && !isRecord(msg.params)) return;

    const request: IncomingRequest = {
      id: msg.id,
      method: msg.method,
      params: isRecord(msg.params) ? msg.params : {},
      projectRoot: isString(msg.projectRoot) ? msg.projectRoot : undefined,
      safeMode: typeof msg.safeMode === 'boolean' ? msg.safeMode : undefined,
    };

    if (!this.dataReady) {
      this.pending.push(request);
      return;
    }
    void this.dispatch(request);
  }

  private async dispatch(request: IncomingRequest): Promise<void> {
    if (!this.analyzer || !this.parseResult) {
      this.send({ type: 'response', id: request.id, data: errorResult('Sidecar not ready') });
      return;
    }
    const handler = resolveHandler(request.method);
    if (!handler) {
      this.send({ type: 'response', id: request.id, data: errorResult(`Unknown method: ${request.method}`) });
      return;
    }
    try {
      const data = await ruleScope.run(request.projectRoot, request.safeMode ?? false, () =>
        handler({
          analyzer: this.analyzer!,
          parseResult: this.parseResult!,
          params: request.params,
          projectRoot: request.projectRoot,
          safeMode: request.safeMode,
        }),
      );
      this.send({ type: 'response', id: request.id, data });
    } catch (err) {
      this.send({ type: 'response', id: request.id, data: errorResult(err instanceof Error ? err.message : String(err)) });
    }
  }

  private async loadData(): Promise<void> {
    try {
      // findLogsDirs yields the Copilot CLI dir (fork divergence D8); the worker
      // collects Claude/Codex/OpenCode independently. With no sources the parse
      // simply returns empty, so the sidecar still comes up ready with empty data.
      // The user's directory exclusions are applied here (Copilot) and inside the
      // worker (other harnesses, via the vendored patch).
      const dirs = filterExcludedDirs(findLogsDirs());
      this.parseResult = await parseAllLogsViaWorker(dirs, (p) => this.onProgress(p));
    } catch (err) {
      process.stderr.write(`[sidecar] parse failed: ${err instanceof Error ? err.message : String(err)}\n`);
      this.parseResult = this.emptyParseResult();
    }

    this.analyzer = new Analyzer(
      this.parseResult.sessions,
      this.parseResult.editLocIndex,
      this.parseResult.workspaces,
    );

    // Mark internally ready and flush pre-load queued requests BEFORE warmUp
    // so they are served during warm-up. The wire `dataReady` message goes to
    // the webview only AFTER warmUp completes: warmUp emits progress pushes,
    // and the webview's ensureLoadingUI() will re-render the loading screen if
    // it is called after the dashboard has already cleared #load-progress-bar —
    // sending dataReady before warmUp causes exactly that race.
    this.dataReady = true;
    const queued = this.pending.splice(0, this.pending.length);
    for (const request of queued) void this.dispatch(request);

    try {
      await this.analyzer.warmUp((phase, detail, pct) => this.onProgress({ phase, detail, pct }));
    } catch { /* warmUp is best-effort */ }

    this.send({ type: 'dataReady', currentWorkspace: '' });
  }

  private onProgress(p: Partial<LoadProgress> & { phase: number }): void {
    this.send({ type: 'progress', ...p });
  }

  private emptyParseResult(): ParseResult {
    return {
      workspaces: new Map(),
      sessions: [],
      editLocIndex: new Map(),
      sessionSourceIndex: new Map(),
    };
  }

  private shutdown(): void {
    process.exit(0);
  }
}
