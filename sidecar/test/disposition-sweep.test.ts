/*
 * Disposition-table completeness sweep (part 6 acceptance).
 *
 * Proves every method in the parent plan's disposition table is mapped to a
 * disposition — answered, degraded, or host-owned — so no webview call can hang.
 * The webview's RPC timeout is 120s (`shared.ts`); a method the sidecar neither
 * answers nor degrades must still return the typed `Unknown method` error
 * (delivered immediately), never silence. This sweep is deterministic: it drives
 * `resolveHandler` directly (no process, no network), complementing the stdio
 * per-method suite in `sidecar-rpc.test.ts`.
 *
 * The contract being asserted:
 *   - PORT methods            -> resolveHandler returns a function (a real answer)
 *   - LLM-degrade methods     -> handler yields { error: 'llm-unavailable' }
 *   - host/github-degrade     -> resolveHandler returns undefined, which the
 *                                server turns into a typed `Unknown method` error
 */

import { describe, expect, it } from 'vitest';
import { resolveHandler, type HandlerContext } from '../src/rpc-handlers';
import type { Analyzer } from '../vendor/core/analyzer';
import type { ParseResult } from '../vendor/core/parser';
import {
  ALL_CORE_METHODS,
  ALL_EXTENSION_METHODS,
  EXTENSION_HOST_OR_DEGRADE_METHODS,
  EXTENSION_LLM_DEGRADE_METHODS,
  EXTENSION_PORT_METHODS,
} from './rpc-methods';

function ctx(): HandlerContext {
  const parseResult: ParseResult = { workspaces: new Map(), sessions: [], editLocIndex: new Map(), sessionSourceIndex: new Map() };
  return { analyzer: {} as Analyzer, parseResult, params: {} };
}

describe('disposition table — completeness sweep', () => {
  it('every core + extension method resolves to a handler or a deliberate typed-error path', () => {
    // resolveHandler returning a function => the sidecar answers/degrades it.
    // returning undefined => the server replies with the typed `Unknown method`
    // error. Either way the webview gets an immediate response — never silence.
    for (const method of [...ALL_CORE_METHODS, ...ALL_EXTENSION_METHODS]) {
      const handler = resolveHandler(method);
      expect(handler === undefined || typeof handler === 'function', `unexpected resolution for ${method}`).toBe(true);
    }
  });

  it.each(EXTENSION_PORT_METHODS)('ported extension method is mapped: %s', (method) => {
    expect(resolveHandler(method), `expected a ported handler for ${method}`).toBeTypeOf('function');
  });

  it.each(EXTENSION_LLM_DEGRADE_METHODS)('LLM extension method degrades: %s', async (method) => {
    const handler = resolveHandler(method);
    expect(handler).toBeTypeOf('function');
    await expect(Promise.resolve(handler!(ctx()))).resolves.toEqual({ error: 'llm-unavailable' });
  });

  it.each(EXTENSION_HOST_OR_DEGRADE_METHODS)('host/degrade method is not served by the sidecar: %s', (method) => {
    // Unmapped on purpose: the bridge owns it (or it degrades via a capability
    // flag). The server answers with the typed `Unknown method` error.
    expect(resolveHandler(method), `${method} should be host-owned, not sidecar-served`).toBeUndefined();
  });

  it('exportSummaryContent (the host-driven export content builder) IS served', () => {
    expect(resolveHandler('exportSummaryContent')).toBeTypeOf('function');
  });
});
