# AI Usage Coach for JetBrains

A JetBrains IDE plugin that analyzes your AI coding assistant usage across
Claude Code, Codex CLI, OpenCode, and Copilot CLI. Read-only, local-only, zero
telemetry.

This is a port of the
[AI Engineering Coach](https://github.com/microsoft/AI-Engineering-Coach)
VS Code extension. The analysis engine (`src/core`) and dashboard UI
(`src/webview`) are reused ~verbatim from upstream and kept in lockstep through a
vendoring pipeline; only a small, audited set of host-specific divergences lives
in this repo.

## Requirements

- **Node.js 20 or newer** on `PATH` (the dashboard runs a Node sidecar). If your
  Node lives somewhere the plugin can't find, set its path under
  **Settings → Tools → AI Usage Coach**.
- A JetBrains IDE on build **242 (2024.2)** or newer — IntelliJ IDEA, PyCharm,
  WebStorm, GoLand, Rider, and other platform IDEs.
- Remote development (Gateway) is **not supported in v1**.

## Getting started

1. Install the plugin and restart the IDE (the tool window is a non-dynamic
   extension point, so install/uninstall requires a restart — this is expected).
2. Open the **AI Usage Coach** tool window (right stripe). On first open it
   shows a one-time data-access disclosure, then builds your activity index.

## Privacy & data access

The plugin reads your local AI coding-assistant session logs **read-only**, keeps
all data **on your machine**, and sends **zero telemetry**. It reads:

| Harness      | Directory                     |
| ------------ | ----------------------------- |
| Claude Code  | `~/.claude`                   |
| Codex CLI    | `~/.codex`                    |
| OpenCode     | `~/.local/share/opencode`     |
| Copilot CLI  | `~/.copilot`                  |

A first-run disclosure states this before any scanning happens. To opt a
directory out, add its absolute path (one per line) under **Excluded
directories** in **Settings → Tools → AI Usage Coach**; the sidecar then never
reads it or its contents.

## Using the analytics in Claude Code (MCP)

The plugin ships a standalone [MCP](https://modelcontextprotocol.io) server that
exposes the same analytics to any MCP client — **even with the IDE closed**. See
[docs/MCP_SETUP.md](docs/MCP_SETUP.md) for setup.

## Authoring custom rules

Detection rules and metrics are markdown files. The authoring semantics are
upstream's — see
[`docs/AUTHORING_RULES.md`](https://github.com/microsoft/AI-Engineering-Coach/blob/main/docs/AUTHORING_RULES.md)
in the upstream repo. Personal and project rules require approval in the IDE
(the trust gate) before they execute; the headless MCP path serves built-in
analytics only and leaves unapproved rules pending.

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md). The fastest way to file a
useful bug report is **Help → Collect AI Usage Coach Troubleshooting Info**,
which copies a redacted report (sidecar log, Node detection, environment) to your
clipboard.

## Architecture

Decisions D1–D8 are recorded in [`docs/ADR/`](docs/ADR/). In short: one
application-level Node sidecar wraps the vendored core and speaks an NDJSON RPC
protocol to the Kotlin host; the cache is isolated from the VS Code extension's;
and an MCP stdio server exposes the same analytics with the IDE closed.

## Repository layout

```
plugin/    IntelliJ Platform plugin (Kotlin, Gradle 2.x plugin)
sidecar/   Node/TypeScript sidecar — stdio RPC server wrapping the vendored core
  vendor/  upstream src/core + src/webview snapshot (generated, never hand-edited)
tools/     sync-upstream.mjs + upstream.lock (pinned SHA) + patches/ (divergence set)
docs/ADR/  architecture decision records (D1–D8)
```

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
./gradlew :plugin:verifyPlugin  # IntelliJ Plugin Verifier (IDEA, PyCharm, WebStorm, GoLand, Rider)
./gradlew :plugin:runIde        # launches a sandbox IDE with the plugin
```

### Signing & publishing

`signPlugin` and `publishPlugin` read credentials from the environment (CI
secrets) — never committed: `CERTIFICATE_CHAIN`, `PRIVATE_KEY`,
`PRIVATE_KEY_PASSWORD`, and `PUBLISH_TOKEN`. With them unset, `buildPlugin` still
works; only signing and publishing require them.

## License

[MIT](LICENSE). Vendored upstream code is © Microsoft Corporation, also MIT —
see [NOTICE](NOTICE).
