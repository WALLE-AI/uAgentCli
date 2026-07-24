/**
 * 品牌（branded）ID 类型：防止裸字符串在 session/message/tool-call
 * 之间误串用。构造函数不做格式校验，只做类型收窄。
 */

declare const sessionIdBrand: unique symbol;
declare const messageIdBrand: unique symbol;
declare const toolCallIdBrand: unique symbol;

export type SessionID = string & { readonly [sessionIdBrand]: true };
export type MessageID = string & { readonly [messageIdBrand]: true };
export type ToolCallID = string & { readonly [toolCallIdBrand]: true };

export function toSessionID(value: string): SessionID {
  return value as SessionID;
}

export function toMessageID(value: string): MessageID {
  return value as MessageID;
}

export function toToolCallID(value: string): ToolCallID {
  return value as ToolCallID;
}
