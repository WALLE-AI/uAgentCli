import type { PermissionMode } from '../permission/mode.js';

export const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypass', 'yolo'];

function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as string[]).includes(value);
}

/** REPL 命令需要的最小交互面——由 `cli/main.ts` 的 `runRepl()` 闭包实现。 */
export interface ReplCommandContext {
  print: (text: string) => void;
  resetState: () => void;
  requestAbort: () => void;
  requestExit: () => void;
  getMode: () => PermissionMode;
  setMode: (mode: PermissionMode) => void;
}

export interface ReplCommandDef {
  name: string;
  description: string;
  handle: (args: string, ctx: ReplCommandContext) => void;
}

export const REPL_COMMANDS: ReplCommandDef[] = [
  {
    name: '/help',
    description: 'List available commands.',
    handle: (_args, ctx) => {
      ctx.print(REPL_COMMANDS.map((c) => `  ${c.name} — ${c.description}`).join('\n'));
    },
  },
  {
    name: '/clear',
    description: 'Reset the conversation (session/memory/skills untouched).',
    handle: (_args, ctx) => {
      ctx.resetState();
      ctx.print('Conversation cleared.');
    },
  },
  {
    name: '/abort',
    description: 'Interrupt the currently running turn, if any.',
    handle: (_args, ctx) => {
      ctx.requestAbort();
    },
  },
  {
    name: '/exit',
    description: 'Exit uAgentCli.',
    handle: (_args, ctx) => {
      ctx.requestExit();
    },
  },
  {
    name: '/mode',
    description: `Show or switch the permission mode (${PERMISSION_MODES.join('/')}).`,
    handle: (args, ctx) => {
      const target = args.trim();
      if (!target) {
        ctx.print(`Current mode: ${ctx.getMode()}`);
        return;
      }
      if (!isPermissionMode(target)) {
        ctx.print(`Unknown mode "${target}". Valid modes: ${PERMISSION_MODES.join(', ')}`);
        return;
      }
      ctx.setMode(target);
      ctx.print(`Mode set to "${target}".`);
    },
  },
];

/**
 * 输入是否命中一个 slash 命令。以 `/` 开头的输入永远被当作"尝试调用命令"
 * 处理（命中已知命令则执行，未知命令给出清晰提示）——不会被当作普通聊天
 * 消息发给模型。只有完全不以 `/` 开头的输入才返回 `false`，交回调用方
 * 走正常发消息流程。
 */
export function dispatchReplCommand(input: string, ctx: ReplCommandContext): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return false;
  }

  const spaceIndex = trimmed.indexOf(' ');
  const name = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1);

  const command = REPL_COMMANDS.find((c) => c.name === name);
  if (!command) {
    ctx.print(`Unknown command "${name}". Type /help for a list of commands.`);
    return true;
  }
  command.handle(args, ctx);
  return true;
}
