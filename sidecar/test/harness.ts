/*
 * Stdio test harness: spawns the built sidecar and drives it over NDJSON,
 * exactly as the Kotlin bridge will (part 3) — no IDE required.
 *
 * It asserts protocol purity by throwing if any non-JSON line appears on
 * stdout, which directly verifies that no vendored `console`/worker output
 * leaks into the RPC stream.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { DIST_MAIN } from './paths';

export interface ProgressEvent {
  type: 'progress';
  phase: number;
  detail?: string;
  pct?: number;
  [k: string]: unknown;
}

export interface HostRequest {
  id: string;
  method: string;
  params: unknown;
}

export class SidecarHarness {
  private readonly child: ChildProcess;
  private seq = 0;
  private readonly pending = new Map<string, { resolve: (d: unknown) => void; reject: (e: Error) => void }>();
  private stderr = '';
  private exited = false;

  hello?: { version: string; capabilities: Record<string, boolean> };
  readonly progress: ProgressEvent[] = [];
  dataReady?: { currentWorkspace: string };
  readonly hostRequests: HostRequest[] = [];

  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;
  readonly ready: Promise<void>;

  constructor(opts: { home: string; cacheDir: string }) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.child = spawn('node', [DIST_MAIN], {
      env: {
        ...process.env,
        HOME: opts.home,
        USERPROFILE: opts.home,
        AI_COACH_CACHE_DIR: opts.cacheDir,
      },
      // Capture stderr so a crash surfaces the reason instead of a bare timeout.
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr!.on('data', (chunk: Buffer) => { this.stderr += chunk.toString(); });
    const rl = readline.createInterface({ input: this.child.stdout!, crlfDelay: Infinity });
    rl.on('line', (line) => this.onLine(line));
    // A crash before dataReady, or with requests in flight, must reject — never
    // hang until the test timeout with no diagnostic.
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      if (this.dataReady) return; // clean shutdown after ready is fine
      const detail = `sidecar exited (code=${code} signal=${signal ?? ''})\n${this.stderr.trim()}`;
      const err = new Error(detail);
      this.rejectReady(err);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      throw new Error(`non-JSON line on protocol stdout (stream pollution): ${trimmed}`);
    }
    switch (msg.type) {
      case 'hello':
        this.hello = { version: msg.version as string, capabilities: msg.capabilities as Record<string, boolean> };
        break;
      case 'progress':
        this.progress.push(msg as unknown as ProgressEvent);
        break;
      case 'dataReady':
        this.dataReady = { currentWorkspace: (msg.currentWorkspace as string) ?? '' };
        this.resolveReady();
        break;
      case 'response': {
        const cb = this.pending.get(msg.id as string);
        if (cb) { this.pending.delete(msg.id as string); cb.resolve(msg.data); }
        break;
      }
      case 'host-request':
        this.hostRequests.push({ id: msg.id as string, method: msg.method as string, params: msg.params });
        break;
    }
  }

  /** Send a request and resolve with its `data` payload (rejects if the sidecar dies). */
  request(method: string, params?: Record<string, unknown>, projectRoot?: string): Promise<unknown> {
    const id = `r${this.seq++}`;
    if (this.exited) return Promise.reject(new Error(`sidecar already exited:\n${this.stderr.trim()}`));
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const envelope: Record<string, unknown> = { type: 'request', id, method };
      if (params) envelope.params = params;
      if (projectRoot) envelope.projectRoot = projectRoot;
      this.child.stdin!.write(`${JSON.stringify(envelope)}\n`);
    });
  }

  /** Close stdin and wait for the sidecar to exit on its own. */
  dispose(): Promise<number | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.child.kill(); resolve(null); }, 3000);
      this.child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
      this.child.stdin!.end();
    });
  }
}
