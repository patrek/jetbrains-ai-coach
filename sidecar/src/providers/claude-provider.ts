/*
 * Claude Code CLI adapter.
 *
 *   claude -p --output-format json --tools ""   (prompt piped via stdin)
 *
 * stdin avoids `ARG_MAX` (claude -p reads stdin), `--tools ""` keeps it a pure
 * inference call, and `--output-format json` gives a stable envelope. Only
 * `.result` is read — every other field is unstable and may drift upstream.
 */

import type { CliProvider, ProviderResult, ProviderRunOptions } from '../cli-provider';
import { PROVIDER_TIMEOUT_MS } from '../cli-provider';
import { runChild } from './spawn-child';

/** stderr phrasings that mean "the CLI is installed but not authenticated". */
const AUTH_FAILURE = /\b(unauthenticated|not logged in|login required|invalid api key|no api key|authentication failed|please run.*login)\b/i;

export const claudeProvider: CliProvider = {
  id: 'claude',
  async run(prompt: string, opts: ProviderRunOptions): Promise<ProviderResult> {
    const outcome = await runChild({
      binaryPath: opts.binaryPath,
      args: ['-p', '--output-format', 'json', '--tools', ''],
      stdin: prompt,
      signal: opts.signal,
      env: opts.env,
      spawn: opts.spawn,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });

    switch (outcome.status) {
      case 'enoent':
        return { ok: false, reason: 'not-installed' };
      case 'timeout':
        return { ok: false, reason: 'timeout' };
      case 'error':
        return { ok: false, reason: 'cli-error' };
      case 'ok':
        break;
    }

    if (outcome.code !== 0) {
      return { ok: false, reason: AUTH_FAILURE.test(outcome.stderr) ? 'unauthenticated' : 'cli-error' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outcome.stdout);
    } catch {
      return { ok: false, reason: 'bad-output' };
    }

    const result = (parsed as { result?: unknown }).result;
    if (typeof result !== 'string' || !result.trim()) {
      return { ok: false, reason: 'bad-output' };
    }
    return { ok: true, text: result };
  },
};