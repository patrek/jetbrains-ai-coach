# Copilot Instructions

## Project Overview

AI Coach for JetBrains is a JetBrains IDE plugin that analyzes AI coding assistant usage (Claude Code, Codex CLI, OpenCode, Copilot CLI). It is a port of the [AI Engineering Coach](https://github.com/microsoft/AI-Engineering-Coach) VS Code extension.

The project has two independent subsystems:

- **`plugin/`** — Kotlin/Gradle IntelliJ Platform plugin (tool window, JCEF webview, sidecar supervisor)
- **`sidecar/`** — Node.js/TypeScript stdio RPC server wrapping the vendored analysis engine

## Build, Test, and Lint Commands

### Sidecar (Node/TypeScript)

```bash
cd sidecar
npm ci                  # install dependencies
npm test                # run vitest suite (includes vendored upstream tests)
npm run test:watch      # watch mode
npm run build           # esbuild → dist/ bundles (required before Gradle builds)
```

Run a single test file:
```bash
cd sidecar
npx vitest run src/rpc-handlers.test.ts
```

### Plugin (Kotlin/Gradle)

```bash
./gradlew :plugin:buildPlugin    # build installable plugin zip
./gradlew :plugin:verifyPlugin   # IntelliJ Plugin Verifier
./gradlew :plugin:runIde         # launch sandbox IDE with plugin loaded
```

Run a single Kotlin test class:
```bash
./gradlew :plugin:test --tests "com.aicoach.jetbrains.sidecar.NodeDetectorTest"
```

> `compileKotlin` does **not** require Node; only `buildPlugin` / `processResources` triggers `buildSidecar`.

### Vendoring Pipeline

```bash
node tools/sync-upstream.mjs            # fetch upstream SHA, apply patches, run vendored tests
node tools/sync-upstream.mjs --dry-run  # validate manifest + patches only (no file copy)
```

## Architecture

### Two-Process Model

The Kotlin plugin spawns a single application-level Node.js child process (`SidecarService`, decision D4). Communication is NDJSON over stdio:

- **Kotlin → Node:** `{ type:'request', id, method, params?, projectRoot? }`
- **Kotlin → Node:** `{ type:'host-response', id, data }` (reply to a host-request)
- **Node → Kotlin:** `{ type:'hello', ... }`, `{ type:'progress', ... }`, `{ type:'dataReady', ... }`, `{ type:'response', id, data }`, `{ type:'host-request', id, method, params }`

The sidecar exits when stdin closes — it cannot outlive its IDE host.

### Vendored Code (`sidecar/vendor/`)

`sidecar/vendor/` is **generated, never hand-edited**. It is a snapshot of the upstream `src/core` and `src/webview`. Changes to vendored code must go through the patch system in `tools/patches/`. The directory is not committed and must be populated via `node tools/sync-upstream.mjs` before building.

### JCEF Webview

The dashboard UI runs inside a JCEF browser. Assets are served by `AssetSchemeHandler` via a custom `aicoach://` scheme (decision D7). The sidecar bundles the webview app (`dist/webview/app.js`, `styles.css`); `plugin/src/main/resources/webview/` holds the static shell (`index.html`, `bootstrap.js`).

### Trust Store

The rule trust store lives in Kotlin, not Node (decision D5). The sidecar calls back to the host via `host-request` messages (`trust/get`, `trust/set`) and waits up to 10 s before degrading.

### Log Sources

Only CLI harnesses are parsed (Claude Code, Codex, OpenCode, Copilot CLI). VS Code and Xcode file discovery is patched out in the vendored tree (decision D8).

## Key Conventions

### `sidecar/vendor/` is read-only

Never edit files under `sidecar/vendor/` directly. Write a patch in `tools/patches/` and re-run `sync-upstream.mjs`. A patch that no longer applies cleanly fails CI.

### Sidecar bundles are not committed

`sidecar/dist/` is gitignored. The Gradle `:plugin:processResources` task runs `npm run build` automatically, so `buildPlugin` produces a self-contained JAR. Local development that only touches Kotlin does not need Node installed.

### Kotlin test framework

Kotlin unit tests use JUnit 4 (not JUnit 5). The IntelliJ Platform test framework runs on JUnit 4 but doesn't export it to the test compile classpath, so `junit` is declared explicitly in `gradle/libs.versions.toml`.

### Plugin targets all JetBrains IDEs

`plugin.xml` depends only on `com.intellij.modules.platform`. Do not add IDE-specific module dependencies. `pluginVerification` targets IntelliJ IDEA Community + PyCharm Community to cover the acceptance criterion.

### `sinceBuild = "242"`, no `untilBuild`

The plugin supports IntelliJ Platform 2024.2+ with no upper bound, so it keeps working on future releases without forced re-publish.

### OpenWolf context management

This project uses OpenWolf. Read `.wolf/OPENWOLF.md` at session start. Check `.wolf/anatomy.md` before reading files; check `.wolf/cerebrum.md` before generating code. Update both after significant changes.
