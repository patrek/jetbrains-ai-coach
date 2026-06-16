import { describe, expect, it } from 'vitest';
import { parseProvider } from './rpc-server';

// parseProvider is the trust boundary for the per-RPC provider stamp: untyped
// wire input that decides whether (and which) CLI gets spawned. It must accept
// only a well-formed { id, binaryPath } and reject everything else.
describe('parseProvider', () => {
  it('accepts a well-formed provider stamp', () => {
    expect(parseProvider({ id: 'claude', binaryPath: '/usr/bin/claude' })).toEqual({
      id: 'claude',
      binaryPath: '/usr/bin/claude',
    });
  });

  it('ignores extra fields, keeping only id + binaryPath', () => {
    expect(parseProvider({ id: 'copilot', binaryPath: '/c', rogue: true })).toEqual({
      id: 'copilot',
      binaryPath: '/c',
    });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'claude'],
    ['an array', ['claude', '/bin']],
    ['missing binaryPath', { id: 'claude' }],
    ['missing id', { binaryPath: '/bin/claude' }],
    ['a non-string id', { id: 1, binaryPath: '/bin/claude' }],
    ['a non-string binaryPath', { id: 'claude', binaryPath: 42 }],
  ])('returns undefined for %s', (_label, value) => {
    expect(parseProvider(value)).toBeUndefined();
  });
});