/** 最小的渠道适配器接口：收发消息 + 中断通知。 */
export interface ChannelAdapter {
  send(text: string): void;
  onMessage(handler: (text: string) => void): void;
  onAbort(handler: () => void): void;
}
