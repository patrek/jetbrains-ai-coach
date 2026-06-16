import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveProvider, COPILOT_MAX_PROMPT_BYTES, PROVIDER_TIMEOUT_MS } from './cli-provider';
import { claudeProvider } from './providers/claude-provider';
import { copilotProvider } from './providers/copilot-provider';

/** A spawn() stand-in: an EventEmitter with stream-shaped stdio + kill record. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killSignals: string[] = [];
  stdinData: string | undefined;
  stdin = {
    on: () => this.stdin,
    end: (data?: string) => {
      this.stdinData = data;
    },
  };

  kill(signal: string): boolean {
    this.killSignals.push(signal);
    return true;
  }

  // Convenience: drive a clean exit.
  exit(code: number, out = '', err = ''): void {
    if (out) this.stdout.emit('data', Buffer.from(out));
    if (err) this.stderr.emit('data', Buffer.from(err));
    this.emit('close', code);
  }
}

interface SpawnCall {
  bin: string;
  args: string[];
}

/** Returns a spawn seam that always yields `child` and records each call. */
function fakeSpawn(child: FakeChild): { spawn: typeof import('node:child_process').spawn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn = ((bin: string, args: string[]) => {
    calls.push({ bin, args });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  return { spawn, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveProvider', () => {
  it('resolves the two known provider ids', () => {
    expect(resolveProvider('claude')).toBe(claudeProvider);
    expect(resolveProvider('copilot')).toBe(copilotProvider);
  });

  it('returns undefined for an unknown id', () => {
    expect(resolveProvider('gemini')).toBeUndefined();
    expect(resolveProvider('')).toBeUndefined();
  });
});

describe('claudeProvider', () => {
  it('returns the parsed .result on a clean JSON exit', async () => {
    const child = new FakeChild();
    const { spawn, calls } = fakeSpawn(child);
    const p = claudeProvider.run('make a rule', { binaryPath: '/bin/claude', spawn });
    child.exit(0, JSON.stringify({ result: '# Generated rule', session_id: 'abc', total_cost_usd: 0.01 }));

    expect(await p).toEqual({ ok: true, text: '# Generated rule' });
    expect(calls[0]).toEqual({ bin: '/bin/claude', args: ['-p', '--output-format', 'json', '--tools', ''] });
    expect(child.stdinData).toBe('make a rule'); // prompt via stdin, never argv
  });

  it('maps ENOENT to not-installed', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = claudeProvider.run('x', { binaryPath: '/bin/claude', spawn });
    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    expect(await p).toEqual({ ok: false, reason: 'not-installed' });
  });

  it('maps a non-zero exit with an auth stderr to unauthenticated', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = claudeProvider.run('x', { binaryPath: '/bin/claude', spawn });
    child.exit(1, '', 'Error: not logged in. Please run claude login.');
    expect(await p).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('maps a generic non-zero exit to cli-error', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = claudeProvider.run('x', { binaryPath: '/bin/claude', spawn });
    child.exit(2, '', 'segfault');
    expect(await p).toEqual({ ok: false, reason: 'cli-error' });
  });

  it('maps malformed JSON to bad-output', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = claudeProvider.run('x', { binaryPath: '/bin/claude', spawn });
    child.exit(0, 'not json at all');
    expect(await p).toEqual({ ok: false, reason: 'bad-output' });
  });

  it('maps an empty/whitespace result to bad-output', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = claudeProvider.run('x', { binaryPath: '/bin/claude', spawn });
    child.exit(0, JSON.stringify({ result: '   ' }));
    expect(await p).toEqual({ ok: false, reason: 'bad-output' });
  });

  it('maps a missing or non-string .result key to bad-output', async () => {
    const child1 = new FakeChild();
    const p1 = claudeProvider.run('x', { binaryPath: '/bin/claude', spawn: fakeSpawn(child1).spawn });
    child1.exit(0, JSON.stringify({ session_id: 'abc' })); // no result key
    expect(await p1).toEqual({ ok: false, reason: 'bad-output' });

    const child2 = new FakeChild();
    const p2 = claudeProvider.run('x', { binaryPath: '/bin/claude', spawn: fakeSpawn(child2).spawn });
    child2.exit(0, JSON.stringify({ result: 42 })); // non-string result
    expect(await p2).toEqual({ ok: false, reason: 'bad-output' });
  });

  it('kills a timed-out child (SIGTERM then SIGKILL) and reports timeout', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = claudeProvider.run('x', { binaryPath: '/bin/claude', spawn });

    vi.advanceTimersByTime(PROVIDER_TIMEOUT_MS); // deadline → SIGTERM
    vi.advanceTimersByTime(2_000); // child still alive → SIGKILL backstop
    child.emit('close', null); // child finally dies

    expect(await p).toEqual({ ok: false, reason: 'timeout' });
    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});

describe('copilotProvider', () => {
  it('returns trimmed plain-text stdout on a clean exit', async () => {
    const child = new FakeChild();
    const { spawn, calls } = fakeSpawn(child);
    const p = copilotProvider.run('explain this', { binaryPath: '/bin/copilot', spawn });
    child.exit(0, '  the explanation  \n');

    expect(await p).toEqual({ ok: true, text: 'the explanation' });
    expect(calls[0].args).toEqual(['-p', 'explain this', '-s', '--no-ask-user']);
  });

  it('maps ENOENT to not-installed', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = copilotProvider.run('x', { binaryPath: '/bin/copilot', spawn });
    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    expect(await p).toEqual({ ok: false, reason: 'not-installed' });
  });

  it('maps any non-zero exit to cli-error (no auth signature parsing)', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = copilotProvider.run('x', { binaryPath: '/bin/copilot', spawn });
    child.exit(1, 'some output', 'not logged in'); // would-be auth text stays cli-error
    expect(await p).toEqual({ ok: false, reason: 'cli-error' });
  });

  it('maps empty stdout to bad-output', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = copilotProvider.run('x', { binaryPath: '/bin/copilot', spawn });
    child.exit(0, '   \n  ');
    expect(await p).toEqual({ ok: false, reason: 'bad-output' });
  });

  it('rejects an oversize prompt with cli-error without spawning', async () => {
    const spawn = vi.fn() as unknown as typeof import('node:child_process').spawn;
    const huge = 'a'.repeat(COPILOT_MAX_PROMPT_BYTES + 1);
    const result = await copilotProvider.run(huge, { binaryPath: '/bin/copilot', spawn });
    expect(result).toEqual({ ok: false, reason: 'cli-error' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('kills a timed-out child (SIGTERM then SIGKILL) and reports timeout', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = copilotProvider.run('x', { binaryPath: '/bin/copilot', spawn });

    vi.advanceTimersByTime(PROVIDER_TIMEOUT_MS);
    vi.advanceTimersByTime(2_000);
    child.emit('close', null);

    expect(await p).toEqual({ ok: false, reason: 'timeout' });
    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});

describe('child lifecycle (shared spawn helper)', () => {
  it('kills the child and reports timeout when the caller signal aborts', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const ac = new AbortController();
    const p = claudeProvider.run('x', { binaryPath: '/bin/claude', spawn, signal: ac.signal });

    ac.abort(); // shutdown cancellation → SIGTERM
    child.emit('close', null); // child dies before the SIGKILL backstop

    expect(await p).toEqual({ ok: false, reason: 'timeout' });
    expect(child.killSignals).toContain('SIGTERM');
  });

  it('maps a synchronous spawn throw to cli-error', async () => {
    const throwingSpawn = (() => {
      throw new Error('spawn blew up');
    }) as unknown as typeof import('node:child_process').spawn;
    const result = await claudeProvider.run('x', { binaryPath: '/bin/claude', spawn: throwingSpawn });
    expect(result).toEqual({ ok: false, reason: 'cli-error' });
  });
});

describe('shell-injection safety', () => {
  const MALICIOUS = '"; rm -rf ~ #';

  it('passes a shell-meta prompt to Copilot as a single argv element', async () => {
    const child = new FakeChild();
    const { spawn, calls } = fakeSpawn(child);
    const p = copilotProvider.run(MALICIOUS, { binaryPath: '/bin/copilot', spawn });
    child.exit(0, 'ok');
    await p;
    // The whole prompt is exactly one argv element — never split or interpolated.
    expect(calls[0].args).toEqual(['-p', MALICIOUS, '-s', '--no-ask-user']);
  });

  it('passes a shell-meta prompt to Claude via stdin, never argv', async () => {
    const child = new FakeChild();
    const { spawn, calls } = fakeSpawn(child);
    const p = claudeProvider.run(MALICIOUS, { binaryPath: '/bin/claude', spawn });
    child.exit(0, JSON.stringify({ result: 'ok' }));
    await p;
    expect(child.stdinData).toBe(MALICIOUS);
    expect(calls[0].args).not.toContain(MALICIOUS);
  });
});