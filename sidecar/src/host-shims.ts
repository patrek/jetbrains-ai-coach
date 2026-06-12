/*
 * Host shims: adapters that let the vendored core reach IDE-host-owned state
 * over the same stdio channel the RPC server uses.
 *
 * Trust store (decision D5): rule-approval authority lives in the Kotlin host
 * (a `PersistentStateComponent`), not in a user-writable file next to the
 * untrusted rules. The vendored core consumes trust state through a
 * `TrustMemento` whose `get` is SYNCHRONOUS — so we cannot round-trip to the
 * host on every read. Instead we keep a local in-memory mirror, hydrated once
 * from the host at startup (`trust/get`), serve `get` from the mirror, and
 * write `update` through to the host (`trust/update`) while updating the mirror
 * synchronously.
 *
 * With no host attached (the Part 2 stdio test harness, or a standalone run)
 * the mirror works on its own: updates are kept in memory so personal-layer
 * rule auto-approval still behaves correctly; they simply aren't persisted.
 */

import type { TrustMemento } from '../vendor/core/rule-trust';
import { setDefaultTrustStore } from '../vendor/core/rule-trust';

/** A request channel to the IDE host, multiplexed over the sidecar's stdout. */
export interface HostChannel {
  /** Issue a host-bound RPC and resolve with its response payload. */
  request(method: string, params: unknown): Promise<unknown>;
}

export interface TrustMementoOptions {
  /** When present, updates write through to the host and a seed is fetched. */
  channel?: HostChannel;
  /** Initial mirror contents (e.g. a snapshot already fetched from the host). */
  seed?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Build a `TrustMemento` backed by an in-memory mirror, optionally writing
 * through to (and seeded from) the IDE host over `channel`.
 */
export function createHostTrustMemento(opts: TrustMementoOptions = {}): TrustMemento {
  const mirror = new Map<string, unknown>(Object.entries(opts.seed ?? {}));
  return {
    get<T>(key: string, defaultValue: T): T {
      return mirror.has(key) ? (mirror.get(key) as T) : defaultValue;
    },
    update(key: string, value: unknown): Promise<void> {
      mirror.set(key, value);
      if (!opts.channel) return Promise.resolve();
      // Swallow host errors: a failed persist must not break a local rule save.
      return opts.channel.request('trust/update', { key, value }).then(
        () => undefined,
        () => undefined,
      );
    },
  };
}

/**
 * Fetch the full trust snapshot from the host to seed the mirror. Returns an
 * empty object when no host is attached or the host errors — the sidecar then
 * runs with an empty (but functional) in-memory trust store.
 *
 * Not called in part 2 (no host is attached). Part 3's bridge wiring calls it
 * with the live `HostChannel` at sidecar startup, before `createHostTrustMemento`,
 * to hydrate the mirror from the IDE's PersistentStateComponent (decision D5).
 */
export async function loadTrustSeed(channel?: HostChannel): Promise<Record<string, unknown>> {
  if (!channel) return {};
  try {
    const snapshot = await channel.request('trust/get', {});
    return isRecord(snapshot) ? snapshot : {};
  } catch {
    return {};
  }
}

/** Install `memento` as the core's default trust store. */
export function installTrustMemento(memento: TrustMemento): void {
  setDefaultTrustStore(memento);
}
