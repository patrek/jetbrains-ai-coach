# Vendor patches — the divergence log

Every file under `sidecar/vendor/` is a **verbatim** snapshot of the upstream
[AI Engineering Coach](https://github.com/microsoft/AI-Engineering-Coach) repo at
the SHA pinned in `tools/upstream.lock`. Vendored files are **never hand-edited**.
The only sanctioned way to diverge from upstream is a patch in this directory.

`tools/sync-upstream.mjs` applies every `*.patch` here (sorted by filename) after
copying the upstream tree, using `git apply --check` first. A patch that no
longer applies **fails the sync and CI** — drift surfaces immediately instead of
rotting silently.

## Why so strict

The port's entire premise is ~90% code reuse with lockstep upstream fixes. That
only holds if re-syncing to a new upstream SHA stays mechanical. A small,
auditable patch set keeps it that way.

**Target: fewer than 10 small patches.** A growing patch set is a signal that a
divergence should instead be pushed upstream (e.g. the `getCapabilities`
capability method — see `docs/ADR/0006-getcapabilities-degradation.md`) or moved
out of the vendored tree into the sidecar's own (non-vendored) code.

## Authoring a patch

1. Run a full sync so `sidecar/vendor/` matches upstream exactly.
2. Edit the vendored file to the desired state.
3. Generate the patch from the repo root, paths relative to the repo root:

   ```bash
   git diff -- sidecar/vendor/ > tools/patches/NNNN-short-description.patch
   ```

4. Restore the vendored tree (`node tools/sync-upstream.mjs --skip-tests`) and
   confirm the patch re-applies cleanly.
5. Add a row to the log below.

## Divergence log

| Patch | Introduced by | Purpose |
| ----- | ------------- | ------- |
| `0001-cache-dir-and-atomic-writes.patch` | part 2 | Cache dir → `~/.ai-coach-jetbrains/cache/` (overridable via `AI_COACH_CACHE_DIR`) so the fork never collides with the VS Code extension's shared cache (decision D1), and `saveCacheData` writes **synchronously** via temp-file + rename. The fork parses in a child process that `parser.ts` kills the instant it returns its result, so upstream's deferred worker-thread write would be lost before it lands; the synchronous atomic write persists the cache before the child exits, which is what makes warm starts work. |
| `0002-findlogsdirs-drop-vscode-xcode.patch` | part 2 | `findLogsDirs()` returns `[]` so only the CLI-harness collectors run (Claude Code, Codex, OpenCode, Copilot CLI); VS Code workspaceStorage and Xcode discovery are dropped from the path (decision D8). Updates the matching `parser-main.test.ts` case so the vendored suite stays green. |
| `0003-panel-shared-type-only-vscode.patch` | part 2 | Make `panel-shared.ts`'s `vscode` import type-only. It is used only for types, but a runtime `import * as vscode` would crash the sidecar at load (no `vscode` module outside the IDE). Lets the sidecar reuse the vendored RPC handler map. |
