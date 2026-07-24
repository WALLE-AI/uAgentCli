import type { Message, TextBlock } from '../types/message.js';
import type { RunContext } from '../types/abort.js';
import { toSessionID, type SessionID } from '../types/ids.js';
import { initialEpoch } from '../context/epoch.js';
import type { TokenCounter } from '../context/token-counter.js';
import type { LlmProvider } from '../llm/types.js';
import { PermissionManager } from '../permission/manager.js';
import {
  runOuterLoop,
  type PendingMessagesQueue,
  type RunLoopMutableState,
  type RunLoopStaticInput,
  type ToolExecutionDeps,
} from '../core/run-loop.js';
import { ToolRegistry } from '../tool/registry.js';
import type { MemoryStore } from './types.js';

/** 阈值触发：每隔 `everyNMessages` 条新消息才抽取一次，不是每回合都抽取（§F）。 */
export interface ExtractionThreshold {
  everyNMessages: number;
}

export function shouldTriggerExtraction(
  currentMessageCount: number,
  lastExtractedAtMessageCount: number,
  threshold: ExtractionThreshold,
): boolean {
  return currentMessageCount - lastExtractedAtMessageCount >= threshold.everyNMessages;
}

function flattenText(message: Message): string {
  return message.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}

function serializeHistory(history: Message[]): string {
  return history
    .filter((m) => flattenText(m).length > 0)
    .map((m) => `${m.role}: ${flattenText(m)}`)
    .join('\n');
}

function extractLastAssistantText(messages: Message[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  return lastAssistant ? flattenText(lastAssistant) : '';
}

/** 抽取子任务只输出"一行一条"的记忆条目；空行/纯空白行被丢弃。 */
function parseExtractedEntries(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface RunMemoryExtractionInput {
  /** 记忆条目要写入的命名空间（通常是发起抽取的 agent 名）。 */
  agentName: string;
  history: Message[];
  provider: LlmProvider;
  tokenCounter: TokenCounter;
  model: { id: string };
  /** memory-extractor 的 prompt（来自 agent/registry.ts 的内置定义）。 */
  agentPrompt: string;
  store: MemoryStore;
  parentSessionID: SessionID;
}

export interface RunMemoryExtractionResult {
  writtenIds: string[];
}

/**
 * §F 记忆抽取子任务：MVP 同步跑一次验证（异步化标注为后续），零工具、
 * 单轮（`maxTurns: 1`）——只把序列化后的历史喂给 `memory-extractor` 子
 * agent，解析其输出成条目逐条写入 `store`。子 session 与父完全隔离，
 * 除写入的记忆条目外没有任何状态回灌父会话。
 */
export async function runMemoryExtraction(input: RunMemoryExtractionInput): Promise<RunMemoryExtractionResult> {
  const registry = new ToolRegistry();
  const manager = new PermissionManager();
  const childSessionID = toSessionID(`${input.parentSessionID}::memory-extractor`);

  const ctx: RunContext = {
    signal: new AbortController().signal,
    sessionID: childSessionID,
    depth: 1,
    permission: { mode: 'default', sessionID: childSessionID },
  };

  const staticInput: RunLoopStaticInput = {
    model: input.model,
    agentPrompt: input.agentPrompt,
    soulText: '',
    projectDocText: '',
    skillsVerboseText: '',
    memorySnapshotText: '<memory>\n(none)\n</memory>',
    computeEnvText: () => '<env></env>',
    tools: [],
    provider: input.provider,
    tokenCounter: input.tokenCounter,
    config: { maxTurns: 1, maxIterationsBeforeGrace: 2, contextLimit: 200_000, maxOutputTokens: 1024 },
  };

  const toolDeps: ToolExecutionDeps = {
    registry,
    ruleset: { rules: [] },
    approved: { rules: [] },
    manager,
    mode: 'default',
  };

  const prompt = [
    'Extract durable memory items from this transcript, one item per line.',
    'Output nothing else.',
    '',
    serializeHistory(input.history),
  ].join('\n');

  const state: RunLoopMutableState = {
    epoch: initialEpoch(),
    messages: [{ role: 'user', seq: 1, content: [{ type: 'text', text: prompt }] }],
    nextSeq: 2,
  };
  const emptyQueue: PendingMessagesQueue = { drain: () => [] };

  const result = await runOuterLoop(state, ctx, staticInput, toolDeps, emptyQueue);
  const entries = parseExtractedEntries(extractLastAssistantText(result.state.messages));

  const writtenIds = entries.map(
    (content) => input.store.write({ agentName: input.agentName, content }).id,
  );

  return { writtenIds };
}
