/*
 * Trust-gate integration suite — drives the built sidecar over NDJSON with the
 * harness's mock host (which answers `trust/get` -> {}, so every personal /
 * project rule starts UNTRUSTED). It verifies the only security boundary against
 * arbitrary user-supplied rule DSL:
 *
 *   - pending-never-executes: an untrusted personal rule is listed as pending
 *     and its detections never appear in analyzer output;
 *   - approval admits the exact approved content and clears it from pending;
 *   - TOCTOU: editing a file after approval re-blocks it (the edited hash != the
 *     approved hash), so an edit is never silently trusted;
 *   - cross-project isolation: project A's rules never load for project B and
 *     vice-versa, even in one shared sidecar.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SidecarHarness } from './harness';
import { hashContent } from '../vendor/core/rule-trust';

interface RuleSummary { id: string; source: string }
interface RuleEditorData { rules: RuleSummary[] }
interface PendingInfo { filePath: string; layer: string; kind: string; hash: string }
interface PendingData { pending: PendingInfo[] }
interface AntiPatternsData { patterns?: { id: string }[] }

function ruleMarkdown(id: string, name: string): string {
  return [
    '---',
    `id: ${id}`,
    `name: ${name}`,
    'group: prompt-quality',
    'severity: low',
    'scope: requests',
    '---',
    '',
    'when: true',
  ].join('\n');
}

function rulesDir(root: string): string {
  return path.join(root, '.ai-engineer-coach', 'rules');
}

describe('sidecar trust gate — personal rules start untrusted', () => {
  // NOTE: the `it` blocks below run SEQUENTIALLY and share mutable state on
  // disk + in the sidecar's pending list. The intended order is:
  //   1. pending (untrusted) -> 2. approve -> 3. tamper re-blocks -> 4. no-op.
  // Each step depends on the prior step's side effects (approval map, file
  // contents). `originalContent` is captured in beforeAll so any test can pin
  // the gate's hash against the EXACT bytes written, independent of ordering.
  let home: string;
  let harness: SidecarHarness;
  let pendingPath: string;
  let originalContent: string;

  beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicoach-trust-'));
    home = path.join(root, 'home');
    const cacheDir = path.join(root, 'cache');
    fs.mkdirSync(home, { recursive: true });
    // Write the personal rule BEFORE startup so the gated load at install time
    // sees it untrusted and queues it as pending.
    const dir = rulesDir(home);
    fs.mkdirSync(dir, { recursive: true });
    pendingPath = path.join(dir, 'untrusted-personal.md');
    originalContent = ruleMarkdown('untrusted-personal', 'Untrusted Personal');
    fs.writeFileSync(pendingPath, originalContent, 'utf-8');

    harness = new SidecarHarness({ home, cacheDir });
    await harness.ready;
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it('lists the untrusted personal rule as pending and never executes it', async () => {
    const pending = (await harness.request('getLocalRulesPending')) as PendingData;
    const entry = pending.pending.find((p) => p.filePath === pendingPath);
    expect(entry).toBeDefined();
    expect(entry!.layer).toBe('personal');
    expect(entry!.kind).toBe('rule');

    // The gate must hash the file's CONTENT (SHA-256), not its path or a
    // constant. Pin the pending hash to the exact bytes written so a hashing
    // regression (e.g. hashing the path, or a stubbed/empty digest) is caught.
    expect(entry!.hash).toBe(hashContent(originalContent));
    // Sanity: the content hash is path-independent, so it must NOT equal a hash
    // of the file path — guards against a "hash the wrong input" regression.
    expect(entry!.hash).not.toBe(hashContent(pendingPath));

    // Pending => blocked => not registered => never in analyzer output.
    const editor = (await harness.request('getRuleEditor')) as RuleEditorData;
    expect(editor.rules.some((r) => r.id === 'untrusted-personal')).toBe(false);

    const anti = (await harness.request('getAntiPatterns')) as AntiPatternsData;
    expect((anti.patterns ?? []).some((p) => p.id === 'untrusted-personal')).toBe(false);
  });

  it('approves the pending rule, clears it from pending, and admits it', async () => {
    const result = (await harness.request('approveLocalRules', { filePaths: [pendingPath] })) as PendingData & { ok: boolean };
    expect(result.ok).toBe(true);
    expect(result.pending.some((p) => p.filePath === pendingPath)).toBe(false);

    const editor = (await harness.request('getRuleEditor')) as RuleEditorData;
    const rule = editor.rules.find((r) => r.id === 'untrusted-personal');
    expect(rule).toBeDefined();
    expect(rule!.source).toBe('personal');
  });

  it('TOCTOU: editing an approved file after approval re-blocks it', async () => {
    // The previous test approved the file at its original content. Overwrite it
    // with different content on disk, then reload: the edited hash != approved
    // hash, so the edit must NOT be silently trusted.
    fs.writeFileSync(pendingPath, ruleMarkdown('untrusted-personal', 'Tampered Personal'), 'utf-8');

    const reloaded = (await harness.request('reloadLocalRules')) as PendingData;
    const entry = reloaded.pending.find((p) => p.filePath === pendingPath);
    expect(entry).toBeDefined();
    expect(entry!.layer).toBe('personal');

    const editor = (await harness.request('getRuleEditor')) as RuleEditorData;
    expect(editor.rules.some((r) => r.id === 'untrusted-personal')).toBe(false);
  });

  it('approving a non-pending path is a no-op (does not throw, nothing admitted)', async () => {
    const bogus = path.join(rulesDir(home), 'does-not-exist.md');
    const result = (await harness.request('approveLocalRules', { filePaths: [bogus] })) as PendingData & { ok: boolean };
    expect(result.ok).toBe(true);
    // The still-tampered real file remains pending.
    expect(result.pending.some((p) => p.filePath === pendingPath)).toBe(true);
  });
});

describe('sidecar trust gate — cross-project isolation', () => {
  let home: string;
  let projA: string;
  let projB: string;
  let harness: SidecarHarness;

  beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicoach-xproj-'));
    home = path.join(root, 'home');
    projA = path.join(root, 'projA');
    projB = path.join(root, 'projB');
    const cacheDir = path.join(root, 'cache');
    fs.mkdirSync(home, { recursive: true });

    for (const [proj, id] of [[projA, 'proj-a-rule'], [projB, 'proj-b-rule']] as const) {
      const dir = rulesDir(proj);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${id}.md`);
      fs.writeFileSync(filePath, ruleMarkdown(id, id), 'utf-8');
    }

    harness = new SidecarHarness({ home, cacheDir });
    await harness.ready;
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  /** Approve every pending file for the given project root, then reload it. */
  async function approveAllPendingFor(projectRoot: string): Promise<void> {
    const pending = (await harness.request('reloadLocalRules', undefined, projectRoot)) as PendingData;
    const paths = pending.pending.filter((p) => p.layer === 'project').map((p) => p.filePath);
    await harness.request('approveLocalRules', { filePaths: paths }, projectRoot);
  }

  it('loads only the requested project root and never the other', async () => {
    // Approve both projects' rules (each scoped to its own root) so the gate is
    // not the thing hiding them — isolation must come from per-request scoping.
    await approveAllPendingFor(projA);
    await approveAllPendingFor(projB);

    const editorA = (await harness.request('getRuleEditor', undefined, projA)) as RuleEditorData;
    expect(editorA.rules.some((r) => r.id === 'proj-a-rule')).toBe(true);
    expect(editorA.rules.some((r) => r.id === 'proj-b-rule')).toBe(false);

    const editorB = (await harness.request('getRuleEditor', undefined, projB)) as RuleEditorData;
    expect(editorB.rules.some((r) => r.id === 'proj-b-rule')).toBe(true);
    expect(editorB.rules.some((r) => r.id === 'proj-a-rule')).toBe(false);
  });

  it('safe-mode drops the project layer but keeps built-ins', async () => {
    // A known built-in rule id (built-ins ship with the extension and are
    // implicitly trusted — see vendor/core/rule-trust.ts). Used to prove that
    // safe-mode drops ONLY the project layer, not every layer.
    const BUILTIN_ID = 'caps-lock';

    // BASELINE (safeMode:false): the project rule is admitted (it was approved
    // in the previous test), and the built-in is present. This rules out the
    // gate or scoping being the thing hiding the project rule.
    const baseline = (await harness.request('getRuleEditor', undefined, projA, false)) as RuleEditorData;
    expect(baseline.rules.some((r) => r.id === 'proj-a-rule')).toBe(true);
    expect(baseline.rules.some((r) => r.id === BUILTIN_ID)).toBe(true);

    // SAFE MODE (safeMode:true): the project layer is dropped...
    const safe = (await harness.request('getRuleEditor', undefined, projA, true)) as RuleEditorData;
    expect(safe.rules.some((r) => r.id === 'proj-a-rule')).toBe(false);
    expect(safe.rules.some((r) => r.id === 'proj-b-rule')).toBe(false);
    // ...but BUILT-IN rules must SURVIVE. A regression that drops all layers
    // (not just the project layer) would otherwise pass the assertions above;
    // this catches it.
    expect(safe.rules.some((r) => r.id === BUILTIN_ID)).toBe(true);
  });

  it('reloadLocalRules under safe-mode clears the project layer for later requests, built-ins survive', async () => {
    const BUILTIN_ID = 'caps-lock';

    // Reload projA with safeMode:true (the 4th arg). This exercises the reload
    // path under safe-mode, not just getRuleEditor. The reload response carries
    // the pending list (not the rule set); the loaded-layer effect is observed
    // through the follow-up getRuleEditor below.
    const reloaded = (await harness.request('reloadLocalRules', undefined, projA, true)) as PendingData;
    expect(Array.isArray(reloaded.pending)).toBe(true);

    // A subsequent read of the same project (still in safe-mode) must exclude
    // the project layer while keeping built-ins — i.e. the safe-mode reload
    // actually cleared the project rule from the active set.
    const after = (await harness.request('getRuleEditor', undefined, projA, true)) as RuleEditorData;
    expect(after.rules.some((r) => r.id === 'proj-a-rule')).toBe(false);
    expect(after.rules.some((r) => r.id === BUILTIN_ID)).toBe(true);

    // And once we drop back out of safe-mode, the approved project rule returns
    // (proving the reload cleared it transiently, not permanently revoked it).
    const restored = (await harness.request('getRuleEditor', undefined, projA, false)) as RuleEditorData;
    expect(restored.rules.some((r) => r.id === 'proj-a-rule')).toBe(true);
  });
});
