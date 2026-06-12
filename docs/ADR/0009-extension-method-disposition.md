# ADR 0009: Disposition of the extension RPC methods in the sidecar

- **Status:** Accepted
- **Date:** 2026-06-12
- **Decision ID:** finalizes the parent-plan disposition table (part 2 audit)

## Context

`ExtensionMethodMap` (vendor/core/types/rpc-types.ts) adds 20 methods beyond the
55 core `RpcMethodMap` methods. In upstream they are served by the VS Code
extension's `panel-request-service.ts`, which is heavily coupled to `vscode`
(authentication, `workspace.fs`, the Language Model API). The part 2 plan calls
for auditing the nine "audit" methods the sidecar might own and recording a
final port-vs-degrade decision for each. The 55 core methods are handled
separately (reuse of the vendored handler map); this ADR covers only the
extension methods.

## Decision

Each extension method is dispositioned as **port** (sidecar implements it,
filesystem/network only), **degrade** (`{error: 'llm-unavailable'}`, gated by
[ADR 0006](0006-getcapabilities-degradation.md)), or **host** (intercepted by
the Kotlin bridge, never forwarded to the sidecar — wired in part 3).

| Method | Disposition | Rationale |
| ------ | ----------- | --------- |
| `getWorkspaceDeps` | **Port** (done, part 2) | Pure `package.json` reads keyed off parse-result workspace roots; no `vscode`. Implemented in `rpc-handlers.ts`. |
| `getSdlcToolAnalysis` | **Port** (part 6) | Derives MCP-tool usage from parsed sessions; no `vscode`. Deferred to the SDLC page work. |
| `getSdlcRepoScan` | **Port** (part 6) | Scans workspace roots for git remotes / CI files; filesystem only. |
| `getSdlcGitHubData` | **Degrade → `github:false`** | Needs `vscode.authentication` for a GitHub token. v1 reports the `github` capability false; a host-provided token can re-enable it later. |
| `installSkill` | **Port** (part 6) | `vscode.workspace.fs` writes map cleanly to Node `fs`; fetch stays. Deferred with the catalog UI. |
| `installCatalogItem` | **Port** (part 6) | Same as `installSkill`. |
| `discoverCatalog` | **Port** (part 6) | Fetches a remote catalog; no `vscode`. |
| `reviewContextFiles` | **Degrade** | The file reads are portable, but the review itself is an LLM call. Degrades until the host exposes an LLM. |
| `triageSkills`, `triageCatalog` | **Degrade** | LLM-dependent ranking. |
| `createSkill`, `generateSkillContent`, `generateLearningQuiz`, `generateLearningResources`, `generateCodeComparison`, `generateDidYouKnow` | **Degrade** | LLM-generation methods. |
| `openExternal` | **Host** | `BrowserUtil.browse` in the bridge. |
| `saveModelBudgets`, `loadModelBudgets` | **Host** | `PropertiesComponent` in the bridge. |
| `exportSummary` | **Host** | IntelliJ save flow (part 6). |
| `reviewLocalRules` (core method) | **Host** | Opens `TrustApprovalDialog`; the bridge intercepts it. The sidecar answers a typed error if it ever arrives, but it is never forwarded. |

Part 2 implements `getWorkspaceDeps` (the representative filesystem-only port)
and degrades the LLM extension methods to `{error: 'llm-unavailable'}` in
`rpc-handlers.ts`. The remaining **port** methods are filesystem/network-only and
are deferred to the parts that build their UIs; until then the sidecar answers
them with `Unknown method`, which is correct (their pages do not yet exist).

## Consequences

- No `vscode` call ever returns a value to, or crashes, the sidecar. Four of the
  five `require('vscode')` sites in the vendored handler map belong to overridden
  handlers and never run; the fifth (`getRuleEditor`'s workspace-root lookup) is
  caught by upstream's own test-context fallback and degrades to "no project
  rule layer" — correct for part 2, where no project is attached. Threading the
  per-request project root into `getRuleEditor` is a part-3 item (it matters only
  once the bridge stamps scope and the rules-editor UI lands).
- The degrade set is a single source of truth (`LLM_UNAVAILABLE_METHODS` in
  `rpc-handlers.ts`) shared by core and extension LLM methods.
- Three SDLC/catalog ports are knowingly deferred; this ADR records that they are
  ports (not degrades) so the later parts do not re-litigate the decision.

## Alternatives considered

- **Port all nine audit methods now** — rejected: their UIs ship in later parts,
  the part 2 acceptance suite does not cover them, and porting
  `panel-request-service.ts` wholesale would pull a large vscode-coupled surface
  into the sidecar prematurely.
- **Degrade the SDLC/catalog ports too** — rejected: they are genuinely
  filesystem/network-only and degrading them would lose real functionality for
  no isolation benefit.
