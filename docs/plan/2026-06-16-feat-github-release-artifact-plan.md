# feat: GitHub Release artifact for the plugin zip

**Date:** 2026-06-16
**Type:** enhancement
**Status:** Ready for implementation
**Branch:** `feat/github-release-artifact`
**Spec:** [`docs/superpowers/specs/2026-06-16-github-release-artifact-design.md`](../superpowers/specs/2026-06-16-github-release-artifact-design.md)

## Summary

Make the installable plugin zip downloadable from GitHub. Pushing a version tag
(`vX.Y.Z`) runs a new workflow that builds the plugin and publishes a GitHub
Release with the zip attached. This is distribution-by-sideload — separate from
the JetBrains Marketplace path (which requires signing and a Marketplace token,
both out of scope here).

The tag is the single source of truth: the zip name, the `plugin.xml`
`<version>`, and the Release tag all derive from it.

## Background & context

- **Versioning today:** `gradle.properties:2` pins `version = 0.1.0`. `plugin.xml`
  has **no** `<version>` element — `patchPluginXml` stamps `project.version` into
  the manifest at build time. Passing `-Pversion=$VERSION` overrides
  `project.version`, so the stamped version follows the tag with no source edit.
- **Build entry point:** `./gradlew :plugin:buildPlugin` emits the distributable
  to `plugin/build/distributions/plugin-<version>.zip`. The base name is the
  Gradle project name (`:plugin`, see `settings.gradle.kts:14`).
- **`buildPlugin` is self-contained for bundling** only if the sidecar tree and
  deps are present: `processResources` depends on `buildSidecar`, which runs
  `npm run build` in `sidecar/` over `src/` + `vendor/`
  (`plugin/build.gradle.kts:101-122`). So the workflow must sync upstream and
  `npm ci` the sidecar **before** building — exactly what `ci.yml` does.
- **Existing CI (`ci.yml`):** three jobs — `plugin` (5-IDE `verifyPlugin`
  matrix), `sidecar`, `sync-dry-run`. The release workflow **reuses the `plugin`
  job's setup steps** (checkout → JDK 21 → Node 20 → Gradle → sync → npm ci →
  build) but does **not** repeat the 5-IDE verify matrix — that already ran on
  the commit when it merged to `main`.
- **Signing is unset-safe:** `plugin/build.gradle.kts:67-75` reads signing /
  publish credentials from env vars; with them unset, `buildPlugin` still works.
  The release workflow never sets them, so the artifact is unsigned (by
  decision). Unsigned zips install fine via "Install Plugin from Disk".

## Goals

- Pushing tag `vX.Y.Z` produces a published GitHub Release with the plugin zip
  attached under a clean public name.
- `workflow_dispatch` provides a safe manual dry-run that produces a **draft**
  release (no public noise).
- A malformed version never produces a release (fail fast on a regex guard).
- README documents the install-from-GitHub flow.

## Non-goals (out of scope)

- Plugin signing (`signPlugin`) — unsigned by decision.
- JetBrains Marketplace publishing (`publishPlugin`, Marketplace token).
- Curated changelogs beyond GitHub's auto-generated notes.

## Files

| File | Action | Notes |
|------|--------|-------|
| `.github/workflows/release.yml` | **create** | The release workflow (below). |
| `README.md` | **edit** | Add "Install from GitHub" subsection under `## Getting started` (after line 28). |

## Implementation

### 1. `.github/workflows/release.yml` (new)

Mirror the `ci.yml` style (concurrency block, comment density, step naming).
Single `release` job on `ubuntu-latest`.

```yaml
name: Release

on:
  push:
    tags: ["v*"]
  workflow_dispatch:
    inputs:
      version:
        description: "Version to build (e.g. 0.1.0). Produces a DRAFT release."
        required: true

# Only the release job needs to create the Release and upload assets.
permissions:
  contents: write

# Cancel superseded runs on the same ref.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  release:
    name: Build & publish plugin zip
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"

      - name: Set up Node 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@v4

      # buildPlugin bundles the sidecar (esbuild over src/ + vendor/), so the
      # vendored tree and sidecar devDependencies must be present first.
      - name: Sync upstream (populate sidecar/vendor)
        run: node tools/sync-upstream.mjs --skip-tests

      - name: Install sidecar dependencies
        working-directory: sidecar
        run: npm ci

      # Tag push: strip leading "v" from the ref. workflow_dispatch: use the input.
      # Guard the result so a malformed tag never produces a release.
      # Untrusted input flows through env (never inline ${{ }} in run:) to keep
      # the dispatch input off the shell command line.
      - name: Derive version
        id: version
        env:
          EVENT_NAME: ${{ github.event_name }}
          DISPATCH_VERSION: ${{ github.event.inputs.version }}
        run: |
          if [ "$EVENT_NAME" = "workflow_dispatch" ]; then
            VERSION="$DISPATCH_VERSION"
          else
            VERSION="${GITHUB_REF_NAME#v}"
          fi
          if ! echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$'; then
            echo "::error::Invalid version '$VERSION' (expected X.Y.Z or X.Y.Z-suffix)"
            exit 1
          fi
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          # Prerelease iff a SemVer pre-release suffix is present (e.g. -rc.1).
          if echo "$VERSION" | grep -q '-'; then
            echo "prerelease=true" >> "$GITHUB_OUTPUT"
          else
            echo "prerelease=false" >> "$GITHUB_OUTPUT"
          fi

      # Fast safety gate first: platform-free unit tests (seconds, no IDE
      # download) fail fast before the heavier buildPlugin. The 5-IDE
      # verifyPlugin matrix already ran when this commit merged to main.
      - name: Run plugin tests
        run: ./gradlew :plugin:test

      # -Pversion overrides project.version, which patchPluginXml stamps into
      # plugin.xml — so the built manifest version matches the tag.
      - name: Build plugin
        run: ./gradlew :plugin:buildPlugin -Pversion=${{ steps.version.outputs.version }}

      # buildPlugin emits plugin-<version>.zip (base name = Gradle project name).
      # Copy to a clean public filename. ASSET is defined once and reused below.
      - name: Stage release asset
        env:
          ASSET: ai-usage-coach-${{ steps.version.outputs.version }}.zip
        run: |
          cp "plugin/build/distributions/plugin-${{ steps.version.outputs.version }}.zip" "$ASSET"

      # Pinned to a full commit SHA: this is the only third-party action and it
      # runs with contents: write. Resolve the SHA for the latest v2 tag at
      # implementation time and keep the version in the trailing comment.
      - name: Publish GitHub Release
        uses: softprops/action-gh-release@<full-40-char-sha>  # v2.x.x
        with:
          files: ai-usage-coach-${{ steps.version.outputs.version }}.zip
          name: AI Usage Coach ${{ steps.version.outputs.version }}
          tag_name: ${{ github.event_name == 'workflow_dispatch' && format('v{0}', steps.version.outputs.version) || github.ref_name }}
          generate_release_notes: true
          prerelease: ${{ steps.version.outputs.prerelease == 'true' }}
          draft: ${{ github.event_name == 'workflow_dispatch' }}
          body: |
            Install via **Settings → Plugins → ⚙ → Install Plugin from Disk…**
            and pick the attached zip. See the README "Install from GitHub"
            section for details.
```

**Key decisions reflected above:**

- **Asset name:** `buildPlugin` produces `plugin-<version>.zip`; the workflow
  copies it to `ai-usage-coach-<version>.zip` for a clean public download name.
- **`tag_name`:** on a tag push, reuse the pushed tag (`github.ref_name`); on
  `workflow_dispatch`, use `v<version>` paired with `draft: true` so the tag is
  only created if the draft is later published.
- **`prerelease`:** derived in the **Derive version** step from the *parsed
  version* (presence of a `-` suffix), **not** from `github.ref_name`. On a
  `workflow_dispatch` run `github.ref_name` is the branch (e.g. `main` or a
  hyphenated feature branch), so keying off it would misfire — the version-based
  flag is correct on both trigger paths. `vX.Y.Z-rc.1` publishes as a
  prerelease; clean `vX.Y.Z` as a normal release.
- **Untrusted input:** the `workflow_dispatch` `version` input is passed via
  `env:` (`DISPATCH_VERSION`) and referenced as `"$DISPATCH_VERSION"`, never
  inline `${{ }}` inside `run:` — this avoids interpolating attacker-controlled
  text onto the shell command line. The build step's `-Pversion=...` is safe
  because it uses the already-regex-validated `steps.version.outputs.version`.
- **Third-party action pinning:** `softprops/action-gh-release` is the only
  non-GitHub action and runs with `contents: write`. Pin it to a full commit
  SHA (version in a trailing comment) rather than the mutable `@v2` tag. The
  GitHub-owned `actions/*` stay at `@v4`, consistent with `ci.yml`.
- **`draft`:** only on `workflow_dispatch` — manual test runs produce an
  unpublished draft (safe to delete); real tag pushes publish immediately.
- **Ordering:** build precedes release, so a broken build/sync fails the job and
  no release is created. Re-running a tag updates the existing release's asset
  (action-gh-release behavior) rather than erroring.

### 2. `README.md` (edit)

The current `## Getting started` (README.md:23) is a numbered list. Inserting a
subsection mid-list would break the visual numbering, so add **`### Install from
GitHub` as a sibling subsection *after* the existing numbered steps** (i.e.
after README.md:28), not inside the list. Keep it short:

```markdown
### Install from GitHub

1. Download `ai-usage-coach-<version>.zip` from the [Releases page](../../releases).
2. **Settings → Plugins → ⚙ → Install Plugin from Disk…**, then pick the zip.
3. Restart the IDE.
```

Node ≥ 20 is already in `## Requirements` (README.md:16) — no change needed.

## Validation

YAML workflows are not unit-testable. Validate by exercising the real paths:

1. **Manual dry-run (`workflow_dispatch`):** trigger the workflow from the
   Actions tab with `version: 0.1.0`. Confirm it produces a **draft** release
   named "AI Usage Coach 0.1.0" with `ai-usage-coach-0.1.0.zip` attached, and
   does **not** appear publicly. Delete the draft after.
2. **Asset manifest check:** unzip the attached asset and confirm
   `META-INF/plugin.xml` has `<version>0.1.0</version>` (stamped via
   `-Pversion`).
3. **Install check:** install the downloaded zip via "Install Plugin from
   Disk", restart, and confirm the **AI Usage Coach** tool window loads.
4. **Malformed-tag guard:** confirm the regex guard rejects a bad version
   (can be checked locally by running the derive-version shell block with an
   invalid value, expecting a non-zero exit).
5. **Prerelease flag:** confirm `prerelease` is derived from the version, not
   the branch — a `0.1.0-rc.1` dispatch flags prerelease; a plain `0.1.0`
   dispatch from a hyphenated branch does **not**.
6. **Re-run dedupe:** re-push (or re-dispatch) the same version and confirm the
   release ends with a **single** `ai-usage-coach-<version>.zip` asset, not a
   duplicate.
7. **First real release:** push `v0.1.0` and confirm a published (non-draft)
   release appears with the asset.

## Acceptance criteria

- [ ] Pushing tag `vX.Y.Z` produces a **published** GitHub Release named
      "AI Usage Coach X.Y.Z" with `ai-usage-coach-X.Y.Z.zip` attached.
- [ ] The attached zip's `plugin.xml` `<version>` equals `X.Y.Z`.
- [ ] The zip installs via "Install Plugin from Disk" and the tool window loads.
- [ ] `workflow_dispatch` produces a **draft** release (not public).
- [ ] A malformed tag (e.g. `vfoo`) fails the job before any release is created.
- [ ] A `-rc`/`-beta` tag publishes as a prerelease; a clean `vX.Y.Z` does not.
- [ ] README documents the install-from-GitHub flow.

## Risks & edge cases

| Risk | Mitigation |
|------|------------|
| Sidecar not bundled into zip | Sync + `npm ci` steps run before `buildPlugin`, matching `ci.yml`. |
| Tag/manifest version drift | Single `-Pversion` value drives both the asset name and `patchPluginXml`. |
| Manual run pollutes public releases | `draft: true` on `workflow_dispatch` only. |
| Re-pushing a tag | `action-gh-release` updates the existing release's asset rather than erroring. |
| **`workflow_dispatch` with an already-published version** | `action-gh-release` targets the release by `tag_name` and does not distinguish draft from published — dispatching `version: X.Y.Z` when `vX.Y.Z` is already published **overwrites the published release's asset**. Only dry-run versions that are not yet released; treat dispatch as a pre-release-tag rehearsal hatch. |
| Command injection via dispatch input | Untrusted input passed via `env:`, never inline `${{ }}` in `run:`. |
| Supply-chain (third-party action) | `softprops/action-gh-release` pinned to a full commit SHA, not a mutable tag. |
| Accidental signing requirement | Workflow never sets signing env vars; `buildPlugin` is unset-safe. |
| `contents: write` over-scope | Scoped to this workflow only; everything else read-only. |
