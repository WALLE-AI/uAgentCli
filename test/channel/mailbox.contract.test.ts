import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertTeammateMode, FileMailbox } from '../../src/channel/mailbox.js';

describe('assertTeammateMode (SendMessage constraint)', () => {
  it('passes for a teammate-mode agent', () => {
    expect(() => assertTeammateMode({ name: 'buddy', mode: 'teammate' })).not.toThrow();
  });

  it('rejects an asTool-mode agent with a clear error, not a silent no-op', () => {
    expect(() => assertTeammateMode({ name: 'explore', mode: 'asTool' })).toThrow(
      /only supports agents in "teammate" mode/,
    );
  });
});

describe('FileMailbox (real file-backed implementation)', () => {
  let dir: string;
  let mailbox: FileMailbox;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'uagentcli-mailbox-'));
    mailbox = new FileMailbox(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('receive() returns an empty array when the recipient has no mailbox file yet', async () => {
    expect(await mailbox.receive('nobody')).toEqual([]);
  });

  it('a sent message is delivered to receive() for the recipient', async () => {
    await mailbox.send({ from: 'a', to: 'b', body: 'hi' });
    expect(await mailbox.receive('b')).toEqual([{ from: 'a', to: 'b', body: 'hi' }]);
  });

  it('preserves send order across multiple messages to the same recipient', async () => {
    await mailbox.send({ from: 'a', to: 'b', body: 'first' });
    await mailbox.send({ from: 'a', to: 'b', body: 'second' });
    expect(await mailbox.receive('b')).toEqual([
      { from: 'a', to: 'b', body: 'first' },
      { from: 'a', to: 'b', body: 'second' },
    ]);
  });

  it('receive() consumes the mailbox: a second receive() returns nothing new', async () => {
    await mailbox.send({ from: 'a', to: 'b', body: 'hi' });
    await mailbox.receive('b');
    expect(await mailbox.receive('b')).toEqual([]);
  });

  it('does not cross-deliver messages addressed to a different recipient', async () => {
    await mailbox.send({ from: 'a', to: 'b', body: 'for b' });
    await mailbox.send({ from: 'a', to: 'c', body: 'for c' });
    expect(await mailbox.receive('b')).toEqual([{ from: 'a', to: 'b', body: 'for b' }]);
    expect(await mailbox.receive('c')).toEqual([{ from: 'a', to: 'c', body: 'for c' }]);
  });
});
