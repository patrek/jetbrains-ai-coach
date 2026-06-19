import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexProvider } from './codex-provider';
import { PROVIDER_TIMEOUT_MS } from '../cli-provider';

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

describe('codexProvider', () => {
  it('returns the parsed agent_message text from NDJSON stream', async () => {
    const child = new FakeChild();
    const { spawn, calls } = fakeSpawn(child);
    const p = codexProvider.run('make a rule', { binaryPath: '/bin/codex', spawn });
    
    // Simulate NDJSON output with multiple events (actual Codex format)
    const ndjson = [
      '{"type":"thread.started","thread_id":"abc123"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"# Generated rule"}}',
      '{"type":"turn.completed"}',
    ].join('\n');
    
    child.exit(0, ndjson);

    expect(await p).toEqual({ ok: true, text: '# Generated rule' });
    expect(calls[0]).toEqual({ 
      bin: '/bin/codex', 
      args: ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-']
    });
    expect(child.stdinData).toBe('make a rule'); // prompt via stdin, never argv
  });

  it('extracts the last agent_message when multiple exist', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    
    const ndjson = [
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"first response"}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"ls"}}',
      '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"final response"}}',
    ].join('\n');
    
    child.exit(0, ndjson);
    expect(await p).toEqual({ ok: true, text: 'final response' });
  });

  it('skips malformed JSON lines and extracts valid agent_message', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    
    const ndjson = [
      'not json at all',
      '{"type":"turn.started"}',
      '{broken json',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"the answer"}}',
      '',
      'more garbage',
    ].join('\n');
    
    child.exit(0, ndjson);
    expect(await p).toEqual({ ok: true, text: 'the answer' });
  });

  it('maps no agent_message to bad-output', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    
    const ndjson = [
      '{"type":"thread.started","thread_id":"abc"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls"}}',
      '{"type":"turn.completed"}',
    ].join('\n');
    
    child.exit(0, ndjson);
    expect(await p).toEqual({ ok: false, reason: 'bad-output' });
  });

  it('maps empty agent_message text to bad-output', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    
    const ndjson = '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"   "}}';
    child.exit(0, ndjson);
    expect(await p).toEqual({ ok: false, reason: 'bad-output' });
  });

  it('maps missing text field to bad-output', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    
    const ndjson = '{"type":"item.completed","item":{"id":"item_1","type":"agent_message"}}';
    child.exit(0, ndjson);
    expect(await p).toEqual({ ok: false, reason: 'bad-output' });
  });

  it('maps ENOENT to not-installed', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    expect(await p).toEqual({ ok: false, reason: 'not-installed' });
  });

  it('maps non-zero exit with auth stderr to unauthenticated', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    child.exit(1, '', 'Error: 401 Unauthorized - invalid token');
    expect(await p).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('maps non-zero exit with "authentication" in stderr to unauthenticated', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    child.exit(1, '', 'authentication failed: please log in');
    expect(await p).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('maps generic non-zero exit to cli-error', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    child.exit(2, '', 'internal error');
    expect(await p).toEqual({ ok: false, reason: 'cli-error' });
  });

  it('kills a timed-out child (SIGTERM then SIGKILL) and reports timeout', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });

    vi.advanceTimersByTime(PROVIDER_TIMEOUT_MS); // deadline → SIGTERM
    vi.advanceTimersByTime(2_000); // child still alive → SIGKILL backstop
    child.emit('close', null); // child finally dies

    expect(await p).toEqual({ ok: false, reason: 'timeout' });
    expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('kills the child and reports timeout when the caller signal aborts', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const ac = new AbortController();
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn, signal: ac.signal });

    ac.abort(); // shutdown cancellation → SIGTERM
    child.emit('close', null); // child dies before the SIGKILL backstop

    expect(await p).toEqual({ ok: false, reason: 'timeout' });
    expect(child.killSignals).toContain('SIGTERM');
  });

  it('passes a shell-meta prompt via stdin, never argv', async () => {
    const MALICIOUS = '"; rm -rf ~ #';
    const child = new FakeChild();
    const { spawn, calls } = fakeSpawn(child);
    const p = codexProvider.run(MALICIOUS, { binaryPath: '/bin/codex', spawn });
    
    const ndjson = '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"ok"}}';
    child.exit(0, ndjson);
    await p;
    
    expect(child.stdinData).toBe(MALICIOUS);
    expect(calls[0].args).not.toContain(MALICIOUS);
    expect(calls[0].args).toContain('-'); // stdin marker
  });

  it('handles empty lines in NDJSON stream', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    
    const ndjson = [
      '',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"response"}}',
      '',
      '',
    ].join('\n');
    
    child.exit(0, ndjson);
    expect(await p).toEqual({ ok: true, text: 'response' });
  });

  it('trims whitespace from extracted text', async () => {
    const child = new FakeChild();
    const { spawn } = fakeSpawn(child);
    const p = codexProvider.run('test', { binaryPath: '/bin/codex', spawn });
    
    const ndjson = '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"  response with spaces  \\n"}}';
    child.exit(0, ndjson);
    expect(await p).toEqual({ ok: true, text: 'response with spaces' });
  });
});

// Made with Bob
