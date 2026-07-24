import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * 部分部署环境（企业内网/本沙箱）只能通过 HTTP(S) 代理访问外部 API，
 * 而两家 provider SDK 内置的 `node-fetch` 不会自动读取
 * `HTTP_PROXY`/`HTTPS_PROXY` 环境变量（不同于 `curl` 等工具）。这里只在
 * 环境变量存在时才构造一个 `httpAgent` 显式传给 SDK；未设置代理的环境
 * 完全不受影响。
 */
export function resolveProxyAgent(env: NodeJS.ProcessEnv = process.env): HttpsProxyAgent<string> | undefined {
  const proxyUrl = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  return proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;
}
