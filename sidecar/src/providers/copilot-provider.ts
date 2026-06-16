/*
 * GitHub Copilot CLI adapter.
 *
 *   copilot -p "<prompt>" -s --no-ask-user
 *
 * Copilot has no stable JSON output and no documented exit codes (issue #3397),
 * so this stays defensive: plain-text stdout, any non-zero exit is a generic
 * `cli-error`, and all Copilot-specific quirks are isolated here. Auth is
 * detected host-side (env-token presence), so there is no `unauthenticated`
 * path in this adapter — a real auth failure surfaces as `cli-error`.
 */

import { warnCore } from '../../vendor/core/log';
import type { CliProvider, ProviderResult, ProviderRunOptions } from '../cli-provider';
import { COPILOT_MAX_PROMPT_BYTES, PROVIDER_TIMEOUT_MS } from '../cli-provider';
import { runChild } from './spawn-child';

export const copilotProvider: CliProvider = {
  id: 'copilot',
  async run(prompt: string, opts: ProviderRunOptions): Promise<ProviderResult> {
    // The prompt rides in argv (no documented stdin), so cap it before spawning
    // rather than letting an oversize argv fail as an opaque E2BIG.
    if (Buffer.byteLength(prompt, 'utf8') > COPILOT_MAX_PROMPT_BYTES) {
      warnCore('copilot-provider', `prompt exceeds ${COPILOT_MAX_PROMPT_BYTES} bytes; refusing to spawn`);
      return { ok: false, reason: 'cli-error' };
    }

    const outcome = await runChild({
      binaryPath: opts.binaryPath,
      args: ['-p', prompt, '-s', '--no-ask-user'],
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
      return { ok: false, reason: 'cli-error' };
    }

    const text = outcome.stdout.trim();
    if (!text) {
      return { ok: false, reason: 'bad-output' };
    }
    return { ok: true, text };
  },
};