/*
 * Sidecar entry point.
 *
 * Bundled by esbuild to `dist/main.js` and launched by the IDE host (part 3)
 * with the webview RPC envelope flowing over stdin/stdout. The worker bundles
 * (`parse-worker.js`, `warm-up-worker.js`, `cache-write-worker.js`) sit next to
 * it in `dist/` so the vendored worker model keeps running unmodified.
 *
 * stdout is RESERVED for the NDJSON protocol. The vendored core logs diagnostics
 * via console.debug/info (which default to stdout) and a warm-up worker thread
 * inherits this process's stdout — any of which would corrupt the stream. So we
 * capture the real stdout writer for the protocol and redirect everything else
 * (console + stray stdout writes) to stderr before the server starts.
 */

import { resolveCacheDir, CACHE_DIR_ENV } from './cache-paths';

// Resolve the cache dir HERE (cache-paths is the source of truth) and stamp the
// env BEFORE the vendored cache module is loaded — it reads this at module load.
// The dynamic import of rpc-server below is what triggers that load, so the
// assignment must precede it. An explicit override (tests, host) is respected.
if (!process.env[CACHE_DIR_ENV]) process.env[CACHE_DIR_ENV] = resolveCacheDir();

// Capture the real stdout writer for the protocol BEFORE redirecting.
const protocolWrite = process.stdout.write.bind(process.stdout) as (chunk: string) => boolean;

// Route console output (incl. vendored core diagnostics) to stderr.
const toStderr = (...args: unknown[]): void => { console.error(...args); };
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;

// Redirect any stray stdout writes (e.g. warm-up worker output piped through
// this process) to stderr, so only the protocol writer reaches fd 1.
const stderrWrite = process.stderr.write.bind(process.stderr);
process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
  return (stderrWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

// Dynamic import so the env stamp above lands before the vendored cache loads.
void import('./rpc-server').then(({ RpcServer }) => {
  const server = new RpcServer({ input: process.stdin, write: (line) => { protocolWrite(line); } });
  return server.start();
}).catch((err: unknown) => {
  process.stderr.write(`[sidecar] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
