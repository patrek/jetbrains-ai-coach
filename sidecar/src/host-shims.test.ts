import { describe, expect, it, vi } from 'vitest';
import { createHostTrustMemento, loadTrustSeed, type HostChannel } from './host-shims';

describe('createHostTrustMemento', () => {
  it('serves get synchronously from the in-memory mirror', () => {
    const memento = createHostTrustMemento({ seed: { 'trusted:a': true } });
    expect(memento.get('trusted:a', false)).toBe(true);
    expect(memento.get('missing', 'default')).toBe('default');
  });

  it('updates the mirror synchronously and resolves without a channel', async () => {
    const memento = createHostTrustMemento();
    await memento.update('k', 123);
    expect(memento.get('k', 0)).toBe(123);
  });

  it('writes updates through to the host channel', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const channel: HostChannel = { request };
    const memento = createHostTrustMemento({ channel });

    await memento.update('approved:rule', 'sha');

    expect(memento.get('approved:rule', '')).toBe('sha');
    expect(request).toHaveBeenCalledWith('trust/update', { key: 'approved:rule', value: 'sha' });
  });

  it('a failed host write does not reject the update (local save still succeeds)', async () => {
    const channel: HostChannel = { request: vi.fn().mockRejectedValue(new Error('host gone')) };
    const memento = createHostTrustMemento({ channel });
    await expect(memento.update('k', 1)).resolves.toBeUndefined();
    expect(memento.get('k', 0)).toBe(1);
  });
});

describe('loadTrustSeed', () => {
  it('returns an empty seed with no channel', async () => {
    expect(await loadTrustSeed()).toEqual({});
  });

  it('fetches a snapshot from the host channel', async () => {
    const channel: HostChannel = { request: vi.fn().mockResolvedValue({ 'trusted:x': true }) };
    expect(await loadTrustSeed(channel)).toEqual({ 'trusted:x': true });
  });

  it('degrades to empty when the host errors', async () => {
    const channel: HostChannel = { request: vi.fn().mockRejectedValue(new Error('nope')) };
    expect(await loadTrustSeed(channel)).toEqual({});
  });
});
