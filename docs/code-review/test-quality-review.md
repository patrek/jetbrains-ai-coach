# Test Quality Review — Design Spec: Provider-backed Learning LLM Methods

**Spec**: `docs/superpowers/specs/2026-06-17-learning-llm-methods-design.md`  
**Review scope**: Testing section only (lines ~150–170 of the spec)  
**Ground truth**: `sidecar/src/rpc-handlers.test.ts`, `sidecar/src/cli-provider.ts`  
**Date**: 2026-06-17

---

## 1. Coverage Summary

The spec's required test list covers the following nine bullets:

1. `LLM_UNAVAILABLE_METHODS.size` drops from 10 to 6
2. The four Learning methods are no longer in `LLM_UNAVAILABLE_METHODS`
3. Each method returns the expected shape on fake-provider success
4. Absent provider returns bare `llm-unavailable`
5. Provider failure returns `llm-unavailable` plus `reason`
6. Malformed JSON triggers one retry with the JSON-only nudge
7. Invalid items are filtered and defaults/clamps are applied
8. Learning resources reject non-`https://` URLs
9. Webview gating treats all four Learning methods as provider-backed

The existing test file (`rpc-handlers.test.ts`) covers analogous paths for `generateRule` and `explainOccurrence`, so the spec is drawing from a proven template. The question is whether the nine bullets are sufficient, and whether they are specified with enough precision to be unambiguous during implementation.

---

## 2. Critical Gaps

### 2.1 The `size` assertion conflates two independent invariants

The spec writes the assertion as a single number: `LLM_UNAVAILABLE_METHODS.size` drops from 10 to 6. This matches the existing pattern (the current test asserts `.size === 10` after `generateRule` and `explainOccurrence` were removed from a prior value of 12). However, shrinking the set by exactly four is an **arithmetic identity**, not a behavioral guarantee. If one Learning method is accidentally left in the set and a different non-Learning method is simultaneously removed, the size assertion still passes.

The existing test correctly combines the size check with explicit `has()` probes for each removed method. The spec should mirror this: require one assertion per removed method name (`generateLearningQuiz`, `generateLearningResources`, `generateCodeComparison`, `generateDidYouKnow` each assert `.has(method) === false`), not just the aggregate count.

The spec states "the four Learning methods are no longer in `LLM_UNAVAILABLE_METHODS`" as a second bullet, but it is listed separately from the size bullet rather than mandated as the mechanically required companion. A developer reading the spec could interpret the two bullets as optional alternatives rather than co-required assertions.

**Verdict**: Critical. The size bullet is necessary but not sufficient. The spec must make explicit that both the aggregate size and all four per-method `has()` checks are required in the same test block.

### 2.2 Per-method validator/clamp edge cases are entirely unspecified

Bullet 7 ("invalid items are filtered and defaults/clamps are applied") addresses all four methods with one generic sentence. The spec's Method Behavior section defines non-trivial validation rules for each method:

- `generateLearningQuiz`: `correctIndex` must be 0–3; exactly four choices required; difficulty clamped to `easy|medium|hard`; topic defaults to `"general"` when absent
- `generateCodeComparison`: `betterSnippet` must be `"A"` or `"B"`; category clamped to one of five values; difficulty clamped; language defaulted from request
- `generateDidYouKnow`: category clamped to five values; fact and context must be non-empty; generic/empty facts filtered
- `generateLearningResources`: URL must begin with `https://`; title, type, and reason must be non-empty

These validators will live in `sidecar/src/learning-provider.ts`. They are the most likely source of bugs because they involve range checks, string normalization, and per-item filtering. The spec does not require any test to exercise:

- A quiz question with `correctIndex === 4` (out of 0–3 range) being filtered out
- A quiz question with three choices instead of four being filtered out
- A code comparison with `betterSnippet === "C"` being filtered out
- A code comparison with an unknown category being clamped or filtered
- A did-you-know fact with an unknown category being clamped
- A did-you-know response where all facts are empty, returning an empty array
- A resources response where all URLs are `http://` (non-https), returning an empty `resources` array
- A resources response where some URLs are `https://` and some are not, verifying the mixed filter

The `https://` URL check appears as bullet 8, but it only says "learning resources reject non-`https://` URLs." This is ambiguous: does it mean reject the individual resource item (filtering it out), reject the entire response, or return an error? The spec text says "return an empty `resources` array" when no valid resources remain, but the test bullet does not require coverage of the mixed-URL case or the all-invalid case. These are distinct behaviors that could regress independently.

**Verdict**: Critical. The validator logic is the most complex normalization path in the implementation and yet receives the least specific test coverage in the spec. At minimum, each method needs at least one test for its most restrictive filter rule (correctIndex range, betterSnippet value set, https-only URL) exercised in isolation.

### 2.3 The JSON-repair/retry behavior is underspecified

Bullet 6 requires: "malformed JSON triggers one retry with the JSON-only nudge." The `generateRule` retry path in the existing tests is specified with considerable precision: the test asserts `fakeRun` call count (`toHaveBeenCalledTimes(3)` for two invalid attempts plus a valid final), and it inspects the retry prompt content (`fakeRun.mock.calls[1][0]` contains the prior attempt text and the word `"issues"`).

The spec for the Learning methods says "one retry with the JSON-only nudge" but does not specify:

- Whether "one retry" means a maximum of two total `fakeRun` calls (initial + one retry), or something else
- What the nudge prompt must contain (the spec's Error Handling section says "respond only with a valid JSON object or array, no markdown fences and no commentary" — this is the required nudge content, but the test bullet does not require verifying the nudge prompt text)
- Whether exhausting retries produces `{ error: "llm-unavailable", reason: "bad-output" }` (specified in the Error Handling section) and whether this requires a test
- Whether a provider failure during the retry (not on the first call) must degrade to `llm-unavailable` + the provider's `reason` rather than `bad-output`

The existing `generateRule` tests cover mid-retry provider failure explicitly (`degrades mid-retry if the provider fails after a first invalid attempt`). The spec does not require an equivalent test for the Learning JSON retry path, even though the behavior difference (JSON parse error vs. provider error during retry) is non-trivial.

**Verdict**: Critical. The retry test bullet must require: (a) assertion on total `fakeRun` call count, (b) inspection of retry prompt content for the JSON-only nudge text, (c) a test for exhausted retries returning `{ error: "llm-unavailable", reason: "bad-output" }`, and (d) a test for provider failure mid-retry.

---

## 3. Important Issues

### 3.1 "Focused helper tests if the JSON logic grows" is too vague to enforce

The spec says: "Extend `sidecar/src/rpc-handlers.test.ts` and add focused helper tests if the JSON parsing/normalization logic grows beyond simple inline coverage."

The phrase "grows beyond simple inline coverage" has no objective threshold. The validators described in the spec are already non-trivial: per-field null checks, range clamping, string membership tests, URL prefix filtering, and per-item array filtering for four different response shapes. This logic will almost certainly be extracted into helper functions in `learning-provider.ts`. Whether that constitutes "simple inline coverage" is a judgment call that will be made under implementation pressure, likely in the direction of "it's fine."

The spec should either (a) require a dedicated `sidecar/src/learning-provider.test.ts` unconditionally, since the method-behavior section already documents enough rules to justify a standalone unit test file, or (b) define a concrete threshold: "if any exported function in `learning-provider.ts` exceeds 20 lines or contains more than two conditional branches, it must have direct unit tests in a sibling test file."

### 3.2 "Expected shape on fake-provider success" is not defined per method

Bullet 3 requires each method to return "the expected shape" on fake-provider success. The spec does not define what the expected shape is for any of the four methods. The webview already expects a specific shape for each method (the spec says "returns the current webview response shape"), and these are defined in `sidecar/vendor/webview/page-learning.ts`, but the test bullet does not reference them or reproduce them.

For `generateRule`, the test asserts `{ markdown: cleanRuleMarkdown(VALID_RULE) }` — a concrete shape with a concrete value. The analogous Learning tests need to assert concrete shapes: for `generateLearningQuiz`, something like `{ questions: [{ question: '...', choices: [...], correctIndex: 0, explanation: '...', difficulty: 'easy', topic: 'general' }] }`; for `generateLearningResources`, `{ resources: [{ title: '...', url: 'https://...', type: '...', reason: '...' }] }`; and so on.

Without the expected shapes being defined in the spec's test requirements, an implementer could assert `expect(result).toHaveProperty('questions')` — a structurally weak check that would pass even if the question items have incorrect field names or types.

### 3.3 The webview-gating test claim is unrealistic as specified

Bullet 9 requires: "webview gating treats all four Learning methods as provider-backed methods."

In the existing test suite, webview gating is tested through `0006-webview-llm-capability-gate.patch`, not through the `rpc-handlers.test.ts` suite. The patch file is a text patch — it has no test harness, no DOM, and no runtime. PR #14 explicitly deferred a webview render test for the same reason: the webview has no DOM test harness in the sidecar test environment.

The spec lists this bullet in the context of "Extend `rpc-handlers.test.ts`," which means it implicitly expects this to be a Node.js/Vitest test. But the webview gating logic runs in the browser-side webview code, not in the sidecar RPC layer. The `rpc-handlers.test.ts` suite tests what the sidecar does when called, not whether the webview calls the sidecar in the first place.

There are two realistic interpretations of this bullet:

1. Verify that the four method names appear in the `PROVIDER_METHODS` set in the patch (a grep/string-search test against the patch text, not a runtime test). This is testable but unusual.
2. Accept that this is a patch-review criterion rather than an automated test, and remove it from the automated test list.

Neither interpretation matches "extend `rpc-handlers.test.ts`." The spec should disambiguate: either describe an explicit static assertion (e.g., read the patch file text and assert each method name appears in `PROVIDER_METHODS`), or move the webview-gating verification into a code-review checklist rather than an automated test requirement.

### 3.4 Empty-result paths are not required

The spec's Method Behavior section defines filtering behavior: invalid items are removed from the result. This means each method can return an empty array if all provider-generated items fail validation. The empty-result path is a distinct behavioral state — the webview must handle it gracefully (showing an empty state vs. a spinner vs. an error). The spec requires testing "invalid items are filtered" but does not require testing the case where filtering produces zero valid items.

For `generateLearningResources` specifically, the spec says "If the provider returns no valid resources, return an empty `resources` array." This is the only explicit empty-result statement, but the spec does not require a test for it. The analogous cases for the other three methods (all quiz questions filtered, all comparisons filtered, all facts filtered) are left untested.

---

## 4. Suggestions

### 4.1 Consolidate the size + membership assertions into one required test block

The spec's first two bullets should be collapsed into a single test block specification: "One test asserts `LLM_UNAVAILABLE_METHODS.size === 6`, and four separate `.has()` assertions confirm each Learning method name is absent." This matches the existing pattern in the test file and prevents the size arithmetic from masking a set membership error.

### 4.2 Add a `ProviderResult` contract note to the test spec

The spec mentions wiring to the CLI provider infrastructure but does not remind implementers that the fake provider must return values satisfying `ProviderResult` from `cli-provider.ts` (`{ ok: true; text: string } | { ok: false; reason: ProviderFailureReason }`). For Learning methods returning JSON, the `text` field carries the raw JSON string. Tests that use `fakeRun.mockResolvedValue({ ok: true, text: '...' })` should include a note that `text` must be a valid JSON string (not a pre-parsed object) for the JSON helper path to be exercised.

### 4.3 Specify the retry count constraint in terms of `fakeRun` call count

Rather than "malformed JSON triggers one retry," the spec should say: "malformed JSON on the first call triggers a second call with the JSON-only nudge text; `fakeRun` is called exactly twice." This matches how `generateRule`'s retry tests are written and produces an unambiguous, implementer-friendly assertion.

### 4.4 Consider a per-method test describe block

The existing test file uses `describe('generateRule (provider-wired)', ...)` and `describe('explainOccurrence (provider-wired)', ...)`. With four new methods, a flat list of tests in one describe block would become unwieldy. The spec should suggest (or require) one `describe` block per method, mirroring the existing pattern, so tests can be found and extended independently.

---

## 5. Anti-Pattern Risks

The following anti-patterns are likely to emerge during implementation given the underspecification noted above. They are not present yet (the spec precedes the code), but the spec's ambiguity makes them probable:

| Risk | Source | Why it matters |
|---|---|---|
| Weak shape assertion (`toHaveProperty('questions')`) | Bullet 3 does not define shapes | Passes even with wrong field names |
| Tautological clamp test (`expect(difficulty, 'easy')` where the input was already `'easy'`) | Bullet 7 does not require out-of-range inputs | Clamp logic untested; bugs silent |
| Missing call-count assertion in retry test | Bullet 6 says "one retry" but does not require `toHaveBeenCalledTimes` | Implementation could call provider three times; test still passes |
| Over-counting retries (`generateRule` does up to 3 calls; spec says "one retry" = 2) | Ambiguous "retry" language | Implementation may diverge from spec's intent |

---

## 6. Verdict

**Fix required before implementation begins.** The spec's test section provides a correct high-level checklist but is underspecified in three critical areas that will produce either false-confidence tests or untested validator branches:

1. The `size` assertion must be paired with mandatory per-method `has()` checks.
2. The validator/clamp edge cases must be enumerated per method, not collapsed into one generic bullet.
3. The JSON-retry specification must include call-count, nudge-prompt content, exhausted-retry, and mid-retry-failure requirements.

The webview-gating bullet should either be recast as a static patch-text assertion or moved out of the automated test list entirely.

The "focused helper tests if the JSON logic grows" escape hatch should be either removed (and a dedicated test file required unconditionally) or replaced with a concrete, objective threshold.

**Critical issues**: 3  
**Important issues**: 4  
**Suggestions**: 4
