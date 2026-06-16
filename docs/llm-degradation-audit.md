# LLM degradation — per-page audit

The JetBrains host has no Language Model API in v1, so every LLM-dependent feature
degrades (decisions D2/D6, [ADR 0006](ADR/0006-getcapabilities-degradation.md)).
The sidecar answers the LLM methods with the typed `{error: 'llm-unavailable'}`
(`LLM_UNAVAILABLE_METHODS` in `sidecar/src/rpc-handlers.ts`); the webview learns
host capability once via `getCapabilities` and gates those methods centrally in
`shared.ts` (the single sanctioned webview patch,
`tools/patches/0006-webview-llm-capability-gate.patch`).

## Mechanism

The gate is a single choke point in `shared.ts:rpc()`, not per-page DOM edits —
keeping the vendored webview at ~one small divergence:

- **Proactive** — once `getCapabilities().llm === false` is known, any of the 12
  LLM methods rejects immediately with the friendly message, before a request is
  sent (no spinner, no round-trip).
- **Reactive** — if a call races ahead of the capability fetch, the sidecar's
  `llm-unavailable` reply is translated into the same message at the response
  boundary.

The message points the user to the MCP tools in Claude Code, which expose the
same analytics with the IDE closed.

## Per-page disposition

"Disable + message" = the entry point stays visible but, when invoked, surfaces
the friendly message (via the page's existing error display). "Silent skip" = a
background enrichment that simply renders nothing when unavailable (no error, no
hang). No entry point is physically removed from the DOM, because that would
require per-page divergence beyond the single sanctioned patch.

| Nav page | Entry point | Method(s) | Disposition |
| -------- | ----------- | --------- | ----------- |
| Anti-Patterns | "Explain this occurrence" | `explainOccurrence` | Disable + message (inline result area) |
| Anti-Patterns (rule editor) | "Generate rule with AI" | `generateRule` | Disable + message |
| Rule Editor | "Generate rule with AI" | `generateRule` | Disable + message |
| Rule Playground | NL-rule compile | `compileNlRule` | Disable + message |
| Learning | Quiz / resources / code comparison / "did you know" | `generateLearningQuiz`, `generateLearningResources`, `generateCodeComparison`, `generateDidYouKnow` | Disable + message |
| Skills | "Generate skill content" | `generateSkillContent` | Disable + message |
| Skills | Custom-skill opportunities (triage) | `triageSkills` | Disable + message |
| Skills | Community-catalog recommendations (triage) | `triageCatalog` | Disable + message |
| Dashboard | Background skill/catalog triage enrichment | `triageSkills`, `triageCatalog` | Silent skip (already `.catch`-swallowed upstream) |
| Config (context health) | "Review context files with AI" | `reviewContextFiles` | Disable + message |

Note: the community catalog itself (`discoverCatalog`, `installSkill`,
`installCatalogItem`) is **not** LLM-dependent — those are ported and fully
functional in the sidecar (ADR 0009). Only the LLM *ranking* of catalog items
(`triageCatalog`) degrades.

## Acceptance

Exercising every nav-registry page with `llm:false` produces zero hung spinners,
and every LLM entry point either shows the "available via MCP" message or
silently skips a background enrichment — verified against the disposition above.
