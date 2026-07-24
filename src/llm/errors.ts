/**
 * §H 归一化错误类型：provider 适配层负责把各家 SDK 的错误映射到这四类，
 * run-loop 的错误分支只认识这四类，不需要理解具体 SDK 的错误形状。
 */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class RateLimitError extends LlmProviderError {
  constructor(message = 'rate limited') {
    super(message, true);
  }
}

export class OverloadError extends LlmProviderError {
  constructor(message = 'provider overloaded') {
    super(message, true);
  }
}

export class ContextLengthExceededError extends LlmProviderError {
  constructor(message = 'context length exceeded') {
    super(message, false);
  }
}

export class ContentFilterError extends LlmProviderError {
  constructor(message = 'content filtered') {
    super(message, false);
  }
}
