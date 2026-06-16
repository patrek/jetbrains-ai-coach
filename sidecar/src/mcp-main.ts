/*
 * Standalone MCP server entry point (decision D2, ADR 0002).
 *
 * Bundled by esbuild to `dist/mcp-main.js`. An MCP client spawns it directly
 * (e.g. `claude mcp add aicoach -- node ~/.ai-coach-jetbrains/runtime/current/mcp-main.js`),
 * so it runs with the IDE closed. See `mcp-server.ts` for the data lifecycle.
 *
 * Two things must happen BEFORE the vendored cache/parser modules load:
 *   1. The cache dir env is stamped (the vendored cache module reads it at module
 *      load) — `cache-paths` is the source of truth, matching `main.ts`.
 *   2. `console.log/info/debug` are routed to stderr. stdout is reserved for the
 *      MCP protocol the transport writes; vendored diagnostics default to stdout
 *      and would corrupt the stream.
 * A dynamic import of `mcp-server` defers the heavy module graph until after both
 * are in place.
 */

import { CACHE_DIR_ENV, resolveCacheDir } from './cache-paths';

if (!process.env[CACHE_DIR_ENV]) process.env[CACHE_DIR_ENV] = resolveCacheDir();

const toStderr = (...args: unknown[]): void => { console.error(...args); };
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

void import('./mcp-server').then(({ startMcpServer }) => startMcpServer()).catch((err: unknown) => {
  process.stderr.write(`[mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
