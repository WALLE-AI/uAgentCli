import { describe, expect, it } from 'vitest';
import { ChannelRegistry } from '../../src/channel/registry.js';
import type { ChannelAdapter } from '../../src/channel/types.js';

function fakeAdapter(): ChannelAdapter {
  return { send: () => {}, onMessage: () => {}, onAbort: () => {} };
}

describe('ChannelRegistry', () => {
  it('registers and retrieves an adapter by name', () => {
    const registry = new ChannelRegistry();
    const adapter = fakeAdapter();
    registry.register('local-cli', adapter);
    expect(registry.get('local-cli')).toBe(adapter);
  });

  it('returns undefined for an unregistered name', () => {
    const registry = new ChannelRegistry();
    expect(registry.get('missing')).toBeUndefined();
  });

  it('re-registering the same name overwrites the previous adapter', () => {
    const registry = new ChannelRegistry();
    const first = fakeAdapter();
    const second = fakeAdapter();
    registry.register('local-cli', first);
    registry.register('local-cli', second);
    expect(registry.get('local-cli')).toBe(second);
  });
});
