# Architecture Review — Provider-backed learning LLM methods (design spec)

**Target (only file in scope):** `docs/superpowers/specs/2026-06-17-learning-llm-methods-design.md`
**Reviewed against:** `sidecar/src/rpc-handlers.ts`, `sidecar/src/cli-provider.ts`, `sidecar/src/providers/*`, `sidecar/src/rpc-server.ts`, `sidecar/vendor/webview/shared.ts`, `tools/patches/0006-webview-llm-capability-gate.patch`, `sidecar/vendor/webview/panel-llm.ts`, `sidecar/vendor/webview/panel-request-service.ts`, `sidecar/vendor/webview/page-learning.ts`, `sidecar/vendor/core/types/rpc-types.ts`, ADRs 0006 / 0009 / 0010, `tools/patches/README.md`.

This reviews the *design*, not code. The verdict measures whether the proposed seam, layering, contracts, and failure semantics are sound and faithful to the real system as it exists today.

---

## Verdict

**Ready to merge as a design — with two corrections required before implementation.** The architecture is fundamentally sound: it reuses the established provider seam, respects the sidecar/host/webview layering, keeps divergence bounded, and matches the failure semantics of `generateRule`/`explainOccurrence`. Two items must be fixed in the spec text (one is a factual source-file error that will mislead the implementer; one is a contract-fidelity gap). The remainder are important-but-non-blocking refinements.

- **Critical:** 1
- **Important:** 4
- **Suggestions:** 4

---

## 1. Layer Separation

The design preserves the project's three-tier separation exactly:

- **Sidecar stays provider-agnostic.** `learning-provider.ts` is proposed as a non-vendored `sidecar/src/` module that calls the existing `CliProvider` contract (`provider.run(prompt, opts)`) via the same `runWithProvider` seam `generateRule`/`explainOccurrence` use. It names no provider; `resolveProvider(ctx.provider.id)` continues to do the narrowing. **Clean.**
- **Host stamps.** The design relies on the Kotlin bridge stamping `provider: { id, binaryPath }` onto the envelope (ADR 0010 §2) and synthesizing `capabilities.provider.status` per-window (§3). The spec adds no new host architecture — explicitly an "Out of Scope" goal. **Clean.**
- **Webview gates.** Patch 0006 grows only to move the four methods into `PROVIDER_METHODS`; the gate logic (`refreshCapabilities` → `providerStatus !== 'active'` reject) is unchanged. **Clean.**

**Dependency direction is correct and is the central design merit:** `learning-provider.ts` (sidecar app layer) → `cli-provider.ts` (sidecar contract) → `providers/*` (adapters). It must NOT import `vendor/webview/panel-request-service.ts` or `panel-llm.ts`, both of which import `vscode` at module top level (`panel-request-service.ts:8`, `panel-llm.ts:8`). The spec correctly forbids this. Importing either would crash the sidecar at load (the same failure mode ADR 0009 and patch 0003 already guard against).

No layer violations found in the design.

---

## 2. The `learning-provider.ts` seam — clean seam vs. drift risk

This is the crux of the review. The seam is the right shape, but the spec mis-describes its source of truth, and that error changes the drift calculus.

### CRITICAL — The spec cites the wrong upstream source file

The spec says (Architecture, Decisions): adapt "JSON cleanup, repair, and retry behavior **from upstream `panel-llm.ts`**" and "Keep prompts, JSON parsing, retries, and normalizers in sidecar-owned code rather than importing `sidecar/vendor/webview/panel-llm.ts`, because that file imports `vscode`."

Two facts contradict this:

1. **`panel-llm.ts` does NOT contain the prompts, validators, or normalizers for these four methods.** It contains only the JSON *schemas* (`SCHEMA_QUIZ`, `SCHEMA_CODE_REVIEW`, `SCHEMA_DID_YOU_KNOW`, `SCHEMA_RESOURCES`), the `parseLlmJson`/`balanceTruncatedJson` helpers, and the `callLlm`/`callLlmJson` request loop. The **prompt builders, per-method validators, and normalizers actually live in `panel-request-service.ts`** (`handleGenerateLearningQuiz` + `buildQuizSystemPrompt`/`buildQuizUserPrompt`/`normalizeQuizQuestions` at lines 154–287, 361–377; `handleGenerateCodeComparison` 379–470; `handleGenerateDidYouKnow` 472–519; `handleGenerateLearningResources` 521–568).
2. `panel-llm.ts` imports `vscode` at line 8 (for `LanguageModelChat` types and `callLlm`), so the "can't import it" reasoning is *coincidentally* true — but for the JSON helpers, not for the logic the spec is actually re-deriving.

**Why this is critical, not cosmetic:** the implementer following the spec will look in `panel-llm.ts` for the prompt/validator/normalizer logic, not find it, and either (a) under-implement, or (b) discover the real source mid-implementation and have to redesign which symbols to mirror. The spec must name `panel-request-service.ts` as the source for prompts/validators/normalizers and `panel-llm.ts` as the source for the JSON-repair helpers. **Fix the spec text before implementation.**

### Bounded divergence vs. a vendor export patch — the right call, but state it explicitly

The cli-provider precedent (ADR 0010 consequences; `tools/patches/0008`) reused `generateRule`'s prompt/validators via an **export-only patch** (`0008`) precisely to avoid "duplicating ~120 lines that would rot on every re-sync," and re-derived only the `explainOccurrence` inline literals in the override.

These four learning methods are the opposite case:

- The logic lives inside **private methods of a `vscode`-importing class** (`PanelRequestService`). You cannot `export` them with a 0008-style one-line patch — they are instance methods, not module-private free functions, and the module's top-level `import * as vscode` poisons the whole file for sidecar import regardless of what you export.
- Therefore **re-deriving in `learning-provider.ts` is the only non-`vscode` option** short of refactoring upstream (a heavy, non-upstreamable `vendor/core`/`vendor/webview` divergence the project rule forbids — same reasoning that descoped `compileNlRule`, ADR 0010 §6).

So the design's choice is correct, but the spec should **explicitly record the trade-off and its drift cost** the way ADR 0010 did: this duplicates the four prompt strings + four validator/normalizer blocks (~120–180 lines) into non-vendored code that will silently drift if upstream changes a prompt, a category enum, or a clamp. That is an *acceptable, bounded* divergence (the upstream logic is stable and the webview consumers pin the shapes), but it is unlogged divergence — unlike a vendor patch, nothing forces a re-sync to surface it. **Recommend an ADR or a docstring + a re-sync checklist note so the drift is discoverable.** (See Important #2.)

---

## 3. Contract fidelity — "one flat prompt" and the dropped structured-output schema

### Collapsing role-tagged messages into one flat prompt — acceptable for all four

Upstream sends `LanguageModelChatMessage.User(systemPrompt)` + `.User(userPrompt)` (quiz, code-comparison) or a single `.User(systemPrompt)` (did-you-know, resources). Note these are **both `User` turns, not System+User** — there is no role distinction to lose. The provider contract takes one flat string (`cli-provider.ts:52` "role/turn structure is collapsed by the caller"), and `generateRule`/`explainOccurrence` already collapse `system\n\nuser` with no observed loss. Concatenating `systemPrompt\n\nuserPrompt` for the two two-message methods is faithful. **No semantic loss for these four.**

### IMPORTANT — Loss of structured-output JSON-schema enforcement is real and unaddressed

Upstream's `callLlmJson(..., SCHEMA_*)` passes `response_format: { type: 'json_schema', strict: true, schema }` to the model (`panel-llm.ts:16–23, 377–383`). The CLI providers have **no equivalent** — `claude -p --output-format json` returns a free-form `.result` string (`claude-provider.ts`), and Copilot returns plain text. So the design trades hard schema enforcement for **prompt-instruction + parse-and-retry**.

The spec's mitigation (JSON-only nudge retry, then `bad-output`) is the correct and only available substitute, and it mirrors `callLlmJson`'s own fallback path (`panel-llm.ts:411–418` drops structured output and nudges on parse failure). But the spec frames this as merely "adapted retry behavior" and does not acknowledge that **the schema guarantee is gone** — meaning malformed-but-parseable output (e.g. `correctIndex: 5`, a 3-choice question, an unknown category) is more likely than upstream. This is exactly why the per-method validators/normalizers (filter invalid items, clamp counts, fill defaults) are load-bearing here in a way they are not upstream. The spec *does* specify those validators, so the design is safe — but it should **state that the validators are now the primary correctness gate, not a backstop**, so they are not skimped in implementation. Verify the validators match upstream exactly (they do today: quiz requires exactly 4 choices and `0 ≤ correctIndex < 4` at `panel-request-service.ts:272–286`; the spec's "exactly four choices / 0..3" matches).

### Response shapes — verified against consumers, one nuance

The webview consumers pin these exact shapes (`page-learning.ts`):

| Method | Consumer reads | Type (`rpc-types.ts:122–125`) | Spec matches? |
| --- | --- | --- | --- |
| `generateLearningQuiz` | `result.questions ?? []` (L66) | `{ questions: unknown[] }` | Yes |
| `generateCodeComparison` | `result.rounds ?? []` (L480) | `{ rounds: unknown[] }` | Yes |
| `generateDidYouKnow` | `result.facts ?? []` (L544) | `{ facts: unknown[] }` | Yes |
| `generateLearningResources` | `data.resources ?? []` (L656) | `{ resources: unknown[]; error?: string }` | Partly — see below |

The spec correctly names per-item shapes (quiz `correctIndex` 0–3, code-comparison `betterSnippet ∈ {A,B}`, etc.) and they match the upstream normalizers and the `page-learning.ts` field reads (`r.betterSnippet` L419, `q.correctIndex` L806). **The four wrapper keys are correct.**

---

## 4. Failure Semantics

The design's failure mapping is consistent with the existing provider path:

- **Absent / unresolvable provider stamp → bare `{ error: 'llm-unavailable' }`.** Matches `runWithProvider` (`rpc-handlers.ts:277–280`) and the historical `LLM_UNAVAILABLE_METHODS` behavior. The webview reactive path treats a bare `llm-unavailable` as the generic "ask Claude Code" message (`shared.ts:148–153`). **Consistent.**
- **Runtime provider failure → `{ error: 'llm-unavailable', reason }`.** Matches `runWithProvider`'s `errorResult('llm-unavailable', { reason: result.reason })` (`rpc-handlers.ts:285`). The webview maps `reason` (`timeout`/`cli-error`/`bad-output`) through `PROVIDER_MESSAGES` (`shared.ts:148–153`, 41–49). **Consistent.**
- **Bad output after retries → `{ error: 'llm-unavailable', reason: 'bad-output' }`.** `bad-output` is a defined `ProviderFailureReason` (`cli-provider.ts:33`) and already has a webview message ("returned unusable output. Try again."). Reusing it for the JSON-parse-exhausted case is semantically apt and needs no new wire vocabulary. **Consistent.**

### IMPORTANT — `generateLearningResources` empty result vs. `error` field is under-specified

The upstream resources handler is the one method that, on a thrown error, posts `postError(..., { resources: [] })` (`panel-request-service.ts:566`) — i.e. it returns the partial `{ resources: [] }` shape *alongside* the error so the consumer's `data.resources ?? []` (L656) renders empty rather than crashing. The `rpc-types.ts:123` shape `{ resources: unknown[]; error?: string }` encodes this dual nature.

The spec says two things that are subtly different: "return an empty `resources` array" on no valid resources (success path), and route provider failures through `llm-unavailable`. It does **not** specify what the *runtime-failure* envelope for resources looks like — bare `{ error: 'llm-unavailable', reason }` (the provider convention) or `{ error: ..., resources: [] }` (the upstream convention). Either works for the consumer (it reads `data.resources ?? []` and the `.catch` handler surfaces `err.message`), but the spec should **pick one explicitly** so the implementer and the test ("provider failure returns `llm-unavailable` plus `reason`") agree. Recommend the provider convention (bare `llm-unavailable` + `reason`) for consistency with the other three methods, and rely on `?? []` for the empty render. Confirm `page-learning.ts:648` catch path surfaces the translated message (patch 0006 already wired `err.message` for resources, L177–183).

---

## 5. Patch 0006 growth — single-flag UX for the other methods stays intact

The proposed change moves the four methods into `PROVIDER_METHODS` while leaving them in `LLM_METHODS` (for the 300 s timeout). Tracing `shared.ts:rpc()`:

- `PROVIDER_METHODS.has(method)` is checked **first** (L86) → the four methods take the `refreshCapabilities()` + `providerStatus` gate, identical to `generateRule`/`explainOccurrence`. Correct.
- The `llmAvailable === false && LLM_METHODS.has(method)` branch (L98) is only reached for methods **not** in `PROVIDER_METHODS`. So `compileNlRule`, `createSkill`, `generateSkillContent`, `triageSkills`, `triageCatalog`, `reviewContextFiles` keep the single-flag "ask Claude Code" UX. **Intact — no regression.**
- The timeout selection (`LLM_METHODS.has(method)` → `RPC_LLM_TIMEOUT_MS`, L71) still applies to all twelve. Correct.

The growth is the minimal edit: change one set membership. It is the same kind of risk-flagged expansion already logged in `tools/patches/README.md:45` for the first two methods; **the README row must be updated** to say four methods (now six total provider-backed) gate on `provider.status` and the count of single-flag methods drops from 10 to 6. (The spec's Testing section asserts `LLM_UNAVAILABLE_METHODS.size` drops 10→6, which is the sidecar mirror of this.) The spec does not mention updating the README row — **add it.** (Important #3.)

### IMPORTANT — `getCapabilities` re-poll cost: four learning calls now each trigger an extra round-trip

Each provider-backed call does `refreshCapabilities()` (an extra `getCapabilities` RPC) before sending (`shared.ts:86–94`). The Learning page fires several of these (quiz, resources, comparison, did-you-know) and `page-learning.ts` shows them rendering on a single page, sometimes near-simultaneously. With two provider methods this was negligible; with six, a Learning-page load can now issue 4 back-to-back `getCapabilities` round-trips in addition to the four method calls. This is not wrong (the re-poll is the whole point — no host→webview push, ADR 0010 §5), but the spec should acknowledge it and confirm it is acceptable, or note that `getCapabilities` is cheap/host-synchronous. Not a blocker; flagging because the per-call re-poll was designed for occasional rule/occurrence actions, not a page that fans out four LLM calls at once.

---

## 6. Sidecar dispatcher changes

`rpc-handlers.ts` changes are correctly scoped:

- Remove four entries from `LLM_UNAVAILABLE_METHODS` (currently 10, → 6). The remaining set (`compileNlRule`, `createSkill`, `generateSkillContent`, `triageSkills`, `triageCatalog`, `reviewContextFiles`) matches ADR 0009's degrade list minus the four now wired. Consistent.
- Register four handlers in `OVERRIDES`. `resolveHandler` checks `LLM_UNAVAILABLE_METHODS` *before* `OVERRIDES` (`rpc-handlers.ts:382–383`), so a method must be removed from the set or the override is shadowed. The spec says to do both — correct, and worth keeping as an explicit test (the spec's "no longer in `LLM_UNAVAILABLE_METHODS`" assertion covers it).
- The handlers receive `ctx.provider` and degrade via the same `runWithProvider` seam. The spec implies reuse of that seam — **recommend it explicitly import and reuse `runWithProvider`** rather than re-implementing the provider-absent/unresolvable/failure branches, to avoid a second copy of that logic drifting from the canonical one (Suggestion).

---

## Findings summary

### Critical (fix before implementation)
1. **Wrong source file cited.** The spec says the prompts/validators/normalizers come from `panel-llm.ts`; they actually live in `panel-request-service.ts` (a `vscode`-importing class). `panel-llm.ts` holds only schemas + JSON-repair helpers. The implementer will be misled. Correct the spec to name both sources accurately.

### Important
2. **Bounded divergence is unlogged.** Re-deriving four prompt/validator/normalizer blocks (~120–180 lines) into non-vendored `learning-provider.ts` is the correct choice (no 0008-style export patch is possible — the logic is private methods on a `vscode` class), but unlike a vendor patch nothing forces re-sync discovery. Record the trade-off + a re-sync checklist note (mirror ADR 0010's treatment).
3. **Patch 0006 README row + count not updated.** The divergence log (`tools/patches/README.md:45`) says two provider-backed methods; it must become six, and the single-flag count 10→6. The spec omits this.
4. **`generateLearningResources` runtime-failure envelope under-specified.** Upstream returns `{ error, resources: [] }`; the provider convention is bare `{ error: 'llm-unavailable', reason }`. The spec must pick one so the test and implementation agree (recommend the provider convention).
5. **Structured-output guarantee is lost, making validators the primary correctness gate.** CLI providers have no `json_schema` enforcement; the spec should state that the per-method validators/normalizers now *are* the correctness boundary (not a backstop) and must match upstream exactly.

### Suggestions
- Reuse the existing `runWithProvider` seam in the four handlers rather than re-implementing the absent/unresolvable/failure branches.
- Acknowledge the 4×`getCapabilities` re-poll fan-out on a single Learning-page load; confirm acceptable.
- Add a test that each handler is shadowed correctly (removed from `LLM_UNAVAILABLE_METHODS` AND present in `OVERRIDES`), since `resolveHandler` checks the set first.
- Consider a shared JSON-parse-and-retry helper in `learning-provider.ts` (the four methods + the `generateRule` retry loop share the same shape) to keep the parse/nudge/`bad-output` logic in one place rather than four.

---

## Closing assessment

The design respects every established boundary: provider-agnostic sidecar, host-stamped envelope, webview capability gate, one-way dependency flow, and bounded vendor divergence. The "one flat prompt" collapse loses nothing for these four methods (both upstream turns are `User` turns). The failure semantics are a faithful extension of the `generateRule`/`explainOccurrence` path. The only true defect is the **mis-cited source file (Critical #1)**, which will actively mislead implementation; the four Important items are accuracy/documentation gaps that should be closed in the spec but do not change the architecture. With those corrections, this is a clean, well-layered design.
