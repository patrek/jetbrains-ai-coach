## Simplification Analysis

**Target**: `docs/superpowers/specs/2026-06-17-learning-llm-methods-design.md`
**Reviewer scope**: Design spec only — no implementation code reviewed.
**Grounding files read**: `sidecar/src/rpc-handlers.ts`, `sidecar/src/cli-provider.ts`,
`sidecar/vendor/webview/panel-llm.ts`, `tools/patches/0006-webview-llm-capability-gate.patch`,
`tools/patches/README.md`.

---

### Core Purpose

Wire four Learning-page LLM methods (`generateLearningQuiz`, `generateLearningResources`,
`generateCodeComparison`, `generateDidYouKnow`) to the existing selectable CLI provider
infrastructure so they behave like `generateRule` / `explainOccurrence`: use the
host-stamped provider when active, degrade to `llm-unavailable` otherwise.

---

### Unnecessary Complexity Found

#### 1. Dedicated `learning-provider.ts` module — premature file boundary

The spec mandates a new non-vendored module `sidecar/src/learning-provider.ts` to hold
prompt builders, a JSON helper, repair/retry logic, and per-method validators. Looking at
the actual precedent — `generateRule` and `explainOccurrence` in `rpc-handlers.ts` —
neither has been factored into its own module. Both handlers live directly inside
`rpc-handlers.ts` (lines 289–361), beside `runWithProvider` (lines 276–287). The two
handlers together total roughly 70 lines. Even if each Learning handler is somewhat
longer due to richer JSON validation, four handlers at ~40–50 lines each is 160–200
lines — perfectly within the size range of the existing file (390 lines total today,
growing to roughly 550–590 lines). Creating a separate module for them introduces an
import indirection with no architectural payoff; `rpc-handlers.ts` is the dispatcher and
would still need to import from `learning-provider.ts` rather than containing the code
directly.

The spec's rationale for the module ("keep prompts, JSON parsing, retries, and
normalizers in sidecar-owned code") is sound reasoning for *where the code lives* but
doesn't justify *why it needs its own file*. The existing handlers already satisfy
exactly that constraint while staying in `rpc-handlers.ts`. There is no reuse target
outside `rpc-handlers.ts` that would benefit from the extraction, and the file boundary
adds one more file to read, one more import chain to trace, and one more surface for
future reviewers to ask "why is this separate?"

Verdict: unless `rpc-handlers.ts` grows noticeably past ~600 lines or a second consumer
of the JSON helper emerges, the four handlers + a tiny shared JSON helper should live
directly in `rpc-handlers.ts`, matching the `generateRule`/`explainOccurrence` precedent
exactly.

#### 2. JSON repair/retry layer — re-implementing logic that already exists upstream

The spec calls for "JSON cleanup, repair, and retry behavior adapted from upstream
`panel-llm.ts` without importing the `vscode` dependency." This sounds reasonable at
first glance, but reading `panel-llm.ts` in full reveals that the JSON logic is
substantial:

- `parseLlmJson` (~60 lines): strips markdown fences, handles JSONL, boundary
  extraction, two fix passes.
- `balanceTruncatedJson` (~24 lines): full bracket-stack/escape-state machine.
- `callLlmJson` retry loop with structured-output fallback (~40 lines).

That is roughly 120 lines of non-trivial parsing logic with real edge-case handling
(JSONL, smart quotes, control characters, truncated responses). The spec proposes
adapting this for the sidecar — meaning re-writing it without the `vscode` import.

The `vscode`-specific parts of `panel-llm.ts` are not in the parsing path at all.
`parseLlmJson` and `balanceTruncatedJson` are pure-function string manipulation with
zero `vscode` references. The retry loop in `callLlmJson` uses `vscode.CancellationToken`
and `vscode.LanguageModelChatMessage`, but those are call-infrastructure concerns, not
JSON-parsing concerns. The JSON parsing functions could be exported from `panel-llm.ts`
via a patch (patch `0009` or similar, analogous to `0008-export-generate-rule-helpers.patch`)
and imported directly — they are vscode-free.

The spec's stated reason for not importing from `panel-llm.ts` ("because that file
imports `vscode`") was examined carefully in the PR #13 work and is explicitly mitigated
by patches `0003` (type-only vscode import in `panel-shared.ts`) and the established
technique of exporting symbols via `0008`. The sidecar already successfully imports from
vendored files that contain `require('vscode')` inside try/catch (see `rpc-handlers.ts`
line 37–46). The parser `require('vscode')` in vendored code does not prevent importing
pure-function exports from those files.

Before committing to a re-implementation of `parseLlmJson` / `balanceTruncatedJson` in
sidecar-owned code, the implementer should verify whether a small export patch for those
two functions would work. If it does, the sidecar gets ~120 lines of battle-tested
parsing for free and never diverges from upstream fixes to it. If it does not (e.g., a
top-level side-effecting `vscode` import that cannot be isolated), only then is
re-implementation warranted. The spec does not record that this was evaluated — it
asserts the constraint as given. An implementer following the spec as written will
re-implement ~120 lines unnecessarily.

#### 3. Per-method normalizers/validators — scope is underconstrained in a way that invites over-building

The spec lists precise validation rules for each method (e.g., "exactly four choices,"
"difficulty clamped to easy/medium/hard," "URL beginning with `https://`"). These are
correct and necessary. What is missing is guidance on how much code these normalizers
should be. Without that, an implementer could reasonably write a defensive
object-by-object visitor for each method that totals 200+ lines, or they could write
four compact filter functions of ~10–15 lines each. The spec should explicitly say these
should be inline within each handler, not broken into separate exported validator
functions. Looking at `generateRule`/`explainOccurrence`, validation is 2–4 lines of
`isString` guards. The Learning methods need more (array item filtering), but the
spec's silence on implementation size invites over-engineering.

#### 4. The retry-with-nudge spec adds a complexity layer whose necessity is unverified

The spec requires: "Malformed JSON should trigger a bounded retry with an additional
instruction: respond only with a valid JSON object or array, no markdown fences and no
commentary." This is sensible, but the CLI providers are `claude` and `copilot` (Copilot
CLI's `--output-format json` flag). Looking at how existing CLI providers operate — they
receive a single flat prompt and return text — a JSON-only nudge requires the sidecar to
re-invoke the provider a second time with an augmented prompt. There is no evidence in
the spec (or elsewhere) of actual observed malformed JSON output from these two CLIs for
structured prompts. The `generateRule` handler has a retry loop for markdown validation,
which is justified because rule markdown has complex structural requirements. JSON output
from a well-prompted CLI is far more likely to be clean. Requiring retry infrastructure
before any integration testing has been done is speculative complexity; it would be
better specified as "add retry if empirically needed during integration testing."

---

### Code to Remove (from Spec)

These spec decisions, if followed as written, lead to unnecessary implementation work:

- `learning-provider.ts` module boundary — fold into `rpc-handlers.ts` directly.
  Estimated LOC reduction: 0 implementation LOC removed, but ~10–15 LOC of
  module-boundary boilerplate (exports, imports, module header comments) avoided.
- Re-implemented `parseLlmJson`/`balanceTruncatedJson` — replaced by export patch.
  Estimated LOC reduction: ~120 lines of re-derived parsing code not written.
- Separate exported validator functions per method — keep inline within handlers.
  Estimated LOC reduction: ~30–40 lines of abstraction overhead avoided.

---

### Simplification Recommendations

#### 1. Drop the `learning-provider.ts` module; keep handlers in `rpc-handlers.ts`

- Current spec: "Add a non-vendored sidecar module, `sidecar/src/learning-provider.ts`."
- Proposed: Add the four Learning handlers and any shared JSON helper directly in
  `rpc-handlers.ts`, structured the same way as `generateRule` and `explainOccurrence`.
  A shared `parseProviderJson` helper (inline or as a file-level function) of ~20–30
  lines handles fence stripping and common repairs without replicating the full upstream
  implementation. The four handlers register themselves in `OVERRIDES` and remove their
  entries from `LLM_UNAVAILABLE_METHODS`, exactly as the two existing provider-backed
  methods did.
- Impact: One fewer file to maintain; exact parity with the established pattern;
  no module-import chain to trace.

#### 2. Before re-implementing JSON parsing, try an export patch first

- Current spec: Re-implement `parseLlmJson`/`balanceTruncatedJson` in sidecar-owned code.
- Proposed: Add patch `0009-export-panel-llm-json-helpers.patch` exporting
  `parseLlmJson` (and optionally `balanceTruncatedJson`) from `panel-llm.ts`. Verify
  that importing them from the sidecar does not trigger a vscode crash (same technique
  as patch `0008`). If it works, import them directly — zero re-implementation, zero
  divergence risk.
- Impact: ~120 lines of re-derived code replaced by a ~5-line export patch; upstream
  fixes to the JSON parsing flow apply automatically on re-sync.

#### 3. Specify that normalizers are inline, not extracted

- Current spec: Silent on how normalizers are structured.
- Proposed: Add one sentence: "Normalizers should be inline within each handler, not
  extracted into separate exported functions, matching the existing handler style."
- Impact: Prevents an implementer from over-abstracting; keeps each handler
  self-contained and readable without jumping between functions.

#### 4. Downgrade retry to "implement if needed after integration testing"

- Current spec: "Malformed JSON should trigger a bounded retry" as a required behavior
  with required test coverage.
- Proposed: Specify retry as optional: "If integration testing reveals malformed JSON
  from CLI providers, add a single nudge retry." Make the test coverage conditional on
  implementing retry.
- Impact: Removes ~20–30 lines of retry plumbing and ~3–4 test cases if the CLIs
  produce clean JSON (very likely for Claude Code; probable for Copilot CLI with
  `--output-format json`).

---

### YAGNI Violations

#### Separate module for four handlers

Not needed now. The only consumer of `learning-provider.ts` is `rpc-handlers.ts`.
There is no second consumer on the horizon (the spec explicitly lists out-of-scope
items; none of them would reuse learning-specific prompt builders). Module extraction
is justified when two or more files need the same logic, or when a file grows past
comfortable reading size. Neither condition holds at implementation time.
Do instead: inline in `rpc-handlers.ts`.

#### Pre-emptive JSON repair for CLI output

The CLI providers (`claude`, `copilot`) are being called with explicit JSON-format
prompts. There is no baseline measurement of how often they produce malformed output.
Upstream's `parseLlmJson` was written for GitHub Copilot's language model (which uses
the VS Code LLM API with structured output options). The sidecar's CLI providers are
shell-invoked with a flat prompt — different failure modes. Building a full repair layer
before measuring actual failure rates is YAGNI.
Do instead: implement `JSON.parse` with fence-strip only, measure real failure rates,
add repair if warranted.

---

### PR Granularity Assessment

The spec proposes "one PR for all four methods." This is well-scoped and correct. The
four methods share the same infrastructure addition (`runWithProvider` already exists),
the same patch change (moving four names from one set to another in `shared.ts`), and
the same test structure. Splitting to two PRs (e.g., quiz + comparison in one, facts +
resources in another) would create an intermediate state where `PROVIDER_METHODS` in
the patch contains two of the four, which is confusing and not obviously shippable.
One PR is the right granularity here. No change recommended.

---

### Under-Specification Risks

These items in the spec leave enough ambiguity that an implementer could over-build
without violating the spec's intent:

1. "A local JSON helper layered on the existing CLI provider path" — does not specify
   whether this is a 10-line function or a 120-line re-implementation. Needs: "a
   simple fence-stripping + `JSON.parse`; only add repair if the export patch is not
   viable."

2. "Per-method validators and normalizers" — does not specify scope or structure. Needs:
   "inline within each handler; no separate exported validator class or module."

3. "Focused helper tests if the JSON parsing/normalization logic grows beyond simple
   inline coverage" — the hedge "grows beyond" is vague. An implementer might use this
   as license to add a separate test file from the start. Needs: "add a separate test
   file only if `rpc-handlers.test.ts` exceeds ~300 lines after adding the Learning
   method tests."

---

### Final Assessment

The spec is well-intentioned and architecturally sound in its high-level decisions
(provider failure semantics, webview gating, URL safety, out-of-scope discipline). The
core problem is that it specifies a module structure (`learning-provider.ts`) that
diverges from the established pattern without justification, and assumes re-implementing
upstream JSON parsing logic is necessary without first evaluating the export-patch
approach that was used successfully for `generateRule`.

The spec's intent — "keep prompts and parsing in sidecar-owned code, not vendored" —
is satisfied equally well by handlers living in `rpc-handlers.ts` (already sidecar-owned)
and by exporting the pure JSON helpers via a patch (zero behavior change, zero vscode
dependency, inert upstream — exactly the `0008` playbook).

Total potential LOC reduction: 25–35% of the anticipated implementation LOC
(primarily from avoiding the re-implemented JSON parser and abstraction overhead).

Complexity score: Medium (spec introduces unnecessary structural decisions; the
underlying feature is Low complexity once those are resolved).

Recommended action: Revise the spec on two points before implementation begins —
(1) specify that handlers live in `rpc-handlers.ts` unless the export-patch approach
for JSON helpers proves unviable, and (2) downgrade retry to optional pending
integration testing. The four method behaviors, error semantics, test matrix, patch
scope, and out-of-scope list are well-specified and should be preserved as-is.
