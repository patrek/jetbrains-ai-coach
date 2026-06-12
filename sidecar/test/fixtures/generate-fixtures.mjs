/*
 * Deterministic synthetic Claude Code session generator.
 *
 * Produces ~500 sessions in the upstream Claude JSONL layout
 * (`<out>/.claude/projects/<encoded-cwd>/<uuid>.jsonl`) so the sidecar's
 * perf and integration tests can parse real-shaped logs WITHOUT touching the
 * developer's home directory. Tests point `HOME` at the output dir.
 *
 * Determinism is required: the harness budget tools forbid `Date.now()` /
 * `Math.random()` because they would break resumable runs, and reproducible
 * fixtures keep CI honest ("not vibes"). All randomness comes from a seeded
 * mulberry32 PRNG and all timestamps from a fixed epoch, so the same inputs
 * always produce byte-identical output. The data is generated at test time,
 * never committed — only this script is.
 *
 * Usage:
 *   node generate-fixtures.mjs <outDir> [sessionCount]
 *   import { generateFixtures } from './generate-fixtures.mjs'
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const SEED = 0x5eed1234;
const EPOCH_MS = Date.parse('2025-01-01T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const PROJECT_CWDS = [
  '/Users/dev/acme-web',
  '/Users/dev/acme-api',
  '/Users/dev/payments-service',
  '/Users/dev/mobile-app',
  '/Users/dev/infra-terraform',
  '/Users/dev/data-pipeline',
  '/Users/dev/design-system',
  '/Users/dev/ml-experiments',
  '/Users/dev/docs-site',
  '/Users/dev/cli-tools',
];

const MODELS = [
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-3-5-sonnet',
  'claude-haiku-4',
];

const PROMPTS = [
  'add error handling to the upload endpoint',
  'refactor the auth middleware to use async/await',
  'why is this test flaky',
  'write a migration for the new column',
  'explain this stack trace',
  'optimize the N+1 query in the dashboard loader',
  'add a retry with backoff to the http client',
  'generate unit tests for the parser',
  'rename this module and fix all imports',
  'document the public API of this package',
];

const REPLIES = [
  'Done. I updated the handler and added a guard clause.',
  'I refactored it and the tests still pass.',
  'The flakiness comes from an unawaited promise; fixed.',
  'Migration written and applied to the local schema.',
  'That error is a null deref in the loader; here is the fix.',
  'Batched the query, cutting it from N+1 to two round-trips.',
];

/** mulberry32: tiny deterministic PRNG. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const intBetween = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

function encodeCwd(cwd) {
  return cwd.replaceAll('/', '-');
}

/** Deterministic pseudo-UUID derived from the session index. */
function sessionUuid(index) {
  const hex = (index * 0x9e3779b1 >>> 0).toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function isoAt(ms) {
  return new Date(ms).toISOString();
}

function buildSession(rng, index) {
  const cwd = PROJECT_CWDS[index % PROJECT_CWDS.length];
  const sessionId = sessionUuid(index);
  const model = pick(rng, MODELS);
  const requestCount = intBetween(rng, 1, 15);
  // Spread session start across ~5 months from the epoch.
  let ts = EPOCH_MS + intBetween(rng, 0, 150) * DAY_MS + intBetween(rng, 0, 18) * 60 * 60 * 1000;

  const lines = [];
  for (let r = 0; r < requestCount; r++) {
    lines.push({
      type: 'user',
      timestamp: isoAt(ts),
      sessionId,
      cwd,
      message: { role: 'user', content: [{ type: 'text', text: pick(rng, PROMPTS) }] },
    });
    ts += intBetween(rng, 5, 90) * 1000;
    lines.push({
      type: 'assistant',
      timestamp: isoAt(ts),
      sessionId,
      message: {
        role: 'assistant',
        model,
        content: [{ type: 'text', text: pick(rng, REPLIES) }],
        usage: {
          input_tokens: intBetween(rng, 200, 8000),
          output_tokens: intBetween(rng, 20, 1200),
        },
      },
    });
    ts += intBetween(rng, 30, 600) * 1000;
  }
  return { cwd, sessionId, lines };
}

export function generateFixtures(outDir, { sessions = 500 } = {}) {
  const rng = makeRng(SEED);
  const projectsRoot = path.join(outDir, '.claude', 'projects');
  fs.rmSync(projectsRoot, { recursive: true, force: true });

  let totalLines = 0;
  for (let i = 0; i < sessions; i++) {
    const { cwd, sessionId, lines } = buildSession(rng, i);
    const projDir = path.join(projectsRoot, encodeCwd(cwd));
    fs.mkdirSync(projDir, { recursive: true });
    const file = path.join(projDir, `${sessionId}.jsonl`);
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf-8');
    totalLines += lines.length;
  }
  return { sessions, projectsRoot, totalLines };
}

// CLI entry: `node generate-fixtures.mjs <outDir> [sessionCount]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('usage: node generate-fixtures.mjs <outDir> [sessionCount]');
    process.exit(1);
  }
  const count = process.argv[3] ? Number(process.argv[3]) : 500;
  const result = generateFixtures(outDir, { sessions: count });
  console.log(`generated ${result.sessions} sessions (${result.totalLines} lines) under ${result.projectsRoot}`);
}
