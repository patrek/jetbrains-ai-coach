# Design: GitHub Release artifact for the plugin zip

Date: 2026-06-16
Status: Approved (brainstorm)

## Overview

Make the installable plugin zip downloadable from GitHub. Pushing a version tag
(`vX.Y.Z`) runs a workflow that builds the plugin and publishes a GitHub Release
with the zip attached. This is distribution-by-sideload, separate from the
JetBrains Marketplace path (which needs signing and a Marketplace token).

## Decisions

- **Trigger:** version-tag push → GitHub Release (durable, versioned, stable
  public download URL).
- **Signing:** unsigned for now. A GitHub-downloaded zip installs fine via
  "Install Plugin from Disk"; JetBrains only requires signing for the
  Marketplace. Signing can be added later when the certificate is provisioned.
- **Versioning:** derived from the git tag. The tag is the single source of
  truth — the zip name, `plugin.xml <version>`, and Release tag always match.
- **Structure:** a standalone `.github/workflows/release.yml`, isolated from the
  PR-CI workflow (`ci.yml`), publishing via `softprops/action-gh-release`.

## Workflow design (`.github/workflows/release.yml`)

### Triggers & permissions

- `on.push.tags: ['v*']` — the primary release path.
- `on.workflow_dispatch` with a `version` input — a manual test/dry-run hatch.
- `permissions: { contents: write }` — required to create the Release and upload
  assets. Everything else stays read-only.
- A `concurrency` group keyed on the ref cancels superseded runs.

### Build job (ubuntu-latest)

Reuses the same setup as the `ci.yml` plugin job:

1. `actions/checkout@v4`
2. `actions/setup-java@v4` (temurin, 21)
3. `actions/setup-node@v4` (20)
4. `gradle/actions/setup-gradle@v4`
5. `node tools/sync-upstream.mjs --skip-tests` — populate `sidecar/vendor/`.
6. `npm ci` in `sidecar/`.
7. **Derive `VERSION`:**
   - tag push: strip the leading `v` from `github.ref_name`.
   - `workflow_dispatch`: use the `version` input.
   - Guard: `VERSION` must match `^[0-9]+\.[0-9]+\.[0-9]+([-.].+)?$`; fail
     otherwise so a malformed tag never produces a release.
8. `./gradlew :plugin:buildPlugin -Pversion=$VERSION` — the `-P` property
   overrides `project.version`, which `patchPluginXml` stamps into `plugin.xml`.
9. **Fast safety gate:** `./gradlew :plugin:test` (platform-free unit tests, no
   IDE download — seconds). The 5-IDE `verifyPlugin` matrix already ran on this
   commit when it merged to `main`, so it is not repeated here.

### Asset naming

`buildPlugin` emits `plugin/build/distributions/plugin-$VERSION.zip` (the base
name is the Gradle project name, `plugin`). The workflow copies it to a clean
public filename **`ai-usage-coach-$VERSION.zip`** before upload. The copy lives
in the workflow so local `buildPlugin` behavior is unchanged.

### Release creation (`softprops/action-gh-release@v2`)

- `files: ai-usage-coach-$VERSION.zip`
- `name: "AI Usage Coach $VERSION"`
- `tag_name`: the pushed tag (`github.ref_name`) on the tag path; `v$VERSION` on
  the `workflow_dispatch` path (paired with `draft: true`, so the tag is only
  created if the draft is later published).
- `generate_release_notes: true`
- `prerelease: ${{ contains(github.ref_name, '-') }}` — only `-rc`/`-beta` tags
  are prereleases; `vX.Y.Z` publish as normal releases.
- `draft: true` **only** on `workflow_dispatch`, so manual test runs produce an
  unpublished draft instead of public noise; real tag pushes publish immediately.
- Body: a one-line install instruction pointing at the README section.

## Documentation

Add an "Install from GitHub" section to `README.md`:

1. Download `ai-usage-coach-<version>.zip` from the Releases page.
2. **Settings → Plugins → ⚙ → Install Plugin from Disk…**, pick the zip.
3. Restart the IDE.

Node ≥ 20 is already documented in Requirements.

## Validation & edge cases

- **Validation:** YAML is not unit-testable. Run `workflow_dispatch` once to
  exercise the build + upload path — it produces a *draft* release, safe to
  delete. Then cut the first real release by pushing `v0.1.0`.
- **Re-running a tag:** `softprops/action-gh-release` updates the existing
  release's asset rather than erroring.
- **Build/sync failure:** the build step precedes the release step, so a broken
  build fails the job and no release is created.

## Acceptance criteria

- Pushing tag `vX.Y.Z` produces a published GitHub Release named
  "AI Usage Coach X.Y.Z" with `ai-usage-coach-X.Y.Z.zip` attached.
- The attached zip's `plugin.xml` `<version>` equals `X.Y.Z`.
- The zip installs via "Install Plugin from Disk" and the tool window loads.
- `workflow_dispatch` produces a draft release (not public).
- A malformed tag fails the job before any release is created.
- README documents the install-from-GitHub flow.

## Out of scope

- Plugin signing (unsigned by decision).
- JetBrains Marketplace publishing (`publishPlugin`, Marketplace token).
- Curated changelogs beyond GitHub's auto-generated notes.
