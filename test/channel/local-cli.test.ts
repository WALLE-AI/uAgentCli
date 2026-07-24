import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLocalCliAdapter } from '../../src/channel/adapters/local-cli.js';

function makeStreams() {
  return { input: new PassThrough(), output: new PassThrough() };
}

function writeLine(input: PassThrough, line: string): void {
  input.write(`${line}\n`);
}

function waitTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('local-cli channel adapter', () => {
  it('dispatches non-command lines to registered message handlers', async () => {
    const streams = makeStreams();
    const adapter = createLocalCliAdapter(streams);
    const received: string[] = [];
    adapter.onMessage((text) => received.push(text));

    writeLine(streams.input, 'hello there');
    await waitTick();

    expect(received).toEqual(['hello there']);
  });

  it('dispatches /abort lines to abort handlers instead of message handlers', async () => {
    const streams = makeStreams();
    const adapter = createLocalCliAdapter(streams);
    const messages: string[] = [];
    let aborted = false;
    adapter.onMessage((text) => messages.push(text));
    adapter.onAbort(() => {
      aborted = true;
    });

    writeLine(streams.input, '/abort');
    await waitTick();

    expect(aborted).toBe(true);
    expect(messages).toEqual([]);
  });

  it('send() writes text to the output stream', async () => {
    const streams = makeStreams();
    const adapter = createLocalCliAdapter(streams);

    const chunks: string[] = [];
    streams.output.on('data', (chunk) => chunks.push(chunk.toString()));

    adapter.send('hello from assistant');
    await waitTick();

    expect(chunks.join('')).toBe('hello from assistant\n');
  });

  it('supports multiple message handlers', async () => {
    const streams = makeStreams();
    const adapter = createLocalCliAdapter(streams);
    const a: string[] = [];
    const b: string[] = [];
    adapter.onMessage((text) => a.push(text));
    adapter.onMessage((text) => b.push(text));

    writeLine(streams.input, 'x');
    await waitTick();

    expect(a).toEqual(['x']);
    expect(b).toEqual(['x']);
  });
});
