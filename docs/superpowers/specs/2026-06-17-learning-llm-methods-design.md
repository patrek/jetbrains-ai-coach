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
  rather than importing the upstream sources, because both are `vscode`-coupled at
  module level and cannot be imported (nor cleanly export-patched like `0008`):
  - **Prompts, per-method validators, and normalizers** live in
    `sidecar/vendor/webview/panel-request-service.ts` — a `vscode`-importing
    service class (`PanelRequestService`), not `panel-llm.ts`.
  - **JSON schemas and the repair helpers** (`parseLlmJson`,
    `balanceTruncatedJson`) live in `sidecar/vendor/webview/panel-llm.ts`, which
    does `import * as vscode` and uses it at runtime (`vscode.lm`,
    `CancellationTokenSource`) — so the module-level import poisons even the pure
    helpers. Re-derive them in sidecar-owned code.

## Architecture

**Why a module (not inline in `rpc-handlers.ts`).** `generateRule` and
`explainOccurrence` live inline because they reuse vendored prompts/validators via
the `0008` export patch — only a few lines of glue each. These four methods cannot
import their upstream logic (see Decisions), so they re-derive ~4 prompt builders,
the `parseLlmJson`/`balanceTruncatedJson` repair helpers, and 4 validator/
normalizers — several hundred lines. That volume belongs in a dedicated module,
not bloating the dispatcher. (An export patch was evaluated and rejected: unlike
patch `0003`, which made `panel-shared.ts`'s `vscode` import type-only, `panel-llm.ts`
uses `vscode` at runtime — `vscode.lm`, `CancellationTokenSource` — so its
module-level import cannot be made type-only, and the prompts/validators live in a
`vscode`-importing service class anyway.)

Add a non-vendored sidecar module, `sidecar/src/learning-provider.ts`. It owns
the learning-specific provider work:

- prompt builders for `generateLearningQuiz`, `generateLearningResources`,
  `generateCodeComparison`, and `generateDidYouKnow`, re-derived from the prompt
  text in `panel-request-service.ts`
- a local JSON helper layered on the existing CLI provider path
- JSON cleanup, repair, and retry behavior re-derived from the `parseLlmJson` /
  `balanceTruncatedJson` helpers in `panel-llm.ts` (not imported — see Decisions)
- per-method validators and normalizers (re-derived from
  `panel-request-service.ts`) that return the exact response shapes the existing
  webview already expects (see "Response shapes" below)

`sidecar/src/rpc-handlers.ts` remains the dispatcher and keeps the handlers
**thin**: it removes the four Learning methods from `LLM_UNAVAILABLE_METHODS` and
registers them in `OVERRIDES` via a `LEARNING_HANDLERS` record spread in (mirroring
the existing `SDLC_CATALOG_HANDLERS` pattern). Each handler validates/clamps its
input params, asks `learning-provider.ts` to build the flat prompt, calls the
existing **`runWithProvider(ctx, prompt)`** seam (do not re-implement the provider
failure branches), then hands the returned text to the module's parse/validate/
normalize pipeline. Provider failure semantics stay identical to `generateRule`/
`explainOccurrence`.

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

## Response shapes (webview contract)

Each handler must return the **exact wrapper key** the Learning page already reads
(`page-learning.ts` does `result.<key> ?? []`, so a wrong or missing key renders
nothing while the call "succeeds" — this is a silent-failure trap). The provider's
JSON is an array (or `{ items: [...] }`); the handler unwraps it, validates/clamps
each item, and returns it under the wrapper key below:

| Method | Wrapper key | Item type (from `page-learning.ts`) |
| --- | --- | --- |
| `generateLearningQuiz` | `{ questions: [...] }` | `QuizQuestion[]` |
| `generateCodeComparison` | `{ rounds: [...] }` | `CodeComparisonRound[]` |
| `generateDidYouKnow` | `{ facts: [...] }` | `DidYouKnowFact[]` |
| `generateLearningResources` | `{ resources: [...] }` | `CachedResource[]` |

On success a method always returns its wrapper key with a (possibly empty) array —
never a bare array and never the provider's raw `{ items: [...] }` envelope.

## Method Behavior

**Validation is the primary correctness gate.** The VS Code path enforced a
`json_schema` on the model; the CLI path has no such enforcement, so these
validators/normalizers are the *only* thing keeping malformed items out of the
webview — they must match upstream exactly, not act as a loose backstop.

**Reject vs. clamp (mirror `panel-request-service.ts` precisely).** Each handler
unwraps the provider's array (or `{ items: [...] }`), **filters** items that fail a
hard requirement (drops the whole item), then **clamps/defaults** soft fields,
then slices to the per-method cap. The split per method (verified against upstream):

| Method (cap) | Reject (drop item) if… | Clamp / default |
| --- | --- | --- |
| Quiz (3) | `question` not a string; `choices` not an array of **exactly 4**; `correctIndex` not a number in **0–3**; `explanation` not a string | `difficulty` → request difficulty if not one of easy/medium/hard; `topic` → `general` if empty |
| Code comparison (3) | `snippetA`/`snippetB` not non-empty strings; `betterSnippet` not `A`/`B`; `title`/`explanation` not strings | `category` → `readability` if unknown; `difficulty` → request difficulty if unknown; `language` → request lang / `code` |
| Did-you-know (5) | `fact` not a non-empty string; `project` not a string | `category` → `api` if unknown |
| Resources (6) | `title` not a string; `url` not a string or not starting `https://` | `type` → `Resource` if empty; `reason` → `''` if empty |

`correctIndex` and the 4-choice count are **reject** conditions, not clamps —
do not coerce them.

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

**Success vs. failure envelope (resolves the resources ambiguity).** On success a
method returns its wrapper key with a (possibly empty) array — e.g. all items
filtered out → `{ resources: [] }`, **not** an error. A genuine provider/parse
failure returns the standard provider envelope: bare `{ error: "llm-unavailable" }`
(no provider stamped / unresolvable) or `{ error: "llm-unavailable", reason }`
(runtime failure), matching `generateRule`/`explainOccurrence`. We **do not** copy
upstream's `postError(..., { resources: [] })` shape (an artifact of its
`postError` signature) — the empty-array case is success, the error case is the
plain provider envelope. The webview already distinguishes them: it reads
`result.resources ?? []` on success and surfaces the provider message on `error`.

**Why the retry is warranted (not speculative).** The CLI path loses upstream's
`json_schema` enforcement, and providers return free-form text (Claude's `.result`
can carry fences/prose; Copilot is plain text), so malformed JSON is *more* likely
here than on the VS Code path. A single bounded retry adds an instruction: respond
only with a valid JSON object or array, no markdown fences and no commentary. After
the retry is exhausted, return `{ error: "llm-unavailable", reason: "bad-output" }`
so the webview surfaces the same provider failure message used for unusable CLI
output. (A provider failure *on the retry call* returns its real `reason`, not
`bad-output`.)

## Testing

Extend `sidecar/src/rpc-handlers.test.ts`, one `describe` block per method
(mirroring the existing `generateRule`/`explainOccurrence` blocks). Add a
`sidecar/src/learning-provider.test.ts` for the re-derived JSON repair/retry
helpers (the validator/normalizer logic is non-trivial — pin it directly).

**The fake provider must hand back a raw JSON *string* in `text`** (not a parsed
object), so the handler's JSON parse/repair/normalize path is actually exercised.

Required coverage:

*Set membership*
- `LLM_UNAVAILABLE_METHODS.size` drops from 10 to 6, **and** each of the four
  methods individually asserts `LLM_UNAVAILABLE_METHODS.has('<method>') === false`
  (the size check alone can pass with the wrong members).

*Success shape (per method)* — assert the **specific wrapper key** from the
"Response shapes" table, not just "an object":
- `generateLearningQuiz` → `result.questions` is an array of valid questions
- `generateCodeComparison` → `result.rounds`
- `generateDidYouKnow` → `result.facts`
- `generateLearningResources` → `result.resources`

*Provider failure semantics* (per the existing provider-backed methods)
- absent/unresolvable provider stamp → bare `{ error: 'llm-unavailable' }`
- runtime provider failure → `{ error: 'llm-unavailable', reason }`

*JSON retry* (match the upstream intent precisely)
- malformed JSON on the first call → provider invoked **exactly twice**
  (`toHaveBeenCalledTimes(2)`), and the retry prompt **contains the JSON-only
  nudge text**
- retries exhausted (still malformed) → `{ error: 'llm-unavailable', reason: 'bad-output' }`
- a provider failure *on the retry call* → `{ error: 'llm-unavailable', reason }`
  (not `bad-output`)

*Validator / normalizer edge cases (per method — these are now the primary
correctness gate, since the CLI path loses upstream's `json_schema` enforcement)*
- quiz: `correctIndex` outside 0–3 and a non-4 `choices` count → item dropped per
  upstream (confirm the spec's "clamp" wording against `panel-request-service.ts`;
  upstream **rejects/filters**, it does not clamp `correctIndex`)
- code-comparison: `betterSnippet` not `A`/`B` → dropped; unknown `category`/
  `difficulty` handled exactly as upstream (clamp vs drop)
- did-you-know: empty/generic facts filtered (not padded); unknown `category`
- resources: non-`https://` URL filtered out; a mix of valid + invalid keeps only
  the valid ones
- **empty-result path for all four**: when every item is invalid, the method
  returns its wrapper key with an **empty array** (not an error, not a bare array)

*Webview gating* — the webview has **no DOM test harness** (PR #14 deferred a
render test for the same reason). Do **not** assert rendered behavior; instead
assert statically that `tools/patches/0006-webview-llm-capability-gate.patch`
adds all four method names to `PROVIDER_METHODS` (a patch-text string assertion),
or record this as a manual code-review checklist item.

Verification target: `cd sidecar && npm test`.

Kotlin tests are not required for this slice unless the implementation changes
host stamping, provider detection, settings, or capabilities synthesis.

## Documentation

- **`tools/patches/README.md`** — update the `0006` divergence-log row: it now moves
  **six** methods into `PROVIDER_METHODS` (the original two + these four), and the
  single-flag degraded set drops from 10 → 6.
- **ADR** — record the re-derived `learning-provider.ts` divergence (extend ADR 0010
  or a short new ADR). Note the re-sync implication: the module is sidecar-owned, so
  it will **not** break on an upstream sync, but it **can silently drift** from
  upstream prompt/validator changes — so an upstream sync that touches
  `panel-request-service.ts` or `panel-llm.ts` should re-check these re-derived
  prompts/validators. Add a pointer in the patches README so the drift risk is
  discoverable from the divergence log even though there is no patch file.
- **`.wolf/cerebrum.md`** — the existing Decision Log entry stands; no change needed.

## Out of Scope

- `compileNlRule`
- `createSkill` and `generateSkillContent`
- `triageSkills`, `triageCatalog`, and `reviewContextFiles`
- GitHub token or SDLC data capability work
- host-to-webview capability push
- live network validation of learning-resource URLs
- new CLI providers
