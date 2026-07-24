import { z } from 'zod';

import type { ToolDef } from '../types.js';
import { loadToolPrompt } from '../prompts/load.js';
import { globToRegExp, walkFiles } from './walk.js';

const paramsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
});

type GlobParams = z.infer<typeof paramsSchema>;

export const globTool: ToolDef<GlobParams> = {
  id: 'glob',
  description: loadToolPrompt('glob'),
  parameters: paramsSchema,
  isReadOnly: true,
  isConcurrencySafe: true,
  isDestructive: false,
  execute: async (params) => {
    const root = params.path ?? process.cwd();
    const regex = globToRegExp(params.pattern);
    const matched = walkFiles(root)
      .filter((relPath) => regex.test(relPath))
      .sort();

    return { output: matched.length > 0 ? matched.join('\n') : '(no matches)' };
  },
};
