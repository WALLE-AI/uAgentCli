/**
 * §A 核心消息类型：Anthropic / OpenAI 兼容族的公共内容块超集。
 * 这是最高风险的一段类型设计——provider 适配、缓存策略、上下文装配
 * 均以此为唯一目标形状，冻结后不应轻改结构。
 */

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface ImageBlockSource {
  type: 'base64' | 'url';
  media_type?: string;
  data?: string;
  url?: string;
}

export interface ImageBlock {
  type: 'image';
  source: ImageBlockSource;
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | ImageBlock;

export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * `seq` 是单调递增序号，供 context epoch/prune 定位可见历史边界，
 * 不代表时间戳，不应参与缓存前缀的字节内容。
 */
export interface Message {
  role: MessageRole;
  content: ContentBlock[];
  seq: number;
}
