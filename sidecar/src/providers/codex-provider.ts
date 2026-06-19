/*
 * Codex CLI (OpenAI) adapter.
 *
 *   codex exec --json --ephemeral --skip-git-repo-check -s read-only -
 *   (prompt piped via stdin)
 *
 * --json emits NDJSON events; the adapter scans for the last assistant
 * message event and extracts its text content. --ephemeral prevents
 * session file side-effects. -s read-only enforces sandbox safety.
 */

import type { CliProvider, ProviderResult, ProviderRunOptions } from '../cli-provider';
import { PROVIDER_TIMEOUT_MS } from '../cli-provider';
import { runChild } from './spawn-child';

/** stderr phrasings that mean "the CLI is installed but not authenticated". */
const AUTH_FAILURE = /\b(401|unauthorized|authentication|unauthenticated|token expired|please log in|not logged in)\b/i;

/**
 * Scan NDJSON lines for the last assistant message and extract its text.
 * Returns undefined if no valid assistant message is found.
 *
 * Codex emits events like:
 *   {"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"..."}}
 */
function extractAnswer(stdout: string): string | undefined {
  let answer: string | undefined;
  
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Skip malformed JSON lines
      continue;
    }
    
    // Look for item.completed events with agent_message items
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).type === 'item.completed'
    ) {
      const item = (parsed as { item?: unknown }).item;
      if (
        item &&
        typeof item === 'object' &&
        (item as Record<string, unknown>).type === 'agent_message'
      ) {
        const text = (item as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim()) {
          answer = text.trim();
        }
      }
    }
  }
  
  return answer;
}

export const codexProvider: CliProvider = {
  id: 'codex',
  
  async run(prompt: string, opts: ProviderRunOptions): Promise<ProviderResult> {
    // The prompt rides in via stdin (the trailing `-`), so there is no ARG_MAX
    // limit to guard against — same as the Claude adapter, which is uncapped.
    const outcome = await runChild({
      binaryPath: opts.binaryPath,
      args: ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-'],
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
      return {
        ok: false,
        reason: AUTH_FAILURE.test(outcome.stderr) ? 'unauthenticated' : 'cli-error',
      };
    }

    const text = extractAnswer(outcome.stdout);
    if (!text) {
      return { ok: false, reason: 'bad-output' };
    }
    
    return { ok: true, text };
  },
};

// Made with Bob
