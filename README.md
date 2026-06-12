# AI Coach for JetBrains

A JetBrains IDE plugin that analyzes your AI coding assistant usage across
Claude Code, Codex CLI, OpenCode, and Copilot CLI. Read-only, zero telemetry.

This is a port of the
[AI Engineering Coach](https://github.com/microsoft/AI-Engineering-Coach)
VS Code extension. The analysis engine (`src/core`) and dashboard UI
(`src/webview`) are reused ~verbatim from upstream and kept in lockstep through a
vendoring pipeline; only a small, audited set of host-specific divergences lives
in this repo.

> **Status:** scaffold + vendoring pipeline only (part 1 of 7). No end-user
> functionality is wired up yet.

## Repository layout

```
plugin/    IntelliJ Platform plugin (Kotlin, Gradle 2.x plugin)
sidecar/   Node/TypeScript sidecar — stdio RPC server wrapping the vendored core
  vendor/  upstream src/core + src/webview snapshot (generated, never hand-edited)
tools/     sync-upstream.mjs + upstream.lock (pinned SHA) + patches/ (divergence set)
docs/ADR/  architecture decision records (D1–D8)
```

## Architecture

Decisions D1–D8 are recorded in [`docs/ADR/`](docs/ADR/). In short: one
application-level Node sidecar wraps the vendored core and speaks an NDJSON RPC
protocol to the Kotlin host; the cache is isolated from the VS Code extension's;
and an MCP stdio server exposes the same analytics with the IDE closed.

## Development

### Prerequisites

- JDK 21
- Node.js ≥ 20

### Vendoring the upstream engine

The `sidecar/vendor/` tree is generated, not committed. Populate it from the
pinned upstream SHA:

```bash
node tools/sync-upstream.mjs          # fetch, copy, apply patches, run vendored tests
node tools/sync-upstream.mjs --dry-run # validate manifest + remote + patches only
```

To re-sync to a newer upstream commit, update the `ref` in
[`tools/upstream.lock`](tools/upstream.lock) and re-run the script. Any patch in
`tools/patches/` that no longer applies fails the sync (and CI). See
[`tools/patches/README.md`](tools/patches/README.md).

### Sidecar

```bash
cd sidecar
npm ci
npm test     # runs the vendored vitest suite
npm run build # esbuild → dist/ bundles
```

### Plugin

```bash
./gradlew :plugin:buildPlugin   # builds the installable plugin zip
./gradlew :plugin:verifyPlugin  # IntelliJ Plugin Verifier
./gradlew :plugin:runIde        # launches a sandbox IDE with the plugin
```

## License

[MIT](LICENSE). Vendored upstream code is © Microsoft Corporation, also MIT —
see [NOTICE](NOTICE).
