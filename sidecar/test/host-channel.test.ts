/*
 * Host-channel round-trip suite — drives the built sidecar with a mock host
 * (the harness answers `trust/get`/`trust/update`), verifying the part-3
 * follow-up that wires the `host-request`/`host-response` trust channel:
 *
 *   - the sidecar issues a `trust/get` at startup to seed its trust mirror;
 *   - a personal-layer rule approval is written through to the host as
 *     `trust/update`.
 *
 * This is the sidecar half of decision D5: trust authority lives in the IDE
 * host, mirrored in-process and fed over the same stdout stream as RPC.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SidecarHarness } from './harness';

const PERSONAL_RULE = [
  '---',
  'id: host-channel-rule',
  'name: Host Channel Rule',
  'group: prompt-quality',
  'severity: low',
  'scope: requests',
  '---',
  '',
  'when: true',
].join('\n');

describe('sidecar host channel — trust/* round-trip via a mock host', () => {
  let harness: SidecarHarness;

  beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicoach-host-'));
    const home = path.join(root, 'home');
    const cacheDir = path.join(root, 'cache');
    fs.mkdirSync(home, { recursive: true });
    harness = new SidecarHarness({ home, cacheDir });
    await harness.ready;
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it('issues a trust/get host-request at startup to seed the trust mirror', () => {
    expect(harness.hostRequests.some((r) => r.method === 'trust/get')).toBe(true);
  });

  it('writes a personal-layer rule approval through to the host as trust/update', async () => {
    const before = harness.hostRequests.filter((r) => r.method === 'trust/update').length;

    const result = (await harness.request('saveRule', { markdown: PERSONAL_RULE })) as { ok: boolean };
    expect(result.ok).toBe(true);

    // The write-through resolves before saveRule answers, but allow a tick for
    // the host-request line to be observed by the harness reader.
    await new Promise((r) => setTimeout(r, 50));
    const after = harness.hostRequests.filter((r) => r.method === 'trust/update').length;
    expect(after).toBeGreaterThan(before);
  });
});
