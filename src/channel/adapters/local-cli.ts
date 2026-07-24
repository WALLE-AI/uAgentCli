import readline from 'node:readline';
import type { ChannelAdapter } from '../types.js';

export interface LocalCliStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

const ABORT_COMMAND = '/abort';

/** 把 Node `readline` 的输入/输出包装成 `ChannelAdapter`；`/abort` 行触发中断处理器。 */
export function createLocalCliAdapter(
  streams: LocalCliStreams = { input: process.stdin, output: process.stdout },
): ChannelAdapter {
  const rl = readline.createInterface({ input: streams.input });
  const messageHandlers: Array<(text: string) => void> = [];
  const abortHandlers: Array<() => void> = [];

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed === ABORT_COMMAND) {
      for (const handler of abortHandlers) {
        handler();
      }
      return;
    }
    for (const handler of messageHandlers) {
      handler(line);
    }
  });

  return {
    send: (text) => {
      streams.output.write(`${text}\n`);
    },
    onMessage: (handler) => {
      messageHandlers.push(handler);
    },
    onAbort: (handler) => {
      abortHandlers.push(handler);
    },
  };
}
