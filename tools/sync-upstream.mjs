#!/usr/bin/env node
/**
 * Vendoring pipeline for the upstream AI Engineering Coach VS Code extension.
 *
 * Pulls a pinned upstream SHA (see tools/upstream.lock), copies the shared
 * source trees (`src/core`, `src/webview`) into `sidecar/vendor/`, applies the
 * reviewed divergence set from `tools/patches/`, and runs the vendored test
 * suite. Vendored files are NEVER hand-edited — all divergence flows through a
 * patch. A patch that no longer applies fails loudly so drift surfaces in CI
 * rather than silently rotting.
 *
 * Usage:
 *   node tools/sync-upstream.mjs            full sync: fetch, copy, patch, test
 *   node tools/sync-upstream.mjs --dry-run  validate manifest, remote, patches only
 *   node tools/sync-upstream.mjs --skip-tests   sync without running vitest
 *
 * Env:
 *   SYNC_UPSTREAM_REPO   override the repo URL from the lock file (accepts a
 *                        local path — useful for offline runs and CI caching).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = path.join(REPO_ROOT, 'tools', 'upstream.lock');
const PATCHES_DIR = path.join(REPO_ROOT, 'tools', 'patches');
const CACHE_DIR = path.join(REPO_ROOT, 'tools', '.upstream-cache');
const SIDECAR_DIR = path.join(REPO_ROOT, 'sidecar');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_TESTS = args.has('--skip-tests');

function log(message) {
  console.log(`[sync] ${message}`);
}

function fail(message) {
  console.error(`[sync] ERROR: ${message}`);
  process.exit(1);
}

function git(cwd, ...gitArgs) {
  return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readManifest() {
  if (!fs.existsSync(LOCK_PATH)) fail(`missing manifest: ${LOCK_PATH}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch (err) {
    return fail(`manifest is not valid JSON: ${err.message}`);
  }
  if (!manifest.repo) fail('manifest is missing "repo"');
  if (!/^[0-9a-f]{40}$/.test(manifest.ref ?? '')) {
    fail('manifest "ref" must be a full 40-character commit SHA');
  }
  if (!manifest.paths || Object.keys(manifest.paths).length === 0) {
    fail('manifest is missing "paths"');
  }
  manifest.repo = process.env.SYNC_UPSTREAM_REPO || manifest.repo;
  return manifest;
}

function listPatches() {
  if (!fs.existsSync(PATCHES_DIR)) return [];
  return fs
    .readdirSync(PATCHES_DIR)
    .filter(name => name.endsWith('.patch'))
    .sort()
    .map(name => path.join(PATCHES_DIR, name));
}

function ensureCacheRepo(repo) {
  if (!fs.existsSync(path.join(CACHE_DIR, '.git'))) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    log(`cloning ${repo} (blob-filtered)`);
    git(REPO_ROOT, 'clone', '--filter=blob:none', '--no-checkout', repo, CACHE_DIR);
  }
}

function fetchRef(repo, ref) {
  log(`fetching ${ref.slice(0, 12)}`);
  // Set the origin in case SYNC_UPSTREAM_REPO changed between runs.
  git(CACHE_DIR, 'remote', 'set-url', 'origin', repo);
  try {
    git(CACHE_DIR, 'fetch', '--filter=blob:none', 'origin', ref);
  } catch {
    // Some servers reject fetching a bare SHA; fall back to fetching all refs.
    git(CACHE_DIR, 'fetch', '--filter=blob:none', 'origin');
  }
  try {
    git(CACHE_DIR, 'cat-file', '-e', `${ref}^{commit}`);
  } catch {
    fail(`pinned ref ${ref} not found in ${repo}`);
  }
}

function extractPath(ref, srcPath, destPath) {
  const absDest = path.join(REPO_ROOT, destPath);
  fs.rmSync(absDest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(absDest), { recursive: true });

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-upstream-'));
  try {
    // `git archive | tar -x` extracts a subtree at the pinned SHA without
    // checking out a full working tree.
    const tarball = path.join(staging, 'tree.tar');
    execFileSync('git', ['-C', CACHE_DIR, 'archive', '--format=tar', '-o', tarball, ref, '--', srcPath]);
    execFileSync('tar', ['-x', '-f', tarball, '-C', staging]);
    const extractedRoot = path.join(staging, srcPath);
    if (!fs.existsSync(extractedRoot)) fail(`upstream path not found at ${ref}: ${srcPath}`);
    fs.cpSync(extractedRoot, absDest, { recursive: true });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  log(`vendored ${srcPath} -> ${destPath}`);
}

function applyPatches(patches) {
  if (patches.length === 0) {
    log('no patches to apply');
    return;
  }
  for (const patch of patches) {
    const name = path.basename(patch);
    // `git apply` is atomic per patch: it either applies the whole patch or
    // touches nothing, so a failure here cannot leave a half-applied file.
    try {
      git(REPO_ROOT, 'apply', patch);
    } catch (err) {
      fail(`patch does not apply cleanly: ${name}\n${err.stderr || err.message}`);
    }
    log(`applied patch ${name}`);
  }
}

function runVendoredTests() {
  if (SKIP_TESTS) {
    log('skipping tests (--skip-tests)');
    return;
  }
  if (!fs.existsSync(path.join(SIDECAR_DIR, 'node_modules'))) {
    log('installing sidecar dependencies (npm ci)');
    execFileSync('npm', ['ci'], { cwd: SIDECAR_DIR, stdio: 'inherit' });
  }
  log('running vendored vitest suite');
  execFileSync('npm', ['test'], { cwd: SIDECAR_DIR, stdio: 'inherit' });
}

function main() {
  const manifest = readManifest();
  const patches = listPatches();

  log(`repo: ${manifest.repo}`);
  log(`ref:  ${manifest.ref}`);
  log(`paths: ${Object.keys(manifest.paths).join(', ')}`);
  log(`patches: ${patches.length === 0 ? '(none)' : patches.map(p => path.basename(p)).join(', ')}`);

  if (DRY_RUN) {
    // Light reachability check that does not require fetching the full tree.
    try {
      git(REPO_ROOT, 'ls-remote', '--exit-code', manifest.repo, 'HEAD');
    } catch {
      fail(`upstream repo is not reachable: ${manifest.repo}`);
    }
    log('dry run OK: manifest valid, remote reachable, patches listed');
    return;
  }

  ensureCacheRepo(manifest.repo);
  fetchRef(manifest.repo, manifest.ref);
  for (const [srcPath, destPath] of Object.entries(manifest.paths)) {
    extractPath(manifest.ref, srcPath, destPath);
  }
  applyPatches(patches);
  runVendoredTests();
  log('sync complete');
}

main();
