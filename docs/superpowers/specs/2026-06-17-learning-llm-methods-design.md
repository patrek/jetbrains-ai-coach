---
title: "Design: Provider-backed learning LLM methods"
date: 2026-06-17
status: approved-for-review
scope:
  - generateLearningQuiz
  - generateLearningResources
  - generateCodeComparison
  - generateDidYouKnow
---

# Provider-backed learning LLM methods

## Purpose

Wire the four Learning page LLM methods to the selectable CLI provider
infrastructure introduced by PR #13/#14. These methods currently degrade through
`LLM_UNAVAILABLE_METHODS`; after this work, they should behave like
`generateRule` and `explainOccurrence`: use the host-stamped provider when active
and return `llm-unavailable` when no usable provider is available.

The goal is to make the Learning page's quiz, resources, code-comparison, and
did-you-know experiences usable without introducing new host architecture or
expanding vendored divergence beyond the existing webview gate patch.

## Decisions

- Implement all four Learning methods in one PR.
- Gate all four methods on detailed provider status in the webview.
- Use conservative URL handling for learning resources: accept only `https://`
  URLs and do not claim network verification.
- Keep prompts, JSON parsing, retries, and normalizers in sidecar-owned code
  rather than importing `sidecar/vendor/webview/panel-llm.ts`, because that file
  imports `vscode`.

## Architecture

Add a non-vendored sidecar module, `sidecar/src/learning-provider.ts`. It owns
the learning-specific provider work:

- prompt builders for `generateLearningQuiz`, `generateLearningResources`,
  `generateCodeComparison`, and `generateDidYouKnow`
- a local JSON helper layered on the existing CLI provider path
- JSON cleanup, repair, and retry behavior adapted from upstream `panel-llm.ts`
  without importing the `vscode` dependency
- per-method validators and normalizers that return the response shapes the
  existing webview already expects

`sidecar/src/rpc-handlers.ts` remains the dispatcher. It should remove the four
Learning methods from `LLM_UNAVAILABLE_METHODS`, register the learning handlers
in `OVERRIDES`, and keep provider failure semantics consistent with the existing
provider-backed methods.

`tools/patches/0006-webview-llm-capability-gate.patch` should grow only enough
to move the four Learning methods into `PROVIDER_METHODS`. They should still be
listed in `LLM_METHODS` for timeout handling, but provider-backed preflight should
use `capabilities.provider.status`, not the generic `capabilities.llm` message.

## Data Flow

1. The Learning page calls the same RPC method names it already uses.
2. `shared.ts` refreshes `getCapabilities` before provider-backed calls.
3. If `provider.status` is not `active`, the webview rejects with the existing
   provider-status message and does not send the method request.
4. Kotlin stamps the provider into the sidecar request envelope only when the
   provider is selected, consented, installed, and authenticated.
5. `resolveHandler()` dispatches the request to the matching learning handler.
6. The handler validates and clamps input parameters, builds one flat prompt, and
   calls the selected CLI provider.
7. The JSON helper parses provider text, repairs common JSON formatting issues,
   and retries with a JSON-only nudge when parsing fails.
8. The method normalizer filters invalid items, clamps counts, fills safe
   defaults, and returns the current webview response shape.

Provider failures should match `generateRule` and `explainOccurrence`:

- absent or unresolvable provider stamp: `{ error: "llm-unavailable" }`
- runtime provider failure: `{ error: "llm-unavailable", reason }`

The webview translates both forms through the provider/generic messages already
owned by patch `0006`.

## Method Behavior

### `generateLearningQuiz`

Generate up to three multiple-choice questions. Each valid question requires:

- a non-empty question string
- exactly four choices
- a numeric `correctIndex` from 0 through 3
- a non-empty explanation
- difficulty clamped to `easy`, `medium`, or `hard`
- a topic string, defaulting to `general` when missing

The prompt should keep upstream's intent: practical coding scenarios using the
developer's stack, not package-install trivia.

### `generateCodeComparison`

Generate up to three side-by-side code review rounds. Each valid round requires:

- non-empty `snippetA` and `snippetB`
- `betterSnippet` equal to `A` or `B`
- non-empty title and explanation
- category clamped to `performance`, `safety`, `readability`, `correctness`, or
  `security`
- difficulty clamped to `easy`, `medium`, or `hard`
- language defaulted from the request when missing

The prompt should ask for plausible, professional snippets with subtle tradeoffs,
not obviously broken examples.

### `generateDidYouKnow`

Generate up to five stack-specific facts. Each valid fact requires:

- a non-empty fact
- a non-empty project/dependency context
- category clamped to `performance`, `api`, `pitfall`, `config`, or `debug`

Generic or empty facts should be filtered out rather than padded.

### `generateLearningResources`

Generate up to six resource recommendations. Each valid resource requires:

- a non-empty title
- a URL beginning with `https://`
- a type string
- a reason string

The prompt should ask for high-confidence official or well-known resources. It
must not imply that the sidecar performs live link verification. If the provider
returns no valid resources, return an empty `resources` array.

## Error Handling

Input validation should be local and deterministic. Bad or missing optional
fields should fall back to the same defaults upstream uses. Provider availability
errors should use `llm-unavailable` so the webview continues to display the
existing capability/provider messages.

Malformed JSON should trigger a bounded retry with an additional instruction:
respond only with a valid JSON object or array, no markdown fences and no
commentary. After retries are exhausted, return
`{ error: "llm-unavailable", reason: "bad-output" }` so the webview surfaces the
same provider failure message used for unusable CLI output.

## Testing

Extend `sidecar/src/rpc-handlers.test.ts` and add focused helper tests if the
JSON parsing/normalization logic grows beyond simple inline coverage.

Required coverage:

- `LLM_UNAVAILABLE_METHODS.size` drops from 10 to 6
- the four Learning methods are no longer in `LLM_UNAVAILABLE_METHODS`
- each method returns the expected shape on fake-provider success
- absent provider returns bare `llm-unavailable`
- provider failure returns `llm-unavailable` plus `reason`
- malformed JSON triggers one retry with the JSON-only nudge
- invalid items are filtered and defaults/clamps are applied
- learning resources reject non-`https://` URLs
- webview gating treats all four Learning methods as provider-backed methods

Verification target: `cd sidecar && npm test`.

Kotlin tests are not required for this slice unless the implementation changes
host stamping, provider detection, settings, or capabilities synthesis.

## Out of Scope

- `compileNlRule`
- `createSkill` and `generateSkillContent`
- `triageSkills`, `triageCatalog`, and `reviewContextFiles`
- GitHub token or SDLC data capability work
- host-to-webview capability push
- live network validation of learning-resource URLs
- new CLI providers
