import { z } from 'zod';

import type { ToolDef } from '../types.js';
import { loadToolPrompt } from '../prompts/load.js';

const paramsSchema = z.object({
  url: z.string().url(),
  timeoutMs: z.number().int().positive().optional(),
});

type WebFetchParams = z.infer<typeof paramsSchema>;

const DEFAULT_TIMEOUT_MS = 10_000;

/** 极简 HTML→纯文本：去掉 script/style 整块，再去掉剩余标签，折叠空白。 */
function stripHtml(html: string): string {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim();
}

export const webFetchTool: ToolDef<WebFetchParams> = {
  id: 'webfetch',
  description: loadToolPrompt('webfetch'),
  parameters: paramsSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  untrustedOutput: true,
  execute: async (params, ctx) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    ctx.signal.addEventListener('abort', onAbort);

    try {
      const response = await fetch(params.url, { signal: controller.signal });
      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();
      const output = contentType.includes('text/html') ? stripHtml(text) : text;
      return {
        output,
        metadata: { status: response.status, contentType },
      };
    } finally {
      clearTimeout(timeout);
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
};
