/*
 * Shared non-interactive child spawn for the CLI providers.
 *
 * Centralizes the parts that must be identical across adapters and are easy to
 * get subtly wrong: the argv-only spawn (never a shell), the adapter-imposed
 * deadline composed with the caller's shutdown signal, and the SIGTERM →
 * SIGKILL kill so a timed-out child is never orphaned. Each adapter owns only
 * its argv, stdin, and output parsing.
 */

import { spawn as nodeSpawn } from 'node:child_process';

type SpawnFn = typeof nodeSpawn;

/** Grace period between SIGTERM and the SIGKILL backstop on a killed child. */
const SIGKILL_BACKSTOP_MS = 2_000;

export interface ChildRun {
  binaryPath: string;
  args: string[];
  /** Written to the child's stdin then closed; omit to close stdin empty. */
  stdin?: string;
  /** Caller cancellation; aborting kills the child and yields `timeout`. */
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnFn;
  timeoutMs: number;
}

export type ChildOutcome =
  | { status: 'ok'; code: number; stdout: string; stderr: string }
  | { status: 'enoent' } // binary not found
  | { status: 'timeout' } // deadline or shutdown; child killed
  | { status: 'error' }; // any other spawn-level failure

export function runChild(run: ChildRun): Promise<ChildOutcome> {
  const spawn = run.spawn ?? nodeSpawn;
  return new Promise<ChildOutcome>((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const child = (() => {
      try {
        // argv array only — the prompt is never interpolated into a shell.
        return spawn(run.binaryPath, run.args, { env: run.env, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        return undefined;
      }
    })();

    const finish = (outcome: ChildOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      run.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    function onAbort(): void {
      if (timedOut) return; // deadline and caller-abort can both fire; kill once
      timedOut = true;
      try {
        child?.kill('SIGTERM');
      } catch {
        /* already exited */
      }
      killTimer = setTimeout(() => {
        try {
          child?.kill('SIGKILL');
        } catch {
          /* already exited */
        }
      }, SIGKILL_BACKSTOP_MS);
      killTimer.unref?.();
    }

    const deadline = setTimeout(onAbort, run.timeoutMs);
    deadline.unref?.();

    if (!child) {
      finish({ status: 'error' });
      return;
    }

    if (run.signal) {
      if (run.signal.aborted) onAbort();
      else run.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(err.code === 'ENOENT' ? { status: 'enoent' } : { status: 'error' });
    });

    child.on('close', (code) => {
      finish(timedOut ? { status: 'timeout' } : { status: 'ok', code: code ?? 0, stdout, stderr });
    });

    // A child that dies before draining stdin yields EPIPE; swallow it so the
    // real outcome ('error'/'enoent'/'timeout') is what surfaces.
    child.stdin?.on('error', () => {
      /* ignore */
    });
    child.stdin?.end(run.stdin ?? '');
  });
}