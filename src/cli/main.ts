#!/usr/bin/env -S npx tsx --env-file-if-exists=.env
import readline from 'node:readline';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { openDatabase } from '../storage/db.js';

import { toSessionID } from '../types/ids.js';
import type { RunContext } from '../types/abort.js';
import type { Message, ToolResultBlock } from '../types/message.js';
import { initialEpoch } from '../context/epoch.js';
import { resolveProjectDoc } from '../context/pipeline.js';
import { TokenCounter } from '../context/token-counter.js';
import { ToolRegistry } from '../tool/registry.js';
import { readTool } from '../tool/builtin/read.js';
import { writeTool } from '../tool/builtin/write.js';
import { editTool } from '../tool/builtin/edit.js';
import { bashTool } from '../tool/builtin/bash.js';
import { grepTool } from '../tool/builtin/grep.js';
import { globTool } from '../tool/builtin/glob.js';
import { webFetchTool } from '../tool/builtin/webfetch.js';
import { createSkillTool } from '../tool/builtin/skill.js';
import { createTaskTool, type TaskContextBase } from '../tool/builtin/task.js';
import { PermissionManager } from '../permission/manager.js';
import type { Ruleset } from '../permission/types.js';
import { AgentRegistry } from '../agent/registry.js';
import { createAnthropicProvider } from '../llm/anthropic-provider.js';
import { createOpenAiCompatibleProvider } from '../llm/openai-compatible-provider.js';
import { createProviderRegistry, type ProviderRegistry } from '../llm/registry.js';
import type { LlmProvider, LlmUsage } from '../llm/types.js';
import { runOuterLoop, type PendingMessagesQueue, type RunLoopMutableState, type RunLoopStaticInput, type ToolExecutionDeps } from '../core/run-loop.js';
import { HookRegistry } from '../hooks/registry.js';
import { loadSoul, resolveIdentityPaths } from '../storage/identity-files.js';
import { discoverSkills } from '../skill/discovery.js';
import { formatSkills } from '../skill/registry.js';
import { resolveScope } from '../storage/paths.js';
import { LongTermMemoryStore } from '../memory/long-term-store.js';
import { runMemoryExtraction, shouldTriggerExtraction } from '../memory/extractor.js';
import type { MemoryStore } from '../memory/types.js';
import type { PermissionMode } from '../permission/mode.js';
import { dispatchReplCommand, type ReplCommandContext } from './repl-commands.js';

/** Ctrl+C 双击退出窗口——第一次按下先中断当前轮（若有），窗口内第二次才真正退出进程。 */
const SIGINT_EXIT_WINDOW_MS = 2000;

/**
 * 解析 `.env` 内容为 KEY→VALUE（忽略空行/`#` 注释；支持可选的成对引号；
 * 空值 `KEY=` 视为"不设置"，跳过——留给调用方保留其他来源的默认值）。
 * 纯函数，便于单测；副作用（写 `process.env`）在 `loadDotEnvOverrides()`。
 */
export function parseDotEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (isQuoted) {
      value = value.slice(1, -1);
    }
    if (key && value !== '') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 项目 `.env` **覆盖**（不是 Node `--env-file`/`--env-file-if-exists` 那种
 * "已存在的环境变量优先"的语义）——本项目的模型/provider 配置属于项目
 * 而非用户 shell 全局状态，shell 里残留的同名变量（常见于多项目共用
 * `OPENAI_API_KEY`/`OPENAI_BASE_URL` 这类通用名）不应该悄悄压过它。
 */
function loadDotEnvOverrides(cwd: string = process.cwd()): void {
  const envPath = path.join(cwd, '.env');
  if (!existsSync(envPath)) {
    return;
  }
  const vars = parseDotEnvContent(readFileSync(envPath, 'utf-8'));
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}

const MEMORY_AGENT_NAME = 'build';
const MEMORY_RETRIEVE_TOP_K = 5;
/** REPL 长会话里每隔多少条新消息才抽取一次，避免每回合都触发（§F）。 */
const MEMORY_EXTRACT_EVERY_N_MESSAGES = 4;

interface MemoryContext {
  store: MemoryStore;
  extractorPrompt: string;
  provider: LlmProvider;
  tokenCounter: TokenCounter;
  model: { id: string };
}

function buildMemorySnapshotText(store: MemoryStore): string {
  const retrieved = store.retrieve(MEMORY_AGENT_NAME, MEMORY_RETRIEVE_TOP_K);
  if (retrieved.length === 0) {
    return '<memory>\n(no memory entries retrieved this turn)\n</memory>';
  }
  return ['<memory>', ...retrieved.map((entry) => entry.content), '</memory>'].join('\n');
}

/** 跑完一轮后抽取本轮消息，写回同一个 store；抽取失败不影响本轮已产出的回复。 */
async function extractMemoryAfterTurn(memory: MemoryContext, sessionID: RunContext['sessionID'], messages: Message[]): Promise<void> {
  try {
    await runMemoryExtraction({
      agentName: MEMORY_AGENT_NAME,
      history: messages,
      provider: memory.provider,
      tokenCounter: memory.tokenCounter,
      model: memory.model,
      agentPrompt: memory.extractorPrompt,
      store: memory.store,
      parentSessionID: sessionID,
    });
  } catch (error) {
    console.error('memory extraction failed (ignored):', error instanceof Error ? error.message : String(error));
  }
}

export interface CliArgs {
  mode: 'repl' | 'once';
  message?: string;
}

/** 解析 argv：`--once "<message>"` 触发一次性非交互模式，否则默认交互式 REPL。 */
export function parseCliArgs(argv: string[]): CliArgs {
  const onceIndex = argv.indexOf('--once');
  if (onceIndex !== -1 && argv[onceIndex + 1] !== undefined) {
    return { mode: 'once', message: argv[onceIndex + 1] };
  }
  return { mode: 'repl' };
}

function buildEnvText(): string {
  return [
    '<env>',
    `cwd: ${process.cwd()}`,
    `platform: ${process.platform}`,
    `date: ${new Date().toISOString().slice(0, 10)}`,
    '</env>',
  ].join('\n');
}

function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

/** `ask()` 的同时在终端发起 y/n 交互，结果直接 `settle()`——CLI 的批准通道。 */
class InteractiveTerminalManager extends PermissionManager {
  override ask(request: Parameters<PermissionManager['ask']>[0]): Promise<'allow' | 'deny' | 'ask'> {
    const promise = super.ask(request);
    void (async () => {
      const allowed = await askYesNo(`Allow tool "${request.patterns[0]}" (${request.action})?`);
      this.settle(request.id, allowed ? 'allow' : 'deny');
    })();
    return promise;
  }
}

function formatUsage(usage: LlmUsage | undefined): string {
  if (!usage) {
    return '(no usage info)';
  }
  return [
    `input_tokens=${usage.inputTokens ?? 0}`,
    `output_tokens=${usage.outputTokens ?? 0}`,
    `cache_creation_input_tokens=${usage.cacheCreationInputTokens ?? 0}`,
    `cache_read_input_tokens=${usage.cacheReadInputTokens ?? 0}`,
  ].join(' ');
}

function extractFinalText(messages: Message[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!lastAssistant) {
    return '';
  }
  return lastAssistant.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** 按已配置的 API key 装配可用 provider；`model.id` 的族由 `selectModelVariant` 判定，见 llm/registry.ts。 */
function buildProviderRegistry(): ProviderRegistry {
  const providers: Partial<Record<'anthropic' | 'openai' | 'default', LlmProvider>> = {};
  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  if (process.env.OPENAI_API_KEY) {
    providers.openai = createOpenAiCompatibleProvider({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return createProviderRegistry(providers);
}

function resolveModelId(): string {
  return process.env.UAGENT_MODEL || 'claude-sonnet-5';
}

async function bootstrap() {
  const modelId = resolveModelId();
  const provider = buildProviderRegistry().getProvider(modelId);

  const cwd = process.cwd();
  const { home } = resolveScope(cwd);
  mkdirSync(home, { recursive: true });
  const identityPaths = resolveIdentityPaths(home, cwd);
  const soul = loadSoul(identityPaths);
  const projectDoc = resolveProjectDoc(cwd);
  const skills = discoverSkills([path.join(cwd, '.agents', 'skills')]);
  const skillsVerboseText = formatSkills(skills, { verbose: true });

  const memoryDb = openDatabase(path.join(home, 'memory.db'));
  const memoryStore = new LongTermMemoryStore(memoryDb);
  const memorySnapshotText = buildMemorySnapshotText(memoryStore);

  const registry = new ToolRegistry();
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(bashTool);
  registry.register(grepTool);
  registry.register(globTool);
  registry.register(webFetchTool);
  registry.register(createSkillTool(skills));

  const manager = new InteractiveTerminalManager();
  const ruleset: Ruleset = { rules: [] };
  const approved: Ruleset = { rules: [] };

  const tokenCounter = new TokenCounter();

  const config = {
    maxTurns: 30,
    maxIterationsBeforeGrace: 40,
    contextLimit: 180_000,
    maxOutputTokens: 4_096,
  };

  const taskContext: TaskContextBase = {
    defaultModel: { id: modelId },
    soulText: soul.clean,
    projectDocText: projectDoc,
    skillsVerboseText,
    memorySnapshotText,
    computeEnvText: buildEnvText,
    provider,
    tokenCounter,
    config,
  };
  const agentRegistry = new AgentRegistry({ userDir: home, projectDir: cwd });
  registry.register(
    createTaskTool({ agents: agentRegistry, toolRegistry: registry, parentRuleset: ruleset, context: taskContext, manager }),
  );

  const memory: MemoryContext = {
    store: memoryStore,
    extractorPrompt: agentRegistry.get('memory-extractor')!.prompt,
    provider,
    tokenCounter,
    model: { id: modelId },
  };

  const sessionID = toSessionID(`local-${process.pid}`);
  const controller = new AbortController();
  const ctx: RunContext = {
    signal: controller.signal,
    sessionID,
    depth: 0,
    permission: { mode: 'default', sessionID },
  };

  const staticInput: RunLoopStaticInput = {
    model: { id: modelId },
    soulText: soul.clean,
    projectDocText: projectDoc,
    skillsVerboseText,
    memorySnapshotText,
    computeEnvText: buildEnvText,
    tools: registry.getTools(),
    provider,
    tokenCounter,
    config,
    onTextDelta: (text) => process.stdout.write(text),
  };

  const toolDeps: ToolExecutionDeps = { registry, ruleset, approved, manager, mode: 'default', hooks: new HookRegistry() };

  return { staticInput, toolDeps, ctx, controller, memory };
}

async function runOnce(message: string): Promise<void> {
  let bootstrapped: Awaited<ReturnType<typeof bootstrap>>;
  try {
    bootstrapped = await bootstrap();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const { staticInput, toolDeps, ctx, memory } = bootstrapped;
  const emptyQueue: PendingMessagesQueue = { drain: () => [] };
  const state: RunLoopMutableState = {
    epoch: initialEpoch(),
    messages: [{ role: 'user', seq: 1, content: [{ type: 'text', text: message }] }],
    nextSeq: 2,
  };

  console.log('--- streaming reply ---');
  const result = await runOuterLoop(state, ctx, staticInput, toolDeps, emptyQueue);
  process.stdout.write('\n');

  console.log('--- terminal decision ---');
  console.log(JSON.stringify(result.decision));
  if (result.decision.type === 'terminal' && result.decision.detail) {
    console.error('--- error detail ---');
    console.error(result.decision.detail);
  }

  const toolResults = result.state.messages
    .flatMap((m) => m.content)
    .filter((b): b is ToolResultBlock => b.type === 'tool_result');
  if (toolResults.length > 0) {
    console.log(`--- ${toolResults.length} tool call(s) executed ---`);
  }

  // `--once` 是全新进程，天然满足"非每回合"的抽取间隔——每次运行后都尝试一次。
  if (result.state.messages.length >= 2) {
    await extractMemoryAfterTurn(memory, ctx.sessionID, result.state.messages);
  }
}

async function runRepl(): Promise<void> {
  let bootstrapped: Awaited<ReturnType<typeof bootstrap>>;
  try {
    bootstrapped = await bootstrap();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const { staticInput, toolDeps, ctx: initialCtx, memory } = bootstrapped;
  const pendingMessages: Message[] = [];
  const queue: PendingMessagesQueue = {
    drain: () => {
      const drained = [...pendingMessages];
      pendingMessages.length = 0;
      return drained;
    },
  };

  let state: RunLoopMutableState = { epoch: initialEpoch(), messages: [], nextSeq: 1 };
  let lastExtractedAtMessageCount = 0;

  // 每一轮都用全新的 AbortController/signal——共用一个会让 /abort 或
  // Ctrl+C 中断一次之后，后续每轮在 runInnerLoop 第一步就看到
  // `signal.aborted === true` 而直接判定为 aborted（见 T13 排查记录）。
  let currentController = new AbortController();
  let currentCtx: RunContext = { ...initialCtx, signal: currentController.signal };
  let isRunning = false;
  let lastSigintAt = 0;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('uAgentCli — type a message, /help for commands, Ctrl+C to interrupt/exit.');
  rl.setPrompt('> ');
  rl.prompt();

  const commandCtx: ReplCommandContext = {
    print: (text) => console.log(text),
    resetState: () => {
      state = { epoch: initialEpoch(), messages: [], nextSeq: 1 };
    },
    requestAbort: () => {
      if (isRunning) {
        currentController.abort();
        console.log('Aborted.');
      } else {
        console.log('Nothing is running.');
      }
    },
    requestExit: () => rl.close(),
    getMode: () => toolDeps.mode,
    setMode: (mode: PermissionMode) => {
      toolDeps.mode = mode;
      currentCtx = { ...currentCtx, permission: { ...currentCtx.permission, mode } };
    },
  };

  function runTurn(): void {
    isRunning = true;
    currentController = new AbortController();
    currentCtx = { ...currentCtx, signal: currentController.signal };

    void runOuterLoop(state, currentCtx, staticInput, toolDeps, queue).then(async (result) => {
      // `isRunning` 必须一直保持 true 到"这一轮彻底收尾"（包括记忆抽取
      // 这个额外的真实 API 调用）为止——提早翻 false 会让用户在抽取还在
      // 跑的窗口期发的新消息，被当成"没有轮次在跑"而另起一次真正并发的
      // runOuterLoop，跟抽取调用抢同一个 provider/连接池，观感上像卡死。
      state = result.state;
      process.stdout.write('\n');
      if (result.decision.type === 'terminal' && result.decision.detail) {
        console.error(`--- ${result.decision.reason} ---`);
        console.error(result.decision.detail);
      }

      if (shouldTriggerExtraction(state.messages.length, lastExtractedAtMessageCount, { everyNMessages: MEMORY_EXTRACT_EVERY_N_MESSAGES })) {
        lastExtractedAtMessageCount = state.messages.length;
        await extractMemoryAfterTurn(memory, currentCtx.sessionID, state.messages);
      }

      isRunning = false;

      // 一个终止态为 aborted 的 outer loop 不会自己去 drain 挂起队列——如果
      // 用户在"上一轮已经在收尾但 isRunning 还没翻成 false"这个窗口期发了
      // 新消息，它会被推进 pendingMessages 却没人处理。这里在每轮结束时
      // 兜底检查一次，避免消息被静默吞掉。
      if (pendingMessages.length > 0) {
        runTurn();
        return;
      }

      rl.prompt();
    });
  }

  rl.on('line', (line) => {
    if (dispatchReplCommand(line, commandCtx)) {
      rl.prompt();
      return;
    }
    const trimmed = line.trim();
    if (trimmed === '') {
      rl.prompt();
      return;
    }

    pendingMessages.push({ role: 'user', seq: state.nextSeq, content: [{ type: 'text', text: trimmed }] });
    state = { ...state, nextSeq: state.nextSeq + 1 };

    // 已经有一轮在跑：新消息只入队，交给那一轮的外层 steering-drain 去捡
    // （见 run-loop.ts 的 runOuterLoop），不再另起一次并发的 runOuterLoop。
    if (!isRunning) {
      runTurn();
    }
  });

  // `rl.on('SIGINT', ...)` only fires in raw/keypress input mode; our
  // readline interface runs in the default cooked mode, where a real
  // Ctrl+C is intercepted by the terminal driver and delivered as an
  // actual OS SIGINT signal to the process, not as a raw `\x03` byte on
  // stdin -- must hook it at the process level, not the readline level.
  process.on('SIGINT', () => {
    if (isRunning) {
      currentController.abort();
      console.log('\n(aborted — press Ctrl+C again within 2s to exit, or keep typing)');
      lastSigintAt = Date.now();
      rl.prompt();
      return;
    }
    const now = Date.now();
    if (now - lastSigintAt < SIGINT_EXIT_WINDOW_MS) {
      rl.close();
      return;
    }
    lastSigintAt = now;
    console.log('\n(press Ctrl+C again within 2s to exit, or type /exit)');
    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
}

async function main(): Promise<void> {
  loadDotEnvOverrides();
  const args = parseCliArgs(process.argv.slice(2));
  if (args.mode === 'once' && args.message) {
    await runOnce(args.message);
    return;
  }
  await runRepl();
}

/**
 * `argv[1]` may be a symlink (e.g. an `npm link`-installed global bin
 * pointing at this file) while `import.meta.url` resolves through it to
 * the real path -- resolve both to real paths before comparing, or this
 * silently never fires when run via a linked bin.
 */
function resolveRealPathSafe(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${resolveRealPathSafe(process.argv[1])}`;
if (isMainModule) {
  void main();
}

export { formatUsage, extractFinalText };
