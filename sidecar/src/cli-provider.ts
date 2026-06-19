/*
 * CLI inference provider contract.
 *
 * The two LLM-backed core methods (`generateRule`, `explainOccurrence`) get a
 * real backend by shelling out — non-interactively — to a CLI agent the user
 * already installed and authenticated (Claude Code or GitHub Copilot CLI). The
 * sidecar stays provider-agnostic: the IDE host decides which provider is
 * active and stamps its id + resolved binary path onto each RPC envelope; the
 * sidecar only invokes whatever the stamp names (see ADR 0009 / the
 * cli-provider plan).
 *
 * Adapters live in `providers/`. They never interpolate the prompt into a
 * shell (argv arrays only), impose their own deadline, and kill the child on
 * timeout so nothing is orphaned (the orphan-prevention contract with the
 * Kotlin host).
 */

import { claudeProvider } from './providers/claude-provider';
import { copilotProvider } from './providers/copilot-provider';
import { codexProvider } from './providers/codex-provider';

export type ProviderId = 'claude' | 'copilot' | 'codex';

/**
 * Why a provider run did not produce usable text. Each maps to a distinct,
 * actionable reason surfaced in the UI; there is deliberately no
 * auto-fallback to the other CLI.
 */
export type ProviderFailureReason =
  | 'not-installed' // spawn ENOENT — the binary is gone
  | 'unauthenticated' // detected auth failure (Claude only, from stderr)
  | 'timeout' // adapter-imposed deadline hit; child killed
  | 'cli-error' // non-zero exit / generic spawn failure / oversize prompt
  | 'bad-output'; // exit 0 but output unparseable, empty, or unusable

export type ProviderResult =
  | { ok: true; text: string }
  | { ok: false; reason: ProviderFailureReason };

export interface ProviderRunOptions {
  /** Binary path resolved by the host and stamped on the envelope. */
  binaryPath: string;
  /** Caller cancellation (sidecar shutdown); composed with the adapter deadline. */
  signal?: AbortSignal;
  /** Process env to hand the child. Injectable for tests. */
  env?: NodeJS.ProcessEnv;
  /** Spawn seam, injected by tests; defaults to `node:child_process`'s `spawn`. */
  spawn?: typeof import('node:child_process').spawn;
}

export interface CliProvider {
  readonly id: ProviderId;
  /** A single flat prompt string; role/turn structure is collapsed by the caller. */
  run(prompt: string, opts: ProviderRunOptions): Promise<ProviderResult>;
}

/** Adapter-imposed wall-clock deadline. Claude has no timeout flag of its own. */
export const PROVIDER_TIMEOUT_MS = 60_000;

/**
 * Copilot has no documented stdin, so the prompt rides in argv. Cap it well
 * under a typical `ARG_MAX` so an oversize prompt fails with a defined reason
 * instead of an opaque spawn error.
 */
export const COPILOT_MAX_PROMPT_BYTES = 96 * 1024;

/**
 * Codex uses stdin (like Claude) but we apply the same conservative cap as
 * Copilot for consistency and to guard against OS-level limits.
 */
export const CODEX_MAX_PROMPT_BYTES = 96 * 1024;

const PROVIDERS: Record<ProviderId, CliProvider> = {
  claude: claudeProvider,
  copilot: copilotProvider,
  codex: codexProvider,
};

/**
 * Build the provider named by the envelope stamp; narrows the untyped wire
 * string to {@link ProviderId} and returns `undefined` for anything else.
 */
export function resolveProvider(id: string): CliProvider | undefined {
  return id === 'claude' || id === 'copilot' || id === 'codex' ? PROVIDERS[id] : undefined;
}