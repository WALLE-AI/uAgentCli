import { describe, expect, it } from 'vitest';
import { toMessageID, toSessionID, toToolCallID } from '../../src/types/ids.js';

describe('branded ID constructors', () => {
  it('toSessionID wraps a plain string', () => {
    expect(toSessionID('sess-1')).toBe('sess-1');
  });

  it('toMessageID wraps a plain string', () => {
    expect(toMessageID('msg-1')).toBe('msg-1');
  });

  it('toToolCallID wraps a plain string', () => {
    expect(toToolCallID('call-1')).toBe('call-1');
  });
});
